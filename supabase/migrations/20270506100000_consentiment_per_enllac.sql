-- Consentimiento RGPD pedido por correo, y la lista de correos que lo han dado (04-11-2026).
--
-- POR QUÉ. Hasta aquí solo había consentimiento si la persona se registraba en `/registre`.
-- Una entidad que da de alta el equipo («Nova entitat», el ARA 2026) no tenía ninguno, y la
-- única vía para «tenerlo» era que el equipo lo declarase en su nombre (`alta_assistida`),
-- que es justo lo que no vale: el consentimiento lo da la persona, con una acción suya.
-- Ahora el equipo le manda un enlace por correo; la persona abre `/consentiment/:token`, lee
-- la política y marca lo que quiere. Hasta que lo hace, no consta nada.
--
-- QUÉ CAMBIA
--   · `consentiments` admite filas sin cuenta (`user_id` nulo) cuando vienen de un enlace
--     (`origen = 'enllac'`): quedan atadas a la organización, al correo al que se envió el
--     enlace y al propio enlace (`enlace_id`). Sigue siendo solo inserción.
--   · `v_consentiments_vigents` agrupa por persona: la cuenta, o (sin cuenta) la
--     organización y el correo. Suma la columna `email` al final.
--   · `enlaces_token` gana el propósito `consentiment_rgpd` sobre `organizacion`.
--   · RPC `demanar_consentiment(org, email)` (equipo): acuña el enlace y revoca el anterior.
--   · RPC `registrar_consentiment_enllac(...)` (solo `service_role`, la usa
--     `enlace-publico`): guarda las tres respuestas con la huella del texto que compuso el
--     servidor, deja la evidencia y gasta el enlace.
--   · RPC `llista_consentiments()` (equipo): el estado vigente de cada persona con su
--     correo y su organización, para exportar la lista (cierra la deuda §12.142).
--
-- ⚠️ NO CONDICIONA NINGÚN ENVÍO OPERATIVO (mismo aviso que 20270429100100): los avisos del
--    servicio los gobiernan los interruptores de Configuració, no estas casillas.

-- 1 · consentiments ----------------------------------------------------------------------
alter table public.consentiments alter column user_id drop not null;
alter table public.consentiments
  add column if not exists email     text,
  add column if not exists enlace_id uuid references public.enlaces_token (id) on delete set null;

alter table public.consentiments drop constraint if exists consentiments_origen_check;
alter table public.consentiments add constraint consentiments_origen_check
  check (origen in ('registre', 'alta_assistida', 'enllac'));

-- Sin cuenta solo se entra por un enlace, y entonces el correo es quien consintió. La
-- organización puede faltar más adelante (borrar la ficha la pone a null): el correo no.
alter table public.consentiments drop constraint if exists consentiments_titular;
alter table public.consentiments add constraint consentiments_titular
  check (user_id is not null or (origen = 'enllac' and email is not null));

create index if not exists consentiments_org_idx
  on public.consentiments (organizacion_id, tipus, created_at desc);

comment on column public.consentiments.email is
  'Correo al que se envió el enlace de consentimiento (origen enllac). Nulo en las filas con cuenta.';
comment on column public.consentiments.enlace_id is
  'El enlace con el que se dio (origen enllac).';

-- 2 · la vista vigente, por persona --------------------------------------------------------
create or replace view public.v_consentiments_vigents
with (security_invoker = true) as
select distinct on (coalesce(c.user_id::text,
                             'enllac:' || coalesce(c.organizacion_id::text, '') || ':' || lower(c.email)),
                    c.tipus)
       c.user_id, c.organizacion_id, c.tipus, c.valor, c.versio_text, c.origen, c.registrat_per,
       c.created_at, c.email
  from public.consentiments c
 order by coalesce(c.user_id::text,
                   'enllac:' || coalesce(c.organizacion_id::text, '') || ':' || lower(c.email)),
          c.tipus, c.created_at desc;

revoke all on public.v_consentiments_vigents from public, anon, authenticated;
grant select on public.v_consentiments_vigents to authenticated, service_role;

