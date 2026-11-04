// «Dona-li accés» (plan 1, rebanada 1D): lo puro de los dos lados.
//
//   · `donar-acces/correu.ts` — a qué correo se da el acceso, qué se escribe en él y cómo se
//     traduce un rechazo de `concedir_acces_org()`.
//   · `lib/accesEntitat.ts` — del estado de la cuenta, qué botones salen en la ficha y por qué
//     están grises.
//
// Lo que pasa contra la base y la función (permisos, compensación, el enlace que llega) lo
// prueban el arnés y `tests/e2e/acces.e2e.ts` contra el clon.

import { describe, expect, it } from 'vitest'
import { accionsAcces, clauErrorAcces, type CondicionsAcces } from '../src/lib/accesEntitat'

// `plantillaEmail()` lee `APP_URL` con `Deno.env`: fuera de Deno, un `Deno` que no sabe nada.
;(globalThis as Record<string, unknown>).Deno = { env: { get: () => undefined } }
const { composaCorreu, errorConcedir, resoldreCorreu } = await import('../supabase/functions/donar-acces/correu')

const ENLLAC = 'http://127.0.0.1:55321/auth/v1/verify?token=abc&type=recovery&redirect_to=http://localhost:5173'

describe('resoldreCorreu: a qué correo se da el acceso', () => {
  it('el que manda la pantalla, normalizado', () => {
    expect(resoldreCorreu('  Persona@Exemple.CAT ', ['altre@x.cat'])).toEqual({ ok: true, email: 'persona@exemple.cat' })
  })
  it('sin correo en la petición, el de las fichas si es uno solo', () => {
    expect(resoldreCorreu(undefined, ['a@x.cat', 'A@x.cat ', null])).toEqual({ ok: true, email: 'a@x.cat' })
  })
  it('sin ninguno, falta_correu', () => {
    expect(resoldreCorreu('', [null, '  '])).toEqual({ ok: false, code: 'falta_correu' })
  })
  it('con dos distintos no elige por nadie', () => {
    expect(resoldreCorreu(null, ['a@x.cat', 'b@x.cat'])).toEqual({ ok: false, code: 'correus_diferents' })
  })
  it('un correo mal escrito no pasa', () => {
    expect(resoldreCorreu('persona@exemple', [])).toEqual({ ok: false, code: 'correu_invalid' })
    expect(resoldreCorreu('per sona@x.cat', [])).toEqual({ ok: false, code: 'correu_invalid' })
  })
})

