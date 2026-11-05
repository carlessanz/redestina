-- Lo certificable: solo donación conciliada a una entidad SOCIAL (05-11-2026).
--
-- Plan «Certificat de donació según el modelo de Tabaquet», bloque 1 (datos). Tres fallos
-- que salieron al explorar, los tres en la base de cálculo del certificado de donación:
--
--   (1) `cierre_base_periodo()` (20270320100000) filtraba solo `valorizacion = 'donacio'` y
--       NO MIRABA `entidades.tipo_receptor`: entraban en el CD los kilos donados a entidades
--       animales, transformadoras y comerciales. 🔴 Regla de negocio: un certificado de
--       donación solo acredita lo que se ha donado a una ENTIDAD SOCIAL. Nunca ventas ni
--       maquila, nunca canalizaciones sin entidad, nunca `valorizacion` nula.
--
--   (2) REC mixto (deuda 139, reproducida en el clon el 05-11-2026: líneas con 202,02 kg de
--       neto sobre 200 conciliados). El REC de una oferta suma los kilos de TODAS sus
--       canalizaciones (`validar_recollida()`: `sum(coalesce(kg_reales, kg_confirmados))`
--       sin mirar la modalidad), pero el reparto lo dividía solo entre las líneas de
--       donación. En una oferta donación + venta, los kilos de la venta acababan en el CD.
--
--   (3) `cierre_pendents_periodo()` contaba como «sin conciliar» donaciones que nunca
--       podrán entrar en un certificado (entidad no social), y bloqueaba con ellas.
--
-- Lo que hace esta migración:
--
--   · `motiu_exclusio_certificat(valorizacion, entidad_id, tipo_receptor)`: el ÚNICO sitio
--     donde se decide si una canalización es certificable. Devuelve null si lo es y, si no,
--     el motivo: `sense_valoritzacio` · `venda` · `maquila` · `sense_entitat` ·
--     `entitat_no_social:<tipo_receptor>` (`desconegut` si la entidad no tiene tipo). La
--     usan `cierre_base_periodo()` (y por ella el anual, el periodo y la oferta),
--     `cierre_pendents_periodo()`, `cierre_exclosos_periodo()` y el ámbito oferta de
--     `calcular_certificado_periodo()`.
--
--   · `cierre_base_periodo()` (misma firma; `create or replace` vale): el universo del
--     reparto pasa a ser TODA canalización conciliada bajo el REC, sea cual sea su
--     modalidad o su entidad. Cada línea recibe su parte proporcional del neto del REC y
--     **nunca más que sus `kg_conciliados`**; el céntimo del redondeo sigue yendo a la
--     línea mayor del grupo. Después se descartan las no certificables. Así la parte de la
--     venta se queda en la venta (y no se certifica) y la de una entidad animal se queda en
--     la suya (y tampoco). La invariante nueva, por `(clau_repartiment, producto)`:
--       suma de kg_neto de TODAS las líneas = least(rec_neto, suma de kg_conciliados)
--       y cada línea ≤ sus kg_conciliados.
--     `excedent_partit` solo lo marcan las líneas certificables fuera de la ventana: una
--     venta de la misma oferta fuera de la ventana no parte ningún certificado.
--
--   · `cierre_pendents_periodo()` (misma firma): solo lo que, una vez conciliado, entraría.
--
--   · `cierre_exclosos_periodo(productor, desde, fins, excedente, modo)`: lo que se queda
--     fuera de un certificado y por qué, para enseñarlo en el diálogo («Excloses del
--     certificat»). Solo el equipo. Además de los cinco motivos de arriba devuelve
--     `conciliacio_retroactiva` en modo real (la conciliación hecha después de cerrar solo
--     entra en los cierres de prueba, regla de `cierre_base_periodo()`).
--
-- Cierra la deuda 139.

