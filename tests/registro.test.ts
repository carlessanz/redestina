// El registro público decidiendo si una organización ya existe (etapa 2, deuda §12.28).
//
// POR QUÉ SE PRUEBA ESTO Y NO LA EDGE FUNCTION ENTERA. `registro/index.ts` usa `Deno.serve`
// y el import map de `jsr:`, así que queda fuera del alcance de Vitest (la cabecera de
// `vitest.config.ts` lo explica). Lo que sí se puede ejercitar —y es donde está todo lo que
// puede salir mal— es la decisión: `coincidencies.ts` no importa nada, ni siquiera Deno.
//
// Y LO QUE PUEDE SALIR MAL AQUÍ TIENE DOS CARAS MUY DISTINTAS:
//   · pasarse de prudente cuesta una fila duplicada que el equipo resuelve con un clic;
//   · quedarse corto significa dar por nueva una organización que ya está, o —peor— dar por
//     «la misma» a dos que no lo son, y eso más adelante es mezclar kilos y certificados
//     fiscales de dos donantes.
// Por eso casi todas las pruebas de abajo son de la segunda cara: que el nombre no cuente
// nunca, que el teléfono corto no case, y que un papel ya ocupado se vea aunque la ficha que
// lo ocupa no haya coincidido con nada.

import { describe, expect, it } from 'vitest'
import {
  algunTelefonCoincideix,
  clausTelefon,
  decidir,
  esForta,
  type FitxaCoincident,
  mateixEmail,
  mateixTelefon,
  motiuEmail,
  motiuTelefon,
  notaPaperNou,
  type OrgCoincident,
  patroTelefon,
  ultimes9,
} from '../supabase/functions/registro/coincidencies.ts'

// --- fábricas cortas, para que cada prueba diga solo lo suyo -----------------
function fitxa(over: Partial<FitxaCoincident> = {}): FitxaCoincident {
  return {
    tipus: 'productor',
    id: 'f1',
    organitzacio: 'o1',
    nom: 'Mas de Prova SCP',
    per: ['email'],
    ...over,
  }
}

function org(over: Partial<OrgCoincident> = {}): OrgCoincident {
  return { id: 'o1', nombre: 'Mas de Prova SCP', es_generadora: true, es_receptora: false, ...over }
}

describe('ultimes9: la clave con la que se comparan dos teléfonos', () => {
  it('se queda con las últimas 9 cifras, venga como venga', () => {
    expect(ultimes9('34612345678')).toBe('612345678')
    expect(ultimes9('+34 612 345 678')).toBe('612345678')
    expect(ultimes9('612345678')).toBe('612345678')
    expect(ultimes9('612-345-678 (Joan)')).toBe('612345678')
  })

  it('devuelve null por debajo de 9 cifras, nunca una clave corta', () => {
    // Un prefijo suelto casaría con centenares de fichas: la duda no puede producir
    // una coincidencia, tiene que producir «no sé».
    expect(ultimes9('12345678')).toBeNull()
    expect(ultimes9('')).toBeNull()
    expect(ultimes9(null)).toBeNull()
    expect(ultimes9(undefined)).toBeNull()
    expect(ultimes9('sense telefon')).toBeNull()
  })
})

