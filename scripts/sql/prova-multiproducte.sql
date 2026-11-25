-- Prueba de las ofertas multiproducto (20270620100000–100600; proceso 3.3, fase 6 del plan de
-- noviembre de 2026). SOLO CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-multiproducte.sql
--
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja nada (tampoco los números que
-- gasta). Cada caso imprime «ok · …»; el primero que no se cumple aborta con «FALLA · …».
--
-- Casos:
--   1. Alta (6a): `crear_disponibilitat` con tres productos (servidor) → cabecera `D-…`, tres
--      ofertas publicadas con su grupo; publicar un esborrany como primera fila; rechazos
--      (`cal_dos_productes`, `columna_no_permesa`, `estat_invalid`, con sesión 42501).
--   2. Lectura: `ofertes_disponibilitat` y la RLS de `disponibilitats` por perfil (social ve las
--      tres, comercial solo la de venta, productor las suyas, uuid inventado 0 filas).
--   3. Solicitud (6b): la entidad social pide DOS productos con una fecha → una solicitud
--      `pendent`, dos intereses con `sollicitud_id`; repetir → `sollicitud_pendent`.
--   4. Todo o nada: la empresa comercial pide venta + donación → «no encaixa» en la línea 2, sin
--      solicitud ni interés.
--   5. Resolver: `falten_linies` con una sola línea; externo → 42501; aprobar 1 (kg ajustados) y
--      rechazar 1 → una canalización con `sollicitud_id`, estado `resolta`, y SOLO dos avisos
--      nuevos (`sollicitud_resolta` a la entidad y al productor), ningún aviso por línea.
--   6. Recogida (6c): la entidad declara la aprobada con diferencia («inferior») → «Valida totes»
--      del equipo → ENT y REC de esa canalización conciliados.
--   7. Nivel 1: `assignar_directe_multiple` (dos líneas) → dos canalizaciones aprobadas con grupo y
--      un solo par de avisos; el equipo registra una recogida «coincideix» (validada en el acto) y
--      la otra «no_recollit» (anulada con motivo, kg liberados).
--   8. Un solo producto sin disponibilidad: `manifestar_interes` + `aprovar_resposta` como siempre
--      (sin grupo y CON sus avisos por línea: la marca de agrupación no se queda puesta).
--   9. Guardas de grupo: el equipo no puede mover `disponibilitat_id` ni `sollicitud_id` a mano.
--  10. Borrado de ficha y vaciado: `borrar_ficha_completa` de una entidad con solicitud pendiente y
--      de un productor con cabecera arrastran las filas nuevas; el inventario del vaciado las cuenta.

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

create temp table ctx as
select pg_temp.usuari('hola+superadmin@carlessanz.com')         as u_super,
       pg_temp.usuari('hola+equip@carlessanz.com')              as u_equip,
       pg_temp.usuari('hola+prodowner-masprova@carlessanz.com') as u_prod,
       pg_temp.usuari('hola+recowner-social@carlessanz.com')    as u_rec,
       pg_temp.usuari('hola+recowner-comercial@carlessanz.com') as u_com,
       '75eb2254-32c9-472a-91f5-22e0e6a758cd'::uuid             as p_marta,   -- Ofertant de prova (con convenio)
       '3341114b-5b61-42cf-842e-0b94e103157b'::uuid             as e_social,  -- Entitat social receptora de prova
       '3949fbf9-06c2-4425-9e9b-7dbbfb15f019'::uuid             as e_doble,   -- Doble rol de prova (social)
       'cee74104-a3ef-4df4-8d86-c2499ce243a4'::uuid             as e_empresa, -- Empresa receptora de prova (comercial)
       (now() at time zone 'Europe/Madrid')::date               as hoy,
       ((((now() at time zone 'Europe/Madrid')::date + 1) + time '10:00') at time zone 'Europe/Madrid') as dema;
grant select on ctx to authenticated;

-- Las filas que compondría `crear-oferta` (lo mínimo; `asistido` para no pasar por validación).
create function pg_temp.fila(p_prod text, p_kg numeric, p_mods text[], p_n int) returns jsonb
language sql as $$
  select jsonb_build_object(
    'id_excedente', 'E-' || to_char((now() at time zone 'Europe/Madrid')::date, 'YYMMDD') || '-OFE-'
                    || upper(left(p_prod, 3)) || '-' || (9000 + p_n),
    'producto', p_prod, 'kg_total', p_kg, 'modalitat', p_mods[1], 'modalitats', to_jsonb(p_mods),
    'preu_minim', case when 'venda' = any (p_mods) then 0.2 end,
    'disponible_hasta', (now() at time zone 'Europe/Madrid')::date + 10,
    'texto_oferta', 'Prova multiproducte ' || p_prod, 'origen', 'asistido');
