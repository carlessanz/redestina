-- Prueba de los precios de referencia (punto 3, fase D1, 20270531100000). SOLO CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-preus-referencia.sql
--
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja nada. Usa un producto
-- sintético (`TEST-PREU`) y cargas sintéticas de 2025 (las reales del clon no se tocan).
-- Cada caso imprime «ok · …»; el primero que no se cumple aborta con «FALLA · …».
--
-- Casos:
--   a. Precedencia (ajuste 20270602100000): Gencat del mes → si no lo tiene, el ÚLTIMO precio
--      de Gencat del producto (con su mes de origen) y Mercabarna no se mira → Mercabarna solo
--      sin Gencat: el ÚLTIMO día capturado del mes (no la media) y solo con el mes cerrado →
--      manual vigente; un producto `preu_manual` va siempre al manual.
--   b. Validar en bloque (2025-01 a 2025-03) y por mes: guarda el mes de origen (`font_mes`);
--      no sobrescribe lo validado (tampoco cuando Gencat publica después el mes); el mes futuro
--      se niega; las cargas usadas quedan `validada`.
--   c. Cambiar una celda exige motivo y deja el anterior en el historial.
--   d. `preu_referencia_de()`: validado → anterior (provisional) → manual.
--   e. Idempotencia de `registrar_carrega_preus` (mismo fichero; mismo día de Mercabarna).
--   f. Alta de producto: duplicado (23505) y familia desconocida (22023).
--   g. Permisos: técnico (lee, no valida), cuenta externa (42501), internas sin EXECUTE.

\set QUIET on
\set ON_ERROR_STOP on
\o /dev/null
begin;

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

select pg_temp.usuari('hola+superadmin@carlessanz.com')          as u_super,
       pg_temp.usuari('hola+equip@carlessanz.com')               as u_equip,
       pg_temp.usuari('hola+prodowner-masprova@carlessanz.com')  as u_prod1
\gset

\echo '== Datos sintéticos =='
select pg_temp.ok(pg_temp.com(:'u_super', $q$select crear_producte('TEST-PREU', 'Varis', 'Test precio')$q$) = 'TEST-PREU',
                  'el super_admin da de alta un producto');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select crear_producte('test-preu', 'Varis')$q$) like 'ERR 23505%',
                  'un nombre repetido (sin distinguir mayúsculas) es 23505');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select crear_producte('TEST-PREU-2', 'Família inventada')$q$) like 'ERR 22023%familia_desconeguda%',
                  'una familia que no existe es 22023');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select crear_producte('TEST-PREU-3', 'Varis')$q$) like 'ERR 42501%',
                  'el técnico no da de alta productos (42501)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select crear_producte('TEST-PREU-M', 'Varis')$q$) = 'TEST-PREU-M',
                  'un segundo producto, solo con Mercabarna');

-- Cargas: una de Gencat (enero de 2025 = 100 €/100 kg) y dos días de Mercabarna en febrero.
select registrar_carrega_preus('gencat',
  '{"sha256":"test-gencat-1","data_font":"2025-03-15","periode_fins":"2025-01-01"}',
  '[{"codi_font":"T-001","nom_font":"Test producte","exercici":2025,"mes":1,"valor_original":100,"unitat":"€/100 kg","eur_kg":1.0}]')
  as carrega_g \gset
select registrar_carrega_preus('mercabarna', '{"sha256":"test-merca-1","data_font":"2025-02-03"}',
  '[{"nom_font":"TEST PREU","exercici":2025,"mes":2,"dia":3,"valor_original":2,"unitat":"€/kg","eur_kg":2},
    {"nom_font":"TEST PREU M","exercici":2025,"mes":2,"dia":3,"valor_original":2,"unitat":"€/kg","eur_kg":2}]') as carrega_m1 \gset
select registrar_carrega_preus('mercabarna', '{"sha256":"test-merca-2","data_font":"2025-02-10"}',
  '[{"nom_font":"TEST PREU","exercici":2025,"mes":2,"dia":10,"valor_original":3,"unitat":"€/kg","eur_kg":3},
    {"nom_font":"TEST PREU M","exercici":2025,"mes":2,"dia":10,"valor_original":3,"unitat":"€/kg","eur_kg":3}]') as carrega_m2 \gset
