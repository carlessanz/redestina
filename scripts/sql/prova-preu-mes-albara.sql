-- Prueba del precio del mes del albarán (punto 3, fase D2, 20270601100000). SOLO CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-preu-mes-albara.sql
--
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja nada (ni números de serie).
-- Usa dos productos sintéticos (`TEST-D2`, `TEST-D2B`), una ficha de productor y una entidad
-- social sintéticas. El MES ACTUAL (M, hora de Madrid) es el mes del albarán; el último validado
-- es M-2 (como Gencat, con dos meses de retraso). Cada caso imprime «ok · …»; el primero que no
-- se cumple aborta con «FALLA · …».
--
-- Casos:
--   a. Una canalización nueva sin coste declarado: provisional con el precio de M-2, su mes de
--      albarán M y el de la fuente M-2; el REC lo imprime provisional. Una `declarat`: 0,65 y
--      definitiva. Una de un producto sin ningún precio: null y provisional (deuda 128).
--   b. Certificado de oferta: bloqueado (`preus_provisionals`, con producto y mes) y su emisión
--      negada con 22023. Escritura directa del equipo: 42501 en una conciliada y en `preu_*`.
--   c. Validar M: la canalización pasa al precio de M con rastro (`mes_validat`, anterior y
--      nuevo, quién); el certificado en borrador se recalcula solo y ya se emite con el valor de M;
--      la `declarat`, intacta; el REC ya no es provisional.
--   d. Revalidar M con otro precio: la canalización certificada no se mueve; una sin certificar sí
--      (`mes_revalidat`).
--   e. Deuda 128: la de sin precio bloquea; un precio manual de M la valora.
--   e2. Gencat sin el mes (20270602100000): validar M toma el último Gencat (M-2); la fila
--      guarda `font_mes = M-2`, la canalización `preu_mes_font = M-2` con albarán de M, y
--      `preus_vigents_oferta` lo devuelve.
--   f. Canalizaciones de antes de la D2: intactas. Permisos: el historial y la lectura del mes son
--      del equipo; las funciones internas no tienen EXECUTE; `auditoria_funcions_obertes()` en 0.

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

-- Un NIF válido y libre (como `prueba-conciliacion-y-certificados.sql`).
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

create temp table t_ids (k text primary key, v uuid);
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from t_ids where k = p_k $$;
create function pg_temp.c(p_k text) returns canalizaciones language sql as $$
  select c.* from canalizaciones c where c.id = (select v from t_ids where k = p_k) $$;

select pg_temp.usuari('hola+superadmin@carlessanz.com')          as u_super,
       pg_temp.usuari('hola+equip@carlessanz.com')               as u_equip,
       pg_temp.usuari('hola+prodowner-masprova@carlessanz.com')  as u_prod1
\gset

-- El mes actual (M) y el último validado (M-2), en hora de Madrid.
select date_trunc('month', now() at time zone 'Europe/Madrid')::date                        as m,
       (date_trunc('month', now() at time zone 'Europe/Madrid') - interval '2 months')::date as m2
\gset
select extract(year from :'m'::date)::int as m_any, extract(month from :'m'::date)::int as m_mes,
       extract(year from :'m2'::date)::int as m2_any, extract(month from :'m2'::date)::int as m2_mes
\gset

-- Una canalización de antes de la D2, para comprobar al final que no se ha movido.
create temp table t_antiga as
  select id, coste_kg, preu_font, preu_provisional from canalizaciones
   where preu_font = 'historic' order by created_at limit 1;

\echo '== Datos sintéticos =='
select pg_temp.ok(pg_temp.com(:'u_super', $q$select crear_producte('TEST-D2', 'Varis')$q$) = 'TEST-D2'
                  and pg_temp.com(:'u_super', $q$select crear_producte('TEST-D2B', 'Varis')$q$) = 'TEST-D2B',
                  'dos productos sintéticos');
-- El manual vigente de TEST-D2 (la propuesta de M al validar) y el precio validado de M-2.
insert into costes_producto (producto, coste_kg, motivo) values ('TEST-D2', 0.80, 'prova D2');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select fixar_preu_referencia('TEST-D2', %s, %s, 'manual', 0.50, 'prova D2')::text$q$,
                                                 :m2_any, :m2_mes)) not like 'ERR%',
                  'M-2 validado para TEST-D2 a 0,50');

