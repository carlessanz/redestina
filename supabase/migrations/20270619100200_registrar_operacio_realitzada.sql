-- «Registrar operació realitzada» (proceso 3.7 del cliente; fase 5 del plan de noviembre de 2026),
-- 3 de 4: la RPC `registrar_operacio_realitzada()`.
--
-- El equipo (Superadmin y Dinamitzador = `pot_aprovar()`) registra A POSTERIORI una operación que
-- ya ocurrió fuera del circuito (sin publicar → interés → asignación → recogida): ofertante,
-- producto (+ variedad), kg reales recogidos, FECHA de la operación, lugar, tipo de operación
-- (excedent / espigolada), modalidad y destinatarios (una o varias entidades con sus kg). Lo que
-- sobra de los kg recogidos va a destinos finales (`destins_finals`, como `DestiFinal`).
--
-- TODO EN UNA TRANSACCIÓN, reutilizando las puertas del ciclo normal (nada se duplica):
--   1. la oferta (`excedentes`, `origen = 'registre'`, nace `publicada`: `trg_excedentes_validacio`
--      no manda a validación ese origen), con `id_excedente` del día de la operación;
--   2. por destinatario, `assignar_directe()` (compatibilidad modalidad/receptor, P8, entidad
--      activa, convenio de la entidad, precio acordado y aceptado en venta) SIN hora prevista;
--   3. el precio de la canalización con el MES DE LA OPERACIÓN (D2: el mes del albarán; el
--      trigger de alta lo había calculado con el mes de hoy);
--   4. por canalización, `registrar_recollida_escriu()` (`coincideix`, origen `equip`, fecha real
--      = la de la operación) y `validar_recollida()`: donación → su ENT y su REC emitidos con esa
--      fecha (ejercicio y número de esa fecha) y conciliados; venta/maquila → conciliada sin
--      albarán. `trg_canalizaciones_data_real` deja `data_hora_recollida` = fecha de la operación;
--   5. el sobrante, `registrar_desti_final()` con la fecha de la operación;
--   6. la oferta queda `cerrada` (los kg cuadran por construcción; lo deciden los triggers de
--      siempre y `recalcula_estat_excedent()`).
--
-- Indicador de transacción `redestina.registre_posteriori = 'on'` (20270619100100): silencia TODOS
-- los avisos (`crear_avis`) y salta `data_anterior` en `registrar_recollida_escriu`. Se fija tras
-- las validaciones y se restaura al final.
--
-- Reglas (todas 22023 salvo el permiso y el convenio):
--   · 42501 si no hay sesión o no es `pot_aprovar()` (ANTES que nada; `validar_recollida` exige la
--     identidad de quien valida, así que `service_role` tampoco: la Edge Function, si la hay,
--     llama con el JWT del usuario).
--   · `modalitat_invalida`, `espigolada_nomes_donacio`, `kg_invalids`, `cal_data`, `data_futura`
--     (fecha posterior a hoy en Madrid, o `p_hora` aún por llegar hoy), `fora_exercici` (fuera del
--     ejercicio en curso), `productor_inexistent`, `producte_desconegut`, `ubicacio_aliena`,
--     `observacions_llargues`, `cal_destinatari`, `destinatari_invalid`, `entitat_repetida`,
--     `entitat_inexistent`, `cal_preu_acordat`, `preu_invalid`, `destins_invalids`,
--     `desti_desconegut`, `kg_no_quadren` (destinatarios + destinos ≠ kg recogidos),
--     `periode_certificat` (la fecha cae en un periodo ya certificado del donante —CD de periodo o
--     anual con número— o de una entidad receptora —CR con número—), `id_excedent_invalid`,
--     `id_excedent_ocupat`. Y las de las puertas reutilizadas (`entitat_inactiva`, «no encaixa amb
--     el tipus de receptor», `subcausa_invalida`…).
--   · `42501 sense_conveni` (de `exigir_convenio`, como en todo el ciclo) si el productor o una
--     entidad no tienen convenio vigente para esa modalidad.
--
-- El identificador `E-AAMMDD-XXX-YYY-N`: si llega `p_id_excedente` (lo genera el servidor con
-- `generarId()` de `_shared/oferta.ts` y la FECHA DE LA OPERACIÓN) se valida su forma y que
-- AAMMDD sea esa fecha; si no llega, se genera aquí con la misma regla: `siglas_oferta()` (paridad
-- con `siglas()` de `_shared/oferta.ts`) y `siguiente_numero(prefijo, año)` dentro de esta
-- transacción. Un `id_excedente` ya usado da `23505` (el servidor reintenta, como en el alta).

