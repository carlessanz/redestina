// Fotos del catálogo y de las ofertas, desde un manifiesto versionado (27-09-2026).
//
//   deno run -A scripts/fotos-cataleg.ts --local <dir> [--manifest <json>]   # solo procesa
//   SUPABASE_URL=... SB_SECRET_KEY=... deno run -A scripts/fotos-cataleg.ts [--forcar]
//                                     [--nomes productes|ofertes] [--dry-run]
//
// QUÉ HACE. Lee `scripts/fotos-cataleg.json` —de dónde sale cada foto, su autor y su
// licencia— y, para cada entrada: la descarga, la recorta al centro a la proporción que
// toca, la redimensiona al tamaño en que se ve y la guarda como WebP SIN METADATOS; después
// la sube al bucket que le corresponde y la fija con la RPC de siempre.
//
//   · Producto: grande 1000×750 (4:3, el detalle del Mercat es `aspect-[4/3]`) y miniatura
//     240×240 (tarjetas de 64 px y listas de 40-48 px, a 3×), en `fotos-productes`, con
//     `fixar_foto_producte()` (guarda también la procedencia en `productos.foto_credit`).
//   · Oferta: 1200×900 (4:3) en `fotos-ofertes/<productor_id>/`, con `fixar_fotos_oferta()`.
//
// POR QUÉ UN MANIFIESTO Y NO LOS FICHEROS. Las imágenes no entran en git (son binarios y se
// regeneran), pero QUÉ imagen se eligió y con qué licencia sí: es lo que permite responder
// «¿de dónde sale esta foto?» dentro de un año, y volver a montarlo todo en otra base.
//
// 🔴 SOLO dominio público o CC0 (sin atribución obligatoria ni marca de agua): el manifiesto
//    lo dice por entrada y el script se niega a subir cualquier otra licencia.
//
// IDEMPOTENTE: un producto o una oferta que ya tenga foto se salta, salvo con `--forcar`.
// Procesa con `sips` (macOS) y `cwebp`: es una herramienta de esta máquina, no del servidor.

import { createClient } from "npm:@supabase/supabase-js@2";

interface Font {
  url: string;
  titol?: string;
  autor?: string;
  llicencia: string;
  llicencia_url?: string;
  font_url?: string;
  /** En una oferta: qué enseña (camp, caixes, palet, granel…). Solo informativo. */
  que?: string;
}
interface Manifest {
  productes: Record<string, Font>;
  ofertes: Record<string, Font[]>;
}

const LLICENCIES_LLIURES = /^(cc0|pdm|public domain|domini públic)/i;

const args = Deno.args;
const valor = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const local = valor("--local");
const nomes = valor("--nomes");
const forcar = args.includes("--forcar");
const dryRun = args.includes("--dry-run");

// `--manifest <ruta>` permite probar un manifiesto parcial sin tocar el versionado.
const rutaManifest = valor("--manifest");
const manifest: Manifest = JSON.parse(
  rutaManifest
    ? await Deno.readTextFile(rutaManifest)
    : await Deno.readTextFile(new URL("./fotos-cataleg.json", import.meta.url)),
);
manifest.productes ??= {};
manifest.ofertes ??= {};

async function cmd(bin: string, a: string[]): Promise<string> {
  const r = await new Deno.Command(bin, { args: a, stdout: "piped", stderr: "piped" }).output();
  if (!r.success) throw new Error(`${bin} ${a.join(" ")}: ${new TextDecoder().decode(r.stderr)}`);
  return new TextDecoder().decode(r.stdout);
}

const AGENT = "Redestina/1.0 (+https://redestina.carlessanz.com)";
const cacheDescarregues = new Map<string, string>();

