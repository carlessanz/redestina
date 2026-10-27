// El ciclo guiado de la canalización asistida: que diga lo que toca, y que lo diga en los
// dos idiomas.
//
// POR QUÉ HACE FALTA ESTA PRUEBA Y NO BASTA `cobertura.test.ts`. Aquel lee el código como
// texto y solo encuentra **literales**: `t('canal.albarans_t')` lo vería, pero
// `` t(`canal.${pas}_t`) `` no. Todas las claves de este módulo se componen, así que sin
// esto una fase sin traducir llegaría a producción y se leería en pantalla como
// `canal.albarans_t` — que es exactamente el fallo que `cobertura.test.ts` nació para
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

const AHIR = '2026-10-26T10:00:00Z'

/**
 * Una donación repartida entre DOS receptoras, aprobadas y con sus salidas en borrador: lo
 * que deja `aprovar_resposta()`. La primera tiene hora de recogida y la segunda, no.
 */
function dues(): FetsCanal {
  return {
    oferta: { estado: 'bloqueada', kg_total: 100, origen: null, modalitat: 'donacio' },
    conveni_gen: { id: 'c1', estado: 'vigent' },
    respostes: [
      {
        id: 'r1', entidad_id: 'e1', entitat: 'Menjador', estado: 'acceptada',
        aprovacio: 'aprovada', canalizacion_id: 'ca1', conveni_rec: { id: 'c2', estado: 'vigent' },
      },
      {
        id: 'r2', entidad_id: 'e2', entitat: 'Rebost', estado: 'acceptada',
        aprovacio: 'aprovada', canalizacion_id: 'ca2', conveni_rec: { id: 'c3', estado: 'vigent' },
      },
    ],
    canalitzacions: [
      { id: 'ca1', kg_conciliados: null, coste_kg: 1, estado: 'pendiente', data_hora_recollida: AHIR, recollida_registrada_at: null, recollida_validada_at: null },
      { id: 'ca2', kg_conciliados: null, coste_kg: 1, estado: 'pendiente', data_hora_recollida: null, recollida_registrada_at: null, recollida_validada_at: null },
    ],
    albarans: [
      { id: 'a1', tipo: 'REC', estado: 'borrador', numero: null, canalizacion_id: null },
      { id: 'a2', tipo: 'ENT', estado: 'borrador', numero: null, canalizacion_id: 'ca1' },
      { id: 'a3', tipo: 'ENT', estado: 'borrador', numero: null, canalizacion_id: 'ca2' },
    ],
    cost_falten: 0,
    exercici: null,
    dadesProvisionals: false,
  }
}

/** Una espigolada repartida: la jornada creó el REC y el reparto las salidas. */
function espigolada(): FetsCanal {
  return {
    ...base(),
    oferta: { estado: 'parcial', kg_total: 50, origen: 'espigolament' },
    conveni_gen: { id: 'c1', estado: 'vigent' },
    canalitzacions: [{ id: 'ca1', kg_conciliados: null, coste_kg: 1, data_hora_recollida: null }],
    albarans: [
      { id: 'a1', tipo: 'REC', estado: 'emitido', numero: 'REC-2026-9', canalizacion_id: null },
      { id: 'a2', tipo: 'ENT', estado: 'borrador', numero: null, canalizacion_id: 'ca1' },
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
          { id: 'a1', tipo: 'REC', estado: 'confirmado', numero: null, canalizacion_id: null, fora_tolerancia: true },
          { id: 'a2', tipo: 'ENT', estado: 'entregado', numero: null, canalizacion_id: 'ca1' },
        ],
      },
      // Sin canalizaciones: la recogida espera a que haya una.
      { ...base(), conveni_gen: { id: 'c1', estado: 'vigent' } },
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
      dues(), espigolada(), { ...dues(), canalitzacions: dues().canalitzacions.map((c) => ({ ...c, recollida_registrada_at: AHIR })) },
    ]
    for (const c of casos) for (const p of escalaCanal(c)) claus.add(clauPas(p))
    expect(claus.has('certificat_ct')).toBe(true)
    expect(claus.has('certificat_mixt')).toBe(true)
    for (const k of ['albarans_venda', 'albarans_validar', 'albarans_espigolada']) {
      expect(claus.has(k), k).toBe(true)
    }
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
      albarans: [
        { id: 'a1', tipo: 'REC', estado: 'anulado', numero: 'REC-2026-1', canalizacion_id: null },
        { id: 'a2', tipo: 'ENT', estado: 'conciliado', numero: 'ENT-2026-1', canalizacion_id: 'ca1' },
      ],
    }
    expect(escalaCanal(f).find((p) => p.pas === 'albarans')!.estat).not.toBe('fet')
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

  it('no le toca ni hora ni registro: sus albaranes los emite el equipo', () => {
    const escala = escalaCanal(espigolada())
    for (const pas of ['recollida_hora', 'recollida_registrar'] as const) {
      const p = escala.find((x) => x.pas === pas)!
      expect(p.estat, pas).toBe('fet')
      expect(p.motiuKey).toBe('canal.bl_espigolada')
    }
    const alb = escala.find((x) => x.pas === 'albarans')!
    expect(clauPas(alb)).toBe('albarans_espigolada')
    expect(alb.estat).toBe('ara')
  })
})

