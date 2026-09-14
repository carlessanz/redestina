// «Què toca ara» en las cuatro fichas largas del equipo.
//
// Mismo argumento que `procesOferta.test.ts`: las claves se componen (`alb.next_${estado}`,
// `tan.ds_${estado}`…), así que ninguna otra prueba las ve, y una traducción que falte
// saldría en pantalla como identificador con el build en verde.
//
// Además se comprueba algo que no es cosmético: que un REC y un ENT NO digan lo mismo en
// `entregado` ni en `confirmado`. Un REC entregado ya se puede conciliar y un ENT no; la
// conciliación de un ENT ni siquiera existe (se hace desde el REC del registro). Decir lo
// mismo en los dos manda al equipo a buscar un botón que no está.

import { describe, it, expect } from 'vitest'
import {
  ETAPES_ALBARA,
  ETAPES_CONVENI,
  ETAPES_DONANT,
  ETAPES_EXERCICI,
  PASSOS_ALBARA_CLAUS,
  PASSOS_CONVENI_CLAUS,
  PASSOS_DONANT_CLAUS,
  PASSOS_EXERCICI_CLAUS,
  seguentPasAlbara,
  seguentPasConveni,
  seguentPasDonant,
  seguentPasExercici,
} from '../src/lib/seguentPas'
import type { EstatExercici } from '../src/lib/seguentPas'
import type { PuntProces } from '../src/lib/procesOferta'
import { DICTS } from '../src/lib/i18n'
import type { ConvenioEstado, EstadoAlbaran, EstatCierreDonante } from '../src/types'

const ALBARA_TOTS: EstadoAlbaran[] = [
  'borrador', 'emitido', 'entregado', 'confirmado', 'conciliado', 'anulado', 'rectificado',
]
const CONVENI_TOTS: ConvenioEstado[] = [
  'esborrany', 'pendent_firma', 'firmat', 'vigent', 'retornat', 'resolt', 'substituit',
]
const EXERCICI_TOTS: EstatExercici[] = ['obert', 'provisional', 'tancat', 'declarat']

/** Todos los puntos de las cuatro máquinas, con nombre para el informe del `it.each`. */
const PUNTS: { nom: string; punt: PuntProces }[] = [
  ...ALBARA_TOTS.flatMap((estado) => ([
    { nom: `REC/${estado}`, punt: seguentPasAlbara({ tipo: 'REC' as const, estado, diesEntregat: 4, motiu: 'Error' }) },
    { nom: `ENT/${estado}`, punt: seguentPasAlbara({ tipo: 'ENT' as const, estado, diesEntregat: 4, motiu: 'Error' }) },
    { nom: `OPE/${estado}`, punt: seguentPasAlbara({ tipo: 'OPE' as const, estado, diesEntregat: 4, motiu: 'Error' }) },
  ])),
  ...CONVENI_TOTS.map((estado) => ({
    nom: `conveni/${estado}`,
    punt: seguentPasConveni({ estado, nom: 'Anna', carrec: 'Presidenta', data: '12/03/2026', motiu: 'NIF' }),
  })),
  { nom: 'exercici/obert sense càlcul', punt: seguentPasExercici({ estado: 'obert', calculat: false, bloquejats: 0 }) },
  { nom: 'exercici/obert bloquejats', punt: seguentPasExercici({ estado: 'obert', calculat: true, bloquejats: 3 }) },
  { nom: 'exercici/obert net', punt: seguentPasExercici({ estado: 'obert', calculat: true, bloquejats: 0 }) },
  ...(['provisional', 'tancat', 'declarat'] as EstatExercici[]).map((estado) => ({
    nom: `exercici/${estado}`, punt: seguentPasExercici({ estado, calculat: true, bloquejats: 0 }),
  })),
  ...ETAPES_DONANT.map((estado) => ({
    nom: `donant/${estado}`, punt: seguentPasDonant({ estado, importe: '1.234,00 €' }),
  })),
]

