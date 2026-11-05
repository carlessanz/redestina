-- Prueba del importador de entidades (20270511100000). SOLO CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-importacio.sql
--
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja nada (ni fichas, ni
-- organizaciones, ni registro de importación). Usa las cuentas de prueba y las fichas TEST-*
-- del fixture (`crear-usuarios-prueba.ts`); si falta alguna, se para con un mensaje claro.
-- Las filas importadas son sintéticas (`TEST-IMP …`, correos `@exemple.invalid`).
--
-- Cada caso imprime «ok · …»; el primero que no se cumple aborta con «FALLA · …».
--
-- Casos:
--   0. Permisos: el técnico y una cuenta externa reciben 42501 en las dos RPC; las internas no
--      se ejecutan con sesión; el super_admin recibe 22023 con un payload inválido.
--   a. 3 filas nuevas (NIF válido, sin NIF, receptora social) → 3 `creada`, inactivas, con su
--      `ref_externa`, su nota y su rastro en `fitxa_estat_hist`.
--   b. El mismo fichero otra vez → 3 `sense_canvis` y `ja_importat_at`.
--   c. El NIF de un productor existente pidiendo el papel `entidad` → `paper_afegit` en la
--      misma organización (inactiva, con el NIF de la hermana); repetirla → `sense_canvis`.
--   d. La misma fila sin NIF dos veces en el lote → la segunda `error` (`repetit_al_fitxer`).
--   e. Fila dudosa (correo de una ficha existente, sin NIF): sin decisión → `omesa`; con el
--      candidato → `actualitzada`; con un uuid ajeno → `error` (`decisio_no_candidata`).
--   f. NIF inválido → entra sin NIF, aviso `nif_invalid` y el valor en la nota.
--   g. Correo de productor ya usado (dudosa decidida «crear») → a la nota con `correu_en_us`.
--   h. `crear_entitat` sigue igual: `cal_paper`, `falta_nif`, y nace activa con su rastro.
--   i. Solo rellena huecos: una ficha existente con un valor distinto da `conflictes` y no se pisa.
--   j. `borrar_ficha_completa` borra una ficha que sale en el registro (FK SET NULL).

\set QUIET on
\set ON_ERROR_STOP on
\o /dev/null
begin;

-- ---------------------------------------------------------------------------
-- Ayudantes (temporales: desaparecen con la sesión)
-- ---------------------------------------------------------------------------
-- Ejecuta una consulta escalar con la SESIÓN de una cuenta (rol `authenticated` + `sub`).
-- Devuelve el resultado como texto, o 'ERR <sqlstate> <mensaje>' si falla.
create function pg_temp.com(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare
  r text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
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

-- La fila `p_n` del resultado de una RPC.
create function pg_temp.fila(p_res jsonb, p_n int) returns jsonb
language sql as $$
  select f from jsonb_array_elements(p_res->'files') f where (f->>'fila')::int = p_n;
$$;

-- Un NIF (CIF de SL) válido que no tiene ninguna ficha: el fixture no se toca.
create function pg_temp.nif_lliure(p_salta int) returns text
language sql as $$
  select n from (
    select 'B' || lpad(g::text, 7, '0') || d as n
      from generate_series(9876500, 9876999) g, unnest(array['0','1','2','3','4','5','6','7','8','9']) d
  ) s
   where public.nif_valid(n)
     and not exists (select 1 from productores p where p.nif = s.n)
     and not exists (select 1 from entidades e where e.nif = s.n)
   order by n offset p_salta limit 1;
$$;

select pg_temp.usuari('hola+superadmin@carlessanz.com')          as u_super,
       pg_temp.usuari('hola+equip@carlessanz.com')               as u_equip,
       pg_temp.usuari('hola+prodowner-masprova@carlessanz.com')  as u_prod1,
       pg_temp.nif_lliure(0)                                     as nif_a
\gset

-- Fichas del fixture.
select (select organizacion_id from productores where codigo = 'TEST-PROD-1') as org_prod1,
       (select nif from productores where codigo = 'TEST-PROD-1')             as nif_prod1,
       (select email from productores where codigo = 'TEST-PROD-1')           as email_prod1,
       (select organizacion_id from entidades where codigo = 'TEST-ENT-SOCIAL') as org_social,
       (select email from entidades where codigo = 'TEST-ENT-SOCIAL')           as email_social
\gset
select pg_temp.ok(:'org_prod1' <> '' and :'org_social' <> '' and :'nif_prod1' <> '',
                  'fixture: TEST-PROD-1 (con NIF) y TEST-ENT-SOCIAL existen');
select pg_temp.ok(not exists (select 1 from entidades where organizacion_id = :'org_prod1'),
                  'fixture: TEST-PROD-1 no tiene papel de receptor (para el caso c)');

\echo
\echo '== 0. Permisos =='
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select previsualitzar_importacio_entitats('[]')::text$q$) like 'ERR 42501%',
                  'el tècnic no previsualitza (42501)');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select importar_entitats('{}', '[]')::text$q$) like 'ERR 42501%',
                  'el tècnic no importa (42501)');
