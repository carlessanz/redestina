// El cierre del intake: la fecha que el productor dicta, las siglas del identificador y el
// texto que se publica.
//
// Por qué importa cada pieza:
//
//   · `parseDisponibleFins` es lo que convierte un «23/07» dicho por WhatsApp en la fecha
//     real de `excedentes.disponible_hasta`. De esa columna depende el job de vencidas
//     (`marcar_excedentes_vencidos()`): si queda null, la oferta no caduca nunca y se
//     queda publicada para siempre; si se parsea MAL, caduca antes de tiempo y el
//     productor ve su excedente marcado «no colocada» con producto todavía en el campo.
//     Es la deuda §12.4, y lo que la acota es exactamente esta función.
//   · `siglas` compone las tres letras del `id_excedente` (`E-260721-CAR-TOM-1`), la
//     referencia que circula por WhatsApp desde julio y por la que el equipo busca una
//     oferta. Tiene que salir SIEMPRE de tres caracteres, aunque el nombre sea «Al» o esté
//     lleno de acentos.
//   · `componerTextoOferta` es el mensaje literal que lee la entidad receptora. Su última
//     línea explica cómo aceptar, y es la que pone en marcha el diálogo de `respuestas.ts`.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  parseDisponibleFins,
  siglas,
  componerTextoOferta,
} from '../supabase/functions/_shared/oferta.ts'

/** Campos mínimos de una oferta, para variar solo lo que cada prueba mira. */
function campos(extra: Partial<Parameters<typeof componerTextoOferta>[0]> = {}) {
  return {
    producte: 'Tomàquet',
    productor: 'Can Prova SCP',
    municipi: 'Gavà',
    ubicacio: 'https://maps.app.goo.gl/prova',
    quantitat: '300kg aprox · 12 caixes',
    disponible: '23/07',
    horari: 'matí',
    modalitat: 'donació',
    causa: 'Excés de producció',
    envasos: 'No',
    responsable: '',
    observacions: '',
    ...extra,
  }
}

describe('parseDisponibleFins · separadores', () => {
  // Se fija el día para que la inferencia del año sea comprobable: sin esto, la prueba
  // diría una cosa distinta cada 1 de enero.
  afterEach(() => { vi.useRealTimers() })

  function hoyEs(anio: number, mes1a12: number, dia: number) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(anio, mes1a12 - 1, dia, 12, 0, 0))
  }

  it('acepta la barra, el guion y el punto', () => {
    hoyEs(2026, 6, 15)
    expect(parseDisponibleFins('23/07')).toBe('2026-07-23')
    expect(parseDisponibleFins('23-07')).toBe('2026-07-23')
    expect(parseDisponibleFins('23.07')).toBe('2026-07-23')
  })

  it('acepta un solo dígito en el día o en el mes', () => {
    hoyEs(2026, 6, 15)
    expect(parseDisponibleFins('23-7')).toBe('2026-07-23')
    expect(parseDisponibleFins('3/7')).toBe('2026-07-03')
  })

  it('acepta el año de cuatro cifras y el de dos', () => {
    hoyEs(2026, 6, 15)
    expect(parseDisponibleFins('23.07.2026')).toBe('2026-07-23')
    expect(parseDisponibleFins('23/07/26')).toBe('2026-07-23')
  })

  // El productor contesta a una pregunta abierta, así que la fecha casi nunca llega sola.
  it('encuentra la fecha dentro de una frase', () => {
    hoyEs(2026, 6, 15)
    expect(parseDisponibleFins('fins al 23/07 si pot ser')).toBe('2026-07-23')
    expect(parseDisponibleFins('crec que el 3-8')).toBe('2026-08-03')
  })
})

