// La exportación de entidades a Excel (Plan 2 B3, 10-11-2026; D10): el MISMO formato que la
// plantilla del importador, para completar datos fuera y volver a subirlo.
//
// Lo pidió Sebas (Teams, 09-11). La lanza todo el equipo (también `tecnic`); importar sigue siendo
// del super_admin. Los datos los da la RPC `exportar_entitats()` (una fila por organización, en
// CÓDIGOS); aquí se ponen en palabras y se compone el fichero:
//   · «Entitats»: las columnas de la plantilla (`COLUMNES_DE_PLANTILLA`), en su orden, con los
//     valores en el idioma de la interfaz (como la hoja «Llistes»: el lector acepta los dos). Desde
//     B4 (20270519100000) «ID Redestina» (Z) y «Data d'alta a l'organització» (AA) son columnas de
//     la plantilla: el importador las lee (el ID identifica la organización; la fecha la actualiza).
//     DETRÁS, dos informativas (`CAPCALERES_EXPORTACIO`): el estado CRM de cada papel (AB, AC; P9:
//     no se importa). Las letras no se mueven: los desplegables de B2 caen en el mismo sitio.
//   · Las columnas de NOTA (Càrrec, Web, Observacions…) salen VACÍAS: reimportarlas añadiría el
//     texto otra vez al comentario interno.
//   · «Instruccions» propias de la exportación y «Llistes» idéntica a la plantilla; los
//     desplegables de B2 (`featureValidacions`) en las filas con datos y en `FILES_BUIDES` más.
//
// El contrato que se garantiza (`tests/exportEntitats.test.ts`, ida y vuelta): una fila exportada,
// leída con `llegeixFulla` + `normalitzaFila`, da la fila del contrato que corresponde a la ficha,
// sin avisos ni líneas de nota; así la reimportación de lo exportado sale `sense_canvis`.
//
// PURO salvo `blobExportacio()` (que carga `write-excel-file` con `import()` dinámico).

import type { SheetData } from 'write-excel-file/browser'
import { CAPCALERES_EXPORTACIO, TIPUS_RECEPTOR, type ClauColumna } from './importEntitats'
import { featureValidacions } from './excelValidacions'
import { MODALITATS_IDS } from './modalitats'
import { TIPUS_EMPRESA } from './perfilReceptor'
import {
  COLUMNES_DE_PLANTILLA, dadesPlantilla, NOM_FULLA, validacionsPlantilla, type ContextPlantilla,
} from './plantillaEntitats'

/** Una fila de `exportar_entitats()` (migración 20270518110000). */
export interface FilaExportacio {
  organizacion_id: string
  es_test: boolean
  rols: string[]
  nom_comercial: string | null
  razon_social: string | null
  nif: string | null
  tipus_empresa: string | null
  tipo_receptor: string | null
  tipus_activitat: string[] | null
  modalitats_interes: string[] | null
  persona_contacte: string | null
  email: string | null
  email2: string | null
  telefon: string | null
  telefon2: string | null
  direccion: string | null
  codigo_postal: string | null
  municipi: string | null
  area_geografica: string | null
  airtable_id: string | null
  /** Texto: `AAAA-MM-DD` o lo que se importó del Excel (a veces solo el año). */
  data_alta: string | null
  estat_crm_productor: string | null
  estat_crm_entidad: string | null
}

/** Filas vacías (con formato texto y desplegables) detrás de las exportadas, para añadir entidades. */
export const FILES_BUIDES = 100

/** Las columnas informativas, en su orden, detrás de las de la plantilla (el importador las ignora). */
export const COLUMNES_EXTRA = [
  { clau: 'estat_crm_productor', capcalera: CAPCALERES_EXPORTACIO.estat_crm_productor },
  { clau: 'estat_crm_entidad', capcalera: CAPCALERES_EXPORTACIO.estat_crm_entidad },
] as const

const ESTATS_CRM = ['potencial', 'en_desenvolupament', 'actiu', 'inactiu'] as const

/** El nombre del fichero: `entitats-AAAA-MM-DD.xlsx`. */
export function nomFitxerExportacio(avui: string): string {
  return `entitats-${avui}.xlsx`
}

const net = (s: string | null | undefined): string | null => {
  const v = (s ?? '').trim()
  return v === '' ? null : v
}

