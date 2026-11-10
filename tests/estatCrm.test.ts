// Plan 2, B1 (20270518100000): el estado CRM por papel en la interfaz.
import { describe, expect, it } from 'vitest'
import { ESTATS_CRM, classeEstatCrm, estatCrm, estatOrganitzacio, estatPerFiltre } from '../src/lib/estatCrm'
import { readFileSync } from 'node:fs'

describe('estatCrm', () => {
  it('los cuatro estados, los mismos que el CHECK de la migración', () => {
    const sql = readFileSync('supabase/migrations/20270518100000_estat_crm.sql', 'utf8')
    expect(sql).toContain(`check (estat_crm in (${ESTATS_CRM.map((e) => `'${e}'`).join(', ')}))`)
  })

  it('reconoce solo valores válidos', () => {
    expect(estatCrm('actiu')).toBe('actiu')
    expect(estatCrm('activa')).toBeNull()
    expect(estatCrm(null)).toBeNull()
  })

  it('cada estado tiene su color de token (sin paleta genérica)', () => {
    for (const e of ESTATS_CRM) expect(classeEstatCrm(e)).toMatch(/^bg-[a-z-]+ text-[a-z-]+$/)
    expect(classeEstatCrm('actiu')).toContain('exito')
    expect(classeEstatCrm('en_desenvolupament')).toContain('aviso')
  })

  it('la organización: actiu si algún papel lo es; si no, el más avanzado', () => {
    expect(estatOrganitzacio('inactiu', 'actiu')).toBe('actiu')
    expect(estatOrganitzacio('potencial', 'en_desenvolupament')).toBe('en_desenvolupament')
    expect(estatOrganitzacio('inactiu', 'potencial')).toBe('potencial')
    expect(estatOrganitzacio('inactiu', null)).toBe('inactiu')
  })

  it('el filtro: con papel manda el estado de ese papel', () => {
    const fila = { productor_estat_crm: 'inactiu', entidad_estat_crm: 'actiu', estat_crm: 'actiu' }
    expect(estatPerFiltre(fila, 'ofertant')).toBe('inactiu')
    expect(estatPerFiltre(fila, 'receptor')).toBe('actiu')
    expect(estatPerFiltre(fila, undefined)).toBe('actiu')
    expect(estatPerFiltre({ ...fila, entidad_estat_crm: null }, 'receptor')).toBeNull()
  })
})
