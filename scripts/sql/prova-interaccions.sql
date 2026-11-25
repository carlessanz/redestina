-- Prueba de «Interaccions i seguiment» (proceso 1.2; 20270616100000 y 20270616100100). SOLO
-- CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-interaccions.sql
--
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja ninguna interacción. Usa las
-- fichas `es_test` sembradas (`sembrar-entitats-ficticies.ts`) y las cuentas del arnés
-- (`hola+equip@…`, `hola+superadmin@…`, `hola+prodowner-masprova@…`); si falta algo, se para con
-- un mensaje claro. Cada caso imprime «ok · …»; el primero que no se cumple aborta con «FALLA · …».
--
-- Casos:
--   1. Crear una interacción con próximo paso y previsión (lugar de la ficha) → sale en
--      `pendents` y en `previsions`, con los nombres resueltos; otra sin nada → solo en historial.
--   2. Filtros: tipus, responsable, producto, estat (pendent/vencut/fet/sense), rango de
--      previsión, rango de la interacción, organización, zona (comarca e INE) y búsqueda.
--   3. `tancar_seguiment` con resultado → sale de `pendents`, sigue en `historial` con su
--      resultado; repetir no pisa el resultado; uno cerrado sin resultado lo completa.
--   4. Errores de validación de `afegir_nota_interna` (previsión) y de `interaccions_llistat`.
--   5. Externos: 42501 en las RPC nuevas; `interaccions_base` no se ejecuta con sesión.
--   6. Borrar el lugar deja `previsio_ubicacio_id` a null; la llamada vieja (sin previsión, tipo
--      `seguiment`) sigue valiendo.

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

-- La llamada a interaccions_llistat como el equipo; devuelve el jsonb en texto.
create function pg_temp.llista(p_user uuid, p_args text) returns jsonb
language plpgsql as $$
declare r text;
begin
  r := pg_temp.com(p_user, 'select interaccions_llistat(' || p_args || ')::text');
  if r like 'ERR%' then
    raise exception 'FALLA · interaccions_llistat(%) → %', p_args, r;
  end if;
  return r::jsonb;
end;
$$;

-- ¿Está la nota en la página?
create function pg_temp.hi_es(p_res jsonb, p_id text) returns boolean
language sql as $$
  select exists (select 1 from jsonb_array_elements(p_res->'files') f where f->>'id' = p_id);
$$;

select pg_temp.usuari('hola+equip@carlessanz.com')              as u_equip,
       pg_temp.usuari('hola+superadmin@carlessanz.com')         as u_super,
       pg_temp.usuari('hola+prodowner-masprova@carlessanz.com') as u_extern
\gset

-- Una organización de prueba con productor y algún lugar; y otra cualquiera de prueba.
select p.id as prod_org1, p.organizacion_id as org1,
       coalesce(nullif(p.area_geografica, ''), '') as comarca1, coalesce(p.municipio_ine, '') as ine1
  from productores p
 where p.es_test
 order by p.created_at limit 1
\gset
-- El lugar de la previsión se crea aquí (se va con el ROLLBACK) para poder borrarlo en el caso 6.
insert into productor_ubicaciones (productor_id, alias) values (:'prod_org1', 'TEST-ARNES Camp de proves')
returning id as lloc1, alias as lloc1_alias
\gset
select e.organizacion_id as org2
  from entidades e where e.es_test and e.organizacion_id <> :'org1'
 order by e.created_at limit 1
\gset
-- Un lugar de OTRA organización (para `ubicacio_aliena`).
select u.id as lloc_alie
  from productor_ubicaciones u join productores p on p.id = u.productor_id
 where p.organizacion_id <> :'org1'
 order by u.id limit 1
\gset
select nombre as prod1 from productos order by nombre limit 1 \gset
select nombre as prod2 from productos order by nombre offset 1 limit 1 \gset

-- ---------------------------------------------------------------------------
-- 1. Crear y ver
-- ---------------------------------------------------------------------------
select pg_temp.com(:'u_equip', format($q$
  select (afegir_nota_interna(
    p_org => %L, p_canal => 'visita', p_text => 'TEST-ARNES visita al camp', p_tipus => 'prospeccio',
    p_responsable => %L, p_propera_accio => 'Trucar per confirmar la collita',
    p_propera_data => (now() at time zone 'Europe/Madrid')::date + 3,
    p_previsio_producte => %L, p_previsio_kg => 1200, p_previsio_data => (now() at time zone 'Europe/Madrid')::date + 20,
    p_previsio_ubicacio_id => %L)).id::text$q$, :'org1', :'u_super', :'prod1', :'lloc1')) as n1
