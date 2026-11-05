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
// ⚠️ Sin desplegables (validación de datos): `write-excel-file` no los hace sin un paquete
//    aparte o sin inyectar XML a mano en un orden que Excel exige, y eso es frágil. La hoja
//    «Llistes» dice los valores, y el lector tolera mayúsculas, acentos y los dos idiomas.
//
// Las columnas de NIF, CP, teléfonos e ID van en formato texto (`@`) en las primeras filas,
// para que Excel no se coma el cero de «08380» ni convierta un móvil en notación científica.

import type { SheetData } from 'write-excel-file/browser'
import {
  COLUMNES_PLANTILLA, TIPUS_RECEPTOR, type ActivitatCataleg, type ColumnaPlantilla, type Llista,
} from './importEntitats'
import { MODALITATS_IDS } from './modalitats'
import { TIPUS_EMPRESA } from './perfilReceptor'

type Traductor = (clau: string, params?: Record<string, string | number>) => string

export interface ContextPlantilla {
  t: Traductor
  lang: 'ca' | 'es'
  activitats: readonly ActivitatCataleg[]
  comarques: readonly string[]
}

/** Filas vacías con formato texto, para que lo que se escriba ahí no lo reinterprete Excel. */
const FILES_FORMATADES = 300

export const NOM_FULLA = { entitats: 'Entitats', instruccions: 'Instruccions', llistes: 'Llistes' } as const

/** Las columnas que salen en la plantilla, en su orden. */
export const COLUMNES_DE_PLANTILLA: readonly ColumnaPlantilla[] = COLUMNES_PLANTILLA.filter((c) => c.plantilla)

export const LLISTES: readonly Llista[] = ['rol', 'tipo_receptor', 'tipus_empresa', 'tipus_activitat', 'modalitats', 'comarca']

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

/** El fichero de la plantilla, listo para descargar. `null` si la librería no carga. */
export async function blobPlantilla(ctx: ContextPlantilla): Promise<Blob | null> {
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const fulles = dadesPlantilla(ctx).map((f) => ({
      sheet: f.nom,
      data: f.data,
      columns: f.amples.map((width) => ({ width })),
      stickyRowsCount: f.nom === NOM_FULLA.entitats ? 1 : undefined,
    }))
    return await writeXlsxFile(fulles).toBlob()
  } catch {
    return null
  }
}
