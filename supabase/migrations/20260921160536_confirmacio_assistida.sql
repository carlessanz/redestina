-- ---------------------------------------------------------------------------
-- La vía asistida de albaranes y facturas (modelo asistido, §1bis)
-- ---------------------------------------------------------------------------
-- El modelo de Redestina es ASISTIDO: el dinamizador conduce actos que la organización
-- hace delante de él, por teléfono o en persona. Para la firma del convenio eso ya
-- existía (`iniciar_firma_asistida`, canal `asistido`). Para el albarán y la factura NO,
-- y el resultado era que una confirmación conducida por teléfono quedaba documentada
-- como «enviada por correo»: `marcar_entregado()` inserta sin `canal`, o sea `'email'`
-- por defecto, y `registrar_confirmacion()` nunca escribía `asistido_por`.
--
-- 🔴 ESO NO ERA UN DETALLE: es una afirmación falsa dentro de un documento con valor
--    legal. El PDF del albarán imprime la vía a partir de `enlaces_token.canal`, así que
--    el papel decía algo que no había ocurrido. Esta migración da la puerta que faltaba y
--    hace que la evidencia diga la verdad.
--
-- ⚠️ LO QUE ESTA MIGRACIÓN **NO** HACE, Y ES DELIBERADO:
--    · No toca `marcar_entregado()`. Marcar `asistido` en el momento de entregar —cuando
--      todavía no hay nadie conduciendo nada— documentaría algo que no ha pasado. El
--      enlace asistido se acuña cuando el dinamizador tiene de verdad a la persona.
--    · No abre `firma_convenio`: ya está `iniciar_firma_asistida()`, y un segundo
--      circuito de firma es un segundo sitio donde equivocarse.
--    · No concede escritura sobre `enlaces_token` ni `evidencias` a nadie.

