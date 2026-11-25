-- Prueba de «Registrar operació realitzada» (20270619100000–100300; proceso 3.7, fase 5 del plan de
-- noviembre de 2026). SOLO CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-operacio-realitzada.sql
--
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja nada (tampoco los números que
-- gasta). Cada caso imprime «ok · …»; el primero que no se cumple aborta con «FALLA · …».
--
-- Casos:
--   1. Donación de hace diez días a DOS entidades con sobrante a un destino (Dinamitzador): oferta
--      `cerrada`, `origen = 'registre'`, `id_excedente` con la fecha de la operación; dos
--      canalizaciones conciliadas con `data_hora_recollida` = esa fecha y `recollida_origen =
--      'equip'`; ENT y REC por recogida emitidos (número del ejercicio, fecha de recogida = la de la
--      operación) y conciliados; el precio, del mes de la operación; el destino, con su fecha; CERO
--      filas nuevas en `avisos`; en «Entrades i sortides», dos filas `registre_posteriori` con esa
--      fecha y el ENT/REC.
--   2. Venta (Superadmin): conciliada sin albarán, con el precio acordado y aceptado; cerrada; sin
--      avisos (el `recollida_confirmada` que `validar_recollida` crea en venta, silenciado).
--   3. Maquila de hoy sin hora: conciliada sin albarán, `data_hora` ≤ ahora.
--   4. Espigolada (donación): `tipus_operacio = 'espigolada'`, al campo; espigolada en venta →
--      `espigolada_nomes_donacio`.
--   5. `p_id_excedente` del servidor: con la fecha correcta se usa tal cual; con otra fecha →
--      `id_excedent_invalid`.
--   6. Rechazos: fecha del ejercicio anterior → `fora_exercici`; mañana → `data_futura`; kg que no
--      cuadran → `kg_no_quadren`; periodo certificado (CDP con número del donante) →
--      `periode_certificat`; CR con número de la entidad → `periode_certificat`; sin convenio →
--      `42501 sense_conveni`; entidad repetida; sin destinatarios; venta sin precio.
--   7. Permisos: un externo (productora, receptora) → 42501; uuid inventado del equipo → 22023.
--   8. Fuera del registro a posteriori, `crear_avis` sigue insertando y `data_anterior` sigue viva.

\set QUIET on
\set ON_ERROR_STOP on
\o /dev/null
begin;

-- ---------------------------------------------------------------------------
-- Ayudantes (temporales)
-- ---------------------------------------------------------------------------
create function pg_temp.com(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare
  r text;
begin
  if p_user is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  else
    perform set_config('request.jwt.claims', '', true);
  end if;
  begin
    execute p_sql into r;
  exception when others then
    r := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
end;
$$;

create function pg_temp.ok(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FALLA · %', p_msg;
  end if;
  raise notice 'ok · %', p_msg;
end;
$$;

create function pg_temp.usuari(p_email text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  select id into v from auth.users where email = p_email;
  if v is null then
    raise exception 'Falta la cuenta % (scripts/crear-usuarios-prueba.ts)', p_email;
  end if;
  return v;
end;
$$;

-- La llamada, como texto SQL (la ejecuta `pg_temp.com` con la sesión que toque).
create function pg_temp.rpc(p_prod uuid, p_kg numeric, p_data date, p_mod text, p_dest jsonb,
                            p_destins jsonb default '[]', p_extra text default '') returns text
language sql as $$
  select format(
    'select public.registrar_operacio_realitzada(p_productor => %L, p_producto => %L, p_kg => %s, '
    'p_data => %L, p_modalitat => %L, p_destinataris => %L::jsonb, p_destins => %L::jsonb%s)::text',
    p_prod, 'Carbassa', p_kg, p_data, p_mod, p_dest, p_destins, p_extra);
$$;

create temp table ctx as
select pg_temp.usuari('hola+superadmin@carlessanz.com')         as u_super,
       pg_temp.usuari('hola+equip@carlessanz.com')              as u_equip,
       pg_temp.usuari('hola+prodowner-masprova@carlessanz.com') as u_prod,
       pg_temp.usuari('hola+recowner-social@carlessanz.com')    as u_rec,
       '75eb2254-32c9-472a-91f5-22e0e6a758cd'::uuid             as p_marta,   -- Ofertant de prova (con convenio)
       '4767be96-5e4f-4a26-9bb9-7aedc9b6f368'::uuid             as p_sense,   -- Fruites del Segrià (sin convenio)
       '3341114b-5b61-42cf-842e-0b94e103157b'::uuid             as e_social,  -- Entitat social receptora de prova
       '3949fbf9-06c2-4425-9e9b-7dbbfb15f019'::uuid             as e_doble,   -- Doble rol de prova (social)
       'cee74104-a3ef-4df4-8d86-c2499ce243a4'::uuid             as e_empresa, -- Empresa receptora de prova
       'd87f0de1-e6b1-4d91-9a4a-c7cd4cf0409c'::uuid             as e_obrador, -- Obrador de prova (maquila)
       (now() at time zone 'Europe/Madrid')::date               as hoy,
       greatest((now() at time zone 'Europe/Madrid')::date - 10,
                date_trunc('year', (now() at time zone 'Europe/Madrid')::date)::date) as dia;
grant select on ctx to authenticated;

create temp table avisos0 as select count(*) as n from avisos;

-- ===========================================================================
-- 1. Donación a dos entidades con sobrante
-- ===========================================================================
create temp table r1 as
select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 100, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 50),
                                       jsonb_build_object('entidad_id', (select e_doble from ctx), 'kg', 30, 'caixes', 3)),
                     jsonb_build_array(jsonb_build_object('desti', 'compostatge', 'kg', 20, 'notes', 'arnes')),
                     ', p_variedad => ''Cacauet'', p_observacions => ''Prova registre a posteriori''')) as t;

