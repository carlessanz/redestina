// El gate: quién PUEDE recibir algo.
//
// Es el candado que impide escribirle a gente real mientras el sistema está en pruebas, y
// la única barrera que sobrevive al paso a producción de Meta (§8): cuando se vacíe
// `meta_test_recipients`, esto seguirá filtrando. Un fallo aquí no da error ni deja rastro
// —el mensaje sale, y sale bien— así que el único sitio donde se puede detectar es aquí.
//
// De ahí la forma de estas pruebas: lo que se comprueba una y otra vez es el FAIL-SAFE. La
// regla del módulo es que la duda corta, y la duda tiene muchas caras —la fila no existe,
// la consulta falla, el buzón del equipo está sin rellenar, el valor no es exactamente
// `'false'`—. Cada una tiene su prueba, porque cada una es una forma distinta de que el
// candado se abra solo.
//
// El cliente es un doble a mano, no un mock del módulo: `gate.ts` recibe el cliente por
// parámetro justamente para esto. El doble es una base de datos en memoria con los mismos
// filtros que usan las consultas reales (`eq`, `ilike`, `in`, `limit`, `maybeSingle`), así
// que lo que se prueba es la lógica de las consultas —qué tablas mira y con qué
// condiciones—, no una respuesta escrita a mano que daría igual lo que el módulo pidiera.

import { describe, it, expect } from 'vitest'
import {
  esTelefonoTest,
  esEmailTest,
  esCuentaPermitida,
  modoTestActivo,
  destinatariosPrueba,
} from '../supabase/functions/_shared/gate.ts'

// ---------------------------------------------------------------------------
// El doble del cliente
// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>
/** Una tabla son sus filas, o la palabra `error` si se quiere simular que la consulta falla. */
type Tabla = Fila[] | 'error'
type BaseFalsa = Record<string, Tabla>

class Consulta {
  private filtros: ((f: Fila) => boolean)[] = []
  private tope: number | null = null

  constructor(private tabla: Tabla) {}

  select(_columnas?: string) { return this }

  eq(columna: string, valor: unknown) {
    this.filtros.push((f) => f[columna] === valor)
    return this
  }

  /** `ilike` sin comodines, que es como lo usa el gate: igualdad sin distinguir mayúsculas. */
  ilike(columna: string, valor: unknown) {
    const v = String(valor).toLowerCase()
    this.filtros.push((f) => String(f[columna] ?? '').toLowerCase() === v)
    return this
  }

  in(columna: string, valores: unknown[]) {
    this.filtros.push((f) => valores.includes(f[columna]))
    return this
  }

  limit(n: number) {
    this.tope = n
    return this
  }

  private resolver(): { data: Fila[] | null; error: { message: string } | null } {
    if (this.tabla === 'error') return { data: null, error: { message: 'consulta fallida' } }
    let filas = this.tabla.filter((f) => this.filtros.every((p) => p(f)))
    if (this.tope !== null) filas = filas.slice(0, this.tope)
    return { data: filas, error: null }
  }

  maybeSingle(): Promise<{ data: Fila | null; error: { message: string } | null }> {
    const { data, error } = this.resolver()
    return Promise.resolve({ data: data?.[0] ?? null, error })
  }

  // Thenable: `await consulta` y `Promise.all([...])` funcionan igual que con supabase-js.
  then<R>(
    alCumplir: (v: { data: Fila[] | null; error: { message: string } | null }) => R,
    alFallar?: (e: unknown) => R,
  ): Promise<R> {
    return Promise.resolve(this.resolver()).then(alCumplir, alFallar)
  }
}

// El tipo del cliente es `any` en el propio `gate.ts` (no hay tipos de Deno aquí), así que
// el doble lo devuelve igual: es el único `any` de estas pruebas y es inevitable.
// deno-lint-ignore no-explicit-any
type ClienteFalso = any

function crearCliente(base: BaseFalsa): { cliente: ClienteFalso; consultadas: string[] } {
  const consultadas: string[] = []
  const cliente = {
    from(tabla: string) {
      consultadas.push(tabla)
      return new Consulta(base[tabla] ?? [])
    },
  }
  return { cliente, consultadas }
}

// ---------------------------------------------------------------------------