$$;

-- ===========================================================================
-- 1. Alta
-- ===========================================================================
create temp table d1 as
select public.crear_disponibilitat(
         (select p_marta from ctx),
         jsonb_build_array(pg_temp.fila('Carbassa', 100, array['donacio'], 1),
                           pg_temp.fila('Ceba', 80, array['donacio'], 2),
                           pg_temp.fila('Poma', 60, array['donacio', 'venda'], 3)),
         null, (select u_equip from ctx)) as j;
grant select on d1 to authenticated;
create temp table g as
select (j->>'disponibilitat_id')::uuid as disp,
       (j->'ofertes'->0->>'id')::uuid as ex_car,
       (j->'ofertes'->1->>'id')::uuid as ex_ceb,
       (j->'ofertes'->2->>'id')::uuid as ex_pom
  from d1;
grant select on g to authenticated;

select pg_temp.ok((select (j->>'codi') ~ ('^D-' || to_char((select hoy from ctx), 'YYMMDD') || '-OFE-[0-9]+$') from d1),
                  'alta: codi D-AAMMDD-OFE-N (' || (select j->>'codi' from d1) || ')');
select pg_temp.ok((select count(*) = 3 and bool_and(estado = 'publicada') and bool_and(productor_id = (select p_marta from ctx))
                     from excedentes where disponibilitat_id = (select disp from g)),
                  'alta: tres ofertes publicades del productor amb el seu grup');
select pg_temp.ok((select created_by = (select u_equip from ctx) and productor_id = (select p_marta from ctx)
                     from disponibilitats where id = (select disp from g)),
                  'alta: la capçalera porta productor i autoria');


-- Publicar un esborrany como primera fila del grupo.
insert into excedentes (productor_id, producto, estado, dades_esborrany, origen)
values ((select p_marta from ctx), 'Enciam', 'esborrany', '{"producte": "Enciam"}', 'asistido');
create temp table esb as
select id from excedentes where productor_id = (select p_marta from ctx) and estado = 'esborrany'
 order by created_at desc limit 1;
create temp table d1b as
select public.crear_disponibilitat(
         (select p_marta from ctx),
         jsonb_build_array(pg_temp.fila('Enciam', 20, array['donacio'], 4),
                           pg_temp.fila('Pastanaga', 30, array['donacio'], 5)),
         (select id from esb), null) as j;
select pg_temp.ok((select (j->'ofertes'->0->>'id')::uuid = (select id from esb) from d1b),
                  'alta: la primera fila reescriu l''esborrany (mateix id)');
select pg_temp.ok((select estado = 'publicada' and dades_esborrany is null
                          and disponibilitat_id = (select (j->>'disponibilitat_id')::uuid from d1b)
                     from excedentes where id = (select id from esb)),
                  'alta: l''esborrany queda publicat, sense dades_esborrany i amb el seu grup');

select pg_temp.ok((select pg_temp.com(null, format(
                     'select public.crear_disponibilitat(%L, %L::jsonb)::text',
                     (select p_marta from ctx), jsonb_build_array(pg_temp.fila('Carbassa', 1, array['donacio'], 6))))
                   like 'ERR 22023 cal_dos_productes%'), 'alta: un sol producte → cal_dos_productes');
select pg_temp.ok((select pg_temp.com(null, format(
                     'select public.crear_disponibilitat(%L, %L::jsonb)::text',
                     (select p_marta from ctx),
                     jsonb_build_array(pg_temp.fila('Carbassa', 1, array['donacio'], 6) || '{"id": "00000000-0000-0000-0000-000000000000"}',
                                       pg_temp.fila('Ceba', 1, array['donacio'], 7))))
                   like 'ERR 22023 columna_no_permesa: id%'), 'alta: columna id → columna_no_permesa');
select pg_temp.ok((select pg_temp.com(null, format(
                     'select public.crear_disponibilitat(%L, %L::jsonb)::text',
                     (select p_marta from ctx),
                     jsonb_build_array(pg_temp.fila('Carbassa', 1, array['donacio'], 6) || '{"estado": "cerrada"}',
                                       pg_temp.fila('Ceba', 1, array['donacio'], 7))))
                   like 'ERR 22023 estat_invalid%'), 'alta: estat diferent de publicada → estat_invalid');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'select public.crear_disponibilitat(%L, %L::jsonb)::text',
                     (select p_marta from ctx),
                     jsonb_build_array(pg_temp.fila('Carbassa', 1, array['donacio'], 6), pg_temp.fila('Ceba', 1, array['donacio'], 7))))
                   like 'ERR 42501%'), 'alta: amb sessio (fins i tot l''equip) → 42501');
