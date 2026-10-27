-- El convenio DECLARADO: vigente sin firma electrónica ni escaneado (27-10-2026).
--
-- POR QUÉ EXISTE. Con las notificaciones apagadas y la importación masiva de organizaciones,
-- el equipo gestiona el ciclo entero en nombre de las partes (plan de gestión autónoma). Para
-- operar, una organización necesita un convenio vigente (`exigir_convenio`, corte encendido
-- desde el 16-09-2026), y hasta hoy había dos caminos y los dos exigían a alguien más: la
-- firma (electrónica o asistida, con la persona delante) o el papel ya escaneado. Decisión
-- del cliente del 27-10-2026: el super_admin puede **darlo por vigente** con los datos de la
-- ficha, y el PDF lo dice.
--
-- Lo que lo distingue de los otros dos orígenes:
--   · `plataforma`: firma con evidencias (IP, huella, trazo) → número de su serie.
--   · `paper`: firmado fuera, escaneado subido → SIN número (es un papel de otra época).
--   · `declarat`: nadie firma aquí ni hay papel → **CON número**, porque el documento que
--     acredita es el que emite Redestina, y su página de evidencias dice exactamente lo que
--     pasó: «donat per vigent per l'equip (nom) el dd/mm, en nom de X, sense signatura».
--
-- ⚠️ NO hay fila en `evidencias`: su `enlace_id` es not null, y una evidencia de un enlace que
--    nunca existió sería mentir justo en la tabla que existe para no mentir. La declaración
--    vive en `firmante` (quién dice el equipo que representa a la organización) y en
--    `declarat_per`/`declarat_at` (quién la hizo y cuándo).
-- ⚠️ Un declarado se SUSTITUYE por uno firmado: `conveni_cobreix_tot()` deja de contarlo, así
--    que la organización puede firmar el suyo desde el panel, y la contrafirma lo deja
--    `substituit` como a cualquier vigente del mismo tipo.

-- ---------------------------------------------------------------------------
-- 1. Columnas y checks
-- ---------------------------------------------------------------------------
alter table convenios
  add column if not exists declarat_per uuid references auth.users (id) on delete set null,
  add column if not exists declarat_at  timestamptz;

comment on column convenios.declarat_per is
  'Quién del equipo lo dio por vigente sin firma ni escaneado (origen = declarat, 20270430100000).';

-- `convenios` tiene GRANT de SELECT por tabla para `authenticated` (la RLS decide las filas):
-- las dos columnas nuevas se leen sin tocar nada.

alter table convenios drop constraint if exists convenios_origen_check;
alter table convenios add constraint convenios_origen_check
  check (origen in ('plataforma', 'paper', 'declarat'));

alter table convenios drop constraint if exists convenios_numero_segons_estat;
alter table convenios add constraint convenios_numero_segons_estat check (
  (origen = 'plataforma' and (
      (estado = 'esborrany' and numero_completo is null)
   or estado = 'pendent_firma'
   or (estado in ('firmat', 'vigent', 'retornat', 'resolt', 'substituit')
       and numero_completo is not null and serie is not null and ejercicio is not null)))
  or (origen = 'paper' and numero_completo is null and (
      estado = 'esborrany'
   or (coalesce(btrim(referencia_paper), '') <> '' and firmado_at is not null)))
  -- Nace vigente en un solo `update` (abajo), así que el borrador declarado no llega a
  -- existir; se admite por simetría con los otros dos.
  or (origen = 'declarat' and (
      (estado = 'esborrany' and numero_completo is null)
   or (estado in ('vigent', 'resolt', 'substituit')
       and numero_completo is not null and serie is not null and ejercicio is not null
       and firmado_at is not null and declarat_per is not null))));

