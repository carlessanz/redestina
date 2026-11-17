// Comprobaciones puras de `crear-oferta` (07-10-2026). Aparte de `index.ts` para poder
// probarlas desde Vitest: aquel usa `Deno.serve` y los import maps.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RE_UUID = new RegExp(`^${UUID}$`, "i");
/** `<uuid>.<ext>`: exactamente lo que sube `src/lib/fotos.ts` (`crypto.randomUUID()`). */
const RE_FITXER = new RegExp(`^${UUID}\\.(jpe?g|png|webp)$`, "i");

/**
 * ¿Son válidas las fotos de una oferta de ESTE productor? Como mucho 3, y cada una
 * exactamente `<productor_id>/<uuid>.<jpg|jpeg|png|webp>` — los tipos que admite el bucket
 * `fotos-ofertes` (20270404100000).
 *
 * Un `startsWith(productorId + '/')` no bastaba: `<productor>/../<otro>/x.jpg` o
 * `<productor>//x.jpg` empiezan igual y, según quién normalice la ruta, apuntan a la
 * carpeta de otro. Aquí no se normaliza nada: se exige la forma exacta, y cualquier otra
 * —segmentos `..`, barras dobles, subcarpetas, otra extensión— se rechaza.
 */
export function fotosValides(fotos: unknown, productorId: string): boolean {
  if (fotos === undefined || fotos === null) return true;
  if (!Array.isArray(fotos) || fotos.length > 3) return false;
  if (!RE_UUID.test(productorId)) return false;
  // El prefijo, EXACTO (Storage distingue mayúsculas: otra grafía sería otra carpeta).
  const prefijo = `${productorId}/`;
  return fotos.every((f) => {
    if (typeof f !== "string") return false;
    if (!f.startsWith(prefijo)) return false;
    const resto = f.slice(prefijo.length);
    return RE_FITXER.test(resto);
  });
}

/**
 * ¿Se le puede servir el coste de REFERENCIA del catálogo? `costes_producto` es del equipo
 * por RLS (§4) y aquí se lee con `service_role`, así que la regla la impone esto: el
 * equipo (alta asistida) o quien tiene alguna ficha de productor propia (su panel, que lo
 * propone al publicar). Una receptora o una cuenta pendiente reciben el catálogo sin él.
 */
export function veuCostReferencia(ctx: { esIntern: boolean; productores: string[] }): boolean {
  return ctx.esIntern || ctx.productores.length > 0;
}

/**
 * ¿Los kilos son un número positivo? (17-11-2026, `400 kg_invalid`). `faltantes()` solo mira que
 * no esté vacío, y «0» no lo está: una oferta de 0 kg pasaba y se guardaba con `kg_total` nulo.
 * Acepta la coma decimal, como lo escribe el bot.
 */
export function kgValid(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0;
}

/**
 * ¿Cuántos envases devolver es un entero positivo? Solo se mira con retorno «Sí» (si no, el
 * valor no se guarda). Vacío lo decide `faltantes()`, que lo exige con retorno.
 */
export function quantitatRetornValida(d: Record<string, unknown>): boolean {
  if (d.retorn !== "Sí") return true;
  const v = d.retorn_quantitat;
  if (v === undefined || v === null || v === "") return true;
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}

/**
 * ¿El enlace de Maps propio de la oferta es un http(s) de como mucho 500 caracteres? Vacío vale
 * (es opcional). Mismo criterio que el check `excedentes_gmaps_url` de la base.
 */
export function mapsValid(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t === "" || (/^https?:\/\/\S+$/i.test(t) && t.length <= 500);
}

/**
 * El primer error de FORMATO de lo que se ha contestado (fase C del punto 3, 17-11-2026), o
 * null. Mira solo lo que hay: un campo vacío no es un error (eso lo decide `faltantes()` al
 * publicar). Lo usan el guardado de un esborrany —que admite datos a medias pero no datos
 * mal formados— y el alta, que lo llama además de `faltantes()`.
 */
export function errorFormatOferta(
  d: Record<string, unknown>,
  productorId: string,
): "kg_invalid" | "retorn_quantitat_invalid" | "maps_invalid" | "fotos_invalides" | "cost_invalid" | "foto_producte_invalid" | null {
  const buit = (v: unknown) => v === undefined || v === null || v === "";
  if (!buit(d.kg) && !kgValid(d.kg)) return "kg_invalid";
  if (!quantitatRetornValida(d)) return "retorn_quantitat_invalid";
  if (!mapsValid(d.gmaps_url)) return "maps_invalid";
  if (!fotosValides(d.fotos, productorId)) return "fotos_invalides";
  if (!buit(d.cost_kg)) {
    const n = Number(String(d.cost_kg).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return "cost_invalid";
  }
  if (!buit(d.foto_producte) && typeof d.foto_producte !== "boolean") return "foto_producte_invalid";
  return null;
}