select pg_temp.ok((select pg_temp.com(null, format(
                     'select public.crear_disponibilitat(%L, %L::jsonb)::text',
                     (select p_marta from ctx),
                     jsonb_build_array(pg_temp.fila('Carbassa', 1, array['donacio'], 1), pg_temp.fila('Ceba', 1, array['donacio'], 7))))
                   like 'ERR 23505%'), 'alta: id_excedente repetit → 23505 (el servidor reintenta)');

-- ===========================================================================
-- 2. Lectura
-- ===========================================================================
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select count(*)::text from public.ofertes_disponibilitat(%L) where modalitats_meves @> array[''donacio'']',
                     (select disp from g))) = '3'),
                  'lectura: la social veu les tres ofertes del grup amb donacio entre les seves modalitats');
select pg_temp.ok((select pg_temp.com((select u_com from ctx), format(
                     'select string_agg(producto || '':'' || array_to_string(modalitats_meves, ''+''), '','') from public.ofertes_disponibilitat(%L)',
                     (select disp from g))) = 'Poma:venda'),
                  'lectura: la comercial nomes veu la de venda (compatibilitat)');
select pg_temp.ok((select pg_temp.com((select u_prod from ctx), format(
                     'select count(*)::text || ''/'' || count(modalitats_meves)::text from public.ofertes_disponibilitat(%L)',
                     (select disp from g))) = '3/0'),
                  'lectura: el productor veu les seves tres, sense modalitats_meves');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx),
                     'select count(*)::text from public.ofertes_disponibilitat(''00000000-0000-0000-0000-000000000000'')') = '0'),
                  'lectura: uuid inventat → 0 files');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select count(*)::text from public.disponibilitats where id = %L', (select disp from g))) = '1'),
                  'lectura: la social veu la capçalera (RLS per les ofertes que ja veu)');
select pg_temp.ok((select pg_temp.com((select u_prod from ctx), format(
                     'select count(*)::text from public.disponibilitats where id = %L', (select disp from g))) = '1'),
                  'lectura: el productor veu la seva capçalera');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx),
                     'select count(*)::text from public.disponibilitats where productor_id <> ''75eb2254-32c9-472a-91f5-22e0e6a758cd''') = '0'),
                  'lectura: la social no veu capçaleres alienes sense ofertes visibles');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx),
                     'insert into public.disponibilitats (codi, productor_id) values (''D-000000-XXX-1'', ''75eb2254-32c9-472a-91f5-22e0e6a758cd'') returning id::text')
                   like 'ERR 42501%'), 'lectura: ningu escriu disponibilitats a ma (GRANT nomes SELECT)');

-- ===========================================================================
-- 3. Solicitud de la entidad social (dos productos, una fecha)
-- ===========================================================================
create temp table s1 as
select pg_temp.com((select u_rec from ctx), format(
         'select public.manifestar_interes_multiple(%L, %L::jsonb, %L)::text',
         (select disp from g),
         jsonb_build_array(jsonb_build_object('excedente_id', (select ex_car from g), 'kg', 40),
                           jsonb_build_object('excedente_id', (select ex_ceb from g), 'kg', 30)),
         (select dema from ctx))) as t;
select pg_temp.ok((select t not like 'ERR%' from s1), 'sollicitud: la RPC respon (' || (select left(t, 200) from s1) || ')');
create temp table sol as select (t::jsonb->>'sollicitud_id')::uuid as id from s1;
grant select on sol to authenticated;
select pg_temp.ok((select estat = 'pendent' and entidad_id = (select e_social from ctx) and canal = 'panel'
                          and recollida_at = (select dema from ctx) and created_by = (select u_rec from ctx)
                     from sollicituds_recollida where id = (select id from sol)),
                  'sollicitud: pendent, de la social, canal panel, amb la data comuna');
select pg_temp.ok((select count(*) = 2 and bool_and(aprovacio = 'pendent' and estado = 'acceptada'
                                                     and recollida_at = (select dema from ctx))
                     from oferta_respuestas where sollicitud_id = (select id from sol)),
                  'sollicitud: dos interessos pendents amb sollicitud_id i la mateixa data');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select count(*)::text from public.sollicituds_recollida where id = %L', (select id from sol))) = '1'),
                  'sollicitud: la social la veu');
select pg_temp.ok((select pg_temp.com((select u_prod from ctx), format(
                     'select count(*)::text from public.sollicituds_recollida where id = %L', (select id from sol))) = '0'),
                  'sollicitud: el productor NO la veu mentre no hi ha canalitzacio');