select pg_temp.ok((select t not like 'ERR%' from r1), 'donacio: la RPC respon (' || (select left(t, 200) from r1) || ')');
create temp table ex1 as select (t::jsonb->>'excedente_id')::uuid as id, t::jsonb as j from r1;

select pg_temp.ok((select estado = 'cerrada' and origen = 'registre' and kg_total = 100
                          and tipus_operacio = 'excedent' and not producte_al_camp
                          and modalitats = array['donacio'] and variedad = 'Cacauet'
                          and validada_per = (select u_equip from ctx)
                          and disponible_desde = (select dia from ctx)
                     from excedentes where id = (select id from ex1)),
                  'donacio: oferta cerrada, origen registre, kg 100, excedent, validada per l''equip');
select pg_temp.ok((select id_excedente ~ ('^E-' || to_char((select dia from ctx), 'YYMMDD') || '-OFE-CAR-[0-9]+$')
                     from excedentes where id = (select id from ex1)),
                  'donacio: id_excedente E-<data de l''operacio>-OFE-CAR-N (' ||
                  (select id_excedente from excedentes where id = (select id from ex1)) || ')');
select pg_temp.ok((select (j->>'estado') = 'cerrada' and jsonb_array_length(j->'canalitzacions') = 2
                          and (j->>'kg_destins')::numeric = 20 and (j->>'kg_destinataris')::numeric = 80
                     from ex1),
                  'donacio: la resposta diu cerrada, 2 canalitzacions, 80 + 20 kg');

select pg_temp.ok((select count(*) = 2
                          and bool_and(c.estado = 'conciliada')
                          and bool_and((c.data_hora_recollida at time zone 'Europe/Madrid')::date = (select dia from ctx))
                          and bool_and(c.recollida_origen = 'equip')
                          and bool_and(c.resultat_recollida = 'coincideix')
                          and bool_and(c.recollida_registrada_per = (select u_equip from ctx))
                          and bool_and(c.recollida_validada_per = (select u_equip from ctx))
                          and bool_and(c.kg_conciliados = c.kg_confirmados)
                          and sum(c.kg_conciliados) = 80
                          and bool_and(c.preu_mes_albara = date_trunc('month', (select dia from ctx))::date)
                     from canalizaciones c where c.excedente_id = (select id from ex1)),
                  'donacio: dues canalitzacions conciliades amb la data de l''operacio, origen equip, preu del seu mes');
