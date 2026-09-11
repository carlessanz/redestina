// Los bloques de una plantilla: interpolación de marcadores y aplanado a texto.
//
// Por qué esto no es «formateo»: `cuerpoATexto()` produce el texto que la página de firma
// enseña y cuyo sha256 se guarda en `evidencias.sha256_texto`. Esa huella es lo ÚNICO que
// acredita qué firmó una persona. La cabecera del fichero lo avisa con todas las letras:
// «la forma exacta de esta salida es parte del contrato de la evidencia; cambiarla (añadir
// una línea en blanco, cambiar la viñeta) hace que la huella de una firma futura no se
// pueda comparar con la de una anterior sobre el mismo texto».
//
// Traducido: si alguien mete un `trim()` de más aquí, ningún test de integración se pondrá
// rojo, ningún PDF saldrá mal, y dentro de dos años no se podrá demostrar que dos convenios
// idénticos lo eran. Por eso estas pruebas fijan la salida carácter a carácter.
//
// La otra mitad —que un marcador sin valor se quede VISIBLE en vez de vaciarse— es la
// decisión que impide emitir un documento legal con un silencio donde iba un NIF.

import { describe, it, expect } from 'vitest'
import {
  interpolar,
  interpolarCuerpo,
  esCuerpo,
  cuerpoATexto,
  type Bloque,
} from '../supabase/functions/_shared/pdf/bloques.ts'

describe('interpolar', () => {
  it('sustituye un marcador por su valor', () => {
    expect(interpolar('Hola {{nom}}', { nom: 'Anna' }).texto).toBe('Hola Anna')
  })

  it('tolera los espacios de dentro de las llaves', () => {
    expect(interpolar('{{ nom }}', { nom: 'Anna' }).texto).toBe('Anna')
    expect(interpolar('{{  nom  }}', { nom: 'Anna' }).texto).toBe('Anna')
  })

  it('resuelve rutas anidadas', () => {
    const v = { donant: { nom: 'Can Prova', nif: 'B00000000' } }
    expect(interpolar('{{donant.nom}} — NIF {{donant.nif}}', v).texto)
      .toBe('Can Prova — NIF B00000000')
  })

  // La decisión central del módulo. Vaciar el hueco produciría «NIF  —» y nadie lo vería
  // al hojear; dejarlo visible hace imposible firmar un documento a medias sin notarlo, y
  // además el llamante puede negarse a emitir mirando `faltan`.
  it('un marcador sin valor se queda literal y se acusa en «faltan»', () => {
    const r = interpolar('NIF {{organitzacio.nif}}', {})
    expect(r.texto).toBe('NIF {{organitzacio.nif}}')
    expect(r.faltan).toEqual(['organitzacio.nif'])
  })

  it('null, undefined y la cadena vacía cuentan todos como «sin valor»', () => {
    for (const valor of [null, undefined, '']) {
      const r = interpolar('X {{a}}', { a: valor })
      expect(r.texto).toBe('X {{a}}')
      expect(r.faltan).toEqual(['a'])
    }
  })

  // ⚠️ El 0 y el false SÍ son valores. Si se comprobaran con un `if (!valor)`, un importe
  // de 0 € o un «no» se imprimirían como el marcador crudo dentro de un documento legal.
  it('el 0 y el false son valores, no huecos', () => {
    expect(interpolar('{{kg}} kg', { kg: 0 }).texto).toBe('0 kg')
    expect(interpolar('{{kg}} kg', { kg: 0 }).faltan).toEqual([])
    expect(interpolar('retorn: {{r}}', { r: false }).texto).toBe('retorn: false')
  })

  it('una ruta que atraviesa algo que no es objeto no revienta: es un hueco', () => {
    const r = interpolar('{{a.b.c}}', { a: 'texto' })
    expect(r.texto).toBe('{{a.b.c}}')
    expect(r.faltan).toEqual(['a.b.c'])
  })

  it('el mismo marcador repetido se sustituye en todas sus apariciones', () => {
    expect(interpolar('{{n}} i {{n}} i {{n}}', { n: 'A' }).texto).toBe('A i A i A')
  })

  // `interpolar` NO deduplica: devuelve una entrada por aparición. Quien deduplica es
  // `interpolarCuerpo` (con un Set), y las dos pruebas de al lado lo fijan por separado
  // para que no se cambie una creyendo que la otra lo cubre.
  it('un marcador sin valor repetido aparece tantas veces como sale', () => {
    expect(interpolar('{{x}} {{x}}', {}).faltan).toEqual(['x', 'x'])
  })

  it('«faltan» conserva el orden de aparición', () => {
    expect(interpolar('{{c}} {{a}} {{b}}', {}).faltan).toEqual(['c', 'a', 'b'])
  })

  it('un texto sin marcadores sale intacto', () => {
    const t = 'Clàusula primera. Les parts acorden el següent:'
    const r = interpolar(t, { lo: 'que sea' })
    expect(r.texto).toBe(t)
    expect(r.faltan).toEqual([])
  })

  it('lo que no encaja con el patrón no se toca', () => {
    // Llave sencilla, llave sin cerrar y caracteres fuera del alfabeto del marcador.
    expect(interpolar('{nom} {{nom', { nom: 'A' }).texto).toBe('{nom} {{nom')
    expect(interpolar('{{no-val}}', { 'no-val': 'X' }).texto).toBe('{{no-val}}')
  })
})

