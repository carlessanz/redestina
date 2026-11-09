// El importador de entidades desde Excel (06-11-2026), la parte del navegador: reconocer las
// columnas por su cabecera, leer la hoja (filas de título encima, filas vacías, la fila de
// ejemplo de la plantilla), normalizar cada fila al contrato de las RPC y la plantilla.
//
// Filas SINTÉTICAS que reproducen los problemas del Excel real de Airtable: CP como número,
// dos teléfonos en una celda, «contacto: x@y.org», «No disponible», «Tipo de entidad» que no
// es la forma jurídica, «Contactos» que se ignora, cabeceras sueltas sin datos. Ningún dato real.

import { describe, expect, it } from 'vitest'
import { DICTS } from '../src/lib/i18n'
import {
  activitatsDe, campDeColumna, campsOmplerts, CAMPS_RESULTAT, cellaCsv, clauCodi, CODIS_BASE, COLUMNES_PLANTILLA,
  csvInforme, ERRORS_LOT, esExemple, filesPerEnviar, filesSensePaper, llegeixCsv, llegeixFulla, localitzaCapcalera,
  mapaCapcaleres, MARCA_EXEMPLE, modalitatsDeText, normalitzaFila, normalitzaFulla, proposaRols, rolsDeText, sha256Hex,
  telefonsDe, tipusEmpresaDe, tipusReceptorDe, valorCp, valorText, type ActivitatCataleg, type Cella,
} from '../src/lib/importEntitats'
import { COLUMNES_DE_PLANTILLA, dadesPlantilla, LLISTES, valorsLlista, type ContextPlantilla } from '../src/lib/plantillaEntitats'

/** Las cabeceras exactas de la exportación de Airtable (hoja «Hoja1», fila 1). */
const AIRTABLE = [
  'Nombre comercial', 'Persona de contacto', 'Entidad', 'Cargo (contacto)', 'Correo (contacto)', 'Número fijo', 'Cargo',
  'Email general', 'Tipo de entidad', 'Actividad', 'Contactos', 'Dirección fiscal', 'Municipio', 'Provincia', 'Área (intern)',
  'Registro excedente', 'Provincia (from Municipio)', 'Código postal', 'Nombre fiscal', 'Forma jurídica', 'NIF', 'Web',
  'Número de trabajadores',
]
const col = (h: string) => AIRTABLE.indexOf(h)

/** Una fila de Airtable con los valores dados por cabecera. */
function filaAirtable(v: Partial<Record<string, Cella>>): Cella[] {
  const f: Cella[] = AIRTABLE.map(() => null)
  for (const [h, x] of Object.entries(v)) f[col(h)] = x
  return f
}

const CATALEG: ActivitatCataleg[] = [
  { codi: 'productor_agricola', nom_ca: 'Productor agrícola', nom_es: 'Productor agrícola' },
  { codi: 'menjador_social', nom_ca: 'Menjador social', nom_es: 'Comedor social', aplica: 'entidad' },
  { codi: 'banc_aliments', nom_ca: "Banc d'aliments", nom_es: 'Banco de alimentos' },
]
const ctx = { activitats: CATALEG }

