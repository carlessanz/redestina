// Importación de las organizaciones del ARA 2026 como INACTIVAS (plan 1, rebanada 1E).
//
//   eval "$(bash scripts/local/entorno-local.sh)"          # el CLON (nunca source .env.local)
//   deno run -A --node-modules-dir=none scripts/import-ara-2026.ts --dry-run   # SIEMPRE primero: informe
//   deno run -A --node-modules-dir=none scripts/import-ara-2026.ts             # carga (en el clon)
//
// Lee las cinco hojas exportadas a CSV en `scripts/data/2026/` (fuera de git: datos personales;
// las exporta `scripts/data/2026/exportar-ara.py` desde el `.xlsm`, sin ejecutar macros) y, si
// está, `airtable.csv` para el informe de cruce (que NO carga nada). Escribe los informes en la
// misma carpeta: `informe-<fecha>[-dry-run].md` y `cruce-airtable-<fecha>.md`. Nunca a Drive ni
// a git. Lo que decide qué se crea vive en `scripts/ara2026/nucli.ts` (puro, con pruebas).
//
// Fuera del clon (`SUPABASE_URL` que no sea esta máquina) solo corre con `--dry-run`, salvo que
// se pase `--produccio`: la carga en producción es una sesión aparte, con el informe del
// `--dry-run` delante y la aprobación explícita de Carles.
//
// Idempotente: una segunda pasada encuentra cada ficha por `ref_externa` y solo RELLENA HUECOS
// (no pisa lo que el equipo haya corregido, ni toca `activo`).

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  creuarAirtable, type CreuAirtable, type Existent, type FilaAra, HOJAS, type Hoja, indexMunicipis, type Incidencia,
  llegirAirtable, llegirFulla, parseCsv, pegatRellenaHuecos, type PlaCarrega, planificar,
} from "./ara2026/nucli.ts";