describe('patroTelefon: el filtro grueso que va a la consulta', () => {
  const re = (nou: string) => new RegExp(patroTelefon(nou))

  it('encuentra el número esté guardado como esté', () => {
    // Los campos de teléfono son texto libre: el importador los normaliza, pero cualquier
    // edición posterior desde la ficha puede dejar espacios, guiones o un nombre detrás.
    expect(re('612345678').test('34612345678')).toBe(true)
    expect(re('612345678').test('+34 612 345 678')).toBe(true)
    expect(re('612345678').test('612-345-678')).toBe(true)
    expect(re('612345678').test('612345678 (Joan)')).toBe(true)
  })

  it('no encuentra un número distinto', () => {
    expect(re('612345678').test('34612345679')).toBe(false)
    expect(re('612345678').test('34600000000')).toBe(false)
  })

  it('lo encuentra también en MEDIO del campo (deuda §12.91)', () => {
    // Era el fallo visible: con el patrón anclado al final, un campo con dos números no
    // casaba, y como el ancla viaja en la consulta la fila ni llegaba a memoria.
    expect(re('612345678').test('612345678 / 933000000')).toBe(true)
    expect(re('612345678').test('Joan 612 345 678 (matins)')).toBe(true)
  })

  it('casa de más, y por eso NO es el criterio', () => {
    // `612345678` está dentro de `6123456789`, que es otro número. El prefiltro lo trae y
    // `mateixTelefon` lo descarta: una fila de más se tira, una que no se consulta no
    // se recupera.
    expect(re('612345678').test('6123456789')).toBe(true)
    expect(mateixTelefon('6123456789', '612345678')).toBe(false)
    // Y lo mismo cuando las nueve cifras aparecen dentro de una tirada más larga que no
    // se descompone en números enteros: el prefiltro la trae, el criterio la tira.
    expect(re('612345678').test('612345678912')).toBe(true)
    expect(mateixTelefon('612345678912', '612345678')).toBe(false)
  })
})

describe('clausTelefon: un campo de texto libre puede llevar más de un número', () => {
  it('un solo número da su clave, venga como venga', () => {
    expect(clausTelefon('34612345678')).toEqual(['612345678'])
    expect(clausTelefon('+34 612 345 678')).toEqual(['612345678'])
    expect(clausTelefon('612345678 (Joan)')).toEqual(['612345678'])
  })

  it('dos números en la misma celda dan las dos claves', () => {
    // La mitad NO evidente de la deuda §12.91: `ultimes9()` del campo entero devuelve las
    // del SEGUNDO número, así que quien se registraba con el primero no casaba ni con el
    // patrón arreglado.
    expect(clausTelefon('612345678 / 933000000').sort())
      .toEqual(['612345678', '933000000'])
    expect(clausTelefon('612345678 933000000').sort())
      .toEqual(['612345678', '933000000'])
  })

  it('nunca devuelve menos que ultimes9: lo que ya casaba sigue casando', () => {
    // Garantía de no regresión — la clave de siempre está siempre dentro del conjunto.
    for (const camp of ['34612345678', '0034612345678', '612345678 / 933000000', '933 000 000']) {
      expect(clausTelefon(camp)).toContain(ultimes9(camp))
    }
  })

  it('no inventa claves desplazando el corte una cifra', () => {
    // Un número que no empieza por prefijo español se lee como siempre (sus últimas 9) y
    // ahí se para: ir desplazando el corte fabricaría claves que no son ningún teléfono, y
    // cada clave de más es una coincidencia falsa que alguien tiene que mirar.
    expect(clausTelefon('393331234567')).toEqual(['331234567'])
  })

  it('un campo sin teléfono comparable no da ninguna clave', () => {
    expect(clausTelefon('sense telefon')).toEqual([])
    expect(clausTelefon('12345678')).toEqual([])
    expect(clausTelefon(null)).toEqual([])
  })
})

describe('algunTelefonCoincideix: la ficha tiene varias columnas de teléfono', () => {
  it('lo encuentra en telefono2 y en telefono3', () => {
    // `entidades` las trae del Excel SDA; mirar solo `telefono` dejaba fuera al contacto
    // que dio su móvil como segundo número.
    expect(algunTelefonCoincideix([null, '34612345678', null], '612345678')).toBe(true)
    expect(algunTelefonCoincideix(['933000000', null, '612345678'], '34612345678')).toBe(true)
  })

  it('lo encuentra en telefono_alt, que es donde el import dejó los extra', () => {
    expect(algunTelefonCoincideix(['933000000', '612345678'], '34612345678')).toBe(true)
  })

  it('un número distinto no casa por compartir el final', () => {
    // La dirección del fallo importa: de más, una ficha duplicada que el equipo resuelve;
    // de menos —o mal—, dos organizaciones fundidas con sus kilos y su certificado fiscal.
    expect(algunTelefonCoincideix(['34612345679', '933000000'], '612345678')).toBe(false)
    expect(algunTelefonCoincideix(['612345678', null], '345678')).toBe(false)
  })

  it('sin teléfono no casa con ninguna ficha', () => {
    expect(algunTelefonCoincideix(['34612345678', null, null], null)).toBe(false)
    expect(algunTelefonCoincideix([null, null], '34612345678')).toBe(false)
  })
})

