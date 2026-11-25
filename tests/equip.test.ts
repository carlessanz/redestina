// El equipo de Redestina (`lib/equip.ts`, 09-11-2026): el orden, los recuentos, qué se ofrece
// de cada cuenta y la traducción de los errores de `canviar_rol_equip()`. Y el alta (deuda 169):
// la validación del formulario, dónde va cada código de `alta-equip` y el cliente, que nunca lanza.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACCIONS_AUDITORIA, ACCIONS_HIST, CODIS_EQUIP, altaMembreEquip, campErrorAlta, clauErrorAlta, correuValid,
  normalitzaCorreu, validaAltaMembre, GRUPS_ACCIO, GRUP_TAULA, ROLS_EQUIP, accionsMembre, agrupaAccions, clauErrorEquip, clauRol, destiPerDefecte,
  destinsPossibles, esBaixada, filtraEquip, persona, personesAuditoria, normalitzaTelefon, ordenaEquip, recompteRols, rolEquipDe, telefonValid, type MembreEquip,
} from '../src/lib/equip'
import { DICTS } from '../src/lib/i18n'

// El cliente de Supabase no se crea: la sesión es la que diga cada prueba y `fetch` se simula.
const sessio = vi.hoisted(() => ({ token: 'jwt-prova' as string | null }))
vi.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: sessio.token ? { access_token: sessio.token } : null } }),
    },
  },
  supabaseUrl: 'https://prova.supabase.co',
}))

function membre(over: Partial<MembreEquip>): MembreEquip {
  return {
    user_id: 'u', email: 'a@x.org', nom: null, rol: 'admin', actiu: true,
    ultim_acces: null, des_de: null, otorgat_per: null, es_tu: false, telefon: null, membresies: 0, ...over,
  }
}

describe('ordenaEquip', () => {
  it('primero el rol con más permisos y, dentro, por correo', () => {
    const r = ordenaEquip([
      membre({ user_id: '1', email: 'z@x.org', rol: 'admin' }),
      membre({ user_id: '2', email: 'b@x.org', rol: 'admin' }),
      membre({ user_id: '3', email: 'a@x.org', rol: 'admin' }),
      membre({ user_id: '4', email: 'z@x.org', rol: 'super_admin' }),
    ])
    expect(r.map((m) => m.user_id)).toEqual(['4', '3', '2', '1'])
  })

  it('no modifica el array de entrada', () => {
    const entrada = [membre({ user_id: '1', rol: 'admin' }), membre({ user_id: '2', rol: 'super_admin' })]
    ordenaEquip(entrada)
    expect(entrada.map((m) => m.user_id)).toEqual(['1', '2'])
  })

  it('un correo nulo no rompe el orden', () => {
    expect(() => ordenaEquip([membre({ email: null }), membre({ email: 'a@x.org' })])).not.toThrow()
  })
})

describe('recompteRols', () => {
  it('cuenta cada rol y deja a cero los que no hay', () => {
    expect(recompteRols([membre({ rol: 'admin' }), membre({ rol: 'admin' }), membre({ rol: 'super_admin' })]))
      .toEqual({ super_admin: 1, admin: 2 })
  })
  it('un rol que la pantalla no conoce (el `tecnic` retirado) no suma ni rompe', () => {
    const viejo = membre({ rol: 'tecnic' as unknown as MembreEquip['rol'] })
    expect(recompteRols([viejo, membre({ rol: 'admin' })])).toEqual({ super_admin: 0, admin: 1 })
  })
})

describe('dos roles (proceso 0.1, 25-11-2026)', () => {
  it('ROLS_EQUIP ya no tiene `tecnic`', () => {
    expect([...ROLS_EQUIP]).toEqual(['super_admin', 'admin'])
  })
  it('se muestran «Superadmin» y «Dinamitzador»/«Dinamizador»', () => {
    expect(DICTS.ca['eq.rol_super_admin']).toBe('Superadmin')
    expect(DICTS.es['eq.rol_super_admin']).toBe('Superadmin')
    expect(DICTS.ca['eq.rol_admin']).toBe('Dinamitzador')
    expect(DICTS.es['eq.rol_admin']).toBe('Dinamizador')
    expect(DICTS.ca['eq.rol_tecnic']).toBeUndefined()
    expect(DICTS.es['eq.rol_tecnic']).toBeUndefined()
    expect(DICTS.ca['eq.d_tecnic']).toBeUndefined()
  })
  it('clauRol: los vigentes por su clave; el retirado de la historia, con la suya', () => {
    expect(clauRol('super_admin')).toBe('eq.rol_super_admin')
    expect(clauRol('admin')).toBe('eq.rol_admin')
    expect(clauRol('tecnic')).toBe('eq.rol_retirat_tecnic')
    for (const l of ['ca', 'es'] as const) expect(DICTS[l]['eq.rol_retirat_tecnic'], l).toBeTruthy()
  })
})