describe('parseDisponibleFins · el año que no se dice', () => {
  afterEach(() => { vi.useRealTimers() })

  function hoyEs(anio: number, mes1a12: number, dia: number) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(anio, mes1a12 - 1, dia, 12, 0, 0))
  }

  it('una fecha aún por llegar se entiende en el año en curso', () => {
    hoyEs(2026, 6, 15)
    expect(parseDisponibleFins('23/07')).toBe('2026-07-23')
  })

  // Nadie dice «hasta el 10 de enero» en junio refiriéndose al enero que ya pasó. Es la
  // única interpretación que no produce una oferta nacida caducada.
  it('una fecha ya pasada se entiende en el año siguiente', () => {
    hoyEs(2026, 6, 15)
    expect(parseDisponibleFins('10/01')).toBe('2027-01-10')
  })

  it('hoy mismo cuenta como futuro, no salta de año', () => {
    hoyEs(2026, 6, 15)
    expect(parseDisponibleFins('15/06')).toBe('2026-06-15')
  })

  it('en fin de año el salto es al año siguiente de verdad', () => {
    hoyEs(2026, 12, 28)
    expect(parseDisponibleFins('5/1')).toBe('2027-01-05')
    expect(parseDisponibleFins('31/12')).toBe('2026-12-31')
  })

  // Con año explícito no se infiere nada: si alguien escribe una fecha pasada con su año,
  // es lo que ha dicho y no se corrige (la oferta nacerá vencida y el job la cerrará).
  it('con año explícito no se corrige, aunque ya haya pasado', () => {
    hoyEs(2026, 6, 15)
    expect(parseDisponibleFins('10/01/2026')).toBe('2026-01-10')
  })

  // Propiedad, por si algún día se cambia la inferencia: sin año, lo devuelto nunca puede
  // caer en el pasado. Es la invariante que de verdad protege al productor.
  it.each(['1/1', '28/02', '15/06', '30/09', '31/12'])(
    'sin año, «%s» nunca cae en el pasado',
    (texto) => {
      hoyEs(2026, 6, 15)
      const r = parseDisponibleFins(texto)
      expect(r).not.toBeNull()
      expect(r! >= '2026-06-15').toBe(true) // ISO ordena como texto
    },
  )
})

