// La heurística que decide si una entidad acepta o rechaza una oferta.
//
// Por qué esta suite importa más que las demás: `clasificar()` es una lista de palabras, y
// AGENTS.md §12.14 la tiene anotada como deuda precisamente por eso —«un texto corto que
// empiece por sí/no con una oferta pendiente podría clasificarse mal»—. La propia función
// lleva el aviso escrito encima: «sin test, esa fragilidad solo se descubre cuando una
// entidad acepta una oferta y el sistema entiende que la rechaza».
//
// Lo que esta suite hace, entonces, no es demostrar que la heurística es buena: es **dejar
// medido dónde acierta y dónde no**, para que la próxima persona que la toque sepa qué
// estaba rompiendo y qué estaba arreglando. Los casos del bloque final son exactamente los
// que la deuda teme, escritos con el resultado REAL, no con el deseable.
//
// Consecuencia de equivocarse: una fila de `oferta_respuestas` queda `rebutjada` (se cierra
// el diálogo y se le contesta «gràcies per contestar») o `acceptada` con kg que nadie pidió.
// Ninguna de las dos cosas se revisa después: la cola de aprobación solo ve el resultado.

import { describe, it, expect } from 'vitest'
import {
  normalizar,
  clasificar,
  parseNumero,
} from '../supabase/functions/_shared/respuestas.ts'

describe('normalizar', () => {
  it('quita acentos y baja a minúsculas', () => {
    expect(normalizar('SÍ')).toBe('si')
    expect(normalizar('Gràcies')).toBe('gracies')
    expect(normalizar('MOLTÍSSIMES GRÀCIES')).toBe('moltissimes gracies')
  })

  // ⚠️ EL COMENTARIO DEL CÓDIGO DICE LO CONTRARIO DE LO QUE PASA. En `respuestas.ts`, la
  // línea del `replace` está anotada «(ç se conserva)», y no es cierto: NFD descompone la
  // ç en «c» + cedilla combinante (U+0327), que cae dentro del rango U+0300–U+036F que el
  // `replace` borra. O sea que la ç se convierte en c.
  //
  // El comportamiento es el correcto —«no puç», mal escrito, acaba casando con «no puc» de
  // la lista de negativos—, pero la anotación engaña a quien vaya a tocar esa expresión.
  // Se deja medido aquí y se reporta como defecto de documentación, no de código.
  it('la ç se convierte en c, al contrario de lo que dice el comentario del código', () => {
    expect(normalizar('no puç')).toBe('no puc')
    expect(normalizar('Ça')).toBe('ca')
    expect(normalizar('Força')).toBe('forca')
  })

  it('y por eso un «no puç» mal escrito se sigue entendiendo', () => {
    expect(clasificar('no puç')).toBe('rebutjada')
  })

  it('los signos de puntuación se vuelven separadores', () => {
    expect(normalizar('Sí, gràcies!')).toBe('si gracies')
    expect(normalizar('no.')).toBe('no')
    expect(normalizar('bé; d’acord')).toBe('be d acord')
  })

  // El apóstrofo catalán llega de dos formas —la recta del teclado y la tipográfica que
  // pone iOS—, y las dos tienen que producir la misma cadena o «d'acord» solo casaría en
  // uno de los dos teléfonos.
  it('el apóstrofo recto y el tipográfico dan lo mismo', () => {
    expect(normalizar("d'acord")).toBe('d acord')
    expect(normalizar('d’acord')).toBe('d acord')
  })

  it('colapsa espacios y recorta', () => {
    expect(normalizar('  si    us   plau  ')).toBe('si us plau')
    expect(normalizar('   ')).toBe('')
    expect(normalizar('')).toBe('')
  })
})

describe('clasificar: los síes claros', () => {
  it.each([
    'Sí',
    'SI',
    'sí!',
    'ok',
    'OK',
    'vale',
    "d'acord",
    'd’acord',
    'dacord',
    'Accepto',
    'La vull',
    'ho vull',
    'correcte',
    'perfecte',
    'endavant',
    'Sí, gràcies',
    'sí la vull',
  ])('«%s» es una aceptación', (texto) => {
    expect(clasificar(texto)).toBe('acceptada')
  })

  it('acepta también con la frase alrededor, si es corta', () => {
    expect(clasificar('Sí, ho volem')).toBe('acceptada')
    expect(clasificar('doncs ok')).toBe('acceptada')
    expect(clasificar('per nosaltres perfecte')).toBe('acceptada')
  })

  it('en castellano', () => {
    expect(clasificar('Sí, lo queremos')).toBe('acceptada')
    expect(clasificar('vale')).toBe('acceptada')
    expect(clasificar('ok, perfecto')).toBe('acceptada')
  })
})