describe('accionsMembre', () => {
  it('a uno mismo no se le ofrece nada (la base lo rechaza con no_et_pots_canviar)', () => {
    const yo = membre({ user_id: 'yo', rol: 'super_admin', es_tu: true })
    const r = accionsMembre(yo, [yo])
    expect(r).toMatchObject({ canvia: false, motiu: 'eq.m_tu', opcions: [] })
  })

  it('el único super_admin activo no se puede bajar', () => {
    const unico = membre({ user_id: 's', rol: 'super_admin' })
    expect(accionsMembre(unico, [unico, membre({ user_id: 'a', rol: 'admin' })]).motiu).toBe('eq.m_ultim')
  })

  it('con otro super_admin activo, sí se puede bajar', () => {
    const a = membre({ user_id: 's1', rol: 'super_admin' })
    const b = membre({ user_id: 's2', rol: 'super_admin' })
    expect(accionsMembre(a, [a, b]).canvia).toBe(true)
  })

  it('otro super_admin inactivo no cuenta como relevo', () => {
    const a = membre({ user_id: 's1', rol: 'super_admin' })
    const b = membre({ user_id: 's2', rol: 'super_admin', actiu: false })
    expect(accionsMembre(a, [a, b]).motiu).toBe('eq.m_ultim')
  })

  it('un admin ofrece los dos roles y «treure de l’equip», en ese orden', () => {
    const a = membre({ rol: 'admin' })
    expect(accionsMembre(a, [a]).opcions.map((o) => o.valor)).toEqual(['super_admin', 'admin', 'cap'])
  })

  it('todas las claves de las opciones existen en ca y es', () => {
    const a = membre({})
    for (const o of accionsMembre(a, [a]).opcions) {
      expect(DICTS.ca[o.clau], o.clau).toBeTruthy()
      expect(DICTS.es[o.clau], o.clau).toBeTruthy()
    }
  })
})

describe('esBaixada', () => {
  it('bajar de rol o sacar del equipo es baja', () => {
    expect(esBaixada('super_admin', 'admin')).toBe(true)
    expect(esBaixada('admin', 'cap')).toBe(true)
    expect(esBaixada('super_admin', 'cap')).toBe(true)
  })
  it('subir o repetir no lo es', () => {
    expect(esBaixada('admin', 'super_admin')).toBe(false)
    expect(esBaixada('admin', 'admin')).toBe(false)
    expect(esBaixada('super_admin', 'super_admin')).toBe(false)
  })
})

describe('clauErrorEquip', () => {
  it('traduce cada código de la RPC a su clave, que existe en los dos idiomas', () => {
    for (const c of ['rol_invalid', 'no_et_pots_canviar', 'usuari_inexistent', 'no_es_de_lequip', 'ultim_super_admin']) {
      const clau = clauErrorEquip(`error: ${c}`)
      expect(clau).toBe(`eq.e_${c}`)
      expect(DICTS.ca[clau], clau).toBeTruthy()
      expect(DICTS.es[clau], clau).toBeTruthy()
    }
  })
  it('un mensaje desconocido o vacío cae al genérico', () => {
    expect(clauErrorEquip('permission denied for table users')).toBe('eq.e_error')
    expect(clauErrorEquip(null)).toBe('eq.e_error')
    expect(DICTS.ca['eq.e_error']).toBeTruthy()
  })
  it('hay una clave de rol por cada rol', () => {
    for (const r of ROLS_EQUIP) expect(DICTS.ca[`eq.rol_${r}`], r).toBeTruthy()
  })
})

