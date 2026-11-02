-- Plan 1 · rebanada 1A (02-11-2026): estado, búsqueda y activación de las entidades.
--
-- POR QUÉ. El proceso 1 de la Taula mestra pide importar las organizaciones del ARA como
-- INACTIVAS (D2) y activarlas después exigiendo el NIF, buscar por NIF o nombre antes de dar
-- de alta (D6), decidir «inactiva» por rol y por organización (D7) y retirar las «Persones de
-- contacte» (D3: un solo contacto por entidad). Esta migración es la base de las demás
-- rebanadas y SOLO AÑADE: el frontend vigente sigue sirviéndose igual (§7).
--
-- Contenido:
--   1. `entidades.activo` (los productores ya lo tenían).
--   2. `fitxa_estat_hist` + trigger `*_estat`: activar exige NIF válido y razón social, y todo
--      cambio de `activo` deja rastro — también el que hace el equipo directo en la tabla.
--   3. `v_organizaciones` ampliada (columnas al final, sigue `security_invoker`).
--   4. `cerca_entitats()`: NIF que empieza por, o nombre que contiene o se parece.
--   5. `activar_fitxa()` · `desactivar_fitxa()` · `desactivar_organitzacio()`.
--   6. `afegir_paper_org_equip()`: el equipo añade el otro papel, sin membresía.
--   7. D3: `desar_contacte_org` / `esborrar_contacte_org` sin EXECUTE para `authenticated`.
--   8. Consumidores de `activo`: el Mercat, el interés (panel y asistido) y `kpis_equip()`.

-- ---------------------------------------------------------------------------
-- 1. `entidades.activo`
-- ---------------------------------------------------------------------------
-- `default true`: las entidades que ya existen siguen operando igual. Las importadas (1E)
-- entrarán con `false` explícito. `entidades` tiene GRANT de tabla, así que la columna nace
-- legible y escribible por el equipo (RLS `gestio intern`) sin tocar nada.
alter table public.entidades add column if not exists activo boolean not null default true;

comment on column public.entidades.activo is
  'La ficha opera (Mercat, priorización, interés). Activar exige NIF válido y razón social (trigger entidades_estat, 20270501100000).';

-- ---------------------------------------------------------------------------
-- 2. El histórico y la regla de activación, en un trigger
-- ---------------------------------------------------------------------------
-- En trigger y no solo en la RPC: el equipo escribe las fichas DIRECTO (RLS `gestio intern`,
-- `RecordDetail` enseña la casilla `activo` del productor), así que una regla que viviera solo
-- en `activar_fitxa()` se saltaría desde la ficha sin que nada lo dijera.
--
-- Dos FK excluyentes con `on delete cascade`, como `membresias`: `borrar_ficha_completa()`
-- arrastra el histórico con la ficha y no deja huérfanos (§7).
create table if not exists public.fitxa_estat_hist (
  id           uuid primary key default gen_random_uuid(),
  tipus        text not null check (tipus in ('productor', 'entidad')),
  productor_id uuid references public.productores(id) on delete cascade,
  entidad_id   uuid references public.entidades(id) on delete cascade,
  activo       boolean not null,
  per          uuid references public.perfiles(id) on delete set null,
  at           timestamptz not null default now(),
  constraint fitxa_estat_hist_una_fitxa check (
    (tipus = 'productor' and productor_id is not null and entidad_id is null)
    or (tipus = 'entidad' and entidad_id is not null and productor_id is null)
  )
);
create index if not exists fitxa_estat_hist_productor on public.fitxa_estat_hist (productor_id, at desc) where productor_id is not null;
create index if not exists fitxa_estat_hist_entidad on public.fitxa_estat_hist (entidad_id, at desc) where entidad_id is not null;

comment on table public.fitxa_estat_hist is
  'Cada cambio de `activo` de una ficha: quién (`per`, null = servidor) y cuándo. Solo inserción, por trigger. Lectura: equipo.';

-- Dos capas (§4): `authenticated` SELECT y nada más (los privilegios por defecto de escritura
-- ya están revocados), y la política deja leer solo al equipo.
alter table public.fitxa_estat_hist enable row level security;
revoke all on public.fitxa_estat_hist from anon;
revoke insert, update, delete, truncate on public.fitxa_estat_hist from authenticated;
grant select on public.fitxa_estat_hist to authenticated;
drop policy if exists fitxa_estat_hist_llegir on public.fitxa_estat_hist;
create policy fitxa_estat_hist_llegir on public.fitxa_estat_hist
  for select to authenticated
  using ((select public.es_intern()));

