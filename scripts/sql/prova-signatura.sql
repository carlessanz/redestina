-- Prueba del circuito de firma unificado (20270510100000–100200). SOLO CONTRA EL CLON.
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 55322 -U postgres -d postgres -X \
--     -v ON_ERROR_STOP=1 -f scripts/sql/prova-signatura.sql
--
-- Todo va dentro de UNA transacción que acaba en ROLLBACK: no deja nada (ni documentos, ni
-- firmas, ni enlaces, ni avisos, ni la petición a `generar-documento` en la cola de pg_net).
-- Usa las fichas TEST-* del fixture (`crear-usuarios-prueba.ts` + `crear-datos-documentales-
-- prueba.ts`); si falta alguna, se para con un mensaje claro.
--
-- Cada caso imprime «ok · …»; el primero que no se cumple aborta con «FALLA · …».
--
-- Casos:
--   1. Canvas (titular de TEST-PROD-1 sobre un REC): enlace de panel → firma por enlace →
--      v2 `signat` con el MISMO código (`sha256_datos`), v1 sustituida, firma `tancat`,
--      v2 `pendiente_fichero` (la generará `generar-documento`) y aviso `document_signat`.
--   2. Subida del super_admin (ENT de TEST-ENT-SOCIAL): vía `correu`, v2 `emitido` con el
--      fichero y SIN encolar `generar-documento`.
--   3. Subida de la titular de TEST-ENT-SOCIAL sobre un ENT `confirmado` → `signat`; otra
--      emisión (la conciliación) lo sustituye → la firma se rechaza sola y `tancar_signatura`
--      responde `versio_substituida`; la v2 vuelve a «pendent».
--   4. Rechazo con motivo: `cal_motiu` sin motivo; con motivo el documento vuelve a «pendent»
--      con `ultim_motiu_rebuig` y sale en `pendents_meus`.
--   5. Modo prueba: la titular no acuña, no tiene permiso y no ve la fila; el super_admin sí
--      puede recorrerlo.
--   6. CONV: `usa_firma_conveni` para el canvas y el correo; la subida sí entra.
--   7. Lo ajeno: otra organización recibe 42501 y 0 filas; `ja_signat`, `document_canviat` y
--      `dades_invalides`.

\set QUIET on
\set ON_ERROR_STOP on
-- La salida de las consultas no dice nada (cada caso habla por su NOTICE): a /dev/null.
\o /dev/null
begin;

-- ---------------------------------------------------------------------------
-- Ayudantes (temporales: desaparecen con la sesión)
-- ---------------------------------------------------------------------------
-- Ejecuta una consulta escalar con la SESIÓN de una cuenta (rol `authenticated` + `sub`), o
-- como el servidor (`p_user` null: `auth.uid()` es null). Devuelve el resultado como texto, o
-- 'ERR <sqlstate> <mensaje>' si falla.
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

-- ¿Hay una petición a `generar-documento` para este documento en la cola de pg_net? (El
-- aviso `document_signat` también encola la suya, a `enviar-avis`: por eso no vale contar.)
create function pg_temp.encolat(p_doc uuid) returns boolean
language sql as $$
  select exists (select 1 from net.http_request_queue q
                  where q.url like '%/generar-documento'
                    and convert_from(q.body, 'UTF8') like '%' || p_doc::text || '%');
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

-- Documento vigente de un tipo y una ficha TEST-*, con el estado de albarán pedido.
create function pg_temp.doc(p_tipo text, p_org text, p_estat_alb text default null, p_salta int default 0) returns uuid
language plpgsql as $$
declare v uuid;
begin
  select v2.documento_id into v
    from v_signatura_document v2
    join documentos d on d.id = v2.documento_id
    left join productores p on v2.tipo_org = 'productor' and p.id = v2.org_id
    left join entidades   e on v2.tipo_org = 'entidad'   and e.id = v2.org_id
    left join albaranes  al on d.objeto_tipo = 'albaran' and al.id = d.objeto_id
   where v2.tipo = p_tipo and v2.estat = 'pendent'
     and coalesce(p.codigo, e.codigo) = p_org
     and (p_estat_alb is null or al.estado = p_estat_alb)
   order by v2.numero_completo
   offset p_salta limit 1;
  if v is null then
    raise exception 'Falta un % pendent de % (scripts/crear-datos-documentales-prueba.ts)', p_tipo, p_org;
  end if;
  return v;
