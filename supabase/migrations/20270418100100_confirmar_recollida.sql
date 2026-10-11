-- Fase 3 de la revisión del 08-10-2026: confirmar la recogida.
--
-- Tres piezas, y las tres terminan en la misma función de siempre, `registrar_confirmacion()`:
--
--   1. WhatsApp como vía de confirmación. Una parte con móvil y SIN correo no tenía cómo
--      confirmar: `marcar_entregado()` solo creaba enlaces `where email is not null`. Ahora le
--      crea uno `canal = 'whatsapp'` con su teléfono, y el webhook lo consume con dos botones
--      («tot correcte» / «hi ha diferències») o con el número de kilos. El token de ese
--      enlace no viaja por WhatsApp —quedaría publicado en la consola de Mensajería—: lo que
--      autoriza es que el botón llega desde el teléfono de la ficha.
--   2. `registrar_confirmacion()` admite una sesión de EQUIPO, pero solo sobre un enlace
--      asistido. Una función, un camino: la confirmación del equipo deja la misma evidencia
--      que la de la persona, con `asistido_por`.
--   3. `confirmar_recollida()`: el botón «Confirma la recollida» del panel del equipo. En una
--      transacción emite y entrega el albarán de salida si hacía falta, confirma por cada
--      parte que falte, apunta los kilos reales, confirma el REC cuando ya no le falta ninguna
--      salida y, si cuadra dentro de tolerancia, concilia (en cascada).

-- ------------------------------------------------------------------ 1. El canal WhatsApp
alter table public.enlaces_token drop constraint enlaces_token_canal_check;
alter table public.enlaces_token
  add constraint enlaces_token_canal_check
  check (canal in ('email', 'asistido', 'panel', 'whatsapp'));

alter table public.enlaces_token
  add column if not exists destinatario_telefono text,
  -- En qué punto del diálogo de WhatsApp está la confirmación: `kg` = se le han pedido los
  -- kilos reales y el siguiente número que escriba es la respuesta.
  add column if not exists wa_pas text check (wa_pas in ('kg')),
  -- Cuándo se le mandó la pregunta con los botones. La manda `recollides-programades` cada
  -- 15 minutos a los enlaces de WhatsApp que no la tienen: así da igual si el albarán lo
  -- marcó entregado el job o el equipo desde el panel, y si la ventana de 24 h estaba
  -- cerrada se vuelve a intentar en cuanto la persona escribe.
  add column if not exists wa_preguntat_at timestamptz;

-- Las columnas nuevas de una tabla con GRANT por columnas no heredan nada (§4).
-- `destinatario_telefono` es un dato de contacto de la ficha: lo lee el equipo, como el correo.
grant select (destinatario_telefono, wa_pas, wa_preguntat_at) on public.enlaces_token to authenticated;

create index if not exists enlaces_token_whatsapp_idx
  on public.enlaces_token (destinatario_telefono)
  where canal = 'whatsapp' and estado = 'activo' and usado_at is null;

