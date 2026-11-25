-- «Interaccions i seguiment» (proceso 1.2 del cliente), parte de LECTURA: la sección global del
-- equipo con tres vistas sobre las MISMAS filas de `notes_internes` que registra la ficha.
--
-- Solo lectura; sin tablas ni columnas nuevas (las puso 20270616100000). Patrón de «Entrades i
-- sortides» (20270612100000):
--
--   1. `interaccions_base(<filtros>)`, INTERNA (sin EXECUTE para ninguna sesión): ÚNICA definición
--      de la fila y de los filtros, con su validación (22023). `security invoker`: solo la llama
--      (2), que es `security definer`.
--   2. `interaccions_llistat(p_vista, <filtros>, p_limit, p_offset)` → `{total, files}`: la página
--      de una de las tres vistas y el total de TODO lo filtrado.
--        · `pendents`: próximo paso sin hacer (`propera_accio` y sin `seguiment_fet_at`), por
--          `propera_data` ascendente (lo vencido primero).
--        · `historial`: todas las interacciones, por `data` descendente.
--        · `previsions`: las que llevan previsión de producto, por `previsio_data` ascendente.
--   3. `interaccions_opcions()`: los valores con los que poblar los desplegables de filtro
--      (responsables, productos, comarcas y municipios que aparecen en las interacciones).
--
-- Las dos públicas son del equipo (`es_intern()`), `security definer` y `stable`, con la guarda
-- ANTES que cualquier validación (§4bis). `auditoria_funcions_obertes()` sigue en 0 filas.
--
-- 🔴 Las notas internas y sus previsiones NUNCA salen por ningún canal: estas funciones solo las
--    devuelven a una sesión del equipo; ninguna Edge Function ni plantilla las llama.
--
-- Decisiones:
--   · Nombre de la organización: el comercial, con el criterio de `v_organizaciones.nom_comercial`
--     (`empresa` del productor → `nombre` de la entidad → `name` del productor). Se cruza directo
--     con `productores`/`entidades` (una ficha de cada tipo por organización) en vez de con la
--     vista, que calcula cuentas y membresías que aquí no hacen falta.
--   · Zona = comarca de la organización (`area_geografica` del productor y, si no, de la entidad),
--     la misma que «Entrades i sortides» usa como respaldo. `p_zona` acepta además un código INE de
--     municipio (filtro «municipi o zona»): una comarca nunca es un código de cinco cifras.
--   · Responsable y autor: nombre de `perfiles` (mismo id que `auth.users`; la FK de
--     `responsable` va a `auth.users` a propósito, 20270504100000), y si no hay nombre, el correo.
--   · Fechas: `p_desde`/`p_hasta` filtran el DÍA de la interacción en Europa/Madrid;
--     `p_prev_desde`/`p_prev_hasta`, `previsio_data`. «Vençut» = pendiente con `propera_data`
--     anterior a hoy en Madrid.
--   · `p_estat`: `pendent` (todo próximo paso sin hacer, vencido o no) · `vencut` (los pendientes
--     vencidos) · `fet` · `sense` (sin próximo paso). Cada fila trae su `estat_seguiment`, que es
--     uno de `sense` · `pendent` · `vencut` · `fet`.

