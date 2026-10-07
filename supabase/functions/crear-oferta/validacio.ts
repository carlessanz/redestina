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
