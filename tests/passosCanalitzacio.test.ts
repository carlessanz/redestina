// El ciclo guiado de la canalización asistida: que diga lo que toca, y que lo diga en los
// dos idiomas.
//
// POR QUÉ HACE FALTA ESTA PRUEBA Y NO BASTA `cobertura.test.ts`. Aquel lee el código como
// texto y solo encuentra **literales**: `t('canal.rec_emetre_t')` lo vería, pero
// `` t(`canal.${pas}_t`) `` no. Todas las claves de este módulo se componen, así que sin
// esto una fase sin traducir llegaría a producción y se leería en pantalla como
// `canal.rec_emetre_t` — que es exactamente el fallo que `cobertura.test.ts` nació para
// impedir, solo que por la puerta que no vigila.
//
// Lo segundo que se comprueba es el ORDEN de las comprobaciones, que en este módulo ES la
// regla de negocio: el convenio del generador bloquea la oferta, el de la receptora bloquea
// la aprobación, el albarán manda sobre el estado del excedente y sin conciliar no hay
// certificado. Un test que solo mirara las claves dejaría pasar un reordenamiento que
// cambia el producto sin romper nada.

import { describe, it, expect } from 'vitest'
import { DICTS } from '../src/lib/i18n'
import {
  certificatsDelLot, clauPas, escalaCanal, PASSOS_CANAL, PASSOS_FASE_CLAUS, puntCanal,
} from '../src/lib/passosCanalitzacio'
import type { FetsCanal } from '../src/lib/passosCanalitzacio'

const IDIOMES = ['ca', 'es'] as const

/** Un lote recién nacido: sin convenio, sin respuestas, sin albaranes. */
function base(): FetsCanal {
  return {
    oferta: { estado: 'publicada', kg_total: 100, origen: null },
    conveni_gen: null,
    respostes: [],
    canalitzacions: [],
    albarans: [],
    cost_falten: 0,
    exercici: null,
  }
}

/**
 * Una venta entera hecha: sin REC (no existe en venta y maquila) y con su OPE conciliado.
 * Ejercicio en prueba y cerrado, para que el último escalón sea el que se mira.
 */
function venda(): FetsCanal {
  return {
    oferta: { estado: 'bloqueada', kg_total: 100, origen: null, modalitat: 'venda' },
    conveni_gen: { id: 'c1', estado: 'vigent' },
    respostes: [{
      id: 'r1', entidad_id: 'e1', entitat: 'Obrador', estado: 'acceptada',
      aprovacio: 'aprovada', canalizacion_id: 'ca1',
      conveni_rec: { id: 'c2', estado: 'vigent' },
    }],
    canalitzacions: [{ id: 'ca1', kg_conciliados: 100, coste_kg: null }],
    albarans: [
      { id: 'a2', tipo: 'OPE', estado: 'conciliado', numero: 'OPE-2026-1', canalizacion_id: 'ca1' },
    ],
    // El coste falta a propósito: en venta no debe frenar nada.
    cost_falten: 1,
    exercici: { estado: 'tancat', modo: 'prueba' },
    dadesProvisionals: true,
  }
}

/** Una oferta de varias modalidades con una entrega de cada: pide los dos certificados. */
function mixt(): FetsCanal {
  const c = complet()
  return {
    ...c,
    canalitzacions: [...c.canalitzacions, { id: 'ca2', kg_conciliados: 50, coste_kg: null }],
    albarans: [
      ...c.albarans,
      { id: 'a3', tipo: 'OPE', estado: 'conciliado', numero: 'OPE-2026-2', canalizacion_id: 'ca2' },
    ],
  }
}

/** El ciclo entero hecho, salvo lo que cada prueba retire. */
function complet(): FetsCanal {
  return {
    oferta: { estado: 'bloqueada', kg_total: 100, origen: null },
    conveni_gen: { id: 'c1', estado: 'vigent' },
    respostes: [{
      id: 'r1', entidad_id: 'e1', entitat: 'Menjador', estado: 'acceptada',
      aprovacio: 'aprovada', canalizacion_id: 'ca1',
      conveni_rec: { id: 'c2', estado: 'vigent' },
    }],
    canalitzacions: [{ id: 'ca1', kg_conciliados: 100, coste_kg: 1 }],
    albarans: [
      { id: 'a1', tipo: 'REC', estado: 'conciliado', numero: 'REC-2026-1', canalizacion_id: null },
      { id: 'a2', tipo: 'ENT', estado: 'conciliado', numero: 'ENT-2026-1', canalizacion_id: 'ca1' },
    ],
    cost_falten: 0,
    exercici: { estado: 'declarat', modo: 'real' },
    dadesProvisionals: false,
  }
}