-- ---------------------------------------------------------------------------
-- 1. `interaccions_base()`: interna, única definición de la fila y de los filtros
-- ---------------------------------------------------------------------------
create or replace function public.interaccions_base(
  p_desde       date default null,
  p_hasta       date default null,
  p_org         uuid default null,
  p_zona        text default null,
  p_tipus       text default null,
  p_responsable uuid default null,
  p_producte    text default null,
  p_prev_desde  date default null,
  p_prev_hasta  date default null,
  p_estat       text default null,
  p_cerca       text default null
)
returns table(
  id                    uuid,
  organizacion_id       uuid,
  organitzacio          text,
  municipi              text,
  municipi_ine          text,
  comarca               text,
  data                  timestamptz,
  tipus                 text,
  canal                 text,
  text                  text,
  autor_id              uuid,
  autor_nom             text,
  responsable_id        uuid,
  responsable_nom       text,
  propera_accio         text,
  propera_data          date,
  estat_seguiment       text,
  seguiment_fet_at      timestamptz,
  fet_per_nom           text,
  resultat              text,
  previsio_producte     text,
  previsio_kg           numeric,
  previsio_data         date,
  previsio_ubicacio_id  uuid,
  previsio_ubicacio_nom text,
  created_at            timestamptz
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_cerca text := nullif(btrim(coalesce(p_cerca, '')), '');
  v_avui  date := (now() at time zone 'Europe/Madrid')::date;
begin
  if (p_desde is not null and p_hasta is not null and p_desde > p_hasta)
     or (p_prev_desde is not null and p_prev_hasta is not null and p_prev_desde > p_prev_hasta) then
    raise exception 'rang_invertit: la data inicial es posterior a la final' using errcode = '22023';
  end if;
  if p_tipus is not null
     and p_tipus not in ('prospeccio', 'captacio', 'operativa', 'incidencia', 'documentacio', 'altres', 'seguiment') then
    raise exception 'tipus_invalid: %', p_tipus using errcode = '22023';
  end if;
  if p_estat is not null and p_estat not in ('pendent', 'vencut', 'fet', 'sense') then
    raise exception 'estat_invalid: %', p_estat using errcode = '22023';
  end if;
  if v_cerca is not null then
    v_cerca := public.unaccent(lower(v_cerca));
  end if;

  return query
  with f as (
    select n.id                                                                    as f_id,
           n.organizacion_id                                                       as f_org,
           coalesce(nullif(btrim(p.empresa), ''), nullif(btrim(e.nombre), ''), nullif(btrim(p.name), '')) as f_org_nom,
           coalesce(m.nom, nullif(p.poblacion, ''), nullif(e.poblacion, ''))       as f_municipi,
           coalesce(p.municipio_ine, e.municipio_ine)                              as f_ine,
           coalesce(nullif(p.area_geografica, ''), nullif(e.area_geografica, ''))  as f_comarca,
           n.data                                                                  as f_data,
           (n.data at time zone 'Europe/Madrid')::date                             as f_dia,
           n.tipus                                                                 as f_tipus,
           n.canal                                                                 as f_canal,
           n.text                                                                  as f_text,
           n.autor                                                                 as f_autor,
           coalesce(nullif(btrim(pa.nombre), ''), pa.email)                        as f_autor_nom,
           n.responsable                                                           as f_resp,
           coalesce(nullif(btrim(pr.nombre), ''), pr.email)                        as f_resp_nom,
           n.propera_accio                                                         as f_accio,
           n.propera_data                                                          as f_propera,
           case
             when n.propera_accio is null then 'sense'
             when n.seguiment_fet_at is not null then 'fet'
             when n.propera_data < v_avui then 'vencut'
             else 'pendent'
           end                                                                     as f_estat,
           n.seguiment_fet_at                                                      as f_fet_at,
           coalesce(nullif(btrim(pf.nombre), ''), pf.email)                        as f_fet_nom,
           n.resultat                                                              as f_resultat,
           n.previsio_producte                                                     as f_producte,
           n.previsio_kg                                                           as f_kg,
           n.previsio_data                                                         as f_prev,
           n.previsio_ubicacio_id                                                  as f_lloc_id,
           coalesce(nullif(btrim(u.alias), ''), nullif(btrim(u.municipio), ''), n.previsio_ubicacio) as f_lloc,
           n.created_at                                                            as f_created
      from notes_internes n
      left join productores p  on p.organizacion_id = n.organizacion_id
      left join entidades   e  on e.organizacion_id = n.organizacion_id
      left join municipios  m  on m.codi_ine = coalesce(p.municipio_ine, e.municipio_ine)
      left join perfiles    pa on pa.id = n.autor
      left join perfiles    pr on pr.id = n.responsable
      left join perfiles    pf on pf.id = n.seguiment_fet_per
      left join productor_ubicaciones u on u.id = n.previsio_ubicacio_id
  )
  select f.f_id, f.f_org, f.f_org_nom, f.f_municipi, f.f_ine, f.f_comarca,
         f.f_data, f.f_tipus, f.f_canal, f.f_text, f.f_autor, f.f_autor_nom, f.f_resp, f.f_resp_nom,
         f.f_accio, f.f_propera, f.f_estat, f.f_fet_at, f.f_fet_nom, f.f_resultat,
         f.f_producte, f.f_kg, f.f_prev, f.f_lloc_id, f.f_lloc, f.f_created
    from f
   where (p_desde is null or f.f_dia >= p_desde)
     and (p_hasta is null or f.f_dia <= p_hasta)
     and (p_org is null or f.f_org = p_org)
     and (p_zona is null or f.f_comarca = p_zona or f.f_ine = p_zona)
     and (p_tipus is null or f.f_tipus = p_tipus)
     and (p_responsable is null or f.f_resp = p_responsable)
     and (p_producte is null or f.f_producte = p_producte)
     and (p_prev_desde is null or f.f_prev >= p_prev_desde)
     and (p_prev_hasta is null or f.f_prev <= p_prev_hasta)
     and (p_estat is null
          or (p_estat = 'pendent' and f.f_estat in ('pendent', 'vencut'))
          or f.f_estat = p_estat)
     and (v_cerca is null
          or strpos(public.unaccent(lower(concat_ws(' ',
                f.f_text, f.f_accio, f.f_resultat, f.f_org_nom, f.f_producte, f.f_lloc))), v_cerca) > 0);
end;
$$;
revoke execute on function public.interaccions_base(date, date, uuid, text, text, uuid, text, date, date, text, text)
  from public, anon, authenticated;

comment on function public.interaccions_base(date, date, uuid, text, text, uuid, text, date, date, text, text) is
  'Interna (20270616100100): una fila por interacción (`notes_internes`) con sus filtros. Única definición de «Interaccions i seguiment»; la llama interaccions_llistat.';

-- ---------------------------------------------------------------------------
-- 2. `interaccions_llistat()`: la página de una vista y el total de lo filtrado
-- ---------------------------------------------------------------------------
-- { "total": n, "files": [ <fila de interaccions_base> … ] }
-- `p_vista`: pendents · historial · previsions (otro → 22023 `vista_invalida`). `p_limit` 1-1000
-- (22023 `limit_invalid`), `p_offset` >= 0 (22023 `offset_invalid`). El resto, en la base
-- (`rang_invertit`, `tipus_invalid`, `estat_invalid`).
create or replace function public.interaccions_llistat(
  p_vista       text,
  p_desde       date    default null,
  p_hasta       date    default null,
  p_org         uuid    default null,
  p_zona        text    default null,
  p_tipus       text    default null,
  p_responsable uuid    default null,
  p_producte    text    default null,
  p_prev_desde  date    default null,
  p_prev_hasta  date    default null,
  p_estat       text    default null,
  p_cerca       text    default null,
  p_limit       integer default 25,
  p_offset      integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  res jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta les interaccions' using errcode = '42501';
  end if;
  if p_vista is null or p_vista not in ('pendents', 'historial', 'previsions') then
    raise exception 'vista_invalida: %', p_vista using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'limit_invalid: entre 1 i 1000' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'offset_invalid: ha de ser 0 o mes' using errcode = '22023';
  end if;

  with b as materialized (
    select x.*,
           -- La clave de orden de cada vista, en una sola columna ordenable.
           case p_vista
             when 'pendents'   then x.propera_data
             when 'previsions' then x.previsio_data
           end as k_data
      from public.interaccions_base(p_desde, p_hasta, p_org, p_zona, p_tipus, p_responsable,
                                    p_producte, p_prev_desde, p_prev_hasta, p_estat, p_cerca) x
     where case p_vista
             when 'pendents'   then x.propera_accio is not null and x.seguiment_fet_at is null
             when 'previsions' then x.previsio_producte is not null
             else true
           end
  ),
  pag as (
    select b.*, row_number() over (order by b.k_data asc nulls last, b.data desc, b.created_at desc, b.id) as ordre
      from b
     order by b.k_data asc nulls last, b.data desc, b.created_at desc, b.id
     limit p_limit offset p_offset
  )
  select jsonb_build_object(
           'total', (select count(*) from b),
           'files', coalesce((
             select jsonb_agg(to_jsonb(pag) - 'k_data' - 'ordre' order by pag.ordre) from pag), '[]'::jsonb))
    into res;
  return res;
end;
$$;
revoke execute on function public.interaccions_llistat(text, date, date, uuid, text, text, uuid, text, date, date, text, text, integer, integer)
  from public, anon;
grant execute on function public.interaccions_llistat(text, date, date, uuid, text, text, uuid, text, date, date, text, text, integer, integer)
  to authenticated, service_role;

comment on function public.interaccions_llistat(text, date, date, uuid, text, text, uuid, text, date, date, text, text, integer, integer) is
  '«Interaccions i seguiment» (proceso 1.2, 20270616100100): una página de pendents·historial·previsions sobre notes_internes y el total filtrado. Solo equipo.';

-- ---------------------------------------------------------------------------
-- 3. `interaccions_opcions()`: los valores de los desplegables de filtro
-- ---------------------------------------------------------------------------
-- { "responsables": [{id, nom}], "productes": [nom], "zones": [comarca],
--   "municipis": [{ine, nom}] } — solo lo que aparece en alguna interacción, ordenado por nombre.
create or replace function public.interaccions_opcions()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  res jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta les interaccions' using errcode = '42501';
  end if;

  with o as (
    select distinct n.organizacion_id,
           coalesce(p.municipio_ine, e.municipio_ine) as ine,
           coalesce(nullif(p.area_geografica, ''), nullif(e.area_geografica, '')) as comarca
      from notes_internes n
      left join productores p on p.organizacion_id = n.organizacion_id
      left join entidades   e on e.organizacion_id = n.organizacion_id
  )
  select jsonb_build_object(
    'responsables', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'nom', r.nom) order by r.nom, r.id)
        from (select distinct n.responsable as id,
                     coalesce(nullif(btrim(pr.nombre), ''), pr.email, n.responsable::text) as nom
                from notes_internes n
                left join perfiles pr on pr.id = n.responsable
               where n.responsable is not null) r), '[]'::jsonb),
    'productes', coalesce((
      select jsonb_agg(x.previsio_producte order by x.previsio_producte)
        from (select distinct n.previsio_producte from notes_internes n
               where n.previsio_producte is not null) x), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(z.comarca order by z.comarca)
        from (select distinct o.comarca from o where o.comarca is not null) z), '[]'::jsonb),
    'municipis', coalesce((
      select jsonb_agg(jsonb_build_object('ine', mu.codi_ine, 'nom', mu.nom) order by mu.nom, mu.codi_ine)
        from municipios mu
       where mu.codi_ine in (select o.ine from o where o.ine is not null)), '[]'::jsonb))
    into res;
  return res;
end;
$$;
revoke execute on function public.interaccions_opcions() from public, anon;
grant execute on function public.interaccions_opcions() to authenticated, service_role;

comment on function public.interaccions_opcions() is
  '«Interaccions i seguiment» (proceso 1.2, 20270616100100): responsables, productos, comarcas y municipios que aparecen en las interacciones, para los desplegables de filtro. Solo equipo.';
