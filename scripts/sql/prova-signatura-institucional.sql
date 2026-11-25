-- Prueba de los perfiles del equipo y de la firma (20270615100000–100200, proceso 0.1).
-- SOLO CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-signatura-institucional.sql
--
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja nada. Las filas en modo REAL
-- que necesita (cierres de 2099, un acumulado, certificados con número) se crean dentro y
-- desaparecen con el rollback: es justo lo que `comprobar-rls.ts` no puede hacer, porque corre
-- contra producción y una fila real no se crea nunca desde el arnés.
--
-- Cada caso imprime «ok · …»; el primero que no se cumple aborta con «FALLA · …».
--
-- Casos:
--   1. Rol: la cuenta `equip` es `admin`; `tecnic` ya no entra (CHECK y `canviar_rol_equip`).
--   2. Firma institucional en REAL, solo super_admin: contrafirmar, emitir CR, rectificar CD, CDP
--      y CR. El Dinamitzador recibe el 42501 nuevo; el super_admin pasa la guarda y choca con lo
--      siguiente (los datos provisionales del clon). En PRUEBA el Dinamitzador sigue pasando.
--   3. Configuración: el Dinamitzador no escribe las listas de prueba; el super_admin sí.
--   4. Firmas de la contraparte: el Dinamitzador cierra y rechaza la de un albarán, no la de un
--      CONV; una subida suya de un ENT se cierra al momento, la de un CONV va a la cola.
--   5. Firma propia: `fixar_firma_equip` (servidor), `la_meva_firma`, y `signant_equip` congelado
--      en el albarán y copiado a `documentos.datos` al emitir; null si emite el servidor.

\set QUIET on
\set ON_ERROR_STOP on
\o /dev/null
begin;

-- ---------------------------------------------------------------------------
-- Ayudantes (temporales)
-- ---------------------------------------------------------------------------
-- Consulta escalar con la SESIÓN de una cuenta, o como el servidor (`p_user` null).
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

-- Un documento vigente y pendiente de firma de un tipo (de cualquier ficha: es el clon).
create function pg_temp.doc(p_tipo text, p_salta int default 0) returns uuid
language plpgsql as $$
declare v uuid;
begin
  select v2.documento_id into v
    from v_signatura_document v2
   where v2.tipo = p_tipo and v2.estat = 'pendent'
   order by v2.numero_completo
   offset p_salta limit 1;
  if v is null then
    raise exception 'Falta un % pendent de signar al clon', p_tipo;
  end if;
  return v;
end;
$$;

select pg_temp.usuari('hola+superadmin@carlessanz.com')         as u_super,
       pg_temp.usuari('hola+equip@carlessanz.com')              as u_equip,
       pg_temp.usuari('hola+prodowner-masprova@carlessanz.com') as u_prod1,
       '00000000-0000-0000-0000-000000000000'                   as z
\gset

-- ---------------------------------------------------------------------------
\echo '== 1. Rol =='
select pg_temp.ok((select array_agg(rol order by rol) = array['admin'] from usuario_roles where user_id = :'u_equip'),
                  'la cuenta equip es admin (y solo admin)');
select pg_temp.ok(not exists (select 1 from usuario_roles where rol = 'tecnic'), 'no queda ninguna fila tecnic');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select pot_aprovar()::text$q$) = 'true', 'el Dinamitzador tiene pot_aprovar()');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select es_super_admin()::text$q$) = 'false', 'el Dinamitzador NO es super_admin');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select canviar_rol_equip(%L, 'tecnic')::text$q$, :'u_equip'))
                  like 'ERR 22023 rol_invalid%', 'canviar_rol_equip(tecnic) → 22023 rol_invalid');
select pg_temp.ok(pg_temp.com(null, format($q$insert into usuario_roles (user_id, rol) values (%L, 'tecnic') returning rol$q$, :'u_super'))
                  like 'ERR 23514%', 'el CHECK de usuario_roles rechaza tecnic (23514)');