describe('motiuTelefon: la columna decide la FUERZA de la coincidencia', () => {
  it('la principal manda, aunque el número esté también en una secundaria', () => {
    expect(motiuTelefon('34612345678', ['933000000'], '612345678')).toBe('telefon')
    expect(motiuTelefon('34612345678', ['612345678'], '612345678')).toBe('telefon')
  })

  it('solo en una secundaria, la señal es débil', () => {
    expect(motiuTelefon('933000000', ['34612345678'], '612345678')).toBe('telefon_secundari')
    expect(motiuTelefon(null, [null, '612345678'], '34612345678')).toBe('telefon_secundari')
  })

  it('sin coincidencia, nada', () => {
    expect(motiuTelefon('933000000', ['934000000'], '612345678')).toBeNull()
    expect(motiuTelefon('612345678', ['933000000'], null)).toBeNull()
  })
})

describe('esForta: qué coincidencia puede llegar a denegar un alta', () => {
  it('el correo y el teléfono principal son fuertes', () => {
    expect(esForta(['email'])).toBe(true)
    expect(esForta(['telefon'])).toBe(true)
    expect(esForta(['telefon_secundari', 'email'])).toBe(true)
  })

  it('un teléfono secundario, solo, no', () => {
    expect(esForta(['telefon_secundari'])).toBe(false)
    expect(esForta([])).toBe(false)
  })
})

describe('mateixTelefon y mateixEmail: el criterio de verdad', () => {
  it('el teléfono se compara por sus últimas 9 cifras', () => {
    expect(mateixTelefon('34612345678', '+34 612 345 678')).toBe(true)
    expect(mateixTelefon('612345678', '34612345678')).toBe(true)
    expect(mateixTelefon('34612345678', '34612345679')).toBe(false)
  })

  it('y casa aunque el campo guarde dos números', () => {
    expect(mateixTelefon('612345678 / 933000000', '34612345678')).toBe(true)
    expect(mateixTelefon('612345678 / 933000000', '933000000')).toBe(true)
    expect(mateixTelefon('612345678 / 933000000', '34600000000')).toBe(false)
  })

  it('un teléfono que no llega a 9 cifras no coincide ni consigo mismo', () => {
    expect(mateixTelefon('12345678', '12345678')).toBe(false)
    expect(mateixTelefon(null, null)).toBe(false)
    expect(mateixTelefon('', '')).toBe(false)
  })

  it('el correo ignora mayúsculas y espacios de los lados', () => {
    expect(mateixEmail('Hola@Example.com', ' hola@example.com ')).toBe(true)
    expect(mateixEmail('hola@example.com', 'hola+1@example.com')).toBe(false)
  })

  it('dos correos vacíos no son el mismo correo', () => {
    // Media base tiene el correo en blanco: sin esto, cualquier alta sin correo casaría
    // con todas ellas de golpe.
    expect(mateixEmail('', '')).toBe(false)
    expect(mateixEmail(null, undefined)).toBe(false)
  })
})

