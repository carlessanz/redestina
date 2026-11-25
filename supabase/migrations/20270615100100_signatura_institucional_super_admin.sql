-- Firma institucional = solo Superadmin; albaranes = todo el equipo (25-11-2026, proceso 0.1).
--
-- Con `tecnic` retirado (20270615100000), `pot_aprovar()` es «cualquier cuenta del equipo». Lo que
-- NO puede hacer el Dinamitzador (`admin`) es lo que pone la firma y el sello de la APODERADA
-- (`parametros_documentales.firma_ruta`/`sello_ruta`) en un documento REAL, ni tocar la
-- configuración. Lo que esta migración cambia, y nada más:
--
--   1. Firma institucional (idioma de guardas de §4bis: `auth.uid() is not null and not
--      es_super_admin()` → 42501; `service_role`, que no tiene `auth.uid()`, pasa igual que antes):
--        · `contrafirmar_convenio` — SIEMPRE super_admin: un convenio no tiene modo prueba (su
--          documento CONV se emite `modo = 'real'` en `convenio_emet_document`).
--        · `emetre_certificat_recepcio`, `rectificar_certificado`, `rectificar_certificado_periodo`
--          y `rectificar_certificat_recepcio` — en REAL, super_admin; en PRUEBA, `pot_aprovar()`
--          como hasta hoy. Es lo que ya hacían `emitir_certificado` y `emitir_certificado_periodo`.
--          La comprobación del modo va DESPUÉS de leer la fila (hace falta saber el modo) y antes
--          de cualquier otra; con un uuid inventado el Dinamitzador recibe 22023 «no existeix»,
--          igual que con el CD.
--      Revisado con `prosrc ~ firma_ruta|sello_ruta|apoderada` y los que llaman a los
--      `*_emet_document`/`*_datos_certificado*`: no queda otra vía abierta al `admin` que estampe la
--      firma en real. `emitir_resumen` (RES) no lleva firma ni sello; `declarar_conveni`,
--      `regenerar_documents_fundacio`, `emitir_certificado*` (real) ya eran del super_admin;
--      `firmar_convenio_por_enlace` emite el CONV `firmat` SIN sello (eso es la contrafirma).
--      `rectificar_certificado_transaccion` solo responde 22023 (retirado) y no se toca.
--
--   2. Configuración: las políticas de escritura de `meta_test_recipients`,
--      `email_test_recipients` y `plantillas_documento` pasan de `pot_aprovar()` a
--      `es_super_admin()`. La lectura (equipo) no cambia.
--
--   3. Firmas de la contraparte: cerrar (`tancar_signatura`), rechazar (`rebutjar_signatura`) y el
--      cierre directo al subir (`registrar_document_signat`) son de TODO el equipo cuando el
--      documento es un albarán (`firmes_document.tipo_doc` / `documentos.tipo` REC o ENT —OPE no se
--      firma, CHECK de `firmes_document`—); para CONV, CD y CR (lo institucional) siguen siendo del
--      super_admin. En las dos RPC del panel, la guarda de equipo va primero (permiso antes que
--      existencia) y la del tipo después de leer la firma.
--
-- Todas mantienen su firma: `create or replace` basta y conserva los GRANT. Se repiten igualmente
-- los `revoke`/`grant` para que el estado quede escrito aquí.

-- 1a. Contrafirmar un convenio: siempre super_admin ---------------------------------------

CREATE OR REPLACE FUNCTION public.contrafirmar_convenio(p_id uuid)
 RETURNS convenios
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c   convenios%rowtype;
  par parametros_documentales%rowtype;
