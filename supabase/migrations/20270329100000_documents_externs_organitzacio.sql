-- Documentación que aporta el EQUIPO sobre una organización, y su descarga.
--
-- POR QUÉ. La Fundació llega a Redestina con papeles anteriores a la plataforma:
-- convenios firmados en papel, certificados de donación de ejercicios pasados, planes de
-- prevención hechos fuera. Hoy no hay dónde guardarlos: `documentos_externos` solo cuelga
-- de un albarán o de un cierre, y `documentos` es lo que Redestina EMITE —número de serie
-- propio, snapshot congelado y dos huellas—, así que meter ahí un papel de 2023 obligaría
-- a inventarle un snapshot y a quemarle un número de una serie legal de este año.
--
-- Esto va en `documentos_externos`, que es exactamente lo que es: un fichero de fuera, con
-- `numero` y `fecha` «del documento ajeno, tal como vienen impresos» (20261012100400).
--
-- 🔴 Y SE ARREGLA UNA INCOHERENCIA QUE YA ESTABA. Desde `20270111100100` la autorización
--    admite `objeto_tipo = 'convenio'` en las dos mitades —`puc_pujar_document_extern()`
--    (:1291) y la política de lectura (:1306)— pero **el CHECK de la columna nunca se
--    amplió**: un insert de convenio moría con `23514`. O sea que media pieza llevaba meses
--    puesta y no se podía usar. Aquí se cierra.
--
-- ⚠️ QUIÉN SUBE A UNA FICHA: solo el equipo. Un titular no aporta documentación a su
--    propia ficha —esto es archivo que aporta la Fundación sobre ella—, y dejarle subir
--    ahí convertiría un apartado de back office en un buzón abierto. Leer sí: la decisión
--    del 22-09-2026 es que la organización vea en su panel lo que se ha guardado de ella.

-- ---------------------------------------------------------------------------
-- 1. El vocabulario: dos objetos nuevos y tres tipos nuevos
-- ---------------------------------------------------------------------------
-- No se edita `20261012100400` (está aplicada, §7): se sustituye el check.
alter table documentos_externos drop constraint if exists documentos_externos_objeto_tipo_check;
alter table documentos_externos add constraint documentos_externos_objeto_tipo_check
  check (objeto_tipo in ('albaran', 'cierre_donante', 'convenio', 'productor', 'entidad'));

alter table documentos_externos drop constraint if exists documentos_externos_tipo_check;
alter table documentos_externos add constraint documentos_externos_tipo_check
  check (tipo in (
    'albaran_productor',   -- el albarán propio del generador (D2)
    'factura',             -- la factura del donante contra el resumen (fase 4)
    'foto_incidencia',     -- lo que adjunta quien confirma una entrega
    'conveni_signat',      -- el convenio firmado EN PAPEL, escaneado (20270329100100)
    'certificat_previ',    -- certificado fiscal de un ejercicio anterior a Redestina
    'pla_previ',           -- plan de prevención hecho fuera de la plataforma
    'altre'));

comment on column documentos_externos.objeto_tipo is
  'De qué cuelga: un albarán, un cierre, un convenio, o directamente la ficha (productor|entidad) cuando es archivo de la organización.';

-- ---------------------------------------------------------------------------
-- 2. `ruta_documento()`: dos ramas nuevas
-- ---------------------------------------------------------------------------
-- Se recrea ENTERA a partir de la versión viva (20260921223245, la del certificado de
-- recepción), como han hecho las seis migraciones anteriores con las suyas. Lo único nuevo
-- son los dos `elsif` del final: la carpeta ya se llamaba `productors/<id>` y
-- `entitats/<id>`, así que el archivo de una ficha cae donde ya está todo lo suyo.
--
-- ⚠️ El `select` sobre la tabla de fichas NO es decorativo: es lo que hace que un
--    `objeto_id` inventado acabe en `0A000` en vez de en una carpeta con un uuid que no es
--    de nadie. `documentos_externos` no tiene FK (es polimórfica), así que esta es la única
--    comprobación de que la ficha existe.
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
$$;

-- ---------------------------------------------------------------------------
-- 3. `ruta_documento_externo()`: los tres tipos nuevos en la lista blanca
-- ---------------------------------------------------------------------------
-- ⚠️ Esta lista NO es una duplicación del check de arriba por descuido: `p_tipo` acaba
--    DENTRO del nombre del fichero, así que un valor con `/` o con `..` sacaría el fichero
--    de la carpeta de su organización. Se valida donde se compone la ruta (20270304100000).
create or replace function public.ruta_documento_externo(
  p_objeto_tipo text,
  p_objeto_id   uuid,
  p_tipo        text,
  p_ejercicio   int,
  p_extension   text,
  p_modo        text default 'real'
) returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ext     text;
  v_base    text;
  v_carpeta text;
