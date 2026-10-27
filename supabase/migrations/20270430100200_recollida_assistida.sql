-- La recogida registrada por el EQUIPO en nombre del receptor, en un solo paso (27-10-2026,
-- fase 3 del plan de gestión autónoma).
--
-- POR QUÉ. El camino del usuario son dos actos: la entidad declara los kilos
-- (`registrar_recollida`, exige ser de la entidad) y un admin los valida (`validar_recollida`,
-- que emite ENT/OPE y REC con los kilos validados y concilia). El equipo no podía declarar en
-- nombre de nadie, y su atajo `confirmar_recollida` rellenaba las líneas con los kilos
-- ASIGNADOS, no los reales, sin guardar `kg_declarats` ni `resultat_recollida` ni la
-- incidencia, y solo conciliaba dentro de tolerancia (R1 del plan: paridad de filas).
--
-- AHORA: `registrar_recollida_assistida()` hace las dos cosas en una transacción, con el
-- MISMO código que el receptor (`registrar_recollida_escriu`, extraído de
-- `registrar_recollida`) y el MISMO `validar_recollida`. Lo único que cambia es la autoría:
-- `recollida_registrada_per` es la cuenta del equipo, la incidencia lleva `origen = 'equip'`,
-- y la confirmación del albarán se imprime como ASISTIDA (canal `asistido`, conducida por
-- quien la registró), no como «declarada pel receptor», que sería falso.
--
-- `confirmar_recollida()` se queda como ENVOLTORIO del camino nuevo. ⚠️ Cambia de
-- comportamiento: concilia SIEMPRE (la validación del admin es la revisión) y las líneas
-- llevan los kilos REALES.

-- ---------------------------------------------------------------------------
-- 1. confirmar_part_declarada(): con el canal del enlace
-- ---------------------------------------------------------------------------
-- La firma cambia (un parámetro más, con default), así que se borra la vieja.
drop function if exists public.confirmar_part_declarada(uuid, text, numeric, uuid, text, text, timestamptz, jsonb, jsonb);