describe('decidir: los tres casos', () => {
  it('caso 1 — sin coincidencias, alta normal', () => {
    expect(decidir('productor', [], [])).toEqual({ cas: 'alta' })
  })

  it('caso 2 — la misma organización estrenando papel', () => {
    // El productor que ahora también recibe: coincide su ficha de productor y su
    // organización todavía no tiene ficha de entidad.
    const d = decidir('entidad', [fitxa()], [org({ es_generadora: true, es_receptora: false })])
    expect(d.cas).toBe('paper_nou')
    if (d.cas !== 'paper_nou') return
    expect(d.fitxes).toHaveLength(1)
    expect(d.organitzacions[0].id).toBe('o1')
  })

  it('caso 3 — ya hay ficha de este tipo: duplicado', () => {
    const d = decidir('productor', [fitxa()], [org()])
    expect(d).toMatchObject({ cas: 'duplicat', camp: 'email' })
  })

  it('caso 3 también cuando la ficha que ocupa el papel NO ha coincidido', () => {
    // Una organización con las dos fichas puede tener correos distintos en cada una. Si
    // se registra como productor con el correo de la ENTIDAD, ninguna ficha de productor
    // casa —y aun así el papel está ocupado—. Es el motivo de consultar `v_organizaciones`
    // y no conformarse con las fichas que han casado.
    const d = decidir(
      'productor',
      [fitxa({ tipus: 'entidad', id: 'e1', nom: 'Doble receptora' })],
      [org({ es_generadora: true, es_receptora: true })],
    )
    expect(d).toMatchObject({ cas: 'duplicat', camp: 'email' })
  })

  it('una ficha del mismo tipo sin organización sigue siendo un duplicado', () => {
    // Las fichas creadas por el caso 2 nacen sin organización a propósito: si eso
    // desactivara la detección, el segundo intento colaría.
    const d = decidir('entidad', [fitxa({ tipus: 'entidad', organitzacio: null })], [])
    expect(d).toMatchObject({ cas: 'duplicat' })
  })

  it('el correo manda sobre el teléfono al explicar el duplicado', () => {
    const d = decidir('productor', [fitxa({ per: ['telefon', 'email'] })], [org()])
    expect(d).toMatchObject({ camp: 'email' })
    const soloTel = decidir('productor', [fitxa({ per: ['telefon'] })], [org()])
    expect(soloTel).toMatchObject({ camp: 'telefon' })
  })

  it('con varias organizaciones coincidentes no elige ninguna', () => {
    // El correo casa con una y el teléfono con otra: eso no lo resuelve una función, lo
    // resuelve una persona mirando las dos fichas.
    const d = decidir(
      'productor',
      [
        fitxa({ tipus: 'entidad', id: 'e1', organitzacio: 'o1', per: ['email'] }),
        fitxa({ tipus: 'entidad', id: 'e2', organitzacio: 'o2', per: ['telefon'] }),
      ],
      [
        org({ id: 'o1', es_generadora: false, es_receptora: true }),
        org({ id: 'o2', es_generadora: false, es_receptora: true }),
      ],
    )
    expect(d.cas).toBe('paper_nou')
    if (d.cas !== 'paper_nou') return
    expect(d.fitxes).toHaveLength(2)
  })

  it('si una de las varias ya tiene el papel, gana el duplicado', () => {
    const d = decidir(
      'productor',
      [
        fitxa({ tipus: 'entidad', id: 'e1', organitzacio: 'o1', per: ['email'] }),
        fitxa({ tipus: 'entidad', id: 'e2', organitzacio: 'o2', per: ['telefon'] }),
      ],
      [
        org({ id: 'o1', es_generadora: false, es_receptora: true }),
        org({ id: 'o2', es_generadora: true, es_receptora: true }),
      ],
    )
    expect(d.cas).toBe('duplicat')
    if (d.cas !== 'duplicat') return
    // Y señala la ficha de la organización que está ocupada, no la primera de la lista.
    expect(d.fitxa.id).toBe('e2')
  })
})

