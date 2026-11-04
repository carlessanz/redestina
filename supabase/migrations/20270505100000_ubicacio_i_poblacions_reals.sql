-- Població real, àrea editable i «Ubicació» (04-11-2026).
--
-- POR QUÉ. En la ficha, «Població» y «Àrea geogràfica» salían de solo lectura y la población
-- podía ser cualquier texto: en una ficha ponía «Mercabarna», que no es un municipio sino un
-- lugar dentro de uno. Carles pide que la población sea SIEMPRE un municipio de verdad, que
-- población y área se puedan editar, y un campo aparte para lugares como Mercabarna.
--
-- QUÉ HACE.
--   1. `ubicacio` (≤120) en `productores` y `entidades`: el lugar que no es un municipio
--      (Mercabarna, un polígono, un mercado…).
--   2. `poblacion` deja de ser texto libre: el trigger `trg_fitxa_municipi()` la deriva SIEMPRE
--      del municipio (`municipio_ine`). Un texto que llega sin municipio (el registro público,
--      la importación, un dato de antes) se casa con la lista oficial; si no casa, NO se pierde:
--      pasa a `ubicacio` y la población queda vacía hasta que alguien elija el municipio.
--   3. `area_geografica` (la comarca) sigue saliendo del municipio, pero ahora se puede cambiar:
--      si en la misma escritura se cambia el área, se respeta.
--   4. Las RPC del actor (`actualitzar_fitxa_productor/entitat`) aceptan `ubicacio` y
--      `area_geografica` (una comarca de la lista, o la que ya tenía); `crear_entitat` acepta
--      `ubicacio`.
--   5. Los datos de hoy pasan por la misma regla.
--
-- COMPATIBLE HACIA ATRÁS (§7): el frontend publicado no manda `ubicacio` ni el área y sigue
-- igual; el registro público sigue mandando `poblacion` como texto y el trigger lo ordena.

-- ---------------------------------------------------------------------------
-- 1. La columna
-- ---------------------------------------------------------------------------
alter table public.productores add column if not exists ubicacio text;
alter table public.entidades add column if not exists ubicacio text;

alter table public.productores drop constraint if exists productores_ubicacio_check;
alter table public.productores add constraint productores_ubicacio_check
  check (ubicacio is null or char_length(btrim(ubicacio)) between 1 and 120);
alter table public.entidades drop constraint if exists entidades_ubicacio_check;
alter table public.entidades add constraint entidades_ubicacio_check
  check (ubicacio is null or char_length(btrim(ubicacio)) between 1 and 120);

comment on column public.productores.ubicacio is
  'Lugar que no es un municipio (Mercabarna, un polígono…). La población es siempre un municipio (20270505100000).';
comment on column public.entidades.ubicacio is
  'Lugar que no es un municipio (Mercabarna, un polígono…). La población es siempre un municipio (20270505100000).';

