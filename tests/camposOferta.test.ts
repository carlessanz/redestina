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
  SECCIONES,
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

describe('el cuestionario se explica a sí mismo', () => {
  // Estos textos son lo único que el productor tiene para decidir, y valen para los DOS
  // canales: lo que se escribe aquí lo lee quien rellena el formulario del panel y quien
  // contesta al bot. Un campo sin `ayuda` es una pregunta que solo entiende quien ya sabe
  // la respuesta —pasaba con `modalitat`, que ofrecía tres palabras sin decir que deciden
  // qué entidades pueden recibir la oferta y qué documento se acaba emitiendo—.
  it('los 14 campos tienen ayuda, y no vacía', () => {
    for (const c of CAMPOS) {
      expect(c.ayuda, `${c.clave} no tiene ayuda`).toBeDefined()
      expect(c.ayuda!.trim(), `la ayuda de ${c.clave} está vacía`).not.toBe('')
    }
  })

  it('las tres modalitats explican qué implica elegirlas', () => {
    expect(campo('modalitat').opciones).toHaveLength(3)
    for (const o of campo('modalitat').opciones!) {
      expect(o.descripcion, `la modalitat "${o.id}" no se explica`).toBeDefined()
      expect(o.descripcion!.trim()).not.toBe('')
    }
    // Y la que tiene consecuencia fiscal lo dice: es la única que emite certificado.
    expect(MODALITATS.find((m) => m.id === 'donacio')!.descripcion).toContain('certificat')
  })

  it('la ayuda de tipus_caixa nombra una opción que existe de verdad', () => {
    // Si alguien renombra el vocabulario de cajas, esta ayuda se queda señalando a una
    // opción fantasma y nadie lo vería hasta que un productor la buscara en el desplegable.
    const opciones = campo('tipus_caixa').opciones!.map((o) => o.titulo)
    expect(opciones).toContain('Productor/a')
    expect(campo('tipus_caixa').ayuda).toContain('Productor/a')
  })

  it('el ejemplo de formato de la fecha sobrevive a la explicación', () => {
    // La ayuda creció para decir qué pasa al vencer, pero el ejemplo va al final: sin él,
    // «fins quin dia» se contesta en cualquier formato y `parseDisponibleFins` no lo entiende.
    expect(campo('disponible_fins').ayuda).toMatch(/23\/07$/)
  })
})

describe('secciones: el cuestionario tiene estructura, no 14 campos seguidos', () => {
  it('cada campo declara una sección, y esa sección existe', () => {
    const claves = SECCIONES.map((s) => s.clau)
    for (const c of CAMPOS) {
      expect(claves, `la sección de ${c.clave} no está en SECCIONES`).toContain(c.seccion)
    }
  })

  it('ninguna sección se queda sin campos', () => {
    for (const s of SECCIONES) {
      expect(
        CAMPOS.some((c) => c.seccion === s.clau),
        `la sección "${s.clau}" no la usa ningún campo`,
      ).toBe(true)
    }
  })

  // Lo que hace que la estructura sirva para algo: los campos de una sección van SEGUIDOS.
  // Si se intercalaran, el panel tendría que pintar dos veces la misma cabecera y el orden
  // del formulario dejaría de ser el orden de `PASOS` —que es el que recorre el bot—.
  it('PASOS no intercala secciones: una vez cerrada, no vuelve a abrirse', () => {
    const vistas: string[] = []
    for (const c of CAMPOS) {
      if (vistas[vistas.length - 1] === c.seccion) continue
      expect(vistas, `la sección "${c.seccion}" reaparece en ${c.clave}`).not.toContain(c.seccion)
      vistas.push(c.seccion)
    }
    expect(vistas).toEqual(SECCIONES.map((s) => s.clau))
  })

  it('el reparto es el que espera el panel', () => {
    const porSeccion = (s: string) => CAMPOS.filter((c) => c.seccion === s).map((c) => c.clave)
    expect(porSeccion('producte')).toEqual(['familia', 'producte', 'varietat'])
    expect(porSeccion('quantitat')).toEqual(['kg', 'caixes', 'tipus_caixa', 'retorn'])
    expect(porSeccion('recollida')).toEqual(['ubicacio', 'disponible_fins', 'horari'])
    expect(porSeccion('modalitat')).toEqual(['modalitat', 'preu_minim'])
    expect(porSeccion('causa')).toEqual(['causa', 'observacions'])
  })

  it('las cabeceras están en català y no pasan por i18n', () => {
    const modalitat = SECCIONES.find((s) => s.clau === 'modalitat')!
    expect(modalitat.titol).toBe('Com vols donar-hi sortida')
    expect(modalitat.descripcio).toBe(
      'Decideix quines entitats la poden rebre i quin document es genera.',
    )
  })
})
