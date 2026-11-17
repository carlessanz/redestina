// El catálogo de CAUSAS y SUBCAUSAS (fase B del punto 3, fila 3.6; `20270529100000`):
// `_shared/causes.ts` (servidor, intake y panel) y `src/lib/causes.ts` (el selector agrupado).
//
// Lo que se vigila: (1) el catálogo de la migración = el de la Fundació (7 categorías, 20
// subcausas, nombres ca/es) y las 8 de antes, inactivas; (2) lo que sirve el descriptor (solo
// activas, en orden, con sus subcausas); (3) la lista de WhatsApp cabe en una fila de lista (24/72);
// (4) la validación de la subcausa del panel; (5) el texto de la oferta «Categoria — Subcausa» y la
// edición; (6) las opciones agrupadas del desplegable.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CAUSES_WHATSAPP, MAX_DESC_FILA, MAX_TITOL_FILA, agrupaCauses, filesCausaWhatsApp, motiuSubcausa, textCausa,
  trobaSubcausa, type FilaCausa, type FilaSubcausa,
} from '../supabase/functions/_shared/causes.ts'
import { MAX_DESC_FILA_LISTA, MAX_TITULO_FILA_LISTA } from '../supabase/functions/_shared/camposOferta.ts'
import { canvisOferta, componerTextoOferta } from '../supabase/functions/_shared/oferta.ts'

// `lib/causes` importa el cliente de Supabase; aquí solo interesan sus funciones puras.
vi.mock('../src/lib/supabase', () => ({ supabase: {}, supabaseUrl: '' }))
import {
  catalegDelDescriptor, esSubcausaTriable, opcionsSubcausa, teSubcauses, textSubcausa,
} from '../src/lib/causes'

const MIGRACIO = readFileSync('supabase/migrations/20270529100000_causes_subcauses.sql', 'utf8')

/** Las filas `(…)` de un `insert into public.<taula>` de la migración. */
function filesInsert(taula: string): string[][] {
  const i = MIGRACIO.indexOf(`insert into public.${taula}`)
  expect(i, taula).toBeGreaterThan(-1)
  const valors = MIGRACIO.slice(MIGRACIO.indexOf(' values', i), MIGRACIO.indexOf('on conflict', i))
  // Cada fila es un `( … )` con literales entre comillas simples ('' = una comilla), números y booleanos.
  return [...valors.matchAll(/\(((?:'(?:[^']|'')*'|[^()'])*)\)/g)].map((m) =>
    [...m[1].matchAll(/'((?:[^']|'')*)'|(\w+)/g)]
      .map((x) => (x[1] !== undefined ? x[1].replace(/''/g, "'") : x[2])))
}

const CAUSES_MIG = filesInsert('causas')
const SUBCAUSES_MIG = filesInsert('subcausas')

const FILES_CAUSA: FilaCausa[] = [
  ...CAUSES_MIG.map(([codigo, nombre, nombre_es, activa, orden]) => ({
    codigo, nombre, nombre_es, activa: activa === 'true', orden: Number(orden),
  })),
  { codigo: 'EX', nombre: 'Excedent', nombre_es: 'Excedente', activa: false, orden: null },
  { codigo: 'CE', nombre: 'Criteris Estètics', nombre_es: 'Criterios estéticos', activa: false, orden: null },
]
const FILES_SUBCAUSA: FilaSubcausa[] = SUBCAUSES_MIG.map(([codigo, causa_codigo, nombre, nombre_es, orden]) => ({
  codigo, causa_codigo, nombre, nombre_es, orden: Number(orden), activa: true,
}))

describe('el catálogo de la migración = el de la Fundació (fila 3.6)', () => {
  it('7 categorías activas C1…C7, en orden, con nombre ca y es', () => {
    expect(CAUSES_MIG.map((f) => f[0])).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'])
    expect(CAUSES_MIG.map((f) => f[4])).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(CAUSES_MIG.every((f) => f[3] === 'true' && f[1] && f[2])).toBe(true)
    expect(CAUSES_MIG[1].slice(1, 3)).toEqual(['Demanda i comercialització', 'Demanda y comercialización'])
  })

  it('20 subcausas C<n>.<m>, cada una de su categoría, ordenadas dentro de ella', () => {
    expect(SUBCAUSES_MIG).toHaveLength(20)
    for (const [codigo, causa, nombre, nombre_es] of SUBCAUSES_MIG) {
      expect(codigo.startsWith(`${causa}.`), codigo).toBe(true)
      expect(nombre && nombre_es, codigo).toBeTruthy()
      // Sentencia: primera letra en mayúscula, el resto como se escribe.
      expect(nombre[0], codigo).toBe(nombre[0].toUpperCase())
    }
    expect(SUBCAUSES_MIG.filter((f) => f[1] === 'C3').map((f) => f[0])).toEqual(['C3.1', 'C3.2'])
    expect(SUBCAUSES_MIG.find((f) => f[0] === 'C6.2')?.[2]).toBe("Manca d'espai d'emmagatzematge")
  })

  it('las 8 de antes quedan inactivas, sin borrarse (Excedent, Canalització y Maquila dejan de ser causas)', () => {
    const i = MIGRACIO.indexOf('update public.causas\n   set activa = false')
    expect(i).toBeGreaterThan(-1)
    const tros = MIGRACIO.slice(i, MIGRACIO.indexOf(';', i))
    expect([...tros.matchAll(/'([A-Z]{2})'/g)].map((m) => m[1]).sort())
      .toEqual(['CE', 'CL', 'CN', 'EX', 'FC', 'GD', 'MQ', 'PR'])
    expect(MIGRACIO).not.toMatch(/delete from public\.causas/)
  })
})

