-- Descartar un convenio en BORRADOR (05-10-2026, reunión de seguimiento con la Fundació).
--
-- POR QUÉ. La ficha de prueba Mas de Prova SCP tiene un convenio `com` (compraventa y
-- maquila) en `esborrany` que no debe existir: la Fundació va a un único «Conveni de
-- col·laboració» por tipo de entidad. Y no había ninguna puerta para quitarlo:
-- `convenios` no tiene `grant delete` para `authenticated` (20270111100000 §6) y ninguna
-- RPC borraba. El trigger `convenios_no_esborrar` ya decía que un borrador «sí se puede
-- borrar, porque todavía no es nada»; faltaba quien lo hiciera.
--
-- QUÉ HACE. Solo `pot_aprovar()` (admin o super_admin), igual que devolver o resolver.
-- Solo `estado = 'esborrany'`: sin número (constraint `convenios_numero_segons_estat`),
-- así que borrarlo no deja hueco en ninguna serie legal. Un `pendent_firma` NO se
-- descarta aunque tampoco tenga número: ya ha salido un enlace hacia alguien, y eso se
-- resuelve revocándolo o dejándolo caducar, no haciendo desaparecer el convenio.
-- Se niega también si hay documentos externos colgados del convenio (un papel subido):
-- eso es evidencia y no se borra en cascada.
--
-- Deja rastro en el log de Postgres (`raise log`) con quién, qué y de qué organización.
-- No hay tabla de auditoría de convenios y un borrador descartado no la justifica.

create or replace function public.descartar_convenio_esborrany(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c convenios%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden descartar un conveni' using errcode = '42501';
  end if;

  select * into c from convenios where id = p_id for update;
  if c.id is null or c.estado <> 'esborrany' then
    raise exception 'Nomes es pot descartar un conveni en esborrany (estat %)',
      coalesce(c.estado, 'inexistent') using errcode = '22023';
  end if;

  if exists (select 1 from documentos_externos d
              where d.objeto_tipo = 'convenio' and d.objeto_id = c.id) then
    raise exception 'Aquest conveni te documents adjunts: no es pot descartar'
      using errcode = '22023';
  end if;

  -- Un borrador no debería tener enlaces (enviar lo pasa a `pendent_firma`), pero si
  -- quedara alguno, sin convenio sería un enlace huérfano que lleva a un 404.
  delete from enlaces_token where objeto_tipo = 'convenio' and objeto_id = c.id;

  delete from convenios where id = c.id;

  raise log 'descartar_convenio_esborrany: % (% %, org %) per %',
    c.id, c.tipo, c.tipo_org, coalesce(c.productor_id, c.entidad_id), auth.uid();
end;
$$;

comment on function public.descartar_convenio_esborrany(uuid) is
  'Borra un convenio en esborrany (sin número). Solo pot_aprovar(). 22023 si no es borrador o tiene documentos externos.';

revoke execute on function public.descartar_convenio_esborrany(uuid) from public, anon;
grant  execute on function public.descartar_convenio_esborrany(uuid) to authenticated, service_role;
