// El cuestionario de la oferta: los 14 pasos, cuáles son obligatorios y cuál se salta.
//
// Por qué importa: este módulo es la ÚNICA definición del cuestionario, y la comparten dos
// interfaces que no se parecen en nada —el intake conversacional de WhatsApp (`intake.ts`,
// que recorre `PASOS`) y el formulario del panel del productor, que la pide por
// `GET /crear-oferta/campos`—. La cabecera del fichero lo dice: es «la única forma de que
// "el mismo formulario" siga siendo cierto dentro de seis meses». Si alguien añade un paso
// a `PASOS` y olvida el `CampoOferta`, el bot preguntaría algo que el panel no sabe pintar;
// si toca `aplica()`, el productor de una donación se encontraría preguntándole un precio
// mínimo que su modalidad no tiene.
//
// `faltantes()` es además el guardia de `crear-oferta`: lo que devuelve vacío se da de alta.

import { describe, it, expect } from 'vitest'
import {
  PASOS,
  CAMPOS,
  MODALITATS,
  aplica,
  faltantes,
  type CampoOferta,
  type Paso,
} from '../supabase/functions/_shared/camposOferta.ts'

/** Busca el descriptor de un paso; falla la prueba si no existe (no devuelve undefined). */
function campo(clave: Paso): CampoOferta {
  const c = CAMPOS.find((x) => x.clave === clave)
  expect(c, `no hay descriptor para el paso "${clave}"`).toBeDefined()
  return c as CampoOferta
}

/** Una oferta completa de donación, para ir quitándole cosas en cada prueba. */
function donacionCompleta(): Record<string, unknown> {
  return {
    familia: 'Horta Fulla',
    producte: 'Enciam',
    varietat: '',
    kg: 300,
    caixes: 12,
    tipus_caixa: 'Palot',
    retorn: 'No',
    ubicacio: 'uuid-de-ubicacion',
    disponible_fins: '23/07',
    horari: 'matí',
    modalitat: 'donacio',
    causa: 'EXC',
    observacions: '',
  }
}

describe('PASOS y CAMPOS describen el mismo cuestionario', () => {
  // Las dos listas se escriben por separado y nada en el código las obliga a coincidir.
  // Si divergen, el intake recorre un paso que el panel no sabe pintar (o al revés).
  it('hay un descriptor por paso, y ninguno de más', () => {
    expect(CAMPOS.map((c) => c.clave)).toEqual([...PASOS])
  })

  it('son 14 pasos: 13 fijos más el condicional', () => {
    expect(PASOS).toHaveLength(14)
    expect(CAMPOS.filter((c) => c.condicion)).toHaveLength(1)
  })

  it('todo campo de tipo «opcions» trae sus opciones', () => {
    for (const c of CAMPOS.filter((x) => x.tipo === 'opcions')) {
      expect(c.opciones, `${c.clave} es «opcions» sin opciones`).toBeDefined()
      expect(c.opciones!.length).toBeGreaterThan(0)
    }
  })

  it('las etiquetas están en català, que es lo que se pregunta por WhatsApp', () => {
    expect(campo('familia').etiqueta).toBe('De quina família és el producte?')
    expect(campo('kg').etiqueta).toBe('Quants kg aproximadament?')
  })
})

describe('qué es obligatorio', () => {
  // Lo obligatorio es exactamente lo que una oferta necesita para poder publicarse: qué
  // es, cuánto hay, hasta cuándo, en qué modalidad y por qué. Todo lo demás afina.
  it('los siete campos obligatorios son los que permiten publicar', () => {
    const obligatorios = CAMPOS.filter((c) => c.obligatorio).map((c) => c.clave)
    expect(obligatorios).toEqual([
      'familia',
      'producte',
      'kg',
      'disponible_fins',
      'modalitat',
      'preu_minim',
      'causa',
    ])
  })

  it('varietat, caixes, horari y observacions son opcionales', () => {
    for (const c of ['varietat', 'caixes', 'horari', 'observacions'] as Paso[]) {
      expect(campo(c).obligatorio, `${c} no debería ser obligatorio`).toBe(false)
    }
  })

  // ⚠️ Divergencia conocida y documentada (AGENTS.md §6bis): `tipus_caixa` y `retorn` son
  // opcionales AQUÍ —y por tanto en el panel—, pero el intake los pregunta con lista y sin
  // fila «saltar», así que por WhatsApp no se puede avanzar sin contestarlos. Se deja
  // medido para que, si algún día se unifica, esta prueba avise de que ya no es cierto.
  it('tipus_caixa y retorn son opcionales en el descriptor (el intake los exige igual)', () => {
    expect(campo('tipus_caixa').obligatorio).toBe(false)
    expect(campo('retorn').obligatorio).toBe(false)
  })
})

