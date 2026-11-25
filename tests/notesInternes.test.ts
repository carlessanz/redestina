import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CANALS_NOTA, MAX_ACCIO, MAX_PREVISIO_UBICACIO, MAX_RESULTAT, MAX_TEXT_NOTA, TIPUS_NOTA, TIPUS_NOTA_LLEGITS,
  dataPerEnviar, esTipusNota, estatSeguiment, faTemps, kgDeText, previsioPerEnviar, resultatValid, seguimentPerEnviar, textValid,
} from '../src/lib/notesInternes'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('faTemps', () => {
  const ara = new Date(2026, 10, 2, 10, 0) // 2-11-2026 10:00 local

  it('hoy, ayer y días', () => {
    expect(faTemps(new Date(2026, 10, 2, 8, 0).toISOString(), ara)).toEqual({ clau: 'ni.avui', n: 0 })
    expect(faTemps(new Date(2026, 10, 1, 23, 0).toISOString(), ara)).toEqual({ clau: 'ni.ahir', n: 1 })
    expect(faTemps(new Date(2026, 9, 30, 12, 0).toISOString(), ara)).toEqual({ clau: 'ni.fa_dies', n: 3 })
  })

  it('meses y años', () => {
    expect(faTemps(new Date(2026, 7, 1, 12, 0).toISOString(), ara)).toEqual({ clau: 'ni.fa_mesos', n: 3 })
    expect(faTemps(new Date(2024, 10, 1, 12, 0).toISOString(), ara)).toEqual({ clau: 'ni.fa_anys', n: 2 })
  })

  it('una fecha futura cuenta como hoy', () => {
    expect(faTemps(new Date(2026, 10, 3, 12, 0).toISOString(), ara).clau).toBe('ni.avui')
  })
})

describe('dataPerEnviar', () => {
  it('hoy o una fecha mal formada → la RPC pone now()', () => {
    expect(dataPerEnviar('2026-11-02', '2026-11-02')).toBeUndefined()
    expect(dataPerEnviar('', '2026-11-02')).toBeUndefined()
    expect(dataPerEnviar('2/11/2026', '2026-11-02')).toBeUndefined()
  })

  it('otro día → ese día a las 12:00 locales', () => {
    const iso = dataPerEnviar('2026-10-28', '2026-11-02')!
    const d = new Date(iso)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 28, 12])
  })
})

describe('textValid', () => {
  it('ni vacío ni por encima del tope de la RPC', () => {
    expect(textValid('   ')).toBe(false)
    expect(textValid('Trucada')).toBe(true)
    expect(textValid('a'.repeat(MAX_TEXT_NOTA))).toBe(true)
    expect(textValid('a'.repeat(MAX_TEXT_NOTA + 1))).toBe(false)
  })
})

describe('estatSeguiment', () => {
  it('vencido, hoy, previsto y hecho (por días de calendario)', () => {
    expect(estatSeguiment('2026-11-01', '2026-11-04', false)).toBe('vencut')
    expect(estatSeguiment('2026-11-04', '2026-11-04', false)).toBe('avui')
    expect(estatSeguiment('2026-11-10', '2026-11-04', false)).toBe('previst')
    expect(estatSeguiment('2026-11-01', '2026-11-04', true)).toBe('fet')
  })
})

describe('seguimentPerEnviar', () => {
  it('las dos cosas o ninguna', () => {
    expect(seguimentPerEnviar('  ', '')).toBeNull()
    expect(seguimentPerEnviar('Trucar', '')).toBe('incompleta')
    expect(seguimentPerEnviar('', '2026-11-10')).toBe('incompleta')
    expect(seguimentPerEnviar(' Trucar ', '2026-11-10')).toEqual({ accio: 'Trucar', data: '2026-11-10' })
  })
})

describe('kgDeText', () => {
  it('admite coma decimal; vacío o texto → null', () => {
    expect(kgDeText('12,5')).toBe(12.5)
    expect(kgDeText(' 300 ')).toBe(300)
    expect(kgDeText('')).toBeNull()
    expect(kgDeText('molts')).toBeNull()
    expect(kgDeText('-3')).toBeNull()
  })
})

