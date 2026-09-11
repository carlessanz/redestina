// La priorización de entidades receptoras.
//
// Por qué importa: es el único sitio del sistema que decide A QUIÉN se le ofrece un
// excedente, y lo hace sin que nadie lo revise después — el panel pinta el ranking y el
// equipo envía por orden. Un peso mal aplicado no rompe nada visible: solo hace que la
// entidad equivocada reciba antes la oferta, todos los días, en silencio.
//
// Los pesos son una regla de negocio acordada (AGENTS.md §6ter), no un detalle de
// implementación: por eso se prueban uno a uno y por su valor exacto, no «que puntúe más».
// Y las dos decisiones que sí excluyen a alguien del reparto —`No procedeix` y sin estado—
// se prueban aparte, porque son las únicas que pueden dejar a una entidad sin ver nada.

import { describe, it, expect } from 'vitest'
import {
  puntuarEntidad,
  priorizar,
  type EntidadPriorizable,
  type ExcedenteContexto,
} from '../supabase/functions/_shared/priorizacion.ts'

// Entidad neutra: todo apagado, para que cada prueba encienda solo lo que mide.
function entidad(parcial: Partial<EntidadPriorizable> = {}): EntidadPriorizable {
  return {
    id: 'e1',
    nombre: 'Entitat',
    poblacion: null,
    telefono: null,
    opt_in: true,
    area_geografica: null,
    estat: 'Signat',
    prioritat: null,
    productes_frescos: null,
    transport_plataforma: null,
    descarrega_toro: null,
    ...parcial,
  }
}

function excedente(parcial: Partial<ExcedenteContexto> = {}): ExcedenteContexto {
  return {
    familia: 'Fruita Dolça',
    area_geografica: null,
    poblacion: null,
    kg_total: 100,
    ...parcial,
  }
}

/** Puntúa y falla la prueba si la entidad resultó excluida (ahí no hay puntuación que mirar). */
function puntos(e: EntidadPriorizable, x: ExcedenteContexto): number {
  const r = puntuarEntidad(e, x)
  expect(r).not.toBeNull()
  return r!.puntuacion
}

describe('puntuarEntidad · proximidad', () => {
  it('la misma área suma 3', () => {
    const x = excedente({ area_geografica: 'Baix Llobregat' })
    expect(puntos(entidad({ area_geografica: 'Baix Llobregat' }), x)).toBe(3)
  })

  it('el mismo municipio suma 2 ENCIMA de la misma área, no por su cuenta', () => {
    const x = excedente({ area_geografica: 'Baix Llobregat', poblacion: 'Gavà' })
    expect(puntos(entidad({ area_geografica: 'Baix Llobregat', poblacion: 'Gavà' }), x)).toBe(5)
  })

  // El municipio es un extra de la proximidad, no un peso independiente: sin la misma
  // área (aquí, otra comarca) coincidir de municipio no debería poder pasar.
  it('el mismo municipio sin la misma área no suma nada', () => {
    const x = excedente({ area_geografica: 'Baix Llobregat', poblacion: 'Gavà' })
    expect(puntos(entidad({ area_geografica: 'Camp Tarragona', poblacion: 'Gavà' }), x)).toBe(0)
  })

  it('compara sin distinguir mayúsculas ni espacios sobrantes', () => {
    const x = excedente({ area_geografica: 'Baix Llobregat', poblacion: 'Gavà' })
    expect(puntos(entidad({ area_geografica: '  baix llobregat ', poblacion: 'GAVÀ' }), x)).toBe(5)
  })

  // Dos fichas incompletas no son «el mismo sitio»: sin área en el excedente, la
  // coincidencia de dos vacíos sumaría 3 a todo el mundo.
  it('dos áreas vacías no cuentan como coincidencia', () => {
    expect(puntos(entidad({ area_geografica: null }), excedente({ area_geografica: null }))).toBe(0)
    expect(puntos(entidad({ area_geografica: '' }), excedente({ area_geografica: '  ' }))).toBe(0)
  })

  it('dos municipios vacíos tampoco, aunque el área sí coincida', () => {
    const x = excedente({ area_geografica: 'Baix Llobregat', poblacion: null })
    expect(puntos(entidad({ area_geografica: 'Baix Llobregat', poblacion: null }), x)).toBe(3)
  })
})

