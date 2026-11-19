// «Comparteix» el PDF de un albarán (fase 3 de los puntos 4-6): en el móvil, la hoja del
// sistema con el fichero; si no se puede, se descarga. La decisión es pura.

import { describe, it, expect } from 'vitest'
import { comCompartirDocument, nomFitxerPdf } from '../src/lib/compartirDocument'

describe('comCompartirDocument', () => {
  it('solo comparte en el móvil y si el navegador comparte ficheros', () => {
    expect(comCompartirDocument({ esMobil: true, potFitxers: true })).toBe('compartir')
    expect(comCompartirDocument({ esMobil: true, potFitxers: false })).toBe('descarregar')
    expect(comCompartirDocument({ esMobil: false, potFitxers: true })).toBe('descarregar')
    expect(comCompartirDocument({ esMobil: false, potFitxers: false })).toBe('descarregar')
  })
})

describe('nomFitxerPdf', () => {
  it('añade .pdf solo si falta, y usa el de por defecto si no hay nombre', () => {
    expect(nomFitxerPdf('ENT-2026-0001', 'x')).toBe('ENT-2026-0001.pdf')
    expect(nomFitxerPdf('ENT-2026-0001.PDF', 'x')).toBe('ENT-2026-0001.PDF')
    expect(nomFitxerPdf(null, 'albara')).toBe('albara.pdf')
    expect(nomFitxerPdf('  ', 'albara')).toBe('albara.pdf')
  })
})
