-- El reparto del neto del REC pasa a hacerse por (albarán de recepción, producto).
-- Cierra la deuda §12.90.
--
-- EL DEFECTO, dicho con precisión: era una ASIMETRÍA dentro de la misma función. El
-- emparejamiento con el albarán de recepción ya se hacía por **(albarán, producto)** —el
-- `left join lateral` de la CTE `conrec`, que en una espigolada busca el REC de la
-- JORNADA y suma solo las líneas de ese producto—, pero el reparto proporcional del neto
-- se calculaba con ventanas `partition by excedente_id`. Los dos criterios no son el
-- mismo, y donde se separan es en el espigueo:
--
--   · Fuera del espigueo coinciden: el REC se empareja por `a.excedente_id =
--     o.excedente_id`, así que hay un REC por excedente y un producto por excedente.
--     Particionar por excedente o por (REC, producto) da exactamente lo mismo.
--   · En una espigolada NO coinciden: el REC cuelga de la jornada. Si una misma jornada
--     tuviera **dos registros del mismo producto**, los dos resuelven al mismo
--     `albaran_rec_id` y al mismo `rec_neto` —la misma línea del REC—, pero cada uno era
--     su propia partición de un elemento, así que **cada uno se llevaba el neto ENTERO**.
--     Los kilos se contaban dos veces, en un documento con efecto fiscal.
--
-- LA CLAVE CORRECTA ES `(coalesce(albaran_rec_id, excedente_id), producto)`, y las dos
-- mitades hacen falta:
--
--   · **El producto**, porque `rec_neto` es la suma de las líneas de ESE producto dentro
--     del albarán. Un REC de espigolada con dos productos tiene dos `rec_neto` distintos
--     bajo el mismo `albaran_rec_id`: particionar solo por el albarán mezclaría dos netos
--     en un mismo denominador, que es un error peor que el que se viene a arreglar.
--   · **El `coalesce`**, y no es higiene: cuando no hay REC conciliado que emparejar,
--     `rec_neto` y `albaran_rec_id` son los dos NULL, y en una ventana `partition by` los
--     NULL se agrupan JUNTOS. Sin el `coalesce`, todas las canalizaciones sin REC del
--     ejercicio entero caerían en una sola partición gigante. No cambiaría ningún
--     resultado —con `rec_neto is null` el reparto es la identidad (`kg_prop =
--     round(kg_conciliados, 2)`), `correccion` es 0 y `excedent_partit` es false— pero
--     sería un denominador enorme calculado para nada y una trampa esperando a que
--     alguien añada una rama que sí lo mire.
--
-- SON CUATRO SITIOS Y CAMBIAN LOS CUATRO O NINGUNO: el denominador `suma_can`, el
-- `row_number()` que decide a qué línea se le da el céntimo del residuo, la ventana de
-- `correccion` que calcula ese residuo y el `bool_or` de `excedent_partit`. Cambiar tres
-- de cuatro deja un reparto que no suma. Aquí la clave se calcula UNA VEZ en `conrec`
-- (`clau_repartiment`) y las cuatro ventanas la usan, que es lo que impide que vuelvan a
-- separarse.
--
-- LA INVARIANTE, que es lo que hay que comprobar después de tocar esto: para cada
-- **(albaran_rec_id, producto)** con `rec_neto` no nulo, y sobre una ventana que no parta
-- ese grupo (`excedent_partit = false`), la suma de `kg_neto` del resultado tiene que ser
-- **exactamente** `rec_neto` — ni un céntimo más ni uno menos. Eso es D13: lo que se
-- certifica es el neto conciliado del albarán de recepción, repartido entre las
-- canalizaciones para saber a qué entidades llegó, no una suma de pesadas sueltas. El
-- `select` de verificación del final la mide.
--
-- ⚠️ `excedent_partit` sigue llamándose así porque es una columna de salida y hay
--    consumidores (`calcular_certificado_periodo()` lo convierte en el bloqueo
--    `periode_parteix_excedent`), pero lo que ahora marca es más preciso: que la ventana
--    parte el **grupo de reparto**, que es lo que de verdad hace que la suma no cuadre.
--    Fuera del espigueo es la misma cosa.
--
-- POR QUÉ AHORA Y NO DENTRO DE UN AÑO: porque hoy sale gratis. Medido en producción el
-- 14-09-2026: **cero** jornadas con dos registros del mismo producto (de 1 registro de
-- espigolada que hay) y **cero** certificados emitidos (0 documentos de tipo CD o CT de
-- 15). O sea que no hay ningún número ya certificado que este cambio mueva, y los
-- documentos emitidos no se tocan igualmente —llevan su snapshot congelado en
-- `documentos.datos` y su `sha256_datos`—. Es el mismo argumento de la deuda §12.79: se
-- hace cuando no hay nada que migrar. El día que haya cientos de certificados, esto sería
-- una corrección de documentos con efecto fiscal.
--
-- ⚠️ ESTA MIGRACIÓN NO TOCA NADA MÁS. `cierre_base()`, `cierre_pendents()`,
--    `calcular_cierre()`, `calcular_certificado_periodo()` y `cierre_base_transaccion()`
--    siguen como están: los dos primeros son envoltorios de esta función y heredan el
--    arreglo sin una línea; los otros la consumen y no cambian de contrato, porque la
--    firma y las catorce columnas de salida son idénticas.
--
-- ⚠️ SE COPIA ENTERA LA GUARDA DE ROL de `20270303100500`. No es adorno: cerró una fuga
--    real —cualquier cuenta con sesión podía llamar a `cierre_base(2026)` y recibir la
--    donación de todos los donantes, fila a fila—. `create or replace` reescribe el
--    cuerpo entero, así que perderla aquí sería reabrirla. Y el idioma es
--    `auth.uid() is not null and not es_intern()`, nunca `es_intern()` a secas: con
--    `es_intern()` solo, `service_role` —que no tiene `auth.uid()`— se llevaría un 42501,
--    y quien llama a esto son `calcular_cierre()`, el job de fin de año y el fixture.
--
-- ⚠️ `create or replace` reescribe TODOS los atributos de la función, así que hay que
--    repetir `language plpgsql`, `stable`, `security definer` y el `search_path`. Los
--    privilegios sí se conservan, pero el `revoke`/`grant` se repite abajo para que el
--    fichero diga por sí solo quién la puede ejecutar.

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
    select o.*,
           r.albaran_id as albaran_rec_id,
           r.kg         as rec_neto,
           -- La clave del reparto (ver cabecera): el albarán de recepción cuando lo hay,
           -- y el excedente cuando no, para que los NULL no se junten todos.
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
           case when c.rec_neto is not null
                 and sum(c.kg_conciliados) over w > 0
                then round(c.kg_conciliados * c.rec_neto
                           / sum(c.kg_conciliados) over w, 2)
                else round(c.kg_conciliados, 2)
           end as kg_prop
      from conrec c
    window w as (partition by c.clau_repartiment, c.producto)
  ),
  ajustado as (
    -- El céntimo del redondeo se le da a la línea mayor del grupo, esté dentro o fuera
    -- de la ventana: es suya (20270303100000).
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
            and bool_or(not a.dins) over (partition by a.clau_repartiment, a.producto))
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
   where m.dins;
