-- Los jobs del sistema documental: quién le dice al servidor que hay un PDF que hacer.
--
-- EL PROBLEMA QUE CIERRA (deuda §12.49). Desde el spike, una fila de `documentos` nace
-- `pendiente_fichero` y **ahí se queda**: la Edge Function `generar-documento` había que
-- llamarla a mano. Fue deliberado —para medir el tiempo de generación sin el cron de por
-- medio—, pero deja el circuito a medias: un documento sin PDF es un documento que no
-- existe para quien lo tiene que recibir.
--
-- LA CADENA, igual que la del recordatorio de intake (20260722130000), que es el único
-- precedente del proyecto y por eso se copia en vez de inventar otra:
--
--   insert en documentos → trigger → net.http_post → generar-documento   (inmediato)
--   pg_cron cada 5 min   → disparar_generacion_pendiente() → net.http_post (reintento)
--   pg_cron a las 7:00   → disparar_recordatorios_documentales()          (enlaces)
--
-- POR QUÉ EL TRIGGER **Y** EL JOB, y no solo uno de los dos:
--   · Solo el trigger: si la función está caída, tiene un error de despliegue o el
--     `net.http_post` se pierde, ese documento no se genera nunca y nadie se entera.
--   · Solo el job: cada emisión tardaría hasta 5 minutos en tener PDF, y quien acaba de
--     pulsar «Emet» estaría mirando una pantalla que dice «Generant…» sin motivo.
--   Con los dos: el caso normal es instantáneo y el caso raro se recupera solo.
--
-- POR QUÉ `net.http_post` Y NO UNA LLAMADA SÍNCRONA. Postgres no puede generar un PDF
-- —ni debe: son 2 s de CPU en un runtime aparte, con fuentes y con una librería—, y un
-- trigger que esperase una respuesta HTTP mantendría abierta la transacción de emisión
-- mientras dura. `pg_net` encola la petición y la manda **después del commit**, así que
-- el documento existe antes de que nadie intente generarlo, que es el orden correcto: el
-- número pertenece a la fila, no al fichero (§A).
--
-- SEGURIDAD. La función se despliega `--no-verify-jwt` (la llama la base, que no tiene
-- JWT) y se protege con un secreto compartido en la cabecera `x-documentos-secret`. El
-- secreto vive en `app_config` —solo `service_role`, nunca en git (§4)— y en el secret
-- `DOCUMENTOS_SECRET` de la función, que lo valida. Se pone con:
--
--   deno run -A scripts/set-config.ts documentos_secret '<valor>'
--   supabase secrets set DOCUMENTOS_SECRET='<el mismo valor>'
--
-- ⚠️ Mientras el secreto no esté puesto, los tres disparadores son **no-op silencioso**
--    (un `notice` y fuera). Es a propósito: la migración tiene que poder aplicarse antes
--    que el secreto, y en local —donde no hay secreto ni función desplegada— el arnés
--    emite documentos de prueba sin que nada intente salir a la red.

-- ---------------------------------------------------------------------------
-- 1. De dónde sale la URL de las funciones
-- ---------------------------------------------------------------------------
-- 20260722130000 la escribió a pelo dentro de la función. Aquí se lee de `app_config`
-- con la misma URL de producción por defecto, por una razón práctica: contra una base
-- local se puede apuntar a `http://host.docker.internal:55321` y probar el circuito
-- entero sin tocar la migración. Si la clave no está, se comporta exactamente como
-- antes.
create or replace function public.url_funciones()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select nullif(value, '') from app_config where key = 'functions_base_url'),
    'https://uxppvaldhptdomvdhsmn.supabase.co/functions/v1'
  );
$$;

revoke execute on function public.url_funciones() from public, anon, authenticated;
grant  execute on function public.url_funciones() to service_role;

