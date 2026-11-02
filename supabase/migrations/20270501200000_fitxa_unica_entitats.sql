-- Plan 1 · rebanada 1C (02-11-2026): ficha única «Entitat» y listado «Entitats».
--
-- POR QUÉ. Una organización pasa a tener UNA ficha en el panel del equipo (D1), con el rol o
-- el doble rol visible, y lo que ve el actor de su propia ficha y lo que ve el equipo sale de
-- una única definición de campos (`src/lib/campsFitxa.ts`, D8). Esta migración SOLO AÑADE
-- (§7, compatible hacia atrás: el frontend vigente sigue sirviéndose igual):
--
--   1. `actualitzar_fitxa_entitat()`: la lista blanca del actor se amplía (P5) con los campos
--      que hasta hoy solo tenía el equipo y que son suyos: el contacto secundario
--      (`contacto2`, `telefono3`, `email2`), `telefono2` y la logística del receptor
--      (`productes_frescos*`, `transport_plataforma*`, `descarrega_toro*`). Misma firma,
--      mismas validaciones, mismos GRANT (`create or replace` los conserva).
--   2. `v_entitats_llistat`: una fila por organización para el listado «Entitats», que
--      sustituye a `v_productores_llistat` y `v_entidades_llistat` (se conservan: §7).

-- ---------------------------------------------------------------------------
-- 1. `actualitzar_fitxa_entitat()` con la lista blanca de P5
-- ---------------------------------------------------------------------------
-- ⚠️ `tests/campsFitxa.test.ts` lee las claves `d ? '…'` de la ÚLTIMA definición de esta
--    función y las compara con lo que `campsFitxa.ts` declara editable por el actor: si se
--    añade una columna aquí sin declararla allí (o al revés), la prueba falla.
create or replace function public.actualitzar_fitxa_entitat(p_id uuid, p_dades jsonb)
returns entidades
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e entidades;
  d jsonb := coalesce(p_dades, '{}'::jsonb);
  txt text;
begin
  if not public.soc_titular('entidad', p_id) then
    raise exception 'Nomes el titular pot editar les dades' using errcode = '42501';
  end if;
  select * into e from entidades where id = p_id for update;

  txt := nullif(trim(d->>'tipo_entidad'), '');
  if not tipus_empresa_valid(txt, e.tipo_entidad) then
    raise exception 'tipus d''entitat desconegut: %', txt using errcode = '22023';
  end if;
  if d ? 'municipio_ine' and nullif(d->>'municipio_ine', '') is not null
     and not exists (select 1 from municipios where codi_ine = d->>'municipio_ine') then
    raise exception 'municipi desconegut' using errcode = '22023';
  end if;
  if d ? 'perfil_receptor' and jsonb_typeof(d->'perfil_receptor') <> 'object' then
    raise exception 'perfil_receptor ha de ser un objecte' using errcode = '22023';
  end if;
  if d ? 'tipus_activitat' and not public.tipus_activitat_valid(d->'tipus_activitat', 'entidad') then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;
  if d ? 'modalitats_interes' and (jsonb_typeof(d->'modalitats_interes') <> 'array' or exists (
       select 1 from jsonb_array_elements_text(d->'modalitats_interes') m where m not in ('donacio', 'venda', 'maquila'))) then
    raise exception 'modalitat_desconeguda' using errcode = '22023';
  end if;
  -- Los tres booleanos de logística admiten «sense definir» (null): un valor que no sea
  -- true/false/null es un error de llamada, no un dato.
  if (d ? 'productes_frescos' and jsonb_typeof(d->'productes_frescos') not in ('boolean', 'null'))
     or (d ? 'transport_plataforma' and jsonb_typeof(d->'transport_plataforma') not in ('boolean', 'null'))
     or (d ? 'descarrega_toro' and jsonb_typeof(d->'descarrega_toro') not in ('boolean', 'null')) then
    raise exception 'logistica_invalida: cal true, false o null' using errcode = '22023';
  end if;

  -- ⚠️ `tipo_receptor`, `estat`, `prioritat`, `es_test`, `activo`… NO están en la lista:
  --    deciden qué ofertas ve y cómo puntúa, y eso lo decide el equipo (`campsFitxa.ts`:
  --    `edita: 'equip'`). Las claves que no están aquí se ignoran en silencio.
  update entidades set
    nombre        = case when d ? 'nombre' then coalesce(nullif(trim(d->>'nombre'), ''), nombre) else nombre end,
    razon_social  = case when d ? 'razon_social' then nullif(trim(d->>'razon_social'), '') else razon_social end,
    tipo_entidad  = case when d ? 'tipo_entidad' then txt else tipo_entidad end,
    contacto      = case when d ? 'contacto' then nullif(trim(d->>'contacto'), '') else contacto end,
    telefono      = case when d ? 'telefono' then nullif(trim(d->>'telefono'), '') else telefono end,
    email         = case when d ? 'email' then nullif(trim(d->>'email'), '') else email end,
    nif           = case when d ? 'nif' then nullif(upper(trim(d->>'nif')), '') else nif end,
    direccion     = case when d ? 'direccion' then nullif(trim(d->>'direccion'), '') else direccion end,
    codigo_postal = case when d ? 'codigo_postal' then nullif(trim(d->>'codigo_postal'), '') else codigo_postal end,
    municipio_ine = case when d ? 'municipio_ine' then nullif(d->>'municipio_ine', '') else municipio_ine end,
    horario       = case when d ? 'horario' then nullif(trim(d->>'horario'), '') else horario end,
    calendari_repartiment = case when d ? 'calendari_repartiment' then nullif(trim(d->>'calendari_repartiment'), '') else calendari_repartiment end,
    perfil_receptor = case when d ? 'perfil_receptor' then d->'perfil_receptor' else perfil_receptor end,
    tipus_activitat = case when d ? 'tipus_activitat'
      then coalesce(array(select jsonb_array_elements_text(d->'tipus_activitat')), '{}') else tipus_activitat end,
    modalitats_interes = case when d ? 'modalitats_interes'
      then coalesce(array(select distinct jsonb_array_elements_text(d->'modalitats_interes')), '{}') else modalitats_interes end,
    -- 1C (P5): el contacto secundario y la logística son de la organización.
    telefono2     = case when d ? 'telefono2' then nullif(trim(d->>'telefono2'), '') else telefono2 end,
    telefono3     = case when d ? 'telefono3' then nullif(trim(d->>'telefono3'), '') else telefono3 end,
    email2        = case when d ? 'email2' then nullif(trim(d->>'email2'), '') else email2 end,
    contacto2     = case when d ? 'contacto2' then nullif(trim(d->>'contacto2'), '') else contacto2 end,
    productes_frescos        = case when d ? 'productes_frescos' then (d->>'productes_frescos')::boolean else productes_frescos end,
    productes_frescos_txt    = case when d ? 'productes_frescos_txt' then nullif(trim(d->>'productes_frescos_txt'), '') else productes_frescos_txt end,
    transport_plataforma     = case when d ? 'transport_plataforma' then (d->>'transport_plataforma')::boolean else transport_plataforma end,
    transport_plataforma_txt = case when d ? 'transport_plataforma_txt' then nullif(trim(d->>'transport_plataforma_txt'), '') else transport_plataforma_txt end,
    descarrega_toro          = case when d ? 'descarrega_toro' then (d->>'descarrega_toro')::boolean else descarrega_toro end,
    descarrega_toro_txt      = case when d ? 'descarrega_toro_txt' then nullif(trim(d->>'descarrega_toro_txt'), '') else descarrega_toro_txt end
  where id = p_id
  returning * into e;
  return e;