-- ---------------------------------------------------------------------------
-- 2. Casar un texto con un municipio
-- ---------------------------------------------------------------------------
-- Sin mayúsculas, acentos ni el artículo pospuesto del nomenclátor («Prat de Llobregat, el»
-- = «El Prat de Llobregat»). Solo devuelve un código si hay UNA coincidencia exacta: «Sant
-- Boi» o «Hospitalet» no casan, y es mejor que alguien elija que adivinar.
create or replace function public.municipi_de_text(p_text text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  with q as (
    select lower(unaccent(replace(btrim(p_text), '’', ''''))) as t
  ), c as (
    select m.codi_ine
      from municipios m, q
     where q.t <> ''
       and q.t in (lower(unaccent(m.nom)), lower(unaccent(public.nom_municipi_llegible(m.nom))))
  )
  select case when (select count(*) from c) = 1 then (select codi_ine from c) end;
$$;

revoke execute on function public.municipi_de_text(text) from public, anon, authenticated;

comment on function public.municipi_de_text(text) is
  'Código INE del municipio que se llama exactamente así (sin acentos ni mayúsculas), o null si no hay uno solo (20270505100000).';

-- ---------------------------------------------------------------------------
-- 3. El trigger: la población es siempre un municipio
-- ---------------------------------------------------------------------------
create or replace function public.trg_fitxa_municipi()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m          municipios;
  v_txt      text := nullif(btrim(new.poblacion), '');
  -- La población llega escrita en esta operación (alta, registro, importación): no es la
  -- que ya derivó el trigger.
  v_escrit   boolean := tg_op = 'INSERT' or new.poblacion is distinct from old.poblacion;
  -- Alguien borra el municipio a propósito: la población que tenía se va con él.
  v_buidat   boolean := tg_op = 'UPDATE' and old.municipio_ine is not null and new.municipio_ine is null;
  v_usa_text boolean;
  v_canvi    boolean := tg_op = 'INSERT' or new.municipio_ine is distinct from old.municipio_ine;
  v_area     boolean := tg_op = 'UPDATE' and new.area_geografica is distinct from old.area_geografica;
begin
  v_usa_text := v_txt is not null and (not v_buidat or v_escrit);

  -- a) Sin municipio, un texto que es un municipio lo fija.
  if new.municipio_ine is null and v_usa_text then
    new.municipio_ine := public.municipi_de_text(v_txt);
    v_canvi := v_canvi or new.municipio_ine is not null;
  end if;

  if new.municipio_ine is not null then
    select * into m from municipios where codi_ine = new.municipio_ine;
    if found then
      -- b) Lo escrito que no es ese municipio («Mercabarna») es una ubicación: no se pierde.
      if v_escrit and v_txt is not null
         and public.municipi_de_text(v_txt) is distinct from m.codi_ine
         and nullif(btrim(new.ubicacio), '') is null then
        new.ubicacio := left(v_txt, 120);
      end if;
      new.poblacion := nom_municipi_llegible(m.nom);
      -- El área sale del municipio nuevo, salvo que esta misma escritura la cambie.
      if v_canvi and not v_area then
        new.area_geografica := m.comarca;
      end if;
    end if;
    return new;
  end if;

  -- c) Sin municipio no hay población: el texto que no casa pasa a la ubicación.
  if v_usa_text and nullif(btrim(new.ubicacio), '') is null then
    new.ubicacio := left(v_txt, 120);
  end if;
  new.poblacion := null;
  return new;
end;
$$;

drop trigger if exists productores_municipi on public.productores;
create trigger productores_municipi
  before insert or update of municipio_ine, poblacion on public.productores
  for each row execute function public.trg_fitxa_municipi();

drop trigger if exists entidades_municipi on public.entidades;
create trigger entidades_municipi
  before insert or update of municipio_ine, poblacion on public.entidades
  for each row execute function public.trg_fitxa_municipi();

-- ---------------------------------------------------------------------------
-- 4. Las RPC: ubicación y área en la lista blanca del actor; ubicación en el alta
-- ---------------------------------------------------------------------------
-- ⚠️ `tests/campsFitxa.test.ts` lee las claves `d ? '…'` de la ÚLTIMA definición de estas
--    funciones (y las de `crear_entitat`) y las compara con `campsFitxa.ts`.
-- `create or replace` con la misma firma: conserva los GRANT de cada una.
create or replace function public.actualitzar_fitxa_productor(p_id uuid, p_dades jsonb)
returns productores
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p productores;
  d jsonb := coalesce(p_dades, '{}'::jsonb);
  txt text;
begin
  if not public.soc_titular('productor', p_id) then
    raise exception 'Nomes el titular pot editar les dades' using errcode = '42501';
  end if;
  select * into p from productores where id = p_id for update;

  txt := nullif(trim(d->>'tipo_empresa'), '');
  if not tipus_empresa_valid(txt, p.tipo_empresa) then
    raise exception 'tipus d''empresa desconegut: %', txt using errcode = '22023';
  end if;
  if d ? 'municipio_ine' and nullif(d->>'municipio_ine', '') is not null
     and not exists (select 1 from municipios where codi_ine = d->>'municipio_ine') then
    raise exception 'municipi desconegut' using errcode = '22023';
  end if;
  -- El área es la comarca: una de la lista, o la que ya tenía (un valor antiguo del import,
  -- como «Terres Ebre», se conserva mientras no se cambie; mismo criterio que tipo_empresa).
  if d ? 'area_geografica' and nullif(btrim(d->>'area_geografica'), '') is not null
     and btrim(d->>'area_geografica') is distinct from p.area_geografica
     and not exists (select 1 from municipios where comarca = btrim(d->>'area_geografica')) then
    raise exception 'comarca_desconeguda' using errcode = '22023';
  end if;
  if d ? 'ubicacio' and char_length(btrim(coalesce(d->>'ubicacio', ''))) > 120 then
    raise exception 'ubicacio_massa_llarga' using errcode = '22023';
  end if;
  if d ? 'tipus_activitat' and not public.tipus_activitat_valid(d->'tipus_activitat', 'productor') then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;

  -- Solo las claves que llegan: una clave ausente no toca la columna. `name` no se vacía
  -- nunca (es el nombre con el que se identifica la ficha en todo el circuito).
  update productores set
    name          = case when d ? 'name' then coalesce(nullif(trim(d->>'name'), ''), name) else name end,
    empresa       = case when d ? 'empresa' then nullif(trim(d->>'empresa'), '') else empresa end,
    razon_social  = case when d ? 'razon_social' then nullif(trim(d->>'razon_social'), '') else razon_social end,
    tipo_empresa  = case when d ? 'tipo_empresa' then txt else tipo_empresa end,
    email         = case when d ? 'email' then nullif(trim(d->>'email'), '') else email end,
    phone         = case when d ? 'phone' then nullif(trim(d->>'phone'), '') else phone end,
    telefono_alt  = case when d ? 'telefono_alt' then nullif(trim(d->>'telefono_alt'), '') else telefono_alt end,
    nif           = case when d ? 'nif' then nullif(upper(trim(d->>'nif')), '') else nif end,
    direccion     = case when d ? 'direccion' then nullif(trim(d->>'direccion'), '') else direccion end,
    codigo_postal = case when d ? 'codigo_postal' then nullif(trim(d->>'codigo_postal'), '') else codigo_postal end,
    municipio_ine = case when d ? 'municipio_ine' then nullif(d->>'municipio_ine', '') else municipio_ine end,
    -- 20270505100000: la ubicación (un lugar que no es municipio) y el área, editables.
    ubicacio      = case when d ? 'ubicacio' then nullif(btrim(d->>'ubicacio'), '') else ubicacio end,
    area_geografica = case when d ? 'area_geografica' then nullif(btrim(d->>'area_geografica'), '') else area_geografica end,
    tipus_activitat = case when d ? 'tipus_activitat'
      then coalesce(array(select jsonb_array_elements_text(d->'tipus_activitat')), '{}') else tipus_activitat end
  where id = p_id
  returning * into p;
  return p;
end;
$$;

create or replace function public.actualitzar_fitxa_entitat(p_id uuid, p_dades jsonb)
returns entidades
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e entidades;
  d jsonb := coalesce(p_dades, '{}'::jsonb);
  txt text;
begin
  if not public.soc_titular('entidad', p_id) then
    raise exception 'Nomes el titular pot editar les dades' using errcode = '42501';
  end if;
  select * into e from entidades where id = p_id for update;

  txt := nullif(trim(d->>'tipo_entidad'), '');
  if not tipus_empresa_valid(txt, e.tipo_entidad) then
    raise exception 'tipus d''entitat desconegut: %', txt using errcode = '22023';
  end if;
  if d ? 'municipio_ine' and nullif(d->>'municipio_ine', '') is not null
     and not exists (select 1 from municipios where codi_ine = d->>'municipio_ine') then
    raise exception 'municipi desconegut' using errcode = '22023';
  end if;
  -- El área es la comarca: una de la lista, o la que ya tenía (un valor antiguo del import,
  -- como «Terres Ebre», se conserva mientras no se cambie; mismo criterio que tipo_empresa).
  if d ? 'area_geografica' and nullif(btrim(d->>'area_geografica'), '') is not null
     and btrim(d->>'area_geografica') is distinct from e.area_geografica
     and not exists (select 1 from municipios where comarca = btrim(d->>'area_geografica')) then
    raise exception 'comarca_desconeguda' using errcode = '22023';
  end if;
  if d ? 'ubicacio' and char_length(btrim(coalesce(d->>'ubicacio', ''))) > 120 then
    raise exception 'ubicacio_massa_llarga' using errcode = '22023';
  end if;
  if d ? 'perfil_receptor' and jsonb_typeof(d->'perfil_receptor') <> 'object' then
    raise exception 'perfil_receptor ha de ser un objecte' using errcode = '22023';
  end if;
  if d ? 'tipus_activitat' and not public.tipus_activitat_valid(d->'tipus_activitat', 'entidad') then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;
  if d ? 'modalitats_interes' and (jsonb_typeof(d->'modalitats_interes') <> 'array' or exists (
       select 1 from jsonb_array_elements_text(d->'modalitats_interes') m where m not in ('donacio', 'venda', 'maquila'))) then
    raise exception 'modalitat_desconeguda' using errcode = '22023';
  end if;
  -- Los tres booleanos de logística admiten «sense definir» (null): un valor que no sea
  -- true/false/null es un error de llamada, no un dato.
  if (d ? 'productes_frescos' and jsonb_typeof(d->'productes_frescos') not in ('boolean', 'null'))
     or (d ? 'transport_plataforma' and jsonb_typeof(d->'transport_plataforma') not in ('boolean', 'null'))
     or (d ? 'descarrega_toro' and jsonb_typeof(d->'descarrega_toro') not in ('boolean', 'null')) then
    raise exception 'logistica_invalida: cal true, false o null' using errcode = '22023';
  end if;

  -- ⚠️ `tipo_receptor`, `estat`, `prioritat`, `es_test`, `activo`… NO están en la lista:
  --    deciden qué ofertas ve y cómo puntúa, y eso lo decide el equipo (`campsFitxa.ts`:
  --    `edita: 'equip'`). Las claves que no están aquí se ignoran en silencio.
  update entidades set
    nombre        = case when d ? 'nombre' then coalesce(nullif(trim(d->>'nombre'), ''), nombre) else nombre end,
    razon_social  = case when d ? 'razon_social' then nullif(trim(d->>'razon_social'), '') else razon_social end,
    tipo_entidad  = case when d ? 'tipo_entidad' then txt else tipo_entidad end,
    contacto      = case when d ? 'contacto' then nullif(trim(d->>'contacto'), '') else contacto end,
    telefono      = case when d ? 'telefono' then nullif(trim(d->>'telefono'), '') else telefono end,
    email         = case when d ? 'email' then nullif(trim(d->>'email'), '') else email end,
    nif           = case when d ? 'nif' then nullif(upper(trim(d->>'nif')), '') else nif end,
    direccion     = case when d ? 'direccion' then nullif(trim(d->>'direccion'), '') else direccion end,
    codigo_postal = case when d ? 'codigo_postal' then nullif(trim(d->>'codigo_postal'), '') else codigo_postal end,
    municipio_ine = case when d ? 'municipio_ine' then nullif(d->>'municipio_ine', '') else municipio_ine end,
    -- 20270505100000: la ubicación (un lugar que no es municipio) y el área, editables.
    ubicacio      = case when d ? 'ubicacio' then nullif(btrim(d->>'ubicacio'), '') else ubicacio end,
    area_geografica = case when d ? 'area_geografica' then nullif(btrim(d->>'area_geografica'), '') else area_geografica end,
    horario       = case when d ? 'horario' then nullif(trim(d->>'horario'), '') else horario end,
    calendari_repartiment = case when d ? 'calendari_repartiment' then nullif(trim(d->>'calendari_repartiment'), '') else calendari_repartiment end,
    perfil_receptor = case when d ? 'perfil_receptor' then d->'perfil_receptor' else perfil_receptor end,
    tipus_activitat = case when d ? 'tipus_activitat'
      then coalesce(array(select jsonb_array_elements_text(d->'tipus_activitat')), '{}') else tipus_activitat end,
    modalitats_interes = case when d ? 'modalitats_interes'
      then coalesce(array(select distinct jsonb_array_elements_text(d->'modalitats_interes')), '{}') else modalitats_interes end,
    -- 1C (P5): el contacto secundario y la logística son de la organización.
    telefono2     = case when d ? 'telefono2' then nullif(trim(d->>'telefono2'), '') else telefono2 end,
    telefono3     = case when d ? 'telefono3' then nullif(trim(d->>'telefono3'), '') else telefono3 end,
    email2        = case when d ? 'email2' then nullif(trim(d->>'email2'), '') else email2 end,
    contacto2     = case when d ? 'contacto2' then nullif(trim(d->>'contacto2'), '') else contacto2 end,
    productes_frescos        = case when d ? 'productes_frescos' then (d->>'productes_frescos')::boolean else productes_frescos end,
    productes_frescos_txt    = case when d ? 'productes_frescos_txt' then nullif(trim(d->>'productes_frescos_txt'), '') else productes_frescos_txt end,
    transport_plataforma     = case when d ? 'transport_plataforma' then (d->>'transport_plataforma')::boolean else transport_plataforma end,
    transport_plataforma_txt = case when d ? 'transport_plataforma_txt' then nullif(trim(d->>'transport_plataforma_txt'), '') else transport_plataforma_txt end,
    descarrega_toro          = case when d ? 'descarrega_toro' then (d->>'descarrega_toro')::boolean else descarrega_toro end,
    descarrega_toro_txt      = case when d ? 'descarrega_toro_txt' then nullif(trim(d->>'descarrega_toro_txt'), '') else descarrega_toro_txt end
  where id = p_id
  returning * into e;
  return e;
end;
$$;

create or replace function public.crear_entitat(p_dades jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d        jsonb := coalesce(p_dades, '{}'::jsonb);
  v_rols   text[];
  v_nom    text;
  v_rao    text;
  v_nif    text;
  v_te     text;
  v_pers   text;
  v_email  text;
  v_tel    text;
  v_dir    text;
  v_cp     text;
  v_mun    text;
  v_ubi    text;
  v_tr     text;
  v_test   boolean;
  v_act    text[];
  v_act_p  text[];
  v_act_e  text[];
  v_org    uuid;
  v_prod   uuid;
  v_ent    uuid;
begin
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip pot donar d''alta una entitat' using errcode = '42501';
  end if;

  -- Los papeles: uno o los dos.
  if jsonb_typeof(d->'rols') is distinct from 'array' then
    raise exception 'cal_paper: tria almenys un paper' using errcode = '22023';
  end if;
  v_rols := array(select distinct x from jsonb_array_elements_text(d->'rols') x);
  if cardinality(v_rols) = 0 then
    raise exception 'cal_paper: tria almenys un paper' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_rols) x where x not in ('productor', 'entidad')) then
    raise exception 'paper_desconegut' using errcode = '22023';
  end if;

  v_nom   := nullif(btrim(coalesce(d->>'nom_comercial', '')), '');
  v_rao   := nullif(btrim(coalesce(d->>'razon_social', '')), '');
  v_nif   := nullif(upper(regexp_replace(coalesce(d->>'nif', ''), '[\s.\-]', '', 'g')), '');
  v_te    := nullif(btrim(coalesce(d->>'tipus_empresa', '')), '');
  v_pers  := nullif(btrim(coalesce(d->>'persona_contacte', '')), '');
  v_email := nullif(lower(btrim(coalesce(d->>'email', ''))), '');
  v_tel   := nullif(regexp_replace(coalesce(d->>'telefon', ''), '\D', '', 'g'), '');
  v_dir   := nullif(btrim(coalesce(d->>'direccion', '')), '');
  v_cp    := nullif(btrim(coalesce(d->>'codigo_postal', '')), '');
  v_mun   := nullif(btrim(coalesce(d->>'municipio_ine', '')), '');
  v_ubi   := nullif(btrim(coalesce(d->>'ubicacio', '')), '');
  v_tr    := nullif(btrim(coalesce(d->>'tipo_receptor', '')), '');
  v_test  := coalesce((d->>'es_test')::boolean, false);

  -- Lo que exige nacer activa (mismo orden y mismos códigos que el trigger de 1A).
  if v_nom is null then
    raise exception 'cal_nom_comercial: cal el nom comercial' using errcode = '22023';
  end if;
  if v_nif is null then
    raise exception 'falta_nif: cal el NIF per donar-la d''alta activa' using errcode = '22023';
  end if;
  if not public.nif_valid(v_nif) then
    raise exception 'nif_invalid: el NIF % no es valid', v_nif using errcode = '22023';
  end if;
  if v_rao is null then
    raise exception 'falta_rao_social: cal la rao social per donar-la d''alta activa' using errcode = '22023';
  end if;

  if not public.tipus_empresa_valid(v_te, null) then
    raise exception 'tipus d''entitat desconegut: %', v_te using errcode = '22023';
  end if;
  if v_mun is not null and not exists (select 1 from municipios where codi_ine = v_mun) then
    raise exception 'municipi desconegut' using errcode = '22023';
  end if;
  if char_length(v_ubi) > 120 then
    raise exception 'ubicacio_massa_llarga' using errcode = '22023';
  end if;
  if 'entidad' = any(v_rols) then
    if v_tr is null then
      raise exception 'cal_tipus_receptor: tria el tipus de receptor' using errcode = '22023';
    end if;
    if v_tr not in ('social', 'animal', 'transformador', 'comercial') then
      raise exception 'tipo_receptor_desconegut' using errcode = '22023';
    end if;
  end if;

  -- Las actividades: cada una tiene que aplicar a alguno de los papeles elegidos, y cada
  -- ficha guarda las suyas (las `ambdos`, en las dos).
  if d ? 'tipus_activitat' and jsonb_typeof(d->'tipus_activitat') is distinct from 'array' then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;
  v_act := array(select distinct x from jsonb_array_elements_text(coalesce(d->'tipus_activitat', '[]'::jsonb)) x);
  if exists (select 1 from unnest(v_act) x
              where not exists (select 1 from tipus_activitat ta
                                 where ta.codi = x
                                   and (ta.aplica = 'ambdos' or ta.aplica = any(v_rols)))) then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;
  v_act_p := array(select ta.codi from tipus_activitat ta
                    where ta.codi = any(v_act) and ta.aplica in ('productor', 'ambdos') order by ta.ordre);
  v_act_e := array(select ta.codi from tipus_activitat ta
                    where ta.codi = any(v_act) and ta.aplica in ('entidad', 'ambdos') order by ta.ordre);

  -- Las fichas. La primera estrena la organización (trigger `*_estrena_organizacion`); la
  -- segunda se cuelga de ella, y el trigger del NIF deja compartirlo dentro de la misma.
  -- Un correo o teléfono que ya tiene otra ficha de productor (índices únicos) deshace todo.
  begin
    if 'productor' = any(v_rols) then
      insert into productores (name, empresa, razon_social, nif, tipo_empresa, tipus_activitat,
                               email, phone, direccion, codigo_postal, municipio_ine, ubicacio, es_test)
      values (coalesce(v_pers, v_nom), v_nom, v_rao, v_nif, v_te, v_act_p,
              v_email, v_tel, v_dir, v_cp, v_mun, v_ubi, v_test)
      returning id, organizacion_id into v_prod, v_org;
    end if;
    if 'entidad' = any(v_rols) then
      insert into entidades (nombre, razon_social, nif, tipo_entidad, tipus_activitat, contacto,
                             email, telefono, direccion, codigo_postal, municipio_ine, ubicacio, tipo_receptor,
                             es_test, organizacion_id)
      values (v_nom, v_rao, v_nif, v_te, v_act_e, v_pers,
              v_email, v_tel, v_dir, v_cp, v_mun, v_ubi, v_tr,
              v_test, v_org)
      returning id, organizacion_id into v_ent, v_org;
    end if;
  exception when unique_violation then
    raise exception 'dades_en_us: el correu o el telefon ja els te una altra fitxa' using errcode = '22023';
  end;

  -- Quién la dio de alta activa: el mismo rastro que un cambio de estado.
  if v_prod is not null then
    insert into fitxa_estat_hist (tipus, productor_id, activo, per) values ('productor', v_prod, true, auth.uid());
  end if;
  if v_ent is not null then
    insert into fitxa_estat_hist (tipus, entidad_id, activo, per) values ('entidad', v_ent, true, auth.uid());
  end if;

  return jsonb_build_object('organizacion_id', v_org, 'productor_id', v_prod, 'entidad_id', v_ent);
end;
$$;

-- Sin EXECUTE para `service_role` ni sin sesión: ningún job da de alta entidades (la
-- importación de 1E escribe con su propio script y entra inactiva).
revoke execute on function public.crear_entitat(jsonb) from public, anon, service_role;
grant execute on function public.crear_entitat(jsonb) to authenticated;

comment on function public.crear_entitat(jsonb) is
  '1B (20270501300000; ubicacio desde 20270505100000): alta de una entidad con uno o dos papeles en una transacción. Nace activa: exige NIF válido, razón social y, si es receptor, tipo_receptor. Solo equipo con sesión.';

comment on function public.actualitzar_fitxa_productor(uuid, jsonb) is
  'El productor edita su ficha (solo el titular). Lista blanca: los campos `edita: tots` de `campsFitxa.ts`; ubicacio y area_geografica desde 20270505100000.';
comment on function public.actualitzar_fitxa_entitat(uuid, jsonb) is
  'La entidad edita su ficha (solo el titular). Lista blanca: los campos `edita: tots` de `campsFitxa.ts` (1C, P5); ubicacio y area_geografica desde 20270505100000.';

-- ---------------------------------------------------------------------------
-- 5. Los datos de hoy, por la misma regla
-- ---------------------------------------------------------------------------
-- Las fichas con población escrita y sin municipio: el trigger la casa o la pasa a ubicación.
-- (`set poblacion = poblacion` basta: el trigger es `update of poblacion`.)
update public.productores set poblacion = poblacion where municipio_ine is null and poblacion is not null;
update public.entidades   set poblacion = poblacion where municipio_ine is null and poblacion is not null;
