// «Interaccions i seguiment» (proceso 1.2 del cliente, 25-11-2026): la lógica de la sección del
// equipo `/equip/interaccions`, sin React ni red.
//
// La sección no tiene tabla propia: lee las MISMAS filas de `notes_internes` que registra la ficha
// de cada entidad (pestaña «Gestió interna»), con tres vistas (`?vista=`):
//   · `pendents`: los próximos pasos sin hacer, por fecha de seguimiento (lo vencido primero);
//   · `historial`: todas las interacciones, la más reciente arriba;
//   · `previsions`: las que llevan previsión de producto, por fecha prevista.
// Los datos los dan `interaccions_llistat()` e `interaccions_opcions()` (20270616100100). Aquí vive:
//   · cómo se pasan los filtros de la barra a los argumentos de la RPC (vacío → null, y lo que no
//     vale —un valor viejo del `localStorage`— no llega a la base, que daría `22023`);
//   · las etiquetas de vista, tipo y estado, por clave i18n LITERAL (las ve `tests/cobertura.test.ts`);
//   · la lectura defensiva de lo que devuelve la RPC (los `numeric` pueden llegar como texto).
//
// 🔴 Las notas internas y sus previsiones nunca salen por ningún canal (AGENTS §8).
//
// Puro: se prueba desde Vitest (`tests/interaccions.test.ts`).

import type {
  EstatSeguimentFiltre, FilaInteraccio, OpcionsInteraccions, PaginaInteraccions, VistaInteraccions,
} from '../types'
import { TIPUS_NOTA_LLEGITS, esTipusNota } from './notesInternes'
import { diaValid } from './sortides'

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

export const VISTES_INTERACCIONS: readonly VistaInteraccions[] = ['pendents', 'historial', 'previsions']
export const ESTATS_SEGUIMENT_FILTRE: readonly EstatSeguimentFiltre[] = ['pendent', 'vencut', 'fet', 'sense']

/** Las filas de una página de la tabla (las de «Entrades i sortides»). */
export const MIDA_PAGINA_INTERACCIONS = 25

const CLAU_VISTA: Record<VistaInteraccions, string> = {
  pendents: 'ixs.tab_pendents',
  historial: 'ixs.tab_historial',
  previsions: 'ixs.tab_previsions',
}

/** La tabla vacía, sin filtros puestos. */
const CLAU_BUIT: Record<VistaInteraccions, string> = {
  pendents: 'ixs.buit_pendents',
  historial: 'ixs.buit_historial',
  previsions: 'ixs.buit_previsions',
}

/** El tipo, con las claves de la ficha (`ni.tipus_*`), también el heredado `seguiment`. */
const CLAU_TIPUS: Record<(typeof TIPUS_NOTA_LLEGITS)[number], string> = {
  prospeccio: 'ni.tipus_prospeccio',
  captacio: 'ni.tipus_captacio',
  operativa: 'ni.tipus_operativa',
  incidencia: 'ni.tipus_incidencia',
  documentacio: 'ni.tipus_documentacio',
  altres: 'ni.tipus_altres',
  seguiment: 'ni.tipus_seguiment',
}

const CLAU_ESTAT: Record<EstatSeguimentFiltre, string> = {
  pendent: 'ixs.estat_pendent',
  vencut: 'ixs.estat_vencut',
  fet: 'ixs.estat_fet',
  sense: 'ixs.estat_sense',
}

/**
 * El color del estado (§2bis, solo tokens). Lo vencido es «lo que te toca»: `aviso`, no rojo
 * (no es un error, es trabajo pendiente). Lo hecho, en `exito`.
 */
const CLASSE_ESTAT: Record<EstatSeguimentFiltre, string> = {
  pendent: 'bg-muted text-muted-foreground',
  vencut: 'bg-aviso-fondo text-aviso',
  fet: 'bg-exito-fondo text-exito',
  sense: 'border border-input bg-background text-muted-foreground',
}

export function esVista(v: unknown): v is VistaInteraccions {
  return typeof v === 'string' && (VISTES_INTERACCIONS as readonly string[]).includes(v)
}
export function esEstatSeguiment(v: unknown): v is EstatSeguimentFiltre {
  return typeof v === 'string' && (ESTATS_SEGUIMENT_FILTRE as readonly string[]).includes(v)
}