describe('claves i18n', () => {
  it('cada paso tiene título, qué pasa y qué toca en ca y es', () => {
    for (const pas of PASSOS_CANAL) {
      for (const sufix of ['_t', '_passa', '_toca']) {
        for (const idioma of IDIOMES) {
          const clau = `canal.${pas}${sufix}`
          expect(DICTS[idioma][clau], `falta ${clau} en ${idioma}`).toBeTruthy()
        }
      }
    }
  })

  it('los motivos de bloqueo que el módulo puede devolver existen en los dos idiomas', () => {
    // Se recogen EJECUTANDO el módulo, no leyéndolo: así una rama nueva que devuelva un
    // motivo sin traducir cae aquí sola, sin que nadie tenga que acordarse de listarlo.
    const motius = new Set<string>()
    const casos: FetsCanal[] = [
      base(),
      { ...base(), oferta: { estado: 'cancelada', kg_total: 10, origen: null } },
      { ...base(), oferta: { estado: 'no_colocada', kg_total: 10, origen: null } },
      { ...base(), oferta: { estado: 'publicada', kg_total: 10, origen: 'espigolament' } },
      { ...complet(), cost_falten: 2 },
      { ...complet(), dadesProvisionals: true },
      {
        ...complet(),
        canalitzacions: [{ id: 'ca1', kg_conciliados: null, coste_kg: 1 }],
        albarans: [
          { id: 'a1', tipo: 'REC', estado: 'confirmado', numero: null, canalizacion_id: null },
          { id: 'a2', tipo: 'ENT', estado: 'entregado', numero: null, canalizacion_id: 'ca1' },
        ],
      },
      {
        ...complet(),
        respostes: [{
          id: 'r1', entidad_id: 'e1', entitat: 'Menjador', estado: 'acceptada',
          aprovacio: 'pendent', canalizacion_id: null, conveni_rec: null,
        }],
      },
      // Los motivos de la venta, la validación y el certificado bloqueado en el cierre.
      venda(),
      { ...base(), conveni_gen: { id: 'c1', estado: 'vigent' }, oferta: { estado: 'pendent_validacio', kg_total: 10, origen: null } },
      {
        ...complet(), exercici: { estado: 'tancat', modo: 'prueba' },
        certificats: [{ tipo: 'donacio', certificado_numero: null, bloqueja: true }],
      },
    ]
    for (const c of casos) {
      for (const p of escalaCanal(c)) if (p.motiuKey) motius.add(p.motiuKey)
    }
    expect(motius.size).toBeGreaterThan(5)
    for (const clau of motius) {
      for (const idioma of IDIOMES) {
        expect(DICTS[idioma][clau], `falta ${clau} en ${idioma}`).toBeTruthy()
      }
    }
  })

  it('las variantes de clave de un paso (`clau`) existen en los dos idiomas', () => {
    // El certificado de una venta es el CT, y el cierre sin donación no pide resumen: esas
    // variantes se componen igual que las normales y tampoco las ve `cobertura.test.ts`.
    const claus = new Set<string>()
    const casos: FetsCanal[] = [
      venda(), mixt(), complet(), { ...venda(), oferta: { ...venda().oferta, modalitat: 'maquila' } },
    ]
    for (const c of casos) for (const p of escalaCanal(c)) claus.add(clauPas(p))
    expect(claus.has('certificat_ct')).toBe(true)
    expect(claus.has('certificat_mixt')).toBe(true)
    for (const clau of claus) {
      for (const sufix of ['_t', '_passa', '_toca']) {
        for (const idioma of IDIOMES) {
          expect(DICTS[idioma][`canal.${clau}${sufix}`], `falta canal.${clau}${sufix} en ${idioma}`).toBeTruthy()
        }
      }
    }
  })

  it('las seis fases se reutilizan de FASES_EQUIP y están traducidas', () => {
    expect(PASSOS_FASE_CLAUS).toHaveLength(6)
    for (const clau of PASSOS_FASE_CLAUS) {
      for (const idioma of IDIOMES) expect(DICTS[idioma][clau]).toBeTruthy()
    }
  })
})