-- El clon no tiene ninguna cuenta `admin`: el técnico sube a admin dentro de la transacción.
update usuario_roles set rol = 'admin' where user_id = :'u_equip' and rol = 'tecnic';
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select pot_aprovar()::text$q$) = 'true', 'el técnico, ascendido, es admin (pot_aprovar)');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select previsualitzar_importacio_entitats('[]')::text$q$) like 'ERR 42501%',
                  'un admin tampoco previsualitza (42501: solo super_admin)');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select importar_entitats('{}', '[]')::text$q$) like 'ERR 42501%',
                  'un admin tampoco importa (42501)');
update usuario_roles set rol = 'tecnic' where user_id = :'u_equip' and rol = 'admin';
select pg_temp.ok(pg_temp.com(:'u_prod1', $q$select previsualitzar_importacio_entitats('[]')::text$q$) like 'ERR 42501%',
                  'una cuenta externa no previsualiza (42501)');
select pg_temp.ok(pg_temp.com(:'u_prod1', $q$select importar_entitats('{}', '[]')::text$q$) like 'ERR 42501%',
                  'una cuenta externa no importa (42501)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select importacio_processa('[]', true)::text$q$) like 'ERR 42501%',
                  'importacio_processa no se ejecuta con sesión (interna)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select alta_fitxa_interna(array['productor'], null, false, '{}', '{}')::text$q$) like 'ERR 42501%',
                  'alta_fitxa_interna no se ejecuta con sesión (interna)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select previsualitzar_importacio_entitats('{}')::text$q$) like 'ERR 22023 dades_invalides%',
                  'super_admin: payload que no es una lista → 22023 dades_invalides');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select importar_entitats('{}', '[]')::text$q$) like 'ERR 22023 dades_invalides%',
                  'super_admin: fitxer sin nom ni sha256 → 22023 dades_invalides');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select importar_entitats(%L, '[]')::text$q$,
                    '{"nom":"x.xlsx","sha256":"' || repeat('a', 64) || '"}')) like 'ERR 22023 sense_files%',
                  'super_admin: lista vacía → 22023 sense_files');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select previsualitzar_importacio_entitats(%L)::text$q$,
                    (select jsonb_agg(jsonb_build_object('fila', g)) from generate_series(1, 1001) g))) like 'ERR 22023 massa_files%',
                  'super_admin: 1001 filas → 22023 massa_files');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select previsualitzar_importacio_entitats('[{"fila":2},{"fila":2}]')::text$q$) like 'ERR 22023 fila_repetida%',
                  'super_admin: dos filas con el mismo número → 22023 fila_repetida');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select previsualitzar_importacio_entitats('[{"nom_comercial":"x"}]')::text$q$) like 'ERR 22023 fila_invalida%',
                  'super_admin: fila sin número → 22023 fila_invalida');

