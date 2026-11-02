import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANALS_NOTA, MAX_TEXT_NOTA, dataPerEnviar, faTemps, textValid } from '../src/lib/notesInternes'

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

describe('el vocabulario coincide con la base', () => {
  it('CANALS_NOTA es el CHECK de notes_internes.canal y el de la RPC', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20270502100000_notes_internes.sql'), 'utf-8')
    const lista = `(${CANALS_NOTA.map((c) => `'${c}'`).join(', ')})`
    expect(sql).toContain(`canal in ${lista}`)
    expect(sql).toContain(`p_canal not in ${lista}`)
    expect(sql).toContain(`> ${MAX_TEXT_NOTA}`)
  })
})
