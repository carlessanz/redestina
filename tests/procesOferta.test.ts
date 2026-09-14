// El proceso de una oferta, comprobado caso por caso.
//
// DOS COSAS SE PRUEBAN AQUÍ, y la segunda es la que de verdad justifica el fichero:
//
//   1. LA DERIVACIÓN. Qué etapa sale de cada combinación de estado, albarán y kilos. Es
//      la regla de negocio escrita en código, y el orden de las comprobaciones es parte de
//      ella: las salidas ganan a todo, el albarán manda sobre el estado del excedente y el
//      aviso de vencida solo desplaza a las dos primeras etapas.
//
//   2. QUE LAS CLAVES EXISTAN EN LOS DOS IDIOMAS. `procesOferta.ts` COMPONE sus claves
//      (`proc.${rol}_${etapa}_${parte}`), así que `cobertura.test.ts` —que busca literales
//      `t('...')`— no las ve ninguna. Sin esta comprobación, una etapa nueva sin traducir
//      saldría en pantalla como `proc.e_loquesea_toca` con el build en verde, que es
//      exactamente el fallo de la deuda §12.82. Mismo motivo que `documentsPanell.test.ts`.
//
// Y una tercera, barata y silenciosa: que los `{marcadores}` de cada texto coincidan con
// las `vars` que se devuelven. Un `{n}` sin su var se pinta crudo en pantalla, y una var
// sin su `{n}` es un dato que desaparece sin dar ningún error (`t()` no avisa).

import { describe, it, expect } from 'vitest'
import {
  ETAPES_INTERES,
  ETAPES_OFERTA,
  ESTATS_OFERTA,
  FASES_EQUIP,
  PASSOS_INTERES_CLAUS,
  PASSOS_OFERTA_CLAUS,
  etiquetaEstatOferta,
  llegendaOferta,
  puntInteres,
  puntOferta,
} from '../src/lib/procesOferta'
import type { FetsInteres, FetsOferta, PuntProces, RolMira } from '../src/lib/procesOferta'
import { DICTS } from '../src/lib/i18n'
import { readFileSync } from 'node:fs'
import type { EstadoAlbaran, EstadoExcedente } from '../src/types'

const base: FetsOferta = { estado: 'publicada', kgTotal: 100, kgCanalitzats: 0 }
const rec = (estado: EstadoAlbaran, numero = 'REC-2026-00001', diesEsperant: number | null = 3) =>
  ({ estado, numero, diesEsperant })

/** Marcadores `{x}` de un texto, como en `tests/i18n.test.ts`. */
function marcadores(texto: string): string[] {
  return [...new Set(texto.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g) ?? [])].sort()
}

