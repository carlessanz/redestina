// «Interaccions i seguiment» (proceso 1.2): la lógica pura de `/equip/interaccions`
// (`src/lib/interaccions.ts`) y su paridad con la RPC de lectura (20270616100100).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ESTATS_SEGUIMENT_FILTRE, VISTES_INTERACCIONS, ambFiltresInteraccions, argsFiltresInteraccions,
  classeEstatSeguiment, clauBuit, clauErrorInteraccions, clauEstatSeguiment, clauTipus, clauVista, esCodiIne,
  llegeixFilaInteraccio, llegeixOpcionsInteraccions, llegeixPaginaInteraccions, llegeixVista, opcionsZona,
  rangInvertitInteraccions, rutaFitxaInteraccions, textZona,
} from '../src/lib/interaccions'
import { TIPUS_NOTA_LLEGITS } from '../src/lib/notesInternes'
import { DICTS } from '../src/lib/i18n'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const UUID = '0b0b0b0b-1111-4222-8333-444455556666'

describe('la vista de la URL', () => {
  it('por defecto, pendents; lo que no existe, también', () => {
    expect(llegeixVista(null)).toBe('pendents')
    expect(llegeixVista('xyz')).toBe('pendents')
    expect(llegeixVista('historial')).toBe('historial')
    expect(llegeixVista('previsions')).toBe('previsions')
  })

  it('la ficha se abre en «Gestió interna»', () => {
    expect(rutaFitxaInteraccions(UUID)).toBe(`/equip/entitats/${UUID}?pestanya=intern`)
  })
})

describe('argsFiltresInteraccions', () => {
  const buits = { valors: {}, desDe: '', finsA: '', cerca: '' }

  it('sin nada, todo null y sin filtros', () => {
    const a = argsFiltresInteraccions(buits)
    expect(Object.values(a).every((x) => x === null)).toBe(true)
    expect(ambFiltresInteraccions(a)).toBe(false)
  })

  it('pasa los valores válidos', () => {
    const a = argsFiltresInteraccions({
      valors: {
        entitat: UUID, zona: 'Baix Llobregat', tipus: 'prospeccio', responsable: UUID, producte: 'Tomàquet',
        estat: 'vencut', prev_desde: '2026-12-01', prev_hasta: '2026-12-31',
      },
      desDe: '2026-11-01', finsA: '2026-11-30', cerca: '  trucada ',
    })
    expect(a).toEqual({
      p_desde: '2026-11-01', p_hasta: '2026-11-30', p_org: UUID, p_zona: 'Baix Llobregat', p_tipus: 'prospeccio',
      p_responsable: UUID, p_producte: 'Tomàquet', p_prev_desde: '2026-12-01', p_prev_hasta: '2026-12-31',
      p_estat: 'vencut', p_cerca: 'trucada',
    })
    expect(ambFiltresInteraccions(a)).toBe(true)
  })

  it('lo que no vale no llega a la base', () => {
    const a = argsFiltresInteraccions({
      valors: { entitat: 'no-uuid', tipus: 'visita', estat: 'obert', responsable: 'x', prev_desde: '2026-02-31' },
      desDe: '31/12/2026', finsA: '', cerca: '   ',
    })
    expect([a.p_org, a.p_tipus, a.p_estat, a.p_responsable, a.p_prev_desde, a.p_desde, a.p_cerca])
      .toEqual([null, null, null, null, null, null, null])
  })

  it('el tipo heredado se puede filtrar', () => {
    expect(argsFiltresInteraccions({ ...buits, valors: { tipus: 'seguiment' } }).p_tipus).toBe('seguiment')
  })
})