describe('una coincidencia SOLO por columna secundaria nunca deniega', () => {
  // La regla, y el motivo: `telefono2`, `telefono3` y `telefono_alt` guardan centralitas,
  // fijos compartidos y el contacto de otra persona. Medido en producción: `Càritas
  // l'Aldea` y `Càritas Roquetes` comparten número. Con el 409, una de las dos no se
  // podría registrar y no tendría más salida que llamar por teléfono. Un fallo de la
  // detección ha de producir un duplicado que el equipo ve, nunca un alta denegada.

  it('ni cuando la ficha es del MISMO tipo que se registra', () => {
    const d = decidir('productor', [fitxa({ per: ['telefon_secundari'] })], [org()])
    expect(d.cas).toBe('paper_nou')
  })

  it('ni cuando la organización ya tiene ese papel cubierto', () => {
    const d = decidir(
      'productor',
      [fitxa({ tipus: 'entidad', id: 'e1', per: ['telefon_secundari'] })],
      [org({ es_generadora: true, es_receptora: true })],
    )
    expect(d.cas).toBe('paper_nou')
  })

  it('pero la misma coincidencia por la columna principal SÍ deniega', () => {
    // El contraste es la prueba: lo que cambia entre los dos casos es solo la columna.
    expect(decidir('productor', [fitxa({ per: ['telefon'] })], [org()]))
      .toMatchObject({ cas: 'duplicat', camp: 'telefon' })
  })

  it('y una débil no rebaja a una fuerte que esté al lado', () => {
    // Con las dos, la fuerte manda y el alta se deniega como siempre.
    expect(decidir('productor', [fitxa({ per: ['telefon_secundari', 'email'] })], [org()]))
      .toMatchObject({ cas: 'duplicat', camp: 'email' })
    // Y si la fuerte está en OTRA ficha, el duplicado señala a esa, no a la débil.
    const d = decidir(
      'entidad',
      [
        fitxa({ tipus: 'entidad', id: 'feble', per: ['telefon_secundari'], organitzacio: 'o9' }),
        fitxa({ tipus: 'entidad', id: 'forta', per: ['email'] }),
      ],
      [org({ es_receptora: true })],
    )
    expect(d).toMatchObject({ cas: 'duplicat' })
    if (d.cas !== 'duplicat') return
    expect(d.fitxa.id).toBe('forta')
  })

  it('la ficha débil no se tira: va en la nota, que es lo que lee el equipo', () => {
    const d = decidir('productor', [fitxa({ per: ['telefon_secundari'] })], [org()])
    if (d.cas !== 'paper_nou') return
    expect(d.fitxes).toHaveLength(1)
    expect(notaPaperNou(d.fitxes, '2026-09-14T08:00:00.000Z')).toContain('telefon secundari')
  })
})

describe('notaPaperNou: lo único que el equipo tiene para decidir', () => {
  const nota = notaPaperNou(
    [
      fitxa({ nom: 'Mas de Prova SCP', per: ['email'] }),
      fitxa({ tipus: 'entidad', id: 'e9', nom: null, per: ['email', 'telefon'] }),
    ],
    '2026-09-11T08:30:00.000Z',
  )

  it('dice el día, qué ficha y por qué coincide', () => {
    expect(nota).toContain('2026-09-11')
    expect(nota).toContain('fitxa de productor «Mas de Prova SCP» (coincideix el correu)')
    expect(nota).toContain('fitxa de entitat sense nom (coincideix el correu i telefon)')
  })

  it('avisa cuando lo único que hay es un teléfono secundario', () => {
    // Sin esta línea, la nota de una centralita compartida se lee igual que la de un
    // correo que coincide, y el equipo no tiene con qué distinguirlas.
    const feble = notaPaperNou([fitxa({ per: ['telefon_secundari'] })], '2026-09-14T08:00:00.000Z')
    expect(feble).toContain('senyal feble')
    expect(nota).not.toContain('senyal feble')
  })

  it('deja escrito que la ficha NO se ha enlazado', () => {
    // Sin esta frase, el equipo podría dar por hecho que el sistema ya lo ha resuelto.
    expect(nota).toContain('SENSE enllacar')
  })
})