begin
  -- `auth.uid() is not null and not …`, como en todo el circuito documental
  -- (20261109100100 §12): `service_role` no tiene `auth.uid()` y pasa, porque estas tres
  -- acciones las llaman DOS caminos —el panel con la sesión de una persona y, en la
  -- campaña, el servidor por tandas—.
  -- 20270615100100: contrasignar estampa la firma y el sello de la apoderada en un documento
  -- REAL (el CONV no tiene modo prueba), así que es solo del super_admin.
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin contrasigna un conveni (signatura institucional)' using errcode = '42501';
  end if;

  select * into c from convenios where id = p_id for update;
  if c.id is null or c.estado <> 'firmat' then
    raise exception 'Nomes es pot contrasignar un conveni firmat (estat %)',
      coalesce(c.estado, 'inexistent') using errcode = '22023';
  end if;

  select * into par from parametros_documentales where id = 1;
  if coalesce(btrim(par.apoderada_nombre), '') = '' then
    raise exception 'Falta l''apoderada als parametres documentals: no es pot estampar cap firma'
      using errcode = '22023';
  end if;

  -- El vigente anterior de la misma organización y el mismo modelo cede el sitio.
  update convenios
     set estado = 'substituit', sustituido_por = c.id
   where estado = 'vigent' and tipo = c.tipo and id <> c.id
     and coalesce(productor_id, entidad_id) = coalesce(c.productor_id, c.entidad_id);

  update convenios
     set estado            = 'vigent',
         contrafirmado_at  = now(),
         contrafirmado_por = auth.uid()
   where id = c.id
  returning * into c;

  perform public.convenio_emet_document(c.id, 'contrafirmat',
    jsonb_build_object('destinatario', c.firmante->>'email', 'motivo', 'conveni_vigent'));

  return c;
end;
$function$;

revoke execute on function public.contrafirmar_convenio(uuid) from public, anon;
grant execute on function public.contrafirmar_convenio(uuid) to authenticated;
comment on function public.contrafirmar_convenio(uuid) is
  'Contrafirma un convenio firmado (lo deja vigent y emite el CONV con la firma y el sello de la apoderada). Solo super_admin (20270615100100; service_role pasa). 42501 sin permiso · 22023 si no está firmat o falta la apoderada.';


-- 1b. Certificado de recepción: en real, super_admin -----------------------------------------