select pg_temp.ok(exists (select 1 from equip_rols_hist where user_id = :'u_equip' and rol_abans = 'tecnic'
                            and rol_despres = 'admin' and detall ? 'motiu'),
                  'el paso a admin dejó rastro en equip_rols_hist');

-- ---------------------------------------------------------------------------
\echo '== 2. Firma institucional =='
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select contrafirmar_convenio(%L)::text$q$, :'z')) like 'ERR 42501%',
                  'contrafirmar_convenio: el Dinamitzador → 42501');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select contrafirmar_convenio(%L)::text$q$, :'z')) like 'ERR 22023%',
                  'contrafirmar_convenio: el super_admin pasa la guarda (22023, no existe)');

-- Filas REALES de 2099 (desaparecen con el rollback).
select (select id from entidades order by created_at limit 1)   as ent,
       (select id from productores order by created_at limit 1) as prod
\gset
insert into cierres_receptor (entidad_id, periodo_desde, periodo_hasta, ejercicio, modo, calculado_at, kg_total)
values (:'ent', '2099-01-01', '2099-03-31', 2099, 'real', now(), 10) returning id as cr_emetre \gset
insert into cierres_receptor (entidad_id, periodo_desde, periodo_hasta, ejercicio, modo, calculado_at, kg_total,
                              certificado_numero, certificado_at, estado)
values (:'ent', '2099-04-01', '2099-06-30', 2099, 'real', now(), 10, 'CR-2099-TEST', now(), 'certificat_emes')
returning id as cr_real \gset
insert into cierres_receptor (entidad_id, periodo_desde, periodo_hasta, ejercicio, modo, kg_total)
values (:'ent', '2099-07-01', '2099-09-30', 2099, 'prueba', 10) returning id as cr_prova \gset
insert into cierres_periodo (productor_id, periodo_desde, periodo_hasta, ejercicio, modo, kg_total,
                             certificado_numero, certificado_at, estado)
values (:'prod', '2099-01-01', '2099-03-31', 2099, 'real', 10, 'CDP-2099-TEST', now(), 'certificat_emes')
returning id as cdp_real \gset
insert into cierres_ejercicio (ejercicio, modo) values (2099, 'real') returning id as ce_real \gset
insert into cierres_donante (cierre_id, productor_id, kg_total, certificado_numero, certificado_at, estado)
values (:'ce_real', :'prod', 10, 'CD-2099-TEST', now(), 'certificat_emes') returning id as cd_real \gset

select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select emetre_certificat_recepcio(%L)::text$q$, :'cr_emetre'))
                  like 'ERR 42501 Nomes el super_admin signa%', 'emetre_certificat_recepcio REAL: el Dinamitzador → 42501');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select emetre_certificat_recepcio(%L)::text$q$, :'cr_emetre'))
                  not like 'ERR 42501 Nomes el super_admin%', 'emetre_certificat_recepcio REAL: el super_admin pasa la guarda');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select emetre_certificat_recepcio(%L)::text$q$, :'cr_prova'))
                  like 'ERR 22023%', 'emetre_certificat_recepcio PRUEBA: el Dinamitzador pasa (22023 sin calcular)');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select rectificar_certificat_recepcio(%L, 'arnes')::text$q$, :'cr_real'))
                  like 'ERR 42501 Nomes el super_admin signa%', 'rectificar_certificat_recepcio REAL: el Dinamitzador → 42501');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select rectificar_certificat_recepcio(%L, 'arnes')::text$q$, :'cr_real'))
                  not like 'ERR 42501 Nomes el super_admin%', 'rectificar_certificat_recepcio REAL: el super_admin pasa la guarda');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select rectificar_certificado_periodo(%L, 'arnes')::text$q$, :'cdp_real'))
                  like 'ERR 42501 Nomes el super_admin signa%', 'rectificar_certificado_periodo REAL: el Dinamitzador → 42501');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select rectificar_certificado_periodo(%L, 'arnes')::text$q$, :'cdp_real'))
                  not like 'ERR 42501 Nomes el super_admin%', 'rectificar_certificado_periodo REAL: el super_admin pasa la guarda');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select rectificar_certificado(%L, 'arnes')::text$q$, :'cd_real'))
                  like 'ERR 42501 Nomes el super_admin signa%', 'rectificar_certificado REAL: el Dinamitzador → 42501');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select rectificar_certificado(%L, 'arnes')::text$q$, :'cd_real'))
                  not like 'ERR 42501 Nomes el super_admin%', 'rectificar_certificado REAL: el super_admin pasa la guarda');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select emitir_certificado(%L)::text$q$, :'cd_real'))
                  like 'ERR 42501%', 'emitir_certificado REAL: el Dinamitzador → 42501 (como antes)');

