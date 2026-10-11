-- Fase 11 de la revisión del 08-10-2026: el Pla de Prevenció como EXPEDIENTE.
--
-- Lo que pidió la Fundació (§7): «El Pla de Prevenció hauria de funcionar com un expedient de
-- seguiment de l'empresa, no com un únic formulari» — y en una sección DISTINTA de «El meu
-- diagnòstic». El recorrido: diagnòstic inicial → visita tècnica → quantificació → anàlisi de
-- causes → pla d'accions → seguiment trimestral → verificació anual.
--
-- Qué hay:
--   · `expedients_prevencion` (uno abierto por organización) y siete tablas hijas: visites,
--     processos (y puntos críticos), quantificació, objectius, accions, seguiments (por
--     trimestre) y verificacions (anual). Lectura: el equipo y la propia organización (solo
--     lectura). SIN GRANT de escritura para nadie: todo entra por RPC.
--   · Abrir, verificar y cerrar un expediente, y exportarlo, es `pot_aprovar()`; registrar
--     visitas, procesos, cuantificación, acciones y seguimientos es del equipo (`es_intern()`).
--   · La cuantificación puede llenarse desde Redestina (canalizaciones conciliadas y destinos
--     registrados de la fase 1): `volcar_quantificacio_redestina()` a mano y un job mensual.
--   · Las evidencias son `documentos_externos` con `objeto_tipo = 'expedient'`.
--   · Exportar = un `documentos` tipo `PLA` sobre el expediente, numerado en la serie `PLA` la
--     primera vez y versionado después (el anterior queda `vigente = false`).
--
-- ⚠️ El modelo PPPMA del PDF final no ha llegado: el PDF lleva la estructura del Excel
--    «Estructura servicio planes de prevención» y se ajustará cuando llegue.
-- ⚠️ La FK a la ficha es `restrict` a propósito: `borrar_ficha_completa()` no conoce los
--    expedientes, y un expediente con su PDF emitido es documentación que no se borra. La base
--    rechaza el borrado (la «última red» de §4) hasta que esa función lo contemple.

create table public.expedients_prevencion (
  id                     uuid primary key default gen_random_uuid(),
  tipo_org               text not null check (tipo_org in ('productor', 'entidad')),
  productor_id           uuid references public.productores(id) on delete restrict,
  entidad_id             uuid references public.entidades(id) on delete restrict,
  nivell                 text not null default 'basic' check (nivell in ('basic', 'personalitzat')),
  estat                  text not null default 'obert'
                           check (estat in ('obert', 'en_seguiment', 'verificat', 'tancat')),
  tecnic_id              uuid references auth.users(id) on delete set null,
  data_inici             date not null default ((now() at time zone 'Europe/Madrid')::date),
  objectius_estrategics  text[] not null default '{}',
  context                text,
  equip                  jsonb not null default '[]' check (jsonb_typeof(equip) = 'array'),
  pla_id                 uuid references public.planes_prevencion(id) on delete set null,
  serie                  text,
  ejercicio              int,
  numero                 int,
  numero_completo        text unique,
  versio_document        int not null default 0,
  exportat_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references auth.users(id) on delete set null,
  constraint expedients_fk_excloent check (
    (tipo_org = 'productor' and productor_id is not null and entidad_id is null)
    or (tipo_org = 'entidad' and entidad_id is not null and productor_id is null))
);
create unique index expedients_un_obert
  on public.expedients_prevencion (coalesce(productor_id, entidad_id)) where estat <> 'tancat';

