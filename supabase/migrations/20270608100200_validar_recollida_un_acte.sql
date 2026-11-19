-- Fase 3 del plan de los puntos 4-6 (cambio C3, con D2): VALIDAR UNA RECOGIDA EN UN ACTO.
--
-- Hasta aquí `validar_recollida()` emitía y confirmaba la salida (ENT/OPE) y dejaba el REC de la
-- oferta en borrador hasta que se validara la ÚLTIMA recogida (`v_falten`): entre medias, el ENT
-- quedaba «Confirmat» y aparecía «Concilia». Ahora, según la canalización:
--
--   · DONACIÓN CON SU PROPIO REC (20270608100100): emite, entrega y confirma su ENT (como antes)
--     y después SU REC con los kilos validados; concilia el REC, que arrastra el ENT. Sin esperar
--     a las demás recogidas y sin estado intermedio. `esperant_altres` sale siempre false.
--   · VENTA O MAQUILA SIN ALBARÁN (D): no hay documento de Redestina. La canalización queda
--     `conciliada` con `kg_reales = kg_conciliados = kg validados`, se valora si hacía falta y se
--     avisa al productor (`recollida_confirmada`, los mismos parámetros que
--     `trg_albara_avis_confirmat`, que sin albarán no salta). Devuelve `albara_id`, `tipus`,
--     `estat` y `rec` a null, `conciliat: true` y `sense_albara: true`.
--   · LO HEREDADO (REC por oferta, OPE ya emitido, espigolada): el camino de siempre. Dos ajustes:
--     el REC de la oferta es solo el HEREDADO (sin `canalizacion_id`), y una canalización ya
--     `conciliada` (p. ej. una venta validada sin albarán en una oferta mixta) no hace esperar al
--     REC heredado.
--   · VENTA (cualquier camino): sin precio acordado y aceptado por el ofertante → `22023
--     cal_preu_acceptat` (la regla de la fase 2: obligatorio para confirmar una venta; se fija con
--     `fixar_preu_acordat()`).
--
-- Y la oferta se cierra sola: la canalización pasa a `conciliada` (por `conciliar_albaran` o aquí)
-- y `canalizaciones_tanca_excedent` hace el resto.
--
-- `registrar_recollida_escriu()`: una venta o maquila sin albarán vivo se registra igual (la
-- donación sigue exigiendo su ENT: `sense_albara`).
-- `registrar_recollida_assistida()`: la foto también puede colgar de la canalización
-- (`documentos_externos.objeto_tipo = 'canalizacion'`, 20270608100400).
--
-- Mismas firmas. `validar_recollida` devuelve las mismas claves (más `sense_albara`).