-- ---------------------------------------------------------------------------
\echo '== 3. Configuración =='
select pg_temp.ok(pg_temp.com(:'u_equip', $q$insert into email_test_recipients (email) values ('arnes-0-1@exemple.cat') returning email$q$)
                  like 'ERR 42501%', 'el Dinamitzador no añade correos de prueba (42501)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$insert into email_test_recipients (email) values ('arnes-0-1@exemple.cat') returning email$q$)
                  = 'arnes-0-1@exemple.cat', 'el super_admin sí');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$insert into meta_test_recipients (phone) values ('34600000001') returning phone$q$)
                  like 'ERR 42501%', 'el Dinamitzador no añade teléfonos de prueba (42501)');
select pg_temp.ok(pg_temp.com(:'u_equip', $q$select count(*)::text from email_test_recipients$q$)::int > 0,
                  'el Dinamitzador sigue leyendo las listas');

-- ---------------------------------------------------------------------------
\echo '== 4. Firmas de la contraparte =='
select pg_temp.doc('ENT', 0) as ent1, pg_temp.doc('CONV', 0) as conv1, pg_temp.doc('REC', 0) as rec1 \gset

-- Una subida del Dinamitzador de un ENT: se cierra al momento (vía correu).
select pg_temp.com(null, format($q$select ruta_document_signat(%L, 'pdf')$q$, :'ent1')) as ruta_ent \gset
select pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb)::text$q$,
  :'ent1', :'u_equip', jsonb_build_object('ruta', :'ruta_ent', 'sha256', repeat('c', 64),
                                          'mime', 'application/pdf', 'bytes', 1234))) as reg_ent \gset
select pg_temp.ok(:'reg_ent' like '{%' and (:'reg_ent'::jsonb ->> 'estat') = 'tancat' and (:'reg_ent'::jsonb ->> 'via') = 'correu',
                  'el Dinamitzador sube un ENT firmado → tancat al momento (vía correu)');
select pg_temp.ok((select signant_nom is null from firmes_document where id = (:'reg_ent'::jsonb ->> 'firma_id')::uuid),
                  'sin nombre declarado no figura el Dinamitzador como firmante');

-- Una subida suya de un CONV: va a la cola del super_admin.
select pg_temp.com(null, format($q$select ruta_document_signat(%L, 'pdf')$q$, :'conv1')) as ruta_conv \gset
select pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb)::text$q$,
  :'conv1', :'u_equip', jsonb_build_object('ruta', :'ruta_conv', 'sha256', repeat('d', 64),
                                           'mime', 'application/pdf', 'bytes', 1234))) as reg_conv \gset
select pg_temp.ok(:'reg_conv' like '{%' and (:'reg_conv'::jsonb ->> 'estat') = 'signat' and (:'reg_conv'::jsonb ->> 'via') = 'pujat',
                  'el Dinamitzador sube un CONV firmado → signat (cola del super_admin)');
select (:'reg_conv'::jsonb ->> 'firma_id') as firma_conv \gset
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select tancar_signatura(%L)::text$q$, :'firma_conv'))
                  like 'ERR 42501%institucional%', 'tancar_signatura de un CONV: el Dinamitzador → 42501');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select rebutjar_signatura(%L, 'arnes')::text$q$, :'firma_conv'))
                  like 'ERR 42501%institucional%', 'rebutjar_signatura de un CONV: el Dinamitzador → 42501');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select tancar_signatura(%L)::text$q$, :'firma_conv')) like '{%',
                  'tancar_signatura de un CONV: el super_admin la cierra');

