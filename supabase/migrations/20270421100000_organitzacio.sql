-- Fase 7 de la revisión del 08-10-2026: la ficha de la organización.
--
--   · «Tipus d'activitat», selección múltiple y separada de «Tipus d'empresa o entitat» (que
--     dice QUÉ es la organización; esto, QUÉ HACE). Catálogo en tabla, con las dos listas del
--     documento del cliente y a qué papel aplica cada opción.
--   · «Modalitats que m'interessen» del receptor: su PREFERENCIA. La elegibilidad sigue en
--     `tipo_receptor × modalitat_receptor_compat`; no se codifica una segunda regla.
--   · Personas de contacto de la organización, reutilizables (general, administrativo,
--     recogidas…), como los lugares de recogida.
--   · NIF válido y único por organización: un trigger lo impone en las dos tablas de fichas,
--     venga de la ficha propia, de la del equipo o del registro.
--   · «Rol a REDESTINA»: marcar el otro papel crea la ficha hermana con los datos comunes y
--     una membresía PENDIENTE: la valida el equipo desde «Registres pendents», como un alta.

-- --------------------------------------------------------------- tipus d'activitat
create table if not exists public.tipus_activitat (
  codi    text primary key,
  nom_ca  text not null,
  nom_es  text not null,
  aplica  text not null check (aplica in ('productor', 'entidad', 'ambdos')),
  ordre   int not null default 0
);
insert into public.tipus_activitat (codi, nom_ca, nom_es, aplica, ordre) values
  ('productor_agricola',   'Productor agrícola',                   'Productor agrícola',                  'ambdos',    10),
  ('cooperativa_agraria',  'Cooperativa agrària',                  'Cooperativa agraria',                 'productor', 20),
  ('explotacio_agricola',  'Explotació agrícola',                  'Explotación agrícola',                'entidad',   25),
  ('explotacio_ramadera',  'Explotació ramadera',                  'Explotación ganadera',                'entidad',   26),
  ('majorista',            'Majorista',                            'Mayorista',                           'ambdos',    30),
  ('distribuidor',         'Distribuïdor',                         'Distribuidor',                        'ambdos',    40),
  ('comercialitzador',     'Comercialitzador',                     'Comercializador',                     'productor', 50),
  ('industria_alimentaria','Indústria alimentària',                'Industria alimentaria',               'ambdos',    60),
  ('transformador_obrador','Transformador alimentari / obrador',   'Transformador alimentario / obrador', 'ambdos',    70),
  ('restauracio_catering', 'Restauració / càtering',               'Restauración / catering',             'ambdos',    80),
  ('comerc_minorista',     'Comerç minorista',                     'Comercio minorista',                  'ambdos',    90),
  ('logistica_transport',  'Logística / transport',                'Logística / transporte',              'entidad',  100),
  ('banc_aliments',        'Banc d''aliments',                     'Banco de alimentos',                  'entidad',  110),
  ('distribucio_social',   'Distribució social',                   'Distribución social',                 'entidad',  120),
  ('menjador_social',      'Menjador social',                      'Comedor social',                      'entidad',  130),
  ('botiga_social',        'Botiga social',                        'Tienda social',                       'entidad',  140),
  ('centre_comunitari',    'Centre comunitari',                    'Centro comunitario',                  'entidad',  150),
  ('ong_entitat_social',   'ONG / entitat social',                 'ONG / entidad social',                'entidad',  160),
  ('altres',               'Altres',                               'Otros',                               'ambdos',   999)
on conflict (codi) do nothing;
alter table public.tipus_activitat enable row level security;
create policy "tipus_activitat: lectura" on public.tipus_activitat for select to authenticated using (true);
revoke all on public.tipus_activitat from anon;
grant select on public.tipus_activitat to authenticated;