/** Todos los puntos que las dos funciones saben producir, para recorrerlos en bloque. */
function totsElsPunts(): { nom: string; punt: PuntProces }[] {
  const fora: { nom: string; punt: PuntProces }[] = []
  const rols: RolMira[] = ['productor', 'equip']
  const combinacions: { nom: string; fets: FetsOferta }[] = [
    { nom: 'publicada', fets: { ...base } },
    { nom: 'publicada+gestio', fets: { ...base, nEnviades: 4, nInteressades: 2, nPerAprovar: 1 } },
    { nom: 'parcial', fets: { ...base, estado: 'parcial', kgCanalitzats: 40 } },
    { nom: 'bloqueada', fets: { ...base, estado: 'bloqueada', kgCanalitzats: 100 } },
    { nom: 'rec emès', fets: { ...base, estado: 'bloqueada', albaraRec: rec('emitido') } },
    { nom: 'rec entregat', fets: { ...base, estado: 'bloqueada', albaraRec: rec('entregado'), pendentDeMi: true } },
    { nom: 'rec confirmat', fets: { ...base, estado: 'bloqueada', albaraRec: rec('confirmado') } },
    { nom: 'rec conciliat', fets: { ...base, estado: 'bloqueada', albaraRec: rec('conciliado') } },
    { nom: 'tancada', fets: { ...base, estado: 'cerrada', kgCanalitzats: 100 } },
    { nom: 'vençuda', fets: { ...base, vencuda: true } },
    { nom: 'vençuda parcial', fets: { ...base, estado: 'parcial', vencuda: true, kgCanalitzats: 30 } },
    { nom: 'no col·locada', fets: { ...base, estado: 'no_colocada', motiu: 'Cap entitat' } },
    { nom: 'cancel·lada', fets: { ...base, estado: 'cancelada', motiu: 'Pluja' } },
  ]
  for (const rol of rols) {
    for (const c of combinacions) fora.push({ nom: `${rol}/${c.nom}`, punt: puntOferta(c.fets, rol) })
  }

  const interessos: { nom: string; fets: FetsInteres }[] = [
    { nom: 'rebuda', fets: { estado: 'pendent', aprovacio: 'pendent', ofertaEstado: 'publicada' } },
    { nom: 'interès enviat', fets: { estado: 'acceptada', aprovacio: 'pendent', ofertaEstado: 'parcial' } },
    { nom: 'assignada', fets: { estado: 'acceptada', aprovacio: 'aprovada', ofertaEstado: 'parcial', kg: 40 } },
    { nom: 'ent emès', fets: { estado: 'acceptada', aprovacio: 'aprovada', ofertaEstado: 'bloqueada', albaraEnt: { estado: 'emitido', numero: 'ENT-2026-00001' } } },
    { nom: 'ent entregat', fets: { estado: 'acceptada', aprovacio: 'aprovada', ofertaEstado: 'bloqueada', albaraEnt: { estado: 'entregado', numero: 'ENT-2026-00001' } } },
    { nom: 'ent confirmat', fets: { estado: 'acceptada', aprovacio: 'aprovada', ofertaEstado: 'bloqueada', albaraEnt: { estado: 'confirmado', numero: 'ENT-2026-00001' } } },
    { nom: 'ent conciliat', fets: { estado: 'acceptada', aprovacio: 'aprovada', ofertaEstado: 'cerrada', kg: 40, albaraEnt: { estado: 'conciliado', numero: 'ENT-2026-00001' } } },
    { nom: 'no assignada', fets: { estado: 'acceptada', aprovacio: 'rebutjada', ofertaEstado: 'parcial', motiu: 'Massa lluny' } },
    { nom: 'retirada', fets: { estado: 'acceptada', aprovacio: 'pendent', ofertaEstado: 'cancelada' } },
    { nom: 'declinada', fets: { estado: 'rebutjada', aprovacio: 'pendent', ofertaEstado: 'publicada' } },
  ]
  for (const c of interessos) fora.push({ nom: `receptor/${c.nom}`, punt: puntInteres(c.fets) })
  return fora
}

const PUNTS = totsElsPunts()

describe('puntOferta: de qué estado sale qué etapa', () => {
  it('recién publicada y sin movimiento, la etapa 1 sin variante', () => {
    const p = puntOferta({ ...base }, 'productor')
    expect(p.etapa).toBe('publicada')
    expect(p.index).toBe(0)
    expect(p.variant).toBeNull()
  })

  // El productor no necesita saber a cuántas entidades se ha escrito; lo que le cambia la
  // espera es que alguien haya dicho que sí. El equipo, al revés: para él la gestión
  // empieza al enviar.
  it('«en gestió» se dispara con distinto hecho según quién mire', () => {
    const enviada: FetsOferta = { ...base, nEnviades: 5, nInteressades: 0 }
    expect(puntOferta(enviada, 'productor').variant).toBeNull()
    expect(puntOferta(enviada, 'equip').variant).toBe('gestio')
    expect(puntOferta({ ...base, nInteressades: 2 }, 'productor').variant).toBe('gestio')
  })

  it('parcial y bloqueada son la misma etapa con variante distinta', () => {
    const p = puntOferta({ ...base, estado: 'parcial', kgCanalitzats: 40 }, 'equip')
    expect([p.etapa, p.index, p.variant]).toEqual(['assignada', 1, 'parcial'])
    const b = puntOferta({ ...base, estado: 'bloqueada', kgCanalitzats: 100 }, 'equip')
    expect([b.etapa, b.index, b.variant]).toEqual(['assignada', 1, 'coberta'])
  })

  // El caso que más se confunde al leer la tabla: `bloqueada` no quiere decir «recogida».
  it('bloqueada SIN albarán es assignada·coberta; con REC emitido ya es recollida·emes', () => {
    expect(puntOferta({ ...base, estado: 'bloqueada' }, 'equip').variant).toBe('coberta')
    const amb = puntOferta({ ...base, estado: 'bloqueada', albaraRec: rec('emitido') }, 'equip')
    expect([amb.etapa, amb.index, amb.variant]).toEqual(['recollida', 2, 'emes'])
  })

  it('el albarán manda sobre el estado del excedente', () => {
    const casos: [EstadoAlbaran, string, number, string | null][] = [
      ['emitido', 'recollida', 2, 'emes'],
      ['entregado', 'recollida', 2, 'entregat'],
      ['confirmado', 'confirmada', 3, null],
      ['conciliado', 'tancada', 4, null],
    ]
    for (const [estado, etapa, index, variant] of casos) {
      const p = puntOferta({ ...base, estado: 'parcial', albaraRec: rec(estado) }, 'equip')
      expect([p.etapa, p.index, p.variant], estado).toEqual([etapa, index, variant])
    }
  })

  // Un REC anulado o rectificado no cuenta: la oferta vuelve a estar donde estaba.
  it('un REC anulado o rectificado no mueve la etapa', () => {
    for (const estado of ['anulado', 'rectificado'] as EstadoAlbaran[]) {
      const p = puntOferta({ ...base, estado: 'bloqueada', albaraRec: rec(estado) }, 'equip')
      expect(p.etapa, estado).toBe('assignada')
    }
  })

  it('`cerrada` cierra aunque no haya albarán', () => {
    const p = puntOferta({ ...base, estado: 'cerrada', kgCanalitzats: 90 }, 'productor')
    expect([p.etapa, p.index]).toEqual(['tancada', 4])
    expect(p.vars.kg).toBe(90)
  })

  it('las salidas ganan a todo y valen -1', () => {
    for (const estado of ['no_colocada', 'cancelada'] as EstadoExcedente[]) {
      const p = puntOferta({
        ...base, estado, kgCanalitzats: 100, vencuda: true, nInteressades: 3,
        albaraRec: rec('conciliado'),
      }, 'equip')
      expect(p.index, estado).toBe(-1)
      expect(p.etapa, estado).toBe(estado === 'cancelada' ? 'cancellada' : 'sense_desti')
    }
  })
})

