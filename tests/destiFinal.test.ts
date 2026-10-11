// El destino final de los kilos (fase 1 de la revisión del 08-10-2026). La autoridad es la
// base (`registrar_desti_final()`); esto comprueba que la pantalla anticipa lo mismo.

import { describe, expect, it } from 'vitest'
import {
  calDemanarDesti, CODIS_DESTI, errorDesti, FILA_BUIDA, kgDeText, payloadDesti, resumDesti,
} from '../src/lib/destiFinal'
import type { FilaDesti } from '../src/lib/destiFinal'
import { DICTS } from '../src/lib/i18n'

const fila = (f: Partial<FilaDesti>): FilaDesti => ({ ...FILA_BUIDA, ...f })
const AVUI = '2026-10-11'

describe('kgDeText', () => {
  it('acepta coma y punto, y rechaza lo que no es un número', () => {
    expect(kgDeText('12,5')).toBe(12.5)
    expect(kgDeText(' 1 000 ')).toBe(1000)
    expect(kgDeText('')).toBeNull()
    expect(kgDeText('molts')).toBeNull()
  })
})

describe('resumDesti', () => {
  it('el ejemplo del cliente: 250 ofrecidos → 100 donados, 80 vendidos, 70 compostados', () => {
    // 100 por Redestina (canalización) y 150 externos en dos filas.
    const r = resumDesti(250, 100, [fila({ desti: 'venda', kg: '80' }), fila({ desti: 'compostatge', kg: '70' })])
    expect(r).toEqual({ kgExterns: 150, kgSenseDesti: 0, sobren: 0 })
  })

  it('lo que falta y lo que sobra', () => {
    expect(resumDesti(150, 0, [fila({ desti: 'venda', kg: '100' })]).kgSenseDesti).toBe(50)
    expect(resumDesti(150, 100, [fila({ desti: 'venda', kg: '80' })]).sobren).toBe(30)
  })
})

describe('errorDesti', () => {
  it('una fila vacía no cuenta: es la que se añade para empezar', () => {
    expect(errorDesti(100, 0, [fila({})], AVUI)).toBeNull()
  })
  it('cada fila necesita destino y kilos positivos, y no una fecha futura', () => {
    expect(errorDesti(100, 0, [fila({ kg: '10' })], AVUI)).toBe('desti.err_desti')
    expect(errorDesti(100, 0, [fila({ desti: 'venda', kg: '0' })], AVUI)).toBe('desti.err_kg')
    expect(errorDesti(100, 0, [fila({ desti: 'venda', kg: '10', data: '2026-10-12' })], AVUI)).toBe('desti.err_data')
  })
  it('no deja enviar más kilos que la oferta (la base respondería massa_kg)', () => {
    expect(errorDesti(100, 60, [fila({ desti: 'venda', kg: '50' })], AVUI)).toBe('desti.err_massa')
    expect(errorDesti(100, 60, [fila({ desti: 'venda', kg: '40' })], AVUI)).toBeNull()
  })
})

describe('payloadDesti', () => {
  it('quita las filas vacías y convierte los números', () => {
    expect(payloadDesti([fila({ desti: 'venda', kg: '12,5', receptor: ' Empresa X ' }), fila({})]))
      .toEqual([{ desti: 'venda', kg: 12.5, receptor: 'Empresa X' }])
  })
})

describe('calDemanarDesti', () => {
  it('pide (banda roja) en «sense sortida» o si el job lo reclamó, y solo si falta algo', () => {
    expect(calDemanarDesti('no_colocada', false, 10)).toBe(true)
    expect(calDemanarDesti('parcial', true, 10)).toBe(true)
    expect(calDemanarDesti('parcial', false, 10)).toBe(false)
    expect(calDemanarDesti('no_colocada', true, 0)).toBe(false)
  })
})

describe('los textos', () => {
  it('cada rechazo del servidor tiene su texto en ca y es (claves compuestas)', () => {
    for (const c of [...CODIS_DESTI, 'generic']) {
      expect(DICTS.ca[`desti.err_${c}`], `ca desti.err_${c}`).toBeTruthy()
      expect(DICTS.es[`desti.err_${c}`], `es desti.err_${c}`).toBeTruthy()
    }
  })
})
