// «Entrades i sortides» (punto 6.7 del Excel de la Fundació, 20-11-2026): la lógica de la
// pantalla del equipo `/equip/entrades-sortides`, sin React ni red.
//
// FASE 4 (25-11-2026): la espigolada deja de ser una pseudo-modalidad. La modalidad es la REAL de
// la salida (donació · venda · maquila, `canalizaciones.valorizacion`) y el TIPUS D'OPERACIÓ es
// otra dimensión, la de la oferta (`excedentes.tipus_operacio`: excedent ja collit · espigolada;
// migraciones 20270617100000 y 20270618100000). La RPC aún manda `per_modalitat.espigolada` para
// el frontend publicado: aquí NO se lee (los kilos de las espigolades salen de `per_tipus_operacio`).
//
// Es la hoja «Aprofitat» del Excel ARA con el que trabaja hoy el equipo: una fila por salida de
// producto de un ofertante a un receptor (una canalización), sin agrupar, con los indicadores
// por ofertante, receptor, producto, modalidad, mes y zona, y la exportación a Excel. Los datos
// los dan dos RPC del equipo (migración 20270612100000): `entrades_sortides()` (página + totales
// de todo lo filtrado) y `entrades_sortides_resum()` (agrupado). Aquí vive:
//   · cómo se pasan los filtros de la barra a los argumentos de las RPC (vacío → null, y lo que
//     no vale —un valor viejo del `localStorage`— no llega a la base, que daría `22023`);
//   · las etiquetas de modalidad, estado y grupo, por clave i18n (literales: los ve
//     `tests/cobertura.test.ts`);
//   · la lectura defensiva de lo que devuelven las RPC (los `numeric` pueden llegar como texto);
//   · las dos hojas del Excel. Solo `blobSortides()` carga `write-excel-file`, con `import()`.
//
// Puro: se prueba desde Vitest (`tests/sortides.test.ts`).

import type { SheetData } from 'write-excel-file/browser'
import type {
  AgrupacioSortides, AlbaraSortida, EntradesSortides, EstatSortida, FilaSortida, GrupSortides,
  ModalitatSortida, ResumSortides, TipusOperacio, XifresModalitat, XifresSortides,
} from '../types'

type T = (clau: string, params?: Record<string, string | number>) => string

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

export const MODALITATS_SORTIDA: readonly ModalitatSortida[] = ['donacio', 'venda', 'maquila']
/** El tipus d'operació de la oferta: ya cosechado o espigolada (una donación normal). */
export const TIPUS_OPERACIO: readonly TipusOperacio[] = ['excedent', 'espigolada']
export const ESTATS_SORTIDA: readonly EstatSortida[] = [
  'pendent', 'programada', 'registrada', 'entregada', 'confirmada', 'conciliada', 'anulada',
]
export const AGRUPACIONS_SORTIDES: readonly AgrupacioSortides[] = [
  'ofertant', 'receptor', 'producte', 'modalitat', 'tipus_operacio', 'mes', 'zona', 'estat',
]

/** Las filas de una página de la tabla. */
export const MIDA_PAGINA_SORTIDES = 25
/** Las filas por petición al exportar: el tope de `entrades_sortides` (y el `max_rows` de PostgREST). */
export const PAGINA_EXPORTACIO_SORTIDES = 1000

/**
 * La modalidad en la interfaz: las tres reales, con sus claves (`od.mod_*`: la maquila es
 * «Transformació en obrador (maquila)»).
 */
const CLAU_MODALITAT: Record<ModalitatSortida, string> = {
  donacio: 'od.mod_donacio',
  venda: 'od.mod_venda',
  maquila: 'od.mod_maquila',
}

/** El nombre corto de la modalidad, para las columnas del Resum. */
const CLAU_MODALITAT_CURTA: Record<ModalitatSortida, string> = {
  donacio: 'sort.curt_donacio',
  venda: 'sort.curt_venda',
  maquila: 'sort.curt_maquila',
}