describe('puntuarEntidad · capacidad logística', () => {
  it('transporte y toro suman 1 cada uno', () => {
    expect(puntos(entidad({ transport_plataforma: true }), excedente())).toBe(1)
    expect(puntos(entidad({ descarrega_toro: true }), excedente())).toBe(1)
    expect(puntos(entidad({ transport_plataforma: true, descarrega_toro: true }), excedente())).toBe(2)
  })

  it('por encima de 500 kg la capacidad pesa doble', () => {
    const grande = excedente({ kg_total: 501 })
    expect(puntos(entidad({ transport_plataforma: true, descarrega_toro: true }), grande)).toBe(4)
  })

  // El umbral es estricto: 500 kg todavía NO es un excedente grande.
  it('500 kg clavados aún no es grande; 501 sí', () => {
    expect(puntos(entidad({ transport_plataforma: true }), excedente({ kg_total: 500 }))).toBe(1)
    expect(puntos(entidad({ transport_plataforma: true }), excedente({ kg_total: 501 }))).toBe(2)
  })

  it('sin kg declarados se trata como excedente pequeño', () => {
    expect(puntos(entidad({ transport_plataforma: true }), excedente({ kg_total: null }))).toBe(1)
  })

  it('el motivo dice cuándo el peso ha sido doble', () => {
    const normal = puntuarEntidad(entidad({ transport_plataforma: true }), excedente({ kg_total: 100 }))
    const doble = puntuarEntidad(entidad({ transport_plataforma: true }), excedente({ kg_total: 900 }))
    expect(normal!.motivos).toContain('Transport amb plataforma')
    expect(doble!.motivos).toContain('Transport amb plataforma (excedent gran)')
  })
})

describe('puntuarEntidad · producto fresco', () => {
  it('producto fresco y entidad que acepta frescos suman 2', () => {
    expect(puntos(entidad({ productes_frescos: true }), excedente({ familia: 'Horta Fulla' }))).toBe(2)
  })

  it('«Varis» es la única familia que no es fresca', () => {
    expect(puntos(entidad({ productes_frescos: true }), excedente({ familia: 'Varis' }))).toBe(0)
    expect(puntos(entidad({ productes_frescos: true }), excedente({ familia: 'varis' }))).toBe(0)
  })

  it('una entidad que no acepta frescos no suma, aunque el producto lo sea', () => {
    expect(puntos(entidad({ productes_frescos: false }), excedente({ familia: 'Horta Fulla' }))).toBe(0)
    expect(puntos(entidad({ productes_frescos: null }), excedente({ familia: 'Horta Fulla' }))).toBe(0)
  })

  // `productes_frescos` queda `null` cuando el texto libre del Excel no era concluyente
  // (§4), y ese null se trata como «no»: la duda no suma puntos, que es lo correcto.
  it('la familia desconocida se considera fresca (solo «Varis» excluye)', () => {
    expect(puntos(entidad({ productes_frescos: true }), excedente({ familia: null }))).toBe(2)
  })
})

describe('puntuarEntidad · prioritat', () => {
  it('suma max(0, 3 - prioritat)', () => {
    expect(puntos(entidad({ prioritat: 1 }), excedente())).toBe(2)
    expect(puntos(entidad({ prioritat: 2 }), excedente())).toBe(1)
    expect(puntos(entidad({ prioritat: 3 }), excedente())).toBe(0)
  })

  it('nunca resta: una prioritat por encima de 3 suma cero', () => {
    expect(puntos(entidad({ prioritat: 5 }), excedente())).toBe(0)
  })

  it('sin prioritat no suma y no deja motivo', () => {
    const r = puntuarEntidad(entidad({ prioritat: null }), excedente())
    expect(r!.puntuacion).toBe(0)
    expect(r!.motivos.some((m) => m.startsWith('Prioritat'))).toBe(false)
  })

  it('una prioritat que no suma tampoco se anuncia como motivo', () => {
    const r = puntuarEntidad(entidad({ prioritat: 3 }), excedente())
    expect(r!.motivos.some((m) => m.startsWith('Prioritat'))).toBe(false)
  })
})