describe('esTelefonoTest', () => {
  const base: BaseFalsa = {
    productores: [
      { id: 'p1', phone: '34611111111', es_test: true },
      { id: 'p2', phone: '34622222222', es_test: false },
    ],
    entidades: [
      { id: 'e1', telefono: '34633333333', es_test: true },
      { id: 'e2', telefono: '34644444444', es_test: false },
    ],
  }

  it('un productor de prueba pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esTelefonoTest(cliente, '34611111111')).toBe(true)
  })

  it('una entidad de prueba pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esTelefonoTest(cliente, '34633333333')).toBe(true)
  })

  it('un productor REAL no pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esTelefonoTest(cliente, '34622222222')).toBe(false)
  })

  it('una entidad REAL no pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esTelefonoTest(cliente, '34644444444')).toBe(false)
  })

  it('un teléfono que no está en ninguna ficha no pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esTelefonoTest(cliente, '34600000000')).toBe(false)
  })

  // Las dos tablas, siempre: mirar solo una dejaría fuera al doble rol y a la mitad de
  // las fichas con móvil verificado en Meta (§9).
  it('mira productores Y entidades', async () => {
    const { cliente, consultadas } = crearCliente(base)
    await esTelefonoTest(cliente, '34600000000')
    expect(consultadas).toContain('productores')
    expect(consultadas).toContain('entidades')
  })

  // Fail-safe: si la base no contesta, no se envía. El gate no puede «suponer que sí».
  it('si la consulta falla, NO pasa', async () => {
    const { cliente } = crearCliente({ productores: 'error', entidades: 'error' })
    expect(await esTelefonoTest(cliente, '34611111111')).toBe(false)
  })

  it('el teléfono se compara exacto: un formato distinto no pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esTelefonoTest(cliente, '+34611111111')).toBe(false)
    expect(await esTelefonoTest(cliente, '611111111')).toBe(false)
  })
})

describe('esEmailTest', () => {
  const base: BaseFalsa = {
    productores: [
      { id: 'p1', email: 'prod@test.cat', es_test: true },
      { id: 'p2', email: 'real@productor.cat', es_test: false },
    ],
    entidades: [
      { id: 'e1', email: 'ent@test.cat', es_test: true },
      { id: 'e2', email: 'real@entitat.cat', es_test: false },
    ],
  }

  it('el correo de una entidad de prueba pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esEmailTest(cliente, 'ent@test.cat')).toBe(true)
  })

  // El caso del 30-07-2026: antes solo miraba `entidades`, y eso dejaba sin poder recibir
  // nada a un productor de prueba sin WhatsApp — justo a quien el correo por defecto
  // (§8bis) viene a rescatar.
  it('el correo de un PRODUCTOR de prueba también pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esEmailTest(cliente, 'prod@test.cat')).toBe(true)
  })

  it('no distingue mayúsculas', async () => {
    const { cliente } = crearCliente(base)
    expect(await esEmailTest(cliente, 'Prod@Test.CAT')).toBe(true)
  })

  it('un correo real no pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esEmailTest(cliente, 'real@productor.cat')).toBe(false)
    expect(await esEmailTest(cliente, 'real@entitat.cat')).toBe(false)
  })

  it('si la consulta falla, NO pasa', async () => {
    const { cliente } = crearCliente({ productores: 'error', entidades: 'error' })
    expect(await esEmailTest(cliente, 'prod@test.cat')).toBe(false)
  })
})

