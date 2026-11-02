-- Plan 1 · rebanada 1E (02-11-2026): `ref_externa` en las dos fichas, para importar el ARA 2026.
--
-- POR QUÉ. El importador `scripts/import-ara-2026.ts` carga las organizaciones del ARA como
-- INACTIVAS (D2) y tiene que poder repetirse sin duplicar: cada ficha importada guarda de qué
-- hoja y de qué fila del CSV salió (`ARA26:<hoja>:<fila>`) y la segunda pasada la encuentra por
-- ahí. El plan la daba por puesta en 1A, pero 1A no la añadió (solo existía en `excedentes` y
-- `espigoladas`). SOLO AÑADE: columna nullable sin default, el frontend vigente sigue igual (§7).
--
-- Permisos: las dos tablas tienen GRANT de tabla para `authenticated`, así que la columna nace
-- legible (RLS de siempre) y escribible solo por quien ya escribe la ficha (el equipo, RLS
-- `gestio intern`). La interfaz no la enseña ni la edita (`NO_ES_MOSTRA` en `campsFitxa.ts`): es
-- trazabilidad del origen, no un dato de la entidad.

alter table public.productores add column if not exists ref_externa text;
alter table public.entidades   add column if not exists ref_externa text;

comment on column public.productores.ref_externa is
  'Origen de una ficha importada (ARA26:<hoja>:<fila del CSV>). Clave de idempotencia de scripts/import-ara-2026.ts (20270503100000).';
comment on column public.entidades.ref_externa is
  'Origen de una ficha importada (ARA26:<hoja>:<fila del CSV>). Clave de idempotencia de scripts/import-ara-2026.ts (20270503100000).';

-- Única cuando existe: dos fichas no pueden decir que vienen de la misma fila.
create unique index if not exists productores_ref_externa_uidx
  on public.productores (ref_externa) where ref_externa is not null;
create unique index if not exists entidades_ref_externa_uidx
  on public.entidades (ref_externa) where ref_externa is not null;