\gset
select pg_temp.ok(:'n1' not like 'ERR%', 'el equipo crea una interacción con próximo paso y previsión (' || :'n1' || ')');

select pg_temp.com(:'u_equip', format($q$
  select (afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'TEST-ARNES trucada sense res mes',
          p_tipus => 'documentacio')).id::text$q$, :'org2')) as n2
\gset
select pg_temp.ok(:'n2' not like 'ERR%', 'una interacción sin próximo paso ni previsión');

-- Una vencida (próximo paso de ayer) con previsión de otro producto y lugar en texto libre.
select pg_temp.com(:'u_equip', format($q$
  select (afegir_nota_interna(p_org => %L, p_canal => 'email', p_text => 'TEST-ARNES correu',
          p_tipus => 'captacio', p_propera_accio => 'Enviar conveni',
          p_propera_data => (now() at time zone 'Europe/Madrid')::date - 1,
          p_previsio_producte => %L, p_previsio_kg => 300.5,
          p_previsio_data => (now() at time zone 'Europe/Madrid')::date + 60,
          p_previsio_ubicacio => 'Camp de la riera')).id::text$q$, :'org2', :'prod2')) as n3
\gset
select pg_temp.ok(:'n3' not like 'ERR%', 'una interacción con el próximo paso vencido y lugar en texto libre');

select pg_temp.llista(:'u_equip', $$p_vista => 'pendents', p_cerca => 'TEST-ARNES'$$)::text as r_pend \gset
select pg_temp.ok(pg_temp.hi_es(:'r_pend', :'n1') and pg_temp.hi_es(:'r_pend', :'n3')
                  and not pg_temp.hi_es(:'r_pend', :'n2'),
                  'pendents: las dos con próximo paso, no la que no tiene');
select pg_temp.ok((:'r_pend'::jsonb->'files'->0->>'id') = :'n3', 'pendents: lo vencido primero (propera_data asc)');

select pg_temp.llista(:'u_equip', $$p_vista => 'previsions', p_cerca => 'TEST-ARNES'$$)::text as r_prev \gset
select pg_temp.ok(pg_temp.hi_es(:'r_prev', :'n1') and pg_temp.hi_es(:'r_prev', :'n3')
                  and not pg_temp.hi_es(:'r_prev', :'n2')
                  and (:'r_prev'::jsonb->'files'->0->>'id') = :'n1',
                  'previsions: las dos con previsión, por fecha prevista asc');

select pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES'$$)::text as r_hist \gset
select pg_temp.ok((:'r_hist'::jsonb->>'total')::int = 3, 'historial: las tres');

select f as fila1 from jsonb_array_elements(:'r_prev'::jsonb->'files') f where f->>'id' = :'n1' \gset
select pg_temp.ok((:'fila1'::jsonb->>'organizacion_id') = :'org1'
                  and (:'fila1'::jsonb->>'organitzacio') is not null
                  and (:'fila1'::jsonb->>'tipus') = 'prospeccio'
                  and (:'fila1'::jsonb->>'responsable_id') = :'u_super'
                  and (:'fila1'::jsonb->>'responsable_nom') is not null
                  and (:'fila1'::jsonb->>'autor_nom') is not null
                  and (:'fila1'::jsonb->>'previsio_producte') = :'prod1'
                  and (:'fila1'::jsonb->>'previsio_kg')::numeric = 1200
                  and (:'fila1'::jsonb->>'previsio_ubicacio_id') = :'lloc1'
                  and (:'fila1'::jsonb->>'previsio_ubicacio_nom') = :'lloc1_alias'
                  and (:'fila1'::jsonb->>'estat_seguiment') = 'pendent',
                  'la fila trae organización, responsable, autor, previsión y el alias del lugar');
select f->>'previsio_ubicacio_nom' as lloc3 from jsonb_array_elements(:'r_prev'::jsonb->'files') f where f->>'id' = :'n3' \gset
select pg_temp.ok(:'lloc3' = 'Camp de la riera', 'el lugar en texto libre sale como previsio_ubicacio_nom');

