// La parte PURA del borrador del alta de oferta y de su control de fecha (`FormulariNovaOferta`).
//
// Aparte del componente para poder probarla desde Vitest sin montar React ni tocar el
// almacenamiento del navegador: aquí solo se decide QUÉ vale un borrador leído y cómo se
// convierte la fecha entre el control `<input type="date">` (ISO) y lo que guarda la oferta
// («dd/mm/aaaa», que es lo que entiende `parseDisponibleFins()` en el servidor, §6bis).

/** Siete días: es lo que se le dijo a la Fundació en la reunión del 05-10-2026. */
export const VIDA_ESBORRANY_MS = 7 * 24 * 3600 * 1000

export interface Esborrany<D = Record<string, unknown>> {
  datos: D
  pas: number
  pasMaxim: number
  costTocat: boolean
  /** `Date.now()` del momento en que se guardó. */
  desat: number
  /**
   * Lo propuesto desde la ficha que nadie ha tocado (11-11-2026). Sin esto, al recuperar el
   * borrador el lugar propuesto parecía una respuesta y salía «Confirmat» sin que nadie lo
   * hubiera confirmado (P5). Opcional: un borrador de antes no lo lleva.
   */
  proposats?: string[]
  /** Si se había pulsado «Canvia el lloc» (P5): se vuelve a la lista, no a la confirmación. */
  canviaLloc?: boolean
}

/**
 * Qué hacer con lo que hay guardado.
 *
 * - `esborrany`: el borrador si vale (bien formado y de hace menos de `VIDA_ESBORRANY_MS`).
 * - `treu`: hay que retirarlo del almacenamiento (caducado o con una forma que no es la
 *   nuestra). Un JSON roto NO se retira: puede ser una escritura a medias de otra pestaña,
 *   y el siguiente guardado lo sustituirá igual.
 */
export function interpretaEsborrany(
  cru: string | null,
  ara: number,
): { esborrany: Esborrany | null; treu: boolean } {
  if (!cru) return { esborrany: null, treu: false }
  let e: unknown
  try { e = JSON.parse(cru) } catch { return { esborrany: null, treu: false } }
  if (!e || typeof e !== 'object') return { esborrany: null, treu: true }
  const b = e as Partial<Esborrany>
  if (!b.datos || typeof b.datos !== 'object' || typeof b.desat !== 'number') {
    return { esborrany: null, treu: true }
  }
  // Un `desat` en el futuro (reloj cambiado) cuenta como recién guardado, no como eterno:
  // `ara - desat` negativo pasa la comprobación igual que uno de hace un minuto.
  if (ara - b.desat > VIDA_ESBORRANY_MS) return { esborrany: null, treu: true }
  // Los dos campos opcionales, solo si tienen su forma: un valor raro se ignora, no invalida.
  const net: Esborrany = { ...(b as Esborrany) }
  if (!Array.isArray(b.proposats) || !b.proposats.every((x) => typeof x === 'string')) delete net.proposats
  if (typeof b.canviaLloc !== 'boolean') delete net.canviaLloc
  return { esborrany: net, treu: false }
}

/** «2026-09-30» → «30/09/2026». Vacío si no es una fecha ISO. */
export function isoADdmmaaaa(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** «30/09/2026» → «2026-09-30». Vacío si no se reconoce (el control lo pinta en blanco). */
export function ddmmaaaaAIso(txt: string): string {
  const m = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

/**
 * «2026-11-17» + 2 → «2026-11-19», en días NATURALES (17-11-2026: «Fins quin dia està
 * disponible» propone hoy + 2, con el «hoy» de Madrid). Se calcula en UTC para que el cambio de
 * hora no reste un día. Vacío si no es una fecha ISO.
 */
export function sumaDiesIso(iso: string, n: number): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n))
  return d.toISOString().slice(0, 10)
}

/** Lo que propone el formulario para «disponible fins»: hoy (Madrid) + 2 días, en «dd/mm/aaaa». */
export const DIES_DISPONIBLE_PER_DEFECTE = 2
export function disponiblePerDefecte(avuiIso: string): string {
  return isoADdmmaaaa(sumaDiesIso(avuiIso, DIES_DISPONIBLE_PER_DEFECTE))
}

/**
 * ¿Un enlace de Maps propio de la oferta vale? http(s), sin espacios y ≤500 (el mismo criterio
 * que `mapsValid` de `crear-oferta` y el check de la base). Vacío vale: es opcional.
 */
export function mapsOfertaValid(v: unknown): boolean {
  if (v == null) return true
  const t = String(v).trim()
  return t === '' || (/^https?:\/\/\S+$/i.test(t) && t.length <= 500)
}