-- ---------------------------------------------------------------------------
-- 1. acunar_enllac_assistit(): el espejo de equipo de acunar_enllac_propi()
-- ---------------------------------------------------------------------------
-- Molde: `20270318100000_documents_panell_extern.sql:253-395`. Tres diferencias, y las
-- tres importan:
--
--   (a) La guarda EXIGE SESIÓN DE EQUIPO, así que `service_role` no puede llamarla (se le
--       revoca el EXECUTE, que además hereda del bootstrap). Un enlace asistido con
--       `creado_por` nulo sería un acto conducido por nadie, que es exactamente lo que
--       `evidencias.asistido_por` existe para impedir.
--   (b) El destinatario sale de LA FICHA DE LA PARTE, no del perfil de quien acuña: el
--       equipo no es parte del albarán. Y puede quedar `null` —eso es lo que cierra el
--       hueco de que hoy `marcar_entregado()` solo crea enlace `where d.email is not
--       null`, dejando sin confirmación posible a una ficha sin correo—. El enlace
--       asistido no se manda, así que la falta de correo no lo impide.
--   (c) No hay parámetro `p_email`: un correo escrito a mano sería una afirmación falsa
--       sobre a quién se escribió, en una tabla cuyo único valor es ser cierta.
create or replace function public.acunar_enllac_assistit(
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
  a         albaranes%rowtype;
  cd        cierres_donante%rowtype;
  v_entrega boolean;
  v_recibe  boolean;
  v_rol     text;
  v_prod    uuid;
  v_ent     uuid;
begin
  -- (a) Sesión de equipo. `service_role` (auth.uid() null) NO pasa, al revés que en casi
  --     todas las RPC documentales: aquí la identidad del conductor es el dato.
  if v_user is null or not public.es_intern() then
    raise exception 'Cal una sessio de l''equip per acunyar un enllac assistit'
      using errcode = '42501';
  end if;

  select * into v_tok from public.generar_token_enlace();

  -- --- Albarán --------------------------------------------------------------
  if p_proposito = 'confirmacion_albaran' and p_objeto_tipo = 'albaran' then
    select * into a from albaranes where id = p_objeto_id for update;
    if a.id is null then
      raise exception 'Aquest albara no existeix' using errcode = 'PT404';
    end if;
    if a.estado <> 'entregado' then
      raise exception 'Aquest albara no esta pendent de confirmacio (estat %)', a.estado
        using errcode = '22023';
    end if;

    -- Qué partes tiene. Mismo reparto que `marcar_entregado()`.
    -- ⚠️ Los alias NO pueden llamarse `a` ni `cd`: son variables declaradas arriba y
    --    plpgsql resuelve antes la variable, así que la parte se resolvería mal en
    --    silencio (la trampa que documenta 20270318100000:334-339).
    select coalesce(ex.productor_id, esp.productor_id), ca.entidad_id into v_prod, v_ent
      from albaranes al
      left join canalizaciones ca  on ca.id  = al.canalizacion_id
      left join excedentes     ex  on ex.id  = al.excedente_id
      left join espigoladas    esp on esp.id = al.espigolada_id
     where al.id = a.id;

    -- El equipo no es parte: lo que decide es el TIPO del albarán, no de quién es.
    v_entrega := a.tipo in ('REC', 'OPE') and v_prod is not null;
    v_recibe  := a.tipo in ('ENT', 'OPE') and v_ent  is not null;

    v_rol := coalesce(
      nullif(btrim(coalesce(p_rol_parte, '')), ''),
      case when v_entrega and not v_recibe then 'entrega'
           when v_recibe and not v_entrega then 'recibe' end);
    if v_rol is null then
      raise exception 'Indica de quina part es la confirmacio (entrega o recibe)'
        using errcode = '22023';
    end if;
    if (v_rol = 'entrega' and not v_entrega) or (v_rol = 'recibe' and not v_recibe) then
      raise exception 'Aquest albara no te aquesta part' using errcode = '22023';
    end if;

    -- (b) El destinatario es la FICHA de esa parte, y puede no tener correo.
    if v_rol = 'entrega' then
      select p.email, coalesce(p.empresa, p.name) into v_mail, v_nom
        from productores p where p.id = v_prod;
    else
      select e.email, coalesce(e.contacto, e.nombre) into v_mail, v_nom
        from entidades e where e.id = v_ent;
    end if;

    -- En un OPE hay dos enlaces vivos, uno por parte: revocar el de la otra sería
    -- romperle la confirmación a quien no ha pedido nada (regla de 20270318100000:367-371).
    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'albaran' and objeto_id = a.id
       and proposito = 'confirmacion_albaran' and estado = 'activo'
       and (rol_parte = v_rol or (a.tipo <> 'OPE' and rol_parte is null));

    insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                               destinatario_email, destinatario_nombre, canal, rol_parte,
                               token_hash, caduca_at, creado_por)
    values ('confirmacion_albaran', 'albaran', a.id, v_mail, v_nom, 'asistido', v_rol,
            v_tok.token_hash, v_caduca, v_user)
    returning id into v_id;

    return jsonb_build_object('id', v_id, 'token', v_tok.token,
                              'url_path', '/confirmar/' || v_tok.token,
                              'rol_part', v_rol, 'canal', 'asistido',
                              'destinatari', v_mail,
                              'caduca_at', v_caduca);

  -- --- Factura del donante --------------------------------------------------
  elsif p_proposito = 'subida_factura' and p_objeto_tipo = 'cierre_donante' then
    select * into cd from cierres_donante where id = p_objeto_id for update;
    if cd.id is null then
      raise exception 'Aquest acumulat de donant no existeix' using errcode = 'PT404';
    end if;
    -- Declarado es el final del camino: ya se ha presentado el 182.
    if cd.estado = 'declarat' then
      raise exception 'Aquest acumulat ja esta declarat' using errcode = '22023';
    end if;

    select p.email, coalesce(p.empresa, p.name) into v_mail, v_nom
      from productores p where p.id = cd.productor_id;

    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'cierre_donante' and objeto_id = cd.id
       and proposito = 'subida_factura' and estado = 'activo';

    insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                               destinatario_email, destinatario_nombre, canal,
                               token_hash, caduca_at, creado_por)
    values ('subida_factura', 'cierre_donante', cd.id, v_mail, v_nom, 'asistido',
            v_tok.token_hash, v_caduca, v_user)
    returning id into v_id;

    return jsonb_build_object('id', v_id, 'token', v_tok.token,
                              'url_path', '/factura/' || v_tok.token,
                              'canal', 'asistido',
                              'destinatari', v_mail,
                              'caduca_at', v_caduca);
  end if;

  raise exception 'Proposit no admes com a assistit: %', p_proposito using errcode = '22023';
end;
$$;

revoke execute on function public.acunar_enllac_assistit(text, text, uuid, text)
  from public, anon, service_role;
grant  execute on function public.acunar_enllac_assistit(text, text, uuid, text)
  to authenticated;

comment on function public.acunar_enllac_assistit(text, text, uuid, text) is
  'Acuna un enllac assistit (canal asistido, 1 h) perque l''equip condueixi la confirmacio d''un albara o la pujada d''una factura amb la persona al davant. Exigeix sessio d''equip: service_role no pot, perque la identitat de qui condueix es el dada.';