-- Las cajas viajan como en `assignar_directe`: a la respuesta (`caixes_solicitades`).
select pg_temp.ok((select caixes_solicitades = 3 from oferta_respuestas
                    where excedente_id = (select id from ex1) and entidad_id = (select e_doble from ctx)),
                  'donacio: les caixes del destinatari arriben a l''assignacio');

select pg_temp.ok((select count(*) = 4
                          and count(*) filter (where a.tipo = 'ENT') = 2
                          and count(*) filter (where a.tipo = 'REC') = 2
                          and bool_and(a.estado = 'conciliado')
                          and bool_and(a.numero_completo is not null)
                          and bool_and(a.ejercicio = extract(year from (select dia from ctx))::int)
                          and bool_and(((a.recogida->>'fecha_hora')::timestamptz at time zone 'Europe/Madrid')::date
                                       = (select dia from ctx))
                          and bool_and(a.canalizacion_id is not null)
                     from albaranes a where a.excedente_id = (select id from ex1)),
                  'donacio: ENT + REC per recollida, numerats a l''exercici, amb la data de l''operacio, conciliats');
select pg_temp.ok((select count(*) = 1 and sum(kg) = 20 and bool_and(desti_codi = 'compostatge')
                          and bool_and(data = (select dia from ctx)) and bool_and(origen = 'equip')
                     from excedente_destins where excedente_id = (select id from ex1)),
                  'donacio: el sobrant, al desti final amb la data de l''operacio');
select pg_temp.ok((select count(*) = 2 and bool_and(r.aprovacio = 'aprovada') and bool_and(r.canal = 'asistido')
                          and bool_and(r.assignacio_directa)
                     from oferta_respuestas r where r.excedente_id = (select id from ex1)),
                  'donacio: una assignacio directa aprovada per destinatari');
select pg_temp.ok((select count(*) = (select n from avisos0) from avisos),
                  'donacio: CAP avis nou');

create temp table es1 as
select pg_temp.com((select u_equip from ctx),
         format('select public.entrades_sortides(p_desde => %L, p_hasta => %L, p_productor => %L, p_limit => 100)::text',
                (select dia from ctx), (select dia from ctx), (select p_marta from ctx)))::jsonb as j;
select pg_temp.ok((select count(*) = 2
                          and bool_and((f->>'registre_posteriori')::boolean)
                          and bool_and((f->>'data_sortida')::date = (select dia from ctx))
                          and bool_and(f->'albara_ent'->>'numero' is not null)
                          and bool_and(f->'albara_rec'->>'numero' is not null)
                          and bool_and(f->>'estat' = 'conciliada')
                     from es1, jsonb_array_elements(j->'files') f
                    where (f->>'excedente_id')::uuid = (select id from ex1)),
                  'donacio: Entrades i sortides, dues files registre_posteriori amb la data, ENT i REC');
select pg_temp.ok((select coalesce(bool_and(not coalesce((f->>'registre_posteriori')::boolean, true)), true)
                     from es1, jsonb_array_elements(j->'files') f
                    where (f->>'excedente_id')::uuid <> (select id from ex1)),
                  'donacio: la resta de files del dia surten registre_posteriori = false');


-- 1b. Una operación de un mes ANTERIOR (del mismo ejercicio): el precio, del mes de la operación,
--     no del de hoy (el trigger de alta lo calcula con el mes de la canalización, que nace hoy).
--     En enero no hay mes anterior en el ejercicio: el caso se salta.
create temp table r1b as
select case when extract(month from (select hoy from ctx)) > 1 then
  pg_temp.com((select u_equip from ctx),
    pg_temp.rpc((select p_marta from ctx), 12, (date_trunc('month', (select hoy from ctx)) - interval '1 day')::date,
                'donacio', jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 12))))
  end as t;
select pg_temp.ok((select t is null or (t not like 'ERR%' and (
                     select bool_and(c.preu_mes_albara = date_trunc('month', (t::jsonb->>'data')::date)::date)
                            and bool_and((c.data_hora_recollida at time zone 'Europe/Madrid')::date = (t::jsonb->>'data')::date)
                       from canalizaciones c where c.excedente_id = (t::jsonb->>'excedente_id')::uuid))
                     from r1b),
                  'mes anterior: preu_mes_albara i data de recollida del mes de l''operacio (' ||
                  coalesce((select left(t, 120) from r1b), 'saltat al gener') || ')');