describe('cabeceras', () => {
  it('reconoce todas las cabeceras de Airtable (y descarta las que no aportan)', () => {
    const m = mapaCapcaleres(AIRTABLE)
    expect(m.falten).toEqual([])
    const per = Object.fromEntries(m.reconegudes.map((r) => [`${r.capcalera}`, r.clau]))
    expect(per).toMatchObject({
      'Nombre comercial': 'nom_comercial', 'Persona de contacto': 'persona_contacte', Entidad: 'entitat',
      'Cargo (contacto)': 'carrec', Cargo: 'carrec', 'Correo (contacto)': 'email', 'Número fijo': 'telefon2',
      'Email general': 'email2', 'Tipo de entidad': 'tipus_entitat', Actividad: 'tipus_activitat',
      'Dirección fiscal': 'direccion', Municipio: 'municipi', 'Área (intern)': 'area_geografica',
      'Registro excedente': 'registre_excedent', 'Código postal': 'codigo_postal', 'Nombre fiscal': 'razon_social',
      'Forma jurídica': 'tipus_empresa', NIF: 'nif', Web: 'web', 'Número de trabajadores': 'treballadors',
    })
    expect(m.ignorades.map((i) => [i.capcalera, i.motiu])).toEqual([
      ['Contactos', 'a_proposit'], ['Provincia', 'a_proposit'], ['Provincia (from Municipio)', 'a_proposit'],
    ])
  })

  it('una cabecera repetida cuenta por ocurrencia; si no admite varias, manda la primera', () => {
    const m = mapaCapcaleres(['Nom comercial', 'Cargo', 'NIF', 'Cargo', 'nif ', 'Telèfon', 'Teléfono'])
    expect(m.reconegudes.filter((r) => r.clau === 'carrec').map((r) => r.ocurrencia)).toEqual([0, 1])
    expect(m.reconegudes.filter((r) => r.clau === 'telefon')).toHaveLength(2)
    expect(m.ignorades).toEqual([{ index: 4, capcalera: 'nif', motiu: 'repetida' }])
  })

  it('sin nombre comercial falta la obligatoria; una cabecera desconocida se ignora', () => {
    const m = mapaCapcaleres(['NIF', 'Color preferit', null, ''])
    expect(m.falten).toEqual(['nom_comercial'])
    expect(m.ignorades).toEqual([{ index: 1, capcalera: 'Color preferit', motiu: 'desconeguda' }])
  })

  it('acentos, mayúsculas, espacios y apóstrofos no cuentan', () => {
    const m = mapaCapcaleres(['  NOMBRE   COMERCIAL ', 'Tipus d’activitat', 'codi postal'])
    expect(m.reconegudes.map((r) => r.clau)).toEqual(['nom_comercial', 'tipus_activitat', 'codigo_postal'])
  })

  it('ningún alias choca con otro (el índice se construye sin lanzar)', () => {
    const totes = COLUMNES_PLANTILLA.flatMap((c) => [c.capcalera, ...c.alias])
    expect(mapaCapcaleres(totes).ignorades.filter((i) => i.motiu !== 'repetida')).toEqual([])
  })
})

describe('leer una hoja', () => {
  it('tolera filas de título encima y salta las vacías y las de cabeceras sueltas sin datos', () => {
    const files: Cella[][] = [
      ['Llistat d’entitats 2026'],
      [],
      AIRTABLE,
      filaAirtable({ 'Nombre comercial': 'TEST Hort A', NIF: 'B00000000' }),
      [null, null, ''],
      // La fila 11 del Excel real: cabeceras sueltas en columnas sin cabecera (Y:AB).
      [...AIRTABLE.map(() => null), 'Observaciones', 'Contacto principal', 'Responsable interno', 'Rol'],
      filaAirtable({ 'Nombre comercial': 'TEST Hort B' }),
    ]
    expect(localitzaCapcalera(files)).toBe(2)
    const f = llegeixFulla(files)
    expect(f.filaCapcalera).toBe(2)
    expect(f.files.map((x) => x.numero)).toEqual([4, 7])
  })

  it('salta la fila de ejemplo de la plantilla', () => {
    expect(esExemple(['Tots dos', 'Cal Exemple', MARCA_EXEMPLE])).toBe(true)
    expect(esExemple(['Exemple de Mar SL'])).toBe(false)
    const f = llegeixFulla([['Nom comercial', 'Observacions'], ['Cal Exemple', MARCA_EXEMPLE], ['Cal Pep', 'res']])
    expect(f.exemples).toBe(1)
    expect(f.files.map((x) => x.numero)).toEqual([3])
  })

  it('CSV con `;` y BOM, y con `,`', () => {
    expect(llegeixCsv('﻿Nom comercial;NIF\r\nCal Pep;B00000000\r\n')).toEqual([['Nom comercial', 'NIF'], ['Cal Pep', 'B00000000']])
    expect(llegeixCsv('Nom comercial,NIF\n"Cal Pep, SL",B00000000\n')).toEqual([['Nom comercial', 'NIF'], ['Cal Pep, SL', 'B00000000']])
  })
})

