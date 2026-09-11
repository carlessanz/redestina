-- 🔴 La base de cálculo del cierre la podía leer CUALQUIER cuenta con sesión.
--
-- QUÉ PASABA. `cierre_base(ejercicio, modo)` y `cierre_pendents(ejercicio)` son
-- `security definer` —tienen que serlo: cruzan `canalizaciones`, `excedentes` y
-- `albaranes` sin que la RLS de cada una vuelva a filtrar— y desde `20261109100100` tienen
-- `grant execute … to authenticated`. Lo que NO tenían es una comprobación de rol por
-- dentro, al revés que sus vecinas `datos_182()` y `comparar_cierre_prueba()`. O sea que
-- un productor o una entidad con sesión podía llamar a `cierre_base(2026)` por PostgREST y
-- recibir **la donación de todos los donantes**: productor, producto, kilos conciliados y
-- coste por kilo, fila a fila.
--
-- No estaba en ninguna lista de deuda y el arnés no lo miraba —comprobaba `datos_182` y
-- daba por hecho el resto de la familia—. Se encontró al añadir `cierre_base_periodo()`,
-- que habría heredado exactamente el mismo agujero.
--
-- EL ARREGLO, en un solo sitio: la comprobación va en las dos funciones **de periodo**,
-- que desde 20270303100000 son la implementación única; `cierre_base()` y
-- `cierre_pendents()` son envoltorios suyos y la heredan sin tocarlas.
--
-- ⚠️ EL IDIOMA ES `auth.uid() is not null and not es_intern()`, no `es_intern()` a secas.
--    Con `es_intern()` solo, una llamada con `service_role` —que no tiene `auth.uid()`—
--    se llevaría un 42501, y quien llama a esto son `calcular_cierre()`, el job de fin de
--    año y `crear-datos-documentales-prueba.ts`. Es el mismo error que ya mordió en
--    `datos_182()`, donde devolvía cero filas en silencio (§4bis).
--
-- Y pasan a `plpgsql` porque una función `language sql` no puede levantar una excepción
-- condicional. `create or replace` admite el cambio de lenguaje mientras la firma y el
-- tipo de retorno no cambien, y no cambian.

create or replace function public.cierre_base_periodo(
  p_desde date,
  p_hasta date,
  p_modo  text default 'prueba'
)
returns table (
  canalizacion_id uuid,
  excedente_id    uuid,
  entidad_id      uuid,
  productor_id    uuid,
  producto        text,
  mes             int,
  kg_conciliados  numeric,
  coste_kg        numeric,
  retroactiva     boolean,
  albaran_rec_id  uuid,
  rec_neto        numeric,
  kg_neto         numeric,
  valor           numeric,
  excedent_partit boolean
)
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
    -- ⚠️ SIN filtro de fecha. El universo del reparto son todas las canalizaciones
    --    conciliadas del excedente, entren o no en la ventana (20270303100000).
    select c.id as canalizacion_id, c.excedente_id, c.entidad_id,
           e.productor_id, e.producto, e.espigolada_id,
           c.kg_conciliados, c.coste_kg,
           c.conciliacion_retroactiva as retroactiva,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid') as fecha_local
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
     where c.valorizacion = 'donacio'
       and c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  conrec as (
    select o.*, r.albaran_id as albaran_rec_id, r.kg as rec_neto
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
           sum(c.kg_conciliados) over (partition by c.excedente_id) as suma_can,
           row_number() over (partition by c.excedente_id
                              order by c.kg_conciliados desc, c.canalizacion_id) as rn,
           case when c.rec_neto is not null
                 and sum(c.kg_conciliados) over (partition by c.excedente_id) > 0
                then round(c.kg_conciliados * c.rec_neto
                           / sum(c.kg_conciliados) over (partition by c.excedente_id), 2)
                else round(c.kg_conciliados, 2)
           end as kg_prop
      from conrec c
  ),
  ajustado as (
    select r.*,
           case when r.rn = 1 and r.rec_neto is not null and r.suma_can > 0
                then round(r.rec_neto, 2) - sum(r.kg_prop) over (partition by r.excedente_id)
                else 0
           end as correccion
      from repartido r
  ),
  marcado as (
    select a.*,
           (a.rec_neto is not null
            and bool_or(not a.dins) over (partition by a.excedente_id)) as excedent_partit
      from ajustado a
  )
  select m.canalizacion_id, m.excedente_id, m.entidad_id, m.productor_id, m.producto,
         extract(month from m.fecha_local)::int as mes,
         m.kg_conciliados, m.coste_kg, m.retroactiva, m.albaran_rec_id, m.rec_neto,
         (m.kg_prop + m.correccion)::numeric as kg_neto,
         round((m.kg_prop + m.correccion) * coalesce(m.coste_kg, 0), 2) as valor,
         m.excedent_partit
    from marcado m
   where m.dins;
end;
$$;

comment on function public.cierre_base_periodo(date, date, text) is
  'Base de cálculo de una ventana de fechas (solo equipo). El neto del REC se reparte entre TODAS las canalizaciones del excedente y se filtra después.';

create or replace function public.cierre_pendents_periodo(p_desde date, p_hasta date)
returns table (productor_id uuid, canalizaciones int, kg numeric)
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
   where c.valorizacion = 'donacio'
     and c.estado in ('confirmada', 'entregada')
     and (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
            at time zone 'Europe/Madrid') >= p_desde::timestamp
     and (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
            at time zone 'Europe/Madrid') < (p_hasta + 1)::timestamp
   group by e.productor_id;
end;
$$;

comment on function public.cierre_pendents_periodo(date, date) is
  'Donaciones de la ventana sin conciliar (solo equipo). Cada una bloquea el certificado de su donante.';

-- Verificación (con una sesión de productor, por PostgREST):
--   select * from cierre_base(2026, 'prueba');      -- 42501
--   select * from cierre_pendents(2026);            -- 42501
-- y con service_role o una cuenta del equipo, las filas de siempre.
