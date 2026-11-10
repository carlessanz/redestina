// La plantilla Excel del importador de entidades (06-11-2026).
//
// Tres hojas: «Entitats» (las cabeceras de `COLUMNES_PLANTILLA`, en catalán, y una fila de
// ejemplo marcada que el lector salta), «Instruccions» (qué es cada columna, si es
// obligatoria, el formato, los valores admitidos y qué pasa si falta) y «Llistes» (los valores
// de las listas cerradas, en el idioma de la interfaz: el lector acepta los dos).
//
// `dadesPlantilla()` es PURA (la prueba comprueba que la plantilla se reconoce entera);
// `descarregaPlantilla()` carga `write-excel-file` con `import()` dinámico, para que la
// librería vaya en un chunk aparte y solo la descargue quien la usa.
//
// Desplegables (Plan 2 B2, 10-11-2026; D9): en la hoja «Entitats», cada columna con lista lleva un
// desplegable que apunta a su columna de «Llistes» (`validacionsPlantilla`), SALVO Comarca, que la
// deduce el municipio. `write-excel-file` no hace validación de datos: `lib/excelValidacions.ts`
// inserta el `<dataValidations>` con una «feature» de la librería, en el sitio que exige OOXML. En
// las listas de un valor, salirse avisa (no bloquea: el lector tolera mayúsculas, acentos y los dos
// idiomas); en las de varios (actividad, modalidades), el desplegable solo ayuda.
//
// Las columnas de NIF, CP, teléfonos, IDs y la fecha de alta van en formato texto (`@`) en las
// primeras filas, para que Excel no se coma el cero de «08380», no convierta un móvil en notación
// científica ni reinterprete «2021» o «15/03/2019» (la base entiende los dos; B4, 20270519100000).
// «ID Redestina» y «Data d'alta a l'organització» (B4) van al final (Z, AA): las letras de las
// columnas con desplegable no se mueven.

import type { Feature, SheetData } from 'write-excel-file/browser'
import {
  COLUMNES_PLANTILLA, TIPUS_RECEPTOR, type ActivitatCataleg, type ColumnaPlantilla, type Llista,
} from './importEntitats'
import { featureValidacions, rangLlista, type ValidacioLlista } from './excelValidacions'
import { MODALITATS_IDS } from './modalitats'
import { TIPUS_EMPRESA } from './perfilReceptor'
import { NATURALESES } from './naturalesa'

type Traductor = (clau: string, params?: Record<string, string | number>) => string

export interface ContextPlantilla {
  t: Traductor
  lang: 'ca' | 'es'
  activitats: readonly ActivitatCataleg[]
  comarques: readonly string[]
  /** Los nombres de los municipios tal como se escriben (`nomLlegible`), ya ordenados. */
  municipis: readonly string[]
}

/** Filas vacías con formato texto, para que lo que se escriba ahí no lo reinterprete Excel. */
const FILES_FORMATADES = 300

export const NOM_FULLA = { entitats: 'Entitats', instruccions: 'Instruccions', llistes: 'Llistes' } as const

/** Las columnas que salen en la plantilla, en su orden. */
export const COLUMNES_DE_PLANTILLA: readonly ColumnaPlantilla[] = COLUMNES_PLANTILLA.filter((c) => c.plantilla)

export const LLISTES: readonly Llista[] = ['rol', 'tipo_receptor', 'tipus_empresa', 'tipus_activitat', 'modalitats', 'comarca', 'municipi', 'naturalesa']

/** Las listas que NO llevan desplegable en «Entitats» (D9: la comarca sale del municipio). */
export const SENSE_DESPLEGABLE: readonly Llista[] = ['comarca']

/** Las listas que admiten varios valores separados por coma: el desplegable ayuda pero no avisa. */
export const LLISTES_MULTIPLES: readonly Llista[] = ['tipus_activitat', 'modalitats']

/** Primera y última fila de «Entitats» con desplegable: la de ejemplo y las que van con formato. */
export const FILES_AMB_DESPLEGABLE = { primeraFila: 2, ultimaFila: FILES_FORMATADES + 2 } as const

/** Los valores de cada lista, ya en palabras. */
export function valorsLlista(llista: Llista, ctx: ContextPlantilla): string[] {
  const { t } = ctx
  switch (llista) {
    case 'rol': return [t('ef.paper_ofertant'), t('ef.paper_receptor'), t('ie.rol_tots')]
    case 'tipo_receptor': return TIPUS_RECEPTOR.map((x) => t(`org.tr_${x}`))
    case 'tipus_empresa': return TIPUS_EMPRESA.map((x) => t(`org.te_${x}`))
    case 'tipus_activitat': return ctx.activitats.map((a) => (ctx.lang === 'es' ? a.nom_es : a.nom_ca))
    case 'modalitats': return MODALITATS_IDS.map((m) => t(`od.mod_${m}`))
    case 'comarca': return [...ctx.comarques]
    case 'municipi': return [...ctx.municipis]
    case 'naturalesa': return NATURALESES.map((n) => t(`nat.${n}`))
  }
}

const negreta = (value: string) => ({ value, fontWeight: 'bold' as const })
const text = (value: string) => ({ value, type: String, format: '@' as const })
const buidaText = () => ({ value: undefined, type: String, format: '@' as const })