\echo
\echo '== a. Tres filas nuevas =='
select json_build_array(
  json_build_object('fila', 2, 'rols', json_build_array('productor'), 'nom_comercial', 'TEST-IMP Horta Alfa',
                    'razon_social', 'TEST-IMP Horta Alfa SL', 'nif', :'nif_a', 'tipus_empresa', 'sl',
                    'tipus_activitat', json_build_array('productor_agricola', 'banc_aliments', 'inventada'),
                    'email', 'test-imp-alfa@exemple.invalid', 'telefon', '34 699 900 001',
                    'municipi', 'Malgrat de Mar', 'codigo_postal', '8380', 'nota', 'Ve de la fira de Malgrat.'),
  json_build_object('fila', 3, 'rols', json_build_array('productor'), 'nom_comercial', 'TEST-IMP Pagès Beta',
                    'persona_contacte', 'Joana Beta', 'email', 'test-imp-beta@exemple.invalid', 'email2', 'beta2@exemple.invalid',
                    'telefon', '34699900002', 'municipi', 'Poble que no existeix', 'area_geografica', 'Maresme'),
  json_build_object('fila', 4, 'rols', json_build_array('entidad'), 'nom_comercial', 'TEST-IMP Rebost Gamma',
                    'tipo_receptor', 'social', 'modalitats_interes', json_build_array('donacio', 'regal'),
                    'email', 'test-imp-gamma@exemple.invalid', 'email2', 'gamma2@exemple.invalid',
                    'telefon', '34699900003', 'telefon2', '34699900013', 'municipio_ine', '08110',
                    'area_geografica', 'Vallès Oriental', 'airtable_id', 'recTESTIMPgamma01')
)::text as lot_a \gset