describe('clasificar: los noes claros', () => {
  it.each([
    'No',
    'NO',
    'no.',
    'no puc',
    'no la vull',
    'no ho vull',
    'no em va bé',
    'rebutjo',
    'descarto',
    'ara no',
    'No, gràcies',
    'no interessa',
  ])('«%s» es un rechazo', (texto) => {
    expect(clasificar(texto)).toBe('rebutjada')
  })

  // El orden importa y está escrito en el código: los negativos se comprueban ANTES. Si
  // fuera al revés, «no la vull» casaría con «vull» y se leería como aceptación —el error
  // más caro posible, porque el sistema comprometería kilos que nadie ha pedido—.
  it('«no la vull» no se lee como «vull»', () => {
    expect(clasificar('no la vull')).toBe('rebutjada')
    expect(clasificar('no ho vull')).toBe('rebutjada')
  })

  it('el «no» al final también cuenta', () => {
    expect(clasificar('aquesta setmana no')).toBe('rebutjada')
    expect(clasificar('avui no')).toBe('rebutjada')
  })

  it('en castellano', () => {
    expect(clasificar('no, gracias')).toBe('rebutjada')
    expect(clasificar('ahora no')).toBe('rebutjada')
  })
})

describe('clasificar: lo que NO se puede decidir devuelve null', () => {
  // Devolver null es la respuesta segura: el webhook deja pasar el mensaje al intake y no
  // toca la fila. Un falso positivo, en cambio, cierra el diálogo sin remedio.
  it.each([
    '',
    '   ',
    'Quan la podeu portar?',
    'a quina hora?',
    'gràcies',
    'bon dia',
    'depèn',
    'potser',
    'us truco després',
    '👍',
    '200',
  ])('«%s» no se clasifica', (texto) => {
    expect(clasificar(texto)).toBeNull()
  })

  // La guarda del párrafo largo: por encima de 5 palabras solo vale la coincidencia
  // EXACTA, que en un párrafo no se da nunca. Es lo que impide que una explicación larga
  // que mencione un «no» de pasada cierre la oferta.
  it('un párrafo largo no dispara, aunque lleve palabras de la lista', () => {
    expect(clasificar(
      'Bon dia, no sabem encara si tindrem furgoneta aquesta setmana, us ho direm demà',
    )).toBeNull()
    expect(clasificar(
      'Moltes gràcies per avisar-nos, ho comentem a l’equip i us diem alguna cosa aviat',
    )).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Los casos límite que la deuda §12.14 teme, con su comportamiento REAL
// ---------------------------------------------------------------------------
// Esto no es una lista de aspiraciones: es lo que la función devuelve HOY. Se escribe para
// que un cambio en la heurística tenga que pasar por aquí y decidir a conciencia qué se
// mueve. Donde el resultado medido es el equivocado, lo dice el comentario.
describe('casos límite (comportamiento medido, deuda §12.14)', () => {
  it('la frontera de las 5 palabras: la misma frase se clasifica o no según su largo', () => {
    // 5 palabras → «corto» → entra por «empieza por no»
    expect(clasificar('no ens va bé això')).toBe('rebutjada')
    // 6 palabras → ya no es corto → exige coincidencia exacta, que no hay
    expect(clasificar('no ens va gens bé això')).toBeNull()
  })

  // ✅ Acierto: el párrafo largo que empieza por «no» NO se clasifica. Es justo el caso que
  // la deuda nombra, y la guarda del `corto` lo cubre.
  it('un mensaje largo que empieza por «no» se deja sin clasificar', () => {
    expect(clasificar(
      'No us ho puc confirmar fins dilluns, però en principi ens interessa molt aquesta oferta',
    )).toBeNull()
  })

  // ❌ FALLO REAL, medido: «no hi ha problema» es una ACEPTACIÓN en lenguaje corriente y se
  // clasifica como rechazo, porque son 4 palabras y empieza por «no ». La fila queda
  // `rebutjada` y la entidad recibe «gràcies per contestar». No se ablanda la aserción: se
  // deja escrito el resultado real y se anota en el informe.
  it('«no hi ha problema» (aceptación) se lee como RECHAZO', () => {
    expect(clasificar('no hi ha problema')).toBe('rebutjada')
    expect(clasificar('cap problema no')).toBe('rebutjada')
  })

  // ❌ FALLO REAL, medido: un «sí» seguido de una negación se queda con el «sí» porque los
  // negativos se comprueban por «empieza/termina por» y aquí el «no» va en medio. La regla
  // que protege de lo contrario («no la vull») deja este flanco abierto.
  it('«sí, però no ens va bé» se lee como ACEPTACIÓN', () => {
    expect(clasificar('si no ens va be')).toBe('acceptada')
  })

  // ❌ FALLO REAL, medido: «si us plau» / «si de cas» son subordinadas condicionales, no un
  // «sí». La heurística no distingue el «si» sin acento del «sí» acentuado porque
  // `normalizar()` quita los acentos antes de mirar —que es lo que hace que «SI» en
  // mayúsculas funcione—.
  it('«si us plau» y «si de cas» se leen como ACEPTACIÓN', () => {
    expect(clasificar('si us plau')).toBe('acceptada')
    expect(clasificar('si de cas us truco')).toBe('acceptada')
  })

  // Hueco de vocabulario: el castellano «de acuerdo» no está en la lista (sí está el
  // catalán «d'acord»), así que un receptor castellanohablante que conteste así no se
  // clasifica. Es el fallo barato: cae al intake y no cierra nada.
  it('«de acuerdo» (castellano) no está en la lista y no se clasifica', () => {
    expect(clasificar('de acuerdo')).toBeNull()
    expect(clasificar('estamos de acuerdo')).toBeNull()
  })

  // Un «no» pegado a otra palabra sin espacio no casa: la comprobación es por palabra.
  it('«nooo» y «sip» no casan', () => {
    expect(clasificar('nooo')).toBeNull()
    expect(clasificar('sip')).toBeNull()
  })
})

describe('parseNumero', () => {
  it('lee el número tal cual', () => {
    expect(parseNumero('200')).toBe(200)
    expect(parseNumero('0')).toBe(0)
  })

  it('acepta la coma decimal, que es como se escribe aquí', () => {
    expect(parseNumero('150,5')).toBe(150.5)
  })

  it('lo encuentra dentro de una frase', () => {
    expect(parseNumero('uns 300 kg')).toBe(300)
    expect(parseNumero('en volem 120 si pot ser')).toBe(120)
  })

  it('se queda con el PRIMER número', () => {
    expect(parseNumero('entre 100 i 200')).toBe(100)
  })

  it('sin número, null', () => {
    expect(parseNumero(null)).toBeNull()
    expect(parseNumero('')).toBeNull()
    expect(parseNumero('no ho sé')).toBeNull()
    expect(parseNumero('tots els que hi hagi')).toBeNull()
  })

  // El punto es separador de MILLARES en català y en castellano, no decimal. Es el error
  // de mil veces: quien pide «1.500 kg» y queda registrado con 1,5 kg no lo detecta nadie,
  // porque el diálogo solo comprueba `kg > 0` y no repregunta. Estas pruebas sujetan la
  // regla para que nadie la simplifique de vuelta a un `[.,]` indistinto.
  it('el punto de millar no se come tres ceros', () => {
    expect(parseNumero('1.500 kg')).toBe(1500)
    expect(parseNumero('12.345')).toBe(12345)
    expect(parseNumero('1.234.567')).toBe(1234567)
  })

  it('millar y decimal a la vez', () => {
    expect(parseNumero('1.500,5')).toBe(1500.5)
  })

  // El caso irreducible: `1.5` puede ser uno y medio o un millar mal escrito, y no hay
  // forma de saberlo. Se elige decimal porque equivocarse ahí cuesta 0,5 kg, y
  // equivocarse al revés costaba 1.498,5.
  it('un punto que no es millar se respeta como decimal', () => {
    expect(parseNumero('1.5')).toBe(1.5)
    expect(parseNumero('0.75')).toBe(0.75)
    expect(parseNumero('12.34')).toBe(12.34)
  })
})