-- ---------------------------------------------------------------------------
-- 2. El trigger de encolado
-- ---------------------------------------------------------------------------
-- `after insert`: si el insert se deshace, no se ha encolado nada (pg_net solo manda lo
-- que sobrevive al commit). No lleva `for each statement` porque una emisión inserta
-- exactamente una fila y el `documento_id` va en el cuerpo.
create or replace function trg_documentos_encola_generacion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secreto text;
begin
  -- Un documento que ya nace con fichero no se encola (no pasa hoy, pero una futura
  -- importación de documentos históricos lo haría y no habría nada que generar).
  if new.fichero_at is not null or new.estado = 'emitido' then
    return new;
  end if;

  select value into secreto from app_config where key = 'documentos_secret';
  if secreto is null or secreto = '' then
    raise notice 'documentos_encola_generacion: sense secret configurat, no-op (%).', new.numero_completo;
    return new;
  end if;

  perform net.http_post(
    url     := public.url_funciones() || '/generar-documento',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-documentos-secret', secreto),
    body    := jsonb_build_object('documento_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists documentos_encola_generacion on documentos;
create trigger documentos_encola_generacion
  after insert on documentos
  for each row execute function trg_documentos_encola_generacion();

-- ---------------------------------------------------------------------------
-- 3. El reintento: cada 5 minutos
-- ---------------------------------------------------------------------------
-- Reencola lo que se quedó sin fichero. Las tres condiciones son las que importan:
--
--   · `estado in ('pendiente_fichero','error')` — lo `emitido` ya está hecho.
--   · `fichero_at is null` — cinturón: si el fichero existe, no se vuelve a subir aunque
--     el estado se hubiera quedado raro. `marcar_documento_generado()` es idempotente,
--     pero es mejor no llegar a pedírselo.
--   · `intentos < 5` — un documento que falla cinco veces tiene un problema que no se
--     arregla repitiendo (una plantilla rota, un parámetro que falta). A partir de ahí
--     se queda en la bandeja de Documents, en rojo, para que alguien lo mire. Sin este
--     tope, un fallo permanente serían 288 peticiones al día para siempre.
--
-- `intentos` lo sube `marcar_documento_error()` (20260928100800), no este job: lo que
-- cuenta es el número de generaciones fallidas, no el de veces que se ha encolado.
--
-- El `limit 50` acota el pico si alguna vez se acumulan: a 5 minutos son 600 documentos
-- por hora, muy por encima de cualquier ritmo real de Redestina.
create or replace function public.disparar_generacion_pendiente()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secreto text;
  d       record;
  n       int := 0;
begin
  select value into secreto from app_config where key = 'documentos_secret';
  if secreto is null or secreto = '' then
    raise notice 'disparar_generacion_pendiente: sense secret configurat, no-op';
    return;
  end if;

  for d in
    select id, numero_completo
      from documentos
     where estado in ('pendiente_fichero', 'error')
       and fichero_at is null
       and intentos < 5
     order by emitido_at
     limit 50
  loop
    perform net.http_post(
      url     := public.url_funciones() || '/generar-documento',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-documentos-secret', secreto),
      body    := jsonb_build_object('documento_id', d.id)
    );
    n := n + 1;
  end loop;

  if n > 0 then
    raise notice 'disparar_generacion_pendiente: % document(s) reencolat(s)', n;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Los recordatorios: una vez al día
-- ---------------------------------------------------------------------------
-- A diferencia del reintento, aquí la base **no decide nada**: solo despierta a la
-- función, que es quien sabe a los cuántos días toca recordar (7 y 14), quién puede
-- recibir correo (`modoTestActivo` + `esEmailTest`, §8) y qué texto se manda. Poner esa
-- lógica en SQL la duplicaría y la dejaría fuera del gate de envío.
--
-- 7:00 en hora del servidor (pg_cron corre en UTC: son las 9:00 en Madrid en verano y
-- las 8:00 en invierno). Un recordatorio de firma no es urgente y esa franja es la que
-- hace que llegue antes de que la persona empiece el día.
create or replace function public.disparar_recordatorios_documentales()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secreto text;
begin
  select value into secreto from app_config where key = 'documentos_secret';
  if secreto is null or secreto = '' then
    raise notice 'disparar_recordatorios_documentales: sense secret configurat, no-op';
    return;
  end if;

  perform net.http_post(
    url     := public.url_funciones() || '/recordatorios-documentales',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-documentos-secret', secreto),
    body    := '{}'::jsonb
  );
end;
$$;

-- Ni una ni otra las llama nadie desde el navegador: las llama pg_cron, que corre como
-- superusuario. `create function` concede EXECUTE a PUBLIC, así que hay que quitarlo.
revoke execute on function public.disparar_generacion_pendiente()      from public, anon, authenticated;
revoke execute on function public.disparar_recordatorios_documentales() from public, anon, authenticated;
grant  execute on function public.disparar_generacion_pendiente()      to service_role;
grant  execute on function public.disparar_recordatorios_documentales() to service_role;

-- ---------------------------------------------------------------------------
-- 5. Las agendas (idempotentes, como el job de vencidas y el de intake)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('documentos-pendientes')
    where exists (select 1 from cron.job where jobname = 'documentos-pendientes');
exception when others then null;
end $$;

select cron.schedule('documentos-pendientes', '*/5 * * * *',
                     'select public.disparar_generacion_pendiente()');

do $$
begin
  perform cron.unschedule('recordatorios-documentales')
    where exists (select 1 from cron.job where jobname = 'recordatorios-documentales');
exception when others then null;
end $$;

select cron.schedule('recordatorios-documentales', '0 7 * * *',
                     'select public.disparar_recordatorios_documentales()');

-- Verificación:
--   select jobname, schedule, active from cron.job order by jobname;
--   select public.disparar_generacion_pendiente();      -- sin secreto: NOTICE y nada más
--   select tgname from pg_trigger where tgrelid = 'documentos'::regclass and not tgisinternal;
--   -- Con el secreto puesto, tras emitir: select * from net._http_response order by created desc limit 1;
