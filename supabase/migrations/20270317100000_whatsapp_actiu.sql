-- Interruptor global de WhatsApp (`app_settings.whatsapp_activo`).
--
-- QUÉ ES. El super_admin puede apagar WhatsApp en TODA la plataforma desde Configuración.
-- Apagado, no sale ni un mensaje por WhatsApp —ni intake, ni recordatorios, ni ALTA/BAJA,
-- ni ofertas, ni accesos— y todo lo que tiene equivalente sale por correo (§8bis).
--
-- POR QUÉ NO SERVÍAN LOS INTERRUPTORES QUE YA HABÍA. `WHATSAPP_ENVIO_REAL` es un secreto
-- de entorno (no lo toca nadie desde el panel) y además SIMULA devolviendo `ok:true`, así
-- que ningún respaldo a correo se dispara: el mensaje se pierde en silencio. `test_mode`
-- decide A QUIÉN se envía, no POR DÓNDE. Este decide el canal, que es otra cosa.
--
-- FAIL-SAFE AL REVÉS QUE `test_mode`, y es deliberado. Aquí la duda no puede dejar a la
-- plataforma muda: solo un `'false'` explícito apaga WhatsApp. Así esta migración es un
-- no-op hasta que alguien pulse el interruptor, y una base recreada desde cero nace con el
-- comportamiento de siempre. En `test_mode` la duda corta un envío; aquí, no.

-- ---------------------------------------------------------------------------
-- 1. La clave, con el valor de siempre
-- ---------------------------------------------------------------------------
-- `do nothing`: si alguien ya la apagó, una reaplicación de la migración no la enciende.
insert into app_settings (key, value)
values ('whatsapp_activo', 'true')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. whatsapp_activo(): el interruptor, para lo que vive en SQL
-- ---------------------------------------------------------------------------
-- Gemela de `roles_activos()` (20260730092000) salvo en el `coalesce`: allí el defecto es
-- 'false' (fail-safe hacia lo permisivo), aquí es 'true'.
--
-- La leen `disparar_recordatorios_intake()` —para que el cron de 2 min no despierte una
-- Edge Function que no va a enviar nada— y `get_my_session_context()`, que es como se
-- entera el frontend: un productor NO puede leer `app_settings` (su RLS es `es_intern()`),
-- pero sí puede llamar a la RPC de sesión, que es `security definer`.
create or replace function public.whatsapp_activo()
returns boolean
language sql
stable
parallel restricted
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           (select value from app_settings where key = 'whatsapp_activo'),
           'true') <> 'false';
$$;

revoke execute on function public.whatsapp_activo() from public, anon;
grant  execute on function public.whatsapp_activo() to authenticated, service_role;

comment on function public.whatsapp_activo() is
  'Interruptor global de WhatsApp (app_settings.whatsapp_activo). Fail-safe ENCENDIDO: solo un ''false'' explícito lo apaga.';