CREATE OR REPLACE FUNCTION public.emetre_certificat_recepcio(p_id uuid, p_motiu text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cr      cierres_receptor%rowtype;
  par     parametros_documentales%rowtype;
  v_serie text;
  v_n     int;
  v_dest  jsonb;
  v_doc   uuid;
  v_bloq  text;
  v_subs  int := 0;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;

  select * into cr from cierres_receptor where id = p_id for update;
  if cr.id is null then
    raise exception 'Aquest certificat de recepcio no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  -- 20270615100100: en REAL el certificado lleva la firma y el sello de la apoderada, y eso es
  -- solo del super_admin; en prueba sigue siendo de quien puede aprobar.
  if cr.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa un certificat real' using errcode = '42501';
  end if;

  -- (0) Los datos de la Fundación tienen que ser los de verdad **en modo real**
  --     (20260921214526). En prueba se emite: serie `P-CR`, marca de agua y
  --     `destinatariosPrueba`, que es lo que permite recorrer el ciclo entero.
  if cr.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat real. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  if cr.certificado_numero is not null then
    raise exception 'Aquest periode ja te el certificat % (fes servir rectificar_certificat_recepcio)',
      cr.certificado_numero using errcode = '22023';
  end if;
  if cr.calculado_at is null then
    raise exception 'Aquest periode no s''ha calculat encara' using errcode = '22023';
  end if;

  -- (1) Ningún bloqueo bloqueante.
  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cr.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquesta entitat esta bloquejada: %', v_bloq using errcode = '22023';
  end if;

  if cr.kg_total <= 0 then
    raise exception 'Un certificat de 0 quilos no te sentit' using errcode = '22023';
  end if;

  -- (2) Sin plantilla vigente el PDF saldría con el cuerpo provisional del renderizador,
  --     que no dice lo que este documento es ni lo que no es. Se comprueba antes de pedir
  --     número: si faltara, el rollback devolvería el número a la serie, pero es más
  --     honesto no llegar a quemarlo.
  if not exists (select 1 from plantillas_documento p
                  where p.tipo = 'CR' and p.variante is null and p.vigente) then
    raise exception 'No hi ha cap plantilla CR vigent: sense ella el certificat no diria que acredita quilos rebuts'
      using errcode = '22023';
  end if;

  v_dest := public.recepcio_destinatari(p_id);

  v_serie := case when cr.modo = 'prueba' then 'P-CR' else 'CR' end;
  v_n := public.siguiente_numero(v_serie, cr.ejercicio);
  update cierres_receptor
     set certificado_numero = public.formato_numero(v_serie, cr.ejercicio, v_n),
         certificado_at     = now(),
         estado             = 'certificat_emes',
         notas              = coalesce(nullif(btrim(coalesce(p_motiu, '')), ''), notas)
   where id = p_id
  returning * into cr;

  v_doc := public.recepcio_emet_document(
    p_id,
    public.recepcio_datos_certificat(p_id),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', 'Certificat de recepcio ' || to_char(cr.periodo_desde, 'DD/MM/YYYY')
                || ' — ' || to_char(cr.periodo_hasta, 'DD/MM/YYYY') || ' · ' || cr.certificado_numero,
      'plantilla', 'certificat_recepcio'));

  -- Los certificados anteriores de la misma entidad CONTENIDOS en esta ventana quedan
  -- sustituidos: lo que este documento dice incluye lo que decían ellos, y dos papeles
  -- vigentes con kilos solapados es el doble conteo que hay que evitar.
  update cierres_receptor o
     set estado = 'substituit', sustituido_at = now(), sustituido_por = p_id
   where o.entidad_id = cr.entidad_id and o.modo = cr.modo
     and o.id <> p_id and o.certificado_numero is not null
     and o.estado <> 'substituit'
     and o.periodo_desde >= cr.periodo_desde and o.periodo_hasta <= cr.periodo_hasta;
  get diagnostics v_subs = row_count;

  update documentos d
     set vigente = false, sustituido_por = v_doc
   where d.objeto_tipo = 'cierre_receptor' and d.vigente and d.id <> v_doc
     and d.objeto_id in (select o.id from cierres_receptor o
                          where o.sustituido_por = p_id);

  return jsonb_build_object('document', v_doc, 'numero', cr.certificado_numero,
                            'data', cr.certificado_at,
                            'kg', cr.kg_total,
                            'kg_donacio', cr.kg_donacio, 'kg_compra', cr.kg_compra,
                            'destinatari', v_dest,
                            'periode', jsonb_build_object('des_de', cr.periodo_desde,
                                                          'fins_a', cr.periodo_hasta),
                            'substitueix', v_subs,
                            'motiu', cr.notas);
end;
$function$;

revoke execute on function public.emetre_certificat_recepcio(uuid, text) from public, anon;
grant execute on function public.emetre_certificat_recepcio(uuid, text) to authenticated;
comment on function public.emetre_certificat_recepcio(uuid, text) is
  'Emite el certificado de recepción de una ventana. En REAL solo super_admin (firma institucional, 20270615100100); en prueba, pot_aprovar(). datos_provisionales solo bloquea el modo real. p_motiu es una nota INTERNA que no se imprime.';


-- 1c. Rectificar el certificado anual de donación: en real, super_admin -----------------------

