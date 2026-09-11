// Saber qué Edge Functions han cambiado de verdad entre dos despliegues.
//
// EL PROBLEMA (deuda §12.44). La salida de `supabase functions deploy` **no sirve** para
// saberlo: solo `No change found in Function: X` es concluyente, y su ausencia no prueba
// nada —el 10-09-2026 cinco funciones desplegadas hacía diez minutos volvieron a
// empaquetarse sin que su código hubiera cambiado—. Y `updated_at` de `functions list`
// tampoco: puede ser viejo con el bundle al día, porque se despliega, se verifica contra
// producción y se commitea después.
//
// Lo que sí es fiable es el **`ezbr_sha256`** que publica `supabase functions list`: es la
// huella del bundle desplegado. La deuda decía que era «el candidato a comparación fiable,
// pero todavía no se ha usado así — haría falta guardar el valor de antes». Esto lo guarda.
//
// USO, alrededor de un despliegue:
//
//   deno run -A scripts/huellas-funciones.ts guardar     # antes
//   supabase functions deploy …                          # el despliegue
//   deno run -A scripts/huellas-funciones.ts comparar    # después: dice qué cambió
//
//   deno run -A scripts/huellas-funciones.ts listar      # solo mirar, sin guardar nada
//
// El fichero de huellas va a `scripts/data/`, que está fuera de git (§7): son datos de una
// máquina y un momento, no del proyecto.
//
// ⚠️ Esto NO dice si el bundle desplegado coincide con el código del repo. Dice si CAMBIÓ
// entre dos momentos, que es una pregunta distinta y es la que no se podía responder. Para
// lo primero haría falta reproducir el empaquetado byte a byte, que el CLI no ofrece.

const FICHERO = "scripts/data/huellas-funciones.json";

interface Funcion {
  slug: string;
  status: string;
  verify_jwt: boolean;
  ezbr_sha256?: string;
  updated_at?: number;
}

/** Lo que publica `supabase functions list` en JSON, quedándonos con lo que importa. */
async function huellasActuales(): Promise<Record<string, string>> {
  const cmd = new Deno.Command("supabase", {
    args: ["functions", "list", "-o", "json"],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr));
    throw new Error("`supabase functions list` ha fallado");
  }
  const crudo = new TextDecoder().decode(stdout).trim();
  // ⚠️ El CLI escribe avisos (`WARN: config section …`) ANTES del JSON, y el JSON viene
  // formateado en varias líneas, así que no vale ni parsear la salida entera ni quedarse con
  // una línea suelta. Se corta desde el primer `[` o `{`, que es donde empieza el documento.
  const inicio = Math.min(
    ...[crudo.indexOf("["), crudo.indexOf("{")].filter((i) => i >= 0),
  );
  const texto = Number.isFinite(inicio) ? crudo.slice(inicio) : crudo;
  const datos = JSON.parse(texto);
  const lista: Funcion[] = Array.isArray(datos) ? datos : datos.functions ?? [];

  const fuera: Record<string, string> = {};
  for (const f of lista) {
    // Sin `ezbr_sha256` no hay nada que comparar: se deja constancia en vez de fingir.
    fuera[f.slug] = f.ezbr_sha256 ?? "(sense_empremta)";
  }
  return fuera;
}

function leerGuardadas(): Record<string, string> | null {
  try {
    return JSON.parse(Deno.readTextFileSync(FICHERO)) as Record<string, string>;
  } catch {
    return null;
  }
}

function pinta(titulo: string, filas: string[]): void {
  if (filas.length === 0) return;
  console.log(`\n${titulo}`);
  for (const f of filas) console.log(`  ${f}`);
}

const accion = Deno.args[0] ?? "listar";

if (!["guardar", "comparar", "listar"].includes(accion)) {
  console.error("Uso: deno run -A scripts/huellas-funciones.ts [guardar|comparar|listar]");
  Deno.exit(2);
}

const ahora = await huellasActuales();

if (accion === "listar") {
  console.log(`${Object.keys(ahora).length} funciones:`);
  for (const [slug, sha] of Object.entries(ahora).sort()) {
    console.log(`  ${slug.padEnd(28)} ${sha.slice(0, 16)}`);
  }
  Deno.exit(0);
}

if (accion === "guardar") {
  await Deno.mkdir("scripts/data", { recursive: true });
  Deno.writeTextFileSync(FICHERO, JSON.stringify(ahora, null, 2) + "\n");
  console.log(`Guardadas ${Object.keys(ahora).length} huellas en ${FICHERO}.`);
  console.log("Despliega y luego: deno run -A scripts/huellas-funciones.ts comparar");
  Deno.exit(0);
}

// comparar
const antes = leerGuardadas();
if (!antes) {
  console.error(`No hay huellas guardadas en ${FICHERO}.`);
  console.error("Ejecuta `guardar` ANTES de desplegar: sin el valor de antes no hay comparación.");
  Deno.exit(1);
}

const cambiadas: string[] = [];
const iguales: string[] = [];
const nuevas: string[] = [];
const desaparecidas: string[] = [];

for (const [slug, sha] of Object.entries(ahora)) {
  if (!(slug in antes)) nuevas.push(slug);
  else if (antes[slug] !== sha) cambiadas.push(`${slug.padEnd(28)} ${antes[slug].slice(0, 12)} → ${sha.slice(0, 12)}`);
  else iguales.push(slug);
}
for (const slug of Object.keys(antes)) {
  if (!(slug in ahora)) desaparecidas.push(slug);
}

pinta(`CAMBIADAS (${cambiadas.length}):`, cambiadas);
pinta(`NUEVAS (${nuevas.length}):`, nuevas);
pinta(`YA NO ESTÁN (${desaparecidas.length}):`, desaparecidas);
pinta(`SIN CAMBIOS (${iguales.length}):`, iguales);

console.log(
  `\n${cambiadas.length} cambiada(s), ${iguales.length} igual(es)` +
    (nuevas.length ? `, ${nuevas.length} nueva(s)` : "") +
    (desaparecidas.length ? `, ${desaparecidas.length} desaparecida(s)` : ""),
);
// Sin código de salida distinto de 0: que una función cambie o no cambie es información,
// no un error. Quien llama decide qué esperaba.