select pg_temp.com(:'u_super', format($q$select previsualitzar_importacio_entitats(%L)::text$q$, :'lot_a')) as prev_a \gset
select pg_temp.ok(:'prev_a' like '{%', 'previsualitzar responde (' || left(:'prev_a', 60) || ')');
select pg_temp.ok((:'prev_a'::jsonb #>> '{resum,per_accio,crear}')::int = 3 and (:'prev_a'::jsonb #>> '{resum,per_estat,nova}')::int = 3,
                  'la previsualización prevé 3 altas nuevas');
select pg_temp.ok(not exists (select 1 from productores where empresa like 'TEST-IMP%')
                  and not exists (select 1 from entidades where nombre like 'TEST-IMP%'),
                  'previsualizar no escribe nada');
select pg_temp.ok(not exists (select 1 from importacions_entitats), 'previsualizar no deja registro');

select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-a.xlsx","sha256":"' || repeat('a', 64) || '"}', :'lot_a')) as imp_a \gset
select pg_temp.ok(:'imp_a' like '{%', 'importar responde (' || left(:'imp_a', 60) || ')');
select pg_temp.ok((:'imp_a'::jsonb #>> '{resum,creades}')::int = 3, '3 creades');
select pg_temp.ok((:'imp_a'::jsonb ->> 'ja_importat_at') is null, 'primera vez: ja_importat_at null');
select (pg_temp.fila(:'imp_a'::jsonb, 2) ->> 'productor_id') as p_a,
       (pg_temp.fila(:'imp_a'::jsonb, 3) ->> 'productor_id') as p_b,
       (pg_temp.fila(:'imp_a'::jsonb, 4) ->> 'entidad_id')   as e_c,
       (pg_temp.fila(:'imp_a'::jsonb, 4) ->> 'organizacion_id') as org_c
\gset
select pg_temp.ok((select not activo and not es_test and nif = :'nif_a'
                     and ref_externa = 'IMP:NIF:' || :'nif_a' and municipio_ine = '08110' and poblacion is not null
                     and codigo_postal is null and email = 'test-imp-alfa@exemple.invalid' and phone = '34699900001'
                     and name = 'TEST-IMP Horta Alfa' and tipus_activitat = array['productor_agricola']
                     and comentario like '[Importació % · fila 2]%Ve de la fira de Malgrat.%'
                     from productores where id = :'p_a'),
                  'fila 2: productor inactivo, NIF, ref IMP:NIF, municipio, nota; CP de 4 cifras y actividades ajenas descartados');
select pg_temp.ok((select avisos @> array['tipus_activitat_desconegut:banc_aliments', 'tipus_activitat_desconegut:inventada', 'codi_postal_invalid']
                     from importacions_entitats_files where fila = 2),
                  'fila 2: avisos tipus_activitat_desconegut y codi_postal_invalid en el registro');
select pg_temp.ok((select not activo and nif is null and ref_externa like 'IMP:%' and ref_externa not like 'IMP:NIF:%'
                     and length(ref_externa) = 68 and municipio_ine is null and ubicacio = 'Poble que no existeix'
                     and area_geografica = 'Maresme' and name = 'Joana Beta' and empresa = 'TEST-IMP Pagès Beta'
                     and comentario like '%Correu secundari: beta2@exemple.invalid%'
                     from productores where id = :'p_b'),
                  'fila 3: sin NIF, ref IMP:<sha256>, municipio no encontrado → ubicacio, email2 → nota');
select pg_temp.ok((select avisos @> array['sense_nif', 'municipi_no_trobat', 'correu2_a_nota']
                     from importacions_entitats_files where fila = 3),
                  'fila 3: avisos sense_nif, municipi_no_trobat, correu2_a_nota');
select pg_temp.ok((select not activo and tipo_receptor = 'social' and modalitats_interes = array['donacio']
                     and ref_externa = 'AIRTABLE:recTESTIMPgamma01' and email2 = 'gamma2@exemple.invalid'
                     and telefono2 = '34699900013' and area_geografica = 'Maresme'
                     from entidades where id = :'e_c'),
                  'fila 4: receptora social inactiva, ref AIRTABLE, modalidad ajena descartada, comarca del municipio');
select pg_temp.ok((select avisos @> array['modalitat_desconeguda:regal', 'area_no_coincideix']
                     from importacions_entitats_files where fila = 4),
                  'fila 4: avisos modalitat_desconeguda y area_no_coincideix');
select pg_temp.ok((select count(*) = 3 from fitxa_estat_hist
                    where (productor_id in (:'p_a', :'p_b') or entidad_id = :'e_c') and not activo and per = :'u_super'),
                  'el rastro de las tres altas (inactivas) en fitxa_estat_hist');
select pg_temp.ok((select count(*) = 1 from importacions_entitats where fitxer_sha256 = repeat('a', 64) and files_total = 3
                     and creat_per = :'u_super' and (resum->>'creades')::int = 3)
                  and (select count(*) = 3 from importacions_entitats_files where accio = 'creada'),
                  'registro: una importación y tres filas creada');

\echo
\echo '== b. El mismo fichero otra vez =='
select pg_temp.com(:'u_super', format($q$select previsualitzar_importacio_entitats(%L)::text$q$, :'lot_a')) as prev_b \gset
select pg_temp.ok((:'prev_b'::jsonb #>> '{resum,per_accio,sense_canvis}')::int = 3
                  and (:'prev_b'::jsonb #>> '{resum,per_estat,existent}')::int = 3,
                  'la previsualización ya las ve existentes y sin cambios');
select pg_temp.ok(pg_temp.fila(:'prev_b'::jsonb, 2) ->> 'identificada_per' = 'nif'
                  and pg_temp.fila(:'prev_b'::jsonb, 3) ->> 'identificada_per' = 'ref'
                  and pg_temp.fila(:'prev_b'::jsonb, 4) ->> 'identificada_per' = 'airtable',
                  'identidad: NIF, ref IMP: y Airtable');
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-a (2).xlsx","sha256":"' || repeat('a', 64) || '"}', :'lot_a')) as imp_b \gset
select pg_temp.ok((:'imp_b'::jsonb #>> '{resum,sense_canvis}')::int = 3, 'reimportar: 3 sense_canvis (idempotente)');
select pg_temp.ok((:'imp_b'::jsonb ->> 'ja_importat_at') is not null, 'reimportar: ja_importat_at del lote anterior');
select pg_temp.ok((select count(*) = 1 from productores where empresa = 'TEST-IMP Horta Alfa')
                  and (select count(*) = 1 from entidades where nombre = 'TEST-IMP Rebost Gamma')
                  and (select comentario not like '%fila 2]%fila 2]%' from productores where id = :'p_a'),
                  'sin duplicados ni nota repetida');

\echo
\echo '== c. NIF de un productor existente pidiendo el papel de receptor =='
select json_build_array(json_build_object('fila', 7, 'rols', json_build_array('entidad'),
  'nom_comercial', 'Mas de Prova (receptor)', 'nif', :'nif_prod1', 'tipo_receptor', 'animal',
  'persona_contacte', 'Contacte TEST-IMP'))::text as lot_c \gset
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-c.xlsx","sha256":"' || repeat('c', 64) || '"}', :'lot_c')) as imp_c \gset
select pg_temp.ok(pg_temp.fila(:'imp_c'::jsonb, 7) ->> 'accio' = 'paper_afegit'
                  and pg_temp.fila(:'imp_c'::jsonb, 7) ->> 'organizacion_id' = :'org_prod1',
                  'paper_afegit en la misma organización');
select pg_temp.ok((select not e.activo and e.nif = :'nif_prod1' and e.tipo_receptor = 'animal'
                     and e.es_test = p.es_test and e.email = lower(p.email) and e.contacto = 'Contacte TEST-IMP'
                     and e.nombre = 'Mas de Prova (receptor)'
                     from entidades e join productores p on p.organizacion_id = e.organizacion_id
                    where e.organizacion_id = :'org_prod1'),
                  'la ficha nueva: inactiva, NIF y es_test de la hermana, el correo que faltaba copiado de ella');
select pg_temp.ok((select activo from productores where codigo = 'TEST-PROD-1'),
                  'la hermana no cambia de estado');
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-c.xlsx","sha256":"' || repeat('c', 64) || '"}', :'lot_c')) as imp_c2 \gset
select pg_temp.ok(pg_temp.fila(:'imp_c2'::jsonb, 7) ->> 'accio' = 'sense_canvis', 'repetir el papel añadido → sense_canvis');

\echo
\echo '== d. La misma fila sin NIF dos veces =='
select json_build_array(
  json_build_object('fila', 10, 'rols', json_build_array('productor'), 'nom_comercial', 'TEST-IMP Delta, S.L.', 'municipi', 'Reus'),
  json_build_object('fila', 11, 'rols', json_build_array('productor'), 'nom_comercial', 'test-imp  DELTA SL', 'municipi', 'Reus')
)::text as lot_d \gset
select pg_temp.com(:'u_super', format($q$select previsualitzar_importacio_entitats(%L)::text$q$, :'lot_d')) as prev_d \gset
select pg_temp.ok(pg_temp.fila(:'prev_d'::jsonb, 10) ->> 'accio_prevista' = 'crear'
                  and pg_temp.fila(:'prev_d'::jsonb, 11) ->> 'accio_prevista' = 'error'
                  and pg_temp.fila(:'prev_d'::jsonb, 11) -> 'errors' ? 'repetit_al_fitxer:10',
                  'la segunda fila (mismo nombre normalizado y municipio) → error repetit_al_fitxer:10');

\echo
\echo '== e. Fila dudosa: mismo correo que una ficha existente, sin NIF =='
select json_build_array(json_build_object('fila', 20, 'rols', json_build_array('entidad'),
  'nom_comercial', 'TEST-IMP Menjador Epsilon', 'email', upper(:'email_social'), 'tipo_receptor', 'social',
  'nota', 'Nota de la fila dubtosa'))::jsonb as lot_e \gset
select pg_temp.com(:'u_super', format($q$select previsualitzar_importacio_entitats(%L)::text$q$, :'lot_e')) as prev_e \gset
select pg_temp.ok(pg_temp.fila(:'prev_e'::jsonb, 20) ->> 'estat' = 'dubtosa'
                  and pg_temp.fila(:'prev_e'::jsonb, 20) ->> 'accio_prevista' = 'ometre'
                  and exists (select 1 from jsonb_array_elements(pg_temp.fila(:'prev_e'::jsonb, 20) -> 'candidats') c
                               where c->>'organizacion_id' = :'org_social' and c->>'motiu' = 'correu'),
                  'dubtosa con el candidato por correo; sin decisión → ometre');
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-e.xlsx","sha256":"' || repeat('e', 64) || '"}', :'lot_e')) as imp_e \gset
select pg_temp.ok(pg_temp.fila(:'imp_e'::jsonb, 20) ->> 'accio' = 'omesa'
                  and not exists (select 1 from entidades where nombre = 'TEST-IMP Menjador Epsilon'),
                  'importar sin decisión → omesa (no crea ni une)');
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-e.xlsx","sha256":"' || repeat('e', 64) || '"}',
  jsonb_set(:'lot_e'::jsonb, '{0,decisio}', to_jsonb(:'org_social'::text)))) as imp_e2 \gset
select pg_temp.ok(pg_temp.fila(:'imp_e2'::jsonb, 20) ->> 'accio' = 'actualitzada'
                  and pg_temp.fila(:'imp_e2'::jsonb, 20) -> 'camps_omplerts' ? 'entidades.comentarios',
                  'con el candidato como decisión → actualitzada (la nota en comentarios)');
select pg_temp.ok((select nombre <> 'TEST-IMP Menjador Epsilon' and comentarios like '%Nota de la fila dubtosa%' and activo
                     from entidades where codigo = 'TEST-ENT-SOCIAL'),
                  'no pisa el nombre ni el estado de la ficha existente');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(pg_temp.fila(:'imp_e2'::jsonb, 20) -> 'conflictes') c
                           where c->>'columna' = 'nombre' and c->>'camp' = 'nom_comercial'
                             and c->>'fitxer' = 'TEST-IMP Menjador Epsilon'),
                  'la diferencia de nombre sale como conflicte');
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-e.xlsx","sha256":"' || repeat('e', 64) || '"}',
  jsonb_set(:'lot_e'::jsonb, '{0,decisio}', to_jsonb(:'org_prod1'::text)))) as imp_e3 \gset
select pg_temp.ok(pg_temp.fila(:'imp_e3'::jsonb, 20) ->> 'accio' = 'error'
                  and pg_temp.fila(:'imp_e3'::jsonb, 20) -> 'errors' ? 'decisio_no_candidata',
                  'con un uuid que no es candidato → error decisio_no_candidata');
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-e.xlsx","sha256":"' || repeat('e', 64) || '"}',
  jsonb_set(:'lot_e'::jsonb, '{0,decisio}', '"potser"'))) as imp_e4 \gset