end;
$$;

select pg_temp.usuari('hola+prodowner-masprova@carlessanz.com')  as u_prod1,
       pg_temp.usuari('hola+prodowner-hortaprova@carlessanz.com') as u_prod2,
       pg_temp.usuari('hola+recowner-social@carlessanz.com')     as u_social,
       pg_temp.usuari('hola+superadmin@carlessanz.com')          as u_super,
       pg_temp.usuari('hola+equip@carlessanz.com')               as u_equip
\gset

select pg_temp.doc('REC', 'TEST-PROD-1', 'conciliado', 0)  as rec1,
       pg_temp.doc('REC', 'TEST-PROD-1', 'conciliado', 1)  as rec2,
       pg_temp.doc('REC', 'TEST-PROD-1', 'conciliado', 2)  as rec3,
       pg_temp.doc('ENT', 'TEST-ENT-SOCIAL', 'conciliado') as ent_conc,
       pg_temp.doc('ENT', 'TEST-ENT-SOCIAL', 'confirmado') as ent_conf,
       pg_temp.doc('CONV', 'TEST-PROD-1')                  as conv1,
       pg_temp.doc('CD', 'TEST-PROD-1')                    as cd_prova
\gset

\echo
\echo '== 1. Canvas desde el panel (titular de TEST-PROD-1, REC) =='

-- La titular acuña su enlace de panel.
select pg_temp.com(:'u_prod1',
  format($q$select acunar_enllac_propi('firma_document', 'documento', %L)::text$q$, :'rec1')) as acu1
\gset
select pg_temp.ok(:'acu1' like '{%' and (:'acu1'::jsonb ->> 'url_path') like '/signar-document/%',
                  'acunar_enllac_propi devuelve url_path /signar-document/<token>');
select (:'acu1'::jsonb ->> 'id') as enl1 \gset
select pg_temp.ok((select canal = 'panel' and caduca_at <= now() + interval '1 hour 1 minute'
                     from enlaces_token where id = :'enl1'),
                  'el enlace es de panel y caduca en 1 h');

-- El documento que ve es el de siempre, pendiente.
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select estat from v_signatura_document where documento_id = %L$q$, :'rec1')) = 'pendent',
  'la titular ve el REC como pendent');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select count(*)::text from pendents_meus() where proposito = 'firma_document' and objeto_id = %L$q$, :'rec1')) = '1',
  'pendents_meus() le ofrece el REC (firma_document)');

-- Mínimos y huella: el servidor rechaza lo incompleto.
select pg_temp.ok(pg_temp.com(null, format($q$select signar_document_per_enllac(%L, %L::jsonb)::text$q$,
  :'enl1', jsonb_build_object('nombre', 'Titular', 'cargo', 'Gerent', 'documento_identidad', '12345678Z',
                               'declaracion_representacion', true, 'trazo_firma_ruta', 'x/evidencies/a.png',
                               'sha256_texto', repeat('0', 64))))
  like 'ERR 22023 document_canviat%', 'huella distinta → 22023 document_canviat');
select pg_temp.ok(pg_temp.com(null, format($q$select signar_document_per_enllac(%L, %L::jsonb)::text$q$,
  :'enl1', jsonb_build_object('nombre', 'T', 'cargo', 'Gerent', 'documento_identidad', '12345678Z',
                               'declaracion_representacion', true, 'trazo_firma_ruta', 'x/evidencies/a.png',
                               'sha256_texto', (select sha256_datos from documentos where id = :'rec1'))))
  like 'ERR 22023 dades_invalides%', 'nombre de 1 letra → 22023 dades_invalides');
select pg_temp.ok(pg_temp.com(:'u_prod1', format($q$select signar_document_per_enllac(%L, '{}'::jsonb)::text$q$, :'enl1'))
  like 'ERR 42501%', 'signar_document_per_enllac con sesión → 42501 (solo servidor)');