select pg_temp.ok(:'carrega_g' <> '' and :'carrega_m1' <> '' and :'carrega_m2' <> '', 'tres cargas registradas');
select pg_temp.ok(registrar_carrega_preus('gencat', '{"sha256":"test-gencat-1"}', '[]') is null,
                  'el mismo fichero de Gencat no crea otra carga (null)');
select pg_temp.ok(registrar_carrega_preus('mercabarna', '{"sha256":"otro","data_font":"2025-02-10"}', '[]') is null,
                  'el mismo día de Mercabarna no crea otra carga (null)');
select pg_temp.ok((select files from preus_carregues where id = :'carrega_g') = 1, 'la carga cuenta sus filas');

select pg_temp.ok(pg_temp.com(:'u_super', $q$select afegir_equivalencia_preu('TEST-PREU', 'gencat', 'Test producte', 'T-001')::text$q$) not like 'ERR%',
                  'equivalencia con Gencat (por código)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select afegir_equivalencia_preu('TEST-PREU', 'mercabarna', ' TEST PREU ')::text$q$) not like 'ERR%',
                  'equivalencia con Mercabarna (el nombre se recorta)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select afegir_equivalencia_preu('TEST-PREU', 'mercabarna', 'test preu')::text$q$)
                  = (select id::text from productes_fonts where producto = 'TEST-PREU' and font = 'mercabarna'),
                  'añadirla otra vez (en minúsculas) devuelve la misma: idempotente');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select fijar_coste_producto('TEST-PREU', 0.5, 'prova')::text$q$) not like 'ERR%',
                  'precio manual vigente 0,50');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select afegir_equivalencia_preu('TEST-PREU-M', 'mercabarna', 'TEST PREU M')::text$q$) not like 'ERR%',
                  'TEST-PREU-M: solo equivalencia con Mercabarna');

\echo '== a. Precedencia =='
select pg_temp.ok((select proposta_font = 'gencat' and proposta_eur_kg = 1.0 and manual_eur_kg = 0.5
                          and gencat_mes = '2025-01-01' and proposta_mes_font = '2025-01-01'
                     from preus_calcula_mes(2025, 1) where producto = 'TEST-PREU'),
                  'enero: Gencat manda sobre el manual, con su mes');
select pg_temp.ok((select proposta_font = 'gencat' and proposta_eur_kg = 1.0 and proposta_mes_font = '2025-01-01'
                          and mercabarna_eur_kg = 3
                     from preus_calcula_mes(2025, 2) where producto = 'TEST-PREU'),
                  'febrero: Gencat no lo tiene → su ÚLTIMO precio (enero, 1,00); Mercabarna existe pero no se usa');
select pg_temp.ok((select proposta_font = 'gencat' and proposta_eur_kg = 1.0 and proposta_mes_font = '2025-01-01'
                     from preus_calcula_mes(2025, 3) where producto = 'TEST-PREU'),
                  'marzo: también el último de Gencat (enero), no el manual');
select pg_temp.ok((select proposta_font = 'manual' and gencat_eur_kg is null and proposta_mes_font is null
                     from preus_calcula_mes(2024, 12) where producto = 'TEST-PREU'),
                  'Gencat nunca mira meses POSTERIORES al pedido');
select pg_temp.ok((select proposta_font = 'mercabarna' and proposta_eur_kg = 3 and mercabarna_dies = 2
                          and proposta_mes_font = '2025-02-01'
                     from preus_calcula_mes(2025, 2) where producto = 'TEST-PREU-M'),
                  'sin Gencat: el ÚLTIMO valor de Mercabarna del mes (día 10: 3,00), no la media; 2 días capturados');
select pg_temp.ok((select proposta_font is null and proposta_eur_kg is null
                     from preus_calcula_mes(2025, 3) where producto = 'TEST-PREU-M'),
                  'sin Gencat ni Mercabarna ni manual: sin propuesta');
update productos set preu_manual = true where nombre = 'TEST-PREU';
select pg_temp.ok((select proposta_font = 'manual' and proposta_eur_kg = 0.5 and proposta_mes_font is null
                     from preus_calcula_mes(2025, 1) where producto = 'TEST-PREU'),
                  'un producto preu_manual va al manual aunque Gencat tenga el mes');