describe('composaCorreu: el correo de bienvenida', () => {
  it('en catalán por defecto, con el enlace en el botón y en el texto', () => {
    const c = composaCorreu({ enllac: ENLLAC, nom: 'Marta', organitzacio: 'Horta Prova' })
    expect(c.subject).toBe('Benvingut/da a REDESTINA · Estableix la teva contrasenya')
    expect(c.html).toContain(`href="${ENLLAC}"`)
    expect(c.html).toContain('Estableix la contrasenya')
    expect(c.html).toContain('Hola Marta,')
    expect(c.html).toContain('<strong>Horta Prova</strong>')
    expect(c.html).toContain('lang="ca"')
    expect(c.text).toContain(ENLLAC)
  })
  it('en castellano si la cuenta lo tiene', () => {
    const c = composaCorreu({ enllac: ENLLAC, idioma: 'es', nom: null })
    expect(c.subject).toBe('Bienvenido/a a REDESTINA · Establece tu contraseña')
    expect(c.html).toContain('Hola:')
    expect(c.html).toContain('lang="es"')
    expect(c.html).not.toContain('en nombre de')
  })
  it('los datos de la ficha se escapan', () => {
    const c = composaCorreu({ enllac: ENLLAC, nom: '<script>x</script>', organitzacio: 'A & B "C"' })
    expect(c.html).not.toContain('<script>x</script>')
    expect(c.html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(c.html).toContain('A &amp; B &quot;C&quot;')
  })
  it('sin código de seis cifras: es un enlace de recuperación, no un acceso mágico', () => {
    const c = composaCorreu({ enllac: ENLLAC })
    expect(c.html).not.toMatch(/\b\d{6}\b/)
    expect(c.text).not.toMatch(/codi|código/i)
  })
})

describe('errorConcedir: los rechazos de concedir_acces_org()', () => {
  it.each([
    ['entitat_inactiva', 409], ['registre_pendent', 409], ['compte_equip', 409],
    ['compte_en_altra_org', 409], ['altre_compte_actiu', 409], ['organitzacio_inexistent', 404],
    ['correu_invalid', 400],
  ])('%s → %i', (code, status) => {
    expect(errorConcedir(code)).toEqual({ status, code })
  })
  it('el correo único de productores → dades_en_us', () => {
    expect(errorConcedir('duplicate key value violates unique constraint "productores_email_key"'))
      .toEqual({ status: 409, code: 'dades_en_us' })
  })
  it('lo demás es un error interno', () => {
    expect(errorConcedir('connection reset')).toEqual({ status: 500, code: 'error_intern' })
    expect(errorConcedir(undefined)).toEqual({ status: 500, code: 'error_intern' })
  })
})

describe('accionsAcces: los botones del bloque «Contacte i accés»', () => {
  const base: CondicionsAcces = {
    estat: 'sense', potAprovar: true, entitatActiva: true, correu: 'a@x.cat', correuCanviat: false, motiuCorreu: null,
  }

  it('sin cuenta: solo «Dona-li accés», y se puede pulsar', () => {
    expect(accionsAcces(base)).toEqual({ donar: { motiu: null }, reenviar: null, desactivar: null })
  })
  it('desactivada: «Dona-li accés» la reactiva', () => {
    expect(accionsAcces({ ...base, estat: 'desactivat' }).donar).toEqual({ motiu: null })
  })
  it.each(['enviat', 'actiu'] as const)('%s: «Torna a enviar» y «Desactiva l’accés»', (estat) => {
    expect(accionsAcces({ ...base, estat })).toEqual({ donar: null, reenviar: { motiu: null }, desactivar: { motiu: null } })
  })
  it('con un registro pendiente no se ofrece nada: se decide en Aprovacions', () => {
    expect(accionsAcces({ ...base, estat: 'pendent' })).toEqual({ donar: null, reenviar: null, desactivar: null })
  })
  it('los motivos, en orden: permiso, entidad inactiva, sin correo, correo sin desar', () => {
    expect(accionsAcces({ ...base, potAprovar: false, entitatActiva: false }).donar?.motiu).toBe('appr.need_approver')
    expect(accionsAcces({ ...base, entitatActiva: false, correu: '' }).donar?.motiu).toBe('acc.m_inactiva')
    expect(accionsAcces({ ...base, correu: '  ', correuCanviat: true }).donar?.motiu).toBe('acc.m_sense_correu')
    expect(accionsAcces({ ...base, correuCanviat: true, motiuCorreu: 'canal.motiu_email' }).donar?.motiu).toBe('acc.m_desa_correu')
    // Con el correo apagado ya no sale gris: es un envío manual (§8, 04-11-2026).
    expect(accionsAcces({ ...base, motiuCorreu: 'canal.motiu_email' }).donar?.motiu).toBeNull()
  })
  it('desactivar no depende del correo, solo del permiso', () => {
    const a = accionsAcces({ ...base, estat: 'actiu', correu: '', motiuCorreu: 'canal.motiu_notificacions' })
    expect(a.reenviar?.motiu).toBe('acc.m_sense_correu')
    expect(a.desactivar).toEqual({ motiu: null })
    expect(accionsAcces({ ...base, estat: 'actiu', potAprovar: false }).desactivar).toEqual({ motiu: 'appr.need_approver' })
  })
})

describe('clauErrorAcces: el código del servidor como clave i18n', () => {
  it('los conocidos tienen su clave; lo demás, el genérico', () => {
    expect(clauErrorAcces('correu_desactivat')).toBe('acc.e_correu_desactivat')
    expect(clauErrorAcces('no_test_user')).toBe('acc.e_no_test_user')
    expect(clauErrorAcces('http_500')).toBe('acc.e_error')
    expect(clauErrorAcces(null)).toBe('acc.e_error')
  })
})