describe('«vençuda» solo desplaza las dos primeras etapas, y solo para el equipo', () => {
  it('el productor nunca la ve', () => {
    expect(puntOferta({ ...base, vencuda: true }, 'productor').etapa).toBe('publicada')
  })

  it('el equipo la ve sobre publicada y sobre assignada, conservando el paso', () => {
    const p1 = puntOferta({ ...base, vencuda: true }, 'equip')
    expect([p1.etapa, p1.index]).toEqual(['vencuda', 0])
    const p2 = puntOferta({ ...base, estado: 'parcial', vencuda: true, kgCanalitzats: 30 }, 'equip')
    expect([p2.etapa, p2.index]).toEqual(['vencuda', 1])
    expect(p2.vars.n).toBe(70)
  })

  // A partir de la recogida la fecha de disponibilidad ya no significa nada: el producto
  // está fuera de la finca.
  it('no desplaza a partir de la recogida', () => {
    const p = puntOferta({ ...base, vencuda: true, albaraRec: rec('emitido') }, 'equip')
    expect(p.etapa).toBe('recollida')
  })
})

describe('puntInteres: la lectura del receptor', () => {
  const b: FetsInteres = { estado: 'pendent', aprovacio: 'pendent', ofertaEstado: 'publicada' }

  it('pendiente de contestar, con enlace al mercado', () => {
    const p = puntInteres(b)
    expect([p.etapa, p.index, p.emToca, p.enllac]).toEqual(['oferta_rebuda', 0, true, '/receptor/mercat'])
  })

  it('aceptada y sin aprobar, esperando al equipo', () => {
    const p = puntInteres({ ...b, estado: 'acceptada' })
    expect([p.etapa, p.index, p.emToca]).toEqual(['interes_enviat', 1, false])
  })

  it('aprobada sin albarán es «assignada» con sus kg', () => {
    const p = puntInteres({ ...b, estado: 'acceptada', aprovacio: 'aprovada', kg: 40 })
    expect([p.etapa, p.index]).toEqual(['assignada', 2])
    expect(p.vars.kg).toBe(40)
  })

  it('el ENT cuenta el resto del camino', () => {
    const ap: FetsInteres = { ...b, estado: 'acceptada', aprovacio: 'aprovada' }
    const casos: [EstadoAlbaran, string, number, string | null, boolean][] = [
      ['emitido', 'entrega', 3, 'emes', false],
      ['entregado', 'entrega', 3, 'entregat', true],
      ['confirmado', 'confirmada', 4, null, false],
      ['conciliado', 'tancada', 5, null, false],
    ]
    for (const [estado, etapa, index, variant, emToca] of casos) {
      const p = puntInteres({ ...ap, albaraEnt: { estado, numero: 'ENT-1' } })
      expect([p.etapa, p.index, p.variant, p.emToca], estado).toEqual([etapa, index, variant, emToca])
    }
  })

  it('las tres salidas, y su orden de precedencia', () => {
    // Haber dicho que no es la historia, aunque además la oferta se cancelara.
    expect(puntInteres({ ...b, estado: 'rebutjada', ofertaEstado: 'cancelada' }).etapa).toBe('declinada')
    expect(puntInteres({ ...b, estado: 'acceptada', aprovacio: 'rebutjada' }).etapa).toBe('no_assignada')
    expect(puntInteres({ ...b, estado: 'acceptada', ofertaEstado: 'no_colocada' }).etapa).toBe('retirada')
    for (const e of ['declinada', 'no_assignada', 'retirada']) {
      const p = puntInteres(
        e === 'declinada' ? { ...b, estado: 'rebutjada' }
          : e === 'no_assignada' ? { ...b, estado: 'acceptada', aprovacio: 'rebutjada' }
            : { ...b, estado: 'acceptada', ofertaEstado: 'cancelada' },
      )
      expect(p.index, e).toBe(-1)
    }
  })

  // Un interés ya aprobado no se «retira» porque la oferta se cierre: lo que le pasó a esa
  // entidad es que recibió su parte.
  it('una oferta cancelada NO retira un interés ya aprobado', () => {
    const p = puntInteres({ ...b, estado: 'acceptada', aprovacio: 'aprovada', ofertaEstado: 'cancelada' })
    expect(p.etapa).toBe('assignada')
  })
})