/**
 * El valor de cada columna de la plantilla para una organización, ya en palabras. Lo que no es un
 * código conocido NO sale (una forma jurídica heredada como «Explotació hortícola», una modalidad
 * o actividad fuera del catálogo): exportarlo haría que la reimportación lo mandara al comentario.
 * Las columnas de nota quedan vacías.
 */
export function valorsFila(f: FilaExportacio, ctx: ContextPlantilla): Partial<Record<ClauColumna, string>> {
  const { t } = ctx
  const out: Partial<Record<ClauColumna, string>> = {}
  const posa = (k: ClauColumna, v: string | null | undefined) => {
    const x = net(v)
    if (x !== null) out[k] = x
  }
  const prod = f.rols.includes('productor')
  const ent = f.rols.includes('entidad')
  posa('rols', prod && ent ? t('ie.rol_tots') : prod ? t('ef.paper_ofertant') : ent ? t('ef.paper_receptor') : null)
  posa('nom_comercial', f.nom_comercial)
  posa('razon_social', f.razon_social)
  posa('nif', f.nif)
  posa('tipus_empresa', f.tipus_empresa && (TIPUS_EMPRESA as readonly string[]).includes(f.tipus_empresa) ? t(`org.te_${f.tipus_empresa}`) : null)
  posa('tipo_receptor', ent && f.tipo_receptor && TIPUS_RECEPTOR.includes(f.tipo_receptor) ? t(`org.tr_${f.tipo_receptor}`) : null)
  const noms = (f.tipus_activitat ?? [])
    .map((c) => ctx.activitats.find((a) => a.codi === c))
    .filter((a) => a !== undefined)
    .map((a) => (ctx.lang === 'es' ? a.nom_es : a.nom_ca))
  posa('tipus_activitat', noms.join(', '))
  posa('modalitats_interes', ent
    ? (f.modalitats_interes ?? []).filter((m) => (MODALITATS_IDS as readonly string[]).includes(m)).map((m) => t(`od.mod_${m}`)).join(', ')
    : null)
  posa('persona_contacte', f.persona_contacte)
  posa('email', f.email)
  posa('email2', f.email2)
  posa('telefon', f.telefon)
  posa('telefon2', f.telefon2)
  posa('direccion', f.direccion)
  posa('codigo_postal', f.codigo_postal)
  posa('municipi', f.municipi)
  posa('area_geografica', f.area_geografica)
  posa('airtable_id', f.airtable_id)
  posa('redestina_id', f.organizacion_id)
  posa('data_alta', f.data_alta)
  return out
}

const negreta = (value: string) => ({ value, fontWeight: 'bold' as const })
const text = (value: string | undefined) => ({ value, type: String, format: '@' as const })

/**
 * «Data d'alta»: una fecha `AAAA-MM-DD` va como fecha de Excel (`dd/mm/yyyy`); solo el año (lo que
 * trajo el Excel del ARA), como texto. El importador lee las dos (`valorData`).
 */
function cellaData(v: string | null) {
  const s = net(v)
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return { value: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), type: Date, format: 'dd/mm/yyyy' }
  return text(s ?? undefined)
}

/** Una fila de «Entitats»: las columnas de la plantilla y, detrás, las informativas. */
function filaFulla(f: FilaExportacio, ctx: ContextPlantilla) {
  const v = valorsFila(f, ctx)
  const estat = (e: string | null) => ((ESTATS_CRM as readonly string[]).includes(e ?? '') ? ctx.t(`ef.estat_${e}`) : null)
  return [
    ...COLUMNES_DE_PLANTILLA.map((c) => (c.clau === 'data_alta' ? cellaData(v.data_alta ?? null)
      : c.text ? text(v[c.clau]) : v[c.clau] ?? null)),
    estat(f.estat_crm_productor),
    estat(f.estat_crm_entidad),
  ]
}