select pg_temp.ok(pg_temp.fila(:'imp_e4'::jsonb, 20) -> 'errors' ? 'decisio_invalida',
                  'una decisión que no es crear/ometre/uuid → error decisio_invalida');

\echo
\echo '== f. NIF inválido =='
select json_build_array(json_build_object('fila', 30, 'rols', json_build_array('productor'),
  'nom_comercial', 'TEST-IMP Zeta', 'nif', 'B-1234.5678', 'municipi', 'Girona'))::text as lot_f \gset
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-f.xlsx","sha256":"' || repeat('f', 64) || '"}', :'lot_f')) as imp_f \gset
select pg_temp.ok(pg_temp.fila(:'imp_f'::jsonb, 30) ->> 'accio' = 'creada'
                  and pg_temp.fila(:'imp_f'::jsonb, 30) -> 'avisos' ? 'nif_invalid',
                  'creada con aviso nif_invalid');
select pg_temp.ok((select nif is null and comentario like '%NIF no vàlid al fitxer: B-1234.5678%' and municipio_ine is not null
                     from productores where empresa = 'TEST-IMP Zeta'),
                  'sin NIF y con el valor original en la nota');

\echo
\echo '== g. Correo de productor ya usado =='
select json_build_array(json_build_object('fila', 40, 'rols', json_build_array('productor'),
  'nom_comercial', 'TEST-IMP Eta', 'email', :'email_prod1', 'telefon', '34699900040', 'decisio', 'crear'))::text as lot_g \gset
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-g.xlsx","sha256":"' || repeat('b', 64) || '"}', :'lot_g')) as imp_g \gset
select pg_temp.ok(pg_temp.fila(:'imp_g'::jsonb, 40) ->> 'accio' = 'creada'
                  and pg_temp.fila(:'imp_g'::jsonb, 40) -> 'avisos' ? 'correu_en_us',
                  'dubtosa decidida «crear» → creada con aviso correu_en_us');