describe('todas las claves compuestas existen en ca y en es', () => {
  // ESTA es la prueba que no se puede sustituir por `cobertura.test.ts`: las claves se
  // componen, así que nadie más las ve.
  it.each(PUNTS)('$nom', ({ punt }) => {
    for (const clau of Object.values(punt.claus)) {
      expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
      expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
    }
  })

  it('las etiquetas de los pasos también', () => {
    for (const clau of [...PASSOS_OFERTA_CLAUS, ...PASSOS_INTERES_CLAUS]) {
      expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
      expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
    }
    expect(PASSOS_OFERTA_CLAUS).toHaveLength(ETAPES_OFERTA.length)
    expect(PASSOS_INTERES_CLAUS).toHaveLength(ETAPES_INTERES.length)
  })

  it('la leyenda cubre los siete estados, con badge y explicación', () => {
    const items = llegendaOferta()
    expect(items).toHaveLength(ESTATS_OFERTA.length)
    for (const it of items) {
      expect(DICTS.ca[it.key], `falta ${it.key} en ca`).toBeTruthy()
      expect(DICTS.es[it.key], `falta ${it.key} en es`).toBeTruthy()
      expect(DICTS.ca[it.descKey], `falta ${it.descKey} en ca`).toBeTruthy()
      expect(DICTS.es[it.descKey], `falta ${it.descKey} en es`).toBeTruthy()
      expect(it.clase).toMatch(/^bg-/)
    }
  })
})

describe('los marcadores {x} y las vars son el mismo juego', () => {
  // `t('x', {n: 3})` sobre un texto sin `{n}` devuelve el texto tal cual: el dato
  // desaparece sin ningún error. Y al revés, un `{n}` sin su var se pinta crudo.
  it.each(PUNTS)('$nom', ({ punt }) => {
    for (const idioma of ['ca', 'es'] as const) {
      const usados = new Set<string>()
      for (const clau of Object.values(punt.claus)) {
        for (const m of marcadores(DICTS[idioma][clau] ?? '')) usados.add(m.slice(1, -1))
      }
      expect([...usados].sort(), `${idioma}: marcadores sin var`)
        .toEqual(Object.keys(punt.vars).sort())
    }
  })
})