/** El tipus d'operació en la interfaz (filtro, columna, grupo y Excel; también el listado de ofertas). */
const CLAU_TIPUS_OPERACIO: Record<TipusOperacio, string> = {
  excedent: 'tipop.excedent',
  espigolada: 'tipop.espigolada',
}

/**
 * El estado de la recogida: el de la ficha de la operación (`op.estat_*`), salvo `programada`.
 * En la ficha, `pendent` y `programada` se leen igual («Recollida pendent»: a quien mira le da
 * lo mismo), pero aquí son dos opciones del filtro y dos valores del Excel, y tienen que poder
 * distinguirse. `anulada` no sale nunca en la ficha (`operacio_detall` no la conoce).
 */
const CLAU_ESTAT: Record<EstatSortida, string> = {
  pendent: 'op.estat_pendent',
  programada: 'sort.estat_programada',
  registrada: 'op.estat_registrada',
  entregada: 'op.estat_entregada',
  confirmada: 'op.estat_confirmada',
  conciliada: 'op.estat_conciliada',
  anulada: 'op.estat_anulada',
}

/** Las clases del badge del estado, las de la ficha de la operación (§2bis, solo tokens). */
const CLASSE_ESTAT: Record<EstatSortida, string> = {
  pendent: 'bg-aviso-fondo text-aviso',
  programada: 'bg-aviso-fondo text-aviso',
  registrada: 'bg-secondary text-secondary-foreground',
  entregada: 'bg-muted text-foreground',
  confirmada: 'bg-exito-fondo text-exito',
  conciliada: 'border border-input bg-background text-muted-foreground',
  anulada: 'bg-error-fondo text-error',
}

/** El nombre de cada agrupación (el desplegable «Agrupa per» y la cabecera del grupo). */
const CLAU_AGRUPACIO: Record<AgrupacioSortides, string> = {
  ofertant: 'sort.per_ofertant',
  receptor: 'sort.per_receptor',
  producte: 'sort.per_producte',
  modalitat: 'sort.per_modalitat',
  tipus_operacio: 'sort.per_tipus_operacio',
  mes: 'sort.per_mes',
  zona: 'sort.per_zona',
  estat: 'sort.per_estat',
}

/** Un grupo sin valor (zona o producto vacíos; ofertante o receptor sin ficha). */
const CLAU_SENSE: Partial<Record<AgrupacioSortides, string>> = {
  ofertant: 'sort.sense_ofertant',
  receptor: 'sort.sense_receptor',
  producte: 'sort.sense_producte',
  zona: 'sort.sense_zona',
  mes: 'sort.sense_data',
}

/** Los meses (`preu.mes_1…12`, ya en minúscula en los dos idiomas). */
const CLAU_MES = [
  'preu.mes_1', 'preu.mes_2', 'preu.mes_3', 'preu.mes_4', 'preu.mes_5', 'preu.mes_6',
  'preu.mes_7', 'preu.mes_8', 'preu.mes_9', 'preu.mes_10', 'preu.mes_11', 'preu.mes_12',
] as const

export function esModalitatSortida(v: unknown): v is ModalitatSortida {
  return typeof v === 'string' && (MODALITATS_SORTIDA as readonly string[]).includes(v)
}
export function esTipusOperacio(v: unknown): v is TipusOperacio {
  return typeof v === 'string' && (TIPUS_OPERACIO as readonly string[]).includes(v)
}
export function esEstatSortida(v: unknown): v is EstatSortida {
  return typeof v === 'string' && (ESTATS_SORTIDA as readonly string[]).includes(v)
}
export function esAgrupacio(v: unknown): v is AgrupacioSortides {
  return typeof v === 'string' && (AGRUPACIONS_SORTIDES as readonly string[]).includes(v)
}

