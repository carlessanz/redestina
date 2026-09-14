-- `firmar_convenio_por_enlace()` acepta la evidencia por la puerta: `p_evidencia.payload`.
-- Cierra la deuda §12.96.
--
-- QUÉ PASABA. La RPC lee `p_evidencia` con una **lista fija de claves** —nombre, cargo,
-- documento_identidad, declaracion_representacion, trazo_firma_ruta, ip, user_agent,
-- sha256_texto, asistido_por— y guarda como `evidencias.payload` **`p_datos` entero**,
-- que es el bloque de datos de la ORGANIZACIÓN. O sea que quien quisiera dejar constancia
-- de algo que no cabe en esa lista no tenía dónde ponerlo… salvo colándolo en `p_datos`.
-- Y eso es exactamente lo que hace hoy `enlace-publico` con la firma desde el panel
-- (`canal = 'panel'`, 20270318100000): manda `p_datos.panell = {user_id, email}` sabiendo
-- que `datos_org` se compone con claves explícitas y que esa clave de más acabará solo en
-- `evidencias.payload`. Funciona, pero por un rodeo: el dato correcto llega al sitio
-- correcto porque otra función no lo mira, no porque haya una puerta.
--
-- EL CAMBIO, y es todo lo que cambia: `evidencias.payload` pasa a ser
--
--     coalesce(p_datos, '{}') || (p_evidencia->'payload')     -- cuando esa clave es un objeto
--     coalesce(p_datos, '{}')                                 -- si no viene, como hasta hoy
--
-- QUÉ GANA SI LAS DOS TRAEN LA MISMA CLAVE: **gana `p_evidencia.payload`**, y el motivo no
-- es de estilo. `p_datos` es lo que la persona TECLEÓ —llega del cuerpo de una petición
-- pública, sin sesión— y `p_evidencia` es lo que el SERVIDOR observó: la IP, el
-- user-agent, la huella del texto que compuso él mismo, la cuenta que acuñó el enlace
-- leída de `enlaces_token` y no del cuerpo. En una tabla de evidencias, la palabra del
-- servidor manda sobre la del navegador. El orden del `||` de jsonb lo dice: el operando
-- derecho pisa al izquierdo.
--
-- POR QUÉ SE CONSERVA `p_datos` DENTRO DEL PAYLOAD en vez de sustituirlo: porque lo que
-- la persona tecleó **es evidencia**. Es el NIF y el domicilio que declaró al firmar, y
-- la huella `sha256_texto` no los cubre (solo cubre el articulado, §9). Si el payload
-- pasara a ser únicamente `p_evidencia->'payload'`, cada firma anterior y cada firma
-- nueva dirían cosas distintas sobre el mismo hecho, y se perdería el único sitio donde
-- queda lo declarado.
--
-- ⚠️ `jsonb_typeof(...) = 'object'`, y hace falta: `'{"a":1}'::jsonb || '"x"'::jsonb` **no
--    da error**, da el array `[{"a":1},"x"]`. Un payload que no sea un objeto convertiría
--    la evidencia en una lista y nadie se enteraría hasta leerla. Si no es un objeto, se
--    ignora y queda el comportamiento de siempre.
--
-- ⚠️ `datos_org` NO CAMBIA, y es la mitad de por qué esto es seguro. Se sigue componiendo
--    con claves explícitas (`raso_social`, `nif`, `domicili`, `codi_postal`, `poblacio`,
--    `representant`, `carrec`, `email`, `nom_comercial`), así que una clave de más —venga
--    por `p_datos` o por el payload— no puede acabar en el snapshot congelado del
--    convenio ni, por tanto, en el PDF.
--
-- ⚠️ `asistido_por` SIGUE SIGNIFICANDO LO MISMO: «alguien del equipo condujo la firma».
--    Una firma hecha desde el panel por su propio titular **no** va ahí, y esta migración
--    no cambia eso: sigue leyéndose de `p_evidencia->>'asistido_por'`, que `enlace-publico`
--    solo rellena cuando el enlace es `canal = 'asistido'`. Decir «firma asistida» de una
--    firma propia sería afirmar algo falso en un documento legal.
--
-- ⚠️ COMPATIBLE HACIA ATRÁS, a propósito: sin `p_evidencia.payload` el resultado es byte a
--    byte el de hoy, así que esta migración se puede aplicar **antes** de tocar
--    `enlace-publico` y nada cambia hasta que se toque. Lo que le tocaría a esa función
--    después es mover `panell` de `p_datos` a `p_evidencia.payload`; mientras no se haga,
--    el rodeo sigue funcionando igual.
--
-- ⚠️ Es una migración NUEVA porque `20270111100100` está aplicada y no se edita (§7). Se
--    copia el cuerpo entero: `create or replace` lo reescribe todo, incluidos `volatile`,
--    `security definer` y el `search_path`, que se repiten. Y se repite el
--    `revoke`/`grant`: **solo `service_role`**, porque quien firma no tiene sesión y lo
--    que autoriza es el token; si `authenticated` pudiera llamarla, cualquier cuenta
--    podría firmar un convenio ajeno conociendo el uuid de su enlace —que el equipo sí
--    lee—.