/** Las tres hojas, como datos de `write-excel-file`. */
export function dadesPlantilla(ctx: ContextPlantilla): { nom: string; data: SheetData; amples: number[] }[] {
  const { t } = ctx
  const cols = COLUMNES_DE_PLANTILLA

  // «Entitats»: cabeceras, la fila de ejemplo y filas con formato texto donde toca.
  const entitats: SheetData = [
    cols.map((c) => negreta(c.capcalera)),
    cols.map((c) => (c.text ? text(c.exemple) : c.exemple || null)),
    ...Array.from({ length: FILES_FORMATADES }, () => cols.map((c) => (c.text ? buidaText() : null))),
  ]

  // «Instruccions»: unas líneas de cómo funciona y una tabla por columna.
  const falta = (c: ColumnaPlantilla) => t(c.obligatoria ? 'ie.falta_obligatoria'
    : c.clau === 'rols' ? 'ie.falta_rols'
      : c.clau === 'redestina_id' ? 'ie.falta_redestina_id'
        : c.clau === 'data_alta' ? 'ie.falta_data_alta'
          : c.clau === 'naturalesa' ? 'ie.falta_naturalesa'
          : c.etiquetaNota ? 'ie.falta_nota' : 'ie.falta_opcional')
  const instruccions: SheetData = [
    [negreta(t('ie.pl_titol'))],
    [t('ie.pl_intro_1')],
    [t('ie.pl_intro_2')],
    [t('ie.pl_intro_3')],
    [t('ie.pl_intro_4')],
    [],
    [negreta(t('ie.pl_columna')), negreta(t('ie.pl_obligatoria')), negreta(t('ie.pl_format')),
      negreta(t('ie.pl_valors')), negreta(t('ie.pl_falta'))],
    ...cols.map((c) => [
      c.capcalera,
      t(c.obligatoria ? 'c.yes' : 'c.no'),
      t(`ie.h_${c.clau}`),
      c.llista ? t('ie.pl_veure_llista', { llista: t(`ie.ll_${c.llista}`) }) : null,
      falta(c),
    ]),
  ]

  // «Llistes»: una columna por lista.
  const valors = LLISTES.map((l) => valorsLlista(l, ctx))
  const alt = Math.max(...valors.map((v) => v.length))
  const llistes: SheetData = [
    LLISTES.map((l) => negreta(t(`ie.ll_${l}`))),
    ...Array.from({ length: alt }, (_, i) => valors.map((v) => v[i] ?? null)),
  ]

  return [
    { nom: NOM_FULLA.entitats, data: entitats, amples: cols.map((c) => Math.max(14, Math.min(34, c.capcalera.length + 4))) },
    { nom: NOM_FULLA.instruccions, data: instruccions, amples: [26, 12, 70, 30, 50] },
    { nom: NOM_FULLA.llistes, data: llistes, amples: LLISTES.map(() => 30) },
  ]
}

/**
 * Los desplegables de «Entitats»: una validación por columna con lista (menos las de
 * `SENSE_DESPLEGABLE`), con el rango de su columna en «Llistes». Una lista vacía (el catálogo no
 * cargó) se queda sin desplegable.
 */
export function validacionsPlantilla(ctx: ContextPlantilla): ValidacioLlista[] {
  const out: ValidacioLlista[] = []
  COLUMNES_DE_PLANTILLA.forEach((c, columna) => {
    if (!c.llista || SENSE_DESPLEGABLE.includes(c.llista)) return
    const rang = rangLlista(NOM_FULLA.llistes, LLISTES.indexOf(c.llista), valorsLlista(c.llista, ctx).length)
    if (rang) out.push({ columna, rang, multiple: LLISTES_MULTIPLES.includes(c.llista) })
  })
  return out
}

/** La feature de `write-excel-file` que pone los desplegables en «Entitats» (la primera hoja). */
export function featurePlantilla<F = unknown>(ctx: ContextPlantilla): Feature<F> {
  return featureValidacions<F>(validacionsPlantilla(ctx), {
    ...FILES_AMB_DESPLEGABLE, avisTitol: ctx.t('ie.dv_titol'), avis: ctx.t('ie.dv_avis'),
  })
}

/** Las hojas con el formato de `writeXlsxFile` (sirve igual para `/browser` y para `/node`). */
export function fullesPlantilla(ctx: ContextPlantilla) {
  return dadesPlantilla(ctx).map((f) => ({
    sheet: f.nom,
    data: f.data,
    columns: f.amples.map((width) => ({ width })),
    stickyRowsCount: f.nom === NOM_FULLA.entitats ? 1 : undefined,
  }))
}

/** El `FileContent` de `write-excel-file/browser` (el paquete no exporta el alias). */
type ContingutNavegador = File | Blob | ArrayBuffer

/** El fichero de la plantilla, listo para descargar. `null` si la librería no carga. */
export async function blobPlantilla(ctx: ContextPlantilla): Promise<Blob | null> {
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    return await writeXlsxFile(fullesPlantilla(ctx), { features: [featurePlantilla<ContingutNavegador>(ctx)] }).toBlob()
  } catch {
    return null
  }
}
