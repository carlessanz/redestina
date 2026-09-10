-- Las RPC de los convenios: preparar, enviar, firmar, contrafirmar, devolver y resolver;
-- y el bloqueo que todo esto habilita.
--
-- ESTE FICHERO ES DONDE `exigir_convenio()` DEJA DE SER UN STUB. Desde 20261012100500 esa
-- función devolvía siempre un aviso porque la tabla `convenios` no existía. Ahora existe,
-- y con ella la regla del funcional (§3.2.2 + D7): **antes de la fecha de corte se avisa,
-- después se bloquea**. El bloqueo actúa en los tres sitios por los que se puede canalizar:
--
--   · `aprovar_resposta()`      — la vía normal (se recrea aquí, con las DOS partes)
--   · `repartir_espigolada()`   — la vía que NO pasa por la anterior (ya la llamaba)
--   · la priorización           — marca a quien no lo tiene (lo consume la Edge Function)
--
-- LA FIRMA ES ELECTRÓNICA SIMPLE CON EVIDENCIAS, y eso decide el diseño entero. No vale
-- por el trazo del dedo: vale por lo que se puede demostrar alrededor —identidad
-- declarada, control del correo (el token de 256 bits solo existió en su buzón), **huella
-- del texto exacto aceptado**, fecha, IP y navegador—. Todo eso ya lo modela `evidencias`
-- (20260928100300); aquí solo se rellena y se exige.
--
-- ⚠️ EL DNI NO ENTRA EN `documentos.datos`, aunque el PDF sí lo imprima. `documentos`
--    tiene `grant select … to authenticated` sobre la tabla entera, así que meter el
--    documento de identidad en el snapshot lo dejaría legible desde el navegador para
--    todo el equipo y para la propia organización, deshaciendo en una línea el GRANT por
--    columnas de `evidencias`. El renderizador lo lee de `evidencias` con `service_role`
--    en el momento de componer la página de evidencias. El precio es que `sha256_datos`
--    no cubre el DNI; la contrapartida es que el dato de categoría alta sigue estando en
--    un solo sitio, que es lo que dice §2.5 del plan funcional.
--
-- CÓDIGOS DE ERROR (los que el panel y `enlace-publico` tienen que distinguir):
--   42501  sin permiso — incluye el bloqueo por convenio, con el mensaje `sense_conveni: …`
--   22023  estado imposible (un convenio que no admite esa acción, un motivo que falta)
--   PT404  el enlace no existe o no es de firma      → PostgREST responde 404
--   PT409  el enlace ya se usó, o el convenio ya no admite firma → 409
--   PT410  el enlace ha caducado o está revocado     → 410
--   PT403  hace falta el código de 6 cifras y no se ha validado → 403
--
-- ORDEN DE LO QUE VIENE: primero los puentes y las consultas (que no escriben nada),
-- después las seis acciones del ciclo, después la firma asistida, las dos vistas de la
-- campaña, y por último lo que hay que recrear de otras fases (`ruta_documento`,
-- `documents_meus`, `puc_pujar_document_extern`, `get_my_session_context`).

