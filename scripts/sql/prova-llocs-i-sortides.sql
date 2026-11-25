-- Prueba de la fase 4 del plan de noviembre de 2026 (20270618100000–100200): «Entrades i
-- sortides» por tipus d'operació y modalidad real, el lugar que hereda días y franja de la oferta
-- y el día de recogida que limita al receptor. SOLO CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-llocs-i-sortides.sql
--
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja nada. Cada caso imprime
-- «ok · …»; el primero que no se cumple aborta con «FALLA · …».
--
-- Casos:
--   a. Lugar desde la oferta (`excedentes_lloc_des_de_oferta`): publicada con lugar vacío → el
--      lugar recibe días y franja; con días → no se pisan (la franja vacía sí se rellena); con
--      todo → nada; esborrany → nada hasta publicarlo; pendent_validacio → sí; lugar de otro
--      productor → nunca.
--   b. `dia_fora_dies`: el receptor (nivel 2) pidiendo un día fuera → 22023; el día bueno pasa;
--      el equipo (assignar_directe, interés asistido) ese mismo día fuera → pasa.
--   c. `entrades_sortides`: `p_tipus_operacio = 'espigolada'`, `p_modalitat = 'venda'`,
--      `p_modalitat = 'espigolada'` (compatibilidad), `tipus_operacio_invalid`,
--      `modalitat_invalida`, el resumen por `tipus_operacio` y el externo denegado.

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

create function pg_temp.lloc(p_prod uuid, p_alias text, p_dies int[], p_franges jsonb) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into productor_ubicaciones (productor_id, alias, dies_setmana, franges)
  values (p_prod, p_alias, p_dies, p_franges)
  returning id into v;
  return v;
end;
$$;

-- Una oferta de prueba como la inserta `crear-oferta` (sin texto).
create function pg_temp.oferta(p_ref text, p_prod uuid, p_lloc uuid, p_estat text, p_origen text,
                               p_mods text[], p_dies smallint[], p_ini time, p_fi time,
                               p_esp boolean default false) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, modalitats,
                          producte_al_camp, espigolada_demanada, origen, estado, disponible_hasta,
                          preu_minim, ubicacion_id, dies_recollida, hora_recollida_inici,
                          hora_recollida_fi)
  values (case when p_estat = 'esborrany' then null else p_ref end, p_prod, 'Carbassa', 100,
          p_mods[1], p_mods, p_esp, p_esp, p_origen, p_estat,
          (now() at time zone 'Europe/Madrid')::date + 14,
          case when 'venda' = any(p_mods) then 0.10 end, p_lloc, p_dies, p_ini, p_fi)
  returning id into v;
  return v;
end;
$$;

-- El siguiente día (1-7 ISO) a las 10:00 de Madrid, a partir de mañana.
create function pg_temp.proper(p_isodow int) returns timestamptz
language sql as $$
  select (d + time '10:00') at time zone 'Europe/Madrid'
    from generate_series((now() at time zone 'Europe/Madrid')::date + 1,
                         (now() at time zone 'Europe/Madrid')::date + 7, interval '1 day') g(d0),
         lateral (select g.d0::date as d) x
   where extract(isodow from d) = p_isodow
   limit 1;
$$;

create temp table ctx as
select pg_temp.usuari('hola+superadmin@carlessanz.com')         as u_super,
       pg_temp.usuari('hola+equip@carlessanz.com')              as u_equip,
       pg_temp.usuari('hola+recowner-social@carlessanz.com')    as u_rec,
       '75eb2254-32c9-472a-91f5-22e0e6a758cd'::uuid             as p_marta,   -- Marta Prova Ofertant
       '3fef203c-54f5-4c1b-bbc0-171311ca8f05'::uuid             as p_jordi,   -- Jordi Prova Segon
       '3341114b-5b61-42cf-842e-0b94e103157b'::uuid             as e_social;  -- Entitat social receptora de prova
grant select on ctx to authenticated;

-- ===========================================================================
-- a. El lugar hereda días y franja de la oferta (rellena huecos, nunca pisa)
-- ===========================================================================
create temp table ll as
select pg_temp.lloc((select p_marta from ctx), 'TEST-lloc buit', null, null)                    as buit,
       pg_temp.lloc((select p_marta from ctx), 'TEST-lloc amb dies', array[2, 4], '[]'::jsonb)  as amb_dies,
       pg_temp.lloc((select p_marta from ctx), 'TEST-lloc complet', array[5],
                    '[{"inici": "07:00", "fi": "09:00"}]'::jsonb)                               as complet,
       pg_temp.lloc((select p_marta from ctx), 'TEST-lloc esborrany', '{}', null)               as esb,
       pg_temp.lloc((select p_marta from ctx), 'TEST-lloc validacio', null, null)               as valid,
       pg_temp.lloc((select p_marta from ctx), 'TEST-lloc aliè', null, null)                    as alie;

