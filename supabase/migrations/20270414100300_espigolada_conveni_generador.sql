-- Repartir una espigolada exige también el convenio del GENERADOR, no solo el de la entidad.
--
-- `repartir_espigolada()` es el único camino que crea canalizaciones sin pasar por
-- `aprovar_resposta()`, y por eso llama por su cuenta a `exigir_convenio()` (§4bis). Pero solo
-- lo hacía con la entidad (`don_rec`, parte que recibe). `aprovar_resposta()` lo exige a las
-- DOS partes: el generador entrega (`don_gen`) y la entidad recibe. Sin el del generador, una
-- espigolada en la finca de una organización sin convenio acababa en un REC, en ENT y en un
-- certificado de donación de alguien que nunca firmó nada — justo lo que la fecha de corte
-- existe para impedir.
--
-- Mismo patrón que `aprovar_resposta()`: `exigir_convenio(tipo, org, 'donacio', parte)`, que
-- antes de `fecha_corte_convenios` devuelve un aviso y después levanta `42501 sense_conveni`.
-- El aviso va a `avisos`, como el de la entidad. Se comprueba UNA vez y ANTES de insertar
-- nada: todos los registros de una espigolada son del mismo generador (el de la jornada), y
-- comprobarlo dentro del bucle repetiría el mismo aviso por cada lote.
-- Un reparto vacío no comprueba nada: no crea ninguna canalización.

create or replace function public.repartir_espigolada(p_id uuid, p_lotes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  esp      espigoladas%rowtype;
  lote     jsonb;
  v_can    uuid;
  v_aviso  text;
  v_avisos jsonb := '[]'::jsonb;
  v_res    jsonb := '[]'::jsonb;
  v_cub    numeric;
  ex       excedentes%rowtype;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot repartir una espigolada' using errcode = '42501';
  end if;

  select * into esp from espigoladas where id = p_id for update;
  if esp.id is null or esp.estado <> 'oberta' then
    raise exception 'Aquesta espigolada no admet mes repartiment' using errcode = '22023';
  end if;

  -- El generador entrega: su convenio de donación, como en `aprovar_resposta()`.
  if jsonb_array_length(coalesce(p_lotes, '[]'::jsonb)) > 0 then
    v_aviso := public.exigir_convenio('productor', esp.productor_id, 'donacio', 'entrega');
    if v_aviso is not null then
      v_avisos := v_avisos || to_jsonb(v_aviso);
    end if;
  end if;

  for lote in select * from jsonb_array_elements(p_lotes) loop
    select * into ex from excedentes
     where id = (lote->>'excedente_id')::uuid and espigolada_id = esp.id;
    if ex.id is null then
      raise exception 'El registre % no es d''aquesta espigolada', lote->>'excedente_id'
        using errcode = '22023';
    end if;

    -- La entidad recibe.
    v_aviso := public.exigir_convenio('entidad', (lote->>'entidad_id')::uuid, 'donacio', 'recibe');
    if v_aviso is not null then
      v_avisos := v_avisos || to_jsonb(v_aviso);
    end if;

    insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion,
                                nota_lote, codigo_lote, estado)
    values (ex.id, (lote->>'entidad_id')::uuid, (lote->>'kg')::numeric, 'donacio',
            lote->>'nota', lote->>'codigo_lote', 'confirmada')
    returning id into v_can;

    v_res := v_res || jsonb_build_object('canalitzacio_id', v_can,
                                         'excedente_id', ex.id,
                                         'kg', (lote->>'kg')::numeric);

    -- Misma regla que `aprovar_resposta()`: al cubrir los kilos, el registro se bloquea.
    select coalesce(sum(kg_confirmados), 0) into v_cub
      from canalizaciones where excedente_id = ex.id;
    update excedentes
       set estado = case when coalesce(ex.kg_total, 0) > 0 and v_cub >= ex.kg_total
                         then 'bloqueada' else 'parcial' end
     where id = ex.id;
  end loop;

  return jsonb_build_object('lots', v_res, 'avisos', v_avisos);
end;
$function$;

revoke execute on function public.repartir_espigolada(uuid, jsonb) from public, anon;
grant  execute on function public.repartir_espigolada(uuid, jsonb) to authenticated, service_role;