export function clauModalitat(m: string): string {
  return esModalitatSortida(m) ? CLAU_MODALITAT[m] : 'sort.desconegut'
}
export function clauModalitatCurta(m: ModalitatSortida): string {
  return CLAU_MODALITAT_CURTA[m]
}
export function clauTipusOperacio(x: string): string {
  return esTipusOperacio(x) ? CLAU_TIPUS_OPERACIO[x] : 'sort.desconegut'
}
export function clauEstat(e: string): string {
  return esEstatSortida(e) ? CLAU_ESTAT[e] : 'sort.desconegut'
}
export function classeEstat(e: string): string {
  return esEstatSortida(e) ? CLASSE_ESTAT[e] : 'bg-muted text-muted-foreground'
}
export function clauAgrupacio(a: AgrupacioSortides): string {
  return CLAU_AGRUPACIO[a]
}

// ---------------------------------------------------------------------------
// La URL: pestaña y agrupación
// ---------------------------------------------------------------------------

export type PestanyaSortides = 'sortides' | 'resum'

export function llegeixPestanyaSortides(v: string | null | undefined): PestanyaSortides {
  return v === 'resum' ? 'resum' : 'sortides'
}

/** La agrupación del Resum (`?per=`); por defecto, la modalidad (la de la RPC). */
export const AGRUPACIO_PER_DEFECTE: AgrupacioSortides = 'modalitat'
export function llegeixAgrupacio(v: string | null | undefined): AgrupacioSortides {
  return esAgrupacio(v) ? v : AGRUPACIO_PER_DEFECTE
}

// ---------------------------------------------------------------------------
// Filtros → argumentos de las RPC
// ---------------------------------------------------------------------------

/** Las dimensiones de la barra de filtros, por su clave en `ValorsFiltre`. */
export const DIMENSIONS_FILTRE = ['ofertant', 'receptor', 'producte', 'zona', 'modalitat', 'tipus_operacio', 'estat'] as const

export interface FiltresSortides {
  valors: Record<string, string>
  /** `AAAA-MM-DD` o '' (sin límite), inclusivos, sobre la fecha de salida. */
  desDe: string
  finsA: string
  cerca: string
}

/** Los diez filtros comunes de las dos RPC (null = sin filtro). */
export interface ArgsFiltresSortides {
  p_desde: string | null
  p_hasta: string | null
  p_productor: string | null
  p_entidad: string | null
  p_producto: string | null
  p_zona: string | null
  p_modalitat: string | null
  p_estat: string | null
  p_cerca: string | null
  p_tipus_operacio: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un día `AAAA-MM-DD` que existe (el 31 de febrero no), o null. */
export function diaValid(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? '').trim())
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? m[0] : null
}

/**
 * «22/11/2026» de `2026-11-22`, sin pasar por `Date`: la fecha de salida ya es un día de Madrid,
 * y convertirla a instante la movería de día en un navegador al oeste de Greenwich. Lo que no
 * sea un día se devuelve tal cual (o «—» si no hay nada).
 */
export function textDia(s: string | null | undefined): string {
  const d = diaValid(s)
  if (!d) return (s ?? '').trim() || '—'
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}

const textNet = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s === '' ? null : s
}

/**
 * Los argumentos de `entrades_sortides()`/`entrades_sortides_resum()` a partir de la barra.
 * Un valor que no vale (un uuid roto, una modalidad que ya no existe) se trata como «sin filtro»
 * en vez de llegar a la base y dar un error que la pantalla no sabría explicar.
 */
export function argsFiltres(f: FiltresSortides): ArgsFiltresSortides {
  const v = f.valors
  const uuid = (x: string | undefined) => (x && UUID.test(x) ? x : null)
  return {
    p_desde: diaValid(f.desDe),
    p_hasta: diaValid(f.finsA),
    p_productor: uuid(v.ofertant),
    p_entidad: uuid(v.receptor),
    p_producto: textNet(v.producte),
    p_zona: textNet(v.zona),
    // Un `modalitat=espigolada` recordado de antes de la fase 4 ya no es modalidad: sin filtro.
    p_modalitat: esModalitatSortida(v.modalitat) ? v.modalitat : null,
    p_estat: esEstatSortida(v.estat) ? v.estat : null,
    p_cerca: textNet(f.cerca),
    p_tipus_operacio: esTipusOperacio(v.tipus_operacio) ? v.tipus_operacio : null,
  }
}