describe('rangInvertitInteraccions', () => {
  const nul = { p_desde: null, p_hasta: null, p_prev_desde: null, p_prev_hasta: null }
  it('cualquiera de los dos rangos al revés', () => {
    expect(rangInvertitInteraccions(nul)).toBe(false)
    expect(rangInvertitInteraccions({ ...nul, p_desde: '2026-11-02', p_hasta: '2026-11-01' })).toBe(true)
    expect(rangInvertitInteraccions({ ...nul, p_prev_desde: '2026-12-02', p_prev_hasta: '2026-12-01' })).toBe(true)
    expect(rangInvertitInteraccions({ ...nul, p_desde: '2026-11-01', p_hasta: '2026-11-01' })).toBe(false)
  })

  it('el error de la RPC tiene su texto', () => {
    expect(clauErrorInteraccions('rang_invertit: la data inicial…')).toBe('ixs.err_rang')
    expect(clauErrorInteraccions('lo que sea')).toBe('c.load_error')
  })
})

describe('«Municipi o zona»', () => {
  const o = { responsables: [], productes: [], zones: ['Baix Llobregat', 'Maresme'], municipis: [{ ine: '08101', nom: 'l’Hospitalet de Llobregat' }] }
  it('comarcas y municipios (por INE) en un solo filtro', () => {
    expect(opcionsZona(o)).toEqual(['Baix Llobregat', 'Maresme', '08101'])
    expect(textZona('08101', o)).toBe('l’Hospitalet de Llobregat')
    expect(textZona('Maresme', o)).toBe('Maresme')
    expect(esCodiIne('08101')).toBe(true)
    expect(esCodiIne('Maresme')).toBe(false)
  })
})

describe('lectura defensiva', () => {
  it('una fila con numéricos en texto y estado raro', () => {
    const f = llegeixFilaInteraccio({ id: 'a', organizacion_id: 'o', tipus: 'operativa', estat_seguiment: 'xyz', previsio_kg: '12.5', text: 'hola' })
    expect(f.previsio_kg).toBe(12.5)
    expect(f.estat_seguiment).toBe('sense')
    expect(f.organitzacio).toBeNull()
  })

  it('la página y las opciones', () => {
    const p = llegeixPaginaInteraccions({ total: '3', files: [{ id: 'a' }] })
    expect(p.total).toBe(3)
    expect(p.files).toHaveLength(1)
    expect(llegeixPaginaInteraccions(null)).toEqual({ total: 0, files: [] })
    const o = llegeixOpcionsInteraccions({
      responsables: [{ id: 'r1', nom: 'Anna' }, { nom: 'sense id' }], productes: ['Poma', '', 3],
      zones: ['Maresme'], municipis: [{ ine: '08101', nom: null }],
    })
    expect(o).toEqual({
      responsables: [{ id: 'r1', nom: 'Anna' }], productes: ['Poma'], zones: ['Maresme'], municipis: [{ ine: '08101', nom: '08101' }],
    })
  })
})

describe('las etiquetas existen en los dos idiomas', () => {
  const claus = [
    ...VISTES_INTERACCIONS.map(clauVista), ...VISTES_INTERACCIONS.map(clauBuit),
    ...TIPUS_NOTA_LLEGITS.map(clauTipus), ...ESTATS_SEGUIMENT_FILTRE.map(clauEstatSeguiment),
    clauTipus('visita'),
  ]
  it.each(claus)('%s', (k) => {
    expect(DICTS.ca[k]).toBeTruthy()
    expect(DICTS.es[k]).toBeTruthy()
  })

  it('vencido en `aviso`, hecho en `exito` (solo tokens)', () => {
    expect(classeEstatSeguiment('vencut')).toContain('aviso')
    expect(classeEstatSeguiment('fet')).toContain('exito')
  })
})

describe('paridad con la RPC de lectura (20270616100100)', () => {
  const sql = readFileSync(join(RAIZ, 'supabase/migrations/20270616100100_interaccions_llistat.sql'), 'utf-8')
  it('las vistas, los estados y los tipos', () => {
    expect(sql).toContain(`p_vista not in (${VISTES_INTERACCIONS.map((v) => `'${v}'`).join(', ')})`)
    expect(sql).toContain(`p_estat not in (${ESTATS_SEGUIMENT_FILTRE.map((v) => `'${v}'`).join(', ')})`)
    expect(sql).toContain(`p_tipus not in (${TIPUS_NOTA_LLEGITS.map((v) => `'${v}'`).join(', ')})`)
  })
})
