// La exportación de entidades a Excel (Plan 2 B3, 10-11-2026): el fichero tiene el formato de la
// plantilla del importador y, sobre todo, IDA Y VUELTA: una fila exportada, leída con el lector del
// importador (`llegeixFulla` + `normalitzaFila`), da exactamente la fila del contrato que
// corresponde a la ficha, sin avisos ni líneas de nota, INCLUIDOS «ID Redestina» y la fecha de alta
// (B4, 20270519100000: ahora se importan). Es lo que hace que reimportar lo exportado salga
// `sense_canvis` (el E2E lo comprueba contra la base).
//
// Filas SINTÉTICAS con la forma de `exportar_entitats()`. Ningún dato real.

import { describe, expect, it } from 'vitest'
import type Stream from 'node:stream'
import type { Blob as BlobNode } from 'node:buffer'
import { strFromU8, unzipSync } from 'fflate'
import readXlsxFile from 'read-excel-file/node'
import writeXlsxFile from 'write-excel-file/node'
import { lletraColumna } from '../src/lib/excelValidacions'
import {
  COLUMNES_EXTRA, dadesExportacio, enOrdre, FILES_BUIDES, filesAmbDesplegable, llibreExportacio, nomFitxerExportacio,
  valorsFila, type FilaExportacio,
} from '../src/lib/exportEntitats'
import { DICTS } from '../src/lib/i18n'
import {
  CAPCALERES_EXPORTACIO, COLUMNES_PLANTILLA, llegeixFulla, mapaCapcaleres, normalitzaFila, type ActivitatCataleg,
  type Cella, type FilaContracte, type Paper,
} from '../src/lib/importEntitats'
import { COLUMNES_DE_PLANTILLA, NOM_FULLA, validacionsPlantilla, type ContextPlantilla } from '../src/lib/plantillaEntitats'

const CATALEG: ActivitatCataleg[] = [
  { codi: 'productor_agricola', nom_ca: 'Productor agrícola', nom_es: 'Productor agrícola', aplica: 'productor' },
  { codi: 'majorista', nom_ca: 'Majorista', nom_es: 'Mayorista', aplica: 'ambdos' },
  { codi: 'menjador_social', nom_ca: 'Menjador social', nom_es: 'Comedor social', aplica: 'entidad' },
]

const fila = (f: Partial<FilaExportacio>): FilaExportacio => ({
  organizacion_id: '00000000-0000-4000-8000-000000000000', es_test: false, rols: ['productor'], nom_comercial: null,
  razon_social: null, nif: null, tipus_empresa: null, tipo_receptor: null, tipus_activitat: [], modalitats_interes: [],
  persona_contacte: null, email: null, email2: null, telefon: null, telefon2: null, direccion: null, codigo_postal: null,
  municipi: null, area_geografica: null, airtable_id: null, data_alta: null, estat_crm_productor: null,
  estat_crm_entidad: null, ...f,
})

