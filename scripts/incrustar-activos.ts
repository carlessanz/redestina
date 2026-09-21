/**
 * Regenera `supabase/functions/generar-documento/activos/incrustats.ts`, el módulo que
 * lleva las cuatro fuentes y el logo del PDF **dentro del bundle**, en base64.
 *
 * 🔴 **No es una optimización: es la única forma que funciona.** Los `static_files` de
 * `config.toml` dejaron de llegar al disco del isolate cuando cambió el modo de
 * despliegue del CLI (21-09-2026), y `Deno.readFile` empezó a responder `path not found`
 * para TODOS los documentos. Medido en producción: en ese runtime no existe ni el
 * directorio del propio módulo. Un módulo importado sí viaja siempre con el bundle.
 *
 * Ejecutar tras cambiar cualquier fuente o el logo:
 *   deno run -A scripts/incrustar-activos.ts
 */
/** base64 sin dependencias: `btoa` no acepta bytes, así que se le da la cadena binaria a trozos. */
function aBase64(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

const DIR = new URL("../supabase/functions/generar-documento/activos/", import.meta.url);
const FICHEROS: Record<string, string> = {
  titulo: "Sora-SemiBold.ttf",
  tituloFuerte: "Sora-Bold.ttf",
  cuerpo: "Inter-Regular.ttf",
  cuerpoFuerte: "Inter-SemiBold.ttf",
  logo: "logo-redestina-pdf.png",
};

const partes: string[] = [];
let total = 0;
for (const [clave, nombre] of Object.entries(FICHEROS)) {
  const bytes = await Deno.readFile(new URL(nombre, DIR));
  total += bytes.length;
  partes.push(`/** \`${nombre}\` — ${bytes.length} bytes. */\nexport const ${clave} =\n  "${aBase64(bytes)}";`);
}

const cabecera = `// GENERADO POR scripts/incrustar-activos.ts — NO EDITAR A MANO.
//
// Las cuatro fuentes y el logo del PDF, en base64, dentro del bundle. Los ficheros
// originales siguen en esta misma carpeta y son la fuente de verdad: este módulo es su
// copia empaquetada, y se regenera con el script.
//
// Por qué no se leen del disco: \`static_files\` de \`config.toml\` los sube, pero dónde
// (o si) los deja el runtime depende del modo de despliegue. El 21-09-2026 un redespliegue
// con el CLI nuevo hizo que no llegara ninguno, y \`generar-documento\` pasó a fallar con
// \`path not found\` en todos los documentos. Un módulo importado no tiene ese problema.
//
// Total incrustado: ${total} bytes.
`;

const destino = new URL("incrustats.ts", DIR);
await Deno.writeTextFile(destino, `${cabecera}\n${partes.join("\n\n")}\n`);
console.log(`escrito ${destino.pathname} (${total} bytes de activos)`);