CREATE OR REPLACE FUNCTION public.rectificar_certificado(p_cd uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cd    cierres_donante%rowtype;
  ce    cierres_ejercicio%rowtype;
  par   parametros_documentales%rowtype;
  v_doc uuid;
  v_dest jsonb;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Una rectificacio necessita motiu' using errcode = '22023';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  -- 20270615100100: en REAL el certificado lleva la firma y el sello de la apoderada, y eso es
  -- solo del super_admin; en prueba sigue siendo de quien puede aprobar.
  if ce.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa un certificat real' using errcode = '42501';
  end if;

  if cd.certificado_numero is null then
    raise exception 'Aquest donant encara no te certificat' using errcode = '22023';
  end if;
  if cd.estado = 'declarat' or ce.estado = 'declarat' then
    raise exception 'Despres del 182 la rectificacio la decideix la gestoria (D10)'
      using errcode = '22023';
  end if;
  -- Solo en REAL: una rectificación de prueba es parte del ensayo (20260921214526).
  if ce.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat REAL (en mode prova si que es pot)'
      using errcode = '42501';
  end if;

  update cierres_donante
     set rectificaciones = rectificaciones + 1,
         certificado_at  = now(),
         estado          = 'certificat_emes'
   where id = p_cd
  returning * into cd;

  v_dest := public.cierre_destinatario(p_cd);
  v_doc := public.cierre_emet_document(
    p_cd, 'CD', 'definitiu',
    public.cierre_datos_certificado(p_cd) || jsonb_build_object('motiu_rectificacio', p_motivo),
    jsonb_build_object('destinatario', v_dest->>'email', 'nombre', v_dest->>'nom',
                       'forzado', v_dest->>'forcat', 'motiu_destinatari', v_dest->>'motiu',
                       'asunto', 'Certificat de donacio RECTIFICAT ' || ce.ejercicio::text
                                 || ' — ' || cd.certificado_numero,
                       'plantilla', 'certificat_donacio'));

  return jsonb_build_object('document', v_doc, 'numero', cd.certificado_numero,
                            'versio', cd.rectificaciones + 1, 'motiu', p_motivo);
end;
$function$;

revoke execute on function public.rectificar_certificado(uuid, text) from public, anon;
grant execute on function public.rectificar_certificado(uuid, text) to authenticated;
comment on function public.rectificar_certificado(uuid, text) is
  'Versión siguiente del certificado anual de donación, con motivo. No consume número nuevo. En REAL solo super_admin (20270615100100); en prueba, pot_aprovar(). Los datos provisionales solo la bloquean en modo REAL (21-09-2026).';


-- 1d. Rectificar el certificado de una ventana (CDP): en real, super_admin ---------------------

CREATE OR REPLACE FUNCTION public.rectificar_certificado_periodo(p_periodo uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cp     cierres_periodo%rowtype;
  par    parametros_documentales%rowtype;
  v_doc  uuid;
  v_dest jsonb;
  v_bloq text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Una rectificacio necessita motiu' using errcode = '22023';
  end if;

  select * into cp from cierres_periodo where id = p_periodo for update;
  if cp.id is null then
    raise exception 'Aquest certificat de periode no existeix' using errcode = '22023';
  end if;
  -- 20270615100100: en REAL el certificado lleva la firma y el sello de la apoderada, y eso es
  -- solo del super_admin; en prueba sigue siendo de quien puede aprobar.
  if cp.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa un certificat real' using errcode = '42501';
  end if;

  if cp.certificado_numero is null then
    raise exception 'Aquest periode encara no te certificat' using errcode = '22023';
  end if;
  if cp.estado = 'substituit' then
    raise exception 'Aquest periode ja esta substituit: rectifica el certificat que el va substituir'
      using errcode = '22023';
  end if;

  select * into par from parametros_documentales where id = 1;
  -- Solo en REAL: una rectificación de prueba es parte del ensayo (20260921214526).
  if cp.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat REAL (en mode prova si que es pot)'
      using errcode = '42501';
  end if;

  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cp.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquest donant esta bloquejat: %', v_bloq using errcode = '22023';
  end if;

  update cierres_periodo
     set rectificaciones = rectificaciones + 1,
         certificado_at  = now(),
         estado          = 'certificat_emes'
   where id = p_periodo
  returning * into cp;

  v_dest := public.periodo_destinatario(p_periodo);
  v_doc := public.periodo_emet_document(
    p_periodo,
    public.periodo_datos_certificado(p_periodo) || jsonb_build_object('motiu_rectificacio', p_motivo),
    jsonb_build_object('destinatario', v_dest->>'email', 'nombre', v_dest->>'nom',
                       'forzado', v_dest->>'forcat', 'motiu_destinatari', v_dest->>'motiu',
                       'asunto', 'Certificat de donacio (periode) RECTIFICAT — ' || cp.certificado_numero,
                       'plantilla', 'certificat_donacio'));

  return jsonb_build_object('document', v_doc, 'numero', cp.certificado_numero,
                            'versio', cp.rectificaciones + 1, 'motiu', p_motivo);
end;
$function$;

revoke execute on function public.rectificar_certificado_periodo(uuid, text) from public, anon;
grant execute on function public.rectificar_certificado_periodo(uuid, text) to authenticated;
comment on function public.rectificar_certificado_periodo(uuid, text) is
  'Versión siguiente del certificado de donación de una ventana, con motivo. No consume número nuevo. En REAL solo super_admin (20270615100100); en prueba, pot_aprovar(). Los datos provisionales solo la bloquean en modo REAL (21-09-2026).';


-- 1e. Rectificar el certificado de recepción: en real, super_admin ----------------------------

CREATE OR REPLACE FUNCTION public.rectificar_certificat_recepcio(p_id uuid, p_motiu text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cr     cierres_receptor%rowtype;
  par    parametros_documentales%rowtype;
  v_doc  uuid;
  v_dest jsonb;
  v_bloq text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motiu), '') = '' then
    raise exception 'Una rectificacio necessita motiu' using errcode = '22023';
  end if;

  select * into cr from cierres_receptor where id = p_id for update;
  if cr.id is null then
    raise exception 'Aquest certificat de recepcio no existeix' using errcode = '22023';
  end if;
  -- 20270615100100: en REAL el certificado lleva la firma y el sello de la apoderada, y eso es
  -- solo del super_admin; en prueba sigue siendo de quien puede aprobar.
  if cr.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa un certificat real' using errcode = '42501';
  end if;

  if cr.certificado_numero is null then
    raise exception 'Aquest periode encara no te certificat' using errcode = '22023';
  end if;
  if cr.estado = 'substituit' then
    raise exception 'Aquest periode ja esta substituit: rectifica el certificat que el va substituir'
      using errcode = '22023';
  end if;

  select * into par from parametros_documentales where id = 1;
  if cr.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat real'
      using errcode = '42501';
  end if;

  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cr.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquesta entitat esta bloquejada: %', v_bloq using errcode = '22023';
  end if;

  update cierres_receptor
     set rectificaciones = rectificaciones + 1,
         certificado_at  = now(),
         estado          = 'certificat_emes'
   where id = p_id
  returning * into cr;

  v_dest := public.recepcio_destinatari(p_id);
  v_doc := public.recepcio_emet_document(
    p_id,
    public.recepcio_datos_certificat(p_id) || jsonb_build_object('motiu_rectificacio', p_motiu),
    jsonb_build_object('destinatario', v_dest->>'email', 'nombre', v_dest->>'nom',
                       'forzado', v_dest->>'forcat', 'motiu_destinatari', v_dest->>'motiu',
                       'asunto', 'Certificat de recepcio RECTIFICAT — ' || cr.certificado_numero,
                       'plantilla', 'certificat_recepcio'));

  return jsonb_build_object('document', v_doc, 'numero', cr.certificado_numero,
                            'versio', cr.rectificaciones + 1, 'motiu', p_motiu);
end;
$function$;

revoke execute on function public.rectificar_certificat_recepcio(uuid, text) from public, anon;
grant execute on function public.rectificar_certificat_recepcio(uuid, text) to authenticated;
comment on function public.rectificar_certificat_recepcio(uuid, text) is
  'Versión siguiente del certificado de recepción, con motivo. En REAL solo super_admin (20270615100100); en prueba, pot_aprovar().';


-- 2. Configuración: solo super_admin escribe ------------------------------------------------
-- Mismos nombres de política (la interfaz y el arnés no dependen de ellos, pero así el catálogo
-- sigue diciendo lo mismo), con el helper envuelto en `(select …)`.

drop policy if exists "meta_test: escriptura admin" on public.meta_test_recipients;
drop policy if exists "meta_test: escriptura super_admin" on public.meta_test_recipients;
create policy "meta_test: escriptura super_admin" on public.meta_test_recipients
  for all to authenticated
  using ((select public.es_super_admin()))
  with check ((select public.es_super_admin()));

drop policy if exists "email_test: escriptura admin" on public.email_test_recipients;
drop policy if exists "email_test: escriptura super_admin" on public.email_test_recipients;
create policy "email_test: escriptura super_admin" on public.email_test_recipients
  for all to authenticated
  using ((select public.es_super_admin()))
  with check ((select public.es_super_admin()));

drop policy if exists "plantilles: aprovador escriu" on public.plantillas_documento;
drop policy if exists "plantilles: super_admin escriu" on public.plantillas_documento;
create policy "plantilles: super_admin escriu" on public.plantillas_documento
  for insert to authenticated
  with check ((select public.es_super_admin()));

drop policy if exists "plantilles: aprovador actualitza" on public.plantillas_documento;
drop policy if exists "plantilles: super_admin actualitza" on public.plantillas_documento;
create policy "plantilles: super_admin actualitza" on public.plantillas_documento
  for update to authenticated
  using ((select public.es_super_admin()))
  with check ((select public.es_super_admin()));


-- 3a. Cerrar una firma: albarán = equipo; institucional = super_admin ------------------------

CREATE OR REPLACE FUNCTION public.tancar_signatura(p_firma uuid, p_nota text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  f     firmes_document%rowtype;
  v_nou uuid;
begin
  -- Permiso antes que existencia: fuera del equipo, 42501 sin mirar la firma.
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes l''equip tanca una signatura' using errcode = '42501';
  end if;

  select * into f from firmes_document where id = p_firma for update;

  -- 20270615100100: un albarán (REC/ENT) lo cierra cualquiera del equipo; lo institucional
  -- (CONV, CD, CR) sigue siendo del super_admin. Va después de leer la firma (hace falta su
  -- tipo) y antes de mirar el estado.
  if f.id is not null and f.tipo_doc not in ('REC', 'ENT')
     and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin tanca la signatura d''un document institucional' using errcode = '42501';
  end if;

  -- La rechazó sola el trigger 8.2 porque salió otra versión: se dice así, no «estado».
  if f.estat = 'rebutjat' and f.motiu_rebuig like 'versio_substituida%' then
    raise exception 'versio_substituida: el document signat ja no es la versio vigent'
      using errcode = '22023';
  end if;
  if f.id is null or f.estat <> 'signat' then
    raise exception 'estat_incorrecte: aquesta signatura no esta pendent de tancar'
      using errcode = '22023';
  end if;

  update firmes_document set nota_tancament = nullif(btrim(coalesce(p_nota, '')), '')
   where id = f.id;
  v_nou := public.document_emet_versio_signada(f.id, auth.uid());

  return jsonb_build_object('firma_id', f.id, 'estat', 'tancat', 'document_signat_id', v_nou);
end;
$function$;

revoke execute on function public.tancar_signatura(uuid, text) from public, anon;
grant execute on function public.tancar_signatura(uuid, text) to authenticated;
comment on function public.tancar_signatura(uuid, text) is
  'Cierra una firma signat (emite la versión n+1 con el fichero subido). Albarán (REC/ENT): pot_aprovar(); CONV/CD/CR: es_super_admin() (20270615100100). 42501 sin permiso · 22023 estat_incorrecte · versio_substituida.';


-- 3b. Rechazar una firma: misma regla ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rebutjar_signatura(p_firma uuid, p_motiu text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  f firmes_document%rowtype;
begin
  -- Permiso antes que existencia: fuera del equipo, 42501 sin mirar la firma.
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes l''equip rebutja una signatura' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motiu), '') = '' then
    raise exception 'cal_motiu: cal explicar per que es rebutja' using errcode = '22023';
  end if;

  select * into f from firmes_document where id = p_firma for update;

  -- 20270615100100: un albarán (REC/ENT) lo cierra cualquiera del equipo; lo institucional
  -- (CONV, CD, CR) sigue siendo del super_admin. Va después de leer la firma (hace falta su
  -- tipo) y antes de mirar el estado.
  if f.id is not null and f.tipo_doc not in ('REC', 'ENT')
     and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin rebutja la signatura d''un document institucional' using errcode = '42501';
  end if;

  if f.estat = 'rebutjat' and f.motiu_rebuig like 'versio_substituida%' then
    raise exception 'versio_substituida: el document signat ja no es la versio vigent'
      using errcode = '22023';
  end if;
  if f.id is null or f.estat <> 'signat' then
    raise exception 'estat_incorrecte: aquesta signatura no esta pendent de tancar'
      using errcode = '22023';
  end if;

  update firmes_document
     set estat        = 'rebutjat',
         motiu_rebuig = btrim(p_motiu),
         rebutjat_per = auth.uid(),
         rebutjat_at  = now()
   where id = f.id;

  return jsonb_build_object('firma_id', f.id, 'estat', 'rebutjat', 'documento_id', f.documento_id);
end;
$function$;

revoke execute on function public.rebutjar_signatura(uuid, text) from public, anon;
grant execute on function public.rebutjar_signatura(uuid, text) to authenticated;
comment on function public.rebutjar_signatura(uuid, text) is
  'Rechaza una firma signat con motivo; el documento vuelve a «pendent». Albarán (REC/ENT): pot_aprovar(); CONV/CD/CR: es_super_admin() (20270615100100). 42501 sin permiso · 22023 cal_motiu · estat_incorrecte.';


-- 3c. Registrar un documento firmado subido: cierre directo del albarán para el equipo -------

CREATE OR REPLACE FUNCTION public.registrar_document_signat(p_documento uuid, p_user uuid, p_fitxer jsonb, p_signant jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d        documentos%rowtype;
  r        record;
  v_super  boolean;
  v_equip  boolean;
  v_tanca  boolean;
  v_via    text;
  v_firma  uuid;
  v_nou    uuid;
  v_ruta   text := btrim(coalesce(p_fitxer->>'ruta', ''));
  v_sha    text := lower(btrim(coalesce(p_fitxer->>'sha256', '')));
  v_mime   text := lower(btrim(coalesce(p_fitxer->>'mime', '')));
  v_bytes  bigint;
  v_data   date;
  v_nom    text := nullif(btrim(coalesce(p_signant->>'nom', '')), '');
  v_carr   text := nullif(btrim(coalesce(p_signant->>'carrec', '')), '');
  v_avui   date := (now() at time zone 'Europe/Madrid')::date;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor registra un document signat' using errcode = '42501';
  end if;
  -- Permiso antes que existencia.
  if p_user is null or not public.puc_signar_document(p_documento, p_user) then
    raise exception 'No pots signar aquest document' using errcode = '42501';
  end if;

  select * into r from public.document_signatura_comprova(p_documento) limit 1;
  select * into d from documentos where id = p_documento;

  -- El fichero.
  begin
    v_bytes := nullif(p_fitxer->>'bytes', '')::bigint;
  exception when others then
    v_bytes := null;
  end;
  if v_ruta = '' or v_sha !~ '^[0-9a-f]{64}$'
     or v_mime not in ('application/pdf', 'image/jpeg', 'image/png')
     or v_bytes is null or v_bytes <= 0 or v_bytes > 10 * 1024 * 1024 then
    raise exception 'dades_invalides: el fitxer no es valid (pdf, jpg o png de fins a 10 MB)'
      using errcode = '22023';
  end if;
  -- Tiene que estar en la carpeta del documento (la que da `ruta_document_signat()`).
  if d.ruta is null
     or position(regexp_replace(d.ruta, '/[^/]*$', '') || '/' in v_ruta) <> 1
     or v_ruta like '%..%' then
    raise exception 'dades_invalides: la ruta del fitxer no correspon al document' using errcode = '22023';
  end if;

  -- La fecha que declara: válida y no futura.
  if nullif(btrim(coalesce(p_signant->>'data_signatura', '')), '') is not null then
    begin
      v_data := (p_signant->>'data_signatura')::date;
    exception when others then
      raise exception 'dades_invalides: data de signatura incorrecta' using errcode = '22023';
    end;
    if v_data > v_avui then
      raise exception 'dades_invalides: la data de signatura no pot ser futura' using errcode = '22023';
    end if;
  end if;

  -- Por usuario y no por sesión (la sesión es la del servidor). Falla CERRADO: sin la fila
  -- de rol, la subida va a la cola de revisión aunque `roles_activos` esté apagado.
  v_super := exists (select 1 from usuario_roles ur
                       join perfiles pe on pe.id = ur.user_id
                      where ur.user_id = p_user and pe.activo and ur.rol = 'super_admin');
  v_equip := exists (select 1 from usuario_roles ur
                       join perfiles pe on pe.id = ur.user_id
                      where ur.user_id = p_user and pe.activo);
  -- 20270615100100: lo sube el equipo y lo cierra en el acto el super_admin siempre, y
  -- cualquiera del equipo si es un albarán (REC/ENT). Lo institucional que sube un Dinamitzador
  -- va a la cola de revisión del super_admin.
  v_tanca := v_super or (v_equip and d.tipo in ('REC', 'ENT'));
  v_via := case when v_tanca then 'correu' else 'pujat' end;

  -- Sin nombre declarado, el de la cuenta que sube, salvo si es del equipo: el equipo sube
  -- la firma de OTRA persona y no debe figurar como firmante.
  if v_nom is null and not v_equip then
    select nullif(btrim(pe.nombre), '') into v_nom from perfiles pe where pe.id = p_user;
  end if;

  insert into firmes_document (documento_id, objeto_tipo, objeto_id, tipo_doc, modo,
                               part, tipo_org, org_id, via, estat,
                               fitxer_ruta, fitxer_sha256, fitxer_mime, fitxer_bytes,
                               signant_nom, signant_carrec, data_signatura, signat_per)
  values (d.id, d.objeto_tipo, d.objeto_id, d.tipo, d.modo,
          r.part, r.tipo_org, r.org_id, v_via, 'signat',
          v_ruta, v_sha, v_mime, v_bytes::int,
          v_nom, v_carr, coalesce(v_data, v_avui), p_user)
  returning id into v_firma;

  if v_tanca then
    v_nou := public.document_emet_versio_signada(v_firma, p_user);
  end if;

  return jsonb_build_object('firma_id', v_firma, 'documento_id', d.id, 'via', v_via,
                            'estat', case when v_tanca then 'tancat' else 'signat' end,
                            'document_signat_id', v_nou);
end;
$function$;

-- Solo servidor, como estaba (20270510100100).
revoke execute on function public.registrar_document_signat(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_document_signat(uuid, uuid, jsonb, jsonb) to service_role;
comment on function public.registrar_document_signat(uuid, uuid, jsonb, jsonb) is
  'Solo servidor (20270510100100): registra un fichero firmado. Se cierra al momento (via correu, versión n+1 emitida con el fichero) si sube el super_admin, o cualquiera del equipo y el documento es un albarán REC/ENT (20270615100100); si no, via pujat, signat (cola del super_admin).';