// Los seis valores que de verdad hay en `sda.csv`: Signat (62), Pendent (36),
// No procedeix (7), vacío (5), Pendent entitat (1) y Pendent Espigoladors (1).
describe('puntuarEntidad · los seis valores reales de estat', () => {
  it('«Signat» entra como activa', () => {
    const r = puntuarEntidad(entidad({ estat: 'Signat' }), excedente())
    expect(r!.pendiente).toBe(false)
    expect(r!.motivos).not.toContain('⚠️ Conveni pendent')
  })

  it.each(['Pendent', 'Pendent entitat', 'Pendent Espigoladors'])(
    '«%s» entra, pero marcada como pendiente y con aviso',
    (estat) => {
      const r = puntuarEntidad(entidad({ estat }), excedente())
      expect(r).not.toBeNull()
      expect(r!.pendiente).toBe(true)
      expect(r!.motivos).toContain('⚠️ Conveni pendent')
    },
  )

  it('«No procedeix» queda EXCLUIDA del reparto', () => {
    expect(puntuarEntidad(entidad({ estat: 'No procedeix' }), excedente())).toBeNull()
    expect(puntuarEntidad(entidad({ estat: 'NO PROCEDEIX' }), excedente())).toBeNull()
  })

  it('sin estado queda EXCLUIDA, tanto si es null como si es una cadena vacía', () => {
    expect(puntuarEntidad(entidad({ estat: null }), excedente())).toBeNull()
    expect(puntuarEntidad(entidad({ estat: '' }), excedente())).toBeNull()
    expect(puntuarEntidad(entidad({ estat: '   ' }), excedente())).toBeNull()
  })

  // Una entidad pendiente sigue puntuando: lo que cambia es dónde acaba en el ranking,
  // no cuánto vale. Si la puntuación se anulara, el orden dentro del bloque pendiente
  // sería arbitrario.
  it('una pendiente conserva su puntuación entera', () => {
    const x = excedente({ area_geografica: 'Baix Llobregat' })
    expect(puntos(entidad({ estat: 'Pendent', area_geografica: 'Baix Llobregat' }), x)).toBe(3)
  })
})

describe('puntuarEntidad · opt-in', () => {
  // Distinción deliberada (§6ter): sin opt-in no se puede ENVIAR por API, pero la
  // entidad sigue siendo candidata — se la puede llamar por teléfono o mandarle un correo.
  it('sin opt-in se marca, pero NO se excluye ni se penaliza', () => {
    const x = excedente({ area_geografica: 'Baix Llobregat' })
    const r = puntuarEntidad(entidad({ opt_in: false, area_geografica: 'Baix Llobregat' }), x)
    expect(r).not.toBeNull()
    expect(r!.puntuacion).toBe(3)
    expect(r!.opt_in).toBe(false)
    expect(r!.motivos).toContain('Sense opt-in: no es pot enviar per API')
  })

  it('un opt_in nulo se devuelve como falso, no como nulo', () => {
    const r = puntuarEntidad(entidad({ opt_in: null }), excedente())
    expect(r!.opt_in).toBe(false)
    expect(r!.motivos).toContain('Sense opt-in: no es pot enviar per API')
  })

  it('con opt-in no aparece el aviso', () => {
    const r = puntuarEntidad(entidad({ opt_in: true }), excedente())
    expect(r!.motivos).not.toContain('Sense opt-in: no es pot enviar per API')
  })
})

describe('puntuarEntidad · los pesos se suman, no se pisan', () => {
  it('la entidad ideal de un excedente grande suma 3+2+2+2+2+2 = 13', () => {
    const x = excedente({
      familia: 'Horta Fulla',
      area_geografica: 'Baix Llobregat',
      poblacion: 'Gavà',
      kg_total: 800,
    })
    const e = entidad({
      area_geografica: 'Baix Llobregat',
      poblacion: 'Gavà',
      transport_plataforma: true,
      descarrega_toro: true,
      productes_frescos: true,
      prioritat: 1,
    })
    expect(puntos(e, x)).toBe(13)
  })
})

