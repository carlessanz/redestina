-- Los días de recogida de la oferta LIMITAN de verdad al receptor (proceso 3.2 del cliente; fase 4
-- del plan de noviembre de 2026).
--
-- `comprova_hora_recollida(ex, p_quan)` (20270412100000, sin redefiniciones posteriores) ya
-- rechazaba una hora pasada, fuera de la disponibilidad o fuera de la franja, pero no miraba
-- `excedentes.dies_recollida` (20270528100000): un receptor podía pedir un sábado en una oferta
-- que solo se recoge lunes y miércoles. Se añade:
--
--   22023 `dia_fora_dies: l'oferta nomes es recull els dies …`
--   cuando `ex.dies_recollida` no está vacío y el día ISO de la semana de `p_quan` EN MADRID
--   (1 = dilluns … 7 = diumenge, la numeración de la columna) no está en él.
--
-- SOLO para sesiones EXTERNAS (el receptor, nivel 2: `auth.uid() is not null and not
-- es_intern()`). El equipo (asigna o registra la realidad) y el servidor (`service_role`) no se
-- bloquean por días: la interfaz les avisa. Llamadores, para que conste:
--   · `comprova_interes()` es la única que la llama, y le llega `p_recollida` desde
--     `manifestar_interes` (la entidad: SE BLOQUEA), `manifestar_interes_assistit`,
--     `assignar_directe` y `proposar_canvis` (equipo: no se bloquea). `respondre_proposta` le pasa
--     `null` (la hora propuesta ya la eligió el equipo): no se comprueba.
--   · `aprova_resposta_intern`, `aprovar_resposta`, `modificar_assignacio` y
--     `registrar_recollida*` no la llaman: no cambian.
--
-- `create or replace` con la misma firma: conserva los GRANT (authenticated, service_role).

create or replace function public.comprova_hora_recollida(ex excedentes, p_quan timestamptz)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local timestamp := p_quan at time zone 'Europe/Madrid';
  v_noms  text[] := array['dilluns', 'dimarts', 'dimecres', 'dijous', 'divendres', 'dissabte', 'diumenge'];
begin
  if p_quan is null then return; end if;
  if p_quan < now() - interval '1 hour' then
    raise exception 'hora_passada: la recollida no pot ser en el passat' using errcode = '22023';
  end if;
  if ex.disponible_hasta is not null and v_local::date > ex.disponible_hasta then
    raise exception 'hora_fora_disponibilitat: l''oferta es disponible fins al %', ex.disponible_hasta
      using errcode = '22023';
  end if;
  -- 20270618100200: los días de recogida de la oferta, solo para el receptor.
  if cardinality(ex.dies_recollida) > 0
     and auth.uid() is not null and not public.es_intern()
     and not (extract(isodow from v_local)::smallint = any (ex.dies_recollida)) then
    raise exception 'dia_fora_dies: l''oferta nomes es recull els dies %',
      (select string_agg(v_noms[d], ', ' order by d)
         from (select distinct d::int as d from unnest(ex.dies_recollida) d where d between 1 and 7) x)
      using errcode = '22023';
  end if;
  if ex.hora_recollida_inici is not null and ex.hora_recollida_fi is not null
     and (v_local::time < ex.hora_recollida_inici or v_local::time > ex.hora_recollida_fi) then
    raise exception 'hora_fora_franja: la franja de recollida es de % a %',
      to_char(ex.hora_recollida_inici, 'HH24:MI'), to_char(ex.hora_recollida_fi, 'HH24:MI')
      using errcode = '22023';
  end if;
end;
$$;

comment on function public.comprova_hora_recollida(excedentes, timestamptz) is
  'Reglas de la hora de recogida (20270412100000; 20270618100200 dia_fora_dies): hora_passada, '
  'hora_fora_disponibilitat, dia_fora_dies (solo sesiones externas, si la oferta tiene dies_recollida) '
  'y hora_fora_franja. Todas 22023.';