select pg_temp.ok((select count(*) = (select n from avisos0) from avisos), 'mes anterior: CAP avis nou');

-- ===========================================================================
-- 2. Venta
-- ===========================================================================
create temp table r2 as
select pg_temp.com((select u_super from ctx),
         pg_temp.rpc((select p_marta from ctx), 40, (select dia from ctx), 'venda',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_empresa from ctx), 'kg', 40, 'preu_kg', 0.5)))) as t;
select pg_temp.ok((select t not like 'ERR%' from r2), 'venda: la RPC respon (' || (select left(t, 200) from r2) || ')');
create temp table ex2 as select (t::jsonb->>'excedente_id')::uuid as id from r2;
select pg_temp.ok((select e.estado = 'cerrada' and e.modalitats = array['venda'] from excedentes e where e.id = (select id from ex2)),
                  'venda: oferta cerrada');
select pg_temp.ok((select count(*) = 1 and bool_and(c.estado = 'conciliada') and bool_and(c.valorizacion = 'venda')
                          and bool_and(c.preu_acordat_kg = 0.5) and bool_and(c.preu_acceptat_at is not null)
                          and bool_and(c.kg_conciliados = 40)
                          and bool_and((c.data_hora_recollida at time zone 'Europe/Madrid')::date = (select dia from ctx))
                     from canalizaciones c where c.excedente_id = (select id from ex2)),
                  'venda: conciliada amb el preu acordat i acceptat, amb la data de l''operacio');
select pg_temp.ok((select count(*) = 0 from albaranes where excedente_id = (select id from ex2)),
                  'venda: sense albara');
select pg_temp.ok((select count(*) = (select n from avisos0) from avisos),
                  'venda: CAP avis nou (tampoc recollida_confirmada)');

-- ===========================================================================
-- 3. Maquila de hoy sin hora
-- ===========================================================================
create temp table r3 as
select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 25, (select hoy from ctx), 'maquila',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_obrador from ctx), 'kg', 25)))) as t;
select pg_temp.ok((select t not like 'ERR%' from r3), 'maquila: la RPC respon (' || (select left(t, 200) from r3) || ')');
select pg_temp.ok((select (t::jsonb->>'estado') = 'cerrada' and (t::jsonb->>'data_hora')::timestamptz <= now()
                          and (t::jsonb->'canalitzacions'->0->>'sense_albara')::boolean
                     from r3),
                  'maquila d''avui sense hora: cerrada, sense albara, data_hora <= ara');

-- ===========================================================================
-- 4. Espigolada
-- ===========================================================================
create temp table r4 as
select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 60, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 60)),
                     '[]', ', p_espigolada => true')) as t;
select pg_temp.ok((select t not like 'ERR%' from r4), 'espigolada: la RPC respon (' || (select left(t, 200) from r4) || ')');
select pg_temp.ok((select e.tipus_operacio = 'espigolada' and e.producte_al_camp and e.espigolada_demanada
                          and e.estado = 'cerrada' and e.espigolada_id is null
                     from excedentes e where e.id = ((select t from r4)::jsonb->>'excedente_id')::uuid),
                  'espigolada: tipus espigolada, al camp, cerrada, sense jornada heretada');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 10, (select dia from ctx), 'venda',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_empresa from ctx), 'kg', 10, 'preu_kg', 1)),
                     '[]', ', p_espigolada => true')) like 'ERR 22023 espigolada_nomes_donacio%'),
                  'espigolada en venda: 22023 espigolada_nomes_donacio');

-- ===========================================================================
-- 5. `p_id_excedente` del servidor
-- ===========================================================================
create temp table r5 as
select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 5, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 5)),
                     '[]', format(', p_id_excedente => %L, p_texto_oferta => %L',
                                  'E-' || to_char((select dia from ctx), 'YYMMDD') || '-TST-REG-901', 'text de prova'))) as t;