select pg_temp.com(null, format($q$select signar_document_per_enllac(%L, %L::jsonb)::text$q$,
  :'enl1', jsonb_build_object('nombre', 'Titular de Mas de Prova', 'cargo', 'Gerent',
                               'documento_identidad', '12345678Z', 'declaracion_representacion', true,
                               'trazo_firma_ruta', 'productors/x/2026/evidencies/' || :'enl1' || '.png',
                               'ip', '127.0.0.1', 'user_agent', 'prova-signatura.sql',
                               'sha256_texto', (select sha256_datos from documentos where id = :'rec1')))) as sig1
\gset
select pg_temp.ok(:'sig1' like '{%' and (:'sig1'::jsonb ->> 'estat') = 'tancat', 'la firma con trazo se cierra sola');
select (:'sig1'::jsonb ->> 'document_signat_id') as rec1_v2, (:'sig1'::jsonb ->> 'firma_id') as firma1 \gset

select pg_temp.ok((select n.subtipo = 'signat' and n.version = o.version + 1 and n.vigente
                          and n.sha256_datos = o.sha256_datos and n.datos = o.datos
                          and n.numero_completo = o.numero_completo
                          and n.estado = 'pendiente_fichero' and n.fichero_at is null
                          and n.ruta like '%/REC/' || n.numero_completo || '-v' || n.version || '.pdf'
                          and not o.vigente and o.sustituido_por = n.id
                     from documentos o, documentos n where o.id = :'rec1' and n.id = :'rec1_v2'),
                  'v2 signat: mismo código y datos, pendiente_fichero; v1 sustituida');
select pg_temp.ok(pg_temp.encolat(:'rec1_v2'), 'la v2 de canvas se encola para generar-documento');
select pg_temp.ok((select f.estat = 'tancat' and f.via = 'canvas' and f.part = 'donant'
                          and f.evidencia_id is not null and f.enlace_id = :'enl1'
                          and f.signat_per = :'u_prod1' and f.tancat_at is not null
                     from firmes_document f where f.id = :'firma1'),
                  'firma canvas tancat con evidencia, enlace y quién firmó');
select pg_temp.ok((select ev.documento_identidad = '12345678Z' and ev.tipo = 'firma'
                     from evidencias ev join firmes_document f on f.evidencia_id = ev.id where f.id = :'firma1'),
                  'el DNI vive en evidencias (no en firmes_document)');
select pg_temp.ok((select usado_at is not null and estado = 'usado' from enlaces_token where id = :'enl1'),
                  'el enlace queda consumido');
select pg_temp.ok((select count(*) = 1 from avisos a
                    where a.tipus = 'document_signat' and a.objecte_tipo = 'documento'
                      and a.objecte_id = :'rec1_v2' and a.destinatari_tipo = 'productor'
                      and a.params ->> 'tipus' = 'REC'),
                  'aviso document_signat a la organización sobre la versión firmada');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select estat || '·' || via from v_signatura_document where documento_id = %L$q$, :'rec1_v2')) = 'tancat·canvas',
  'la titular ve la v2 como tancat (canvas)');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select count(*)::text from pendents_meus() where objeto_id in (%L, %L)$q$, :'rec1', :'rec1_v2')) = '0',
  'ya no está en pendents_meus()');
select pg_temp.ok(pg_temp.com(null, format($q$select signar_document_per_enllac(%L, '{}'::jsonb)::text$q$, :'enl1'))
  like 'ERR PT409%', 'el mismo enlace otra vez → PT409');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select acunar_enllac_propi('firma_document', 'documento', %L)::text$q$, :'rec1_v2'))
  like 'ERR 22023 ja_signat%', 'acuñar sobre la versión firmada → 22023 ja_signat');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select acunar_enllac_propi('firma_document', 'documento', %L)::text$q$, :'rec1'))
  like 'ERR 22023 versio_substituida%', 'acuñar sobre la versión sustituida → 22023 versio_substituida');

\echo
\echo '== 2. Subida del super_admin (vía correo, ENT de TEST-ENT-SOCIAL) =='

select pg_temp.ok(pg_temp.com(null, format($q$select ruta_document_signat(%L, 'jpeg')$q$, :'ent_conc'))
  ~ '/ENT/ENT-[0-9]{4}-[0-9]+-signat-[0-9a-f]{8}\.jpg$', 'ruta_document_signat: carpeta del documento, -signat-<8hex>.jpg');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select ruta_document_signat(%L, 'pdf')$q$, :'ent_conc'))
  like 'ERR 42501%', 'ruta_document_signat con sesión → 42501 (solo servidor)');