-- 3 · enlaces_token: el propósito nuevo ----------------------------------------------------
alter table public.enlaces_token drop constraint if exists enlaces_token_proposito_check;
alter table public.enlaces_token add constraint enlaces_token_proposito_check
  check (proposito in ('firma_convenio', 'confirmacion_albaran', 'subida_factura', 'consentiment_rgpd'));
alter table public.enlaces_token drop constraint if exists enlaces_token_objeto_tipo_check;
alter table public.enlaces_token add constraint enlaces_token_objeto_tipo_check
  check (objeto_tipo in ('albaran', 'convenio', 'cierre_donante', 'organizacion'));

-- 4 · demanar_consentiment -----------------------------------------------------------------
create or replace function public.demanar_consentiment(p_org uuid, p_email text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existeix boolean;
  v_mail     text;
  v_nom      text;
  v_dies     integer;
  v_token    text;
  v_id       uuid;
  v_caduca   timestamptz;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot demanar el consentiment' using errcode = '42501';
  end if;

  select true,
         coalesce(nullif(btrim(p_email), ''), nullif(btrim(p.email), ''), nullif(btrim(e.email), '')),
         coalesce(nullif(btrim(p.razon_social), ''), nullif(btrim(e.razon_social), ''),
                  nullif(btrim(p.empresa), ''), nullif(btrim(e.nombre), ''), nullif(btrim(p.name), ''))
    into v_existeix, v_mail, v_nom
    from organizaciones o
    left join productores p on p.organizacion_id = o.id
    left join entidades   e on e.organizacion_id = o.id
   where o.id = p_org
   limit 1;
  if v_existeix is null then
    raise exception 'organitzacio_desconeguda' using errcode = '22023';
  end if;
  if v_mail is null or v_mail !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'sense_correu' using errcode = '22023';
  end if;

  -- Uno vivo por organización: el nuevo revoca el anterior.
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'organizacion' and objeto_id = p_org
     and proposito = 'consentiment_rgpd' and estado = 'activo';

  select coalesce(caducidad_enlace_dias, 30) into v_dies from parametros_documentales where id = 1;
  v_caduca := now() + make_interval(days => coalesce(v_dies, 30));

  -- Misma fábrica de token que `enviar_convenio` (20261012100500): 32 bytes en base64url.
  v_token := rtrim(translate(
    encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                             clock_timestamp()::text, 'UTF8')), 'base64'),
    '+/', '-_'), '=');

  insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                             destinatario_email, destinatario_nombre,
                             token_hash, caduca_at, creado_por)
  values ('consentiment_rgpd', 'organizacion', p_org, v_mail, v_nom,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_caduca, auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'destinatari', v_mail,
                            'nom', v_nom, 'caduca_at', v_caduca);
end;
$$;

revoke execute on function public.demanar_consentiment(uuid, text) from public, anon;
grant execute on function public.demanar_consentiment(uuid, text) to authenticated, service_role;

comment on function public.demanar_consentiment(uuid, text) is
  'Equipo: acuña el enlace de consentimiento RGPD de una organización (revoca el anterior) y '
  'devuelve el token en claro para mandarlo por correo. No registra ningún consentimiento.';