/** ¿El rango está al revés? La RPC lo rechaza (`periode_invalid`); la pantalla lo dice antes. */
export function rangInvertit(a: Pick<ArgsFiltresSortides, 'p_desde' | 'p_hasta'>): boolean {
  return a.p_desde !== null && a.p_hasta !== null && a.p_desde > a.p_hasta
}

/** ¿Hay algún filtro puesto (contando el buscador)? Decide el texto de la lista vacía. */
export function ambFiltres(a: ArgsFiltresSortides): boolean {
  return Object.values(a).some((x) => x !== null)
}

/** La clave del mensaje de un error de las RPC (`22023 <codi>: …`); por defecto, el genérico. */
export function clauError(missatge: string | null | undefined): string {
  const m = missatge ?? ''
  if (m.includes('periode_invalid')) return 'sort.err_periode'
  if (m.includes('tipus_operacio_invalid')) return 'sort.err_tipus_operacio'
  return 'c.load_error'
}

// ---------------------------------------------------------------------------
// Lectura defensiva de lo que devuelven las RPC
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const numONull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const textONull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function albara(v: unknown): AlbaraSortida | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  if (typeof a.id !== 'string') return null
  const tipo = a.tipo === 'REC' || a.tipo === 'OPE' ? a.tipo : 'ENT'
  return { id: a.id, tipo, numero: textONull(a.numero), estado: typeof a.estado === 'string' ? a.estado : '' }
}

export function llegeixFila(v: unknown): FilaSortida {
  const f = (v ?? {}) as Record<string, unknown>
  return {
    canalizacion_id: String(f.canalizacion_id ?? ''),
    excedente_id: textONull(f.excedente_id),
    id_excedente: textONull(f.id_excedente),
    espigolada_id: textONull(f.espigolada_id),
    created_at: String(f.created_at ?? ''),
    data_sortida: String(f.data_sortida ?? ''),
    productor_id: textONull(f.productor_id),
    productor_nom: textONull(f.productor_nom),
    productor_org: textONull(f.productor_org),
    entidad_id: textONull(f.entidad_id),
    entidad_nom: textONull(f.entidad_nom),
    entidad_org: textONull(f.entidad_org),
    producto: textONull(f.producto),
    variedad: textONull(f.variedad),
    kg_sortida: numONull(f.kg_sortida),
    kg_recollits: numONull(f.kg_recollits),
    // La RPC de antes de la fase 4 podía mandar `espigolada` como modalidad: era una donación.
    modalitat: esModalitatSortida(f.modalitat) ? f.modalitat : 'donacio',
    tipus_operacio: esTipusOperacio(f.tipus_operacio) ? f.tipus_operacio
      : (f.modalitat === 'espigolada' || textONull(f.espigolada_id) ? 'espigolada' : 'excedent'),
    estat: esEstatSortida(f.estat) ? f.estat : 'pendent',
    causa_codigo: textONull(f.causa_codigo),
    municipi: textONull(f.municipi),
    municipi_ine: textONull(f.municipi_ine),
    zona: textONull(f.zona),
    caixes_entregades: numONull(f.caixes_entregades),
    caixes_retornades: numONull(f.caixes_retornades),
    preu_kg: numONull(f.preu_kg),
    valor: numONull(f.valor),
    albara_ent: albara(f.albara_ent),
    albara_rec: albara(f.albara_rec),
    // Proceso 3.7 (20270619100300): la oferta se registró a posteriori. Una RPC anterior no lo manda.
    registre_posteriori: f.registre_posteriori === true,
  }
}

export function llegeixEntrades(v: unknown): EntradesSortides {
  const r = (v ?? {}) as Record<string, unknown>
  return {
    total: num(r.total),
    kg_sortida: num(r.kg_sortida),
    kg_recollits: num(r.kg_recollits),
    files: Array.isArray(r.files) ? r.files.map(llegeixFila) : [],
  }
}

