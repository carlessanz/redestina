// Las modalidades en plural (05-10-2026, D2). Hay DOS copias del módulo —la de las Edge
// Functions y la del navegador— y tienen que decir lo mismo: el orden canónico decide cuál
// es la «principal» que se escribe en `excedentes.modalitat`, y si divergieran el panel
// enseñaría una modalidad principal distinta de la que guarda el servidor.

import { describe, expect, it } from 'vitest'
import * as srv from '../supabase/functions/_shared/modalitats.ts'
import * as web from '../src/lib/modalitats'

describe('modalitats · las dos copias dicen lo mismo', () => {
  it('mismo vocabulario y mismo orden canónico', () => {
    expect([...web.MODALITATS_IDS]).toEqual([...srv.MODALITATS_IDS])
  })
  const casos: unknown[] = [
    'donacio', ['venda', 'donacio'], 'totes', ['totes'], ['maquila', 'maquila'], '', null,
    ['VENDA', ' maquila '], ['xyz', 'venda'], undefined,
  ]
  for (const c of casos) {
    it(`modalitatsDe(${JSON.stringify(c)})`, () => {
      expect(web.modalitatsDe(c)).toEqual(srv.modalitatsDe(c))
    })
  }
})

describe('modalitats · servidor', () => {
  it('ordena en canónico, sin repetidos, y descarta lo desconocido', () => {
    expect(srv.modalitatsDe(['maquila', 'donacio', 'maquila', 'xx'])).toEqual(['donacio', 'maquila'])
  })
  it('«totes» son las tres', () => {
    expect(srv.modalitatsDe('totes')).toEqual(['donacio', 'venda', 'maquila'])
  })
  it('la principal es la donación si está', () => {
    expect(srv.principal(['venda', 'donacio'])).toBe('donacio')
    expect(srv.principal(['maquila', 'venda'])).toBe('venda')
    expect(srv.principal([])).toBeNull()
  })
  it('etiqueta legible', () => {
    expect(srv.etiquetaModalitats(['donacio'])).toBe('Donació')
    expect(srv.etiquetaModalitats(['venda', 'donacio'])).toBe('Donació o venda')
    expect(srv.etiquetaModalitats(['donacio', 'venda', 'maquila'])).toBe('Donació, venda o maquila')
  })
  it('precio solo si hay venta o maquila', () => {
    expect(srv.ambPreu(['donacio'])).toBe(false)
    expect(srv.ambPreu(['donacio', 'maquila'])).toBe(true)
  })
})

describe('modalitats · navegador', () => {
  const t = (k: string) => ({ 'od.mod_donacio': 'Donació', 'od.mod_venda': 'Venda', 'od.mod_maquila': 'Maquila', 'mod.o': 'o' } as Record<string, string>)[k] ?? k
  it('modalitatsOferta prefiere la lista y cae a la única', () => {
    expect(web.modalitatsOferta({ modalitat: 'venda', modalitats: ['donacio', 'venda'] })).toEqual(['donacio', 'venda'])
    expect(web.modalitatsOferta({ modalitat: 'venda', modalitats: null })).toEqual(['venda'])
    expect(web.modalitatsOferta({ modalitat: 'venda', modalitats: [] })).toEqual(['venda'])
    expect(web.modalitatsOferta({ modalitat: null })).toEqual([])
  })
  it('textModalitats', () => {
    expect(web.textModalitats(['donacio', 'venda', 'maquila'], t)).toBe('Donació, venda o maquila')
    expect(web.textModalitats(['venda'], t)).toBe('Venda')
    expect(web.textModalitats([], t)).toBe('')
  })
})