select pg_temp.ok((select email is null and phone = '34699900040'
                     and comentario like '%Correu ja en ús en una altra fitxa: ' || lower(:'email_prod1') || '%'
                     from productores where empresa = 'TEST-IMP Eta'),
                  'el correo va a la nota, no a la columna única');

\echo
\echo '== h. crear_entitat sigue igual =='
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select crear_entitat('{"rols":[]}')::text$q$) like 'ERR 22023 cal_paper%',
                  'crear_entitat sin papeles → 22023 cal_paper');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select crear_entitat('{"rols":["productor"],"nom_comercial":"TEST-IMP Theta"}')::text$q$)
                    like 'ERR 22023 falta_nif%',
                  'crear_entitat sin NIF → 22023 falta_nif');
select pg_temp.ok(pg_temp.com(:'u_prod1', $q$select crear_entitat('{"rols":["productor"]}')::text$q$) like 'ERR 42501%',
                  'crear_entitat de una cuenta externa → 42501');
select pg_temp.com(:'u_equip', format($q$select crear_entitat(%L)::text$q$, json_build_object(
  'rols', json_build_array('productor', 'entidad'), 'nom_comercial', 'TEST-IMP Iota', 'razon_social', 'TEST-IMP Iota SL',
  'nif', pg_temp.nif_lliure(5), 'tipo_receptor', 'social', 'es_test', true,
  'tipus_activitat', json_build_array('productor_agricola', 'banc_aliments')))) as cre_h \gset
