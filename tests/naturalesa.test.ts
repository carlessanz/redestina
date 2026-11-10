// La naturalesa de una organización (Plan 2 A5, 20270523100000): la sugerencia por el NIF, las
// modalidades que se ofrecen y la regla P8. El espejo de `src/lib/naturalesa.ts` tiene que decir
// lo mismo que la migración: si una cambia y la otra no, «Nova entitat» sugeriría una cosa y la
// base guardaría otra.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FORMES_EMPRESA, FORMES_SOCIAL, LLETRES_EMPRESA, LLETRES_SOCIAL,
  modalitatsDeLaNaturalesa, modalitatsInteresDe, naturalesaDeText, naturalesaEfectiva, naturalesaSuggerida,
} from '../src/lib/naturalesa'

const SQL = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20270523100000_naturalesa.sql'), 'utf-8')

describe('naturalesaSuggerida', () => {
  it('por la letra del NIF', () => {
    expect(naturalesaSuggerida('G12345678')).toBe('entitat_social')
    expect(naturalesaSuggerida('R1234567J')).toBe('entitat_social')
    expect(naturalesaSuggerida('B12345674')).toBe('empresa')
    expect(naturalesaSuggerida('a-1234567-4')).toBe('empresa')
    // Persona física (DNI o NIE): opera como autónoma.
    expect(naturalesaSuggerida('12345678Z')).toBe('empresa')
    expect(naturalesaSuggerida('X1234567L')).toBe('empresa')
  })

  it('F, H y V pueden ser las dos cosas: decide la forma jurídica o nadie', () => {
    expect(naturalesaSuggerida('F12345678')).toBeNull()
    expect(naturalesaSuggerida('F12345678', 'associacio')).toBe('entitat_social')
    expect(naturalesaSuggerida('V12345678', 'sl')).toBe('empresa')
    expect(naturalesaSuggerida('H12345678', 'cooperativa')).toBeNull()
  })

  it('el NIF manda sobre la forma; sin NIF, la forma', () => {
    expect(naturalesaSuggerida('G12345678', 'sl')).toBe('entitat_social')
    expect(naturalesaSuggerida('', 'fundacio')).toBe('entitat_social')
    expect(naturalesaSuggerida(null, 'autonom')).toBe('empresa')
    expect(naturalesaSuggerida(null, null)).toBeNull()
    expect(naturalesaSuggerida('xx', 'altres')).toBeNull()
  })

  it('las letras y las formas son las mismas que en la migración', () => {
    expect(SQL).toContain(`n ~ '^[${LLETRES_SOCIAL}][0-9]{7}[0-9A-J]$'`)
    expect(SQL).toContain(`n ~ '^[${LLETRES_EMPRESA}][0-9]{7}[0-9A-J]$'`)
    expect(SQL).toContain(`f in (${FORMES_SOCIAL.map((f) => `'${f}'`).join(', ')})`)
    expect(SQL).toContain(`f in (${FORMES_EMPRESA.map((f) => `'${f}'`).join(', ')})`)
  })
})

describe('modalitats según la naturalesa', () => {
  it('chips: social donación y compra; empresa compra y maquila; sin naturalesa, todas', () => {
    expect(modalitatsInteresDe('entitat_social')).toEqual(['donacio', 'venda'])
    expect(modalitatsInteresDe('empresa')).toEqual(['venda', 'maquila'])
    expect(modalitatsInteresDe(null)).toEqual(['donacio', 'venda', 'maquila'])
  })

  it('lo ya marcado se sigue enseñando', () => {
    expect(modalitatsInteresDe('empresa', ['donacio'])).toEqual(['donacio', 'venda', 'maquila'])
  })

  it('la regla P8 solo restringe una naturalesa CONFIRMADA', () => {
    const regla = [
      { modalitat: 'donacio', naturalesa: 'entitat_social' }, { modalitat: 'venda', naturalesa: 'entitat_social' },
      { modalitat: 'maquila', naturalesa: 'entitat_social' }, { modalitat: 'venda', naturalesa: 'empresa' },
      { modalitat: 'maquila', naturalesa: 'empresa' },
    ]
    expect(modalitatsDeLaNaturalesa('empresa', 'confirmada', regla)).toEqual(['venda', 'maquila'])
    expect(modalitatsDeLaNaturalesa('entitat_social', 'confirmada', regla)).toEqual(['donacio', 'venda', 'maquila'])
    expect(modalitatsDeLaNaturalesa('empresa', 'suggerida', regla)).toBeNull()
    expect(modalitatsDeLaNaturalesa(null, null, regla)).toBeNull()
    expect(modalitatsDeLaNaturalesa('empresa', 'confirmada', null)).toBeNull()
  })

  it('la siembra de la migración: una empresa nunca recibe donación (P8)', () => {
    const siembra = SQL.slice(SQL.indexOf('insert into public.modalitat_naturalesa_compat'), SQL.indexOf('on conflict do nothing'))
    const files = [...siembra.matchAll(/\('(\w+)',\s*'(\w+)'\)/g)].map((m) => `${m[1]}:${m[2]}`)
    expect(files.filter((f) => f.endsWith(':empresa')).sort()).toEqual(['maquila:empresa', 'venda:empresa'])
    expect(files.filter((f) => f.endsWith(':entitat_social')).sort())
      .toEqual(['donacio:entitat_social', 'maquila:entitat_social', 'venda:entitat_social'])
  })
})

describe('naturalesaEfectiva', () => {
  it('solo surte efecto la confirmada: la sugerida no cambia nada de lo que se ve', () => {
    expect(naturalesaEfectiva('empresa', 'confirmada')).toBe('empresa')
    expect(naturalesaEfectiva('empresa', 'suggerida')).toBeNull()
    expect(naturalesaEfectiva(null, 'confirmada')).toBeNull()
    expect(naturalesaEfectiva('altra', 'confirmada')).toBeNull()
  })
})

describe('naturalesaDeText (Excel)', () => {
  it('código o etiqueta, en ca o es, con o sin acentos', () => {
    expect(naturalesaDeText('entitat_social')).toBe('entitat_social')
    expect(naturalesaDeText('Entitat social')).toBe('entitat_social')
    expect(naturalesaDeText(' Entidad Social ')).toBe('entitat_social')
    expect(naturalesaDeText('EMPRESA')).toBe('empresa')
  })
  it('lo que no casa, null', () => {
    expect(naturalesaDeText('Cooperativa')).toBeNull()
    expect(naturalesaDeText('')).toBeNull()
    expect(naturalesaDeText(null)).toBeNull()
  })
})