do $d$
declare
  v_prod uuid; v_ent uuid; v_e uuid; v_c uuid;
begin
  insert into productores (name, empresa, email, nif, direccion, codigo_postal, poblacion, es_test)
  values ('Prova D2', 'Prova D2 SL', 'prova-d2-prod@example.invalid', pg_temp.nif_lliure(),
          'Carrer de Prova 2', '08001', 'Barcelona', true)
  returning id into v_prod;
  update productores set razon_social = empresa where id = v_prod;
  insert into t_ids values ('prod', v_prod);
  insert into entidades (nombre, email, es_test, tipo_receptor, estat, activo)
  values ('Entitat Prova D2', 'prova-d2-ent@example.invalid', true, 'social', 'Signat', false)
  returning id into v_ent;
  -- ex1 · ex3 · ex4: sin coste; ex2: declarado 0,65; ex5: producto sin ningún precio.
  for i in 1..5 loop
    insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen, coste_kg)
    values ('E-PROVA-D2-' || i, v_prod, case when i = 5 then 'TEST-D2B' else 'TEST-D2' end,
            100, 'donacio', 'publicada', 'asistido', case when i = 2 then 0.65 end)
    returning id into v_e;
    insert into t_ids values ('ex' || i, v_e);
    -- La de ex4 se crea después de validar M (caso d).
    if i <> 4 then
      insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
      values (v_e, v_ent, 100, 'donacio', 'confirmada') returning id into v_c;
      insert into t_ids values ('c' || i, v_c);
    end if;
  end loop;
  insert into t_ids values ('ent', v_ent);
end $d$;

\echo '== a. Al crear la canalización =='
select pg_temp.ok((select coste_kg = 0.50 and preu_font = 'manual' and preu_provisional
                          and preu_mes_albara = :'m'::date and preu_mes_font = :'m2'::date
                     from pg_temp.c('c1')),
                  'sin coste declarado: 0,50 de M-2, provisional, mes del albarán M');
select pg_temp.ok((select coste_kg = 0.65 and preu_font = 'declarat' and not preu_provisional and preu_mes_font is null
                     from pg_temp.c('c2')),
                  'con coste declarado: 0,65, declarat, definitivo');
select pg_temp.ok((select coste_kg is null and preu_font is null and preu_provisional from pg_temp.c('c5')),
                  'sin ningún precio: null y provisional (deuda 128)');
select pg_temp.ok((select (l->>'valor_kg')::numeric = 0.50 and (l->'valor_font'->>'provisional')::boolean
                          and l->'valor_font'->>'font' = 'manual'
                          and l->'valor_font'->>'mes_font' = :'m2'
                     from jsonb_array_elements(albaran_datos((select a.id from albaranes a
                            where a.tipo = 'REC' and a.excedente_id = pg_temp.id('ex1')))->'linies') l),
                  'el REC lleva el valor provisional y su fuente (valor_font)');
select pg_temp.ok((select count(*) = 1 and min(provisionals) = 2
                     from preus_canalitzacions_mes(:m_any, :m_mes) where producto = 'TEST-D2'),
                  'la pantalla de Preus de M ve 2 canalizaciones provisionales de TEST-D2');

\echo '== b. Bloqueo del certificado y protección =='
select conciliacion_retroactiva(pg_temp.id('c1'), 100, null, 'prova D2');
select conciliacion_retroactiva(pg_temp.id('c3'), 100, null, 'prova D2');
select conciliacion_retroactiva(pg_temp.id('c5'), 100, null, 'prova D2');
select pg_temp.ok((select estado = 'conciliada' and coste_kg = 0.50 and preu_provisional from pg_temp.c('c1')),
                  'conciliar no cambia el valor provisional');
select calcular_certificado_periodo(pg_temp.id('prod'), null, null, 'prueba', pg_temp.id('ex1'));
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(cp.bloqueos) b
                                   where b->>'codigo' = 'preus_provisionals' and (b->>'bloqueja')::boolean
                                     and b->'mesos'->0->>'producto' = 'TEST-D2'
                                     and b->'mesos'->0->>'mes' = to_char(:'m'::date, 'YYYY-MM'))
                     from cierres_periodo cp where cp.excedente_id = pg_temp.id('ex1')),
                  'el certificado de la oferta lleva el bloqueo preus_provisionals (producto y mes)');