const args = Deno.args;
const DRY_RUN = args.includes("--dry-run");
const PRODUCCIO = args.includes("--produccio");
const dirArg = args.find((a) => a.startsWith("--dir="))?.slice(6);
const DIR = dirArg ? dirArg.replace(/\/?$/, "/") : new URL("./data/2026/", import.meta.url).pathname;

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY (para el clon: eval \"$(bash scripts/local/entorno-local.sh)\").");
  Deno.exit(1);
}
const host = new URL(url).hostname;
const esLocal = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
if (!esLocal && !DRY_RUN && !PRODUCCIO) {
  console.error(`SUPABASE_URL apunta a ${host}, que no es el clon. Sin --dry-run hace falta --produccio (y la aprobación de Carles).`);
  Deno.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------
const llegides = {} as Record<Hoja, { files: FilaAra[]; descartades: number[] }>;
const filesCsv = {} as Record<Hoja, number>;
for (const h of HOJAS) {
  const files = parseCsv(await Deno.readTextFile(`${DIR}${h}.csv`));
  filesCsv[h] = files.length - 1;
  llegides[h] = llegirFulla(h, files);
}

// deno-lint-ignore no-explicit-any
async function totes(taula: string, cols: string, ordre = "id"): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let des = 0;; des += 1000) {
    const { data, error } = await sb.from(taula).select(cols).order(ordre).range(des, des + 999);
    if (error) throw new Error(`${taula}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const productors = await totes("productores", "*");
const entitats = await totes("entidades", "*");
const municipis = await totes("municipios", "codi_ine, nom", "codi_ine");

const esImportada = (r: { ref_externa: string | null }) => (r.ref_externa ?? "").startsWith("ARA26:");
const existent: Existent = { nifsAliens: new Map(), correusProductors: new Set(), telefonsProductors: new Set(), importats: new Map() };
const perId = new Map<string, Record<string, unknown>>();
for (const [taula, rows, camp] of [["productores", productors, "name"], ["entidades", entitats, "nombre"]] as const) {
  for (const r of rows) {
    perId.set(r.id, r);
    if (esImportada(r)) {
      existent.importats.set(r.ref_externa, { taula, id: r.id, organizacion_id: r.organizacion_id, nom: r[camp] });
      continue;
    }
    // Las propias fichas importadas no cuentan como «ya en uso»: el plan reparte de nuevo.
    if (r.nif) existent.nifsAliens.set(String(r.nif).toUpperCase().replace(/[\s.-]/g, ""), r.organizacion_id);
    if (taula === "productores") {
      if (r.email) existent.correusProductors.add(String(r.email).toLowerCase());
      if (r.phone) existent.telefonsProductors.add(String(r.phone));
    }
  }
}

const pla = planificar(llegides, existent, indexMunicipis(municipis));

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------
type Resultat = "creada" | "actualitzada" | "sense_canvis" | "error";
const resultat = new Map<string, Resultat>(); // ref → resultado
const errors: Incidencia[] = [];
let orgsNoves = 0;

for (const org of pla.orgs) {
  let orgId = org.productor?.existent?.organizacion_id ?? org.entitat?.existent?.organizacion_id ?? null;
  const novaOrg = !orgId;
  for (const fitxa of [org.productor, org.entitat]) {
    if (!fitxa) continue;
    const ref = fitxa.fila.ref;
    if (fitxa.existent) {
      const pegat = pegatRellenaHuecos(perId.get(fitxa.existent.id) ?? {}, fitxa.dades);
      if (!Object.keys(pegat).length) { resultat.set(ref, "sense_canvis"); continue; }
      if (DRY_RUN) { resultat.set(ref, "actualitzada"); continue; }
      const { error } = await sb.from(fitxa.taula).update(pegat).eq("id", fitxa.existent.id);
      if (error) { errors.push({ ref, hoja: fitxa.fila.hoja, nom: fitxa.fila.nom, detall: error.message }); resultat.set(ref, "error"); }
      else resultat.set(ref, "actualitzada");
      continue;
    }
    if (DRY_RUN) { resultat.set(ref, "creada"); continue; }
    const fila = orgId ? { ...fitxa.dades, organizacion_id: orgId } : fitxa.dades;
    const { data, error } = await sb.from(fitxa.taula).insert(fila).select("id, organizacion_id").single();
    if (error) { errors.push({ ref, hoja: fitxa.fila.hoja, nom: fitxa.fila.nom, detall: error.message }); resultat.set(ref, "error"); continue; }
    orgId = data.organizacion_id;
    resultat.set(ref, "creada");
  }
  // Nueva si ninguna de sus fichas existía y (en la carga) se llegó a crear alguna.
  if (novaOrg && (DRY_RUN || orgId)) orgsNoves++;
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------
const comptaRes = (r: Resultat, t?: string) =>
  pla.orgs.flatMap((o) => [o.productor, o.entitat]).filter((f) => f && resultat.get(f.fila.ref) === r && (!t || f.taula === t)).length;
const avui = new Date().toISOString().slice(0, 10);
// Una pasada nunca pisa el informe de otra del mismo día (la carga y su repetición, p. ej.).
async function lliure(base: string): Promise<string> {
  for (let n = 1;; n++) {
    const nom = `${base}${n > 1 ? `-${n}` : ""}.md`;
    try { await Deno.stat(nom); } catch { return nom; }
  }
}
const nomInforme = await lliure(`${DIR}informe-${avui}${DRY_RUN ? "-dry-run" : ""}`);
await Deno.writeTextFile(nomInforme, informe(pla));

let resumAirtable = "";
try {
  const text = await Deno.readTextFile(`${DIR}airtable.csv`);
  const at = llegirAirtable(text);
  const creu = creuarAirtable(at.registres, HOJAS.flatMap((h) => llegides[h].files));
  await Deno.writeTextFile(`${DIR}cruce-airtable-${avui}.md`, informeAirtable(at, creu));
  const n = (d: CreuAirtable["decisio"]) => creu.filter((c) => c.decisio === d).length;
  resumAirtable = `Airtable: ${at.registres.length} registros, ${creu.length} nombres — casar (confirmar) ${n("casar_confirmar")}, revisar ${n("revisar")}, crear inactivo ${n("crear_inactiu")}`;
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
  resumAirtable = "Airtable: sin airtable.csv, no hay cruce";
}

// En la consola, solo cifras (los nombres van al informe, fuera de git).
console.log(`${DRY_RUN ? "DRY-RUN (no escribe)" : "CARGA"} contra ${host}`);
console.table(HOJAS.map((h) => fila(h)));
console.log(`Fichas ${DRY_RUN ? "a crear" : "creadas"}: productores ${comptaRes("creada", "productores")}, entidades ${comptaRes("creada", "entidades")}; ` +
  `${DRY_RUN ? "a actualizar" : "actualizadas"} ${comptaRes("actualitzada")}; sin cambios ${comptaRes("sense_canvis")}; errores ${errors.length}`);
console.log(`Organizaciones nuevas: ${orgsNoves}; doble rol: ${pla.dobleRol.length}`);
console.log(resumAirtable);
console.log(`Informe: ${nomInforme}`);
if (errors.length) Deno.exit(2);

// ---------------------------------------------------------------------------

function fila(h: Hoja) {
  const de = (xs: Incidencia[]) => xs.filter((x) => x.hoja === h).length;
  const fitxes = pla.orgs.flatMap((o) => [o.productor, o.entitat]).filter((f) => f && f.fila.hoja === h);
  const r = (x: Resultat) => fitxes.filter((f) => resultat.get(f!.fila.ref) === x).length;
  return {
    hoja: h, filas_csv: filesCsv[h], sin_nombre: pla.descartades.filter((d) => d.hoja === h).length,
    leidas: llegides[h].files.length, [DRY_RUN ? "a_crear" : "creadas"]: r("creada"),
    [DRY_RUN ? "a_actualizar" : "actualizadas"]: r("actualitzada"), sin_cambios: r("sense_canvis"), errores: r("error"),
    ja_existeix: de(pla.jaExisteix), ref_desquadrada: de(pla.refDesquadrada),
    sin_nif: de(pla.senseNif), nif_invalido: de(pla.nifInvalid), nif_repetido: de(pla.nifRepetit),
    tel_sin_extraer: de(pla.telefonsSenseExtreure),
  };
}

function llista(titol: string, xs: Incidencia[], nota = ""): string {
  if (!xs.length) return `### ${titol} (0)\n\nNinguna.\n`;
  return `### ${titol} (${xs.length})\n\n${nota ? nota + "\n\n" : ""}| Ref | Nombre | Detalle |\n| --- | --- | --- |\n` +
    xs.map((x) => `| ${x.ref} | ${x.nom.replace(/\|/g, "/")} | ${x.detall.replace(/\|/g, "/").replace(/\n/g, " ")} |`).join("\n") + "\n";
}

function informe(p: PlaCarrega): string {
  const files = HOJAS.map(fila);
  const cols = Object.keys(files[0]);
  const taula = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |\n` +
    files.map((f) => `| ${cols.map((c) => (f as Record<string, unknown>)[c]).join(" | ")} |`).join("\n");
  const senseMunicipi = new Map<string, number>();
  for (const m of p.municipiSenseCasar) senseMunicipi.set(m.detall, (senseMunicipi.get(m.detall) ?? 0) + 1);
  return `# Importación ARA 2026 — ${DRY_RUN ? "dry-run" : "carga"} del ${avui}

**Destino:** \`${host}\`${esLocal ? " (clon local)" : ""} · **Origen:** \`${DIR}\` · **Script:** \`scripts/import-ara-2026.ts\`

⚠️ Contiene datos personales (nombres, NIF, teléfonos): se queda en \`scripts/data/2026/\`, fuera de git y de Drive.

Todas las fichas entran **inactivas** (\`activo = false\`, D2) y con \`ref_externa = ARA26:<hoja>:<línea del CSV>\`.

## Por hoja

${taula}

## Totales

- Fichas ${DRY_RUN ? "a crear" : "creadas"}: **${comptaRes("creada", "productores")} productores** y **${comptaRes("creada", "entidades")} entidades**; ${DRY_RUN ? "a actualizar" : "actualizadas"} (solo huecos): ${comptaRes("actualitzada")}; sin cambios: ${comptaRes("sense_canvis")}; errores: ${errors.length}.
- Organizaciones ${DRY_RUN ? "nuevas previstas" : "nuevas"}: ${orgsNoves} · **doble rol** (mismo NIF en Prod y SDA): ${p.dobleRol.length}.
- Sin NIF en el origen: ${p.senseNif.length} · NIF inválido (entra sin NIF): ${p.nifInvalid.length} · NIF repetido (lo conserva la primera fila): ${p.nifRepetit.length} · NIF que ya tiene una ficha no importada (no se crea): ${p.jaExisteix.length}.
- Teléfonos: celdas sin ningún teléfono reconocible ${p.telefonsSenseExtreure.length} (el texto se conserva en \`telefono_alt\` o en el comentario) · teléfono ya usado por otro productor (\`phone\` es único) ${p.telefonEnUs.length}.
- Correos: no reconocibles ${p.correusNoValids.length} · ya usados por otro productor (\`email\` es único) ${p.correuEnUs.length}.
- Municipio casado por nombre (\`municipio_ine\`; el trigger rellena población y comarca): ${p.municipiCasat} · sin casar: ${p.municipiSenseCasar.length}.
- Filas sin nombre (descartadas): ${p.descartades.length} · ref ya usada con otro nombre (no se toca): ${p.refDesquadrada.length}.

## Detalle

${llista("Errores de la carga", errors)}
${llista("NIF inválido", p.nifInvalid, "Entran sin NIF; el valor original queda en el bloque «ARA 2026» del comentario para corregirlo al activar.")}
${llista("NIF repetido entre filas", p.nifRepetit, "La primera fila (en el orden prod_actius → prod_inactius → prod_potencials → sda → sda_inactius) lo conserva; las demás entran sin NIF y con la nota en el comentario.")}
### Doble rol (${p.dobleRol.length})

${p.dobleRol.length ? "| NIF | Ofertante | Receptor |\n| --- | --- | --- |\n" + p.dobleRol.map((d) => `| ${d.nif} | ${d.productor.ref} ${d.productor.nom} | ${d.entitat.ref} ${d.entitat.nom} |`).join("\n") : "Ninguno."}

${llista("NIF que ya existe en la base (no se crea)", p.jaExisteix)}
${llista("Ref ya usada con otro nombre (la exportación cambió de orden: no se toca)", p.refDesquadrada)}
${llista("Celdas de teléfono sin ningún número reconocible", p.telefonsSenseExtreure)}
${llista("Teléfono ya usado por otro productor", p.telefonEnUs, "Va a `telefono_alt`.")}
${llista("Correo ya usado por otro productor", p.correuEnUs, "Va al comentario.")}
${llista("Correos no reconocibles", p.correusNoValids)}
### Población sin municipio del catálogo (${p.municipiSenseCasar.length} filas)

Se conserva el texto en \`poblacion\` y \`area_geografica\`; el equipo lo casa en la ficha.

${[...senseMunicipi].sort((a, b) => b[1] - a[1]).map(([n, c]) => `- ${n} (${c})`).join("\n") || "Ninguna."}

### Mismo nombre en varias filas (${p.nomsRepetits.length}) — no se juntan (sin NIF, nunca por nombre)

${p.nomsRepetits.map((n) => `- ${n.nom}: ${n.refs.join(", ")}`).join("\n") || "Ninguno."}
`;
}

function informeAirtable(at: ReturnType<typeof llegirAirtable>, creu: CreuAirtable[]): string {
  const fiables = at.registres.filter((r) => r.fiable).length;
  const cand = (c: { ref: string; nom: string; altresNoms: string[]; nif: string | null; sim?: number }) =>
    `${c.ref} «${[c.nom, ...c.altresNoms].join(" / ").replace(/\|/g, "/")}»${c.nif ? ` NIF ${c.nif}` : " sin NIF"}${c.sim !== undefined && c.sim < 1 ? ` (${c.sim.toFixed(2)})` : ""}`;
  const files = creu.map((c) =>
    `| ${c.paper} | ${c.nom.replace(/\|/g, "/")} | ${c.registres} | ${c.destins.join(", ") || "—"} | ` +
    `${c.exactes.map(cand).join("<br>") || "—"} | ${c.semblants.slice(0, 3).map(cand).join("<br>") || "—"} | **${c.decisio}** — ${c.proposta} |`);
  const n = (d: CreuAirtable["decisio"]) => creu.filter((c) => c.decisio === d).length;
  return `# Cruce Airtable ↔ ARA 2026 — ${avui}

⚠️ Datos personales: se queda en \`scripts/data/2026/\`, fuera de git y de Drive. **Nada de esto se ha cargado.**

## Lectura de \`airtable.csv\`

La exportación llega rota (las celdas de varias líneas son filas sueltas con \`;\` de relleno). Se agrupa
por registro (la línea que empieza por \`E-2026-NNN\` y las que la siguen) y solo se fía de su línea de inicio:
el **ofertante** sale de «Nombre transacción» (\`E-2026-NNN\` + nombre); **receptor** y **destino**, solo si esa
línea llega con sus 28 campos en su sitio.

- Registros reconstruidos: **${at.registres.length}** (${fiables} con la línea de inicio entera; ${at.registres.length - fiables} desplazados: solo se toma el ofertante).
- Códigos \`E-2026-NNN\` sin registro en el fichero (llegan solo como «Mensaje comercial», sin ofertante): ${at.codisSenseRegistre.length} — ${at.codisSenseRegistre.join(", ") || "ninguno"}.
- Nombres distintos: ${creu.filter((c) => c.paper === "ofertant").length} ofertantes y ${creu.filter((c) => c.paper === "receptor").length} receptores.

## Regla

Por parecido de nombre **nunca** se une solo (\`AGENTS §4\`). Una coincidencia **exacta** tras normalizar (sin acentos,
mayúsculas ni signos) se propone como «casar» y **la confirma Carles**; las parecidas (trigramas ≥ 0,40, el umbral
de \`cerca_entitats\`, o un nombre que contiene al otro) van a «revisar». Lo que solo está en Airtable se propone
**crear inactivo**: ofertante → \`productores\`; receptor → \`entidades\` con \`tipo_receptor = comercial\` salvo
entidad social (punto 7 del análisis del 21-09-2026), o \`animal\` si todo lo que recibió fue a alimentación animal.

Resumen: casar (confirmar) **${n("casar_confirmar")}** · revisar **${n("revisar")}** · crear inactivo **${n("crear_inactiu")}**.

| Papel | Nombre (Airtable) | Registros | Destino final | Exacto en el ARA | Parecidos (top 3) | Decisión propuesta |
| --- | --- | --- | --- | --- | --- | --- |
${files.join("\n")}

## Lo que falta para casar mejor

El CSV de Airtable es la tabla de **transacciones**: solo trae nombres (ni NIF, ni teléfono, ni correo). Para casar
por teléfono o correo exactos —la vía buena— hace falta la exportación de las tablas **«Ofertantes»** y
**«Receptores»** de Airtable (plan 1, §8 P7), en CSV nativo por tabla.
`;
}