alter table public.productores add column if not exists tipus_activitat text[] not null default '{}';
alter table public.entidades   add column if not exists tipus_activitat text[] not null default '{}';
alter table public.entidades   add column if not exists modalitats_interes text[] not null default '{}';
alter table public.entidades drop constraint if exists entidades_modalitats_interes_check;
alter table public.entidades add constraint entidades_modalitats_interes_check
  check (modalitats_interes <@ array['donacio', 'venda', 'maquila']);

create or replace function public.tipus_activitat_valid(p_valors jsonb, p_papel text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_valors) = 'array'
     and not exists (
       select 1 from jsonb_array_elements_text(p_valors) v
        where not exists (select 1 from tipus_activitat ta
                           where ta.codi = v and ta.aplica in (p_papel, 'ambdos')));
$$;
revoke execute on function public.tipus_activitat_valid(jsonb, text) from public, anon, authenticated;

-- ------------------------------------------------------------------------ NIF
--
-- La MISMA regla que `src/lib/validacio.ts` (`errorNif`): DNI, NIE o CIF con su dígito de
-- control. Si una cambia, cambian las dos (las dos tienen prueba: `tests/validacio.test.ts`
-- y el check del arnés que intenta guardar uno inválido).
create or replace function public.nif_valid(p_nif text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  n text := upper(regexp_replace(coalesce(p_nif, ''), '[\s.\-]', '', 'g'));
  lletres constant text := 'TRWAGMYFPDXBNJZSQVHLCKE';
  cos text; parells int := 0; senars int := 0; d int; x int; control int; lletra text; c text;
begin
  if n = '' then return true; end if;
  if n ~ '^\d{8}[A-Z]$' then
    return substr(lletres, (substr(n, 1, 8)::bigint % 23)::int + 1, 1) = substr(n, 9, 1);
  end if;
  if n ~ '^[XYZ]\d{7}[A-Z]$' then
    return substr(lletres, ((strpos('XYZ', substr(n, 1, 1)) - 1)::text || substr(n, 2, 7))::bigint::int % 23 + 1, 1) = substr(n, 9, 1);
  end if;
  if n ~ '^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$' then
    cos := substr(n, 2, 7);
    for i in 1..7 loop
      d := substr(cos, i, 1)::int;
      if i % 2 = 0 then parells := parells + d;
      else x := d * 2; senars := senars + x / 10 + x % 10; end if;
    end loop;
    control := (10 - ((parells + senars) % 10)) % 10;
    lletra := substr('JABCDEFGHI', control + 1, 1);
    c := substr(n, 9, 1);
    if strpos('KPQRSNW', substr(n, 1, 1)) > 0 then return c = lletra; end if;
    if strpos('ABEH', substr(n, 1, 1)) > 0 then return c = control::text; end if;
    return c = control::text or c = lletra;
  end if;
  return false;
end;
$$;
revoke execute on function public.nif_valid(text) from public, anon;
grant execute on function public.nif_valid(text) to authenticated;

-- Válido y único POR ORGANIZACIÓN: las dos fichas de una misma organización (doble rol)
-- comparten NIF; dos organizaciones distintas, no. Solo cuando el NIF cambia: una ficha
-- antigua con un NIF mal escrito se puede seguir guardando si no lo toca.
create or replace function public.trg_fitxa_nif()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nif text;
begin
  if new.nif is null or (tg_op = 'UPDATE' and new.nif is not distinct from old.nif) then
    return new;
  end if;
  v_nif := upper(regexp_replace(new.nif, '[\s.\-]', '', 'g'));
  if v_nif = '' then new.nif := null; return new; end if;
  if not public.nif_valid(v_nif) then
    raise exception 'nif_invalid: el NIF % no es valid', new.nif using errcode = '22023';
  end if;
  new.nif := v_nif;
  if exists (select 1 from productores p
              where upper(regexp_replace(coalesce(p.nif, ''), '[\s.\-]', '', 'g')) = v_nif
                and p.organizacion_id is distinct from new.organizacion_id
                and not (tg_table_name = 'productores' and p.id = new.id))
     or exists (select 1 from entidades e
              where upper(regexp_replace(coalesce(e.nif, ''), '[\s.\-]', '', 'g')) = v_nif
                and e.organizacion_id is distinct from new.organizacion_id
                and not (tg_table_name = 'entidades' and e.id = new.id)) then
    raise exception 'nif_en_us: el NIF % ja el te una altra organitzacio', v_nif using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_fitxa_nif() from public, anon, authenticated;
drop trigger if exists productores_nif on public.productores;
create trigger productores_nif before insert or update of nif on public.productores
  for each row execute function public.trg_fitxa_nif();
drop trigger if exists entidades_nif on public.entidades;
create trigger entidades_nif before insert or update of nif on public.entidades
  for each row execute function public.trg_fitxa_nif();

-- --------------------------------------------------------- personas de contacto
create table if not exists public.organizacion_contactos (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones(id) on delete cascade,
  nom             text not null check (btrim(nom) <> ''),
  carrec          text,
  telefon         text,
  email           text,
  tipus           text not null default 'general'
                    check (tipus in ('general', 'administratiu', 'recollides', 'altres')),
  es_principal    boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists organizacion_contactos_org_idx on public.organizacion_contactos (organizacion_id);
alter table public.organizacion_contactos enable row level security;

-- Las organizaciones de la cuenta (las de sus fichas con membresía activa).
create or replace function public.meves_organitzacions()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.organizacion_id from productores p where p.id in (select public.mis_productores())
  union
  select e.organizacion_id from entidades e where e.id in (select public.mis_entidades());
$$;
revoke execute on function public.meves_organitzacions() from public, anon;
grant execute on function public.meves_organitzacions() to authenticated;

-- ¿Es titular de alguna ficha de esta organización?
create or replace function public.soc_titular_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from productores p where p.organizacion_id = p_org and public.soc_titular('productor', p.id))
      or exists (select 1 from entidades e where e.organizacion_id = p_org and public.soc_titular('entidad', e.id));
$$;
revoke execute on function public.soc_titular_org(uuid) from public, anon;
grant execute on function public.soc_titular_org(uuid) to authenticated;

create policy "organizacion_contactos: lectura" on public.organizacion_contactos
  for select to authenticated
  using ((select public.es_intern()) or organizacion_id in (select public.meves_organitzacions()));
revoke all on public.organizacion_contactos from anon;
grant select on public.organizacion_contactos to authenticated;

create or replace function public.desar_contacte_org(p_id uuid, p_organizacion uuid, p_dades jsonb)
returns public.organizacion_contactos
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d jsonb := coalesce(p_dades, '{}'::jsonb);
  v_org uuid := p_organizacion;
  r organizacion_contactos;
begin
  if auth.uid() is null then
    raise exception 'Cal una sessio' using errcode = '42501';
  end if;
  if p_id is not null then
    select organizacion_id into v_org from organizacion_contactos where id = p_id;
  end if;
  if not (public.es_intern() or public.soc_titular_org(v_org)) then
    raise exception 'Nomes el titular o l''equip poden editar els contactes' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'contacte_inexistent' using errcode = '22023';
  end if;
  if coalesce(btrim(d->>'nom'), '') = '' then
    raise exception 'cal_nom' using errcode = '22023';
  end if;
  if coalesce(d->>'tipus', 'general') not in ('general', 'administratiu', 'recollides', 'altres') then
    raise exception 'tipus_contacte_desconegut' using errcode = '22023';
  end if;
  if p_id is null then
    insert into organizacion_contactos (organizacion_id, nom, carrec, telefon, email, tipus, es_principal)
    values (v_org, btrim(d->>'nom'), nullif(btrim(d->>'carrec'), ''), nullif(btrim(d->>'telefon'), ''),
            nullif(btrim(d->>'email'), ''), coalesce(d->>'tipus', 'general'), coalesce((d->>'es_principal')::boolean, false))
    returning * into r;
  else
    update organizacion_contactos set
      nom = btrim(d->>'nom'), carrec = nullif(btrim(d->>'carrec'), ''), telefon = nullif(btrim(d->>'telefon'), ''),
      email = nullif(btrim(d->>'email'), ''), tipus = coalesce(d->>'tipus', tipus),
      es_principal = coalesce((d->>'es_principal')::boolean, es_principal)
     where id = p_id returning * into r;
  end if;
  return r;
end;
$$;
revoke execute on function public.desar_contacte_org(uuid, uuid, jsonb) from public, anon;
grant execute on function public.desar_contacte_org(uuid, uuid, jsonb) to authenticated;

create or replace function public.esborrar_contacte_org(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Cal una sessio' using errcode = '42501';
  end if;
  select organizacion_id into v_org from organizacion_contactos where id = p_id;
  if not (public.es_intern() or (v_org is not null and public.soc_titular_org(v_org))) then
    raise exception 'Nomes el titular o l''equip poden esborrar els contactes' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'contacte_inexistent' using errcode = '22023';
  end if;
  delete from organizacion_contactos where id = p_id;
end;
$$;
revoke execute on function public.esborrar_contacte_org(uuid) from public, anon;
grant execute on function public.esborrar_contacte_org(uuid) to authenticated;

-- ----------------------------------------------------------- «Rol a REDESTINA»
--
-- La organización estrena el otro papel: ficha hermana con los datos comunes, en la MISMA
-- organización, y una membresía PENDIENTE del titular. No da acceso hasta que el equipo la
-- aprueba (cola «Registres pendents»), igual que el registro con los dos papeles. Una
-- entidad nueva nace sin `tipo_receptor`: decide qué ofertas ve, y eso lo fija el equipo.
create or replace function public.afegir_paper_organitzacio(p_tipo_actual text, p_id_actual uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p productores%rowtype;
  e entidades%rowtype;
  v_org uuid;
  v_nou uuid;
  v_tipo text;
begin
  if auth.uid() is null or p_tipo_actual not in ('productor', 'entidad')
     or not public.soc_titular(p_tipo_actual, p_id_actual) then
    raise exception 'Nomes el titular pot afegir un paper a l''organitzacio' using errcode = '42501';
  end if;
  v_tipo := case p_tipo_actual when 'productor' then 'entidad' else 'productor' end;

  if p_tipo_actual = 'productor' then
    select * into p from productores where id = p_id_actual;
    v_org := p.organizacion_id;
    if exists (select 1 from entidades x where x.organizacion_id = v_org) then
      raise exception 'ja_te_paper' using errcode = '22023';
    end if;
    begin
      insert into entidades (nombre, razon_social, contacto, email, telefono, nif, direccion, codigo_postal,
                             municipio_ine, organizacion_id, es_test)
      values (coalesce(p.empresa, p.name), p.razon_social, p.name, p.email, p.phone, p.nif, p.direccion,
              p.codigo_postal, p.municipio_ine, v_org, p.es_test)
      returning id into v_nou;
    exception when unique_violation then
      raise exception 'dades_en_us' using errcode = '22023';
    end;
    insert into membresias (user_id, tipo, entidad_id, rol_org, activo, aprovacio)
    values (auth.uid(), 'entidad', v_nou, 'titular', false, 'pendent');
  else
    select * into e from entidades where id = p_id_actual;
    v_org := e.organizacion_id;
    if exists (select 1 from productores x where x.organizacion_id = v_org) then
      raise exception 'ja_te_paper' using errcode = '22023';
    end if;
    begin
      insert into productores (name, empresa, razon_social, email, phone, nif, direccion, codigo_postal,
                               municipio_ine, organizacion_id, es_test)
      values (coalesce(e.contacto, e.nombre), e.nombre, e.razon_social, e.email, e.telefono, e.nif, e.direccion,
              e.codigo_postal, e.municipio_ine, v_org, e.es_test)
      returning id into v_nou;
    exception when unique_violation then
      raise exception 'dades_en_us' using errcode = '22023';
    end;
    insert into membresias (user_id, tipo, productor_id, rol_org, activo, aprovacio)
    values (auth.uid(), 'productor', v_nou, 'titular', false, 'pendent');
  end if;

  return jsonb_build_object('tipo', v_tipo, 'id', v_nou);
end;
$$;
revoke execute on function public.afegir_paper_organitzacio(text, uuid) from public, anon;
grant execute on function public.afegir_paper_organitzacio(text, uuid) to authenticated;

-- ---------------------------------- las vistas de los listados, con las columnas nuevas
-- `create or replace view` solo admite AÑADIR columnas al final.
create or replace view public.v_productores_llistat with (security_invoker = true) as
 SELECT id,
    name,
    email,
    phone,
    created_at,
    empresa,
    codigo,
    comentario,
    visitado,
    conveni,
    tipo_empresa,
    telefono_alt,
    direccion,
    codigo_postal,
    nif,
    area_geografica,
    poblacion,
    productos_habituales,
    data_alta,
    activo,
    es_test,
    (EXISTS ( SELECT 1
           FROM membresias m
          WHERE m.productor_id = p.id AND m.aprovacio = 'rebutjada'::text)) AS rebutjada,
    p.tipus_activitat
   FROM productores p;


create or replace view public.v_entidades_llistat with (security_invoker = true) as
 SELECT id,
    nombre,
    codigo,
    familia,
    prioritat,
    estat,
    gestio,
    comentarios,
    area_geografica,
    poblacion,
    direccion,
    codigo_postal,
    horario,
    nif,
    telefono,
    telefono2,
    telefono3,
    email,
    email2,
    contacto,
    contacto2,
    calendari_repartiment,
    productes_frescos,
    productes_frescos_txt,
    transport_plataforma,
    transport_plataforma_txt,
    descarrega_toro,
    descarrega_toro_txt,
    data_alta,
    opt_in,
    created_at,
    modalitat,
    es_test,
    tipo_receptor,
    (EXISTS ( SELECT 1
           FROM membresias m
          WHERE m.entidad_id = e.id AND m.aprovacio = 'rebutjada'::text)) AS rebutjada,
    e.tipus_activitat,
    e.modalitats_interes
   FROM entidades e;


-- --------------------------------------- las RPC de la ficha propia, con los campos nuevos
CREATE OR REPLACE FUNCTION public.actualitzar_fitxa_entitat(p_id uuid, p_dades jsonb)
 RETURNS entidades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- ⚠️ `tipo_receptor`, `estat`, `prioritat`, `es_test`… NO están en la lista: deciden qué
  --    ofertas ve y cómo puntúa, y eso lo decide el equipo.
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
    horario       = case when d ? 'horario' then nullif(trim(d->>'horario'), '') else horario end,
    calendari_repartiment = case when d ? 'calendari_repartiment' then nullif(trim(d->>'calendari_repartiment'), '') else calendari_repartiment end,
    perfil_receptor = case when d ? 'perfil_receptor' then d->'perfil_receptor' else perfil_receptor end,
    tipus_activitat = case when d ? 'tipus_activitat'
      then coalesce(array(select jsonb_array_elements_text(d->'tipus_activitat')), '{}') else tipus_activitat end,
    modalitats_interes = case when d ? 'modalitats_interes'
      then coalesce(array(select distinct jsonb_array_elements_text(d->'modalitats_interes')), '{}') else modalitats_interes end
  where id = p_id
  returning * into e;
  return e;
end;
$function$;

CREATE OR REPLACE FUNCTION public.actualitzar_fitxa_productor(p_id uuid, p_dades jsonb)
 RETURNS productores
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    tipus_activitat = case when d ? 'tipus_activitat'
      then coalesce(array(select jsonb_array_elements_text(d->'tipus_activitat')), '{}') else tipus_activitat end
  where id = p_id
  returning * into p;
  return p;
end;
$function$;