describe('aplica: el preu mínim se salta en donació', () => {
  // Es la única condición del cuestionario, y es de negocio: en una donación no hay precio
  // que negociar, así que preguntarlo no es solo ruido, es contradecir la modalidad.
  it('en donació NO se pregunta el preu mínim', () => {
    expect(aplica(campo('preu_minim'), { modalitat: 'donacio' })).toBe(false)
  })

  it('en venda y en maquila SÍ se pregunta', () => {
    expect(aplica(campo('preu_minim'), { modalitat: 'venda' })).toBe(true)
    expect(aplica(campo('preu_minim'), { modalitat: 'maquila' })).toBe(true)
  })

  // Sin modalidad todavía no se puede saber, y el paso va DESPUÉS de `modalitat` en
  // `PASOS`, así que cuando se evalúa el dato ya está. Fuera de orden, no se pregunta.
  it('sin modalitat no se pregunta', () => {
    expect(aplica(campo('preu_minim'), {})).toBe(false)
    expect(aplica(campo('preu_minim'), { modalitat: null })).toBe(false)
  })

  it('una modalitat desconocida tampoco lo dispara', () => {
    expect(aplica(campo('preu_minim'), { modalitat: 'permuta' })).toBe(false)
  })

  it('los campos sin condición se preguntan siempre, haya lo que haya', () => {
    expect(aplica(campo('kg'), {})).toBe(true)
    expect(aplica(campo('causa'), { modalitat: 'donacio' })).toBe(true)
  })

  it('las tres modalitats del desplegable son las tres del check de la base', () => {
    expect(MODALITATS.map((m) => m.id)).toEqual(['donacio', 'venda', 'maquila'])
  })
})

describe('faltantes: qué impide dar de alta la oferta', () => {
  it('una donación completa no debe nada', () => {
    expect(faltantes(donacionCompleta())).toEqual([])
  })

  // El caso que justifica la condición: la misma oferta, sin preu_minim, es válida como
  // donación e inválida como venta.
  it('la misma oferta sin preu: válida en donació, incompleta en venda', () => {
    const d = donacionCompleta()
    expect(faltantes(d)).toEqual([])
    expect(faltantes({ ...d, modalitat: 'venda' })).toEqual(['preu_minim'])
  })

  it('en venda con preu, completa', () => {
    expect(faltantes({ ...donacionCompleta(), modalitat: 'venda', preu_minim: 0.8 })).toEqual([])
  })

  it('devuelve TODO lo que falta, en el orden del cuestionario', () => {
    expect(faltantes({})).toEqual([
      'familia',
      'producte',
      'kg',
      'disponible_fins',
      'modalitat',
      'causa',
    ])
  })

  it('lo opcional nunca aparece, aunque esté vacío', () => {
    const d = donacionCompleta()
    delete d.varietat
    delete d.caixes
    delete d.horari
    delete d.observacions
    delete d.tipus_caixa
    delete d.retorn
    delete d.ubicacio
    expect(faltantes(d)).toEqual([])
  })

  // Un campo «presente pero vacío» es un campo que falta: si no, un formulario enviado con
  // los inputs en blanco pasaría el guardia y se publicaría una oferta sin producto.
  it('la cadena vacía y los espacios cuentan como ausencia', () => {
    expect(faltantes({ ...donacionCompleta(), producte: '' })).toEqual(['producte'])
    expect(faltantes({ ...donacionCompleta(), producte: '   ' })).toEqual(['producte'])
    expect(faltantes({ ...donacionCompleta(), producte: null })).toEqual(['producte'])
    expect(faltantes({ ...donacionCompleta(), producte: undefined })).toEqual(['producte'])
  })

  // `kg` llega como número desde el panel y como texto desde el intake: los dos valen.
  it('acepta el valor como número o como texto', () => {
    expect(faltantes({ ...donacionCompleta(), kg: 300 })).toEqual([])
    expect(faltantes({ ...donacionCompleta(), kg: '300' })).toEqual([])
  })

  // ⚠️ Comportamiento medido, no deseado: `kg: 0` NO se considera ausente, porque el
  // guardia mira `String(v).trim() === ''` y "0" no lo es. Una oferta de 0 kg pasaría este
  // filtro; quien la corta después es `crearExcedente`, que guarda `kg_total: kg || null`.
  it('un 0 pasa el guardia (lo corta después crearExcedente)', () => {
    expect(faltantes({ ...donacionCompleta(), kg: 0 })).toEqual([])
  })
})
