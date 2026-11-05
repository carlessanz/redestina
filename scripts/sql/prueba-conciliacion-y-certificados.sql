-- Prueba de punta a punta del circuito confirmación → conciliación → cierre (07-10-2026).
--
-- ⚠️ SOLO CONTRA EL CLON LOCAL, y siempre dentro de UNA transacción que acaba en ROLLBACK:
--    consume números de series legales (REC/ENT/OPE) y crea fichas, ofertas y un cierre de
--    prueba, y el rollback lo devuelve todo —también las peticiones a `pg_net`, que solo se
--    envían cuando la fila de la cola se confirma—. No deja rastro.
--
--   docker exec -i supabase_db_Redestina psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 \
--     < scripts/sql/prueba-conciliacion-y-certificados.sql
--
-- Corre como `postgres`, o sea sin `auth.uid()`: es el camino de `service_role` de las RPC.
-- Cada comprobación es un `raise exception` si falla; si llega al final, dice «TOT CORRECTE».
--
-- Qué recorre (migraciones 20270414100000…100300):
--   A. OPE de dos partes: la primera confirmación deja el albarán `entregado`; la segunda lo
--      pasa a `confirmado`; los kilos de la línea son los de la parte que RECIBE aunque
--      confirme primero; un rechazo de quien entrega se conserva; una parte no confirma dos
--      veces.
--   B. Donación con cascada (confirma la entidad y luego se concilia el REC) y donación con
--      conciliación tardía (se concilia el REC antes de que confirme la entidad, y el job
--      recoge el ENT). REC fuera de tolerancia sin motivo → 22023.
--   C. Cierre de PRUEBA (desde 20270509100400, sin CT): `calcular_cierre` ya no crea filas
--      `transaccio`; la tanda de CT responde `certificat_transaccio_retirat`; la de CD emite
--      `P-CD` con la fecha de expedición (fuera de rango → 22023) y la plantilla `CD` del
--      modelo; `datos_182` no lee filas `transaccio`; `marcar_declarado` marca el CD.
--   D. `repartir_espigolada` exige el convenio del generador.
--   E. Lo certificable (20270509100000…100300): venta, maquila, donación a entidad animal,
--      a transformadora, sin entidad, sin modalidad y un REC mixto (donación social +
--      donación animal + venta, con merma) NO entran en `cierre_base_periodo` ni en el CD y
--      salen todos en `cierre_exclosos_periodo` con su motivo; la donación social entra con
--      sus kg exactos y la del REC mixto con su parte proporcional (45 de 50, no 64,29), sin
--      tope por línea (20270509100700).
--      Ámbito oferta de `calcular_certificado_periodo` (ventana derivada, oferta ajena,
--      oferta sin nada certificable), fecha de expedición del CDP y sustitución por líneas.
--
-- ⚠️ La ficha de prueba lleva un NIF válido y LIBRE generado al vuelo (`pg_temp.nif_lliure`):
--    el NIF fijo de antes (B00000000) ya lo tenía otra organización del clon y el alta caía
--    en `nif_en_us` antes de probar nada.

begin;

-- Un NIF (CIF de sociedad, letra B) válido y que no use ninguna ficha del clon.
create function pg_temp.nif_lliure() returns text
language plpgsql as $f$
declare
  v_base text;
  v_ctl  text;
begin
  for i in 1..5000 loop
    v_base := 'B' || lpad((floor(random() * 8999999) + 1000000)::int::text, 7, '0');
    foreach v_ctl in array array['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','I','J'] loop
      if public.nif_valid(v_base || v_ctl)
         and not exists (select 1 from productores where nif = v_base || v_ctl)
         and not exists (select 1 from entidades where nif = v_base || v_ctl) then
        return v_base || v_ctl;
      end if;
    end loop;
  end loop;
  raise exception 'No trobo cap NIF lliure';
end;
$f$;

do $prueba$
declare
  v_prod   uuid;
  v_ent    uuid;
  v_ex1    uuid;  -- donación, cascada
  v_ex2    uuid;  -- donación, ENT tardío
  v_ex3    uuid;  -- venta, OPE de dos partes
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  v_rec1 uuid; v_ent1 uuid; v_rec2 uuid; v_ent2 uuid; v_ope uuid;
  v_lin  uuid;
  r      jsonb;
  v_link_e uuid; v_link_r uuid;
  a      albaranes%rowtype;
  v_ok   boolean;
  v_txt  text;
  v_n    int;
  v_cierre uuid;
  v_cd   cierres_donante%rowtype;
  v_ct   cierres_donante%rowtype;
  v_esp  uuid;
  v_exesp uuid;
  ev     jsonb := jsonb_build_object('nombre', 'Prova', 'cargo', 'Prova', 'ip', '127.0.0.1',
                                    'user_agent', 'prueba-conciliacion-y-certificados.sql',
                                    'sha256_texto', repeat('0', 64));
  lin    jsonb;
  -- E. Lo certificable
  v_hoy    date := (now() at time zone 'Europe/Madrid')::date;
  v_prod2  uuid;
  v_ent_an uuid; v_ent_tr uuid;
  v_xv uuid; v_xm uuid; v_xa uuid; v_xt uuid; v_xs uuid; v_xn uuid; v_xmix uuid; v_xsoc uuid;
  v_cv uuid; v_cm uuid; v_ca uuid; v_ct2 uuid; v_cs uuid; v_cn uuid; v_csoc uuid;
  v_cmx_soc uuid; v_cmx_an uuid; v_cmx_ven uuid;
  v_recm uuid; v_entm_soc uuid; v_entm_an uuid;
  v_kg   numeric;
  v_motius text[];
  v_cp   cierres_periodo%rowtype;
  v_cp2  cierres_periodo%rowtype;
  v_doc  jsonb;