select pg_temp.oferta('E-991231-TST-LLC-1', (select p_marta from ctx), (select buit from ll),
                      'publicada', 'asistido', array['donacio'], '{3,1,3}'::smallint[], '09:00', '12:30');
select pg_temp.ok((select dies_setmana = array[1, 3]
                          and franges = '[{"inici": "09:00", "fi": "12:30"}]'::jsonb
                     from productor_ubicaciones where id = (select buit from ll)),
                  'a1 · lloc buit + oferta publicada: rep els dies (ordenats, sense repetits) i la franja');

select pg_temp.oferta('E-991231-TST-LLC-2', (select p_marta from ctx), (select amb_dies from ll),
                      'publicada', 'asistido', array['donacio'], '{1,3}'::smallint[], '10:00', '13:00');
select pg_temp.ok((select dies_setmana = array[2, 4]
                          and franges = '[{"inici": "10:00", "fi": "13:00"}]'::jsonb
                     from productor_ubicaciones where id = (select amb_dies from ll)),
                  'a2 · lloc amb dies: els dies no es trepitgen; la franja buida ([]) s''omple');

select pg_temp.oferta('E-991231-TST-LLC-3', (select p_marta from ctx), (select complet from ll),
                      'publicada', 'asistido', array['donacio'], '{1,3}'::smallint[], '10:00', '13:00');
select pg_temp.ok((select dies_setmana = array[5]
                          and franges = '[{"inici": "07:00", "fi": "09:00"}]'::jsonb
                     from productor_ubicaciones where id = (select complet from ll)),
                  'a3 · lloc complet: no canvia res');

create temp table esb as
select pg_temp.oferta(null, (select p_marta from ctx), (select esb from ll),
                      'esborrany', 'asistido', array['donacio'], '{6}'::smallint[], '08:00', '10:00') as id;
select pg_temp.ok((select dies_setmana = '{}'::int[] and franges is null
                     from productor_ubicaciones where id = (select esb from ll)),
                  'a4 · un esborrany no toca el lloc');
update excedentes set estado = 'publicada', id_excedente = 'E-991231-TST-LLC-4'
 where id = (select id from esb);
select pg_temp.ok((select dies_setmana = array[6]
                          and franges = '[{"inici": "08:00", "fi": "10:00"}]'::jsonb
                     from productor_ubicaciones where id = (select esb from ll)),
                  'a5 · en publicar l''esborrany, el lloc (amb dies {}) rep dies i franja');

select pg_temp.oferta('E-991231-TST-LLC-5', (select p_marta from ctx), (select valid from ll),
                      'pendent_validacio', 'panel', array['donacio'], '{2}'::smallint[], null, null);
select pg_temp.ok((select dies_setmana = array[2] and franges is null
                     from productor_ubicaciones where id = (select valid from ll)),
                  'a6 · pendent_validacio sense hores: rep els dies, la franja es queda buida');

select pg_temp.oferta('E-991231-TST-LLC-6', (select p_jordi from ctx), (select alie from ll),
                      'publicada', 'asistido', array['donacio'], '{1}'::smallint[], '09:00', '11:00');
select pg_temp.ok((select dies_setmana is null and franges is null
                     from productor_ubicaciones where id = (select alie from ll)),
                  'a7 · el lloc d''un altre productor no es toca mai');

-- ===========================================================================
-- b. `dia_fora_dies`: limita al receptor, no al equipo
-- ===========================================================================
-- Ofertas que solo se recogen el lunes (1), franja amplia. Una por intento (el interés es único
-- por oferta y entidad).
create temp table ob as
select pg_temp.oferta('E-991231-TST-DIA-1', (select p_marta from ctx), null, 'publicada', 'asistido',
                      array['donacio'], '{1}'::smallint[], '07:00', '20:00') as rec_fora,
       pg_temp.oferta('E-991231-TST-DIA-2', (select p_marta from ctx), null, 'publicada', 'asistido',
                      array['donacio'], '{1}'::smallint[], '07:00', '20:00') as rec_be,
       pg_temp.oferta('E-991231-TST-DIA-3', (select p_marta from ctx), null, 'publicada', 'asistido',
                      array['donacio'], '{1}'::smallint[], '07:00', '20:00') as eq_assigna,
       pg_temp.oferta('E-991231-TST-DIA-4', (select p_marta from ctx), null, 'publicada', 'asistido',
                      array['donacio'], '{1}'::smallint[], '07:00', '20:00') as eq_assistit,
       pg_temp.oferta('E-991231-TST-DIA-5', (select p_marta from ctx), null, 'publicada', 'asistido',
                      array['donacio'], null, '07:00', '20:00') as sense_dies;