-- ---------------------------------------------------------------------------
-- 2. Filtros
-- ---------------------------------------------------------------------------
select pg_temp.ok(
  (pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_tipus => 'captacio'$$)->>'total')::int = 1,
  'filtro tipus');
select pg_temp.ok(
  (pg_temp.llista(:'u_equip', format($$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_responsable => %L$$, :'u_super'))->>'total')::int = 1,
  'filtro responsable (el de la primera; las otras, el autor)');
select pg_temp.ok(
  (pg_temp.llista(:'u_equip', format($$p_vista => 'previsions', p_cerca => 'TEST-ARNES', p_producte => %L$$, :'prod2'))->>'total')::int = 1,
  'filtro producto');
select pg_temp.ok(
  (pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_estat => 'pendent'$$)->>'total')::int = 2
  and (pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_estat => 'vencut'$$)->>'total')::int = 1
  and (pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_estat => 'sense'$$)->>'total')::int = 1
  and (pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_estat => 'fet'$$)->>'total')::int = 0,
  'filtro estat: pendent (incluye vencidos) 2, vencut 1, sense 1, fet 0');
select pg_temp.ok(
  (pg_temp.llista(:'u_equip', $$p_vista => 'previsions', p_cerca => 'TEST-ARNES',
     p_prev_desde => (now() at time zone 'Europe/Madrid')::date + 10,
     p_prev_hasta => (now() at time zone 'Europe/Madrid')::date + 30$$)->>'total')::int = 1,
  'filtro rango de previsión');
select pg_temp.ok(
  (pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES',
     p_desde => (now() at time zone 'Europe/Madrid')::date - 5,
     p_hasta => (now() at time zone 'Europe/Madrid')::date$$)->>'total')::int = 3
  and (pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES',
     p_hasta => (now() at time zone 'Europe/Madrid')::date - 1$$)->>'total')::int = 0,
  'filtro período de la interacción');
select pg_temp.ok(
  (pg_temp.llista(:'u_equip', format($$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_org => %L$$, :'org2'))->>'total')::int = 2,
  'filtro organización');
select pg_temp.ok(:'comarca1' = ''
  or (pg_temp.llista(:'u_equip', format($$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_zona => %L, p_org => %L$$, :'comarca1', :'org1'))->>'total')::int = 1,
  'filtro zona (comarca)');
select pg_temp.ok(:'ine1' = ''
  or (pg_temp.llista(:'u_equip', format($$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_zona => %L, p_org => %L$$, :'ine1', :'org1'))->>'total')::int = 1,
  'filtro zona (código INE del municipio)');
select pg_temp.ok(
  pg_temp.hi_es(pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'CONFIRMAR LA COLLITA'$$), :'n1')
  and pg_temp.hi_es(pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'riera'$$), :'n3'),
  'búsqueda en el próximo paso (sin mayúsculas) y en el lugar');
select pg_temp.ok(
  (pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_limit => 1, p_offset => 1$$)->>'total')::int = 3
  and jsonb_array_length(pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_limit => 1, p_offset => 1$$)->'files') = 1,
  'paginación: total de todo lo filtrado, una fila en la página');

select pg_temp.com(:'u_equip', 'select interaccions_opcions()::text') as opc \gset
select pg_temp.ok((:'opc'::jsonb->'productes') ? :'prod1' and (:'opc'::jsonb->'productes') ? :'prod2'
                  and exists (select 1 from jsonb_array_elements(:'opc'::jsonb->'responsables') r where r->>'id' = :'u_super')
                  and jsonb_typeof(:'opc'::jsonb->'zones') = 'array'
                  and jsonb_typeof(:'opc'::jsonb->'municipis') = 'array',
                  'interaccions_opcions: responsables, productos, zonas y municipios');

-- ---------------------------------------------------------------------------
-- 3. Cerrar con resultado
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select (tancar_seguiment(%L, '  Confirmada per al dia 12  ')).resultat$q$, :'n1'))
                  = 'Confirmada per al dia 12', 'tancar_seguiment guarda el resultado (recortado)');