update productos set preu_manual = false where nombre = 'TEST-PREU';
update preus_carregues set estat = 'descartada' where id = :'carrega_m2';
select pg_temp.ok((select mercabarna_eur_kg = 2 and mercabarna_dies = 1 from preus_calcula_mes(2025, 2) where producto = 'TEST-PREU-M'),
                  'una carga descartada no cuenta: el último valor pasa a ser el del día 3');
update preus_carregues set estat = 'pendent' where id = :'carrega_m2';
-- El mes en curso: Mercabarna no propone nada hasta que el mes se cierra.
select extract(year from now() at time zone 'Europe/Madrid')::int as ara_e,
       extract(month from now() at time zone 'Europe/Madrid')::int as ara_m \gset
select registrar_carrega_preus('mercabarna', '{"sha256":"test-merca-ara","data_font":"2025-02-20"}',
  format('[{"nom_font":"TEST PREU M","exercici":%s,"mes":%s,"dia":1,"valor_original":9,"unitat":"€/kg","eur_kg":9}]',
         :ara_e, :ara_m)::jsonb) as carrega_ara \gset
select pg_temp.ok((select mercabarna_eur_kg is null from preus_calcula_mes(:ara_e, :ara_m) where producto = 'TEST-PREU-M'),
                  'el mes en curso: Mercabarna no propone (el precio no cambia cada día)');
delete from preus_carregues where id = :'carrega_ara';

\echo '== b. Validar =='
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select validar_preus_mes(2025, 1)::text$q$) like 'ERR 42501%',
                  'el técnico no valida (42501)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select validar_preus_periode(2025, 1, 2025, 3)->>'mesos'$q$) = '3',
                  'el super_admin valida 2025-01..03 en bloque');
select pg_temp.ok((select string_agg(mes || ':' || font || ':' || eur_kg::numeric(6,2), ',' order by mes)
                     from preus_referencia where producto = 'TEST-PREU')
                  = '1:gencat:1.00,2:gencat:1.00,3:gencat:1.00',
                  'TEST-PREU: los tres meses con Gencat (1,00)');
select pg_temp.ok((select string_agg(mes || ':' || coalesce(font_mes::text, '-'), ',' order by mes)
                     from preus_referencia where producto = 'TEST-PREU')
                  = '1:2025-01-01,2:2025-01-01,3:2025-01-01',
                  'y cada uno dice de qué mes sale: enero');
select pg_temp.ok((select string_agg(mes || ':' || font || ':' || eur_kg::numeric(6,2) || ':' || font_mes, ',' order by mes)
                     from preus_referencia where producto = 'TEST-PREU-M')
                  = '2:mercabarna:3.00:2025-02-01',
                  'TEST-PREU-M: solo febrero, con Mercabarna (último valor) y su mes');
select pg_temp.ok((select font_dies = 2 and font_nom = 'TEST PREU M' and validat_per = :'u_super'
                     from preus_referencia where producto = 'TEST-PREU-M' and mes = 2),
                  'febrero guarda los días capturados, el nombre en la fuente y quién validó');
select pg_temp.ok((select count(*) = 3 from preus_carregues
                    where id in (:'carrega_g', :'carrega_m1', :'carrega_m2') and estat = 'validada'),
                  'las cargas usadas quedan validada');
-- Una carga nueva de Gencat que revisa enero no cambia lo validado.
select registrar_carrega_preus('gencat', '{"sha256":"test-gencat-2","data_font":"2025-04-15"}',
  '[{"codi_font":"T-001","nom_font":"Test producte","exercici":2025,"mes":1,"valor_original":120,"unitat":"€/100 kg","eur_kg":1.2}]')
  as carrega_g2 \gset
select pg_temp.ok((select proposta_eur_kg = 1.2 and validat_eur_kg = 1.0 from preus_calcula_mes(2025, 1) where producto = 'TEST-PREU'),
                  'la propuesta usa la carga más reciente; el validado se queda');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select validar_preus_mes(2025, 1)->>'validats'$q$)::int >= 0,
                  'volver a validar el mes');
select pg_temp.ok((select eur_kg = 1.0 from preus_referencia where producto = 'TEST-PREU' and mes = 1 and exercici = 2025),
                  'no sobrescribe lo validado');
