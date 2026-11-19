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
  esProducteAlCamp,
  mapsOferta,
  retornDetall,
  textoEnvasos,
} from '../supabase/functions/_shared/oferta.ts'
import { diesValids, textDies, textOfertaPerCopiar, TANCAMENT_BOT } from '../supabase/functions/_shared/textOferta.ts'

/** Campos mínimos de una oferta, para variar solo lo que cada prueba mira. */
function campos(extra: Partial<Parameters<typeof componerTextoOferta>[0]> = {}) {
  return {
    producte: 'Tomàquet',
    productor: 'Can Prova SCP',
    municipi: 'Gavà',
    ubicacio: 'https://maps.app.goo.gl/prova',
    quantitat: '300 kg aprox',
    disponible: '23/07',
    horari: 'matí',
    modalitat: 'donació',
    causa: 'Excés de producció',
    envasos: 'No',
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
    const t = componerTextoOferta(campos({ observacions: 'Cal trucar abans' }))
    expect(t.startsWith('📢 *OFERTA DISPONIBLE*')).toBe(true)
    const orden = [
      'PRODUCTE:',
      'PRODUCTOR:',
      'MUNICIPI:',
      'PUNT DE RECOLLIDA:',
      'QUANTITAT:',
      'DISPONIBLE FINS:',
      'HORARI DE RECOLLIDA:',
      'MODALITAT:',
      'CAUSA:',
      'ENVASOS:',
      'OBSERVACIONS:',
    ]
    const posiciones = orden.map((s) => t.indexOf(s))
    expect(posiciones.every((p) => p >= 0)).toBe(true)
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)
  })

  it('la ubicación va en su propia línea, porque es un enlace', () => {
    const t = componerTextoOferta(campos())
    const lineas = t.split('\n')
    const i = lineas.findIndex((l) => l.includes('PUNT DE RECOLLIDA:'))
    expect(lineas[i + 1]).toBe('https://maps.app.goo.gl/prova')
  })

  // La última línea es la que arranca el diálogo de aceptación: si dejara de decir SÍ/NO,
  // `clasificar()` seguiría esperando unas palabras que ya nadie estaría invitando a usar.
  it('termina explicando cómo aceptar, con el SÍ y el NO que espera el diálogo', () => {
    const t = componerTextoOferta(campos())
    expect(t.trimEnd().endsWith(
      "✅ Si t'interessa, prem *M'interessa* (o respon *SÍ*); si no, *Ara no*.",
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

  // 🔴 CAMBIADO A PROPÓSITO (fase C del punto 3, filas 3.7.5 y 3.7.6, 17-11-2026). Hasta
  // entonces `observacions` y `responsable` dejaban su etiqueta vacía («se lee como no hi
  // ha»). La Fundació pide lo contrario: ninguna etiqueta vacía y fuera «RESPONSABLE» del todo
  // (y la línea de transporte, que ya no se pregunta).
  it('ninguna etiqueta vacía: sin observaciones no sale la línea, y RESPONSABLE ya no existe', () => {
    const t = componerTextoOferta(campos({ observacions: '' }))
    expect(t).not.toContain('OBSERVACIONS')
    expect(t).not.toContain('RESPONSABLE')
    expect(t).not.toContain('TRANSPORT')
    expect(componerTextoOferta(campos({ observacions: '  ' }))).not.toContain('OBSERVACIONS')
    expect(componerTextoOferta(campos({ observacions: 'Cal trucar' }))).toContain('📝 OBSERVACIONS: Cal trucar')
  })

  it('ninguna línea acaba en «:» salvo PUNT DE RECOLLIDA, con el enlace en la siguiente', () => {
    const buida = componerTextoOferta({ producte: 'Pera', productor: '', municipi: '', quantitat: '', modalitat: '' })
    expect(buida.split('\n').filter((l) => /:\s*$/.test(l))).toEqual([])
    const linies = componerTextoOferta(campos()).split('\n')
    const sols = linies.map((l, i) => [l, i] as const).filter(([l]) => /:\s*$/.test(l))
    expect(sols.map(([l]) => l)).toEqual(['🗺️ PUNT DE RECOLLIDA:'])
    expect(linies[sols[0][1] + 1]).toMatch(/^https?:/)
  })

  it('la variedad va con el producto, entre paréntesis', () => {
    expect(componerTextoOferta(campos({ varietat: 'Raf' }))).toContain('🌿 PRODUCTE: Tomàquet (Raf)')
  })

  it('los valores se imprimen tal cual, sin tocarlos', () => {
    const t = componerTextoOferta(campos({ producte: 'Tomàquet de penjar', municipi: 'Gavà' }))
    expect(t).toContain('🌿 PRODUCTE: Tomàquet de penjar')
    expect(t).toContain('📍 MUNICIPI: Gavà')
  })
})

// ---------------------------------------------------------------------------
// Etiquetas sin valor: `ubicacio`, `horari` y `envasos` SÍ desaparecen si están vacíos
// ---------------------------------------------------------------------------
// Al revés que `observacions`/`responsable` (arriba): son campos opcionales del panel sin
// respuesta, no texto que alguien haya escrito y esté vacío por decisión. Hasta el
// 22-09-2026 se imprimían igual, y el mensaje salía con «🗺️ UBICACIÓ:» seguido de un guion
// suelto y con «HORARI RECOLLIDA:»/«ENVASOS:» sin nada detrás — ruido en un mensaje que se
// lee en el móvil, el mismo criterio que ya se aplicaba a `producte_al_camp`/`preu_minim`
// (deuda §12.122).
describe('componerTextoOferta · etiquetas que desaparecen si no hay nada que decir', () => {
  it('sin enlace de ubicació no sale ni la etiqueta ni la línea', () => {
    const t = componerTextoOferta(campos({ ubicacio: undefined }))
    expect(t).not.toContain('PUNT DE RECOLLIDA')
  })

  it('sin horari no sale la línea', () => {
    const t = componerTextoOferta(campos({ horari: '' }))
    expect(t).not.toContain('HORARI')
  })

  it('sin envasos no sale la línea', () => {
    const t = componerTextoOferta(campos({ envasos: '' }))
    expect(t).not.toContain('ENVASOS')
  })

  it('con los tres presentes, se imprimen los tres', () => {
    const t = componerTextoOferta(campos())
    expect(t).toContain('🗺️ PUNT DE RECOLLIDA:')
    expect(t).toContain('⏰ HORARI DE RECOLLIDA: matí')
    expect(t).toContain('♻️ ENVASOS: No')
  })
})

// ---------------------------------------------------------------------------
// Producte al camp: lo que la entidad tiene que saber antes de decir que sí
// ---------------------------------------------------------------------------
// `excedentes.producte_al_camp` (20270328101000) declara que lo ofrecido TODAVÍA NO ESTÁ
// RECOGIDO. Decide dos cosas: que el equipo pueda convertir la oferta en una jornada de
// espigueo sin duplicar la entrada, y qué se está comprometiendo a hacer quien la acepta
// —ir a una finca a collir no es pasar a recoger unos palots—.

describe('esProducteAlCamp: traducir la respuesta a un boolean', () => {
  // El intake guarda el `id` de la fila pulsada; el panel, el `value` del desplegable. Los
  // dos son la misma cadena hoy, y aun así el traductor existe porque el error de leerlo
  // mal no da ningún fallo: publica una oferta que afirma algo que nadie ha dicho.
  it('reconoce el id que mandan los dos canales', () => {
    expect(esProducteAlCamp('si')).toBe(true)
    expect(esProducteAlCamp('no')).toBe(false)
  })

  it('tolera el acento, las mayúsculas y los espacios', () => {
    expect(esProducteAlCamp('Sí')).toBe(true)
    expect(esProducteAlCamp(' SÍ ')).toBe(true)
    expect(esProducteAlCamp('No')).toBe(false)
  })

  it('acepta el boolean por si algún día la pantalla es una casilla', () => {
    expect(esProducteAlCamp(true)).toBe(true)
    expect(esProducteAlCamp(false)).toBe(false)
    expect(esProducteAlCamp('true')).toBe(true)
  })

  // Lo importante: ante la duda, false. Es el default de la columna y el estado de todas
  // las ofertas anteriores; un `true` inventado metería la oferta en la cola de
  // espigolades del equipo y se lo diría a la entidad en el texto publicado.
  it('cualquier otra cosa es false, que es el lado seguro', () => {
    expect(esProducteAlCamp(undefined)).toBe(false)
    expect(esProducteAlCamp(null)).toBe(false)
    expect(esProducteAlCamp('')).toBe(false)
    expect(esProducteAlCamp('potser')).toBe(false)
    expect(esProducteAlCamp(0)).toBe(false)
  })
})

describe('componerTextoOferta · producte al camp', () => {
  it('no dice nada cuando el producto ya está collit', () => {
    expect(componerTextoOferta(campos())).not.toContain('PRODUCTE AL CAMP')
    expect(componerTextoOferta(campos({ producteAlCamp: false }))).not.toContain('PRODUCTE AL CAMP')
  })

  it('lo avisa cuando todavía hay que collir-ho', () => {
    expect(componerTextoOferta(campos({ producteAlCamp: true })))
      .toContain("🌱 PRODUCTE AL CAMP: sí (encara no s'ha collit)")
  })

  // Va pegada al producto y no al final: la entidad decide leyendo las primeras líneas, y
  // esto cambia lo que significa aceptar. Enterrada entre las observaciones no la ve nadie.
  it('sale justo después del producte, antes que el productor', () => {
    const t = componerTextoOferta(campos({ producteAlCamp: true }))
    const lineas = t.split('\n')
    const i = lineas.findIndex((l) => l.includes('PRODUCTE:'))
    expect(lineas[i + 1]).toContain('PRODUCTE AL CAMP:')
    expect(lineas[i + 2]).toContain('PRODUCTOR:')
  })

  it('el resto del mensaje sigue entero, con su cierre de SÍ/NO', () => {
    const t = componerTextoOferta(campos({ producteAlCamp: true, preu: '0.8 €/kg' }))
    for (const etiqueta of ['MUNICIPI:', 'QUANTITAT:', 'MODALITAT:', 'PREU MÍNIM:', 'CAUSA:',
      'ENVASOS:']) {
      expect(t, `falta ${etiqueta}`).toContain(etiqueta)
    }
    expect(t.trimEnd().endsWith(
      "✅ Si t'interessa, prem *M'interessa* (o respon *SÍ*); si no, *Ara no*.",
    )).toBe(true)
  })
})

// Fase A del punto 3 (17-11-2026): qué envases y cuántos, los días de recogida y el enlace de
// Maps propio de la oferta. El resto del texto no cambia.
describe('retorno con detalle, días y Maps de la oferta', () => {
  it('textoEnvasos: con retorno, cantidad y envase entre paréntesis', () => {
    expect(textoEnvasos(undefined, 'Sí', 'caixes de plàstic verdes', 20))
      .toBe('cal retornar-los (20 · caixes de plàstic verdes)')
    expect(textoEnvasos(undefined, 'Sí', '', '')).toBe('cal retornar-los')
    expect(textoEnvasos(undefined, 'Sí', '  ', 2.5)).toBe('cal retornar-los')
    // Con «No», lo que quedara escrito no se imprime.
    expect(textoEnvasos(undefined, 'No', 'caixes', 20)).toBe('no cal retornar-los')
  })

  it('textDies y diesValids: en orden, sin repetir y descartando lo raro', () => {
    expect(diesValids([5, 1, 3, 1, 0, 8, '2', 'x'])).toEqual([1, 2, 3, 5])
    expect(diesValids('dl')).toEqual([])
    expect(textDies([7, 1, 3])).toBe('dl, dc, dg')
    expect(textDies(null)).toBe('')
  })

  // Fase C del punto 3 (fila 3.7.6): días y franja en UNA línea, la del horario, tras la fecha.
  it('los días van en la línea del horario, con la franja, tras DISPONIBLE FINS', () => {
    const amb = componerTextoOferta(campos({ dies: 'dl, dc', horari: 'de 8:00 a 12:00' }))
    const linies = amb.split('\n')
    const i = linies.findIndex((l) => l.startsWith('📅 DISPONIBLE FINS'))
    expect(linies[i + 1]).toBe('⏰ HORARI DE RECOLLIDA: dl, dc · de 8:00 a 12:00')
    expect(componerTextoOferta(campos({ dies: 'dl', horari: '' }))).toContain('⏰ HORARI DE RECOLLIDA: dl\n')
    expect(componerTextoOferta(campos())).not.toContain('DIES')
  })

  it('textoEnvasos: formato, cuántos y retorno (fila 3.7.6)', () => {
    expect(textoEnvasos('caixes', 'Sí', 'caixes verdes', 12, 20))
      .toBe('20 caixes · cal retornar-los (12 · caixes verdes)')
    expect(textoEnvasos('palet', 'No', '', null, 1)).toBe('1 palet · no cal retornar-los')
    expect(textoEnvasos('caixes', 'No', '', null, null)).toBe('Caixes · no cal retornar-los')
    expect(textoEnvasos('envasos_propis', undefined)).toBe('Cal portar envasos propis')
    expect(textoEnvasos(undefined, undefined)).toBe('')
  })

  it('mapsOferta: solo http(s) de hasta 500 caracteres', () => {
    expect(mapsOferta(' https://maps.app.goo.gl/x ')).toBe('https://maps.app.goo.gl/x')
    expect(mapsOferta('maps.app.goo.gl/x')).toBeNull()
    expect(mapsOferta(`https://x.y/${'a'.repeat(500)}`)).toBeNull()
    expect(mapsOferta(undefined)).toBeNull()
  })

  it('retornDetall: solo con retorno «Sí»', () => {
    expect(retornDetall({ retorn: 'Sí', retorn_envasos: ' caixes ', retorn_quantitat: '20' }))
      .toEqual({ detall: 'caixes', quantitat: 20 })
    expect(retornDetall({ retorn: 'Sí', retorn_envasos: '', retorn_quantitat: 0 }))
      .toEqual({ detall: null, quantitat: null })
    expect(retornDetall({ retorn: 'No', retorn_envasos: 'caixes', retorn_quantitat: 20 }))
      .toEqual({ detall: null, quantitat: null })
  })
})

describe('textOfertaPerCopiar (fase 4 de los puntos 4-6)', () => {
  const text = componerTextoOferta({ producte: 'Carbassa', quantitat: '100 kg' })
  it('cambia el cierre del bot por el del enlace', () => {
    const r = textOfertaPerCopiar(text, 'https://x.test/receptor/mercat?oferta=1&accio=interes')
    expect(r).not.toContain(TANCAMENT_BOT)
    expect(r.endsWith("dia i l'hora de recollida:\nhttps://x.test/receptor/mercat?oferta=1&accio=interes")).toBe(true)
  })
  it('sin enlace, pide responder al mensaje', () => {
    const r = textOfertaPerCopiar(text, null)
    expect(r).not.toContain(TANCAMENT_BOT)
    expect(r).toContain('respon aquest missatge')
    expect(r.startsWith('📢 *OFERTA DISPONIBLE*')).toBe(true)
  })
  it('un texto sin el cierre del bot también recibe el nuevo', () => {
    expect(textOfertaPerCopiar('Hola', '')).toBe("Hola\n\n✅ Si t'interessa, respon aquest missatge amb els kg que vols recollir, el dia i l'hora de recollida.")
  })
})