/** Descarga una vez y la normaliza a JPEG (así `sips` recorta igual un PNG que un JPEG). */
async function descarrega(url: string): Promise<string> {
  const ja = cacheDescarregues.get(url);
  if (ja) return ja;
  const dir = await Deno.makeTempDir();
  const orig = `${dir}/orig`;
  // Con `curl` y no con `fetch`: Flickr —de donde sale buena parte del CC0 de Openverse—
  // responde 403 al `fetch` de Deno y 200 a `curl` con la misma URL.
  // ⚠️ Y el User-Agent importa: Flickr rechaza (403) cualquiera que diga «Bot», y Wikimedia
  //    responde 429 si no identifica el proyecto. Con la URL del proyecto, los dos dan 200.
  await cmd("curl", ["-sSfL", "--max-time", "60", "-A", AGENT, "-o", orig, url]);
  const jpg = `${dir}/orig.jpg`;
  await cmd("sips", ["-s", "format", "jpeg", orig, "--out", jpg]);
  cacheDescarregues.set(url, jpg);
  return jpg;
}

/** Recorte central a `w:h`, reescalado a `w×h` y WebP sin metadatos. Devuelve la ruta. */
async function processa(url: string, w: number, h: number): Promise<{ ruta: string; avis?: string }> {
  const origen = await descarrega(url);
  const info = await cmd("sips", ["-g", "pixelWidth", "-g", "pixelHeight", origen]);
  const W = Number(info.match(/pixelWidth: (\d+)/)?.[1]);
  const H = Number(info.match(/pixelHeight: (\d+)/)?.[1]);
  let cw = W, ch = H;
  if (W / H > w / h) cw = Math.round(H * w / h);
  else ch = Math.round(W * h / w);
  const dir = await Deno.makeTempDir();
  const tall = `${dir}/tall.jpg`;
  await cmd("sips", ["--cropToHeightWidth", String(ch), String(cw), origen, "--out", tall]);
  await cmd("sips", ["-z", String(h), String(w), tall]);
  const webp = `${dir}/foto.webp`;
  await cmd("cwebp", ["-quiet", "-q", "80", "-metadata", "none", tall, "-o", webp]);
  // Ampliar una imagen pequeña la deja borrosa: no se bloquea, pero se avisa.
  const avis = cw < w || ch < h ? `origen petit (${W}×${H}) per a ${w}×${h}` : undefined;
  return { ruta: webp, avis };
}