describe('agrupaCauses: lo que sirve el descriptor', () => {
  it('solo las activas, en orden, cada una con sus subcausas activas en orden', () => {
    const g = agrupaCauses([...FILES_CAUSA].reverse(), [...FILES_SUBCAUSA].reverse())
    expect(g.map((c) => c.codigo)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'])
    expect(g[0].subcausas.map((s) => s.codigo)).toEqual(['C1.1', 'C1.2', 'C1.3'])
    expect(g.reduce((n, c) => n + c.subcausas.length, 0)).toBe(20)
  })

  it('una subcausa inactiva no se ofrece; con nomesActives = false salen todas, las de antes al final', () => {
    const subs = FILES_SUBCAUSA.map((s) => (s.codigo === 'C1.2' ? { ...s, activa: false } : s))
    expect(agrupaCauses(FILES_CAUSA, subs)[0].subcausas.map((s) => s.codigo)).toEqual(['C1.1', 'C1.3'])
    const totes = agrupaCauses(FILES_CAUSA, subs, false)
    expect(totes.map((c) => c.codigo)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'CE', 'EX'])
    expect(totes.find((c) => c.codigo === 'EX')?.activa).toBe(false)
    expect(totes[0].subcausas.find((s) => s.codigo === 'C1.2')?.activa).toBe(false)
  })

  it('trobaSubcausa da la subcausa y su causa', () => {
    const g = agrupaCauses(FILES_CAUSA, FILES_SUBCAUSA)
    expect(trobaSubcausa(g, 'C5.1')?.causa.codigo).toBe('C5')
    expect(trobaSubcausa(g, 'C5')).toBeNull()
    expect(trobaSubcausa(g, null)).toBeNull()
  })
})

describe('WhatsApp: solo la categoría, en una lista de 7 filas', () => {
  const files = filesCausaWhatsApp(agrupaCauses(FILES_CAUSA, FILES_SUBCAUSA))

  it('una fila por categoría activa, `causa:<codigo>`', () => {
    expect(files.map((f) => f.id)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((c) => `causa:${c}`))
  })

  it('títulos ≤ 24 y descripciones ≤ 72 (los topes de la Cloud API), los mismos que camposOferta', () => {
    expect(MAX_TITOL_FILA).toBe(MAX_TITULO_FILA_LISTA)
    expect(MAX_DESC_FILA).toBe(MAX_DESC_FILA_LISTA)
    for (const [codi, w] of Object.entries(CAUSES_WHATSAPP)) {
      expect(w.titulo.length, `${codi}: ${w.titulo}`).toBeLessThanOrEqual(MAX_TITOL_FILA)
      expect(w.descripcion.length, `${codi}: ${w.descripcion}`).toBeLessThanOrEqual(MAX_DESC_FILA)
      expect(w.descripcion.length, codi).toBeGreaterThan(0)
    }
    for (const f of files) {
      expect(f.titulo.length).toBeLessThanOrEqual(MAX_TITOL_FILA)
      expect(f.descripcion.length).toBeLessThanOrEqual(MAX_DESC_FILA)
    }
  })

  it('CAUSES_WHATSAPP tiene exactamente las categorías sembradas', () => {
    expect(Object.keys(CAUSES_WHATSAPP).sort()).toEqual(CAUSES_MIG.map((f) => f[0]).sort())
  })

  it('una categoría nueva sin entrada sale con su nombre recortado, nunca pasada de tope', () => {
    const [f] = filesCausaWhatsApp([{ codigo: 'C8', nombre: 'Una categoria nova amb un nom molt i molt llarg', nombre_es: null, subcausas: [] }])
    expect(f.titulo.length).toBeLessThanOrEqual(MAX_TITOL_FILA)
    expect(f.descripcion).toBe('Una categoria nova amb un nom molt i molt llarg')
  })
})

