-- Ofertas multiproducto (proceso 3.3; fase 6 del plan de noviembre de 2026), 7 de 7: RECOGIDA
-- REAL conjunta (entrega 6c).
--
-- Cada canalización de la solicitud se sigue registrando, validando y documentando POR SEPARADO
-- (su ENT y su REC por recogida, `validar_recollida` y el trigger de albaranes sin cambios). Estas
-- dos RPC solo recorren las líneas en una transacción (todo o nada):
--
--   · `registrar_recollida_multiple(p_sollicitud, p_linies, p_quan, p_motiu)`:
--       - la ENTIDAD de la solicitud → por línea `registrar_recollida()` (solo declara; la valida
--         el equipo después, una a una o con «Valida totes»);
--       - el EQUIPO (`pot_aprovar()`) → por línea `registrar_recollida_assistida()` (registra y
--         valida en un acto, como hoy el nivel 1);
--       - `resultat = 'no_recollit'` → la canalización se ANULA con motivo (la entidad, por la
--         interna `anula_canalitzacio()` sobre lo suyo; el equipo, por `anular_assignacio()`): se
--         liberan los kg, sus albaranes vivos se anulan y se avisa como en cualquier anulación.
--     Se puede registrar solo una parte de las líneas (lo recogido se cierra aunque otra quede
--     pendiente).
--     `p_linies = [{canalizacion_id, resultat, kg_reals?, observacions?, motiu?, foto?}]`, con
--     `resultat` ∈ `coincideix` · `inferior` (= `menys`) · `superior` (= `mes`) · `menys` · `mes`
--     · `no_recollit`. `p_quan` = cuándo se recogió (null = ahora), común a todas las líneas.
--   · `validar_recollides_sollicitud(p_sollicitud, p_motiu)` (`pot_aprovar()`): «Valida totes»;
--     `validar_recollida()` de cada canalización de la solicitud ya declarada y sin validar.
--
-- Errores: `42501` sin sesión, solicitud ajena (permiso ANTES que existencia: un uuid inventado da
-- 42501 a quien no es del equipo) o no es del equipo; `22023` `sollicitud_inexistent`,
-- `cal_linies`, `linia_invalida`, `linia_fora_sollicitud`, `linia_duplicada`, `resultat_invalid`,
-- y los de las puertas reutilizadas con su código y mensaje intactos (`ja_registrada`,
-- `kg_no_coincideixen`, `falta_motiu_diferencia`, `cal_motiu`, `canalitzacio_anulada`,
-- `ja_validada`…), con `detail = {"linia": n, "canalizacion_id": "…"}`.