-- ---------------------------------------------------------------------------
-- 2. registrar_confirmacion(): ahora deja constancia de quién condujo el acto
-- ---------------------------------------------------------------------------
-- Misma firma, y compatible byte a byte si no llega nada nuevo: el patrón de
-- `20270320100200_firmar_conveni_payload.sql`, que hizo esto mismo con la firma.
-- Dos cambios y nada más:
--
--   (1) La evidencia gana `asistido_por`, **solo cuando el enlace es `asistido`** y
--       leyéndolo de `enlaces_token.creado_por`, nunca del cuerpo de la petición: quien
--       confirma no tiene sesión y podría escribir cualquier uuid. Decir «asistida» de
--       una confirmación hecha desde el panel propio, o de una por correo, seria afirmar
--       algo falso — por eso el `case` y no un `coalesce` a secas.
--   (2) `payload` pasa a ser lo respondido MÁS lo que añade el servidor
--       (`p_evidencia->'payload'`), con el guardia `jsonb_typeof = 'object'`.
--       ⚠️ Sin ese guardia no hay error, hay dato corrupto: `'{"a":1}'::jsonb || '"x"'::jsonb`
--          devuelve un ARRAY, no falla.
create or replace function public.registrar_confirmacion(
  p_enlace    uuid,
  p_payload   jsonb,
  p_evidencia jsonb default null
) returns albaranes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  en enlaces_token%rowtype;
  a  albaranes%rowtype;
  k  jsonb;
  v_rechazo text;
  v_payload jsonb;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor registra una confirmacio' using errcode = '42501';
  end if;

  select * into en from enlaces_token where id = p_enlace for update;
  if en.id is null or en.proposito <> 'confirmacion_albaran' then
    raise exception 'Enllac desconegut' using errcode = 'PT404';
  end if;
  if en.usado_at is not null or en.estado in ('usado', 'revocado') then
    raise exception 'Aquest enllac ja s''ha fet servir' using errcode = 'PT409';
  end if;
  if en.caduca_at < now() or en.estado = 'caducado' then
    raise exception 'Aquest enllac ha caducat' using errcode = 'PT410';
  end if;

  select * into a from albaranes where id = en.objeto_id for update;
  if a.id is null or a.estado not in ('emitido', 'entregado') then
    raise exception 'Aquest albara ja no admet confirmacio' using errcode = 'PT409';
  end if;

  -- Los kilos que dice haber recibido, línea a línea.
  for k in select * from jsonb_array_elements(coalesce(p_payload->'kg_confirmados', '[]'::jsonb)) loop
    update albaran_lineas
       set kg_confirmados = (k->>'kg')::numeric
     where id = (k->>'linea_id')::uuid and albaran_id = a.id;
  end loop;

  v_rechazo := coalesce(p_payload->>'rechazo', 'cap');
  if v_rechazo <> 'cap' and coalesce(btrim(p_payload->>'motivo_rechazo'), '') = '' then
    raise exception 'Un rebuig total o parcial necessita motiu' using errcode = '22023';
  end if;

  update albaranes
     set estado         = 'confirmado',
         confirmado_at  = now(),
         incidencias    = coalesce(p_payload->'incidencias', a.incidencias),
         rechazo        = v_rechazo,
         motivo_rechazo = p_payload->>'motivo_rechazo'
   where id = a.id
  returning * into a;

  if a.canalizacion_id is not null and (p_payload->>'caixes_retornades') is not null then
    update canalizaciones
       set caixes_retornades = (p_payload->>'caixes_retornades')::int
     where id = a.canalizacion_id;
  end if;

  -- (2) Lo respondido, más lo que el servidor sabe y el navegador no puede afirmar.
  v_payload := coalesce(p_payload, '{}'::jsonb);
  if jsonb_typeof(p_evidencia->'payload') = 'object' then
    v_payload := v_payload || (p_evidencia->'payload');
  end if;

  -- La evidencia: es lo que hace que la confirmación valga algo.
  insert into evidencias (enlace_id, tipo, nombre, cargo, ip, user_agent, sha256_texto,
                          payload, asistido_por)
  values (en.id, 'confirmacion',
          p_evidencia->>'nombre', p_evidencia->>'cargo',
          (p_evidencia->>'ip')::inet, p_evidencia->>'user_agent',
          p_evidencia->>'sha256_texto',
          v_payload,
          -- (1) Manda la fila del enlace sobre el cuerpo de la petición, y solo si es
          --     asistido: en `email` y en `panel` esta columna tiene que quedar NULL.
          case when en.canal = 'asistido'
               then coalesce(en.creado_por,
                             nullif(p_evidencia->>'asistido_por', '')::uuid)
               end);

  update enlaces_token set usado_at = now(), estado = 'usado' where id = en.id;

  return a;
end;
$$;

revoke execute on function public.registrar_confirmacion(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant  execute on function public.registrar_confirmacion(uuid, jsonb, jsonb)
  to service_role;

comment on function public.registrar_confirmacion(uuid, jsonb, jsonb) is
  'Registra la confirmacio d''un albara des de enlace-publico. Nomes service_role: qui confirma no te sessio, el que autoritza es el token. Escriu asistido_por nomes quan l''enllac es de canal asistido.';