-- ---------------------------------------------------------------------------
-- 1. convenios_meus(): el puente para `documentos` y para los adjuntos
-- ---------------------------------------------------------------------------
-- Mismo patrón y mismo motivo que `albarans_de_les_meves_orgs()` y
-- `cierres_donante_meus()` (§A del plan, deuda §12.23): una función `security definer`
-- que devuelve `setof uuid` se evalúa una vez por consulta (InitPlan) y no reentra en
-- ninguna política; un `exists` correlacionado dentro de la política de `documentos` se
-- evaluaría una vez por fila y recorrería `convenios` reevaluando SU RLS.
create or replace function public.convenios_meus(p_user uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els convenis d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  return query
    select c.id
      from convenios c
      join membresias m on (m.productor_id = c.productor_id or m.entidad_id = c.entidad_id)
      join perfiles   pe on pe.id = m.user_id
     where m.user_id = v_user and m.activo and pe.activo;
end;
$$;

comment on function public.convenios_meus(uuid) is
  'Ids de los convenios de las organizaciones de esa persona. Puente para la RLS de documentos y adjuntos.';

-- ---------------------------------------------------------------------------
-- 2. convenio_vigente(): ¿esta organización puede hacer esta operación?
-- ---------------------------------------------------------------------------
-- La pregunta de negocio entera, en una línea de SQL: ¿tiene vigente **el** convenio que
-- la matriz exige para esa valorización y ese lado de la operación?
--
-- Es `stable` y no escribe nada, así que la puede llamar la priorización, el panel y el
-- propio externo (para que su pantalla le explique qué le falta). Devuelve `true` cuando
-- la matriz no exige nada: una valorización sin fila en `convenios_exigidos` no es un
-- bloqueo, es una regla que todavía no se ha escrito, y bloquear por omisión pararía el
-- servicio el día que alguien añada una valorización nueva.
create or replace function public.convenio_vigente(
  p_tipo_org     text,
  p_org          uuid,
  p_valorizacion text,
  p_parte        text
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_org is null then false
    when not exists (select 1 from convenios_exigidos ce
                      where ce.valorizacion = p_valorizacion and ce.parte = p_parte)
      then true
    else not exists (
      -- Falta alguno de los exigidos → no está cubierta.
      select 1
        from convenios_exigidos ce
       where ce.valorizacion = p_valorizacion
         and ce.parte        = p_parte
         and not exists (
           select 1 from convenios c
            where c.estado = 'vigent'
              and c.tipo   = ce.tipo_convenio
              and ((p_tipo_org = 'productor' and c.productor_id = p_org)
                or (p_tipo_org = 'entidad'   and c.entidad_id   = p_org))))
  end;
$$;

comment on function public.convenio_vigente(text, uuid, text, text) is
  'True si la organización tiene vigentes todos los convenios que convenios_exigidos pide para (valorización, parte).';

-- ---------------------------------------------------------------------------
-- 3. exigir_convenio(): antes del corte avisa, después bloquea
-- ---------------------------------------------------------------------------
-- DOS FIRMAS, Y NO ES UN DESCUIDO. La de dos argumentos ya existe desde 20261012100500 y
-- la llama `repartir_espigolada()`; recrearla con parámetros nuevos —aunque tuvieran
-- valor por defecto— crearía una **sobrecarga** y dejaría ambiguas las llamadas de dos
-- argumentos que ya están escritas. Así que la de dos se conserva letra por letra en su
-- firma (y ahora sí consulta `convenios`, asumiendo donación, que es lo único que reparte
-- una espigolada) y delega en la de cuatro, que es la que usa `aprovar_resposta()`, donde
-- la valorización sí se conoce.
--
-- LA FECHA DE CORTE ES EL INTERRUPTOR (D7). Mientras `parametros_documentales.
-- fecha_corte_convenios` sea null o esté en el futuro, esto devuelve **texto** y quien
-- llama decide qué hacer con él (el panel lo enseña). Desde el corte, levanta `42501` con
-- el mensaje empezando por `sense_conveni:`, que es lo que la interfaz busca para pintar
-- el botón «Envia conveni» en vez de un error genérico.
create or replace function public.exigir_convenio(
  p_tipo         text,
  p_org          uuid,
  p_valorizacion text,
  p_parte        text
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_corte  date;
  v_nombre text;
  v_falta  text;
begin
  if p_org is null then
    return null;
  end if;

  if public.convenio_vigente(p_tipo, p_org, p_valorizacion, p_parte) then
    return null;
  end if;

  select fecha_corte_convenios into v_corte from parametros_documentales where id = 1;

  select coalesce(pr.empresa, pr.name, en.nombre, '(organitzacio)') into v_nombre
    from (select 1) x
    left join productores pr on p_tipo = 'productor' and pr.id = p_org
    left join entidades   en on p_tipo = 'entidad'   and en.id = p_org;

  select string_agg(ce.tipo_convenio, ', ' order by ce.tipo_convenio) into v_falta
    from convenios_exigidos ce
   where ce.valorizacion = p_valorizacion and ce.parte = p_parte;

  if v_corte is not null and current_date >= v_corte then
    raise exception 'sense_conveni: % no te conveni vigent (%) per a % com a part que %.',
      v_nombre, coalesce(v_falta, '?'), p_valorizacion,
      case p_parte when 'entrega' then 'entrega' else 'rep' end
      using errcode = '42501';
  end if;

  return 'AVIS: ' || v_nombre || ' encara no te conveni vigent (' || coalesce(v_falta, '?') ||
         ') per a ' || p_valorizacion ||
         coalesce('. A partir del ' || v_corte::text || ' aquesta operacio quedara bloquejada.',
                  '. La data de tall encara no esta fixada.');
end;
$$;

-- La de dos argumentos: misma firma de siempre (no se puede cambiar sin romper
-- `repartir_espigolada`), donación implícita y parte deducida de quién es la organización.
create or replace function public.exigir_convenio(p_tipo text, p_org uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.exigir_convenio(
    p_tipo, p_org, 'donacio',
    case p_tipo when 'productor' then 'entrega' else 'recibe' end);
$$;

comment on function public.exigir_convenio(text, uuid, text, text) is
  'Null si está cubierta; texto de aviso antes de la fecha de corte; 42501 «sense_conveni: …» desde el corte.';
comment on function public.exigir_convenio(text, uuid) is
  'Atajo para donación (lo llama repartir_espigolada, que solo reparte donaciones).';

-- ---------------------------------------------------------------------------
-- 4. aprovar_resposta(): ahora comprueba LAS DOS PARTES
-- ---------------------------------------------------------------------------
-- Se recrea entera (misma firma, mismo tipo de retorno: `canalizaciones`) porque
-- `language plpgsql` no admite parches. Lo único que cambia respecto a 20260730097000 es
-- el bloque de convenios: antes de crear la canalización se comprueba **quien entrega** y
-- **quien recibe**, cada uno con su lado de la matriz.
--
-- ⚠️ POR QUÉ LOS AVISOS SALEN POR `raise notice` Y NO EN EL RETORNO. El tipo de retorno es
--    `canalizaciones` y lo consume `OfferDetail`; cambiarlo a `jsonb` para poder devolver
--    avisos obligaría a tocar el panel en la misma tanda, y el panel es de otro agente.
--    Antes de la fecha de corte el aviso lo pinta la pantalla llamando a
--    `convenio_vigente()` **antes** de aprobar, que es donde de verdad sirve —un aviso
--    después de haber canalizado no evita nada—. Desde el corte no hay aviso que dar: hay
--    excepción, y esa sí llega al panel.
create or replace function public.aprovar_resposta(
  p_resposta uuid,
  p_kg       numeric default null,
  p_preu     numeric default null,
  p_motiu    text default null
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        oferta_respuestas;
  ex       excedentes;
  c        canalizaciones;
  kg       numeric;
  cubierto numeric;
  v_val    text;
  v_aviso  text;
begin
  if not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden aprovar' using errcode = '42501';
  end if;

  select * into r from oferta_respuestas where id = p_resposta for update;
  if r.id is null or r.estado <> 'acceptada' or r.aprovacio <> 'pendent' then
    raise exception 'Aquesta resposta no es pot aprovar' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = r.excedente_id for update;
  kg := coalesce(p_kg, r.kg_solicitados);
  if kg is null or kg <= 0 then
    raise exception 'Cal indicar els kg a canalitzar' using errcode = '22023';
  end if;

  -- El bloqueo por convenio, las dos partes. `exigir_convenio` levanta 42501 desde la
  -- fecha de corte y devuelve texto antes; aquí el texto se registra y no detiene nada.
  v_val := coalesce(ex.modalitat, 'donacio');
  v_aviso := public.exigir_convenio('productor', ex.productor_id, v_val, 'entrega');
  if v_aviso is not null then raise notice '%', v_aviso; end if;
  v_aviso := public.exigir_convenio('entidad', r.entidad_id, v_val, 'recibe');
  if v_aviso is not null then raise notice '%', v_aviso; end if;

  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, estado)
  values (r.excedente_id, r.entidad_id, kg, 'confirmada')
  returning * into c;

  update oferta_respuestas
     set aprovacio       = 'aprovada',
         aprovat_at      = now(),
         motiu_aprovacio = p_motiu,
         canalizacion_id = c.id,
         kg_solicitados  = kg,
         preu_ofert      = coalesce(p_preu, r.preu_ofert)
   where id = r.id;

  -- Misma regla que el alta manual: al cubrir los kg, la oferta se bloquea.
  select coalesce(sum(kg_confirmados), 0) into cubierto
    from canalizaciones where excedente_id = ex.id;

  update excedentes
     set estado = case
           when coalesce(ex.kg_total, 0) > 0 and cubierto >= ex.kg_total then 'bloqueada'
           else 'parcial'
         end
   where id = ex.id and estado in ('publicada', 'parcial');

  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Piezas internas: serie, datos congelados y emisión del documento
-- ---------------------------------------------------------------------------
create or replace function public.convenio_serie(p_tipo text)
returns text
language sql
immutable
as $$
  select case p_tipo
           when 'don_gen' then 'CONV-DON-GEN'
           when 'don_rec' then 'CONV-DON-REC'
           when 'com'     then 'CONV-COM'
         end;
$$;

-- La copia congelada de la organización, tal como se firma. Sale de la ficha y de lo que
-- la persona completa en la página de firma; **sin DNI** (ver cabecera).
create or replace function public.convenio_datos_org(p_conv uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c  convenios%rowtype;
  pr productores%rowtype;
  en entidades%rowtype;
begin
  select * into c from convenios where id = p_conv;
  if c.id is null then
    raise exception 'Aquest conveni no existeix' using errcode = '22023';
  end if;

  if c.tipo_org = 'productor' then
    select * into pr from productores where id = c.productor_id;
    return jsonb_build_object(
      'tipus_org',     'productor',
      'org_id',        pr.id,
      'raso_social',   coalesce(pr.empresa, pr.name),
      'nom',           pr.name,
      'nif',           pr.nif,
      'domicili',      pr.direccion,
      'codi_postal',   pr.codigo_postal,
      'poblacio',      pr.poblacion,
      'comarca',       pr.area_geografica,
      'email',         pr.email,
      'telefon',       pr.phone);
  end if;

  select * into en from entidades where id = c.entidad_id;
  return jsonb_build_object(
    'tipus_org',     'entidad',
    'org_id',        en.id,
    'raso_social',   en.nombre,
    'nom',           en.nombre,
    'nif',           en.nif,
    'domicili',      en.direccion,
    'codi_postal',   en.codigo_postal,
    'poblacio',      en.poblacion,
    'comarca',       en.area_geografica,
    'email',         en.email,
    'telefon',       en.telefono);
end;
$$;

-- El puente con `documentos`, igual que `albaran_emet_document` y `cierre_emet_document`:
-- el número ya está en la fila del dominio, aquí solo se versiona el PDF y se apaga el
-- anterior. El trigger de 20260928100700 encola la generación tras el commit.
create or replace function public.convenio_emet_document(
  p_conv    uuid,
  p_subtipo text,
  p_envio   jsonb default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c        convenios%rowtype;
  par      parametros_documentales%rowtype;
  v_ver    int;
  v_previo uuid;
  v_id     uuid;
  v_datos  jsonb;
begin
  select * into c   from convenios where id = p_conv;
  select * into par from parametros_documentales where id = 1;

  select id, version into v_previo, v_ver
    from documentos
   where objeto_tipo = 'convenio' and objeto_id = p_conv and tipo = 'CONV' and vigente;

  if v_previo is not null then
    update documentos set vigente = false where id = v_previo;
  end if;

  -- El snapshot. Lleva las evidencias **sin** el documento de identidad: el renderizador
  -- lo lee aparte con `service_role` para estamparlo en la página de evidencias.
  v_datos := jsonb_build_object(
    'tipus',         c.tipo,
    'subtipus',      p_subtipo,
    'numero',        c.numero_completo,
    'ejercici',      c.ejercicio,
    'idioma',        c.idioma,
    'roles_com',     to_jsonb(c.roles_com),
    'organitzacio',  c.datos_org,
    'firmant',       c.firmante,
    'firmat_at',     c.firmado_at,
    'contrafirmat_at', c.contrafirmado_at,
    'fundacio', jsonb_build_object(
      'raso_social',      par.razon_social,
      'cif',              par.cif,
      'domicili',         par.domicilio,
      'codi_postal',      par.codigo_postal,
      'poblacio',         par.poblacion,
      'inscripcio',       par.inscripcion,
      'apoderada_nom',    par.apoderada_nombre,
      'apoderada_carrec', par.apoderada_cargo,
      'firma_ruta',       case when p_subtipo = 'contrafirmat' then par.firma_ruta end,
      'segell_ruta',      case when p_subtipo = 'contrafirmat' then par.sello_ruta end),
    'dades_provisionals', par.datos_provisionales,
    'evidencies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tipus',        ev.tipo,
               'nom',          ev.nombre,
               'carrec',       ev.cargo,
               'declaracio',   ev.declaracion_representacion,
               'traç_ruta',    ev.trazo_firma_ruta,
               'ip',           host(ev.ip),
               'user_agent',   ev.user_agent,
               'sha256_texte', ev.sha256_texto,
               'assistit_per', ev.asistido_por,
               'created_at',   ev.created_at)
             order by ev.created_at)
        from evidencias ev
        join enlaces_token en on en.id = ev.enlace_id
       where en.objeto_tipo = 'convenio' and en.objeto_id = p_conv), '[]'::jsonb));

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos, ruta, envio, emitido_por
  ) values (
    'CONV', p_subtipo, 'convenio', p_conv,
    c.numero_completo, coalesce(v_ver, 0) + 1, c.serie, c.ejercicio,
    'real', c.idioma,
    coalesce(c.plantilla_id,
             (select p.id from plantillas_documento p
               where p.tipo = 'CONV' and p.variante = c.tipo and p.idioma = c.idioma and p.vigente
               limit 1)),
    v_datos,
    encode(sha256(convert_to(v_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('convenio', p_conv, 'CONV', c.numero_completo,
                          coalesce(v_ver, 0) + 1, 'real', c.ejercicio),
    p_envio,
    auth.uid()
  ) returning id into v_id;

  if v_previo is not null then
    update documentos set sustituido_por = v_id where id = v_previo;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. preparar_convenio(): el borrador
-- ---------------------------------------------------------------------------
-- Compone el convenio con la plantilla vigente del modelo y el idioma, y con los datos que
-- hoy tiene la ficha. Lo que falte se pedirá en la página de firma: preparar **no** exige
-- ficha completa, porque eso es exactamente lo que la campaña quiere descubrir (§3.2.6,
-- paso 2) y no un motivo para no poder empezar.
--
-- IDEMPOTENTE POR ORGANIZACIÓN Y MODELO: si ya hay un borrador o un enviado sin firmar, se
-- devuelve ese en vez de crear otro. Una campaña que se relanza no debe multiplicar
-- borradores, y el índice único solo protege los vigentes.
create or replace function public.preparar_convenio(
  p_tipo_org  text,
  p_org       uuid,
  p_tipo      text,
  p_idioma    text default null,
  p_roles_com text[] default null
) returns convenios
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c        convenios%rowtype;
  v_idioma text;
  v_pl     uuid;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot preparar un conveni' using errcode = '42501';
  end if;

  -- El idioma sale del perfil del titular si existe (misma regla que el resto de
  -- documentos, decisión D del plan); si no, catalán.
  select coalesce(p_idioma, pe.idioma, 'ca') into v_idioma
    from membresias m
    join perfiles pe on pe.id = m.user_id
   where m.activo and m.rol_org = 'titular'
     and ((p_tipo_org = 'productor' and m.productor_id = p_org)
       or (p_tipo_org = 'entidad'   and m.entidad_id   = p_org))
   order by m.created_at limit 1;
  v_idioma := coalesce(v_idioma, p_idioma, 'ca');

  -- ¿Ya hay uno en marcha? (no cuenta el vigente: eso sería una renovación, y se pide
  -- explícitamente con otro borrador cuando cambia la versión de la plantilla).
  select * into c from convenios
   where tipo = p_tipo
     and ((p_tipo_org = 'productor' and productor_id = p_org)
       or (p_tipo_org = 'entidad'   and entidad_id   = p_org))
     and estado in ('esborrany', 'pendent_firma', 'retornat', 'firmat')
   order by created_at desc limit 1;
  if c.id is not null then
    return c;
  end if;

  select p.id into v_pl from plantillas_documento p
   where p.tipo = 'CONV' and p.variante = p_tipo and p.idioma = v_idioma and p.vigente
   limit 1;
  if v_pl is null then
    raise exception 'No hi ha plantilla vigent de conveni % en %', p_tipo, v_idioma
      using errcode = '22023';
  end if;

  insert into convenios (tipo, tipo_org, productor_id, entidad_id, plantilla_id, idioma,
                         roles_com, creado_por)
  values (p_tipo, p_tipo_org,
          case when p_tipo_org = 'productor' then p_org end,
          case when p_tipo_org = 'entidad'   then p_org end,
          v_pl, v_idioma,
          case when p_tipo = 'com' then coalesce(p_roles_com, '{}') else '{}' end,
          auth.uid())
  returning * into c;

  update convenios set datos_org = public.convenio_datos_org(c.id) where id = c.id
  returning * into c;

  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. enviar_convenio(): el enlace de firma
-- ---------------------------------------------------------------------------
-- Devuelve `jsonb` y no la fila porque tiene que devolver **el token en claro**: es la
-- única vez que existe (en la base solo queda su sha256). Mismo razonamiento que
-- `marcar_entregado()` (20261012100500), incluida la nota sobre quién lo ve.
--
-- REENVIAR REVOCA EL ANTERIOR. Un convenio con dos enlaces vivos es un convenio que se
-- puede firmar dos veces, y la segunda firma no tendría dónde ir.
create or replace function public.enviar_convenio(p_id uuid, p_email text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c       convenios%rowtype;
  par     parametros_documentales%rowtype;
  v_token text;
  v_mail  text;
  v_nom   text;
  v_id    uuid;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot enviar un conveni' using errcode = '42501';
  end if;

  select * into c from convenios where id = p_id for update;
  if c.id is null or c.estado not in ('esborrany', 'pendent_firma', 'retornat') then
    raise exception 'Aquest conveni no es pot enviar a firmar (estat %)',
      coalesce(c.estado, 'inexistent') using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  v_mail := coalesce(nullif(btrim(p_email), ''), c.datos_org->>'email');
  v_nom  := coalesce(c.firmante->>'nombre', c.datos_org->>'raso_social');
  if coalesce(btrim(v_mail), '') = '' then
    raise exception 'No hi ha correu on enviar el conveni: completa la fitxa o fes servir la firma assistida'
      using errcode = '22023';
  end if;

  -- Revocar el anterior antes de crear el nuevo.
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'convenio' and objeto_id = c.id
     and proposito = 'firma_convenio' and estado = 'activo';

  -- 32 bytes de entropía en base64url. `gen_random_bytes()` de pgcrypto NO se puede usar
  -- aquí (vive en el esquema `extensions` y esta función lleva `search_path = public,
  -- pg_temp`): la aleatoriedad sale de dos `gen_random_uuid()` más el reloj, resumidos con
  -- `sha256()`, los dos built-in. Ver la nota larga en 20261012100500.
  v_token := rtrim(translate(
    encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                             clock_timestamp()::text, 'UTF8')), 'base64'),
    '+/', '-_'), '=');

  insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                             destinatario_email, destinatario_nombre,
                             token_hash, caduca_at, creado_por)
  values ('firma_convenio', 'convenio', c.id, v_mail, v_nom,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          now() + make_interval(days => coalesce(par.caducidad_enlace_dias, 30)),
          auth.uid())
  returning id into v_id;

  update convenios
     set estado     = 'pendent_firma',
         enlace_id  = v_id,
         enviado_at = now(),
         datos_org  = case when c.estado = 'esborrany'
                           then public.convenio_datos_org(c.id) else c.datos_org end
   where id = c.id
  returning * into c;

  return jsonb_build_object('conveni', to_jsonb(c),
                            'enllac', jsonb_build_object('id', v_id, 'token', v_token,
                                                         'destinatari', v_mail, 'nom', v_nom));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. firmar_convenio_por_enlace(): lo que escribe quien no tiene cuenta
-- ---------------------------------------------------------------------------
-- **Solo `service_role`**: la llama `enlace-publico` después de resolver el token con
-- `resolver_enlace()`. Quien firma no tiene sesión, así que ninguna política puede
-- protegerla; lo que la protege es tener el token (y, si lo hay, el código de 6 cifras).
--
-- `p_datos`     = { raso_social, nif, domicili, codi_postal, poblacio, representant,
--                   carrec, email, nom_comercial }
-- `p_evidencia` = { nombre, cargo, documento_identidad, declaracion_representacion,
--                   trazo_firma_ruta, ip, user_agent, sha256_texto, asistido_por }
--
-- TRES COSAS SIN LAS QUE NO SE FIRMA, y las tres son lo que hace que la firma valga algo:
--   · `declaracion_representacion` a true — quien firma declara que puede hacerlo
--   · `sha256_texto` — la huella del texto EXACTO que se le mostró. Sin ella queda un
--     «va firmar» que no dice qué firmó, que es justo lo que no sirve ante nadie
--   · el segundo factor, si el enlace lo lleva (`codigo_hash`): tiene que haberse validado
--     antes, y de eso queda su propia evidencia
--
-- LA FICHA SE COMPLETA, PERO NO SE PISA. Los datos que la persona rellena se copian a la
-- ficha **solo donde estaba vacía**. Es el paso 2 de la campaña (§3.2.6) resuelto sin
-- pantalla: quien firma sabe su NIF mejor que nuestro CSV de 2024. Sobrescribir lo que ya
-- hay sería otra cosa —dejaría que un token cambiara los datos de una organización real—
-- y por eso no se hace.
create or replace function public.firmar_convenio_por_enlace(
  p_enlace    uuid,
  p_datos     jsonb default '{}'::jsonb,
  p_evidencia jsonb default '{}'::jsonb
) returns convenios
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  en      enlaces_token%rowtype;
  c       convenios%rowtype;
  v_n     int;
  v_serie text;
  v_ej    int;
  v_datos jsonb;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor registra una firma' using errcode = '42501';
  end if;

  select * into en from enlaces_token where id = p_enlace for update;
  if en.id is null or en.proposito <> 'firma_convenio' then
    raise exception 'Enllac desconegut' using errcode = 'PT404';
  end if;
  if en.usado_at is not null or en.estado in ('usado', 'revocado') then
    raise exception 'Aquest enllac ja s''ha fet servir' using errcode = 'PT409';
  end if;
  if en.caduca_at < now() or en.estado = 'caducado' then
    raise exception 'Aquest enllac ha caducat' using errcode = 'PT410';
  end if;

  -- Segundo factor: si el enlace lleva código, tiene que estar validado.
  if en.codigo_hash is not null
     and not exists (select 1 from evidencias ev
                      where ev.enlace_id = en.id and ev.tipo = 'codigo'
                        and coalesce((ev.payload->>'valid')::boolean, false)) then
    raise exception 'Cal validar el codi de 6 xifres abans de firmar' using errcode = 'PT403';
  end if;

  select * into c from convenios where id = en.objeto_id for update;
  if c.id is null or c.estado not in ('pendent_firma', 'retornat') then
    raise exception 'Aquest conveni ja no admet firma' using errcode = 'PT409';
  end if;

  if not coalesce((p_evidencia->>'declaracion_representacion')::boolean, false) then
    raise exception 'Cal declarar que es te representacio per firmar' using errcode = '22023';
  end if;
  if coalesce(btrim(p_evidencia->>'sha256_texto'), '') = '' then
    raise exception 'Falta la petjada del text acceptat: sense aixo la firma no acredita res'
      using errcode = '22023';
  end if;

  -- Completar la ficha SOLO donde está vacía (ver cabecera).
  if c.tipo_org = 'productor' then
    update productores
       set nif           = coalesce(nullif(btrim(nif), ''),           nullif(btrim(p_datos->>'nif'), '')),
           direccion     = coalesce(nullif(btrim(direccion), ''),     nullif(btrim(p_datos->>'domicili'), '')),
           codigo_postal = coalesce(nullif(btrim(codigo_postal), ''), nullif(btrim(p_datos->>'codi_postal'), '')),
           poblacion     = coalesce(nullif(btrim(poblacion), ''),     nullif(btrim(p_datos->>'poblacio'), ''))
     where id = c.productor_id;
  else
    update entidades
       set nif           = coalesce(nullif(btrim(nif), ''),           nullif(btrim(p_datos->>'nif'), '')),
           direccion     = coalesce(nullif(btrim(direccion), ''),     nullif(btrim(p_datos->>'domicili'), '')),
           codigo_postal = coalesce(nullif(btrim(codigo_postal), ''), nullif(btrim(p_datos->>'codi_postal'), '')),
           poblacion     = coalesce(nullif(btrim(poblacion), ''),     nullif(btrim(p_datos->>'poblacio'), ''))
     where id = c.entidad_id;
  end if;

  -- La copia congelada: la ficha ya actualizada, con lo que la persona haya escrito encima.
  v_datos := public.convenio_datos_org(c.id) || jsonb_strip_nulls(jsonb_build_object(
    'raso_social',   nullif(btrim(p_datos->>'raso_social'), ''),
    'nom_comercial', nullif(btrim(p_datos->>'nom_comercial'), ''),
    'nif',           nullif(btrim(p_datos->>'nif'), ''),
    'domicili',      nullif(btrim(p_datos->>'domicili'), ''),
    'codi_postal',   nullif(btrim(p_datos->>'codi_postal'), ''),
    'poblacio',      nullif(btrim(p_datos->>'poblacio'), ''),
    'representant',  nullif(btrim(p_datos->>'representant'), ''),
    'carrec',        nullif(btrim(p_datos->>'carrec'), ''),
    'email',         nullif(btrim(p_datos->>'email'), '')));

  -- El número, DENTRO de esta transacción (§A): si algo falla después, no se consume.
  v_serie := public.convenio_serie(c.tipo);
  v_ej    := coalesce(c.ejercicio, extract(year from (now() at time zone 'Europe/Madrid'))::int);
  if c.numero_completo is null then
    v_n := public.siguiente_numero(v_serie, v_ej);
  end if;

  update convenios
     set estado          = 'firmat',
         datos_org       = v_datos,
         firmante        = jsonb_strip_nulls(jsonb_build_object(
                             'nombre', coalesce(p_evidencia->>'nombre', p_datos->>'representant'),
                             'cargo',  coalesce(p_evidencia->>'cargo',  p_datos->>'carrec'),
                             'email',  coalesce(p_datos->>'email', en.destinatario_email))),
         serie           = coalesce(c.serie, v_serie),
         ejercicio       = coalesce(c.ejercicio, v_ej),
         numero          = coalesce(c.numero, v_n),
         numero_completo = coalesce(c.numero_completo, public.formato_numero(v_serie, v_ej, v_n)),
         firmado_at      = now()
   where id = c.id
  returning * into c;

  -- La evidencia. Es la única fila del sistema que guarda un documento de identidad, y
  -- está fuera del GRANT de SELECT de `authenticated` (20260928100300).
  insert into evidencias (enlace_id, tipo, nombre, cargo, documento_identidad,
                          declaracion_representacion, trazo_firma_ruta,
                          ip, user_agent, sha256_texto, payload, asistido_por)
  values (en.id, 'firma',
          p_evidencia->>'nombre', p_evidencia->>'cargo', p_evidencia->>'documento_identidad',
          true, p_evidencia->>'trazo_firma_ruta',
          nullif(p_evidencia->>'ip', '')::inet, p_evidencia->>'user_agent',
          p_evidencia->>'sha256_texto', p_datos,
          nullif(p_evidencia->>'asistido_por', '')::uuid);

  update enlaces_token set usado_at = now(), estado = 'usado' where id = en.id;

  -- Y el documento firmado (todavía sin el sello de Espigoladors: eso es la contrafirma).
  perform public.convenio_emet_document(c.id, 'firmat',
    jsonb_build_object('destinatario', en.destinatario_email,
                       'motivo', 'conveni_firmat'));

  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. contrafirmar_convenio(): la apoderada valida y el convenio pasa a vigente
-- ---------------------------------------------------------------------------
-- El punto de control humano del circuito (§3.2.4, paso 6): alguien con `pot_aprovar()`
-- revisa el NIF y el cargo y valida. Al validar se estampa la firma de la apoderada (D11)
-- y se emite el PDF definitivo como **versión nueva del mismo documento**, que apaga el
-- firmado. El número no cambia: es el mismo convenio, contrafirmado.
--
-- Y si la organización ya tenía uno vigente de ese tipo, pasa a `substituit`. Sin esto, el
-- índice único `convenios_vigent_uidx` haría fallar la contrafirma con un error de
-- unicidad que no explicaría nada; con esto, la renovación es lo que parece.
create or replace function public.contrafirmar_convenio(p_id uuid)
returns convenios
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c   convenios%rowtype;
  par parametros_documentales%rowtype;
begin
  -- `auth.uid() is not null and not …`, como en todo el circuito documental
  -- (20261109100100 §12): `service_role` no tiene `auth.uid()` y pasa, porque estas tres
  -- acciones las llaman DOS caminos —el panel con la sesión de una persona y, en la
  -- campaña, el servidor por tandas—. Con `pot_aprovar()` a secas, la segunda vía
  -- respondería 42501 sin que hubiera nada mal.
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden contrasignar un conveni' using errcode = '42501';
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
$$;

-- ---------------------------------------------------------------------------
-- 10. retornar_convenio() y resolver_convenio(): las dos salidas
-- ---------------------------------------------------------------------------
-- Devolver NO anula la firma: corrige un dato de la ficha y vuelve a pedirla. Por eso el
-- convenio conserva su número y vuelve a `pendent_firma` cuando se reenvía (§3.2.3).
create or replace function public.retornar_convenio(p_id uuid, p_motiu text)
returns convenios
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c convenios%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden retornar un conveni' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motiu), '') = '' then
    raise exception 'Retornar un conveni necessita motiu' using errcode = '22023';
  end if;

  select * into c from convenios where id = p_id for update;
  if c.id is null or c.estado <> 'firmat' then
    raise exception 'Nomes es pot retornar un conveni firmat (estat %)',
      coalesce(c.estado, 'inexistent') using errcode = '22023';
  end if;

  update convenios
     set estado = 'retornat', devuelto_at = now(), motivo_devolucion = p_motiu
   where id = c.id
  returning * into c;
  return c;
end;
$$;

-- Resolver es la baja. La renovación del convenio es tácita (§3.2.3), así que no hay
-- vencimientos que avisar: lo único que se registra es esto, con su fecha de efecto.
-- El preaviso de dos meses del anexo C es el valor por defecto, no un límite: el equipo
-- puede fijar otra fecha si las partes lo acuerdan.
create or replace function public.resolver_convenio(
  p_id           uuid,
  p_motiu        text,
  p_fecha_efecto date default null
) returns convenios
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c convenios%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden resoldre un conveni' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motiu), '') = '' then
    raise exception 'Resoldre un conveni necessita motiu' using errcode = '22023';
  end if;

  select * into c from convenios where id = p_id for update;
  if c.id is null or c.estado <> 'vigent' then
    raise exception 'Nomes es pot resoldre un conveni vigent (estat %)',
      coalesce(c.estado, 'inexistent') using errcode = '22023';
  end if;

  update convenios
     set estado                  = 'resolt',
         resuelto_at             = now(),
         motivo_resolucion       = p_motiu,
         fecha_efecto_resolucion = coalesce(
           p_fecha_efecto,
           ((now() at time zone 'Europe/Madrid')::date + interval '2 months')::date)
   where id = c.id
  returning * into c;
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Firma asistida (§3.2.5): el enlace que no se manda
-- ---------------------------------------------------------------------------
-- El dinamizador abre la misma página de firma en su móvil con la persona delante. El
-- enlace nace con `canal = 'asistido'` y **no se envía a nadie**: el token vuelve en la
-- respuesta para que el panel lo abra directamente.
--
-- SI HAY CORREO, HAY SEGUNDO FACTOR. Un código de 6 cifras, 10 minutos, hasheado como el
-- token, que se manda por Resend. Es lo único que separa «la persona estaba delante» de
-- «alguien del equipo abrió el enlace»: sin él, la evidencia de una firma asistida se
-- apoya solo en `asistido_por`.
--
-- Y SI NO HAY CORREO, NO HAY SEGUNDO FACTOR, a propósito. No hay SMS en el proyecto y el
-- código no puede ir por WhatsApp mientras no exista una plantilla de categoría
-- AUTHENTICATION aprobada (checkpoint §12.2). Fingir un factor que no existe sería peor
-- que no tenerlo: la evidencia dice exactamente lo que hubo.
create or replace function public.iniciar_firma_asistida(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c        convenios%rowtype;
  par      parametros_documentales%rowtype;
  v_token  text;
  v_codigo text;
  v_hex    text;
  v_mail   text;
  v_id     uuid;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot conduir una firma assistida' using errcode = '42501';
  end if;

  select * into c from convenios where id = p_id for update;
  if c.id is null or c.estado not in ('esborrany', 'pendent_firma', 'retornat') then
    raise exception 'Aquest conveni no es pot firmar (estat %)',
      coalesce(c.estado, 'inexistent') using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  v_mail := nullif(btrim(coalesce(c.datos_org->>'email', '')), '');

  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'convenio' and objeto_id = c.id
     and proposito = 'firma_convenio' and estado = 'activo';

  v_token := rtrim(translate(
    encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                             clock_timestamp()::text, 'UTF8')), 'base64'),
    '+/', '-_'), '=');

  if v_mail is not null then
    -- 6 cifras a partir de los 7 primeros hex de un sha256, con un `0` delante para que
    -- el `bit(32)` sea siempre positivo (sin ese cero, `abs()` sobre el mínimo entero
    -- desbordaría; con él, el valor nunca pasa de 0x0FFFFFFF).
    v_hex := encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
    v_codigo := lpad(((('x0' || substr(v_hex, 1, 7))::bit(32)::int) % 1000000)::text, 6, '0');
  end if;

  insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                             destinatario_email, destinatario_nombre, canal,
                             token_hash, codigo_hash, codigo_caduca_at,
                             caduca_at, creado_por)
  values ('firma_convenio', 'convenio', c.id,
          v_mail, coalesce(c.firmante->>'nombre', c.datos_org->>'raso_social'), 'asistido',
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          case when v_codigo is not null
               then encode(sha256(convert_to(v_codigo, 'UTF8')), 'hex') end,
          case when v_codigo is not null then now() + interval '10 minutes' end,
          now() + make_interval(days => coalesce(par.caducidad_enlace_dias, 30)),
          auth.uid())
  returning id into v_id;

  update convenios
     set estado = 'pendent_firma', enlace_id = v_id, enviado_at = now(),
         datos_org = case when c.estado = 'esborrany'
                          then public.convenio_datos_org(c.id) else c.datos_org end
   where id = c.id
  returning * into c;

  return jsonb_build_object(
    'conveni', to_jsonb(c),
    'enllac',  jsonb_build_object('id', v_id, 'token', v_token, 'canal', 'asistido'),
    'codi',    v_codigo,                       -- null si no hay correo: no hay 2º factor
    'destinatari_codi', v_mail);