describe('parseDisponibleFins · lo que no es una fecha', () => {
  it('devuelve null si no hay nada que parsear', () => {
    expect(parseDisponibleFins('')).toBeNull()
    expect(parseDisponibleFins('quan pugueu')).toBeNull()
    expect(parseDisponibleFins('aquesta setmana')).toBeNull()
    expect(parseDisponibleFins('dilluns')).toBeNull()
  })

  it('un número suelto no es una fecha', () => {
    expect(parseDisponibleFins('23')).toBeNull()
    expect(parseDisponibleFins('300 kg')).toBeNull()
  })

  it('rechaza días y meses imposibles', () => {
    expect(parseDisponibleFins('45/07')).toBeNull()
    expect(parseDisponibleFins('23/13')).toBeNull()
    expect(parseDisponibleFins('0/7')).toBeNull()
  })

  // Es lo que separa «parsear» de «creerse cualquier cosa»: el 31 de febrero no existe, y
  // dejarlo pasar escribiría en la base una fecha que Postgres rechazaría —o peor, que
  // JavaScript habría corrido al 3 de marzo sin decir nada—.
  it('rechaza fechas que no existen en el calendario', () => {
    expect(parseDisponibleFins('31/02/2026')).toBeNull()
    expect(parseDisponibleFins('30/02/2026')).toBeNull()
    expect(parseDisponibleFins('31/04/2026')).toBeNull()
    expect(parseDisponibleFins('29/02/2025')).toBeNull() // 2025 no es bisiesto
  })

  it('el 29 de febrero de un bisiesto sí vale', () => {
    expect(parseDisponibleFins('29/02/2028')).toBe('2028-02-29')
  })

  it('rellena a dos cifras, que es lo que espera una columna date', () => {
    expect(parseDisponibleFins('3/7/2026')).toBe('2026-07-03')
    expect(parseDisponibleFins('3/7/2026')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('siglas', () => {
  it('coge las tres primeras letras en mayúsculas', () => {
    expect(siglas('Carles')).toBe('CAR')
    expect(siglas('Tomàquet')).toBe('TOM')
  })

  it('quita los acentos en vez de perder la letra', () => {
    expect(siglas('Òscar')).toBe('OSC')
    expect(siglas('Álvarez')).toBe('ALV')
    expect(siglas('Épica')).toBe('EPI')
  })

  it('ignora espacios, dígitos y signos', () => {
    expect(siglas('Can Prova')).toBe('CAN')
    expect(siglas('J. P. Martí')).toBe('JPM')
    expect(siglas('3 Arrels')).toBe('ARR')
  })

  // El formato `E-AAMMDD-XXX-YYY-N` tiene el ancho fijo: un nombre corto se rellena con X
  // en vez de producir un identificador con una casilla menos.
  it('siempre devuelve tres caracteres', () => {
    expect(siglas('Al')).toBe('ALX')
    expect(siglas('A')).toBe('AXX')
    expect(siglas('')).toBe('XXX')
    expect(siglas('123')).toBe('XXX')
    for (const t of ['Carles', 'Al', '', 'Òscar', '3 Arrels', 'J. P.']) {
      expect(siglas(t)).toHaveLength(3)
    }
  })

  // La ç SÍ se descompone en NFD («c» + cedilla combinante), así que sobrevive como c en
  // vez de perderse con el `[^A-Za-z]`. Es lo que se quiere en un identificador ASCII: un
  // productor que se llame «Çabater» da CAB y no ABX. (Ojo: el comentario de
  // `respuestas.ts` afirma lo contrario sobre el mismo mecanismo — ver esa suite.)
  it('la ç se conserva como c', () => {
    expect(siglas('Força')).toBe('FOR')
    expect(siglas('Ça')).toBe('CAX')
    expect(siglas('Çabater')).toBe('CAB')
  })
})

describe('componerTextoOferta', () => {
  it('lleva la cabecera y las secciones en su orden', () => {
    const t = componerTextoOferta(campos())
    expect(t.startsWith('📢 *OFERTA DISPONIBLE*')).toBe(true)
    const orden = [
      'PRODUCTE:',
      'PRODUCTOR:',
      'MUNICIPI:',
      'UBICACIÓ:',
      'QUANTITAT:',
      'DISPONIBLE:',
      'HORARI RECOLLIDA:',
      'MODALITAT:',
      'CAUSA:',
      'ENVASOS:',
      'RESPONSABLE:',
      'OBSERVACIONS:',
    ]
    const posiciones = orden.map((s) => t.indexOf(s))
    expect(posiciones.every((p) => p >= 0)).toBe(true)
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)
  })

  it('la ubicación va en su propia línea, porque es un enlace', () => {
    const t = componerTextoOferta(campos())
    const lineas = t.split('\n')
    const i = lineas.findIndex((l) => l.includes('UBICACIÓ:'))
    expect(lineas[i + 1]).toBe('https://maps.app.goo.gl/prova')
  })

  // La última línea es la que arranca el diálogo de aceptación: si dejara de decir SÍ/NO,
  // `clasificar()` seguiría esperando unas palabras que ya nadie estaría invitando a usar.
  it('termina explicando cómo aceptar, con el SÍ y el NO que espera el diálogo', () => {
    const t = componerTextoOferta(campos())
    expect(t.trimEnd().endsWith(
      '✅ Per acceptar aquesta oferta respon *SÍ* (o *NO* per descartar-la).',
    )).toBe(true)
  })

  it('el preu mínim solo sale si lo hay', () => {
    expect(componerTextoOferta(campos())).not.toContain('PREU MÍNIM')
    expect(componerTextoOferta(campos({ preu: '0.8 €/kg', modalitat: 'venda' })))
      .toContain('💶 PREU MÍNIM: 0.8 €/kg')
  })

  it('el preu va después de la modalitat y antes de la causa', () => {
    const t = componerTextoOferta(campos({ preu: '0.8 €/kg', modalitat: 'venda' }))
    expect(t.indexOf('MODALITAT:')).toBeLessThan(t.indexOf('PREU MÍNIM:'))
    expect(t.indexOf('PREU MÍNIM:')).toBeLessThan(t.indexOf('CAUSA:'))
  })

  // Un campo vacío deja la etiqueta sin nada detrás y eso es deliberado: el mensaje lo
  // acaba de leer una persona, y una etiqueta vacía se ve; una línea que desaparece, no.
  it('un campo vacío deja su etiqueta, no borra la línea', () => {
    const t = componerTextoOferta(campos({ observacions: '', responsable: '' }))
    expect(t).toContain('📝 OBSERVACIONS: ')
    expect(t).toContain('👥 RESPONSABLE: ')
  })

  it('los valores se imprimen tal cual, sin tocarlos', () => {
    const t = componerTextoOferta(campos({ producte: 'Tomàquet de penjar', municipi: 'Gavà' }))
    expect(t).toContain('🌿 PRODUCTE: Tomàquet de penjar')
    expect(t).toContain('📍 MUNICIPI: Gavà')
  })
})
