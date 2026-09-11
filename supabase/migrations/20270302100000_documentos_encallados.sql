-- Un documento que el runtime mata a mitad de la generación tiene que acabar en rojo.
--
-- ⚠️ Fechada 20270302 para que ordene DESPUÉS de la fase 5 (20270301100200), pero escrita
--    el 11-09-2026. La numeración manda sobre el calendario: el CLI aplica por orden de
--    nombre, y una migración que corrige el circuito documental no puede colarse antes de
--    las que lo construyeron.
--
-- EL AGUJERO. Con `cpu_time_used` medido de verdad (§12.87) se ve que una generación gasta
-- 325-572 ms de los 2 s que da el runtime. Cómodo hoy, pero el día que un documento se
-- pase de ahí, el runtime **mata el isolate a mitad**: no hay excepción que capturar, así
-- que el `catch` de `generar-documento` no llega a llamar a `marcar_documento_error()` y
-- la fila se queda tal cual, en `pendiente_fichero`, con `ultimo_error` NULL e
-- `intentos = 0`. Y eso tenía dos consecuencias, las dos malas:
--
--   1. **No lo ve nadie.** El contador del menú y el filtro de la bandeja miran
--      `estado = 'error'`. Un documento cortado por CPU no llega nunca a ese estado, así
--      que desaparece en silencio: quien lo emitió ve «no s'ha pogut generar» a los 30 s
--      de polling, y el equipo no ve absolutamente nada.
--   2. **No para nunca.** El tope de `intentos < 5` del job protege del fallo que la
--      función SÍ reporta, porque `intentos` lo sube `marcar_documento_error()`. Si la
--      función muere antes de reportar, ese contador se queda en 0 para siempre y el job
--      reencola cada 5 minutos **indefinidamente**: 288 llamadas al día, cada una muriendo
--      igual. El comentario de 20260928100700 daba por cubierto este caso y no lo estaba.
--
-- LA FORMA DE ARREGLARLO. Hacen falta dos contadores porque son dos cosas distintas:
-- `intentos` son las generaciones que **fallaron y lo dijeron**; `reencolados`, las veces
-- que el job **lo intentó**, haya contestado alguien o no. El segundo es el que cuenta los
-- silencios, y es el que acota el bucle.
--
-- Y cuando se agota cualquiera de los dos topes, el job **da el documento por perdido**:
-- lo pasa a `error` con un motivo escrito. Así el caso invisible entra por la misma puerta
-- que ya existe —el contador, el filtro, el tooltip— sin inventar un estado nuevo ni tocar
-- el check de `estado`, que es justo lo que no conviene mover en una tabla inmutable.
--
-- CÓMO SE DISTINGUE UNO DE OTRO desde la interfaz, sin marcador ninguno: un error que la
-- función reportó tiene `intentos >= 1`, porque `marcar_documento_error()` siempre lo sube.
-- Un documento perdido por silencio se queda con `intentos = 0`. O sea que
-- `estado = 'error' and intentos = 0` **es** la firma de «nadie contestó», y se deduce de
-- lo que ya hay en la fila.

-- ---------------------------------------------------------------------------
-- 1. El contador de reencolados
-- ---------------------------------------------------------------------------
alter table documentos
  add column if not exists reencolados int not null default 0;

comment on column documentos.reencolados is
  'Veces que el job de reintento ha encolado este documento, conteste el generador o no. '
  'Distinto de `intentos`, que solo sube cuando la función reporta un fallo: este acota el '
  'bucle cuando la función muere sin decir nada (corte por CPU del runtime).';

-- ---------------------------------------------------------------------------
-- 2. El job, con el silencio acotado y el perdido marcado
-- ---------------------------------------------------------------------------
-- Sustituye a la versión de 20260928100700. Mismo contrato (`void`, mismo nombre, mismo
-- cron ya programado): solo cambia lo que hace por dentro, así que no hay que reprogramar
-- nada en `pg_cron`.
create or replace function public.disparar_generacion_pendiente()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secreto  text;
  d        record;
  n        int := 0;
  perdidos int := 0;
begin
  -- PRIMERO se dan por perdidos los agotados, y después se reencola el resto. En este
  -- orden, un documento que acaba de agotar su tope no se reencola una vez más antes de
  -- que nadie lo mire.
  --
  -- `coalesce` en el motivo: si ya había un error escrito, manda ese. El texto de aquí es
  -- para el caso que no tiene ninguno, que es exactamente el del corte por CPU.
  with agotados as (
    update documentos
       set estado       = 'error',
           ultimo_error = coalesce(
             nullif(ultimo_error, ''),
             'Sense resposta del generador despres de ' || reencolados || ' intents. '
             || 'La funcio va morir sense reportar res: la causa tipica es que el runtime '
             || 'la talles per superar el limit de CPU (2 s). Mira els logs de '
             || 'generar-documento per aquest document.')
     where fichero_at is null
       and estado = 'pendiente_fichero'
       and (intentos >= 5 or reencolados >= 5)
    returning 1)
  select count(*) into perdidos from agotados;

  if perdidos > 0 then
    raise notice 'disparar_generacion_pendiente: % document(s) donat(s) per perdut(s)', perdidos;
  end if;

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
       and intentos    < 5
       and reencolados < 5
     order by emitido_at
     limit 50
  loop
    -- El contador sube ANTES de la llamada, no después: si la función muere, nadie va a
    -- volver aquí a subirlo, y ese es justo el caso que hay que acotar.
    update documentos set reencolados = reencolados + 1 where id = d.id;

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

revoke execute on function public.disparar_generacion_pendiente() from public, anon, authenticated;
grant  execute on function public.disparar_generacion_pendiente() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Lectura de la columna nueva
-- ---------------------------------------------------------------------------
-- `documentos` ya tiene `grant select` de tabla entera para `authenticated` (§4) y
-- `alter default privileges` no alcanza a las columnas añadidas después, así que el GRANT
-- existente ya la cubre. Se deja la comprobación escrita porque es la clase de cosa que
-- se da por hecha y luego responde `permission denied` en producción:
--
--   select has_column_privilege('authenticated', 'public.documentos', 'reencolados', 'SELECT');
--
-- Ninguna escritura: como el resto de la tabla, solo entra por RPC y `service_role`.