describe('valores de celda', () => {
  it('«No disponible», «No localizada», «-» y vacíos son null', () => {
    for (const v of ['No disponible', 'no localizada', ' - ', '', null, undefined, 'N/A']) expect(valorText(v)).toBeNull()
    expect(valorText(937620135)).toBe('937620135')
    expect(valorText(new Date(Date.UTC(2025, 2, 12)))).toBe('2025-03-12')
  })

  it('el código postal recupera el cero', () => {
    expect(valorCp(8380)).toBe('08380')
    expect(valorCp('8380')).toBe('08380')
    expect(valorCp('08380')).toBe('08380')
    expect(valorCp('08380 Malgrat de Mar')).toBe('08380')
    expect(valorCp('No disponible')).toBeNull()
  })

  it('dos teléfonos en una celda, con espacios o con texto', () => {
    expect(telefonsDe('937620135 / 629381497').telefons).toEqual(['34937620135', '34629381497'])
    expect(telefonsDe('93 762 01 35').telefons).toEqual(['34937620135'])
    expect(telefonsDe('Tel: 629381497 (Joan)').telefons).toEqual(['34629381497'])
    expect(telefonsDe('+33 6 12 34 56 78').telefons).toEqual(['33612345678'])
    expect(telefonsDe('123')).toEqual({ telefons: [], noReconeguts: ['123'] })
  })

  it('forma jurídica → tipus_empresa', () => {
    expect(tipusEmpresaDe('Autónomo')).toEqual({ codi: 'autonom', aNota: false })
    expect(tipusEmpresaDe('Sociedad Limitada (S.L.)')).toEqual({ codi: 'sl', aNota: false })
    expect(tipusEmpresaDe('S.A.')).toEqual({ codi: 'sa', aNota: false })
    expect(tipusEmpresaDe('Fundación')).toEqual({ codi: 'fundacio', aNota: false })
    expect(tipusEmpresaDe('Associació')).toEqual({ codi: 'associacio', aNota: false })
    expect(tipusEmpresaDe('Cooperativa agrària SCCL')).toEqual({ codi: 'cooperativa', aNota: false })
    // SAT y sociedad civil (Taula mestra 1.3, 09-11-2026): sin confundirse con SA ni con la SCCL.
    expect(tipusEmpresaDe('SAT')).toEqual({ codi: 'sat', aNota: false })
    expect(tipusEmpresaDe('S.A.T. núm. 123')).toEqual({ codi: 'sat', aNota: false })
    expect(tipusEmpresaDe('Sociedad Agraria de Transformación')).toEqual({ codi: 'sat', aNota: false })
    expect(tipusEmpresaDe('Societat civil privada')).toEqual({ codi: 'sc', aNota: false })
    expect(tipusEmpresaDe('S.C.P.')).toEqual({ codi: 'sc', aNota: false })
    expect(tipusEmpresaDe('SC')).toEqual({ codi: 'sc', aNota: false })
    expect(tipusEmpresaDe('S.C.C.L.')).toEqual({ codi: 'cooperativa', aNota: false })
    expect(tipusEmpresaDe('Comunidad de bienes')).toEqual({ codi: 'altres', aNota: true })
    expect(tipusEmpresaDe(null)).toEqual({ codi: null, aNota: false })
  })

  it('tipo de receptor, modalidades, papeles y actividades (códigos o etiquetas, ca/es)', () => {
    expect(tipusReceptorDe('Entitat social')).toBe('social')
    expect(tipusReceptorDe('Entidad social')).toBe('social')
    expect(tipusReceptorDe('comercial')).toBe('comercial')
    expect(tipusReceptorDe('Zoològic')).toBe('zoològic')
    expect(modalitatsDeText('Donació, Venta')).toEqual(['donacio', 'venda'])
    expect(modalitatsDeText('totes')).toEqual(['donacio', 'venda', 'maquila'])
    expect(modalitatsDeText('Regal')).toEqual(['regal'])
    expect(rolsDeText('Tots dos')).toEqual(['productor', 'entidad'])
    expect(rolsDeText('Ofertante')).toEqual(['productor'])
    expect(rolsDeText('receptor')).toEqual(['entidad'])
    expect(rolsDeText('Ofertant i receptor')).toEqual(['productor', 'entidad'])
    expect(rolsDeText('Ambos')).toEqual(['productor', 'entidad'])
    expect(rolsDeText('Patrocinador')).toBeNull()
    expect(activitatsDe('Comedor social, venta de fruta', CATALEG)).toEqual({ codis: ['menjador_social'], resta: ['venta de fruta'] })
    // Solo las del papel de la fila: a un ofertant, «Comedor social» le va a la nota.
    expect(activitatsDe('Comedor social', CATALEG, ['productor'])).toEqual({ codis: [], resta: ['Comedor social'] })
    expect(activitatsDe('Comedor social', CATALEG, ['entidad'])).toEqual({ codis: ['menjador_social'], resta: [] })
    expect(activitatsDe('Productor agrícola', CATALEG, ['entidad'])).toEqual({ codis: ['productor_agricola'], resta: [] })
  })
})

