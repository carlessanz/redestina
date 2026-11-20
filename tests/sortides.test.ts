// «Entrades i sortides» (punto 6.7): la lógica pura de `src/lib/sortides.ts`.
//
// Lo que se vigila: que los filtros de la barra lleguen a las RPC como espera la base (vacío →
// null, y nada inválido que diera un `22023`), que todas las etiquetas existan en los dos idiomas,
// que lo que devuelven las RPC se lea aunque los `numeric` lleguen como texto, y que el Excel
// tenga sus columnas, fechas como fecha y números como número.

import { describe, expect, it } from 'vitest'
import { DICTS } from '../src/lib/i18n'
import {
  AGRUPACIONS_SORTIDES, COLUMNES_SORTIDES, ESTATS_SORTIDA, MODALITATS_SORTIDA,
  ambFiltres, argsFiltres, cellaDia, classeEstat, clauAgrupacio, clauError, clauEstat, clauModalitat,
  clauModalitatCurta, diaValid, filaExcel, fullaResum, fullaSortides, llegeixAgrupacio, llegeixEntrades,
  llegeixFila, llegeixPestanyaSortides, llegeixResum, llibreSortides, nomFitxerSortides, opcionsDeGrups,
  rangInvertit, resumBuit, textDia, textGrup, textMes,
} from '../src/lib/sortides'
import type { FilaSortida } from '../src/types'