describe('la escalera', () => {
  it('devuelve todos los pasos, siempre, en el mismo orden', () => {
    const e = escalaCanal(base())
    expect(e).toHaveLength(PASSOS_CANAL.length)
    expect(e.map((x) => x.pas)).toEqual([...PASSOS_CANAL])
  })

  it('hay como mucho un paso «ara»', () => {
    for (const f of [base(), complet(), { ...complet(), cost_falten: 3 }]) {
      expect(escalaCanal(f).filter((p) => p.estat === 'ara').length).toBeLessThanOrEqual(1)
    }
  })

  it('un lote nuevo empieza por preparar el convenio del generador', () => {
    const punt = puntCanal(base())
    expect(punt.pas).toBe('conv_gen_preparar')
    expect(punt.fase).toBe(0)
    expect(punt.emToca).toBe(true)
  })

  it('con el convenio firmado pero sin contrafirmar, toca contrafirmar', () => {
    const f = { ...base(), conveni_gen: { id: 'c1', estado: 'firmat' as const } }
    expect(puntCanal(f).pas).toBe('conv_gen_contrasignar')
  })
})

describe('el orden de las comprobaciones es la regla de negocio', () => {
  it('sin convenio vigente del generador, publicar está BLOQUEADO y no solo pendiente', () => {
    const f = { ...base(), conveni_gen: { id: 'c1', estado: 'vigent' as const }, oferta: { estado: 'borrador' as const, kg_total: 10, origen: null } }
    const senseConveni = { ...f, conveni_gen: { id: 'c1', estado: 'pendent_firma' as const } }
    const pas = escalaCanal(senseConveni).find((p) => p.pas === 'oferta_publicar')!
    expect(pas.estat).toBe('bloquejat')
    expect(pas.motiuKey).toBe('canal.bl_sense_conveni_gen')
  })

  it('una receptora sin convenio vigente bloquea la aprobación, no la distribución', () => {
    const f: FetsCanal = {
      ...complet(),
      respostes: [{
        id: 'r1', entidad_id: 'e1', entitat: 'Menjador', estado: 'acceptada',
        aprovacio: 'pendent', canalizacion_id: null, conveni_rec: null,
      }],
    }
    const escala = escalaCanal(f)
    expect(escala.find((p) => p.pas === 'distribuir')!.estat).toBe('fet')
    expect(escala.find((p) => p.pas === 'aprovar')!.estat).toBe('bloquejat')
  })

  it('un REC anulado NO cuenta como entrada hecha', () => {
    const f: FetsCanal = {
      ...complet(),
      albarans: [{ id: 'a1', tipo: 'REC', estado: 'anulado', numero: 'REC-2026-1', canalizacion_id: null }],
    }
    expect(escalaCanal(f).find((p) => p.pas === 'rec_emetre')!.estat).not.toBe('fet')
  })

  it('sin coste por kilo, el cierre está bloqueado', () => {
    const f = { ...complet(), cost_falten: 1, exercici: { estado: 'obert', modo: 'real' } }
    const pas = escalaCanal(f).find((p) => p.pas === 'tancament')!
    expect(pas.estat).toBe('bloquejat')
    expect(pas.motiuKey).toBe('canal.bl_sense_cost')
  })

  it('con datos fiscales provisionales el certificado está bloqueado, y lo dice', () => {
    // Ejercicio `tancat` y no `declarat`: un ejercicio declarado significa que el
    // certificado YA se emitió, y entonces no hay nada que bloquear.
    const f: FetsCanal = {
      ...complet(), exercici: { estado: 'tancat', modo: 'real' }, dadesProvisionals: true,
    }
    const pas = escalaCanal(f).find((p) => p.pas === 'certificat')!
    expect(pas.estat).toBe('bloquejat')
    expect(pas.motiuKey).toBe('canal.bl_dades_provisionals')
  })

  it('en modo PRUEBA los datos provisionales ya NO bloquean el certificado', () => {
    // Decisión del cliente del 21-09-2026, y la base hace lo mismo desde
    // `20270328100900`. Un documento `modo = 'prueba'` usa serie `P-CD`, sale con marca de
    // agua y solo llega a fichas `es_test` o al buzón del equipo, así que no puede
    // alcanzar a un donante real: exigirle los datos fiscales de verdad solo conseguía que
    // el último escalón de la guía de prueba fuera inalcanzable para siempre.
    const f: FetsCanal = {
      ...complet(), exercici: { estado: 'tancat', modo: 'prueba' }, dadesProvisionals: true,
    }
    const pas = escalaCanal(f).find((p) => p.pas === 'certificat')!
    expect(pas.estat).not.toBe('bloquejat')
  })

  it('y en REAL siguen bloqueando aunque el resto del ciclo esté completo', () => {
    // El contraste del anterior: lo que se relajó es el MODO, no la regla.
    const f: FetsCanal = {
      ...complet(), exercici: { estado: 'tancat', modo: 'real' }, dadesProvisionals: true,
    }
    expect(escalaCanal(f).find((p) => p.pas === 'certificat')!.estat).toBe('bloquejat')
  })

  it('sin decir nada de los datos fiscales se asume lo PEOR, no lo cómodo', () => {
    // `dadesProvisionals` sin pasar = provisional. Un certificado emitido con un CIF
    // inválido es el único error caro de los dos.
    const f: FetsCanal = { ...complet(), exercici: { estado: 'tancat', modo: 'real' } }
    delete f.dadesProvisionals
    expect(escalaCanal(f).find((p) => p.pas === 'certificat')!.estat).toBe('bloquejat')
  })
})