do $d$
begin
  perform emitir_certificado_periodo((select id from cierres_periodo where excedente_id = pg_temp.id('ex1')));
  raise exception 'FALLA · la emisión con precios provisionales debería fallar';
exception when sqlstate '22023' then
  -- `emitir_certificado_periodo` mira antes los bloqueos (el detalle del bloqueo); si estuvieran
  -- desfasados, la guarda del trigger da `preus_provisionals` con la lista.
  if sqlerrm not like '%preus_provisionals%' and sqlerrm not like '%Preus de referencia provisionals: TEST-D2%' then
    raise exception 'FALLA · mensaje inesperado: %', sqlerrm;
  end if;
  raise notice 'ok · emitir con precios provisionales: 22023 (bloqueig preus_provisionals)';
end $d$;
do $d$
begin
  -- La guarda del trigger, sola: con los bloqueos vaciados a mano (como si estuvieran desfasados).
  update cierres_periodo set bloqueos = '[]'::jsonb where excedente_id = pg_temp.id('ex1');
  perform emitir_certificado_periodo((select id from cierres_periodo where excedente_id = pg_temp.id('ex1')));
  raise exception 'FALLA · la guarda de la emisión debería saltar';
exception when sqlstate '22023' then
  if sqlerrm not like 'preus_provisionals: TEST-D2 (%' then raise exception 'FALLA · mensaje inesperado: %', sqlerrm; end if;
  raise notice 'ok · la guarda de la emisión: 22023 preus_provisionals con producto y mes';
end $d$;
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$update canalizaciones set coste_kg = 9 where id = %L returning 'x'$q$, pg_temp.id('c1')))
                    like 'ERR 42501%preu_canalitzacio_protegit%',
                  'el equipo no cambia a mano el valor de una conciliada (42501)');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$update canalizaciones set preu_provisional = false where id = %L returning 'x'$q$, pg_temp.id('c1')))
                    like 'ERR 42501%',
                  'nadie marca a mano una canalización como definitiva (42501)');

\echo '== c. Validar el mes del albarán =='
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select validar_preus_mes(%s, %s)::text$q$, :m_any, :m_mes)) not like 'ERR%',
                  'el super_admin valida M');
select pg_temp.ok((select coste_kg = 0.80 and preu_font = 'manual' and not preu_provisional and preu_mes_font = :'m'::date
                     from pg_temp.c('c1')),
                  'la provisional pasa a 0,80 de M, definitiva');
select pg_temp.ok((select count(*) = 1 from canalizaciones_preu_hist h
                    where h.canalizacion_id = pg_temp.id('c1') and h.motiu = 'mes_validat'
                      and h.coste_anterior = 0.50 and h.coste_nou = 0.80 and h.provisional_anterior
                      and not h.provisional_nou and h.canviat_per = :'u_super'::uuid),
                  'con rastro: anterior 0,50, nuevo 0,80, mes_validat, quién');
select pg_temp.ok((select coste_kg = 0.65 and preu_font = 'declarat' from pg_temp.c('c2')),
                  'la declarat no se ha tocado');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(cp.bloqueos) b where b->>'codigo' = 'preus_provisionals')
                          and cp.valor_total = 80.00
                     from cierres_periodo cp where cp.excedente_id = pg_temp.id('ex1')),
                  'el certificado en borrador se ha recalculado solo: sin bloqueo y 100 kg × 0,80 = 80,00 €');
select pg_temp.ok((select (l->>'valor_kg')::numeric = 0.80 and not (l->'valor_font'->>'provisional')::boolean
                     from jsonb_array_elements(albaran_datos((select a.id from albaranes a
                            where a.tipo = 'REC' and a.excedente_id = pg_temp.id('ex1')))->'linies') l),
                  'un REC emitido a partir de ahora ya no es provisional');
do $d$
declare r jsonb;
begin
  r := emitir_certificado_periodo((select id from cierres_periodo where excedente_id = pg_temp.id('ex1')));
  if (r->>'import')::numeric <> 80.00 then raise exception 'FALLA · import %', r->>'import'; end if;
  raise notice 'ok · el certificado se emite con el valor de M (80,00 €)';