-- ¿Este teléfono es un móvil? La misma regla que `esMovil()` de `_shared/canal.ts`: un
-- número español que no empiece por 6 o 7 es fijo; fuera de España no se puede saber.
create or replace function public.es_mobil(p_tel text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_tel is not null
     and p_tel ~ '^[1-9][0-9]{6,14}$'
     and (p_tel !~ '^34' or p_tel ~ '^34[67][0-9]{8}$');
$$;
revoke execute on function public.es_mobil(text) from public, anon;

-- --------------------------------------------- marcar_entregado(): + enlace de WhatsApp
create or replace function public.marcar_entregado(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  a        albaranes%rowtype;
  par      parametros_documentales%rowtype;
  v_dest   record;
  v_token  text;
  v_id     uuid;
  v_canal  text;
  v_res    jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot marcar un albara com a entregat' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado <> 'emitido' then
    raise exception 'Nomes es pot marcar entregat un albara emes' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  update albaranes set estado = 'entregado', entregado_at = now() where id = a.id
  returning * into a;

  for v_dest in
    select * from (
      -- La entidad receptora (ENT y OPE): es la parte que RECIBE.
      select e.email as email, e.telefono as telefono,
             coalesce(e.contacto, e.nombre) as nombre, 'recibe' as rol
        from entidades e
        join canalizaciones c on c.entidad_id = e.id
       where c.id = a.canalizacion_id and a.tipo in ('ENT', 'OPE')
      union all
      -- El generador (REC y OPE): es la parte que ENTREGA en los dos casos.
      select p.email, p.phone, coalesce(p.empresa, p.name), 'entrega'
        from productores p
        join excedentes ex on ex.productor_id = p.id
       where ex.id = a.excedente_id and a.tipo in ('REC', 'OPE')
      union all
      -- El generador de una espigolada (REC sin excedente): también entrega.
      select p.email, p.phone, coalesce(p.empresa, p.name), 'entrega'
        from productores p
        join espigoladas es on es.productor_id = p.id
       where es.id = a.espigolada_id and a.tipo = 'REC'
    ) d
    -- Correo si lo hay; si no, WhatsApp si hay móvil. Sin ninguno de los dos, la parte
    -- confirma por la vía asistida (el equipo, `confirmar_recollida()`).
    where (d.email is not null and btrim(d.email) <> '') or public.es_mobil(d.telefono)
  loop
    v_canal := case when v_dest.email is not null and btrim(v_dest.email) <> '' then 'email' else 'whatsapp' end;

    -- 32 bytes aleatorios en base64url (ver la versión anterior: sin pgcrypto).
    v_token := rtrim(translate(
      encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                               clock_timestamp()::text, 'UTF8')), 'base64'),
      '+/', '-_'), '=');

    insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                               destinatario_email, destinatario_telefono, destinatario_nombre,
                               canal, rol_parte, token_hash, caduca_at, creado_por)
    values ('confirmacion_albaran', 'albaran', a.id,
            case when v_canal = 'email' then v_dest.email end,
            case when v_canal = 'whatsapp' then v_dest.telefono end,
            v_dest.nombre, v_canal, v_dest.rol,
            encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
            now() + make_interval(days => coalesce(par.caducidad_confirmacion_dias, 15)),
            auth.uid())
    returning id into v_id;

    v_res := v_res || jsonb_build_object(
      'id', v_id, 'canal', v_canal,
      'destinatari', case when v_canal = 'email' then v_dest.email end,
      'telefon', case when v_canal = 'whatsapp' then v_dest.telefono end,
      'nom', v_dest.nombre, 'rol_part', v_dest.rol,
      -- El token solo sirve para el enlace del correo; por WhatsApp no viaja.
      'token', case when v_canal = 'email' then v_token end);
  end loop;

  return jsonb_build_object('albara', to_jsonb(a), 'enllacos', v_res);
end;
$function$;

-- ------------------------------------- 2. registrar_confirmacion(): el equipo, si es asistido
CREATE OR REPLACE FUNCTION public.registrar_confirmacion(p_enlace uuid, p_payload jsonb, p_evidencia jsonb DEFAULT NULL::jsonb)
 RETURNS albaranes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  en          enlaces_token%rowtype;
  a           albaranes%rowtype;
  k           jsonb;
  v_rechazo   text;
  v_payload   jsonb;
  v_motivo    text;
  v_inc       jsonb;
  v_previa    boolean;   -- ¿otra parte de este albarán ya confirmó?
  v_recibe_ya boolean;   -- ¿la parte que RECIBE ya confirmó?
  v_espera    boolean;   -- ¿queda otra parte por confirmar?
  v_escribe   boolean;   -- ¿esta confirmación fija los kilos de las líneas?