/** Las tres formas de organización, con todo lo que la exportación saca. */
const FILES: FilaExportacio[] = [
  // Ofertant con todo: dos teléfonos (móvil delante), CP con cero, municipio con artículo, Airtable.
  fila({
    organizacion_id: '11111111-1111-4111-8111-111111111111', rols: ['productor'], nom_comercial: 'Hort de Prova',
    razon_social: 'Hort de Prova, SL', nif: 'B00000000', tipus_empresa: 'sl', tipus_activitat: ['productor_agricola', 'majorista'],
    persona_contacte: 'Anna Prova', email: 'anna@exemple.invalid', telefon: '34600000000', telefon2: '34930000000',
    direccion: 'Carrer Major, 1', codigo_postal: '08380', municipi: "l'Ametlla del Vallès", area_geografica: 'Vallès Oriental',
    airtable_id: 'recABC123', data_alta: '2026-07-30', estat_crm_productor: 'actiu',
  }),
  // Receptora social con modalidades y segundo correo; alta del Excel con solo el año.
  fila({
    organizacion_id: '22222222-2222-4222-8222-222222222222', rols: ['entidad'], nom_comercial: 'Menjador de Prova',
    nif: '65000772N', tipus_empresa: 'fundacio', tipo_receptor: 'social', tipus_activitat: ['menjador_social'],
    modalitats_interes: ['donacio', 'venda'], email: 'hola@exemple.invalid', email2: 'general@exemple.invalid',
    telefon: '34611111111', municipi: 'Mataró', area_geografica: 'Maresme', data_alta: '2021', estat_crm_entidad: 'potencial',
    // A5: confirmada, sale en palabras y vuelve como código.
    naturalesa: 'entitat_social',
  }),
  // Doble papel, actividades de los dos lados, sin NIF.
  fila({
    organizacion_id: '33333333-3333-4333-8333-333333333333', rols: ['productor', 'entidad'], nom_comercial: 'Cooperativa de Prova',
    tipus_empresa: 'cooperativa', tipo_receptor: 'transformador', tipus_activitat: ['majorista', 'menjador_social', 'productor_agricola'],
    modalitats_interes: ['maquila'], municipi: 'Olot', data_alta: '2026-11-02',
    estat_crm_productor: 'en_desenvolupament', estat_crm_entidad: 'inactiu',
  }),
]

/** Lo que el importador tiene que entender de cada fila exportada (escrito aparte, no derivado). */
const ESPERAT: { rols: Paper[]; contracte: Omit<FilaContracte, 'rols' | 'fila'> }[] = [
  { rols: ['productor'], contracte: {
    nom_comercial: 'Hort de Prova', razon_social: 'Hort de Prova, SL', nif: 'B00000000', tipus_empresa: 'sl',
    tipus_activitat: ['productor_agricola', 'majorista'], persona_contacte: 'Anna Prova', email: 'anna@exemple.invalid',
    telefon: '34600000000', telefon2: '34930000000', direccion: 'Carrer Major, 1', codigo_postal: '08380',
    municipi: "l'Ametlla del Vallès", area_geografica: 'Vallès Oriental', airtable_id: 'recABC123',
    redestina_id: '11111111-1111-4111-8111-111111111111', data_alta: '2026-07-30',
  } },
  { rols: ['entidad'], contracte: {
    nom_comercial: 'Menjador de Prova', nif: '65000772N', tipus_empresa: 'fundacio', tipo_receptor: 'social',
    tipus_activitat: ['menjador_social'], modalitats_interes: ['donacio', 'venda'], email: 'hola@exemple.invalid',
    email2: 'general@exemple.invalid', telefon: '34611111111', municipi: 'Mataró', area_geografica: 'Maresme',
    // Solo el año (lo que trajo el Excel del ARA): vuelve como año, no como fecha.
    redestina_id: '22222222-2222-4222-8222-222222222222', data_alta: '2021', naturalesa: 'entitat_social',
  } },
  { rols: ['productor', 'entidad'], contracte: {
    nom_comercial: 'Cooperativa de Prova', tipus_empresa: 'cooperativa', tipo_receptor: 'transformador',
    tipus_activitat: ['majorista', 'menjador_social', 'productor_agricola'], modalitats_interes: ['maquila'], municipi: 'Olot',
    redestina_id: '33333333-3333-4333-8333-333333333333', data_alta: '2026-11-02',
  } },
]

const tDe = (lang: 'ca' | 'es') => (k: string, p?: Record<string, string | number>) => {
  let s = DICTS[lang][k] ?? k
  for (const [x, v] of Object.entries(p ?? {})) s = s.replaceAll(`{${x}}`, String(v))
  return s
}
const ctxDe = (lang: 'ca' | 'es'): ContextPlantilla => ({
  t: tDe(lang), lang, activitats: CATALEG, comarques: ['Maresme', 'Garrotxa', 'Vallès Oriental'],
  municipis: ["l'Ametlla del Vallès", 'Mataró', 'Olot'],
})
const celles = (r: readonly unknown[]): Cella[] =>
  r.map((c) => (c && typeof c === 'object' && 'value' in c ? (c as { value: Cella }).value : c as Cella))