/** Las tres hojas de la exportación (los datos de `write-excel-file`). */
export function dadesExportacio(files: readonly FilaExportacio[], ctx: ContextPlantilla): { nom: string; data: SheetData; amples: number[] }[] {
  const { t } = ctx
  const [plantilla, instruccionsPlantilla, llistes] = dadesPlantilla(ctx)
  const n = COLUMNES_DE_PLANTILLA.length + COLUMNES_EXTRA.length
  // El uuid no cabe en el ancho de la plantilla.
  const iId = COLUMNES_DE_PLANTILLA.findIndex((c) => c.clau === 'redestina_id')
  const entitats: SheetData = [
    [...COLUMNES_DE_PLANTILLA.map((c) => negreta(c.capcalera)), ...COLUMNES_EXTRA.map((c) => negreta(c.capcalera))],
    ...files.map((f) => filaFulla(f, ctx)),
    ...Array.from({ length: FILES_BUIDES }, () => [
      ...COLUMNES_DE_PLANTILLA.map((c) => (c.text ? text(undefined) : null)),
      ...Array.from({ length: n - COLUMNES_DE_PLANTILLA.length }, () => null),
    ]),
  ]

  // «Instruccions»: las de la exportación arriba y la tabla de columnas de la plantilla (que
  // empieza en la fila de cabeceras «Columna»; ya explica «ID Redestina» y la fecha de alta), más
  // una fila por cada columna informativa.
  const iTaula = instruccionsPlantilla.data.findIndex((r) => {
    const c = r[0] as { value?: unknown } | null
    return c !== null && typeof c === 'object' && c.value === t('ie.pl_columna')
  })
  const taula = instruccionsPlantilla.data.slice(iTaula)
  const instruccions: SheetData = [
    [negreta(t('ex.pl_titol'))],
    [t('ex.pl_intro_1')],
    [t('ex.pl_intro_2')],
    [t('ie.pl_intro_3')],
    [t('ie.pl_intro_4')],
    [t('ex.pl_intro_5')],
    [],
    ...taula,
    ...COLUMNES_EXTRA.map((c) => [
      c.capcalera,
      t('c.no'),
      t(`ex.h_${c.clau}`),
      c.clau.startsWith('estat_crm') ? ESTATS_CRM.map((e) => t(`ef.estat_${e}`)).join(' · ') : null,
      t('ex.falta_informativa'),
    ]),
  ]

  return [
    { nom: NOM_FULLA.entitats, data: entitats, amples: [...plantilla.amples.map((a, i) => (i === iId ? 38 : a)), 20, 20] },
    { nom: NOM_FULLA.instruccions, data: instruccions, amples: instruccionsPlantilla.amples },
    { nom: NOM_FULLA.llistes, data: llistes.data, amples: llistes.amples },
  ]
}

/** Las filas de «Entitats» con desplegable: todas las exportadas y las vacías de detrás. */
export function filesAmbDesplegable(nFiles: number): { primeraFila: number; ultimaFila: number } {
  return { primeraFila: 2, ultimaFila: 1 + nFiles + FILES_BUIDES }
}

/** Las hojas con el formato de `writeXlsxFile` y la feature de los desplegables (las de B2). */
export function llibreExportacio<F = unknown>(files: readonly FilaExportacio[], ctx: ContextPlantilla) {
  const fulles = dadesExportacio(files, ctx).map((f) => ({
    sheet: f.nom,
    data: f.data,
    columns: f.amples.map((width) => ({ width })),
    stickyRowsCount: f.nom === NOM_FULLA.entitats ? 1 : undefined,
  }))
  const feature = featureValidacions<F>(validacionsPlantilla(ctx), {
    ...filesAmbDesplegable(files.length), avisTitol: ctx.t('ie.dv_titol'), avis: ctx.t('ie.dv_avis'),
  })
  return { fulles, feature }
}

/** El `FileContent` de `write-excel-file/browser` (el paquete no exporta el alias). */
type ContingutNavegador = File | Blob | ArrayBuffer

/** El fichero, listo para descargar. `null` si la librería no carga o falla. */
export async function blobExportacio(files: readonly FilaExportacio[], ctx: ContextPlantilla): Promise<Blob | null> {
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const { fulles, feature } = llibreExportacio<ContingutNavegador>(files, ctx)
    return await writeXlsxFile(fulles, { features: [feature] }).toBlob()
  } catch {
    return null
  }
}

/**
 * Las filas en el orden de la pantalla (`ids`, las visibles con los filtros); las que la RPC no
 * devuelva (sin ficha) se saltan.
 */
export function enOrdre(files: readonly FilaExportacio[], ids: readonly string[] | null): FilaExportacio[] {
  if (!ids) return [...files]
  const per = new Map(files.map((f) => [f.organizacion_id, f]))
  return ids.map((id) => per.get(id)).filter((f): f is FilaExportacio => f !== undefined)
}
