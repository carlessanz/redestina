-- Ofertas multiproducto (proceso 3.3; fase 6 del plan de noviembre de 2026), 1 de 7: la
-- DISPONIBILIDAD, la cabecera que agrupa varias ofertas de un mismo productor publicadas a la vez.
--
-- 🔴 Principio: las ofertas (`excedentes`) SIGUEN SIENDO UNA POR PRODUCTO, con su `E-…`, su
-- estado, su Mercat, su compatibilidad, P8, convenio, asignación, recogida y albaranes. La
-- disponibilidad solo es un identificador de grupo: un mensaje único, un enlace único y una
-- solicitud conjunta. Una oferta de un solo producto no tiene disponibilidad (`null`) y funciona
-- exactamente como antes.
--
-- Qué crea:
--   · `disponibilitats` (id, `codi` legible `D-AAMMDD-XXX-N`, `productor_id`, `created_by`,
--     `created_at`). El código sale de `siglas_oferta()` + `siguiente_numero('D-AAMMDD-XXX', año)`
--     dentro de la transacción del alta (`crear_disponibilitat`, 20270620100300); no es una serie
--     fiscal (un hueco no importa).
--   · `excedentes.disponibilitat_id` → `disponibilitats(id) on delete set null` + índice parcial.
--     `set null` y no `cascade`: borrar la cabecera nunca puede arrastrar una oferta (ni sus
--     albaranes); en la práctica la cabecera solo se borra DESPUÉS que sus ofertas (vaciado y
--     borrado de ficha), así que el `set null` no llega a disparar ningún UPDATE.
--   · `disponibilitats.productor_id` → `productores(id) on delete cascade`: `borrar_una_fitxa()`
--     borra las ofertas del productor antes que la ficha, y la cabecera cae con la ficha sin tocar
--     la función de borrado (ver 20270620100200 para el vaciado).
--
-- Seguridad (§4, dos capas):
--   · GRANT: `authenticated` solo SELECT; `anon` nada; escritura solo por RPC (service_role).
--   · RLS de lectura: el equipo todo; el productor las suyas; el receptor las que tienen alguna
--     oferta que YA ve por la política de `excedentes` (puente `security definer`
--     `disponibilitats_visibles_meves()`, la misma regla que «excedentes: lectura per rol», sin
--     `exists` correlacionado).
--   · `excedentes.disponibilitat_id` solo lo escribe el servidor (service_role) o una RPC con la
--     marca de transacción `redestina.escriu_grup = 'on'`: el equipo tiene UPDATE directo sobre
--     `excedentes` (política «edicio intern») y sin esta guarda podría mover ofertas de grupo.

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists public.disponibilitats (
  id           uuid primary key default gen_random_uuid(),
  codi         text not null,
  productor_id uuid not null references public.productores(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint disponibilitats_codi_unic unique (codi),
  constraint disponibilitats_codi_format check (codi ~ '^D-[0-9]{6}-[A-Z]{3}-[0-9]+$')
);

create index if not exists disponibilitats_productor_idx on public.disponibilitats (productor_id);

comment on table public.disponibilitats is
  'Fase 6 (3.3, 20270620100000): cabecera de una oferta multiproducto. Agrupa varias ofertas '
  '(excedentes.disponibilitat_id) del mismo productor publicadas a la vez; cada oferta sigue siendo '
  'una por producto. Escritura solo por RPC (crear_disponibilitat).';
comment on column public.disponibilitats.codi is
  'Código legible D-AAMMDD-XXX-N (fecha de Madrid, siglas del productor, correlativo del día).';

alter table public.disponibilitats enable row level security;

revoke all on public.disponibilitats from anon, authenticated;
grant select on public.disponibilitats to authenticated;
grant all on public.disponibilitats to service_role;

-- ---------------------------------------------------------------------------
-- 2. La columna de grupo en `excedentes`
-- ---------------------------------------------------------------------------
alter table public.excedentes
  add column if not exists disponibilitat_id uuid
    references public.disponibilitats(id) on delete set null;

create index if not exists excedentes_disponibilitat_idx
  on public.excedentes (disponibilitat_id) where disponibilitat_id is not null;

comment on column public.excedentes.disponibilitat_id is
  'Fase 6 (3.3): la disponibilidad multiproducto a la que pertenece esta oferta (null = oferta de '
  'un solo producto, como siempre). La escribe solo el servidor o una RPC con redestina.escriu_grup.';

-- ---------------------------------------------------------------------------
-- 3. Puente de lectura para el receptor (security definer, setof uuid)
-- ---------------------------------------------------------------------------
-- Las disponibilidades con alguna oferta que la cuenta YA ve como receptora: es la parte de
-- receptor de «excedentes: lectura per rol» (Mercat compatible, interés propio o canalización
-- propia). El equipo y el productor tienen su rama propia en la política.
create or replace function public.disponibilitats_visibles_meves()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct e.disponibilitat_id
    from excedentes e
   where e.disponibilitat_id is not null
     and ((e.estado in ('publicada', 'parcial')
           and e.modalitats && array(select public.modalitats_compatibles_meves()))
          or e.id in (select public.excedents_amb_interes_meu())
          or e.id in (select public.excedents_de_les_meves_canalitzacions()));
$$;

revoke execute on function public.disponibilitats_visibles_meves() from public, anon;
grant execute on function public.disponibilitats_visibles_meves() to authenticated, service_role;

comment on function public.disponibilitats_visibles_meves() is
  'Fase 6 (20270620100000): puente de RLS. Disponibilidades con alguna oferta que el receptor ya ve '
  '(misma regla que la rama de receptor de «excedentes: lectura per rol»).';

drop policy if exists "disponibilitats: service_role" on public.disponibilitats;
create policy "disponibilitats: service_role" on public.disponibilitats
  for all to service_role using (true) with check (true);

drop policy if exists "disponibilitats: lectura per rol" on public.disponibilitats;
create policy "disponibilitats: lectura per rol" on public.disponibilitats
  for select to authenticated
  using (
    (select public.es_intern())
    or productor_id in (select public.mis_productores())
    or id in (select public.disponibilitats_visibles_meves())
  );

-- ---------------------------------------------------------------------------
-- 4. Guarda de las columnas de grupo (excedentes; la reutilizan oferta_respuestas y canalizaciones)
-- ---------------------------------------------------------------------------
-- Solo el servidor (service_role) o una RPC del grupo (marca de transacción
-- `redestina.escriu_grup`) escriben los identificadores de grupo. El traspaso de autoría y el
-- vaciado no los tocan; el `on delete set null` de las FK sí podría (y pasa: lo hace el dueño
-- de la tabla con la marca de reinicio o sin sesión).
create or replace function public.trg_protegeix_grup()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_nou   uuid;
  v_vell  uuid;
begin
  if auth.uid() is null
     or coalesce(current_setting('redestina.escriu_grup', true), '') = 'on'
     or coalesce(current_setting('redestina.reinicio_dades', true), '') = 'on' then
    return new;
  end if;
  if tg_table_name = 'excedentes' then
    v_nou := new.disponibilitat_id;
    v_vell := case when tg_op = 'UPDATE' then old.disponibilitat_id end;
  else
    v_nou := new.sollicitud_id;
    v_vell := case when tg_op = 'UPDATE' then old.sollicitud_id end;
  end if;
  if (tg_op = 'INSERT' and v_nou is not null)
     or (tg_op = 'UPDATE' and v_nou is distinct from v_vell) then
    raise exception 'grup_protegit: el grup d''una oferta nomes l''escriuen les RPC multiproducte'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_protegeix_grup() from public, anon, authenticated;

drop trigger if exists excedentes_protegeix_grup on public.excedentes;
create trigger excedentes_protegeix_grup
  before insert or update of disponibilitat_id on public.excedentes
  for each row execute function public.trg_protegeix_grup();