-- ---------------------------------------------------------------------------
-- 2. El trigger de control: `esborrany → vigent` también para el declarado
-- ---------------------------------------------------------------------------
-- Recreado entero desde 20270329100300; solo cambian la transición y la lista congelada
-- (`declarat_per`/`declarat_at` no se pueden reescribir una vez vigente).
create or replace function trg_convenios_control()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text;
begin
  if new.roles_com is not null then
    foreach v_rol in array new.roles_com loop
      if v_rol not in ('venedora', 'compradora', 'obrador') then
        raise exception 'Rol de compravenda desconegut: % (venedora | compradora | obrador)', v_rol
          using errcode = '22023';
      end if;
    end loop;
  end if;
  if new.tipo <> 'com' and coalesce(array_length(new.roles_com, 1), 0) > 0 then
    raise exception 'Nomes el conveni de compravenda te rols (% no en pot tenir)', new.tipo
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.estado in ('firmat', 'vigent', 'retornat', 'resolt', 'substituit') then
    if new.tipo             is distinct from old.tipo
    or new.tipo_org         is distinct from old.tipo_org
    or new.productor_id     is distinct from old.productor_id
    or new.entidad_id       is distinct from old.entidad_id
    or new.plantilla_id     is distinct from old.plantilla_id
    or new.idioma           is distinct from old.idioma
    or new.serie            is distinct from old.serie
    or new.ejercicio        is distinct from old.ejercicio
    or new.numero           is distinct from old.numero
    or new.numero_completo  is distinct from old.numero_completo
    or new.datos_org        is distinct from old.datos_org
    or new.firmante         is distinct from old.firmante
    or new.firmado_at       is distinct from old.firmado_at
    or new.roles_com        is distinct from old.roles_com
    or new.origen           is distinct from old.origen
    or new.referencia_paper is distinct from old.referencia_paper
    or new.declarat_per     is distinct from old.declarat_per
    or new.declarat_at      is distinct from old.declarat_at then
      raise exception 'Un conveni firmat no es pot modificar (%). Retorna''l o substitueix-lo.',
        coalesce(old.numero_completo, old.referencia_paper, old.id::text) using errcode = '42501';
    end if;
  end if;

  if new.estado is distinct from old.estado
     and not (
          (old.estado = 'esborrany'     and new.estado = 'pendent_firma')
       or (old.estado = 'esborrany'     and new.estado = 'vigent' and new.origen in ('paper', 'declarat'))
       or (old.estado = 'pendent_firma' and new.estado in ('firmat', 'esborrany'))
       or (old.estado = 'firmat'        and new.estado in ('vigent', 'retornat'))
       or (old.estado = 'retornat'      and new.estado = 'pendent_firma')
       or (old.estado = 'vigent'        and new.estado in ('resolt', 'substituit'))) then
    raise exception 'Transicio d''estat no permesa en un conveni: % -> %', old.estado, new.estado
      using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. El snapshot del PDF dice de dónde viene el convenio
-- ---------------------------------------------------------------------------
-- Recreada entera desde su versión vigente; solo añade `origen` y, si es declarado,
-- `declaracio` (quién del equipo, cuándo, a quién se atribuye y la referencia). El
-- renderizador pinta con eso la página de evidencias en vez de una firma que no hubo.
create or replace function public.convenio_emet_document(p_conv uuid, p_subtipo text, p_envio jsonb default null)
returns uuid
language plpgsql
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
    'origen',        c.origen,
    'declaracio',    case when c.origen = 'declarat' then jsonb_build_object(
                       'per',        (select coalesce(nullif(btrim(pe.nombre), ''), pe.email)
                                        from perfiles pe where pe.id = c.declarat_per),
                       'data',       c.declarat_at,
                       'signant',    c.firmante->>'nombre',
                       'carrec',     c.firmante->>'cargo',
                       'referencia', c.firmante->>'referencia') end,
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