create or replace function public.trg_fitxa_estat()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.activo is not distinct from old.activo then
    return new;
  end if;
  -- Activar (de inactiva a activa) exige NIF presente y válido y razón social (D2, P9: el
  -- domicilio lo pedirá el convenio cuando toque). Desactivar no exige nada.
  if new.activo and not coalesce(old.activo, false) then
    if nullif(btrim(coalesce(new.nif, '')), '') is null then
      raise exception 'falta_nif: cal el NIF per activar la fitxa' using errcode = '22023';
    end if;
    if not public.nif_valid(new.nif) then
      raise exception 'nif_invalid: el NIF % no es valid', new.nif using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(new.razon_social, '')), '') is null then
      raise exception 'falta_rao_social: cal la rao social per activar la fitxa' using errcode = '22023';
    end if;
  end if;
  insert into public.fitxa_estat_hist (tipus, productor_id, entidad_id, activo, per)
  values (
    case tg_table_name when 'productores' then 'productor' else 'entidad' end,
    case when tg_table_name = 'productores' then new.id end,
    case when tg_table_name = 'entidades' then new.id end,
    coalesce(new.activo, false),
    auth.uid()
  );
  return new;
end;
$$;
revoke execute on function public.trg_fitxa_estat() from public, anon, authenticated;

drop trigger if exists productores_estat on public.productores;
create trigger productores_estat before update of activo on public.productores
  for each row execute function public.trg_fitxa_estat();
drop trigger if exists entidades_estat on public.entidades;
create trigger entidades_estat before update of activo on public.entidades
  for each row execute function public.trg_fitxa_estat();

-- ---------------------------------------------------------------------------
-- 3. `v_organizaciones` ampliada
-- ---------------------------------------------------------------------------
-- `create or replace view` solo admite AÑADIR columnas al final: las de antes, en su orden.
-- Sigue `security_invoker` (§12.29): sin él se saltaría la RLS de las dos fichas.
-- `activa` es DERIVADA (D7): la organización está activa si lo está alguno de sus papeles, sin
-- columna propia que pueda discrepar. El estado de la cuenta sale de `membresias`, cuya RLS
-- deja al equipo verlas todas y a cada cuenta las suyas.
create or replace view public.v_organizaciones
with (security_invoker = true) as
  select o.id,
         coalesce(p.name, e.nombre)                        as nombre,
         coalesce(nullif(p.nif, ''), nullif(e.nif, ''))     as nif,
         coalesce(nullif(p.email, ''), nullif(e.email, '')) as email,
         coalesce(nullif(p.phone, ''), nullif(e.telefono, '')) as telefono,
         coalesce(p.poblacion, e.poblacion)                 as poblacion,
         p.id      as productor_id,
         e.id      as entidad_id,
         (p.id is not null) as es_generadora,
         (e.id is not null) as es_receptora,
         e.tipo_receptor,
         o.canal_preferido,
         o.created_at,
         -- 1A (20270501100000)
         (coalesce(p.activo, false) or coalesce(e.activo, false)) as activa,
         p.activo  as productor_activo,
         e.activo  as entidad_activo,
         coalesce(nullif(p.razon_social, ''), nullif(e.razon_social, '')) as razon_social,
         coalesce(nullif(p.empresa, ''), nullif(e.nombre, ''), nullif(p.name, '')) as nom_comercial,
         coalesce(nullif(p.name, ''), nullif(e.contacto, ''))  as persona_contacte,
         coalesce(p.municipio_ine, e.municipio_ine)            as municipio_ine,
         coalesce(nullif(p.area_geografica, ''), nullif(e.area_geografica, '')) as comarca,
         array(select distinct x
                 from unnest(coalesce(p.tipus_activitat, '{}'::text[]) || coalesce(e.tipus_activitat, '{}'::text[])) x
                order by x) as tipus_activitat,
         coalesce(m.n_actives, 0) > 0 as te_compte,
         case
           when coalesce(m.n_actives, 0) > 0     then 'activa'
           when coalesce(m.n_pendents, 0) > 0    then 'pendent'
           when coalesce(m.n_desactivades, 0) > 0 then 'desactivada'
           else 'cap'
         end as compte_estat
    from public.organizaciones o
    left join public.productores p on p.organizacion_id = o.id
    left join public.entidades   e on e.organizacion_id = o.id
    left join lateral (
      select count(*) filter (where mb.activo and mb.aprovacio = 'aprovada' and pf.activo)            as n_actives,
             count(*) filter (where mb.aprovacio = 'pendent')                                         as n_pendents,
             count(*) filter (where mb.aprovacio = 'aprovada' and not (mb.activo and pf.activo))     as n_desactivades
        from public.membresias mb
        join public.perfiles pf on pf.id = mb.user_id
       where (p.id is not null and mb.productor_id = p.id)
          or (e.id is not null and mb.entidad_id = e.id)
    ) m on true;