-- 5 · registrar_consentiment_enllac --------------------------------------------------------
-- `p_respostes`: [{tipus, valor, sha256}] con los tres tipos. Los textos y sus huellas los
-- compone `enlace-publico` desde `_shared/textosRgpd.ts`, nunca el navegador.
create or replace function public.registrar_consentiment_enllac(
  p_token_hash text,
  p_respostes  jsonb,
  p_versio     text,
  p_idioma     text,
  p_ip         inet default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e       enlaces_token%rowtype;
  r       jsonb;
  v_org   uuid;
  v_tipus text[] := '{}';
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor pot registrar un consentiment' using errcode = '42501';
  end if;

  select * into e from enlaces_token where token_hash = p_token_hash for update;
  if e.id is null then
    raise exception 'desconegut' using errcode = 'PT404';
  end if;
  if e.proposito <> 'consentiment_rgpd' or e.objeto_tipo <> 'organizacion' then
    raise exception 'proposit_incorrecte' using errcode = '22023';
  end if;
  if e.estado <> 'activo' or e.usado_at is not null then
    raise exception 'ja_usat' using errcode = 'PT409';
  end if;
  if e.caduca_at < now() then
    raise exception 'caducat' using errcode = 'PT410';
  end if;

  if jsonb_typeof(p_respostes) <> 'array' or jsonb_array_length(p_respostes) <> 3 then
    raise exception 'dades_invalides' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_respostes) loop
    if r->>'tipus' not in ('privacitat', 'comunicacions_plataforma', 'comunicacions_espigoladors')
       or jsonb_typeof(r->'valor') <> 'boolean'
       or coalesce(r->>'sha256', '') !~ '^[0-9a-f]{64}$'
       or r->>'tipus' = any (v_tipus) then
      raise exception 'dades_invalides' using errcode = '22023';
    end if;
    if r->>'tipus' = 'privacitat' and not (r->>'valor')::boolean then
      raise exception 'falta_acceptacio' using errcode = '22023';
    end if;
    v_tipus := v_tipus || (r->>'tipus');
  end loop;

  -- La organización puede haberse borrado mientras el enlace estaba vivo.
  select id into v_org from organizaciones where id = e.objeto_id;

  insert into consentiments (user_id, organizacion_id, tipus, valor, versio_text, sha256_text,
                             idioma, origen, email, enlace_id, ip, user_agent)
  select null, v_org, x->>'tipus', (x->>'valor')::boolean, p_versio, x->>'sha256',
         case when p_idioma = 'es' then 'es' else 'ca' end, 'enllac', e.destinatario_email,
         e.id, p_ip, p_user_agent
    from jsonb_array_elements(p_respostes) x;

  insert into evidencias (enlace_id, tipo, nombre, ip, user_agent, sha256_texto, payload)
  values (e.id, 'confirmacion', e.destinatario_nombre, p_ip, p_user_agent,
          (select x->>'sha256' from jsonb_array_elements(p_respostes) x where x->>'tipus' = 'privacitat'),
          jsonb_build_object('consentiments', p_respostes, 'versio', p_versio, 'idioma', p_idioma));

  update enlaces_token set usado_at = now(), estado = 'usado' where id = e.id;

  return jsonb_build_object('ok', true, 'organizacion_id', v_org);
end;
$$;

revoke execute on function public.registrar_consentiment_enllac(text, jsonb, text, text, inet, text)
  from public, anon, authenticated;
grant execute on function public.registrar_consentiment_enllac(text, jsonb, text, text, inet, text)
  to service_role;

comment on function public.registrar_consentiment_enllac(text, jsonb, text, text, inet, text) is
  'Solo service_role (enlace-publico): guarda los tres consentimientos que da la persona desde '
  'el enlace, con la huella del texto del servidor, deja la evidencia y gasta el enlace.';

-- 6 · llista_consentiments ------------------------------------------------------------------
-- Una fila por persona y tipo, el valor vigente. El correo de una cuenta es el de su login.
create or replace function public.llista_consentiments()
returns table (
  organizacion_id uuid,
  entitat         text,
  es_generadora   boolean,
  es_receptora    boolean,
  email           text,
  tipus           text,
  valor           boolean,
  origen          text,
  versio_text     text,
  created_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot veure els consentiments' using errcode = '42501';
  end if;

  return query
  select v.organizacion_id,
         coalesce(o.nom_comercial, o.razon_social, o.nombre),
         coalesce(o.es_generadora, false),
         coalesce(o.es_receptora, false),
         coalesce(v.email, u.email::text),
         v.tipus, v.valor, v.origen, v.versio_text, v.created_at
    from v_consentiments_vigents v
    left join auth.users u on u.id = v.user_id
    left join v_organizaciones o on o.id = v.organizacion_id
   order by 2 nulls last, 5, v.tipus;
end;
$$;

revoke execute on function public.llista_consentiments() from public, anon;
grant execute on function public.llista_consentiments() to authenticated, service_role;

comment on function public.llista_consentiments() is
  'Equipo: el consentimiento vigente de cada persona (cuenta o enlace) con su correo y su '
  'organización, para exportar la lista de comunicaciones.';
