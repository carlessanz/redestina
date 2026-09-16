-- ---------------------------------------------------------------------------
-- El titular puede firmar su convenio desde el panel, sin esperar a que se lo manden
-- ---------------------------------------------------------------------------
-- QUÉ FALTABA, Y DÓNDE SE VEÍA. `AvisConveni` pinta «Encara no tens el conveni de
-- col·laboració signat» en cuanto la organización no tiene uno vigente, y hasta hoy ese
-- aviso **no llevaba ninguna acción** salvo cuando el convenio ya estaba en
-- `pendent_firma` o `retornat` — o sea, salvo cuando el equipo se lo había enviado por
-- correo. El caso normal de una organización que acaba de registrarse es justo el otro:
-- `registro` le prepara el borrador (`prepararConveni`) y ahí se queda, en `esborrany`,
-- porque el frontend no manda `firmar_ara`. Resultado: la persona lee que le falta el
-- convenio, no puede hacer nada, y el panel le bloquea publicar en cuanto pase la fecha
-- de corte. Pedido por el cliente el 16-09-2026: «posa la opció de signar-lo, amb un
-- botó directe».
--
-- POR QUÉ NO BASTABA `acunar_enllac_propi()`. Esa RPC (20270318100000) acuña el enlace de
-- firma desde el panel, pero **excluye `esborrany` a propósito**: «el equipo prepara y
-- envía, el panel solo firma lo enviado». Esa frase describía el circuito asistido, que
-- sigue existiendo; lo que no contemplaba es el alta self-service, donde no hay nadie a
-- quien esperar. Se conserva tal cual —no se toca— y lo que se añade es una entrada
-- distinta para un caso distinto.
--
-- ⚠️ NO HAY UN SEGUNDO CIRCUITO DE FIRMA, que sería un segundo sitio donde equivocarse.
--    Esto acaba exactamente donde acaba el otro: un `enlaces_token` con `canal = 'panel'`
--    y una hora de vida, y el frontend navegando a `/signar/<token>`. El texto que se
--    firma lo sigue componiendo el servidor, la huella se sigue recalculando en el POST y
--    la evidencia se sigue escribiendo igual.
--
-- ⚠️ `enviado_at` SE QUEDA NULL, como en `acunar_enllac_propi()`. Esa columna significa
--    «cuándo se le mandó por correo», y aquí no se ha mandado nada: escribirla afirmaría
--    en un documento legal algo que no pasó. El índice parcial de `convenios (enviado_at)
--    where estado = 'pendent_firma'` no es único, así que no estorba.
--
-- ⚠️ `datos_org` SÍ se refresca al salir de `esborrany`, igual que hace `enviar_convenio`:
--    es la copia congelada de la ficha, y tiene que ser la del momento en que el documento
--    empieza a poder firmarse, no la de cuando se preparó el borrador.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. `preparar_convenio()`: el titular puede preparar EL SUYO
-- ---------------------------------------------------------------------------
-- La guarda decía «solo el equipo». Se amplía al titular de esa misma organización, que
-- es el único caso nuevo: `soc_titular()` ya comprueba membresía activa sobre esa ficha
-- concreta, así que nadie puede preparar el convenio de otro. Con `service_role`
-- (`auth.uid() is null`) sigue pasando, que es como lo llama `registro`.
--
-- Es idempotente desde el primer día —si ya hay uno en marcha lo devuelve— así que
-- abrirla no multiplica borradores: el peor caso es que el titular «prepare» el que ya
-- tenía y reciba la misma fila.
--
-- ⚠️ `create or replace` REESCRIBE TODOS LOS ATRIBUTOS: hay que repetir `volatile`,
--    `security definer` y el `search_path`, o la función cambia de comportamiento sin que
--    nada falle (la misma trampa del `parallel restricted` de `get_my_session_context`).
--    La firma y el tipo de retorno no cambian, así que los GRANT se conservan.
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
  if auth.uid() is not null
     and not public.es_intern()
     and not public.soc_titular(p_tipo_org, p_org) then
    raise exception 'Nomes l''equip o el titular poden preparar aquest conveni'
      using errcode = '42501';
  end if;

  select coalesce(p_idioma, pe.idioma, 'ca') into v_idioma
    from membresias m
    join perfiles pe on pe.id = m.user_id
   where m.activo and m.rol_org = 'titular'
     and ((p_tipo_org = 'productor' and m.productor_id = p_org)
       or (p_tipo_org = 'entidad'   and m.entidad_id   = p_org))
   order by m.created_at limit 1;
  v_idioma := coalesce(v_idioma, p_idioma, 'ca');

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

