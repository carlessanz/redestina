-- La base de cálculo del cierre, por VENTANA DE FECHAS en vez de por año natural.
--
-- POR QUÉ. Hoy un certificado de donación solo se puede emitir sobre el cierre anual: el
-- periodo está cableado al año (`20261109100100`, `cierre_base()` filtra
-- `extract(year …) = ejercicio` y el snapshot escribe `YYYY-01-01`/`YYYY-12-31`). El
-- administrador tiene que poder certificar **a fecha de hoy**, o a una fecha de corte
-- dada, en cualquier momento del año. Esta migración es el cimiento de eso y no añade
-- ninguna funcionalidad por sí sola.
--
-- UNA SOLA DEFINICIÓN DE «QUÉ ENTRA EN UN CIERRE». `cierre_base(ejercicio, modo)` pasa a
-- ser un **envoltorio** de `cierre_base_periodo(1 de enero, 31 de diciembre, modo)`, y lo
-- mismo `cierre_pendents(ejercicio)`. Dos implementaciones de la misma regla habrían
-- divergido a la primera corrección, y la cifra que divergiera sería la de un documento
-- con efecto fiscal.
--
-- 🔴 Y EL ARREGLO QUE OBLIGA A HACER TODO ESTO: **el reparto del neto del REC estaba mal
--    para cualquier ventana que no fuera el año entero.** D13 manda certificar el neto
--    conciliado del albarán de recepción, y como las líneas del cierre son por
--    canalización, ese neto se reparte en proporción a los kilos de cada una. El reparto
--    se calculaba con una ventana `partition by excedente_id` **sobre las filas que ya
--    habían pasado el filtro de fecha**, así que si un corte parte un excedente por la
--    mitad, el 100 % del neto del REC se atribuye a las canalizaciones visibles: los
--    kilos salen INFLADOS, no incompletos. Con el año natural casi nunca se notaba
--    —un excedente rara vez cruza el 31 de diciembre—; con una ventana arbitraria sería
--    el caso normal.
--
--    Ahora el denominador y el residuo del redondeo se calculan sobre **todas** las
--    canalizaciones conciliadas del excedente, y el filtro de fecha se aplica **después**.
--    Consecuencia deliberada: la suma de las líneas visibles ya **no** tiene por qué ser
--    el neto entero del REC —será su parte—, y si la línea mayor cae fuera de la ventana,
--    el céntimo del residuo se queda con ella. Es lo correcto: ese céntimo es suyo.
--
--    Como red, `cierre_base_periodo()` devuelve además `excedent_partit`: qué líneas
--    pertenecen a un excedente que la ventana parte. Quien certifica un periodo lo
--    convierte en el bloqueo `periode_parteix_excedent` (20270303100300). Un reparto
--    correcto sigue siendo un reparto, y repartir un albarán entre dos certificados es
--    una decisión de negocio, no un detalle de cálculo.
--
-- ⚠️ LO QUE ESTO **NO** ARREGLA, y conviene tenerlo escrito: la partición sigue siendo por
--    `excedente_id`. En una espigolada el REC cuelga de la jornada y se empareja por
--    producto, así que si una misma jornada tuviera **dos registros del mismo producto**,
--    los dos recibirían el neto de esa línea del REC y los kilos se contarían dos veces.
--    No se toca aquí porque cambiar la clave de partición altera el cierre anual, que es
--    otra decisión; queda anotado como deuda.