select pg_temp.ok((select pg_temp.com((select u_com from ctx), format(
                     'select count(*)::text from public.sollicituds_recollida where id = %L', (select id from sol))) = '0'),
                  'sollicitud: una altra entitat no la veu');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select public.manifestar_interes_multiple(%L, %L::jsonb, %L)::text',
                     (select disp from g),
                     jsonb_build_array(jsonb_build_object('excedente_id', (select ex_pom from g), 'kg', 5)),
                     (select dema from ctx))) like 'ERR 22023 sollicitud_pendent%'),
                  'sollicitud: una segona pendent de la mateixa entitat → sollicitud_pendent');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select public.manifestar_interes_multiple(%L, %L::jsonb, %L, %L)::text',
                     (select disp from g),
                     jsonb_build_array(jsonb_build_object('excedente_id', (select ex_pom from g), 'kg', 5)),
                     (select dema from ctx), (select e_empresa from ctx))) like 'ERR 42501%'),
                  'sollicitud: en nom d''una entitat aliena → 42501');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select public.manifestar_interes_multiple(%L, %L::jsonb, %L)::text',
                     '00000000-0000-0000-0000-000000000000',
                     jsonb_build_array(jsonb_build_object('excedente_id', (select ex_pom from g), 'kg', 5)),
                     (select dema from ctx))) like 'ERR 22023 disponibilitat_inexistent%'),
                  'sollicitud: disponibilitat inventada → 22023');

-- ===========================================================================
-- 4. Todo o nada: una línea incompatible tumba la solicitud entera
-- ===========================================================================
create temp table s2 as
select pg_temp.com((select u_com from ctx), format(
         'select public.manifestar_interes_multiple(%L, %L::jsonb, %L)::text',
         (select disp from g),
         jsonb_build_array(jsonb_build_object('excedente_id', (select ex_pom from g), 'kg', 10, 'modalitat', 'venda', 'preu', 0.5),
                           jsonb_build_object('excedente_id', (select ex_car from g), 'kg', 10)),
         (select dema from ctx))) as t;
select pg_temp.ok((select t like 'ERR 22023 Aquesta oferta no encaixa%' from s2),
                  'tot o res: la linia de donacio per a la comercial → no encaixa (' || (select left(t, 120) from s2) || ')');
select pg_temp.ok((select count(*) = 0 from sollicituds_recollida where entidad_id = (select e_empresa from ctx)),
                  'tot o res: cap sollicitud de la comercial');
select pg_temp.ok((select count(*) = 0 from oferta_respuestas
                    where entidad_id = (select e_empresa from ctx) and excedente_id = (select ex_pom from g)),
                  'tot o res: tampoc l''interes de la primera linia (que era valida)');

-- ===========================================================================
-- 5. Resolver: aprobar uno, rechazar otro, un solo aviso
-- ===========================================================================
create temp table rr as
select (select id from oferta_respuestas where sollicitud_id = (select id from sol) and excedente_id = (select ex_car from g)) as r_car,
       (select id from oferta_respuestas where sollicitud_id = (select id from sol) and excedente_id = (select ex_ceb from g)) as r_ceb;
grant select on rr to authenticated;

select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'select public.resoldre_sollicitud(%L, %L::jsonb)::text', (select id from sol),
                     jsonb_build_array(jsonb_build_object('resposta_id', (select r_car from rr), 'accio', 'aprova'))))
                   like 'ERR 22023 falten_linies%'), 'resoldre: una sola linia de dues → falten_linies');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select public.resoldre_sollicitud(%L, %L::jsonb)::text', (select id from sol),
                     jsonb_build_array(jsonb_build_object('resposta_id', (select r_car from rr), 'accio', 'aprova'))))
                   like 'ERR 42501%'), 'resoldre: l''entitat no resol → 42501');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx),
                     'select public.resoldre_sollicitud(''00000000-0000-0000-0000-000000000000'', ''[]''::jsonb)::text')
                   like 'ERR 42501%'), 'resoldre: uuid inventat per un extern → 42501 (permis abans que existencia)');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx),
                     'select public.resoldre_sollicitud(''00000000-0000-0000-0000-000000000000'', ''[]''::jsonb)::text')
                   like 'ERR 22023 sollicitud_inexistent%'), 'resoldre: uuid inventat per l''equip → 22023');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'select public.resoldre_sollicitud(%L, %L::jsonb)::text', (select id from sol),
                     jsonb_build_array(jsonb_build_object('resposta_id', (select r_car from rr), 'accio', 'aprova'),
                                       jsonb_build_object('resposta_id', (select r_ceb from rr), 'accio', 'potser'))))
                   like 'ERR 22023 accio_invalida%'), 'resoldre: accio desconeguda → accio_invalida');

