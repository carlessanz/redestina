-- «Entrades i sortides» por TIPUS D'OPERACIÓ y modalidad de salida REAL (proceso 3.5 A-B del
-- cliente; fase 4 del plan de noviembre de 2026).
--
-- Desde 20270617100000 la espigolada no es una modalidad sino una CLASIFICACIÓN de la oferta
-- (`excedentes.tipus_operacio`, generada: `excedent` · `espigolada`; las jornadas heredadas con
-- `espigolada_id` también salen `espigolada`). Así que la pantalla filtra por dos ejes
-- independientes:
--
--   · `p_tipus_operacio` (NUEVO): `excedent` (ya cosechado) · `espigolada`, sobre
--     `excedentes.tipus_operacio`. Otro valor → `22023 tipus_operacio_invalid`.
--   · `p_modalitat`: la modalidad de salida REAL de la canalización, `donacio` · `venda` ·
--     `maquila` (`coalesce(canalizaciones.valorizacion, excedentes.modalitat, 'donacio')`, como
--     antes). Desaparece la pseudo-modalidad `espigolada` (= donación con `espigolada_id`).
--
-- COMPATIBILIDAD con el frontend publicado (llama por nombre y aún puede mandar
-- `p_modalitat = 'espigolada'`): ese valor se sigue aceptando y se traduce a «tipus d'operació
-- espigolada, sin filtrar modalidad». Si llega también `p_tipus_operacio`, se aplican los dos
-- (con `excedent` no sale nada, que es lo que significa la combinación).
--
-- Cambios en la salida:
--   · la fila gana `tipus_operacio`; `modalitat` es siempre la real (una donación de espigolada
--     sale `donacio`, ya no `espigolada`);
--   · el resumen admite `p_per = 'tipus_operacio'`, `per_modalitat` suma el total con sus tres
--     claves reales y aparece `per_tipus_operacio` = { excedent, espigolada }. Se CONSERVA la
--     clave `per_modalitat.espigolada` (OBSOLETA: igual que `per_tipus_operacio.espigolada`, se
--     solapa con `donacio`) solo para que el frontend publicado no pinte ceros; el nuevo no la lee.
--   · `espigolades` cuenta OFERTAS de tipo espigolada (antes, jornadas `espigolada_id`).
--
-- Firma: `drop` + `create` de las tres (cambia el número de argumentos; `create or replace` no
-- puede). Se borran las firmas viejas para que PostgREST no vea dos sobrecargas con todo por
-- defecto (llamada ambigua). Los GRANT, como estaban: `sortides_base` interna (nadie);
-- las dos públicas, `authenticated` y `service_role`, con la guarda `es_intern()` delante.
-- Idempotente: `drop … if exists` de las firmas vieja y nueva.

