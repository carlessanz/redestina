-- Circuito de firma unificado (05-11-2026, plan aprobado por Carles) · 1/3: el modelo.
--
-- QUÉ RESUELVE. Todo documento que la contraparte tiene que firmar —el certificado de
-- donación (CD, firma el donante), el certificado de recepción (CR, la receptora), los
-- albaranes REC (el productor) y ENT (la receptora) y el convenio (CONV)— se puede firmar
-- de dos maneras desde el panel: con el dedo o el ratón (canvas) o descargándolo,
-- firmándolo fuera y subiéndolo. Y el super_admin lo puede mandar por correo, recibir el
-- firmado y subirlo para darlo por cerrado. El fichero firmado pasa a ser la versión
-- vigente de la biblioteca.
--
-- TRES DECISIONES QUE ORDENAN ESTE FICHERO:
--
--   1. **La firma es una VERSIÓN NUEVA del documento, no una edición.** `documentos` es
--      inmutable (20260928100200), así que firmar emite la versión n+1 con `subtipo =
--      'signat'`, el MISMO `datos` y el MISMO `sha256_datos` (el código de verificación
--      impreso en el original sigue valiendo). Eso lo hace la migración siguiente; aquí
--      solo se abre `signat` en el CHECK.
--   2. **«Pendent» no se guarda: se deriva.** Un documento está pendiente de firma cuando
--      es la versión vigente, el objeto de dominio está en un estado firmable y no tiene
--      ninguna firma viva. Lo dice `document_part_signant()`; la tabla `firmes_document`
--      solo guarda lo que PASA (una firma recibida, cerrada o rechazada). Así no hay un
--      estado que se pueda desincronizar del dominio: anular un albarán lo saca de la
--      lista solo.
--   3. **No bloquea nada.** Recogida, conciliación, cierre y declaración siguen igual; la
--      firma tiene su propio estado y ninguna RPC del dominio lo consulta.
--
-- SIN DNI EN ESTA TABLA. El documento de identidad de una firma con canvas vive en
-- `evidencias.documento_identidad`, que es la única columna del sistema que lo guarda y
-- está fuera del GRANT de SELECT (20260928100300). `firmes_document` apunta a la evidencia.

-- ---------------------------------------------------------------------------
-- 1. CHECKs que se amplían
-- ---------------------------------------------------------------------------
-- Ampliar una lista nunca invalida filas existentes, pero se sigue la regla del proyecto
-- (§7): `not valid` + `validate constraint`, para no tomar un lock largo con datos.

-- documentos.subtipo: + `signat` (la versión n+1 que lleva la firma de la contraparte).
alter table public.documentos drop constraint if exists documentos_subtipo_check;
alter table public.documentos add constraint documentos_subtipo_check
  check (subtipo in ('emes', 'conciliat', 'firmat', 'contrafirmat',
                     'provisional', 'definitiu', 'signat')) not valid;
alter table public.documentos validate constraint documentos_subtipo_check;

-- enlaces_token.proposito: + `firma_document`; objeto_tipo: + `documento`. El enlace de
-- firma apunta a la FILA de `documentos` que se firma (la versión concreta), no al objeto
-- de dominio: si sale una versión nueva entre medias, el enlace deja de valer
-- (`versio_substituida`) en vez de firmar algo que la persona no ha leído.
alter table public.enlaces_token drop constraint if exists enlaces_token_proposito_check;
alter table public.enlaces_token add constraint enlaces_token_proposito_check
  check (proposito in ('firma_convenio', 'confirmacion_albaran', 'subida_factura',
                       'consentiment_rgpd', 'firma_document')) not valid;
alter table public.enlaces_token validate constraint enlaces_token_proposito_check;

alter table public.enlaces_token drop constraint if exists enlaces_token_objeto_tipo_check;
alter table public.enlaces_token add constraint enlaces_token_objeto_tipo_check
  check (objeto_tipo in ('albaran', 'convenio', 'cierre_donante', 'organizacion',
                         'documento')) not valid;
alter table public.enlaces_token validate constraint enlaces_token_objeto_tipo_check;

