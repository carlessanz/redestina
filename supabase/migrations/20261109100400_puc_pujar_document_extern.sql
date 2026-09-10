-- Quién puede subir un documento externo, preguntado de una sola manera.
--
-- EL HUECO QUE CIERRA. `subir-documento-externo` resuelve el permiso llamando a
-- `albarans_de_les_meves_orgs()` y, para cualquier otro `objeto_tipo`, responde `403` con
-- este comentario dentro: «`cierres_donante` llega en la fase 4 con su propio puente;
-- hasta entonces, solo el equipo». Esta es la fase 4, y este es ese puente. Sin él, un
-- donante no puede subir su propia factura contra el resumen anual, que es justamente el
-- documento externo para el que se dejó `documentos_externos` polimórfica desde el primer
-- día (20261012100400).
--
-- POR QUÉ UNA FUNCIÓN QUE RESPONDE SÍ/NO Y NO OTRO `setof uuid`. Con dos tipos de objeto,
-- que la Edge Function elija a qué puente preguntar según el `objeto_tipo` es meter la
-- regla en TypeScript, y cada tipo nuevo (`convenio` en la fase 2, `plan` en la fase 5)
-- obligaría a tocarla. Con una pregunta única —«¿puede esta persona subir a este
-- objeto?»— la Edge Function llama siempre igual y la regla se amplía **aquí**. Además,
-- traerse la lista entera de albaranes de una organización para mirar si un uuid está en
-- ella es traer N filas para responder un booleano.
--
-- ⚠️ RESPONDE POR UN USUARIO, NO POR LA SESIÓN. La llama `service_role` desde la Edge
--    Function, donde `auth.uid()` es null: por eso `p_user`. La guarda es la misma de
--    `albarans_de_les_meves_orgs()` y `cierres_donante_meus()` —con sesión abierta no se
--    puede preguntar por otra persona (42501)—, así que desde el navegador solo se puede
--    preguntar por uno mismo.
--
-- LA REGLA ES LA MISMA QUE LA DE LEER. Un donante puede subir la factura de un
-- `cierre_donante` exactamente cuando lo ve, y verlo incluye el matiz de
-- `cierres_donante_meus()`: los cierres de **prueba** solo si su ficha es `es_test`. Si no
-- fuera la misma regla, alguien podría subir un fichero a una carpeta cuyo contenido
-- después no puede ni listar.

-- ---------------------------------------------------------------------------
-- 1. puc_pujar_document_extern()
-- ---------------------------------------------------------------------------
create or replace function public.puc_pujar_document_extern(
  p_objeto_tipo text,
  p_objeto_id   uuid,
  p_user        uuid default null
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els permisos d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null or p_objeto_id is null then
    return false;
  end if;

  -- El equipo sube a cualquier objeto. Se mira por `usuario_roles` y no por `es_intern()`
  -- porque esta función contesta **por un usuario dado**, y `es_intern()` contesta por la
  -- sesión —que aquí es la de `service_role`, sin `auth.uid()`—. Sin el fail-open de
  -- `roles_activos()`: aquí no hay nada que dejar en marcha, y un `true` de más sería
  -- permitir subir a la carpeta de otro.
  if exists (select 1 from usuario_roles ur
               join perfiles pe on pe.id = ur.user_id
              where ur.user_id = v_user and pe.activo) then
    return true;
  end if;

  if p_objeto_tipo = 'albaran' then
    return p_objeto_id in (select public.albarans_de_les_meves_orgs(v_user));
  elsif p_objeto_tipo = 'cierre_donante' then
    return p_objeto_id in (select public.cierres_donante_meus(v_user));
  end if;
  -- Fase 2: 'convenio'. Fase 5: 'plan'. Lo desconocido se niega.
  return false;
end;
$$;

comment on function public.puc_pujar_document_extern(text, uuid, uuid) is
  'True si esa persona puede subir un documento externo a ese objeto. Equipo siempre; externo, si el objeto es suyo.';

revoke execute on function public.puc_pujar_document_extern(text, uuid, uuid) from public, anon;
grant  execute on function public.puc_pujar_document_extern(text, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. El donante ve los externos de SU cierre
-- ---------------------------------------------------------------------------
-- 20261012100500 dejó la política con la rama de los albaranes y sin la de los cierres,
-- porque `cierres_donante_meus()` todavía no existía. Poder subir una factura y no poder
-- verla después sería una asimetría difícil de explicar: es su documento.
drop policy if exists "externs: intern" on documentos_externos;
drop policy if exists "externs: intern o meus" on documentos_externos;
create policy "externs: intern o meus"
  on documentos_externos for select to authenticated
  using (
       (select public.es_intern())
    or (objeto_tipo = 'albaran'        and objeto_id in (select public.albarans_de_les_meves_orgs()))
    or (objeto_tipo = 'cierre_donante' and objeto_id in (select public.cierres_donante_meus()))
  );

-- Verificación:
--   select puc_pujar_document_extern('cierre_donante', '<cd de TEST-PROD-1>', '<user de TEST-PROD-1>');  -- t
--   select puc_pujar_document_extern('cierre_donante', '<cd d''un altre>',    '<user de TEST-PROD-1>');  -- f
--   select ruta_documento('cierre_donante', '<cd>', 'externs', gen_random_uuid()::text, 1, 'real', 2026);
--     -- productors/<uuid>/2026/externs/<uuid>-v1.pdf  (la Edge Function canvia nomes la fulla)