comment on function public.preparar_convenio(text, uuid, text, text, text[]) is
  'Borrador de convenio, idempotente. Lo puede pedir el equipo, service_role o EL TITULAR de esa organización (20270326100000).';

-- ---------------------------------------------------------------------------
-- 2. `signar_conveni_propi()`: de cero a la página de firma, en una llamada
-- ---------------------------------------------------------------------------
-- Devuelve `jsonb` porque devuelve **el token en claro**, que es la única vez que existe
-- (en la base solo queda su sha256). Mismo contrato de salida que `acunar_enllac_propi()`,
-- para que el frontend no tenga que distinguir cuál le contestó.
--
-- El `p_tipo` se deduce y no se recibe: un productor firma `don_gen` y una entidad
-- `don_rec`. Dejarlo entrar por parámetro permitiría pedir `com` —el convenio comercial,
-- que tiene otra matriz de exigencia— desde una pantalla que no sabe nada de eso.
create or replace function public.signar_conveni_propi(
  p_tipo_org text,
  p_org      uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid := auth.uid();
  v_mail   text;
  v_nom    text;
  v_tipo   text;
  v_tok    record;
  v_id     uuid;
  v_caduca timestamptz := now() + interval '1 hour';
  c        convenios%rowtype;
begin
  if v_user is null then
    raise exception 'Cal una sessio per signar el conveni' using errcode = '42501';
  end if;
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  if not public.soc_titular(p_tipo_org, p_org) then
    raise exception 'Nomes el titular de l''organitzacio pot signar el conveni'
      using errcode = '42501';
  end if;

  v_tipo := case when p_tipo_org = 'productor' then 'don_gen' else 'don_rec' end;

  -- Idempotente: si ya hay borrador, enviado o devuelto, devuelve ese.
  c := public.preparar_convenio(p_tipo_org, p_org, v_tipo, null, null);

  -- Los dos estados en los que no hay nada que firmar se distinguen en el mensaje: uno
  -- es «ya está» y el otro «espera a que lo contrafirmemos», y decirle lo mismo a las dos
  -- personas mandaría a una de ellas a buscar un problema que no tiene.
  if c.estado = 'firmat' then
    raise exception 'Ja has signat aquest conveni: falta la contrasignatura de l''equip'
      using errcode = '22023';
  end if;
  if c.estado not in ('esborrany', 'pendent_firma', 'retornat') then
    raise exception 'Aquest conveni no es pot signar (estat %)', c.estado using errcode = '22023';
  end if;

  select p.email, p.nombre into v_mail, v_nom from perfiles p where p.id = v_user;
  select * into v_tok from public.generar_token_enlace();

  -- Dos enlaces vivos son dos firmas posibles, y la segunda no tendría dónde ir. Misma
  -- regla que `enviar_convenio()` y `acunar_enllac_propi()`: acuñar revoca el anterior,
  -- incluido el que la persona pueda tener en el correo (§12.97).
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'convenio' and objeto_id = c.id
     and proposito = 'firma_convenio' and estado = 'activo';

  insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                             destinatario_email, destinatario_nombre, canal,
                             token_hash, caduca_at, creado_por)
  values ('firma_convenio', 'convenio', c.id, v_mail, v_nom, 'panel',
          v_tok.token_hash, v_caduca, v_user)
  returning id into v_id;

  -- Solo el borrador cambia de estado. `enviado_at` se queda como esté (ver cabecera).
  if c.estado = 'esborrany' then
    update convenios
       set estado    = 'pendent_firma',
           enlace_id = v_id,
           datos_org = public.convenio_datos_org(c.id)
     where id = c.id;
  else
    update convenios set enlace_id = v_id where id = c.id;
  end if;

  return jsonb_build_object('id', v_id, 'token', v_tok.token,
                            'url_path', '/signar/' || v_tok.token,
                            'caduca_at', v_caduca);
end;
$$;

revoke execute on function public.signar_conveni_propi(text, uuid) from public, anon;
grant  execute on function public.signar_conveni_propi(text, uuid) to authenticated;

comment on function public.signar_conveni_propi(text, uuid) is
  'Prepara (si hace falta) el convenio de MI organización, lo pasa a pendent_firma y acuña un enlace de panel de 1 h. Devuelve el token en claro. Solo el titular.';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
-- Con sesión del titular de una organización sin convenio:
--   select public.signar_conveni_propi('productor', '<uuid de la ficha>');
--   -- esperado: {"id": …, "token": "…", "url_path": "/signar/…", "caduca_at": …}
--   select estado, enviado_at from convenios where productor_id = '<uuid>';
--   -- esperado: pendent_firma, enviado_at NULL
--
-- Con la ficha de OTRO (o sin ser titular): 42501.
-- Llamándola dos veces seguidas: dos tokens, y el primero queda 'revocado'.