describe('la recogida de una donación con dos receptoras', () => {
  it('son cuatro pasos en la fase de lliurament, y la escalera tiene 17', () => {
    expect(PASSOS_CANAL).toHaveLength(17)
    expect(escalaCanal(dues()).filter((p) => p.fase === 4).map((p) => p.pas))
      .toEqual(['recollida_hora', 'recollida_registrar', 'albarans', 'conciliar'])
  })

  it('una entrega sin hora: toca fijarla, pero no bloquea registrar', () => {
    const escala = escalaCanal(dues())
    expect(escala.find((p) => p.pas === 'recollida_hora')!.estat).toBe('ara')
    expect(escala.find((p) => p.pas === 'recollida_registrar')!.estat).toBe('pendent')
  })

  it('una hora AUSENTE (el índice) no se da por pendiente; un null explícito, sí', () => {
    const f = dues()
    f.canalitzacions = f.canalitzacions.map(({ data_hora_recollida: _h, ...c }) => c)
    expect(escalaCanal(f).find((p) => p.pas === 'recollida_hora')!.estat).toBe('fet')
  })

  it('con las dos horas: toca registrar', () => {
    const f = dues()
    f.canalitzacions = f.canalitzacions.map((c) => ({ ...c, data_hora_recollida: AHIR }))
    expect(puntCanal(f).pas).toBe('recollida_registrar')
  })

  it('va al ritmo de la que va más atrás: con una validada y la otra sin registrar, falta registrar', () => {
    const f = dues()
    f.canalitzacions = [
      { ...f.canalitzacions[0], recollida_registrada_at: AHIR, recollida_validada_at: AHIR, kg_conciliados: 50 },
      { ...f.canalitzacions[1], data_hora_recollida: AHIR },
    ]
    f.albarans = f.albarans.map((a) => (a.id === 'a2' ? { ...a, estado: 'conciliado' as const, numero: 'ENT-1' } : a))
    expect(puntCanal(f).pas).toBe('recollida_registrar')
  })

  it('registrada por la receptora y sin validar: los albaranes dicen «valida-la»', () => {
    const f = dues()
    f.canalitzacions = f.canalitzacions.map((c) => ({ ...c, recollida_registrada_at: AHIR }))
    const escala = escalaCanal(f)
    expect(escala.find((p) => p.pas === 'recollida_hora')!.estat).toBe('fet')
    expect(escala.find((p) => p.pas === 'recollida_registrar')!.estat).toBe('fet')
    const alb = escala.find((p) => p.pas === 'albarans')!
    expect(clauPas(alb)).toBe('albarans_validar')
    expect(alb.estat).toBe('ara')
  })

  it('validadas las dos: albaranes y conciliación hechos, y el ciclo pasa al cierre', () => {
    const f = dues()
    f.canalitzacions = f.canalitzacions.map((c) => ({
      ...c, recollida_registrada_at: AHIR, recollida_validada_at: AHIR, kg_conciliados: 50,
    }))
    f.albarans = f.albarans.map((a) => ({ ...a, estado: 'conciliado' as const, numero: `${a.tipo}-1` }))
    const escala = escalaCanal(f)
    for (const pas of ['recollida_hora', 'recollida_registrar', 'albarans', 'conciliar'] as const) {
      expect(escala.find((p) => p.pas === pas)!.estat, pas).toBe('fet')
    }
    expect(puntCanal(f).fase).toBe(5)
  })

  it('un REC confirmado fuera de tolerancia bloquea la conciliación, y lo dice', () => {
    const f = dues()
    f.canalitzacions = f.canalitzacions.map((c) => ({
      ...c, recollida_registrada_at: AHIR, recollida_validada_at: AHIR,
    }))
    f.albarans = [
      { id: 'a1', tipo: 'REC', estado: 'confirmado', numero: 'REC-1', canalizacion_id: null, fora_tolerancia: true },
      { id: 'a2', tipo: 'ENT', estado: 'confirmado', numero: 'ENT-1', canalizacion_id: 'ca1' },
      { id: 'a3', tipo: 'ENT', estado: 'confirmado', numero: 'ENT-2', canalizacion_id: 'ca2' },
    ]
    const escala = escalaCanal(f)
    expect(escala.find((p) => p.pas === 'albarans')!.estat).toBe('fet')
    const c = escala.find((p) => p.pas === 'conciliar')!
    expect(c.estat).toBe('bloquejat')
    expect(c.motiuKey).toBe('canal.bl_fora_tolerancia')
  })

  it('una canalización anulada no frena nada', () => {
    const f = dues()
    f.canalitzacions = [
      { ...f.canalitzacions[0], recollida_registrada_at: AHIR, recollida_validada_at: AHIR, kg_conciliados: 50 },
      { ...f.canalitzacions[1], estado: 'anulada' },
    ]
    f.albarans = [
      { id: 'a1', tipo: 'REC', estado: 'conciliado', numero: 'REC-1', canalizacion_id: null },
      { id: 'a2', tipo: 'ENT', estado: 'conciliado', numero: 'ENT-1', canalizacion_id: 'ca1' },
      { id: 'a3', tipo: 'ENT', estado: 'anulado', numero: null, canalizacion_id: 'ca2' },
    ]
    for (const pas of ['recollida_hora', 'recollida_registrar', 'albarans', 'conciliar'] as const) {
      expect(escalaCanal(f).find((p) => p.pas === pas)!.estat, pas).toBe('fet')
    }
  })

  it('una salida confirmada por el circuito anterior cuenta como registrada', () => {
    const f = dues()
    f.albarans = f.albarans.map((a) => ({ ...a, estado: 'confirmado' as const, numero: `${a.tipo}-1` }))
    const escala = escalaCanal(f)
    expect(escala.find((p) => p.pas === 'recollida_registrar')!.estat).toBe('fet')
    expect(puntCanal(f).pas).toBe('conciliar')
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
  it('los albaranes no piden REC: con el OPE confirmado, el paso está hecho', () => {
    const escala = escalaCanal(venda())
    const p = escala.find((x) => x.pas === 'albarans')!
    expect(p.estat).toBe('fet')
    expect(clauPas(p)).toBe('albarans_venda')
    expect(escala.find((x) => x.pas === 'conciliar')!.estat).toBe('fet')
  })

  it('antes de haber albaranes, decide la modalidad de la oferta', () => {
    const f: FetsCanal = { ...base(), oferta: { estado: 'publicada', kg_total: 10, origen: null, modalitat: 'maquila' } }
    expect(certificatsDelLot(f)).toEqual({ donacio: false, transaccio: true })
  })

  it('con albaranes de salida, mandan ELLOS y no la modalidad principal', () => {
    // Una oferta de varias modalidades lleva `modalitat = 'donacio'` (la principal), pero si
    // la única entrega se aprobó como venta, el trigger creó un OPE y ningún REC.
    const f: FetsCanal = { ...venda(), oferta: { ...venda().oferta, modalitat: 'donacio' } }
    expect(certificatsDelLot(f)).toEqual({ donacio: false, transaccio: true })
    expect(clauPas(escalaCanal(f).find((p) => p.pas === 'albarans')!)).toBe('albarans_venda')
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

  it('un OPE confirmado sin conciliar: toca conciliar', () => {
    const f: FetsCanal = {
      ...venda(),
      canalitzacions: [{ id: 'ca1', kg_conciliados: null, coste_kg: null }],
      albarans: [{ id: 'a2', tipo: 'OPE', estado: 'confirmado', numero: 'OPE-2026-1', canalizacion_id: 'ca1' }],
    }
    expect(puntCanal(f).pas).toBe('conciliar')
  })

  it('una venta aprobada sin registrar: toca registrar la recogida, y no pide REC', () => {
    const f: FetsCanal = {
      ...venda(),
      canalitzacions: [{ id: 'ca1', kg_conciliados: null, coste_kg: null, data_hora_recollida: AHIR, recollida_registrada_at: null }],
      albarans: [{ id: 'a2', tipo: 'OPE', estado: 'borrador', numero: null, canalizacion_id: 'ca1' }],
    }
    expect(puntCanal(f).pas).toBe('recollida_registrar')
    expect(clauPas(escalaCanal(f).find((p) => p.pas === 'albarans')!)).toBe('albarans_venda')
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

  it('y el REC sí cuenta: sin él conciliado, los albaranes no están hechos', () => {
    const f: FetsCanal = {
      ...mixt(),
      albarans: mixt().albarans.map((a) => (a.tipo === 'REC' ? { ...a, estado: 'emitido' as const } : a)),
    }
    const p = escalaCanal(f).find((x) => x.pas === 'albarans')!
    expect(clauPas(p)).toBe('albarans')
    expect(p.estat).not.toBe('fet')
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