describe('interpolarCuerpo', () => {
  const cuerpo: Bloque[] = [
    { tipo: 'h1', text: 'Conveni amb {{org.nom}}' },
    { tipo: 'p', text: 'NIF {{org.nif}}.' },
    { tipo: 'lista', text: ['Primer: {{org.nom}}', 'Segon: {{falta}}'] },
    { tipo: 'salt' },
  ]

  it('interpola títulos, párrafos y cada elemento de una lista', () => {
    const r = interpolarCuerpo(cuerpo, { org: { nom: 'Can Prova', nif: 'B1' } })
    expect(r.bloques[0]).toEqual({ tipo: 'h1', text: 'Conveni amb Can Prova' })
    expect(r.bloques[1]).toEqual({ tipo: 'p', text: 'NIF B1.' })
    expect(r.bloques[2]).toEqual({
      tipo: 'lista',
      text: ['Primer: Can Prova', 'Segon: {{falta}}'],
    })
  })

  it('el salto de página pasa sin texto y sin estorbar', () => {
    const r = interpolarCuerpo(cuerpo, { org: { nom: 'X', nif: 'Y' } })
    expect(r.bloques[3]).toEqual({ tipo: 'salt' })
  })

  it('acumula los marcadores sin resolver de todos los bloques, sin repetirlos', () => {
    const r = interpolarCuerpo(
      [
        { tipo: 'p', text: '{{a}} {{b}}' },
        { tipo: 'p', text: '{{a}}' },
        { tipo: 'lista', text: ['{{a}}', '{{c}}'] },
      ],
      {},
    )
    expect(r.faltan).toEqual(['a', 'b', 'c'])
  })

  it('no modifica los bloques de entrada', () => {
    const entrada: Bloque[] = [{ tipo: 'p', text: 'Hola {{n}}' }]
    interpolarCuerpo(entrada, { n: 'Anna' })
    expect(entrada[0].text).toBe('Hola {{n}}')
  })

  it('un cuerpo vacío no falla', () => {
    expect(interpolarCuerpo([], {})).toEqual({ bloques: [], faltan: [] })
  })
})

