// «Nova entitat» en dos pasos (plan 1, rebanada 1B, D6). PURO: sin React ni Supabase, con
// prueba (`tests/novaEntitat.test.ts`).
//
//   · Paso 1, «Qui és?»: un campo «NIF o nom» que llama a `cerca_entitats()` a partir de 3
//     caracteres. Según lo que se elija: activarla si está inactiva, abrir la ficha si ya
//     está activa o añadirle el otro papel. Siempre se puede decir «és nova».
//   · Paso 2, «Dades de l'entitat»: lo mínimo para crearla (`CLAUS_ALTA` de `campsFitxa`), y
//     `crear_entitat()` crea la organización y sus fichas en una transacción (P2).

import { errorCorreu, errorCp, errorNif, errorTelefon, netejaNif, normalitzaTelefon } from './validacio'
import { CAMPS_FITXA, CLAUS_ALTA, normalitzaValor } from './campsFitxa'

/** A partir de cuántos caracteres se busca (lo mismo que corta la RPC). */
export const MIN_CERCA = 3
/** Espera entre tecla y búsqueda. */
export const DEBOUNCE_MS = 250

export type Paper = 'productor' | 'entidad'

/** Una fila de `cerca_entitats()` (1A, 20270501100000). */
export interface ResultatCerca {
  organizacion_id: string
  nom_comercial: string | null
  razon_social: string | null
  nif: string | null
  persona_contacte: string | null
  poblacion: string | null
  comarca: string | null
  productor_id: string | null
  entidad_id: string | null
  es_generadora: boolean
  es_receptora: boolean
  productor_activo: boolean | null
  entidad_activo: boolean | null
  activa: boolean
  te_compte: boolean
  compte_estat: string
  coincidencia: 'nif_exacte' | 'nif' | 'nom'
  similitud: number
}

/** ¿Vale la pena buscar? Lo mismo que la RPC: 3 caracteres de nombre o de NIF. */
export function potCercar(q: string): boolean {
  const nom = q.trim().replace(/\s+/g, ' ')
  return nom.length >= MIN_CERCA || netejaNif(q).length >= MIN_CERCA
}

/**
 * ¿Lo tecleado TIENE FORMA de NIF, NIE o CIF? (sin mirar el dígito de control: eso lo dice
 * el campo del paso 2). Sirve para llevarlo ya puesto al alta al pulsar «És nova».
 */
export function semblaNif(q: string): boolean {
  const n = netejaNif(q)
  return /^\d{8}[A-Z]$/.test(n) || /^[XYZ]\d{7}[A-Z]$/.test(n) || /^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(n)
}

/** Lo que se lleva al paso 2 desde lo tecleado: el NIF si lo parece; si no, el nombre. */
export function prellenaAlta(q: string): { nif?: string; nom_comercial?: string } {
  if (semblaNif(q)) return { nif: netejaNif(q) }
  const nom = q.trim().replace(/\s+/g, ' ')
  return nom.length >= MIN_CERCA ? { nom_comercial: nom } : {}
}

/** Los papeles de un resultado y qué se puede hacer con él (paso 1). */
export interface AccionsResultat {
  /** Los papeles que tiene. */
  papers: Paper[]
  /** Los que tiene y están inactivos: se ofrecen en «Activa-la». */
  inactius: Paper[]
  /** Los que NO tiene: «Afegeix el paper de…» (`afegir_paper_org_equip`). */
  afegibles: Paper[]
  /** Toda la organización está activa (D7: alguno de sus papeles). */
  activa: boolean
}

export function accionsResultat(r: ResultatCerca): AccionsResultat {
  const papers: Paper[] = []
  const inactius: Paper[] = []
  const afegibles: Paper[] = []
  if (r.es_generadora) { papers.push('productor'); if (!r.productor_activo) inactius.push('productor') } else afegibles.push('productor')
  if (r.es_receptora) { papers.push('entidad'); if (!r.entidad_activo) inactius.push('entidad') } else afegibles.push('entidad')
  return { papers, inactius, afegibles, activa: r.activa }
}

// ------------------------------------------------------------------ paso 2

/** Los valores del formulario del alta, por clave de campo de la ficha. */
export type ValorsAlta = Record<string, unknown>

/**
 * Los errores del formulario, como claves i18n por campo, antes de llamar a nadie: lo mal
 * escrito y lo obligatorio (nace activa: NIF y razón social; receptor: su tipo).
 */
export function errorsAlta(v: ValorsAlta, papers: readonly Paper[]): Record<string, string> {
  const e: Record<string, string> = {}
  const txt = (k: string) => String(v[k] ?? '').trim()
  if (!txt('nom_comercial')) e.nom_comercial = 'ef.nom_obligatori'
  if (!txt('razon_social')) e.razon_social = 'ne.err_cal_rao'
  if (!txt('nif')) e.nif = 'ne.err_cal_nif'
  else { const n = errorNif(txt('nif')); if (n) e.nif = n }
  const c = errorCorreu(txt('email')); if (c) e.email = c
  const t = errorTelefon(txt('telefon')); if (t) e.telefon = t
  const cp = errorCp(txt('codigo_postal')); if (cp) e.codigo_postal = cp
  if (papers.includes('entidad') && !txt('tipo_receptor')) e.tipo_receptor = 'ne.err_cal_tipus_receptor'
  return e
}

/** Lo que se manda a `crear_entitat(p_dades)`: solo los campos del alta, normalizados. */
export function dadesAlta(v: ValorsAlta, papers: readonly Paper[], esTest: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { rols: [...papers], es_test: esTest }
  for (const k of CLAUS_ALTA) {
    const c = CAMPS_FITXA.find((x) => x.clau === k)
    if (!c) continue
    if (k === 'tipo_receptor' && !papers.includes('entidad')) continue
    // El teléfono, en E.164 sin «+» (§7): un móvil de 9 cifras recibe el 34 delante.
    const nv = k === 'telefon' ? (normalitzaTelefon(String(v[k] ?? '')) || null) : normalitzaValor(c, v[k])
    if (nv == null || (Array.isArray(nv) && nv.length === 0)) continue
    out[k] = nv
  }
  return out
}

/**
 * El campo al que pertenece un error del servidor y su clave i18n, para enseñarlo junto al
 * campo y no solo en un aviso. `null` si es un error general (permisos, red…).
 */
export function campDelError(missatge: string): { camp: string; clau: string } | null {
  const regles: [string, string, string][] = [
    ['nif_en_us', 'nif', 'org.err_nif_en_us'],
    ['nif_invalid', 'nif', 'val.nif_control'],
    ['falta_nif', 'nif', 'ne.err_cal_nif'],
    ['falta_rao_social', 'razon_social', 'ne.err_cal_rao'],
    ['cal_nom_comercial', 'nom_comercial', 'ef.nom_obligatori'],
    ['cal_tipus_receptor', 'tipo_receptor', 'ne.err_cal_tipus_receptor'],
    ['tipus_activitat_desconegut', 'tipus_activitat', 'org.err_activitat'],
    ['municipi desconegut', 'municipio_ine', 'ne.err_municipi'],
  ]
  for (const [codi, camp, clau] of regles) if (missatge.includes(codi)) return { camp, clau }
  return null
}
