-- Las RPC del plan de prevención básico, y las dos ramas que faltaban en el sistema
-- documental (`ruta_documento` y `documents_meus`). Con esto se cierra la deuda §12.50: ya
-- no queda ningún `objeto_tipo` que levante `0A000`.
--
-- LA DIFERENCIA CON TODO LO DEMÁS: **descarga inmediata**. Un albarán, un convenio o un
-- certificado se emiten y **se envían** —llevan `envio` en `documentos` y la Edge Function
-- los manda por correo—. El plan básico no: se genera al acabar el formulario y la persona
-- lo descarga ahí mismo. Por eso `envio` va **null** y quien lo pide hace **polling** sobre
-- `documentos.estado` hasta que pase a `emitido`, exactamente como ya hace la bandeja del
-- equipo (decisión del §D del plan: nada de Realtime en las tablas documentales).
--
-- ⚠️ El contenido del cuestionario sigue pendiente (anexo B). Ver la cabecera de
--    20270301100000: aquí solo se guarda y se emite el sobre.

-- ---------------------------------------------------------------------------
-- 1. plan_datos(): el snapshot congelado
-- ---------------------------------------------------------------------------
-- Como todos los snapshots del sistema: sin `apoderada_dni` (GRANT por columnas de
-- `parametros_documentales`, 20260928100400) y con lo justo para que el PDF se pueda
-- regenerar idéntico dentro de cinco años.
create or replace function public.plan_datos(p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  pl  planes_prevencion%rowtype;
  par parametros_documentales%rowtype;
  v_org jsonb;
begin
  select * into pl from planes_prevencion where id = p_plan;
  if pl.id is null then
    raise exception 'Aquest pla no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  if pl.tipo_org = 'productor' then
    select jsonb_build_object('tipus', 'productor',
                              'nom', coalesce(pr.empresa, pr.name),
                              'nif', pr.nif, 'poblacio', pr.poblacion,
                              'comarca', pr.area_geografica, 'email', pr.email)
      into v_org from productores pr where pr.id = pl.productor_id;
  else
    select jsonb_build_object('tipus', 'entitat',
                              'nom', en.nombre,
                              'nif', en.nif, 'poblacio', en.poblacion,
                              'comarca', en.area_geografica, 'email', en.email)
      into v_org from entidades en where en.id = pl.entidad_id;
  end if;

  return jsonb_build_object(
    'tipus', 'PLA',
    'nivell', pl.nivel,
    'numero', pl.numero_completo,
    'versio', pl.version,
    'exercici', pl.ejercicio,
    'data_generacio', now(),
    'lloc', par.poblacion,
    'idioma', pl.idioma,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'organitzacio', v_org,
    -- El sobre del cuestionario, tal cual. Cuando exista el anexo B, el renderizador
    -- agrupará por bloques; hoy pinta la lista.
    'questionari', pl.respuestas
  );
end;
$$;

comment on function public.plan_datos(uuid) is
  'Snapshot congelado del plan de prevención. El cuestionario va tal cual: su vocabulario es el anexo B, pendiente.';

-- ---------------------------------------------------------------------------
-- 2. plan_emet_document(): el puente con `documentos`
-- ---------------------------------------------------------------------------
-- Interna, mismo patrón que `albaran_emet_document()` y `cierre_emet_document()`. La
-- diferencia está en el `envio`: **null**, porque el plan se descarga, no se manda.
create or replace function public.plan_emet_document(p_plan uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  pl     planes_prevencion%rowtype;
  v_ver  int;
  v_prev uuid;
  v_id   uuid;
  v_datos jsonb;
begin
  select * into pl from planes_prevencion where id = p_plan;

  select id, version into v_prev, v_ver
    from documentos
   where objeto_tipo = 'plan' and objeto_id = p_plan and tipo = 'PLA' and vigente;

  if v_prev is not null then
    update documentos set vigente = false where id = v_prev;
  end if;

  v_datos := public.plan_datos(p_plan);

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos, ruta, envio, emitido_por
  ) values (
    'PLA', 'emes', 'plan', p_plan,
    pl.numero_completo, coalesce(v_ver, 0) + 1, pl.serie, pl.ejercicio,
    'real', pl.idioma,
    (select p.id from plantillas_documento p
      where p.tipo = 'PLA' and p.idioma = pl.idioma and p.vigente limit 1),
    v_datos,
    encode(sha256(convert_to(v_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('plan', p_plan, 'PLA', pl.numero_completo,
                          coalesce(v_ver, 0) + 1, 'real', pl.ejercicio),
    null,                       -- descarga inmediata: no se envía por correo
    auth.uid()
  ) returning id into v_id;

  if v_prev is not null then
    update documentos set sustituido_por = v_id where id = v_prev;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. puc_gestionar_pla(): quién puede contestar el cuestionario de una organización
-- ---------------------------------------------------------------------------
-- El equipo (modelo asistido) **y** la propia organización (self-service). No hay un
-- helper que responda esto —`mis_productores()` y `mis_entidades()` son dos, y el tipo
-- decide cuál—, así que se escribe una vez y lo usan las dos RPC.
create or replace function public.puc_gestionar_pla(p_tipo_org text, p_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sin sesión quien llama es `service_role` (script o Edge Function): decide él.
  if auth.uid() is null then
    return true;
  end if;
  if public.es_intern() then
    return true;
  end if;
  if p_tipo_org = 'productor' then
    return p_org in (select public.mis_productores());
  end if;
  return p_org in (select public.mis_entidades());
end;
$$;

comment on function public.puc_gestionar_pla(text, uuid) is
  'Equipo o miembro de la propia organización. El diagnóstico es asistido, pero también self-service.';

-- ---------------------------------------------------------------------------
-- 4. guardar_plan_basico(): el borrador del cuestionario
-- ---------------------------------------------------------------------------
-- Idempotente sin recibir ningún id: hay **un solo borrador por organización** (índice
-- único parcial de 20270301100000), así que guardar dos veces actualiza el mismo. Es lo
-- que hace que contestar el formulario en dos ratos no deje dos cuestionarios a medias.
--
-- Guardar NO emite: el documento sale de `emitir_plan_basico()`.
create or replace function public.guardar_plan_basico(
  p_tipo_org   text,
  p_org        uuid,
  p_respuestas jsonb,
  p_idioma     text default 'ca',
  p_nivel      text default 'basic'
) returns planes_prevencion
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  pl planes_prevencion%rowtype;
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(p_tipo_org, p_org) then
    raise exception 'Aquesta organitzacio no es teva' using errcode = '42501';
  end if;
  if p_respuestas is null or jsonb_typeof(p_respuestas) <> 'object' then
    raise exception 'Les respostes han de ser un objecte JSON' using errcode = '22023';
  end if;

  update planes_prevencion
     set respuestas = p_respuestas,
         idioma     = coalesce(p_idioma, idioma),
         nivel      = coalesce(p_nivel, nivel)
   where estado = 'esborrany'
     and coalesce(productor_id, entidad_id) = p_org
  returning * into pl;

  if pl.id is not null then
    return pl;
  end if;

  insert into planes_prevencion (
    tipo_org, productor_id, entidad_id, nivel, respuestas, idioma, creado_por)
  values (
    p_tipo_org,
    case when p_tipo_org = 'productor' then p_org end,
    case when p_tipo_org = 'entidad'   then p_org end,
    coalesce(p_nivel, 'basic'), p_respuestas, coalesce(p_idioma, 'ca'), auth.uid())
  returning * into pl;

  return pl;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. emitir_plan_basico(): número, versión, documento y a descargar
-- ---------------------------------------------------------------------------
-- Devuelve el id del documento para que quien llama haga **polling** sobre
-- `documentos.estado` (`pendiente_fichero` → `emitido`) y ofrezca la descarga. No manda
-- ningún correo: `envio` es null (ver cabecera).
--
-- El plan anterior de la misma organización pasa a `substituit` **en esta transacción**:
-- no puede existir un instante con dos planes vigentes, ni uno con ninguno.
create or replace function public.emitir_plan_basico(p_plan uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  pl        planes_prevencion%rowtype;
  v_org     uuid;
  v_ej      int;
  v_n       int;
  v_version int;
  v_prev    uuid;
  v_doc     uuid;
begin
  select * into pl from planes_prevencion where id = p_plan for update;
  if pl.id is null then
    raise exception 'Aquest pla no existeix' using errcode = '22023';
  end if;
  if not public.puc_gestionar_pla(pl.tipo_org, coalesce(pl.productor_id, pl.entidad_id)) then
    raise exception 'Aquest pla no es teu' using errcode = '42501';
  end if;
  if pl.estado <> 'esborrany' then
    raise exception 'Aquest pla ja esta emes (%)', coalesce(pl.numero_completo, pl.id::text)
      using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(pl.respuestas -> 'respostes', '[]'::jsonb)) = 0 then
    raise exception 'No es pot emetre un pla sense cap resposta' using errcode = '22023';
  end if;

  v_org := coalesce(pl.productor_id, pl.entidad_id);

  -- El ejercicio es el año natural en hora de Madrid, como en toda la numeración.
  v_ej := extract(year from (now() at time zone 'Europe/Madrid'))::int;

  -- La versión del PLAN de esa organización: 1 el primero, 2 el siguiente diagnóstico.
  select coalesce(max(version), 0) + 1 into v_version
    from planes_prevencion
   where coalesce(productor_id, entidad_id) = v_org and estado <> 'esborrany';

  -- El vigente anterior, si lo hay.
  select id into v_prev
    from planes_prevencion
   where coalesce(productor_id, entidad_id) = v_org and vigente and id <> p_plan;

  if v_prev is not null then
    update planes_prevencion
       set vigente = false, estado = 'substituit'
     where id = v_prev;
  end if;

  v_n := public.siguiente_numero('PLA', v_ej);

  update planes_prevencion
     set serie           = 'PLA',
         ejercicio       = v_ej,
         numero          = v_n,
         numero_completo = public.formato_numero('PLA', v_ej, v_n),
         version         = v_version,
         estado          = 'emes',
         vigente         = true,
         emitido_at      = now(),
         emitido_por     = auth.uid()
   where id = p_plan
  returning * into pl;

  if v_prev is not null then
    update planes_prevencion set sustituido_por = p_plan where id = v_prev;
  end if;

  v_doc := public.plan_emet_document(p_plan);

  return jsonb_build_object(
    'pla', p_plan,
    'document', v_doc,
    'numero', pl.numero_completo,
    'versio', pl.version,
    'substitueix', v_prev,
    -- Lo que necesita quien llama para hacer el polling y ofrecer la descarga.
    'descarrega_immediata', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. ruta_documento(): la rama `plan` — la última que faltaba (deuda §12.50)
-- ---------------------------------------------------------------------------
-- Se recrea entera, como hicieron 20261012100500, 20261109100100 y 20270111100100 con las
-- suyas. El propietario del fichero es la organización diagnosticada:
--   PLA -> productors|entitats/<id>/<ejercicio>/PLA/<numero>-vN.pdf
--
-- El CT **no necesita rama propia**: sus documentos son `objeto_tipo = 'cierre_donante'`
-- (ver 20270301100100), así que ya los resolvía la rama del cierre; la carpeta sale de
-- `p_tipo`, o sea `CT/`.
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
    -- Vale igual para el CD y para el CT: el propietario es la organización de la fila.
    select 'productors/' || cd.productor_id::text into v_org
      from cierres_donante cd where cd.id = p_objeto_id;

  elsif p_objeto_tipo = 'convenio' then
    select case cv.tipo_org
             when 'productor' then 'productors/' || cv.productor_id::text
             else                  'entitats/'   || cv.entidad_id::text
           end
      into v_org
      from convenios cv where cv.id = p_objeto_id;

  elsif p_objeto_tipo = 'plan' then
    select case pl.tipo_org
             when 'productor' then 'productors/' || pl.productor_id::text
             else                  'entitats/'   || pl.entidad_id::text
           end
      into v_org
      from planes_prevencion pl where pl.id = p_objeto_id;
  end if;

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

comment on function public.ruta_documento(text, uuid, text, text, int, text, int) is
  'Carpeta y nombre del PDF dentro del bucket. Cubre los seis objeto_tipo: albaran, espigolada, cierre_donante, convenio, plan y prova.';

-- ---------------------------------------------------------------------------
-- 7. documents_meus(): la organización ve también SU plan
-- ---------------------------------------------------------------------------
-- El CT tampoco necesita nada aquí: es `objeto_tipo = 'cierre_donante'` y ya lo cubre
-- `cierres_donante_meus()`, con la misma regla de siempre (los de modo prueba, solo si la
-- ficha es `es_test`).
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
            and d.objeto_id in (select public.convenios_meus(v_user)))
        or (d.objeto_tipo = 'plan'
            and d.objeto_id in (select public.planes_meus(v_user)));
end;
$$;

comment on function public.documents_meus(uuid) is
  'Ids de documentos que ve una cuenta externa: albaranes, cierres (CD y CT), convenios y planes de sus organizaciones.';

-- ---------------------------------------------------------------------------
-- 8. EXECUTE: quitar el PUBLIC por defecto
-- ---------------------------------------------------------------------------
-- `plan_emet_document` es interna: la llama `emitir_plan_basico`, que ya comprueba el
-- permiso. Concedérsela a `authenticated` permitiría insertar un documento en `documentos`
-- saltándose esa comprobación, que es justo lo que la ausencia de GRANT de escritura
-- impide.
revoke execute on function public.plan_emet_document(uuid) from public, anon, authenticated;
grant  execute on function public.plan_emet_document(uuid) to service_role;

revoke execute on function public.plan_datos(uuid)                  from public, anon;
revoke execute on function public.puc_gestionar_pla(text, uuid)     from public, anon;
revoke execute on function public.guardar_plan_basico(text, uuid, jsonb, text, text) from public, anon;
revoke execute on function public.emitir_plan_basico(uuid)          from public, anon;

grant execute on function public.plan_datos(uuid)                   to authenticated, service_role;
grant execute on function public.puc_gestionar_pla(text, uuid)      to authenticated, service_role;
grant execute on function public.guardar_plan_basico(text, uuid, jsonb, text, text) to authenticated, service_role;
grant execute on function public.emitir_plan_basico(uuid)           to authenticated, service_role;

-- `ruta_documento` y `documents_meus` se recrean con `create or replace`: conservan los
-- privilegios que ya tenían (20260928100800 / 20261012100500).

-- Verificación:
--   select public.guardar_plan_basico('productor', '<id>', '{"questionari":"basic","versio_questionari":0,"respostes":[{"id":"q1","valor":"x"}]}');
--   select public.emitir_plan_basico('<pla>');
--   select tipo, numero_completo, ruta, estado, envio from documentos where objeto_tipo = 'plan';
