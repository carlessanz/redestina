-- Plan 1, cierre de la deuda 150 (02-11-2026): el alta de fichas solo por RPC.
--
-- Desde 1B (20270501300000, publicada en `c67e12f`) el panel da de alta productores y entidades
-- únicamente por `crear_entitat()`, que exige NIF válido, razón social y `tipo_receptor` porque la
-- ficha nace activa. Las políticas `alta intern` seguían dejando a cualquiera del equipo insertar
-- directo por la API REST y saltarse esas reglas (una ficha activa sin NIF). Se retiran, y con
-- ellas el GRANT de INSERT: dos capas, como manda AGENTS.md §4.
--
-- No afecta a nadie que escriba hoy:
--   · las tres funciones que insertan fichas (`crear_entitat`, `afegir_paper_org_equip`,
--     `afegir_paper_organitzacio`) son `security definer`;
--   · el registro público, el alta asistida y `import-ara.ts` escriben con `service_role`;
--   · el frontend vigente no inserta en ninguna de las dos tablas.
-- UPDATE (edición del equipo y activar con NIF) y DELETE (solo super_admin) no cambian.
-- Compatible hacia atrás: el frontend publicado ya no usa el INSERT directo.

drop policy if exists "productores: alta intern" on public.productores;
drop policy if exists "entidades: alta intern" on public.entidades;

revoke insert on table public.productores from authenticated;
revoke insert on table public.entidades from authenticated;
