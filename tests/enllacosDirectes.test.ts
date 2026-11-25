// Los enlaces directos de los mensajes (fase 4 de los puntos 4-6): las rutas y los parámetros
// que leen las pantallas con `useDialegPerUrl`. Y que todos pasan por `destiValid`, que es lo
// que los deja sobrevivir al login.

import { describe, expect, it } from 'vitest'
import {
  enllacInteresOferta, enllacPropostaCanvis, enllacRegistreRecollida, rutaAssignaOferta, rutaInteresOferta,
  rutaPropostaCanvis, rutaRecollidaEquip, rutaRegistreRecollida,
  enllacRecollidaSollicitud, rutaDisponibilitat, rutaRecollidaSollicitud, rutaRecollidaSollicitudEquip,
} from '../src/lib/enllacosDirectes'
import { destiValid } from '../src/lib/destiLogin'
import { enllacDisponibilitat } from '../supabase/functions/_shared/textOferta.ts'

describe('enlaces directos', () => {
  it('la oferta del Mercat con el formulario de interés', () => {
    expect(rutaInteresOferta('abc')).toBe('/receptor/mercat?oferta=abc&accio=interes')
    expect(enllacInteresOferta('https://x.test/', 'abc')).toBe('https://x.test/receptor/mercat?oferta=abc&accio=interes')
  })

  it('registrar la recogida: a la operación si hay una, a la lista si hay varias', () => {
    expect(rutaRegistreRecollida(['c1'])).toBe('/receptor/interessos?operacio=c1&accio=recollida')
    expect(rutaRegistreRecollida(['c1', 'c2'])).toBe('/receptor/interessos')
    expect(rutaRegistreRecollida([])).toBe('/receptor/interessos')
    expect(enllacRegistreRecollida('https://x.test', ['c1'])).toBe('https://x.test/receptor/interessos?operacio=c1&accio=recollida')
  })

  it('la propuesta de cambios del equipo, abierta en «Els meus interessos» (fase 5)', () => {
    expect(rutaPropostaCanvis('r1')).toBe('/receptor/interessos?resposta=r1')
    expect(enllacPropostaCanvis('https://x.test/', 'r1')).toBe('https://x.test/receptor/interessos?resposta=r1')
    expect(rutaPropostaCanvis('a&b')).toBe('/receptor/interessos?resposta=a%26b')
  })

  it('los del equipo', () => {
    expect(rutaAssignaOferta('o1')).toBe('/equip/ofertes/o1?accio=assigna')
    expect(rutaRecollidaEquip('o1', 'c1')).toBe('/equip/ofertes/o1?accio=recollida&canalitzacio=c1')
  })

  it('un id raro se escapa y no rompe la query', () => {
    expect(rutaInteresOferta('a&b=c')).toBe('/receptor/mercat?oferta=a%26b%3Dc&accio=interes')
  })

  it('todas las rutas son destinos válidos tras el login', () => {
    for (const r of [rutaInteresOferta('a'), rutaRegistreRecollida(['c']), rutaRegistreRecollida([]),
      rutaAssignaOferta('o'), rutaRecollidaEquip('o', 'c'), rutaPropostaCanvis('r'),
      rutaDisponibilitat('d'), rutaRecollidaSollicitud('s'), rutaRecollidaSollicitudEquip('s')]) {
      expect(destiValid(r)).toBe(r)
    }
  })

  it('multiproducto (fase 6): la disponibilidad en el Mercat y la recogida de una solicitud', () => {
    expect(rutaDisponibilitat('d1')).toBe('/receptor/mercat?disponibilitat=d1')
    // El mensaje único lo compone el servidor: tiene que llevar a la misma pantalla.
    expect(enllacDisponibilitat('https://x.test/', 'd1')).toBe(`https://x.test${rutaDisponibilitat('d1')}`)
    expect(rutaRecollidaSollicitud('s1')).toBe('/receptor/interessos?recollida=s1')
    expect(enllacRecollidaSollicitud('https://x.test/', 's1')).toBe('https://x.test/receptor/interessos?recollida=s1')
    expect(rutaRecollidaSollicitudEquip('s1')).toBe('/equip/aprovacions?recollida=s1')
    expect(rutaRecollidaSollicitud('a&b')).toBe('/receptor/interessos?recollida=a%26b')
  })
})
