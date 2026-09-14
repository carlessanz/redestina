-- Lo que una organización tiene PENDIENTE, y poder hacerlo desde su panel.
--
-- EL PROBLEMA. Un productor o una entidad ya puede ver y descargar sus documentos
-- (`documents_meus()` cubre albaranes, convenios, planes y cierres), pero no tiene forma de
-- saber que le falta firmar un convenio o confirmar un albarán: `enlaces_token` es visible
-- solo para el equipo (20260928100300), y el único camino para firmar es el enlace que le
-- llegó por correo. Si ese correo se perdió, caducó o nunca llegó, no hay nada que hacer
-- desde dentro de la aplicación: el banner del panel dice «t'ho hem enviat per correu» y
-- ahí se acaba.
--
-- LO QUE AÑADE ESTA MIGRACIÓN, y por qué son dos funciones y no una:
--   · `pendents_meus()`  — QUÉ tengo pendiente. Lectura, sin token.
--   · `acunar_enllac_propi()` — acuña un enlace PARA MÍ y devuelve su token en claro, que
--     es la única vez que ese token existe. El frontend navega a `/signar/<token>` o
--     `/confirmar/<token>`, las páginas públicas que ya existen: mismo texto compuesto por
--     el servidor, mismo hash de lo firmado, misma evidencia. No hay un segundo circuito de
--     firma, que sería un segundo sitio donde equivocarse.
--
-- POR QUÉ UNA RPC Y NO UNA POLÍTICA RLS SOBRE `enlaces_token`. Una política no puede
-- calcular `estado_efectivo` —la caducidad no se guarda, se calcula (20260928100300)— así
-- que el panel tendría que deducirla con el reloj del navegador, justo lo que esa decisión
-- evita. Y abriría la tabla entera: el `destinatario_email` de la OTRA parte de un OPE, los
-- enlaces de subida de factura, los contadores de recordatorios. Aquí se devuelve lo que el
-- panel necesita y nada más.
--
-- LO PENDIENTE LO DICE EL ESTADO DEL OBJETO, NO EL DEL ENLACE. Un convenio en
-- `pendent_firma` está pendiente aunque su enlace haya caducado; y como el botón acuña uno
-- nuevo, el enlace viejo deja de importar. El último se devuelve solo como información
-- («te lo mandamos por correo el día X»).

-- ---------------------------------------------------------------------------
-- 1. `enlaces_token.canal` admite 'panel'
-- ---------------------------------------------------------------------------
-- `email` (se manda), `asistido` (lo abre el dinamizador delante de la persona) y ahora
-- `panel` (lo acuña el propio titular con su sesión). El canal se imprime en la página de
-- evidencias del PDF, así que distinguirlos no es cosmética: dice cómo se firmó.
--
-- El nombre del check se resuelve leyendo `pg_constraint` en vez de darlo por hecho: si la
-- tabla se creó con otro nombre, un `drop constraint if exists` con el nombre equivocado no
-- haría nada y el `add` fallaría por duplicado.
do $$
declare
  v_nombre text;
begin
  select con.conname into v_nombre
    from pg_constraint con
   where con.conrelid = 'public.enlaces_token'::regclass
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%canal%'
     and pg_get_constraintdef(con.oid) ilike '%asistido%'
   limit 1;
  if v_nombre is not null then
    execute format('alter table enlaces_token drop constraint %I', v_nombre);
  end if;
end $$;

alter table enlaces_token
  add constraint enlaces_token_canal_check
  check (canal in ('email', 'asistido', 'panel'));

comment on column enlaces_token.canal is
  'email: se manda por correo. asistido: lo abre el dinamizador delante de la persona. panel: lo acuña el propio titular desde su panel con sesión (acunar_enllac_propi), y caduca en 1 hora.';

-- ---------------------------------------------------------------------------
-- 2. generar_token_enlace(): la aleatoriedad, en un solo sitio
-- ---------------------------------------------------------------------------
-- Mismo cálculo que `marcar_entregado()`, `enviar_convenio()` e `iniciar_firma_asistida()`,
-- que conservan cada una su copia porque están en migraciones aplicadas y esas no se
-- editan. A partir de aquí, lo nuevo usa esta.
--
-- ⚠️ NO se usa `gen_random_bytes()` de pgcrypto: en Supabase vive en el esquema
--    `extensions` y las `security definer` llevan `search_path = public, pg_temp`, así que
--    la llamada fallaría con 42883. La entropía sale de dos `gen_random_uuid()` más el
--    reloj —244 bits—, resumidos con `sha256()`; los dos son built-in de Postgres.
create or replace function public.generar_token_enlace(out token text, out token_hash text)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  token := rtrim(translate(
    encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                             clock_timestamp()::text, 'UTF8')), 'base64'),
    '+/', '-_'), '=');
  token_hash := encode(sha256(convert_to(token, 'UTF8')), 'hex');