select pg_temp.ok((select (t::jsonb->>'id_excedente') = 'E-' || to_char((select dia from ctx), 'YYMMDD') || '-TST-REG-901'
                     from r5),
                  'id del servidor: es fa servir tal qual');
select pg_temp.ok((select texto_oferta = 'text de prova' from excedentes
                    where id = ((select t from r5)::jsonb->>'excedente_id')::uuid),
                  'id del servidor: el text de l''oferta tambe');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 5, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 5)),
                     '[]', ', p_id_excedente => ''E-991231-TST-REG-1''')) like 'ERR 22023 id_excedent_invalid%'),
                  'id del servidor amb una altra data: 22023 id_excedent_invalid');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 5, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 5)),
                     '[]', format(', p_id_excedente => %L',
                                  'E-' || to_char((select dia from ctx), 'YYMMDD') || '-TST-REG-901'))) like 'ERR 23505%'),
                  'id del servidor ja usat: 23505 (el servidor reintenta)');

-- ===========================================================================
-- 6. Rechazos
-- ===========================================================================
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 10,
                     (date_trunc('year', (select hoy from ctx)) - interval '1 day')::date, 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10))))
                   like 'ERR 22023 fora_exercici%'),
                  'exercici anterior: 22023 fora_exercici');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 10, (select hoy from ctx) + 1, 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10))))
                   like 'ERR 22023 data_futura%'),
                  'dema: 22023 data_futura');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 100, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 50)),
                     jsonb_build_array(jsonb_build_object('desti', 'compostatge', 'kg', 20))))
                   like 'ERR 22023 kg_no_quadren%'),
                  '50 + 20 de 100 kg: 22023 kg_no_quadren');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_sense from ctx), 10, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10))))
                   like 'ERR 42501 sense_conveni%'),
                  'ofertant sense conveni: 42501 sense_conveni');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 20, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10),
                                       jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10))))
                   like 'ERR 22023 entitat_repetida%'),
                  'la mateixa entitat dos cops: 22023 entitat_repetida');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 20, (select dia from ctx), 'donacio', '[]'::jsonb,
                     jsonb_build_array(jsonb_build_object('desti', 'compostatge', 'kg', 20))))
                   like 'ERR 22023 cal_destinatari%'),
                  'sense destinataris: 22023 cal_destinatari');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 10, (select dia from ctx), 'venda',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_empresa from ctx), 'kg', 10))))
                   like 'ERR 22023 cal_preu_acordat%'),
                  'venda sense preu: 22023 cal_preu_acordat');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 10, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_empresa from ctx), 'kg', 10))))
                   like 'ERR 22023 Aquesta oferta no encaixa%'),
                  'donacio a una empresa confirmada (P8): 22023 no encaixa');

-- Periodo certificado del donante: un CDP con número que cubre la fecha.
insert into cierres_periodo (productor_id, periodo_desde, periodo_hasta, ejercicio, modo, estado,
                             certificado_numero, certificado_at, abast)
values ((select p_marta from ctx), date_trunc('month', (select dia from ctx))::date, (select dia from ctx),
        extract(year from (select dia from ctx))::int, 'prueba', 'certificat_emes', 'CDP-TEST-ARNES', now(), 'periode');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 10, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10))))
                   like 'ERR 22023 periode_certificat%'),
                  'periode certificat del donant: 22023 periode_certificat');
delete from cierres_periodo where certificado_numero = 'CDP-TEST-ARNES';

-- Periodo certificado de la entidad: un CR con número.
insert into cierres_receptor (entidad_id, periodo_desde, periodo_hasta, ejercicio, modo, estado,
                              certificado_numero, certificado_at)
select (select e_social from ctx), date_trunc('month', (select dia from ctx))::date, (select dia from ctx),
       extract(year from (select dia from ctx))::int, 'prueba', 'certificat_emes', 'CR-TEST-ARNES', now();
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc((select p_marta from ctx), 10, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10))))
                   like 'ERR 22023 periode_certificat%'),
                  'certificat de recepcio de l''entitat: 22023 periode_certificat');
delete from cierres_receptor where certificado_numero = 'CR-TEST-ARNES';