end;
$$;

-- Validar el código. **Solo `service_role`**, como la firma: quien lo teclea no tiene
-- sesión. Deja evidencia tanto del acierto como del fallo —un intento fallido es
-- información, y borrarla dejaría la firma peor documentada, no mejor—.
create or replace function public.validar_codi_firma(p_enlace uuid, p_codi text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  en    enlaces_token%rowtype;
  v_ok  boolean;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor valida el codi' using errcode = '42501';
  end if;

  select * into en from enlaces_token where id = p_enlace for update;
  if en.id is null or en.proposito <> 'firma_convenio' then
    raise exception 'Enllac desconegut' using errcode = 'PT404';
  end if;
  if en.codigo_hash is null then
    raise exception 'Aquest enllac no te codi' using errcode = 'PT404';
  end if;
  if en.codigo_caduca_at is null or en.codigo_caduca_at < now() then
    raise exception 'El codi ha caducat: demana''n un de nou' using errcode = 'PT410';
  end if;

  -- Comparación DENTRO de la base: el hash no sale de aquí (por eso `resolver_enlace()`
  -- tampoco lo devuelve, 20260928100300).
  v_ok := en.codigo_hash = encode(sha256(convert_to(coalesce(p_codi, ''), 'UTF8')), 'hex');

  insert into evidencias (enlace_id, tipo, payload)
  values (en.id, 'codigo', jsonb_build_object('valid', v_ok, 'at', now()));

  return v_ok;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Las dos vistas de la campaña (§3.2.6)
-- ---------------------------------------------------------------------------
-- `security_invoker = true` (PG15+): la vista NO es un agujero en la RLS. Se evalúan las
-- políticas de quien consulta, así que el equipo ve la campaña entera y una organización
-- externa vería, como mucho, su propia fila.
--
-- Paso 2 de la campaña: qué falta en cada ficha para poder mandarle el convenio. Un
-- convenio se puede preparar con la ficha a medias —lo que falte se pide en la página de
-- firma— pero sin **correo** no hay a dónde mandarlo, y esa es la única carencia que
-- obliga a firma asistida. El resto son avisos.
create or replace view v_fitxes_incompletes_conveni
with (security_invoker = true) as
with orgs as (
  select 'productor'::text as tipo_org, p.id, coalesce(p.empresa, p.name) as nom,
         p.email, p.nif, p.direccion, p.poblacion, p.area_geografica, p.es_test
    from productores p
   where coalesce(p.activo, true)
  union all
  select 'entidad', e.id, e.nombre, e.email, e.nif, e.direccion, e.poblacion,
         e.area_geografica, e.es_test
    from entidades e
)
select o.tipo_org,
       o.id as org_id,
       o.nom,
       o.email,
       o.area_geografica as comarca,
       o.es_test,
       -- El modelo que le toca: un productor firma `don_gen`; una entidad, `don_rec`. El
       -- de compraventa se prepara aparte, cuando la organización opera en venta o maquila.
       case o.tipo_org when 'productor' then 'don_gen' else 'don_rec' end as tipo,
       exists (select 1 from convenios c
                where c.estado = 'vigent'
                  and c.tipo = case o.tipo_org when 'productor' then 'don_gen' else 'don_rec' end
                  and coalesce(c.productor_id, c.entidad_id) = o.id) as te_conveni_vigent,
       array_remove(array[
         case when coalesce(btrim(o.email), '')     = '' then 'correu'    end,
         case when coalesce(btrim(o.nif), '')       = '' then 'nif'       end,
         case when coalesce(btrim(o.direccion), '') = '' then 'domicili'  end,
         case when coalesce(btrim(o.poblacion), '') = '' then 'poblacio'  end
       ], null) as falta,
       -- Sin correo no se puede enviar: es la lista de la firma presencial (§3.2.5).
       (coalesce(btrim(o.email), '') = '') as nomes_firma_assistida
  from orgs o;

comment on view v_fitxes_incompletes_conveni is
  'Qué falta en cada ficha para poder mandarle su convenio. `falta` vacío y sin convenio vigente = lista para enviar.';

-- Paso 6: seguimiento. Porcentaje firmado por modelo y por comarca, que es como el equipo
-- reparte el trabajo (§3.2.6). Una organización cuenta **una vez por modelo** y su estado
-- es el más avanzado que tenga, porque una campaña se mide por lo conseguido, no por el
-- número de borradores que se han generado por el camino.
create or replace view v_campanya_convenis
with (security_invoker = true) as
with orgs as (
  select 'productor'::text as tipo_org, p.id, coalesce(p.area_geografica, '(sense comarca)') as comarca,
         'don_gen'::text as tipo
    from productores p where coalesce(p.activo, true)
  union all
  select 'entidad', e.id, coalesce(e.area_geografica, '(sense comarca)'), 'don_rec'
    from entidades e
),
estat as (
  select o.tipo_org, o.comarca, o.tipo,
         coalesce((select case
                     when bool_or(c.estado = 'vigent')        then 'vigent'
                     when bool_or(c.estado = 'firmat')        then 'firmat'
                     when bool_or(c.estado = 'pendent_firma') then 'pendent_firma'
                     when bool_or(c.estado = 'retornat')      then 'retornat'
                     when bool_or(c.estado = 'esborrany')     then 'esborrany'
                     when bool_or(c.estado = 'resolt')        then 'resolt'
                   end
                    from convenios c
                   where c.tipo = o.tipo
                     and coalesce(c.productor_id, c.entidad_id) = o.id), 'sense') as estado
    from orgs o
)
select tipo_org, tipo, comarca,
       count(*)                                             as organitzacions,
       count(*) filter (where estado = 'vigent')            as vigents,
       count(*) filter (where estado = 'firmat')            as per_contrasignar,
       count(*) filter (where estado = 'pendent_firma')     as pendents_firma,
       count(*) filter (where estado = 'retornat')          as retornats,
       count(*) filter (where estado = 'esborrany')         as esborranys,
       count(*) filter (where estado = 'resolt')            as resolts,
       count(*) filter (where estado = 'sense')             as sense_conveni,
       round(100.0 * count(*) filter (where estado = 'vigent') / nullif(count(*), 0), 1) as pct_vigent
  from estat
 group by tipo_org, tipo, comarca;

comment on view v_campanya_convenis is
  'Seguimiento de la campaña: estado más avanzado por organización, agregado por modelo y comarca.';

grant select on v_fitxes_incompletes_conveni to authenticated;
grant select on v_campanya_convenis          to authenticated;

-- ---------------------------------------------------------------------------
-- 13. ruta_documento(): la rama `convenio`
-- ---------------------------------------------------------------------------
-- Se recrea entera (20261012100500 y 20261109100100 hicieron lo mismo con las suyas). El
-- propietario del fichero es **la parte que firma**: un convenio de donación vive en la
-- carpeta del productor y uno de entidad receptora, en la de la entidad.
--   CONV -> productors|entitats/<id>/<ejercicio>/CONV/<numero>-vN.pdf
create or replace function public.ruta_documento(
  p_objeto_tipo     text,
  p_objeto_id       uuid,
  p_tipo            text,
  p_numero_completo text,
  p_version         int,
  p_modo            text,
  p_ejercicio       int
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_carpeta text;
  v_fichero text;
  v_org     text;
begin
  v_carpeta := regexp_replace(p_tipo, '^R-', '');
  v_fichero := p_numero_completo || '-v' || p_version::text || '.pdf';

  if p_tipo = 'PROVA' or p_objeto_tipo = 'prova' then
    return 'proves/' || p_ejercicio::text || '/PROVA/' || v_fichero;
  end if;

  if p_objeto_tipo = 'albaran' then
    select case a.tipo
             when 'ENT' then 'entitats/'   || c.entidad_id::text
             else            'productors/' || coalesce(e.productor_id, es.productor_id)::text
           end
      into v_org
      from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
      left join excedentes     e on e.id = a.excedente_id
      left join espigoladas   es on es.id = a.espigolada_id
     where a.id = p_objeto_id;

  elsif p_objeto_tipo = 'espigolada' then
    select 'productors/' || es.productor_id::text into v_org
      from espigoladas es where es.id = p_objeto_id;

  elsif p_objeto_tipo = 'cierre_donante' then
    select 'productors/' || cd.productor_id::text into v_org
      from cierres_donante cd where cd.id = p_objeto_id;

  elsif p_objeto_tipo = 'convenio' then
    select case cv.tipo_org
             when 'productor' then 'productors/' || cv.productor_id::text
             else                  'entitats/'   || cv.entidad_id::text
           end
      into v_org
      from convenios cv where cv.id = p_objeto_id;
  end if;
  -- Fase 5: 'plan'.

  if v_org is null or v_org like '%null%' then
    raise exception
      'ruta_documento(): no es pot resoldre el propietari de % (%). Falta la taula o l''objecte no te organitzacio.',
      p_tipo, p_objeto_tipo using errcode = '0A000';
  end if;

  if p_modo = 'prueba' then
    return v_org || '/proves/' || p_ejercicio::text || '/' || v_carpeta || '/' || v_fichero;
  end if;
  return v_org || '/' || p_ejercicio::text || '/' || v_carpeta || '/' || v_fichero;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. documents_meus(): la organización ve también SU convenio
-- ---------------------------------------------------------------------------
create or replace function public.documents_meus(p_user uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els documents d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  return query
    select d.id
      from documentos d
     where (d.objeto_tipo = 'albaran'
            and d.objeto_id in (select public.albarans_de_les_meves_orgs(v_user)))
        or (d.objeto_tipo = 'cierre_donante'
            and d.objeto_id in (select public.cierres_donante_meus(v_user)))
        or (d.objeto_tipo = 'convenio'
            and d.objeto_id in (select public.convenios_meus(v_user)));
  -- Fase 5 añadirá `plan`.
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. puc_pujar_document_extern(): la rama `convenio`
-- ---------------------------------------------------------------------------
-- Una organización puede adjuntar a su convenio lo que le pidan (un poder notarial, un
-- CIF escaneado). Poder firmarlo y no poder aportar el papel que lo sostiene sería la
-- misma asimetría que 20261109100400 arregló para el cierre.
create or replace function public.puc_pujar_document_extern(
  p_objeto_tipo text,
  p_objeto_id   uuid,
  p_user        uuid default null
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
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

  if p_objeto_tipo = 'albaran' then
    return p_objeto_id in (select public.albarans_de_les_meves_orgs(v_user));
  elsif p_objeto_tipo = 'cierre_donante' then
    return p_objeto_id in (select public.cierres_donante_meus(v_user));
  elsif p_objeto_tipo = 'convenio' then
    return p_objeto_id in (select public.convenios_meus(v_user));
  end if;
  -- Fase 5: 'plan'. Lo desconocido se niega.
  return false;
end;
$$;

drop policy if exists "externs: intern o meus" on documentos_externos;
create policy "externs: intern o meus"
  on documentos_externos for select to authenticated
  using (
       (select public.es_intern())
    or (objeto_tipo = 'albaran'        and objeto_id in (select public.albarans_de_les_meves_orgs()))
    or (objeto_tipo = 'cierre_donante' and objeto_id in (select public.cierres_donante_meus()))
    or (objeto_tipo = 'convenio'       and objeto_id in (select public.convenios_meus()))
  );

-- ---------------------------------------------------------------------------
-- 16. get_my_session_context(): una clave nueva, `conveni_pendent`
-- ---------------------------------------------------------------------------
-- Se recrea entera (es `language sql` y no admite parches). El cuerpo es el de
-- 20260731100000 letra por letra, más `conveni_pendent`: true cuando alguna de las
-- organizaciones de la cuenta tiene un convenio esperando firma. Es lo que deja al panel
-- externo enseñar «tens un conveni pendent de firmar» sin una consulta extra en cada
-- pantalla.
--
-- ⚠️ `parallel restricted` va EXPLÍCITO. `create or replace` reescribe **todos** los
--    atributos de la función: sin esta línea volvería a ser PARALLEL UNSAFE y desharía en
--    silencio 20260731080000. Es la trampa que el plan avisa de esta fase concreta.
create or replace function public.get_my_session_context()
returns jsonb
language sql
stable
parallel restricted
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'user_id',        p.id,
    'email',          p.email,
    'nombre',         p.nombre,
    'idioma',         p.idioma,
    'activo',         p.activo,
    'rol',            public.mi_rol(),
    'roles_activos',  public.roles_activos(),
    'es_intern',      public.mi_rol() is not null,
    'pot_aprovar',    coalesce(public.mi_rol() in ('super_admin', 'admin'), false),
    'es_super_admin', coalesce(public.mi_rol() = 'super_admin', false),
    'vista_defecto',  coalesce(
        p.vista_defecto,
        case
          when public.mi_rol() is not null then 'intern'
          when exists (select 1 from membresias m
                        where m.user_id = p.id and m.activo and m.productor_id is not null)
            then 'productor'
          when exists (select 1 from membresias m
                        where m.user_id = p.id and m.activo and m.entidad_id is not null)
            then 'receptor'
        end),
    'registre_pendent', exists (
        select 1 from membresias m
         where m.user_id = p.id and m.aprovacio = 'pendent'),
    'registre_rebutjat', exists (
        select 1 from membresias m
         where m.user_id = p.id and m.aprovacio = 'rebutjada')
      and not exists (
        select 1 from membresias m
         where m.user_id = p.id and m.activo),
    -- Convenios (20270111100100). `pendent_firma` y `retornat` son los dos estados en los
    -- que la pelota está en el tejado de la organización.
    'conveni_pendent', exists (
        select 1 from convenios c
          join membresias m on (m.productor_id = c.productor_id or m.entidad_id = c.entidad_id)
         where m.user_id = p.id and m.activo
           and c.estado in ('pendent_firma', 'retornat')),
    'organizaciones', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'tipo',          m.tipo,
                 'id',            coalesce(m.productor_id, m.entidad_id),
                 'nombre',        coalesce(pr.empresa, pr.name, en.nombre),
                 'rol_org',       m.rol_org,
                 'tipo_receptor', en.tipo_receptor,
                 'modalitat',     en.modalitat,
                 'poblacion',     coalesce(pr.poblacion, en.poblacion))
               order by m.tipo, m.created_at)
          from membresias m
          left join productores pr on pr.id = m.productor_id
          left join entidades   en on en.id = m.entidad_id
         where m.user_id = p.id and m.activo), '[]'::jsonb))
    from perfiles p
   where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 17. EXECUTE: quitar el PUBLIC por defecto y conceder lo justo
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Sin estos revoke, `anon` podría firmar un
--    convenio sin ni siquiera tener sesión.
do $$
declare
  f text;