-- `created_at` es `now()` = el inicio de ESTA transacción: se comparan ids, no fechas.
create temp table avisos0 as select id from avisos;
create temp table rs as
select pg_temp.com((select u_equip from ctx), format(
         'select public.resoldre_sollicitud(%L, %L::jsonb)::text', (select id from sol),
         jsonb_build_array(jsonb_build_object('resposta_id', (select r_car from rr), 'accio', 'aprova', 'kg', 35),
                           jsonb_build_object('resposta_id', (select r_ceb from rr), 'accio', 'rebutja',
                                              'motiu', 'Ja no en queda prou')))) as t;
select pg_temp.ok((select t not like 'ERR%' from rs), 'resoldre: la RPC respon (' || (select left(t, 200) from rs) || ')');
create temp table can1 as
select id from canalizaciones where sollicitud_id = (select id from sol);
grant select on can1 to authenticated;
select pg_temp.ok((select count(*) = 1 from can1), 'resoldre: una sola canalitzacio amb sollicitud_id');
select pg_temp.ok((select excedente_id = (select ex_car from g) and kg_confirmados = 35 and estado = 'confirmada'
                          and valorizacion = 'donacio' and data_hora_recollida = (select dema from ctx)
                     from canalizaciones where id = (select id from can1)),
                  'resoldre: la canalitzacio de la carbassa, 35 kg ajustats, donacio, amb la data comuna');
select pg_temp.ok((select aprovacio = 'aprovada' and canalizacion_id = (select id from can1) and kg_aprovats = 35
                     from oferta_respuestas where id = (select r_car from rr)),
                  'resoldre: l''interes aprovat apunta a la seva canalitzacio');
select pg_temp.ok((select aprovacio = 'rebutjada' and motiu_aprovacio = 'Ja no en queda prou' and aprovat_per = (select u_equip from ctx)
                     from oferta_respuestas where id = (select r_ceb from rr)),
                  'resoldre: l''altre, rebutjat amb el motiu');
select pg_temp.ok((select estat = 'resolta' and resolta_at is not null from sollicituds_recollida where id = (select id from sol)),
                  'resoldre: la sollicitud queda resolta');
select pg_temp.ok((select count(*) = 2
                          and count(*) filter (where tipus = 'sollicitud_resolta') = 2
                          and count(*) filter (where destinatari_tipo = 'entidad' and destinatari_id = (select e_social from ctx)) = 1
                          and count(*) filter (where destinatari_tipo = 'productor' and destinatari_id = (select p_marta from ctx)) = 1
                     from avisos where id not in (select id from avisos0) and objecte_id = (select id from sol)),
                  'resoldre: exactament dos avisos sollicitud_resolta (entitat i productor)');
select pg_temp.ok((select count(*) = 0 from avisos
                    where tipus in ('interes_aprovat', 'interes_rebutjat', 'sortida_trobada')
                      and (objecte_id in ((select r_car from rr), (select r_ceb from rr), (select ex_car from g), (select ex_ceb from g)))),
                  'resoldre: cap aviso per linia (interes_aprovat / interes_rebutjat / sortida_trobada)');
select pg_temp.ok((select (params->>'n_aprovades')::int = 1 and (params->>'n_rebutjades')::int = 1
                          and jsonb_array_length(params->'linies') = 2 and objecte_tipo = 'sollicitud_recollida'
                     from avisos where objecte_id = (select id from sol) and destinatari_tipo = 'entidad'),
                  'resoldre: l''avis de l''entitat porta les dues linies (1 aprovada, 1 rebutjada)');
select pg_temp.ok((select jsonb_array_length(params->'linies') = 1 and params->>'entitat' is not null
                     from avisos where objecte_id = (select id from sol) and destinatari_tipo = 'productor'),
                  'resoldre: l''avis del productor nomes porta l''aprovada');
select pg_temp.ok((select pg_temp.com((select u_prod from ctx), format(
                     'select count(*)::text from public.sollicituds_recollida where id = %L', (select id from sol))) = '1'),
                  'resoldre: ara el productor ja veu la sollicitud (te una canalitzacio seva)');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'select public.resoldre_sollicitud(%L, %L::jsonb)::text', (select id from sol),
                     jsonb_build_array(jsonb_build_object('resposta_id', (select r_car from rr), 'accio', 'aprova'))))
                   like 'ERR 22023 linia_ja_resolta%'), 'resoldre: tornar-hi → linia_ja_resolta');