begin
  -- Con sesión, solo el equipo, y solo sobre un enlace ASISTIDO (11-10-2026): es lo que
  -- usa `confirmar_recollida()`, que confirma en nombre de la parte con la persona al
  -- teléfono. Un enlace de correo, de panel o de WhatsApp lo registra solo el servidor.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes el servidor registra una confirmacio' using errcode = '42501';
  end if;

  select * into en from enlaces_token where id = p_enlace for update;
  if en.id is null or en.proposito <> 'confirmacion_albaran' then
    raise exception 'Enllac desconegut' using errcode = 'PT404';
  end if;
  if auth.uid() is not null and en.canal <> 'asistido' then
    raise exception 'Nomes el servidor registra una confirmacio' using errcode = '42501';
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

  -- (4) Esta parte ya confirmó con otro enlace. Con `rol_parte` null (enlaces anteriores a
  --     20270304100200) no se puede saber de qué parte era, y no se bloquea.
  if en.rol_parte is not null and exists (
       select 1 from enlaces_token t
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
          and t.proposito = 'confirmacion_albaran'
          and t.id <> en.id and t.usado_at is not null
          and t.rol_parte = en.rol_parte) then
    raise exception 'Aquesta part ja ha confirmat l''albara' using errcode = 'PT409';
  end if;

  select exists (
           select 1 from enlaces_token t
            where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
              and t.proposito = 'confirmacion_albaran'
              and t.id <> en.id and t.usado_at is not null),
         exists (
           select 1 from enlaces_token t
            where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
              and t.proposito = 'confirmacion_albaran'
              and t.id <> en.id and t.usado_at is not null
              and t.rol_parte = 'recibe')
    into v_previa, v_recibe_ya;

  -- (1) ¿Queda la OTRA parte? Solo en OPE, y solo con un enlace vivo de verdad. «Otra»
  --     significa otro `rol_parte`; si alguno es null (enlace antiguo) cuenta como otra.
  v_espera := a.tipo = 'OPE' and exists (
    select 1 from enlaces_token t
     where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
       and t.proposito = 'confirmacion_albaran'
       and t.id <> en.id
       and t.usado_at is null and t.estado = 'activo' and t.caduca_at >= now()
       and (en.rol_parte is null or t.rol_parte is null or t.rol_parte <> en.rol_parte));

  -- (2) Los kilos: `entrega` no pisa lo que ya dijo `recibe`.
  v_escribe := not (a.tipo = 'OPE' and en.rol_parte = 'entrega' and v_recibe_ya);

  if v_escribe then
    -- Los kilos que dice haber recibido, línea a línea.
    for k in select * from jsonb_array_elements(coalesce(p_payload->'kg_confirmados', '[]'::jsonb)) loop
      update albaran_lineas
         set kg_confirmados = (k->>'kg')::numeric
       where id = (k->>'linea_id')::uuid and albaran_id = a.id;
    end loop;
  end if;

  v_rechazo := coalesce(p_payload->>'rechazo', 'cap');
  if v_rechazo <> 'cap' and coalesce(btrim(p_payload->>'motivo_rechazo'), '') = '' then
    raise exception 'Un rebuig total o parcial necessita motiu' using errcode = '22023';
  end if;

  -- (3) El rechazo más grave de las dos partes, y los dos motivos. Con una sola
  --     confirmación (`a.rechazo = 'cap'`, `a.motivo_rechazo` null) el resultado es
  --     exactamente el de antes.
  v_rechazo := case
                 when 'total'   in (a.rechazo, v_rechazo) then 'total'
                 when 'parcial' in (a.rechazo, v_rechazo) then 'parcial'
                 else 'cap'
               end;
  v_motivo := case
                when coalesce(btrim(p_payload->>'motivo_rechazo'), '') = '' then a.motivo_rechazo
                when coalesce(btrim(a.motivo_rechazo), '') = '' then p_payload->>'motivo_rechazo'
                else a.motivo_rechazo || ' · ' || (p_payload->>'motivo_rechazo')
              end;
  v_inc := case
             when v_previa and jsonb_typeof(a.incidencias) = 'array'
                  and jsonb_typeof(p_payload->'incidencias') = 'array'
               then a.incidencias || (p_payload->'incidencias')
             else coalesce(p_payload->'incidencias', a.incidencias)
           end;

  if v_espera then
    -- Falta la otra parte: el albarán sigue `entregado` y sin `confirmado_at`.
    update albaranes
       set incidencias    = v_inc,
           rechazo        = v_rechazo,
           motivo_rechazo = v_motivo
     where id = a.id
    returning * into a;
  else
    update albaranes
       set estado         = 'confirmado',
           confirmado_at  = now(),
           incidencias    = v_inc,
           rechazo        = v_rechazo,
           motivo_rechazo = v_motivo
     where id = a.id
    returning * into a;
  end if;

  if a.canalizacion_id is not null and (p_payload->>'caixes_retornades') is not null then
    update canalizaciones
       set caixes_retornades = (p_payload->>'caixes_retornades')::int
     where id = a.canalizacion_id;
  end if;

  -- Lo respondido, más lo que el servidor sabe y el navegador no puede afirmar.
  v_payload := coalesce(p_payload, '{}'::jsonb);
  if jsonb_typeof(p_evidencia->'payload') = 'object' then
    v_payload := v_payload || (p_evidencia->'payload');
  end if;

  -- La evidencia: es lo que hace que la confirmación valga algo. Una por enlace, también
  -- en el OPE: cada parte deja la suya, con sus kilos aunque no sean los de la línea.
  insert into evidencias (enlace_id, tipo, nombre, cargo, ip, user_agent, sha256_texto,
                          payload, asistido_por)
  values (en.id, 'confirmacion',
          p_evidencia->>'nombre', p_evidencia->>'cargo',
          (p_evidencia->>'ip')::inet, p_evidencia->>'user_agent',
          p_evidencia->>'sha256_texto',
          v_payload,
          -- Manda la fila del enlace sobre el cuerpo de la petición, y solo si es
          -- asistido: en `email` y en `panel` esta columna tiene que quedar NULL.
          case when en.canal = 'asistido'
               then coalesce(en.creado_por,
                             nullif(p_evidencia->>'asistido_por', '')::uuid)
               end);

  update enlaces_token set usado_at = now(), estado = 'usado' where id = en.id;

  return a;