describe('seguentPasAlbara', () => {
  it('cada estado cae en su paso, y anulado/rectificado fuera del camino', () => {
    for (const estado of ALBARA_TOTS) {
      const p = seguentPasAlbara({ tipo: 'REC', estado })
      const esperat = (ETAPES_ALBARA as readonly string[]).indexOf(estado)
      expect([p.etapa, p.index], estado).toEqual([estado, esperat])
    }
    expect(seguentPasAlbara({ tipo: 'REC', estado: 'anulado' }).index).toBe(-1)
    expect(seguentPasAlbara({ tipo: 'REC', estado: 'rectificado' }).index).toBe(-1)
  })

  // La divergencia que importa: no es un matiz de redacción, es qué botón existe.
  it('REC y ENT NO dicen lo mismo en entregado ni en confirmado', () => {
    for (const estado of ['entregado', 'confirmado'] as EstadoAlbaran[]) {
      const rec = seguentPasAlbara({ tipo: 'REC', estado, diesEntregat: 2 })
      const ent = seguentPasAlbara({ tipo: 'ENT', estado, diesEntregat: 2 })
      expect(rec.claus.toca, estado).not.toBe(ent.claus.toca)
      // Y solo el REC pide acción del equipo: el ENT solo puede esperar.
      expect(rec.emToca, estado).toBe(true)
      expect(ent.emToca, estado).toBe(false)
    }
  })

  it('el OPE se cuenta como el ENT: tampoco se concilia desde él', () => {
    for (const estado of ['entregado', 'confirmado'] as EstadoAlbaran[]) {
      const ent = seguentPasAlbara({ tipo: 'ENT', estado })
      const ope = seguentPasAlbara({ tipo: 'OPE', estado })
      expect(ope.claus.toca, estado).toBe(ent.claus.toca)
    }
  })

  it('los días de espera viajan como var; sin ellos, cero y no «undefined»', () => {
    expect(seguentPasAlbara({ tipo: 'REC', estado: 'entregado', diesEntregat: 9 }).vars.n).toBe(9)
    expect(seguentPasAlbara({ tipo: 'ENT', estado: 'entregado' }).vars.n).toBe(0)
  })
})

describe('seguentPasConveni', () => {
  it('cada estado tiene su punto, y «retornat» vuelve al paso 0', () => {
    for (const estado of CONVENI_TOTS) {
      expect(seguentPasConveni({ estado }).etapa, estado).toBe(estado)
    }
    expect(seguentPasConveni({ estado: 'retornat' }).index).toBe(0)
    expect(seguentPasConveni({ estado: 'resolt' }).index).toBe(-1)
    expect(seguentPasConveni({ estado: 'substituit' }).index).toBe(-1)
  })

  it('quien firmó sale en las vars; sin nombre, un guion y no «null»', () => {
    const amb = seguentPasConveni({ estado: 'firmat', nom: 'Anna', carrec: 'Presidenta' })
    expect(amb.vars).toEqual({ nom: 'Anna', carrec: 'Presidenta' })
    expect(seguentPasConveni({ estado: 'firmat' }).vars).toEqual({ nom: '—', carrec: '—' })
  })

  it('los tres estados con acción del equipo son los que la tienen', () => {
    const ambAccio = CONVENI_TOTS.filter((e) => seguentPasConveni({ estado: e }).emToca)
    expect(ambAccio).toEqual(['esborrany', 'firmat', 'retornat'])
  })
})

