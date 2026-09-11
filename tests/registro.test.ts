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
  decidir,
  type FitxaCoincident,
  mateixEmail,
  mateixTelefon,
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
    // `entidades.telefono` es texto libre: el importador lo normaliza, pero cualquier
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

  it('solo mira el final, que es lo que significa «las últimas 9»', () => {
    // Con el número en medio de la celda, el patrón no casa: es un filtro que se queda
    // corto a propósito, y por eso quien decide es `mateixTelefon` sobre lo que vuelva.
    expect(re('612345678').test('612345678 / 933000000')).toBe(false)
  })
})

describe('mateixTelefon y mateixEmail: el criterio de verdad', () => {
  it('el teléfono se compara por sus últimas 9 cifras', () => {
    expect(mateixTelefon('34612345678', '+34 612 345 678')).toBe(true)
    expect(mateixTelefon('612345678', '34612345678')).toBe(true)
    expect(mateixTelefon('34612345678', '34612345679')).toBe(false)
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

  it('deja escrito que la ficha NO se ha enlazado', () => {
    // Sin esta frase, el equipo podría dar por hecho que el sistema ya lo ha resuelto.
    expect(nota).toContain('SENSE enllacar')
  })
})