export function clauVista(v: VistaInteraccions): string {
  return CLAU_VISTA[v]
}
export function clauBuit(v: VistaInteraccions): string {
  return CLAU_BUIT[v]
}
export function clauTipus(t: string): string {
  return esTipusNota(t) ? CLAU_TIPUS[t] : 'ixs.desconegut'
}
export function clauEstatSeguiment(e: string): string {
  return esEstatSeguiment(e) ? CLAU_ESTAT[e] : 'ixs.desconegut'
}
export function classeEstatSeguiment(e: string): string {
  return esEstatSeguiment(e) ? CLASSE_ESTAT[e] : 'bg-muted text-muted-foreground'
}

/** La vista de la URL (`?vista=`); por defecto, los pendientes. */
export function llegeixVista(v: string | null | undefined): VistaInteraccions {
  return esVista(v) ? v : 'pendents'
}

/** La ficha de la entidad, abierta en «Gestió interna» (donde vive su hilo de interacciones). */
export function rutaFitxaInteraccions(orgId: string): string {
  return `/equip/entitats/${orgId}?pestanya=intern`
}

// ---------------------------------------------------------------------------
// Filtros → argumentos de la RPC
// ---------------------------------------------------------------------------

/**
 * Las dimensiones de la barra, por su clave en `ValorsFiltre`. `prev_desde`/`prev_hasta` (la
 * fecha prevista de disponibilidad) también viven ahí: la barra solo tiene un rango propio, que
 * es el de la fecha de la interacción, y así «Neteja els filtres» las vacía con lo demás.
 */
export const DIMENSIONS_INTERACCIONS = [
  'entitat', 'zona', 'tipus', 'responsable', 'producte', 'estat', 'prev_desde', 'prev_hasta',
] as const

export interface FiltresInteraccions {
  valors: Record<string, string>
  /** `AAAA-MM-DD` o '' (sin límite), inclusivos, sobre el DÍA de la interacción. */
  desDe: string
  finsA: string
  cerca: string
}

