-- Circuito de firma unificado (05-11-2026) · 2/3: las RPC.
--
-- Superficie (guardas §4bis; toda función `revoke execute … from public, anon`):
--
--   document_emet_versio_signada(p_firma, p_per)   INTERNA (sin EXECUTE desde la API)
--   signar_document_per_enllac(p_enlace, p_evidencia)        solo servidor (enlace-publico)
--   registrar_document_signat(p_documento, p_user, p_fitxer, p_signant)
--                                                            solo servidor (pujar-document-signat)
--   preparar_enviament_signatura(p_documento, p_email, p_per)
--                                                            solo servidor (reenviar-documento)
--   tancar_signatura(p_firma, p_nota)                        es_super_admin()
--   rebutjar_signatura(p_firma, p_motiu)                     es_super_admin(), motivo obligatorio
--   acunar_enllac_propi(...)                                 + rama ('firma_document','documento')
--
-- Errores (los mensajes EMPIEZAN por la clave, para que el cliente traduzca):
--   42501  permiso (siempre ANTES que la existencia: un uuid inventado da 42501 a quien no puede)
--   22023  versio_substituida · no_signable · ja_signat · usa_firma_conveni · document_canviat ·
--          dades_invalides · estat_incorrecte · cal_motiu · sense_correu
--   PT404/PT409/PT410  enlace desconocido / usado / caducado (como el convenio)
--
-- Y dos triggers sobre `firmes_document` / `documentos`:
--   · al pasar una firma a `tancat`, aviso `document_signat` a la organización (modo real);
--   · cuando una versión deja de ser vigente por OTRA vía (p. ej. la conciliación emite la
--     v2 de un albarán), la firma `signat` que esperaba sobre ella se rechaza sola con
--     `versio_substituida`: lo firmado ya no es el documento vigente y el super_admin no
--     podría cerrarla. El documento nuevo vuelve a salir «pendent», y `tancar_signatura` /
--     `rebutjar_signatura` sobre esa firma responden `22023 versio_substituida`.

-- ---------------------------------------------------------------------------
-- 1. Emitir la versión firmada (interna)
-- ---------------------------------------------------------------------------
-- Apaga la versión firmada, inserta la n+1 con el MISMO `datos` y `sha256_datos` (el código
-- impreso sigue verificando) y `subtipo = 'signat'`, y cierra la firma.
--   · canvas       → `pendiente_fichero` con la ruta de siempre (`ruta_documento`, versión
--                    n+1): el trigger encola `generar-documento`, que estampa el trazo.
--   · pujat/correu → `emitido` desde el principio con el fichero subido (ruta, huella, bytes):
--                    el trigger de generación no lo encola (`fichero_at is not null`).
-- `emitido_por` = la sesión o, desde el servidor, `p_per`.
create or replace function public.document_emet_versio_signada(p_firma uuid, p_per uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  f      firmes_document%rowtype;
  d      documentos%rowtype;
  v_id   uuid;
  v_per  uuid := coalesce(auth.uid(), p_per);
  v_ver  int;
begin
  select * into f from firmes_document where id = p_firma for update;
  if f.id is null or f.estat <> 'signat' then
    raise exception 'estat_incorrecte: la signatura no esta pendent de tancar' using errcode = '22023';
  end if;

  select * into d from documentos where id = f.documento_id for update;
  if d.id is null or not d.vigente then
    raise exception 'versio_substituida: el document signat ja no es la versio vigent (%)',
      coalesce(d.numero_completo, '?') using errcode = '22023';
  end if;

  v_ver := d.version + 1;

  -- Lo que va a pasar ahora (vigente = false) dispararía el rechazo automático de esta
  -- misma firma (trigger de abajo). La marca, local a la transacción, la exceptúa.
  perform set_config('redestina.firma_en_curs', f.id::text, true);

  update documentos set vigente = false where id = d.id;

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos,
    ruta, sha256_fichero, bytes, estado, fichero_at, envio, emitido_por
  ) values (
    d.tipo, 'signat', d.objeto_tipo, d.objeto_id,
    d.numero_completo, v_ver, d.serie, d.ejercicio,
    d.modo, d.idioma, d.plantilla_id, d.datos, d.sha256_datos,
    case when f.via = 'canvas'
         then public.ruta_documento(d.objeto_tipo, d.objeto_id, d.tipo, d.numero_completo,
                                    v_ver, d.modo, d.ejercicio)
         else f.fitxer_ruta end,
    case when f.via = 'canvas' then null else f.fitxer_sha256 end,
    case when f.via = 'canvas' then null else f.fitxer_bytes end,
    case when f.via = 'canvas' then 'pendiente_fichero' else 'emitido' end,
    case when f.via = 'canvas' then null else now() end,
    null,
    v_per
  ) returning id into v_id;

  update documentos set sustituido_por = v_id where id = d.id;

  update firmes_document
     set estat              = 'tancat',
         document_signat_id = v_id,
         tancat_per         = v_per,
         tancat_at          = now()
   where id = f.id;

  perform set_config('redestina.firma_en_curs', '', true);
  return v_id;
