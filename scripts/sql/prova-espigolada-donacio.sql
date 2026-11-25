-- Prueba de «la espigolada es una oferta de donación» (20270617100000–100300; procesos 3.6, 3.5 C
-- y 3.4). SOLO CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-espigolada-donacio.sql
--
-- Se ejecuta desde la RAÍZ del repo (el caso 6 incluye la migración de datos con `\i`).
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja nada. Cada caso imprime
-- «ok · …»; el primero que no se cumple aborta con «FALLA · …».
--
-- Casos:
--   1. Alta del EQUIPO de una oferta con «Espigolada» (la fila que inserta `crear-oferta`:
--      `filaDeDades` + `origen = 'asistido'` + `estado = 'publicada'`): nace publicada,
--      `tipus_operacio = 'espigolada'`, donación al campo, y sale al Mercat de una entidad social.
--      La de la PRODUCTORA (`origen = 'panel'`) va a validación.
--   2. `assignar_directe` sobre ella: canalización de donación con su ENT y su REC por recogida
--      (`canalizacion_id`), sin ninguna rama de espigolada (`espigolada_id` nulo en todo).
--   3. Edición: una oferta ya cosechada (`producte_al_camp = false`, donación + venta) → marcar
--      espigolada → campo, `{donacio}`, `tipus_operacio = 'espigolada'`; desmarcar; pedir venta
--      siendo espigolada → `espigolada_no_donacio`; `producte_al_camp = false` la desmarca; la
--      productora que la marca la manda a validación.
--   4. Con una asignación de VENTA viva, marcar espigolada → `22023 espigolada_no_donacio`.
--   5. Retirada: `crear_espigolada` y `repartir_espigolada` dan 42501 al equipo (sin EXECUTE);
--      `pendents_equip()` devuelve 18 colas y ninguna `espigolades_per_convertir`.
--   6. Migración de datos heredados: una jornada `oberta` sin movimiento de una ficha `es_test` se
--      deshace; la de una ficha real y la que tiene el REC emitido se quedan; es idempotente.
--   7. El check `excedentes_espigolada_donacio` rechaza una espigolada que no sea donación.

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

-- Una oferta de prueba como la inserta `crear-oferta` (sin texto: no hace falta aquí).
create function pg_temp.oferta(p_ref text, p_prod uuid, p_origen text, p_mods text[],
                               p_camp boolean, p_esp boolean) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, modalitats,
                          producte_al_camp, espigolada_demanada, origen, estado, disponible_hasta,
                          preu_minim)
  values (p_ref, p_prod, 'Carbassa', 100, p_mods[1], p_mods, p_camp, p_esp, p_origen, 'publicada',
          (now() at time zone 'Europe/Madrid')::date + 7,
          case when 'venda' = any(p_mods) then 0.10 end)
  returning id into v;
  return v;
end;
$$;

create temp table ctx as
select pg_temp.usuari('hola+superadmin@carlessanz.com')         as u_super,
       pg_temp.usuari('hola+equip@carlessanz.com')              as u_equip,
       pg_temp.usuari('hola+prodowner-masprova@carlessanz.com') as u_prod,
       '75eb2254-32c9-472a-91f5-22e0e6a758cd'::uuid             as p_marta,   -- Marta Prova Ofertant
       '3fef203c-54f5-4c1b-bbc0-171311ca8f05'::uuid             as p_jordi,   -- Jordi Prova Segon
       '3341114b-5b61-42cf-842e-0b94e103157b'::uuid             as e_social,  -- Entitat social receptora de prova
       'cee74104-a3ef-4df4-8d86-c2499ce243a4'::uuid             as e_empresa; -- Empresa receptora de prova
grant select on ctx to authenticated;

-- ===========================================================================
-- 1. Alta del equipo y de la productora
-- ===========================================================================
create temp table of1 as
select pg_temp.oferta('E-991231-TST-ESP-1', (select p_marta from ctx), 'asistido',
                      array['donacio'], true, true) as id;
grant select on of1 to authenticated;