function xifresModalitat(v: unknown): XifresModalitat {
  const x = (v ?? {}) as Record<string, unknown>
  return { sortides: num(x.sortides), kg_sortida: num(x.kg_sortida), kg_recollits: num(x.kg_recollits) }
}

function xifres(v: unknown): XifresSortides {
  const x = (v ?? {}) as Record<string, unknown>
  const pm = (x.per_modalitat ?? {}) as Record<string, unknown>
  const pt = (x.per_tipus_operacio ?? {}) as Record<string, unknown>
  return {
    ...xifresModalitat(x),
    ofertants: num(x.ofertants),
    receptors: num(x.receptors),
    espigolades: num(x.espigolades),
    // `pm.espigolada` (obsoleta) se ignora a propósito: esos kilos ya están en `donacio`.
    per_modalitat: {
      donacio: xifresModalitat(pm.donacio),
      venda: xifresModalitat(pm.venda),
      maquila: xifresModalitat(pm.maquila),
    },
    per_tipus_operacio: {
      excedent: xifresModalitat(pt.excedent),
      espigolada: xifresModalitat(pt.espigolada),
    },
  }
}

export function llegeixResum(v: unknown): ResumSortides {
  const r = (v ?? {}) as Record<string, unknown>
  return {
    total: xifres(r.total),
    grups: Array.isArray(r.grups)
      ? r.grups.map((g): GrupSortides => {
        const o = (g ?? {}) as Record<string, unknown>
        return { ...xifres(o), clau: textONull(o.clau), etiqueta: textONull(o.etiqueta) }
      })
      : [],
  }
}

/** El resumen vacío (antes de cargar, o si falla). */
export function resumBuit(): ResumSortides {
  return llegeixResum({})
}

// ---------------------------------------------------------------------------
// Etiquetas de grupo y opciones de los filtros
// ---------------------------------------------------------------------------

/** «novembre 2026» de `2026-11`; null si no es un mes. */
export function textMes(clau: string | null | undefined, t: T): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(clau ?? '')
  if (!m) return null
  const mes = Number(m[2])
  if (mes < 1 || mes > 12) return null
  return `${t(CLAU_MES[mes - 1])} ${m[1]}`
}

/** Cómo se lee un grupo del Resum: el nombre, la modalidad, el tipo o el estado traducidos, el mes, o «Sense …». */
export function textGrup(per: AgrupacioSortides, g: Pick<GrupSortides, 'clau' | 'etiqueta'>, t: T): string {
  if (per === 'modalitat') return g.clau ? t(clauModalitat(g.clau)) : t('sort.desconegut')
  if (per === 'tipus_operacio') return g.clau ? t(clauTipusOperacio(g.clau)) : t('sort.desconegut')
  if (per === 'estat') return g.clau ? t(clauEstat(g.clau)) : t('sort.desconegut')
  if (per === 'mes') return textMes(g.clau, t) ?? t(CLAU_SENSE.mes ?? 'sort.desconegut')
  const nom = (g.etiqueta ?? '').trim() || (g.clau ?? '').trim()
  return nom || t(CLAU_SENSE[per] ?? 'sort.desconegut')
}

export interface OpcionsFiltre {
  /** Los valores (la `clau` del grupo), por nombre. */
  valors: string[]
  /** El nombre de cada valor. */
  noms: Record<string, string>
}

/**
 * Las opciones de un filtro a partir de los grupos de `entrades_sortides_resum` sin filtros: los
 * que tienen clave (un grupo «sin zona» no se puede pedir: la RPC filtra por igualdad), ordenados
 * por nombre.
 */
