// «Nova entitat» en dos pasos (plan 1, rebanada 1B): lo que decide la pantalla sin pantalla.
// La normalización y el «parece un NIF» del buscador, qué se ofrece al elegir un resultado,
// lo que exige el formulario y lo que viaja a `crear_entitat()`.

import { describe, expect, it } from 'vitest'
import {
  accionsResultat, campDelError, dadesAlta, errorsAlta, potCercar, prellenaAlta, semblaNif,
  type ResultatCerca,
} from '../src/lib/novaEntitat'
import { DICTS } from '../src/lib/i18n'

function resultat(p: Partial<ResultatCerca>): ResultatCerca {
  return {
    organizacion_id: 'o', nom_comercial: 'Mas', razon_social: null, nif: null, persona_contacte: null,
    poblacion: null, comarca: null, productor_id: null, entidad_id: null, es_generadora: false,
    es_receptora: false, productor_activo: null, entidad_activo: null, activa: false, te_compte: false,
    compte_estat: 'cap', coincidencia: 'nom', similitud: 0, ...p,
  }
}

describe('novaEntitat: buscar', () => {
  it('busca a partir de 3 caracteres de nombre o de NIF', () => {
    expect(potCercar('ab')).toBe(false)
    // Como la RPC: los espacios se colapsan, no se quitan («a b» son tres caracteres).
    expect(potCercar('  a  ')).toBe(false)
    expect(potCercar('  a  b ')).toBe(true)
    expect(potCercar('mas')).toBe(true)
    expect(potCercar('B-')).toBe(false)
    expect(potCercar('b.00')).toBe(true)
  })

  it('reconoce la forma de un DNI, un NIE y un CIF, con o sin separadores', () => {
    expect(semblaNif('12345678Z')).toBe(true)
    expect(semblaNif('12.345.678-z')).toBe(true)
    expect(semblaNif('x1234567l')).toBe(true)
    expect(semblaNif('B 6578 0001')).toBe(true)
    // La forma, no el control: un CIF con la cifra mal escrita sigue pareciendo un NIF.
    expect(semblaNif('B65780009')).toBe(true)
    expect(semblaNif('B0000')).toBe(false)
    expect(semblaNif('Mas de Prova')).toBe(false)
    expect(semblaNif('1234567Z')).toBe(false)
  })

  it('lleva al alta el NIF limpio si lo parece, y si no el nombre', () => {
    expect(prellenaAlta(' 12.345.678-z ')).toEqual({ nif: '12345678Z' })
    expect(prellenaAlta('  Mas   de Prova ')).toEqual({ nom_comercial: 'Mas de Prova' })
    expect(prellenaAlta('ab')).toEqual({})
  })
})

describe('novaEntitat: qué se ofrece al elegir un resultado', () => {
  it('inactiva con un papel: activar ese papel y ofrecer el otro', () => {
    const a = accionsResultat(resultat({ es_generadora: true, productor_id: 'p', productor_activo: false, activa: false }))
    expect(a).toEqual({ papers: ['productor'], inactius: ['productor'], afegibles: ['entidad'], activa: false })
  })
  it('activa con los dos papeles: nada que activar ni que añadir', () => {
    const a = accionsResultat(resultat({
      es_generadora: true, es_receptora: true, productor_activo: true, entidad_activo: true, activa: true,
    }))
    expect(a).toEqual({ papers: ['productor', 'entidad'], inactius: [], afegibles: [], activa: true })
  })
  it('activa por un papel y con el otro inactivo: sigue activa (D7) y ofrece activar el otro', () => {
    const a = accionsResultat(resultat({
      es_generadora: true, es_receptora: true, productor_activo: true, entidad_activo: false, activa: true,
    }))
    expect(a.activa).toBe(true)
    expect(a.inactius).toEqual(['entidad'])
  })
})

describe('novaEntitat: el formulario del alta', () => {
  const base = { nom_comercial: 'Mas Nou', razon_social: 'Mas Nou SL', nif: '12345678Z' }

  it('nace activa: exige NIF válido y razón social; un receptor, su tipo', () => {
    expect(errorsAlta({}, ['productor'])).toEqual({
      nom_comercial: 'ef.nom_obligatori', razon_social: 'ne.err_cal_rao', nif: 'ne.err_cal_nif',
    })
    expect(errorsAlta({ ...base, nif: '12345678A' }, ['productor'])).toEqual({ nif: 'val.nif_control' })
    expect(errorsAlta(base, ['productor'])).toEqual({})
    expect(errorsAlta(base, ['productor', 'entidad'])).toEqual({ tipo_receptor: 'ne.err_cal_tipus_receptor' })
    expect(errorsAlta({ ...base, email: 'x@', telefon: '12', codigo_postal: '8' }, ['productor']))
      .toEqual({ email: 'val.email', telefon: 'val.phone', codigo_postal: 'val.cp' })
  })

  it('manda solo los campos del alta, normalizados, con los papeles y la marca de prueba', () => {
    const d = dadesAlta({
      ...base, nif: '12.345.678-z', telefon: '600 111 222', email: '  ', tipus_activitat: [],
      tipo_receptor: 'social', comentari: 'no viaja', es_test: true,
    }, ['productor'], true)
    expect(d).toEqual({
      rols: ['productor'], es_test: true,
      nom_comercial: 'Mas Nou', razon_social: 'Mas Nou SL', nif: '12345678Z', telefon: '34600111222',
    })
    const r = dadesAlta({ ...base, tipo_receptor: 'social', tipus_activitat: ['majorista'] }, ['productor', 'entidad'], false)
    expect(r.tipo_receptor).toBe('social')
    expect(r.tipus_activitat).toEqual(['majorista'])
    expect(r.rols).toEqual(['productor', 'entidad'])
  })

  it('pone cada error del servidor junto a su campo, con una clave que existe', () => {
    expect(campDelError('nif_en_us: el NIF B1 ja el te una altra organitzacio')).toEqual({ camp: 'nif', clau: 'org.err_nif_en_us' })
    expect(campDelError('falta_rao_social: …')?.camp).toBe('razon_social')
    expect(campDelError('cal_tipus_receptor: tria')?.camp).toBe('tipo_receptor')
    expect(campDelError('Nomes l\'equip pot donar d\'alta una entitat')).toBeNull()
    for (const m of ['nif_en_us', 'nif_invalid', 'falta_nif', 'falta_rao_social', 'cal_nom_comercial',
      'cal_tipus_receptor', 'tipus_activitat_desconegut', 'municipi desconegut']) {
      const r = campDelError(m)
      expect(r, m).not.toBeNull()
      expect(DICTS.ca[r!.clau as keyof typeof DICTS.ca], r!.clau).toBeTruthy()
      expect(DICTS.es[r!.clau as keyof typeof DICTS.es], r!.clau).toBeTruthy()
    }
  })
})