create function public.confirmar_part_declarada(
  p_albaran    uuid,
  p_rol        text,
  p_kg         numeric,
  p_user       uuid,
  p_nom        text,
  p_carrec     text,
  p_data       timestamptz,
  p_incidencia jsonb,
  p_extra      jsonb,
  -- 27-10-2026: `asistido` cuando la registró el equipo en nombre de la entidad.
  p_canal      text default 'panel'
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tok record;
  v_id  uuid;
begin
  if auth.uid() is not null then
    raise exception 'Funcio interna' using errcode = '42501';
  end if;
  if p_canal not in ('panel', 'asistido') then
    raise exception 'canal_desconegut' using errcode = '22023';
  end if;
  if exists (select 1 from enlaces_token t
              where t.objeto_tipo = 'albaran' and t.objeto_id = p_albaran
                and t.proposito = 'confirmacion_albaran'
                and t.usado_at is not null and t.rol_parte = p_rol) then
    return false;   -- esa parte ya confirmó
  end if;

  -- Los enlaces vivos de esa parte se revocan (correo o WhatsApp que ya no hacen falta).
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'albaran' and objeto_id = p_albaran
     and proposito = 'confirmacion_albaran' and estado = 'activo'
     and (rol_parte = p_rol or rol_parte is null);

  select * into v_tok from public.generar_token_enlace();
  insert into enlaces_token (proposito, objeto_tipo, objeto_id, canal, rol_parte,
                             token_hash, caduca_at, creado_por)
  values ('confirmacion_albaran', 'albaran', p_albaran, p_canal, p_rol,
          v_tok.token_hash, now() + interval '1 hour', p_user)
  returning id into v_id;

  -- Con `canal = 'asistido'`, `registrar_confirmacion()` escribe `asistido_por` con
  -- `creado_por` (la cuenta del equipo) y el PDF imprime «Confirmació assistida».
  perform public.registrar_confirmacion(
    v_id,
    jsonb_build_object(
      'kg_confirmados', public.repartir_kg_linies(p_albaran, p_kg),
      'rechazo', 'cap',
      'incidencias', case when p_incidencia is not null then jsonb_build_array(p_incidencia) end),
    jsonb_build_object(
      'nombre', p_nom,
      'cargo', p_carrec,
      'payload', jsonb_build_object(
                   'via', 'registrar_recollida',
                   'usuari_id', p_user,
                   'data_recollida', p_data) || coalesce(p_extra, '{}'::jsonb)));
  return true;
end;
$$;

revoke execute on function public.confirmar_part_declarada(uuid, text, numeric, uuid, text, text, timestamptz, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.confirmar_part_declarada(uuid, text, numeric, uuid, text, text, timestamptz, jsonb, jsonb, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. validar_recollida(): sabe si la registró el equipo
-- ---------------------------------------------------------------------------
-- Recreada entera desde 20270428100000 (vía la definición vigente del clon). Solo cambia el
-- texto y el canal de la confirmación cuando quien registró NO es miembro de la entidad.
create or replace function public.validar_recollida(p_canalizacion uuid, p_kg numeric default null, p_motiu text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user     uuid := auth.uid();
  v_claims   text;
  v_sub      text;
  v_ctx      text := current_setting('redestina.validacio_recollida', true);
  c          canalizaciones%rowtype;
  s          albaranes%rowtype;
  r          albaranes%rowtype;
  v_motiu    text := nullif(btrim(coalesce(p_motiu, '')), '');
  v_mconc    text;
  v_decl     numeric;
  v_assig    numeric;
  v_kg       numeric;
  v_corregit boolean;
  v_ja_conf  boolean := false;
  v_ent      text;
  v_nom_rec  text;
  v_nom_adm  text;
  v_prod     uuid;
  v_data     timestamptz;
  v_valid    jsonb;
  v_inc      jsonb;
  v_extra    jsonb;
  v_falten   boolean := false;
  v_kg_rec   numeric;
  v_kg_prev  numeric;
  v_quan_r   timestamptz;
  v_rep      jsonb;
  v_conc     boolean := false;
  v_ok       boolean;
  -- 27-10-2026: ¿la registró el equipo en nombre de la entidad? Entonces la confirmación es
  -- ASISTIDA (canal `asistido`, conducida por quien la registró) y no «declarada pel
  -- receptor», que sería falso en el albarán.
  v_assistida boolean := false;
  v_carrec_rec text;
  v_carrec_ent text;
  v_canal     text;
begin
  -- (0) Solo un admin, con sesión: su identidad es parte de la evidencia. Permiso ANTES que
  --     existencia (un uuid inventado da 42501 a quien no es admin).
  if v_user is null or not public.pot_aprovar() then
    raise exception 'Nomes un admin pot validar una recollida' using errcode = '42501';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if c.recollida_validada_at is not null then
    raise exception 'ja_validada' using errcode = '22023';
  end if;
  if c.recollida_registrada_at is null then
    raise exception 'no_registrada' using errcode = '22023';
  end if;
  if p_kg is not null and (p_kg <= 0 or p_kg > 1000000) then
    raise exception 'kg_invalids' using errcode = '22023';
  end if;

  v_decl  := c.kg_declarats;
  v_assig := c.kg_confirmados;
  v_kg    := round(coalesce(p_kg, v_decl), 2);
  if v_kg is null or v_kg <= 0 then
    raise exception 'kg_invalids' using errcode = '22023';
  end if;
  v_corregit := p_kg is not null and round(p_kg, 2) is distinct from round(v_decl, 2);
  if v_motiu is null
     and (v_corregit or c.incidencia_recollida is not null
          or round(v_decl, 2) is distinct from round(v_assig, 2)) then
    raise exception 'cal_motiu_validacio' using errcode = '22023';
  end if;
  if v_motiu is not null and char_length(v_motiu) > 1000 then
    raise exception 'motiu_llarg' using errcode = '22023';
  end if;

  select * into s from albaranes
   where canalizacion_id = c.id and tipo in ('ENT', 'OPE')
     and estado not in ('anulado', 'rectificado')
   order by created_at desc limit 1
   for update;
  if s.id is null then
    raise exception 'sense_albara' using errcode = '22023';
  end if;
  -- Solo con las registradas con el flujo anterior (20270426100000) o confirmadas después por
  -- otro camino: el albarán ya está emitido y confirmado, así que no se le pueden cambiar los
  -- kilos aquí (para eso está rectificar). Validarla sin corregir la concilia.
  if s.estado in ('confirmado', 'conciliado') then
    if v_corregit then
      raise exception 'albara_ja_confirmat' using errcode = '22023';
    end if;
    v_ja_conf := true;
  end if;

  select e.nombre into v_ent from entidades e where e.id = c.entidad_id;
  select coalesce(nullif(btrim(p.nombre), ''), p.email) into v_nom_rec
    from perfiles p where p.id = c.recollida_registrada_per;
  select coalesce(nullif(btrim(p.nombre), ''), p.email) into v_nom_adm
    from perfiles p where p.id = v_user;
  select coalesce(ex.productor_id, esp.productor_id) into v_prod
    from excedentes ex left join espigoladas esp on esp.id = ex.espigolada_id
   where ex.id = c.excedente_id;
  v_data := coalesce(c.recollida_real_at, c.recollida_registrada_at, now());

  v_assistida := c.recollida_registrada_per is not null and not exists (
    select 1 from membresias m
     where m.user_id = c.recollida_registrada_per and m.entidad_id = c.entidad_id and m.activo);
  v_canal := case when v_assistida then 'asistido' else 'panel' end;
  v_carrec_rec := case when v_assistida
    then 'Registrada per l''equip en nom de ' || coalesce(v_ent, 'l''entitat receptora')
    else v_ent end;
  v_carrec_ent := case when v_assistida
    then 'Recollida registrada per l''equip en nom de ' || coalesce(v_ent, 'l''entitat receptora')
    else 'Recollida declarada per ' || coalesce(v_ent, 'l''entitat receptora') || ' i validada per l''equip' end;

  v_valid := jsonb_build_object(
    'validada_at', now(), 'validada_per', v_user, 'validada_per_nom', v_nom_adm,
    'kg_declarats', v_decl, 'kg_validats', v_kg, 'corregit', v_corregit, 'motiu', v_motiu);
  v_inc := case
    when c.incidencia_recollida is not null then
      (c.incidencia_recollida - 'registrada_at' - 'registrada_per')
        || jsonb_build_object('kg_validats', v_kg, 'validacio', v_valid)
    when v_corregit then jsonb_build_object(
      'descripcion', v_motiu, 'tipus', 'correccio_equip', 'origen', 'equip',
      'kg_assignats', v_assig, 'kg_declarats', v_decl, 'kg_validats', v_kg,
      'validacio', v_valid)
    when c.observacions_recollida is not null then jsonb_build_object(
      'descripcion', c.observacions_recollida, 'origen', 'entitat_receptora')
  end;
  v_extra := jsonb_build_object(
    'resultat', c.resultat_recollida, 'kg_assignats', v_assig,
    'kg_declarats', v_decl, 'kg_validats', v_kg, 'corregit', v_corregit,
    'motiu_validacio', v_motiu, 'validat_per', v_user, 'validat_per_nom', v_nom_adm,
    'validat_amb', 'validar_recollida', 'registrada_per_equip', v_assistida);

  -- (1) El contexto que abre el candado de `emitir_albaran()`.
  perform set_config('redestina.validacio_recollida', 'on', true);

  -- (2) La salida: emitida con los kilos VALIDADOS y entregada (sesión del admin), y
  --     confirmada por declaración del receptor (servidor).
  if not v_ja_conf then
    if s.estado = 'borrador' then
      v_rep := public.repartir_kg_linies(s.id, v_kg);
      update albaran_lineas l
         set kg_bruto = (x->>'kg')::numeric,
             tara_kg  = 0,
             kg_neto  = (x->>'kg')::numeric
        from jsonb_array_elements(v_rep) x
       where l.albaran_id = s.id and l.id = (x->>'linea_id')::uuid;
      perform public.emitir_albaran(s.id, jsonb_build_object('fecha_hora', v_data), null, null);
      perform public.marcar_entregado(s.id);
    elsif s.estado = 'emitido' then
      perform public.marcar_entregado(s.id);
    end if;

    v_claims := current_setting('request.jwt.claims', true);
    v_sub    := current_setting('request.jwt.claim.sub', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);

    v_ok := public.confirmar_part_declarada(
      s.id, 'recibe', v_kg, c.recollida_registrada_per, v_nom_rec, v_carrec_rec, v_data, v_inc, v_extra,
      v_canal);
    if s.tipo = 'OPE' and v_prod is not null then
      v_ok := public.confirmar_part_declarada(
        s.id, 'entrega', v_kg, c.recollida_registrada_per, v_nom_rec, v_carrec_ent,
        v_data, null, v_extra || jsonb_build_object('declaracio_receptor', not v_assistida), v_canal);
    end if;

    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  end if;

  update canalizaciones
     set kg_reales              = v_kg,
         recollida_validada_at  = now(),
         recollida_validada_per = v_user,
         incidencia_recollida   = case when c.incidencia_recollida is not null or v_corregit
                                       then v_inc end
   where id = c.id;
  select * into s from albaranes where id = s.id;

  -- (3) El REC de la oferta (donación), cuando ya no le falta ninguna salida por validar.
  select a.* into r from albaranes a
   where a.tipo = 'REC' and a.estado not in ('anulado', 'rectificado')
     and a.excedente_id = c.excedente_id and a.espigolada_id is null
   order by a.created_at desc limit 1
   for update;

  if r.id is not null then
    select exists (
      select 1 from canalizaciones c2
       where c2.excedente_id = c.excedente_id and c2.estado <> 'anulada'
         and not exists (
           select 1 from albaranes b
            where b.canalizacion_id = c2.id and b.tipo in ('ENT', 'OPE')
              and b.estado in ('confirmado', 'conciliado')))
      into v_falten;

    if not v_falten and r.estado in ('borrador', 'emitido', 'entregado') then
      select coalesce(sum(coalesce(c2.kg_reales, c2.kg_confirmados)), 0),
             coalesce(sum(c2.kg_confirmados), 0),
             min(coalesce(c2.recollida_real_at, c2.data_hora_recollida))
        into v_kg_rec, v_kg_prev, v_quan_r
        from canalizaciones c2
       where c2.excedente_id = c.excedente_id and c2.estado <> 'anulada';
      if r.estado = 'borrador' then
        update albaran_lineas
           set kg_previstos = case when v_kg_prev > 0 then v_kg_prev else kg_previstos end
         where albaran_id = r.id;
        v_rep := public.repartir_kg_linies(r.id, v_kg_rec);
        update albaran_lineas l
           set kg_bruto = (x->>'kg')::numeric,
               tara_kg  = 0,
               kg_neto  = (x->>'kg')::numeric
          from jsonb_array_elements(v_rep) x
         where l.albaran_id = r.id and l.id = (x->>'linea_id')::uuid;
        perform public.emitir_albaran(r.id, jsonb_build_object('fecha_hora', coalesce(v_quan_r, v_data)), null, null);
        perform public.marcar_entregado(r.id);
      elsif r.estado = 'emitido' then
        perform public.marcar_entregado(r.id);
      end if;

      v_claims := current_setting('request.jwt.claims', true);
      v_sub    := current_setting('request.jwt.claim.sub', true);
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      v_ok := public.confirmar_part_declarada(
        r.id, 'entrega', v_kg_rec, c.recollida_registrada_per, v_nom_rec, v_carrec_ent,
        v_data,
        case when v_inc ? 'tipus' then v_inc end,
        v_extra || jsonb_build_object('declaracio_receptor', not v_assistida, 'canalitzacio_id', c.id),
        v_canal);
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
      select * into r from albaranes where id = r.id;
    end if;
  end if;

  -- (4) Conciliar. La validación del admin ES la revisión: se concilia siempre que se pueda,
  --     con su motivo o «Validat per l'equip» (que es lo que satisface la guarda
  --     `cal_motiu_incidencia` de 20270427100000; con incidencia el motivo ya era obligatorio).
  v_mconc := coalesce(v_motiu, 'Validat per l''equip');
  if r.id is not null and r.estado = 'confirmado' then
    perform public.conciliar_albaran(r.id, null, v_mconc, null);
    v_conc := true;
  elsif r.id is not null and r.estado = 'conciliado' and s.estado = 'confirmado' then
    perform public.conciliar_albaran(s.id, null,
      v_mconc || ' (recepcio ' || coalesce(r.numero_completo, '?') || ' ja conciliada)', null);
    v_conc := true;
  elsif r.id is null and s.estado = 'confirmado' then
    perform public.conciliar_albaran(s.id, null, v_mconc, null);
    v_conc := true;
  end if;

  select * into s from albaranes where id = s.id;
  if r.id is not null then select * into r from albaranes where id = r.id; end if;

  perform set_config('redestina.validacio_recollida', coalesce(v_ctx, ''), true);

  return jsonb_build_object(
    'albara_id', s.id, 'albara', s.numero_completo, 'tipus', s.tipo, 'estat', s.estado,
    'rec', case when r.id is not null then jsonb_build_object('id', r.id, 'numero', r.numero_completo, 'estat', r.estado) end,
    'kg_reals', v_kg, 'kg_assignats', v_assig, 'kg_declarats', v_decl,
    'conciliat', v_conc,
    'esperant_altres', coalesce(v_falten, false));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Lo que guarda un registro de recogida, en un solo sitio
-- ---------------------------------------------------------------------------
-- Extraído de `registrar_recollida` (20270428100000) SIN cambiar una regla: lo comparten el
-- receptor y el equipo. Interna: nadie con sesión la llama directamente.
create or replace function public.registrar_recollida_escriu(
  p_canalizacion  uuid,
  p_resultat      text,
  p_kg_reals      numeric,
  p_data          timestamptz,
  p_observacions  text,
  p_per           uuid,
  p_origen        text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_esc     text := current_setting('redestina.escriu_recollida', true);
  c         canalizaciones%rowtype;
  s         albaranes%rowtype;
  v_assig   numeric;
  v_kg      numeric;
  v_obs     text := nullif(btrim(coalesce(p_observacions, '')), '');
  v_data    timestamptz;
  v_inc     jsonb;
begin
  if p_origen not in ('entitat_receptora', 'equip') then
    raise exception 'origen_desconegut' using errcode = '22023';
  end if;
  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if c.recollida_registrada_at is not null or c.recollida_validada_at is not null then
    raise exception 'ja_registrada' using errcode = '22023';
  end if;

  -- (1) Lo declarado. «Coincideix» son exactamente los kilos asignados.
  if p_resultat is null or p_resultat not in ('coincideix', 'menys', 'mes') then
    raise exception 'resultat_invalid' using errcode = '22023';
  end if;
  v_assig := c.kg_confirmados;
  if p_resultat = 'coincideix' then
    v_kg := coalesce(p_kg_reals, v_assig);
    if v_assig is null or v_kg is distinct from v_assig then
      raise exception 'kg_no_coincideixen' using errcode = '22023';
    end if;
  else
    v_kg := p_kg_reals;
    if v_kg is null or v_kg < 0 or v_kg > 1000000 then
      raise exception 'kg_invalids' using errcode = '22023';
    end if;
    if v_kg = 0 then
      raise exception 'kg_zero' using errcode = '22023';
    end if;
    if v_assig is not null and p_resultat = 'menys' and v_kg >= v_assig then
      raise exception 'kg_no_menys' using errcode = '22023';
    end if;
    if v_assig is not null and p_resultat = 'mes' and v_kg <= v_assig then
      raise exception 'kg_no_mes' using errcode = '22023';
    end if;
    if v_obs is null then
      raise exception 'falta_motiu_diferencia' using errcode = '22023';
    end if;
  end if;
  v_kg := round(v_kg, 2);
  if v_obs is not null and char_length(v_obs) > 1000 then
    raise exception 'motiu_llarg' using errcode = '22023';
  end if;

  v_data := coalesce(p_data, now());
  if v_data > now() + interval '5 minutes' then
    raise exception 'data_futura' using errcode = '22023';
  end if;
  if v_data < c.created_at - interval '1 day' then
    raise exception 'data_anterior' using errcode = '22023';
  end if;

  -- (2) Tiene que haber una salida, y que nadie la haya confirmado ya por otro camino.
  select * into s from albaranes
   where canalizacion_id = c.id and tipo in ('ENT', 'OPE')
     and estado not in ('anulado', 'rectificado')
   order by created_at desc limit 1
   for update;
  if s.id is null then
    raise exception 'sense_albara' using errcode = '22023';
  end if;
  if s.estado in ('confirmado', 'conciliado')
     or exists (select 1 from enlaces_token t
                 where t.objeto_tipo = 'albaran' and t.objeto_id = s.id
                   and t.proposito = 'confirmacion_albaran'
                   and t.usado_at is not null and t.rol_parte = 'recibe') then
    raise exception 'ja_registrada' using errcode = '22023';
  end if;

  v_inc := case when p_resultat <> 'coincideix' then jsonb_build_object(
    'descripcion', v_obs, 'tipus', 'diferencia_kg', 'resultat', p_resultat,
    'kg_assignats', v_assig, 'kg_reals', v_kg, 'origen', p_origen,
    'registrada_at', now(), 'registrada_per', p_per) end;

  -- (3) Solo guardar.
  perform set_config('redestina.escriu_recollida', 'on', true);

  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'albaran' and objeto_id = s.id
     and proposito = 'confirmacion_albaran' and estado = 'activo'
     and (rol_parte = 'recibe' or rol_parte is null
          or (s.tipo = 'OPE' and rol_parte = 'entrega'));

  update canalizaciones
     set kg_declarats             = v_kg,
         resultat_recollida       = p_resultat,
         observacions_recollida   = v_obs,
         recollida_real_at        = v_data,
         recollida_registrada_at  = now(),
         recollida_registrada_per = p_per,
         incidencia_recollida     = v_inc,
         recollida_retornada_at   = null,
         motiu_retorn             = null
   where id = c.id;

  perform set_config('redestina.escriu_recollida', coalesce(v_esc, ''), true);

  return jsonb_build_object(
    'estat', 'pendent_validacio',
    'kg_declarats', v_kg,
    'kg_assignats', v_assig,
    'resultat', p_resultat);
end;
$function$;

revoke execute on function public.registrar_recollida_escriu(uuid, text, numeric, timestamptz, text, uuid, text)
  from public, anon, authenticated, service_role;

-- El receptor: misma firma, misma guarda, y lo demás en la función compartida.
create or replace function public.registrar_recollida(
  p_canalizacion uuid,
  p_resultat     text,
  p_kg_reals     numeric default null,
  p_data         timestamptz default null,
  p_observacions text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  c      canalizaciones%rowtype;
begin
  -- Permiso ANTES que existencia.
  if v_user is null then
    raise exception 'Cal una sessio' using errcode = '42501';
  end if;
  select * into c from canalizaciones where id = p_canalizacion;
  if c.id is null or c.entidad_id is null
     or c.entidad_id not in (select public.mis_entidades()) then
    raise exception 'Nomes l''entitat receptora pot registrar aquesta recollida' using errcode = '42501';
  end if;
  return public.registrar_recollida_escriu(p_canalizacion, p_resultat, p_kg_reals, p_data,
                                           p_observacions, v_user, 'entitat_receptora');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. El equipo, en nombre del receptor: registrar + validar en una transacción
-- ---------------------------------------------------------------------------
create or replace function public.registrar_recollida_assistida(
  p_canalizacion uuid,
  p_resultat     text,
  p_kg_reals     numeric default null,
  p_data         timestamptz default null,
  p_observacions text default null,
  p_motiu        text default null,
  p_foto         uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c     canalizaciones%rowtype;
  v_mot text := coalesce(nullif(btrim(coalesce(p_motiu, '')), ''), nullif(btrim(coalesce(p_observacions, '')), ''));
  v_val jsonb;
begin
  -- Un admin, con sesión: es una validación, y su identidad es parte de la evidencia.
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes un admin pot registrar una recollida en nom del receptor' using errcode = '42501';
  end if;
  select * into c from canalizaciones where id = p_canalizacion;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if p_resultat is distinct from 'coincideix' and v_mot is null then
    raise exception 'cal_motiu' using errcode = '22023';
  end if;
  -- La foto, si la hay, ya está subida como documento externo de un albarán de ESTA entrega.
  if p_foto is not null and not exists (
       select 1 from documentos_externos x
        where x.id = p_foto and x.objeto_tipo = 'albaran'
          and x.objeto_id in (select a.id from albaranes a where a.canalizacion_id = c.id)) then
    raise exception 'foto_aliena' using errcode = '22023';
  end if;

  perform public.registrar_recollida_escriu(p_canalizacion, p_resultat, p_kg_reals, p_data,
                                            p_observacions, auth.uid(), 'equip');
  v_val := public.validar_recollida(p_canalizacion, null, v_mot);
  return v_val || jsonb_build_object('registrada_per', 'equip');
end;
$$;

revoke execute on function public.registrar_recollida_assistida(uuid, text, numeric, timestamptz, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.registrar_recollida_assistida(uuid, text, numeric, timestamptz, text, text, uuid)
  to authenticated;

comment on function public.registrar_recollida_assistida(uuid, text, numeric, timestamptz, text, text, uuid) is
  'La recogida registrada por el equipo en nombre del receptor y validada en la misma transacción: ENT/OPE, REC y conciliación como en el camino del usuario (20270430100200).';

-- ---------------------------------------------------------------------------
-- 5. confirmar_recollida(): envoltorio del camino nuevo
-- ---------------------------------------------------------------------------
create or replace function public.confirmar_recollida(
  p_canalizacion uuid,
  p_kg_reals     numeric,
  p_data         timestamptz default null,
  p_observacions text default null,
  p_foto         uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c     canalizaciones%rowtype;
  v_res text;
  v_mot text := coalesce(nullif(btrim(coalesce(p_observacions, '')), ''), 'Confirmat per l''equip');
  v_val jsonb;
begin
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes un admin pot confirmar una recollida' using errcode = '42501';
  end if;
  select * into c from canalizaciones where id = p_canalizacion;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if p_kg_reals is null or p_kg_reals <= 0 then
    raise exception 'kg_invalids' using errcode = '22023';
  end if;
  if c.recollida_validada_at is not null then
    raise exception 'ja_confirmada' using errcode = '22023';
  end if;

  -- La entidad ya la registró: lo que falta es validarla (con los kilos que dice el equipo).
  if c.recollida_registrada_at is not null then
    v_val := public.validar_recollida(p_canalizacion, p_kg_reals, v_mot);
  else
    v_res := case
      when c.kg_confirmados is not null and round(p_kg_reals, 2) = round(c.kg_confirmados, 2) then 'coincideix'
      when c.kg_confirmados is not null and p_kg_reals < c.kg_confirmados then 'menys'
      else 'mes' end;
    v_val := public.registrar_recollida_assistida(p_canalizacion, v_res, p_kg_reals, p_data,
      case when v_res <> 'coincideix' then v_mot else nullif(btrim(coalesce(p_observacions, '')), '') end,
      v_mot, p_foto);
  end if;
  -- Compatibilidad con quien leía la forma anterior.
  return v_val || jsonb_build_object('fora_tolerancia', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. fixar_hora_recollida(): la hora de una entrega, sin formulario
-- ---------------------------------------------------------------------------
-- Hasta hoy solo la escribían `aprovar_resposta` (si el interés traía hora) y
-- `confirmar_recollida`. Sin hora, el job de la recogida nunca mira la entrega. Cambiarla
-- dispara el aviso `recollida_canviada` a las dos partes (`trg_canalitzacio_avis_canvis`), y
-- se vuelve a pedir el registro a la hora nueva (`registre_demanat_at` a null).
create or replace function public.fixar_hora_recollida(p_canalizacion uuid, p_quan timestamptz)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c canalizaciones%rowtype;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot fixar l''hora d''una recollida' using errcode = '42501';
  end if;
  if p_quan is null then
    raise exception 'cal_hora' using errcode = '22023';
  end if;
  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if c.recollida_registrada_at is not null or c.recollida_validada_at is not null then
    raise exception 'ja_registrada' using errcode = '22023';
  end if;
  if p_quan < now() - interval '1 hour' then
    raise exception 'hora_passada: la recollida no pot ser en el passat' using errcode = '22023';
  end if;

  update canalizaciones
     set data_hora_recollida = p_quan,
         registre_demanat_at = null
   where id = c.id
  returning * into c;
  return c;
end;
$$;

revoke execute on function public.fixar_hora_recollida(uuid, timestamptz) from public, anon;
grant execute on function public.fixar_hora_recollida(uuid, timestamptz) to authenticated, service_role;
