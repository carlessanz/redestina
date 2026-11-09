// El equipo de Redestina (`lib/equip.ts`, 09-11-2026): el orden, los recuentos, qué se ofrece
// de cada cuenta y la traducción de los errores de `canviar_rol_equip()`.

import { describe, expect, it } from 'vitest'
import {
  ACCIONS_HIST, GRUPS_ACCIO, GRUP_TAULA, ROLS_EQUIP, accionsMembre, agrupaAccions, clauErrorEquip, destiPerDefecte,
  destinsPossibles, esBaixada, filtraEquip, normalitzaTelefon, ordenaEquip, recompteRols, rolEquipDe, telefonValid, type MembreEquip,
} from '../src/lib/equip'
import { DICTS } from '../src/lib/i18n'

function membre(over: Partial<MembreEquip>): MembreEquip {
  return {
    user_id: 'u', email: 'a@x.org', nom: null, rol: 'admin', actiu: true,
    ultim_acces: null, des_de: null, otorgat_per: null, es_tu: false, telefon: null, membresies: 0, ...over,
  }
}

describe('ordenaEquip', () => {
  it('primero el rol con más permisos y, dentro, por correo', () => {
    const r = ordenaEquip([
      membre({ user_id: '1', email: 'z@x.org', rol: 'tecnic' }),
      membre({ user_id: '2', email: 'b@x.org', rol: 'admin' }),
      membre({ user_id: '3', email: 'a@x.org', rol: 'admin' }),
      membre({ user_id: '4', email: 'm@x.org', rol: 'super_admin' }),
    ])
    expect(r.map((m) => m.user_id)).toEqual(['4', '3', '2', '1'])
  })

  it('no modifica el array de entrada', () => {
    const entrada = [membre({ user_id: '1', rol: 'tecnic' }), membre({ user_id: '2', rol: 'super_admin' })]
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
      .toEqual({ super_admin: 1, admin: 2, tecnic: 0 })
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

  it('un admin ofrece los tres roles y «treure de l’equip», en ese orden', () => {
    const a = membre({ rol: 'admin' })
    expect(accionsMembre(a, [a]).opcions.map((o) => o.valor)).toEqual(['super_admin', 'admin', 'tecnic', 'cap'])
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
    expect(esBaixada('admin', 'tecnic')).toBe(true)
    expect(esBaixada('tecnic', 'cap')).toBe(true)
  })
  it('subir o repetir no lo es', () => {
    expect(esBaixada('admin', 'super_admin')).toBe(false)
    expect(esBaixada('tecnic', 'admin')).toBe(false)
    expect(esBaixada('admin', 'admin')).toBe(false)
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
    expect(rolEquipDe('tecnic')).toBe('tecnic')
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
  const t = membre({ user_id: 't', email: 't@x.org', rol: 'tecnic' })
  const baja = membre({ user_id: 'b', email: 'b@x.org', rol: 'admin', actiu: false })

  it('solo activas y nunca el origen', () => {
    expect(destinsPossibles([yo, a, t, baja], 'a').map((m) => m.user_id)).toEqual(['yo', 't'])
  })
  it('propone a quien pulsa, y si no puede ser él, la primera', () => {
    expect(destiPerDefecte([yo, a, t], 'a')).toBe('yo')
    expect(destiPerDefecte([yo, a, t], 'yo')).toBe('a')
  })
  it('sin nadie, cadena vacía', () => {
    expect(destiPerDefecte([a], 'a')).toBe('')
  })
  it('prefiere a alguien del mismo rol (y entre ellos, a quien pulsa)', () => {
    const a2 = membre({ user_id: 'a2', email: 'a2@x.org', rol: 'admin' })
    const s2 = membre({ user_id: 's2', email: 's2@x.org', rol: 'super_admin' })
    expect(destiPerDefecte([yo, a, a2, t], 'a')).toBe('a2')
    expect(destiPerDefecte([yo, s2, a, t], 's2')).toBe('yo')
    expect(destiPerDefecte([s2, yo, a], 'yo')).toBe('s2')
    // El del mismo rol desactivado no vale: entonces, quien pulsa.
    expect(destiPerDefecte([yo, a, baja, t], 'a')).toBe('yo')
  })
})

describe('filtraEquip', () => {
  it('separa activas e inactivas, ordenadas por rol', () => {
    const yo = membre({ user_id: 'yo', email: 'yo@x.org', rol: 'super_admin', es_tu: true })
    const t = membre({ user_id: 't', email: 't@x.org', rol: 'tecnic' })
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