describe('seguentPasExercici: «obert» son tres situaciones, no una', () => {
  it('sin calcular, con bloqueos y limpio dicen cosas distintas', () => {
    const a = seguentPasExercici({ estado: 'obert', calculat: false, bloquejats: 0 })
    const b = seguentPasExercici({ estado: 'obert', calculat: true, bloquejats: 3 })
    const c = seguentPasExercici({ estado: 'obert', calculat: true, bloquejats: 0 })
    expect([a.etapa, b.etapa, c.etapa])
      .toEqual(['obert_sense_calcul', 'obert_bloquejats', 'obert_net'])
    expect(new Set([a.claus.toca, b.claus.toca, c.claus.toca]).size).toBe(3)
    // Los tres son el mismo paso del cierre: lo que cambia es qué botón toca.
    expect([a.index, b.index, c.index]).toEqual([0, 0, 0])
    expect(b.vars.n).toBe(3)
  })

  it('los otros tres estados van uno a uno, y `declarat` no pide nada', () => {
    for (const estado of ['provisional', 'tancat', 'declarat'] as EstatExercici[]) {
      const p = seguentPasExercici({ estado, calculat: true, bloquejats: 0 })
      expect([p.etapa, p.index], estado)
        .toEqual([estado, (ETAPES_EXERCICI as readonly string[]).indexOf(estado)])
    }
    expect(seguentPasExercici({ estado: 'declarat', calculat: true, bloquejats: 0 }).emToca).toBe(false)
  })
})

describe('seguentPasDonant', () => {
  it('los nueve estados tienen su punto en orden', () => {
    ETAPES_DONANT.forEach((estado, i) => {
      const p = seguentPasDonant({ estado })
      expect([p.etapa, p.index], estado).toEqual([estado, i])
    })
  })

  it('solo `factura_pendent` lleva importe, y sin él un guion', () => {
    expect(seguentPasDonant({ estado: 'factura_pendent', importe: '120,00 €' }).vars)
      .toEqual({ import: '120,00 €' })
    expect(seguentPasDonant({ estado: 'factura_pendent' }).vars).toEqual({ import: '—' })
    expect(seguentPasDonant({ estado: 'enviat', importe: '120,00 €' }).vars).toEqual({})
  })

  it('los estados finales no piden nada al equipo', () => {
    for (const estado of ['resum_enviat', 'enviat', 'declarat'] as EstatCierreDonante[]) {
      expect(seguentPasDonant({ estado }).emToca, estado).toBe(false)
    }
  })
})

describe('todas las claves existen en ca y en es', () => {
  it.each(PUNTS)('$nom', ({ punt }) => {
    for (const clau of Object.values(punt.claus)) {
      expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
      expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
    }
  })

  it('las etiquetas de los pasos de las cuatro máquinas también', () => {
    const totes = [
      ...PASSOS_ALBARA_CLAUS, ...PASSOS_CONVENI_CLAUS,
      ...PASSOS_EXERCICI_CLAUS, ...PASSOS_DONANT_CLAUS,
    ]
    for (const clau of totes) {
      expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
      expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
    }
    expect(PASSOS_ALBARA_CLAUS).toHaveLength(ETAPES_ALBARA.length)
    expect(PASSOS_CONVENI_CLAUS).toHaveLength(ETAPES_CONVENI.length)
    expect(PASSOS_EXERCICI_CLAUS).toHaveLength(EXERCICI_TOTS.length)
    expect(PASSOS_DONANT_CLAUS).toHaveLength(ETAPES_DONANT.length)
  })

  // Los motivos de botón deshabilitado viven en el mismo módulo que el «qué toca»: si
  // están en dos sitios, acaban contradiciéndose.
  it('los motivos de botón deshabilitado están traducidos', () => {
    const motius = [
      'alb.why_emit_first', 'alb.why_deliver_first', 'alb.why_only_rec',
      'alb.why_no_cancel', 'alb.why_only_emitted',
      'tan.why_blocked', 'tan.why_no_invoice', 'tan.why_close_first',
    ]
    for (const clau of motius) {
      expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
      expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
    }
  })
})

describe('los marcadores {x} y las vars son el mismo juego', () => {
  const marcadores = (texto: string) =>
    [...new Set(texto.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [])].map((m) => m.slice(1, -1)).sort()

  it.each(PUNTS)('$nom', ({ punt }) => {
    for (const idioma of ['ca', 'es'] as const) {
      const usats = new Set<string>()
      for (const clau of Object.values(punt.claus)) {
        for (const m of marcadores(DICTS[idioma][clau] ?? '')) usats.add(m)
      }
      expect([...usats].sort(), `${idioma}`).toEqual(Object.keys(punt.vars).sort())
    }
  })
})
