// El texto del certificado de donación según el modelo de la Fundació (05-11-2026).
//
// Lo que se vigila aquí es lo que un error dejaría impreso en un papel con efecto fiscal:
// el periodo, los kilos, la naturaleza del donante, la factura que no existe y que la
// plantilla cargada en la base use exactamente los marcadores que este módulo rellena.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import {
  abastDe,
  carrecEnFrase,
  dataCurta,
  fraseFactura,
  fraseInscripcio,
  kgText,
  MARCADORS_CERTIFICAT,
  majuscules,
  naturalesaPerNif,
  textPeriode,
  treureOpcionalsBuits,
  valorsCertificat,
} from '../supabase/functions/_shared/certificatDonacio'
import { interpolarCuerpo, type Bloque } from '../supabase/functions/_shared/pdf/bloques'

describe('formato de los datos dentro del texto', () => {
  it('fechas dd/mm/aaaa', () => {
    expect(dataCurta('2025-12-31')).toBe('31/12/2025')
    expect(dataCurta('2025-01-01T10:00:00Z')).toBe('01/01/2025')
    expect(dataCurta(null)).toBe('')
  })

  it('kilos con punto de millar también con cuatro cifras, decimal solo si lo hay', () => {
    expect(kgText(2969)).toBe('2.969')
    expect(kgText(2969.5)).toBe('2.969,5')
    expect(kgText(125)).toBe('125')
    expect(kgText(1234567.04)).toBe('1.234.567')
  })

  it('persona jurídica o física según el NIF', () => {
    expect(naturalesaPerNif('B42995878', 'ca')).toBe('jurídica')
    expect(naturalesaPerNif('G66264953', 'es')).toBe('jurídica')
    expect(naturalesaPerNif('47661162X', 'ca')).toBe('física')
    expect(naturalesaPerNif('X1234567L', 'ca')).toBe('física')
    expect(naturalesaPerNif('', 'ca')).toBe('jurídica')
  })

  it('«exercici» solo en el anual; «període» en intervalo y oferta; «dia» si es un solo día', () => {
    expect(textPeriode('exercici', '2025-01-01', '2025-12-31', 'ca')).toBe("l'exercici 01/01/2025 a 31/12/2025")
    expect(textPeriode('periode', '2026-03-01', '2026-03-15', 'ca')).toBe('el període 01/03/2026 a 15/03/2026')
    expect(textPeriode('oferta', '2026-03-04', '2026-03-04', 'ca')).toBe('el dia 04/03/2026')
    expect(textPeriode('exercici', '2025-01-01', '2025-12-31', 'es')).toBe('el ejercicio 01/01/2025 a 31/12/2025')
    expect(textPeriode('oferta', '2026-03-04', '2026-03-06', 'es')).toBe('el periodo 04/03/2026 a 06/03/2026')
  })

  it('la frase de la factura solo existe si hay número', () => {
    expect(fraseFactura(null, 'ca')).toBe('')
    expect(fraseFactura({ numero: '  ' }, 'ca')).toBe('')
    expect(fraseFactura({ numero: '0408809', data: '2025-12-31' }, 'ca'))
      .toBe(', segons la factura núm. 0408809, amb data 31/12/2025')
    expect(fraseFactura({ numero: 'F-1', data: '2025-12-31' }, 'es'))
      .toBe(', según la factura núm. F-1, con fecha 31/12/2025')
  })

  it('mayúsculas, cargo en minúscula e inscripción', () => {
    expect(majuscules('Hort de Can Tabaquet S.L.', 'ca')).toBe('HORT DE CAN TABAQUET S.L.')
    expect(majuscules('dos mil cinc-cents quaranta-tres euros amb sis cèntims', 'ca'))
      .toBe('DOS MIL CINC-CENTS QUARANTA-TRES EUROS AMB SIS CÈNTIMS')
    expect(carrecEnFrase('Apoderada')).toBe('apoderada')
    expect(fraseInscripcio('', 'ca')).toBe('inscrita en el Registre de Fundacions de la Generalitat de Catalunya')
    expect(fraseInscripcio('Inscrita en el Registre de Fundacions de la Generalitat de Catalunya.', 'ca'))
      .toBe('Inscrita en el Registre de Fundacions de la Generalitat de Catalunya')
    expect(fraseInscripcio('1234', 'es')).toBe('inscrita en el Registro de Fundaciones de la Generalitat de Catalunya con el número 1234')
  })

  it('el ámbito de un snapshot antiguo se deduce', () => {
    expect(abastDe({ abast: 'oferta' })).toBe('oferta')
    expect(abastDe({ periode: {}, cierre_periodo_id: 'x' })).toBe('periode')
    expect(abastDe({})).toBe('exercici')
  })
})

/** Los bloques de la plantilla `CD` de la migración del modelo, por idioma. */
function plantillesDeLaMigracio(): string[] {
  const dir = 'supabase/migrations'
  const fitxers = readdirSync(dir).filter((f) => /certificat_donacio/.test(f))
  return fitxers.map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
}

describe('la plantilla de la base y este módulo hablan de lo mismo', () => {
  const sql = plantillesDeLaMigracio().join('\n')

  it('existe la migración de la plantilla del modelo', () => {
    expect(sql).toMatch(/Llei 49\/2002/)
    expect(sql).toMatch(/Ley 49\/2002/)
  })

  it('todo marcador de la plantilla lo rellena valorsCertificat, y al revés', () => {
    const usats = new Set([...sql.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[1]))
    expect([...usats].sort()).toEqual([...MARCADORS_CERTIFICAT].sort())
  })

  it('el texto interpolado del modelo sale completo y sin marcadores', () => {
    const cuerpo: Bloque[] = [
      { tipo: 'p', text: [...MARCADORS_CERTIFICAT].map((m) => `{{${m}}}`).join(' | ') },
    ]
    const valors = valorsCertificat({
      idioma: 'ca',
      abast: 'exercici',
      datos: {
        fundacio: { 'raó_social': 'Fundació Espigoladors', cif: 'G00000000', domicili: 'Carrer de Prova, 1', codi_postal: '08000', poblacio: 'Barcelona', inscripcio: '' },
        apoderada: { nom: 'Persona de Prova', carrec: 'Apoderada' },
        donant: { 'raó_social': 'Hort de Prova S.L.', nif: 'B00000000' },
        periode: { des_de: '2025-01-01', fins_a: '2025-12-31' },
        kg: 2969,
        lloc: 'Barcelona',
      },
      apoderadaDni: '00000000T',
      importLletres: 'dos mil cinc-cents quaranta-tres euros amb sis cèntims',
      importXifres: '2.543,06 €',
      dataExpedicioLlarga: '31 de desembre de 2025',
    })
    const net = cuerpo.map((b) => ({ ...b, text: treureOpcionalsBuits(String(b.text), valors) }))
    const { bloques, faltan } = interpolarCuerpo(net, valors)
    expect(faltan).toEqual([])
    const text = String(bloques[0].text)
    expect(text).toContain("l'exercici 01/01/2025 a 31/12/2025")
    expect(text).toContain('HORT DE PROVA S.L.')
    expect(text).toContain('FUNDACIÓ ESPIGOLADORS')
    expect(text).toContain('2.969')
    expect(text).toContain('DOS MIL CINC-CENTS QUARANTA-TRES EUROS AMB SIS CÈNTIMS')
    expect(text).toContain('apoderada')
    expect(text).not.toContain('factura')
  })
})
