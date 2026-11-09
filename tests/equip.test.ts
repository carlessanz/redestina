// El equipo de Redestina (`lib/equip.ts`, 09-11-2026): el orden, los recuentos, qué se ofrece
// de cada cuenta y la traducción de los errores de `canviar_rol_equip()`.

import { describe, expect, it } from 'vitest'
import {
  ROLS_EQUIP, accionsMembre, clauErrorEquip, esBaixada, ordenaEquip, recompteRols, rolEquipDe, type MembreEquip,
} from '../src/lib/equip'
import { DICTS } from '../src/lib/i18n'

function membre(over: Partial<MembreEquip>): MembreEquip {
  return {
    user_id: 'u', email: 'a@x.org', nom: null, rol: 'admin', actiu: true,
    ultim_acces: null, des_de: null, otorgat_per: null, es_tu: false, ...over,
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
    expect(accionsMembre(yo, [yo])).toEqual({ canvia: false, motiu: 'eq.m_tu', opcions: [] })
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
