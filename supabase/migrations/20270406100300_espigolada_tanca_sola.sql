-- La espigolada se cierra sola cuando está todo repartido (28-09-2026).
--
-- EL DEFECTO. `espigoladas.estado` admite `oberta` y `tancada` desde `20261012100200`, pero
-- nada escribía nunca `tancada`: una jornada repartida y conciliada entera seguía
-- «Oberta» para siempre, y ninguna pantalla la cerraba. Decisión del cliente: que se
-- cierre sola al repartir el último kilo.
--
-- «TODO REPARTIDO» = cada registro de la jornada (`excedentes.espigolada_id`) tiene
-- canalizaciones que suman al menos su `kg_total`, contando `kg_confirmados`: es la misma
-- cuenta que enseña la ficha («1.000 kg · repartits 1.000 · queden 0»). Una jornada sin
-- ningún registro no se cierra.
--
-- POR TRIGGER Y NO DENTRO DE `repartir_espigolada()`: las canalizaciones se crean y se
-- tocan desde más de un camino (el reparto, los atajos de `OfferDetail`, deuda 109), y el
-- estado tiene que seguir a los kilos venga el cambio de donde venga. Por lo mismo es
-- SIMÉTRICO: si una entrega se borra o baja de kilos y vuelven a quedar kilos, la jornada
-- se reabre — `repartir_espigolada()` solo admite jornadas `oberta`, así que cerrada no
-- habría forma de repartir lo que queda.
--
-- `security definer`: `espigoladas` no tiene GRANT de escritura para nadie (todo por RPC),
-- y el trigger corre con los privilegios de quien toca la canalización.

create or replace function public.recalcula_estat_espigolada(p_espigolada uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registres int;
  v_pendents  int;
  v_estat     text;
begin
  if p_espigolada is null then return; end if;

  select count(*),
         count(*) filter (where coalesce((
           select sum(c.kg_confirmados) from canalizaciones c where c.excedente_id = e.id
         ), 0) < coalesce(e.kg_total, 0))
    into v_registres, v_pendents
    from excedentes e
   where e.espigolada_id = p_espigolada;

  if v_registres = 0 then return; end if;
  v_estat := case when v_pendents = 0 then 'tancada' else 'oberta' end;

  update espigoladas set estado = v_estat
   where id = p_espigolada and estado is distinct from v_estat;
end;
$$;

comment on function public.recalcula_estat_espigolada(uuid) is
  'Cierra la espigolada si todos sus registros están repartidos (kg_confirmados >= kg_total) y la reabre si vuelve a quedar algo. La llama el trigger de canalizaciones.';

revoke execute on function public.recalcula_estat_espigolada(uuid) from public, anon, authenticated;
grant  execute on function public.recalcula_estat_espigolada(uuid) to service_role;

create or replace function public.trg_canalizaciones_estat_espigolada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- La jornada de la canalización nueva y, si cambió de excedente o se borró, la de antes.
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalcula_estat_espigolada(
      (select espigolada_id from excedentes where id = new.excedente_id));
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    if tg_op = 'DELETE' or old.excedente_id is distinct from new.excedente_id then
      perform public.recalcula_estat_espigolada(
        (select espigolada_id from excedentes where id = old.excedente_id));
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists canalizaciones_estat_espigolada on canalizaciones;
create trigger canalizaciones_estat_espigolada
  after insert or delete or update of kg_confirmados, excedente_id on canalizaciones
  for each row execute function public.trg_canalizaciones_estat_espigolada();

-- Las jornadas que ya existen, al día.
select public.recalcula_estat_espigolada(id) from espigoladas;