select pg_temp.ok(not pg_temp.hi_es(pg_temp.llista(:'u_equip', $$p_vista => 'pendents', p_cerca => 'TEST-ARNES'$$), :'n1'),
                  'cerrada: sale de pendents');
select f as fila1b from jsonb_array_elements(pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES'$$)->'files') f
 where f->>'id' = :'n1' \gset
select pg_temp.ok((:'fila1b'::jsonb->>'resultat') = 'Confirmada per al dia 12'
                  and (:'fila1b'::jsonb->>'estat_seguiment') = 'fet'
                  and (:'fila1b'::jsonb->>'seguiment_fet_at') is not null
                  and (:'fila1b'::jsonb->>'fet_per_nom') is not null,
                  'cerrada: sigue en historial con su resultado, estado fet y quién la cerró');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select (tancar_seguiment(%L, 'Un altre')).resultat$q$, :'n1'))
                  = 'Confirmada per al dia 12', 'cerrar otra vez no pisa el resultado');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select (tancar_seguiment(%L)).resultat is null$q$, :'n3')) = 'true',
                  'la llamada vieja (sin resultado) cierra sin resultado');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select (tancar_seguiment(%L, 'Enviat')).resultat$q$, :'n3')) = 'Enviat',
                  'una cerrada sin resultado se completa con el que llega');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select tancar_seguiment(%L, repeat('x', 1001))::text$q$, :'n1'))
                  like 'ERR 22023 resultat_massa_llarg%', 'resultado > 1.000 → 22023 resultat_massa_llarg');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select tancar_seguiment(%L, 'x')::text$q$, :'n2'))
                  like 'ERR 22023 nota_sense_seguiment%', 'sin próximo paso → 22023 nota_sense_seguiment');
select pg_temp.ok((pg_temp.llista(:'u_equip', $$p_vista => 'historial', p_cerca => 'TEST-ARNES', p_estat => 'fet'$$)->>'total')::int = 2,
                  'filtro estat fet tras cerrar');
select pg_temp.ok(pg_temp.hi_es(pg_temp.llista(:'u_equip', $$p_vista => 'previsions', p_cerca => 'TEST-ARNES'$$), :'n1'),
                  'la previsión sigue en previsions aunque el seguimiento esté hecho');

-- ---------------------------------------------------------------------------
-- 4. Errores de validación
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'x',
                    p_previsio_producte => %L, p_previsio_kg => 10)::text$q$, :'org1', :'prod1'))
                  like 'ERR 22023 previsio_incompleta%', 'producto y kg sin fecha → previsio_incompleta');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'x',
                    p_previsio_ubicacio => 'Camp')::text$q$, :'org1'))
                  like 'ERR 22023 previsio_incompleta%', 'un lugar sin previsión → previsio_incompleta');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'x',
                    p_previsio_producte => 'TEST-PRODUCTE-INEXISTENT', p_previsio_kg => 10, p_previsio_data => current_date)::text$q$, :'org1'))
                  like 'ERR 22023 producte_desconegut%', 'producto inexistente → producte_desconegut');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'x',
                    p_previsio_producte => %L, p_previsio_kg => 0, p_previsio_data => current_date)::text$q$, :'org1', :'prod1'))
                  like 'ERR 22023 kg_invalid%', 'kg 0 → kg_invalid');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'x',
                    p_previsio_producte => %L, p_previsio_kg => 5, p_previsio_data => current_date,
                    p_previsio_ubicacio_id => %L)::text$q$, :'org1', :'prod1', :'lloc_alie'))
                  like 'ERR 22023 ubicacio_aliena%', 'lugar de otra organización → ubicacio_aliena');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'x',
                    p_previsio_producte => %L, p_previsio_kg => 5, p_previsio_data => current_date,
                    p_previsio_ubicacio => repeat('x', 201))::text$q$, :'org1', :'prod1'))
                  like 'ERR 22023 previsio_ubicacio_massa_llarga%', 'lugar libre > 200 → previsio_ubicacio_massa_llarga');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'x',
                    p_tipus => 'no_existeix')::text$q$, :'org1'))
                  like 'ERR 22023 tipus_nota_desconegut%', 'tipo desconocido → tipus_nota_desconegut');
select pg_temp.ok(pg_temp.com(:'u_equip', 'select interaccions_llistat(p_vista => ''totes'')::text') like 'ERR 22023 vista_invalida%',
                  'vista desconocida → vista_invalida');