select pg_temp.com(null, format($q$select ruta_document_signat(%L, 'pdf')$q$, :'ent_conc')) as ruta2 \gset

select pg_temp.ok(pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb)::text$q$,
  :'ent_conc', :'u_super', jsonb_build_object('ruta', 'altra/carpeta/x.pdf', 'sha256', repeat('a', 64),
                                               'mime', 'application/pdf', 'bytes', 1000)))
  like 'ERR 22023 dades_invalides%', 'fichero fuera de la carpeta del documento → 22023 dades_invalides');
select pg_temp.ok(pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb)::text$q$,
  :'ent_conc', :'u_super', jsonb_build_object('ruta', :'ruta2', 'sha256', repeat('a', 64),
                                               'mime', 'application/zip', 'bytes', 1000)))
  like 'ERR 22023 dades_invalides%', 'MIME no admitido → 22023 dades_invalides');
select pg_temp.ok(pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb, %L::jsonb)::text$q$,
  :'ent_conc', :'u_super', jsonb_build_object('ruta', :'ruta2', 'sha256', repeat('a', 64),
                                               'mime', 'application/pdf', 'bytes', 1000),
  jsonb_build_object('data_signatura', '2999-01-01')))
  like 'ERR 22023 dades_invalides%', 'fecha de firma futura → 22023 dades_invalides');

select pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb, %L::jsonb)::text$q$,
  :'ent_conc', :'u_super', jsonb_build_object('ruta', :'ruta2', 'sha256', repeat('b', 64),
                                               'mime', 'application/pdf', 'bytes', 54321),
  jsonb_build_object('nom', 'Responsable de l''entitat', 'carrec', 'Presidenta',
                     'data_signatura', to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD')))) as reg2
\gset
select pg_temp.ok(:'reg2' like '{%' and (:'reg2'::jsonb ->> 'via') = 'correu' and (:'reg2'::jsonb ->> 'estat') = 'tancat',
                  'el super_admin sube → vía correu, tancat al momento');
select (:'reg2'::jsonb ->> 'document_signat_id') as ent_v2 \gset
select pg_temp.ok((select n.subtipo = 'signat' and n.estado = 'emitido' and n.fichero_at is not null
                          and n.ruta = :'ruta2' and n.sha256_fichero = repeat('b', 64) and n.bytes = 54321
                          and n.sha256_datos = o.sha256_datos and n.envio is null
                          and n.emitido_por = :'u_super' and not o.vigente
                     from documentos o, documentos n where o.id = :'ent_conc' and n.id = :'ent_v2'),
                  'v2 emitido con el fichero subido (ruta, huella, bytes) y el mismo código');
select pg_temp.ok(not pg_temp.encolat(:'ent_v2'), 'la v2 subida NO se encola (ya tiene fichero)');
select pg_temp.ok(pg_temp.com(:'u_social',
  format($q$select estat || '·' || via || '·' || coalesce(fitxer_mime, '-') from v_signatura_document where documento_id = %L$q$, :'ent_v2'))
  = 'tancat·correu·application/pdf', 'la receptora ve su ENT tancat (correu)');

\echo
\echo '== 3. Subida de la titular y otra emisión por medio → versio_substituida =='

select pg_temp.com(null, format($q$select ruta_document_signat(%L, 'png')$q$, :'ent_conf')) as ruta3 \gset
select pg_temp.ok(pg_temp.com(null, format($q$select puc_signar_document(%L, %L)::text$q$, :'ent_conf', :'u_social')) = 'true',
                  'puc_signar_document: la titular de la receptora puede');
select pg_temp.ok(pg_temp.com(null, format($q$select puc_signar_document(%L, %L)::text$q$, :'ent_conf', :'u_prod1')) = 'false',
                  'puc_signar_document: el productor (otra parte) no');
select pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb)::text$q$,
  :'ent_conf', :'u_social', jsonb_build_object('ruta', :'ruta3', 'sha256', repeat('c', 64),
                                                'mime', 'image/png', 'bytes', 2048))) as reg3
\gset
select pg_temp.ok((:'reg3'::jsonb ->> 'via') = 'pujat' and (:'reg3'::jsonb ->> 'estat') = 'signat',
                  'la titular sube → vía pujat, queda signat');
