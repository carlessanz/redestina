// `textError()`: el texto de un error para un aviso. Pura (solo lee el diccionario).
//
// POR QUÉ IMPORTA: los envoltorios de `src/lib` devuelven el error de tres formas —el texto
// que levanta la RPC a propósito, una clave i18n de respaldo o el mensaje crudo de Postgres
// en inglés— y las pantallas lo pintaban a pelo. El orden de las reglas es el contrato:
// código conocido → clave → crudo a respaldo → texto de la RPC tal cual.

import { describe, it, expect } from 'vitest'
import { esClau, textError } from '../src/lib/textError'

/** Un traductor que deja ver qué clave se pidió. */
const t = (clau: string) => `T(${clau})`

describe('textError', () => {
  it('un código conocido gana a todo, venga en `codi` o dentro del mensaje', () => {
    expect(textError(t, { missatge: 'lo que sea', codi: 'sense_conveni' })).toBe('T(od.conv_blocked)')
    expect(textError(t, { missatge: '42501: sense_conveni per a donacio' })).toBe('T(od.conv_blocked)')
    expect(textError(t, 'ERROR sense_conveni')).toBe('T(od.conv_blocked)')
  })

  it('un código que contiene a otro gana el más largo (`cal_motiu_incidencia` ≠ `cal_motiu`)', () => {
    expect(textError(t, { missatge: 'cal_motiu_incidencia: aquest albarà té una incidència de recollida', codi: '22023' }))
      .toBe('T(alb.err_cal_motiu_incidencia)')
    expect(textError(t, { missatge: 'cal_motiu', codi: '22023' })).toBe('T(po.err_cal_motiu)')
  })

  // Fase 5 de los puntos 4-6: la propuesta de cambios. `cal_motiu` y `hora_passada` llegan en el
  // mensaje igual que en otras pantallas; `propostaCanvisApi` los distingue por `codi`.
  it('los códigos de la propuesta de cambios', () => {
    expect(textError(t, { missatge: 'no_proposable: aquesta resposta no admet una proposta (aprovada)', codi: '22023' }))
      .toBe('T(prop.err_no_proposable)')
    expect(textError(t, { missatge: 'sense_proposta: aquesta resposta no te cap proposta per respondre', codi: '22023' }))
      .toBe('T(prop.err_sense_proposta)')
    expect(textError(t, { missatge: 'proposta_pendent: respon primer la proposta de l\'equip', codi: '22023' }))
      .toBe('T(prop.err_proposta_pendent)')
    expect(textError(t, { missatge: 'cal_motiu: cal indicar el motiu de la proposta', codi: 'cal_motiu_proposta' }))
      .toBe('T(prop.err_cal_motiu)')
    expect(textError(t, { missatge: 'hora_passada: l\'hora proposada ja ha passat', codi: 'hora_proposta_passada' }))
      .toBe('T(prop.err_hora_vencuda)')
    expect(textError(t, { missatge: 'cal_canvi: la proposta ha de canviar alguna cosa', codi: '22023' }))
      .toBe('T(asg.err_cal_canvi)')
    // Sin el `codi` propio, `cal_motiu` sigue siendo el de cancelar una oferta.
    expect(textError(t, { missatge: 'cal_motiu', codi: '22023' })).toBe('T(po.err_cal_motiu)')
    for (const c of ['prop.err_no_proposable', 'prop.err_sense_proposta', 'prop.err_proposta_pendent', 'prop.err_cal_motiu',
      'prop.err_hora_vencuda', 'prop.err_protegida', 'prop.err_cal_resposta', 'prop.err_inexistent', 'prop.err_motiu_llarg',
      'prop.err_modalitat']) {
      expect(esClau(c), c).toBe(true)
    }
  })

  it('sin mensaje, el respaldo (por defecto `c.error`)', () => {
    expect(textError(t, null)).toBe('T(c.error)')
    expect(textError(t, undefined)).toBe('T(c.error)')
    expect(textError(t, { missatge: null })).toBe('T(c.error)')
    expect(textError(t, '', 'c.load_error')).toBe('T(c.load_error)')
  })

  it('los códigos que algunas funciones devuelven COMO mensaje', () => {
    expect(textError(t, 'unauthorized')).toBe('T(msg.w_unauth)')
    expect(textError(t, 'forbidden')).toBe('T(msg.w_unauth)')
    expect(textError(t, 'error')).toBe('T(c.error)')
  })

  it('un mensaje que ES una clave del diccionario se traduce', () => {
    expect(textError(t, { missatge: 'c.load_error' })).toBe('T(c.load_error)')
  })

  it('un mensaje crudo de Postgres, Auth o la red cae al respaldo', () => {
    for (const crud of [
      'permission denied for table documentos',
      'new row violates row-level security policy for table "x"',
      'duplicate key value violates unique constraint',
      'JWT expired',
      'TypeError: Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'no_autoritzat',
    ]) {
      expect(textError(t, crud, 'c.load_error'), crud).toBe('T(c.load_error)')
    }
  })

  it('el texto que la RPC levanta a propósito se enseña tal cual', () => {
    const rpc = 'Aquest donant està bloquejat: 3 canalitzacions sense conciliar (412.0 kg)'
    expect(textError(t, { missatge: rpc })).toBe(rpc)
  })

  it('estado de las fichas (plan 1, 1A): los cinco códigos tienen texto en los dos idiomas', () => {
    const casos: [string, string][] = [
      ['entitat_inactiva: aquesta entitat no esta activa', 'org.err_entitat_inactiva'],
      ['falta_nif: cal el NIF per activar la fitxa', 'org.err_falta_nif'],
      ['nif_invalid: el NIF B00000002 no es valid', 'val.nif_control'],
      ['falta_rao_social: cal la rao social per activar la fitxa', 'org.err_falta_rao_social'],
      ['ja_te_paper', 'org.err_ja_te_paper'],
    ]
    for (const [missatge, clau] of casos) {
      expect(textError(t, { missatge, codi: '22023' }), missatge).toBe(`T(${clau})`)
      expect(esClau(clau), clau).toBe(true)
    }
  })

  it('`esClau` solo reconoce claves que existen', () => {
    expect(esClau('c.error')).toBe(true)
    expect(esClau('c.no_existeix_mai')).toBe(false)
    expect(esClau('Hi ha hagut un error')).toBe(false)
  })
})