-- avisos: + tipo `document_signat` (la firma quedó cerrada) sobre `objecte_tipo =
-- 'documento'` (la versión firmada). Los crea el trigger de la migración siguiente.
alter table public.avisos drop constraint if exists avisos_tipus_check;
alter table public.avisos add constraint avisos_tipus_check
  check (tipus in ('oferta_validada', 'oferta_rebutjada', 'sortida_trobada',
                   'interes_aprovat', 'interes_rebutjat', 'oferta_sense_desti',
                   'recollida_canviada', 'kg_assignats_canviats', 'recollida_confirmada',
                   'oferta_modificada', 'oferta_enviada', 'certificat_per_revisar',
                   'recollida_per_registrar', 'recollida_retornada',
                   'document_signat')) not valid;
alter table public.avisos validate constraint avisos_tipus_check;

alter table public.avisos drop constraint if exists avisos_objecte_tipo_check;
alter table public.avisos add constraint avisos_objecte_tipo_check
  check (objecte_tipo in ('excedente', 'oferta_resposta', 'canalizacion',
                          'cierre_donante', 'cierre_periodo', 'documento')) not valid;
alter table public.avisos validate constraint avisos_objecte_tipo_check;

-- ---------------------------------------------------------------------------
-- 2. La tabla
-- ---------------------------------------------------------------------------
create table if not exists public.firmes_document (
  id                 uuid primary key default gen_random_uuid(),

  -- La versión que se firmó y la que nació de la firma (null hasta cerrar). Las dos con
  -- `on delete cascade`: un documento solo se borra en el reinicio de un ciclo de PRUEBA
  -- (`redestina.reinicio_prueba`), y entonces su firma tiene que irse con él. Un
  -- `set null` en `document_signat_id` chocaría con el CHECK de estado en mitad del borrado.
  documento_id       uuid not null references public.documentos(id) on delete cascade,
  document_signat_id uuid references public.documentos(id) on delete cascade,

  -- Desnormalizado de `documentos` y del dominio, congelado al firmar: la cola del equipo
  -- y el aviso no tienen que volver a resolver el objeto (que puede haber cambiado).
  objeto_tipo        text not null,
  objeto_id          uuid not null,
  tipo_doc           text not null check (tipo_doc in ('CD', 'CR', 'REC', 'ENT', 'CONV')),
  modo               text not null check (modo in ('real', 'prueba')),
  part               text not null check (part in ('donant', 'receptor', 'organitzacio')),
  tipo_org           text not null check (tipo_org in ('productor', 'entidad')),
  org_id             uuid not null,

  -- Cómo llegó la firma:
  --   canvas  trazo en pantalla (panel o enlace); se cierra sola al momento.
  --   pujat   la contraparte (o alguien del equipo que no es super_admin) sube el fichero
  --           firmado; queda `signat` hasta que el super_admin lo revisa.
  --   correu  el super_admin sube el firmado que le devolvieron; se cierra al momento.
  via                text not null check (via in ('canvas', 'pujat', 'correu')),
  estat              text not null default 'signat'
                       check (estat in ('signat', 'tancat', 'rebutjat')),

  -- Vía canvas: el enlace por el que se firmó y su evidencia (nombre, cargo, DNI, IP,
  -- trazo). `set null` y no `cascade`: borrar un enlace (solo pasa en un reinicio de
  -- prueba) no debe llevarse la firma por delante.
  enlace_id          uuid references public.enlaces_token(id) on delete set null,
  evidencia_id       uuid references public.evidencias(id) on delete set null,

  -- Vías pujat/correu: el fichero tal cual se subió (sin estampar nada).
  fitxer_ruta        text,
  fitxer_sha256      text,
  fitxer_mime        text,
  fitxer_bytes       int,

  -- Quién firma (lo que declara; el DNI, si lo hay, en la evidencia) y cuándo dice que firmó.
  signant_nom        text,
  signant_carrec     text,
  data_signatura     date,

  -- Quién registró la firma en el sistema (la cuenta del panel, o quien subió el fichero).
  signat_per         uuid references auth.users(id) on delete set null,
  signat_at          timestamptz not null default now(),
  -- El cierre: quién y cuándo, con su nota opcional.
  tancat_per         uuid references auth.users(id) on delete set null,
  tancat_at          timestamptz,
  nota_tancament     text,
  -- El rechazo: quién, cuándo y por qué (obligatorio). El documento vuelve a «pendent».
  rebutjat_per       uuid references auth.users(id) on delete set null,
  rebutjat_at        timestamptz,
  motiu_rebuig       text,

  created_at         timestamptz not null default now(),

  -- Coherencia por vía: el canvas no trae fichero; las otras dos lo traen entero.
  constraint firmes_document_via_coherent check (
    (via = 'canvas'
       and fitxer_ruta is null and fitxer_sha256 is null
       and fitxer_mime is null and fitxer_bytes is null)
    or (via in ('pujat', 'correu')
       and fitxer_ruta is not null and btrim(fitxer_ruta) <> ''
       and fitxer_sha256 ~ '^[0-9a-f]{64}$'
       and fitxer_mime in ('application/pdf', 'image/jpeg', 'image/png')
       and fitxer_bytes > 0)),

  -- Coherencia por estado.
  constraint firmes_document_estat_coherent check (
    (estat = 'signat'
       and document_signat_id is null and tancat_at is null and rebutjat_at is null)
    or (estat = 'tancat'
       and document_signat_id is not null and tancat_at is not null and rebutjat_at is null)
    or (estat = 'rebutjat'
       and document_signat_id is null and tancat_at is null and rebutjat_at is not null
       and motiu_rebuig is not null and btrim(motiu_rebuig) <> ''))
);

