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
--   C. Cierre de PRUEBA: `calcular_cierre` deja calculadas las filas `transaccio`; al cerrar,
--      la tanda de CD y la nueva tanda de CT emiten `P-CD` y `P-CT`; `marcar_declarado` no
--      toca el CT.
--   D. `repartir_espigolada` exige el convenio del generador.

begin;

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
begin
  -- ------------------------------------------------------------------ fichas
  insert into productores (name, empresa, email, nif, direccion, codigo_postal, poblacion, es_test)
  values ('Prova E2E', 'Prova E2E Cascada SL', 'prova-e2e-prod@example.invalid',
          'B00000000', 'Carrer de Prova 1', '08001', 'Barcelona', true)
  returning id into v_prod;
  insert into entidades (nombre, email, es_test, tipo_receptor, estat)
  values ('Entitat Prova E2E', 'prova-e2e-ent@example.invalid', true, 'social', 'Signat')
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

  -- ================================================================== C. Cierre de prueba
  v_cierre := (public.abrir_cierre(extract(year from now() at time zone 'Europe/Madrid')::int, 'prueba')).id;
  r := public.calcular_cierre(v_cierre);
  if r->'transaccions' is null then
    raise exception 'FALLA C1: calcular_cierre no retorna les transaccions';
  end if;
  select * into v_cd from cierres_donante where cierre_id = v_cierre and productor_id = v_prod and tipo = 'donacio';
  select * into v_ct from cierres_donante where cierre_id = v_cierre and productor_id = v_prod and tipo = 'transaccio';
  if v_cd.id is null or v_ct.id is null or v_ct.calculado_at is null then
    raise exception 'FALLA C2: calcular_cierre no ha deixat calculades les dues files (CD %, CT %)', v_cd.id, v_ct.id;
  end if;
  if v_cd.kg_total <> 180 or v_ct.kg_total <> 48 then
    raise exception 'FALLA C3: kg inesperats (CD %, CT %)', v_cd.kg_total, v_ct.kg_total;
  end if;
  if exists (select 1 from jsonb_array_elements(v_cd.bloqueos || v_ct.bloqueos) b where (b->>'bloqueja')::boolean) then
    raise exception 'FALLA C4: bloquejos inesperats: CD % / CT %', v_cd.bloqueos, v_ct.bloqueos;
  end if;
  raise notice 'C1: calcular_cierre → donació % kg, transacció % kg, sense bloquejos', v_cd.kg_total, v_ct.kg_total;

  perform public.cerrar_cierre(v_cierre);
  r := public.emitir_certificados_cierre(v_cierre);
  raise notice 'C2: tanda CD → %', r - 'saltats';
  r := public.emitir_certificados_transaccion_cierre(v_cierre);
  raise notice 'C3: tanda CT → %', r - 'saltats';
  select * into v_cd from cierres_donante where id = v_cd.id;
  select * into v_ct from cierres_donante where id = v_ct.id;
  if v_cd.certificado_numero not like 'P-CD-%' or v_ct.certificado_numero not like 'P-CT-%' then
    raise exception 'FALLA C5: números inesperats (CD %, CT %)', v_cd.certificado_numero, v_ct.certificado_numero;
  end if;
  if not exists (select 1 from documentos where objeto_tipo = 'cierre_donante' and objeto_id = v_ct.id
                    and tipo = 'CT' and modo = 'prueba') then
    raise exception 'FALLA C6: el CT no té document';
  end if;
  -- La segunda tanda no repite nada.
  r := public.emitir_certificados_transaccion_cierre(v_cierre);
  if (r->>'emesos')::int <> 0 or (r->>'ja_tenien')::int < 1 then
    raise exception 'FALLA C7: la segona tanda de CT no és idempotent: %', r;
  end if;
  perform public.marcar_declarado(v_cierre);
  if (select estado from cierres_donante where id = v_ct.id) = 'declarat' then
    raise exception 'FALLA C8: marcar_declarado ha marcat el CT com a declarat';
  end if;
  if (select estado from cierres_donante where id = v_cd.id) <> 'declarat' then
    raise exception 'FALLA C9: marcar_declarado no ha marcat el CD';
  end if;
  raise notice 'C4: % i % emesos; marcar_declarado només marca el CD', v_cd.certificado_numero, v_ct.certificado_numero;

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
