// `exigirEquipo()`: la autorización propia de las Edge Functions que corren con
// `service_role` (BYPASSRLS), así que la RLS no las protege (§4bis).
//
// Lo que se vigila aquí es el interruptor `roles_activos`. Su VALOR sigue el fail-open
// documentado —fila ausente o `'false'` = todo el mundo pasa, igual que la base—, pero un
// ERROR de lectura no es «apagado»: hasta el 07-10-2026 lo era, y una consulta fallida
// dejaba enviar WhatsApp, correo o reenviar documentos a cualquier cuenta con sesión.
// Ahora falla cerrado, como el modo test (§8).

import { describe, it, expect } from 'vitest'
import { exigirEquipo, rolesActivos } from '../supabase/functions/_shared/autorizacion.ts'
import { crearCliente } from './soporte/clienteFalso.ts'
import type { BaseFalsa, Tabla } from './soporte/clienteFalso.ts'

const EXTERN = 'u-extern'
const EQUIP = 'u-equip'

function cliente(appSettings: Tabla, usuari = EXTERN) {
  const base: BaseFalsa = {
    app_settings: appSettings,
    usuario_roles: [{ user_id: EQUIP, rol: 'tecnic' }],
    membresias: [{ user_id: EXTERN, productor_id: 'p1', entidad_id: null, activo: true }],
    perfiles: [{ id: EXTERN, activo: true }, { id: EQUIP, activo: true }],
  }
  const { cliente } = crearCliente(base)
  cliente.auth = {
    getUser: (token: string) =>
      Promise.resolve(
        token === 'bo'
          ? { data: { user: { id: usuari, email: 'x@y.cat' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } },
      ),
  }
  return cliente
}

const req = (token = 'bo') => new Request('https://x', { headers: { Authorization: `Bearer ${token}` } })

describe('rolesActivos', () => {
  it("solo un 'true' explícito lo enciende", async () => {
    expect(await rolesActivos(cliente([{ key: 'roles_activos', value: 'true' }]))).toBe(true)
    expect(await rolesActivos(cliente([{ key: 'roles_activos', value: 'false' }]))).toBe(false)
  })

  it('una fila ausente es el modo permisivo documentado', async () => {
    expect(await rolesActivos(cliente([]))).toBe(false)
  })

  it('un ERROR de lectura falla cerrado (encendido)', async () => {
    expect(await rolesActivos(cliente('error'))).toBe(true)
  })

  it('una excepción del cliente también falla cerrado', async () => {
    const c = { from: () => { throw new Error('red') } }
    expect(await rolesActivos(c)).toBe(true)
  })
})

describe('exigirEquipo', () => {
  it('sin sesión, 401', async () => {
    const r = await exigirEquipo(cliente([{ key: 'roles_activos', value: 'true' }]), req('dolent'))
    expect('rechazo' in r && r.rechazo.status).toBe(401)
  })

  it('una cuenta externa con roles encendidos, 403', async () => {
    const r = await exigirEquipo(cliente([{ key: 'roles_activos', value: 'true' }]), req())
    expect('rechazo' in r && r.rechazo.status).toBe(403)
  })

  it('una cuenta externa con la lectura del interruptor ROTA, 403 (no pasa)', async () => {
    const r = await exigirEquipo(cliente('error'), req())
    expect('rechazo' in r && r.rechazo.status).toBe(403)
  })

  it('el equipo pasa aunque la lectura del interruptor falle', async () => {
    const r = await exigirEquipo(cliente('error', EQUIP), req())
    expect('ctx' in r && r.ctx.esIntern).toBe(true)
  })

  it("con el interruptor apagado explícitamente, la cuenta externa pasa (fail-open de §4bis)", async () => {
    const r = await exigirEquipo(cliente([{ key: 'roles_activos', value: 'false' }]), req())
    expect('ctx' in r).toBe(true)
  })
})
