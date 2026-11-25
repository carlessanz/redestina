// Alta de una cuenta del equipo (deuda 169): lo puro de `alta-equip/correu.ts`.
//
//   · `validaEntrada` — qué se acepta de la pantalla (correo, nombre, rol, idioma, teléfono).
//   · `errorAlta` — cómo se traduce un rechazo de `alta_membre_equip()`.
//   · `composaCorreu` — el correo de bienvenida en ca/es, con el nombre escapado.
//
// Lo que pasa contra la base y la función (permisos, compensación, el correo que llega) se prueba
// contra el clon.

import { describe, expect, it } from 'vitest'

// `plantillaEmail()` lee `APP_URL` con `Deno.env`: fuera de Deno, un `Deno` que no sabe nada.
;(globalThis as Record<string, unknown>).Deno = { env: { get: () => undefined } }
const { composaCorreu, errorAlta, nomRol, normalitzaTelefon, validaEntrada } = await import(
  '../supabase/functions/alta-equip/correu'
)

const ENLLAC = 'http://127.0.0.1:55321/auth/v1/verify?token=abc&type=recovery&redirect_to=http://localhost:5173'
const BASE = { email: 'persona@espigoladors.cat', nombre: 'Anna Puig', rol: 'admin' }

describe('validaEntrada: lo que se acepta', () => {
  it('normaliza correo y nombre; idioma ca por defecto; sin teléfono', () => {
    expect(validaEntrada({ ...BASE, email: '  Persona@Espigoladors.CAT ', nombre: '  Anna   Puig ' })).toEqual({
      ok: true,
      dades: { email: 'persona@espigoladors.cat', nombre: 'Anna Puig', telefon: null, rol: 'admin', idioma: 'ca' },
    })
  })
  it('acepta los dos roles y los dos idiomas', () => {
    const r = validaEntrada({ ...BASE, rol: 'super_admin', idioma: 'es' })
    expect(r.ok && r.dades.rol).toBe('super_admin')
    expect(r.ok && r.dades.idioma).toBe('es')
  })
  it('correo inválido o ausente', () => {
    expect(validaEntrada({ ...BASE, email: 'no-es-un-correu' })).toEqual({ ok: false, code: 'correu_invalid' })
    expect(validaEntrada({ ...BASE, email: undefined })).toEqual({ ok: false, code: 'correu_invalid' })
    expect(validaEntrada(null)).toEqual({ ok: false, code: 'correu_invalid' })
  })
  it('nombre vacío o demasiado largo', () => {
    expect(validaEntrada({ ...BASE, nombre: '   ' })).toEqual({ ok: false, code: 'nom_buit' })
    expect(validaEntrada({ ...BASE, nombre: 42 })).toEqual({ ok: false, code: 'nom_buit' })
    expect(validaEntrada({ ...BASE, nombre: 'a'.repeat(121) })).toEqual({ ok: false, code: 'nom_massa_llarg' })
    expect(validaEntrada({ ...BASE, nombre: 'a'.repeat(120) }).ok).toBe(true)
  })
  it('rol: solo super_admin y admin (el tecnic, retirado)', () => {
    for (const rol of ['tecnic', 'Admin', '', undefined, 'productor']) {
      expect(validaEntrada({ ...BASE, rol })).toEqual({ ok: false, code: 'rol_invalid' })
    }
  })
  it('idioma desconocido', () => {
    expect(validaEntrada({ ...BASE, idioma: 'en' })).toEqual({ ok: false, code: 'idioma_invalid' })
    expect(validaEntrada({ ...BASE, idioma: '' }).ok).toBe(true)
  })
  it('teléfono: E.164 sin «+», normalizado', () => {
    const r = validaEntrada({ ...BASE, telefon: '+34 676 45-24 (92)' })
    expect(r.ok && r.dades.telefon).toBe('34676452492')
    expect(validaEntrada({ ...BASE, telefon: '' })).toMatchObject({ ok: true, dades: { telefon: null } })
    expect(validaEntrada({ ...BASE, telefon: null })).toMatchObject({ ok: true, dades: { telefon: null } })
    expect(validaEntrada({ ...BASE, telefon: '  ' })).toMatchObject({ ok: true, dades: { telefon: null } })
  })
  it('teléfono inválido', () => {
    for (const telefon of ['0034676452492', '1234567', '34 676 abc', '1234567890123456', 676452492]) {
      expect(validaEntrada({ ...BASE, telefon })).toEqual({ ok: false, code: 'telefon_invalid' })
    }
  })
  it('la misma regla de teléfono que el panel (src/lib/equip.ts: normalitzaTelefon/telefonValid)', () => {
    // Copia de la regla, no importación: `src/lib/equip.ts` arrastra el cliente de Supabase.
    const casos: [string, string, boolean][] = [
      ['+34 676 452 492', '34676452492', true],
      ['34-676-452-492', '34676452492', true],
      ['(34) 676452492', '34676452492', true],
      ['0676452492', '0676452492', false],
      ['12345', '12345', false],
      ['', '', true],
    ]
    for (const [t, norm, valid] of casos) {
      expect(normalitzaTelefon(t)).toBe(norm)
      expect(validaEntrada({ ...BASE, telefon: t }).ok).toBe(valid)
    }
  })
})