-- Los privilegios no cambian con `create or replace`, pero se repiten para que el fichero
-- diga por sí solo quién la puede llamar: nadie con sesión, solo las RPC definer.
revoke execute on function public.convenio_emet_document(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. declarar_conveni(): de la ficha a vigente, en una transacción
-- ---------------------------------------------------------------------------
create or replace function public.declarar_conveni(
  p_tipo_org       text,
  p_org            uuid,
  p_tipo           text,
  p_signant_nom    text,
  p_signant_carrec text,
  p_data_firma     date default null,
  p_referencia     text default null,
  p_notes          text default null
) returns convenios
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c        convenios%rowtype;
  par      parametros_documentales%rowtype;
  v_tipo   text;
  v_data   date := coalesce(p_data_firma, (now() at time zone 'Europe/Madrid')::date);
  v_serie  text;
  v_ej     int := extract(year from (now() at time zone 'Europe/Madrid'))::int;
  v_n      int;
  v_falten text[] := '{}';
  v_org    jsonb;
begin
  -- Permiso ANTES que existencia, y con sesión: decide si una organización puede operar sin
  -- haber firmado nada, así que no lo hace un job ni se amplía al equipo (como el papel).
  if auth.uid() is null or not public.es_super_admin() then
    raise exception 'no_autoritzat: nomes el super_admin pot donar per vigent un conveni'
      using errcode = '42501';
  end if;

  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'tipus_org_desconegut' using errcode = '22023';
  end if;
  -- El Conveni de col·laboració de su papel. Los anteriores (don_*, com) ya no tienen
  -- plantilla vigente, así que no se pueden emitir: se niega con un código y no con el
  -- error genérico de `preparar_convenio`.
  v_tipo := case when p_tipo_org = 'productor' then 'col_productor' else 'col_receptor' end;
  if p_tipo is distinct from v_tipo then
    raise exception 'tipus_desconegut: el conveni d''aquest paper es %', v_tipo using errcode = '22023';
  end if;

  if (p_tipo_org = 'productor' and not exists (select 1 from productores where id = p_org))
  or (p_tipo_org = 'entidad'   and not exists (select 1 from entidades   where id = p_org)) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(p_signant_nom, ''))) not between 2 and 120 then
    raise exception 'falta_signant' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_signant_carrec, ''))) not between 2 and 120 then
    raise exception 'falta_carrec' using errcode = '22023';
  end if;
  if v_data > (now() at time zone 'Europe/Madrid')::date then
    raise exception 'data_futura' using errcode = '22023';
  end if;
  if char_length(coalesce(p_referencia, '')) > 120 or char_length(coalesce(p_notes, '')) > 500 then
    raise exception 'text_massa_llarg' using errcode = '22023';
  end if;

  -- Uno vigente del mismo tipo ya está: declarar encima sustituiría un convenio de verdad
  -- (firmado o en papel) por uno sin firma.
  if exists (select 1 from convenios x
              where x.tipo = v_tipo and x.estado = 'vigent'
                and ((p_tipo_org = 'productor' and x.productor_id = p_org)
                  or (p_tipo_org = 'entidad'   and x.entidad_id   = p_org))) then
    raise exception 'ja_vigent: aquesta organitzacio ja te el conveni vigent' using errcode = '22023';
  end if;

  select * into par from parametros_documentales where id = 1;
  if coalesce(btrim(par.apoderada_nombre), '') = '' then
    raise exception 'falta_apoderada: falta l''apoderada als parametres documentals'
      using errcode = '22023';
  end if;

  -- El que haya en marcha, o uno nuevo (idempotente).
  select * into c from public.preparar_convenio(p_tipo_org, p_org, v_tipo) as t;

  if c.estado = 'firmat' then
    -- La organización ya firmó: lo que falta es contrafirmarlo, no declararlo.
    raise exception 'ja_signat: l''organitzacio ja l''ha signat, falta contrasignar-lo'
      using errcode = '22023';
  end if;
  if c.estado = 'retornat' then
    raise exception 'conveni_retornat: torna''l a enviar o resol-lo abans' using errcode = '22023';
  end if;
  if c.estado = 'pendent_firma' then
    -- Había un enlace de firma en marcha: deja de valer, y el convenio vuelve a borrador
    -- (transición permitida) para nacer vigente desde ahí.
    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'convenio' and objeto_id = c.id
       and proposito = 'firma_convenio' and estado = 'activo';
    update convenios set estado = 'esborrany', enlace_id = null where id = c.id returning * into c;
  end if;
  if c.estado <> 'esborrany' then
    raise exception 'estat_inesperat: %', c.estado using errcode = '22023';
  end if;

  -- Los datos mínimos que también exige la firma: sin NIF ni domicilio el convenio no dice
  -- con quién se firma.
  v_org := public.convenio_datos_org(c.id);
  if coalesce(btrim(v_org->>'nif'), '') = '' then v_falten := v_falten || 'nif'; end if;
  if coalesce(btrim(v_org->>'domicili'), '') = '' then v_falten := v_falten || 'domicili'; end if;
  if array_length(v_falten, 1) > 0 then
    raise exception 'falta_dades_fitxa' using errcode = '22023',
      detail = array_to_string(v_falten, ',');
  end if;

  -- El número, DENTRO de esta transacción: si algo falla después, no se consume.
  v_serie := public.convenio_serie(v_tipo);
  v_n := public.siguiente_numero(v_serie, v_ej);

  update convenios
     set estado            = 'vigent',
         origen            = 'declarat',
         datos_org         = v_org,
         firmante          = jsonb_strip_nulls(jsonb_build_object(
                               'nombre',     btrim(p_signant_nom),
                               'cargo',      btrim(p_signant_carrec),
                               'email',      v_org->>'email',
                               'declarat',   true,
                               'referencia', nullif(btrim(p_referencia), ''),
                               'notes',      nullif(btrim(p_notes), ''))),
         serie             = v_serie,
         ejercicio         = v_ej,
         numero            = v_n,
         numero_completo   = public.formato_numero(v_serie, v_ej, v_n),
         -- A mediodía de Madrid: a medianoche, leído en UTC, el día sería el anterior.
         firmado_at        = (v_data + time '12:00') at time zone 'Europe/Madrid',
         contrafirmado_at  = now(),
         contrafirmado_por = auth.uid(),
         declarat_per      = auth.uid(),
         declarat_at       = now()
   where id = c.id
  returning * into c;

  -- El PDF por el camino de siempre (y el correo que lo acompaña, si el correo está encendido
  -- y el destinatario pasa los gates de §8).
  perform public.convenio_emet_document(c.id, 'contrafirmat',
    jsonb_build_object('destinatario', c.firmante->>'email', 'motivo', 'conveni_vigent'));

  raise log 'declarar_conveni: % declara vigent % (%, %)', auth.uid(), c.numero_completo, p_tipo_org, p_org;
  return c;