end;
$$;

comment on function public.cierre_base_periodo(date, date, text) is
  'Base de cálculo de una ventana de fechas (solo equipo). El neto del REC se reparte entre TODAS las canalizaciones de su (albarán, producto) y la fecha se filtra después.';

-- EXECUTE: `create or replace` conserva los privilegios, pero se repiten para que este
-- fichero diga por sí solo quién la puede ejecutar (§4bis).
revoke execute on function public.cierre_base_periodo(date, date, text) from public, anon;
grant  execute on function public.cierre_base_periodo(date, date, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verificación (con `service_role` o una cuenta del equipo)
-- ---------------------------------------------------------------------------
-- 1. LA INVARIANTE. Por cada (REC, producto) sin partir, el reparto tiene que ser
--    EXACTAMENTE el neto del albarán. La columna `dif` tiene que ser 0 en todas las filas:
--
--   select b.albaran_rec_id, a.numero, b.producto, count(*) as linies,
--          sum(b.kg_neto) as reparto, max(b.rec_neto) as neto,
--          round(sum(b.kg_neto) - max(b.rec_neto), 6) as dif,
--          bool_or(b.excedent_partit) as partit
--     from cierre_base_periodo('2026-01-01'::date, '2026-12-31'::date, 'prueba') b
--     left join albaranes a on a.id = b.albaran_rec_id
--    where b.rec_neto is not null
--    group by 1, 2, 3
--   having round(sum(b.kg_neto) - max(b.rec_neto), 6) <> 0;   -- 0 filas
--
-- 2. LA LÍNEA BASE medida en producción ANTES de esta migración, que tiene que seguir
--    dando lo mismo (no hay ninguna jornada con el producto repetido, así que el
--    resultado no debe moverse ni un gramo):
--
--      REC-2026-00001 → 3 líneas, reparto 1000,00 = neto 1000, dif 0, partit false
--      sin REC        → 1 línea,  reparto  118,00, neto NULL
--
-- 3. Y QUE EL ENVOLTORIO ANUAL SIGUE SIENDO EL MISMO:
--
--   select * from cierre_base(2026, 'prueba')
--   except all
--   select * from cierre_base_periodo('2026-01-01', '2026-12-31', 'prueba');   -- 0 filas
--
-- 4. Que sigue cortada para quien no es del equipo (con una sesión de productor, por
--    PostgREST): `select * from cierre_base(2026, 'prueba');` → 42501.