describe('rolEquipDe', () => {
  it('devuelve el rol de plataforma conocido y null para el resto', () => {
    expect(rolEquipDe('super_admin')).toBe('super_admin')
    expect(rolEquipDe('admin')).toBe('admin')
    // Retirado el 25-11-2026: un `tecnic` que llegara de una base vieja no se pinta.
    expect(rolEquipDe('tecnic')).toBeNull()
    expect(rolEquipDe(null)).toBeNull()
    expect(rolEquipDe(undefined)).toBeNull()
    expect(rolEquipDe('productor')).toBeNull()
  })
  it('las claves del rótulo y del menú existen en los dos idiomas', () => {
    for (const k of ['app.rol_title', 'eq.el_teu_rol']) {
      expect(DICTS.ca[k], k).toBeTruthy()
      expect(DICTS.es[k], k).toBeTruthy()
    }
  })
})

describe('accionsMembre: las demás acciones', () => {
  it('a uno mismo solo se le deja editar', () => {
    const yo = membre({ user_id: 'yo', rol: 'super_admin', es_tu: true })
    const { pot, motiuTocar } = accionsMembre(yo, [yo, membre({ user_id: 'x', rol: 'super_admin' })])
    expect(pot).toEqual({ edita: true, activa: false, desactiva: false, esborra: false })
    expect(motiuTocar).toBe('eq.m_tu_tocar')
  })

  it('el único super_admin activo no se desactiva ni se borra, pero se edita', () => {
    const s = membre({ user_id: 's', rol: 'super_admin' })
    const { pot, motiuTocar } = accionsMembre(s, [s, membre({ user_id: 'a' })])
    expect(pot).toEqual({ edita: true, activa: false, desactiva: false, esborra: false })
    expect(motiuTocar).toBe('eq.m_ultim')
  })

  it('un admin activo se puede desactivar y borrar; uno inactivo, activar y borrar', () => {
    const a = membre({ user_id: 'a' })
    expect(accionsMembre(a, [a]).pot).toEqual({ edita: true, activa: false, desactiva: true, esborra: true })
    const i = membre({ user_id: 'i', actiu: false })
    expect(accionsMembre(i, [i]).pot).toEqual({ edita: true, activa: true, desactiva: false, esborra: true })
  })

  it('un super_admin INACTIVO que es el último de los activos no bloquea al otro', () => {
    const a = membre({ user_id: 's1', rol: 'super_admin' })
    const b = membre({ user_id: 's2', rol: 'super_admin', actiu: false })
    expect(accionsMembre(b, [a, b]).pot.esborra).toBe(true)
  })
})

describe('destinsPossibles y destiPerDefecte', () => {
  const yo = membre({ user_id: 'yo', email: 'yo@x.org', rol: 'super_admin', es_tu: true })
  const a = membre({ user_id: 'a', email: 'a@x.org', rol: 'admin' })
  const t = membre({ user_id: 't', email: 't@x.org', rol: 'admin' })
  const baja = membre({ user_id: 'b', email: 'b@x.org', rol: 'admin', actiu: false })

  it('solo activas y nunca el origen', () => {
    expect(destinsPossibles([yo, a, t, baja], 'a').map((m) => m.user_id)).toEqual(['yo', 't'])
  })
  it('propone a quien pulsa, y si no puede ser él, la primera', () => {
    expect(destiPerDefecte([yo, a], 'a')).toBe('yo')
    expect(destiPerDefecte([yo, a, t], 'yo')).toBe('a')
  })
  it('sin nadie, cadena vacía', () => {
    expect(destiPerDefecte([a], 'a')).toBe('')
  })
  it('prefiere a alguien del mismo rol (y entre ellos, a quien pulsa)', () => {
    const a2 = membre({ user_id: 'a2', email: 'a2@x.org', rol: 'admin' })
    const s2 = membre({ user_id: 's2', email: 's2@x.org', rol: 'super_admin' })
    expect(destiPerDefecte([yo, a, a2], 'a')).toBe('a2')
    expect(destiPerDefecte([yo, s2, a, t], 's2')).toBe('yo')
    expect(destiPerDefecte([s2, yo, a], 'yo')).toBe('s2')
    // El del mismo rol desactivado no vale: entonces, quien pulsa.
    expect(destiPerDefecte([yo, a, baja], 'a')).toBe('yo')
  })
})