create table public.pla_visites (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.expedients_prevencion(id) on delete cascade,
  data date not null,
  tipus text not null default 'diagnosi' check (tipus in ('diagnosi', 'seguiment', 'verificacio', 'altres')),
  assistents text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create table public.pla_processos (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.expedients_prevencion(id) on delete cascade,
  nom text not null,
  descripcio text,
  punts_critics text,
  ordre int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create table public.pla_quantificacio (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.expedients_prevencion(id) on delete cascade,
  producte text,
  mes date not null,
  categoria text not null check (categoria in ('perdua', 'excedent', 'residu')),
  kg numeric not null check (kg >= 0),
  desti text,
  causa text,
  font text not null default 'manual' check (font in ('manual', 'redestina')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index pla_quantificacio_exp_mes on public.pla_quantificacio (expedient_id, mes);
create table public.pla_objectius (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.expedients_prevencion(id) on delete cascade,
  descripcio text not null,
  indicador text,
  valor_inicial numeric,
  valor_objectiu numeric,
  unitat text,
  data_objectiu date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create table public.pla_accions (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.expedients_prevencion(id) on delete cascade,
  objectiu_id uuid references public.pla_objectius(id) on delete set null,
  causa text,
  mesura text not null,
  responsable text,
  data_objectiu date,
  estat text not null default 'pendent' check (estat in ('pendent', 'en_curs', 'feta', 'descartada')),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create table public.pla_seguiments (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.expedients_prevencion(id) on delete cascade,
  trimestre text not null check (trimestre ~ '^[0-9]{4}-T[1-4]$'),
  data date,
  resum text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create table public.pla_verificacions (
  id uuid primary key default gen_random_uuid(),
  expedient_id uuid not null references public.expedients_prevencion(id) on delete cascade,
  "any" int not null check ("any" between 2020 and 2100),
  data date,
  resum text,
  conclusio text,
  verificat_per uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- Lectura: el equipo y la propia organización. Sin GRANT de escritura para nadie.
alter table public.expedients_prevencion enable row level security;
revoke all on public.expedients_prevencion from anon, authenticated;
grant select on public.expedients_prevencion to authenticated;
grant all on public.expedients_prevencion to service_role;
create policy "expedients: equip o propi" on public.expedients_prevencion
  for select to authenticated
  using ((select public.es_intern())
         or productor_id in (select public.mis_productores())
         or entidad_id in (select public.mis_entidades()));

do $$
declare
  t text;
begin
  foreach t in array array['pla_visites', 'pla_processos', 'pla_quantificacio', 'pla_objectius',
                           'pla_accions', 'pla_seguiments', 'pla_verificacions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    -- La subconsulta pasa por la RLS de `expedients_prevencion`: se ve lo de un expediente
    -- que se ve.
    execute format('create policy "%s: del meu expedient" on public.%I for select to authenticated
                      using (expedient_id in (select ex.id from public.expedients_prevencion ex))', t, t);
  end loop;
end $$;

-- El puente de los documentos y de las evidencias: los expedientes de las organizaciones de
-- una cuenta. Por usuario (no por sesión), como `planes_meus`, porque lo llaman Edge
-- Functions con `service_role` pasándole el uuid.
create or replace function public.expedients_meus(p_user uuid default null)
 returns setof uuid
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els expedients d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;
  return query
    select ex.id
      from expedients_prevencion ex
     where ex.productor_id in (select m.productor_id from membresias m
                                where m.user_id = v_user and m.activo and m.tipo = 'productor')
        or ex.entidad_id   in (select m.entidad_id from membresias m
                                where m.user_id = v_user and m.activo and m.tipo = 'entidad');
end;
$function$;
revoke execute on function public.expedients_meus(uuid) from public, anon;
grant execute on function public.expedients_meus(uuid) to authenticated, service_role;

-- Los documentos y las evidencias admiten el expediente.
alter table public.documentos drop constraint documentos_objeto_tipo_check;
alter table public.documentos add constraint documentos_objeto_tipo_check check (objeto_tipo = any (array[
  'albaran', 'convenio', 'cierre_donante', 'cierre_periodo', 'cierre_receptor', 'espigolada',
  'plan', 'prova', 'expedient']));
alter table public.documentos_externos drop constraint documentos_externos_objeto_tipo_check;
alter table public.documentos_externos add constraint documentos_externos_objeto_tipo_check check (objeto_tipo = any (array[
  'albaran', 'cierre_donante', 'convenio', 'productor', 'entidad', 'expedient']));
alter table public.documentos_externos drop constraint documentos_externos_tipo_check;
alter table public.documentos_externos add constraint documentos_externos_tipo_check check (tipo = any (array[
  'albaran_productor', 'factura', 'foto_incidencia', 'conveni_signat', 'certificat_previ',
  'pla_previ', 'evidencia', 'altre']));

CREATE OR REPLACE FUNCTION public.documents_meus(p_user uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        or (d.objeto_tipo = 'cierre_periodo'
            and d.objeto_id in (select public.cierres_periodo_meus(v_user)))
        or (d.objeto_tipo = 'cierre_receptor'
            and d.objeto_id in (select public.cierres_receptor_meus(v_user)))
        or (d.objeto_tipo = 'convenio'
            and d.objeto_id in (select public.convenios_meus(v_user)))
        or (d.objeto_tipo = 'plan'
            and d.objeto_id in (select public.planes_meus(v_user)))
        -- Fase 11: el PDF del expediente de prevención de mis organizaciones.
        or (d.objeto_tipo = 'expedient'
            and d.objeto_id in (select public.expedients_meus(v_user)));
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.ruta_documento_externo(p_objeto_tipo text, p_objeto_id uuid, p_tipo text, p_ejercicio integer, p_extension text, p_modo text DEFAULT 'real'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ext     text;
  v_base    text;
  v_carpeta text;
begin
  if p_tipo not in ('albaran_productor', 'factura', 'foto_incidencia',
                    'conveni_signat', 'certificat_previ', 'pla_previ', 'evidencia', 'altre') then
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
$function$;

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

CREATE OR REPLACE FUNCTION public.trg_documentos_objeto_existe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tabla  text;
  v_existe boolean;
begin
  if new.objeto_tipo = 'prova' then
    return new;
  end if;

  v_tabla := case new.objeto_tipo
               when 'albaran'         then 'albaranes'
               when 'convenio'        then 'convenios'
               when 'cierre_donante'  then 'cierres_donante'
               when 'cierre_periodo'  then 'cierres_periodo'
               when 'cierre_receptor' then 'cierres_receptor'
               when 'espigolada'      then 'espigoladas'
               when 'plan'            then 'planes_prevencion'
               when 'expedient'       then 'expedients_prevencion'
             end;

  if to_regclass('public.' || v_tabla) is null then
    raise exception 'Encara no existeix la taula %: no es pot emetre cap document de tipus %',
      v_tabla, new.objeto_tipo using errcode = '0A000';
  end if;

  execute format('select exists (select 1 from public.%I where id = $1)', v_tabla)
    into v_existe using new.objeto_id;

  if not v_existe then
    raise exception 'No existeix cap % amb id %', new.objeto_tipo, new.objeto_id
      using errcode = '23503';
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Las RPC del expediente
-- ---------------------------------------------------------------------------

-- Abrir un expediente: decisión de servicio, `pot_aprovar()`. Solo productores: el receptor
-- no tiene plan de prevención (fase 9). Se enlaza el plan básico de la organización si lo hay.
create or replace function public.obrir_expedient(p_tipo_org text, p_org uuid, p_nivell text default 'basic')
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id  uuid;
  v_pla uuid;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Obrir un expedient de prevencio es de l''admin' using errcode = '42501';
  end if;
  if p_tipo_org is distinct from 'productor' then
    raise exception 'nomes_productors: el pla de prevencio es de les entitats productores' using errcode = '22023';
  end if;
  if p_nivell not in ('basic', 'personalitzat') then
    raise exception 'nivell_desconegut' using errcode = '22023';
  end if;
  if not exists (select 1 from productores where id = p_org) then
    raise exception 'fitxa_inexistent' using errcode = '22023';
  end if;
  if exists (select 1 from expedients_prevencion
              where productor_id = p_org and estat <> 'tancat') then
    raise exception 'ja_te_expedient: aquesta organitzacio ja te un expedient obert' using errcode = '22023';
  end if;

  select id into v_pla from planes_prevencion
   where productor_id = p_org and (vigente or estado = 'esborrany')
   order by vigente desc, created_at desc limit 1;

  insert into expedients_prevencion (tipo_org, productor_id, nivell, tecnic_id, pla_id, created_by)
  values ('productor', p_org, p_nivell, auth.uid(), v_pla, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

-- Los datos de la cabecera. Lo del día a día es del equipo; el nivel (que es un servicio
-- contratado) y los estados de cierre, de `pot_aprovar()` por sus propias RPC.
create or replace function public.desar_expedient(p_id uuid, p_dades jsonb)
 returns public.expedients_prevencion
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  ex expedients_prevencion;
  d  jsonb := coalesce(p_dades, '{}'::jsonb);
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'L''expedient el porta l''equip' using errcode = '42501';
  end if;
  select * into ex from expedients_prevencion where id = p_id for update;
  if ex.id is null then
    raise exception 'expedient_inexistent' using errcode = '22023';
  end if;
  if ex.estat = 'tancat' then
    raise exception 'expedient_tancat' using errcode = '22023';
  end if;
  if d ? 'nivell' and d ->> 'nivell' is distinct from ex.nivell
     and auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Canviar el nivell del pla es de l''admin' using errcode = '42501';
  end if;
  if d ? 'estat' and d ->> 'estat' not in ('obert', 'en_seguiment') then
    raise exception 'estat_no_permes: verificar i tancar tenen la seva accio' using errcode = '22023';
  end if;
  if d ? 'equip' and jsonb_typeof(d -> 'equip') <> 'array' then
    raise exception 'equip ha de ser una llista' using errcode = '22023';
  end if;

  update expedients_prevencion set
    nivell     = case when d ? 'nivell' then d ->> 'nivell' else nivell end,
    estat      = case when d ? 'estat' then d ->> 'estat' else estat end,
    tecnic_id  = case when d ? 'tecnic_id' then nullif(d ->> 'tecnic_id', '')::uuid else tecnic_id end,
    data_inici = case when d ? 'data_inici' then coalesce(nullif(d ->> 'data_inici', '')::date, data_inici) else data_inici end,
    objectius_estrategics = case when d ? 'objectius_estrategics'
      then coalesce(array(select jsonb_array_elements_text(d -> 'objectius_estrategics')), '{}') else objectius_estrategics end,
    context    = case when d ? 'context' then nullif(trim(d ->> 'context'), '') else context end,
    equip      = case when d ? 'equip' then d -> 'equip' else equip end,
    updated_at = now()
  where id = p_id
  returning * into ex;
  return ex;
end;
$function$;

-- Las columnas que cada tabla hija acepta: la lista blanca de `desar_element_expedient`.
create or replace function public.columnes_element_expedient(p_taula text)
 returns text[]
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select case p_taula
    when 'pla_visites'       then array['data', 'tipus', 'assistents', 'notes']
    when 'pla_processos'     then array['nom', 'descripcio', 'punts_critics', 'ordre']
    when 'pla_quantificacio' then array['producte', 'mes', 'categoria', 'kg', 'desti', 'causa']
    when 'pla_objectius'     then array['descripcio', 'indicador', 'valor_inicial', 'valor_objectiu', 'unitat', 'data_objectiu']
    when 'pla_accions'       then array['objectiu_id', 'causa', 'mesura', 'responsable', 'data_objectiu', 'estat', 'notes']
    when 'pla_seguiments'    then array['trimestre', 'data', 'resum', 'notes']
  end;
$function$;

-- Alta o edición de un elemento del expediente. Genérica sobre una lista blanca: las
-- columnas salen de `columnes_element_expedient`, nunca del cliente, y los valores se tipan
-- con `jsonb_populate_record` (un texto donde va un número da 22P02, no se guarda torcido).
-- ⚠️ Las verificaciones no van por aquí: tienen su RPC (`verificar_expedient`, pot_aprovar).
create or replace function public.desar_element_expedient(p_taula text, p_expedient uuid,
  p_id uuid, p_dades jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  ex     expedients_prevencion;
  v_cols text[];
  v_list text;
  v_id   uuid;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'L''expedient el porta l''equip' using errcode = '42501';
  end if;
  v_cols := public.columnes_element_expedient(p_taula);
  if v_cols is null then
    raise exception 'taula_desconeguda: %', p_taula using errcode = '22023';
  end if;
  select * into ex from expedients_prevencion where id = p_expedient;
  if ex.id is null then
    raise exception 'expedient_inexistent' using errcode = '22023';
  end if;
  if ex.estat = 'tancat' then
    raise exception 'expedient_tancat' using errcode = '22023';
  end if;
  if p_dades is null or jsonb_typeof(p_dades) <> 'object' then
    raise exception 'dades_invalides' using errcode = '22023';
  end if;
  if p_taula = 'pla_accions' and nullif(p_dades ->> 'objectiu_id', '') is not null
     and not exists (select 1 from pla_objectius o
                      where o.id = (p_dades ->> 'objectiu_id')::uuid and o.expedient_id = p_expedient) then
    raise exception 'objectiu_alie' using errcode = '22023';
  end if;

  -- Solo las columnas que llegan: en una edición, lo que no se manda no se toca.
  select string_agg(format('%I', c), ', ') into v_list
    from unnest(v_cols) c where p_dades ? c;
  if v_list is null and p_id is null then
    raise exception 'dades_invalides: cap camp' using errcode = '22023';
  end if;

  if p_id is null then
    execute format(
      'insert into public.%I (expedient_id, created_by, %s) select $1, $2, %s from jsonb_populate_record(null::public.%I, $3) returning id',
      p_taula, v_list, v_list, p_taula)
      using p_expedient, auth.uid(), p_dades into v_id;
  else
    if v_list is null then
      return p_id;
    end if;
    execute format(
      'update public.%I t set (%s) = (select %s from jsonb_populate_record(t, $3)) where t.id = $1 and t.expedient_id = $2 returning t.id',
      p_taula, v_list, v_list)
      using p_id, p_expedient, p_dades into v_id;
    if v_id is null then
      raise exception 'element_inexistent' using errcode = '22023';
    end if;
  end if;

  update expedients_prevencion set updated_at = now() where id = p_expedient;
  return v_id;
end;
$function$;

create or replace function public.esborrar_element_expedient(p_taula text, p_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_exp uuid;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'L''expedient el porta l''equip' using errcode = '42501';
  end if;
  if public.columnes_element_expedient(p_taula) is null then
    raise exception 'taula_desconeguda: %', p_taula using errcode = '22023';
  end if;
  execute format('select expedient_id from public.%I where id = $1', p_taula) using p_id into v_exp;
  if v_exp is null then
    raise exception 'element_inexistent' using errcode = '22023';
  end if;
  if exists (select 1 from expedients_prevencion where id = v_exp and estat = 'tancat') then
    raise exception 'expedient_tancat' using errcode = '22023';
  end if;
  execute format('delete from public.%I where id = $1', p_taula) using p_id;
  update expedients_prevencion set updated_at = now() where id = v_exp;
  return true;
end;
$function$;

-- La cuantificación que ya sabe Redestina: los kilos conciliados de sus ofertas (por mes,
-- producto y modalidad) y los destinos que la productora ha registrado (fase 1). Sustituye
-- las filas `redestina` del periodo; las manuales no se tocan.
create or replace function public.volcar_quantificacio_redestina(p_expedient uuid, p_desde date, p_hasta date)
 returns int
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  ex   expedients_prevencion;
  v_n  int;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'L''expedient el porta l''equip' using errcode = '42501';
  end if;
  select * into ex from expedients_prevencion where id = p_expedient;
  if ex.id is null then
    raise exception 'expedient_inexistent' using errcode = '22023';
  end if;
  if ex.productor_id is null then
    return 0;
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'periode_invalid' using errcode = '22023';
  end if;

  delete from pla_quantificacio
   where expedient_id = p_expedient and font = 'redestina'
     and mes between date_trunc('month', p_desde)::date and p_hasta;

  insert into pla_quantificacio (expedient_id, producte, mes, categoria, kg, desti, causa, font, created_by)
  select p_expedient, x.producte, x.mes, 'excedent', x.kg, x.desti, x.causa, 'redestina', auth.uid()
    from (
      select ex2.producto as producte,
             date_trunc('month', (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
                                   at time zone 'Europe/Madrid'))::date as mes,
             sum(coalesce(c.kg_conciliados, c.kg_reales, c.kg_confirmados, 0)) as kg,
             'Redestina · ' || coalesce(c.valorizacion, 'donacio') as desti,
             max(ex2.causa) as causa
        from canalizaciones c
        join excedentes ex2 on ex2.id = c.excedente_id
       where c.estado = 'conciliada' and ex2.productor_id = ex.productor_id
         and (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at) at time zone 'Europe/Madrid')::date
             between p_desde and p_hasta
       group by 1, 2, 4
      union all
      select ex2.producto,
             date_trunc('month', coalesce(d.data, (d.created_at at time zone 'Europe/Madrid')::date))::date,
             sum(d.kg),
             coalesce(df.nom_ca, d.desti_codi),
             max(ex2.causa)
        from excedente_destins d
        join excedentes ex2 on ex2.id = d.excedente_id
        left join destins_finals df on df.codi = d.desti_codi
       where ex2.productor_id = ex.productor_id
         and coalesce(d.data, (d.created_at at time zone 'Europe/Madrid')::date) between p_desde and p_hasta
       group by 1, 2, 4
    ) x
   where x.kg > 0;
  get diagnostics v_n = row_count;
  update expedients_prevencion set updated_at = now() where id = p_expedient;
  return v_n;
end;
$function$;

-- El job mensual: el mes anterior de cada expediente abierto. Solo `service_role`.
create or replace function public.volcar_quantificacio_expedients()
 returns int
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  r     record;
  v_tot int := 0;
  v_ini date := (date_trunc('month', (now() at time zone 'Europe/Madrid')) - interval '1 month')::date;
  v_fi  date := (date_trunc('month', (now() at time zone 'Europe/Madrid')) - interval '1 day')::date;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor' using errcode = '42501';
  end if;
  for r in select id from expedients_prevencion where estat <> 'tancat' and productor_id is not null loop
    v_tot := v_tot + public.volcar_quantificacio_redestina(r.id, v_ini, v_fi);
  end loop;
  return v_tot;
end;
$function$;

-- Verificar (anual) y cerrar: decisiones de servicio, `pot_aprovar()`.
create or replace function public.verificar_expedient(p_id uuid, p_any int, p_resum text, p_conclusio text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  ex   expedients_prevencion;
  v_id uuid;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Verificar un expedient es de l''admin' using errcode = '42501';
  end if;
  select * into ex from expedients_prevencion where id = p_id for update;
  if ex.id is null then
    raise exception 'expedient_inexistent' using errcode = '22023';
  end if;
  if ex.estat = 'tancat' then
    raise exception 'expedient_tancat' using errcode = '22023';
  end if;
  if p_any is null or p_any < 2020 or p_any > 2100 then
    raise exception 'any_invalid' using errcode = '22023';
  end if;
  insert into pla_verificacions (expedient_id, "any", data, resum, conclusio, verificat_per, created_by)
  values (p_id, p_any, (now() at time zone 'Europe/Madrid')::date, nullif(trim(p_resum), ''),
          nullif(trim(p_conclusio), ''), auth.uid(), auth.uid())
  returning id into v_id;
  update expedients_prevencion set estat = 'verificat', updated_at = now() where id = p_id;
  return v_id;
end;
$function$;

create or replace function public.tancar_expedient(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Tancar un expedient es de l''admin' using errcode = '42501';
  end if;
  update expedients_prevencion set estat = 'tancat', updated_at = now()
   where id = p_id and estat <> 'tancat';
  if not found then
    raise exception 'expedient_inexistent_o_tancat' using errcode = '22023';
  end if;
end;
$function$;

-- El snapshot del PDF. Solo `service_role` (lo llama `exportar_expedient`, definer): lleva
-- todo el expediente, igual que `plan_datos()`.
create or replace function public.expedient_datos(p_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  ex    expedients_prevencion;
  par   parametros_documentales%rowtype;
  v_org jsonb;
  pl    planes_prevencion%rowtype;
begin
  select * into ex from expedients_prevencion where id = p_id;
  if ex.id is null then
    raise exception 'expedient_inexistent' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;
  select jsonb_build_object('tipus', 'productor', 'nom', coalesce(pr.empresa, pr.name),
                            'rao_social', pr.razon_social, 'nif', pr.nif, 'poblacio', pr.poblacion,
                            'comarca', pr.area_geografica, 'email', pr.email)
    into v_org from productores pr where pr.id = ex.productor_id;
  select * into pl from planes_prevencion where id = ex.pla_id;

  return jsonb_build_object(
    'format', 'expedient',
    'tipus', 'PLA',
    'nivell', ex.nivell,
    'estat', ex.estat,
    'numero', ex.numero_completo,
    'versio', ex.versio_document,
    'exercici', ex.ejercicio,
    'data_generacio', now(),
    'data_inici', ex.data_inici,
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'organitzacio', v_org,
    'tecnic', (select coalesce(p.nombre, p.email) from perfiles p where p.id = ex.tecnic_id),
    'objectius_estrategics', to_jsonb(ex.objectius_estrategics),
    'context', ex.context,
    'equip', ex.equip,
    'mesures_pla_basic', coalesce(pl.mesures -> 'llista', '[]'::jsonb),
    'visites', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.data)
                           from pla_visites v where v.expedient_id = p_id), '[]'::jsonb),
    'processos', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.ordre, v.created_at)
                             from pla_processos v where v.expedient_id = p_id), '[]'::jsonb),
    'quantificacio', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.mes, v.producte)
                                 from pla_quantificacio v where v.expedient_id = p_id), '[]'::jsonb),
    'objectius', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.created_at)
                             from pla_objectius v where v.expedient_id = p_id), '[]'::jsonb),
    'accions', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.data_objectiu nulls last, v.created_at)
                           from pla_accions v where v.expedient_id = p_id), '[]'::jsonb),
    'seguiments', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' order by v.trimestre)
                              from pla_seguiments v where v.expedient_id = p_id), '[]'::jsonb),
    'verificacions', coalesce((select jsonb_agg(to_jsonb(v) - 'expedient_id' - 'created_by' - 'verificat_per' order by v."any")
                                 from pla_verificacions v where v.expedient_id = p_id), '[]'::jsonb));
