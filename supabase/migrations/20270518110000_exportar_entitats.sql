-- Plan 2 · B3 (10-11-2026): exportación de entidades a Excel con el formato de la plantilla.
--
-- Sebas (Teams, 09-11) pidió poder sacar las entidades a Excel para completar datos fuera y
-- volver a subirlas con el importador. La hoja la compone el navegador (`lib/exportEntitats.ts`,
-- mismas columnas y orden que la plantilla de B2, con sus desplegables); la base solo entrega
-- los datos, una fila por ORGANIZACIÓN, en CÓDIGOS (el navegador los pone en palabras).
--
-- Por qué una RPC y no ampliar `v_entitats_llistat` (T6 del plan): la vista solo admite
-- columnas al final, y el listado no necesita para pintar la forma jurídica, el segundo correo,
-- el teléfono fijo, la dirección, el CP, el nombre del municipio ni el ID de Airtable.
--
-- Quién: TODO el equipo (`es_intern()`, también `tecnic`, D10). Importar sigue siendo solo del
-- super_admin. Un externo: 42501 (el permiso se comprueba antes de leer nada).
--
-- Los valores están elegidos para que REIMPORTAR lo exportado no cambie nada
-- (`importacio_aplica_fila` da `sense_canvis` cuando no hay hueco que rellenar ni nota nueva):
--   · `persona_contacte`: el `name` del productor NO cuenta si es igual que `empresa` (es el
--     valor por defecto del alta, y la comparación del importador lo trata como hueco: si se
--     exportara, la reimportación lo «rellenaría»).
--   · `municipi`: el nombre como se escribe (`nom_municipi_llegible`, que `municipi_de_text`
--     reconoce); sin municipio INE, la ubicación libre (que la reimportación vuelve a dejar en
--     `ubicacio`).
--   · Los campos que existen en las dos fichas salen del ofertant primero y, si no, de la
--     receptora; una diferencia entre las dos fichas es un conflicto en la reimportación, que
--     no cambia nada.
--   · Las columnas de nota (Càrrec, Web, Observacions…) no salen: reimportarlas duplicaría el
--     comentario (`importacio_bloc_nota`).
--   · `data_alta` va en TEXTO: `productores.data_alta` es date, pero `entidades.data_alta` es texto
--     heredado del Excel («2021», «2026-07-30»). Sale la más antigua de las dos, comparando el
--     texto (un año solo, «2021», queda antes que cualquier fecha de ese año o posterior).
-- `estat_crm_*` es informativo (P9): el importador no lo lee.

create or replace function public.exportar_entitats(p_ids uuid[] default null)
returns table (
  organizacion_id     uuid,
  es_test             boolean,
  rols                text[],
  nom_comercial       text,
  razon_social        text,
  nif                 text,
  tipus_empresa       text,
  tipo_receptor       text,
  tipus_activitat     text[],
  modalitats_interes  text[],
  persona_contacte    text,
  email               text,
  email2              text,
  telefon             text,
  telefon2            text,
  direccion           text,
  codigo_postal       text,
  municipi            text,
  area_geografica     text,
  airtable_id         text,
  data_alta           text,
  estat_crm_productor text,
  estat_crm_entidad   text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'nomes_equip' using errcode = '42501';
  end if;

  return query
  select o.id,
         coalesce(p.es_test, false) or coalesce(e.es_test, false),
         array_remove(array[case when p.id is not null then 'productor' end,
                            case when e.id is not null then 'entidad' end], null),
         coalesce(nullif(btrim(p.empresa), ''), nullif(btrim(e.nombre), ''), nullif(btrim(p.name), '')),
         coalesce(nullif(btrim(p.razon_social), ''), nullif(btrim(e.razon_social), '')),
         coalesce(nullif(btrim(p.nif), ''), nullif(btrim(e.nif), '')),
         coalesce(nullif(btrim(p.tipo_empresa), ''), nullif(btrim(e.tipo_entidad), '')),
         nullif(btrim(e.tipo_receptor), ''),
         array(select ta.codi from tipus_activitat ta
                where ta.codi = any(coalesce(p.tipus_activitat, '{}') || coalesce(e.tipus_activitat, '{}'))
                order by ta.ordre, ta.codi),
         coalesce(e.modalitats_interes, '{}'),
         coalesce(case when lower(btrim(p.name)) <> lower(btrim(coalesce(p.empresa, '')))
                       then nullif(btrim(p.name), '') end,
                  nullif(btrim(e.contacto), '')),
         coalesce(nullif(btrim(p.email), ''), nullif(btrim(e.email), '')),
         nullif(btrim(e.email2), ''),
         coalesce(nullif(btrim(p.phone), ''), nullif(btrim(e.telefono), '')),
         coalesce(nullif(btrim(e.telefono2), ''), nullif(btrim(p.telefono_alt), '')),
         coalesce(nullif(btrim(p.direccion), ''), nullif(btrim(e.direccion), '')),
         coalesce(nullif(btrim(p.codigo_postal), ''), nullif(btrim(e.codigo_postal), '')),
         coalesce((select public.nom_municipi_llegible(m.nom) from municipios m
                    where m.codi_ine = coalesce(p.municipio_ine, e.municipio_ine)),
                  nullif(btrim(p.ubicacio), ''), nullif(btrim(e.ubicacio), ''),
                  nullif(btrim(p.poblacion), ''), nullif(btrim(e.poblacion), '')),
         coalesce(nullif(btrim(p.area_geografica), ''), nullif(btrim(e.area_geografica), '')),
         coalesce(case when p.ref_externa like 'AIRTABLE:%' then nullif(substr(p.ref_externa, 10), '') end,
                  case when e.ref_externa like 'AIRTABLE:%' then nullif(substr(e.ref_externa, 10), '') end),
         least(p.data_alta::text, nullif(btrim(e.data_alta), '')),
         p.estat_crm,
         e.estat_crm
    from organizaciones o
    left join productores p on p.organizacion_id = o.id
    left join entidades e on e.organizacion_id = o.id
   where (p.id is not null or e.id is not null)
     and (p_ids is null or o.id = any(p_ids))
   order by lower(coalesce(nullif(btrim(p.empresa), ''), nullif(btrim(e.nombre), ''), nullif(btrim(p.name), ''), '')), o.id;
end;
$$;

comment on function public.exportar_entitats(uuid[]) is
  'Plan 2 B3: una fila por organización (códigos) para la exportación a Excel con el formato de la plantilla. Equipo (es_intern, también tecnic); externos 42501. Valores elegidos para que reimportar dé sense_canvis.';

revoke execute on function public.exportar_entitats(uuid[]) from public, anon;
grant execute on function public.exportar_entitats(uuid[]) to authenticated, service_role;