-- Una firma de un REC pendiente de cerrar (subida por la contraparte; aquí, a mano).
insert into firmes_document (documento_id, objeto_tipo, objeto_id, tipo_doc, modo, part, tipo_org, org_id,
                             via, estat, fitxer_ruta, fitxer_sha256, fitxer_mime, fitxer_bytes)
select d.id, d.objeto_tipo, d.objeto_id, d.tipo, d.modo, p.part, p.tipo_org, p.org_id,
       'pujat', 'signat', regexp_replace(d.ruta, '/[^/]*$', '') || '/arnes-signat.pdf', repeat('e', 64), 'application/pdf', 100
  from documentos d, public.document_part_signant_intern(d.id) p
 where d.id = :'rec1'
returning id as firma_rec \gset
select pg_temp.ok(pg_temp.com(:'u_prod1', format($q$select tancar_signatura(%L)::text$q$, :'firma_rec')) like 'ERR 42501%',
                  'tancar_signatura: un externo → 42501');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select rebutjar_signatura(%L, ' ')::text$q$, :'firma_rec'))
                  like 'ERR 22023 cal_motiu%', 'rebutjar_signatura de un REC sin motivo: el Dinamitzador pasa la guarda (cal_motiu)');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select tancar_signatura(%L)::text$q$, :'firma_rec')) like '{%',
                  'tancar_signatura de un REC: el Dinamitzador la cierra');
select pg_temp.ok((select estat = 'tancat' from firmes_document where id = :'firma_rec'), 'la firma del REC queda tancat');

-- ---------------------------------------------------------------------------
\echo '== 5. Firma propia y signant_equip =='
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select fixar_firma_equip(%L, 'x')$q$, :'u_equip')) like 'ERR 42501%',
                  'fixar_firma_equip con sesión → 42501 (solo servidor)');
select pg_temp.ok(pg_temp.com(null, format($q$select coalesce(fixar_firma_equip(%L, 'equip/x/f.png'), '-')$q$, :'u_prod1'))
                  like 'ERR 22023 no_es_de_lequip%', 'fixar_firma_equip de una cuenta externa → 22023 no_es_de_lequip');
select pg_temp.ok(pg_temp.com(null, format($q$select coalesce(fixar_firma_equip(%L, 'equip/%s/../x.png'), '-')$q$, :'u_equip', :'u_equip'))
                  like 'ERR 22023 ruta_invalida%', 'una ruta que se escapa de la carpeta → 22023 ruta_invalida');
select pg_temp.ok(pg_temp.com(null, format($q$select coalesce(fixar_firma_equip(%L, 'altres/%s/x.png'), '-')$q$, :'u_equip', :'u_equip'))
                  like 'ERR 22023 ruta_invalida%', 'una ruta fuera de equip/<uid>/ → 22023 ruta_invalida');
select pg_temp.com(null, format($q$select coalesce(fixar_firma_equip(%L, null), '-')$q$, :'u_equip')) as previa \gset
select pg_temp.ok(pg_temp.com(null, format($q$select coalesce(fixar_firma_equip(%L, 'equip/%s/firma-1.png'), '-')$q$, :'u_equip', :'u_equip'))
                  = '-', 'fijar sobre ninguna → devuelve null (no hay fichero viejo)');
select pg_temp.ok(pg_temp.com(null, format($q$select coalesce(fixar_firma_equip(%L, 'equip/%s/firma-2.png'), '-')$q$, :'u_equip', :'u_equip'))
                  = 'equip/' || :'u_equip' || '/firma-1.png', 'cambiarla → devuelve la ruta anterior');
