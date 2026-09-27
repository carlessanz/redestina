-- «La meva organització» con listas cerradas (revisión funcional del 23-09-2026).
--
-- La revisión pide que la ficha sirva al ERP: «usar desplegables/listas maestras para las
-- variables que queramos cruzar, y campos abiertos solo cuando no podamos anticipar las
-- respuestas». Esto añade lo que faltaba para poder hacerlo:
--
--   · `razon_social` en las dos fichas: el nombre legal, distinto del comercial.
--   · `municipio_ine` en las dos fichas, contra el nomenclátor oficial. De él salen SOLOS
--     `poblacion` (en su forma legible) y `area_geografica` (la comarca), que hasta hoy se
--     tecleaban a mano: «Sant Cugat», «St. Cugat del Vallès» y «SANT CUGAT» eran tres
--     sitios distintos para la priorización, que compara el área para puntuar.
--   · `entidades.tipo_entidad`: el tipo de empresa o entidad de la receptora (el de la
--     productora ya existía: `productores.tipo_empresa`).
--   · `entidades.perfil_receptor jsonb`: los campos que dependen del tipo de receptor
--     (personas atendidas, conservación, capacidad logística, maquila…). JSON y no columnas
--     porque son distintos por tipo y todavía se van a revisar con la Fundació; las listas
--     cerradas las impone la pantalla (`src/lib/perfilReceptor.ts`). Es el «JSON flexible»
--     que ya prevé el modelo de datos del funcional (§1bis).
--   · `organizaciones.canal_preferido` admite `telefon`: una preferencia para el EQUIPO
--     (llamar). Los envíos automáticos no pueden llamar, así que para ellos `telefon` vale
--     como «que lo decida Redestina» (`normalizarPreferencia()` en `_shared/organizacion.ts`
--     ya descarta cualquier valor que no sea whatsapp/email).
--
-- ⚠️ Las RPC nuevas (`actualitzar_fitxa_*`) reciben un jsonb y escriben SOLO las claves de
--    su lista blanca, como las anteriores `actualizar_mi_*`, que se quedan (las usa la
--    interfaz vigente durante la ventana de publicación, §11).
-- ⚠️ Solo añade: columnas nullable, un check ampliado y funciones nuevas.

alter table productores
  add column if not exists razon_social text,
  add column if not exists municipio_ine text references municipios (codi_ine);

alter table entidades
  add column if not exists razon_social text,
  add column if not exists municipio_ine text references municipios (codi_ine),
  add column if not exists tipo_entidad text,
  add column if not exists perfil_receptor jsonb not null default '{}'::jsonb;

comment on column productores.municipio_ine is
  'Municipio oficial (INE). Al fijarlo, el trigger rellena poblacion y area_geografica (comarca).';
comment on column entidades.perfil_receptor is
  'Campos específicos del tipo de receptor; claves y listas en src/lib/perfilReceptor.ts.';

-- El nombre oficial lleva el artículo pospuesto («Ametlla del Vallès, l'»): para la ficha
-- se le da la vuelta, igual que hace `nomLlegible()` en el cliente.
create or replace function public.nom_municipi_llegible(p_nom text)
returns text
language sql
immutable
as $$
  select case
    when p_nom ~* ', (l'')$' then regexp_replace(p_nom, '^(.*), (l'')$', '\2\1', 'i')
    when p_nom ~* ', (el|la|els|les)$' then regexp_replace(p_nom, '^(.*), (el|la|els|les)$', '\2 \1', 'i')
    else p_nom
  end;
$$;

create or replace function public.trg_fitxa_municipi()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m municipios;
begin
  if new.municipio_ine is null then return new; end if;
  if tg_op = 'UPDATE' and new.municipio_ine is not distinct from old.municipio_ine then
    return new;
  end if;
  select * into m from municipios where codi_ine = new.municipio_ine;
  if found then
    new.poblacion := nom_municipi_llegible(m.nom);
    new.area_geografica := m.comarca;
  end if;
  return new;
end;
$$;

drop trigger if exists productores_municipi on productores;
create trigger productores_municipi
  before insert or update of municipio_ine on productores
  for each row execute function public.trg_fitxa_municipi();

drop trigger if exists entidades_municipi on entidades;
create trigger entidades_municipi
  before insert or update of municipio_ine on entidades
  for each row execute function public.trg_fitxa_municipi();

-- «Telèfon» como preferencia.
alter table organizaciones drop constraint if exists organizaciones_canal_preferido_check;
alter table organizaciones add constraint organizaciones_canal_preferido_check
  check (canal_preferido in ('whatsapp', 'email', 'telefon'));

-- `actualizar_meu_canal` valida la lista a mano: se recrea IGUAL que en `20270314100100`
-- (misma firma, misma guarda de titular o equipo, misma salida de `service_role`) y solo
-- cambia la lista de canales. `create or replace` conserva los GRANT.
create or replace function public.actualizar_meu_canal(
  p_tipo  text,
  p_ficha uuid,
  p_canal text default null
)
returns organizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o_id uuid;
  o    organizaciones;
begin
  if p_tipo not in ('productor', 'entidad') then
    raise exception 'tipus desconegut: %', p_tipo using errcode = '22023';
  end if;

  if p_canal is not null and p_canal not in ('whatsapp', 'email', 'telefon') then
    raise exception 'canal desconegut: %', p_canal using errcode = '22023';
  end if;

  -- El rol se comprueba solo cuando hay sesión de usuario. Mismo patrón que las RPC
  -- documentales y que `trg_membresias_control_aprovacio` (§4bis).
  if auth.uid() is not null
     and not (public.soc_titular(p_tipo, p_ficha) or (select public.es_intern())) then
    raise exception 'Nomes el titular pot editar les dades' using errcode = '42501';
  end if;

  o_id := public.organizacion_de(p_tipo, p_ficha);

  if o_id is null then
    raise exception 'la fitxa % no te organitzacio', p_ficha using errcode = '22023';
  end if;

  update organizaciones
     set canal_preferido = p_canal
   where id = o_id
  returning * into o;

  return o;
end;
$$;


-- Tipos de empresa de la lista cerrada (los de la revisión). Un valor fuera de la lista se
-- acepta SOLO si ya era el guardado: las fichas importadas traen texto libre, y rechazarlo
-- impediría guardar cualquier otra cosa de esa ficha sin tocar ese campo.
create or replace function public.tipus_empresa_valid(p_nou text, p_actual text)
returns boolean
language sql
immutable
as $$
  select p_nou is null
      or p_nou in ('cooperativa', 'sl', 'sa', 'autonom', 'fundacio', 'associacio', 'altres')
      or p_nou is not distinct from p_actual;
$$;

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
    municipio_ine = case when d ? 'municipio_ine' then nullif(d->>'municipio_ine', '') else municipio_ine end
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
  if d ? 'perfil_receptor' and jsonb_typeof(d->'perfil_receptor') <> 'object' then
    raise exception 'perfil_receptor ha de ser un objecte' using errcode = '22023';
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
    perfil_receptor = case when d ? 'perfil_receptor' then d->'perfil_receptor' else perfil_receptor end
  where id = p_id
  returning * into e;
  return e;
end;
$$;

revoke execute on function public.actualitzar_fitxa_productor(uuid, jsonb) from public, anon;
revoke execute on function public.actualitzar_fitxa_entitat(uuid, jsonb) from public, anon;
grant execute on function public.actualitzar_fitxa_productor(uuid, jsonb) to authenticated;
grant execute on function public.actualitzar_fitxa_entitat(uuid, jsonb) to authenticated;