describe('filtraEquip', () => {
  it('separa activas e inactivas, ordenadas por rol', () => {
    const yo = membre({ user_id: 'yo', email: 'yo@x.org', rol: 'super_admin', es_tu: true })
    const t = membre({ user_id: 't', email: 't@x.org', rol: 'admin' })
    const a = membre({ user_id: 'a', email: 'a@x.org', rol: 'admin' })
    const baja = membre({ user_id: 'b', email: 'b@x.org', rol: 'admin', actiu: false })
    expect(filtraEquip([t, baja, yo, a], 'actius').map((m) => m.user_id)).toEqual(['yo', 'a', 't'])
    expect(filtraEquip([t, baja, yo, a], 'inactius').map((m) => m.user_id)).toEqual(['b'])
  })
})

describe('agrupaAccions', () => {
  it('suma por grupo y ordena de más a menos', () => {
    const r = agrupaAccions([
      { taula: 'documentos', columna: 'emitido_por', n: 41 },
      { taula: 'documentos_externos', columna: 'subido_por', n: 4 },
      { taula: 'convenios', columna: 'creado_por', n: 7 },
      { taula: 'convenios', columna: 'contrafirmado_por', n: 7 },
    ])
    expect(r).toEqual([{ grup: 'documents', n: 45 }, { grup: 'convenis', n: 14 }])
  })
  it('una tabla desconocida cae en «altres»', () => {
    expect(agrupaAccions([{ taula: 'tabla_nueva', columna: 'creado_por', n: 2 }])).toEqual([{ grup: 'altres', n: 2 }])
  })
  it('todos los grupos usados existen y tienen texto en los dos idiomas', () => {
    for (const g of new Set(Object.values(GRUP_TAULA))) expect(GRUPS_ACCIO as readonly string[], g).toContain(g)
    for (const g of GRUPS_ACCIO) {
      expect(DICTS.ca[`eq.g_${g}`], g).toBeTruthy()
      expect(DICTS.es[`eq.g_${g}`], g).toBeTruthy()
    }
  })
})

describe('teléfono', () => {
  it('normaliza quitando +, espacios, guiones y paréntesis', () => {
    expect(normalitzaTelefon('+34 (600) 11-22-33')).toBe('34600112233')
  })
  it('vacío vale; de 8 a 15 cifras sin cero inicial, también; el resto no', () => {
    expect(telefonValid('')).toBe(true)
    expect(telefonValid('  ')).toBe(true)
    expect(telefonValid('+34 600 11 22 33')).toBe(true)
    expect(telefonValid('600112233')).toBe(true)
    expect(telefonValid('123')).toBe(false)
    expect(telefonValid('0600112233')).toBe(false)
    expect(telefonValid('1'.repeat(16))).toBe(false)
    expect(telefonValid('abc12345678')).toBe(false)
  })
})

describe('el historial y los errores nuevos', () => {
  it('hay un texto por cada acción del historial', () => {
    for (const a of ACCIONS_HIST) {
      expect(DICTS.ca[`eq.h_${a}`], a).toBeTruthy()
      expect(DICTS.es[`eq.h_${a}`], a).toBeTruthy()
    }
  })
  it('traduce los códigos de las RPC nuevas', () => {
    for (const c of ['no_et_pots_tocar', 'cal_desti', 'desti_igual', 'desti_no_equip', 'telefon_invalid', 'nom_massa_llarg', 'compte_equip', 'te_membresies']) {
      const clau = clauErrorEquip(c)
      expect(clau).toBe(`eq.e_${c}`)
      expect(DICTS.ca[clau], clau).toBeTruthy()
      expect(DICTS.es[clau], clau).toBeTruthy()
    }
  })
})