select (:'reg3'::jsonb ->> 'firma_id') as firma3 \gset
-- Lo que ya hubiera en la cola (el fixture deja una firma de TEST-PROD-1 esperando).
select (select count(*) from firmes_document where estat = 'signat') - 1 as per_tancar_abans \gset
select pg_temp.ok(pg_temp.com(:'u_social',
  format($q$select estat from v_signatura_document where documento_id = %L$q$, :'ent_conf')) = 'signat',
  'la receptora lo ve signat (espera al super_admin)');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select n::text from pendents_equip() where cua = 'signatures_per_tancar'$q$)::int = :per_tancar_abans + 1,
                  'pendents_equip(): signatures_per_tancar cuenta la subida');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select count(*)::text from pendents_equip()$q$) = '17',
                  'pendents_equip() tiene 17 colas');
select pg_temp.ok(pg_temp.com(:'u_super',
  format($q$select estat || '·' || org_nom || '·' || objeto_tipo from v_signatures_bandeja where firma_id = %L$q$, :'firma3'))
  like 'signat·%·albaran', 'la bandeja del equipo la muestra con la organización');
select pg_temp.ok(pg_temp.com(:'u_social', format($q$select registrar_document_signat(%L, %L, '{}'::jsonb)::text$q$, :'ent_conf', :'u_social'))
  like 'ERR 42501%', 'registrar_document_signat con sesión → 42501 (solo servidor)');
select pg_temp.ok(pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb)::text$q$,
  :'ent_conf', :'u_social', jsonb_build_object('ruta', :'ruta3', 'sha256', repeat('c', 64), 'mime', 'image/png', 'bytes', 2048)))
  like 'ERR 22023 ja_signat%', 'otra subida con una firma viva → 22023 ja_signat');

-- La conciliación emite la v2 del albarán por su cuenta.
select albaran_emet_document((select objeto_id from documentos where id = :'ent_conf'), 'conciliat') as ent_conf_v2 \gset
select pg_temp.ok((select estat = 'rebutjat' and motiu_rebuig like 'versio_substituida%' from firmes_document where id = :'firma3'),
                  'la firma que esperaba revisión se rechaza sola (versio_substituida)');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select tancar_signatura(%L)::text$q$, :'firma3'))
  like 'ERR 22023 versio_substituida%', 'tancar_signatura tras otra emisión → 22023 versio_substituida');
-- Mientras su PDF no existe no se firma (no hay nada que leer); cuando `generar-documento`
-- lo sube, vuelve a estar pendiente.
select pg_temp.ok(pg_temp.com(:'u_social',
  format($q$select count(*)::text from v_signatura_document where documento_id = %L$q$, :'ent_conf_v2')) = '0',
  'la v2 sin PDF todavía no se ofrece a firmar');
update documentos set estado = 'emitido', fichero_at = now(), sha256_fichero = repeat('9', 64), bytes = 1
 where id = :'ent_conf_v2';
select pg_temp.ok(pg_temp.com(:'u_social',
  format($q$select estat from v_signatura_document where documento_id = %L$q$, :'ent_conf_v2')) = 'pendent',
  'con su PDF, la v2 conciliada vuelve a estar pendent');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select n::text from pendents_equip() where cua = 'signatures_per_tancar'$q$)::int = :per_tancar_abans,
                  'y ya no cuenta en signatures_per_tancar');

\echo
\echo '== 4. Rechazo con motivo: el documento vuelve a pendent =='

select pg_temp.com(null, format($q$select ruta_document_signat(%L, 'pdf')$q$, :'rec2')) as ruta4 \gset
select pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb)::text$q$,
  :'rec2', :'u_prod1', jsonb_build_object('ruta', :'ruta4', 'sha256', repeat('d', 64),
                                           'mime', 'application/pdf', 'bytes', 4096))) as reg4
\gset
select (:'reg4'::jsonb ->> 'firma_id') as firma4 \gset
select pg_temp.ok((select signant_nom is not null and via = 'pujat' from firmes_document where id = :'firma4'),
                  'sin nombre declarado, la subida lleva el nombre de la cuenta');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select rebutjar_signatura(%L, 'no')::text$q$, :'firma4'))
  like 'ERR 42501%', 'el tècnic no rechaza → 42501');