select pg_temp.ok(:'cre_h' like '{%' and (:'cre_h'::jsonb ->> 'productor_id') is not null and (:'cre_h'::jsonb ->> 'entidad_id') is not null,
                  'crear_entitat con dos papeles responde {organizacion_id, productor_id, entidad_id}');
select pg_temp.ok((select p.activo and e.activo and p.organizacion_id = e.organizacion_id and p.es_test and e.es_test
                     and p.tipus_activitat = array['productor_agricola'] and e.tipus_activitat = array['productor_agricola', 'banc_aliments']
                     and p.ref_externa is null and p.comentario is null and e.comentarios is null
                     and p.organizacion_id = (:'cre_h'::jsonb ->> 'organizacion_id')::uuid
                     from productores p, entidades e
                    where p.id = (:'cre_h'::jsonb ->> 'productor_id')::uuid and e.id = (:'cre_h'::jsonb ->> 'entidad_id')::uuid),
                  'nace activa, en una organización, actividades por papel, sin ref ni nota');
select pg_temp.ok((select count(*) = 2 from fitxa_estat_hist
                    where (productor_id = (:'cre_h'::jsonb ->> 'productor_id')::uuid or entidad_id = (:'cre_h'::jsonb ->> 'entidad_id')::uuid)
                      and activo and per = :'u_equip'),
                  'y deja su rastro activo en fitxa_estat_hist');