describe('errorAlta: el rechazo de alta_membre_equip()', () => {
  it('42501 → 403', () => {
    expect(errorAlta('42501', 'Només el super_admin…')).toEqual({ status: 403, code: 'forbidden' })
  })
  it('22023 por código de mensaje', () => {
    expect(errorAlta('22023', 'rol_invalid')).toEqual({ status: 400, code: 'rol_invalid' })
    expect(errorAlta('22023', 'compte_equip')).toEqual({ status: 409, code: 'compte_equip' })
    expect(errorAlta('22023', 'te_membresies')).toEqual({ status: 409, code: 'te_membresies' })
  })
  it('lo demás, 500', () => {
    expect(errorAlta('22023', 'compte_inexistent')).toEqual({ status: 500, code: 'error_intern' })
    expect(errorAlta('XX000', 'boom')).toEqual({ status: 500, code: 'error_intern' })
    expect(errorAlta(null, null)).toEqual({ status: 500, code: 'error_intern' })
  })
})

describe('composaCorreu: la bienvenida al equipo', () => {
  it('en catalán por defecto, con el rol y el botón', () => {
    const c = composaCorreu({ enllac: ENLLAC, nombre: 'Anna', rol: 'admin' })
    expect(c.subject).toContain("Benvingut/da a l'equip de Redestina")
    expect(c.html).toContain('Hola Anna,')
    expect(c.html).toContain('<strong>Dinamitzador</strong>')
    expect(c.html).toContain('Crea la contrasenya')
    expect(c.html).toContain('type=recovery')
    expect(c.text).toContain(ENLLAC)
    expect(c.text).toContain('Dinamitzador')
  })
  it('en castellano', () => {
    const c = composaCorreu({ enllac: ENLLAC, nombre: 'Anna', rol: 'admin', idioma: 'es' })
    expect(c.subject).toContain('Bienvenido/a al equipo de Redestina')
    expect(c.html).toContain('Hola Anna:')
    expect(c.html).toContain('<strong>Dinamizador</strong>')
    expect(c.html).toContain('Crea la contraseña')
  })
  it('Superadmin en los dos idiomas', () => {
    expect(nomRol('super_admin', 'ca')).toBe('Superadmin')
    expect(nomRol('super_admin', 'es')).toBe('Superadmin')
    expect(composaCorreu({ enllac: ENLLAC, nombre: 'Anna', rol: 'super_admin' }).html).toContain('<strong>Superadmin</strong>')
  })
  it('un idioma desconocido cae al catalán', () => {
    expect(composaCorreu({ enllac: ENLLAC, nombre: 'Anna', rol: 'admin', idioma: 'en' }).subject).toContain('Benvingut')
  })
  it('el nombre se escapa en el HTML (y no en el texto plano)', () => {
    const c = composaCorreu({ enllac: ENLLAC, nombre: '<script>x</script> & "Co"', rol: 'admin' })
    expect(c.html).not.toContain('<script>')
    expect(c.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;Co&quot;')
    expect(c.text).toContain('<script>x</script> & "Co"')
  })
})
