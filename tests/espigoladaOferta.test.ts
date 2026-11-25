// La espigolada como oferta de DONACIÓN (fase 3, 25-11-2026): ya no crea jornada ni lotes; es una
// oferta con `espigolada_demanada`, el producto en el campo y solo donación, que sigue el circuito
// normal. Estas piezas puras son las que lo garantizan en el servidor:
//
//   · `dadesAmbEspigolada`: el alta (y el esborrany y su publicación) con la regla aplicada antes
//     de validar, así que los obligatorios, el convenio exigido y la fila dicen lo mismo.
//   · `filaDeDades`: lo que acaba en `excedentes`.
//   · `canvisOferta` y `filaEditada`: la edición acepta `espigolada` (o `espigolada_demanada`) y el
//     texto se compone con lo que `editar_oferta()` derivará.
//   · `componerTextoOferta`: el texto lo dice, pero no cambia nada más del mensaje.

import { describe, it, expect } from 'vitest'
import {
  canvisOferta, dadesAmbEspigolada, filaDeDades, filaEditada, type CausaResolta,
} from '../supabase/functions/_shared/oferta.ts'
import { componerTextoOferta, textoOfertaDeDades } from '../supabase/functions/_shared/textOferta.ts'
import { faltantes } from '../supabase/functions/_shared/camposOferta.ts'

const SENSE_CAUSA: CausaResolta = { causaCodigo: null, subcausaCodigo: null, causa: null, subcausa: null }

describe('dadesAmbEspigolada', () => {
  it('sin espigolada devuelve el mismo objeto', () => {
    const d = { modalitat: ['venda'], producte_al_camp: 'no' }
    expect(dadesAmbEspigolada(d)).toBe(d)
    expect(dadesAmbEspigolada({ ...d, espigolada: false })).toEqual({ ...d, espigolada: false })
  })

  it('con espigolada: solo donación y el producto en el campo, diga lo que diga el resto', () => {
    const d = dadesAmbEspigolada({ espigolada: true, modalitat: ['venda', 'maquila'], producte_al_camp: 'no' })
    expect(d.modalitat).toEqual(['donacio'])
    expect(d.producte_al_camp).toBe('si')
    expect(d.espigolada).toBe(true)
  })

  it('sin modalitat ni «al camp», la espigolada no deja obligatorios por esas dos preguntas', () => {
    const falten = faltantes(dadesAmbEspigolada({ espigolada: 'si' }))
    expect(falten).not.toContain('modalitat')
    expect(falten).not.toContain('producte_al_camp')
    // Con el producto en el campo no se pregunta cómo se entrega.
    expect(falten).not.toContain('format_entrega')
  })
})

describe('filaDeDades · espigolada', () => {
  it('marca la espigolada, el producto en el campo y la donación', () => {
    const f = filaDeDades({ espigolada: true, modalitat: ['venda'], preu_minim: '0,5', producte: 'Poma' }, null, SENSE_CAUSA)
    expect(f.espigolada_demanada).toBe(true)
    expect(f.producte_al_camp).toBe(true)
    expect(f.modalitat).toBe('donacio')
    expect(f.modalitats).toEqual(['donacio'])
    // Sin venta no hay precio mínimo.
    expect(f.preu_minim).toBeNull()
  })

  it('sin espigolada, la marca queda en false', () => {
    const f = filaDeDades({ modalitat: ['donacio'], producte_al_camp: 'si' }, null, SENSE_CAUSA)
    expect(f.espigolada_demanada).toBe(false)
    expect(f.producte_al_camp).toBe(true)
  })
})

describe('canvisOferta · espigolada', () => {
  // La regla la impone `editar_oferta()` (20270617100300); aquí solo se evita mandarle una
  // contradicción: la espigolada manda, como en el alta.
  it('`espigolada: true` → espigolada_demanada y producto en el campo; las modalidades las fuerza la RPC', () => {
    expect(canvisOferta({ espigolada: true })).toEqual({ espigolada_demanada: true, producte_al_camp: true })
  })

  it('la espigolada manda sobre unas modalidades o un «ja collit» contradictorios', () => {
    expect(canvisOferta({ espigolada: true, modalitats: ['venda'], producte_al_camp: 'no' })).toEqual({
      espigolada_demanada: true, producte_al_camp: true,
    })
  })

  it('acepta también el nombre de la columna', () => {
    expect(canvisOferta({ espigolada_demanada: true }).espigolada_demanada).toBe(true)
    expect(canvisOferta({ espigolada_demanada: false })).toEqual({ espigolada_demanada: false })
  })

  it('`espigolada: false` la apaga sin tocar lo demás', () => {
    expect(canvisOferta({ espigolada: false, modalitats: ['venda'] })).toEqual({
      espigolada_demanada: false, modalitats: ['venda'],
    })
  })

  it('sin la clave, no se manda (un «ja collit» lo desmarca la RPC)', () => {
    expect(canvisOferta({ kg_total: 10 })).not.toHaveProperty('espigolada_demanada')
    expect(canvisOferta({ producte_al_camp: 'no' })).toEqual({ producte_al_camp: false })
  })
})

describe('filaEditada: la fila como la dejará editar_oferta, para el texto', () => {
  const collida = { producto: 'Poma', producte_al_camp: false, espigolada_demanada: false, modalitat: 'venda', modalitats: ['venda'] }

  it('marcar la espigolada: al camp y solo donación', () => {
    const f = filaEditada(collida, canvisOferta({ espigolada: true }))
    expect(f).toMatchObject({ espigolada_demanada: true, producte_al_camp: true, modalitats: ['donacio'], modalitat: null })
  })

  it('una espigolada que pasa a «ja collit» deja de serlo', () => {
    const esp = { ...collida, producte_al_camp: true, espigolada_demanada: true, modalitats: ['donacio'] }
    const f = filaEditada(esp, canvisOferta({ producte_al_camp: 'no' }))
    expect(f).toMatchObject({ espigolada_demanada: false, producte_al_camp: false })
  })

  it('sin tocar la espigolada, lo demás como siempre', () => {
    expect(filaEditada(collida, { kg_total: 50 })).toMatchObject({ kg_total: 50, modalitats: ['venda'], modalitat: null })
  })
})

describe('el texto de una espigolada', () => {
  it('lo dice en la línea del campo, sin la línea genérica', () => {
    const t = componerTextoOferta({ producte: 'Poma', producteAlCamp: true, espigolada: true, modalitat: 'Donació' })
    expect(t).toContain('🌱 ESPIGOLADA:')
    expect(t).not.toContain('PRODUCTE AL CAMP')
    // Y la modalidad es la de una donación: el circuito es el mismo.
    expect(t).toContain('💰 MODALITAT: Donació')
  })

  it('desde la fila, por `espigolada_demanada`', () => {
    const t = textoOfertaDeDades(
      { producto: 'Poma', producte_al_camp: true, espigolada_demanada: true, modalitats: ['donacio'] },
      { productor: 'Mas', municipi: 'Lleida' },
    )
    expect(t).toContain('🌱 ESPIGOLADA:')
  })

  it('una oferta al camp que no es espigolada sigue como antes', () => {
    const t = componerTextoOferta({ producte: 'Poma', producteAlCamp: true })
    expect(t).toContain("🌱 PRODUCTE AL CAMP: sí (encara no s'ha collit)")
    expect(t).not.toContain('ESPIGOLADA')
  })
})