-- ===========================================================================
-- 6. Recogida con diferencia (la entidad declara) → «Valida totes» → ENT+REC
-- ===========================================================================
select pg_temp.ok((select pg_temp.com((select u_com from ctx), format(
                     'select public.registrar_recollida_multiple(%L, %L::jsonb)::text', (select id from sol),
                     jsonb_build_array(jsonb_build_object('canalizacion_id', (select id from can1), 'resultat', 'coincideix'))))
                   like 'ERR 42501%'), 'recollida: una altra entitat → 42501');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select public.registrar_recollida_multiple(%L, %L::jsonb)::text', (select id from sol),
                     jsonb_build_array(jsonb_build_object('canalizacion_id', (select id from can1), 'resultat', 'inferior', 'kg_reals', 30))))
                   like 'ERR 22023 falta_motiu_diferencia%'), 'recollida: inferior sense motiu → falta_motiu_diferencia');
create temp table rc as
select pg_temp.com((select u_rec from ctx), format(
         'select public.registrar_recollida_multiple(%L, %L::jsonb)::text', (select id from sol),
         jsonb_build_array(jsonb_build_object('canalizacion_id', (select id from can1), 'resultat', 'inferior',
                                              'kg_reals', 30, 'observacions', 'Una caixa malmesa')))) as t;
select pg_temp.ok((select t not like 'ERR%' from rc), 'recollida: la RPC respon (' || (select left(t, 200) from rc) || ')');
select pg_temp.ok((select kg_declarats = 30 and resultat_recollida = 'menys' and recollida_registrada_at is not null
                          and recollida_validada_at is null and recollida_origen = 'entitat_receptora'
                     from canalizaciones where id = (select id from can1)),
                  'recollida: declarada (30 kg, menys), pendent de validar');
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select public.validar_recollides_sollicitud(%L)::text', (select id from sol))) like 'ERR 42501%'),
                  'recollida: l''entitat no valida → 42501');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'select public.validar_recollides_sollicitud(%L)::text', (select id from sol)))
                   like 'ERR 22023 cal_motiu_validacio%'),
                  'valida totes: amb diferencia i sense motiu → cal_motiu_validacio (la regla de validar_recollida)');
create temp table vt as
select pg_temp.com((select u_equip from ctx), format(
         'select public.validar_recollides_sollicitud(%L, %L)::text', (select id from sol),
         'Revisat amb l''entitat')) as t;
select pg_temp.ok((select t not like 'ERR%' and (t::jsonb->>'validades')::int = 1 from vt),
                  'valida totes: una canalitzacio validada (' || (select left(t, 200) from vt) || ')');
select pg_temp.ok((select recollida_validada_at is not null and estado = 'conciliada' and kg_conciliados = 30
                     from canalizaciones where id = (select id from can1)),
                  'valida totes: conciliada amb els 30 kg reals');
select pg_temp.ok((select count(*) filter (where tipo = 'ENT') = 1 and count(*) filter (where tipo = 'REC') = 1
                          and bool_and(estado = 'conciliado') and bool_and(numero_completo is not null)
                     from albaranes where canalizacion_id = (select id from can1) and estado <> 'anulado'),
                  'valida totes: ENT i REC d''aquesta canalitzacio, emesos i conciliats');

-- ===========================================================================
-- 7. Nivel 1: asignación directa de dos productos y recogida del equipo
-- ===========================================================================
delete from avisos0;
insert into avisos0 select id from avisos;
select pg_temp.ok((select pg_temp.com((select u_rec from ctx), format(
                     'select public.assignar_directe_multiple(%L, %L, %L::jsonb)::text', (select disp from g), (select e_doble from ctx),
                     jsonb_build_array(jsonb_build_object('excedente_id', (select ex_ceb from g), 'kg', 20))))
                   like 'ERR 42501%'), 'nivell 1: un extern → 42501');
create temp table a1 as
select pg_temp.com((select u_super from ctx), format(
         'select public.assignar_directe_multiple(%L, %L, %L::jsonb, %L)::text', (select disp from g), (select e_doble from ctx),
         jsonb_build_array(jsonb_build_object('excedente_id', (select ex_ceb from g), 'kg', 20),
                           jsonb_build_object('excedente_id', (select ex_pom from g), 'kg', 10, 'modalitat', 'donacio')),
         (select dema from ctx))) as t;
select pg_temp.ok((select t not like 'ERR%' from a1), 'nivell 1: la RPC respon (' || (select left(t, 200) from a1) || ')');
create temp table sol2 as select (t::jsonb->>'sollicitud_id')::uuid as id from a1;
grant select on sol2 to authenticated;
select pg_temp.ok((select estat = 'resolta' and canal = 'asistido' from sollicituds_recollida where id = (select id from sol2)),
                  'nivell 1: sollicitud resolta, canal asistido');