-- ---------------------------------------------------------------------------
-- 1. cierre_base_periodo(): la base de cálculo de una ventana
-- ---------------------------------------------------------------------------
-- Pura, sin efectos. Mismos criterios que la anual: donación · conciliada · fecha de
-- recogida dentro de la ventana EN HORA DE MADRID, con el respaldo de siempre
-- (`data_hora_recollida` → `conciliada_at` → `created_at`, deuda §12.69).
--
-- La ventana es **cerrada por los dos lados**: `p_hasta` entra entera (hasta las 23:59:59
-- de Madrid de ese día).
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
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ops as (
    -- ⚠️ SIN filtro de fecha. Es el arreglo: el universo del reparto son todas las
    --    canalizaciones conciliadas del excedente, entren o no en la ventana.
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
       -- La conciliación retroactiva (sin albaranes) NO cuenta en un cierre real.
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  -- El REC del que salen los kilos. En una espigolada cuelga de la jornada y lleva una
  -- línea por producto, así que se empareja además por producto; en un registro normal
  -- cuelga del propio registro.
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
           -- El residuo del redondeo va ENTERO a la línea mayor del excedente, esté
           -- dentro o fuera de la ventana. Sobre el año entero, la suma de las líneas
           -- sigue siendo EXACTAMENTE el neto del REC.
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
$$;

comment on function public.cierre_base_periodo(date, date, text) is
  'Base de cálculo de una ventana de fechas: donaciones conciliadas, con el neto del REC repartido entre TODAS las canalizaciones del excedente y filtrado después.';

-- ---------------------------------------------------------------------------
-- 2. cierre_base(): el año natural, como envoltorio
-- ---------------------------------------------------------------------------
-- Misma firma y mismas columnas que antes (`excedent_partit` no sale: el cierre anual no
-- bloquea por eso —las canalizaciones de 2026 que ya existen cruzarían el 31 de diciembre
-- y el ensayo sería inejecutable—; el aviso vive en el certificado a demanda).
create or replace function public.cierre_base(p_ejercicio int, p_modo text default 'prueba')
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
  valor           numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.canalizacion_id, b.excedente_id, b.entidad_id, b.productor_id, b.producto,
         b.mes, b.kg_conciliados, b.coste_kg, b.retroactiva, b.albaran_rec_id,
         b.rec_neto, b.kg_neto, b.valor
    from public.cierre_base_periodo(
           make_date(p_ejercicio, 1, 1), make_date(p_ejercicio, 12, 31), p_modo) b;
$$;

comment on function public.cierre_base(int, text) is
  'Base de cálculo del cierre anual (§3.5.1). Envoltorio de cierre_base_periodo() sobre el año natural.';

-- ---------------------------------------------------------------------------
-- 3. cierre_pendents_periodo(): lo que falta por conciliar EN LA VENTANA
-- ---------------------------------------------------------------------------
-- Es el impedimento práctico que desbloquea la emisión bajo demanda: `sense_conciliar`
-- mirando el año entero bloquearía **siempre** a mitad de año, porque a mitad de año
-- casi siempre hay algo sin conciliar. Evaluado sobre el periodo certificado, sigue
-- siendo la garantía «nada sin conciliar» y además dice la verdad.
create or replace function public.cierre_pendents_periodo(p_desde date, p_hasta date)
returns table (productor_id uuid, canalizaciones int, kg numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
$$;

comment on function public.cierre_pendents_periodo(date, date) is
  'Donaciones de la ventana que siguen sin conciliar. Cada una bloquea el certificado de su donante.';

create or replace function public.cierre_pendents(p_ejercicio int)
returns table (productor_id uuid, canalizaciones int, kg numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.productor_id, p.canalizaciones, p.kg
    from public.cierre_pendents_periodo(
           make_date(p_ejercicio, 1, 1), make_date(p_ejercicio, 12, 31)) p;
$$;

comment on function public.cierre_pendents(int) is
  'Canalizaciones de donación del ejercicio sin conciliar. Envoltorio de cierre_pendents_periodo().';

-- ---------------------------------------------------------------------------
-- 4. EXECUTE: quitar el PUBLIC por defecto
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Las dos nuevas son de consulta y no
--    devuelven nada que el equipo no vea ya por la RLS de `canalizaciones`; las llama el
--    panel para enseñar la previsión antes de certificar.
do $$
declare f text;
begin
  foreach f in array array[
    'cierre_base_periodo(date,date,text)',
    'cierre_pendents_periodo(date,date)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- `cierre_base` y `cierre_pendents` se recrean con `create or replace`: conservan los
-- privilegios que ya tenían (20261109100100).

-- Verificación:
--   select * from cierre_base_periodo('2026-01-01','2026-12-31','prueba');
--   -- lo mismo que:
--   select * from cierre_base(2026,'prueba');
--   -- y una ventana que parta un excedente marca excedent_partit y NO infla los kilos:
--   select excedent_partit, sum(kg_neto) from cierre_base_periodo('2026-09-01','2026-09-10','prueba')
--    group by 1;