end;
$$;

revoke execute on function public.declarar_conveni(text, uuid, text, text, text, date, text, text)
  from public, anon, service_role;
grant execute on function public.declarar_conveni(text, uuid, text, text, text, date, text, text)
  to authenticated;

comment on function public.declarar_conveni(text, uuid, text, text, text, date, text, text) is
  'Da por vigente el convenio de colaboración de una organización sin firma ni escaneado, con PDF numerado que lo declara. Solo super_admin (20270430100000).';

-- ---------------------------------------------------------------------------
-- 5. Un declarado no impide firmar el de verdad
-- ---------------------------------------------------------------------------
-- `signar_conveni_propi()` se niega a abrir un convenio si lo vigente ya cubre todo. Con un
-- declarado, la organización TIENE que poder firmar el suyo: la contrafirma lo sustituirá.
create or replace function public.conveni_cobreix_tot(p_tipo_org text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from (select distinct valorizacion from convenios_exigidos) v
     where not exists (
       select 1 from convenios c
        where c.estado = 'vigent'
          and c.origen <> 'declarat'
          and c.organizacion_id = public.organizacion_de(p_tipo_org, p_org)
          and (c.tipo = case when p_tipo_org = 'productor' then 'col_productor' else 'col_receptor' end
               or exists (select 1 from convenis_equivalents eq
                           where eq.tipo_nou = case when p_tipo_org = 'productor' then 'col_productor' else 'col_receptor' end
                             and eq.tipo_antic = c.tipo and eq.valorizacion = v.valorizacion))));