select pg_temp.ok(pg_temp.com(:'u_equip', format($q$select tancar_signatura(%L)::text$q$, :'firma4'))
  like 'ERR 42501%', 'el tècnic no cierra → 42501');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select rebutjar_signatura(%L, '  ')::text$q$, :'firma4'))
  like 'ERR 22023 cal_motiu%', 'sin motivo → 22023 cal_motiu');
select pg_temp.ok(pg_temp.com(:'u_super', $q$select tancar_signatura('00000000-0000-0000-0000-000000000000')::text$q$)
  like 'ERR 22023 estat_incorrecte%', 'super_admin con uuid inventado → 22023 estat_incorrecte');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select rebutjar_signatura(%L, 'La signatura no és llegible')->>'estat'$q$, :'firma4'))
  = 'rebutjat', 'el super_admin rechaza con motivo');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select estat || '·' || ultim_motiu_rebuig from v_signatura_document where documento_id = %L$q$, :'rec2'))
  = 'pendent·La signatura no és llegible', 'vuelve a pendent con el último motivo');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select motiu from pendents_meus() where proposito = 'firma_document' and objeto_id = %L$q$, :'rec2'))
  = 'La signatura no és llegible', 'pendents_meus() lo vuelve a ofrecer, con el motivo');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select rebutjar_signatura(%L, 'otra vez')::text$q$, :'firma4'))
  like 'ERR 22023 estat_incorrecte%', 'rechazar dos veces → 22023 estat_incorrecte');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select (acunar_enllac_propi('firma_document', 'documento', %L) ->> 'url_path') like '/signar-document/%%'$q$, :'rec2'))
  = 'true', 'tras el rechazo se puede volver a firmar');

\echo
\echo '== 5. Modo prueba: la titular no firma; el equipo sí lo recorre =='

select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select acunar_enllac_propi('firma_document', 'documento', %L)::text$q$, :'cd_prova'))
  like 'ERR 42501%', 'la titular no acuña sobre un CD de prueba → 42501');
select pg_temp.ok(pg_temp.com(null, format($q$select puc_signar_document(%L, %L)::text$q$, :'cd_prova', :'u_prod1')) = 'false',
                  'puc_signar_document: titular en prueba → false');
select pg_temp.ok(pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, '{}'::jsonb)::text$q$, :'cd_prova', :'u_prod1'))
  like 'ERR 42501%', 'registrar_document_signat de la titular en prueba → 42501');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select count(*)::text from v_signatura_document where documento_id = %L$q$, :'cd_prova')) = '0',
  'la titular no ve la fila de prueba en v_signatura_document');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select count(*)::text from document_part_signant(%L)$q$, :'cd_prova')) = '0',
  'document_part_signant de un documento de prueba → 0 filas para la titular');
select pg_temp.ok(pg_temp.com(null, format($q$select puc_signar_document(%L, %L)::text$q$, :'cd_prova', :'u_super')) = 'true',
                  'puc_signar_document: el equipo en prueba → true');
select pg_temp.com(null, format($q$select ruta_document_signat(%L, 'pdf')$q$, :'cd_prova')) as ruta5 \gset
select pg_temp.ok(:'ruta5' like '%/proves/%', 'la ruta de prueba cae bajo proves/');
select pg_temp.ok(pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb)->>'estat'$q$,
  :'cd_prova', :'u_super', jsonb_build_object('ruta', :'ruta5', 'sha256', repeat('e', 64),
                                               'mime', 'application/pdf', 'bytes', 999)))
  = 'tancat', 'el super_admin cierra el CD de prueba');
select pg_temp.ok((select count(*) = 0 from avisos where tipus = 'document_signat'
                     and objecte_id = (select document_signat_id from firmes_document where documento_id = :'cd_prova')),
                  'en prueba no hay aviso');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select count(*)::text from firmes_document where documento_id = %L$q$, :'cd_prova')) = '0',
  'la titular no ve la firma de prueba en firmes_document');

\echo
\echo '== 6. Convenio: sin canvas; la subida sí =='

select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select acunar_enllac_propi('firma_document', 'documento', %L)::text$q$, :'conv1'))
  like 'ERR 22023 usa_firma_conveni%', 'acuñar canvas sobre CONV → 22023 usa_firma_conveni');