describe('la subcausa del panel (crear-oferta)', () => {
  it('vacía, o una categoría / una causa de antes = falta la subcausa', () => {
    expect(motiuSubcausa('', null, false)).toBe('subcausa_obligatoria')
    expect(motiuSubcausa(undefined, null, false)).toBe('subcausa_obligatoria')
    expect(motiuSubcausa('C3', null, true)).toBe('subcausa_obligatoria')
    expect(motiuSubcausa('CE', null, true)).toBe('subcausa_obligatoria')
  })

  it('una que no existe o inactiva = inválida; una activa, vale', () => {
    expect(motiuSubcausa('C9.9', null, false)).toBe('subcausa_invalida')
    expect(motiuSubcausa('C3.1', { activa: false }, false)).toBe('subcausa_invalida')
    expect(motiuSubcausa('C3.1', { activa: true }, false)).toBeNull()
  })
})

describe('el texto de la oferta y la edición', () => {
  const base = {
    producte: 'Tomàquet', productor: 'Can Prova', municipi: 'Gavà', quantitat: '300 kg aprox',
    disponible: '23/07', modalitat: 'Donació', causa: 'Preu i rendibilitat', responsable: '', observacions: '',
  }

  it('con subcausa: «CAUSA: Categoria — Subcausa»; sin ella, la causa sola', () => {
    expect(componerTextoOferta({ ...base, subcausa: 'Preu de venda insuficient' }))
      .toContain('🔴 CAUSA: Preu i rendibilitat — Preu de venda insuficient')
    expect(componerTextoOferta(base)).toContain('🔴 CAUSA: Preu i rendibilitat\n')
    expect(textCausa('', 'Sola')).toBe('Sola')
    expect(textCausa(null)).toBe('')
  })

  it('editar_oferta acepta `subcausa_codigo` (vacía viaja vacía: la rechaza la RPC)', () => {
    expect(canvisOferta({ subcausa_codigo: ' C4.2 ' })).toEqual({ subcausa_codigo: 'C4.2' })
    expect(canvisOferta({ subcausa_codigo: null })).toEqual({ subcausa_codigo: '' })
    expect(canvisOferta({ kg_total: 10 })).not.toHaveProperty('subcausa_codigo')
  })
})

describe('el selector agrupado del panel (src/lib/causes)', () => {
  const g = agrupaCauses(FILES_CAUSA, FILES_SUBCAUSA, false)

  it('una opción por subcausa activa, con la categoría como grupo, en los dos idiomas', () => {
    const ca = opcionsSubcausa(g, 'ca')
    expect(ca).toHaveLength(20)
    expect(ca[0]).toEqual({ valor: 'C1.1', text: 'Excés de producció o compra', grup: 'Oferta i planificació' })
    const es = opcionsSubcausa(g, 'es')
    expect(es[3]).toEqual({ valor: 'C2.1', text: 'Falta de compradores o demanda', grup: 'Demanda y comercialización' })
    // Las causas de antes (sin subcausas e inactivas) no dan ninguna opción.
    expect(ca.some((o) => o.grup === 'Excedent')).toBe(false)
  })

  it('la subcausa guardada que ya no se ofrece se sigue viendo', () => {
    const amb = agrupaCauses(FILES_CAUSA, FILES_SUBCAUSA.map((s) => (s.codigo === 'C7.3' ? { ...s, activa: false } : s)), false)
    expect(opcionsSubcausa(amb, 'ca').some((o) => o.valor === 'C7.3')).toBe(false)
    expect(opcionsSubcausa(amb, 'ca', 'C7.3').at(-1)?.valor).toBe('C7.3')
    expect(esSubcausaTriable(amb, 'C7.3')).toBe(false)
    expect(esSubcausaTriable(amb, 'C7.2')).toBe(true)
    expect(esSubcausaTriable(amb, 'CE')).toBe(false)
  })

  it('«Categoria — Subcausa» y el descriptor de un servidor anterior (sin subcausas)', () => {
    expect(textSubcausa(g, 'C6.1', 'ca')).toBe('Logística i conservació — Manca de transport o dificultats de recollida/entrega')
    expect(textSubcausa(g, 'C6', 'ca')).toBe('')
    const vell = catalegDelDescriptor([{ codigo: 'CE', nombre: 'Criteris Estètics' }])
    expect(teSubcauses(vell)).toBe(false)
    expect(teSubcauses(catalegDelDescriptor(g))).toBe(true)
  })
})