-- ---------------------------------------------------------------------------
-- 3. get_my_session_context(): una clave nueva, `whatsapp_actiu`
-- ---------------------------------------------------------------------------
-- Se recrea entera (es `language sql` y no admite parches). El cuerpo es el de
-- 20270111100100 letra por letra, más `whatsapp_actiu`.
--
-- ⚠️ `parallel restricted` va EXPLÍCITO. `create or replace` reescribe **todos** los
--    atributos de la función: sin esta línea volvería a ser PARALLEL UNSAFE y desharía en
--    silencio 20260731080000. Es la trampa de siempre con esta función.
create or replace function public.get_my_session_context()
returns jsonb
language sql
stable
parallel restricted
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'user_id',        p.id,
    'email',          p.email,
    'nombre',         p.nombre,
    'idioma',         p.idioma,
    'activo',         p.activo,
    'rol',            public.mi_rol(),
    'roles_activos',  public.roles_activos(),
    'es_intern',      public.mi_rol() is not null,
    'pot_aprovar',    coalesce(public.mi_rol() in ('super_admin', 'admin'), false),
    'es_super_admin', coalesce(public.mi_rol() = 'super_admin', false),
    -- Interruptor global (20270317100000). Va aquí y no en una consulta aparte porque
    -- `app_settings` solo la lee el equipo, y esto lo necesitan los tres paneles.
    'whatsapp_actiu', public.whatsapp_activo(),
    'vista_defecto',  coalesce(
        p.vista_defecto,
        case
          when public.mi_rol() is not null then 'intern'
          when exists (select 1 from membresias m
                        where m.user_id = p.id and m.activo and m.productor_id is not null)
            then 'productor'
          when exists (select 1 from membresias m
                        where m.user_id = p.id and m.activo and m.entidad_id is not null)
            then 'receptor'
        end),
    'registre_pendent', exists (
        select 1 from membresias m
         where m.user_id = p.id and m.aprovacio = 'pendent'),
    'registre_rebutjat', exists (
        select 1 from membresias m
         where m.user_id = p.id and m.aprovacio = 'rebutjada')
      and not exists (
        select 1 from membresias m
         where m.user_id = p.id and m.activo),
    -- Convenios (20270111100100). `pendent_firma` y `retornat` son los dos estados en los
    -- que la pelota está en el tejado de la organización.
    'conveni_pendent', exists (
        select 1 from convenios c
          join membresias m on (m.productor_id = c.productor_id or m.entidad_id = c.entidad_id)
         where m.user_id = p.id and m.activo
           and c.estado in ('pendent_firma', 'retornat')),
    'organizaciones', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'tipo',          m.tipo,
                 'id',            coalesce(m.productor_id, m.entidad_id),
                 'nombre',        coalesce(pr.empresa, pr.name, en.nombre),
                 'rol_org',       m.rol_org,
                 'tipo_receptor', en.tipo_receptor,
                 'modalitat',     en.modalitat,
                 'poblacion',     coalesce(pr.poblacion, en.poblacion))
               order by m.tipo, m.created_at)
          from membresias m
          left join productores pr on pr.id = m.productor_id
          left join entidades   en on en.id = m.entidad_id
         where m.user_id = p.id and m.activo), '[]'::jsonb))
    from perfiles p
   where p.id = auth.uid();
$$;

-- `create or replace` conserva los privilegios de la función que ya existía, pero se
-- repiten por la misma razón que el `parallel restricted`: que no dependan de la historia.
revoke execute on function public.get_my_session_context() from public, anon;
grant  execute on function public.get_my_session_context() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. disparar_recordatorios_intake(): no despertar a nadie para nada
-- ---------------------------------------------------------------------------
-- Cuerpo de 20260722130000 más la comprobación del interruptor. El `cron.schedule` NO se
-- toca: el job sigue corriendo cada 2 minutos y es esta función la que no hace nada, igual
-- que ya pasaba sin el secreto configurado. Desagendarlo obligaría a acordarse de volver a
-- agendarlo al reactivar WhatsApp, que es justo el tipo de paso que se olvida.
--
-- La Edge Function `intake-recordatorios` comprueba el interruptor por su cuenta: esto es
-- defensa en profundidad, no la única barrera.
create or replace function disparar_recordatorios_intake()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  secreto text;
begin
  select value into secreto from app_config where key = 'recordatorios_secret';
  if secreto is null or secreto = '' then
    raise notice 'disparar_recordatorios_intake: sense secret configurat, no-op';
    return;
  end if;
  if not public.whatsapp_activo() then
    raise notice 'disparar_recordatorios_intake: WhatsApp desactivat, no-op';
    return;
  end if;
  perform net.http_post(
    url := 'https://uxppvaldhptdomvdhsmn.supabase.co/functions/v1/intake-recordatorios',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-recordatorios-secret', secreto
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Verificación (manual, tras aplicar)
-- ---------------------------------------------------------------------------
--   select public.whatsapp_activo();                          -- t (recién aplicada)
--   select public.get_my_session_context() -> 'whatsapp_actiu';
--   select proname, proparallel from pg_proc
--    where proname in ('get_my_session_context', 'whatsapp_activo');   -- las dos, 'r'
--   -- Apagar / encender (lo hace la pantalla de Configuración; esto es la vía de emergencia):
--   -- update app_settings set value = 'false' where key = 'whatsapp_activo';