describe('proposaRols', () => {
  it('la columna Rol manda', () => {
    expect(proposaRols({ rol: 'Receptor', tipusEntitat: 'Productor individual' })).toEqual({ rols: ['entidad'], origen: 'columna' })
  })
  it('sin Rol: «Entidad social» → receptor; «Productor individual» o un registro de excedente → ofertant', () => {
    expect(proposaRols({ tipusEntitat: 'Entidad social' })).toEqual({ rols: ['entidad'], origen: 'deduit' })
    expect(proposaRols({ tipusEntitat: 'Productor individual' })).toEqual({ rols: ['productor'], origen: 'deduit' })
    expect(proposaRols({ tipusEntitat: 'Empresa', registreExcedent: 'E-2026-014' })).toEqual({ rols: ['productor'], origen: 'deduit' })
  })
  it('si nada lo dice, sin papel', () => {
    expect(proposaRols({ tipusEntitat: 'Empresa' })).toEqual({ rols: [], origen: 'cap' })
  })
})

describe('normalitzaFila (Excel de Airtable)', () => {
  const m = mapaCapcaleres(AIRTABLE)

  it('receptora social: correo de «contacto: x@y.org», dos teléfonos, CP numérico, «No disponible»', () => {
    const f = normalitzaFila(5, filaAirtable({
      'Nombre comercial': 'TEST-IMP Menjador', 'Persona de contacto': 'Anna Prova', Entidad: 'Associació TEST-IMP Menjador',
      'Cargo (contacto)': 'Coordinadora', Cargo: 'Presidenta', 'Correo (contacto)': 'No disponible',
      'Número fijo': '937620135 / 629381497', 'Email general': 'contacto: info@exemple.invalid',
      'Tipo de entidad': 'Entidad social', Actividad: 'Menjador social', Contactos: 'recA, recB',
      'Dirección fiscal': 'Carrer Major, 1', Municipio: 'Malgrat de Mar', Provincia: 'Barcelona', 'Área (intern)': 'Maresme',
      'Código postal': 8380, 'Nombre fiscal': 'Associació TEST-IMP', 'Forma jurídica': 'Asociación', NIF: 'g-00000000',
      Web: 'No localizada', 'Número de trabajadores': 4,
    }), m, ctx)
    expect(f.rols).toEqual(['entidad'])
    expect(f.origenRols).toBe('deduit')
    expect(f.contracte).toEqual({
      fila: 5, nom_comercial: 'TEST-IMP Menjador', razon_social: 'Associació TEST-IMP', nif: 'G00000000',
      tipus_empresa: 'associacio', tipus_activitat: ['menjador_social'], persona_contacte: 'Anna Prova',
      // El móvil delante aunque en la celda venga detrás (es el de WhatsApp).
      email: 'info@exemple.invalid', telefon: '34629381497', telefon2: '34937620135', direccion: 'Carrer Major, 1',
      codigo_postal: '08380', municipi: 'Malgrat de Mar', area_geografica: 'Maresme', tipo_receptor: 'social',
      nota: ['Entitat: Associació TEST-IMP Menjador', 'Càrrec: Coordinadora', 'Càrrec: Presidenta', 'Nombre de treballadors: 4'].join('\n'),
    })
    // «Contactos» y «Provincia» no van a ninguna parte.
    expect(JSON.stringify(f.contracte)).not.toContain('recA')
  })

  it('ofertant por «Registro excedente»; actividad libre y forma desconocida a la nota; tres teléfonos', () => {
    const f = normalitzaFila(6, filaAirtable({
      'Nombre comercial': 'TEST-IMP Hort', 'Tipo de entidad': 'Empresa', 'Registro excedente': 'E-2026-001, E-2026-007',
      Actividad: 'Fruita dolça', 'Forma jurídica': 'Comunidad de bienes', 'Número fijo': '972000000 / 600000000 / 611111111',
      'Correo (contacto)': 'a@exemple.invalid; b@exemple.invalid', 'Email general': 'c@exemple.invalid',
    }), m, ctx)
    expect(f.rols).toEqual(['productor'])
    expect(f.contracte.tipus_empresa).toBe('altres')
    expect(f.contracte.tipus_activitat).toBeUndefined()
    // Los móviles delante: el fijo, tercero, va a la nota.
    expect(f.contracte.telefon).toBe('34600000000')
    expect(f.contracte.telefon2).toBe('34611111111')
    expect(f.contracte.email).toBe('a@exemple.invalid')
    expect(f.contracte.email2).toBe('b@exemple.invalid')
    expect(f.contracte.nota?.split('\n')).toEqual([
      "Tipus d'entitat (origen): Empresa", 'Altres correus: c@exemple.invalid', 'Altres telèfons: 34972000000',
      'Forma jurídica: Comunidad de bienes', 'Activitat: Fruita dolça', "Registre d'excedents (origen): E-2026-001, E-2026-007",
    ])
    expect(f.avisosLocals).toEqual(expect.arrayContaining(['telefons_a_nota', 'correus_a_nota', 'forma_juridica_a_nota', 'activitat_a_nota']))
  })

  it('sin papel deducible y sin nombre comercial (usa la entidad)', () => {
    const f = normalitzaFila(7, filaAirtable({ Entidad: 'TEST-IMP Sense Nom', 'Tipo de entidad': 'Empresa' }), m, ctx)
    expect(f.rols).toEqual([])
    expect(f.origenRols).toBe('cap')
    expect(f.nom).toBe('TEST-IMP Sense Nom')
    expect(f.avisosLocals).toContain('nom_de_rao')
  })

  it('el conveni signat y quien lo firmó: a la nota y al resultado', () => {
    const mp = mapaCapcaleres(['Nom comercial', 'Rol', 'Conveni signat (data)', 'Signant del conveni'])
    const f = normalitzaFila(2, ['TEST-IMP Conv', 'Receptor', new Date(Date.UTC(2026, 0, 15)), 'Joan Prova'], mp, ctx)
    expect(f.conveni).toEqual({ data: '2026-01-15', signant: 'Joan Prova' })
    expect(f.contracte.nota).toBe('Conveni signat (data): 2026-01-15\nSignant del conveni: Joan Prova')
    expect(f.origenRols).toBe('columna')
  })
})