/** Los filtros de `interaccions_llistat()` (null = sin filtro). */
export interface ArgsFiltresInteraccions {
  p_desde: string | null
  p_hasta: string | null
  p_org: string | null
  p_zona: string | null
  p_tipus: string | null
  p_responsable: string | null
  p_producte: string | null
  p_prev_desde: string | null
  p_prev_hasta: string | null
  p_estat: EstatSeguimentFiltre | null
  p_cerca: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const textNet = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

/**
 * Los argumentos de `interaccions_llistat()` a partir de la barra. Un valor que no vale (un uuid
 * roto, un tipo que ya no existe, un día imposible) se trata como «sin filtro» en vez de llegar a
 * la base y dar un error que la pantalla no sabría explicar.
 */
export function argsFiltresInteraccions(f: FiltresInteraccions): ArgsFiltresInteraccions {
  const v = f.valors
  const uuid = (x: string | undefined) => (x && UUID.test(x) ? x : null)
  return {
    p_desde: diaValid(f.desDe),
    p_hasta: diaValid(f.finsA),
    p_org: uuid(v.entitat),
    p_zona: textNet(v.zona),
    p_tipus: esTipusNota(v.tipus) ? v.tipus : null,
    p_responsable: uuid(v.responsable),
    p_producte: textNet(v.producte),
    p_prev_desde: diaValid(v.prev_desde),
    p_prev_hasta: diaValid(v.prev_hasta),
    p_estat: esEstatSeguiment(v.estat) ? v.estat : null,
    p_cerca: textNet(f.cerca),
  }
}

/** ¿Algún rango está al revés? La RPC lo rechaza (`rang_invertit`); la pantalla lo dice antes. */
export function rangInvertitInteraccions(a: Pick<ArgsFiltresInteraccions, 'p_desde' | 'p_hasta' | 'p_prev_desde' | 'p_prev_hasta'>): boolean {
  return (a.p_desde !== null && a.p_hasta !== null && a.p_desde > a.p_hasta)
    || (a.p_prev_desde !== null && a.p_prev_hasta !== null && a.p_prev_desde > a.p_prev_hasta)
}

/** ¿Hay algún filtro puesto (contando el buscador)? Decide el texto de la lista vacía. */
export function ambFiltresInteraccions(a: ArgsFiltresInteraccions): boolean {
  return Object.values(a).some((x) => x !== null)
}

/** La clave del mensaje de un error de la RPC (`22023 <codi>: …`); por defecto, el genérico. */
export function clauErrorInteraccions(missatge: string | null | undefined): string {
  const m = missatge ?? ''
  if (m.includes('rang_invertit')) return 'ixs.err_rang'
  return 'c.load_error'
}

/** Un valor de «Municipi o zona»: una comarca (su nombre) o un municipio (código INE de 5 cifras). */
export function esCodiIne(v: string): boolean {
  return /^\d{5}$/.test(v)
}

/**
 * Las opciones de «Municipi o zona»: primero las comarcas y después los municipios (por su
 * código, que es lo que entiende `p_zona`), sin repetir.
 */
export function opcionsZona(o: OpcionsInteraccions): string[] {
  return [...new Set([...o.zones, ...o.municipis.map((m) => m.ine)])]
}

/** Cómo se lee un valor de «Municipi o zona»: el municipio por su nombre, la comarca tal cual. */
export function textZona(v: string, o: OpcionsInteraccions): string {
  if (!esCodiIne(v)) return v
  return o.municipis.find((m) => m.ine === v)?.nom ?? v
}

// ---------------------------------------------------------------------------
// Lectura defensiva de lo que devuelve la RPC
// ---------------------------------------------------------------------------

const textONull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const numONull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function llegeixFilaInteraccio(v: unknown): FilaInteraccio {
  const f = (v ?? {}) as Record<string, unknown>
  return {
    id: String(f.id ?? ''),
    organizacion_id: String(f.organizacion_id ?? ''),
    organitzacio: textONull(f.organitzacio),
    municipi: textONull(f.municipi),
    municipi_ine: textONull(f.municipi_ine),
    comarca: textONull(f.comarca),
    data: String(f.data ?? ''),
    tipus: typeof f.tipus === 'string' ? f.tipus : '',
    canal: typeof f.canal === 'string' ? f.canal : '',
    text: typeof f.text === 'string' ? f.text : '',
    autor_id: textONull(f.autor_id),
    autor_nom: textONull(f.autor_nom),
    responsable_id: textONull(f.responsable_id),
    responsable_nom: textONull(f.responsable_nom),
    propera_accio: textONull(f.propera_accio),
    propera_data: textONull(f.propera_data),
    estat_seguiment: esEstatSeguiment(f.estat_seguiment) ? f.estat_seguiment : 'sense',
    seguiment_fet_at: textONull(f.seguiment_fet_at),
    fet_per_nom: textONull(f.fet_per_nom),
    resultat: textONull(f.resultat),
    previsio_producte: textONull(f.previsio_producte),
    previsio_kg: numONull(f.previsio_kg),
    previsio_data: textONull(f.previsio_data),
    previsio_ubicacio_id: textONull(f.previsio_ubicacio_id),
    previsio_ubicacio_nom: textONull(f.previsio_ubicacio_nom),
    created_at: String(f.created_at ?? ''),
  }
}

export function llegeixPaginaInteraccions(v: unknown): PaginaInteraccions {
  const r = (v ?? {}) as Record<string, unknown>
  const total = Number(r.total)
  return {
    total: Number.isFinite(total) ? total : 0,
    files: Array.isArray(r.files) ? r.files.map(llegeixFilaInteraccio) : [],
  }
}

export function llegeixOpcionsInteraccions(v: unknown): OpcionsInteraccions {
  const r = (v ?? {}) as Record<string, unknown>
  const llista = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])
  return {
    responsables: llista(r.responsables)
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x?.id === 'string')
      .map((x) => ({ id: x.id as string, nom: typeof x.nom === 'string' && x.nom ? x.nom : (x.id as string) })),
    productes: llista(r.productes).filter((x): x is string => typeof x === 'string' && x !== ''),
    zones: llista(r.zones).filter((x): x is string => typeof x === 'string' && x !== ''),
    municipis: llista(r.municipis)
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x?.ine === 'string')
      .map((x) => ({ ine: x.ine as string, nom: typeof x.nom === 'string' && x.nom ? x.nom : (x.ine as string) })),
  }
}