end;
$function$;

-- --------------------------------------------------- 3. confirmar_recollida() (equipo)
--
-- Reparte unos kilos entre las líneas de un albarán: proporcional a lo previsto, con el
-- residuo del redondeo en la línea mayor (el mismo criterio que el reparto del cierre).
create or replace function public.repartir_kg_linies(p_albaran uuid, p_kg numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tot  numeric;
  v_res  jsonb := '[]'::jsonb;
  v_acc  numeric := 0;
  v_max  uuid;
  l      record;
  v_kg   numeric;
begin
  select coalesce(sum(coalesce(kg_neto, kg_previstos, 0)), 0) into v_tot
    from albaran_lineas where albaran_id = p_albaran;
  select id into v_max from albaran_lineas where albaran_id = p_albaran
   order by coalesce(kg_neto, kg_previstos, 0) desc, orden, id limit 1;
  for l in select id, coalesce(kg_neto, kg_previstos, 0) as kg from albaran_lineas
            where albaran_id = p_albaran order by orden, id loop
    v_kg := case when v_tot > 0 then round(p_kg * l.kg / v_tot, 2)
                 when l.id = v_max then p_kg else 0 end;
    v_acc := v_acc + v_kg;
    v_res := v_res || jsonb_build_object('linea_id', l.id, 'kg', v_kg);
  end loop;
  -- El residuo a la línea mayor, para que la suma sea exactamente `p_kg`.
  if v_max is not null and v_acc <> p_kg then
    select jsonb_agg(case when (x->>'linea_id')::uuid = v_max
                          then jsonb_set(x, '{kg}', to_jsonb((x->>'kg')::numeric + (p_kg - v_acc)))
                          else x end)
      into v_res from jsonb_array_elements(v_res) x;
  end if;
  return v_res;
end;
$$;
revoke execute on function public.repartir_kg_linies(uuid, numeric) from public, anon, authenticated;

-- Confirma por la vía asistida la parte `p_rol` de un albarán `entregado`, si no ha
-- confirmado ya. Interna: la llama `confirmar_recollida()` con la sesión del equipo.
create or replace function public.confirmar_part_assistida(
  p_albaran uuid, p_rol text, p_kg numeric, p_observacions text, p_foto uuid, p_data timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_tok   record;
  v_id    uuid;
  v_nom   text;
  v_obs   text := nullif(btrim(coalesce(p_observacions, '')), '');
begin
  if v_user is null or not public.es_intern() then
    raise exception 'Cal una sessio de l''equip' using errcode = '42501';
  end if;
  if exists (select 1 from enlaces_token t
              where t.objeto_tipo = 'albaran' and t.objeto_id = p_albaran
                and t.proposito = 'confirmacion_albaran'
                and t.usado_at is not null and t.rol_parte = p_rol) then
    return false;   -- esa parte ya confirmó
  end if;

  -- Los enlaces vivos de esa parte se revocan: si no, en un OPE la confirmación de la otra
  -- parte vería un enlace «vivo» de esta y se quedaría esperándola para siempre.
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'albaran' and objeto_id = p_albaran
     and proposito = 'confirmacion_albaran' and estado = 'activo'
     and (rol_parte = p_rol or rol_parte is null);

  select * into v_tok from public.generar_token_enlace();
  insert into enlaces_token (proposito, objeto_tipo, objeto_id, canal, rol_parte,
                             token_hash, caduca_at, creado_por)
  values ('confirmacion_albaran', 'albaran', p_albaran, 'asistido', p_rol,
          v_tok.token_hash, now() + interval '1 hour', v_user)
  returning id into v_id;

  select coalesce(nullif(btrim(nombre), ''), email) into v_nom from perfiles where id = v_user;

  perform public.registrar_confirmacion(
    v_id,
    jsonb_build_object(
      'kg_confirmados', public.repartir_kg_linies(p_albaran, p_kg),
      'rechazo', case when p_kg = 0 then 'total' else 'cap' end,
      'motivo_rechazo', case when p_kg = 0 then coalesce(v_obs, 'Sense recollida') end,
      'incidencias', case when v_obs is not null
                          then jsonb_build_array(jsonb_build_object('descripcion', v_obs)) end),
    jsonb_build_object(
      'nombre', v_nom,
      'cargo', 'Equip de Redestina',
      'payload', jsonb_build_object(
        'via', 'confirmar_recollida',
        'nota_assistida', coalesce(v_obs, 'Recollida confirmada per l''equip'),
        'data_recollida', p_data,
        'foto', p_foto)));
  return true;
end;
$$;
revoke execute on function public.confirmar_part_assistida(uuid, text, numeric, text, uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.confirmar_recollida(
  p_canalizacion uuid,
  p_kg_reals     numeric,
  p_data         timestamptz default null,
  p_observacions text default null,
  p_foto         uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c        canalizaciones%rowtype;
  s        albaranes%rowtype;
  r        albaranes%rowtype;
  v_prod   uuid;
  v_quan   timestamptz;
  v_kg_rec numeric;
  v_falten boolean;
  v_prop   jsonb;
  v_conc   boolean := false;
  v_fora   boolean := false;
  v_ok     boolean;
begin
  -- (0) Solo el equipo, con sesión: la identidad de quien conduce es parte de la evidencia
  --     (`asistido_por`). El permiso va ANTES que la existencia, para que una cuenta externa
  --     reciba 42501 aunque el uuid no exista.
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip pot confirmar una recollida' using errcode = '42501';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if p_kg_reals is null or p_kg_reals < 0 then
    raise exception 'kg_invalids' using errcode = '22023';
  end if;

  select * into s from albaranes
   where canalizacion_id = c.id and tipo in ('ENT', 'OPE')
     and estado not in ('anulado', 'rectificado')
   order by created_at desc limit 1
   for update;
  if s.id is null then
    raise exception 'sense_albara' using errcode = '22023';
  end if;
  if s.estado in ('confirmado', 'conciliado') then
    raise exception 'ja_confirmada' using errcode = '22023';
  end if;

  -- La foto, si la hay, ya está subida como documento externo de ESTE albarán.
  if p_foto is not null and not exists (
       select 1 from documentos_externos x
        where x.id = p_foto and x.objeto_tipo = 'albaran' and x.objeto_id = s.id) then
    raise exception 'foto_aliena' using errcode = '22023';
  end if;

  v_quan := coalesce(p_data, c.data_hora_recollida, now());
  if p_data is not null and p_data > now() + interval '5 minutes' then
    raise exception 'data_futura' using errcode = '22023';
  end if;

  -- (1) La salida, emitida y entregada. Emitir consume numeración legal: la pantalla lo dice.
  if s.estado = 'borrador' then
    update albaran_lineas
       set kg_bruto = coalesce(kg_bruto, kg_previstos),
           tara_kg  = coalesce(tara_kg, 0),
           kg_neto  = coalesce(kg_neto, kg_previstos)
     where albaran_id = s.id;
    if p_data is not null then
      update canalizaciones set data_hora_recollida = p_data where id = c.id;
    end if;
    perform public.emitir_albaran(s.id, jsonb_build_object('fecha_hora', v_quan), null, null);
    perform public.marcar_entregado(s.id);
  elsif s.estado = 'emitido' then
    perform public.marcar_entregado(s.id);
  end if;

  -- (2) Cada parte que falte, con los kilos reales.
  select coalesce(ex.productor_id, esp.productor_id) into v_prod
    from excedentes ex left join espigoladas esp on esp.id = ex.espigolada_id
   where ex.id = c.excedente_id;
  if s.tipo = 'OPE' and v_prod is not null then
    v_ok := public.confirmar_part_assistida(s.id, 'entrega', p_kg_reals, p_observacions, p_foto, v_quan);
  end if;
  v_ok := public.confirmar_part_assistida(s.id, 'recibe', p_kg_reals, p_observacions, p_foto, v_quan);

  update canalizaciones set kg_reales = p_kg_reals where id = c.id;
  select * into s from albaranes where id = s.id;

  -- (3) El REC del registro (o de la espigolada), cuando ya no le falta ninguna salida.
  select a.* into r from albaranes a
   where a.tipo = 'REC' and a.estado not in ('anulado', 'rectificado')
     and (a.excedente_id = c.excedente_id
          or (a.espigolada_id is not null and a.espigolada_id =
                (select ex.espigolada_id from excedentes ex where ex.id = c.excedente_id)))
   order by a.created_at desc limit 1;

  if r.id is not null then
    select exists (
      select 1 from canalizaciones c2
       where c2.excedente_id in (
               select ex.id from excedentes ex
                where ex.id = c.excedente_id
                   or (r.espigolada_id is not null and ex.espigolada_id = r.espigolada_id))
         and c2.estado <> 'anulada'
         and not exists (
           select 1 from albaranes b
            where b.canalizacion_id = c2.id and b.tipo in ('ENT', 'OPE')
              and b.estado in ('confirmado', 'conciliado')))
      into v_falten;

    if not v_falten and r.estado in ('borrador', 'emitido', 'entregado') then
      select coalesce(sum(coalesce(c2.kg_reales, c2.kg_confirmados)), 0) into v_kg_rec
        from canalizaciones c2
       where c2.estado <> 'anulada'
         and c2.excedente_id in (
               select ex.id from excedentes ex
                where ex.id = c.excedente_id
                   or (r.espigolada_id is not null and ex.espigolada_id = r.espigolada_id));
      if r.estado = 'borrador' then
        update albaran_lineas
           set kg_previstos = case when v_kg_rec > 0 then v_kg_rec else kg_previstos end
         where albaran_id = r.id;
        update albaran_lineas
           set kg_bruto = coalesce(kg_bruto, kg_previstos),
               tara_kg  = coalesce(tara_kg, 0),
               kg_neto  = coalesce(kg_neto, kg_previstos)
         where albaran_id = r.id;
        perform public.emitir_albaran(r.id, jsonb_build_object('fecha_hora', v_quan), null, null);
        perform public.marcar_entregado(r.id);
      elsif r.estado = 'emitido' then
        perform public.marcar_entregado(r.id);
      end if;
      v_ok := public.confirmar_part_assistida(r.id, 'entrega', v_kg_rec, null, null, v_quan);
      select * into r from albaranes where id = r.id;
    end if;
  end if;

  -- (4) Conciliar si cuadra. Fuera de tolerancia se queda en la cola del equipo
  --     (`albarans_conciliar`), que es donde se decide con motivo.
  if r.id is not null and r.estado = 'confirmado' then
    v_prop := public.propuesta_conciliacion(r.id);
    if coalesce((v_prop->>'dins_tolerancia')::boolean, false) then
      perform public.conciliar_albaran(r.id, null, 'Recollida confirmada per l''equip (dins de tolerancia)', null);
      v_conc := true;
    else
      v_fora := true;
    end if;
  elsif r.id is not null and r.estado = 'conciliado' and s.estado = 'confirmado' then
    perform public.conciliar_albaran(s.id, null,
      'Recollida confirmada per l''equip (recepcio ' || coalesce(r.numero_completo, '?') || ' ja conciliada)', null);
    v_conc := true;
  elsif r.id is null and s.estado = 'confirmado' then
    perform public.conciliar_albaran(s.id, null, 'Recollida confirmada per l''equip', null);
    v_conc := true;
  end if;

  select * into s from albaranes where id = s.id;
  if r.id is not null then select * into r from albaranes where id = r.id; end if;

  return jsonb_build_object(
    'albara_id', s.id, 'albara', s.numero_completo, 'estat', s.estado,
    'rec', case when r.id is not null then jsonb_build_object('numero', r.numero_completo, 'estat', r.estado) end,
    'conciliat', v_conc,
    'fora_tolerancia', v_fora,
    'diferencia_pct', v_prop->'diferencia_pct',
    'kg_recepcio', v_prop->'kg_recepcio',
    'kg_entregues', v_prop->'kg_entregues');
end;
$$;
revoke execute on function public.confirmar_recollida(uuid, numeric, timestamptz, text, uuid) from public, anon;
grant execute on function public.confirmar_recollida(uuid, numeric, timestamptz, text, uuid) to authenticated;