-- ---------------------------------------------------------------------------
-- 1. El criterio, en un solo sitio
-- ---------------------------------------------------------------------------
create or replace function public.motiu_exclusio_certificat(
  p_valorizacion  text,
  p_entidad       uuid,
  p_tipo_receptor text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_valorizacion is null        then 'sense_valoritzacio'
    when p_valorizacion = 'venda'      then 'venda'
    when p_valorizacion = 'maquila'    then 'maquila'
    -- El check de `canalizaciones` no deja otro valor; si algún día lo hubiera, fuera.
    when p_valorizacion <> 'donacio'   then 'sense_valoritzacio'
    when p_entidad is null             then 'sense_entitat'
    when p_tipo_receptor is distinct from 'social'
      then 'entitat_no_social:' || coalesce(nullif(btrim(p_tipo_receptor), ''), 'desconegut')
    else null
  end;
$$;

comment on function public.motiu_exclusio_certificat(text, uuid, text) is
  'Null si la canalizacion entra en un certificado de donacion (donacio a una entidad social); si no, el motivo. Unico criterio de lo certificable (20270509100000).';

-- Pura e interna: la llaman funciones `security definer`, nunca la API.
revoke execute on function public.motiu_exclusio_certificat(text, uuid, text) from public, anon, authenticated;
grant  execute on function public.motiu_exclusio_certificat(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. La base de cálculo (misma firma y mismas columnas)
-- ---------------------------------------------------------------------------
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
           -- 🔴 El tope: ninguna línea recibe más que lo que se concilió en ella. Si el REC
           --    dice más que la suma de las canalizaciones (merma negativa, o kilos de una
           --    canalización todavía no conciliada), lo que sobra no es de nadie y no se
           --    certifica.
           case when c.rec_neto is not null
                 and sum(c.kg_conciliados) over w > 0
                then round(least(c.kg_conciliados,
                                 c.kg_conciliados * c.rec_neto / sum(c.kg_conciliados) over w), 2)
                else round(c.kg_conciliados, 2)
           end as kg_prop
      from conrec c
    window w as (partition by c.clau_repartiment, c.producto)
  ),
  ajustado as (
    -- El céntimo del redondeo se le da a la línea mayor del grupo, esté dentro o fuera de
    -- la ventana y sea o no certificable: es suya (20270303100000). Solo cuando el REC
    -- no supera la suma; si la supera, cada línea ya tiene exactamente lo suyo.
    select r.*,
           case when r.rn = 1 and r.rec_neto is not null and r.suma_can > 0
                 and r.rec_neto <= r.suma_can
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
         least(m.kg_prop + m.correccion, m.kg_conciliados)::numeric as kg_neto,
         round(least(m.kg_prop + m.correccion, m.kg_conciliados) * coalesce(m.coste_kg, 0), 2)
           as valor,
         m.excedent_partit
    from marcado m
   where m.dins
     and m.certificable;
end;
$$;

comment on function public.cierre_base_periodo(date, date, text) is
  'Base de calculo del certificado de donacion: solo donacio conciliada a entidad social; el neto del REC se reparte entre TODAS las conciliadas del REC con tope en kg_conciliados (20270509100000, cierra la deuda 139).';

-- `create or replace` conserva el ACL; se repite para que el fichero se lea solo.
revoke execute on function public.cierre_base_periodo(date, date, text) from public, anon;
grant  execute on function public.cierre_base_periodo(date, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Lo que falta por conciliar: solo lo que entraría (misma firma)
-- ---------------------------------------------------------------------------
create or replace function public.cierre_pendents_periodo(p_desde date, p_hasta date)
returns table(productor_id uuid, canalizaciones integer, kg numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta el que falta per conciliar'
      using errcode = '42501';
  end if;

  return query
  select e.productor_id, count(*)::int, coalesce(sum(c.kg_confirmados), 0)
    from canalizaciones c
    join excedentes e on e.id = c.excedente_id
    left join entidades en on en.id = c.entidad_id
   where public.motiu_exclusio_certificat(c.valorizacion, c.entidad_id, en.tipo_receptor) is null
     and c.estado in ('confirmada', 'entregada')
     and (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
            at time zone 'Europe/Madrid') >= p_desde::timestamp
     and (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
            at time zone 'Europe/Madrid') < (p_hasta + 1)::timestamp
   group by e.productor_id;
end;
$$;

revoke execute on function public.cierre_pendents_periodo(date, date) from public, anon;
grant  execute on function public.cierre_pendents_periodo(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Lo que se queda fuera, y por qué
-- ---------------------------------------------------------------------------
-- Con `p_excedente`, las fechas pueden ir a null (el ámbito oferta no elige ventana: es la
-- de la oferta). Sin oferta, las dos fechas son obligatorias. La fecha es la misma que usa
-- la ventana de `cierre_base_periodo()`.
drop function if exists public.cierre_exclosos_periodo(uuid, date, date, uuid, text);

create function public.cierre_exclosos_periodo(
  p_productor  uuid,
  p_desde      date,
  p_fins       date,
  p_excedente  uuid default null,
  p_modo       text default 'real')
returns table(canalizacion_id uuid, excedente_id uuid, id_excedente text, producto text,
              entidad_id uuid, entidad text, tipo_receptor text, valorizacion text,
              data date, kg numeric, motiu text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- El permiso antes que nada (§4bis): un uuid inventado da 42501 a quien no puede.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta el que queda fora d''un certificat'
      using errcode = '42501';
  end if;
  if p_modo is null or p_modo not in ('prueba', 'real') then
    raise exception 'Mode desconegut: %', p_modo using errcode = '22023';
  end if;
  if p_excedente is null and (p_desde is null or p_fins is null) then
    raise exception 'Cal un periode (des de i fins a) o una oferta' using errcode = '22023';
  end if;
  if p_desde is not null and p_fins is not null and p_desde > p_fins then
    raise exception 'El periode ha de tenir una data d''inici anterior o igual a la de fi'
      using errcode = '22023';
  end if;

  return query
  with base as (
    select c.id, c.excedente_id, e.id_excedente, e.producto, c.entidad_id,
           en.nombre as entidad_nom, en.tipo_receptor, c.valorizacion,
           c.kg_conciliados, c.conciliacion_retroactiva,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid') as fecha_local,
           public.motiu_exclusio_certificat(c.valorizacion, c.entidad_id, en.tipo_receptor)
             as motiu
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
      left join entidades en on en.id = c.entidad_id
     where e.productor_id = p_productor
       and c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and (p_excedente is null or c.excedente_id = p_excedente)
  )
  select b.id, b.excedente_id, b.id_excedente, b.producto, b.entidad_id, b.entidad_nom,
         b.tipo_receptor, b.valorizacion, b.fecha_local::date, b.kg_conciliados,
         coalesce(b.motiu,
                  case when p_modo = 'real' and b.conciliacion_retroactiva
                       then 'conciliacio_retroactiva' end)
    from base b
   where (p_desde is null or b.fecha_local >= p_desde::timestamp)
     and (p_fins  is null or b.fecha_local <  (p_fins + 1)::timestamp)
     and (b.motiu is not null or (p_modo = 'real' and b.conciliacion_retroactiva))
   order by b.fecha_local, b.id;
end;
$$;

comment on function public.cierre_exclosos_periodo(uuid, date, date, uuid, text) is
  'Canalizaciones conciliadas de un donante que NO entran en su certificado de donacion, con el motivo (venda, maquila, sense_entitat, sense_valoritzacio, entitat_no_social:<tipo>, conciliacio_retroactiva). Solo el equipo (20270509100000).';

revoke execute on function public.cierre_exclosos_periodo(uuid, date, date, uuid, text) from public, anon;
grant  execute on function public.cierre_exclosos_periodo(uuid, date, date, uuid, text) to authenticated, service_role;
