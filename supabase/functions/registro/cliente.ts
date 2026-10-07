// El cliente de Supabase que reciben los módulos de `registro`.
//
// Sin tipos generados de la base, como en `_shared/gate.ts`: anotar el cliente con
// `ReturnType<typeof createClient>` resuelve el esquema a `never` y todo insert deja
// de compilar. Con el alias suelto, el tipado útil lo pone la validación (`validacio.ts`).
// deno-lint-ignore no-explicit-any
export type Cliente = any;