/** Lee una hoja «Entitats» con el lector del importador y comprueba la ida y vuelta. */
function comprovaIdaITornada(files: Cella[][]) {
  const m = mapaCapcaleres(files[0])
  expect(m.falten).toEqual([])
  expect(m.reconegudes.map((r) => r.clau)).toEqual(COLUMNES_DE_PLANTILLA.map((c) => c.clau))
  // Las dos informativas (estado CRM) se ignoran A PROPÓSITO (no «desconeguda»): la Revisió no las marca como errata.
  expect(m.ignorades.map((x) => [x.capcalera, x.motiu])).toEqual(COLUMNES_EXTRA.map((c) => [c.capcalera, 'a_proposit']))
  const fulla = llegeixFulla(files)
  expect(fulla.exemples).toBe(0)
  // Las filas vacías preparadas de detrás no cuentan como filas.
  expect(fulla.files.map((f) => f.numero)).toEqual(FILES.map((_, i) => i + 2))
  fulla.files.forEach((f, i) => {
    const n = normalitzaFila(f.numero, f.celles, fulla.mapa, { activitats: CATALEG })
    expect(n.rols, FILES[i].nom_comercial!).toEqual(ESPERAT[i].rols)
    expect(n.origenRols).toBe('columna')
    expect(n.avisosLocals, FILES[i].nom_comercial!).toEqual([])
    // Sin `nota`: ni las columnas de nota (vacías) ni líneas de aviso. Reimportar no toca el comentario.
    expect(n.contracte, FILES[i].nom_comercial!).toEqual({ fila: i + 2, ...ESPERAT[i].contracte })
  })
}