select pg_temp.ok((select count(*) = 2 and bool_and(estado = 'confirmada')
                     from canalizaciones where sollicitud_id = (select id from sol2)),
                  'nivell 1: dues canalitzacions confirmades amb sollicitud_id');
select pg_temp.ok((select count(*) = 2 and bool_and(aprovacio = 'aprovada' and assignacio_directa)
                     from oferta_respuestas where sollicitud_id = (select id from sol2)),
                  'nivell 1: dos interessos aprovats (assignacio directa) amb sollicitud_id');
select pg_temp.ok((select count(*) = 2 and bool_and(tipus = 'sollicitud_resolta')
                     from avisos where id not in (select id from avisos0)
                      and tipus in ('sollicitud_resolta', 'interes_aprovat', 'sortida_trobada')),
                  'nivell 1: dos avisos sollicitud_resolta i cap per linia');

create temp table can2 as
select (select id from canalizaciones where sollicitud_id = (select id from sol2) and excedente_id = (select ex_ceb from g)) as c_ceb,
       (select id from canalizaciones where sollicitud_id = (select id from sol2) and excedente_id = (select ex_pom from g)) as c_pom;
create temp table rc2 as
select pg_temp.com((select u_equip from ctx), format(
         'select public.registrar_recollida_multiple(%L, %L::jsonb)::text', (select id from sol2),
         jsonb_build_array(jsonb_build_object('canalizacion_id', (select c_ceb from can2), 'resultat', 'coincideix'),
                           jsonb_build_object('canalizacion_id', (select c_pom from can2), 'resultat', 'no_recollit',
                                              'motiu', 'No hi havia poma')))) as t;
select pg_temp.ok((select t not like 'ERR%' from rc2), 'nivell 1: recollida de l''equip respon (' || (select left(t, 200) from rc2) || ')');
select pg_temp.ok((select estado = 'conciliada' and recollida_origen = 'equip' and kg_conciliados = 20
                     from canalizaciones where id = (select c_ceb from can2)),
                  'nivell 1: la ceba, registrada i validada en l''acte (conciliada, origen equip)');
select pg_temp.ok((select count(*) filter (where tipo = 'ENT') = 1 and count(*) filter (where tipo = 'REC') = 1
                          and bool_and(estado = 'conciliado')
                     from albaranes where canalizacion_id = (select c_ceb from can2) and estado <> 'anulado'),
                  'nivell 1: ENT i REC de la ceba conciliats');
select pg_temp.ok((select estado = 'anulada' and motiu_anulacio = 'No recollit: No hi havia poma'
                     from canalizaciones where id = (select c_pom from can2)),
                  'nivell 1: la poma, anul·lada amb el motiu');
select pg_temp.ok((select kg_sense_desti = 60 from public.desti_excedent((select ex_pom from g))),
                  'nivell 1: els kg de la poma tornen a estar lliures');
select pg_temp.ok((select count(*) = 0 from albaranes where canalizacion_id = (select c_pom from can2) and estado <> 'anulado'),
                  'nivell 1: els albarans de la poma, anul·lats');

-- ===========================================================================
-- 8. Un solo producto, sin disponibilidad: como siempre
-- ===========================================================================
insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, modalitats, estado, origen,
                        disponible_hasta, texto_oferta)
values ('E-' || to_char((select hoy from ctx), 'YYMMDD') || '-OFE-TOM-9100', (select p_marta from ctx), 'Tomàquet', 50,
        'donacio', array['donacio'], 'publicada', 'asistido', (select hoy from ctx) + 10, 'Prova sola');
create temp table sola as select id from excedentes where id_excedente like '%-OFE-TOM-9100';
grant select on sola to authenticated;
create temp table mi as
select pg_temp.com((select u_rec from ctx), format(
         'select (public.manifestar_interes(%L, %L, 10, null, null, null, %L)).id::text',
         (select id from sola), (select e_social from ctx), (select dema from ctx))) as t;
select pg_temp.ok((select t not like 'ERR%' from mi), 'sol: manifestar_interes com sempre (' || (select left(t, 120) from mi) || ')');
select pg_temp.ok((select sollicitud_id is null from oferta_respuestas where id = (select t::uuid from mi)),
                  'sol: l''interes no porta sollicitud');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'select (public.aprovar_resposta(%L)).id::text', (select t from mi))) not like 'ERR%'),
                  'sol: aprovar_resposta com sempre');
