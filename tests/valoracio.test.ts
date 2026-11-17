// Punto 3, fase D2 (17-11-2026): el valor por kilo de una donación con su fuente.
//   · `costADeclarar`: la oferta solo guarda el coste si el productor CAMBIA la propuesta.
//   · `textFontValor` / `notaFontsCertificat`: lo que dicen el REC, el certificado y el panel.
//   · `mesDeParam` / `rutaPreusMes`: el enlace de un certificado bloqueado a Productes › Preus.

import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/supabase', () => ({ supabase: {}, supabaseUrl: '' }))

import {
  CRITERIS_ORIGEN, costADeclarar, esCriteriOrigen, mateixValor, rotulReferenciaOferta, textCriteriOrigen, textFontValor, textMes,
  textOrigenManual,
} from '../src/lib/valoracio'
import { notaFontsCertificat } from '../supabase/functions/_shared/fontValor'
import { mesDeParam, rutaPreusMes } from '../src/lib/preus'

describe('costADeclarar: solo se declara lo que el productor cambia', () => {
  it('igual a la propuesta → null (el certificado aplicará el precio del mes del albarán)', () => {
    expect(costADeclarar(0.8, 0.8)).toBeNull()
    expect(costADeclarar('0,80', 0.8)).toBeNull()
    expect(costADeclarar(0.80004, 0.8)).toBeNull()
  })
  it('distinto de la propuesta → declarado', () => {
    expect(costADeclarar(0.65, 0.8)).toBe(0.65)
    expect(costADeclarar('0,65', 0.8)).toBe(0.65)
  })
  it('sin propuesta, lo escrito es declarado', () => {
    expect(costADeclarar(0.5, null)).toBe(0.5)
    expect(costADeclarar(0.5, undefined)).toBe(0.5)
  })
  it('vacío o ilegible → null', () => {
    expect(costADeclarar('', 0.8)).toBeNull()
    expect(costADeclarar(null, 0.8)).toBeNull()
    expect(costADeclarar(undefined, 0.8)).toBeNull()
    expect(costADeclarar('abc', 0.8)).toBeNull()
  })
  it('editando: el que la oferta ya tenía declarado se conserva aunque coincida con la propuesta', () => {
    expect(costADeclarar(0.8, 0.8, 0.8)).toBe(0.8)
    // cambiarlo a la propuesta sí lo quita
    expect(costADeclarar(0.8, 0.8, 0.65)).toBeNull()
  })
  it('mateixValor compara a 4 decimales y nunca con null', () => {
    expect(mateixValor(1.2345, 1.2346)).toBe(false)
    expect(mateixValor(1.23451, 1.23449)).toBe(true)
    expect(mateixValor(null, null)).toBe(false)
  })
})

describe('textFontValor: la misma frase en el papel y en la pantalla', () => {
  it('Gencat con su mes', () => {
    expect(textFontValor({ font: 'gencat', mes_font: '2026-09-01' })).toBe(
      'Valor de referència: Gencat, preus percebuts pel pagès, setembre 2026')
    expect(textFontValor({ font: 'gencat', mes_font: '2026-09' }, 'es')).toBe(
      'Valor de referencia: Gencat, precios percibidos por los agricultores, septiembre 2026')
  })
  it('Mercabarna con los días', () => {
    // El valor de Mercabarna es el ÚLTIMO del mes (20270602100000): los días no se imprimen.
    expect(textFontValor({ font: 'mercabarna', mes_font: '2026-11-01', dies: 18 })).toBe(
      'Valor de referència: Mercabarna (darrer preu del mes), novembre 2026')
    expect(textFontValor({ font: 'mercabarna', mes_font: '2026-11-01', dies: 1 }, 'es')).toBe(
      'Valor de referencia: Mercabarna (último precio del mes), noviembre 2026')
    // Octubre validado con el último Gencat (septiembre): el texto dice el mes de ORIGEN.
    expect(textFontValor({ font: 'gencat', mes_font: '2026-09-01', mes_albara: '2026-10-01' })).toBe(
      'Valor de referència: Gencat, preus percebuts pel pagès, setembre 2026')
  })
  it('manual, fijado, declarado e histórico', () => {
    expect(textFontValor({ font: 'manual', mes_font: '2026-10-01' })).toBe('Preu fixat per la Fundació')
    expect(textFontValor({ font: 'fixat' })).toBe('Preu fixat per la Fundació')
    expect(textFontValor({ font: 'declarat' })).toBe('Valor declarat pel donant')
    expect(textFontValor({ font: 'declarat' }, 'es')).toBe('Valor declarado por el donante')
    expect(textFontValor({ font: 'historic' })).toBe('Valor de referència del producte')
  })
  it('provisional: dice el último publicado y que el certificado aplicará el del mes del albarán', () => {
    expect(textFontValor({ font: 'gencat', mes_font: '2026-09-01', provisional: true })).toBe(
      'Valor de referència provisional (darrer publicat: Gencat, preus percebuts pel pagès, setembre 2026); ' +
      'el certificat aplicarà el del mes de l\'albarà.')
    expect(textFontValor({ font: null, provisional: true })).toBe(
      'Sense valor de referència encara; el certificat aplicarà el del mes de l\'albarà.')
  })
  it('sin fuente (un snapshot de antes de la D2) no dice nada', () => {
    expect(textFontValor(null)).toBeNull()
    expect(textFontValor({ font: null })).toBeNull()
  })
  it('textMes', () => {
    expect(textMes('2026-03-01')).toBe('març 2026')
    expect(textMes('2026-13')).toBeNull()
    expect(textMes(null)).toBeNull()
  })
})

