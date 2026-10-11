-- Fase 8 de la revisión del 08-10-2026: los indicadores del tablero, con periodo.
--
-- Hasta hoy el tablero agregaba en el cliente toda la tabla de ofertas y de canalizaciones,
-- sin fecha: «kg canalitzats» era el total de siempre. Ahora una RPC los da para el periodo
-- que se elija (año, mes o rango), con la fecha en hora de Madrid. `security invoker`, como
-- `pendents_equip()`: agrega solo lo que quien pregunta ya puede leer, y se niega a un externo.
create or replace function public.kpis_equip(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip veu els indicadors' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'periode_invalid' using errcode = '22023';
  end if;

  with ofertes as (
    select ex.*, (ex.created_at at time zone 'Europe/Madrid')::date as dia_alta
      from excedentes ex
  ), canals as (
    select c.*,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at) at time zone 'Europe/Madrid')::date as dia
      from canalizaciones c
     where c.estado <> 'anulada'
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    -- Kilos oficiales (conciliados, D13) con la recogida dentro del periodo.
    'kg_canalitzats', coalesce((select sum(coalesce(c.kg_conciliados, c.kg_reales, c.kg_confirmados))
                                  from canals c where c.estado = 'conciliada' and c.dia between p_desde and p_hasta), 0),
    -- Kilos asignados (aprobados) en el periodo, conciliados o no.
    'kg_assignats', coalesce((select sum(c.kg_confirmados) from canals c where c.dia between p_desde and p_hasta), 0),
    'canalitzacions', (select count(*) from canals c where c.dia between p_desde and p_hasta),
    'ofertes_noves', (select count(*) from ofertes o where o.dia_alta between p_desde and p_hasta),
    'kg_oferts', coalesce((select sum(o.kg_total) from ofertes o where o.dia_alta between p_desde and p_hasta), 0),
    -- Las de ahora, sin periodo: lo que está vivo hoy.
    'ofertes_actives', (select count(*) from ofertes o where o.estado in ('pendent_validacio', 'publicada', 'parcial', 'bloqueada')),
    'kg_pendents', coalesce((select sum(greatest(0, o.kg_total - coalesce((select sum(c.kg_confirmados) from canals c where c.excedente_id = o.id), 0)))
                               from ofertes o where o.estado in ('publicada', 'parcial')), 0),
    -- Las que acabaron sin salida en el periodo (por su fecha límite).
    'ofertes_sense_sortida', (select count(*) from ofertes o
                               where o.estado = 'no_colocada' and o.disponible_hasta between p_desde and p_hasta),
    'entitats_receptores', (select count(distinct c.entidad_id) from canals c where c.dia between p_desde and p_hasta)
  ) into v;
  return v;
end;
$$;
revoke execute on function public.kpis_equip(date, date) from public, anon;
grant execute on function public.kpis_equip(date, date) to authenticated;