select pg_temp.ok(pg_temp.com(null, format($q$select preparar_enviament_signatura(%L)::text$q$, :'conv1'))
  like 'ERR 22023 usa_firma_conveni%', 'preparar_enviament_signatura sobre CONV → 22023 usa_firma_conveni');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select admet_canvas::text from v_signatura_document where documento_id = %L$q$, :'conv1')) = 'false',
  'v_signatura_document: el CONV no admite canvas');
select pg_temp.ok(pg_temp.com(:'u_prod1',
  format($q$select count(*)::text from pendents_meus() where proposito = 'firma_document' and objeto_id = %L$q$, :'conv1')) = '0',
  'el CONV no sale en pendents_meus() como firma_document');
select pg_temp.com(null, format($q$select ruta_document_signat(%L, 'pdf')$q$, :'conv1')) as ruta6 \gset
select pg_temp.ok(pg_temp.com(null, format($q$select registrar_document_signat(%L, %L, %L::jsonb)->>'estat'$q$,
  :'conv1', :'u_super', jsonb_build_object('ruta', :'ruta6', 'sha256', repeat('f', 64),
                                            'mime', 'application/pdf', 'bytes', 777)))
  = 'tancat', 'el super_admin sube el convenio firmado → tancat');
select pg_temp.ok((select c.estado in ('firmat', 'vigent')
                     from convenios c join documentos d on d.objeto_id = c.id where d.id = :'conv1'),
                  'el estado del convenio no se toca');

\echo
\echo '== 7. Lo ajeno y lo repetido =='

select pg_temp.ok(pg_temp.com(:'u_prod2',
  format($q$select acunar_enllac_propi('firma_document', 'documento', %L)::text$q$, :'rec3'))
  like 'ERR 42501%', 'otra organización no acuña sobre un REC ajeno → 42501');
select pg_temp.ok(pg_temp.com(:'u_prod2',
  $q$select acunar_enllac_propi('firma_document', 'documento', '00000000-0000-0000-0000-000000000000')::text$q$)
  like 'ERR 42501%', 'uuid inventado → 42501 (permiso antes que existencia)');
select pg_temp.ok(pg_temp.com(:'u_prod2',
  format($q$select count(*)::text from document_part_signant(%L)$q$, :'rec3')) = '0',
  'document_part_signant de lo ajeno → 0 filas');
select pg_temp.ok(pg_temp.com(:'u_prod2',
  format($q$select count(*)::text from v_signatura_document where documento_id = %L$q$, :'rec3')) = '0',
  'v_signatura_document de lo ajeno → 0 filas');
select pg_temp.ok(pg_temp.com(:'u_prod1', $q$select count(*)::text from v_signatures_bandeja$q$) = '0',
                  'una cuenta externa ve 0 filas en v_signatures_bandeja');
select pg_temp.ok(pg_temp.com(:'u_prod1', format($q$select document_emet_versio_signada(%L)::text$q$, :'firma1'))
  like 'ERR 42501%', 'document_emet_versio_signada no se ejecuta desde la API → 42501');
select pg_temp.ok(pg_temp.com(:'u_super', format($q$select preparar_enviament_signatura(%L)::text$q$, :'rec3'))
  like 'ERR 42501%', 'preparar_enviament_signatura con sesión → 42501 (solo servidor)');
select pg_temp.com(null, format($q$select preparar_enviament_signatura(%L, null, %L)::text$q$, :'rec3', :'u_super')) as prep7 \gset
select pg_temp.ok((:'prep7'::jsonb ->> 'token') is not null and (:'prep7'::jsonb ->> 'part') = 'donant'
                  and (select canal = 'email' and caduca_at > now() + interval '29 days'
                         from enlaces_token where id = (:'prep7'::jsonb ->> 'enlace_id')::uuid),
                  'preparar_enviament_signatura: enlace de correo de 30 días con token');
select pg_temp.ok(pg_temp.com(null, format($q$select preparar_enviament_signatura(%L, null, %L)::text$q$, :'rec3', :'u_super')) like '{%'
                  and (select count(*) = 1 from enlaces_token where objeto_id = :'rec3' and canal = 'email' and estado = 'activo'),
                  'reenviar revoca el enlace de correo anterior');

rollback;
\echo
\echo 'prova-signatura: tot correcte (ROLLBACK, no queda res).'