select pg_temp.ok((pg_temp.com(:'u_equip', $q$select la_meva_firma()::text$q$)::jsonb ->> 'ruta') = 'equip/' || :'u_equip' || '/firma-2.png'
                  and (pg_temp.com(:'u_equip', $q$select la_meva_firma()::text$q$)::jsonb ->> 'actualitzada_at') is not null,
                  'la_meva_firma devuelve la ruta y la fecha');
select pg_temp.ok(pg_temp.com(:'u_prod1', $q$select la_meva_firma()::text$q$) like 'ERR 42501%', 'la_meva_firma de un externo → 42501');
select pg_temp.ok((pg_temp.com(:'u_super', $q$select la_meva_firma()::text$q$)::jsonb -> 'ruta') = 'null'::jsonb,
                  'la_meva_firma sin firma → ruta null');

-- Emitir dos albaranes en borrador del flujo (el contexto lo abre la validación).
select (select id from albaranes where estado = 'borrador' order by created_at limit 1)          as alb1,
       (select id from albaranes where estado = 'borrador' order by created_at offset 1 limit 1) as alb2,
       (select id from albaranes where estado = 'borrador' order by created_at offset 2 limit 1) as alb3
\gset
select set_config('redestina.validacio_recollida', 'on', true) \gset
select pg_temp.com(:'u_equip', format($q$select (emitir_albaran(%L)).numero_completo$q$, :'alb1')) as num1 \gset
select pg_temp.ok(:'num1' not like 'ERR%', 'el Dinamitzador emite un albarán (' || :'num1' || ')');
select pg_temp.ok((select signant_equip = jsonb_build_object('nom', coalesce(nullif(btrim(pe.nombre), ''), pe.email),
                                                             'rol', 'admin',
                                                             'firma_ruta', 'equip/' || :'u_equip' || '/firma-2.png')
                     from albaranes a, perfiles pe where a.id = :'alb1' and pe.id = :'u_equip'),
                  'albaranes.signant_equip = {nom, rol admin, firma_ruta}');
select pg_temp.ok((select d.datos -> 'signant_equip' = a.signant_equip
                     from documentos d join albaranes a on a.id = d.objeto_id
                    where d.objeto_tipo = 'albaran' and d.objeto_id = :'alb1' and d.vigente),
                  'documentos.datos->signant_equip = el de la fila (raíz del snapshot)');
select pg_temp.com(:'u_super', format($q$select (emitir_albaran(%L)).numero_completo$q$, :'alb2')) as num2 \gset
select pg_temp.ok((select signant_equip ->> 'rol' = 'super_admin' and signant_equip -> 'firma_ruta' = 'null'::jsonb
                     from albaranes where id = :'alb2'),
                  'emitido por el super_admin sin firma propia → rol super_admin, firma_ruta null');
select pg_temp.com(null, format($q$select (emitir_albaran(%L)).numero_completo$q$, :'alb3')) as num3 \gset
select pg_temp.ok((select a.signant_equip is null and not (d.datos ? 'signant_equip')
                     from albaranes a join documentos d on d.objeto_tipo = 'albaran' and d.objeto_id = a.id and d.vigente
                    where a.id = :'alb3'),
                  'emitido por el servidor → sin signant_equip (ni en la fila ni en datos)');
select pg_temp.ok(pg_temp.com(null, format($q$update albaranes set signant_equip = '{}'::jsonb where id = %L returning id$q$, :'alb1'))
                  like 'ERR 42501%', 'signant_equip de un albarán emitido no se cambia (trigger de inmutabilidad)');
-- Cambiar la firma después NO cambia lo emitido.
select pg_temp.com(null, format($q$select coalesce(fixar_firma_equip(%L, null), '-')$q$, :'u_equip')) as borrada \gset
select pg_temp.ok((select signant_equip ->> 'firma_ruta' = 'equip/' || :'u_equip' || '/firma-2.png' from albaranes where id = :'alb1'),
                  'borrar la firma después no toca el albarán emitido');

\echo
\echo 'Tot correcte. ROLLBACK: no queda res.'
rollback;