describe('esCuentaPermitida', () => {
  const base: BaseFalsa = {
    perfiles: [
      { id: 'u-equip', email: 'equip@espigoladors.com' },
      { id: 'u-test', email: 'titular@test.cat' },
      { id: 'u-real', email: 'titular@real.cat' },
      { id: 'u-sense', email: 'sense-res@exemple.cat' },
      { id: 'u-inactiu', email: 'inactiu@test.cat' },
    ],
    usuario_roles: [{ user_id: 'u-equip', rol: 'super_admin' }],
    membresias: [
      { user_id: 'u-test', productor_id: 'p-test', entidad_id: null, activo: true },
      { user_id: 'u-real', productor_id: 'p-real', entidad_id: null, activo: true },
      { user_id: 'u-inactiu', productor_id: 'p-test', entidad_id: null, activo: false },
    ],
    productores: [
      { id: 'p-test', es_test: true },
      { id: 'p-real', es_test: false },
    ],
    entidades: [{ id: 'e-test', es_test: true }],
  }

  // A propósito (§8): dejar al equipo sin poder recuperar su contraseña los bloquearía
  // fuera de la aplicación que administran, y tener un rol de plataforma ya exige que
  // alguien se lo haya concedido a mano.
  it('el equipo interno pasa siempre, aunque no tenga ninguna organización de prueba', async () => {
    const { cliente } = crearCliente(base)
    expect(await esCuentaPermitida(cliente, 'equip@espigoladors.com')).toBe(true)
  })

  it('quien es titular de una organización de prueba pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esCuentaPermitida(cliente, 'titular@test.cat')).toBe(true)
  })

  it('quien es titular de una organización REAL no pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esCuentaPermitida(cliente, 'titular@real.cat')).toBe(false)
  })

  it('una cuenta sin rol y sin membresías no pasa', async () => {
    const { cliente } = crearCliente(base)
    expect(await esCuentaPermitida(cliente, 'sense-res@exemple.cat')).toBe(false)
  })

  // Una membresía desactivada no habilita nada: es justo el estado de un registro que el
  // equipo ha rechazado o cortado (§4bis).
  it('una membresía desactivada no habilita', async () => {
    const { cliente } = crearCliente(base)
    expect(await esCuentaPermitida(cliente, 'inactiu@test.cat')).toBe(false)
  })

  it('sin perfil no pasa, y ni siquiera pregunta por roles', async () => {
    const { cliente, consultadas } = crearCliente(base)
    expect(await esCuentaPermitida(cliente, 'ningu@exemple.cat')).toBe(false)
    expect(consultadas).toEqual(['perfiles'])
  })

  it('el correo del perfil se busca sin distinguir mayúsculas', async () => {
    const { cliente } = crearCliente(base)
    expect(await esCuentaPermitida(cliente, 'Titular@TEST.cat')).toBe(true)
  })

  it('si falla la consulta de perfiles, NO pasa', async () => {
    const { cliente } = crearCliente({ ...base, perfiles: 'error' })
    expect(await esCuentaPermitida(cliente, 'equip@espigoladors.com')).toBe(false)
  })

  it('si falla la consulta de roles, se sigue por membresías y el equipo deja de pasar', async () => {
    const { cliente } = crearCliente({ ...base, usuario_roles: 'error' })
    expect(await esCuentaPermitida(cliente, 'equip@espigoladors.com')).toBe(false)
    expect(await esCuentaPermitida(cliente, 'titular@test.cat')).toBe(true)
  })

  it('si fallan las membresías, NO pasa quien dependía de ellas', async () => {
    const { cliente } = crearCliente({ ...base, membresias: 'error' })
    expect(await esCuentaPermitida(cliente, 'titular@test.cat')).toBe(false)
  })

  it('una membresía de entidad de prueba también habilita', async () => {
    const { cliente } = crearCliente({
      ...base,
      membresias: [{ user_id: 'u-test', productor_id: null, entidad_id: 'e-test', activo: true }],
    })
    expect(await esCuentaPermitida(cliente, 'titular@test.cat')).toBe(true)
  })
})

describe('modoTestActivo · el fail-safe', () => {
  it('solo un «false» explícito lo apaga', async () => {
    const { cliente } = crearCliente({ app_settings: [{ key: 'test_mode', value: 'false' }] })
    expect(await modoTestActivo(cliente)).toBe(false)
  })

  it('con «true» está activo', async () => {
    const { cliente } = crearCliente({ app_settings: [{ key: 'test_mode', value: 'true' }] })
    expect(await modoTestActivo(cliente)).toBe(true)
  })

  // Las tres caras de la duda. En todas, activo: no se envía a quien no sea de prueba.
  it('si la fila NO EXISTE, se comporta como ACTIVADO', async () => {
    const { cliente } = crearCliente({ app_settings: [] })
    expect(await modoTestActivo(cliente)).toBe(true)
  })

  it('si la consulta FALLA, se comporta como ACTIVADO', async () => {
    const { cliente } = crearCliente({ app_settings: 'error' })
    expect(await modoTestActivo(cliente)).toBe(true)
  })

  it('si el valor es basura o está vacío, se comporta como ACTIVADO', async () => {
    for (const value of ['', 'FALSE', 'no', '0', null, undefined]) {
      const { cliente } = crearCliente({ app_settings: [{ key: 'test_mode', value }] })
      expect(await modoTestActivo(cliente)).toBe(true)
    }
  })

  it('lee la clave test_mode y no otra', async () => {
    const { cliente } = crearCliente({
      app_settings: [
        { key: 'roles_activos', value: 'false' },
        { key: 'test_mode', value: 'true' },
      ],
    })
    expect(await modoTestActivo(cliente)).toBe(true)
  })
})