-- Gencat publica después febrero: lo validado (con el precio de enero) se queda sin actualizar.
select registrar_carrega_preus('gencat', '{"sha256":"test-gencat-3","data_font":"2025-05-15"}',
  '[{"codi_font":"T-001","nom_font":"Test producte","exercici":2025,"mes":2,"valor_original":150,"unitat":"€/100 kg","eur_kg":1.5}]')
  as carrega_g3 \gset
select pg_temp.ok((select proposta_eur_kg = 1.5 and proposta_mes_font = '2025-02-01'
                          and validat_eur_kg = 1.0 and validat_font_mes = '2025-01-01'
                     from preus_calcula_mes(2025, 2) where producto = 'TEST-PREU'),
                  'Gencat publica febrero: la propuesta pasa a febrero (1,50); lo validado sigue con enero (1,00)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select validar_preus_mes(2025, 2)->>'validats'$q$) = '0',
                  'volver a validar febrero no toca lo validado');
select pg_temp.ok((select eur_kg = 1.0 and font_mes = '2025-01-01' from preus_referencia
                    where producto = 'TEST-PREU' and exercici = 2025 and mes = 2),
                  'febrero: 1,00 de enero, sin actualizar');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select validar_preus_mes(2099, 1)::text$q$) like 'ERR 22023%mes_futur%',
                  'un mes futuro se niega (22023 mes_futur)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select validar_preus_mes(2025, 13)::text$q$) like 'ERR 22023%mes_invalid%',
                  'un mes 13 se niega (22023 mes_invalid)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select validar_preus_mes(2025, 1, '[{"producto":"TEST-PREU","font":"gencat"}]')::text$q$)
                    like 'ERR 22023%motiu_obligatori%',
                  'cambiar un mes ya validado sin motivo se niega');

\echo '== c. Cambiar una celda =='
select pg_temp.ok(pg_temp.com(:'u_super', $q$select fixar_preu_referencia('TEST-PREU', 2025, 1, 'gencat', null, '')::text$q$) like 'ERR 22023%motiu_obligatori%',
                  'sin motivo, no');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select fixar_preu_referencia('TEST-PREU', 2025, 1, 'gencat', null, 'Gencat ha revisat gener')->>'canviats'$q$) = '1',
                  'con motivo: toma el valor nuevo de Gencat');
select pg_temp.ok((select eur_kg = 1.2 and motiu = 'Gencat ha revisat gener' and carrega_id = :'carrega_g2'
                     from preus_referencia where producto = 'TEST-PREU' and exercici = 2025 and mes = 1),
                  'el precio, el motivo y la carga nuevos');
select pg_temp.ok((select count(*) = 1 and min(eur_kg) = 1.0 and min(motiu_canvi) = 'Gencat ha revisat gener'
                     from preus_referencia_hist where producto = 'TEST-PREU'),
                  'el anterior (1,00) queda en el historial con el motivo del cambio');
-- (Dos sentencias: una subconsulta de la misma sentencia no vería lo que acaba de escribir la RPC.)
select pg_temp.ok(pg_temp.com(:'u_super', $q$select fixar_preu_referencia('TEST-PREU', 2025, 2, 'manual', 0.75, 'Preu pactat')->>'canviats'$q$) = '1',
                  'otra fuente y otro precio, con motivo');
select pg_temp.ok((select font = 'manual' and eur_kg = 0.75 and proposta_eur_kg = 0.5 from preus_referencia
                    where producto = 'TEST-PREU' and exercici = 2025 and mes = 2),
                  'guarda lo que proponía la fuente elegida (0,50) junto al precio fijado (0,75)');

\echo '== d. preu_referencia_de() (contrato para la D2) =='
select pg_temp.ok((select eur_kg = 0.75 and font = 'manual' and not provisional and origen = 'validat'
                     from preu_referencia_de('TEST-PREU', '2025-02-15')),
                  'mes validado: el suyo, no provisional');
select pg_temp.ok((select eur_kg = 1.0 and font = 'gencat' and provisional and origen = 'anterior' and exercici = 2025 and mes = 3
                     from preu_referencia_de('TEST-PREU', '2025-06-01')),
                  'mes sin validar: el último anterior, provisional y con su mes');
select pg_temp.ok((select eur_kg = 0.5 and font = 'manual' and provisional and origen = 'manual'
                     from preu_referencia_de('TEST-PREU', '2024-12-01')),
                  'antes de todo lo validado: el manual, provisional (el producto tiene fuentes)');
