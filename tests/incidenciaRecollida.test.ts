// La incidencia de recogida que declara el receptor (`registrar_recollida()`, 17-10-2026)
// se lee de dos sitios con dos formas: un objeto en `canalizaciones.incidencia_recollida` y
// una lista en `albaranes.incidencias` (o un objeto suelto en albaranes antiguos).

import { describe, expect, it } from 'vitest'
import { diferenciaKg, incidenciesDiferencia, llegeixIncidencia } from '../src/lib/incidenciaRecollida'

const inc = {
  tipus: 'diferencia_kg', resultat: 'menys', kg_assignats: 40, kg_reals: 35,
  descripcion: 'Una caixa malmesa', origen: 'entitat_receptora',
  registrada_at: '2026-10-17T10:00:00Z', registrada_per: 'u1',
}

describe('incidenciaRecollida', () => {
  it('lee el objeto de la canalización', () => {
    const i = llegeixIncidencia(inc)
    expect(i).toMatchObject({ resultat: 'menys', kg_assignats: 40, kg_reals: 35, descripcion: 'Una caixa malmesa' })
    expect(i && diferenciaKg(i)).toBe(-5)
  })

  it('solo cuenta la diferencia de kilos, no una observación suelta', () => {
    expect(llegeixIncidencia({ descripcion: 'Tot bé', origen: 'entitat_receptora' })).toBeNull()
    expect(llegeixIncidencia(null)).toBeNull()
    expect(llegeixIncidencia([inc])).toBeNull()
  })

  it('acepta lista u objeto suelto en `albaranes.incidencias`', () => {
    expect(incidenciesDiferencia([inc, { descripcion: 'x' }])).toHaveLength(1)
    expect(incidenciesDiferencia(inc)).toHaveLength(1)
    expect(incidenciesDiferencia(null)).toEqual([])
    expect(incidenciesDiferencia({ ...inc, resultat: 'mes', kg_reals: '42.5' })[0]).toMatchObject({ resultat: 'mes', kg_reals: 42.5 })
  })

  it('sin uno de los dos números no hay diferencia', () => {
    expect(diferenciaKg({ kg_assignats: null, kg_reals: 3 })).toBeNull()
  })
})