describe('emToca dice la verdad sobre quién actúa', () => {
  it('el productor solo actúa cuando le toca confirmar o volver a publicar', () => {
    expect(puntOferta({ ...base, albaraRec: rec('entregado'), pendentDeMi: true }, 'productor').emToca).toBe(true)
    expect(puntOferta({ ...base, albaraRec: rec('entregado'), pendentDeMi: false }, 'productor').emToca).toBe(false)
    expect(puntOferta({ ...base, estado: 'no_colocada' }, 'productor').emToca).toBe(true)
    for (const fets of [
      { ...base },
      { ...base, nInteressades: 2 },
      { ...base, estado: 'parcial' as EstadoExcedente },
      { ...base, estado: 'bloqueada' as EstadoExcedente },
      { ...base, albaraRec: rec('emitido') },
      { ...base, albaraRec: rec('confirmado') },
      { ...base, albaraRec: rec('conciliado') },
      { ...base, estado: 'cancelada' as EstadoExcedente },
    ]) {
      expect(puntOferta(fets, 'productor').emToca).toBe(false)
    }
  })

  it('el equipo NO actúa cuando la pelota está en el tejado del productor ni al final', () => {
    expect(puntOferta({ ...base, albaraRec: rec('entregado') }, 'equip').emToca).toBe(false)
    expect(puntOferta({ ...base, albaraRec: rec('conciliado') }, 'equip').emToca).toBe(false)
    expect(puntOferta({ ...base, estado: 'cancelada' }, 'equip').emToca).toBe(false)
    expect(puntOferta({ ...base, estado: 'no_colocada' }, 'equip').emToca).toBe(false)
  })

  it('el receptor solo actúa al pedir la oferta y al confirmar la entrega', () => {
    const ambToca = PUNTS.filter((p) => p.nom.startsWith('receptor/') && p.punt.emToca)
    expect(ambToca.map((p) => p.nom).sort()).toEqual(['receptor/ent entregat', 'receptor/rebuda'])
  })

  it('cada punto con enlace apunta a la ruta del panel que lo mira', () => {
    for (const { nom, punt } of PUNTS) {
      if (!punt.enllac) continue
      const panell = nom.startsWith('receptor/') ? '/receptor/'
        : nom.startsWith('productor/') ? '/productor/' : '/equip/'
      expect(punt.enllac.startsWith(panell), `${nom} → ${punt.enllac}`).toBe(true)
    }
  })
})

describe('etiquetaEstatOferta sustituye a las dos copias', () => {
  it('los siete estados tienen clave traducida y clases de tokens', () => {
    for (const estado of ESTATS_OFERTA) {
      const { key, clase } = etiquetaEstatOferta(estado)
      expect(DICTS.ca[key], `falta ${key} en ca`).toBeTruthy()
      expect(DICTS.es[key], `falta ${key} en es`).toBeTruthy()
      // Nada de la paleta genérica de Tailwind (§2bis): solo tokens del sistema.
      expect(clase).not.toMatch(/\b(bg|text)-(red|green|blue|yellow|gray|slate|amber)-\d/)
    }
  })

  // «Bloquejada» chocaba con el bloqueo por falta de convenio, que es otra cosa y además
  // mala; el estado del excedente es bueno (tiene todos los kilos colocados).
  it('`bloqueada` se lee «Coberta», no «Bloquejada»', () => {
    const { key } = etiquetaEstatOferta('bloqueada')
    expect(DICTS.ca[key]).toBe('Coberta')
    expect(DICTS.es[key]).toBe('Cubierta')
  })
})

describe('FASES_EQUIP: el «Com funciona» del tablero', () => {
  const nav = readFileSync(new URL('../src/lib/nav.ts', import.meta.url), 'utf-8')
  const destins = new Set([...nav.matchAll(/\bto:\s*'([^']+)'/g)].map((m) => m[1]))

  it('la extracción de nav.ts encuentra destinos', () => {
    expect(destins.size).toBeGreaterThan(10)
  })

  it('las seis fases tienen título y descripción en los dos idiomas', () => {
    expect(FASES_EQUIP).toHaveLength(6)
    for (const f of FASES_EQUIP) {
      for (const clau of [`fase.${f.clau}_t`, `fase.${f.clau}_d`]) {
        expect(DICTS.ca[clau], `falta ${clau} en ca`).toBeTruthy()
        expect(DICTS.es[clau], `falta ${clau} en es`).toBeTruthy()
      }
    }
  })

  // Un «Com funciona» que enlaza a una sección retirada es peor que no tener enlace.
  it('cada ruta existe de verdad en el menú del equipo', () => {
    const orfes = FASES_EQUIP.flatMap((f) => f.rutes).filter((r) => !destins.has(r))
    expect(orfes, `rutas sin entrada de menú:\n  ${orfes.join('\n  ')}`).toEqual([])
  })
})