end $d$;
select pg_temp.ok((select preu_certificat like 'P-CDP%' from pg_temp.c('c1')),
                  'la canalización queda sellada con el número del certificado');
select pg_temp.ok((select (d.datos->'fonts_valor') @> jsonb_build_array(jsonb_build_object('font', 'manual', 'mes_font', :'m', 'dies', null))
                     from documentos d join cierres_periodo cp on cp.id = d.objeto_id
                    where cp.excedente_id = pg_temp.id('ex1') and d.objeto_tipo = 'cierre_periodo'
                    order by d.version desc limit 1),
                  'el snapshot del certificado lleva las fuentes (fonts_valor)');

\echo '== d. Revalidar el mes =='
select calcular_certificado_periodo(pg_temp.id('prod'), null, null, 'prueba', pg_temp.id('ex3'));
select emitir_certificado_periodo((select id from cierres_periodo where excedente_id = pg_temp.id('ex3')));
insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
values (pg_temp.id('ex4'), pg_temp.id('ent'), 100, 'donacio', 'confirmada');
insert into t_ids select 'c4', id from canalizaciones where excedente_id = pg_temp.id('ex4');
select pg_temp.ok((select coste_kg = 0.80 and not preu_provisional and preu_font = 'manual' from pg_temp.c('c4')),
                  'una canalización creada con M ya validado: 0,80 definitiva');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select fixar_preu_referencia('TEST-D2', %s, %s, 'manual', 0.90, 'revisio prova D2')::text$q$,
                                                 :m_any, :m_mes)) not like 'ERR%',
                  'el super_admin revalida M a 0,90 con motivo');
select pg_temp.ok((select coste_kg = 0.80 from pg_temp.c('c1')) and (select coste_kg = 0.80 from pg_temp.c('c3')),
                  'las certificadas siguen a 0,80');
select pg_temp.ok((select coste_kg = 0.90 from pg_temp.c('c4'))
                  and exists (select 1 from canalizaciones_preu_hist where canalizacion_id = pg_temp.id('c4') and motiu = 'mes_revalidat'),
                  'la no certificada sigue al precio revalidado (mes_revalidat)');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$update canalizaciones set coste_kg = 1 where id = %L returning 'x'$q$, pg_temp.id('c3')))
                    like 'ERR 42501%canalitzacio_certificada%',
                  'el valor de una certificada no se cambia a mano (42501)');

\echo '== e. Deuda 128 =='
select calcular_certificado_periodo(pg_temp.id('prod'), null, null, 'prueba', pg_temp.id('ex5'));
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(cp.bloqueos) b where b->>'codigo' = 'preus_provisionals')
                          and not exists (select 1 from jsonb_array_elements(cp.bloqueos) b where b->>'codigo' = 'sense_cost')
                     from cierres_periodo cp where cp.excedente_id = pg_temp.id('ex5')),
                  'sin precio: bloquea con preus_provisionals (y sin el sense_cost repetido)');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select fixar_preu_referencia('TEST-D2B', %s, %s, 'manual', 0.40, 'sense font')::text$q$,
                                                 :m_any, :m_mes)) not like 'ERR%',
                  'el equipo pone un precio manual a M');
select pg_temp.ok((select coste_kg = 0.40 and not preu_provisional from pg_temp.c('c5'))
                  and (select valor_total = 40.00 and not exists (select 1 from jsonb_array_elements(bloqueos) b where (b->>'bloqueja')::boolean)
                         from cierres_periodo where excedente_id = pg_temp.id('ex5')),
                  'la conciliada sin coste se valora (0,40) y el certificado se desbloquea');

\echo '== e2. Gencat sin el mes: su último precio, con el mes de origen (20270602100000) =='
select pg_temp.ok(pg_temp.com(:'u_super', $q$select crear_producte('TEST-D2G', 'Varis')$q$) = 'TEST-D2G',
                  'un producto con Gencat');
