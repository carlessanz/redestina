-- El reparto del neto del REC, sin tope por línea (05-11-2026).
--
-- `20270509100000` repartía el neto del REC entre todas las canalizaciones conciliadas bajo
-- él con un tope: ninguna línea podía pasar de sus `kg_conciliados`. Decisión del mismo día
-- (sesión que orquesta, plan «Certificat de donació según el modelo de Tabaquet»): **se quita
-- el tope**. Lo que se certifica es lo que el DONANTE entregó a la Fundació —el REC—, no lo
-- que la entidad confirmó al recibir: un donativo puro con REC de 100 kg y ENT de 99 vuelve a
-- certificar 100, como antes de esta serie.
--
-- Lo que NO cambia, y es lo que cierra la deuda 139: el universo del reparto sigue siendo
-- TODA canalización conciliada bajo el REC (venta, maquila, entidades no sociales incluidas),
-- cada una se lleva su parte proporcional `rec_neto · kg_conciliados / suma`, y después se
-- descartan las no certificables. En una oferta donación social 50 + donación animal 20 +
-- venta 30 con REC de 90, la social certifica 45 (no 64,29, que era el fallo).
--
-- Vuelve la invariante de 20270320100000, ahora sobre todas las modalidades: por cada
-- `(clau_repartiment, producto)`, la suma de `kg_neto` de TODAS las líneas conciliadas es
-- exactamente `rec_neto` (el céntimo del redondeo, a la línea mayor del grupo).
--
-- Misma firma y mismas columnas: `create or replace` (conserva el ACL).

create or replace function public.cierre_base_periodo(
  p_desde date, p_hasta date, p_modo text default 'prueba')
returns table(canalizacion_id uuid, excedente_id uuid, entidad_id uuid, productor_id uuid,
              producto text, mes integer, kg_conciliados numeric, coste_kg numeric,
              retroactiva boolean, albaran_rec_id uuid, rec_neto numeric, kg_neto numeric,
              valor numeric, excedent_partit boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la base de calcul d''un tancament'
      using errcode = '42501';
  end if;

  return query
  with ops as (
    -- ⚠️ SIN filtro de fecha NI de modalidad. El universo del reparto son todas las
    --    canalizaciones conciliadas del excedente: las de otras fechas (20270303100000) y,
    --    desde 20270509100000, también las de venta, maquila y entidades no sociales, que
    --    se llevan su parte del neto del REC y se descartan al final.
    select c.id as canalizacion_id, c.excedente_id, c.entidad_id,
           e.productor_id, e.producto, e.espigolada_id,
           c.kg_conciliados, c.coste_kg,
           c.conciliacion_retroactiva as retroactiva,
           (public.motiu_exclusio_certificat(c.valorizacion, c.entidad_id, en.tipo_receptor)
              is null) as certificable,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid') as fecha_local
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
      left join entidades en on en.id = c.entidad_id
     where c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  conrec as (
    select o.*,
           r.albaran_id as albaran_rec_id,
           r.kg         as rec_neto,
           -- La clave del reparto: el albarán de recepción cuando lo hay, y el excedente
           -- cuando no, para que los NULL no se junten todos (20270320100000).
           coalesce(r.albaran_id, o.excedente_id) as clau_repartiment
      from ops o
      left join lateral (
        select a.id as albaran_id, sum(l.kg_validados) as kg
          from albaranes a
          join albaran_lineas l on l.albaran_id = a.id
         where a.tipo = 'REC' and a.estado = 'conciliado'
           and ( (o.espigolada_id is not null
                  and a.espigolada_id = o.espigolada_id
                  and l.producto is not distinct from o.producto)
              or (o.espigolada_id is null and a.excedente_id = o.excedente_id) )
         group by a.id
         order by a.id
         limit 1
      ) r on true
  ),
  repartido as (
    select c.*,
           (c.fecha_local >= p_desde::timestamp
            and c.fecha_local < (p_hasta + 1)::timestamp) as dins,
           sum(c.kg_conciliados) over w as suma_can,
           row_number() over (partition by c.clau_repartiment, c.producto
                              order by c.kg_conciliados desc, c.canalizacion_id) as rn,
           -- La parte proporcional del neto del REC, SIN TOPE (20270509100700): el REC es
           -- lo que el donante entregó a la Fundació, y eso es lo que se certifica aunque la
           -- entidad haya confirmado menos. El universo incluye venta, maquila y entidades no
           -- sociales, así que su parte se queda en ellas y no llega a ninguna donación social.
           case when c.rec_neto is not null
                 and sum(c.kg_conciliados) over w > 0
                then round(c.kg_conciliados * c.rec_neto / sum(c.kg_conciliados) over w, 2)
                else round(c.kg_conciliados, 2)
           end as kg_prop
      from conrec c
    window w as (partition by c.clau_repartiment, c.producto)
  ),
  ajustado as (
    -- El céntimo del redondeo se le da a la línea mayor del grupo, esté dentro o fuera de
    -- la ventana y sea o no certificable: es suya (20270303100000).
    select r.*,
           case when r.rn = 1 and r.rec_neto is not null and r.suma_can > 0
                then round(r.rec_neto, 2)
                     - sum(r.kg_prop) over (partition by r.clau_repartiment, r.producto)
                else 0
           end as correccion
      from repartido r
  ),
  marcado as (
    select a.*,
           (a.rec_neto is not null
            and bool_or(a.certificable and not a.dins)
                  over (partition by a.clau_repartiment, a.producto))
             as excedent_partit
      from ajustado a
  )
  select m.canalizacion_id, m.excedente_id, m.entidad_id, m.productor_id, m.producto,
         extract(month from m.fecha_local)::int as mes,
         m.kg_conciliados, m.coste_kg, m.retroactiva, m.albaran_rec_id, m.rec_neto,
         (m.kg_prop + m.correccion)::numeric as kg_neto,
         round((m.kg_prop + m.correccion) * coalesce(m.coste_kg, 0), 2) as valor,
         m.excedent_partit
    from marcado m
   where m.dins
     and m.certificable;
end;
$$;

comment on function public.cierre_base_periodo(date, date, text) is
  'Base de calculo del certificado de donacion: solo donacio conciliada a entidad social; el neto del REC se reparte en proporcion entre TODAS las conciliadas del REC, sin tope, y despues se descartan las no certificables (20270509100000 + 20270509100700, cierra la deuda 139).';

revoke execute on function public.cierre_base_periodo(date, date, text) from public, anon;
grant  execute on function public.cierre_base_periodo(date, date, text) to authenticated, service_role;
