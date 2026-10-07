-- El recordatorio del intake pasa a construir su URL con url_funciones() (07-10-2026).
--
-- Era la única llamada de la base a una Edge Function con la URL de producción escrita
-- a pelo (20270317100000:164). Las demás pasan por url_funciones()
-- (20260928100700), que lee app_config.functions_base_url y, si no está, usa la misma
-- URL de producción.
--
-- En producción no cambia nada: la clave no existe y la URL resultante es la misma.
-- Lo que cambia es el clon local (AGENTS.md §11): allí functions_base_url apunta a las
-- funciones locales, y sin esto el job `recordatorios-intake` de la base local seguiría
-- llamando cada 2 minutos a la función de PRODUCCIÓN.
--
-- `create or replace` conserva los GRANT y el job de pg_cron, que llama a la función
-- por su nombre.

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
    url := public.url_funciones() || '/intake-recordatorios',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-recordatorios-secret', secreto
    ),
    body := '{}'::jsonb
  );
end;
$$;
