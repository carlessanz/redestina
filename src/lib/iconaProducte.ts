// El icono de cada producto del catálogo (29-09-2026). Sustituye a las fotos: un SVG propio
// por producto en `public/icones-productes/<slug>.svg`, generado por
// `scripts/icones-productes.ts`. Puro y con test: el script y la pantalla componen el
// nombre del fichero con esta misma función, así que no pueden divergir.

/** «Col de Brussel·les» → `col-de-brussel-les`; «Brócoli» → `brocoli`. */
export function slugProducte(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** La URL del icono. Si el producto no tiene dibujo, la imagen falla y se pinta el de la familia. */
export function urlIconaProducte(nom: string): string {
  return `/icones-productes/${slugProducte(nom)}.svg`
}