grant select on ob to authenticated;
create temp table dt as select pg_temp.proper(1) as dilluns, pg_temp.proper(2) as dimarts;
grant select on dt to authenticated;

select pg_temp.ok(
  pg_temp.com((select u_rec from ctx),
    $q$select (public.manifestar_interes((select rec_fora from pg_temp.ob), (select e_social from pg_temp.ctx),
               10::numeric, null, null, 'donacio', (select dimarts from pg_temp.dt))).id::text$q$)
  like 'ERR 22023 dia_fora_dies: l''oferta nomes es recull els dies dilluns%',
  'b1 · el receptor demanant un dimarts en una oferta de dilluns: 22023 dia_fora_dies');

select pg_temp.ok(
  pg_temp.com((select u_rec from ctx),
    $q$select (public.manifestar_interes((select rec_be from pg_temp.ob), (select e_social from pg_temp.ctx),
               10::numeric, null, null, 'donacio', (select dilluns from pg_temp.dt))).id::text$q$)
  !~ '^ERR',
  'b2 · el receptor demanant un dilluns: passa');

select pg_temp.ok(
  pg_temp.com((select u_rec from ctx),
    $q$select (public.manifestar_interes((select sense_dies from pg_temp.ob), (select e_social from pg_temp.ctx),
               10::numeric, null, null, 'donacio', (select dimarts from pg_temp.dt))).id::text$q$)
  !~ '^ERR',
  'b3 · una oferta sense dies_recollida no limita el dia');

select pg_temp.ok(
  pg_temp.com((select u_super from ctx),
    $q$select (public.assignar_directe((select eq_assigna from pg_temp.ob), (select e_social from pg_temp.ctx),
               10::numeric, 'donacio', (select dimarts from pg_temp.dt))).id::text$q$)
  !~ '^ERR',
  'b4 · l''equip (super_admin) assignant aquell mateix dimarts: passa (registra la realitat)');

select pg_temp.ok(
  pg_temp.com((select u_equip from ctx),
    $q$select (public.manifestar_interes_assistit((select eq_assistit from pg_temp.ob), (select e_social from pg_temp.ctx),
               10::numeric, null, null, 'donacio', (select dimarts from pg_temp.dt))).id::text$q$)
  !~ '^ERR',
  'b5 · l''equip (interes assistit) aquell mateix dimarts: passa');

select pg_temp.ok(
  pg_temp.com(null,
    $q$select public.comprova_hora_recollida(e, (select dimarts from pg_temp.dt))::text
         from excedentes e where e.id = (select rec_fora from pg_temp.ob)$q$)
  !~ '^ERR',
  'b6 · el servidor (service_role, sense sessio) no es bloqueja per dies');

-- ===========================================================================
-- c. «Entrades i sortides» por tipus d'operació y modalidad real
-- ===========================================================================
-- Una espigolada (donación al campo) asignada: su salida es `donacio` y `espigolada`.
create temp table oc as
select pg_temp.oferta('E-991231-TST-SOR-1', (select p_marta from ctx), null, 'publicada', 'asistido',
                      array['donacio'], null, null, null, true) as esp;
grant select on oc to authenticated;
select pg_temp.ok(
  pg_temp.com((select u_super from ctx),
    $q$select (public.assignar_directe((select esp from pg_temp.oc), (select e_social from pg_temp.ctx),
               12::numeric, 'donacio')).id::text$q$) !~ '^ERR',
  'c0 · assignacio d''una espigolada (fixture)');

create temp table es as
select pg_temp.com((select u_equip from ctx),
         $q$select public.entrades_sortides(p_tipus_operacio => 'espigolada', p_limit => 1000)::text$q$)::jsonb as espig,
       pg_temp.com((select u_equip from ctx),
         $q$select public.entrades_sortides(p_modalitat => 'espigolada', p_limit => 1000)::text$q$)::jsonb as compat,
       pg_temp.com((select u_equip from ctx),
         $q$select public.entrades_sortides(p_modalitat => 'venda', p_limit => 1000)::text$q$)::jsonb as venda,
       pg_temp.com((select u_equip from ctx),
         $q$select public.entrades_sortides(p_modalitat => 'donacio', p_tipus_operacio => 'excedent', p_limit => 1000)::text$q$)::jsonb as don_exc,
       pg_temp.com((select u_equip from ctx),
         $q$select public.entrades_sortides(p_modalitat => 'espigolada', p_tipus_operacio => 'excedent')::text$q$)::jsonb as contradiccio,
       pg_temp.com((select u_equip from ctx),
         $q$select public.entrades_sortides(p_limit => 1000)::text$q$)::jsonb as tot;