comment on view public.v_organizaciones is
  'Quién es cada organización, leído de sus fichas: nunca se duplica el nombre ni el NIF. '
  'Los roles (`es_generadora`, `es_receptora`) son DERIVADOS de tener ficha, y `activa` de tener '
  'algún papel activo (D7, 20270501100000). `compte_estat`: cap · pendent · activa · desactivada.';

-- ---------------------------------------------------------------------------
-- 4. `cerca_entitats()` (D6)
-- ---------------------------------------------------------------------------
-- El primer paso del alta (1B) y, después, «Nova oferta» (fila 3.1). Solo equipo: devuelve
-- NIF, nombre y contacto de cualquier organización. `security definer` para no depender de
-- que cada llamada lleve la RLS de dos tablas más membresías; la guarda es la única capa.
-- Sin EXECUTE para `service_role` y con sesión obligatoria: no hay ningún job que la necesite.
create or replace function public.cerca_entitats(
  p_q            text,
  p_nomes_actives boolean default false,
  p_limit        integer default 10
) returns table (
  organizacion_id  uuid,
  nom_comercial    text,
  razon_social     text,
  nif              text,
  persona_contacte text,
  poblacion        text,
  comarca          text,
  productor_id     uuid,
  entidad_id       uuid,
  es_generadora    boolean,
  es_receptora     boolean,
  productor_activo boolean,
  entidad_activo   boolean,
  activa           boolean,
  te_compte        boolean,
  compte_estat     text,
  coincidencia     text,
  similitud        numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- Para el NIF: mayúsculas, sin espacios, puntos ni guiones (la forma en que se guarda).
  v_nif text := upper(regexp_replace(coalesce(p_q, ''), '[\s.\-]', '', 'g'));
  -- Para el nombre: minúsculas y espacios colapsados (no se quitan: «mas de prova»).
  v_nom text := lower(btrim(regexp_replace(coalesce(p_q, ''), '\s+', ' ', 'g')));
  v_lim int := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip pot cercar entitats' using errcode = '42501';
  end if;
  if char_length(v_nom) < 3 and char_length(v_nif) < 3 then
    return;
  end if;

  return query
  with base as (
    select v.*,
           upper(regexp_replace(coalesce(v.nif, ''), '[\s.\-]', '', 'g')) as nif_n,
           greatest(
             similarity(lower(coalesce(v.nom_comercial, '')), v_nom),
             similarity(lower(coalesce(v.razon_social, '')), v_nom),
             similarity(lower(coalesce(v.persona_contacte, '')), v_nom)
           )::numeric as sim,
           (strpos(lower(coalesce(v.nom_comercial, '')), v_nom) > 0
             or strpos(lower(coalesce(v.razon_social, '')), v_nom) > 0
             or strpos(lower(coalesce(v.persona_contacte, '')), v_nom) > 0) as conte
      from public.v_organizaciones v
     where not p_nomes_actives or v.activa
  )
  select b.id, b.nom_comercial, b.razon_social, b.nif, b.persona_contacte, b.poblacion, b.comarca,
         b.productor_id, b.entidad_id, b.es_generadora, b.es_receptora,
         b.productor_activo, b.entidad_activo, b.activa, b.te_compte, b.compte_estat,
         case
           when char_length(v_nif) >= 3 and b.nif_n = v_nif        then 'nif_exacte'
           when char_length(v_nif) >= 3 and b.nif_n like v_nif || '%' then 'nif'
           else 'nom'
         end,
         round(b.sim, 3)
    from base b
   where (char_length(v_nif) >= 3 and b.nif_n <> '' and b.nif_n like v_nif || '%')
      or (char_length(v_nom) >= 3 and (b.conte or b.sim >= 0.4))
   order by (b.nif_n = v_nif) desc,
            (char_length(v_nif) >= 3 and b.nif_n like v_nif || '%') desc,
            b.conte desc,
            b.sim desc,
            b.nom_comercial
   limit v_lim;
end;
$$;
revoke execute on function public.cerca_entitats(text, boolean, integer) from public, anon, service_role;
grant execute on function public.cerca_entitats(text, boolean, integer) to authenticated;

comment on function public.cerca_entitats(text, boolean, integer) is
  'D6 (20270501100000): busca organizaciones por NIF (empieza por) o nombre (contiene o similitud >= 0,4). Solo equipo con sesión. <3 caracteres = vacío.';

-- ---------------------------------------------------------------------------
-- 5. Activar y desactivar (D2, D7)
-- ---------------------------------------------------------------------------
-- Solo `pot_aprovar()` CON SESIÓN: activar abre el Mercat y la priorización a una
-- organización, y queda escrito quién lo hizo (`fitxa_estat_hist.per`). Las reglas (NIF,
-- razón social) y el rastro las pone el trigger; aquí solo se autoriza y se escribe.
-- Idempotentes: activar una activa no escribe ni deja rastro.
create or replace function public.activar_fitxa(p_tipus text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_abans boolean;
begin
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes l''equip pot activar una fitxa' using errcode = '42501';
  end if;
  if p_tipus = 'productor' then
    select activo into v_abans from productores where id = p_id for update;
    if not found then raise exception 'fitxa_inexistent' using errcode = '22023'; end if;
    if not v_abans then update productores set activo = true where id = p_id; end if;
  elsif p_tipus = 'entidad' then
    select activo into v_abans from entidades where id = p_id for update;
    if not found then raise exception 'fitxa_inexistent' using errcode = '22023'; end if;
    if not v_abans then update entidades set activo = true where id = p_id; end if;
  else
    raise exception 'tipus_desconegut' using errcode = '22023';
  end if;
  return jsonb_build_object('tipus', p_tipus, 'id', p_id, 'activo', true, 'canviat', not v_abans);
end;
$$;

create or replace function public.desactivar_fitxa(p_tipus text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_abans boolean;
begin
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes l''equip pot desactivar una fitxa' using errcode = '42501';
  end if;
  if p_tipus = 'productor' then
    select activo into v_abans from productores where id = p_id for update;
    if not found then raise exception 'fitxa_inexistent' using errcode = '22023'; end if;
    if v_abans then update productores set activo = false where id = p_id; end if;
  elsif p_tipus = 'entidad' then
    select activo into v_abans from entidades where id = p_id for update;
    if not found then raise exception 'fitxa_inexistent' using errcode = '22023'; end if;
    if v_abans then update entidades set activo = false where id = p_id; end if;
  else
    raise exception 'tipus_desconegut' using errcode = '22023';
  end if;
  return jsonb_build_object('tipus', p_tipus, 'id', p_id, 'activo', false, 'canviat', v_abans);
end;
$$;

-- «Desactiva l'entitat» (D7): todos sus papeles a la vez, en una transacción.
create or replace function public.desactivar_organitzacio(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p int;
  v_e int;
begin
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes l''equip pot desactivar una organitzacio' using errcode = '42501';
  end if;
  if not exists (select 1 from organizaciones where id = p_org) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;
  update productores set activo = false where organizacion_id = p_org and activo;
  get diagnostics v_p = row_count;
  update entidades set activo = false where organizacion_id = p_org and activo;
  get diagnostics v_e = row_count;
  return jsonb_build_object('organizacion_id', p_org, 'productors', v_p, 'entitats', v_e);
end;
$$;

revoke execute on function public.activar_fitxa(text, uuid) from public, anon, service_role;
revoke execute on function public.desactivar_fitxa(text, uuid) from public, anon, service_role;
revoke execute on function public.desactivar_organitzacio(uuid) from public, anon, service_role;
grant execute on function public.activar_fitxa(text, uuid) to authenticated;
grant execute on function public.desactivar_fitxa(text, uuid) to authenticated;
grant execute on function public.desactivar_organitzacio(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. `afegir_paper_org_equip()`
-- ---------------------------------------------------------------------------
-- La variante de equipo de `afegir_paper_organitzacio()` (que solo puede el titular): crea la
-- ficha hermana con los datos comunes de la existente y SIN membresía —la cuenta, si la hay,
-- se enlaza en 1D—. La hermana hereda el `activo` de la otra: una organización inactiva no se
-- activa por ganar un papel (activarla pasa por el NIF, §2 de esta migración). Una entidad
-- nueva nace sin `tipo_receptor`, que fija el equipo, igual que en la del titular. El NIF solo
-- se copia si es válido: uno heredado mal escrito haría saltar `nif_invalid` en el insert (el
-- trigger del NIF valida al crear) y el equipo no podría añadir el papel por un dato viejo.
create or replace function public.afegir_paper_org_equip(p_org uuid, p_paper text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p productores%rowtype;
  e entidades%rowtype;
  v_nou uuid;
begin
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes l''equip pot afegir un paper a una organitzacio' using errcode = '42501';
  end if;
  if p_paper not in ('productor', 'entidad') then
    raise exception 'paper_desconegut' using errcode = '22023';
  end if;
  if not exists (select 1 from organizaciones where id = p_org) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;

  select * into p from productores where organizacion_id = p_org;
  select * into e from entidades   where organizacion_id = p_org;

  if p_paper = 'entidad' then
    if e.id is not null then raise exception 'ja_te_paper' using errcode = '22023'; end if;
    if p.id is null then raise exception 'organitzacio_buida' using errcode = '22023'; end if;
    begin
      insert into entidades (nombre, razon_social, contacto, email, telefono, nif, direccion, codigo_postal,
                             municipio_ine, organizacion_id, es_test, activo)
      values (coalesce(nullif(p.empresa, ''), p.name), p.razon_social, p.name, p.email, p.phone,
              case when public.nif_valid(p.nif) then p.nif end,
              p.direccion, p.codigo_postal, p.municipio_ine, p_org, p.es_test, coalesce(p.activo, false))
      returning id into v_nou;
    exception when unique_violation then
      raise exception 'dades_en_us' using errcode = '22023';
    end;
  else
    if p.id is not null then raise exception 'ja_te_paper' using errcode = '22023'; end if;
    if e.id is null then raise exception 'organitzacio_buida' using errcode = '22023'; end if;
    begin
      insert into productores (name, empresa, razon_social, email, phone, nif, direccion, codigo_postal,
                               municipio_ine, organizacion_id, es_test, activo)
      values (coalesce(nullif(e.contacto, ''), e.nombre), e.nombre, e.razon_social, e.email, e.telefono,
              case when public.nif_valid(e.nif) then e.nif end,
              e.direccion, e.codigo_postal, e.municipio_ine, p_org, e.es_test, coalesce(e.activo, false))
      returning id into v_nou;
    exception when unique_violation then
      raise exception 'dades_en_us' using errcode = '22023';
    end;
  end if;

  return jsonb_build_object('tipo', p_paper, 'id', v_nou, 'organizacion_id', p_org);
end;
$$;
revoke execute on function public.afegir_paper_org_equip(uuid, text) from public, anon, service_role;
grant execute on function public.afegir_paper_org_equip(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. D3: se retiran las «Persones de contacte»
-- ---------------------------------------------------------------------------
-- Un solo contacto por entidad: el de la ficha. Las RPC quedan solo para `service_role` (por
-- si hay que migrar datos) y la tabla NO se borra en este plan (P6: un `drop table` es
-- destructivo y va en una migración posterior, con autorización explícita).
revoke execute on function public.desar_contacte_org(uuid, uuid, jsonb) from authenticated;
revoke execute on function public.esborrar_contacte_org(uuid) from authenticated;
grant execute on function public.desar_contacte_org(uuid, uuid, jsonb) to service_role;
grant execute on function public.esborrar_contacte_org(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Consumidores de `activo`
-- ---------------------------------------------------------------------------
-- 8a. El Mercat: una entidad INACTIVA con cuenta no ve ofertas nuevas. La rama del mercado de
-- la RLS de `excedentes` pasa por este puente; las otras dos (sus intereses y sus entregas)
-- no se tocan, así que conserva su historia. Misma firma y mismos GRANT (`create or replace`).
create or replace function public.modalitats_compatibles_meves()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct c.modalitat
    from entidades e
    join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
   where e.id in (select public.mis_entidades())
     and e.activo;
$$;

-- 8b. El interés: panel y asistido comparten `comprova_interes()`, así que el rechazo vive aquí
-- y no puede divergir. Va PRIMERO: decir «inactiva» es más útil que cualquier otra guarda.
create or replace function public.comprova_interes(
  p_excedente uuid,
  p_entidad   uuid,
  p_kg        numeric,
  p_preu      numeric,
  p_modalitat text,
  p_recollida timestamptz
) returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  ex     excedentes;
  v_mods text[];
  v_cand text[];
  v_mod  text;
begin
  if exists (select 1 from entidades where id = p_entidad and not activo) then
    raise exception 'entitat_inactiva: aquesta entitat no esta activa' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.estado not in ('publicada', 'parcial') then
    raise exception 'Aquesta oferta ja no esta disponible' using errcode = '22023';
  end if;

  v_mods := coalesce(ex.modalitats, array[ex.modalitat]);
  select coalesce(array_agg(c.modalitat), '{}') into v_cand
    from entidades e
    join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
   where e.id = p_entidad and c.modalitat = any(v_mods);

  if cardinality(v_cand) = 0 then
    raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
  end if;
  if p_modalitat is not null then
    if not (p_modalitat = any(v_cand)) then
      raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
    end if;
    v_mod := p_modalitat;
  elsif cardinality(v_cand) = 1 then
    v_mod := v_cand[1];
  else
    raise exception 'cal_modalitat: tria com vols rebre-la' using errcode = '22023';
  end if;

  perform public.exigir_convenio('entidad', p_entidad, v_mod, 'recibe');

  if p_kg is null or p_kg <= 0 then
    raise exception 'Cal indicar quants kg' using errcode = '22023';
  end if;
  if ex.kg_total is not null and p_kg > ex.kg_total then
    raise exception 'kg_maxim: com a maxim % kg', ex.kg_total using errcode = '22023';
  end if;
  if v_mod in ('venda', 'maquila') and ex.preu_minim is not null
     and (p_preu is null or p_preu < ex.preu_minim) then
    raise exception 'El preu ha de ser com a minim % EUR/kg', ex.preu_minim using errcode = '22023';
  end if;

  perform public.comprova_hora_recollida(ex, p_recollida);
  return v_mod;
end;
$$;
revoke execute on function public.comprova_interes(uuid, uuid, numeric, numeric, text, timestamptz)
  from public, anon, authenticated, service_role;

-- 8c. `kpis_equip()`: `entitats_receptores` es un HECHO del periodo (quién recibió) y no se
-- filtra por el `activo` de hoy, que falsearía periodos pasados. Se añaden las cifras de
-- organizaciones ACTIVAS de hoy, que es donde el tablero cuenta organizaciones como censo.
create or replace function public.kpis_equip(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip veu els indicadors' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'periode_invalid' using errcode = '22023';
  end if;

  with ofertes as (
    select ex.*, (ex.created_at at time zone 'Europe/Madrid')::date as dia_alta
      from excedentes ex
  ), canals as (
    select c.*,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at) at time zone 'Europe/Madrid')::date as dia
      from canalizaciones c
     where c.estado <> 'anulada'
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    -- Kilos oficiales (conciliados, D13) con la recogida dentro del periodo.
    'kg_canalitzats', coalesce((select sum(coalesce(c.kg_conciliados, c.kg_reales, c.kg_confirmados))
                                  from canals c where c.estado = 'conciliada' and c.dia between p_desde and p_hasta), 0),
    -- Kilos asignados (aprobados) en el periodo, conciliados o no.
    'kg_assignats', coalesce((select sum(c.kg_confirmados) from canals c where c.dia between p_desde and p_hasta), 0),
    'canalitzacions', (select count(*) from canals c where c.dia between p_desde and p_hasta),
    'ofertes_noves', (select count(*) from ofertes o where o.dia_alta between p_desde and p_hasta),
    'kg_oferts', coalesce((select sum(o.kg_total) from ofertes o where o.dia_alta between p_desde and p_hasta), 0),
    -- Las de ahora, sin periodo: lo que está vivo hoy.
    'ofertes_actives', (select count(*) from ofertes o where o.estado in ('pendent_validacio', 'publicada', 'parcial', 'bloqueada')),
    'kg_pendents', coalesce((select sum(greatest(0, o.kg_total - coalesce((select sum(c.kg_confirmados) from canals c where c.excedente_id = o.id), 0)))
                               from ofertes o where o.estado in ('publicada', 'parcial')), 0),
    -- Las que acabaron sin salida en el periodo (por su fecha límite).
    'ofertes_sense_sortida', (select count(*) from ofertes o
                               where o.estado = 'no_colocada' and o.disponible_hasta between p_desde and p_hasta),
    'entitats_receptores', (select count(distinct c.entidad_id) from canals c where c.dia between p_desde and p_hasta),
    -- 1A (20270501100000): el censo de hoy, solo lo activo (D7: la organización está activa
    -- si lo está alguno de sus papeles).
    'entitats_actives', (select count(*) from v_organizaciones v where v.activa),
    'ofertants_actius', (select count(*) from productores p where p.activo),
    'receptors_actius', (select count(*) from entidades e where e.activo)
  ) into v;
  return v;
end;
$$;