select pg_temp.ok((select estado = 'publicada' and tipus_operacio = 'espigolada'
                          and modalitats = array['donacio'] and producte_al_camp
                          and espigolada_id is null
                     from excedentes where id = (select id from of1)),
                  '1a · alta del equip amb «Espigolada»: publicada, tipus_operacio espigolada, donacio al camp, sense jornada');

select pg_temp.ok(pg_temp.com((select u_equip from ctx),
                   'select tipus_operacio from excedentes where id = (select id from pg_temp.of1)') = 'espigolada',
                  '1b · l''equip llegeix tipus_operacio (GRANT de taula)');

-- El Mercat: la entidad social la ve como cualquier donación publicada (RLS de lectura).
select pg_temp.ok(
  (select count(*) from membresias m where m.entidad_id = (select e_social from ctx) and m.activo) = 0
  or pg_temp.com((select m.user_id from membresias m
                   where m.entidad_id = (select e_social from ctx) and m.activo limit 1),
                 'select count(*) from excedentes where id = (select id from pg_temp.of1)') = '1',
  '1c · surt al Mercat d''una entitat social');

create temp table of2 as
select pg_temp.oferta('E-991231-TST-ESP-2', (select p_marta from ctx), 'panel',
                      array['donacio'], true, true) as id;
select pg_temp.ok(
  (select estado from excedentes where id = (select id from of2)) = 'pendent_validacio',
  '1d · la de la productora (origen panel) va a validacio');

-- ===========================================================================
-- 2. Asignación directa: ENT + REC por recogida, sin ramas de espigolada
-- ===========================================================================
create temp table can1 as
select pg_temp.com((select u_super from ctx),
    'select (public.assignar_directe((select id from pg_temp.of1),
                         (select e_social from pg_temp.ctx), 40::numeric, ''donacio'')).id::text') as r;
select pg_temp.ok((select r !~ '^ERR' from can1),
  '2a · assignar_directe (super_admin) sobre l''espigolada crea la canalitzacio');
alter table can1 add column id uuid;
update can1 set id = r::uuid;

select pg_temp.ok((select valorizacion = 'donacio' and estado <> 'anulada'
                     from canalizaciones where id = (select id from can1)),
                  '2b · la canalitzacio es de donacio');

select pg_temp.ok(
  (select count(*) from albaranes a
    where a.canalizacion_id = (select id from can1) and a.tipo = 'ENT' and a.espigolada_id is null) = 1
  and (select count(*) from albaranes a
        where a.canalizacion_id = (select id from can1) and a.tipo = 'REC' and a.espigolada_id is null) = 1,
  '2c · ENT i REC de la recollida (canalizacion_id), cap amb espigolada_id');

select pg_temp.ok(
  (select count(*) from albaranes a where a.excedente_id = (select id from of1) and a.espigolada_id is not null) = 0
  and (select espigolada_id is null from excedentes where id = (select id from of1)),
  '2d · ni la oferta ni els seus albarans entren al model heretat');

-- ===========================================================================
-- 3. Edición (proceso 3.4)
-- ===========================================================================
create temp table of3 as
select pg_temp.oferta('E-991231-TST-ESP-3', (select p_marta from ctx), 'asistido',
                      array['donacio', 'venda'], false, false) as id;

select pg_temp.ok((select tipus_operacio = 'excedent' from excedentes where id = (select id from of3)),
                  '3a · una oferta ja collida es excedent');

select public.editar_oferta((select id from of3), '{"espigolada_demanada": true}', '', (select u_super from ctx));
select pg_temp.ok((select espigolada_demanada and producte_al_camp and modalitat = 'donacio'
                          and modalitats = array['donacio'] and tipus_operacio = 'espigolada'
                     from excedentes where id = (select id from of3)),
                  '3b · marcar espigolada: producte al camp, {donacio}, tipus espigolada');