-- ---------------------------------------------------------------------------
-- El cuerpo, copiado entero de 20270111100100 con su prosa
-- ---------------------------------------------------------------------------
-- ⚠️ La prosa de abajo viene con la función a propósito. Recrear una función y dejar sus
--    comentarios en la migración vieja es lo que pasó con `cierre_base_periodo()` y lo
--    que hizo que quien leía el SQL vigente no encontrara la advertencia que importaba
--    (deuda §12.90). Lo único que cambia respecto de 20270111100100 es `evidencias.payload`.

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
--                   trazo_firma_ruta, ip, user_agent, sha256_texto, asistido_por,
--                   payload }   ← `payload` es lo nuevo de esta migración
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
  --
  -- `payload` = lo que la persona tecleó (`p_datos`) MÁS lo que el servidor quiera dejar
  -- constancia (`p_evidencia.payload`), y en caso de choque manda el segundo (ver
  -- cabecera). El `jsonb_typeof` evita que un payload que no sea objeto convierta la
  -- evidencia en un array, que es lo que haría `||` sin quejarse.
  insert into evidencias (enlace_id, tipo, nombre, cargo, documento_identidad,
                          declaracion_representacion, trazo_firma_ruta,
                          ip, user_agent, sha256_texto, payload, asistido_por)
  values (en.id, 'firma',
          p_evidencia->>'nombre', p_evidencia->>'cargo', p_evidencia->>'documento_identidad',
          true, p_evidencia->>'trazo_firma_ruta',
          nullif(p_evidencia->>'ip', '')::inet, p_evidencia->>'user_agent',
          p_evidencia->>'sha256_texto',
          case when jsonb_typeof(p_evidencia->'payload') = 'object'
               then coalesce(p_datos, '{}'::jsonb) || (p_evidencia->'payload')
               else coalesce(p_datos, '{}'::jsonb)
          end,
          nullif(p_evidencia->>'asistido_por', '')::uuid);

  update enlaces_token set usado_at = now(), estado = 'usado' where id = en.id;

  -- Y el documento firmado (todavía sin el sello de Espigoladors: eso es la contrafirma).
  perform public.convenio_emet_document(c.id, 'firmat',
    jsonb_build_object('destinatario', en.destinatario_email,
                       'motivo', 'conveni_firmat'));

  return c;
end;
$$;

comment on function public.firmar_convenio_por_enlace(uuid, jsonb, jsonb) is
  'Registra la firma de un convenio por enlace (solo service_role). evidencias.payload = p_datos + p_evidencia.payload, y en caso de choque manda el segundo.';

-- EXECUTE: `create or replace` conserva los privilegios, pero se repiten para que este
-- fichero diga por sí solo quién la puede ejecutar.
revoke execute on function public.firmar_convenio_por_enlace(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant  execute on function public.firmar_convenio_por_enlace(uuid, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
-- 1. Sigue sin poder llamarla nadie con sesión:
--   select has_function_privilege('authenticated',
--     'public.firmar_convenio_por_enlace(uuid,jsonb,jsonb)','EXECUTE');   -- f
--
-- 2. La regla del payload, sin tocar la base (es aritmética de jsonb):
--   select coalesce('{"nif":"A1","panell":{"user_id":"del navegador"}}'::jsonb, '{}')
--          || '{"panell":{"user_id":"del servidor"}}'::jsonb;
--   -- {"nif": "A1", "panell": {"user_id": "del servidor"}}   ← gana el servidor
--   select jsonb_typeof('"no soc un objecte"'::jsonb) = 'object';   -- f → se ignora
--
-- 3. Y que una firma real sigue dejando lo declarado en la evidencia (con service_role,
--    tras firmar un convenio de prueba):
--   select tipo, payload from evidencias order by created_at desc limit 1;
