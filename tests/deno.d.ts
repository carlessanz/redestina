// El global `Deno`, declarado al mínimo para que `tsc` pueda comprobar las pruebas.
//
// Los módulos de `supabase/functions/_shared/` corren en Deno y leen sus secretos con
// `Deno.env.get()`. Las pruebas los importan desde Node, donde ese global NO existe — y eso
// está bien: las funciones que lo usan no se llaman desde ninguna prueba, porque lo que se
// prueba es la lógica pura. Lo único que hace falta es que el comprobador de tipos sepa que
// el nombre existe; si alguna prueba llegara a ejecutar una de esas funciones, fallaría en
// tiempo de ejecución con un `ReferenceError` bien visible, que es exactamente el aviso que
// se quiere. No es un sustituto ni un doble: es una declaración.
declare const Deno: {
  env: { get(clave: string): string | undefined }
  readFile(ruta: string | URL): Promise<Uint8Array>
}
