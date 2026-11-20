-- «Entrades i sortides» (punto 6.7 del Excel de la Fundació): la capa de datos de una pantalla
-- del equipo con UNA FILA POR SALIDA de producto de un ofertante a un receptor, con filtros,
-- totales, un resumen de indicadores agrupado y exportación a Excel.
--
-- Solo lectura. Sin tablas ni columnas nuevas: una salida es una fila de `canalizaciones`
-- (toda canalización tiene receptor, `entidad_id`), cruzada con `excedentes`, `espigoladas`,
-- `albaranes`, `productores`, `entidades` y `municipios`.
--
--   1. `estat_recollida_canalitzacio(...)`, INTERNA e `immutable`: el `case` del estado de la
--      recogida que hasta ahora vivía solo en `operacio_detall`. Se saca a una función para que
--      la ficha de la operación y esta pantalla digan SIEMPRE lo mismo.
--   2. `operacio_detall(uuid)`: copia letra por letra de la vigente (20270608100100) con un solo
--      cambio, el `case` sustituido por la llamada a (1). Mismo `returns table`, mismo
--      comportamiento (la función devuelve exactamente lo que devolvía el `case`).
--   3. `sortides_base(<filtros>)`, INTERNA (sin EXECUTE para ninguna sesión): ÚNICA definición de
--      la fila y de los filtros, con su validación (`22023`). Las anuladas, fuera salvo que se
--      pidan (`p_estat = 'anulada'`).
--   4. `entrades_sortides(<filtros>, p_limit, p_offset)`: la página y los totales de TODO lo
--      filtrado (no de la página). Para la tabla y para la exportación (hasta 1.000 por página).
--   5. `entrades_sortides_resum(<filtros>, p_per)`: indicadores agrupados (ofertant, receptor,
--      producte, modalitat, mes, zona, estat) con el desglose de kilos por modalidad que mira el
--      equipo en la hoja «Indicadors» del ARA. Sin tope de grupos: la interfaz lo usa también
--      para poblar los desplegables de filtro.
--
-- Las dos públicas son del equipo (`es_intern()`), `security definer` y `stable`, con la guarda
-- antes que nada. `auditoria_funcions_obertes()` sigue en 0 filas.
--
-- Decisiones (detalle en cada función):
--   · Ofertante = `coalesce(excedentes.productor_id, espigoladas.productor_id)`; su nombre, con el
--     criterio de `operacio_detall`/`canalitzacions_actives`: el de la ficha
--     (`coalesce(nullif(empresa, ''), name)`), no el de la persona de contacto.
--   · Modalidad: `coalesce(valorizacion, excedentes.modalitat, 'donacio')`; una donación sobre una
--     oferta de espigolada es `espigolada` («Espigolada – Donació» en la interfaz).
--   · Zona: la comarca de la oferta; si no la tiene, `area_geografica` de la ficha del ofertante.
--     El municipio, igual: el de la oferta y, si falta, el de la ficha.
--   · REC: el de ESTA recogida; si no lo hay, el heredado de la oferta o el de la jornada de
--     espigolada. El heredado solo para una donación (venta y maquila no llevan albarán de
--     Redestina desde 20270608100100; el REC heredado cuenta la donación de la oferta).
--     Nunca anulados ni rectificados.
--
-- Rendimiento: las laterales de albarán van por `albaranes.canalizacion_id`/`excedente_id`/
-- `espigolada_id`, que ya tienen índice. No se crea ninguno.