function comprovaLlicencia(nom: string, f: Font) {
  if (!LLICENCIES_LLIURES.test(f.llicencia)) {
    throw new Error(`${nom}: llicència «${f.llicencia}» no és CC0 ni domini públic`);
  }
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// --- Modo local: procesar para revisar, sin tocar la base -------------------------

if (local) {
  await Deno.mkdir(`${local}/productes`, { recursive: true });
  await Deno.mkdir(`${local}/ofertes`, { recursive: true });
  if (nomes !== "ofertes") {
    for (const [nom, f] of Object.entries(manifest.productes)) {
      try {
        comprovaLlicencia(nom, f);
        const g = await processa(f.url, 1000, 750);
        const m = await processa(f.url, 240, 240);
        await Deno.copyFile(g.ruta, `${local}/productes/${slug(nom)}.webp`);
        await Deno.copyFile(m.ruta, `${local}/productes/${slug(nom)}-mini.webp`);
        console.log(`✓ ${nom}${g.avis ? `  ⚠️ ${g.avis}` : ""}`);
      } catch (e) {
        console.log(`✗ ${nom}: ${(e as Error).message}`);
      }
    }
  }
  if (nomes !== "productes") {
    for (const [ref, fonts] of Object.entries(manifest.ofertes)) {
      for (const [i, f] of fonts.entries()) {
        try {
          comprovaLlicencia(ref, f);
          const o = await processa(f.url, 1200, 900);
          await Deno.copyFile(o.ruta, `${local}/ofertes/${ref}-${i + 1}.webp`);
          console.log(`✓ ${ref} #${i + 1}${o.avis ? `  ⚠️ ${o.avis}` : ""}`);
        } catch (e) {
          console.log(`✗ ${ref} #${i + 1}: ${(e as Error).message}`);
        }
      }
    }
  }
  Deno.exit(0);
}

// --- Subida a la base --------------------------------------------------------------

const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY en el entorno.");
  Deno.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function puja(bucket: string, ruta: string, fitxer: string) {
  const { error } = await db.storage.from(bucket).upload(ruta, await Deno.readFile(fitxer), {
    contentType: "image/webp",
    upsert: false,
  });
  if (error) throw new Error(`pujada ${bucket}/${ruta}: ${error.message}`);
}

let fets = 0, saltats = 0, errors = 0;

if (nomes !== "ofertes") {
  const { data: prods, error } = await db.from("productos").select("nombre, foto");
  if (error) throw error;
  const actuals = new Map((prods ?? []).map((p) => [p.nombre as string, p.foto as string | null]));
  for (const [nom, f] of Object.entries(manifest.productes)) {
    try {
      comprovaLlicencia(nom, f);
      if (!actuals.has(nom)) throw new Error("no és al catàleg");
      if (actuals.get(nom) && !forcar) { saltats++; continue; }
      if (dryRun) { console.log(`(dry-run) ${nom}`); continue; }
      const g = await processa(f.url, 1000, 750);
      const m = await processa(f.url, 240, 240);
      const base = `${slug(nom)}-${crypto.randomUUID().slice(0, 8)}`;
      await puja("fotos-productes", `${base}.webp`, g.ruta);
      await puja("fotos-productes", `${base}-mini.webp`, m.ruta);
      const { data: ant, error: e } = await db.rpc("fixar_foto_producte", {
        p_producto: nom,
        p_foto: `${base}.webp`,
        p_foto_mini: `${base}-mini.webp`,
        p_credit: {
          titol: f.titol ?? null,
          autor: f.autor ?? null,
          llicencia: f.llicencia,
          llicencia_url: f.llicencia_url ?? null,
          font_url: f.font_url ?? f.url,
        },
      });
      if (e) throw new Error(e.message);
      const velles = [ant?.foto, ant?.foto_mini].filter(Boolean) as string[];
      if (velles.length) await db.storage.from("fotos-productes").remove(velles);
      console.log(`✓ ${nom}${g.avis ? `  ⚠️ ${g.avis}` : ""}`);
      fets++;
    } catch (e) {
      console.log(`✗ ${nom}: ${(e as Error).message}`);
      errors++;
    }
  }
}

if (nomes !== "productes") {
  for (const [ref, fonts] of Object.entries(manifest.ofertes)) {
    try {
      for (const f of fonts) comprovaLlicencia(ref, f);
      const { data: exc, error } = await db.from("excedentes")
        .select("id, productor_id, fotos").eq("id_excedente", ref).maybeSingle();
      if (error) throw new Error(error.message);
      if (!exc?.productor_id) throw new Error("oferta sense productor");
      if ((exc.fotos ?? []).length > 0 && !forcar) { saltats++; continue; }
      if (dryRun) { console.log(`(dry-run) ${ref}: ${fonts.length} foto(s)`); continue; }
      const rutes: string[] = [];
      for (const f of fonts.slice(0, 3)) {
        const o = await processa(f.url, 1200, 900);
        const ruta = `${exc.productor_id}/${crypto.randomUUID()}.webp`;
        await puja("fotos-ofertes", ruta, o.ruta);
        rutes.push(ruta);
      }
      const { error: e } = await db.rpc("fixar_fotos_oferta", { p_excedente: exc.id, p_fotos: rutes });
      if (e) throw new Error(e.message);
      const velles = (exc.fotos ?? []) as string[];
      if (velles.length) await db.storage.from("fotos-ofertes").remove(velles);
      console.log(`✓ ${ref}: ${rutes.length} foto(s)`);
      fets++;
    } catch (e) {
      console.log(`✗ ${ref}: ${(e as Error).message}`);
      errors++;
    }
  }
}

console.log(`\nFetes ${fets} · saltades ${saltats} · errors ${errors}`);
if (errors) Deno.exit(1);
