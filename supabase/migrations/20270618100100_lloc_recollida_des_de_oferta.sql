-- Los días y franjas de recogida del LUGAR se rellenan desde la oferta (proceso 3.2 del
-- cliente; fase 4 del plan de noviembre de 2026).
--
-- Criterio del cliente: los días y horarios de recogida son configuración de cada lugar
-- (`productor_ubicaciones.dies_setmana`, `franges`, A4 20270521100000), se reutilizan en las
-- ofertas siguientes y limitan las opciones de recogida. Muchos lugares nacieron sin ellos (el
-- ARA no los trae, el mini-formulario del alta no los pedía). Así que, cuando una oferta sale del
-- borrador con días o franja propios y su lugar no los tiene, el lugar los HEREDA:
--
--   · `dies_setmana` vacío (null o `{}`) ← `excedentes.dies_recollida` (no vacío). Misma
--     numeración en las dos columnas: ISO, 1 = dilluns … 7 = diumenge (checks de 20270521100000 y
--     20270528100000); solo cambia el tipo (`smallint[]` → `int[]`), ordenado y sin repetidos.
--   · `franges` vacío (null o `[]`) ← `[{inici, fi}]` con `hora_recollida_inici/fi` de la oferta
--     en `HH:MM` (el formato que valida `franges_valides()` y escribe `LlocsRecollida.tsx`). Solo
--     si están las dos horas y el inicio es anterior al final (si no, la franja no sería válida y
--     no se escribe; los días sí).
--
-- RELLENA HUECOS, NUNCA PISA: un lugar con días conserva sus días aunque la oferta traiga otros;
-- ídem con las franjas. Nunca toca un lugar de otro productor (la oferta solo copia en un lugar
-- suyo).
--
-- Cuándo (trigger AFTER `excedentes_lloc_des_de_oferta`):
--   · INSERT con `estado` publicada · pendent_validacio · parcial;
--   · UPDATE de `estado`, `ubicacion_id`, `dies_recollida`, `hora_recollida_inici/fi` cuando la
--     oferta queda en uno de esos estados y algo de eso cambió (publicar un esborrany, validar,
--     cambiar el lugar o los días en la edición). En `esborrany`, `borrador` (jornada heredada) y
--     los estados de cierre, nunca.
--
-- `security definer` (quien publica —el servidor, el equipo al validar, `editar_oferta`— no tiene
-- por qué poder escribir el lugar), `set search_path`, sin EXECUTE para nadie (es de trigger).

create or replace function public.trg_excedentes_lloc_des_de_oferta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dies    int[];
  v_franges jsonb;
begin
  if new.ubicacion_id is null
     or new.estado not in ('publicada', 'pendent_validacio', 'parcial') then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.estado is not distinct from old.estado
     and new.ubicacion_id is not distinct from old.ubicacion_id
     and new.dies_recollida is not distinct from old.dies_recollida
     and new.hora_recollida_inici is not distinct from old.hora_recollida_inici
     and new.hora_recollida_fi is not distinct from old.hora_recollida_fi then
    return null;
  end if;

  if cardinality(new.dies_recollida) > 0 then
    select array_agg(distinct d::int order by d::int) into v_dies
      from unnest(new.dies_recollida) d
     where d between 1 and 7;
  end if;
  if new.hora_recollida_inici is not null and new.hora_recollida_fi is not null
     and new.hora_recollida_inici < new.hora_recollida_fi
     -- `franges_valides` exige `inici < fi` también en `HH:MM` (09:00:30 → 09:00 podría igualar).
     and to_char(new.hora_recollida_inici, 'HH24:MI') < to_char(new.hora_recollida_fi, 'HH24:MI') then
    v_franges := jsonb_build_array(jsonb_build_object(
                   'inici', to_char(new.hora_recollida_inici, 'HH24:MI'),
                   'fi',    to_char(new.hora_recollida_fi, 'HH24:MI')));
  end if;
  if v_dies is null and v_franges is null then
    return null;
  end if;

  update productor_ubicaciones u
     set dies_setmana = case when cardinality(u.dies_setmana) > 0 or v_dies is null
                             then u.dies_setmana else v_dies end,
         franges      = case when coalesce(jsonb_array_length(u.franges), 0) > 0 or v_franges is null
                             then u.franges else v_franges end
   where u.id = new.ubicacion_id
     and u.productor_id = new.productor_id
     and ((v_dies is not null and coalesce(cardinality(u.dies_setmana), 0) = 0)
          or (v_franges is not null and coalesce(jsonb_array_length(u.franges), 0) = 0));
  return null;
end;
$$;
revoke execute on function public.trg_excedentes_lloc_des_de_oferta() from public, anon, authenticated;

comment on function public.trg_excedentes_lloc_des_de_oferta() is
  'Trigger (20270618100100): al publicar o validar una oferta (o cambiar su lugar, días o franja), '
  'copia dies_recollida y la franja hora_recollida_inici/fi a su lugar SOLO si el lugar no los tiene. '
  'Rellena huecos, nunca pisa.';

drop trigger if exists excedentes_lloc_des_de_oferta on public.excedentes;
create trigger excedentes_lloc_des_de_oferta
  after insert or update of estado, ubicacion_id, dies_recollida, hora_recollida_inici, hora_recollida_fi
  on public.excedentes
  for each row execute function public.trg_excedentes_lloc_des_de_oferta();