begin
  -- Desde 20270428100000 los albaranes de una recogida solo se emiten dentro del contexto
  -- que fija `validar_recollida()` (candado `recollida_no_validada`). Aquí se prueba el
  -- circuito de albaranes a mano, así que se fija ese mismo contexto, local a esta
  -- transacción (que acaba en ROLLBACK).
  perform set_config('redestina.validacio_recollida', 'on', true);

  -- ------------------------------------------------------------------ fichas
  insert into productores (name, empresa, email, nif, direccion, codigo_postal, poblacion, es_test)
  values ('Prova E2E', 'Prova E2E Cascada SL', 'prova-e2e-prod@example.invalid',
          pg_temp.nif_lliure(), 'Carrer de Prova 1', '08001', 'Barcelona', true)
  returning id into v_prod;
  update productores set razon_social = empresa where id = v_prod;
  -- Inactiva: activar exige NIF y razón social (trg_fitxa_estat), y al certificado no le
  -- importa el estado de la ficha de la entidad, solo su `tipo_receptor`.
  insert into entidades (nombre, email, es_test, tipo_receptor, estat, activo)
  values ('Entitat Prova E2E', 'prova-e2e-ent@example.invalid', true, 'social', 'Signat', false)
  returning id into v_ent;

  -- ------------------------------------------------------------------ ofertas
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado,
                          origen, coste_kg)
  values ('E-PROVA-E2E-1', v_prod, 'Tomàquet', 100, 'donacio', 'publicada', 'asistido', 0.5)
  returning id into v_ex1;
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado,
                          origen, coste_kg)
  values ('E-PROVA-E2E-2', v_prod, 'Tomàquet', 80, 'donacio', 'publicada', 'asistido', 0.5)
  returning id into v_ex2;
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado,
                          origen, coste_kg, preu_minim)
  values ('E-PROVA-E2E-3', v_prod, 'Carbassó', 50, 'venda', 'publicada', 'asistido', 0.7, 0.3)
  returning id into v_ex3;

  -- Las canalizaciones van directas (no por `aprovar_resposta`, que exigiría convenios):
  -- lo que se prueba aquí empieza en el trigger que crea los albaranes.
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_ex1, v_ent, 100, 'donacio', 'confirmada') returning id into v_c1;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_ex2, v_ent, 80, 'donacio', 'confirmada') returning id into v_c2;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_ex3, v_ent, 50, 'venda', 'confirmada') returning id into v_c3;

  select id into v_rec1 from albaranes where tipo = 'REC' and excedente_id = v_ex1;
  select id into v_ent1 from albaranes where tipo = 'ENT' and canalizacion_id = v_c1;
  select id into v_rec2 from albaranes where tipo = 'REC' and excedente_id = v_ex2;
  select id into v_ent2 from albaranes where tipo = 'ENT' and canalizacion_id = v_c2;
  select id into v_ope  from albaranes where tipo = 'OPE' and canalizacion_id = v_c3;
  if v_rec1 is null or v_ent1 is null or v_rec2 is null or v_ent2 is null or v_ope is null then
    raise exception 'FALLA: el trigger no ha creat els albarans esperats';
  end if;
  if exists (select 1 from albaranes where tipo = 'REC' and excedente_id = v_ex3) then
    raise exception 'FALLA: una venda no hauria de tenir REC';
  end if;

  -- Emitir y entregar los cinco.
  perform public.emitir_albaran(v_rec1, null, jsonb_build_array(jsonb_build_object(
    'producto', 'Tomàquet', 'kg_neto', 100, 'kg_previstos', 100)), 'ca');
  perform public.emitir_albaran(v_ent1, null, jsonb_build_array(jsonb_build_object(
    'producto', 'Tomàquet', 'kg_neto', 100, 'kg_previstos', 100)), 'ca');
  perform public.emitir_albaran(v_rec2, null, jsonb_build_array(jsonb_build_object(
    'producto', 'Tomàquet', 'kg_neto', 80, 'kg_previstos', 80)), 'ca');
  perform public.emitir_albaran(v_ent2, null, jsonb_build_array(jsonb_build_object(
    'producto', 'Tomàquet', 'kg_neto', 80, 'kg_previstos', 80)), 'ca');
  perform public.emitir_albaran(v_ope, null, jsonb_build_array(jsonb_build_object(
    'producto', 'Carbassó', 'kg_neto', 50, 'kg_previstos', 50)), 'ca');
  perform public.marcar_entregado(v_rec1);
  perform public.marcar_entregado(v_ent1);
  perform public.marcar_entregado(v_rec2);
  perform public.marcar_entregado(v_ent2);
  r := public.marcar_entregado(v_ope);
  if jsonb_array_length(r->'enllacos') <> 2 then
    raise exception 'FALLA: l''OPE hauria de tenir 2 enllaços, en té %', jsonb_array_length(r->'enllacos');
  end if;

  -- ================================================================== A. OPE dos partes
  select id into v_link_e from enlaces_token
   where objeto_id = v_ope and proposito = 'confirmacion_albaran' and rol_parte = 'entrega';
  select id into v_link_r from enlaces_token
   where objeto_id = v_ope and proposito = 'confirmacion_albaran' and rol_parte = 'recibe';
  select id into v_lin from albaran_lineas where albaran_id = v_ope;

  -- Primero RECIBE: 48 kg.
  a := public.registrar_confirmacion(v_link_r,
         jsonb_build_object('kg_confirmados', jsonb_build_array(jsonb_build_object('linea_id', v_lin, 'kg', 48)),
                            'rechazo', 'cap'), ev);
  if a.estado <> 'entregado' or a.confirmado_at is not null then
    raise exception 'FALLA A1: després de la primera part l''OPE hauria de seguir entregat (és %)', a.estado;
  end if;
  if (select kg_confirmados from albaran_lineas where id = v_lin) <> 48 then
    raise exception 'FALLA A2: els kg de qui rep no s''han escrit';
  end if;

  -- La misma parte otra vez, con un enlace nuevo: PT409.
  insert into enlaces_token (proposito, objeto_tipo, objeto_id, rol_parte, token_hash, caduca_at, canal)
  values ('confirmacion_albaran', 'albaran', v_ope, 'recibe', md5(random()::text), now() + interval '1 day', 'asistido')
  returning id into v_link_r;
  v_ok := false;
  begin
    perform public.registrar_confirmacion(v_link_r, '{"rechazo":"cap"}'::jsonb, ev);
  exception when sqlstate 'PT409' then v_ok := true;
  end;
  if not v_ok then raise exception 'FALLA A3: una part ha pogut confirmar dues vegades'; end if;
  update enlaces_token set estado = 'revocado' where id = v_link_r;

  -- Después ENTREGA: dice 50 kg y un rechazo parcial. La línea se queda con 48 (manda
  -- quien recibe) y el rechazo se conserva.
  a := public.registrar_confirmacion(v_link_e,
         jsonb_build_object('kg_confirmados', jsonb_build_array(jsonb_build_object('linea_id', v_lin, 'kg', 50)),
                            'rechazo', 'parcial', 'motivo_rechazo', 'Prova: 2 kg tornats'), ev);
  if a.estado <> 'confirmado' or a.confirmado_at is null then
    raise exception 'FALLA A4: amb les dues parts l''OPE hauria d''estar confirmat (és %)', a.estado;
  end if;
  if (select kg_confirmados from albaran_lineas where id = v_lin) <> 48 then
    raise exception 'FALLA A5: qui entrega ha trepitjat els kg de qui rep';
  end if;
  if a.rechazo <> 'parcial' or a.motivo_rechazo is null then
    raise exception 'FALLA A6: el rebuig de qui entrega no s''ha conservat (%, %)', a.rechazo, a.motivo_rechazo;
  end if;
  select count(*) into v_n from evidencias ev2 join enlaces_token t on t.id = ev2.enlace_id
   where t.objeto_id = v_ope and ev2.tipo = 'confirmacion';
  if v_n <> 2 then raise exception 'FALLA A7: hi hauria d''haver 2 evidències, n''hi ha %', v_n; end if;
  raise notice 'A: OPE de dues parts correcte (entregat → confirmat, 48 kg, rebuig parcial conservat)';

  -- ================================================================== B. Conciliación
  -- B1. ENT confirmado primero, después el REC; conciliar el REC arrastra el ENT.
  select id into v_lin from albaran_lineas where albaran_id = v_rec1;
  perform public.registrar_confirmacion(
    (select id from enlaces_token where objeto_id = v_rec1 and proposito = 'confirmacion_albaran'),
    jsonb_build_object('kg_confirmados', jsonb_build_array(jsonb_build_object('linea_id', v_lin, 'kg', 100)), 'rechazo', 'cap'), ev);
  select id into v_lin from albaran_lineas where albaran_id = v_ent1;
  perform public.registrar_confirmacion(
    (select id from enlaces_token where objeto_id = v_ent1 and proposito = 'confirmacion_albaran'),
    jsonb_build_object('kg_confirmados', jsonb_build_array(jsonb_build_object('linea_id', v_lin, 'kg', 99)), 'rechazo', 'cap'), ev);
  perform public.conciliar_albaran(v_rec1, null, null, null);
  if (select estado from albaranes where id = v_ent1) <> 'conciliado' then
    raise exception 'FALLA B1: conciliar el REC no ha conciliat l''ENT confirmat';
  end if;
  if (select estado from canalizaciones where id = v_c1) <> 'conciliada'
     or (select coste_kg from canalizaciones where id = v_c1) is null
     or (select kg_conciliados from canalizaciones where id = v_c1) <> 99 then
    raise exception 'FALLA B2: la canalització de la cascada no ha quedat conciliada amb 99 kg i cost';
  end if;
  raise notice 'B1: cascada REC → ENT correcta (canalització conciliada, 99 kg, cost congelat)';

  -- B2. Fuera de tolerancia sin motivo: REC de 80 kg contra un ENT que dice 60.
  select id into v_lin from albaran_lineas where albaran_id = v_rec2;
  perform public.registrar_confirmacion(
    (select id from enlaces_token where objeto_id = v_rec2 and proposito = 'confirmacion_albaran'),
    jsonb_build_object('kg_confirmados', jsonb_build_array(jsonb_build_object('linea_id', v_lin, 'kg', 80)), 'rechazo', 'cap'), ev);
  -- El ENT todavía no ha confirmado: la propuesta cuenta su neto (80) y cabe en tolerancia.
  -- Para forzar el «fuera», se baja temporalmente su neto en una línea de prueba.
  update albaran_lineas set kg_neto = 60 where albaran_id = v_ent2;
  v_ok := false;
  begin
    perform public.conciliar_albaran(v_rec2, null, null, null);
  exception when sqlstate '22023' then
    get stacked diagnostics v_txt = message_text;
    v_ok := v_txt like 'fora_de_tolerancia%';
  end;
  if not v_ok then raise exception 'FALLA B3: un REC fora de tolerància s''ha conciliat sense motiu'; end if;
  update albaran_lineas set kg_neto = 80 where albaran_id = v_ent2;

  -- B3. El REC se concilia ANTES de que confirme la entidad; el ENT confirma después y lo
  --     recoge `conciliacions_automatiques()` (rama 2).
  perform public.conciliar_albaran(v_rec2, null, null, null);
  if (select estado from albaranes where id = v_ent2) <> 'entregado' then
    raise exception 'FALLA B4: un ENT sense confirmar no s''hauria d''haver conciliat';
  end if;
  select id into v_lin from albaran_lineas where albaran_id = v_ent2;
  perform public.registrar_confirmacion(
    (select id from enlaces_token where objeto_id = v_ent2 and proposito = 'confirmacion_albaran'),
    jsonb_build_object('kg_confirmados', jsonb_build_array(jsonb_build_object('linea_id', v_lin, 'kg', 80)), 'rechazo', 'cap'), ev);

  v_n := public.conciliacions_automatiques();
  if (select estado from albaranes where id = v_ent2) <> 'conciliado'
     or (select estado from canalizaciones where id = v_c2) <> 'conciliada' then
    raise exception 'FALLA B5: el job no ha conciliat l''ENT confirmat després del REC';
  end if;
  -- Y la venta (rama 3): OPE confirmado por las dos partes, sin REC.
  if (select estado from albaranes where id = v_ope) <> 'conciliado'
     or (select estado from canalizaciones where id = v_c3) <> 'conciliada'
     or (select kg_conciliados from canalizaciones where id = v_c3) <> 48 then
    raise exception 'FALLA B6: el job no ha conciliat l''OPE confirmat per les dues parts';
  end if;
  raise notice 'B2-B3: fora de tolerància exigeix motiu; ENT tardà i OPE conciliats pel job (% conciliacions)', v_n;

  -- ================================================================== E. Lo certificable
  -- 🔴 Regla (20270509100000): un certificado de donación solo acredita DONACIÓN conciliada
  --    a una entidad SOCIAL. Todo va con un donante propio (v_prod2) y en el día de hoy.
  insert into productores (name, empresa, razon_social, email, nif, direccion, codigo_postal,
                           poblacion, es_test)
  values ('Prova Certificable', 'Prova Certificable SL', 'Prova Certificable SL',
          'prova-certificable@example.invalid', pg_temp.nif_lliure(), 'Carrer de Prova 2',
          '08001', 'Barcelona', true)
  returning id into v_prod2;
  insert into entidades (nombre, email, es_test, tipo_receptor, activo)
  values ('Protectora Prova', 'prova-animal@example.invalid', true, 'animal', false)
  returning id into v_ent_an;
  insert into entidades (nombre, email, es_test, tipo_receptor, activo)
  values ('Obrador Prova', 'prova-transf@example.invalid', true, 'transformador', false)
  returning id into v_ent_tr;

  -- Una oferta por caso (sin REC conciliado: la clave del reparto es el excedente y cada
  -- línea se queda sus kg). Se concilian directamente: aquí se prueba la base de cálculo,
  -- no el circuito de albaranes (eso es B).
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen, coste_kg, preu_minim)
  values ('E-PROVA-CERT-V', v_prod2, 'Carbassó', 30, 'venda', 'publicada', 'asistido', 0.5, 0.3) returning id into v_xv;
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen, coste_kg, preu_minim)
  values ('E-PROVA-CERT-M', v_prod2, 'Carbassó', 25, 'maquila', 'publicada', 'asistido', 0.5, 0.3) returning id into v_xm;
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen, coste_kg)
  values ('E-PROVA-CERT-A', v_prod2, 'Carbassó', 20, 'donacio', 'publicada', 'asistido', 0.5) returning id into v_xa;
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen, coste_kg)
  values ('E-PROVA-CERT-T', v_prod2, 'Carbassó', 15, 'donacio', 'publicada', 'asistido', 0.5) returning id into v_xt;
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen, coste_kg)
  values ('E-PROVA-CERT-S', v_prod2, 'Carbassó', 10, 'donacio', 'publicada', 'asistido', 0.5) returning id into v_xs;
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen, coste_kg)
  values ('E-PROVA-CERT-N', v_prod2, 'Carbassó', 5, null, 'publicada', 'asistido', 0.5) returning id into v_xn;
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen, coste_kg)
  values ('E-PROVA-CERT-OK', v_prod2, 'Carbassó', 12.34, 'donacio', 'publicada', 'asistido', 0.5) returning id into v_xsoc;

  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xv, v_ent, 30, 'venda', 'confirmada') returning id into v_cv;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xm, v_ent, 25, 'maquila', 'confirmada') returning id into v_cm;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xa, v_ent_an, 20, 'donacio', 'confirmada') returning id into v_ca;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xt, v_ent_tr, 15, 'donacio', 'confirmada') returning id into v_ct2;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xs, null, 10, 'donacio', 'confirmada') returning id into v_cs;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xn, v_ent, 5, null, 'confirmada') returning id into v_cn;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xsoc, v_ent, 12.34, 'donacio', 'confirmada') returning id into v_csoc;
  if (select valorizacion from canalizaciones where id = v_cn) is not null then
    raise exception 'FALLA E0: el cas «sense valorització» ha quedat amb valorització';
  end if;

  update canalizaciones
     set estado = 'conciliada', kg_conciliados = kg_confirmados, conciliada_at = now()
   where id in (v_cv, v_cm, v_ca, v_ct2, v_cs, v_cn, v_csoc);

  -- REC MIXTO (deuda 139): una oferta de 100 kg con tres salidas —donación social 50,
  -- donación a una protectora 20 y venta 30— y una entrada (REC) de 90 kg netos. Cada
  -- línea se lleva su parte del neto (90/100): social 45, animal 18, venta 27. Antes el
  -- neto se repartía solo entre las dos donaciones y la social salía con 64,29 kg de 50.
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, modalitats,
                          estado, origen, coste_kg, preu_minim)
  values ('E-PROVA-CERT-MIX', v_prod2, 'Tomàquet', 100, 'donacio', array['donacio', 'venda'],
          'publicada', 'asistido', 0.5, 0.3)
  returning id into v_xmix;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xmix, v_ent, 50, 'donacio', 'confirmada') returning id into v_cmx_soc;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xmix, v_ent_an, 20, 'donacio', 'confirmada') returning id into v_cmx_an;
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_xmix, v_ent, 30, 'venda', 'confirmada') returning id into v_cmx_ven;

  select id into v_recm from albaranes where tipo = 'REC' and excedente_id = v_xmix;
  select id into v_entm_soc from albaranes where tipo = 'ENT' and canalizacion_id = v_cmx_soc;
  select id into v_entm_an from albaranes where tipo = 'ENT' and canalizacion_id = v_cmx_an;
  if v_recm is null or v_entm_soc is null or v_entm_an is null then
    raise exception 'FALLA E1: la oferta mixta no té REC i els dos ENT';
  end if;
  perform public.emitir_albaran(v_recm, null, jsonb_build_array(jsonb_build_object(
    'producto', 'Tomàquet', 'kg_neto', 90, 'kg_previstos', 100)), 'ca');
  perform public.emitir_albaran(v_entm_soc, null, jsonb_build_array(jsonb_build_object(
    'producto', 'Tomàquet', 'kg_neto', 50, 'kg_previstos', 50)), 'ca');
  perform public.emitir_albaran(v_entm_an, null, jsonb_build_array(jsonb_build_object(
    'producto', 'Tomàquet', 'kg_neto', 20, 'kg_previstos', 20)), 'ca');
  perform public.marcar_entregado(v_recm);
  perform public.marcar_entregado(v_entm_soc);
  perform public.marcar_entregado(v_entm_an);
  select id into v_lin from albaran_lineas where albaran_id = v_recm;
  perform public.registrar_confirmacion(
    (select id from enlaces_token where objeto_id = v_recm and proposito = 'confirmacion_albaran'),
    jsonb_build_object('kg_confirmados', jsonb_build_array(jsonb_build_object('linea_id', v_lin, 'kg', 90)), 'rechazo', 'cap'), ev);
  select id into v_lin from albaran_lineas where albaran_id = v_entm_soc;
  perform public.registrar_confirmacion(
    (select id from enlaces_token where objeto_id = v_entm_soc and proposito = 'confirmacion_albaran'),
    jsonb_build_object('kg_confirmados', jsonb_build_array(jsonb_build_object('linea_id', v_lin, 'kg', 50)), 'rechazo', 'cap'), ev);
  select id into v_lin from albaran_lineas where albaran_id = v_entm_an;
  perform public.registrar_confirmacion(
    (select id from enlaces_token where objeto_id = v_entm_an and proposito = 'confirmacion_albaran'),
    jsonb_build_object('kg_confirmados', jsonb_build_array(jsonb_build_object('linea_id', v_lin, 'kg', 20)), 'rechazo', 'cap'), ev);
  perform public.conciliar_albaran(v_recm, null, 'Prova REC mixt: la venda no te REC propi', null);
  -- La venta de la misma oferta, conciliada aparte (su OPE no es lo que se prueba aquí).
  update canalizaciones set estado = 'conciliada', kg_conciliados = 30, conciliada_at = now()
   where id = v_cmx_ven;
  if (select estado from canalizaciones where id = v_cmx_soc) <> 'conciliada'
     or (select kg_conciliados from canalizaciones where id = v_cmx_soc) <> 50
     or (select kg_conciliados from canalizaciones where id = v_cmx_an) <> 20 then
    raise exception 'FALLA E2: la cascada del REC mixt no ha conciliat les dues donacions (50 i 20)';
  end if;

  -- E3. La base de cálculo: SOLO las dos donaciones sociales, con sus kg exactos.
  select count(*), coalesce(sum(b.kg_neto), 0) into v_n, v_kg
    from public.cierre_base_periodo(v_hoy, v_hoy, 'prueba') b where b.productor_id = v_prod2;
  if v_n <> 2 or v_kg <> 57.34 then
    raise exception 'FALLA E3: la base hauria de tenir 2 línies i 57,34 kg (12,34 + 45), en té % i %', v_n, v_kg;
  end if;
  if (select b.kg_neto from public.cierre_base_periodo(v_hoy, v_hoy, 'prueba') b where b.canalizacion_id = v_csoc) <> 12.34 then
    raise exception 'FALLA E4: la donació social no entra amb els seus 12,34 kg';
  end if;
  if (select b.kg_neto from public.cierre_base_periodo(v_hoy, v_hoy, 'prueba') b where b.canalizacion_id = v_cmx_soc) <> 45 then
    raise exception 'FALLA E5: la donació social del REC mixt hauria de tenir 45 kg (90 × 50/100), en té %',
      (select b.kg_neto from public.cierre_base_periodo(v_hoy, v_hoy, 'prueba') b where b.canalizacion_id = v_cmx_soc);
  end if;
  if exists (select 1 from public.cierre_base_periodo(v_hoy, v_hoy, 'prueba') b
              where b.canalizacion_id in (v_cv, v_cm, v_ca, v_ct2, v_cs, v_cn, v_cmx_an, v_cmx_ven)) then
    raise exception 'FALLA E6: una canalització no certificable ha entrat a la base';
  end if;
  -- La invariante del reparto (20270509100700): la social se lleva 45 de los 90 del REC; los
  -- otros 45 (18 de la protectora + 27 de la venta) son de las líneas que no entran.
  if (select sum(b.kg_neto) from public.cierre_base_periodo(v_hoy, v_hoy, 'prueba') b
       where b.albaran_rec_id = v_recm) <> 45 then
    raise exception 'FALLA E7: del REC mixt només haurien d''entrar 45 kg';
  end if;
  raise notice 'E1-E7: base = 2 línies socials (12,34 + 45 kg); REC mixt repartit 45/18/27 i només entra el social';

  -- E8. Las exclusiones, con su motivo.
  select array_agg(x.motiu order by x.motiu) into v_motius
    from public.cierre_exclosos_periodo(v_prod2, v_hoy, v_hoy, null, 'prueba') x;
  if v_motius is distinct from array['entitat_no_social:animal', 'entitat_no_social:animal',
                                     'entitat_no_social:transformador', 'maquila',
                                     'sense_entitat', 'sense_valoritzacio', 'venda', 'venda'] then
    raise exception 'FALLA E8: exclusions inesperades: %', v_motius;
  end if;
  if (select x.motiu from public.cierre_exclosos_periodo(v_prod2, null, null, v_xmix, 'prueba') x
       where x.canalizacion_id = v_cmx_ven) <> 'venda'
     or (select x.motiu from public.cierre_exclosos_periodo(v_prod2, null, null, v_xmix, 'prueba') x
          where x.canalizacion_id = v_cmx_an) <> 'entitat_no_social:animal'
     or (select count(*) from public.cierre_exclosos_periodo(v_prod2, null, null, v_xmix, 'prueba')) <> 2 then
    raise exception 'FALLA E9: les exclusions de l''oferta mixta no són la venda i la protectora';
  end if;
  raise notice 'E8-E9: excloses = %', v_motius;

  -- E10. El certificado a demanda del periodo suma lo mismo que la base.
  v_cp := public.calcular_certificado_periodo(v_prod2, v_hoy, v_hoy, 'prueba');
  if v_cp.kg_total <> 57.34 or v_cp.abast <> 'periode' or v_cp.excedente_id is not null then
    raise exception 'FALLA E10: el CDP del periode hauria de ser de 57,34 kg (és %, %)', v_cp.kg_total, v_cp.abast;
  end if;

  -- E11. Ámbito oferta: ventana derivada, solo lo certificable de la oferta.
  v_cp2 := public.calcular_certificado_periodo(v_prod2, null, null, 'prueba', v_xmix);
  if v_cp2.abast <> 'oferta' or v_cp2.excedente_id <> v_xmix or v_cp2.kg_total <> 45
     or v_cp2.periodo_desde <> v_hoy or v_cp2.periodo_hasta <> v_hoy then
    raise exception 'FALLA E11: el CDP de l''oferta mixta hauria de ser de 45 kg, avui (és % kg, % — %)',
      v_cp2.kg_total, v_cp2.periodo_desde, v_cp2.periodo_hasta;
  end if;
  -- Una oferta sin nada certificable, y una oferta de otro donante.
  v_ok := false;
  begin
    perform public.calcular_certificado_periodo(v_prod2, null, null, 'prueba', v_xv);
  exception when sqlstate '22023' then
    get stacked diagnostics v_txt = message_text;
    v_ok := v_txt like 'oferta_sense_certificable%';
  end;
  if not v_ok then raise exception 'FALLA E12: una oferta de venda ha donat un certificat de donació'; end if;
  v_ok := false;
  begin
    perform public.calcular_certificado_periodo(v_prod2, null, null, 'prueba', v_ex1);
  exception when sqlstate '22023' then
    get stacked diagnostics v_txt = message_text;
    v_ok := v_txt like 'oferta_daltri_productor%';
  end;
  if not v_ok then raise exception 'FALLA E13: s''ha certificat una oferta d''un altre donant'; end if;

  -- E14. La fecha de expedición: ni antes del fin del periodo ni después de hoy.
  v_ok := false;
  begin
    perform public.emitir_certificado_periodo(v_cp2.id, null, v_hoy + 1, false);
  exception when sqlstate '22023' then
    get stacked diagnostics v_txt = message_text;
    v_ok := v_txt like 'data_expedicio_fora_rang%';
  end;
  if not v_ok then raise exception 'FALLA E14: s''ha acceptat una data d''expedició futura'; end if;
  v_ok := false;
  begin
    perform public.emitir_certificado_periodo(v_cp2.id, null, v_hoy - 1, false);
  exception when sqlstate '22023' then
    get stacked diagnostics v_txt = message_text;
    v_ok := v_txt like 'data_expedicio_fora_rang%';
  end;
  if not v_ok then raise exception 'FALLA E15: s''ha acceptat una data d''expedició anterior al final del periode'; end if;

  -- E16. Emitir el de la oferta, con anexo: el snapshot dice ámbito, fecha y anexo.
  r := public.emitir_certificado_periodo(v_cp2.id, null, null, true, v_xmix);
  if (r->>'numero') not like 'P-CDP-%' or (r->>'abast') <> 'oferta' then
    raise exception 'FALLA E16: emissió inesperada: %', r;
  end if;
  select d.datos into v_doc from documentos d where d.id = (r->>'document')::uuid;
  if v_doc->>'abast' <> 'oferta' or v_doc->>'data_expedicio' <> v_hoy::text
     or not (v_doc->>'annex')::boolean or v_doc->>'excedente_id' <> v_xmix::text
     or (v_doc->>'kg')::numeric <> 45 or jsonb_array_length(v_doc->'detall') <> 1 then
    raise exception 'FALLA E17: snapshot inesperat: %', v_doc;
  end if;
  if (select p.variante from documentos d join plantillas_documento p on p.id = d.plantilla_id
       where d.id = (r->>'document')::uuid) is distinct from 'parcial'
     or (select p.titulo from documentos d join plantillas_documento p on p.id = d.plantilla_id
          where d.id = (r->>'document')::uuid) not in ('CERTIFICAT DE DONACIÓ', 'CERTIFICADO DE DONACIÓN') then
    raise exception 'FALLA E18: el CDP no ha agafat la plantilla CD/parcial del model';
  end if;
  raise notice 'E10-E18: CDP periode 57,34 kg; CDP oferta % (45 kg, anex, data %); dates fora de rang refusades',
    r->>'numero', v_hoy;

  -- E19. El del periodo CONTIENE las líneas del de la oferta → al emitirse lo sustituye.
  v_cp := public.calcular_certificado_periodo(v_prod2, v_hoy, v_hoy, 'prueba');
  if exists (select 1 from jsonb_array_elements(v_cp.bloqueos) b where (b->>'bloqueja')::boolean) then
    raise exception 'FALLA E19: el CDP del periode no hauria d''estar bloquejat: %', v_cp.bloqueos;
  end if;
  r := public.emitir_certificado_periodo(v_cp.id);
  if (r->>'substitueix')::int <> 1
     or (select estado from cierres_periodo where id = v_cp2.id) <> 'substituit'
     or (select sustituido_por_periodo from cierres_periodo where id = v_cp2.id) <> v_cp.id then
    raise exception 'FALLA E20: el CDP del periode no ha substituït el de l''oferta: %', r;
  end if;
  if (select d.datos->>'abast' from documentos d where d.id = (r->>'document')::uuid) <> 'periode'
     or (select (d.datos->>'annex')::boolean from documentos d where d.id = (r->>'document')::uuid) then
    raise exception 'FALLA E21: el snapshot del CDP del periode no diu abast=periode sense annex';
  end if;
  raise notice 'E19-E21: % substitueix el de l''oferta', r->>'numero';

  -- E22. El criterio puro, de una vez.
  if public.motiu_exclusio_certificat('donacio', v_ent, 'social') is not null
     or public.motiu_exclusio_certificat('donacio', v_ent, null) <> 'entitat_no_social:desconegut'
     or public.motiu_exclusio_certificat('donacio', v_ent, 'comercial') <> 'entitat_no_social:comercial'
     or public.motiu_exclusio_certificat(null, v_ent, 'social') <> 'sense_valoritzacio' then
    raise exception 'FALLA E22: motiu_exclusio_certificat no respon el que toca';
  end if;
  raise notice 'E22: criteri únic correcte';

  -- ================================================================== C. Cierre de prueba
  -- (Después de E a propósito: la tanda anual tiene que sustituir los CDP de E.)
  v_cierre := (public.abrir_cierre(extract(year from now() at time zone 'Europe/Madrid')::int, 'prueba')).id;
  r := public.calcular_cierre(v_cierre);
  -- El CT está retirado (20270509100400): ni se calcula ni se crea su fila.
  if jsonb_typeof(r->'transaccions') is distinct from 'null' then
    raise exception 'FALLA C1: calcular_cierre encara calcula transaccions: %', r->'transaccions';
  end if;
  select * into v_cd from cierres_donante where cierre_id = v_cierre and productor_id = v_prod and tipo = 'donacio';
  if v_cd.id is null
     or exists (select 1 from cierres_donante where cierre_id = v_cierre and tipo = 'transaccio') then
    raise exception 'FALLA C2: calcular_cierre hauria de deixar la fila de donació i cap de transacció';
  end if;
  -- 180 = 100 (B1: el REC diu 100 i la canalització en concilia 99; es certifica el que el
  -- donant va lliurar, el REC, sense tope per línia: 20270509100700) + 80 (B3). La venda de
  -- B (48 kg) no hi és.
  if v_cd.kg_total <> 180 then
    raise exception 'FALLA C3: kg inesperats al CD (%; esperat 180)', v_cd.kg_total;
  end if;
  if exists (select 1 from jsonb_array_elements(v_cd.bloqueos) b where (b->>'bloqueja')::boolean) then
    raise exception 'FALLA C4: bloquejos inesperats: %', v_cd.bloqueos;
  end if;
  if (select x.motiu from public.cierre_exclosos_periodo(v_prod, v_hoy, v_hoy, null, 'prueba') x
       where x.canalizacion_id = v_c3) is distinct from 'venda' then
    raise exception 'FALLA C4b: la venda de B no surt a les exclusions';
  end if;
  if (select kg_total from cierres_donante where cierre_id = v_cierre and productor_id = v_prod2) <> 57.34 then
    raise exception 'FALLA C4c: el CD anual del donant d''E hauria de ser de 57,34 kg';
  end if;
  raise notice 'C1: calcular_cierre → donació % kg, cap fila de transacció', v_cd.kg_total;

  perform public.cerrar_cierre(v_cierre);

  -- La tanda de CT, retirada.
  v_ok := false;
  begin
    perform public.emitir_certificados_transaccion_cierre(v_cierre);
  exception when sqlstate '22023' then
    get stacked diagnostics v_txt = message_text;
    v_ok := v_txt like 'certificat_transaccio_retirat%';
  end;
  if not v_ok then raise exception 'FALLA C5: la tanda de CT no està retirada'; end if;

  -- La fecha de la tanda anual: futura → 22023, una vez para todos.
  v_ok := false;
  begin
    perform public.emitir_certificados_cierre(v_cierre, v_hoy + 1);
  exception when sqlstate '22023' then
    get stacked diagnostics v_txt = message_text;
    v_ok := v_txt like 'data_expedicio_fora_rang%';
  end;
  if not v_ok then raise exception 'FALLA C6: la tanda ha acceptat una data d''expedició futura'; end if;

  r := public.emitir_certificados_cierre(v_cierre);
  raise notice 'C2: tanda CD → %', r - 'saltats';
  select * into v_cd from cierres_donante where id = v_cd.id;
  if v_cd.certificado_numero not like 'P-CD-%' then
    raise exception 'FALLA C7: número inesperat (%)', v_cd.certificado_numero;
  end if;
  -- Ensayo de un ejercicio en curso: la fecha por defecto es hoy (en real sería el 31-12).
  if v_cd.data_expedicio <> least(make_date(extract(year from v_hoy)::int, 12, 31), v_hoy) then
    raise exception 'FALLA C8: data d''expedició inesperada (%)', v_cd.data_expedicio;
  end if;
  select d.datos into v_doc from documentos d
   where d.objeto_tipo = 'cierre_donante' and d.objeto_id = v_cd.id and d.tipo = 'CD' and d.vigente;
  if v_doc->>'abast' <> 'exercici' or v_doc->>'data_expedicio' <> v_cd.data_expedicio::text
     or (v_doc->>'annex')::boolean or (v_doc->>'kg')::numeric <> 180 then
    raise exception 'FALLA C9: snapshot del CD anual inesperat: %', v_doc;
  end if;
  if (select p.titulo from documentos d join plantillas_documento p on p.id = d.plantilla_id
       where d.objeto_tipo = 'cierre_donante' and d.objeto_id = v_cd.id and d.vigente
         and p.variante is null) not in ('CERTIFICAT DE DONACIÓ', 'CERTIFICADO DE DONACIÓN') then
    raise exception 'FALLA C10: el CD anual no té la plantilla CD del model (sense variant)';
  end if;
  -- El anual manda: los CDP del donante de E quedan sustituidos.
  if exists (select 1 from cierres_periodo where productor_id = v_prod2
                and certificado_numero is not null and estado <> 'substituit') then
    raise exception 'FALLA C11: l''anual no ha substituït els CDP del donant';
  end if;
  raise notice 'C3: % emès amb data % i la plantilla del model; CDP substituïts', v_cd.certificado_numero, v_cd.data_expedicio;

  -- El 182 no lee filas de transacción (20270509100500). Una fila `transaccio` con número
  -- se fuerza a mano; si un trigger no la deja entrar, la comprobación no tiene objeto.
  begin
    insert into cierres_donante (cierre_id, productor_id, tipo, certificado_numero)
    values (v_cierre, v_prod, 'transaccio', 'P-CT-PROVA-182');
  exception when others then
    get stacked diagnostics v_txt = message_text;
    raise notice 'C4: no s''ha pogut forçar una fila transaccio (%): es salta la prova del 182', v_txt;
  end;
  if exists (select 1 from public.datos_182(v_cierre) d where d.certificado_numero = 'P-CT-PROVA-182') then
    raise exception 'FALLA C12: datos_182 llegeix una fila de transacció';
  end if;

  perform public.marcar_declarado(v_cierre);
  if (select estado from cierres_donante where id = v_cd.id) <> 'declarat' then
    raise exception 'FALLA C13: marcar_declarado no ha marcat el CD';
  end if;
  raise notice 'C4: datos_182 només donació; marcar_declarado marca el CD';

  -- ================================================================== D. Espigolada
  insert into espigoladas (productor_id) values (v_prod) returning id into v_esp;
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado,
                          origen, espigolada_id)
  values ('E-PROVA-E2E-4', v_prod, 'Tomàquet', 30, 'donacio', 'borrador', 'espigolament', v_esp)
  returning id into v_exesp;
  lin := jsonb_build_array(jsonb_build_object('excedente_id', v_exesp, 'entidad_id', v_ent, 'kg', 10));
  -- Con la fecha de corte puesta (la del clon), sin convenio del generador → 42501.
  v_ok := false;
  begin
    perform public.repartir_espigolada(v_esp, lin);
  exception when sqlstate '42501' then
    get stacked diagnostics v_txt = message_text;
    v_ok := v_txt like 'sense_conveni: Prova E2E Cascada SL%';
  end;
  if not v_ok then
    raise exception 'FALLA D1: repartir sense conveni del generador no ha tallat pel generador (%)', v_txt;
  end if;
  -- Sin fecha de corte: dos avisos, el del generador primero.
  update parametros_documentales set fecha_corte_convenios = null where id = 1;
  r := public.repartir_espigolada(v_esp, lin);
  if jsonb_array_length(r->'avisos') <> 2 or (r->'avisos'->>0) not like '%Prova E2E Cascada SL%' then
    raise exception 'FALLA D2: s''esperaven dos avisos (generador i entitat): %', r->'avisos';
  end if;
  raise notice 'D: repartir_espigolada exigeix el conveni del generador';

  raise notice 'TOT CORRECTE';
end;
$prueba$;

rollback;