select pg_temp.ok((select count(*) = 1 from avisos where tipus = 'interes_aprovat' and objecte_id = (select t::uuid from mi)),
                  'sol: l''avis interes_aprovat per linia segueix sortint (la marca no s''ha quedat posada)');
select pg_temp.ok((select sollicitud_id is null from canalizaciones where excedente_id = (select id from sola)),
                  'sol: la canalitzacio no porta sollicitud');

-- ===========================================================================
-- 9. Guardas de grupo
-- ===========================================================================
select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'update public.excedentes set disponibilitat_id = null where id = %L returning id::text', (select ex_car from g)))
                   like 'ERR 42501 grup_protegit%'), 'guarda: l''equip no treu una oferta del grup a ma');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'update public.canalizaciones set sollicitud_id = null where id = %L returning id::text', (select id from can1)))
                   like 'ERR 42501 grup_protegit%'), 'guarda: l''equip no mou una canalitzacio de sollicitud a ma');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'update public.oferta_respuestas set sollicitud_id = null where id = %L returning id::text', (select r_ceb from rr)))
                   like 'ERR 42501 grup_protegit%'), 'guarda: l''equip no mou un interes de sollicitud a ma');
select pg_temp.ok((select pg_temp.com((select u_equip from ctx), format(
                     'update public.excedentes set observacions = ''arnes'' where id = %L returning id::text', (select ex_car from g)))
                   not like 'ERR%'), 'guarda: la resta de l''oferta es pot editar igual');

-- ===========================================================================
-- 10. Borrado de ficha y vaciado
-- ===========================================================================
-- Una entidad con un interés (aunque sea de una solicitud) NO se borra: `ofertes_rebudes` (regla de
-- 20270508100000, sin cambios). Una solicitud sin líneas (escrita a mano) sí cae con la ficha.
insert into entidades (nombre, tipo_receptor, es_test) values ('TEST-MULTI entitat', 'social', true);
create temp table fe as select id from entidades where nombre = 'TEST-MULTI entitat';
insert into sollicituds_recollida (disponibilitat_id, entidad_id, recollida_at)
values ((select disp from g), (select id from fe), (select dema from ctx));
insert into oferta_respuestas (excedente_id, entidad_id, estado, kg_solicitados, modalitat, sollicitud_id)
values ((select ex_pom from g), (select id from fe), 'acceptada', 5, 'donacio',
        (select id from sollicituds_recollida where entidad_id = (select id from fe)));
select pg_temp.ok((select pg_temp.com((select u_super from ctx), format(
                     'select public.borrar_ficha_completa(''entidad'', %L)::text', (select id from fe)))
                   like 'ERR 22023 bloqueig_esborrat: ofertes_rebudes%'),
                  'esborrat: una entitat amb interessos (de sollicitud) segueix bloquejada (ofertes_rebudes)');
delete from oferta_respuestas where entidad_id = (select id from fe);
select pg_temp.ok((select pg_temp.com((select u_super from ctx), format(
                     'select public.borrar_ficha_completa(''entidad'', %L)::text', (select id from fe))) not like 'ERR%'),
                  'esborrat: sense interessos, la fitxa de l''entitat s''esborra');
select pg_temp.ok((select count(*) = 0 from sollicituds_recollida where entidad_id = (select id from fe)),
                  'esborrat: la seva sollicitud cau amb la fitxa');

-- Un productor nuevo con una cabecera sin ofertas (con ofertas, la ficha no se borra: bloqueo).
insert into productores (name, empresa, es_test) values ('TEST-MULTI prod', 'TEST-MULTI prod', true);
create temp table fp as select id from productores where name = 'TEST-MULTI prod';
insert into disponibilitats (codi, productor_id) values ('D-000101-TES-1', (select id from fp));
select pg_temp.ok((select pg_temp.com((select u_super from ctx), format(
                     'select public.borrar_ficha_completa(''productor'', %L)::text', (select id from fp))) not like 'ERR%'),
                  'esborrat: la fitxa del productor amb capçalera s''esborra');
select pg_temp.ok((select count(*) = 0 from disponibilitats where codi = 'D-000101-TES-1'),
                  'esborrat: la capçalera cau amb la fitxa');

select pg_temp.ok((select (r->'taules') ? 'disponibilitats' and (r->'taules') ? 'sollicituds_recollida'
                          and (r->'taules'->>'disponibilitats')::int >= 2
                     from (select public.reiniciar_dades_operatives(false) as r) x),
                  'buidatge: l''inventari compta disponibilitats i sollicituds');

\o
\echo 'prova-multiproducte: tot correcte (ROLLBACK)'
rollback;