select pg_temp.ok(
  (select (x.abans -> 'modalitats') = '["donacio", "venda"]'::jsonb
          and (x.despres -> 'modalitats') = '["donacio"]'::jsonb
          and (x.despres -> 'espigolada_demanada') = 'true'::jsonb
     from excedentes_canvis x where x.excedente_id = (select id from of3)
    order by x.created_at desc limit 1),
  '3c · excedentes_canvis guarda tambe el que es deriva (modalitats)');

select pg_temp.ok(
  pg_temp.com(null, $q$select public.editar_oferta((select id from pg_temp.of3),
                 '{"modalitats": ["venda"]}', '', (select u_super from pg_temp.ctx))::text$q$)
  like 'ERR 22023 espigolada_no_donacio%',
  '3d · demanar venda sent espigolada: 22023 espigolada_no_donacio');

select pg_temp.ok(
  pg_temp.com(null, $q$select public.editar_oferta((select id from pg_temp.of3),
                 '{"espigolada_demanada": true, "producte_al_camp": false}', '', (select u_super from pg_temp.ctx))::text$q$)
  like 'ERR 22023 espigolada_sense_camp%',
  '3e · espigolada sense producte al camp al mateix canvi: 22023 espigolada_sense_camp');

select public.editar_oferta((select id from of3), '{"espigolada_demanada": false}', '', (select u_super from ctx));
select pg_temp.ok((select not espigolada_demanada and tipus_operacio = 'excedent' and producte_al_camp
                     from excedentes where id = (select id from of3)),
                  '3f · desmarcar espigolada: permes, torna a excedent (el camp es queda)');

select public.editar_oferta((select id from of3), '{"espigolada_demanada": true, "modalitats": ["donacio"]}', '', (select u_super from ctx));
select public.editar_oferta((select id from of3), '{"producte_al_camp": false}', '', (select u_super from ctx));
select pg_temp.ok((select not espigolada_demanada and not producte_al_camp and tipus_operacio = 'excedent'
                     from excedentes where id = (select id from of3)),
                  '3g · producte_al_camp = false la desmarca');

-- La productora marca la espigolada en una oferta publicada: a validación (como el alta).
select public.editar_oferta((select id from of3), '{"espigolada_demanada": true}', '', (select u_prod from ctx));
select pg_temp.ok((select estado = 'pendent_validacio' and espigolada_demanada
                     from excedentes where id = (select id from of3)),
                  '3h · la productora que la marca la torna a validacio');

-- ===========================================================================
-- 4. Con una venta viva, no se puede marcar espigolada
-- ===========================================================================
create temp table of4 as
select pg_temp.oferta('E-991231-TST-ESP-4', (select p_marta from ctx), 'asistido',
                      array['venda'], false, false) as id;
grant select on of4 to authenticated;
select pg_temp.ok(
  pg_temp.com((select u_super from ctx),
    'select (public.assignar_directe((select id from pg_temp.of4), (select e_empresa from pg_temp.ctx),
              10::numeric, ''venda'', null, null, 0.50::numeric, true)).valorizacion') = 'venda',
  '4a · assignacio de venda viva');
select pg_temp.ok(
  pg_temp.com(null, $q$select public.editar_oferta((select id from pg_temp.of4),
                 '{"espigolada_demanada": true}', '', (select u_super from pg_temp.ctx))::text$q$)
  like 'ERR 22023 espigolada_no_donacio%',
  '4b · marcar espigolada amb una venda viva: 22023 espigolada_no_donacio');

-- ===========================================================================
-- 5. Retirada del módulo
-- ===========================================================================
select pg_temp.ok(
  pg_temp.com((select u_super from ctx),
    'select public.crear_espigolada(''00000000-0000-0000-0000-000000000000''::uuid,
       p_excedente => ''00000000-0000-0000-0000-000000000000''::uuid)::text') like 'ERR 42501%',
  '5a · crear_espigolada: 42501 al super_admin (sense EXECUTE)');
select pg_temp.ok(
  pg_temp.com((select u_equip from ctx),
    'select public.repartir_espigolada(''00000000-0000-0000-0000-000000000000''::uuid, ''[]''::jsonb)::text') like 'ERR 42501%',
  '5b · repartir_espigolada: 42501 a l''equip (sense EXECUTE)');