describe('notaFontsCertificat', () => {
  it('agrupa por fuente y junta los meses sin repetir', () => {
    expect(notaFontsCertificat([
      { font: 'gencat', mes_font: '2026-09-01' },
      { font: 'gencat', mes_font: '2026-10-01' },
      { font: 'gencat', mes_font: '2026-09-01' },
      { font: 'declarat' },
    ])).toBe('Fonts dels valors: Gencat, preus percebuts pel pagès (setembre 2026, octubre 2026); Valor declarat pel donant.')
  })
  it('sin fuentes → null', () => {
    expect(notaFontsCertificat([])).toBeNull()
    expect(notaFontsCertificat(null)).toBeNull()
  })
})

describe('el enlace a Productes › Preus de un mes', () => {
  it('mesDeParam lee aaaa-mm y rechaza lo demás', () => {
    expect(mesDeParam('2026-09')).toEqual({ exercici: 2026, mes: 9 })
    expect(mesDeParam('2026-13')).toBeNull()
    expect(mesDeParam('2026-9')).toBeNull()
    expect(mesDeParam(null)).toBeNull()
  })
  it('rutaPreusMes', () => {
    expect(rutaPreusMes('2026-09')).toBe('/equip/productes?pestanya=preus&mes=2026-09')
  })
})

describe('rotulReferenciaOferta (alta de oferta, 17-11-2026)', () => {
  const nov = { exercici: 2026, mes: 11 }
  it('validado con el último Gencat: el mes de hoy y de qué mes sale', () => {
    expect(rotulReferenciaOferta({ font: 'gencat', mes: '2026-09-01', provisional: false }, nov)).toEqual({
      mes: 'novembre 2026', font: 'Gencat, preus percebuts pel pagès, darrer publicat: setembre 2026',
    })
    expect(rotulReferenciaOferta({ font: 'gencat', mes: '2026-09-01', provisional: false }, nov, 'es')).toEqual({
      mes: 'noviembre 2026', font: 'Gencat, precios percibidos por los agricultores, último publicado: septiembre 2026',
    })
  })
  it('validado del mismo mes o manual: solo la fuente', () => {
    expect(rotulReferenciaOferta({ font: 'gencat', mes: '2026-11-01', provisional: false }, nov).font)
      .toBe('Gencat, preus percebuts pel pagès')
    // 20270604100000: el manual dice siempre que no es oficial (aquí, sin origen guardado).
    expect(rotulReferenciaOferta({ font: 'manual', mes: '2026-11-01', provisional: false }, nov).font)
      .toBe('Preu fixat per la Fundació (No oficial · origen sense documentar)')
  })
  it('provisional: la fuente con el mes del que sale', () => {
    expect(rotulReferenciaOferta({ font: 'manual', mes: '2026-10-01', provisional: true }, nov)).toEqual({
      mes: 'novembre 2026', font: 'Preu fixat per la Fundació (No oficial · origen sense documentar), octubre 2026',
    })
  })
  it('sin fuente (servidor anterior): font null', () => {
    expect(rotulReferenciaOferta({ font: null, mes: null, provisional: null }, nov).font).toBeNull()
  })
})

