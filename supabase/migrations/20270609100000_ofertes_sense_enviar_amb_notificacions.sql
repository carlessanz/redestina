-- Fase 4 de los puntos 4-6 (19-11-2026): la cola «Ofertes sense enviar» de `pendents_equip()`
-- deja de avisar cuando las notificaciones están apagadas (`email_activo()` y `whatsapp_activo()`
-- falsos, que ya incluyen el interruptor general). Sin envío automático, una oferta publicada
-- siempre estaría «sin enviar» y el contador no diría nada útil.
--
-- Copia literal de la definición vigente (20270608100100, 19 colas) con ese único cambio.
-- `create or replace` con la misma firma y el mismo `returns table`: conserva los privilegios.

CREATE OR REPLACE FUNCTION public.pendents_equip()
 RETURNS TABLE(cua text, n integer, ref uuid, detall jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la cua de treball' using errcode = '42501';
  end if;

  return query
  with param as (
    select extract(year from (now() at time zone 'Europe/Madrid'))::int as any_curs,
           (now() at time zone 'Europe/Madrid')::date                   as avui
  ),
  tanc as (
    select ci.id, ci.ejercicio, ci.modo, ci.estado
      from cierres_ejercicio ci
     where ci.estado in ('obert', 'provisional')
     order by ci.abierto_at desc, ci.created_at desc
     limit 1
  ),
  -- Canalizaciones cuya recogida es ya trabajo del EQUIPO (20270427100000): no anuladas, sin
  -- registrar por el receptor, y con la recogida pasada o, sin hora acordada, con más de 2 días.
  canal_equip as (
    select c.id, c.excedente_id
      from canalizaciones c
     where c.estado <> 'anulada'
       and c.recollida_registrada_at is null
       and c.recollida_validada_at is null
       -- 20270428100000: una que un admin acaba de retornar espera otra vez al receptor.
       and (c.recollida_retornada_at is null or c.recollida_retornada_at < now() - interval '2 days')
       and (c.data_hora_recollida <= now()
            or (c.data_hora_recollida is null and c.created_at < now() - interval '2 days'))
  ),
  cues as (
    -- ⚠️ Las columnas del CTE NO se llaman `cua`, `n`, `ref` ni `detall` (parámetros OUT).
    select 1::numeric as ordre, 'registres'::text as clau,
           (select count(*) from membresias m where m.aprovacio = 'pendent')::int as quants,
           null::uuid as objecte, null::jsonb as extra
    union all
    select 2, 'convenis_contrasignar',
           (select count(*) from convenios cv where cv.estado = 'firmat')::int, null, null
    union all
    select 2.5, 'ofertes_per_validar',
           (select count(*) from excedentes e where e.estado = 'pendent_validacio')::int,
           null, null
    union all
    select 3, 'respostes',
           (select count(*) from oferta_respuestas r
             where r.estado = 'acceptada' and r.aprovacio = 'pendent')::int, null, null
    union all
    select 3.5, 'recollides_per_validar',
           (select count(*) from canalizaciones c
             where c.estado <> 'anulada'
               and c.recollida_registrada_at is not null
               and c.recollida_validada_at is null)::int, null, null
    union all
    select 3.7, 'signatures_per_tancar',
           (select count(*) from firmes_document f where f.estat = 'signat')::int, null, null
    union all
    select 4, 'missatges',
           (select coalesce(sum(ms.pendents), 0)::int from missatges_sense_contestar() ms),
           null, null
    union all
    -- 20270609100000: con las notificaciones apagadas (ningún canal efectivo) no hay envío
    -- automático que esperar, así que la cola no avisa: el equipo copia el mensaje a mano.
    select 5, 'ofertes_sense_enviar',
           (case when public.email_activo() or public.whatsapp_activo() then
             (select count(*) from excedentes e
               where e.estado = 'publicada'
                 and not exists (select 1 from oferta_respuestas r
                                  where r.excedente_id = e.id))
            else 0 end)::int, null, null
    union all
    select 5.5, 'ofertes_modificades',
           (select count(distinct x.excedente_id) from excedentes_canvis x
             where x.revisat_at is null
               and not exists (select 1 from usuario_roles ur where ur.user_id = x.user_id))::int,
           null, null
    union all
    select 6, 'ofertes_vencudes',
           (select count(*) from excedentes e, param p
             where (e.estado = 'no_colocada'
                    or (e.estado in ('publicada', 'parcial') and e.disponible_hasta < p.avui))
               and (select dx.kg_sense_desti from public.desti_excedent(e.id) dx) > 0)::int,
           null, null
    union all
    -- Borradores que son trabajo del equipo:
    --   (a) los de espigolada (los emite siempre el equipo);
    --   (b) ENT/OPE cuya canalización está en `canal_equip`;
    --   (c) el REC de una recogida (20270608100100) si su canalización está en `canal_equip`, y el
    --       REC heredado de una oferta si alguna de sus canalizaciones lo está;
    --   (d) cualquier otro borrador que no cuelgue ni de una canalización ni de una espigolada.
    select 7, 'albarans_esborrany',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
             where a.estado = 'borrador'
               and (
                 -- (a)
                 (a.tipo = 'REC' and a.espigolada_id is not null)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is not null)
                 -- (b)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is null
                     and a.canalizacion_id in (select ce.id from canal_equip ce))
                 -- (c)
                 or (a.tipo = 'REC' and a.canalizacion_id is not null
                     and a.canalizacion_id in (select ce.id from canal_equip ce))
                 or (a.tipo = 'REC' and a.canalizacion_id is null
                     and a.espigolada_id is null and a.excedente_id is not null
                     and exists (select 1 from canal_equip ce where ce.excedente_id = a.excedente_id))
                 -- (d)
                 or (a.tipo in ('ENT', 'OPE') and a.canalizacion_id is null
                     and coalesce(ex.espigolada_id is null, true))
                 or (a.tipo = 'REC' and a.espigolada_id is null and a.excedente_id is null)
               ))::int, null, null
    union all
    -- NUEVA (20270608100100, D). Ventas y maquilas cuya recogida ya es trabajo del equipo
    -- (`canal_equip`) y que NO tienen albarán: no salen en `albarans_esborrany` (no hay borrador)
    -- y sin esta cola nadie las contaba. Se cierran con «Registrar la recollida».
    select 7.5, 'recollides_equip',
           (select count(*) from canalizaciones c
             where c.id in (select ce.id from canal_equip ce)
               and c.valorizacion in ('venda', 'maquila')
               and c.estado <> 'conciliada'
               and not exists (select 1 from albaranes b
                                where b.canalizacion_id = c.id and b.tipo in ('ENT', 'OPE')
                                  and b.estado not in ('anulado', 'rectificado')))::int,
           null, null
    union all
    -- Lo que tiene que conciliar el equipo:
    --   · los REC entregados o confirmados;
    --   · los ENT/OPE confirmados SIN «su» REC vivo —el de su canalización (20270608100100) o el
    --     heredado de la oferta / de la jornada—;
    --   · los ENT/OPE confirmados con incidencia de recogida cuyo REC ya está conciliado.
    select 8, 'albarans_conciliar',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
              left join canalizaciones c on c.id = a.canalizacion_id
             where (a.tipo = 'REC' and a.estado in ('entregado', 'confirmado'))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    and not coalesce(c.recollida_registrada_at is not null
                                     and c.recollida_validada_at is null, false)
                    and not exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado not in ('anulado', 'rectificado')
                         and ((r.canalizacion_id is not null and r.canalizacion_id = a.canalizacion_id)
                           or (r.canalizacion_id is null
                               and (r.excedente_id = a.excedente_id
                                    or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id))))))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    and c.incidencia_recollida is not null
                    and c.recollida_validada_at is null
                    and c.recollida_registrada_at is null
                    -- ⚠️ Sin `albarans_germans_rec()` (interna; esta función es invoker).
                    and exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado = 'conciliado'
                         and ((r.canalizacion_id is not null and r.canalizacion_id = a.canalizacion_id)
                           or (r.canalizacion_id is null
                               and (r.excedente_id = a.excedente_id
                                    or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id)))))))::int,
           null, null
    union all
    select 9, 'albarans_esperant',
           (select count(*) from albaranes a where a.estado = 'entregado')::int, null, null
    union all
    select 10, 'costos',
           (select count(distinct e.producto)
              from canalizaciones c
              join excedentes e on e.id = c.excedente_id
              cross join param p
             where extract(year from (c.created_at at time zone 'Europe/Madrid'))::int
                   = p.any_curs
               and e.producto is not null
               and c.coste_kg is null
               and not exists (select 1 from costes_producto cp
                                where cp.producto = e.producto))::int, null, null
    union all
    select 11, 'tancament',
           (select count(*) from cierres_ejercicio ci
             where ci.estado in ('obert', 'provisional'))::int,
           (select t.id from tanc t),
           (select jsonb_build_object(
                     'ejercicio',   t.ejercicio,
                     'modo',        t.modo,
                     'estado',      t.estado,
                     'bloquejats',
                     (select count(*) from cierres_donante d
                       where d.cierre_id = t.id
                         and exists (
                           select 1
                             from jsonb_array_elements(
                                    case when jsonb_typeof(d.bloqueos) = 'array'
                                         then d.bloqueos else '[]'::jsonb end) b
                            where coalesce((b ->> 'bloqueja')::boolean, false))))
              from tanc t)
    union all
    select 12, 'documents_error',
           (select count(*) from documentos d where d.estado = 'error')::int, null, null
    union all
    select 13, 'espigolades_per_convertir',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and e.producte_al_camp
               and e.espigolada_id is null)::int, null, null
    union all
    select 14, 'preus',
           ((select count(*) from preus_carregues pc where pc.font = 'gencat' and pc.estat = 'pendent')
            + (select count(*) from preus_fonts_estat pf where pf.darrer_resultat = 'error'))::int,
           null, null
  )
  select q.clau, q.quants, q.objecte, q.extra from cues q order by q.ordre;
end;
$function$;