describe('la exportación tiene el formato de la plantilla', () => {
  const ctx = ctxDe('ca')
  const [entitats, instruccions, llistes] = dadesExportacio(FILES, ctx)

  it('las mismas columnas y en el mismo orden que la plantilla, y detrás las dos informativas', () => {
    const cap = celles(entitats.data[0] as unknown[])
    expect(cap.slice(0, COLUMNES_DE_PLANTILLA.length)).toEqual(COLUMNES_DE_PLANTILLA.map((c) => c.capcalera))
    expect(cap.slice(COLUMNES_DE_PLANTILLA.length)).toEqual(Object.values(CAPCALERES_EXPORTACIO))
    expect(entitats.amples).toHaveLength(cap.length)
    // Z el ID y AA la fecha (B3); A5 metió «Naturalesa» (columna de plantilla) en AB, así que el
    // estado CRM, informativo y leído por cabecera, pasa a AC y AD.
    const lletra = (h: string) => lletraColumna(cap.indexOf(h))
    expect(['ID Redestina', "Data d'alta a l'organització", 'Naturalesa', 'Estat CRM (ofertant)', 'Estat CRM (receptor)'].map(lletra))
      .toEqual(['Z', 'AA', 'AB', 'AC', 'AD'])
    // El uuid cabe.
    expect(entitats.amples[cap.indexOf('ID Redestina')]).toBe(38)
  })

  it('las columnas de nota salen vacías (reimportarlas duplicaría el comentario)', () => {
    const nota = COLUMNES_DE_PLANTILLA.map((c, i) => [c, i] as const).filter(([c]) => c.etiquetaNota)
    expect(nota.map(([c]) => c.clau)).toEqual(['carrec', 'web', 'treballadors', 'responsable', 'conveni_data', 'conveni_signant', 'observacions'])
    for (const r of entitats.data.slice(1)) {
      const v = celles(r as unknown[])
      for (const [c, i] of nota) expect(v[i] ?? null, c.clau).toBeNull()
    }
  })

  it('el ID Redestina, en texto; la fecha de alta, fecha de Excel (o texto si es un año); el estado CRM por papel, en palabras', () => {
    const extra = COLUMNES_DE_PLANTILLA.length
    const iId = COLUMNES_DE_PLANTILLA.findIndex((c) => c.clau === 'redestina_id')
    const iData = COLUMNES_DE_PLANTILLA.findIndex((c) => c.clau === 'data_alta')
    const f1 = entitats.data[1] as { value?: unknown; type?: unknown; format?: string }[]
    expect(f1[iId]).toMatchObject({ value: FILES[0].organizacion_id, format: '@' })
    expect(f1[iData]).toMatchObject({ value: new Date(Date.UTC(2026, 6, 30)), type: Date, format: 'dd/mm/yyyy' })
    expect(celles(f1).slice(extra)).toEqual(['Actiu', null])
    // Solo el año (lo que trajo el Excel del ARA): se queda como texto.
    const f2 = entitats.data[2] as { value?: unknown; format?: string }[]
    expect(f2[iData]).toMatchObject({ value: '2021', format: '@' })
    expect(celles(f2).slice(extra)).toEqual([null, 'Potencial'])
    expect(celles(entitats.data[3] as unknown[]).slice(extra)).toEqual(['En desenvolupament', 'Inactiu'])
    // Sin fecha: la celda vacía, en formato texto (lo que se escriba ahí no lo reinterpreta Excel).
    const [sense] = dadesExportacio([fila({ data_alta: null })], ctx)
    expect((sense.data[1] as { value?: unknown; format?: string }[])[iData]).toMatchObject({ value: undefined, format: '@' })
  })

  it('las columnas de NIF, CP, teléfonos e ID van en formato texto, también en las filas vacías de detrás', () => {
    for (const r of [entitats.data[1], entitats.data[entitats.data.length - 1]]) {
      const fila = r as { format?: string }[]
      // La fecha de alta completa es la excepción: va como fecha de Excel (`dd/mm/yyyy`, la prueba de arriba).
      COLUMNES_DE_PLANTILLA.forEach((c, i) => {
        if (c.text && !(c.clau === 'data_alta' && fila[i]?.format === 'dd/mm/yyyy')) expect(fila[i]?.format, c.capcalera).toBe('@')
      })
    }
    expect(entitats.data).toHaveLength(1 + FILES.length + FILES_BUIDES)
  })

  it('«Llistes» es la de la plantilla; «Instruccions» explica la exportación y las dos columnas de más', () => {
    expect(llistes.nom).toBe(NOM_FULLA.llistes)
    const textos = instruccions.data.flat().map((c) => (c && typeof c === 'object' && 'value' in c ? String(c.value) : String(c ?? '')))
    expect(textos.some((x) => x.startsWith('ex.') || x.startsWith('ie.'))).toBe(false)
    for (const c of [...COLUMNES_DE_PLANTILLA, ...COLUMNES_EXTRA]) expect(textos).toContain(c.capcalera)
    expect(textos).not.toContain(DICTS.ca['ie.pl_intro_1']) // la de «esborra la fila d'EXEMPLE» no aplica
    // B4: el ID y la fecha ya no son «informativas»: se explican como columnas que se importan.
    expect(textos).toContain(DICTS.ca['ie.h_redestina_id'])
    expect(textos).toContain(DICTS.ca['ie.h_data_alta'])
    expect(textos.filter((x) => x === DICTS.ca['ex.falta_informativa'])).toHaveLength(COLUMNES_EXTRA.length)
  })

  it('lo que no es un código conocido no sale (la reimportación lo mandaría al comentario)', () => {
    const v = valorsFila(fila({
      rols: ['productor'], tipus_empresa: 'Explotació hortícola', tipo_receptor: 'social',
      tipus_activitat: ['inventada', 'majorista'], modalitats_interes: ['donacio'],
    }), ctx)
    expect(v.tipus_empresa).toBeUndefined()
    expect(v.tipo_receptor).toBeUndefined() // un ofertant no tiene tipo de receptor
    expect(v.modalitats_interes).toBeUndefined() // ni modalidades
    expect(v.tipus_activitat).toBe('Majorista')
    expect(valorsFila(fila({ rols: ['entidad'], modalitats_interes: ['regal'] }), ctx).modalitats_interes).toBeUndefined()
  })
})

