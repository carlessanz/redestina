-- Fase 3 del plan de los puntos 4-6 (cambio D4): documentos externos de una CANALIZACIÓN.
--
-- Una venta o una maquila ya no tienen albarán de Redestina (20270608100100). Sus documentos
-- propios —el albarán del productor, la factura, la foto de la recogida— cuelgan de la
-- canalización: `documentos_externos.objeto_tipo = 'canalizacion'`.
--
--   1. `documentos_externos_objeto_tipo_check` + `canalizacion` (superconjunto: `not valid` +
--      `validate`).
--   2. `canalitzacions_de_les_meves_orgs(p_user)` (nueva): función puente `security definer` que
--      devuelve las canalizaciones donde la organización del usuario es la productora (la de la
--      oferta, o la de su espigolada) o la receptora. Mismo patrón que `albarans_de_les_meves_orgs`:
--      preguntar por OTRA persona da 42501. EXECUTE para `authenticated` (la usa una política).
--   3. La política `"externs: intern o meus"`: rama `canalizacion`.
--   4-5. `puc_pujar_document_extern` y `puc_veure_document_extern`: rama `canalizacion` (las dos
--      partes suben y ven).
--   6. `ruta_documento`: una canalización va a la carpeta del productor (como el REC).
--   7. `borrar_una_fitxa`: los externos de las canalizaciones que se van con la ficha (§7: nunca
--      huérfanos), y sus ficheros a `fitxers_orfes`.
--
-- La Edge Function `subir-documento-externo` acepta `canalizacion` (agente `servidor`); se publica
-- DESPUÉS de esta migración.

-- ---------------------------------------------------------------------------
-- 1. El tipo de objeto
-- ---------------------------------------------------------------------------
alter table public.documentos_externos drop constraint if exists documentos_externos_objeto_tipo_check;
alter table public.documentos_externos add constraint documentos_externos_objeto_tipo_check
  check (objeto_tipo = any (array['albaran', 'cierre_donante', 'convenio', 'productor', 'entidad',
                                  'expedient', 'canalizacion'])) not valid;
alter table public.documentos_externos validate constraint documentos_externos_objeto_tipo_check;

-- ---------------------------------------------------------------------------
-- 2. `canalitzacions_de_les_meves_orgs()`
-- ---------------------------------------------------------------------------
create or replace function public.canalitzacions_de_les_meves_orgs(p_user uuid default null)
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
    raise exception 'No pots consultar les canalitzacions d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  return query
    with meves as (
      select m.productor_id, m.entidad_id
        from membresias m
        join perfiles p on p.id = m.user_id
       where m.user_id = v_user and m.activo and p.activo
    )
    select c.id
      from canalizaciones c
      join excedentes      e  on e.id  = c.excedente_id
      left join espigoladas es on es.id = e.espigolada_id
     where coalesce(e.productor_id, es.productor_id)
             in (select productor_id from meves where productor_id is not null)
        or c.entidad_id in (select entidad_id from meves where entidad_id is not null);
end;
$$;
revoke execute on function public.canalitzacions_de_les_meves_orgs(uuid) from public, anon;
grant  execute on function public.canalitzacions_de_les_meves_orgs(uuid) to authenticated, service_role;

comment on function public.canalitzacions_de_les_meves_orgs(uuid) is
  'Puente (20270608100400): canalizaciones donde la organización del usuario es productora o receptora. Para la RLS de documentos_externos (objeto_tipo canalizacion) y las comprobaciones de subir/ver.';

-- ---------------------------------------------------------------------------
-- 3. La política de lectura
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270329100000) con la rama nueva. Los helpers, envueltos en `(select …)`.
drop policy if exists "externs: intern o meus" on public.documentos_externos;
create policy "externs: intern o meus" on public.documentos_externos
  for select to authenticated
  using (
    (select public.es_intern())
    or (objeto_tipo = 'albaran'        and objeto_id in (select public.albarans_de_les_meves_orgs()))
    or (objeto_tipo = 'cierre_donante' and objeto_id in (select public.cierres_donante_meus()))
    or (objeto_tipo = 'convenio'       and objeto_id in (select public.convenios_meus()))
    or (objeto_tipo = 'productor'      and objeto_id in (select public.mis_productores()))
    or (objeto_tipo = 'entidad'        and objeto_id in (select public.mis_entidades()))
    -- 20270608100400:
    or (objeto_tipo = 'canalizacion'   and objeto_id in (select public.canalitzacions_de_les_meves_orgs()))
  );