// ---------------------------------------------------------------------------
// El correo secundario (deuda §12.102)
// ---------------------------------------------------------------------------
// `entidades.email2` era la última columna ciega de la detección. Entra con la MISMA regla
// que los teléfonos secundarios —se mira, no deniega— y estas pruebas son las que sostienen
// esa mitad: que se detecte es fácil de ver en producción; que no pueda denegar, no, porque
// el caso solo aparece cuando alguien se registra con ese correo.
describe('motiuEmail: la columna decide la FUERZA, como en el teléfono', () => {
  it('el correo principal es fuerte', () => {
    expect(motiuEmail('hola@exemple.cat', ['altre@exemple.cat'], 'hola@exemple.cat')).toBe('email')
  })

  it('comparar ignora mayúsculas y espacios de los lados', () => {
    expect(motiuEmail(' Hola@Exemple.CAT ', [], 'hola@exemple.cat')).toBe('email')
  })

  it('el secundario casa, pero como señal débil', () => {
    expect(motiuEmail('altre@exemple.cat', ['hola@exemple.cat'], 'hola@exemple.cat'))
      .toBe('email_secundari')
    expect(motiuEmail(null, [null, 'hola@exemple.cat'], 'hola@exemple.cat')).toBe('email_secundari')
  })

  it('si casa en las dos columnas, manda la fuerte', () => {
    expect(motiuEmail('hola@exemple.cat', ['hola@exemple.cat'], 'hola@exemple.cat')).toBe('email')
  })

  it('sin coincidencia, nada; y un campo vacío no casa con otro vacío', () => {
    expect(motiuEmail('altre@exemple.cat', ['tercer@exemple.cat'], 'hola@exemple.cat')).toBeNull()
    expect(motiuEmail('', [''], '')).toBeNull()
    expect(motiuEmail(null, [null], null)).toBeNull()
  })
})

describe('un correo secundario, solo, tampoco deniega', () => {
  it('no es una coincidencia fuerte', () => {
    expect(esForta(['email_secundari'])).toBe(false)
    expect(esForta(['email_secundari', 'telefon_secundari'])).toBe(false)
  })

  it('pero con cualquier columna principal al lado, sí', () => {
    expect(esForta(['email_secundari', 'telefon'])).toBe(true)
    expect(esForta(['email_secundari', 'email'])).toBe(true)
  })

  // Este es EL caso de la deuda: la entidad ya existe, se registra con el correo que ella
  // tiene en `email2`, y antes esto no se veía siquiera. Ahora se ve — y aun así el alta
  // sigue, porque denegarla dejaría fuera a quien comparte el correo de su gestoría.
  it('una ficha del MISMO tipo que solo casa por el correo secundario no es duplicado', () => {
    const d = decidir(
      'entidad',
      [fitxa({ tipus: 'entidad', per: ['email_secundari'] })],
      [org({ es_generadora: false, es_receptora: true })],
    )
    expect(d.cas).toBe('paper_nou')
  })

  it('y si además casa el correo principal, vuelve a ser duplicado', () => {
    const d = decidir(
      'entidad',
      [fitxa({ tipus: 'entidad', per: ['email_secundari', 'email'] })],
      [org({ es_generadora: false, es_receptora: true })],
    )
    expect(d.cas).toBe('duplicat')
    if (d.cas === 'duplicat') expect(d.camp).toBe('email')
  })

  it('la nota lo nombra y avisa de que la señal es débil', () => {
    const nota = notaPaperNou(
      [fitxa({ tipus: 'entidad', nom: 'Rebost Solidari', per: ['email_secundari'] })],
      '2026-09-15T10:00:00Z',
    )
    expect(nota).toContain('correu secundari')
    expect(nota).toContain('SECUNDARIA')
  })
})