select pg_temp.ok(pg_temp.com(:'u_equip', 'select interaccions_llistat(p_vista => ''historial'', p_estat => ''x'')::text') like 'ERR 22023 estat_invalid%',
                  'estado desconocido → estat_invalid');
select pg_temp.ok(pg_temp.com(:'u_equip', 'select interaccions_llistat(p_vista => ''historial'', p_tipus => ''x'')::text') like 'ERR 22023 tipus_invalid%',
                  'tipo de filtro desconocido → tipus_invalid');
select pg_temp.ok(pg_temp.com(:'u_equip', 'select interaccions_llistat(p_vista => ''historial'', p_limit => 0)::text') like 'ERR 22023 limit_invalid%',
                  'limit 0 → limit_invalid');
select pg_temp.ok(pg_temp.com(:'u_equip', 'select interaccions_llistat(p_vista => ''historial'', p_offset => -1)::text') like 'ERR 22023 offset_invalid%',
                  'offset negativo → offset_invalid');
select pg_temp.ok(pg_temp.com(:'u_equip', 'select interaccions_llistat(p_vista => ''historial'', p_desde => ''2026-12-31'', p_hasta => ''2026-01-01'')::text') like 'ERR 22023 rang_invertit%'
              and pg_temp.com(:'u_equip', 'select interaccions_llistat(p_vista => ''previsions'', p_prev_desde => ''2026-12-31'', p_prev_hasta => ''2026-01-01'')::text') like 'ERR 22023 rang_invertit%',
                  'rangos invertidos → rang_invertit');

-- ---------------------------------------------------------------------------
-- 5. Externos y la interna
-- ---------------------------------------------------------------------------
select pg_temp.ok(pg_temp.com(:'u_extern', 'select interaccions_llistat(p_vista => ''totes'')::text') like 'ERR 42501%',
                  'externo: interaccions_llistat → 42501 (antes que validar)');
select pg_temp.ok(pg_temp.com(:'u_extern', 'select interaccions_opcions()::text') like 'ERR 42501%',
                  'externo: interaccions_opcions → 42501');
select pg_temp.ok(pg_temp.com(:'u_extern', format($q$select tancar_seguiment(%L, 'x')::text$q$, :'n2')) like 'ERR 42501%',
                  'externo: tancar_seguiment → 42501');
select pg_temp.ok(pg_temp.com(:'u_extern', format($q$select afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'x',
                    p_previsio_producte => %L, p_previsio_kg => 5, p_previsio_data => current_date)::text$q$, :'org1', :'prod1')) like 'ERR 42501%',
                  'externo: afegir_nota_interna con previsión → 42501');
select pg_temp.ok(pg_temp.com(:'u_equip', 'select count(*)::text from interaccions_base()') like 'ERR 42501%',
                  'interaccions_base no se ejecuta con sesión (interna)');
select pg_temp.ok(pg_temp.com(:'u_extern', 'select count(*)::text from notes_internes') = '0',
                  'externo: 0 filas en notes_internes');
select pg_temp.ok(pg_temp.com(:'u_equip', 'select count(*)::text from auditoria_funcions_obertes()') = '0',
                  'auditoria_funcions_obertes en 0 filas');

-- ---------------------------------------------------------------------------
-- 6. Borrar el lugar; la llamada vieja
-- ---------------------------------------------------------------------------
delete from productor_ubicaciones where id = :'lloc1';
select pg_temp.ok((select previsio_ubicacio_id is null and previsio_producte is not null from notes_internes where id = :'n1'),
                  'borrar el lugar deja previsio_ubicacio_id a null y conserva la previsión');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select (afegir_nota_interna(p_org => %L, p_canal => 'telefon', p_text => 'TEST-ARNES vella',
                    p_tipus => 'seguiment')).tipus$q$, :'org1')) = 'seguiment',
                  'la llamada de 1.5 con tipo seguiment (heredado) sigue valiendo');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select (afegir_nota_interna(%L, 'telefon', 'TEST-ARNES posicional')).tipus$q$, :'org1')) = 'operativa',
                  'sin tipo, el valor por defecto es operativa');

rollback;
\o
\echo
\echo 'prova-interaccions: tot correcte (ROLLBACK, no queda res).'