-- ---------------------------------------------------------------------------
-- 4. `puc_pujar_document_extern`: rama `canalizacion` (copia de la vigente, 20261109100400)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.puc_pujar_document_extern(p_objeto_tipo text, p_objeto_id uuid, p_user uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid;
  v_equip boolean;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els permisos d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return false;
  end if;

  -- Por usuario y no por sesión (`es_intern()` mira la sesión), igual que 20261109100400:
  -- esta función la llama una Edge Function con `service_role` pasándole el uuid.
  v_equip := exists (select 1 from usuario_roles ur
                       join perfiles pe on pe.id = ur.user_id
                      where ur.user_id = v_user and pe.activo);
  if v_equip then
    return true;
  end if;

  if p_objeto_tipo = 'albaran' then
    return p_objeto_id in (select public.albarans_de_les_meves_orgs(v_user));
  elsif p_objeto_tipo = 'cierre_donante' then
    return p_objeto_id in (select public.cierres_donante_meus(v_user));
  elsif p_objeto_tipo = 'convenio' then
    return p_objeto_id in (select public.convenios_meus(v_user));
  elsif p_objeto_tipo = 'canalizacion' then
    -- 20270608100400: los documentos propios de una venta o maquila (sin albarán de Redestina)
    -- los aportan sus dos partes.
    return p_objeto_id in (select public.canalitzacions_de_les_meves_orgs(v_user));
  end if;
  -- `productor` y `entidad` caen aquí a propósito: el archivo de una ficha lo aporta el
  -- equipo, y el equipo ya ha salido arriba. Lo desconocido se niega.
  return false;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. `puc_veure_document_extern`: rama `canalizacion` (copia de la vigente, 20270425100000)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.puc_veure_document_extern(p_id uuid, p_user uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid;
  d      documentos_externos%rowtype;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots comprovar els permisos d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return false;
  end if;

  select * into d from documentos_externos where id = p_id;
  if d.id is null then
    return false;   -- no existe: se responde igual que «no puedes», sin filtrar nada
  end if;

  if exists (select 1
               from usuario_roles r
               join perfiles p on p.id = r.user_id
              where r.user_id = v_user and p.activo
                and r.rol in ('super_admin', 'admin', 'tecnic')) then
    return true;
  end if;

  if not public.roles_activos() then
    return exists (select 1 from perfiles p where p.id = v_user and p.activo);
  end if;

  if d.ruta like '%/proves/%' or d.ruta like 'proves/%' then
    return false;
  end if;

  if d.objeto_tipo = 'albaran' then
    return d.objeto_id in (select public.albarans_de_les_meves_orgs(v_user));
  elsif d.objeto_tipo = 'cierre_donante' then
    return d.objeto_id in (select public.cierres_donante_meus(v_user));
  elsif d.objeto_tipo = 'convenio' then
    return d.objeto_id in (select public.convenios_meus(v_user));
  elsif d.objeto_tipo = 'canalizacion' then
    -- 20270608100400: las dos partes de la canalización (venta o maquila sin albarán).
    return d.objeto_id in (select public.canalitzacions_de_les_meves_orgs(v_user));
  -- ⚠️ Aquí NO se llama a `mis_productores()` / `mis_entidades()`: esas dos leen
  --    `auth.uid()` y no aceptan usuario, así que con `service_role` —que es como la llama
  --    la Edge Function, pasándole el uuid— devolverían vacío y un externo propio se vería
  --    como ajeno. Es el mismo motivo por el que `puc_pujar_document_extern` resuelve el
  --    equipo con un `exists` en vez de con `es_intern()` (20261109100400).
  elsif d.objeto_tipo = 'expedient' then
    -- Fase 11: las evidencias del expediente las ve su organización (solo lectura).
    return d.objeto_id in (select public.expedients_meus(v_user));
  elsif d.objeto_tipo in ('productor', 'entidad') then
    return exists (
      select 1
        from membresias m
        join perfiles pe on pe.id = m.user_id
       where m.user_id = v_user and m.activo and pe.activo
         and ((d.objeto_tipo = 'productor' and m.productor_id = d.objeto_id)
           or (d.objeto_tipo = 'entidad'   and m.entidad_id   = d.objeto_id)));
  end if;
  return false;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. `ruta_documento`: rama `canalizacion` (copia de la vigente, 20270425100000)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ruta_documento(p_objeto_tipo text, p_objeto_id uuid, p_tipo text, p_numero_completo text, p_version integer, p_modo text, p_ejercicio integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  elsif p_objeto_tipo = 'canalizacion' then
    -- 20270608100400: los documentos externos de una canalización (venta o maquila sin albarán),
    -- en la carpeta del productor, como el REC.
    select 'productors/' || coalesce(e.productor_id, es.productor_id)::text into v_org
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
      left join espigoladas es on es.id = e.espigolada_id
     where c.id = p_objeto_id;

  elsif p_objeto_tipo = 'espigolada' then
    select 'productors/' || es.productor_id::text into v_org
      from espigoladas es where es.id = p_objeto_id;

  elsif p_objeto_tipo = 'cierre_donante' then
    -- Vale igual para el CD y para el CT: el propietario es la organización de la fila.
    select 'productors/' || cd.productor_id::text into v_org
      from cierres_donante cd where cd.id = p_objeto_id;

  elsif p_objeto_tipo = 'cierre_periodo' then
    select 'productors/' || cp.productor_id::text into v_org
      from cierres_periodo cp where cp.id = p_objeto_id;

  elsif p_objeto_tipo = 'cierre_receptor' then
    -- El único de la familia del cierre cuyo propietario es una ENTIDAD.
    select 'entitats/' || cr.entidad_id::text into v_org
      from cierres_receptor cr where cr.id = p_objeto_id;

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

  elsif p_objeto_tipo = 'expedient' then
    -- Fase 11: el expediente de prevención y sus evidencias, bajo su organización.
    select case ex.tipo_org
             when 'productor' then 'productors/' || ex.productor_id::text
             else                  'entitats/'   || ex.entidad_id::text
           end
      into v_org
      from expedients_prevencion ex where ex.id = p_objeto_id;

  elsif p_objeto_tipo = 'productor' then
    select 'productors/' || p.id::text into v_org
      from productores p where p.id = p_objeto_id;

  elsif p_objeto_tipo = 'entidad' then
    select 'entitats/' || e.id::text into v_org
      from entidades e where e.id = p_objeto_id;
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
$function$;

-- ---------------------------------------------------------------------------
-- 7. `borrar_una_fitxa`: los externos de sus canalizaciones (copia de la vigente, 20270526100000)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.borrar_una_fitxa(p_tipo text, p_ficha uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prod    uuid := case when p_tipo = 'productor' then p_ficha end;
  v_ent     uuid := case when p_tipo = 'entidad'   then p_ficha end;
  v_org     uuid;
  v_nom     text;
  v_tel     text;
  v_correu  text; -- 👈 nuevo: el correo de la ficha, para poder purgar la whitelist
  v_albs    uuid[];
  v_cans    uuid[];  -- 20270608100400: las canalizaciones que se van con la ficha
  v_convs   uuid[];
  v_exps    uuid[];
  v_fitxers text[];
  v_tracos  text[]; -- los trazos de firma de los enlaces que se borran (Storage, `evidencies/`)
  v_org_fora boolean := false;
  v_n       jsonb := '{}'::jsonb;
  c         int;
begin
  if p_tipo = 'productor' then
    select p.organizacion_id, coalesce(nullif(p.empresa, ''), p.name), p.phone, p.email
      into v_org, v_nom, v_tel, v_correu -- 👈 captura v_correu junto a v_nom/v_tel
      from productores p where p.id = p_ficha;
  else
    select e.organizacion_id, e.nombre, e.telefono, e.email
      into v_org, v_nom, v_tel, v_correu -- 👈 idem para entidades
      from entidades e where e.id = p_ficha;
  end if;

  -- `found` y no «el nombre es null»: una ficha puede tener el nombre vacío, pero si el
  -- `select` no ha traído fila es que no existe.
  if not found then
    raise exception 'fitxa_no_trobada: no hi ha cap % amb id %', p_tipo, p_ficha
      using errcode = '22023';
  end if;

  -- Los albaranes de esta ficha (todos en borrador: el paso 1 de la RPC ya lo garantizó).
  select coalesce(array_agg(a.id), '{}'::uuid[])
    into v_albs
    from albaranes a
   where a.excedente_id in (select id from excedentes where v_prod is not null and productor_id = v_prod)
      or a.espigolada_id in (select id from espigoladas where v_prod is not null and productor_id = v_prod)
      or a.canalizacion_id in (
           select c2.id from canalizaciones c2
            where (v_ent is not null and c2.entidad_id = v_ent)
               or (v_prod is not null and c2.excedente_id in
                     (select id from excedentes where productor_id = v_prod)));

  -- 20270608100400: las canalizaciones que se van (las de sus ofertas o las de la entidad): sus
  -- documentos externos (`objeto_tipo = 'canalizacion'`) son polimórficos y nadie los arrastraría.
  select coalesce(array_agg(c2.id), '{}'::uuid[])
    into v_cans
    from canalizaciones c2
   where (v_ent is not null and c2.entidad_id = v_ent)
      or (v_prod is not null and c2.excedente_id in
            (select id from excedentes where productor_id = v_prod));

  select coalesce(array_agg(c2.id), '{}'::uuid[])
    into v_convs
    from convenios c2
   where (v_prod is not null and c2.productor_id = v_prod)
      or (v_ent  is not null and c2.entidad_id   = v_ent);

  -- Los expedientes de prevención SIN número (deuda §12.140): los numerados bloquean en el paso 1.
  select coalesce(array_agg(x.id), '{}'::uuid[])
    into v_exps
    from expedients_prevencion x
   where ((v_prod is not null and x.productor_id = v_prod)
       or (v_ent  is not null and x.entidad_id   = v_ent))
     and x.numero_completo is null;

  -- Los ficheros que quedarán sin dueño en Storage. Se anotan ANTES de borrar la fila,
  -- que es la única oportunidad de saber su ruta. También las evidencias de los expedientes.
  select coalesce(array_agg(de.ruta), '{}'::text[])
    into v_fitxers
    from documentos_externos de
   where (de.objeto_tipo = 'albaran'   and de.objeto_id = any(v_albs))
      or (de.objeto_tipo = 'canalizacion' and de.objeto_id = any(v_cans))
      or (de.objeto_tipo = 'expedient' and de.objeto_id = any(v_exps))
      -- 20270526100000: el archivo previo de la ficha y los PDF subidos de sus convenios sin
      -- número (los convenios se van en CASCADE con la ficha; sus ficheros no se iban).
      or (de.objeto_tipo = p_tipo      and de.objeto_id = p_ficha)
      or (de.objeto_tipo = 'convenio'  and de.objeto_id = any(v_convs));

  -- Y los trazos de firma de los enlaces de esos albaranes y convenios: `evidencias` cae en
  -- CASCADE con el enlace, pero el PNG del trazo vive en Storage y nadie lo borraba.
  select coalesce(array_agg(ev.trazo_firma_ruta), '{}'::text[])
    into v_tracos
    from evidencias ev join enlaces_token et on et.id = ev.enlace_id
   where ev.trazo_firma_ruta is not null
     and ((et.objeto_tipo = 'albaran'  and et.objeto_id = any(v_albs))
       or (et.objeto_tipo = 'convenio' and et.objeto_id = any(v_convs)));
  v_fitxers := v_fitxers || v_tracos;

  -- (1) Lo que cuelga de los albaranes en borrador. `documentos_externos` y
  --     `enlaces_token` son POLIMÓRFICAS y no tienen FK, así que nadie las arrastraría:
  --     son exactamente el tipo de huérfano que la regla de §7 prohíbe.
  delete from documentos_externos where objeto_tipo = 'albaran' and objeto_id = any(v_albs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('documents_externs', c);

  delete from enlaces_token where objeto_tipo = 'albaran' and objeto_id = any(v_albs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('enllacos_albara', c);

  -- (1bis) 20270608100400: los documentos externos de sus canalizaciones (venta o maquila).
  delete from documentos_externos where objeto_tipo = 'canalizacion' and objeto_id = any(v_cans);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('documents_canalitzacio', c);

  -- (2) Los albaranes en borrador. `albaran_lineas` va en cascada; `albaranes_no_esborrar`
  --     es la red: si aquí se colara uno con número, aborta la transacción entera.
  delete from albaranes where id = any(v_albs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('albarans_esborrany', c);

  if p_tipo = 'productor' then
    -- (3) Las sesiones de intake ANTES que los excedentes: `intake_sessions.excedente_id`
    --     es `NO ACTION` y rechazaría el borrado del excedente.
    delete from intake_sessions s
     where s.productor_id = v_prod
        or s.excedente_id in (select id from excedentes where productor_id = v_prod)
        -- Por teléfono, con las últimas 9 cifras (§7: los móviles se guardan con y sin
        -- prefijo). ⚠️ El `length(...) >= 9` NO es decoración: sin él, una ficha con un
        -- teléfono a medias («612») compararía sus 3 cifras contra el final de CUALQUIER
        -- número y se llevaría por delante la sesión de intake de otro productor.
        or (s.telefono is not null
            and length(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g')) >= 9
            and right(regexp_replace(s.telefono, '\D', '', 'g'), 9)
              = right(regexp_replace(v_tel, '\D', '', 'g'), 9));
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('sessions_intake', c);

    -- (4) Las respuestas a sus ofertas. Caerían solas por la CASCADE de
    --     `oferta_respuestas.excedente_id`, pero se borran explícitamente para poder
    --     contarlas: un borrado que no dice cuánto se llevó no es auditable.
    delete from oferta_respuestas
     where excedente_id in (select id from excedentes where productor_id = v_prod);
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('respostes', c);

    -- (5) Las canalizaciones de sus ofertas. ⚠️ Aquí se pierde el reparto de esas ofertas
    --     tal como lo vio la entidad receptora; es operativo y va con la ficha, pero
    --     conviene saber que el receptor deja de ver esas entregas en su histórico.
    delete from canalizaciones
     where excedente_id in (select id from excedentes where productor_id = v_prod);
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('canalitzacions', c);

    delete from excedentes where productor_id = v_prod;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('ofertes', c);

    -- (6) Las jornadas de espigueo, ya sin registros ni REC.
    delete from espigoladas where productor_id = v_prod;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('espigolades', c);

    -- (7) Las fincas. Después de excedentes y espigoladas, que las referencian.
    delete from productor_ubicaciones where productor_id = v_prod;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('ubicacions', c);
  else
    delete from oferta_respuestas where entidad_id = v_ent;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('respostes', c);

    delete from canalizaciones where entidad_id = v_ent;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('canalitzacions', c);
  end if;

  -- (8) Los enlaces de firma de sus convenios. Los convenios se van en CASCADE con la
  --     ficha, pero sus enlaces son polimórficos y se quedarían señalando a la nada.
  --     `evidencias` cae en cascada desde el enlace.
  delete from enlaces_token where objeto_tipo = 'convenio' and objeto_id = any(v_convs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('enllacos_conveni', c);

  -- (8bis) Los expedientes de prevención sin número (deuda §12.140). Sus evidencias son
  --        `documentos_externos` polimórficos (nadie las arrastraría) y sus pestañas `pla_*` caen
  --        en CASCADE. Sin este paso, la FK `restrict` abortaba el borrado con un 23503.
  delete from documentos_externos where objeto_tipo = 'expedient' and objeto_id = any(v_exps);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('evidencies_expedient', c);
  delete from expedients_prevencion where id = any(v_exps);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('expedients', c);

  -- (8ter) 20270526100000: el archivo previo de la ficha (certificados y planes previos,
  --        otros) y los PDF subidos de sus convenios sin número. Polimórficos: nadie los
  --        arrastraba y se quedaban apuntando a una ficha que ya no existe.
  delete from documentos_externos where objeto_tipo = p_tipo and objeto_id = p_ficha;
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('arxiu_fitxa', c);
  delete from documentos_externos where objeto_tipo = 'convenio' and objeto_id = any(v_convs);
  get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('documents_conveni', c);

  -- (9) La ficha. Arrastra en CASCADE `convenios` (sin número), `membresias` —o sea que
  --     las cuentas de esa organización se quedan sin panel, que es lo que el panel avisa
  --     antes de preguntar— y `planes_prevencion` (sin número).
  if p_tipo = 'productor' then
    delete from productores where id = v_prod;
  else
    delete from entidades where id = v_ent;
  end if;
  get diagnostics c = row_count;
  if c = 0 then
    raise exception 'fitxa_no_trobada: no hi ha cap % amb id %', p_tipo, p_ficha
      using errcode = '22023';
  end if;

  -- (9bis) 👈 nuevo: la whitelist de correo de prueba (deuda §12.33). Solo coincidencia
  --        EXACTA con el correo que tenía la ficha, capturado arriba antes de borrarla —
  --        nunca toca `tecnologia@espigoladors.com`, que no cuelga de ninguna ficha.
  if v_correu is not null then
    delete from email_test_recipients where email = v_correu;
    get diagnostics c = row_count;
    v_n := v_n || jsonb_build_object('whitelist_correu', c);
  end if;

  -- (10) La organización, si se ha quedado sin ninguna ficha. Es el paso que hasta hoy se
  --      hacía «a mano» después de cada purga —las dos del 16-09-2026 tuvieron que
  --      retirarlas en un paso aparte— y el que convierte el borrado en completo: una
  --      organización sin fichas no la ve nadie y no la limpia nadie.
  if v_org is not null
     and not exists (select 1 from productores where organizacion_id = v_org)
     and not exists (select 1 from entidades   where organizacion_id = v_org)
     -- Un convenio que siguiera colgando de la organización la retiene: antes que borrar
     -- un documento de colaboración por el camino, se deja la organización y se dice.
     and not exists (select 1 from convenios   where organizacion_id = v_org) then
    -- 20270526100000: sus enlaces (la petición del consentimiento RGPD por correo) se iban
    -- quedando apuntando a la nada. El consentimiento dado sigue en `consentiments`
    -- (`enlace_id` pasa a null; la organización ya pasaba a null): es el registro legal.
    select coalesce(array_agg(ev.trazo_firma_ruta), '{}'::text[])
      into v_tracos
      from evidencias ev join enlaces_token et on et.id = ev.enlace_id
     where ev.trazo_firma_ruta is not null and et.objeto_tipo = 'organizacion' and et.objeto_id = v_org;
    v_fitxers := v_fitxers || v_tracos;
    delete from enlaces_token where objeto_tipo = 'organizacion' and objeto_id = v_org;
    get diagnostics c = row_count;  v_n := v_n || jsonb_build_object('enllacos_organitzacio', c);
    delete from organizaciones where id = v_org;
    v_org_fora := true;
  end if;

  -- (11) 20270526100000: los ficheros a la cola de Storage. La base no puede borrar un objeto
  --      (`storage.protect_objects_delete`); los borra el job diario `recordatorios-documentales`.
  --      Antes las rutas solo salían en `fitxers_orfes` del resultado y nadie las miraba.
  insert into fitxers_orfes (bucket, ruta, origen)
  select 'documentos', r, 'esborrat_fitxa:' || p_tipo
    from unnest(v_fitxers) r where r is not null and r <> ''
  on conflict (bucket, ruta) do nothing;

  return jsonb_build_object(
    'tipus',                 p_tipo,
    'id',                    p_ficha,
    'nom',                   v_nom,
    'organizacion_id',       v_org,
    'organitzacio_retirada', v_org_fora,
    'esborrat',              v_n,
    'fitxers_orfes',         to_jsonb(coalesce(v_fitxers, '{}'::text[]))
  );
end;
$function$;