describe('ida y vuelta: lo exportado lo entiende el importador tal cual', () => {
  it.each(['ca', 'es'] as const)('en memoria (%s)', (lang) => {
    const [entitats] = dadesExportacio(FILES, ctxDe(lang))
    comprovaIdaITornada(entitats.data.map((r) => celles(r as unknown[])))
  })

  it.each(['ca', 'es'] as const)('como fichero .xlsx de verdad, con los desplegables (%s)', async (lang) => {
    const ctx = ctxDe(lang)
    const { fulles, feature } = llibreExportacio<Stream | Buffer | BlobNode>(FILES, ctx)
    const buffer = await writeXlsxFile(fulles, { features: [feature] }).toBuffer()
    const [entitats, , llistes] = await readXlsxFile(buffer)
    expect(llistes.sheet).toBe(NOM_FULLA.llistes)
    comprovaIdaITornada(entitats.data.map((r) => r.map((c) => c as Cella)))
    // La fecha de alta vuelve como fecha (y `valorData` la lee): el 30-07-2026, sin correrse un día.
    const iData = COLUMNES_DE_PLANTILLA.findIndex((c) => c.clau === 'data_alta')
    expect(entitats.data[1][iData]).toEqual(new Date(Date.UTC(2026, 6, 30)))
    expect(entitats.data[2][iData]).toBe('2021')

    // Los mismos desplegables que la plantilla, en todas las filas con datos y en las vacías.
    const xml = strFromU8(unzipSync(new Uint8Array(buffer))['xl/worksheets/sheet1.xml'])
    const { primeraFila, ultimaFila } = filesAmbDesplegable(FILES.length)
    expect([primeraFila, ultimaFila]).toEqual([2, 1 + FILES.length + FILES_BUIDES])
    const v = validacionsPlantilla(ctx)
    expect(v).toHaveLength(7)
    expect(xml.split('<dataValidation ').length - 1).toBe(v.length)
    expect(xml.indexOf('<dataValidations ')).toBeGreaterThan(xml.indexOf('</sheetData>'))
    for (const x of v) {
      const c = lletraColumna(x.columna)
      expect(xml).toContain(`sqref="${c}${primeraFila}:${c}${ultimaFila}"`)
    }
  })
})

describe('utilidades', () => {
  it('el nombre del fichero lleva la fecha', () => {
    expect(nomFitxerExportacio('2026-11-10')).toBe('entitats-2026-11-10.xlsx')
  })

  it('las filas salen en el orden de la pantalla y solo las pedidas', () => {
    const ids = [FILES[2].organizacion_id, 'no-hi-es', FILES[0].organizacion_id]
    expect(enOrdre(FILES, ids).map((f) => f.nom_comercial)).toEqual(['Cooperativa de Prova', 'Hort de Prova'])
    expect(enOrdre(FILES, null)).toEqual(FILES)
  })

  it('las cabeceras informativas no chocan con ninguna columna de la plantilla', () => {
    const totes = COLUMNES_PLANTILLA.flatMap((c) => [c.capcalera, ...c.alias]).map((h) => h.toLowerCase())
    for (const h of Object.values(CAPCALERES_EXPORTACIO)) expect(totes).not.toContain(h.toLowerCase())
  })

  it.each(['ca', 'es'] as const)('las claves de la exportación existen (%s)', (lang) => {
    const claus = [
      'el.export_excel', 'el.export_excel_err', 'el.export_excel_buit', 'el.export_excel_ok', 'el.export_excel_ok_1',
      'el.export_excel_massa', 'ex.pl_titol', 'ex.pl_intro_1', 'ex.pl_intro_2', 'ex.pl_intro_5', 'ex.falta_informativa',
      ...COLUMNES_EXTRA.map((c) => `ex.h_${c.clau}`),
    ]
    expect(claus.filter((k) => DICTS[lang][k] === undefined)).toEqual([])
  })
})