select pg_temp.ok(
  pg_temp.com((select u_equip from ctx),
    'select count(*)::text || ''/'' || count(*) filter (where cua = ''espigolades_per_convertir'')::text from public.pendents_equip()') = '18/0',
  '5c · pendents_equip: 18 cues, cap espigolades_per_convertir');

-- ===========================================================================
-- 6. Datos heredados (la migración 20270617100200, otra vez dentro de esta transacción)
-- ===========================================================================
-- (a) Jornada `oberta` de una ficha es_test, convertida desde una oferta, sin movimiento.
create temp table of6 as
select pg_temp.oferta('E-991231-TST-ESP-6', (select p_marta from ctx), 'asistido',
                      array['donacio', 'venda'], true, false) as id;
create temp table j6 as
select (public.crear_espigolada((select p_marta from ctx), p_excedente => (select id from of6))->>'espigolada_id')::uuid as id;
-- (b) La misma, de una ficha REAL (en esta transacción, Jordi deja de ser es_test).
create temp table of7 as
select pg_temp.oferta('E-991231-TST-ESP-7', (select p_jordi from ctx), 'asistido',
                      array['donacio'], true, false) as id;
update productores set es_test = false where id = (select p_jordi from ctx);
create temp table j7 as
select (public.crear_espigolada((select p_jordi from ctx), p_excedente => (select id from of7))->>'espigolada_id')::uuid as id;

select pg_temp.ok((select estado = 'borrador' and origen = 'espigolament' and espigolada_id = (select id from j6)
                     from excedentes where id = (select id from of6))
                  and (select count(*) from albaranes where espigolada_id = (select id from j6) and estado = 'borrador') = 1,
                  '6a · fixture: jornada oberta amb la oferta en borrador i el REC de jornada en esborrany');

create temp table abans6 as
select e.id, e.estado from espigoladas e where e.estado = 'oberta' and e.id not in (select id from j6 union select id from j7);

\o
\i supabase/migrations/20270617100200_espigolades_heredades.sql
\o /dev/null

select pg_temp.ok((select estado = 'publicada' and espigolada_id is null and espigolada_demanada
                          and producte_al_camp and modalitats = array['donacio'] and origen = 'asistido'
                          and tipus_operacio = 'espigolada'
                     from excedentes where id = (select id from of6)),
                  '6b · la oferta desfeta: publicada, donacio al camp, origen asistido, tipus espigolada');
select pg_temp.ok((select estado = 'tancada' from espigoladas where id = (select id from j6))
                  and (select count(*) from albaranes where espigolada_id = (select id from j6)) = 0,
                  '6c · la jornada, tancada i sense el REC d''esborrany');
select pg_temp.ok((select estado = 'oberta' from espigoladas where id = (select id from j7))
                  and (select espigolada_id = (select id from j7) and estado = 'borrador'
                         from excedentes where id = (select id from of7)),
                  '6d · la d''una fitxa real (no es_test) no es toca');
select pg_temp.ok(not exists (select 1 from abans6 a join espigoladas e on e.id = a.id
                               where e.estado <> a.estado),
                  '6e · les jornades amb moviment (REC amb numero, canalitzacions) es queden heretades');

\o
\i supabase/migrations/20270617100200_espigolades_heredades.sql
\o /dev/null
select pg_temp.ok((select estado = 'oberta' from espigoladas where id = (select id from j7))
                  and (select estado = 'publicada' from excedentes where id = (select id from of6)),
                  '6f · idempotent: la segona passada no canvia res');

-- ===========================================================================
-- 7. El check de la espigolada
-- ===========================================================================
select pg_temp.ok(
  pg_temp.com(null, $q$update excedentes set modalitats = array['donacio','venda']
                        where id = (select id from pg_temp.of1) returning id::text$q$)
  like 'ERR 23514%',
  '7a · una espigolada en venda la rebutja el check excedentes_espigolada_donacio');

\o
\echo 'prova-espigolada-donacio: tot ok (rollback)'
rollback;