update productos set preu_manual = true where nombre = 'TEST-PREU';
select pg_temp.ok((select not provisional from preu_referencia_de('TEST-PREU', '2024-12-01')),
                  'si el producto es preu_manual, el manual no es provisional');
select pg_temp.ok((select count(*) = 0 from preu_referencia_de('Producte inexistent', '2025-01-01')),
                  'sin nada: cero filas');

\echo '== f2. Propuesta del alta de oferta: solo Mercabarna = precio del día (20270603100000) =='
select pg_temp.ok((select eur_kg = 3 and font = 'mercabarna' and not provisional and dia is null
                     from preu_proposta_oferta('TEST-PREU-M', '2025-02-15')),
                  'solo Mercabarna con el mes validado: manda el validado');
select pg_temp.ok((select eur_kg = 3 and font = 'mercabarna' and provisional and dia = '2025-02-10'
                          and mes_font = '2025-02-01'
                     from preu_proposta_oferta('TEST-PREU-M', '2025-03-15')),
                  'solo Mercabarna sin el mes validado: el precio del último día capturado, provisional');
select pg_temp.ok((select eur_kg = 3 and dia is null from preu_proposta_oferta('TEST-PREU-M', '2025-02-05')),
                  'con el mes validado no se mira el día (aunque haya precio de ese día)');
update productos set preu_manual = false where nombre = 'TEST-PREU';
select pg_temp.ok((select dia is null from preu_proposta_oferta('TEST-PREU', '2025-03-15')),
                  'un producto con Gencat no toma el precio del día de Mercabarna');
select pg_temp.ok((select count(*) = 1 from preus_vigents_oferta('2025-03-15')
                    where producto = 'TEST-PREU-M' and dia = '2025-02-10'),
                  'preus_vigents_oferta lleva el día');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select preu_proposta_oferta('TEST-PREU-M', current_date)::text$q$) like 'ERR 42501%'
                  and pg_temp.com(:'u_super', $q$select preu_dia_mercabarna('TEST-PREU-M', current_date)::text$q$) like 'ERR 42501%',
                  'preu_proposta_oferta y preu_dia_mercabarna son internas');
update productos set preu_manual = true where nombre = 'TEST-PREU';

\echo '== g. Permisos =='
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select count(*)::text from preus_proposta_mes(2025, 1)$q$)::int > 0,
                  'el técnico lee la propuesta del mes');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select count(*)::text from preus_referencia$q$)::int > 0
                  and pg_temp.com(:'u_equip', $q$select count(*)::text from preus_carregues$q$)::int > 0,
                  'el técnico lee precios y cargas');
select pg_temp.ok(pg_temp.com(:'u_prod1', $q$select count(*)::text from preus_proposta_mes(2025, 1)$q$) like 'ERR 42501%',
                  'una cuenta externa no lee la propuesta (42501)');
select pg_temp.ok(pg_temp.com(:'u_prod1', $q$select count(*)::text from preus_referencia$q$) = '0'
                  and pg_temp.com(:'u_prod1', $q$select count(*)::text from preus_carregues$q$) = '0',
                  'una cuenta externa ve 0 filas');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select preu_referencia_de('TEST-PREU', current_date)::text$q$) like 'ERR 42501%',
                  'preu_referencia_de es interna (sin EXECUTE para una sesión)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select registrar_carrega_preus('gencat', '{}', '[]')::text$q$) like 'ERR 42501%',
                  'registrar_carrega_preus es interna');
select pg_temp.ok(pg_temp.com(:'u_super', $q$insert into preus_referencia (producto, exercici, mes, eur_kg, font) values ('TEST-PREU', 2025, 5, 1, 'manual') returning 'x'$q$) like 'ERR 42501%',
                  'ni el super_admin escribe directo (42501)');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select fixar_font_preus('gencat', false)::text$q$) like 'ERR 42501%'
                  and pg_temp.com(:'u_super', $q$select fixar_font_preus('gencat', null, 'https://example.com/x.xls')::text$q$) like 'ERR 22023%url_invalida%',
                  'la URL de una fuente: solo super_admin y solo de su dominio');
select pg_temp.ok((select count(*) = 0 from auditoria_funcions_obertes()), 'auditoria_funcions_obertes() en 0 filas');

rollback;