describe('auditoría: persona y personesAuditoria', () => {
  it('«Nom (correu)», o lo que haya', () => {
    expect(persona('Anna', 'anna@x.org')).toBe('Anna (anna@x.org)')
    expect(persona(null, 'anna@x.org')).toBe('anna@x.org')
    expect(persona('Anna', null)).toBe('Anna')
    expect(persona('a@x.org', 'a@x.org')).toBe('a@x.org')
    expect(persona(null, null)).toBe('')
  })
  it('una entrada por cuenta, ordenadas, y las borradas marcadas', () => {
    const base = {
      at: '2026-11-09T10:00:00Z', accio: 'rol' as const, rol_abans: null, rol_despres: null, desti_email: null,
      desti_nom: null, total: null, detall: null, per_email: null, per_nom: null,
    }
    const p = personesAuditoria([
      { ...base, user_id: 'b', email: 'b@x.org', nom: 'Bet', esborrat: true },
      { ...base, user_id: 'a', email: 'a@x.org', nom: 'Anna', esborrat: false },
      { ...base, user_id: 'b', email: 'b@x.org', nom: 'Bet', esborrat: true },
    ])
    expect(p).toEqual([
      { user_id: 'a', text: 'Anna (a@x.org)', esborrat: false },
      { user_id: 'b', text: 'Bet (b@x.org)', esborrat: true },
    ])
  })
})

describe('alta: validación del formulario', () => {
  const bo = { email: 'nova@espigoladors.cat', nom: 'Nova Persona', telefon: '' }
  it('nombre, correo y sin teléfono: nada que decir', () => {
    expect(validaAltaMembre(bo)).toEqual({})
    expect(validaAltaMembre({ ...bo, telefon: '+34 600 11 22 33' })).toEqual({})
  })
  it('cada campo, su clave', () => {
    expect(validaAltaMembre({ ...bo, nom: '   ' })).toEqual({ nom: 'eq.e_nom_buit' })
    expect(validaAltaMembre({ ...bo, nom: 'x'.repeat(121) })).toEqual({ nom: 'eq.e_nom_massa_llarg' })
    expect(validaAltaMembre({ ...bo, email: 'no-es-un-correu' })).toEqual({ email: 'eq.e_correu_invalid' })
    expect(validaAltaMembre({ ...bo, telefon: '123' })).toEqual({ telefon: 'eq.e_telefon_invalid' })
    expect(validaAltaMembre({ email: '', nom: '', telefon: '0600' })).toEqual({
      nom: 'eq.e_nom_buit', email: 'eq.e_correu_invalid', telefon: 'eq.e_telefon_invalid',
    })
  })
  it('el correo se normaliza (espacios y mayúsculas) y se valida con forma mínima', () => {
    expect(normalitzaCorreu('  Nova@Espigoladors.CAT ')).toBe('nova@espigoladors.cat')
    expect(correuValid(' A@b.cat ')).toBe(true)
    for (const c of ['', 'a@b', 'a b@c.cat', '@b.cat', 'a@.cat', 'a@@b.cat']) expect(correuValid(c), c).toBe(false)
  })
})