begin
  if p_tipo not in ('albaran_productor', 'factura', 'foto_incidencia',
                    'conveni_signat', 'certificat_previ', 'pla_previ', 'altre') then
    raise exception 'Tipus de document extern no valid: %', p_tipo using errcode = '22023';
  end if;

  v_ext := lower(coalesce(p_extension, ''));
  if v_ext not in ('pdf', 'jpg', 'png') then
    raise exception 'Extensio no acceptada: %', p_extension using errcode = '22023';
  end if;

  v_base    := public.ruta_documento(p_objeto_tipo, p_objeto_id, 'externs',
                                     'x', 1, coalesce(p_modo, 'real'), p_ejercicio);
  v_carpeta := regexp_replace(v_base, '[^/]+$', '');
  if v_carpeta = '' or v_carpeta = v_base then
    raise exception 'ruta_documento() no ha tornat cap carpeta per % (%)', p_objeto_tipo, p_tipo
      using errcode = '0A000';
  end if;

  return v_carpeta || gen_random_uuid()::text || '-' || p_tipo || '.' || v_ext;
end;
$$;

revoke execute on function public.ruta_documento_externo(text, uuid, text, int, text, text)
  from public, anon, authenticated;
grant  execute on function public.ruta_documento_externo(text, uuid, text, int, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Quién puede SUBIR: las dos ramas nuevas son solo del equipo
-- ---------------------------------------------------------------------------
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
  end if;
  -- `productor` y `entidad` caen aquí a propósito: el archivo de una ficha lo aporta el
  -- equipo, y el equipo ya ha salido arriba. Lo desconocido se niega.
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Quién puede VER: la organización ve lo suyo
-- ---------------------------------------------------------------------------
-- Subir y ver siguen siendo la misma regla salvo en las dos ramas nuevas, donde la
-- asimetría es el punto: el equipo escribe, la organización lee.
drop policy if exists "externs: intern o meus" on documentos_externos;
create policy "externs: intern o meus"
  on documentos_externos for select to authenticated
  using (
       (select public.es_intern())
    or (objeto_tipo = 'albaran'        and objeto_id in (select public.albarans_de_les_meves_orgs()))
    or (objeto_tipo = 'cierre_donante' and objeto_id in (select public.cierres_donante_meus()))
    or (objeto_tipo = 'convenio'       and objeto_id in (select public.convenios_meus()))
    or (objeto_tipo = 'productor'      and objeto_id in (select public.mis_productores()))
    or (objeto_tipo = 'entidad'        and objeto_id in (select public.mis_entidades()))
  );

-- ---------------------------------------------------------------------------
-- 6. `puc_veure_document_extern()`: la pieza que faltaba para poder ABRIRLOS
-- ---------------------------------------------------------------------------
-- 🔴 Hasta hoy un documento externo se subía, se listaba **y no se podía volver a abrir**:
--    `descargar-documento` solo sirve `documentos`, y `AlbaraDetall` pinta los externos
--    como texto sin botón. Guardar un certificado para que el productor lo tenga no sirve
--    de nada si nadie puede descargarlo, así que esta función es parte del mismo cambio.
--
-- Mismo molde que `puede_ver_documento()` (20260928100800): guarda anti-suplantación,
-- equipo por rol, fail-open del interruptor, y si no, la misma condición que la política.
--
-- ⚠️ `documentos_externos` no tiene columna `modo` —lo dice 20261012100400— así que el
--    modo prueba se reconoce por la RUTA, que es como ya lo hace `limpiar-documentos-prueba`.
--    Un externo de prueba no sale nunca de las manos del equipo, igual que un documento.
create or replace function public.puc_veure_document_extern(
  p_id   uuid,
  p_user uuid default null
) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
  -- ⚠️ Aquí NO se llama a `mis_productores()` / `mis_entidades()`: esas dos leen
  --    `auth.uid()` y no aceptan usuario, así que con `service_role` —que es como la llama
  --    la Edge Function, pasándole el uuid— devolverían vacío y un externo propio se vería
  --    como ajeno. Es el mismo motivo por el que `puc_pujar_document_extern` resuelve el
  --    equipo con un `exists` en vez de con `es_intern()` (20261109100400).
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
$$;

comment on function public.puc_veure_document_extern(uuid, uuid) is
  'Autoriza la descarga de un documento externo. Espejo de puede_ver_documento() para documentos_externos (20270329100000).';

revoke execute on function public.puc_veure_document_extern(uuid, uuid) from public, anon;
grant  execute on function public.puc_veure_document_extern(uuid, uuid) to authenticated, service_role;

-- Verificación:
--   select public.ruta_documento_externo('productor', '<id_fitxa>', 'certificat_previ', 2023, 'pdf');
--     -- productors/<id_fitxa>/2023/externs/<uuid>-certificat_previ.pdf
--   select public.ruta_documento_externo('entidad', gen_random_uuid(), 'pla_previ', 2024, 'pdf');
--     -- ERROR 0A000: no es pot resoldre el propietari
--   select has_function_privilege('authenticated',
--            'public.puc_veure_document_extern(uuid,uuid)', 'EXECUTE');   -- t
--   select has_table_privilege('authenticated','public.documentos_externos','INSERT');  -- f
