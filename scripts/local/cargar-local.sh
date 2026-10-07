#!/bin/bash
# Carga en el Supabase LOCAL el volcado de producción (07-10-2026).
#
#   bash scripts/local/cargar-local.sh
#
# Requisitos: el stack local arrancado (las migraciones ya han creado el esquema),
# supabase/.local-dump/ con el volcado (volcar-produccion.sh) y el entorno generado
# (preparar-entorno.sh), del que salen los secretos locales.
#
# Todo va en UNA transacción: o queda el clon entero o no cambia nada.
#   1. Vacía con TRUNCATE todo `public` y las cuentas locales. Hace falta porque las
#      migraciones siembran catálogos, series, plantillas, `app_settings`… y el volcado
#      trae esas mismas filas (`regles_pla` incluso sin `on conflict`).
#   2. Carga cuentas y datos con `session_replication_role = replica` (lo pone el propio
#      volcado): los triggers NO se ejecutan. Si se ejecutaran, llamarían a Edge Functions,
#      crearían albaranes y organizaciones de más y duplicarían `perfiles`. Todo lo que
#      calcularían ya viene calculado de producción.
#   3. Como replica tampoco comprueba claves foráneas, las comprueba a mano y aborta si
#      hay alguna huérfana.
#   4. Configura el entorno local: secretos SOLO locales en `app_config`, las funciones
#      apuntando al kong local, y los interruptores de seguridad encendidos.
#
# Se puede repetir: es la forma de refrescar el clon con un volcado nuevo.
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/comu.sh"
cargar_estado_local
exigir_contenedor_db

for f in datos-auth.sql datos-public.sql; do
  [ -s "$DIR_VOLCADO/$f" ] || morir "Falta supabase/.local-dump/$f: ejecuta antes volcar-produccion.sh."
done
[ -f "$ENV_FUNCIONES" ] || morir "Falta supabase/.env.funciones-local: ejecuta antes preparar-entorno.sh."
DOCS="$(grep -E '^DOCUMENTOS_SECRET=' "$ENV_FUNCIONES" | cut -d= -f2-)"
RECS="$(grep -E '^RECORDATORIOS_SECRET=' "$ENV_FUNCIONES" | cut -d= -f2-)"
[ -n "$DOCS" ] && [ -n "$RECS" ] || morir "Los secretos locales están vacíos en supabase/.env.funciones-local."

{
  cat <<'SQL'
-- Sin los NOTICE de cada tabla que arrastra el TRUNCATE: los avisos de verdad son WARNING.
set client_min_messages = warning;

-- 1. Vaciar lo que sembraron las migraciones y las cuentas locales.
do $$
declare t text;
begin
  select string_agg(format('public.%I', table_name), ', ')
    into t
    from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE';
  execute 'truncate table ' || t || ' cascade';
  truncate table auth.identities, auth.users cascade;
end $$;
SQL
  echo "-- 2. Cuentas"
  cat "$DIR_VOLCADO/datos-auth.sql"
  echo
  echo "-- 2. Datos de public"
  cat "$DIR_VOLCADO/datos-public.sql"
  echo
  cat <<SQL
set session_replication_role = origin;

-- 3. Claves foráneas: replica no las ha comprobado durante la carga.
do \$\$
declare
  c record;
  huerfanas bigint;
  total int := 0;
begin
  for c in
    select con.conname, con.conrelid::regclass as hija, con.confrelid::regclass as madre,
           (select string_agg(format('h.%I', a.attname), ',' order by k.n)
              from unnest(con.conkey) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols_h,
           (select string_agg(format('h.%I is not null', a.attname), ' and ' order by k.n)
              from unnest(con.conkey) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as no_nuls,
           (select string_agg(format('m.%I', a.attname), ',' order by k.n)
              from unnest(con.confkey) with ordinality k(attnum, n)
              join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as cols_m
      from pg_constraint con
      join pg_namespace ns on ns.oid = con.connamespace
     where con.contype = 'f' and ns.nspname in ('public', 'auth')
  loop
    execute format(
      'select count(*) from %s h where %s and not exists (select 1 from %s m where (%s) = (%s))',
      c.hija, c.no_nuls, c.madre, c.cols_m, c.cols_h)
      into huerfanas;
    if huerfanas > 0 then
      raise warning 'FK % (% → %): % fila(s) huérfana(s)', c.conname, c.hija, c.madre, huerfanas;
      total := total + 1;
    end if;
  end loop;
  if total > 0 then
    raise exception 'Hay % clave(s) foránea(s) con filas huérfanas: no se carga nada', total;
  end if;
end \$\$;

-- 4. Entorno local. Secretos nuevos y solo locales; nunca los de producción.
insert into app_config (key, value) values
  ('documentos_secret', '$DOCS'),
  ('recordatorios_secret', '$RECS'),
  ('functions_base_url', 'http://kong:8000/functions/v1')
on conflict (key) do update set value = excluded.value;

-- Interruptores de seguridad: modelo de roles encendido (si no, cualquier cuenta lo ve
-- todo) y modo test encendido (solo se «envía» a fichas es_test, y además se simula).
insert into app_settings (key, value) values ('roles_activos', 'true'), ('test_mode', 'true')
on conflict (key) do update set value = excluded.value;
SQL
} | psql_local --single-transaction -q >/dev/null

echo "Clon cargado. Recuento local:"
deno run -A "$REPO/scripts/local/recompte.ts" local
if [ -f "$DIR_VOLCADO/recompte-produccion.json" ]; then
  deno run -A "$REPO/scripts/local/recompte.ts" comparar || true
fi