select pg_temp.ok(
  (select (espig->>'total')::int >= 1
          and not exists (select 1 from jsonb_array_elements(espig->'files') f
                           where f->>'tipus_operacio' <> 'espigolada')
          and exists (select 1 from jsonb_array_elements(espig->'files') f
                       where f->>'id_excedente' = 'E-991231-TST-SOR-1'
                         and f->>'modalitat' = 'donacio' and f->>'tipus_operacio' = 'espigolada')
     from es),
  'c1 · p_tipus_operacio espigolada: nomes espigolades, i l''espigolada surt com a donacio');

select pg_temp.ok(
  (select not exists (select 1 from jsonb_array_elements(venda->'files') f where f->>'modalitat' <> 'venda')
     from es),
  'c2 · p_modalitat venda: nomes vendes (modalitat real)');

select pg_temp.ok(
  (select compat->'total' = espig->'total' and compat->'kg_sortida' = espig->'kg_sortida' from es),
  'c3 · compatibilitat: p_modalitat = espigolada = p_tipus_operacio espigolada');

select pg_temp.ok(
  (select not exists (select 1 from jsonb_array_elements(don_exc->'files') f
                       where f->>'modalitat' <> 'donacio' or f->>'tipus_operacio' <> 'excedent')
          and (contradiccio->>'total')::int = 0
          and (tot->>'total')::int = (espig->>'total')::int
                + (select count(*) from jsonb_array_elements(tot->'files') f
                    where f->>'tipus_operacio' = 'excedent')
     from es),
  'c4 · els dos eixos son independents; excedent + espigolada sumen el total');

select pg_temp.ok(
  pg_temp.com((select u_equip from ctx), $q$select public.entrades_sortides(p_tipus_operacio => 'collit')::text$q$)
    like 'ERR 22023 tipus_operacio_invalid%'
  and pg_temp.com((select u_equip from ctx), $q$select public.entrades_sortides_resum(p_tipus_operacio => 'collit')::text$q$)
    like 'ERR 22023 tipus_operacio_invalid%',
  'c5 · tipus d''operacio desconegut: 22023 tipus_operacio_invalid (llistat i resum)');

select pg_temp.ok(
  pg_temp.com((select u_equip from ctx), $q$select public.entrades_sortides(p_modalitat => 'regal')::text$q$)
    like 'ERR 22023 modalitat_invalida%',
  'c6 · modalitat desconeguda: 22023 modalitat_invalida');

create temp table rs as
select pg_temp.com((select u_equip from ctx),
         $q$select public.entrades_sortides_resum(p_per => 'tipus_operacio')::text$q$)::jsonb as r;
select pg_temp.ok(
  (select (r->'total'->>'sortides')::int
            = (r->'total'->'per_modalitat'->'donacio'->>'sortides')::int
            + (r->'total'->'per_modalitat'->'venda'->>'sortides')::int
            + (r->'total'->'per_modalitat'->'maquila'->>'sortides')::int
          and (r->'total'->>'sortides')::int
            = (r->'total'->'per_tipus_operacio'->'excedent'->>'sortides')::int
            + (r->'total'->'per_tipus_operacio'->'espigolada'->>'sortides')::int
          and r->'total'->'per_modalitat'->'espigolada' = r->'total'->'per_tipus_operacio'->'espigolada'
          and (r->'total'->>'espigolades')::int >= 1
          and not exists (select 1 from jsonb_array_elements(r->'grups') g
                           where g->>'clau' not in ('excedent', 'espigolada'))
     from rs),
  'c7 · resum per tipus_operacio: per_modalitat (3 reals) i per_tipus_operacio sumen el total; espigolada obsoleta = la nova');

select pg_temp.ok(
  pg_temp.com((select u_rec from ctx), $q$select public.entrades_sortides(p_tipus_operacio => 'espigolada')::text$q$)
    like 'ERR 42501%',
  'c8 · un extern: 42501 (permis abans que validacio)');

rollback;
\o
\echo 'prova-llocs-i-sortides: tot ok (ROLLBACK)'
