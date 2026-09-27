-- El productor del REC de una espigolada en `v_albaranes_bandeja` (28-09-2026).
--
-- La misma causa que `20270406100100` (el producto), vista en la columna de al lado: la
-- vista saca `productor_id` de la oferta, y el REC de una jornada de espigueo no cuelga de
-- ninguna. La bandeja del equipo pintaba «—» en «Contrapart» justo en el albarán cuyo
-- productor es lo único que importa. Sin oferta, sale de la jornada (`espigoladas`).
--
-- ⚠️ Mismo contrato que la migración anterior: se conservan nombre, orden y tipo de cada
--    columna, y la vista sigue siendo `security_invoker` (quien no vea la jornada verá null).

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
       coalesce(e.productor_id, es.productor_id) as productor_id,
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
  left join excedentes     e  on e.id  = a.excedente_id
  left join espigoladas    es on es.id = a.espigolada_id
  left join canalizaciones c  on c.id  = a.canalizacion_id
  left join lateral (
       select sum(kg_previstos)   as kg_previstos,
              sum(kg_neto)        as kg_neto,
              sum(kg_confirmados) as kg_confirmados,
              sum(kg_validados)   as kg_validados,
              string_agg(distinct producto, ', ' order by producto) as productes
         from albaran_lineas where albaran_id = a.id
  ) l on true;

comment on view v_albaranes_bandeja is
  'Un albarán por fila con sus kilos sumados y los días de espera. Sin oferta (REC de espigolada), el producto sale de sus líneas y el productor de la jornada. security_invoker: respeta la RLS de quien consulta.';