end;
$$;

-- No es `security definer`: la llaman funciones que ya lo son, y se ejecuta con sus
-- privilegios. Nadie más tiene por qué poder acuñar un token suelto.
revoke execute on function public.generar_token_enlace() from public, anon, authenticated;
grant  execute on function public.generar_token_enlace() to service_role;

comment on function public.generar_token_enlace() is
  'Token de 32 bytes en base64url y su sha256. Solo para uso interno de las RPC que crean enlaces.';

-- ---------------------------------------------------------------------------
-- 3. pendents_meus(): qué tengo pendiente de firmar o confirmar
-- ---------------------------------------------------------------------------
-- Sin parámetro `p_user`: esto es siempre «lo mío». Las funciones puente lo aceptan porque
-- `service_role` necesita preguntar por un tercero al generar documentos; aquí no hay
-- ningún caso así, y no tenerlo es una guarda menos que se puede escribir mal.
--
-- NUNCA devuelve `token_hash` ni `codigo_hash`. El token en claro solo existe en el momento
-- de acuñarlo (punto 4) y en el correo.
create or replace function public.pendents_meus()
returns table (
  proposito               text,
  objeto_tipo             text,
  objeto_id               uuid,
  tipo_org                text,
  org_id                  uuid,
  rol_parte               text,
  numero                  text,
  etiqueta                text,
  tipus                   text,
  estat_objecte           text,
  motiu                   text,
  ejercicio               int,
  enlace_id               uuid,
  enlace_estado_efectivo  text,
  enlace_caduca_at        timestamptz,
  enlace_canal            text,
  enlace_created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;

  return query
  with meves as (
    select m.productor_id, m.entidad_id
      from membresias m
      join perfiles p on p.id = m.user_id
     where m.user_id = v_user and m.activo and p.activo
  ),
  pendents as (
    -- Convenios: `pendent_firma` y `retornat` son los dos estados en los que la pelota
    -- está en el tejado de la organización (mismo criterio que `conveni_pendent`).
    select 'firma_convenio'::text          as proposito,
           'convenio'::text                as objeto_tipo,
           c.id                            as objeto_id,
           c.tipo_org                      as tipo_org,
           coalesce(c.productor_id, c.entidad_id) as org_id,
           null::text                      as rol_parte,
           c.numero_completo               as numero,
           null::text                      as etiqueta,
           c.tipo                          as tipus,
           c.estado                        as estat_objecte,
           c.motivo_devolucion             as motiu,
           c.ejercicio                     as ejercicio
      from convenios c
     where c.estado in ('pendent_firma', 'retornat')
       and (c.productor_id in (select productor_id from meves where productor_id is not null)
         or c.entidad_id   in (select entidad_id   from meves where entidad_id   is not null))
    union all
    -- Albaranes entregados y sin confirmar. La parte se resuelve como en
    -- `marcar_entregado()`: REC y OPE los entrega el generador, ENT y OPE los recibe la
    -- entidad. En un OPE donde la cuenta tenga las dos fichas salen dos filas, y es lo
    -- correcto: son dos confirmaciones distintas.
    select 'confirmacion_albaran'::text,
           'albaran'::text,
           a.id,
           part.tipo_org,
           part.org_id,
           part.rol,
           a.numero_completo,
           (select string_agg(distinct l.producto, ', ') from albaran_lineas l where l.albaran_id = a.id),
           a.tipo,
           a.estado,
           null::text,
           a.ejercicio
      from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
      left join excedentes     e on e.id = a.excedente_id
      left join espigoladas   es on es.id = a.espigolada_id
      cross join lateral (
        select 'productor'::text as tipo_org,
               coalesce(e.productor_id, es.productor_id) as org_id,
               'entrega'::text as rol
         where a.tipo in ('REC', 'OPE')
           and coalesce(e.productor_id, es.productor_id)
               in (select productor_id from meves where productor_id is not null)
        union all
        select 'entidad', c.entidad_id, 'recibe'
         where a.tipo in ('ENT', 'OPE')
           and c.entidad_id in (select entidad_id from meves where entidad_id is not null)
      ) part
     where a.estado = 'entregado'
  )
  select p.proposito, p.objeto_tipo, p.objeto_id, p.tipo_org, p.org_id, p.rol_parte,
         p.numero, p.etiqueta, p.tipus, p.estat_objecte, p.motiu, p.ejercicio,
         en.id, en.estado_efectivo, en.caduca_at, en.canal, en.created_at
    from pendents p
    left join lateral (
      select e.id,
             case
               when e.estado <> 'activo'   then e.estado
               when e.usado_at is not null then 'usado'
               when e.caduca_at < now()    then 'caducado'
               else 'activo'
             end as estado_efectivo,
             e.caduca_at, e.canal, e.created_at
        from enlaces_token e
       where e.objeto_tipo = p.objeto_tipo
         and e.objeto_id   = p.objeto_id
         and e.proposito   = p.proposito
         and (p.rol_parte is null or e.rol_parte is null or e.rol_parte = p.rol_parte)
       order by e.created_at desc
       limit 1
    ) en on true
   order by p.objeto_tipo, p.ejercicio desc nulls last, p.numero nulls last;
end;
$$;

revoke execute on function public.pendents_meus() from public, anon;
grant  execute on function public.pendents_meus() to authenticated, service_role;

comment on function public.pendents_meus() is
  'Lo que las organizaciones de la cuenta tienen pendiente de firmar o confirmar, con el estado efectivo del último enlace. Nunca devuelve el token ni su hash.';

-- ---------------------------------------------------------------------------
-- 4. acunar_enllac_propi(): firmar o confirmar desde el panel
-- ---------------------------------------------------------------------------
-- Devuelve `jsonb` porque devuelve **el token en claro**, que es la única vez que existe
-- (en la base solo queda su sha256). Mismo razonamiento que `enviar_convenio()` y
-- `marcar_entregado()`.
--
-- ACUÑAR REVOCA EL ANTERIOR, como en `enviar_convenio()`. Dos enlaces vivos sobre el mismo
-- convenio son dos firmas posibles y la segunda no tendría dónde ir. El precio, sabido: el
-- enlace que la persona tiene en su correo deja de valer. Es aceptable porque quien acuña
-- es esa misma persona y lo va a usar ahora mismo; y si lo pierde, el panel le da otro.
--
-- CADUCA EN 1 HORA, no en 30 días. Se consume al instante —el frontend navega con él— pero
-- la firma se comprueba en el POST, y leer un convenio entero y rellenar sus campos puede
-- pasar de un cuarto de hora. Una hora cubre eso y deja una ventana pequeña si la URL se
-- queda en el historial del navegador.
--
-- EL EQUIPO NO ACUÑA AQUÍ (42501), y `service_role` tampoco tiene EXECUTE. Un enlace
-- «propio» es el de quien tiene la sesión; para lo demás están `enviar_convenio()`,
-- `iniciar_firma_asistida()` y `marcar_entregado()`. Conceder un GRANT que siempre va a
-- fallar es peor que no tenerlo: el día que una Edge Function la llamara, el error
-- parecería de permisos de datos y no lo sería (§4bis).
create or replace function public.acunar_enllac_propi(
  p_proposito   text,
  p_objeto_tipo text,
  p_objeto_id   uuid,
  p_rol_parte   text default null
) returns jsonb
language plpgsql
volatile
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
  end if;

  raise exception 'Proposit no admes des del panell: %', p_proposito using errcode = '22023';
end;
$$;

revoke execute on function public.acunar_enllac_propi(text, text, uuid, text) from public, anon;
grant  execute on function public.acunar_enllac_propi(text, text, uuid, text) to authenticated;

comment on function public.acunar_enllac_propi(text, text, uuid, text) is
  'Acuña un enlace (canal panel, 1 h) para que el propio titular firme o confirme desde su panel. Devuelve el token en claro. Solo authenticated: el equipo usa enviar_convenio/marcar_entregado.';

-- ---------------------------------------------------------------------------
-- Verificación (manual, tras aplicar)
-- ---------------------------------------------------------------------------
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.enlaces_token'::regclass and contype = 'c';
--   select has_function_privilege('authenticated','public.acunar_enllac_propi(text,text,uuid,text)','EXECUTE');  -- t
--   select has_function_privilege('service_role','public.acunar_enllac_propi(text,text,uuid,text)','EXECUTE');   -- f
--   select has_function_privilege('authenticated','public.generar_token_enlace()','EXECUTE');                     -- f
--   select has_column_privilege('authenticated','public.enlaces_token','token_hash','SELECT');                    -- f
