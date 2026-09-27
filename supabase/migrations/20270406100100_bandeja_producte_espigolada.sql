-- El producto del REC de una espigolada en `v_albaranes_bandeja` (28-09-2026).
--
-- EL DEFECTO. La vista saca `producto` de la oferta (`excedentes`), y el REC de una jornada
-- de espigueo NO cuelga de ninguna: cuelga de `espigolada_id`, con una línea por producto
-- (`crear_espigolada()`). Así que su fila salía con el producto a null, y la bandeja del
-- equipo y «Els meus albarans de recepció» del productor pintaban «—».
--
-- EL ARREGLO. Sin oferta, el producto sale de las líneas del propio albarán —los productos
-- distintos, en orden alfabético y separados por coma—. Con oferta, lo de siempre.
--
-- ⚠️ `create or replace view` exige conservar nombre, orden y tipo de cada columna: aquí
--    solo cambia la EXPRESIÓN de `producto` (sigue siendo text). La vista sigue siendo
--    `security_invoker`, así que las líneas se leen con la RLS de quien consulta: quien no
--    vea las líneas de un albarán verá «—», como hasta ahora.

create or replace view v_albaranes_bandeja
with (security_invoker = true) as
select a.id,
       a.tipo,
       a.numero_completo,
       a.estado,
       a.ejercicio,
       a.excedente_id,
       a.espigolada_id,
       a.canalizacion_id,
       e.id_excedente,
       coalesce(e.producto, l.productes) as producto,
       e.productor_id,
       c.entidad_id,
       c.codigo_lote,
       a.emitido_at,
       a.entregado_at,
       a.confirmado_at,
       a.conciliado_at,
       a.rechazo,
       l.kg_previstos,
       l.kg_neto,
       l.kg_confirmados,
       l.kg_validados,
       -- Días desde que salió el enlace de confirmación. Es lo que ordena la pestaña
       -- «Confirmacions pendents» y lo que compara la RPC con el plazo del parámetro.
       case when a.entregado_at is not null and a.confirmado_at is null
            then extract(day from (now() - a.entregado_at))::int
       end as dias_esperando
  from albaranes a
  left join excedentes     e on e.id = a.excedente_id
  left join canalizaciones c on c.id = a.canalizacion_id
  left join lateral (
       select sum(kg_previstos)   as kg_previstos,
              sum(kg_neto)        as kg_neto,
              sum(kg_confirmados) as kg_confirmados,
              sum(kg_validados)   as kg_validados,
              string_agg(distinct producto, ', ' order by producto) as productes
         from albaran_lineas where albaran_id = a.id
  ) l on true;

comment on view v_albaranes_bandeja is
  'Un albarán por fila con sus kilos sumados y los días de espera. Sin oferta (REC de espigolada), el producto sale de sus líneas. security_invoker: respeta la RLS de quien consulta.';