comment on table public.firmes_document is
  'Firmas de la contraparte sobre un documento (CD, CR, REC, ENT, CONV). «Pendent» NO se guarda: lo deriva document_part_signant(). Sin DNI (vive en evidencias). 20270510100000.';
comment on column public.firmes_document.documento_id is
  'La versión de `documentos` que se firmó.';
comment on column public.firmes_document.document_signat_id is
  'La versión n+1 (subtipo signat) que nació al cerrar la firma. Null mientras está signat o si se rechazó.';
comment on column public.firmes_document.via is
  'canvas (trazo; se cierra sola) · pujat (fichero de la contraparte; lo cierra el super_admin) · correu (fichero subido por el super_admin; se cierra sola).';

-- Una firma VIVA por documento y parte: no se puede subir otra mientras la primera espera
-- revisión ni después de cerrada. Una rechazada no cuenta, y por eso se puede volver a firmar.
create unique index if not exists firmes_document_viva_uidx
  on public.firmes_document (documento_id, part) where estat <> 'rebutjat';

-- La cola del super_admin («Signatures per tancar») es una fracción minúscula de la tabla.
create index if not exists firmes_document_per_tancar_idx
  on public.firmes_document (signat_at) where estat = 'signat';

-- Para resolver el estado de una versión firmada (la vista de abajo).
create index if not exists firmes_document_signat_idx
  on public.firmes_document (document_signat_id) where document_signat_id is not null;

create index if not exists firmes_document_org_idx
  on public.firmes_document (tipo_org, org_id);

-- ---------------------------------------------------------------------------
-- 3. Permisos: dos capas
-- ---------------------------------------------------------------------------
-- Lectura: el equipo todo; una cuenta externa, las firmas de los documentos que ya ve
-- (`documents_meus()`), nunca las de modo prueba (mismo criterio que `documentos`).
-- Escritura: NINGUNA directa. Todo entra por las RPC de la migración siguiente.
alter table public.firmes_document enable row level security;
revoke all on public.firmes_document from public, anon, authenticated;
grant select on public.firmes_document to authenticated;
grant all on public.firmes_document to service_role;

drop policy if exists "firmes: intern o meves" on public.firmes_document;
create policy "firmes: intern o meves" on public.firmes_document
  for select to authenticated
  using ((select public.es_intern())
         or (modo <> 'prueba' and documento_id in (select public.documents_meus())));

