// Los marcadores del convenio que se rellenan en pantalla.
//
// Por qué esto tiene prueba y no es solo un `replace`: lo que aquí se decide es QUÉ LEE
// alguien justo antes de firmar un documento legal. Dejar una llave sin resolver parece un
// fallo del sistema; poner un valor donde no lo hay —un número de convenio inventado, por
// ejemplo— es peor, porque parece un dato.

import { describe, it, expect } from 'vitest'
import { omplirMarcadors, marcadorsDelFormulari, BUIT } from '../src/lib/marcadors'

const ORG = {
  raso_social: 'Organització Carles Sanz',
  nif: 'B12345678',
  domicili: 'Carrer Gran, 1',
  codi_postal: '08001',
  poblacio: 'Barcelona',
  nom_comercial: '',
  representant: 'Carles Sanz',
  carrec: 'Administrador',
  email: 'hola@exemple.com',
}

describe('omplirMarcadors', () => {
  it('sustituye lo que conoce', () => {
    expect(omplirMarcadors('NIF {{nif}} i domicili a {{domicili}}', { nif: 'B1', domicili: 'C/ 1' }))
      .toBe('NIF B1 i domicili a C/ 1')
  })

  it('nunca deja las llaves a la vista', () => {
    const r = omplirMarcadors('Conveni {{numero}} · exercici {{ejercici}}', {})
    expect(r).not.toContain('{{')
    expect(r).not.toContain('}}')
    expect(r).toBe(`Conveni ${BUIT} · exercici ${BUIT}`)
  })

  // Un campo en blanco y un campo desconocido son lo mismo para quien lee: un hueco.
  it('un valor vacío o con solo espacios cuenta como hueco', () => {
    expect(omplirMarcadors('{{a}}', { a: '' })).toBe(BUIT)
    expect(omplirMarcadors('{{a}}', { a: '   ' })).toBe(BUIT)
  })

  it('tolera espacios dentro de las llaves', () => {
    expect(omplirMarcadors('{{ nif }}', { nif: 'B1' })).toBe('B1')
  })

  it('recorta el valor: lo que se pega en un campo suele traer espacios', () => {
    expect(omplirMarcadors('{{nif}}', { nif: '  B1  ' })).toBe('B1')
  })

  it('deja intacto un texto sin marcadores', () => {
    const t = 'Reunits, d’una banda la Fundació i d’altra la part generadora.'
    expect(omplirMarcadors(t, ORG)).toBe(t)
  })
})

describe('marcadorsDelFormulari', () => {
  const d = marcadorsDelFormulari(ORG, 'Carles Sanz', 'Administrador')

  it('acepta las dos formas de cada clave, porque la plantilla mezcla idiomas', () => {
    expect(d['firmant.nombre']).toBe('Carles Sanz')
    expect(d['firmant.nom']).toBe('Carles Sanz')
    expect(d['firmant.cargo']).toBe('Administrador')
    expect(d['firmant.carrec']).toBe('Administrador')
    expect(d['organitzacio.nif']).toBe('B12345678')
    expect(d['organizacion.nif']).toBe('B12345678')
  })

  // El número se asigna al firmar, dentro de la transacción que lo emite: antes no existe.
  // Inventarlo en un documento legal sería peor que dejar el hueco.
  it('NO inventa el número ni el ejercicio', () => {
    expect(d['numero']).toBeUndefined()
    expect(d['ejercici']).toBeUndefined()
    expect(omplirMarcadors('Conveni {{numero}}', d)).toBe(`Conveni ${BUIT}`)
  })

  // El caso real de la captura del cliente, de punta a punta.
  it('resuelve el párrafo de «Reunits» tal y como se veía roto', () => {
    const text = 'Organització Carles Sanz, amb NIF {{organitzacio.nif}} i domicili a '
      + '{{organitzacio.domicili}}, {{organitzacio.codi_postal}} {{organitzacio.poblacio}}, '
      + 'representada per {{firmant.nombre}}, en qualitat de {{firmant.cargo}}.'
    expect(omplirMarcadors(text, d)).toBe(
      'Organització Carles Sanz, amb NIF B12345678 i domicili a Carrer Gran, 1, '
      + '08001 Barcelona, representada per Carles Sanz, en qualitat de Administrador.',
    )
  })
})