/** Un `t()` como el de la interfaz, sobre los diccionarios reales. */
function tDe(lang: 'ca' | 'es') {
  return (clau: string, params?: Record<string, string | number>) => {
    let s = DICTS[lang][clau] ?? DICTS.ca[clau] ?? clau
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
}
const t = tDe('ca')

const UUID = '75eb2254-32c9-472a-91f5-22e0e6a758cd'
const UUID2 = 'd87f0de1-e6b1-4d91-9a4a-c7cd4cf0409c'

const FILA: FilaSortida = {
  canalizacion_id: 'c1', excedente_id: 'e1', id_excedente: 'E-261119-ABC-001-1', espigolada_id: null,
  created_at: '2026-11-19T17:45:32+00:00', data_sortida: '2026-11-19',
  productor_id: UUID, productor_nom: 'Ofertant de prova', productor_org: 'o1',
  entidad_id: UUID2, entidad_nom: 'Banc de prova', entidad_org: 'o2',
  producto: 'Pastanaga', variedad: 'Nantesa', kg_sortida: 40, kg_recollits: 38,
  modalitat: 'donacio', estat: 'conciliada', causa_codigo: 'C1',
  municipi: 'Gavà', municipi_ine: '08089', zona: 'Baix Llobregat',
  caixes_entregades: 3, caixes_retornades: 2, preu_kg: 0.5, valor: 19,
  albara_ent: { id: 'a1', tipo: 'ENT', numero: 'ENT-2026-00014', estado: 'conciliado' },
  albara_rec: { id: 'a2', tipo: 'REC', numero: 'REC-2026-00012', estado: 'conciliado' },
}

describe('filtros → argumentos de las RPC', () => {
  it('sin nada puesto, los nueve a null', () => {
    const a = argsFiltres({ valors: {}, desDe: '', finsA: '', cerca: '   ' })
    expect(a).toEqual({
      p_desde: null, p_hasta: null, p_productor: null, p_entidad: null, p_producto: null,
      p_zona: null, p_modalitat: null, p_estat: null, p_cerca: null,
    })
    expect(ambFiltres(a)).toBe(false)
  })

  it('cada dimensión va a su argumento', () => {
    const a = argsFiltres({
      valors: { ofertant: UUID, receptor: UUID2, producte: 'Pera', zona: 'Baix Llobregat', modalitat: 'venda', estat: 'anulada' },
      desDe: '2026-01-01', finsA: '2026-12-31', cerca: ' pera ',
    })
    expect(a).toEqual({
      p_desde: '2026-01-01', p_hasta: '2026-12-31', p_productor: UUID, p_entidad: UUID2, p_producto: 'Pera',
      p_zona: 'Baix Llobregat', p_modalitat: 'venda', p_estat: 'anulada', p_cerca: 'pera',
    })
    expect(ambFiltres(a)).toBe(true)
  })

  it('lo que no vale no llega a la base (un filtro viejo del localStorage)', () => {
    const a = argsFiltres({
      valors: { ofertant: 'no-es-uuid', receptor: '', modalitat: 'regal', estat: 'perduda', producte: '  ' },
      desDe: '2026-02-31', finsA: '31/12/2026', cerca: '',
    })
    expect(a.p_productor).toBeNull()
    expect(a.p_entidad).toBeNull()
    expect(a.p_modalitat).toBeNull()
    expect(a.p_estat).toBeNull()
    expect(a.p_producto).toBeNull()
    expect(a.p_desde).toBeNull()
    expect(a.p_hasta).toBeNull()
  })

  it('las cuatro modalidades y los siete estados pasan', () => {
    for (const m of MODALITATS_SORTIDA) expect(argsFiltres({ valors: { modalitat: m }, desDe: '', finsA: '', cerca: '' }).p_modalitat).toBe(m)
    for (const e of ESTATS_SORTIDA) expect(argsFiltres({ valors: { estat: e }, desDe: '', finsA: '', cerca: '' }).p_estat).toBe(e)
  })

  it('el rango al revés se detecta antes de preguntar', () => {
    expect(rangInvertit({ p_desde: '2026-12-01', p_hasta: '2026-01-01' })).toBe(true)
    expect(rangInvertit({ p_desde: '2026-01-01', p_hasta: '2026-01-01' })).toBe(false)
    expect(rangInvertit({ p_desde: null, p_hasta: '2026-01-01' })).toBe(false)
  })

  it('el error de periodo tiene su mensaje; el resto, el genérico', () => {
    expect(clauError('periode_invalid: la data inicial es posterior a la final')).toBe('sort.err_periode')
    expect(clauError('limit_invalid: entre 1 i 1000')).toBe('c.load_error')
    expect(clauError(null)).toBe('c.load_error')
  })

  it('días: los que existen, y en pantalla sin pasar por Date', () => {
    expect(diaValid('2024-02-29')).toBe('2024-02-29')
    expect(diaValid('2026-02-29')).toBeNull()
    expect(diaValid('')).toBeNull()
    expect(textDia('2026-11-22')).toBe('22/11/2026')
    expect(textDia(null)).toBe('—')
  })
})

describe('la URL', () => {
  it('pestaña: sortides por defecto', () => {
    expect(llegeixPestanyaSortides(null)).toBe('sortides')
    expect(llegeixPestanyaSortides('resum')).toBe('resum')
    expect(llegeixPestanyaSortides('altra')).toBe('sortides')
  })
  it('agrupación: modalidad por defecto, y las siete', () => {
    expect(llegeixAgrupacio(null)).toBe('modalitat')
    expect(llegeixAgrupacio('xx')).toBe('modalitat')
    for (const a of AGRUPACIONS_SORTIDES) expect(llegeixAgrupacio(a)).toBe(a)
  })
})

describe('etiquetas', () => {
  it.each(['ca', 'es'] as const)('todas las claves existen en %s', (lang) => {
    const claus = [
      ...MODALITATS_SORTIDA.map(clauModalitat),
      ...MODALITATS_SORTIDA.map(clauModalitatCurta),
      ...ESTATS_SORTIDA.map(clauEstat),
      ...AGRUPACIONS_SORTIDES.map(clauAgrupacio),
      ...COLUMNES_SORTIDES.map((c) => c.capcalera),
      'sort.sense_ofertant', 'sort.sense_receptor', 'sort.sense_producte', 'sort.sense_zona', 'sort.sense_data',
      'sort.full_sortides', 'sort.full_resum', 'sort.total', 'sort.desconegut', 'sort.err_periode',
    ]
    const falten = claus.filter((c) => DICTS[lang][c] === undefined)
    expect(falten).toEqual([])
  })

  it('las modalidades se leen como en la interfaz', () => {
    expect(t(clauModalitat('maquila'))).toBe('Transformació en obrador (maquila)')
    expect(t(clauModalitat('espigolada'))).toBe('Espigolada – Donació')
    expect(tDe('es')(clauModalitat('espigolada'))).toBe('Espigueo – Donación')
    expect(clauModalitat('x')).toBe('sort.desconegut')
  })

  it('pendent y programada se distinguen (son dos opciones del filtro)', () => {
    const textos = ESTATS_SORTIDA.map((e) => t(clauEstat(e)))
    expect(new Set(textos).size).toBe(ESTATS_SORTIDA.length)
  })

  it('el badge del estado solo usa tokens del proyecto', () => {
    for (const e of ESTATS_SORTIDA) expect(classeEstat(e)).not.toMatch(/#|\[|-(red|green|amber|yellow|gray|slate)-/)
  })

  it('mes: nombre y año según el idioma', () => {
    expect(textMes('2026-11', t)).toBe('novembre 2026')
    expect(textMes('2026-11', tDe('es'))).toBe('noviembre 2026')
    expect(textMes('2026-13', t)).toBeNull()
    expect(textMes(null, t)).toBeNull()
  })

  it('grupo: nombre, traducción o «Sense …»', () => {
    expect(textGrup('ofertant', { clau: UUID, etiqueta: 'Ofertant de prova' }, t)).toBe('Ofertant de prova')
    expect(textGrup('zona', { clau: null, etiqueta: null }, t)).toBe('Sense zona')
    expect(textGrup('producte', { clau: null, etiqueta: null }, t)).toBe('Sense producte')
    expect(textGrup('receptor', { clau: null, etiqueta: null }, tDe('es'))).toBe('Sin entidad receptora')
    expect(textGrup('modalitat', { clau: 'venda', etiqueta: 'venda' }, t)).toBe('Venda')
    expect(textGrup('estat', { clau: 'conciliada', etiqueta: 'conciliada' }, t)).toBe(t('op.estat_conciliada'))
    expect(textGrup('mes', { clau: '2026-01', etiqueta: '2026-01' }, t)).toBe('gener 2026')
  })
})

describe('opciones de los filtros', () => {
  it('por nombre, sin los grupos sin clave', () => {
    const o = opcionsDeGrups([
      { clau: 'b', etiqueta: 'Zeta' },
      { clau: null, etiqueta: null },
      { clau: 'a', etiqueta: 'Àlaba' },
      { clau: 'c', etiqueta: null },
    ])
    expect(o.valors).toEqual(['a', 'c', 'b'])
    expect(o.noms).toEqual({ a: 'Àlaba', b: 'Zeta', c: 'c' })
  })
})

describe('lectura de las RPC', () => {
  it('los numeric como texto se leen como número; lo que falta, null', () => {
    const f = llegeixFila({ ...FILA, kg_sortida: '80', kg_recollits: null, valor: '19.00', albara_rec: null, modalitat: 'raro' })
    expect(f.kg_sortida).toBe(80)
    expect(f.kg_recollits).toBeNull()
    expect(f.valor).toBe(19)
    expect(f.albara_rec).toBeNull()
    expect(f.modalitat).toBe('donacio')
  })

  it('la página y sus totales', () => {
    const r = llegeixEntrades({ total: '22', kg_sortida: '2720', kg_recollits: '2346.00', files: [FILA] })
    expect(r).toMatchObject({ total: 22, kg_sortida: 2720, kg_recollits: 2346 })
    expect(r.files).toHaveLength(1)
    expect(llegeixEntrades(null)).toEqual({ total: 0, kg_sortida: 0, kg_recollits: 0, files: [] })
  })

  it('el resumen, con las cuatro modalidades siempre', () => {
    const r = llegeixResum({
      total: { sortides: 3, kg_sortida: '100', kg_recollits: 90, ofertants: 1, receptors: 2, espigolades: 0,
        per_modalitat: { donacio: { sortides: 3, kg_sortida: 100, kg_recollits: '90' } } },
      grups: [{ clau: 'donacio', etiqueta: 'donacio', sortides: 3, kg_sortida: 100, kg_recollits: 90 }],
    })
    expect(r.total.kg_sortida).toBe(100)
    expect(r.total.per_modalitat.donacio.kg_recollits).toBe(90)
    expect(r.total.per_modalitat.maquila).toEqual({ sortides: 0, kg_sortida: 0, kg_recollits: 0 })
    expect(r.grups[0].clau).toBe('donacio')
    expect(resumBuit().grups).toEqual([])
  })
})

describe('Excel', () => {
  it('nombre del fichero', () => {
    expect(nomFitxerSortides('2026-11-20')).toBe('entrades-sortides-2026-11-20.xlsx')
  })

  it('la hoja «Sortides»: diecinueve columnas en el orden pedido', () => {
    const fulla = fullaSortides([FILA], t)
    const cap = fulla[0].map((c) => (c as { value: string }).value)
    expect(cap).toEqual([
      'Data de sortida', 'Núm. oferta', 'Entitat productora', 'Producte', 'Varietat', 'Entitat receptora',
      'Kg de sortida', 'Kg recollits', 'Modalitat', 'Estat', 'Causa', 'Municipi', 'Zona',
      'Caixes entregades', 'Caixes retornades', '€/kg', 'Valor (€)', 'Albarà d’entrega', 'Albarà de recepció',
    ])
    expect(fulla).toHaveLength(2)
  })

  it('fechas como fecha, números como número y vacíos como vacíos', () => {
    const fila = filaExcel({ ...FILA, kg_recollits: null, variedad: null }, t)
    const data = fila[0] as { value: Date; type: unknown; format: string }
    expect(data.type).toBe(Date)
    expect(data.value.toISOString().slice(0, 10)).toBe('2026-11-19')
    expect(data.format).toBe('dd/mm/yyyy')
    expect(fila[6]).toMatchObject({ value: 40, type: Number })
    expect(fila[7]).toBeNull()
    expect(fila[4]).toBeNull()
    expect(fila[8]).toEqual({ value: 'Donació' })
    expect(fila[17]).toEqual({ value: 'ENT-2026-00014' })
    expect(fila[18]).toEqual({ value: 'REC-2026-00012' })
    expect(cellaDia('no')).toEqual({ value: 'no' })
  })

  it('la hoja «Resum»: grupo, cifras, kilos por modalidad y la fila del total', () => {
    const resum = llegeixResum({
      total: { sortides: 2, kg_sortida: 60, kg_recollits: 50, ofertants: 1, receptors: 1, espigolades: 0,
        per_modalitat: { donacio: { sortides: 2, kg_sortida: 60, kg_recollits: 50 } } },
      grups: [{ clau: '2026-11', etiqueta: '2026-11', sortides: 2, kg_sortida: 60, kg_recollits: 50,
        per_modalitat: { donacio: { sortides: 2, kg_sortida: 60, kg_recollits: 50 } } }],
    })
    const fulla = fullaResum(resum, 'mes', t)
    expect(fulla).toHaveLength(3)
    expect((fulla[0][0] as { value: string }).value).toBe('Mes')
    expect((fulla[0][7] as { value: string }).value).toBe('Kg recollits · Donació')
    expect((fulla[1][0] as { value: string }).value).toBe('novembre 2026')
    expect(fulla[1][7]).toMatchObject({ value: 50, type: Number })
    expect((fulla[2][0] as { value: string }).value).toBe('Total')
    expect(fulla[0]).toHaveLength(11)
  })

  it('el libro: dos hojas con nombre traducido', () => {
    const llibre = llibreSortides([FILA], resumBuit(), 'modalitat', tDe('es'))
    expect(llibre.map((f) => f.sheet)).toEqual(['Salidas', 'Resumen'])
    expect(llibre[0].columns).toHaveLength(COLUMNES_SORTIDES.length)
  })
})
