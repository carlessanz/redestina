// Las claves i18n de «Pendent de l'equip» se COMPONEN (`t(\`pe.${cua}\`)`), así que
// `cobertura.test.ts` —que solo ve literales `t('...')`— no puede saber si faltan. Esta
// prueba recorre las colas de `pendents_equip()` y exige que cada una tenga sus claves en
// los dos idiomas. Es el mismo molde que `procesOferta.test.ts` para `proc.*`.
//
// ⚠️ La lista de colas se LEE del fuente de `pendentsEquip.ts` con una expresión regular,
// como hace `cobertura.test.ts` con `nav.ts`, en vez de importar el módulo: importarlo
// arrastra el cliente de Supabase, que en Node 20 revienta al cargar (WebSocket). Así,
// añadir una cola al union sin sus claves rompe aquí, que es lo que se quiere.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DICTS } from '../src/lib/i18n'

const FUENTE = readFileSync(new URL('../src/lib/pendentsEquip.ts', import.meta.url), 'utf8')
const bloque = FUENTE.match(/export type CuaEquip =([\s\S]*?)\n\n/)?.[1] ?? ''
const CUES = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])

// Las colas cuya fila del tablero lleva segunda línea (`pe.<cua>_sub`).
const AMB_SUB = ['registres', 'convenis_contrasignar', 'respostes', 'ofertes_vencudes', 'costos', 'albarans_conciliar']
// `albarans_esperant` es informativa: no tiene fila propia (espera a la otra parte, no al
// equipo) y se enseña como segunda línea de `albarans_conciliar`. Sin clave propia, a propósito.
const SENSE_FILA = ['albarans_esperant']

describe('pendents_equip · claves compuestas de «Pendent de l’equip»', () => {
  it('lee las doce colas del union CuaEquip', () => {
    expect(CUES).toHaveLength(12)
    expect(CUES).toContain('tancament')
  })

  for (const idioma of ['ca', 'es'] as const) {
    const dict = DICTS[idioma] as Record<string, string>
    it(`cada cola tiene pe.<cua> y pe.<cua>_cta en ${idioma}`, () => {
      for (const cua of CUES) {
        if (SENSE_FILA.includes(cua)) continue
        expect(dict[`pe.${cua}`], `pe.${cua} (${idioma})`).toBeTruthy()
        expect(dict[`pe.${cua}_cta`], `pe.${cua}_cta (${idioma})`).toBeTruthy()
      }
    })
    it(`las colas con segunda línea tienen pe.<cua>_sub en ${idioma}`, () => {
      for (const cua of AMB_SUB) expect(dict[`pe.${cua}_sub`], `pe.${cua}_sub (${idioma})`).toBeTruthy()
    })
    it(`las claves fijas de la tarjeta existen en ${idioma}`, () => {
      for (const k of ['pe.title', 'pe.subtitle', 'pe.empty', 'pe.only_admin', 'pe.mode_prova', 'pe.mode_real', 'pe.err_generic']) {
        expect(dict[k], `${k} (${idioma})`).toBeTruthy()
      }
    })
  }
})