-- ---------------------------------------------------------------------------
-- 1. `siglas_oferta()`: las tres letras del identificador (interna)
-- ---------------------------------------------------------------------------
-- Paridad con `siglas()` de `supabase/functions/_shared/oferta.ts`: NFD, fuera todo lo que no sea
-- A-Z/a-z (los diacríticos combinantes incluidos), mayúsculas, tres primeras, relleno con X.
create or replace function public.siglas_oferta(p_texto text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select rpad(upper(left(regexp_replace(normalize(coalesce(p_texto, ''), NFD), '[^A-Za-z]', '', 'g'), 3)),
              3, 'X');
$$;
revoke execute on function public.siglas_oferta(text) from public, anon, authenticated;

comment on function public.siglas_oferta(text) is
  'Interna (20270619100200): las tres letras de id_excedente, en paridad con siglas() de _shared/oferta.ts.';

-- ---------------------------------------------------------------------------
-- 2. `registrar_operacio_realitzada()`
-- ---------------------------------------------------------------------------
-- p_destinataris: [ { "entidad_id": uuid, "kg": numeric > 0, "preu_kg": numeric >= 0 (solo y
--                     obligatorio en venda), "caixes": integer (opcional) } … ]  (al menos uno)
-- p_destins:      [ { "desti": destins_finals.codi, "kg": numeric > 0, "receptor": text ≤ 200,
--                     "notes": text ≤ 400 } … ]  (opcional; la fecha es la de la operación)
-- Devuelve: { excedente_id, id_excedente, estado, data, data_hora, kg_total, kg_destinataris,
--             kg_destins, canalitzacions: [ { canalizacion_id, entidad_id, kg, conciliat,
--             sense_albara, albara: {id, numero, estat} | null, rec: {id, numero, estat} | null } ] }
drop function if exists public.registrar_operacio_realitzada(
  uuid, text, numeric, date, text, jsonb, jsonb, text, uuid, boolean, text, time, numeric, text, text, text);

create function public.registrar_operacio_realitzada(
  p_productor     uuid,
  p_producto      text,
  p_kg            numeric,
  p_data          date,
  p_modalitat     text,
  p_destinataris  jsonb,
  p_destins       jsonb   default '[]'::jsonb,
  p_variedad      text    default null,
  p_ubicacion     uuid    default null,
  p_espigolada    boolean default false,
  p_subcausa      text    default null,
  p_hora          time    default null,
  p_coste_kg      numeric default null,
  p_observacions  text    default null,
  p_id_excedente  text    default null,
  p_texto_oferta  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_prev    text := current_setting('redestina.registre_posteriori', true);
  v_hoy     date := (now() at time zone 'Europe/Madrid')::date;
  v_mod     text := lower(nullif(btrim(coalesce(p_modalitat, '')), ''));
  v_esp     boolean := coalesce(p_espigolada, false);
  v_obs     text := nullif(btrim(coalesce(p_observacions, '')), '');
  v_kg      numeric;
  v_quan    timestamptz;
  v_mes     date;
  pr        productores%rowtype;
  v_prod    text;
  v_fam     text;
  v_eur     numeric;
  v_ubi     uuid;
  v_dest    jsonb := p_destinataris;
  v_dsts    jsonb := coalesce(p_destins, '[]'::jsonb);
  v_item    jsonb;
  v_ent     uuid;
  v_kgi     numeric;
  v_preu    numeric;
  v_caixes  integer;
  v_codi    text;
  v_kg_dest numeric := 0;
  v_kg_dsts numeric := 0;
  v_ents    uuid[] := '{}';
  v_linies  jsonb := '[]'::jsonb;
  v_dsts2   jsonb := '[]'::jsonb;
  v_nom     text;
  v_id      text;
  v_pref    text;
  v_n       integer;
  v_ex      uuid;
  c         canalizaciones%rowtype;
  v_val     record;
  v_canals  uuid[] := '{}';
  v_c       uuid;
  v_r       jsonb;
  v_res     jsonb := '[]'::jsonb;
  v_estat   text;
begin
  -- (0) Permiso ANTES que nada (y antes que la existencia de lo que llegue).
  if v_user is null or not public.pot_aprovar() then
    raise exception 'Nomes l''equip pot registrar una operacio ja realitzada' using errcode = '42501';
  end if;

  -- (1) Lo escalar.
  if v_mod is null or v_mod not in ('donacio', 'venda', 'maquila') then
    raise exception 'modalitat_invalida: %', coalesce(p_modalitat, '(cap)') using errcode = '22023';
  end if;
  if v_esp and v_mod <> 'donacio' then
    raise exception 'espigolada_nomes_donacio: una espigolada nomes pot ser donacio' using errcode = '22023';
  end if;
  if p_kg is null or p_kg <= 0 or p_kg > 1000000 then
    raise exception 'kg_invalids: els kg recollits han de ser mes que 0' using errcode = '22023';
  end if;
  v_kg := round(p_kg, 2);
  if p_data is null then
    raise exception 'cal_data: cal la data de l''operacio' using errcode = '22023';
  end if;
  if p_data > v_hoy then
    raise exception 'data_futura: l''operacio no pot ser posterior a avui' using errcode = '22023';
  end if;
  if extract(year from p_data) <> extract(year from v_hoy) then
    raise exception 'fora_exercici: nomes es poden registrar operacions de l''exercici %',
      extract(year from v_hoy)::int using errcode = '22023';
  end if;
  v_quan := (p_data + coalesce(p_hora, time '12:00')) at time zone 'Europe/Madrid';
  if v_quan > now() then
    if p_hora is not null then
      raise exception 'data_futura: l''hora de l''operacio encara no ha arribat' using errcode = '22023';
    end if;
    v_quan := now();   -- hoy sin hora: ahora
  end if;
  v_mes := date_trunc('month', p_data)::date;
  if v_obs is not null and char_length(v_obs) > 1000 then
    raise exception 'observacions_llargues: com a maxim 1000 caracters' using errcode = '22023';
  end if;
  if p_coste_kg is not null and p_coste_kg <= 0 then
    raise exception 'preu_invalid: el cost per kg ha de ser mes que 0' using errcode = '22023';
  end if;

  -- (2) El ofertante, el producto y el lugar.
  select * into pr from productores where id = p_productor;
  if pr.id is null then
    raise exception 'productor_inexistent' using errcode = '22023';
  end if;
  v_nom := coalesce(nullif(btrim(pr.empresa), ''), pr.name, '(ofertant)');
  select p.nombre, p.familia, p.eur_kg into v_prod, v_fam, v_eur
    from productos p where p.nombre = btrim(coalesce(p_producto, ''));
  if v_prod is null then
    raise exception 'producte_desconegut: %', coalesce(p_producto, '(cap)') using errcode = '22023';
  end if;
  if p_ubicacion is not null then
    if not exists (select 1 from productor_ubicaciones u
                    where u.id = p_ubicacion and u.productor_id = p_productor) then
      raise exception 'ubicacio_aliena: el lloc no es d''aquest ofertant' using errcode = '22023';
    end if;
    v_ubi := p_ubicacion;
  else
    select u.id into v_ubi from productor_ubicaciones u
     where u.productor_id = p_productor
     order by u.es_principal desc nulls last, u.id
     limit 1;
  end if;

  -- (3) Los destinatarios.
  if v_dest is null or jsonb_typeof(v_dest) <> 'array' or jsonb_array_length(v_dest) = 0 then
    raise exception 'cal_destinatari: cal almenys una entitat destinataria' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(v_dest) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'destinatari_invalid' using errcode = '22023';
    end if;
    begin
      v_ent    := nullif(v_item->>'entidad_id', '')::uuid;
      v_kgi    := nullif(v_item->>'kg', '')::numeric;
      v_preu   := nullif(v_item->>'preu_kg', '')::numeric;
      v_caixes := nullif(v_item->>'caixes', '')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'destinatari_invalid: %', v_item::text using errcode = '22023';
    end;
    if v_ent is null then
      raise exception 'destinatari_invalid: falta entidad_id' using errcode = '22023';
    end if;
    if v_ent = any(v_ents) then
      raise exception 'entitat_repetida: cada entitat un cop' using errcode = '22023';
    end if;
    if not exists (select 1 from entidades e where e.id = v_ent) then
      raise exception 'entitat_inexistent' using errcode = '22023';
    end if;
    if v_kgi is null or v_kgi <= 0 or v_kgi > 1000000 then
      raise exception 'kg_invalids: els kg de cada entitat han de ser mes que 0' using errcode = '22023';
    end if;
    if v_caixes is not null and v_caixes < 0 then
      raise exception 'destinatari_invalid: caixes negatives' using errcode = '22023';
    end if;
    if v_mod = 'venda' then
      if v_preu is null then
        raise exception 'cal_preu_acordat: una venda necessita el preu acordat' using errcode = '22023';
      end if;
      if v_preu < 0 then
        raise exception 'preu_invalid: el preu no pot ser negatiu' using errcode = '22023';
      end if;
    else
      v_preu := null;
    end if;
    v_ents    := v_ents || v_ent;
    v_kg_dest := v_kg_dest + round(v_kgi, 2);
    v_linies  := v_linies || jsonb_build_array(jsonb_build_object(
                   'entidad_id', v_ent, 'kg', round(v_kgi, 2), 'preu', v_preu, 'caixes', v_caixes));
  end loop;

  -- (4) Los destinos finales del sobrante.
  if jsonb_typeof(v_dsts) <> 'array' then
    raise exception 'destins_invalids' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(v_dsts) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'destins_invalids' using errcode = '22023';
    end if;
    v_codi := v_item->>'desti';
    if not exists (select 1 from destins_finals f where f.codi = v_codi and f.actiu) then
      raise exception 'desti_desconegut: %', coalesce(v_codi, '(cap)') using errcode = '22023';
    end if;
    begin
      v_kgi := nullif(v_item->>'kg', '')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'destins_invalids: %', v_item::text using errcode = '22023';
    end;
    if v_kgi is null or v_kgi <= 0 then
      raise exception 'kg_invalids: els kg de cada desti han de ser mes que 0' using errcode = '22023';
    end if;
    v_kg_dsts := v_kg_dsts + round(v_kgi, 2);
    v_dsts2 := v_dsts2 || jsonb_build_array(jsonb_build_object(
                 'desti', v_codi, 'kg', round(v_kgi, 2), 'data', p_data,
                 'receptor', v_item->>'receptor', 'notes', v_item->>'notes'));
  end loop;

  if v_kg_dest + v_kg_dsts <> v_kg then
    raise exception 'kg_no_quadren: entitats (% kg) + destins (% kg) no sumen els % kg recollits',
      v_kg_dest, v_kg_dsts, v_kg using errcode = '22023';
  end if;

  -- (5) Periodos ya certificados: del donante (CD de periodo o anual con número) y de las
  --     entidades (CR con número). Cuentan los dos modos: mientras los datos de la Fundació sean
  --     provisionales todo se certifica en `prueba`, y un certificado emitido no recoge lo que se
  --     añada después.
  if exists (select 1 from cierres_periodo cp
              where cp.productor_id = p_productor and cp.abast = 'periode'
                and cp.certificado_numero is not null
                and p_data between cp.periodo_desde and cp.periodo_hasta)
     or exists (select 1 from cierres_donante cd
                  join cierres_ejercicio ce on ce.id = cd.cierre_id
                 where cd.productor_id = p_productor
                   and ce.ejercicio = extract(year from p_data)::int
                   and cd.certificado_numero is not null) then
    raise exception 'periode_certificat: % ja te un certificat emes que cobreix el %', v_nom, p_data
      using errcode = '22023';
  end if;
  if exists (select 1 from cierres_receptor cr
              where cr.entidad_id = any(v_ents)
                and cr.certificado_numero is not null
                and p_data between cr.periodo_desde and cr.periodo_hasta) then
    raise exception 'periode_certificat: una entitat destinataria ja te el certificat de recepcio que cobreix el %',
      p_data using errcode = '22023';
  end if;

  -- (6) Convenios: el del ofertante aquí; el de cada entidad, en `comprova_interes` (dentro de
  --     `assignar_directe`). Tras la fecha de corte, `42501 sense_conveni`.
  perform public.exigir_convenio('productor', p_productor, v_mod, 'entrega');

  -- (7) El identificador.
  if p_id_excedente is not null then
    v_id := btrim(p_id_excedente);
    if v_id !~ '^E-[0-9]{6}-[A-Z]{3}-[A-Z]{3}-[1-9][0-9]*$'
       or substr(v_id, 3, 6) <> to_char(p_data, 'YYMMDD') then
      raise exception 'id_excedent_invalid: % (ha de ser E-%-XXX-YYY-N)', v_id, to_char(p_data, 'YYMMDD')
        using errcode = '22023';
    end if;
  else
    v_pref := 'E-' || to_char(p_data, 'YYMMDD') || '-' || public.siglas_oferta(v_nom)
              || '-' || public.siglas_oferta(v_prod);
    -- El contador no conoce los id de antes de existir (se numeraban contando filas): se salta
    -- el que ya esté usado (consulta exacta por el índice único, no un conteo).
    for i in 1..5 loop
      v_n  := public.siguiente_numero(v_pref, extract(year from p_data)::int);
      v_id := v_pref || '-' || v_n;
      exit when not exists (select 1 from excedentes e where e.id_excedente = v_id);
      v_id := null;
    end loop;
    if v_id is null then
      raise exception 'id_excedent_ocupat: %', v_pref using errcode = '22023';
    end if;
  end if;

  -- ═══ Desde aquí se escribe: sin avisos y sin el límite `data_anterior` ═══
  perform set_config('redestina.registre_posteriori', 'on', true);

  -- (8) La oferta.
  insert into excedentes (
    id_excedente, productor_id, ubicacion_id, familia, producto, variedad, kg_total,
    modalitat, modalitats, subcausa_codigo, disponible_desde, disponible_hasta,
    observacions, texto_oferta, valor_eur, coste_kg, estado, origen,
    producte_al_camp, espigolada_demanada, validada_at, validada_per)
  values (
    v_id, p_productor, v_ubi, v_fam, v_prod, nullif(btrim(coalesce(p_variedad, '')), ''), v_kg,
    v_mod, array[v_mod], nullif(btrim(coalesce(p_subcausa, '')), ''), p_data, p_data,
    v_obs, nullif(btrim(coalesce(p_texto_oferta, '')), ''), v_kg * coalesce(v_eur, 1), p_coste_kg,
    'publicada', 'registre',
    v_esp, v_esp, now(), v_user)
  returning id into v_ex;

  -- (9) Una asignación aprobada por destinatario (las reglas de siempre) y el precio del mes de
  --     la operación.
  for v_item in select * from jsonb_array_elements(v_linies) loop
    c := public.assignar_directe(
           v_ex, (v_item->>'entidad_id')::uuid, (v_item->>'kg')::numeric, v_mod, null,
           nullif(v_item->>'caixes', '')::integer, nullif(v_item->>'preu', '')::numeric,
           v_mod = 'venda', 'Operacio registrada a posteriori');

    if c.preu_mes_albara is distinct from v_mes then
      select * into v_val from public.valoracio_canalitzacio(v_ex, v_mes);
      perform set_config('redestina.ajust_preus', 'on', true);
      perform set_config('redestina.motiu_preu', 'registre_posteriori', true);
      update canalizaciones
         set preu_mes_albara  = v_mes,
             coste_kg         = v_val.coste_kg,
             preu_font        = v_val.font,
             preu_mes_font    = v_val.mes_font,
             preu_font_dies   = v_val.dies,
             preu_provisional = coalesce(v_val.provisional, true)
       where id = c.id;
      perform set_config('redestina.motiu_preu', '', true);
      perform set_config('redestina.ajust_preus', 'off', true);
    end if;
    v_canals := v_canals || c.id;
  end loop;

  -- (10) La recogida: registrada por el equipo con la fecha real y validada (emite y concilia).
  foreach v_c in array v_canals loop
    perform public.registrar_recollida_escriu(v_c, 'coincideix', null, v_quan, null, v_user, 'equip');
    v_r := public.validar_recollida(v_c, null, 'Operacio registrada a posteriori');
    select v_res || jsonb_build_array(jsonb_build_object(
             'canalizacion_id', cc.id, 'entidad_id', cc.entidad_id, 'kg', cc.kg_conciliados,
             'estado', cc.estado, 'conciliat', coalesce((v_r->>'conciliat')::boolean, false),
             'sense_albara', coalesce((v_r->>'sense_albara')::boolean, false),
             'albara', case when v_r->>'albara_id' is not null then jsonb_build_object(
                         'id', v_r->>'albara_id', 'numero', v_r->>'albara', 'estat', v_r->>'estat') end,
             'rec', v_r->'rec'))
      into v_res
      from canalizaciones cc where cc.id = v_c;
  end loop;

  -- (11) El sobrante, a sus destinos finales.
  if jsonb_array_length(v_dsts2) > 0 then
    perform public.registrar_desti_final(v_ex, v_dsts2);
  end if;

  perform public.recalcula_estat_excedent(v_ex);
  select e.estado into v_estat from excedentes e where e.id = v_ex;

  perform set_config('redestina.registre_posteriori', coalesce(v_prev, ''), true);

  return jsonb_build_object(
    'excedente_id', v_ex, 'id_excedente', v_id, 'estado', v_estat,
    'data', p_data, 'data_hora', v_quan, 'kg_total', v_kg,
    'kg_destinataris', v_kg_dest, 'kg_destins', v_kg_dsts,
    'canalitzacions', v_res);
end;
$$;

revoke execute on function public.registrar_operacio_realitzada(
  uuid, text, numeric, date, text, jsonb, jsonb, text, uuid, boolean, text, time, numeric, text, text, text)
  from public, anon;
grant execute on function public.registrar_operacio_realitzada(
  uuid, text, numeric, date, text, jsonb, jsonb, text, uuid, boolean, text, time, numeric, text, text, text)
  to authenticated, service_role;

comment on function public.registrar_operacio_realitzada(
  uuid, text, numeric, date, text, jsonb, jsonb, text, uuid, boolean, text, time, numeric, text, text, text) is
  'Proceso 3.7 (20270619100200): el equipo (pot_aprovar) registra a posteriori una operación ya realizada, '
  'en una transacción: oferta origen=registre → asignación por destinatario → recogida registrada y validada '
  'con la fecha real (ENT+REC o conciliada sin albarán) → destinos del sobrante → cerrada. Sin avisos '
  '(redestina.registre_posteriori). Solo el ejercicio en curso; nunca en un periodo certificado.';