describe('previsioPerEnviar', () => {
  const buida = { producte: '', kg: '', data: '', ubicacioId: '', ubicacioText: '' }

  it('nada escrito → sin previsión', () => {
    expect(previsioPerEnviar(buida)).toBeNull()
    expect(previsioPerEnviar({ ...buida, producte: '  ' })).toBeNull()
  })

  it('producto, kg y fecha: los tres o ninguno; un lugar solo tampoco vale', () => {
    expect(previsioPerEnviar({ ...buida, producte: 'Tomàquet' })).toBe('incompleta')
    expect(previsioPerEnviar({ ...buida, producte: 'Tomàquet', kg: '100' })).toBe('incompleta')
    expect(previsioPerEnviar({ ...buida, kg: '100', data: '2026-12-01' })).toBe('incompleta')
    expect(previsioPerEnviar({ ...buida, ubicacioText: 'el camp' })).toBe('incompleta')
    expect(previsioPerEnviar({ ...buida, producte: 'Tomàquet', kg: '100', data: '1/12/2026' })).toBe('incompleta')
  })

  it('kg > 0', () => {
    expect(previsioPerEnviar({ ...buida, producte: 'Tomàquet', kg: '0', data: '2026-12-01' })).toBe('kg')
    expect(previsioPerEnviar({ ...buida, producte: 'Tomàquet', kg: 'molts', data: '2026-12-01' })).toBe('kg')
  })

  it('el lugar: uno de la ficha o el texto libre (≤ 200), nunca los dos', () => {
    const base = { ...buida, producte: ' Tomàquet ', kg: '12,5', data: '2026-12-01' }
    expect(previsioPerEnviar(base)).toEqual({ p_previsio_producte: 'Tomàquet', p_previsio_kg: 12.5, p_previsio_data: '2026-12-01' })
    expect(previsioPerEnviar({ ...base, ubicacioId: 'u1', ubicacioText: 'ignorat' }))
      .toEqual({ p_previsio_producte: 'Tomàquet', p_previsio_kg: 12.5, p_previsio_data: '2026-12-01', p_previsio_ubicacio_id: 'u1' })
    expect(previsioPerEnviar({ ...base, ubicacioText: ' el camp ' }))
      .toEqual({ p_previsio_producte: 'Tomàquet', p_previsio_kg: 12.5, p_previsio_data: '2026-12-01', p_previsio_ubicacio: 'el camp' })
    expect(previsioPerEnviar({ ...base, ubicacioText: 'a'.repeat(MAX_PREVISIO_UBICACIO) })).not.toBe('ubicacio_llarga')
    expect(previsioPerEnviar({ ...base, ubicacioText: 'a'.repeat(MAX_PREVISIO_UBICACIO + 1) })).toBe('ubicacio_llarga')
  })
})

describe('resultatValid y esTipusNota', () => {
  it('el resultado, vacío o dentro del tope', () => {
    expect(resultatValid('')).toBe(true)
    expect(resultatValid('a'.repeat(MAX_RESULTAT))).toBe(true)
    expect(resultatValid('a'.repeat(MAX_RESULTAT + 1))).toBe(false)
  })

  it('el tipo heredado se lee pero no se ofrece', () => {
    expect(esTipusNota('seguiment')).toBe(true)
    expect(esTipusNota('prospeccio')).toBe(true)
    expect(esTipusNota('visita')).toBe(false)
    expect((TIPUS_NOTA as readonly string[]).includes('seguiment')).toBe(false)
    expect(TIPUS_NOTA_LLEGITS).toContain('seguiment')
  })
})

describe('el vocabulario coincide con la base', () => {
  it('TIPUS_NOTA, MAX_RESULTAT y MAX_PREVISIO_UBICACIO son los de 20270616100000', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20270616100000_interaccions_seguiment.sql'), 'utf-8')
    const lista = `(${TIPUS_NOTA.map((c) => `'${c}'`).join(', ')})`
    expect(sql).toContain(`tipus in ${lista}`)
    expect(sql).toContain(`not in ${lista}`)
    expect(sql).toContain(`between 1 and ${MAX_RESULTAT}`)
    expect(sql).toContain(`> ${MAX_RESULTAT}`)
    expect(sql).toContain(`between 1 and ${MAX_PREVISIO_UBICACIO}`)
    expect(sql).toContain(`> ${MAX_PREVISIO_UBICACIO}`)
  })

  it('MAX_ACCIO es el de 20270504100000', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20270504100000_crm_seguiments_i_estat_org.sql'), 'utf-8')
    expect(sql).toContain(`between 1 and ${MAX_ACCIO}`)
    expect(sql).toContain(`> ${MAX_ACCIO}`)
  })

  it('CANALS_NOTA es el CHECK de notes_internes.canal y el de la RPC', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20270502100000_notes_internes.sql'), 'utf-8')
    const lista = `(${CANALS_NOTA.map((c) => `'${c}'`).join(', ')})`
    expect(sql).toContain(`canal in ${lista}`)
    expect(sql).toContain(`p_canal not in ${lista}`)
    expect(sql).toContain(`> ${MAX_TEXT_NOTA}`)
  })
})
