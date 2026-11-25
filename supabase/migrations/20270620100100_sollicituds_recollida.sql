-- Ofertas multiproducto (proceso 3.3; fase 6 del plan de noviembre de 2026), 2 de 7: la
-- SOLICITUD DE RECOGIDA, el segundo identificador de grupo.
--
-- Una entidad pide VARIOS productos de una misma disponibilidad con UNA fecha y hora de recogida.
-- Cada producto sigue siendo su propio interés (`oferta_respuestas`, uno por oferta y entidad) y,
-- si se aprueba, su propia canalización (con su ENT y su REC por recogida, sin cambios). La
-- solicitud solo los agrupa: `oferta_respuestas.sollicitud_id` y `canalizaciones.sollicitud_id`.
--
-- `sollicituds_recollida`:
--   · `disponibilitat_id` → `disponibilitats(id) on delete cascade` y `entidad_id` →
--     `entidades(id) on delete cascade`: la solicitud cae con la cabecera o con la ficha de la
--     entidad. `borrar_una_fitxa()` borra antes las respuestas y canalizaciones de esa ficha (o de
--     las ofertas del productor), así que el `set null` de abajo no llega a dispararse.
--   · `recollida_at` (la fecha y hora común), `canal` (los mismos valores que
--     `oferta_respuestas.canal`), `created_by`, `created_at`.
--   · `estat`: `pendent` (alguna línea por resolver: `pendent` o `proposada`) · `resolta` (alguna
--     aprobada) · `rebutjada` (ninguna aprobada ni pendiente). Lo mantiene SOLO el trigger
--     `oferta_respuestas_estat_sollicitud`, así que sigue siendo cierto aunque una línea se
--     apruebe o se anule por las puertas de siempre (`aprovar_resposta`, `anular_assignacio`…).
--     `resolta_at` = cuándo dejó de estar pendiente.
--   · `oferta_respuestas.sollicitud_id` y `canalizaciones.sollicitud_id` → `on delete set null`,
--     con índice parcial; los protege `trg_protegeix_grup()` (20270620100000).
--
-- Seguridad (§4): `authenticated` solo SELECT; escritura solo por RPC. RLS de lectura: el equipo
-- todo; la entidad las suyas; el productor las que ya tienen alguna canalización de una oferta
-- suya (puente `sollicituds_dels_meus_productors()`: el productor no ve intereses pendientes,
-- igual que no ve `oferta_respuestas`).

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists public.sollicituds_recollida (
  id                uuid primary key default gen_random_uuid(),
  disponibilitat_id uuid not null references public.disponibilitats(id) on delete cascade,
  entidad_id        uuid not null references public.entidades(id) on delete cascade,
  recollida_at      timestamptz,
  canal             text not null default 'panel',
  estat             text not null default 'pendent',
  resolta_at        timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint sollicituds_recollida_canal_check
    check (canal in ('whatsapp', 'email', 'panel', 'asistido', 'manual')),
  constraint sollicituds_recollida_estat_check
    check (estat in ('pendent', 'resolta', 'rebutjada'))
);

create index if not exists sollicituds_recollida_disponibilitat_idx
  on public.sollicituds_recollida (disponibilitat_id);
create index if not exists sollicituds_recollida_entitat_idx
  on public.sollicituds_recollida (entidad_id);
create index if not exists sollicituds_recollida_pendents_idx
  on public.sollicituds_recollida (created_at) where estat = 'pendent';

comment on table public.sollicituds_recollida is
  'Fase 6 (3.3, 20270620100100): una entidad pide varios productos de una disponibilidad con una '
  'sola fecha de recogida. Cada producto es su interés (oferta_respuestas.sollicitud_id) y, '
  'aprobado, su canalización (canalizaciones.sollicitud_id). Escritura solo por RPC; el estado lo '
  'mantiene el trigger oferta_respuestas_estat_sollicitud.';

alter table public.sollicituds_recollida enable row level security;

revoke all on public.sollicituds_recollida from anon, authenticated;
grant select on public.sollicituds_recollida to authenticated;
grant all on public.sollicituds_recollida to service_role;

-- ---------------------------------------------------------------------------
-- 2. Las columnas de grupo en intereses y canalizaciones
-- ---------------------------------------------------------------------------
alter table public.oferta_respuestas
  add column if not exists sollicitud_id uuid
    references public.sollicituds_recollida(id) on delete set null;
create index if not exists oferta_respuestas_sollicitud_idx
  on public.oferta_respuestas (sollicitud_id) where sollicitud_id is not null;

alter table public.canalizaciones
  add column if not exists sollicitud_id uuid
    references public.sollicituds_recollida(id) on delete set null;