-- ---------------------------------------------------------------------------
-- 4. Quién firma un documento (interna) y si se puede firmar ahora
-- ---------------------------------------------------------------------------
-- `document_part_signant_intern(doc)` resuelve la PARTE que firma un documento, con su
-- organización, sin mirar permisos ni estado. Devuelve 0 filas si el tipo no se firma.
-- `signable` dice si se puede firmar AHORA:
--   · la versión es la vigente, está `emitido` (hay PDF que leer) y no es ya la `signat`;
--   · el objeto de dominio está en un estado firmable:
--       CD  cierre_donante (donacio) / cierre_periodo en certificat_emes · enviat → donant
--       CR  cierre_receptor en certificat_emes · enviat                          → receptor
--       REC albarán confirmado · conciliado (el productor del excedente o la jornada) → donant
--       ENT albarán confirmado · conciliado (la entidad de la canalización)      → receptor
--       CONV convenio firmat · vigent (sin canvas: el convenio se firma por su circuito) → organitzacio
--
-- Es interna (sin EXECUTE para `authenticated`): la usan las RPC de firma, que deciden
-- ellas qué contar a quién. Hacia fuera está `document_part_signant()`.
create or replace function public.document_part_signant_intern(p_documento uuid)
returns table (part text, tipo_org text, org_id uuid, admet_canvas boolean, signable boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d        documentos%rowtype;
  v_part   text;
  v_tipo   text;
  v_org    uuid;
  v_estat  boolean := false;
begin
  select * into d from documentos where id = p_documento;
  if d.id is null or d.tipo not in ('CD', 'CR', 'REC', 'ENT', 'CONV') then
    return;
  end if;

  if d.tipo = 'CD' and d.objeto_tipo = 'cierre_donante' then
    select 'donant', 'productor', cd.productor_id,
           cd.tipo = 'donacio' and cd.estado in ('certificat_emes', 'enviat')
      into v_part, v_tipo, v_org, v_estat
      from cierres_donante cd where cd.id = d.objeto_id;

  elsif d.tipo = 'CD' and d.objeto_tipo = 'cierre_periodo' then
    select 'donant', 'productor', cp.productor_id,
           cp.estado in ('certificat_emes', 'enviat')
      into v_part, v_tipo, v_org, v_estat
      from cierres_periodo cp where cp.id = d.objeto_id;

  elsif d.tipo = 'CR' and d.objeto_tipo = 'cierre_receptor' then
    select 'receptor', 'entidad', cr.entidad_id,
           cr.estado in ('certificat_emes', 'enviat')
      into v_part, v_tipo, v_org, v_estat
      from cierres_receptor cr where cr.id = d.objeto_id;

  elsif d.tipo = 'REC' and d.objeto_tipo = 'albaran' then
    -- ⚠️ Alias `al`/`ex`/`esp`: `d` es la variable de arriba (ver la nota de
    --    `acunar_enllac_propi`, 20270318100000, sobre alias que plpgsql resuelve como variable).
    select 'donant', 'productor', coalesce(ex.productor_id, esp.productor_id),
           al.tipo = 'REC' and al.estado in ('confirmado', 'conciliado')
      into v_part, v_tipo, v_org, v_estat
      from albaranes al
      left join excedentes  ex  on ex.id  = al.excedente_id
      left join espigoladas esp on esp.id = al.espigolada_id
     where al.id = d.objeto_id;

  elsif d.tipo = 'ENT' and d.objeto_tipo = 'albaran' then
    select 'receptor', 'entidad', ca.entidad_id,
           al.tipo = 'ENT' and al.estado in ('confirmado', 'conciliado')
      into v_part, v_tipo, v_org, v_estat
      from albaranes al
      left join canalizaciones ca on ca.id = al.canalizacion_id
     where al.id = d.objeto_id;

  elsif d.tipo = 'CONV' and d.objeto_tipo = 'convenio' then
    select 'organitzacio', cv.tipo_org, coalesce(cv.productor_id, cv.entidad_id),
           cv.estado in ('firmat', 'vigent')
      into v_part, v_tipo, v_org, v_estat
      from convenios cv where cv.id = d.objeto_id;
  end if;

  if v_org is null then
    return;
  end if;

  part         := v_part;
  tipo_org     := v_tipo;
  org_id       := v_org;
  admet_canvas := d.tipo <> 'CONV';
  signable     := d.vigente
                  and d.estado = 'emitido'
                  and coalesce(d.subtipo, '') <> 'signat'
                  and coalesce(v_estat, false);
  return next;
end;
$$;

comment on function public.document_part_signant_intern(uuid) is
  'Interna (20270510100000): la parte que firma un documento y si se puede firmar ahora (signable). Sin guarda: no se ejecuta desde la API.';

revoke execute on function public.document_part_signant_intern(uuid) from public, anon, authenticated;
grant execute on function public.document_part_signant_intern(uuid) to service_role;

-- `document_part_signant(doc)` — la cara pública. Una fila si el documento se puede firmar
-- AHORA (no mira si ya hay una firma viva: eso lo resuelve la vista, que distingue
-- `pendent` de `signat`). A una cuenta externa solo le contesta sobre documentos de modo
-- real cuya parte firmante es una organización suya; con cualquier otro uuid, 0 filas —lo
-- mismo que con uno inventado, así que no se puede usar para sondear la base—.
create or replace function public.document_part_signant(p_documento uuid)
returns table (part text, tipo_org text, org_id uuid, admet_canvas boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r       record;
  v_modo  text;
begin
  select * into r from public.document_part_signant_intern(p_documento) limit 1;
  if r.part is null or not r.signable then
    return;
  end if;

  if auth.uid() is not null and not public.es_intern() then
    select d.modo into v_modo from documentos d where d.id = p_documento;
    if v_modo is distinct from 'real' then
      return;
    end if;
    if not ((r.tipo_org = 'productor' and r.org_id in (select public.mis_productores()))
         or (r.tipo_org = 'entidad'   and r.org_id in (select public.mis_entidades()))) then
      return;
    end if;
  end if;

  part         := r.part;
  tipo_org     := r.tipo_org;
  org_id       := r.org_id;
  admet_canvas := r.admet_canvas;
  return next;
end;
$$;

comment on function public.document_part_signant(uuid) is
  'Quién firma un documento si se puede firmar ahora: (part, tipo_org, org_id, admet_canvas). 0 filas si no se firma, no es la vigente, no está en estado firmable o (externo) no es suyo o es de prueba. 20270510100000.';

revoke execute on function public.document_part_signant(uuid) from public, anon;
grant execute on function public.document_part_signant(uuid) to authenticated, service_role;

-- `puc_signar_document(doc, user)` — ¿esta persona puede registrar una firma sobre este
-- documento? Molde: `puc_pujar_document_extern()` (20270329100000). Por USUARIO y no por
-- sesión, porque la llama la Edge Function de subida con `service_role` pasándole el uuid.
--   · el equipo (cualquier rol con perfil activo): sí, también en modo prueba;
--   · una cuenta externa: solo si es TITULAR activa de la organización que firma y el
--     documento es de modo real. Un operador ve el documento pero no lo firma (como el
--     convenio). No mira si el documento es firmable AHORA: esa es otra respuesta
--     (`no_signable`, `ja_signat`), y mezclarlas convertiría un «ya está firmado» en un 403.
create or replace function public.puc_signar_document(p_documento uuid, p_user uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid;
  v_modo  text;
  r       record;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els permisos d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return false;
  end if;

  if exists (select 1 from usuario_roles ur
               join perfiles pe on pe.id = ur.user_id
              where ur.user_id = v_user and pe.activo) then
    return true;
  end if;

  select d.modo into v_modo from documentos d where d.id = p_documento;
  if v_modo is distinct from 'real' then
    return false;
  end if;

  select * into r from public.document_part_signant_intern(p_documento) limit 1;
  if r.org_id is null then
    return false;
  end if;

  return exists (
    select 1
      from membresias m
      join perfiles pe on pe.id = m.user_id
     where m.user_id = v_user
       and m.activo
       and pe.activo
       and m.rol_org = 'titular'
       and ((r.tipo_org = 'productor' and m.productor_id = r.org_id)
         or (r.tipo_org = 'entidad'   and m.entidad_id   = r.org_id)));
end;
$$;

comment on function public.puc_signar_document(uuid, uuid) is
  'Equipo: sí (también prueba). Externo: solo titular activo de la organización que firma y documento real. No mira si es firmable ahora. 20270510100000.';

revoke execute on function public.puc_signar_document(uuid, uuid) from public, anon;
grant execute on function public.puc_signar_document(uuid, uuid) to authenticated, service_role;

-- `ruta_document_signat(doc, ext)` — dónde se sube el fichero firmado: la MISMA carpeta
-- que el PDF original, `<numero>-signat-<8hex>.<ext>`. El sufijo aleatorio hace que dos
-- intentos (uno rechazado y el siguiente) no choquen nunca con `upsert:false`, y que la
-- ruta no se pueda adivinar. Solo `service_role` (la usa `pujar-document-signat`).
create or replace function public.ruta_document_signat(p_documento uuid, p_ext text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  d       documentos%rowtype;
  v_ext   text := lower(btrim(coalesce(p_ext, '')));
  v_ruta  text;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor calcula la ruta d''un document signat' using errcode = '42501';
  end if;

  v_ext := case v_ext when 'jpeg' then 'jpg' else v_ext end;
  if v_ext not in ('pdf', 'jpg', 'png') then
    raise exception 'dades_invalides: extensio no admesa (%)', p_ext using errcode = '22023';
  end if;

  select * into d from documentos where id = p_documento;
  if d.id is null then
    raise exception 'no_signable: document desconegut' using errcode = '22023';
  end if;

  v_ruta := coalesce(d.ruta,
                     public.ruta_documento(d.objeto_tipo, d.objeto_id, d.tipo, d.numero_completo,
                                           d.version, d.modo, d.ejercicio));
  return regexp_replace(v_ruta, '/[^/]*$', '') || '/' || d.numero_completo || '-signat-'
         || substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8)
         || '.' || v_ext;
end;
$$;

comment on function public.ruta_document_signat(uuid, text) is
  'Solo service_role (20270510100000): <carpeta del documento>/<numero>-signat-<8hex>.<pdf|jpg|png>.';

revoke execute on function public.ruta_document_signat(uuid, text) from public, anon, authenticated;
grant execute on function public.ruta_document_signat(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Un documento borrado (solo en un reinicio de prueba) se lleva sus enlaces de firma
-- ---------------------------------------------------------------------------
-- Las funciones de reinicio (`reiniciar_cierre_prueba`, `reiniciar_periodes_prova`,
-- `reiniciar_recepcions_prova`, `reiniciar_documentos_prova`) borran los enlaces por el
-- objeto de DOMINIO; los de `firma_document` apuntan al documento y se quedarían
-- huérfanos. Un trigger aquí evita tener que reescribir las cuatro. Las evidencias caen
-- por la cascada del enlace; las firmas, por la de `documento_id`.
create or replace function public.trg_documentos_esborra_enllacos_firma()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from enlaces_token
   where objeto_tipo = 'documento' and objeto_id = old.id;
  return old;
end;
$$;

revoke execute on function public.trg_documentos_esborra_enllacos_firma() from public, anon, authenticated;

drop trigger if exists documentos_esborra_enllacos_firma on public.documentos;
create trigger documentos_esborra_enllacos_firma
  after delete on public.documentos
  for each row execute function public.trg_documentos_esborra_enllacos_firma();

-- ---------------------------------------------------------------------------
-- 6. Las vistas
-- ---------------------------------------------------------------------------
-- `v_signatura_document` — una fila por documento VIGENTE de tipo firmable con algo que
-- decir de su firma. `security_invoker`: cada cuenta ve las filas de los documentos que
-- sus políticas le dejan ver (el externo, los suyos y nunca los de prueba), y las firmas
-- con la política de `firmes_document`.
--
--   estat = tancat   la vigente es la versión `signat` y su firma está cerrada;
--           signat   hay una firma viva `signat` sobre la vigente (espera al super_admin);
--           pendent  `document_part_signant()` devuelve parte y no hay firma viva.
--   Sin parte ni firma, la fila no sale: no hay nada que firmar.
--
-- `ultim_motiu_rebuig`/`ultim_rebutjat_at`: solo en `pendent`, el último rechazo de esta
-- versión (para decirle a la persona por qué tiene que volver a firmar).
create or replace view public.v_signatura_document
with (security_invoker = true) as
select d.id                                                  as documento_id,
       d.tipo                                                as tipo,
       d.numero_completo                                     as numero_completo,
       d.version                                             as version,
       case when ft.id is not null then 'tancat'
            when fv.id is not null then 'signat'
            else 'pendent' end                               as estat,
       coalesce(ft.id, fv.id)                                as firma_id,
       coalesce(ft.via, fv.via)                              as via,
       coalesce(ft.signant_nom, fv.signant_nom)              as signant_nom,
       coalesce(ft.signat_at, fv.signat_at)                  as signat_at,
       ft.tancat_at                                          as tancat_at,
       coalesce(ft.fitxer_mime, fv.fitxer_mime)              as fitxer_mime,
       coalesce(ps.part, ft.part, fv.part)                   as part,
       coalesce(ps.tipo_org, ft.tipo_org, fv.tipo_org)       as tipo_org,
       coalesce(ps.org_id, ft.org_id, fv.org_id)             as org_id,
       coalesce(ps.admet_canvas, d.tipo <> 'CONV')           as admet_canvas,
       rb.motiu_rebuig                                       as ultim_motiu_rebuig,
       rb.rebutjat_at                                        as ultim_rebutjat_at
  from public.documentos d
  left join lateral (
    select f.* from public.firmes_document f
     where d.subtipo = 'signat' and f.document_signat_id = d.id and f.estat = 'tancat'
     limit 1
  ) ft on true
  left join lateral (
    select f.* from public.firmes_document f
     where f.documento_id = d.id and f.estat = 'signat'
     order by f.signat_at desc
     limit 1
  ) fv on true
  left join lateral (
    select s.part, s.tipo_org, s.org_id, s.admet_canvas
      from public.document_part_signant(d.id) s
     limit 1
  ) ps on true
  left join lateral (
    select f.motiu_rebuig, f.rebutjat_at from public.firmes_document f
     where ft.id is null and fv.id is null
       and f.documento_id = d.id and f.estat = 'rebutjat'
     order by f.rebutjat_at desc
     limit 1
  ) rb on true
 where d.vigente
   and d.tipo in ('CD', 'CR', 'REC', 'ENT', 'CONV')
   and (ft.id is not null or fv.id is not null or ps.part is not null);

comment on view public.v_signatura_document is
  'Estado de firma de cada documento vigente firmable (pendent · signat · tancat). security_invoker. 20270510100000.';

revoke all on public.v_signatura_document from public, anon;
grant select on public.v_signatura_document to authenticated, service_role;

-- `v_signatures_bandeja` — lo mismo para el EQUIPO, con lo que hace falta para pintar la
-- cola «Signatures per tancar» y la pestaña «Signatures» de Documents sin otra consulta:
-- el modo, el objeto de dominio, la organización con su nombre y el detalle de la firma.
-- La guarda es `es_intern()` dentro de la vista (una externa ve 0 filas, sin error).
create or replace view public.v_signatures_bandeja
with (security_invoker = true) as
select v.documento_id, v.tipo, v.numero_completo, v.version, v.estat, v.firma_id, v.via,
       v.signant_nom, v.signat_at, v.tancat_at, v.fitxer_mime, v.part, v.tipo_org, v.org_id,
       v.admet_canvas, v.ultim_motiu_rebuig, v.ultim_rebutjat_at,
       d.modo                                                as modo,
       d.objeto_tipo                                         as objeto_tipo,
       d.objeto_id                                           as objeto_id,
       d.ejercicio                                           as ejercicio,
       d.emitido_at                                          as emitido_at,
       f.signant_carrec                                      as signant_carrec,
       f.data_signatura                                      as data_signatura,
       f.signat_per                                          as signat_per,
       f.fitxer_bytes                                        as fitxer_bytes,
       f.nota_tancament                                      as nota_tancament,
       case v.tipo_org
         when 'productor' then coalesce(nullif(btrim(p.empresa), ''), p.name)
         else e.nombre
       end                                                   as org_nom,
       v.org_id                                              as fitxa_id,
       coalesce(p.organizacion_id, e.organizacion_id)        as organizacion_id
  from public.v_signatura_document v
  join public.documentos d on d.id = v.documento_id
  left join public.firmes_document f on f.id = v.firma_id
  left join public.productores p on v.tipo_org = 'productor' and p.id = v.org_id
  left join public.entidades   e on v.tipo_org = 'entidad'   and e.id = v.org_id
 where (select public.es_intern());

comment on view public.v_signatures_bandeja is
  'Bandeja de firmas del equipo (Aprovacions › Signatures per tancar, Documents › Signatures). Una externa ve 0 filas. security_invoker. 20270510100000.';

revoke all on public.v_signatures_bandeja from public, anon;
grant select on public.v_signatures_bandeja to authenticated, service_role;