describe('alta: los códigos de alta-equip', () => {
  it('ningún código es parte de otro (se buscan por includes)', () => {
    for (const a of CODIS_EQUIP) for (const b of CODIS_EQUIP) if (a !== b) expect(b.includes(a), `${a} ⊂ ${b}`).toBe(false)
  })
  it('clauErrorEquip reconoce los códigos nuevos', () => {
    for (const c of ['compte_existent', 'correu_invalid', 'nom_buit', 'telefon_invalid', 'rol_invalid', 'correu_fallit', 'compte_inexistent']) {
      expect(clauErrorEquip(`error: ${c}`)).toBe(`eq.e_${c}`)
    }
    // `compte_inexistent` no se confunde con `compte_existent`.
    expect(clauErrorEquip('compte_inexistent')).toBe('eq.e_compte_inexistent')
  })
  it('clauErrorAlta: «ya es del equipo», sesión, permiso, red y el genérico tienen clave propia', () => {
    expect(clauErrorAlta('compte_equip')).toBe('eq.e_alta_compte_equip')
    expect(clauErrorAlta('compte_existent')).toBe('eq.e_compte_existent')
    expect(clauErrorAlta('te_membresies')).toBe('eq.e_te_membresies')
    expect(clauErrorAlta('correu_fallit')).toBe('eq.e_correu_fallit')
    expect(clauErrorAlta('unauthorized')).toBe('eq.e_alta_sessio')
    expect(clauErrorAlta('http_401')).toBe('eq.e_alta_sessio')
    expect(clauErrorAlta('forbidden')).toBe('eq.e_alta_forbidden')
    expect(clauErrorAlta('xarxa')).toBe('eq.e_alta_xarxa')
    expect(clauErrorAlta('http_500')).toBe('eq.e_alta_error')
    expect(clauErrorAlta('')).toBe('eq.e_alta_error')
  })
  it('cada clave del alta existe en los dos idiomas', () => {
    const codis = ['compte_equip', 'compte_existent', 'te_membresies', 'correu_invalid', 'nom_buit', 'telefon_invalid',
      'rol_invalid', 'correu_fallit', 'compte_inexistent', 'unauthorized', 'forbidden', 'xarxa', 'http_500']
    for (const c of codis) {
      const clau = clauErrorAlta(c)
      expect(DICTS.ca[clau], clau).toBeTruthy()
      expect(DICTS.es[clau], clau).toBeTruthy()
    }
  })
  it('cada código va bajo su campo o arriba', () => {
    expect(campErrorAlta('correu_invalid')).toBe('email')
    expect(campErrorAlta('compte_equip')).toBe('email')
    expect(campErrorAlta('compte_existent')).toBe('email')
    expect(campErrorAlta('te_membresies')).toBe('email')
    expect(campErrorAlta('nom_buit')).toBe('nom')
    expect(campErrorAlta('telefon_invalid')).toBe('telefon')
    expect(campErrorAlta('rol_invalid')).toBe('rol')
    for (const c of ['correu_fallit', 'forbidden', 'unauthorized', 'xarxa', 'http_500']) expect(campErrorAlta(c), c).toBeNull()
  })
  it('el alta es una acción del historial y de la auditoría, la primera', () => {
    expect(ACCIONS_HIST[0]).toBe('alta')
    expect(ACCIONS_AUDITORIA).toContain('alta')
  })
})

describe('altaMembreEquip: el cliente nunca lanza', () => {
  const dades = { email: ' Nova@X.org ', nom: ' Nova ', telefon: '+34 600 11 22 33', rol: 'admin' as const, idioma: 'es' as const }
  afterEach(() => { vi.unstubAllGlobals(); sessio.token = 'jwt-prova' })

  function respon(status: number, cos: unknown) {
    const f = vi.fn(async () => new Response(JSON.stringify(cos), { status, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', f)
    return f
  }

  it('manda el contrato con el JWT y devuelve lo que dice el servidor', async () => {
    const f = respon(200, { ok: true, user_id: 'u1', email: 'nova@x.org', rol: 'admin', simulat: true })
    const r = await altaMembreEquip(dades)
    expect(r).toEqual({ ok: true, user_id: 'u1', email: 'nova@x.org', rol: 'admin', simulat: true })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://prova.supabase.co/functions/v1/alta-equip')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-prova')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'nova@x.org', nombre: 'Nova', telefon: '34600112233', rol: 'admin', idioma: 'es',
    })
  })
  it('sin teléfono, no se manda', async () => {
    const f = respon(200, { ok: true, user_id: 'u1', email: 'nova@x.org', rol: 'admin' })
    const r = await altaMembreEquip({ ...dades, telefon: '' })
    expect(r).toMatchObject({ ok: true, simulat: false })
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).not.toHaveProperty('telefon')
  })
  it('un error del servidor vuelve con su código', async () => {
    respon(409, { error: 'compte_existent' })
    expect(await altaMembreEquip(dades)).toEqual({ ok: false, error: 'compte_existent' })
    respon(502, { error: 'correu_fallit' })
    expect(await altaMembreEquip(dades)).toEqual({ ok: false, error: 'correu_fallit' })
    respon(500, null)
    expect(await altaMembreEquip(dades)).toEqual({ ok: false, error: 'http_500' })
    respon(401, { message: 'Invalid JWT' })
    expect(await altaMembreEquip(dades)).toEqual({ ok: false, error: 'unauthorized' })
  })
  it('sin sesión no llama; sin red, `xarxa`', async () => {
    sessio.token = null
    const f = respon(200, { ok: true })
    expect(await altaMembreEquip(dades)).toEqual({ ok: false, error: 'unauthorized' })
    expect(f).not.toHaveBeenCalled()
    sessio.token = 'jwt-prova'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await altaMembreEquip(dades)).toEqual({ ok: false, error: 'xarxa' })
  })
})