end;
$$;

comment on function public.actualitzar_fitxa_entitat(uuid, jsonb) is
  'La entidad edita su ficha (solo el titular). Lista blanca de columnas: las que `campsFitxa.ts` declara `edita: tots` (1C, P5: 20270501200000).';

-- ---------------------------------------------------------------------------
-- 2. `v_entitats_llistat`: una fila por organización
-- ---------------------------------------------------------------------------
-- Lo que el listado «Entitats» necesita y `v_organizaciones` no trae: la marca de prueba, el
-- alta rechazada (§12.29: se MARCA, no se esconde), las modalidades que interesan, si hay
-- convenio vigente por papel y la última actividad (oferta, interés o canalización).
--
-- `security_invoker` (§12.29): cada cuenta ve lo que sus políticas le dejan —el equipo todas
-- las organizaciones; un actor, la suya—. Las subconsultas leen `membresias`, `convenios`,
-- `excedentes`, `oferta_respuestas` y `canalizaciones` con la RLS de quien consulta, así que
-- para un actor «sin convenio» puede ser «no me dejan verlo»; el listado es del equipo.
create or replace view public.v_entitats_llistat
with (security_invoker = true) as
  select v.id,
         v.nom_comercial,
         v.razon_social,
         v.nif,
         v.persona_contacte,
         v.email,
         v.telefono,
         v.poblacion,
         v.comarca,
         v.municipio_ine,
         v.productor_id,
         v.entidad_id,
         v.es_generadora,
         v.es_receptora,
         v.productor_activo,
         v.entidad_activo,
         v.activa,
         v.tipo_receptor,
         v.tipus_activitat,
         v.te_compte,
         v.compte_estat,
         v.canal_preferido,
         v.created_at,
         (coalesce(p.es_test, false) or coalesce(e.es_test, false)) as es_test,
         exists (select 1 from public.membresias m
                  where m.aprovacio = 'rebutjada'
                    and ((p.id is not null and m.productor_id = p.id) or (e.id is not null and m.entidad_id = e.id))) as rebutjada,
         coalesce(e.modalitats_interes, '{}'::text[]) as modalitats_interes,
         e.prioritat,
         (p.id is not null and exists (select 1 from public.convenios c
                                        where c.estado = 'vigent' and c.productor_id = p.id)) as conveni_productor,
         (e.id is not null and exists (select 1 from public.convenios c
                                        where c.estado = 'vigent' and c.entidad_id = e.id)) as conveni_entitat,
         greatest(
           (select max(x.created_at) from public.excedentes x where p.id is not null and x.productor_id = p.id),
           (select max(r.created_at) from public.oferta_respuestas r where e.id is not null and r.entidad_id = e.id),
           (select max(c.created_at) from public.canalizaciones c where e.id is not null and c.entidad_id = e.id)
         ) as darrera_activitat
    from public.v_organizaciones v
    left join public.productores p on p.id = v.productor_id
    left join public.entidades   e on e.id = v.entidad_id
   -- Una organización sin ninguna ficha (un resto de un borrado parcial) no es una entidad.
   where v.productor_id is not null or v.entidad_id is not null;

comment on view public.v_entitats_llistat is
  'El listado «Entitats» del equipo (1C, 20270501200000): una fila por organización, con rol, estado, cuenta, convenio por papel y última actividad. `security_invoker`.';

-- Dos capas (§4): `anon` nada; `authenticated` solo SELECT (lo que ya nace por defecto, aquí
-- explícito), y lo que ve cada cuenta lo deciden las políticas de las tablas de debajo.
revoke all on public.v_entitats_llistat from anon;
grant select on public.v_entitats_llistat to authenticated, service_role;