select registrar_carrega_preus('gencat', '{"sha256":"test-d2g","data_font":"2025-01-15"}',
  format('[{"codi_font":"T-D2G","nom_font":"Test D2G","exercici":%s,"mes":%s,"valor_original":110,"unitat":"€/100 kg","eur_kg":1.10}]',
         :m2_any, :m2_mes)::jsonb) as carrega_d2g \gset
select pg_temp.ok(pg_temp.com(:'u_super', $q$select afegir_equivalencia_preu('TEST-D2G', 'gencat', 'Test D2G', 'T-D2G')::text$q$) not like 'ERR%',
                  'su equivalencia con Gencat');
do $d$
declare v_e uuid; v_c uuid;
begin
  insert into excedentes (id_excedente, productor_id, producto, kg_total, modalitat, estado, origen)
  values ('E-PROVA-D2-6', pg_temp.id('prod'), 'TEST-D2G', 100, 'donacio', 'publicada', 'asistido')
  returning id into v_e;
  insert into t_ids values ('ex6', v_e);
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion, estado)
  values (v_e, pg_temp.id('ent'), 100, 'donacio', 'confirmada') returning id into v_c;
  insert into t_ids values ('c6', v_c);
end $d$;
select pg_temp.ok((select coste_kg is null and preu_provisional from pg_temp.c('c6')),
                  'sin ningún mes validado: sin valor y provisional');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select validar_preus_mes(%s, %s)::text$q$, :m_any, :m_mes)) not like 'ERR%',
                  'validar M: Gencat aún no tiene M');
select pg_temp.ok((select font = 'gencat' and eur_kg = 1.10 and font_mes = :'m2'::date
                     from preus_referencia where producto = 'TEST-D2G' and exercici = :m_any and mes = :m_mes),
                  'M queda validado con el último Gencat (M-2) y lo dice (font_mes)');
select pg_temp.ok((select coste_kg = 1.10 and preu_font = 'gencat' and not preu_provisional
                          and preu_mes_albara = :'m'::date and preu_mes_font = :'m2'::date
                     from pg_temp.c('c6')),
                  'la canalización hereda el valor, la fuente y el mes de ORIGEN (M-2); su albarán sigue en M');
select pg_temp.ok((select mes_font = :'m2'::date and font = 'gencat' and not provisional
                     from preus_vigents_oferta() where producto = 'TEST-D2G'),
                  'la propuesta de la oferta también dice el mes de origen');

\echo '== f. Lo de antes y los permisos =='
select pg_temp.ok((select count(*) = 0 from t_antiga a join canalizaciones c on c.id = a.id
                    where c.coste_kg is distinct from a.coste_kg or c.preu_font is distinct from a.preu_font
                       or c.preu_provisional is distinct from a.preu_provisional),
                  'una canalización de antes de la D2 sigue igual');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select count(*)::text from canalizaciones_preu_hist$q$)::int > 0,
                  'el técnico lee el historial de valores');
select pg_temp.ok(pg_temp.com(:'u_prod1', $q$select count(*)::text from canalizaciones_preu_hist$q$) = '0',
                  'una cuenta externa ve 0 filas del historial');
select pg_temp.ok(pg_temp.com(:'u_prod1', format($q$select count(*)::text from preus_canalitzacions_mes(%s, %s)$q$, :m_any, :m_mes)) like 'ERR 42501%',
                  'una cuenta externa no lee lo que espera un mes (42501)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$insert into canalizaciones_preu_hist (canalizacion_id, motiu) values (gen_random_uuid(), 'x') returning 'x'$q$) like 'ERR 42501%',
                  'nadie escribe el historial a mano (42501)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select preus_ajusta_canalitzacions('TEST-D2', 2026, 1)::text$q$) like 'ERR 42501%'
                  and pg_temp.com(:'u_super', $q$select valoracio_canalitzacio(gen_random_uuid(), current_date)::text$q$) like 'ERR 42501%'
                  and pg_temp.com(:'u_super', $q$select preus_vigents_oferta(current_date)::text$q$) like 'ERR 42501%',
                  'las funciones internas no tienen EXECUTE para una sesión');
select pg_temp.ok((select count(*) = 0 from auditoria_funcions_obertes()), 'auditoria_funcions_obertes() en 0 filas');

rollback;
\o
\echo 'prova-preu-mes-albara: TOT CORRECTE'