describe('priorizar', () => {
  it('ordena de mayor a menor puntuación', () => {
    const x = excedente({ area_geografica: 'A', kg_total: 100 })
    const lista = [
      entidad({ id: 'baja', prioritat: 3 }),
      entidad({ id: 'alta', area_geografica: 'A', prioritat: 1 }),
      entidad({ id: 'media', transport_plataforma: true }),
    ]
    expect(priorizar(lista, x).map((e) => e.id)).toEqual(['alta', 'media', 'baja'])
  })

  // El bloque pendiente va al final SIEMPRE, incluso cuando puntúa más que una activa:
  // el aviso de conveni pendiente pesa más que cualquier afinidad.
  it('las pendientes van al final aunque puntúen más que las activas', () => {
    const x = excedente({ area_geografica: 'A', poblacion: 'P', kg_total: 900 })
    const lista = [
      entidad({
        id: 'pendent-perfecta',
        estat: 'Pendent',
        area_geografica: 'A',
        poblacion: 'P',
        transport_plataforma: true,
        prioritat: 1,
      }),
      entidad({ id: 'activa-fluixa', estat: 'Signat' }),
    ]
    const r = priorizar(lista, x)
    expect(r.map((e) => e.id)).toEqual(['activa-fluixa', 'pendent-perfecta'])
    expect(r[1].puntuacion).toBeGreaterThan(r[0].puntuacion)
  })

  it('dentro del bloque pendiente también ordena por puntuación', () => {
    const x = excedente({ area_geografica: 'A' })
    const lista = [
      entidad({ id: 'p-baixa', estat: 'Pendent entitat' }),
      entidad({ id: 'p-alta', estat: 'Pendent Espigoladors', area_geografica: 'A' }),
    ]
    expect(priorizar(lista, x).map((e) => e.id)).toEqual(['p-alta', 'p-baixa'])
  })

  it('deja fuera a las excluidas', () => {
    const lista = [
      entidad({ id: 'ok' }),
      entidad({ id: 'no-procedeix', estat: 'No procedeix' }),
      entidad({ id: 'sense-estat', estat: null }),
    ]
    expect(priorizar(lista, excedente()).map((e) => e.id)).toEqual(['ok'])
  })

  it('con la lista vacía devuelve la lista vacía, no falla', () => {
    expect(priorizar([], excedente())).toEqual([])
  })

  // El empate es el caso normal —97 de 111 entidades comparten prioritat 1 (deuda §12.12)—,
  // así que lo que decide el orden de casi todo el ranking es la estabilidad del criterio,
  // no el criterio. Un orden inestable haría que la misma oferta propusiera entidades
  // distintas en dos recargas seguidas, y el equipo envía por orden.
  it('los empates conservan el orden de entrada (orden estable)', () => {
    const x = excedente()
    const lista = Array.from({ length: 12 }, (_, i) => entidad({ id: `e${i}`, prioritat: 1 }))
    const esperado = lista.map((e) => e.id)
    expect(priorizar(lista, x).map((e) => e.id)).toEqual(esperado)
    // Y la segunda pasada con la misma entrada da exactamente lo mismo.
    expect(priorizar(lista, x).map((e) => e.id)).toEqual(esperado)
  })

  it('el empate es estable también cruzando activas y pendientes', () => {
    const lista = [
      entidad({ id: 'a1', estat: 'Signat' }),
      entidad({ id: 'p1', estat: 'Pendent' }),
      entidad({ id: 'a2', estat: 'Signat' }),
      entidad({ id: 'p2', estat: 'Pendent' }),
    ]
    expect(priorizar(lista, excedente()).map((e) => e.id)).toEqual(['a1', 'a2', 'p1', 'p2'])
  })
})

// ---------------------------------------------------------------------------
// La invariante que justifica el módulo
// ---------------------------------------------------------------------------
// Priorizar es ordenar, no filtrar: el ranking tiene que contener exactamente a las
// candidatas —ni una menos, que sería una entidad que nunca recibe nada, ni una más, que
// sería ofrecerle producto a quien el equipo decidió que no procede— y cada una con la
// misma puntuación que daría `puntuarEntidad` por su cuenta. Si las dos funciones
// discreparan, el panel enseñaría un número y el orden obedecería a otro.
describe('el ranking contiene exactamente a las candidatas, con su puntuación intacta', () => {
  const x = excedente({ area_geografica: 'A', poblacion: 'P', familia: 'Horta Fulla', kg_total: 700 })
  const lista = [
    entidad({ id: '1', estat: 'Signat', area_geografica: 'A', poblacion: 'P' }),
    entidad({ id: '2', estat: 'Pendent', transport_plataforma: true, prioritat: 1 }),
    entidad({ id: '3', estat: 'No procedeix', area_geografica: 'A' }),
    entidad({ id: '4', estat: null }),
    entidad({ id: '5', estat: 'Pendent entitat', productes_frescos: true, opt_in: false }),
    entidad({ id: '6', estat: 'Signat', descarrega_toro: true }),
  ]

  it('no pierde ni inventa candidatas', () => {
    const sueltas = lista.filter((e) => puntuarEntidad(e, x) !== null).map((e) => e.id)
    expect(priorizar(lista, x).map((e) => e.id).sort()).toEqual(sueltas.sort())
  })

  it('la puntuación del ranking es la misma que la individual', () => {
    for (const fila of priorizar(lista, x)) {
      const suelta = puntuarEntidad(lista.find((e) => e.id === fila.id)!, x)
      expect(fila.puntuacion).toBe(suelta!.puntuacion)
      expect(fila.motivos).toEqual(suelta!.motivos)
    }
  })
})