create or replace function public.registrar_recollida_multiple(
  p_sollicitud uuid,
  p_linies     jsonb,
  p_quan       timestamptz default null,
  p_motiu      text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  s        sollicituds_recollida;
  v_equip  boolean;
  v_item   jsonb;
  v_ord    bigint;
  v_can    uuid;
  v_vistos uuid[] := '{}';
  v_resu   text;
  v_mot    text;
  v_obs    text;
  v_r      jsonb;
  v_res    jsonb := '[]'::jsonb;
  v_state  text;
  v_msg    text;
begin
  if v_user is null then
    raise exception 'Cal una sessio' using errcode = '42501';
  end if;
  select * into s from sollicituds_recollida where id = p_sollicitud;
  v_equip := public.pot_aprovar();
  if not v_equip and (s.id is null or s.entidad_id not in (select public.mis_entidades())) then
    raise exception 'Nomes l''entitat receptora pot registrar aquesta recollida' using errcode = '42501';
  end if;
  if s.id is null then
    raise exception 'sollicitud_inexistent' using errcode = '22023';
  end if;
  perform public.comprova_linies_multiple(p_linies);

  -- Validación de las líneas antes de escribir nada.
  for v_item, v_ord in select e, o from jsonb_array_elements(p_linies) with ordinality as t(e, o) loop
    v_can := public.uuid_de_linia(v_item, 'canalizacion_id');
    if v_can is null or not exists (select 1 from canalizaciones c
                                     where c.id = v_can and c.sollicitud_id = p_sollicitud) then
      raise exception 'linia_fora_sollicitud' using errcode = '22023',
        detail = jsonb_build_object('linia', v_ord, 'canalizacion_id', v_can)::text;
    end if;
    if v_can = any (v_vistos) then
      raise exception 'linia_duplicada' using errcode = '22023',
        detail = jsonb_build_object('linia', v_ord, 'canalizacion_id', v_can)::text;
    end if;
    v_vistos := v_vistos || v_can;
    if coalesce(v_item->>'resultat', '') not in
       ('coincideix', 'inferior', 'superior', 'menys', 'mes', 'no_recollit') then
      raise exception 'resultat_invalid' using errcode = '22023',
        detail = jsonb_build_object('linia', v_ord, 'canalizacion_id', v_can)::text;
    end if;
  end loop;

  for v_item, v_ord in select e, o from jsonb_array_elements(p_linies) with ordinality as t(e, o) loop
    v_can  := (v_item->>'canalizacion_id')::uuid;
    v_resu := case v_item->>'resultat' when 'inferior' then 'menys' when 'superior' then 'mes'
                   else v_item->>'resultat' end;
    v_obs  := nullif(btrim(coalesce(v_item->>'observacions', '')), '');
    v_mot  := coalesce(nullif(btrim(coalesce(v_item->>'motiu', '')), ''),
                       nullif(btrim(coalesce(p_motiu, '')), ''));
    begin
      if v_resu = 'no_recollit' then
        v_mot := left('No recollit' || coalesce(': ' || coalesce(v_mot, v_obs), ''), 1000);
        if v_equip then
          perform public.anular_assignacio(v_can, v_mot);
        else
          perform public.anula_canalitzacio(v_can, v_mot);
        end if;
        v_r := jsonb_build_object('estat', 'anulada', 'motiu', v_mot);
      elsif v_equip then
        v_r := public.registrar_recollida_assistida(
                 v_can, v_resu, nullif(v_item->>'kg_reals', '')::numeric, p_quan, v_obs, v_mot,
                 public.uuid_de_linia(v_item, 'foto'));
      else
        v_r := public.registrar_recollida(
                 v_can, v_resu, nullif(v_item->>'kg_reals', '')::numeric, p_quan,
                 coalesce(v_obs, v_mot));
      end if;
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      raise exception using errcode = v_state, message = v_msg,
        detail = jsonb_build_object('linia', v_ord, 'canalizacion_id', v_can)::text;
    end;
    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'canalizacion_id', v_can, 'resultat', v_resu, 'resposta', v_r));
  end loop;

  return jsonb_build_object(
    'sollicitud_id', p_sollicitud,
    'registrada_per', case when v_equip then 'equip' else 'entitat_receptora' end,
    'linies', v_res);
end;
$$;

revoke execute on function public.registrar_recollida_multiple(uuid, jsonb, timestamptz, text) from public, anon;
grant execute on function public.registrar_recollida_multiple(uuid, jsonb, timestamptz, text) to authenticated, service_role;

comment on function public.registrar_recollida_multiple(uuid, jsonb, timestamptz, text) is
  'Fase 6c (3.3, 20270620100600): recogida real de una solicitud multiproducto, todo o nada. La '
  'entidad declara por línea (registrar_recollida); el equipo registra y valida '
  '(registrar_recollida_assistida); no_recollit anula esa canalización con motivo. '
  'p_linies = [{canalizacion_id, resultat, kg_reals?, observacions?, motiu?, foto?}].';

create or replace function public.validar_recollides_sollicitud(
  p_sollicitud uuid,
  p_motiu      text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c       record;
  v_r     jsonb;
  v_res   jsonb := '[]'::jsonb;
  v_state text;
  v_msg   text;
begin
  -- `validar_recollida` exige la identidad de quien valida: sin sesión tampoco.
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes un admin pot validar una recollida' using errcode = '42501';
  end if;
  if not exists (select 1 from sollicituds_recollida where id = p_sollicitud) then
    raise exception 'sollicitud_inexistent' using errcode = '22023';
  end if;

  for c in select x.id from canalizaciones x
            where x.sollicitud_id = p_sollicitud
              and x.estado <> 'anulada'
              and x.recollida_registrada_at is not null
              and x.recollida_validada_at is null
            order by x.created_at, x.id loop
    begin
      v_r := public.validar_recollida(c.id, null, p_motiu);
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      raise exception using errcode = v_state, message = v_msg,
        detail = jsonb_build_object('canalizacion_id', c.id)::text;
    end;
    v_res := v_res || jsonb_build_array(jsonb_build_object('canalizacion_id', c.id, 'resposta', v_r));
  end loop;

  return jsonb_build_object('sollicitud_id', p_sollicitud,
                            'validades', jsonb_array_length(v_res), 'linies', v_res);
end;
$$;

revoke execute on function public.validar_recollides_sollicitud(uuid, text) from public, anon;
grant execute on function public.validar_recollides_sollicitud(uuid, text) to authenticated, service_role;

comment on function public.validar_recollides_sollicitud(uuid, text) is
  'Fase 6c (3.3, 20270620100600): «Valida totes» (pot_aprovar). validar_recollida de cada '
  'canalización de la solicitud ya declarada y sin validar, todo o nada.';