-- ---------------------------------------------------------------------------
-- 1. `registrar_recollida_escriu`
-- ---------------------------------------------------------------------------
create or replace function public.registrar_recollida_escriu(
  p_canalizacion uuid, p_resultat text, p_kg_reals numeric, p_data timestamptz,
  p_observacions text, p_per uuid, p_origen text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- (2) La salida, y que nadie la haya confirmado ya por otro camino. 20270608100100 (D): una
  --     venta o una maquila no tiene albarán de Redestina; sin salida viva se registra igual. La
  --     donación la sigue necesitando.
  select * into s from albaranes
   where canalizacion_id = c.id and tipo in ('ENT', 'OPE')
     and estado not in ('anulado', 'rectificado')
   order by created_at desc limit 1
   for update;
  if s.id is null and coalesce(c.valorizacion, '') not in ('venda', 'maquila') then
    raise exception 'sense_albara' using errcode = '22023';
  end if;
  if s.id is not null
     and (s.estado in ('confirmado', 'conciliado')
          or exists (select 1 from enlaces_token t
                      where t.objeto_tipo = 'albaran' and t.objeto_id = s.id
                        and t.proposito = 'confirmacion_albaran'
                        and t.usado_at is not null and t.rol_parte = 'recibe')) then
    raise exception 'ja_registrada' using errcode = '22023';
  end if;
  if s.id is null and c.estado = 'conciliada' then
    raise exception 'ja_registrada' using errcode = '22023';
  end if;

  v_inc := case when p_resultat <> 'coincideix' then jsonb_build_object(
    'descripcion', v_obs, 'tipus', 'diferencia_kg', 'resultat', p_resultat,
    'kg_assignats', v_assig, 'kg_reals', v_kg, 'origen', p_origen,
    'registrada_at', now(), 'registrada_per', p_per) end;

  -- (3) Solo guardar.
  perform set_config('redestina.escriu_recollida', 'on', true);

  if s.id is not null then
    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'albaran' and objeto_id = s.id
       and proposito = 'confirmacion_albaran' and estado = 'activo'
       and (rol_parte = 'recibe' or rol_parte is null
            or (s.tipo = 'OPE' and rol_parte = 'entrega'));
  end if;

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
$$;

-- ---------------------------------------------------------------------------
-- 2. `validar_recollida`
-- ---------------------------------------------------------------------------
create or replace function public.validar_recollida(
  p_canalizacion uuid, p_kg numeric default null, p_motiu text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  -- ASISTIDA (canal `asistido`) y no «declarada pel receptor».
  v_assistida boolean := false;
  v_carrec_rec text;
  v_carrec_ent text;
  v_canal     text;
  -- 20270608100200: el camino.
  v_rec_propi  boolean := false;   -- donación con su propio REC
  v_sense_alb  boolean := false;   -- venta o maquila sin albarán
  ex           excedentes%rowtype;
  v_dif        boolean;
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
  -- (A, fase 2) Una venta no se confirma sin el precio acordado y aceptado por el ofertante.
  if c.valorizacion = 'venda' and (c.preu_acordat_kg is null or c.preu_acceptat_at is null) then
    raise exception 'cal_preu_acceptat: una venda necessita el preu acordat i acceptat per l''ofertant'
      using errcode = '22023';
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
    -- 20270608100200 (D): una venta o una maquila no tiene albarán de Redestina.
    if coalesce(c.valorizacion, '') in ('venda', 'maquila') then
      v_sense_alb := true;
    else
      raise exception 'sense_albara' using errcode = '22023';
    end if;
  end if;
  -- Solo con las registradas con el flujo anterior: el albarán ya está confirmado y no se le
  -- pueden cambiar los kilos aquí (para eso está rectificar). Validarla sin corregir la concilia.
  if s.id is not null and s.estado in ('confirmado', 'conciliado') then
    if v_corregit then
      raise exception 'albara_ja_confirmat' using errcode = '22023';
    end if;
    v_ja_conf := true;
  end if;

  -- El REC: el de ESTA recogida (20270608100100) o, si no lo hay, el heredado de la oferta.
  if not v_sense_alb then
    select a.* into r from albaranes a
     where a.tipo = 'REC' and a.canalizacion_id = c.id
       and a.estado not in ('anulado', 'rectificado')
     order by a.created_at desc limit 1
     for update;
    v_rec_propi := r.id is not null;
    if not v_rec_propi then
      select a.* into r from albaranes a
       where a.tipo = 'REC' and a.estado not in ('anulado', 'rectificado')
         and a.excedente_id = c.excedente_id and a.espigolada_id is null
         and a.canalizacion_id is null
       order by a.created_at desc limit 1
       for update;
    end if;
  end if;

  select e.nombre into v_ent from entidades e where e.id = c.entidad_id;
  select coalesce(nullif(btrim(p.nombre), ''), p.email) into v_nom_rec
    from perfiles p where p.id = c.recollida_registrada_per;
  select coalesce(nullif(btrim(p.nombre), ''), p.email) into v_nom_adm
    from perfiles p where p.id = v_user;
  select coalesce(e.productor_id, esp.productor_id) into v_prod
    from excedentes e left join espigoladas esp on esp.id = e.espigolada_id
   where e.id = c.excedente_id;
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
  v_mconc := coalesce(v_motiu, 'Validat per l''equip');

  -- (1) El contexto que abre el candado de `emitir_albaran()` (y el de la recogida protegida).
  perform set_config('redestina.validacio_recollida', 'on', true);

  -- ═══ (D) VENTA O MAQUILA SIN ALBARÁN: la canalización, conciliada en un acto ═══
  if v_sense_alb then
    -- El valor, si aún no lo tenía (la misma regla que `conciliar_albaran`), ANTES de pasar a
    -- conciliada: `canalizaciones_protegeix_preu` no deja mover el coste de una conciliada.
    perform public.valora_canalitzacio_si_cal(c.id, 'conciliacio');

    update canalizaciones
       set kg_reales              = v_kg,
           recollida_validada_at  = now(),
           recollida_validada_per = v_user,
           incidencia_recollida   = case when c.incidencia_recollida is not null or v_corregit
                                         then v_inc end,
           kg_conciliados         = v_kg,
           estado                 = 'conciliada',
           conciliada_at          = now(),
           conciliada_por         = v_user,
           motivo_conciliacion    = v_mconc
     where id = c.id
    returning * into c;

    -- El aviso al productor: el de `trg_albara_avis_confirmat`, que sin albarán no salta.
    select * into ex from excedentes where id = c.excedente_id;
    v_dif := c.incidencia_recollida is not null
          or (c.kg_confirmados is not null and round(v_kg, 2) <> round(c.kg_confirmados, 2));
    if ex.id is not null and ex.productor_id is not null then
      perform public.crear_avis('productor', ex.productor_id, 'recollida_confirmada', 'excedente', ex.id,
        jsonb_build_object('producte', ex.producto, 'kg', v_kg, 'entitat', v_ent,
                           'recollida_at', c.data_hora_recollida, 'excedente_id', ex.id,
                           'kg_assignats', c.kg_confirmados,
                           'diferencia', coalesce(v_dif, false)));
    end if;

    perform set_config('redestina.validacio_recollida', coalesce(v_ctx, ''), true);

    return jsonb_build_object(
      'albara_id', null, 'albara', null, 'tipus', null, 'estat', null,
      'rec', null,
      'kg_reals', v_kg, 'kg_assignats', v_assig, 'kg_declarats', v_decl,
      'conciliat', true,
      'esperant_altres', false,
      'sense_albara', true);
  end if;

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

  if v_rec_propi then
    -- ═══ (C) DONACIÓN CON SU PROPIO REC: emitido con los kilos validados y confirmado ═══
    if r.estado in ('borrador', 'emitido', 'entregado') then
      if r.estado = 'borrador' then
        v_rep := public.repartir_kg_linies(r.id, v_kg);
        update albaran_lineas l
           set kg_bruto = (x->>'kg')::numeric,
               tara_kg  = 0,
               kg_neto  = (x->>'kg')::numeric
          from jsonb_array_elements(v_rep) x
         where l.albaran_id = r.id and l.id = (x->>'linea_id')::uuid;
        perform public.emitir_albaran(r.id, jsonb_build_object('fecha_hora', v_data), null, null);
        perform public.marcar_entregado(r.id);
      elsif r.estado = 'emitido' then
        perform public.marcar_entregado(r.id);
      end if;

      v_claims := current_setting('request.jwt.claims', true);
      v_sub    := current_setting('request.jwt.claim.sub', true);
      perform set_config('request.jwt.claims', '', true);
      perform set_config('request.jwt.claim.sub', '', true);
      v_ok := public.confirmar_part_declarada(
        r.id, 'entrega', v_kg, c.recollida_registrada_per, v_nom_rec, v_carrec_ent,
        v_data,
        case when v_inc ? 'tipus' then v_inc end,
        v_extra || jsonb_build_object('declaracio_receptor', not v_assistida, 'canalitzacio_id', c.id),
        v_canal);
      perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
      select * into r from albaranes where id = r.id;
    end if;
    v_falten := false;
  elsif r.id is not null then
    -- ═══ LO HEREDADO: el REC de la oferta, cuando ya no le falta ninguna salida ═══
    -- 20270608100200: una canalización ya `conciliada` (p. ej. una venta validada sin albarán en
    -- una oferta mixta) no tiene salida que confirmar y no hace esperar al REC.
    select exists (
      select 1 from canalizaciones c2
       where c2.excedente_id = c.excedente_id and c2.estado not in ('anulada', 'conciliada')
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
  --     con su motivo o «Validat per l'equip». Con REC propio, conciliar el REC arrastra su ENT
  --     (`albarans_germans_rec`) y el ENT escribe la canalización.
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
  -- Si el REC se concilió pero su ENT no estaba confirmado (no debería pasar), se dice la verdad.
  if v_rec_propi and s.estado <> 'conciliado' then
    v_conc := false;
  end if;

  perform set_config('redestina.validacio_recollida', coalesce(v_ctx, ''), true);

  return jsonb_build_object(
    'albara_id', s.id, 'albara', s.numero_completo, 'tipus', s.tipo, 'estat', s.estado,
    'rec', case when r.id is not null then jsonb_build_object('id', r.id, 'numero', r.numero_completo, 'estat', r.estado) end,
    'kg_reals', v_kg, 'kg_assignats', v_assig, 'kg_declarats', v_decl,
    'conciliat', v_conc,
    'esperant_altres', coalesce(v_falten, false),
    'sense_albara', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. `registrar_recollida_assistida`: la foto también puede colgar de la canalización
-- ---------------------------------------------------------------------------
create or replace function public.registrar_recollida_assistida(
  p_canalizacion uuid, p_resultat text, p_kg_reals numeric default null,
  p_data timestamptz default null, p_observacions text default null,
  p_motiu text default null, p_foto uuid default null)
returns jsonb
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
  -- La foto, si la hay, ya está subida como documento externo de ESTA entrega: de uno de sus
  -- albaranes o (20270608100200) de la propia canalización —una venta o maquila no tiene albarán—.
  if p_foto is not null and not exists (
       select 1 from documentos_externos x
        where x.id = p_foto
          and ((x.objeto_tipo = 'albaran'
                and x.objeto_id in (select a.id from albaranes a where a.canalizacion_id = c.id))
            or (x.objeto_tipo = 'canalizacion' and x.objeto_id = c.id))) then
    raise exception 'foto_aliena' using errcode = '22023';
  end if;

  perform public.registrar_recollida_escriu(p_canalizacion, p_resultat, p_kg_reals, p_data,
                                            p_observacions, auth.uid(), 'equip');
  v_val := public.validar_recollida(p_canalizacion, null, v_mot);
  return v_val || jsonb_build_object('registrada_per', 'equip');
end;
$$;