-- ===========================================================================
-- 7. Permisos
-- ===========================================================================
select pg_temp.ok((select pg_temp.com((select u_prod from ctx),
         pg_temp.rpc((select p_marta from ctx), 10, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10))))
                   like 'ERR 42501%'),
                  'la productora: 42501');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx),
         pg_temp.rpc((select p_marta from ctx), 10, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10))))
                   like 'ERR 42501%'),
                  'la receptora: 42501');
select pg_temp.ok((select pg_temp.com(null,
         pg_temp.rpc((select p_marta from ctx), 10, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', (select e_social from ctx), 'kg', 10))))
                   like 'ERR 42501%'),
                  'sense sessio (service_role): 42501');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
         pg_temp.rpc('00000000-0000-0000-0000-000000000000', 10, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', '00000000-0000-0000-0000-000000000000', 'kg', 10))))
                   like 'ERR 22023 productor_inexistent%'),
                  'l''equip amb uuid inventat: 22023 productor_inexistent');
select pg_temp.ok((select pg_temp.com((select u_prod from ctx),
         pg_temp.rpc('00000000-0000-0000-0000-000000000000', 10, (select dia from ctx), 'donacio',
                     jsonb_build_array(jsonb_build_object('entidad_id', '00000000-0000-0000-0000-000000000000', 'kg', 10))))
                   like 'ERR 42501%'),
                  'un extern amb uuid inventat: 42501 (permis abans que existencia)');
select pg_temp.ok((select not has_function_privilege('authenticated', 'public.siglas_oferta(text)', 'EXECUTE')
                          and not has_function_privilege('anon',
                            'public.registrar_operacio_realitzada(uuid,text,numeric,date,text,jsonb,jsonb,text,uuid,boolean,text,time,numeric,text,text,text)',
                            'EXECUTE')),
                  'siglas_oferta interna; anon sense EXECUTE a la RPC');
select pg_temp.ok((select count(*) = 0 from public.auditoria_funcions_obertes()),
                  'auditoria_funcions_obertes() en 0 files');

-- ===========================================================================
-- 8. Fuera del registro a posteriori, todo como antes
-- ===========================================================================
select pg_temp.ok((select count(*) = (select n from avisos0) from avisos),
                  'en acabar tots els registres: CAP avis nou');
-- `data_anterior` sigue viva en el ciclo normal: una canalización de hoy no admite una recogida
-- de hace diez días sin el indicador.
create temp table of8 as
with e as (
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, modalitats, origen,
                          estado, disponible_hasta)
  values ('E-991231-TST-REG-8', (select p_marta from ctx), 'Carbassa', 10, 'donacio', array['donacio'],
          'asistido', 'publicada', (select hoy from ctx) + 7)
  returning id)
select id from e;
create temp table c8 as
select (pg_temp.com((select u_equip from ctx),
          format('select (public.assignar_directe(%L, %L, 10, ''donacio'')).id::text',
                 (select id from of8), (select e_social from ctx))))::uuid as id;
select pg_temp.ok((select pg_temp.com(null,
         format('select public.registrar_recollida_escriu(%L, ''coincideix'', null, %L::timestamptz, null, %L, ''equip'')::text',
                (select id from c8), now() - interval '10 days', (select u_equip from ctx)))
                   like 'ERR 22023 data_anterior%'),
                  'fora del registre, data_anterior segueix viva');
select pg_temp.ok((select public.crear_avis('productor', (select p_marta from ctx), 'oferta_validada',
                                            'excedente', (select id from ex1), '{}') is not null),
                  'fora del registre, crear_avis segueix inserint');
select pg_temp.ok((select current_setting('redestina.registre_posteriori', true) is distinct from 'on'),
                  'l''indicador no queda encès després de la RPC');
select pg_temp.ok((select public.siglas_oferta('Fruites del Segrià') = 'FRU'
                          and public.siglas_oferta('Çà') = 'CAX'
                          and public.siglas_oferta('l·l') = 'LLX'
                          and public.siglas_oferta('') = 'XXX'),
                  'siglas_oferta: paritat amb siglas() de _shared/oferta.ts');

\o
\echo 'prova-operacio-realitzada: tot ok (ROLLBACK)'
rollback;