describe('una espigolada no recorre las seis fases', () => {
  const f: FetsCanal = {
    ...base(),
    oferta: { estado: 'publicada', kg_total: 50, origen: 'espigolament' },
    conveni_gen: { id: 'c1', estado: 'vigent' },
  }

  it('sus fases 2-4 salen HECHAS con su motivo, nunca pendientes', () => {
    const escala = escalaCanal(f)
    for (const pas of ['oferta_publicar', 'distribuir', 'interes', 'conv_rec', 'aprovar'] as const) {
      const p = escala.find((x) => x.pas === pas)!
      expect(p.estat, `${pas} debería estar hecho en una espigolada`).toBe('fet')
      expect(p.motiuKey).toBe('canal.bl_espigolada')
    }
  })

  it('entra al ciclo por la fase de lliurament', () => {
    expect(puntCanal(f).fase).toBe(4)
  })
})

describe('una oferta cancelada no sigue', () => {
  it('publicar queda bloqueado con el motivo de su estado', () => {
    const f = { ...base(), conveni_gen: { id: 'c1', estado: 'vigent' as const }, oferta: { estado: 'cancelada' as const, kg_total: 10, origen: null } }
    const pas = escalaCanal(f).find((p) => p.pas === 'oferta_publicar')!
    expect(pas.estat).toBe('bloquejat')
    expect(pas.motiuKey).toBe('canal.bl_cancelada')
  })
})

describe('el ciclo completo', () => {
  it('no deja ningún paso «ara» y lo dice con su propio texto', () => {
    const punt = puntCanal(complet())
    expect(punt.pas).toBeNull()
    expect(punt.claus.titol).toBe('canal.complet_t')
    for (const idioma of IDIOMES) {
      expect(DICTS[idioma]['canal.complet_t']).toBeTruthy()
      expect(DICTS[idioma]['canal.complet_passa']).toBeTruthy()
      expect(DICTS[idioma]['canal.complet_toca']).toBeTruthy()
    }
  })
})