$$;

revoke execute on function public.conveni_cobreix_tot(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. La lectura del ciclo guiado, ampliada
-- ---------------------------------------------------------------------------
-- Recreada entera desde 20270414101100 (vía la definición vigente del clon). Solo AÑADE
-- claves: el origen del convenio (un declarado se pinta distinto) y lo que necesitan las
-- fases 2 y 3 del plan —el interés con modalidad y hora, y el estado de la recogida— para
-- que la pantalla no tenga que adivinar ni volver a consultar. El frontend vigente ignora
-- las claves que no conoce, así que esto es compatible hacia atrás.
create or replace function public.canalitzacio_assistida(p_excedente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  ex  excedentes%rowtype;
  res jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot veure una canalitzacio assistida'
      using errcode = '42501';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null then
    raise exception 'Aquesta oferta no existeix' using errcode = 'PT404';
  end if;

  select jsonb_build_object(
    'oferta', jsonb_build_object(
      'id', ex.id, 'id_excedente', ex.id_excedente, 'estado', ex.estado,
      'modalitat', ex.modalitat, 'producto', ex.producto, 'kg_total', ex.kg_total,
      'preu_minim', ex.preu_minim, 'disponible_hasta', ex.disponible_hasta,
      'origen', ex.origen, 'espigolada_id', ex.espigolada_id,
      'created_at', ex.created_at,
      -- Nueva (opcional): todas las modalidades de la oferta.
      'modalitats', to_jsonb(ex.modalitats)),

    'productor', (select jsonb_build_object('id', p.id,
                           'nom', coalesce(p.empresa, p.name),
                           'email', p.email, 'telefon', p.phone,
                           'organizacion_id', p.organizacion_id)
                    from productores p where p.id = ex.productor_id),

    'conveni_gen', (
      select jsonb_build_object('id', c.id, 'tipo', c.tipo, 'estado', c.estado,
                                'numero', c.numero_completo, 'enviado_at', c.enviado_at,
                                'origen', c.origen)
        from convenios c
        join convenios_exigidos ce
          on (ce.tipo_convenio = c.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce.tipo_convenio and eq.tipo_antic = c.tipo and eq.valorizacion = ex.modalitat)) and ce.valorizacion = ex.modalitat
         and ce.parte = 'entrega'
       where c.productor_id = ex.productor_id
         and c.estado <> 'substituit'
       order by case c.estado when 'vigent' then 0 when 'firmat' then 1
                              when 'pendent_firma' then 2 else 3 end
       limit 1),

    'respostes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'entidad_id', r.entidad_id,
               'entitat', coalesce(e.nombre, '(sense fitxa)'),
               'email', e.email, 'tipo_receptor', e.tipo_receptor,
               'canal', r.canal, 'estado', r.estado, 'aprovacio', r.aprovacio,
               'kg_solicitados', r.kg_solicitados, 'preu_ofert', r.preu_ofert,
               'canalizacion_id', r.canalizacion_id,
               -- Nuevas (27-10-2026): lo que la entidad pidió, igual que en el Mercat.
               'modalitat', r.modalitat, 'caixes_solicitades', r.caixes_solicitades,
               'recollida_at', r.recollida_at, 'kg_aprovats', r.kg_aprovats,
               'telefono', r.telefono, 'enviado_at', r.enviado_at,
               'conveni_rec', (
                 select jsonb_build_object('id', c2.id, 'estado', c2.estado,
                                           'numero', c2.numero_completo, 'tipo', c2.tipo,
                                           'origen', c2.origen)
                   from convenios c2
                   join convenios_exigidos ce2
                     on (ce2.tipo_convenio = c2.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce2.tipo_convenio and eq.tipo_antic = c2.tipo and eq.valorizacion = ex.modalitat)) and ce2.valorizacion = ex.modalitat
                    and ce2.parte = 'recibe'
                  where c2.entidad_id = r.entidad_id and c2.estado <> 'substituit'
                  order by case c2.estado when 'vigent' then 0 when 'firmat' then 1
                                          when 'pendent_firma' then 2 else 3 end
                  limit 1))
               order by r.created_at)
        from oferta_respuestas r
        left join entidades e on e.id = r.entidad_id
       where r.excedente_id = ex.id), '[]'::jsonb),

    'canalitzacions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ca.id, 'entidad_id', ca.entidad_id,
               'entitat', e.nombre,
               'kg_confirmados', ca.kg_confirmados, 'kg_reales', ca.kg_reales,
               'kg_conciliados', ca.kg_conciliados,
               'conciliada_at', ca.conciliada_at, 'coste_kg', ca.coste_kg,
               -- Nueva (opcional): la modalidad de esta entrega.
               'valorizacion', ca.valorizacion,
               -- Nuevas (27-10-2026): la recogida, para el ciclo guiado sin formularios.
               'estado', ca.estado, 'comentarios', ca.comentarios,
               'data_hora_recollida', ca.data_hora_recollida,
               'recollida_registrada_at', ca.recollida_registrada_at,
               'recollida_validada_at', ca.recollida_validada_at,
               'recollida_retornada_at', ca.recollida_retornada_at,
               'kg_declarats', ca.kg_declarats, 'resultat_recollida', ca.resultat_recollida,
               'incidencia', ca.incidencia_recollida is not null,
               'created_at', ca.created_at)
               order by ca.created_at)
        from canalizaciones ca
        left join entidades e on e.id = ca.entidad_id
       where ca.excedente_id = ex.id), '[]'::jsonb),

    'albarans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', al.id, 'tipo', al.tipo, 'estado', al.estado,
               'numero', al.numero_completo, 'canalizacion_id', al.canalizacion_id,
               'emitido_at', al.emitido_at, 'entregado_at', al.entregado_at,
               'confirmado_at', al.confirmado_at, 'conciliado_at', al.conciliado_at,
               'rechazo', al.rechazo,
               -- Nueva (27-10-2026): un REC confirmado fuera de tolerancia no se concilia solo.
               'fora_tolerancia', case when al.tipo = 'REC' and al.estado = 'confirmado'
                                       then not coalesce((public.propuesta_conciliacion(al.id)->>'dins_tolerancia')::boolean, true) end)
               order by al.tipo, al.created_at)
        from albaranes al
       where al.excedente_id = ex.id
          or al.canalizacion_id in (select id from canalizaciones where excedente_id = ex.id)
          or (ex.espigolada_id is not null and al.espigolada_id = ex.espigolada_id)),
      '[]'::jsonb),

    'cost_falten', (
      select count(*) from (select distinct ex.producto as prod) x
       where ex.coste_kg is null
         and not exists (select 1 from costes_producto cp where cp.producto = x.prod)),

    -- El real antes que cualquier prueba (como siempre); entre pruebas, el último
    -- calculado y, si ninguno lo está, el más reciente. Antes no había desempate.
    'exercici', (
      select jsonb_build_object('id', ce3.id, 'ejercicio', ce3.ejercicio,
                                'modo', ce3.modo, 'estado', ce3.estado)
        from cierres_ejercicio ce3
       where ce3.ejercicio = extract(year from coalesce(ex.created_at, now()))::int
       order by case ce3.modo when 'real' then 0 else 1 end,
                ce3.calculado_at desc nulls last,
                ce3.created_at desc,
                ce3.id
       limit 1)
  ) into res;

  return res;
end;
$function$;