-- ---------------------------------------------------------------------------
-- 1. `estat_recollida_canalitzacio()`: interna
-- ---------------------------------------------------------------------------
-- ⚠️ El vocabulario lo leen la ficha de la operación (`operacio_detall.estat_recollida`) y
--    «Entrades i sortides»: pendent · programada · registrada · entregada · confirmada ·
--    conciliada. NO conoce `anulada` a propósito: `operacio_detall` nunca lo devolvió (a la
--    entidad no le enseña las anuladas; al equipo, el estado del albarán). `sortides_base()` la
--    añade por fuera.
create or replace function public.estat_recollida_canalitzacio(
  p_estado            text,         -- canalizaciones.estado
  p_registrada_at     timestamptz,  -- canalizaciones.recollida_registrada_at
  p_validada_at       timestamptz,  -- canalizaciones.recollida_validada_at
  p_data_hora         timestamptz,  -- canalizaciones.data_hora_recollida
  p_albara_estado     text          -- estado del ENT/OPE vivo más reciente de la canalización
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
           -- Registrada por el receptor y esperando a que un admin la valide.
           when p_registrada_at is not null and p_validada_at is null then 'registrada'
           when p_estado = 'conciliada' or p_albara_estado = 'conciliado' then 'conciliada'
           when p_albara_estado = 'confirmado' then 'confirmada'
           when p_albara_estado = 'entregado' then 'entregada'
           when p_albara_estado = 'emitido' or p_data_hora is not null then 'programada'
           else 'pendent'
         end;
$$;
revoke execute on function public.estat_recollida_canalitzacio(text, timestamptz, timestamptz, timestamptz, text)
  from public, anon, authenticated;

comment on function public.estat_recollida_canalitzacio(text, timestamptz, timestamptz, timestamptz, text) is
  'Interna (20270612100000): estado de la recogida de una canalización (pendent·programada·registrada·entregada·confirmada·conciliada). Única definición; la usan operacio_detall y sortides_base.';

-- ---------------------------------------------------------------------------
-- 2. `operacio_detall()`: el estado, por la función de (1)
-- ---------------------------------------------------------------------------
-- Copia letra por letra de la vigente (20270608100100). Único cambio: el `case` de
-- `estat_recollida` pasa a `estat_recollida_canalitzacio(...)`, con los mismos argumentos y el
-- mismo orden de condiciones. Mismo `returns table`: los GRANT se conservan.
create or replace function public.operacio_detall(p_canalizacion uuid)
returns table(canalizacion_id uuid, excedente_id uuid, resposta_id uuid, rol text, producte text, varietat text, modalitat text, kg_sollicitats numeric, kg_assignats numeric, kg_rebuts numeric, data_hora_recollida timestamptz, estat_recollida text, productor_nom text, productor_contacte text, productor_telefon text, entitat_nom text, entitat_contacte text, entitat_telefon text, lloc_alias text, lloc_adreca text, lloc_municipi text, lloc_maps text, lloc_contacte text, lloc_telefon text, lloc_horari text, lloc_observacions text, condicions text, albara_numero text, albara_estat text, pot_registrar boolean, recollida_real_at timestamptz, recollida_registrada_at timestamptz, incidencia_recollida jsonb, rec_numero text, rec_estat text, kg_declarats numeric, resultat_recollida text, recollida_validada_at timestamptz, recollida_retornada_at timestamptz, motiu_retorn text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select c.*, e.productor_id, e.producto, e.variedad, e.observacions, e.ubicacion_id,
           e.horari_recollida, e.espigolada_id,
           case
             when auth.uid() is null or public.es_intern() then 'equip'
             when e.productor_id in (select public.mis_productores()) then 'productor'
             when c.entidad_id in (select public.mis_entidades()) then 'entidad'
           end as qui
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
     where c.id = p_canalizacion
  ),
  alb as (
    select a.id, a.numero_completo, a.estado
      from albaranes a, c
     where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
       and a.estado not in ('anulado', 'rectificado')
     order by a.created_at desc
     limit 1
  ),
  rec as (
    -- 20270608100100: el REC de ESTA recogida; si no lo hay, el heredado de la oferta.
    select a.numero_completo, a.estado
      from albaranes a, c
     where a.tipo = 'REC' and a.estado not in ('anulado', 'rectificado')
       and (a.canalizacion_id = c.id
            or (a.canalizacion_id is null and a.excedente_id = c.excedente_id
                and a.espigolada_id is null))
     order by (a.canalizacion_id is null), a.created_at desc
     limit 1
  )
  select c.id, c.excedente_id, r.id, c.qui,
         c.producto, c.variedad, c.valorizacion,
         r.kg_solicitados,
         c.kg_confirmados,
         coalesce(c.kg_conciliados, c.kg_reales),
         c.data_hora_recollida,
         -- 20270612100000: el `case` vive en `estat_recollida_canalitzacio()` (la comparte
         -- «Entrades i sortides»).
         public.estat_recollida_canalitzacio(c.estado, c.recollida_registrada_at,
                                             c.recollida_validada_at, c.data_hora_recollida,
                                             alb.estado),
         coalesce(nullif(p.empresa, ''), p.name), p.name, p.phone,
         en.nombre, en.contacto, en.telefono,
         u.alias, u.direccion, coalesce(u.municipio, p.poblacion), u.gmaps_url,
         coalesce(u.contacto_nombre, p.name), coalesce(u.contacto_telefono, p.phone),
         coalesce(u.horario, c.horari_recollida), u.observaciones,
         c.observacions,
         alb.numero_completo, alb.estado,
         -- La misma condición que exige `registrar_recollida()`.
         (c.qui = 'entidad' and c.estado <> 'anulada' and c.recollida_registrada_at is null
          and c.recollida_validada_at is null
          and c.espigolada_id is null
          and (
            (alb.estado in ('borrador', 'emitido', 'entregado')
             and not exists (select 1 from enlaces_token t
                              where t.objeto_tipo = 'albaran' and t.objeto_id = alb.id
                                and t.proposito = 'confirmacion_albaran'
                                and t.usado_at is not null and t.rol_parte = 'recibe'))
            -- 20270608100100 (D): una venta o una maquila no tiene albarán.
            or (alb.id is null and c.valorizacion in ('venda', 'maquila')
                and c.estado <> 'conciliada'))),
         c.recollida_real_at, c.recollida_registrada_at, c.incidencia_recollida,
         rec.numero_completo, rec.estado,
         c.kg_declarats, c.resultat_recollida, c.recollida_validada_at,
         c.recollida_retornada_at, c.motiu_retorn
    from c
    left join alb on true
    left join rec on true
    left join productores p on p.id = c.productor_id
    left join entidades en on en.id = c.entidad_id
    left join productor_ubicaciones u on u.id = c.ubicacion_id
    left join oferta_respuestas r on r.canalizacion_id = c.id
   where c.qui is not null
     and (c.qui <> 'entidad' or c.estado <> 'anulada');
$$;

-- ---------------------------------------------------------------------------
-- 3. `sortides_base()`: interna, única definición de la fila y de los filtros
-- ---------------------------------------------------------------------------
-- `security invoker`: solo la llaman `entrades_sortides()` y `entrades_sortides_resum()`, que son
-- `security definer` (corre como su propietario). Ninguna sesión tiene EXECUTE.
--
-- Filtros (null = sin filtro): fechas inclusivas sobre `data_sortida`; igualdad exacta en
-- productor, entidad, producto, zona, modalidad y estado; `p_cerca` sin mayúsculas ni acentos
-- sobre ofertante, receptor, producto, variedad, `id_excedente` y números de albarán.
create or replace function public.sortides_base(
  p_desde     date default null,
  p_hasta     date default null,
  p_productor uuid default null,
  p_entidad   uuid default null,
  p_producto  text default null,
  p_zona      text default null,
  p_modalitat text default null,
  p_estat     text default null,
  p_cerca     text default null
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
  albara_rec         jsonb
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_cerca text := nullif(btrim(coalesce(p_cerca, '')), '');
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    raise exception 'periode_invalid: la data inicial es posterior a la final' using errcode = '22023';
  end if;
  if p_modalitat is not null and p_modalitat not in ('donacio', 'venda', 'maquila', 'espigolada') then
    raise exception 'modalitat_invalida: %', p_modalitat using errcode = '22023';
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
           case
             when coalesce(c.valorizacion, ex.modalitat, 'donacio') = 'donacio'
                  and ex.espigolada_id is not null then 'espigolada'
             else coalesce(c.valorizacion, ex.modalitat, 'donacio')
           end                                                     as f_modalitat,
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
                                'estado', rec.estado) end          as f_rec
      from canalizaciones c
      left join excedentes  ex on ex.id = c.excedente_id
      left join espigoladas es on es.id = ex.espigolada_id
      left join productores p  on p.id = coalesce(ex.productor_id, es.productor_id)
      left join entidades   en on en.id = c.entidad_id
      -- La salida: el ENT/OPE vivo más reciente de ESTA canalización (lo mismo que
      -- `operacio_detall.alb`, que decide también el estado).
      left join lateral (
        select a.id, a.tipo, a.numero_completo, a.estado
          from albaranes a
         where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
           and a.estado not in ('anulado', 'rectificado')
         order by a.created_at desc
         limit 1
      ) alb on true
      -- La entrada: el REC de ESTA recogida; si no lo hay, el heredado de la oferta o el de la
      -- jornada de espigolada, solo para una donación (venta y maquila no llevan REC).
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
         f.f_ent, f.f_rec
    from f
    left join municipios m on m.codi_ine = f.f_ine
   where (p_desde is null or f.f_data >= p_desde)
     and (p_hasta is null or f.f_data <= p_hasta)
     and (p_productor is null or f.f_productor = p_productor)
     and (p_entidad is null or f.f_entidad = p_entidad)
     and (p_producto is null or f.f_producto = p_producto)
     and (p_zona is null or f.f_zona = p_zona)
     and (p_modalitat is null or f.f_modalitat = p_modalitat)
     -- Las anuladas, solo si se piden.
     and (case when p_estat is null then f.f_estat <> 'anulada' else f.f_estat = p_estat end)
     and (v_cerca is null
          or strpos(public.unaccent(lower(concat_ws(' ',
                f.f_productor_nom, f.f_entidad_nom, f.f_producto, f.f_variedad, f.f_id_excedente,
                f.f_ent->>'numero', f.f_rec->>'numero'))), v_cerca) > 0);
end;
$$;
revoke execute on function public.sortides_base(date, date, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;

comment on function public.sortides_base(date, date, uuid, uuid, text, text, text, text, text) is
  'Interna (20270612100000): una fila por salida (canalización) con sus filtros. Única definición de «Entrades i sortides»; la llaman entrades_sortides y entrades_sortides_resum.';

-- ---------------------------------------------------------------------------
-- 4. `entrades_sortides()`: la página y los totales de lo filtrado
-- ---------------------------------------------------------------------------
-- { "total": n, "kg_sortida": x, "kg_recollits": y, "files": [ <fila de sortides_base> … ] }
-- Orden: `data_sortida desc, created_at desc, canalizacion_id`. `p_limit` 1-1000 (22023
-- `limit_invalid`), `p_offset` >= 0 (22023 `offset_invalid`).
create or replace function public.entrades_sortides(
  p_desde     date    default null,
  p_hasta     date    default null,
  p_productor uuid    default null,
  p_entidad   uuid    default null,
  p_producto  text    default null,
  p_zona      text    default null,
  p_modalitat text    default null,
  p_estat     text    default null,
  p_cerca     text    default null,
  p_limit     integer default 25,
  p_offset    integer default 0
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
                                       p_zona, p_modalitat, p_estat, p_cerca)
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
revoke execute on function public.entrades_sortides(date, date, uuid, uuid, text, text, text, text, text, integer, integer)
  from public, anon;
grant execute on function public.entrades_sortides(date, date, uuid, uuid, text, text, text, text, text, integer, integer)
  to authenticated, service_role;

comment on function public.entrades_sortides(date, date, uuid, uuid, text, text, text, text, text, integer, integer) is
  '«Entrades i sortides» (20270612100000): una fila por salida, paginada, y los totales de todo lo filtrado. Solo equipo.';

-- ---------------------------------------------------------------------------
-- 5. `entrades_sortides_resum()`: indicadores agrupados
-- ---------------------------------------------------------------------------
-- { "total": {sortides, kg_sortida, kg_recollits, ofertants, receptors, espigolades, per_modalitat},
--   "grups": [ {clau, etiqueta, <lo mismo>} … ] }
-- `per_modalitat` = { donacio|venda|maquila|espigolada: {sortides, kg_sortida, kg_recollits} },
-- siempre las cuatro claves. `p_per`: ofertant · receptor · producte · modalitat · mes · zona ·
-- estat (otro → 22023 `agrupacio_invalida`). `clau`: uuid en texto (ofertant, receptor),
-- `AAAA-MM` (mes) o el valor; `etiqueta`: el nombre legible (modalitat, estat y mes repiten la
-- clave: la traduce la interfaz). Orden: `kg_sortida desc` (mes: cronológico). Sin tope.
create or replace function public.entrades_sortides_resum(
  p_desde     date default null,
  p_hasta     date default null,
  p_productor uuid default null,
  p_entidad   uuid default null,
  p_producto  text default null,
  p_zona      text default null,
  p_modalitat text default null,
  p_estat     text default null,
  p_cerca     text default null,
  p_per       text default 'modalitat'
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
  if p_per is null or p_per not in ('ofertant', 'receptor', 'producte', 'modalitat', 'mes', 'zona', 'estat') then
    raise exception 'agrupacio_invalida: %', p_per using errcode = '22023';
  end if;

  with b as (
    select s.*,
           case p_per
             when 'ofertant'  then s.productor_id::text
             when 'receptor'  then s.entidad_id::text
             when 'producte'  then s.producto
             when 'modalitat' then s.modalitat
             when 'mes'       then to_char(s.data_sortida, 'YYYY-MM')
             when 'zona'      then s.zona
             when 'estat'     then s.estat
           end as k,
           case p_per
             when 'ofertant'  then s.productor_nom
             when 'receptor'  then s.entidad_nom
             when 'producte'  then s.producto
             when 'modalitat' then s.modalitat
             when 'mes'       then to_char(s.data_sortida, 'YYYY-MM')
             when 'zona'      then s.zona
             when 'estat'     then s.estat
           end as et
      from public.sortides_base(p_desde, p_hasta, p_productor, p_entidad, p_producto,
                                p_zona, p_modalitat, p_estat, p_cerca) s
  ),
  -- Un solo recorrido: los grupos y, con el conjunto vacío `()`, el total (que existe también
  -- cuando no hay ninguna fila: todo a 0).
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
             'espigolades',  count(distinct b.espigolada_id),
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
               'espigolada', jsonb_build_object(
                 'sortides',     count(*) filter (where b.modalitat = 'espigolada'),
                 'kg_sortida',   coalesce(sum(b.kg_sortida)   filter (where b.modalitat = 'espigolada'), 0),
                 'kg_recollits', coalesce(sum(b.kg_recollits) filter (where b.modalitat = 'espigolada'), 0))
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
revoke execute on function public.entrades_sortides_resum(date, date, uuid, uuid, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.entrades_sortides_resum(date, date, uuid, uuid, text, text, text, text, text, text)
  to authenticated, service_role;

comment on function public.entrades_sortides_resum(date, date, uuid, uuid, text, text, text, text, text, text) is
  '«Entrades i sortides» (20270612100000): indicadores agrupados (ofertant·receptor·producte·modalitat·mes·zona·estat) con el desglose por modalidad. Solo equipo.';