begin
  -- Consultas y puentes: los usa la RLS, la priorización y las pantallas.
  foreach f in array array[
    'convenios_meus(uuid)',
    'convenio_vigente(text,uuid,text,text)',
    'exigir_convenio(text,uuid)',
    'exigir_convenio(text,uuid,text,text)',
    'convenio_serie(text)',
    'documents_meus(uuid)',
    'puc_pujar_document_extern(text,uuid,uuid)',
    'ruta_documento(text,uuid,text,text,int,text,int)',
    'get_my_session_context()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Acciones del panel: las llama el equipo con su sesión, y cada una comprueba el rol por
  -- dentro (`es_intern()` o `pot_aprovar()`), que es lo que de verdad decide.
  foreach f in array array[
    'preparar_convenio(text,uuid,text,text,text[])',
    'enviar_convenio(uuid,text)',
    'contrafirmar_convenio(uuid)',
    'retornar_convenio(uuid,text)',
    'resolver_convenio(uuid,text,date)',
    'iniciar_firma_asistida(uuid)',
    'aprovar_resposta(uuid,numeric,numeric,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- SOLO `service_role`. Las llama `enlace-publico`, que no tiene sesión de usuario: lo
  -- que autoriza es el token, y si `authenticated` pudiera llamarlas, cualquier cuenta
  -- podría firmar un convenio ajeno conociendo el uuid de su enlace —que sí es legible
  -- para el equipo—.
  foreach f in array array[
    'firmar_convenio_por_enlace(uuid,jsonb,jsonb)',
    'validar_codi_firma(uuid,text)',
    'convenio_emet_document(uuid,text,jsonb)',
    'convenio_datos_org(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Verificación:
--   select has_function_privilege('authenticated','public.firmar_convenio_por_enlace(uuid,jsonb,jsonb)','EXECUTE'); -- f
--   select has_function_privilege('authenticated','public.convenio_vigente(text,uuid,text,text)','EXECUTE');        -- t
--   select proparallel from pg_proc where proname = 'get_my_session_context';  -- 'r' (restricted)
--   select * from v_campanya_convenis order by tipo_org, comarca;