describe('esCuerpo: validar lo que llega de un jsonb', () => {
  it('acepta un cuerpo con los seis tipos', () => {
    expect(esCuerpo([
      { tipo: 'h1', text: 'A' },
      { tipo: 'h2', text: 'B' },
      { tipo: 'h3', text: 'C' },
      { tipo: 'p', text: 'D' },
      { tipo: 'lista', text: ['E'] },
      { tipo: 'salt' },
    ])).toBe(true)
  })

  it('rechaza lo que no es un array de bloques', () => {
    expect(esCuerpo(null)).toBe(false)
    expect(esCuerpo(undefined)).toBe(false)
    expect(esCuerpo('texto')).toBe(false)
    expect(esCuerpo({ tipo: 'p' })).toBe(false)
    expect(esCuerpo([{ tipo: 'blockquote', text: 'x' }])).toBe(false)
    expect(esCuerpo([{ text: 'sin tipo' }])).toBe(false)
    expect(esCuerpo([null])).toBe(false)
  })

  // Comportamiento medido: un array vacío pasa la validación (`every` sobre vacío es
  // true). No es un descuido peligroso —`cuerpoATexto([])` da ''— pero significa que
  // `esCuerpo` no distingue «cuerpo válido» de «plantilla sin contenido»: quien quiera esa
  // distinción tiene que mirar la longitud, no esta función.
  it('un array vacío se considera cuerpo válido', () => {
    expect(esCuerpo([])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// El contrato de la evidencia
// ---------------------------------------------------------------------------
describe('cuerpoATexto: la forma exacta es parte de la huella', () => {
  it('los bloques se separan con UNA línea en blanco', () => {
    expect(cuerpoATexto([
      { tipo: 'h1', text: 'Títol' },
      { tipo: 'p', text: 'Primer paràgraf.' },
      { tipo: 'p', text: 'Segon paràgraf.' },
    ])).toBe('Títol\n\nPrimer paràgraf.\n\nSegon paràgraf.')
  })

  it('los títulos no llevan ninguna marca: son su propio texto', () => {
    expect(cuerpoATexto([{ tipo: 'h1', text: 'A' }])).toBe('A')
    expect(cuerpoATexto([{ tipo: 'h3', text: 'A' }])).toBe('A')
  })

  it('la lista lleva «· » delante de cada elemento y salto simple entre ellos', () => {
    expect(cuerpoATexto([{ tipo: 'lista', text: ['Un', 'Dos', 'Tres'] }]))
      .toBe('· Un\n· Dos\n· Tres')
  })

  // El salto de página es maquetación del PDF; en la pantalla de firma no existe. Si
  // imprimiera algo, el texto enseñado y el hasheado dejarían de ser el mismo.
  it('el salto de página no imprime nada, ni una línea en blanco de más', () => {
    expect(cuerpoATexto([
      { tipo: 'p', text: 'A' },
      { tipo: 'salt' },
      { tipo: 'p', text: 'B' },
    ])).toBe('A\n\nB')
  })

  it('un bloque con texto vacío no deja hueco', () => {
    expect(cuerpoATexto([
      { tipo: 'p', text: 'A' },
      { tipo: 'p', text: '' },
      { tipo: 'p' },
      { tipo: 'p', text: 'B' },
    ])).toBe('A\n\nB')
  })

  it('un cuerpo entero, de todos los tipos, sale así y no de otra forma', () => {
    const texto = cuerpoATexto([
      { tipo: 'h1', text: 'Conveni de col·laboració' },
      { tipo: 'h2', text: 'Primera. Objecte' },
      { tipo: 'p', text: 'Les parts acorden el següent.' },
      { tipo: 'lista', text: ['Lliurar el producte', 'Signar l’albarà'] },
      { tipo: 'salt' },
      { tipo: 'h3', text: 'Segona. Durada' },
      { tipo: 'p', text: 'Un any.' },
    ])
    expect(texto).toBe(
      'Conveni de col·laboració\n\n' +
        'Primera. Objecte\n\n' +
        'Les parts acorden el següent.\n\n' +
        '· Lliurar el producte\n· Signar l’albarà\n\n' +
        'Segona. Durada\n\n' +
        'Un any.',
    )
  })

  it('un cuerpo vacío da la cadena vacía', () => {
    expect(cuerpoATexto([])).toBe('')
    expect(cuerpoATexto([{ tipo: 'salt' }])).toBe('')
  })

  // Determinismo: es la propiedad de la que depende poder comparar dos huellas. Si la
  // función dependiera de la hora, del idioma del sistema o del orden de un objeto, la
  // misma entrada daría huellas distintas y `evidencias.sha256_texto` no probaría nada.
  it('la misma entrada da exactamente el mismo texto, llamada tras llamada', () => {
    const cuerpo: Bloque[] = [
      { tipo: 'h1', text: 'Títol' },
      { tipo: 'lista', text: ['Un', 'Dos'] },
      { tipo: 'salt' },
      { tipo: 'p', text: 'Final.' },
    ]
    const primera = cuerpoATexto(cuerpo)
    for (let i = 0; i < 5; i++) expect(cuerpoATexto(cuerpo)).toBe(primera)
    // Y con una copia estructuralmente igual, no con el mismo objeto.
    expect(cuerpoATexto(JSON.parse(JSON.stringify(cuerpo)))).toBe(primera)
  })

  // Interpolar y aplanar es el camino real (`textoConvenioPla`): pasar dos veces por él
  // con los mismos valores tiene que dar el mismo texto, o la comprobación de «el document
  // ha canviat» del POST de firma rechazaría firmas legítimas.
  it('interpolar + aplanar es estable: el camino completo también es determinista', () => {
    const plantilla: Bloque[] = [
      { tipo: 'h1', text: 'Conveni amb {{org.nom}}' },
      { tipo: 'lista', text: ['NIF {{org.nif}}', 'Exercici {{any}}'] },
    ]
    const valores = { org: { nom: 'Can Prova', nif: 'B00000000' }, any: 2027 }
    const a = cuerpoATexto(interpolarCuerpo(plantilla, valores).bloques)
    const b = cuerpoATexto(interpolarCuerpo(plantilla, valores).bloques)
    expect(a).toBe(b)
    expect(a).toBe('Conveni amb Can Prova\n\n· NIF B00000000\n· Exercici 2027')
  })
})
