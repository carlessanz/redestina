// El tipo del cliente de Supabase que reciben los módulos de `_shared/`.
//
// POR QUÉ NO `any`. Hasta octubre de 2026 cada módulo declaraba su `type Cliente = any`, y
// con eso el compilador no veía ni una errata en `.from(...).select(...)`. `SupabaseClient`
// con sus genéricos por defecto (`Database = any`) sí comprueba la API del cliente —
// `from`, `rpc`, `storage`, `auth`— sin pedir tipos generados de la base, que el proyecto
// no tiene.
//
// ⚠️ NO es `ReturnType<typeof createClient>`: con el esquema inferido, PostgREST resuelve
//    las tablas a `never` y todo insert deja de compilar (nota de `registro/index.ts`).
//
// Es un `import type`: se borra al compilar, así que importar este fichero desde Vitest no
// arrastra `@supabase/supabase-js` en ejecución.
import type { SupabaseClient } from "@supabase/supabase-js";

export type ClienteSupabase = SupabaseClient;