export function opcionsDeGrups(grups: readonly Pick<GrupSortides, 'clau' | 'etiqueta'>[]): OpcionsFiltre {
  const noms: Record<string, string> = {}
  for (const g of grups) {
    if (!g.clau) continue
    noms[g.clau] = (g.etiqueta ?? '').trim() || g.clau
  }
  const valors = Object.keys(noms).sort((a, b) => noms[a].localeCompare(noms[b], 'ca'))
  return { valors, noms }
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

/** El nombre del fichero: `entrades-sortides-AAAA-MM-DD.xlsx`. */
export function nomFitxerSortides(avui: string): string {
  return `entrades-sortides-${avui}.xlsx`
}

/** Las columnas de la hoja «Sortides», en su orden (la cabecera, por clave i18n). */
export const COLUMNES_SORTIDES = [
  { clau: 'data_sortida', capcalera: 'sort.x_data', ample: 12 },
  { clau: 'id_excedente', capcalera: 'sort.x_oferta', ample: 22 },
  { clau: 'ofertant', capcalera: 'sort.x_ofertant', ample: 28 },
  { clau: 'producte', capcalera: 'sort.x_producte', ample: 18 },
  { clau: 'varietat', capcalera: 'sort.x_varietat', ample: 16 },
  { clau: 'receptor', capcalera: 'sort.x_receptor', ample: 28 },
  { clau: 'kg_sortida', capcalera: 'sort.x_kg_sortida', ample: 12 },
  { clau: 'kg_recollits', capcalera: 'sort.x_kg_recollits', ample: 12 },
  { clau: 'modalitat', capcalera: 'sort.x_modalitat', ample: 22 },
  { clau: 'tipus_operacio', capcalera: 'sort.x_tipus_operacio', ample: 20 },
  { clau: 'estat', capcalera: 'sort.x_estat', ample: 20 },
  { clau: 'causa', capcalera: 'sort.x_causa', ample: 10 },
  { clau: 'municipi', capcalera: 'sort.x_municipi', ample: 18 },
  { clau: 'zona', capcalera: 'sort.x_zona', ample: 18 },
  { clau: 'caixes_entregades', capcalera: 'sort.x_caixes_ent', ample: 12 },
  { clau: 'caixes_retornades', capcalera: 'sort.x_caixes_ret', ample: 12 },
  { clau: 'preu_kg', capcalera: 'sort.x_preu_kg', ample: 10 },
  { clau: 'valor', capcalera: 'sort.x_valor', ample: 12 },
  { clau: 'albara_ent', capcalera: 'sort.x_albara_ent', ample: 18 },
  { clau: 'albara_rec', capcalera: 'sort.x_albara_rec', ample: 18 },
  // Proceso 3.7: «Sí» si la operación se registró a posteriori; vacía si no.
  { clau: 'registre_posteriori', capcalera: 'sort.x_registre_posteriori', ample: 14 },
] as const

/** Una celda de `write-excel-file`: texto, número o fecha (null = vacía). */
export type CellaSortides =
  | { value: string; fontWeight?: 'bold' }
  | { value: number; type: NumberConstructor; format?: string; fontWeight?: 'bold' }
  | { value: Date; type: DateConstructor; format: string }
  | null

const negreta = (value: string): CellaSortides => ({ value, fontWeight: 'bold' })
const cText = (v: string | null | undefined): CellaSortides => (v ? { value: v } : null)
const cNum = (v: number | null | undefined, format?: string): CellaSortides =>
  (v === null || v === undefined || !Number.isFinite(v) ? null : { value: v, type: Number, ...(format ? { format } : {}) })

/** Un día `AAAA-MM-DD` como fecha de Excel (`dd/mm/yyyy`); lo que no lo sea, como texto. */
export function cellaDia(s: string | null | undefined): CellaSortides {
  const d = diaValid(s)
  if (!d) return cText(s)
  const [a, m, dia] = d.split('-').map(Number)
  return { value: new Date(Date.UTC(a, m - 1, dia)), type: Date, format: 'dd/mm/yyyy' }
}

/** Una fila de la hoja «Sortides». */
export function filaExcel(f: FilaSortida, t: T): CellaSortides[] {
  return [
    cellaDia(f.data_sortida),
    cText(f.id_excedente),
    cText(f.productor_nom),
    cText(f.producto),
    cText(f.variedad),
    cText(f.entidad_nom),
    cNum(f.kg_sortida),
    cNum(f.kg_recollits),
    cText(t(clauModalitat(f.modalitat))),
    cText(t(clauTipusOperacio(f.tipus_operacio))),
    cText(t(clauEstat(f.estat))),
    cText(f.causa_codigo),
    cText(f.municipi),
    cText(f.zona),
    cNum(f.caixes_entregades),
    cNum(f.caixes_retornades),
    cNum(f.preu_kg, '0.0000'),
    cNum(f.valor, '#,##0.00'),
    cText(f.albara_ent?.numero ?? null),
    cText(f.albara_rec?.numero ?? null),
    cText(f.registre_posteriori ? t('c.yes') : null),
  ]
}

/** La hoja «Sortides»: cabecera y una fila por salida, en el orden recibido. */
export function fullaSortides(files: readonly FilaSortida[], t: T): CellaSortides[][] {
  return [COLUMNES_SORTIDES.map((c) => negreta(t(c.capcalera))), ...files.map((f) => filaExcel(f, t))]
}

/**
 * La hoja «Resum»: el grupo, las cifras, los kilos recogidos por modalidad y por tipus d'operació;
 * y la fila del total.
 */
export function fullaResum(resum: ResumSortides, per: AgrupacioSortides, t: T): CellaSortides[][] {
  const capcalera = [
    t(clauAgrupacio(per)), t('sort.x_sortides'), t('sort.x_kg_sortida'), t('sort.x_kg_recollits'),
    t('sort.x_ofertants'), t('sort.x_receptors'), t('sort.x_espigolades'),
    ...MODALITATS_SORTIDA.map((m) => t('sort.x_kg_recollits_mod', { modalitat: t(clauModalitatCurta(m)) })),
    ...TIPUS_OPERACIO.map((x) => t('sort.x_kg_recollits_mod', { modalitat: t(clauTipusOperacio(x)) })),
  ].map(negreta)
  const fila = (nom: string, x: XifresSortides, bold = false): CellaSortides[] => {
    const n = (v: number) => (bold ? { value: v, type: Number, fontWeight: 'bold' as const } : cNum(v))
    return [
      bold ? negreta(nom) : cText(nom),
      n(x.sortides), n(x.kg_sortida), n(x.kg_recollits),
      n(x.ofertants), n(x.receptors), n(x.espigolades),
      ...MODALITATS_SORTIDA.map((m) => n(x.per_modalitat[m].kg_recollits)),
      ...TIPUS_OPERACIO.map((o) => n(x.per_tipus_operacio[o].kg_recollits)),
    ]
  }
  return [
    capcalera,
    ...resum.grups.map((g) => fila(textGrup(per, g, t), g)),
    fila(t('sort.total'), resum.total, true),
  ]
}

/** Los anchos de columna de la hoja «Resum». */
const AMPLES_RESUM = [30, 10, 14, 14, 10, 10, 12, 16, 16, 16, 22, 16]

/** Las dos hojas, con el formato de `writeXlsxFile` (nombres traducidos). */
export function llibreSortides(files: readonly FilaSortida[], resum: ResumSortides, per: AgrupacioSortides, t: T) {
  return [
    { sheet: t('sort.full_sortides'), data: fullaSortides(files, t), columns: COLUMNES_SORTIDES.map((c) => ({ width: c.ample })), stickyRowsCount: 1 },
    { sheet: t('sort.full_resum'), data: fullaResum(resum, per, t), columns: AMPLES_RESUM.map((width) => ({ width })), stickyRowsCount: 1 },
  ]
}

/** El fichero, listo para descargar. `null` si la librería no carga o falla. */
export async function blobSortides(
  files: readonly FilaSortida[], resum: ResumSortides, per: AgrupacioSortides, t: T,
): Promise<Blob | null> {
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const fulles = llibreSortides(files, resum, per, t).map((f) => ({ ...f, data: f.data as SheetData }))
    return await writeXlsxFile(fulles).toBlob()
  } catch {
    return null
  }
}