describe('lo que se manda', () => {
  const m = mapaCapcaleres(['Nom comercial', 'Rol'])
  const files = normalitzaFulla(llegeixFulla([['Nom comercial', 'Rol'], ['A', 'Ofertant'], ['B', '']]), ctx)
  void m

  it('papeles elegidos en la revisión y decisión de las dudosas', () => {
    expect(filesSensePaper(files, {})).toEqual([3])
    expect(filesSensePaper(files, { 3: ['entidad'] })).toEqual([])
    expect(filesPerEnviar(files, { 3: ['entidad'] }, { 3: 'crear' })).toEqual([
      { fila: 2, nom_comercial: 'A', rols: ['productor'] },
      { fila: 3, nom_comercial: 'B', rols: ['entidad'], decisio: 'crear' },
    ])
  })

  it('sha256 del fichero', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('lo que contesta la base', () => {
  it('códigos con detalle tras «:»', () => {
    expect(clauCodi('semblant_a_fila:4')).toEqual({ clau: 'ie.c_semblant_a_fila', detall: '4' })
    expect(clauCodi('error_bd:23505:duplicate key: x')).toEqual({ clau: 'ie.c_error_bd', detall: '23505:duplicate key: x' })
    expect(clauCodi('sense_nif')).toEqual({ clau: 'ie.c_sense_nif', detall: '' })
  })

  it('columnas reales → campos del contrato (espejo de importacio_camp)', () => {
    expect(campDeColumna('productores.phone')).toBe('telefon')
    expect(campDeColumna('entidades.telefono2')).toBe('telefon2')
    expect(campDeColumna('entidades.comentarios')).toBe('nota')
    expect(campsOmplerts(['productores.comentario', 'entidades.email', 'productores.email'])).toEqual(['email', 'nota'])
  })

  it('el informe protege de fórmulas', () => {
    expect(cellaCsv('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(cellaCsv('-3')).toBe("'-3")
    expect(cellaCsv(-3)).toBe('-3')
    const csv = csvInforme([{ fila: 2, nom: '@Cal', nif: null, accio: 'Creada', organitzacio: null, camps: '', conflictes: '', avisos: 'a;b', errors: '', conveni: '' }],
      { fila: 'Fila', nom: 'Nom', nif: 'NIF', accio: 'A', organitzacio: 'O', camps: 'C', conflictes: 'X', avisos: 'Av', errors: 'E', conveni: 'Cv' })
    expect(csv.startsWith('﻿Fila;Nom;')).toBe(true)
    expect(csv).toContain("2;'@Cal;;Creada;;;;\"a;b\";;")
  })
})

describe('la plantilla', () => {
  const t = (k: string, p?: Record<string, string | number>) => {
    let s = DICTS.ca[k] ?? k
    for (const [x, v] of Object.entries(p ?? {})) s = s.replaceAll(`{${x}}`, String(v))
    return s
  }
  const pctx: ContextPlantilla = { t, lang: 'ca', activitats: CATALEG, comarques: ['Maresme', 'Garrotxa'] }
  const [entitats, instruccions, llistes] = dadesPlantilla(pctx)
  const celles = (r: unknown[]): Cella[] => r.map((c) => (c && typeof c === 'object' && 'value' in c ? (c as { value: Cella }).value : c as Cella))

  it('se reconoce entera al volver a subirla, y la fila de ejemplo se salta', () => {
    const files = entitats.data.map((r) => celles(r as unknown[]))
    const m = mapaCapcaleres(files[0])
    expect(m.ignorades).toEqual([])
    expect(m.falten).toEqual([])
    expect(m.reconegudes.map((r) => r.clau)).toEqual(COLUMNES_DE_PLANTILLA.map((c) => c.clau))
    const f = llegeixFulla(files)
    expect(f.exemples).toBe(1)
    expect(f.files).toEqual([])
  })

  it('la fila de ejemplo, si se dejara, sería una fila válida', () => {
    const files = entitats.data.slice(0, 2).map((r) => celles(r as unknown[]))
    const m = mapaCapcaleres(files[0])
    const f = normalitzaFila(2, files[1], m, ctx)
    expect(f.rols).toEqual(['productor', 'entidad'])
    expect(f.contracte).toMatchObject({ nom_comercial: 'Cal Exemple', nif: 'B00000000', tipus_empresa: 'sl', tipo_receptor: 'social',
      tipus_activitat: ['productor_agricola'], modalitats_interes: ['donacio'], codigo_postal: '08380', telefon: '34600000000' })
  })

  it('las columnas de NIF, CP y teléfonos van en formato texto', () => {
    const fila = entitats.data[2] as { format?: string }[]
    COLUMNES_DE_PLANTILLA.forEach((c, i) => {
      if (c.text) expect(fila[i]?.format, c.capcalera).toBe('@')
    })
  })

  it('cada valor de las listas lo entiende el lector, en catalán y en castellano', () => {
    for (const lang of ['ca', 'es'] as const) {
      const tl = (k: string) => DICTS[lang][k] ?? k
      const c = { ...pctx, t: tl, lang }
      for (const v of valorsLlista('rol', c)) expect(rolsDeText(v), v).not.toBeNull()
      expect(valorsLlista('tipo_receptor', c).map(tipusReceptorDe)).toEqual(['social', 'animal', 'transformador', 'comercial'])
      expect(valorsLlista('tipus_empresa', c).map((v) => tipusEmpresaDe(v).codi)).toEqual(['cooperativa', 'sat', 'sc', 'sl', 'sa', 'autonom', 'fundacio', 'associacio', 'altres'])
      expect(modalitatsDeText(valorsLlista('modalitats', c).join(', '))).toEqual(['donacio', 'venda', 'maquila'])
      expect(activitatsDe(valorsLlista('tipus_activitat', c).join(', '), CATALEG).resta).toEqual([])
    }
    expect(llistes.data[0]).toHaveLength(LLISTES.length)
  })

  it('las instrucciones tienen una fila por columna, con su ayuda traducida', () => {
    const textos = instruccions.data.flat().map((c) => (c && typeof c === 'object' && 'value' in c ? String(c.value) : String(c ?? '')))
    for (const c of COLUMNES_DE_PLANTILLA) expect(textos).toContain(c.capcalera)
    expect(textos.some((x) => x.startsWith('ie.'))).toBe(false)
  })
})

describe('las claves compuestas existen en los dos idiomas', () => {
  const claus = [
    ...COLUMNES_PLANTILLA.flatMap((c) => [`ie.h_${c.clau}`, `ie.col_${c.clau}`]),
    ...LLISTES.map((l) => `ie.ll_${l}`),
    ...CODIS_BASE.map((c) => `ie.c_${c}`),
    ...ERRORS_LOT.map((c) => `ie.lot_${c}`),
    ...CAMPS_RESULTAT.map((c) => `ie.camp_${c}`),
    ...['telefons_a_nota', 'telefon_no_reconegut', 'correus_a_nota', 'correu_no_reconegut', 'forma_juridica_a_nota',
      'activitat_a_nota', 'rol_desconegut', 'nom_de_rao'].map((c) => `ie.al_${c}`),
  ]
  it.each(['ca', 'es'] as const)('%s', (lang) => {
    expect(claus.filter((k) => DICTS[lang][k] === undefined)).toEqual([])
  })
})