drop function if exists public.entrades_sortides(date, date, uuid, uuid, text, text, text, text, text, integer, integer);
drop function if exists public.entrades_sortides(date, date, uuid, uuid, text, text, text, text, text, text, integer, integer);
drop function if exists public.entrades_sortides_resum(date, date, uuid, uuid, text, text, text, text, text, text);
drop function if exists public.entrades_sortides_resum(date, date, uuid, uuid, text, text, text, text, text, text, text);
drop function if exists public.sortides_base(date, date, uuid, uuid, text, text, text, text, text);
drop function if exists public.sortides_base(date, date, uuid, uuid, text, text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- 1. `sortides_base()`: interna, única definición de la fila y de los filtros
-- ---------------------------------------------------------------------------
-- Copia de 20270612100000 con tres cambios: `f_modalitat` es la real (sin la rama
-- `espigolada`), la fila gana `tipus_operacio` y el filtro `p_tipus_operacio` (con la
-- traducción de `p_modalitat = 'espigolada'`).
create function public.sortides_base(
  p_desde          date default null,
  p_hasta          date default null,
  p_productor      uuid default null,
  p_entidad        uuid default null,
  p_producto       text default null,
  p_zona           text default null,
  p_modalitat      text default null,
  p_estat          text default null,
  p_cerca          text default null,
  p_tipus_operacio text default null
)
returns table(
  canalizacion_id    uuid,
  excedente_id       uuid,
  id_excedente       text,
  espigolada_id      uuid,
  created_at         timestamptz,
  data_sortida       date,
  productor_id       uuid,
  productor_nom      text,
  productor_org      uuid,
  entidad_id         uuid,
  entidad_nom        text,
  entidad_org        uuid,
  producto           text,
  variedad           text,
  kg_sortida         numeric,
  kg_recollits       numeric,
  modalitat          text,
  estat              text,
  causa_codigo       text,
  municipi           text,
  municipi_ine       text,
  zona               text,
  caixes_entregades  integer,
  caixes_retornades  integer,
  preu_kg            numeric,
  valor              numeric,
  albara_ent         jsonb,
  albara_rec         jsonb,
  tipus_operacio     text
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_cerca  text := nullif(btrim(coalesce(p_cerca, '')), '');
  v_mod    text := p_modalitat;
  -- Compatibilidad: la pseudo-modalidad `espigolada` del frontend publicado.
  v_compat boolean := false;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    raise exception 'periode_invalid: la data inicial es posterior a la final' using errcode = '22023';
  end if;
  if v_mod = 'espigolada' then
    v_compat := true;
    v_mod := null;
  end if;
  if v_mod is not null and v_mod not in ('donacio', 'venda', 'maquila') then
    raise exception 'modalitat_invalida: %', p_modalitat using errcode = '22023';
  end if;
  if p_tipus_operacio is not null and p_tipus_operacio not in ('excedent', 'espigolada') then
    raise exception 'tipus_operacio_invalid: %', p_tipus_operacio using errcode = '22023';
  end if;
  if p_estat is not null and p_estat not in
     ('pendent', 'programada', 'registrada', 'entregada', 'confirmada', 'conciliada', 'anulada') then
    raise exception 'estat_invalid: %', p_estat using errcode = '22023';
  end if;
  if v_cerca is not null then
    v_cerca := public.unaccent(lower(v_cerca));
  end if;

  return query
  with f as (
    select c.id                                                    as f_canalizacion,
           c.excedente_id                                          as f_excedente,
           ex.id_excedente                                         as f_id_excedente,
           ex.espigolada_id                                        as f_espigolada,
           c.created_at                                            as f_created,
           ((coalesce(c.recollida_real_at, c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid'))::date                as f_data,
           p.id                                                    as f_productor,
           coalesce(nullif(p.empresa, ''), p.name)                 as f_productor_nom,
           p.organizacion_id                                       as f_productor_org,
           c.entidad_id                                            as f_entidad,
           en.nombre                                               as f_entidad_nom,
           en.organizacion_id                                      as f_entidad_org,
           ex.producto                                             as f_producto,
           ex.variedad                                             as f_variedad,
           c.kg_confirmados                                        as f_kg_sortida,
           coalesce(c.kg_conciliados, c.kg_reales)                 as f_kg_recollits,
           -- 20270618100000: la modalidad REAL; la espigolada es el tipo de operación.
           coalesce(c.valorizacion, ex.modalitat, 'donacio')       as f_modalitat,
           case
             when c.estado = 'anulada' then 'anulada'
             else public.estat_recollida_canalitzacio(c.estado, c.recollida_registrada_at,
                                                      c.recollida_validada_at, c.data_hora_recollida,
                                                      alb.estado)
           end                                                     as f_estat,
           ex.causa_codigo                                         as f_causa,
           coalesce(ex.municipi_ine, p.municipio_ine)              as f_ine,
           coalesce(nullif(ex.comarca, ''), nullif(p.area_geografica, '')) as f_zona,
           c.caixes_entregades                                     as f_caixes_ent,
           c.caixes_retornades                                     as f_caixes_ret,
           case when c.valorizacion = 'venda' then coalesce(c.preu_acordat_kg, c.coste_kg)
                else c.coste_kg end                                as f_preu,
           case when alb.id is not null then
             jsonb_build_object('id', alb.id, 'tipo', alb.tipo, 'numero', alb.numero_completo,
                                'estado', alb.estado) end          as f_ent,
           case when rec.id is not null then
             jsonb_build_object('id', rec.id, 'tipo', rec.tipo, 'numero', rec.numero_completo,
                                'estado', rec.estado) end          as f_rec,
           coalesce(ex.tipus_operacio, 'excedent')                 as f_tipus
      from canalizaciones c
      left join excedentes  ex on ex.id = c.excedente_id
      left join espigoladas es on es.id = ex.espigolada_id
      left join productores p  on p.id = coalesce(ex.productor_id, es.productor_id)
      left join entidades   en on en.id = c.entidad_id
      left join lateral (
        select a.id, a.tipo, a.numero_completo, a.estado
          from albaranes a
         where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
           and a.estado not in ('anulado', 'rectificado')
         order by a.created_at desc
         limit 1
      ) alb on true
      -- La entrada: el REC de ESTA recogida; si no lo hay, el heredado de la oferta o el de la
      -- jornada de espigolada (rama dormida, deuda 192), solo para una donación.
      left join lateral (
        select a.id, a.tipo, a.numero_completo, a.estado
          from albaranes a
         where a.tipo = 'REC' and a.estado not in ('anulado', 'rectificado')
           and (a.canalizacion_id = c.id
                or (coalesce(c.valorizacion, ex.modalitat, 'donacio') = 'donacio'
                    and a.canalizacion_id is null
                    and ((a.excedente_id = c.excedente_id)
                         or (ex.espigolada_id is not null and a.espigolada_id = ex.espigolada_id))))
         order by (a.canalizacion_id is null), a.created_at desc
         limit 1
      ) rec on true
  )
  select f.f_canalizacion, f.f_excedente, f.f_id_excedente, f.f_espigolada, f.f_created, f.f_data,
         f.f_productor, f.f_productor_nom, f.f_productor_org,
         f.f_entidad, f.f_entidad_nom, f.f_entidad_org,
         f.f_producto, f.f_variedad, f.f_kg_sortida, f.f_kg_recollits,
         f.f_modalitat, f.f_estat, f.f_causa,
         m.nom, f.f_ine, f.f_zona,
         f.f_caixes_ent, f.f_caixes_ret,
         f.f_preu,
         case when f.f_kg_recollits is not null and f.f_preu is not null
              then round(f.f_kg_recollits * f.f_preu, 2) end,
         f.f_ent, f.f_rec,
         f.f_tipus
    from f
    left join municipios m on m.codi_ine = f.f_ine
   where (p_desde is null or f.f_data >= p_desde)
     and (p_hasta is null or f.f_data <= p_hasta)
     and (p_productor is null or f.f_productor = p_productor)
     and (p_entidad is null or f.f_entidad = p_entidad)
     and (p_producto is null or f.f_producto = p_producto)
     and (p_zona is null or f.f_zona = p_zona)
     and (v_mod is null or f.f_modalitat = v_mod)
     and (p_tipus_operacio is null or f.f_tipus = p_tipus_operacio)
     and (not v_compat or f.f_tipus = 'espigolada')
     -- Las anuladas, solo si se piden.
     and (case when p_estat is null then f.f_estat <> 'anulada' else f.f_estat = p_estat end)
     and (v_cerca is null
          or strpos(public.unaccent(lower(concat_ws(' ',
                f.f_productor_nom, f.f_entidad_nom, f.f_producto, f.f_variedad, f.f_id_excedente,
                f.f_ent->>'numero', f.f_rec->>'numero'))), v_cerca) > 0);
end;
$$;
revoke execute on function public.sortides_base(date, date, uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;

comment on function public.sortides_base(date, date, uuid, uuid, text, text, text, text, text, text) is
  'Interna (20270612100000; 20270618100000 tipus_operacio): una fila por salida (canalización) con sus filtros. Única definición de «Entrades i sortides»; la llaman entrades_sortides y entrades_sortides_resum.';

-- ---------------------------------------------------------------------------
-- 2. `entrades_sortides()`: la página y los totales de lo filtrado
-- ---------------------------------------------------------------------------
-- { "total": n, "kg_sortida": x, "kg_recollits": y, "files": [ <fila de sortides_base> … ] }
-- Igual que en 20270612100000 más `p_tipus_operacio`.
create function public.entrades_sortides(
  p_desde          date    default null,
  p_hasta          date    default null,
  p_productor      uuid    default null,
  p_entidad        uuid    default null,
  p_producto       text    default null,
  p_zona           text    default null,
  p_modalitat      text    default null,
  p_estat          text    default null,
  p_cerca          text    default null,
  p_tipus_operacio text    default null,
  p_limit          integer default 25,
  p_offset         integer default 0
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
    raise exception 'Nomes l''equip consulta les entrades i sortides' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'limit_invalid: entre 1 i 1000' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'offset_invalid: ha de ser 0 o mes' using errcode = '22023';
  end if;

  with b as materialized (
    select * from public.sortides_base(p_desde, p_hasta, p_productor, p_entidad, p_producto,
                                       p_zona, p_modalitat, p_estat, p_cerca, p_tipus_operacio)
  )
  select jsonb_build_object(
           'total',        (select count(*) from b),
           'kg_sortida',   (select coalesce(sum(b.kg_sortida), 0) from b),
           'kg_recollits', (select coalesce(sum(b.kg_recollits), 0) from b),
           'files', coalesce((
             select jsonb_agg(to_jsonb(x) order by x.data_sortida desc, x.created_at desc, x.canalizacion_id)
               from (select * from b
                      order by b.data_sortida desc, b.created_at desc, b.canalizacion_id
                      limit p_limit offset p_offset) x), '[]'::jsonb))
    into res;
  return res;
end;
$$;
revoke execute on function public.entrades_sortides(date, date, uuid, uuid, text, text, text, text, text, text, integer, integer)
  from public, anon;
grant execute on function public.entrades_sortides(date, date, uuid, uuid, text, text, text, text, text, text, integer, integer)
  to authenticated, service_role;

comment on function public.entrades_sortides(date, date, uuid, uuid, text, text, text, text, text, text, integer, integer) is
  '«Entrades i sortides» (20270612100000; 20270618100000 p_tipus_operacio): una fila por salida, paginada, y los totales de todo lo filtrado. Solo equipo.';

-- ---------------------------------------------------------------------------
-- 3. `entrades_sortides_resum()`: indicadores agrupados
-- ---------------------------------------------------------------------------
-- { "total": {sortides, kg_sortida, kg_recollits, ofertants, receptors, espigolades,
--             per_modalitat, per_tipus_operacio},
--   "grups": [ {clau, etiqueta, <lo mismo>} … ] }
-- `per_modalitat` = { donacio|venda|maquila: {sortides, kg_sortida, kg_recollits} } (suman el
-- total) + `espigolada` OBSOLETA (= per_tipus_operacio.espigolada; solo para el frontend
-- publicado). `per_tipus_operacio` = { excedent|espigolada: {…} }, siempre las dos claves.
-- `p_per`: ofertant · receptor · producte · modalitat · tipus_operacio · mes · zona · estat
-- (otro → 22023 `agrupacio_invalida`).
create function public.entrades_sortides_resum(
  p_desde          date default null,
  p_hasta          date default null,
  p_productor      uuid default null,
  p_entidad        uuid default null,
  p_producto       text default null,
  p_zona           text default null,
  p_modalitat      text default null,
  p_estat          text default null,
  p_cerca          text default null,
  p_tipus_operacio text default null,
  p_per            text default 'modalitat'
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
    raise exception 'Nomes l''equip consulta les entrades i sortides' using errcode = '42501';
  end if;
  if p_per is null or p_per not in ('ofertant', 'receptor', 'producte', 'modalitat', 'tipus_operacio',
                                    'mes', 'zona', 'estat') then
    raise exception 'agrupacio_invalida: %', p_per using errcode = '22023';
  end if;

  with b as (
    select s.*,
           case p_per
             when 'ofertant'       then s.productor_id::text
             when 'receptor'       then s.entidad_id::text
             when 'producte'       then s.producto
             when 'modalitat'      then s.modalitat
             when 'tipus_operacio' then s.tipus_operacio
             when 'mes'            then to_char(s.data_sortida, 'YYYY-MM')
             when 'zona'           then s.zona
             when 'estat'          then s.estat
           end as k,
           case p_per
             when 'ofertant'       then s.productor_nom
             when 'receptor'       then s.entidad_nom
             when 'producte'       then s.producto
             when 'modalitat'      then s.modalitat
             when 'tipus_operacio' then s.tipus_operacio
             when 'mes'            then to_char(s.data_sortida, 'YYYY-MM')
             when 'zona'           then s.zona
             when 'estat'          then s.estat
           end as et
      from public.sortides_base(p_desde, p_hasta, p_productor, p_entidad, p_producto,
                                p_zona, p_modalitat, p_estat, p_cerca, p_tipus_operacio) s
  ),
  g as (
    select grouping(b.k) = 1 as es_total,
           b.k,
           max(b.et) as et,
           coalesce(sum(b.kg_sortida), 0) as kg_s,
           jsonb_build_object(
             'sortides',     count(*),
             'kg_sortida',   coalesce(sum(b.kg_sortida), 0),
             'kg_recollits', coalesce(sum(b.kg_recollits), 0),
             'ofertants',    count(distinct b.productor_id),
             'receptors',    count(distinct b.entidad_id),
             -- 20270618100000: ofertas de tipo espigolada (antes, jornadas `espigolada_id`).
             'espigolades',  count(distinct b.excedente_id) filter (where b.tipus_operacio = 'espigolada'),
             'per_modalitat', jsonb_build_object(
               'donacio', jsonb_build_object(
                 'sortides',     count(*) filter (where b.modalitat = 'donacio'),
                 'kg_sortida',   coalesce(sum(b.kg_sortida)   filter (where b.modalitat = 'donacio'), 0),
                 'kg_recollits', coalesce(sum(b.kg_recollits) filter (where b.modalitat = 'donacio'), 0)),
               'venda', jsonb_build_object(
                 'sortides',     count(*) filter (where b.modalitat = 'venda'),
                 'kg_sortida',   coalesce(sum(b.kg_sortida)   filter (where b.modalitat = 'venda'), 0),
                 'kg_recollits', coalesce(sum(b.kg_recollits) filter (where b.modalitat = 'venda'), 0)),
               'maquila', jsonb_build_object(
                 'sortides',     count(*) filter (where b.modalitat = 'maquila'),
                 'kg_sortida',   coalesce(sum(b.kg_sortida)   filter (where b.modalitat = 'maquila'), 0),
                 'kg_recollits', coalesce(sum(b.kg_recollits) filter (where b.modalitat = 'maquila'), 0)),
               -- OBSOLETA (solo para el frontend publicado): se solapa con `donacio`.
               'espigolada', jsonb_build_object(
                 'sortides',     count(*) filter (where b.tipus_operacio = 'espigolada'),
                 'kg_sortida',   coalesce(sum(b.kg_sortida)   filter (where b.tipus_operacio = 'espigolada'), 0),
                 'kg_recollits', coalesce(sum(b.kg_recollits) filter (where b.tipus_operacio = 'espigolada'), 0))
             ),
             'per_tipus_operacio', jsonb_build_object(
               'excedent', jsonb_build_object(
                 'sortides',     count(*) filter (where b.tipus_operacio = 'excedent'),
                 'kg_sortida',   coalesce(sum(b.kg_sortida)   filter (where b.tipus_operacio = 'excedent'), 0),
                 'kg_recollits', coalesce(sum(b.kg_recollits) filter (where b.tipus_operacio = 'excedent'), 0)),
               'espigolada', jsonb_build_object(
                 'sortides',     count(*) filter (where b.tipus_operacio = 'espigolada'),
                 'kg_sortida',   coalesce(sum(b.kg_sortida)   filter (where b.tipus_operacio = 'espigolada'), 0),
                 'kg_recollits', coalesce(sum(b.kg_recollits) filter (where b.tipus_operacio = 'espigolada'), 0))
             )) as xifres
      from b
     group by grouping sets ((b.k), ())
  )
  select jsonb_build_object(
           'total', (select g.xifres from g where g.es_total),
           'grups', coalesce((
             select jsonb_agg(jsonb_build_object('clau', g.k, 'etiqueta', g.et) || g.xifres
                              order by case when p_per = 'mes' then g.k end asc nulls last,
                                       g.kg_s desc, g.et nulls last, g.k)
               from g where not g.es_total), '[]'::jsonb))
    into res;
  return res;
end;
$$;
revoke execute on function public.entrades_sortides_resum(date, date, uuid, uuid, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.entrades_sortides_resum(date, date, uuid, uuid, text, text, text, text, text, text, text)
  to authenticated, service_role;

comment on function public.entrades_sortides_resum(date, date, uuid, uuid, text, text, text, text, text, text, text) is
  '«Entrades i sortides» (20270612100000; 20270618100000 tipus_operacio): indicadores agrupados (ofertant·receptor·producte·modalitat·tipus_operacio·mes·zona·estat) con el desglose por modalidad real y por tipo de operación. Solo equipo.';