end;
$function$;

-- Exportar: el PDF del expediente, como `documentos` tipo PLA sobre el expediente. Número de
-- la serie `PLA` la primera vez; después, versión siguiente del mismo número (el anterior
-- queda `vigente = false`, como un plan sustituido). Se descarga al momento (envio null).
create or replace function public.exportar_expedient(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  ex      expedients_prevencion;
  v_ej    int;
  v_n     int;
  v_prev  uuid;
  v_doc   uuid;
  v_datos jsonb;
  v_idioma text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Exportar el pla de prevencio es de l''admin' using errcode = '42501';
  end if;
  select * into ex from expedients_prevencion where id = p_id for update;
  if ex.id is null then
    raise exception 'expedient_inexistent' using errcode = '22023';
  end if;

  if ex.numero_completo is null then
    v_ej := extract(year from (now() at time zone 'Europe/Madrid'))::int;
    v_n  := public.siguiente_numero('PLA', v_ej);
    update expedients_prevencion
       set serie = 'PLA', ejercicio = v_ej, numero = v_n,
           numero_completo = public.formato_numero('PLA', v_ej, v_n)
     where id = p_id
    returning * into ex;
  end if;

  update expedients_prevencion
     set versio_document = versio_document + 1, exportat_at = now(), updated_at = now()
   where id = p_id
  returning * into ex;

  select id into v_prev from documentos
   where objeto_tipo = 'expedient' and objeto_id = p_id and tipo = 'PLA' and vigente;
  if v_prev is not null then
    update documentos set vigente = false where id = v_prev;
  end if;

  v_datos := public.expedient_datos(p_id);
  select coalesce(pl.idioma, 'ca') into v_idioma from planes_prevencion pl where pl.id = ex.pla_id;

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos, ruta, envio, emitido_por
  ) values (
    'PLA', 'emes', 'expedient', p_id,
    ex.numero_completo, ex.versio_document, ex.serie, ex.ejercicio,
    'real', coalesce(v_idioma, 'ca'), null, v_datos,
    encode(sha256(convert_to(v_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('expedient', p_id, 'PLA', ex.numero_completo, ex.versio_document, 'real', ex.ejercicio),
    null, auth.uid()
  ) returning id into v_doc;

  if v_prev is not null then
    update documentos set sustituido_por = v_doc where id = v_prev;
  end if;

  return jsonb_build_object('document', v_doc, 'numero', ex.numero_completo, 'versio', ex.versio_document,
                            'descarrega_immediata', true);
end;
$function$;

-- GRANT: las que llama el panel, a `authenticated`; las internas, solo al servidor.
revoke execute on function public.obrir_expedient(text, uuid, text) from public, anon;
revoke execute on function public.desar_expedient(uuid, jsonb) from public, anon;
revoke execute on function public.desar_element_expedient(text, uuid, uuid, jsonb) from public, anon;
revoke execute on function public.esborrar_element_expedient(text, uuid) from public, anon;
revoke execute on function public.volcar_quantificacio_redestina(uuid, date, date) from public, anon;
revoke execute on function public.verificar_expedient(uuid, int, text, text) from public, anon;
revoke execute on function public.tancar_expedient(uuid) from public, anon;
revoke execute on function public.exportar_expedient(uuid) from public, anon;
grant execute on function public.obrir_expedient(text, uuid, text) to authenticated, service_role;
grant execute on function public.desar_expedient(uuid, jsonb) to authenticated, service_role;
grant execute on function public.desar_element_expedient(text, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.esborrar_element_expedient(text, uuid) to authenticated, service_role;
grant execute on function public.volcar_quantificacio_redestina(uuid, date, date) to authenticated, service_role;
grant execute on function public.verificar_expedient(uuid, int, text, text) to authenticated, service_role;
grant execute on function public.tancar_expedient(uuid) to authenticated, service_role;
grant execute on function public.exportar_expedient(uuid) to authenticated, service_role;
revoke execute on function public.volcar_quantificacio_expedients() from public, anon, authenticated;
revoke execute on function public.expedient_datos(uuid) from public, anon, authenticated;
revoke execute on function public.columnes_element_expedient(text) from public, anon;
grant execute on function public.volcar_quantificacio_expedients() to service_role;
grant execute on function public.expedient_datos(uuid) to service_role;

-- El job: el día 1 de cada mes, la cuantificación del mes anterior.
select cron.schedule('quantificacio-expedients', '15 5 1 * *', 'select public.volcar_quantificacio_expedients()');
