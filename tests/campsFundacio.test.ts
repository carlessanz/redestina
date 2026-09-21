// Los datos de la Fundación: qué se considera «todavía provisional».
//
// POR QUÉ MERECE PRUEBA. `campsPendents()` es lo único que impide desmarcar
// `datos_provisionales` con la fila a medias, y desmarcarlo abre la emisión de
// certificados con efecto fiscal. Un falso «ya está todo» no da ningún error: saca un
// certificado con el CIF inválido que sembró la migración.
//
// ⚠️ Las etiquetas de los campos se componen (`t(`cfgf.f_${camp}`)`), así que
// `cobertura.test.ts` —que solo ve literales— no las mira. Se comprueban aquí, con el
// mismo molde que `pendentsEquip.test.ts` usa para `pe.*`.

import { describe, expect, it } from 'vitest'
import { CAMPS_FUNDACIO, campsPendents, type DadesFundacio } from '../src/lib/campsFundacio'
import { DICTS } from '../src/lib/i18n'

/** Una fila completa y creíble, sobre la que cada caso estropea un solo campo. */
function fila(canvis: Partial<DadesFundacio> = {}): DadesFundacio {
  return {
    razon_social: 'Fundació Espigoladors',
    cif: 'G65432109',
    domicilio: 'Carrer de Mostra, 1',
    codigo_postal: '08001',
    poblacion: 'Barcelona',
    inscripcion: 'Registre de Fundacions núm. 1234',
    apoderada_nombre: 'Nom Cognom',
    apoderada_cargo: 'Directora',
    email_equipo: 'equip@example.org',
    firma_ruta: null,
    sello_ruta: null,
    datos_provisionales: true,
    actualizado_at: null,
    ...canvis,
  }
}

describe('campsPendents', () => {
  it('con la fila completa no falta nada', () => {
    expect(campsPendents(fila())).toEqual([])
  })

  it('sin fila, faltan todos (no se supone que esté bien lo que no se ha podido leer)', () => {
    expect(campsPendents(null)).toEqual([...CAMPS_FUNDACIO])
  })

  it('un campo vacío, en blanco o nulo cuenta como pendiente', () => {
    expect(campsPendents(fila({ poblacion: null }))).toEqual(['poblacion'])
    expect(campsPendents(fila({ poblacion: '' }))).toEqual(['poblacion'])
    expect(campsPendents(fila({ poblacion: '   ' }))).toEqual(['poblacion'])
  })

  it('el texto sembrado «PROVISIONAL — pendent de…» cuenta como pendiente', () => {
    const d = fila({ razon_social: 'PROVISIONAL — pendent de la raó social real de la Fundació' })
    expect(campsPendents(d)).toEqual(['razon_social'])
  })

  it('y lo detecta escrito de cualquier forma: es el aviso, no la mayúscula', () => {
    expect(campsPendents(fila({ inscripcion: 'provisional, a confirmar' }))).toEqual(['inscripcion'])
  })

  // Los dos valores que la migración sembró CON FORMA DE DATO REAL. Sin esto, la fila
  // parecería completa y el certificado saldría con un CIF que no existe.
  it('el CIF inválido sembrado (G00000000) cuenta como pendiente', () => {
    expect(campsPendents(fila({ cif: 'G00000000' }))).toEqual(['cif'])
  })

  it('el código postal sembrado (00000) cuenta como pendiente', () => {
    expect(campsPendents(fila({ codigo_postal: '00000' }))).toEqual(['codigo_postal'])
  })

  it('pero no se valida ningún CIF: uno real distinto del sembrado pasa', () => {
    expect(campsPendents(fila({ cif: 'G12345678' }))).toEqual([])
  })

  it('devuelve todos los que faltan, no solo el primero', () => {
    expect(campsPendents(fila({ cif: 'G00000000', email_equipo: null })))
      .toEqual(['cif', 'email_equipo'])
  })
})

describe('las etiquetas compuestas de los campos existen en los dos idiomas', () => {
  for (const idioma of ['ca', 'es'] as const) {
    it(`cfgf.f_<camp> para los ${CAMPS_FUNDACIO.length} campos en ${idioma}`, () => {
      const dict = DICTS[idioma] as Record<string, string>
      for (const camp of CAMPS_FUNDACIO) {
        expect(dict[`cfgf.f_${camp}`], `cfgf.f_${camp} (${idioma})`).toBeTruthy()
      }
    })
  }
})
