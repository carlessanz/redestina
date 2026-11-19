-- Fase 5 de los puntos 4-6: REALTIME para los contadores en vivo.
--
-- La interfaz se suscribe a `postgres_changes` para refrescar los badges (los de `pendents_equip()`
-- en el panel del equipo y los avisos / `pendents_meus()` en los externos) sin esperar a navegar.
-- `supabase_realtime` ya publicaba `wa_contacts`, `wa_messages`, `excedentes`, `canalizaciones`,
-- `oferta_respuestas` y `membresias`. Se añaden las tablas que alimentan colas de
-- `pendents_equip()` o los avisos y que aún no estaban:
--
--   · `avisos`             — campana y badges de los paneles externos;
--   · `convenios`          — cola `convenis_contrasignar` y «Pendent de tu» (firma);
--   · `albaranes`          — colas `albarans_esborrany`, `albarans_conciliar`, `albarans_esperant`
--                            y la confirmación de los externos;
--   · `firmes_document`    — cola `signatures_per_tancar` y «Pendent de tu» (firma de documentos);
--   · `excedentes_canvis`  — cola `ofertes_modificades`;
--   · `documentos`         — cola `documents_error`.
--
-- Fuera, a propósito (cambian poco y el contador se refresca al navegar): `cierres_ejercicio`
-- (`tancament`), `preus_carregues` / `preus_fonts_estat` (`preus`), `costes_producto` (`costos`).
--
-- Seguridad (comprobado en el clon sobre `realtime.apply_rls`):
--   · Realtime evalúa la RLS de cada suscriptor con su rol: las seis tienen RLS y política de
--     lectura (`avisos: els meus`, `convenis: intern o meus`, `albarans: intern o meus`, `firmes:
--     intern o meves`, `excedentes_canvis: equip i productor`, `documentos: intern o meus`);
--   · y filtra las COLUMNAS por `has_column_privilege(rol, tabla, columna, 'SELECT')`, también en
--     `old_record`: `documentos.envio` (fuera del GRANT de SELECT por columnas) no sale nunca;
--   · un DELETE no pasa por la RLS (Realtime no puede evaluarla sobre una fila borrada) y manda
--     solo la clave primaria (identidad de réplica por defecto). Ninguna de las seis se borra en
--     la operativa normal salvo por las puertas de borrado; lo que viaja es un uuid.
--   · Ninguna tabla cambia de identidad de réplica (`full` mandaría la fila antigua entera).
--
-- Idempotente: solo añade las que no estén ya en la publicación.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Sense publicacio supabase_realtime: no es publica res';
    return;
  end if;
  foreach t in array array['avisos', 'convenios', 'albaranes', 'firmes_document',
                           'excedentes_canvis', 'documentos'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