describe('destinatariosPrueba', () => {
  const base: BaseFalsa = {
    parametros_documentales: [{ id: 1, email_equipo: 'equip@espigoladors.com' }],
    productores: [
      { id: 'p1', email: 'donant@test.cat', es_test: true },
      { id: 'p2', email: 'donant@real.cat', es_test: false },
    ],
    entidades: [{ id: 'e1', email: 'entitat@test.cat', es_test: true }],
  }
  const doc = (modo: string | null) => ({ id: 'd1', modo, envio: { destinatario: 'donant@real.cat' } })

  it('un documento real no aplica la barrera', async () => {
    const { cliente } = crearCliente(base)
    const r = await destinatariosPrueba(cliente, doc('real'))
    expect(r.modoPrueba).toBe(false)
    expect(r.permitidos).toEqual(['donant@real.cat'])
    expect(r.bloqueados).toEqual([])
  })

  it('en modo prueba, un donante REAL queda bloqueado', async () => {
    const { cliente } = crearCliente(base)
    const r = await destinatariosPrueba(cliente, doc('prueba'))
    expect(r.modoPrueba).toBe(true)
    expect(r.permitidos).toEqual([])
    expect(r.bloqueados).toEqual([{ email: 'donant@real.cat', motivo: 'no_test_user' }])
  })

  it('en modo prueba pasan la organización de prueba y el buzón del equipo', async () => {
    const { cliente } = crearCliente(base)
    const r = await destinatariosPrueba(cliente, doc('prueba'), [
      'donant@test.cat',
      'entitat@test.cat',
      'equip@espigoladors.com',
      'donant@real.cat',
    ])
    expect(r.permitidos).toEqual(['donant@test.cat', 'entitat@test.cat', 'equip@espigoladors.com'])
    expect(r.bloqueados.map((b) => b.email)).toEqual(['donant@real.cat'])
  })

  it('el buzón del equipo se reconoce aunque venga en otra caja', async () => {
    const { cliente } = crearCliente(base)
    const r = await destinatariosPrueba(cliente, doc('prueba'), ['EQUIP@Espigoladors.com'])
    expect(r.permitidos).toEqual(['EQUIP@Espigoladors.com'])
  })

  // ⚠️ El punto entero del módulo (§4, §8): el modo test global se apaga el día que
  // Redestina sale a producción, pero los cierres de prueba se siguen ensayando cada
  // diciembre. Esta barrera no puede depender de aquel interruptor —y la prueba lo
  // comprueba por donde no se puede fingir: `app_settings` ni se consulta—.
  it('NO depende de test_mode: no lo lee siquiera', async () => {
    const { cliente, consultadas } = crearCliente({
      ...base,
      app_settings: [{ key: 'test_mode', value: 'false' }],
    })
    const r = await destinatariosPrueba(cliente, doc('prueba'))
    expect(r.permitidos).toEqual([])
    expect(consultadas).not.toContain('app_settings')
  })

  it('sin buzón del equipo, esa dirección queda bloqueada y el resultado lo dice aparte', async () => {
    const { cliente } = crearCliente({ ...base, parametros_documentales: [{ id: 1, email_equipo: null }] })
    const r = await destinatariosPrueba(cliente, doc('prueba'), ['equip@espigoladors.com'])
    expect(r.permitidos).toEqual([])
    // El motivo describe la dirección; la falta del buzón es del sistema y va en su campo.
    expect(r.bloqueados).toEqual([{ email: 'equip@espigoladors.com', motivo: 'no_test_user' }])
    expect(r.bustiaEquip).toBe(false)
  })

  // Nació como `it.fails` describiendo un defecto real: el motivo se elegía mirando solo si
  // había buzón del equipo (`equipo ? 'no_test_user' : 'sense_bustia_equip'`), así que con el
  // buzón sin rellenar —el estado de HOY: `email_equipo` es NULL, §12 checkpoint 10— un
  // donante REAL bloqueado salía etiquetado «falta el buzón del equipo». El bloqueo era
  // correcto; el diagnóstico mandaba a arreglar lo que no era. Ya está corregido: el motivo
  // lo decide la comprobación que falla, y el buzón viaja en `bustiaEquip`.
  it('el motivo distingue «no es de prueba» de «falta el buzón»', async () => {
    const { cliente } = crearCliente({ ...base, parametros_documentales: [{ id: 1, email_equipo: null }] })
    const r = await destinatariosPrueba(cliente, doc('prueba'), ['donant@real.cat'])
    expect(r.permitidos).toEqual([])
    expect(r.bloqueados).toEqual([{ email: 'donant@real.cat', motivo: 'no_test_user' }])
  })

  it('si no se puede leer parametros_documentales, el buzón del equipo se bloquea igual', async () => {
    const { cliente } = crearCliente({ ...base, parametros_documentales: 'error' })
    const r = await destinatariosPrueba(cliente, doc('prueba'), ['equip@espigoladors.com'])
    expect(r.permitidos).toEqual([])
  })

  // Que el buzón del equipo no se pueda leer no debe cortar a las organizaciones de
  // prueba: la duda corta SOLO la dirección de la que se duda.
  it('sin buzón legible, una organización de prueba sigue pasando', async () => {
    const { cliente } = crearCliente({ ...base, parametros_documentales: 'error' })
    const r = await destinatariosPrueba(cliente, doc('prueba'), ['donant@test.cat'])
    expect(r.permitidos).toEqual(['donant@test.cat'])
  })

  it('la lista explícita manda sobre el destinatario del documento', async () => {
    const { cliente } = crearCliente(base)
    const r = await destinatariosPrueba(cliente, doc('prueba'), ['donant@test.cat'])
    expect(r.permitidos).toEqual(['donant@test.cat'])
    expect(r.bloqueados).toEqual([])
  })

  it('quita duplicados y direcciones vacías', async () => {
    const { cliente } = crearCliente(base)
    const r = await destinatariosPrueba(cliente, doc('prueba'), [
      'donant@test.cat',
      '  donant@test.cat  ',
      '',
      '   ',
    ])
    expect(r.permitidos).toEqual(['donant@test.cat'])
  })

  it('un documento sin destinatario no produce ningún envío', async () => {
    const { cliente } = crearCliente(base)
    const r = await destinatariosPrueba(cliente, { id: 'd1', modo: 'prueba', envio: null })
    expect(r.permitidos).toEqual([])
    expect(r.bloqueados).toEqual([])
  })

  // Un `modo` que no es ninguno de los dos (null, una errata) NO activa la barrera: la
  // clase de documento que llega aquí sin modo es la que ya han filtrado los gates de §8.
  it('un modo desconocido se trata como documento real', async () => {
    const { cliente } = crearCliente(base)
    expect((await destinatariosPrueba(cliente, doc(null))).modoPrueba).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// La invariante que justifica el módulo
// ---------------------------------------------------------------------------
// La duda corta, siempre y en las cuatro funciones. Da igual la forma que tome la avería
// —la tabla no contesta, la fila no está, el valor no es el esperado—: el resultado tiene
// que ser el más restrictivo posible. Es lo contrario del fail-open deliberado de los
// roles (§4bis), y por un motivo claro: allí la duda no debe dejar al equipo sin trabajar;
// aquí la duda no debe dejar salir un mensaje a una persona real.
describe('con la base rota, el gate se cierra', () => {
  const rota: BaseFalsa = {
    productores: 'error',
    entidades: 'error',
    perfiles: 'error',
    usuario_roles: 'error',
    membresias: 'error',
    app_settings: 'error',
    parametros_documentales: 'error',
  }

  it('nadie es usuario de prueba', async () => {
    const { cliente } = crearCliente(rota)
    expect(await esTelefonoTest(cliente, '34611111111')).toBe(false)
    expect(await esEmailTest(cliente, 'qui@sigui.cat')).toBe(false)
    expect(await esCuentaPermitida(cliente, 'qui@sigui.cat')).toBe(false)
  })

  it('el modo test se da por ACTIVADO, que es lo que bloquea el envío', async () => {
    const { cliente } = crearCliente(rota)
    expect(await modoTestActivo(cliente)).toBe(true)
  })

  it('un documento de prueba no encuentra a nadie a quien escribir', async () => {
    const { cliente } = crearCliente(rota)
    const r = await destinatariosPrueba(cliente, { modo: 'prueba', envio: { destinatario: 'qui@sigui.cat' } })
    expect(r.permitidos).toEqual([])
    expect(r.bloqueados).toHaveLength(1)
  })
})