describe('rotulReferenciaOferta: solo Mercabarna, el precio del día (20270603100000)', () => {
  it('dice el día del precio', () => {
    expect(rotulReferenciaOferta({ font: 'mercabarna', mes: '2026-11-01', provisional: true, dia: '2026-11-16' },
      { exercici: 2026, mes: 11 })).toEqual({ mes: 'novembre 2026', font: 'Mercabarna, preu del 16/11/2026' })
    expect(rotulReferenciaOferta({ font: 'mercabarna', mes: '2026-11-01', provisional: true, dia: '2026-11-16' },
      { exercici: 2026, mes: 11 }, 'es').font).toBe('Mercabarna, precio del 16/11/2026')
  })
})

describe('el origen de un precio manual: siempre «No oficial» (20270604100000)', () => {
  it('con criterio y fuente: el criterio y de dónde sale', () => {
    expect(textOrigenManual({ criteri: 'producte_semblant', font_origen: 'Préssec — Gencat, setembre 2026' }))
      .toBe("No oficial · preu oficial d'un producte semblant: Préssec — Gencat, setembre 2026")
    expect(textOrigenManual({ criteri: 'producte_semblant', font_origen: 'Melocotón — Gencat' }, 'es'))
      .toBe('No oficial · precio oficial de un producto parecido: Melocotón — Gencat')
  })
  it('sin fuente: lo dice («sense font disponible»)', () => {
    expect(textOrigenManual({ criteri: 'fixat_equip', font_origen: null }))
      .toBe("No oficial · fixat per l'equip · sense font disponible")
    expect(textOrigenManual({ criteri: 'fixat_equip', font_origen: '   ' }, 'es'))
      .toBe('No oficial · fijado por el equipo · sin fuente disponible')
  })
  it('sin criterio (un manual de antes): origen sin documentar, pero «No oficial» igual', () => {
    expect(textOrigenManual(null)).toBe('No oficial · origen sense documentar')
    expect(textOrigenManual({ criteri: 'inventat', font_origen: null }, 'es')).toBe('No oficial · origen sin documentar')
    expect(textOrigenManual({ criteri: null, font_origen: 'IDESCAT' })).toBe('No oficial · IDESCAT')
  })
  it('los cinco criterios, los mismos que el check de la base, con texto en las dos lenguas', () => {
    expect([...CRITERIS_ORIGEN]).toEqual(['producte_semblant', 'mediana_familia', 'mediana_global', 'font_externa', 'fixat_equip'])
    for (const c of CRITERIS_ORIGEN) {
      expect(esCriteriOrigen(c)).toBe(true)
      expect(textCriteriOrigen(c, 'ca')).not.toBe('')
      expect(textCriteriOrigen(c, 'es')).not.toBe('')
    }
    expect(esCriteriOrigen('manual')).toBe(false)
  })
  it('paridad con la migración: el check y la RPC aceptan exactamente estos criterios', async () => {
    const { readFileSync } = await import('node:fs')
    const sql = readFileSync('supabase/migrations/20270604100000_origen_preu_manual.sql', 'utf8')
    for (const c of CRITERIS_ORIGEN) expect(sql.match(new RegExp(`'${c}'`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe('rotulReferenciaOferta: un precio manual dice que no es oficial (20270604100000)', () => {
  const avui = { exercici: 2026, mes: 11 }
  it('con origen', () => {
    expect(rotulReferenciaOferta({
      font: 'manual', mes: '2026-11-01', provisional: false,
      origen: { criteri: 'mediana_familia', font_origen: "Mediana d'11 productes d'Horta Tub/Bul/Arr" },
    }, avui).font).toBe("Preu fixat per la Fundació (No oficial · mediana dels preus de la seva família: Mediana d'11 productes d'Horta Tub/Bul/Arr)")
  })
  it('sin origen (servidor anterior): «No oficial» igual', () => {
    expect(rotulReferenciaOferta({ font: 'manual', mes: '2026-11-01', provisional: false }, avui, 'es').font)
      .toBe('Precio fijado por la Fundació (No oficial · origen sin documentar)')
  })
  it('Gencat no cambia', () => {
    expect(rotulReferenciaOferta({ font: 'gencat', mes: '2026-11-01', provisional: false }, avui).font)
      .toBe('Gencat, preus percebuts pel pagès')
  })
})
