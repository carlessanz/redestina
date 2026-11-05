// El correo que acompaña a un documento emitido (supabase/functions/_shared/correu-document.ts).
// Lo que importa: qué documentos se mandan y cuáles no, en qué idioma, que el de prueba lo
// diga en el asunto y que ningún dato del documento entre sin escapar.

import { describe, it, expect } from 'vitest'
import { composaCorreuDocument, type DocumentPerEnviar } from '../supabase/functions/_shared/correu-document.ts'

const base: DocumentPerEnviar = {
  tipo: 'CD', subtipo: 'definitiu', objeto_tipo: 'cierre_donante',
  numero_completo: 'CD-2026-0001', ejercicio: 2026, idioma: 'ca', modo: 'real',
  envio: { destinatario: 'donant@example.com', nombre: 'Mas de Prova SCP' },
}

describe('qué se manda', () => {
  it('convenios, resúmenes y certificados, sí', () => {
    for (const tipo of ['CONV', 'RES', 'CD', 'CT', 'CR']) {
      expect(composaCorreuDocument({ ...base, tipo }), tipo).not.toBeNull()
    }
  })
  it('albaranes, planes y el documento de humo, no', () => {
    for (const tipo of ['REC', 'ENT', 'OPE', 'R-ENT', 'PLA', 'PROVA']) {
      expect(composaCorreuDocument({ ...base, tipo }), tipo).toBeNull()
    }
  })
  it('sin destinatario en `envio`, no', () => {
    expect(composaCorreuDocument({ ...base, envio: null })).toBeNull()
    expect(composaCorreuDocument({ ...base, envio: { destinatario: '  ' } })).toBeNull()
  })
})

describe('qué se dice', () => {
  it('el convenio firmado avisa de que falta la contrasignatura; el contrafirmado, de que es vigente', () => {
    const f = composaCorreuDocument({ ...base, tipo: 'CONV', subtipo: 'firmat', numero_completo: 'CONV-DON-GEN-2026-0005' })!
    expect(f.assumpte).toContain('conveni signat')
    expect(f.cosHtml).toContain('contrasignar')
    const v = composaCorreuDocument({ ...base, tipo: 'CONV', subtipo: 'contrafirmat', numero_completo: 'CONV-DON-GEN-2026-0005' })!
    expect(v.assumpte).toContain('vigent')
  })
  it('el resumen no pide la factura, y el provisional lo dice', () => {
    const r = composaCorreuDocument({ ...base, tipo: 'RES', subtipo: 'provisional' })!
    expect(r.cosHtml.toLowerCase()).not.toContain('factura')
    expect(r.cosHtml).toContain('provisional')
  })
  it('el certificado a demanda habla del periodo, no del año', () => {
    const c = composaCorreuDocument({ ...base, objeto_tipo: 'cierre_periodo' })!
    expect(c.cosHtml).toContain('període')
  })
  describe('el certificado de donación, según su ámbito', () => {
    it('el anual: «de l’exercici AAAA»', () => {
      const c = composaCorreuDocument({ ...base, datos: { abast: 'exercici', periode: { des_de: '2026-01-01', fins_a: '2026-12-31' } } })!
      expect(c.assumpte).toBe('Certificat de donació de l’exercici 2026 · CD-2026-0001')
      expect(c.cosHtml).toContain('durant l’exercici 2026')
      const es = composaCorreuDocument({ ...base, idioma: 'es' })!
      expect(es.assumpte).toBe('Certificado de donación del ejercicio 2026 · CD-2026-0001')
    })
    it('el de un periodo: las dos fechas en dd/mm/aaaa', () => {
      const d = { abast: 'periode', periode: { des_de: '2026-03-01', fins_a: '2026-03-15' } }
      const c = composaCorreuDocument({ ...base, objeto_tipo: 'cierre_periodo', numero_completo: 'CDP-2026-0002', datos: d })!
      expect(c.assumpte).toBe('Certificat de donació del període 01/03/2026 – 15/03/2026 · CDP-2026-0002')
      expect(c.cosHtml).toContain('durant el període 01/03/2026 – 15/03/2026')
      const es = composaCorreuDocument({ ...base, objeto_tipo: 'cierre_periodo', idioma: 'es', numero_completo: 'CDP-2026-0002', datos: d })!
      expect(es.assumpte).toBe('Certificado de donación del periodo 01/03/2026 – 15/03/2026 · CDP-2026-0002')
    })
    it('el de una oferta: «de la teva donació del dd/mm/aaaa»', () => {
      const d = { abast: 'oferta', periode: { des_de: '2026-10-14', fins_a: '2026-10-14' } }
      const c = composaCorreuDocument({ ...base, objeto_tipo: 'cierre_periodo', numero_completo: 'CDP-2026-0003', datos: d })!
      expect(c.assumpte).toBe('Certificat de donació de la teva donació del 14/10/2026 · CDP-2026-0003')
      expect(c.cosHtml).toContain('de la donació del 14/10/2026')
      const es = composaCorreuDocument({ ...base, objeto_tipo: 'cierre_periodo', idioma: 'es', numero_completo: 'CDP-2026-0003', datos: d })!
      expect(es.assumpte).toBe('Certificado de donación de tu donación del 14/10/2026 · CDP-2026-0003')
      const dos = composaCorreuDocument({ ...base, objeto_tipo: 'cierre_periodo', datos: { abast: 'oferta', periode: { des_de: '2026-10-14', fins_a: '2026-10-16' } } })!
      expect(dos.assumpte).toContain('del 14/10/2026 al 16/10/2026')
    })
    it('lo de antes de `abast` se lee por `objeto_tipo`', () => {
      const c = composaCorreuDocument({ ...base, objeto_tipo: 'cierre_periodo', datos: { periode: { des_de: '2026-03-01', fins_a: '2026-03-15' } } })!
      expect(c.assumpte).toContain('del període 01/03/2026 – 15/03/2026')
    })
    it('ninguno menciona el modelo 182', () => {
      for (const abast of ['exercici', 'periode', 'oferta']) {
        for (const idioma of ['ca', 'es']) {
          const c = composaCorreuDocument({ ...base, idioma, datos: { abast, periode: { des_de: '2026-01-01', fins_a: '2026-12-31' } } })!
          expect(`${c.assumpte} ${c.cosHtml} ${c.nota}`).not.toContain('182')
        }
      }
    })
  })
  it('en castellano si el documento está en castellano', () => {
    const c = composaCorreuDocument({ ...base, idioma: 'es' })!
    expect(c.idioma).toBe('es')
    expect(c.titol).toBe('Tu certificado de donación')
  })
  it('el de prueba lo dice en el asunto y en el cuerpo', () => {
    const c = composaCorreuDocument({ ...base, numero_completo: 'P-CD-2026-0001', modo: 'prueba' })!
    expect(c.assumpte.startsWith('[PROVA] ')).toBe(true)
    expect(c.cosHtml).toContain('Document de prova')
  })
  it('escapa el nombre y el número, y el asunto va en texto plano', () => {
    const c = composaCorreuDocument({ ...base, numero_completo: 'CD<b>1', envio: { destinatario: 'x@y.z', nombre: '<script>' } })!
    expect(c.cosHtml).not.toContain('<script>')
    expect(c.cosHtml).toContain('&lt;script&gt;')
    expect(c.assumpte).toContain('CD<b>1')
    expect(c.fitxer).toBe('CD_b_1.pdf')
  })
})