create index if not exists canalizaciones_sollicitud_idx
  on public.canalizaciones (sollicitud_id) where sollicitud_id is not null;

comment on column public.oferta_respuestas.sollicitud_id is
  'Fase 6 (3.3): la solicitud multiproducto a la que pertenece este interés (null = interés suelto).';
comment on column public.canalizaciones.sollicitud_id is
  'Fase 6 (3.3): la solicitud multiproducto de la que nace esta canalización (null = suelta).';

drop trigger if exists oferta_respuestas_protegeix_grup on public.oferta_respuestas;
create trigger oferta_respuestas_protegeix_grup
  before insert or update of sollicitud_id on public.oferta_respuestas
  for each row execute function public.trg_protegeix_grup();

drop trigger if exists canalizaciones_protegeix_grup on public.canalizaciones;
create trigger canalizaciones_protegeix_grup
  before insert or update of sollicitud_id on public.canalizaciones
  for each row execute function public.trg_protegeix_grup();

-- ---------------------------------------------------------------------------
-- 3. El estado de la solicitud, derivado de sus líneas
-- ---------------------------------------------------------------------------
create or replace function public.recalcula_estat_sollicitud(p_sollicitud uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pend  int;
  v_apr   int;
  v_estat text;
begin
  if p_sollicitud is null then return null; end if;
  select count(*) filter (where r.aprovacio in ('pendent', 'proposada')),
         count(*) filter (where r.aprovacio = 'aprovada')
    into v_pend, v_apr
    from oferta_respuestas r
   where r.sollicitud_id = p_sollicitud;

  v_estat := case when v_pend > 0 then 'pendent'
                  when v_apr > 0 then 'resolta'
                  when v_pend + v_apr = 0
                       and not exists (select 1 from oferta_respuestas r
                                        where r.sollicitud_id = p_sollicitud) then 'pendent'
                  else 'rebutjada' end;

  update sollicituds_recollida
     set estat = v_estat,
         resolta_at = case when v_estat = 'pendent' then null
                           else coalesce(resolta_at, now()) end
   where id = p_sollicitud
     and (estat is distinct from v_estat
          or (v_estat = 'pendent' and resolta_at is not null)
          or (v_estat <> 'pendent' and resolta_at is null));
  return v_estat;
end;
$$;

revoke execute on function public.recalcula_estat_sollicitud(uuid) from public, anon, authenticated;
grant execute on function public.recalcula_estat_sollicitud(uuid) to service_role;

create or replace function public.trg_respostes_estat_sollicitud()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.sollicitud_id is not null
     and old.sollicitud_id is distinct from new.sollicitud_id then
    perform public.recalcula_estat_sollicitud(old.sollicitud_id);
  end if;
  if new.sollicitud_id is not null then
    perform public.recalcula_estat_sollicitud(new.sollicitud_id);
  end if;
  return null;
end;
$$;

revoke execute on function public.trg_respostes_estat_sollicitud() from public, anon, authenticated;

drop trigger if exists oferta_respuestas_estat_sollicitud on public.oferta_respuestas;
create trigger oferta_respuestas_estat_sollicitud
  after insert or update of aprovacio, sollicitud_id on public.oferta_respuestas
  for each row execute function public.trg_respostes_estat_sollicitud();

-- ---------------------------------------------------------------------------
-- 4. RLS de lectura
-- ---------------------------------------------------------------------------
-- El productor ve una solicitud cuando ya hay alguna canalización de una oferta suya en ella
-- (lo mismo que ya ve en `canalizaciones`); los intereses pendientes no son suyos.
create or replace function public.sollicituds_dels_meus_productors()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct c.sollicitud_id
    from canalizaciones c
    join excedentes e on e.id = c.excedente_id
   where c.sollicitud_id is not null
     and e.productor_id in (select public.mis_productores());
$$;

revoke execute on function public.sollicituds_dels_meus_productors() from public, anon;
grant execute on function public.sollicituds_dels_meus_productors() to authenticated, service_role;

comment on function public.sollicituds_dels_meus_productors() is
  'Fase 6 (20270620100100): puente de RLS. Solicitudes con alguna canalización de una oferta de '
  'los productores de la cuenta.';

drop policy if exists "sollicituds: service_role" on public.sollicituds_recollida;
create policy "sollicituds: service_role" on public.sollicituds_recollida
  for all to service_role using (true) with check (true);

drop policy if exists "sollicituds: lectura per rol" on public.sollicituds_recollida;
create policy "sollicituds: lectura per rol" on public.sollicituds_recollida
  for select to authenticated
  using (
    (select public.es_intern())
    or entidad_id in (select public.mis_entidades())
    or id in (select public.sollicituds_dels_meus_productors())
  );