end;
$$;

comment on function public.document_emet_versio_signada(uuid, uuid) is
  'Interna (20270510100100): emite la versión n+1 signat (mismo datos y sha256_datos) y cierra la firma. 22023 versio_substituida si la firmada ya no es vigente.';

revoke execute on function public.document_emet_versio_signada(uuid, uuid) from public, anon, authenticated;
grant execute on function public.document_emet_versio_signada(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Comprobaciones comunes antes de registrar una firma (interna)
-- ---------------------------------------------------------------------------
-- Bloquea el documento y devuelve la parte. El orden de los errores es el contrato:
-- no_signable (no existe / tipo que no se firma) → versio_substituida → ja_signat →
-- no_signable (estado de dominio). El permiso lo ha mirado ya quien llama.
create or replace function public.document_signatura_comprova(p_documento uuid)
returns table (part text, tipo_org text, org_id uuid, admet_canvas boolean)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  d  documentos%rowtype;
  r  record;
begin
  select * into d from documentos where id = p_documento for update;
  if d.id is null then
    raise exception 'no_signable: document desconegut' using errcode = '22023';
  end if;

  select * into r from public.document_part_signant_intern(d.id) limit 1;
  if r.part is null then
    raise exception 'no_signable: aquest tipus de document no es signa (%)', d.tipo
      using errcode = '22023';
  end if;
  if not d.vigente then
    raise exception 'versio_substituida: hi ha una versio mes nova de %', d.numero_completo
      using errcode = '22023';
  end if;
  if coalesce(d.subtipo, '') = 'signat'
     or exists (select 1 from firmes_document f
                 where f.documento_id = d.id and f.estat <> 'rebutjat') then
    raise exception 'ja_signat: % ja te una signatura', d.numero_completo using errcode = '22023';
  end if;
  if not r.signable then
    raise exception 'no_signable: % no es pot signar en aquest moment', d.numero_completo
      using errcode = '22023';
  end if;

  part         := r.part;
  tipo_org     := r.tipo_org;
  org_id       := r.org_id;
  admet_canvas := r.admet_canvas;
  return next;
end;
$$;

revoke execute on function public.document_signatura_comprova(uuid) from public, anon, authenticated;
grant execute on function public.document_signatura_comprova(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Firma con trazo por enlace (panel o correo) — solo servidor
-- ---------------------------------------------------------------------------
-- Espejo de `firmar_convenio_por_enlace()` (20270320100200). La llama `enlace-publico`
-- (POST `accion:'firmar_document'`) después de subir el trazo a `…/evidencies/<enlace>.png`.
--
-- p_evidencia (jsonb):
--   { nombre text ≥2, cargo text ≥2, documento_identidad text ≥5,
--     declaracion_representacion true, sha256_texto text (= documentos.sha256_datos),
--     trazo_firma_ruta text, ip text?, user_agent text?, payload object?, asistido_por uuid? }
-- Devuelve { firma_id, documento_id, document_signat_id, numero, version, estat:'tancat' }.
--
-- Un documento de modo PRUEBA solo se firma por un enlace que acuñó alguien del equipo
-- (`creado_por` con rol): una cuenta externa nunca firma en prueba.
create or replace function public.signar_document_per_enllac(p_enlace uuid, p_evidencia jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  en      enlaces_token%rowtype;
  d       documentos%rowtype;
  r       record;
  v_ev    uuid;
  v_firma uuid;
  v_nou   uuid;
  v_per   uuid;
  v_nom   text := btrim(coalesce(p_evidencia->>'nombre', ''));
  v_carr  text := btrim(coalesce(p_evidencia->>'cargo', ''));
  v_dni   text := btrim(coalesce(p_evidencia->>'documento_identidad', ''));
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor registra una signatura' using errcode = '42501';
  end if;

  select * into en from enlaces_token where id = p_enlace for update;
  if en.id is null or en.proposito <> 'firma_document' or en.objeto_tipo <> 'documento' then
    raise exception 'Enllac desconegut' using errcode = 'PT404';
  end if;
  if en.usado_at is not null or en.estado in ('usado', 'revocado') then
    raise exception 'Aquest enllac ja s''ha fet servir' using errcode = 'PT409';
  end if;
  if en.caduca_at < now() or en.estado = 'caducado' then
    raise exception 'Aquest enllac ha caducat' using errcode = 'PT410';
  end if;

  select * into d from documentos where id = en.objeto_id;
  if d.id is null then
    raise exception 'Enllac desconegut' using errcode = 'PT404';
  end if;
  if d.modo = 'prueba' and not exists (select 1 from usuario_roles ur where ur.user_id = en.creado_por) then
    raise exception 'Un document de prova nomes el pot signar l''equip' using errcode = '42501';
  end if;
  if d.tipo = 'CONV' then
    raise exception 'usa_firma_conveni: el conveni se signa pel seu circuit' using errcode = '22023';
  end if;

  select * into r from public.document_signatura_comprova(d.id) limit 1;

  if coalesce(btrim(p_evidencia->>'sha256_texto'), '') <> d.sha256_datos then
    raise exception 'document_canviat: el document que has llegit no es el vigent' using errcode = '22023';
  end if;
  if char_length(v_nom) < 2 or char_length(v_carr) < 2 or char_length(v_dni) < 5 then
    raise exception 'dades_invalides: cal nom, carrec i document d''identitat' using errcode = '22023';
  end if;
  if not coalesce((p_evidencia->>'declaracion_representacion')::boolean, false) then
    raise exception 'dades_invalides: cal declarar que es te representacio per signar' using errcode = '22023';
  end if;
  if coalesce(btrim(p_evidencia->>'trazo_firma_ruta'), '') = '' then
    raise exception 'dades_invalides: falta el traç de la signatura' using errcode = '22023';
  end if;

  insert into evidencias (enlace_id, tipo, nombre, cargo, documento_identidad,
                          declaracion_representacion, trazo_firma_ruta,
                          ip, user_agent, sha256_texto, payload, asistido_por)
  values (en.id, 'firma', v_nom, v_carr, v_dni, true,
          btrim(p_evidencia->>'trazo_firma_ruta'),
          nullif(p_evidencia->>'ip', '')::inet, p_evidencia->>'user_agent',
          d.sha256_datos,
          case when jsonb_typeof(p_evidencia->'payload') = 'object'
               then p_evidencia->'payload' else '{}'::jsonb end,
          nullif(p_evidencia->>'asistido_por', '')::uuid)
  returning id into v_ev;

  -- Quién firmó en el sistema: la cuenta que acuñó el enlace del panel; por correo, nadie.
  v_per := case when en.canal = 'panel' then en.creado_por end;

  insert into firmes_document (documento_id, objeto_tipo, objeto_id, tipo_doc, modo,
                               part, tipo_org, org_id, via, estat, enlace_id, evidencia_id,
                               signant_nom, signant_carrec, data_signatura, signat_per)
  values (d.id, d.objeto_tipo, d.objeto_id, d.tipo, d.modo,
          r.part, r.tipo_org, r.org_id, 'canvas', 'signat', en.id, v_ev,
          v_nom, v_carr, (now() at time zone 'Europe/Madrid')::date, v_per)
  returning id into v_firma;

  update enlaces_token set usado_at = now(), estado = 'usado' where id = en.id;

  -- El trazo ES la revisión: se cierra sola.
  v_nou := public.document_emet_versio_signada(v_firma, coalesce(v_per, en.creado_por));

  return jsonb_build_object('firma_id', v_firma, 'documento_id', d.id,
                            'document_signat_id', v_nou, 'numero', d.numero_completo,
                            'version', d.version + 1, 'estat', 'tancat');
end;
$$;

comment on function public.signar_document_per_enllac(uuid, jsonb) is
  'Solo servidor (20270510100100): firma con trazo por enlace firma_document; inserta la evidencia y la firma canvas y la cierra (versión n+1 signat).';

revoke execute on function public.signar_document_per_enllac(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.signar_document_per_enllac(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Fichero firmado subido — solo servidor
-- ---------------------------------------------------------------------------
-- La llama `pujar-document-signat` DESPUÉS de subir el fichero a `ruta_document_signat()`
-- (si esto falla, la función borra el fichero).
--
-- p_fitxer (jsonb, obligatorio):
--   { ruta text (en la carpeta del documento), sha256 text (64 hex),
--     mime 'application/pdf'|'image/jpeg'|'image/png', bytes int (1..10 MB) }
-- p_signant (jsonb, opcional):
--   { nom text?, carrec text?, data_signatura 'AAAA-MM-DD'? (no futura) }
-- Devuelve { firma_id, documento_id, via, estat, document_signat_id }.
--
-- Quién sube decide la vía: el super_admin → `correu` y se cierra al momento (es él quien
-- revisa); cualquier otra persona con permiso → `pujat` y queda `signat` en su cola.
create or replace function public.registrar_document_signat(
  p_documento uuid,
  p_user      uuid,
  p_fitxer    jsonb,
  p_signant   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  d        documentos%rowtype;
  r        record;
  v_super  boolean;
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
  v_via := case when v_super then 'correu' else 'pujat' end;

  -- Sin nombre declarado, el de la cuenta que sube (salvo el super_admin, que sube la firma
  -- de OTRA persona y no debe figurar como firmante).
  if v_nom is null and not v_super then
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

  if v_super then
    v_nou := public.document_emet_versio_signada(v_firma, p_user);
  end if;

  return jsonb_build_object('firma_id', v_firma, 'documento_id', d.id, 'via', v_via,
                            'estat', case when v_super then 'tancat' else 'signat' end,
                            'document_signat_id', v_nou);
end;
$$;

comment on function public.registrar_document_signat(uuid, uuid, jsonb, jsonb) is
  'Solo servidor (20270510100100): registra un fichero firmado. super_admin → via correu, tancat al momento (versión n+1 emitido con el fichero); resto → via pujat, signat (cola del super_admin).';

revoke execute on function public.registrar_document_signat(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_document_signat(uuid, uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Cerrar y rechazar (super_admin)
-- ---------------------------------------------------------------------------
create or replace function public.tancar_signatura(p_firma uuid, p_nota text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  f     firmes_document%rowtype;
  v_nou uuid;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin tanca una signatura' using errcode = '42501';
  end if;

  select * into f from firmes_document where id = p_firma for update;
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
$$;

comment on function public.tancar_signatura(uuid, text) is
  'es_super_admin() (20270510100100): cierra una firma signat (emite la versión n+1 con el fichero subido). 22023 estat_incorrecte · versio_substituida.';

revoke execute on function public.tancar_signatura(uuid, text) from public, anon;
grant execute on function public.tancar_signatura(uuid, text) to authenticated, service_role;

create or replace function public.rebutjar_signatura(p_firma uuid, p_motiu text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  f firmes_document%rowtype;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin rebutja una signatura' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motiu), '') = '' then
    raise exception 'cal_motiu: cal explicar per que es rebutja' using errcode = '22023';
  end if;

  select * into f from firmes_document where id = p_firma for update;
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
$$;

comment on function public.rebutjar_signatura(uuid, text) is
  'es_super_admin() (20270510100100): rechaza una firma signat con motivo; el documento vuelve a «pendent». 22023 cal_motiu · estat_incorrecte.';

revoke execute on function public.rebutjar_signatura(uuid, text) from public, anon;
grant execute on function public.rebutjar_signatura(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Enlace por correo (30 días) — solo servidor
-- ---------------------------------------------------------------------------
-- Molde: `enviar_convenio()` (20270111100100). La usa `reenviar-documento` con
-- `amb_enllac_signatura` (la función ya comprobó que quien pulsa es del equipo y que el
-- envío manual está aceptado, §8). Revoca el enlace de CORREO activo anterior (no el del
-- panel: la persona puede estar firmando ahora mismo) y acuña uno nuevo.
-- Correo: `p_email` o el de la ficha que firma. Devuelve
--   { enlace_id, token, email, nom, caduca_at, documento_id, numero, tipo, part, modo }.
create or replace function public.preparar_enviament_signatura(
  p_documento uuid,
  p_email     text default null,
  p_per       uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  d       documentos%rowtype;
  r       record;
  par     parametros_documentales%rowtype;
  v_mail  text;
  v_nom   text;
  v_token text;
  v_id    uuid;
  v_cad   timestamptz;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor prepara l''enviament d''una signatura' using errcode = '42501';
  end if;

  select * into d from documentos where id = p_documento;
  if d.id is not null and d.tipo = 'CONV' then
    raise exception 'usa_firma_conveni: el conveni s''envia a signar des del seu circuit'
      using errcode = '22023';
  end if;
  select * into r from public.document_signatura_comprova(p_documento) limit 1;
  select * into par from parametros_documentales where id = 1;

  if r.tipo_org = 'productor' then
    select p.email, coalesce(nullif(btrim(p.empresa), ''), p.name) into v_mail, v_nom
      from productores p where p.id = r.org_id;
  else
    select e.email, coalesce(e.contacto, e.nombre) into v_mail, v_nom
      from entidades e where e.id = r.org_id;
  end if;
  v_mail := coalesce(nullif(btrim(p_email), ''), nullif(btrim(v_mail), ''));
  if v_mail is null then
    raise exception 'sense_correu: la fitxa no te correu on enviar el document' using errcode = '22023';
  end if;

  update enlaces_token set estado = 'revocado'
   where proposito = 'firma_document' and objeto_tipo = 'documento'
     and objeto_id = d.id and canal = 'email' and estado = 'activo';

  -- Misma fábrica de token que `enviar_convenio()` (ver la nota de 20261012100500).
  v_token := rtrim(translate(
    encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                             clock_timestamp()::text, 'UTF8')), 'base64'),
    '+/', '-_'), '=');
  v_cad := now() + make_interval(days => coalesce(par.caducidad_enlace_dias, 30));

  insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                             destinatario_email, destinatario_nombre, canal,
                             token_hash, caduca_at, creado_por)
  values ('firma_document', 'documento', d.id, v_mail, v_nom, 'email',
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_cad, p_per)
  returning id into v_id;

  return jsonb_build_object('enlace_id', v_id, 'token', v_token, 'email', v_mail, 'nom', v_nom,
                            'caduca_at', v_cad, 'documento_id', d.id,
                            'numero', d.numero_completo, 'tipo', d.tipo, 'part', r.part,
                            'modo', d.modo);
end;
$$;

comment on function public.preparar_enviament_signatura(uuid, text, uuid) is
  'Solo servidor (20270510100100): acuña el enlace firma_document por correo (caducidad_enlace_dias, 30 por defecto). 22023 no_signable · ja_signat · versio_substituida · usa_firma_conveni · sense_correu.';

revoke execute on function public.preparar_enviament_signatura(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.preparar_enviament_signatura(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. `acunar_enllac_propi`: rama nueva ('firma_document', 'documento', <doc>)
-- ---------------------------------------------------------------------------
-- Misma firma (`create or replace`). Las dos ramas de antes no cambian ni una línea.
-- La nueva: el documento tiene que ser de los que la cuenta ve (`documents_meus`, si no
-- 42501 sin decir si existe), real (en prueba solo el equipo), no un convenio
-- (`usa_firma_conveni`), firmable ahora, y la cuenta TITULAR de la organización que firma.
-- Revoca solo los enlaces de PANEL activos de ese documento (el del correo sigue valiendo).
create or replace function public.acunar_enllac_propi(p_proposito text, p_objeto_tipo text, p_objeto_id uuid, p_rol_parte text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_mail    text;
  v_nom     text;
  v_tok     record;
  v_id      uuid;
  v_caduca  timestamptz := now() + interval '1 hour';
  c         convenios%rowtype;
  a         albaranes%rowtype;
  v_entrega boolean;
  v_recibe  boolean;
  v_rol     text;
  v_prod    uuid;
  v_ent     uuid;
  v_doc     documentos%rowtype;
  v_part    record;
begin
  if v_user is null then
    raise exception 'Cal una sessio per acunyar un enllac propi' using errcode = '42501';
  end if;

  select p.email, p.nombre into v_mail, v_nom from perfiles p where p.id = v_user;
  select * into v_tok from public.generar_token_enlace();

  -- --- Convenio -------------------------------------------------------------
  if p_proposito = 'firma_convenio' and p_objeto_tipo = 'convenio' then
    select * into c from convenios where id = p_objeto_id for update;
    -- Mismo mensaje para «no existe» y «no es tuyo»: la diferencia entre las dos cosas es
    -- información sobre convenios ajenos.
    if c.id is null or c.id not in (select public.convenios_meus(v_user)) then
      raise exception 'Aquest conveni no es teu' using errcode = '42501';
    end if;
    if not public.soc_titular(c.tipo_org, coalesce(c.productor_id, c.entidad_id)) then
      raise exception 'Nomes el titular de l''organitzacio pot signar el conveni'
        using errcode = '42501';
    end if;
    -- `esborrany` no entra: el equipo prepara y envía, el panel solo firma lo enviado.
    if c.estado not in ('pendent_firma', 'retornat') then
      raise exception 'Aquest conveni no esta pendent de signatura (estat %)', c.estado
        using errcode = '22023';
    end if;

    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'convenio' and objeto_id = c.id
       and proposito = 'firma_convenio' and estado = 'activo';

    insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                               destinatario_email, destinatario_nombre, canal,
                               token_hash, caduca_at, creado_por)
    values ('firma_convenio', 'convenio', c.id, v_mail, v_nom, 'panel',
            v_tok.token_hash, v_caduca, v_user)
    returning id into v_id;

    -- El estado NO se toca: ya estaba en `pendent_firma` o `retornat`, y `enviado_at`
    -- sigue diciendo cuándo se le mandó por correo, que es lo que significa.
    update convenios set enlace_id = v_id where id = c.id;

    return jsonb_build_object('id', v_id, 'token', v_tok.token,
                              'url_path', '/signar/' || v_tok.token,
                              'caduca_at', v_caduca);

  -- --- Albarán --------------------------------------------------------------
  elsif p_proposito = 'confirmacion_albaran' and p_objeto_tipo = 'albaran' then
    select * into a from albaranes where id = p_objeto_id for update;
    if a.id is null or a.id not in (select public.albarans_de_les_meves_orgs(v_user)) then
      raise exception 'Aquest albara no es teu' using errcode = '42501';
    end if;
    if a.estado <> 'entregado' then
      raise exception 'Aquest albara no esta pendent de confirmacio (estat %)', a.estado
        using errcode = '22023';
    end if;

    -- Qué parte soy. Mismo reparto que `marcar_entregado()`: REC y OPE los entrega el
    -- generador, ENT y OPE los recibe la entidad.
    -- ⚠️ Los alias NO pueden llamarse `a` ni `c`: son variables declaradas arriba
    --    (`a albaranes%rowtype`, `c convenios%rowtype`) y plpgsql resuelve antes la
    --    variable. Con `c` como alias de `canalizaciones`, `c.entidad_id` sería el
    --    `entidad_id` del CONVENIO —que existe y aquí está vacío—, y la parte se
    --    resolvería mal en silencio o daría «referencia ambigua» al ejecutarse.
    select coalesce(ex.productor_id, esp.productor_id), ca.entidad_id into v_prod, v_ent
      from albaranes al
      left join canalizaciones ca  on ca.id  = al.canalizacion_id
      left join excedentes     ex  on ex.id  = al.excedente_id
      left join espigoladas    esp on esp.id = al.espigolada_id
     where al.id = a.id;

    v_entrega := a.tipo in ('REC', 'OPE')
                 and v_prod is not null
                 and v_prod in (select public.mis_productores());
    v_recibe  := a.tipo in ('ENT', 'OPE')
                 and v_ent is not null
                 and v_ent in (select public.mis_entidades());

    v_rol := coalesce(
      nullif(btrim(coalesce(p_rol_parte, '')), ''),
      case when v_entrega and not v_recibe then 'entrega'
           when v_recibe and not v_entrega then 'recibe' end);
    if v_rol is null then
      raise exception 'Indica de quina part es la confirmacio (entrega o recibe)'
        using errcode = '22023';
    end if;
    if (v_rol = 'entrega' and not v_entrega) or (v_rol = 'recibe' and not v_recibe) then
      raise exception 'Aquesta part de l''albara no es teva' using errcode = '42501';
    end if;

    -- En un OPE hay DOS enlaces vivos, uno por parte: revocar el de la otra parte sería
    -- romperle la confirmación a alguien que no ha pedido nada. Los enlaces anteriores a
    -- 20270304100200 tienen `rol_parte` nulo y no se puede saber de quién son, así que
    -- solo se revocan cuando el albarán tiene una sola parte posible.
    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'albaran' and objeto_id = a.id
       and proposito = 'confirmacion_albaran' and estado = 'activo'
       and (rol_parte = v_rol or (a.tipo <> 'OPE' and rol_parte is null));

    insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                               destinatario_email, destinatario_nombre, canal, rol_parte,
                               token_hash, caduca_at, creado_por)
    values ('confirmacion_albaran', 'albaran', a.id, v_mail, v_nom, 'panel', v_rol,
            v_tok.token_hash, v_caduca, v_user)
    returning id into v_id;

    return jsonb_build_object('id', v_id, 'token', v_tok.token,
                              'url_path', '/confirmar/' || v_tok.token,
                              'rol_part', v_rol,
                              'caduca_at', v_caduca);

  -- --- Documento a firmar (20270510100100) ----------------------------------
  elsif p_proposito = 'firma_document' and p_objeto_tipo = 'documento' then
    select * into v_doc from documentos where id = p_objeto_id;
    if v_doc.id is null or v_doc.id not in (select public.documents_meus(v_user)) then
      raise exception 'Aquest document no es teu' using errcode = '42501';
    end if;
    if v_doc.modo <> 'real' and not public.es_intern() then
      raise exception 'Aquest document no es teu' using errcode = '42501';
    end if;
    if v_doc.tipo = 'CONV' then
      raise exception 'usa_firma_conveni: el conveni se signa des de «Pendent de tu»'
        using errcode = '22023';
    end if;

    select * into v_part from public.document_signatura_comprova(v_doc.id) limit 1;
    if not public.soc_titular(v_part.tipo_org, v_part.org_id) then
      raise exception 'Nomes la persona titular de l''organitzacio pot signar el document'
        using errcode = '42501';
    end if;

    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'documento' and objeto_id = v_doc.id
       and proposito = 'firma_document' and canal = 'panel' and estado = 'activo';

    insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                               destinatario_email, destinatario_nombre, canal,
                               token_hash, caduca_at, creado_por)
    values ('firma_document', 'documento', v_doc.id, v_mail, v_nom, 'panel',
            v_tok.token_hash, v_caduca, v_user)
    returning id into v_id;

    return jsonb_build_object('id', v_id, 'token', v_tok.token,
                              'url_path', '/signar-document/' || v_tok.token,
                              'caduca_at', v_caduca);
  end if;

  raise exception 'Proposit no admes des del panell: %', p_proposito using errcode = '22023';
end;
$$;

revoke execute on function public.acunar_enllac_propi(text, text, uuid, text) from public, anon;
grant execute on function public.acunar_enllac_propi(text, text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------------
-- 8.1 Aviso `document_signat` cuando una firma queda cerrada. A la organización que firmó,
--     sobre la versión firmada; params {numero, tipus}. En modo prueba no: la organización
--     no ve los documentos de prueba y el aviso le hablaría de algo que no existe para ella.
create or replace function public.trg_firmes_document_avis()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num text;
begin
  if new.estat = 'tancat' and old.estat is distinct from 'tancat' and new.modo = 'real' then
    select d.numero_completo into v_num from documentos d where d.id = new.documento_id;
    perform public.crear_avis(new.tipo_org, new.org_id, 'document_signat', 'documento',
                              new.document_signat_id,
                              jsonb_build_object('numero', v_num, 'tipus', new.tipo_doc));
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_firmes_document_avis() from public, anon, authenticated;

drop trigger if exists firmes_document_avis on public.firmes_document;
create trigger firmes_document_avis
  after update of estat on public.firmes_document
  for each row execute function public.trg_firmes_document_avis();

-- 8.2 Una versión que deja de ser vigente por otra vía se lleva por delante la firma que
--     esperaba revisión sobre ella. Sin esto, la firma se quedaría `signat` para siempre: la
--     cola la contaría, el super_admin no la podría cerrar (`versio_substituida`) y el
--     documento nuevo no saldría «pendent» hasta rechazarla a mano. La firma que se está
--     cerrando ahora mismo (`redestina.firma_en_curs`) queda fuera.
create or replace function public.trg_documentos_firma_substituida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.vigente and not new.vigente then
    update firmes_document
       set estat        = 'rebutjat',
           motiu_rebuig = 'versio_substituida: s''ha emes una versio nova del document',
           rebutjat_at  = now()
     where documento_id = new.id
       and estat = 'signat'
       and id::text is distinct from nullif(current_setting('redestina.firma_en_curs', true), '');
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_documentos_firma_substituida() from public, anon, authenticated;

drop trigger if exists documentos_firma_substituida on public.documentos;
create trigger documentos_firma_substituida
  after update of vigente on public.documentos
  for each row execute function public.trg_documentos_firma_substituida();