\echo
\echo '== i. Solo rellena huecos =='
update productores set telefono_alt = null, razon_social = 'Raó que ja hi era SL' where id = :'p_a';
select json_build_array(json_build_object('fila', 2, 'rols', json_build_array('productor'), 'nom_comercial', 'TEST-IMP Horta Alfa',
  'nif', :'nif_a', 'razon_social', 'Una altra raó SL', 'telefon2', '34699900091'))::text as lot_i \gset
select pg_temp.com(:'u_super', format($q$select importar_entitats(%L, %L)::text$q$,
  '{"nom":"prova-i.xlsx","sha256":"' || repeat('d', 64) || '"}', :'lot_i')) as imp_i \gset
select pg_temp.ok(pg_temp.fila(:'imp_i'::jsonb, 2) ->> 'accio' = 'actualitzada'
                  and pg_temp.fila(:'imp_i'::jsonb, 2) -> 'camps_omplerts' ? 'productores.telefono_alt'
                  and exists (select 1 from jsonb_array_elements(pg_temp.fila(:'imp_i'::jsonb, 2) -> 'conflictes') c
                               where c->>'columna' = 'razon_social' and c->>'actual' = 'Raó que ja hi era SL'
                                 and c->>'fitxer' = 'Una altra raó SL'),
                  'rellena el hueco (telefono_alt) y anota el conflicto de razón social');
select pg_temp.ok((select razon_social = 'Raó que ja hi era SL' and telefono_alt = '34699900091' and not activo
                     from productores where id = :'p_a'),
                  'no pisa la razón social ni toca el estado');

\echo
\echo '== j. borrar_ficha_completa con fichas del registro =='
select pg_temp.com(:'u_super', format($q$select borrar_ficha_completa('productor', %L)::text$q$, :'p_b')) as del_j \gset
select pg_temp.ok(:'del_j' like '{%' and (:'del_j'::jsonb ->> 'ok')::boolean, 'borrar_ficha_completa borra la ficha importada');
select pg_temp.ok((select count(*) >= 2 from importacions_entitats_files where fila = 3 and productor_id is null and organizacion_id is null),
                  'el registro se queda, sin la ficha (FK SET NULL)');

\echo
\echo '== Lectura del registro =='
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select count(*)::text from importacions_entitats$q$)::int > 0
                  and pg_temp.com(:'u_equip', $q$select count(*)::text from importacions_entitats_files$q$)::int > 0,
                  'el equipo lee el registro');
select pg_temp.ok(pg_temp.com(:'u_prod1', $q$select count(*)::text from importacions_entitats$q$) = '0'
                  and pg_temp.com(:'u_prod1', $q$select count(*)::text from importacions_entitats_files$q$) = '0',
                  'una cuenta externa ve 0 filas del registro');
select pg_temp.ok(pg_temp.com(:'u_super', $q$insert into importacions_entitats (fitxer_nom, fitxer_sha256, files_total) values ('x', repeat('a', 64), 0) returning id::text$q$)
                    like 'ERR 42501%',
                  'ni el super_admin escribe directo en el registro (42501)');
select pg_temp.ok((select count(*) = 0 from auditoria_funcions_obertes()), 'auditoria_funcions_obertes() en 0 filas');

rollback;
\o
\echo
\echo 'prova-importacio: tot correcte (ROLLBACK, no queda res).'