describe('venta y maquila: sin REC, y el certificado es el CT', () => {
  it('los cuatro pasos del REC salen HECHOS con su motivo, no esperando para siempre', () => {
    const escala = escalaCanal(venda())
    for (const pas of ['rec_emetre', 'rec_entregat', 'rec_confirmar', 'rec_conciliar'] as const) {
      const p = escala.find((x) => x.pas === pas)!
      expect(p.estat, `${pas} no aplica en venta`).toBe('fet')
      expect(p.motiuKey).toBe('canal.bl_sense_rec_venda')
    }
  })

  it('antes de haber albaranes, decide la modalidad de la oferta', () => {
    const f: FetsCanal = { ...base(), oferta: { estado: 'publicada', kg_total: 10, origen: null, modalitat: 'maquila' } }
    expect(escalaCanal(f).find((p) => p.pas === 'rec_emetre')!.estat).toBe('fet')
    expect(certificatsDelLot(f)).toEqual({ donacio: false, transaccio: true })
  })

  it('con albaranes de salida, mandan ELLOS y no la modalidad principal', () => {
    // Una oferta de varias modalidades lleva `modalitat = 'donacio'` (la principal), pero si
    // la única entrega se aprobó como venta, el trigger creó un OPE y ningún REC.
    const f: FetsCanal = { ...venda(), oferta: { ...venda().oferta, modalitat: 'donacio' } }
    expect(certificatsDelLot(f)).toEqual({ donacio: false, transaccio: true })
    expect(escalaCanal(f).find((p) => p.pas === 'rec_emetre')!.motiuKey).toBe('canal.bl_sense_rec_venda')
  })

  it('una oferta sin modalidad conocida se trata como donación, como siempre', () => {
    expect(certificatsDelLot(base())).toEqual({ donacio: true, transaccio: false })
  })

  it('el coste por kilo no frena una venta: el CT no lleva importes', () => {
    const escala = escalaCanal(venda())
    const cost = escala.find((p) => p.pas === 'cost')!
    expect(cost.estat).toBe('fet')
    expect(cost.motiuKey).toBe('canal.bl_cost_no_cal')
    expect(escala.find((p) => p.pas === 'tancament')!.estat).toBe('fet')
  })

  it('el último escalón apunta al CT, y en prueba los datos provisionales no lo bloquean', () => {
    const cert = escalaCanal(venda()).find((p) => p.pas === 'certificat')!
    expect(clauPas(cert)).toBe('certificat_ct')
    expect(cert.estat).toBe('ara')
    expect(puntCanal(venda()).claus.titol).toBe('canal.certificat_ct_t')
  })

  it('en REAL con datos provisionales, el CT también está bloqueado', () => {
    const f: FetsCanal = { ...venda(), exercici: { estado: 'tancat', modo: 'real' } }
    const cert = escalaCanal(f).find((p) => p.pas === 'certificat')!
    expect(cert.estat).toBe('bloquejat')
    expect(cert.motiuKey).toBe('canal.bl_dades_provisionals')
  })

  it('con el CT emitido en el cierre, el ciclo está completo', () => {
    const f: FetsCanal = {
      ...venda(),
      certificats: [{ tipo: 'transaccio', certificado_numero: 'P-CT-2026-0001', bloqueja: false }],
    }
    expect(escalaCanal(f).find((p) => p.pas === 'certificat')!.estat).toBe('fet')
    expect(puntCanal(f).pas).toBeNull()
  })

  it('con el CT bloqueado en el cierre, el escalón lo dice', () => {
    const f: FetsCanal = {
      ...venda(),
      certificats: [{ tipo: 'transaccio', certificado_numero: null, bloqueja: true }],
    }
    const cert = escalaCanal(f).find((p) => p.pas === 'certificat')!
    expect(cert.estat).toBe('bloquejat')
    expect(cert.motiuKey).toBe('canal.bl_certificat_bloquejat')
  })

  it('un OPE confirmado sin conciliar: toca conciliar las salidas', () => {
    const f: FetsCanal = {
      ...venda(),
      canalitzacions: [{ id: 'ca1', kg_conciliados: null, coste_kg: null }],
      albarans: [{ id: 'a2', tipo: 'OPE', estado: 'confirmado', numero: 'OPE-2026-1', canalizacion_id: 'ca1' }],
    }
    expect(puntCanal(f).pas).toBe('ent_conciliar')
  })
})

describe('una oferta con donación y venta pide los dos certificados', () => {
  it('el escalón dice los dos, y no está hecho con solo uno emitido', () => {
    const f: FetsCanal = {
      ...mixt(), exercici: { estado: 'tancat', modo: 'prueba' },
      certificats: [
        { tipo: 'donacio', certificado_numero: 'P-CD-2026-0001', bloqueja: false },
        { tipo: 'transaccio', certificado_numero: null, bloqueja: false },
      ],
    }
    const cert = escalaCanal(f).find((p) => p.pas === 'certificat')!
    expect(clauPas(cert)).toBe('certificat_mixt')
    expect(cert.estat).not.toBe('fet')
  })

  it('y los pasos del REC sí aplican', () => {
    expect(escalaCanal(mixt()).find((p) => p.pas === 'rec_emetre')!.motiuKey).toBeUndefined()
  })
})

describe('una oferta pendiente de validación', () => {
  const f: FetsCanal = {
    ...base(),
    conveni_gen: { id: 'c1', estado: 'vigent' },
    oferta: { estado: 'pendent_validacio', kg_total: 10, origen: null },
  }

  it('NO cuenta como publicada: toca validarla', () => {
    expect(puntCanal(f).pas).toBe('oferta_validar')
    expect(puntCanal(f).emToca).toBe(true)
  })

  it('la distribución queda bloqueada con su motivo visible', () => {
    const p = escalaCanal(f).find((x) => x.pas === 'distribuir')!
    expect(p.estat).toBe('bloquejat')
    expect(p.motiuKey).toBe('canal.bl_pendent_validacio')
  })

  it('una vez validada (publicada), el paso está hecho', () => {
    const v = { ...f, oferta: { ...f.oferta, estado: 'publicada' as const } }
    expect(escalaCanal(v).find((x) => x.pas === 'oferta_validar')!.estat).toBe('fet')
  })
})
