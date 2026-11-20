-- La fecha de una recogida VALIDADA es la REAL (20-11-2026, hallado por `tests/e2e/circuit-tomaquet.e2e.ts`).
--
-- El problema: la receptora puede recoger ANTES de la hora prevista (la registra hoy, el equipo la valida
-- hoy). `validar_recollida()` emite el ENT y el REC con la fecha real (`recollida_real_at`), pero la
-- canalización se quedaba con la PREVISTA en `data_hora_recollida`, que es la fecha que usan los cierres,
-- los certificados, el 182, el impacto y Entrades i sortides. Resultado: el albarán decía 20-11 y el
-- certificado de la oferta 21-11, y no se podía emitir hasta mañana («El periode acaba el 2026-11-21 i
-- encara no ha acabat»). En un cambio de año, la misma donación caía en dos ejercicios distintos.
--
-- La regla: al VALIDAR la recogida (el acto en que nacen los números legales), `data_hora_recollida`
-- pasa a ser la real. Un solo punto —un trigger sobre el paso de `recollida_validada_at` de nulo a no
-- nulo—, así valen todos los caminos que validan (`validar_recollida`, el registro asistido del equipo,
-- la asignación en un acto). No es un cambio de hora que haya que avisar: el aviso `recollida_canviada`
-- se salta en ese acto. Lo ya validado no se toca (podría mover un certificado emitido).

create or replace function public.trg_canalizaciones_data_real()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.recollida_validada_at is null and new.recollida_validada_at is not null
     and new.recollida_real_at is not null
     and new.data_hora_recollida is distinct from new.recollida_real_at then
    new.data_hora_recollida := new.recollida_real_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_canalizaciones_data_real() from public, anon, authenticated;

drop trigger if exists canalizaciones_data_real on public.canalizaciones;
create trigger canalizaciones_data_real
  before update of recollida_validada_at on public.canalizaciones
  for each row execute function public.trg_canalizaciones_data_real();

-- El aviso de cambios: igual que antes, salvo que la fecha cambie en el acto de validar.
create or replace function public.trg_canalitzacio_avis_canvis()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  ex      excedentes;
  v_resp  uuid;
  v_ent   text;
  v_tipus text[] := '{}';
  v_t     text;
  v_par   jsonb;
begin
  if new.estado = 'anulada' then return new; end if;
  if old.data_hora_recollida is not null
     and new.data_hora_recollida is distinct from old.data_hora_recollida
     -- 20270613100000: validar la recogida fija la fecha REAL; no es un cambio que avisar.
     and not (old.recollida_validada_at is null and new.recollida_validada_at is not null) then
    v_tipus := array_append(v_tipus, 'recollida_canviada');
  end if;
  if old.kg_confirmados is not null
     and new.kg_confirmados is distinct from old.kg_confirmados then
    v_tipus := array_append(v_tipus, 'kg_assignats_canviats');
  end if;
  if cardinality(v_tipus) = 0 then
    return new;
  end if;

  select * into ex from excedentes where id = new.excedente_id;
  select r.id into v_resp from oferta_respuestas r where r.canalizacion_id = new.id limit 1;
  select e.nombre into v_ent from entidades e where e.id = new.entidad_id;
  v_par := jsonb_build_object(
    'producte', ex.producto, 'kg', new.kg_confirmados, 'kg_abans', old.kg_confirmados,
    'recollida_at', new.data_hora_recollida, 'entitat', v_ent, 'excedente_id', ex.id);

  foreach v_t in array v_tipus loop
    perform public.crear_avis('entidad', new.entidad_id, v_t,
      case when v_resp is null then 'canalizacion' else 'oferta_resposta' end,
      coalesce(v_resp, new.id), v_par);
    perform public.crear_avis('productor', ex.productor_id, v_t, 'excedente', ex.id, v_par);
  end loop;
  return new;
end;
$function$;
