// La importación del ARA 2026 (plan 1, rebanada 1E) sobre CSV sintéticos: mapeo por cabecera,
// NIF inválido/repetido/ausente, doble rol por NIF, tres teléfonos en una celda, unicidad de
// `phone`/`email` en `productores`, idempotencia que solo rellena huecos y el cruce con Airtable.
// Ningún dato real: los NIF son válidos por construcción (B00000000, 00000000T…).

import { describe, expect, it } from 'vitest'
import {
  claveMunicipi, codiValid, creuarAirtable, dataAlta, derivarBoolean, type Existent, extraerCorreos, extraerTelefonos,
  type FilaAra, HOJAS, type Hoja, indexMunicipis, llegirAirtable, llegirFulla, normalitzaCapcalera, parseCsv,
  estatCrmDeHoja, pegatRellenaHuecos, planificar, resolCapcaleres, similitud, tipoReceptorDeFamilia, tipusProposat,
} from '../scripts/ara2026/nucli'

const CAP_ACTIUS = ',Nom,Empresa,Codi,Comentari,Visitat,Conveni,Tipo  Empresa,Movils,Fix,Adreça,C.P.,NIF,Area geogràfica,Població,Coord,Coord 2,Producte,01/19'
const CAP_INACTIUS = ',,Empresa,Codi,Comentari,Visitat,Conveni,Tipo  Empresa,Movils,Fix,Adreça,C.P.,NIF,Area geogràfica,Població,Coord,Coord 2,Producte'
const CAP_POT = '"Data\nAlta",Codi,Productor/a,Empresa,Comentari,Visitat,Conveni,Producte,Movils,Fix,Adreça,C.P.,NIF,C.P.,Població,Producte'
const CAP_SDA = 'Data Alta ,nom,Familia,Prioritat,Codi,Estat,Comentaris,Gestió,Area geogràfica,Població,Adreça,Codi postal,Horari,NIF,Telefon,Contactes,Telèfon,Mail,Contacte 2,Telèfon 2,Mail 2,Calendari de repartiment,Repartiment de productes frescos,Transport amb plataforma?,Descàrrega amb toro,Càmara Frigo (m3),Neveres repartiment,Observacions,Nombre beneficiaris atesos,Treballador/es,Voluntaris,Voluntaris per espigolar,CURS Manip.aliments,Saldo,Saldo 30/6/25'
const CAP_SDA_I = CAP_SDA.replace('NOM', 'nom').replace('Treballador/es', 'Personal contractat').replace('nom,', 'NOM ,')

const csv = (cap: string, files: string[]) => parseCsv([cap, ...files].join('\n'))

const buit = (): Existent => ({ nifsAliens: new Map(), correusProductors: new Set(), telefonsProductors: new Set(), importats: new Map() })
const totesBuides = () => Object.fromEntries(HOJAS.map((h) => [h, { files: [] as FilaAra[], descartades: [] as number[] }])) as Record<Hoja, { files: FilaAra[]; descartades: number[] }>

describe('normalizadores', () => {
  it('cabeceras: espacios dobles, saltos, acentos y espacio final', () => {
    expect(normalitzaCapcalera('Tipo  Empresa')).toBe('tipo empresa')
    expect(normalitzaCapcalera('Data\nAlta')).toBe('data alta')
    expect(normalitzaCapcalera('NOM ')).toBe('nom')
    expect(normalitzaCapcalera('Telèfon')).toBe(normalitzaCapcalera('Telefon'))
  })
  it('tres teléfonos en una celda, con nombres y extensión', () => {
    expect(extraerTelefonos('670038564 (Julia) 664755419 (Quim) / 93 263 91 00 (ext. 9196)'))
      .toEqual(['34670038564', '34664755419', '34932639100'])
    expect(extraerTelefonos('Josep (alcalde) i Mariona')).toEqual([])
  })
  it('correos dentro de texto libre', () => {
    expect(extraerCorreos('afarre@exemple.cat 936377223')).toEqual(['afarre@exemple.cat'])
  })
  it('fecha de alta: ISO, serie de Excel y año suelto', () => {
    expect(dataAlta('2022-05-03')).toEqual({ iso: '2022-05-03', text: '2022-05-03' })
    expect(dataAlta('43795')).toEqual({ iso: '2019-11-26', text: '2019-11-26' })
    expect(dataAlta('2022')).toEqual({ iso: null, text: '2022' })
    expect(dataAlta('FITXAT')).toEqual({ iso: null, text: 'FITXAT' })
  })
  it('códigos, booleanos y tipo de receptor', () => {
    expect(codiValid('PR015')).toBe('PR015')
    expect(codiValid('??')).toBeNull()
    expect(codiValid('pendent')).toBeNull()
    expect(derivarBoolean('Si (Punt solidari)')).toBe(true)
    expect(derivarBoolean('NO')).toBe(false)
    expect(derivarBoolean('1 furgo')).toBeNull()
    expect(tipoReceptorDeFamilia('SDA')).toBe('social')
    expect(tipoReceptorDeFamilia('Centre Social')).toBe('social')
    expect(tipoReceptorDeFamilia('Animal')).toBe('animal')
    expect(tipoReceptorDeFamilia('E.I. E-I.F')).toBe('transformador')
    expect(tipoReceptorDeFamilia('')).toBeNull()
  })
  it('municipio: «Prat de Llobregat, el» = «El Prat de Llobregat»; los nombres repetidos no casan', () => {
    expect(claveMunicipi('Prat de Llobregat, el')).toBe(claveMunicipi('El Prat de Llobregat'))
    const idx = indexMunicipis([{ codi_ine: '1', nom: 'Gavà' }, { codi_ine: '2', nom: 'Repetit' }, { codi_ine: '3', nom: 'Repetit' }])
    expect(idx.get(claveMunicipi('GAVA'))).toBe('1')
    expect(idx.has('REPETIT')).toBe(false)
  })
  it('similitud de trigramas como pg_trgm: 1 si es igual, 0 si no comparte nada', () => {
    expect(similitud('Cal Peretó', 'CAL PERETO')).toBe(1)
    expect(similitud('abc', 'xyz')).toBe(0)
  })
})

describe('lectura por cabecera', () => {
  it('falla si a la exportación le falta una cabecera esperada', () => {
    expect(() => resolCapcaleres('sda', ['Data Alta', 'nom'])).toThrow(/faltan cabeceras/)
  })
  it('prod_potencials: «Producte» #0 es el tipo y #1 el producto; «C.P.» #1 es el área', () => {
    const { files } = llegirFulla('prod_potencials', csv(CAP_POT, ['FITXAT,-,Jordi,Hort Jordi,,,,Pot.NoContac,600000001,,,,,Maresme,Argentona,cebes']))
    const f = files[0]
    expect(f.camps.tipo_empresa).toBe('Pot.NoContac')
    expect(f.camps.productos_habituales).toEqual(['cebes'])
    expect(f.camps.area_geografica).toBe('Maresme')
    expect(f.camps.codigo).toBeNull()
    expect(f.anotacions).toContain("Data d'alta (ARA): FITXAT")
  })
  it('prod_inactius: la columna 0 es el motivo de baja y la 1 el nombre', () => {
    const { files } = llegirFulla('prod_inactius', csv(CAP_INACTIUS, ['jubilat,Pere Prova,,PR001,,,,Productor,600000002,,,,,Maresme,Mataró,,,']))
    expect(files[0].nom).toBe('Pere Prova')
    expect(files[0].anotacions).toContain('Motiu de baixa (ARA): jubilat')
  })
  it('prod_actius: «Fix» con correo va al correo; las filas sin nombre se descartan', () => {
    const { files, descartades } = llegirFulla('prod_actius', csv(CAP_ACTIUS, [
      '2022-05-03,Anna,Hort Anna,PR002,,,,Productor,600000003,anna@exemple.cat,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,',
      ',,,,comentari sense nom,,,,,,,,,,,,,,',
    ]))
    expect(files[0].correus).toEqual(['anna@exemple.cat'])
    expect(files[0].camps.data_alta).toBe('2022-05-03')
    expect(descartades).toEqual([4])
  })
  it('sda: «Telefon» #0 → telefono, «Telèfon» #1 → telefono2, «Telèfon 2» → telefono3', () => {
    const { files } = llegirFulla('sda', csv(CAP_SDA, [
      '44306,Rebost,SDA,1,E001,Signat,,,,,,,,,937000001 // 602000001,Maria,600000004,rebost@exemple.cat,Joan,600000005,no és correu,Diari,SI,no,,8,,Obs,100 families,2,5,SI,NO,0,',
    ]))
    const f = files[0]
    expect(f.telefonsEntitat).toEqual({ telefono: ['34937000001', '34602000001'], telefono2: ['34600000004'], telefono3: ['34600000005'] })
    expect(f.camps.data_alta).toBe('2021-04-20')
    expect(f.camps.tipo_receptor).toBe('social')
    expect(f.camps.productes_frescos).toBe(true)
    expect(f.correusNoValids).toEqual(['no és correu'])
    expect(f.anotacions.join('\n')).toMatch(/Altres telèfons \(telefono\): 34602000001/)
    expect(f.anotacions).toContain('Càmera frigorífica (m3): 8')
  })
  it('sda_inactius: «NOM » y «Personal contractat»', () => {
    const { files } = llegirFulla('sda_inactius', csv(CAP_SDA_I, [',Antiga,SDA,0,E005,Pendent,,,,,,,,,,,,,,,,,,,,,,,,3,,,,0,']))
    expect(files[0].nom).toBe('Antiga')
    expect(files[0].anotacions).toContain('Personal: 3')
  })
})

describe('planificar', () => {
  function cas() {
    const t = totesBuides()
    t.prod_actius = llegirFulla('prod_actius', csv(CAP_ACTIUS, [
      ',Doble,Doble SL,PR010,,,,Productor,600000010,doble@exemple.cat,,,B00000000,,Gavà,,,,', // NIF compartido con el SDA
      ',Invalid,,PR011,,,,Productor,600000010,doble@exemple.cat,,,B00000001,,,,,,', // NIF mal; mismo móvil y correo
      ',Sense,,PR012,,,,Productor,,,,,,,,,,,',
      ',Repetit,,PR013,,,,Productor,,,,,B00000000,,,,,,', // NIF repetido entre productores
      ',JaHi,,PR014,,,,Productor,,,,,00000000T,,,,,,', // NIF que ya tiene una ficha de la base
    ]))
    t.sda = llegirFulla('sda', csv(CAP_SDA, [',Doble Entitat,SDA,1,E010,,,,,,,,,B-00000000,,,,,,,,,,,,,,,,,,,,,']))
    return t
  }
  const existent = (): Existent => ({ ...buit(), nifsAliens: new Map([['00000000T', 'org-x']]) })

  it('doble rol por NIF, NIF inválido/repetido/ausente y «ja existeix»', () => {
    const p = planificar(cas(), existent(), indexMunicipis([{ codi_ine: '08089', nom: 'Gavà' }]))
    expect(p.dobleRol).toHaveLength(1)
    expect(p.dobleRol[0].nif).toBe('B00000000')
    const doble = p.orgs.find((o) => o.clau === 'B00000000')!
    expect(doble.productor?.fila.nom).toBe('Doble')
    expect(doble.entitat?.fila.nom).toBe('Doble Entitat')
    expect(doble.entitat?.dades.nif).toBe('B00000000')
    expect(p.nifInvalid.map((x) => x.nom)).toEqual(['Invalid'])
    expect(p.nifRepetit.map((x) => x.nom)).toEqual(['Repetit'])
    expect(p.senseNif.map((x) => x.nom)).toEqual(['Sense'])
    expect(p.jaExisteix.map((x) => x.nom)).toEqual(['JaHi'])
    expect(p.orgs).toHaveLength(4) // Doble (2 fichas), Invalid, Sense, Repetit
    expect(p.municipiCasat).toBe(1)
    expect(doble.productor?.dades.municipio_ine).toBe('08089')
  })
  it('todo entra inactivo, con ref_externa, y el NIF malo queda anotado en el comentario', () => {
    const p = planificar(cas(), existent(), new Map())
    const fitxes = p.orgs.flatMap((o) => [o.productor, o.entitat]).filter(Boolean)
    expect(fitxes.every((f) => f!.dades.activo === false && f!.dades.es_test === false)).toBe(true)
    expect(fitxes.every((f) => String(f!.dades.ref_externa).startsWith('ARA26:'))).toBe(true)
    const inv = fitxes.find((f) => f!.fila.nom === 'Invalid')!
    expect(inv.dades.nif).toBeNull()
    expect(String(inv.dades.comentario)).toMatch(/NIF de l'origen no vàlid: B00000001/)
    const rep = fitxes.find((f) => f!.fila.nom === 'Repetit')!
    expect(String(rep.dades.comentario)).toMatch(/NIF repetit a l'origen \(el conserva ARA26:prod_actius:2\)/)
  })
  it('phone y email de productores son únicos: el segundo los pierde', () => {
    const p = planificar(cas(), existent(), new Map())
    const fitxes = p.orgs.flatMap((o) => [o.productor]).filter(Boolean)
    const doble = fitxes.find((f) => f!.fila.nom === 'Doble')!
    const inv = fitxes.find((f) => f!.fila.nom === 'Invalid')!
    expect(doble.dades.phone).toBe('34600000010')
    expect(doble.dades.email).toBe('doble@exemple.cat')
    expect(inv.dades.phone).toBeNull()
    expect(inv.dades.telefono_alt).toBe('34600000010')
    expect(inv.dades.email).toBeNull()
    expect(p.telefonEnUs.map((x) => x.nom)).toEqual(['Invalid'])
    expect(p.correuEnUs.map((x) => x.nom)).toEqual(['Invalid'])
  })
  it('sin NIF nunca se juntan por nombre', () => {
    const t = totesBuides()
    t.prod_actius = llegirFulla('prod_actius', csv(CAP_ACTIUS, [',Mateix,,,,,,,,,,,,,,,,,']))
    t.sda = llegirFulla('sda', csv(CAP_SDA, [',Mateix,SDA,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,']))
    const p = planificar(t, buit(), new Map())
    expect(p.orgs).toHaveLength(2)
    expect(p.dobleRol).toHaveLength(0)
    expect(p.nomsRepetits).toEqual([{ nom: 'MATEIX', refs: ['ARA26:prod_actius:2', 'ARA26:sda:2'] }])
  })
  it('idempotente: la segunda pasada reconoce la ficha por ref; si el nombre no casa, no la toca', () => {
    const t = totesBuides()
    t.prod_actius = llegirFulla('prod_actius', csv(CAP_ACTIUS, [',Anna,,,,,,,,,,,,,,,,,', ',Berta,,,,,,,,,,,,,,,,,']))
    const ex = buit()
    ex.importats.set('ARA26:prod_actius:2', { taula: 'productores', id: 'p1', organizacion_id: 'o1', nom: 'ANNA' })
    ex.importats.set('ARA26:prod_actius:3', { taula: 'productores', id: 'p2', organizacion_id: 'o2', nom: 'Una altra' })
    const p = planificar(t, ex, new Map())
    expect(p.orgs).toHaveLength(1)
    expect(p.orgs[0].productor?.existent).toEqual({ id: 'p1', organizacion_id: 'o1' })
    expect(p.refDesquadrada.map((x) => x.ref)).toEqual(['ARA26:prod_actius:3'])
  })
  it('la segunda pasada solo rellena huecos y nunca toca activo', () => {
    expect(pegatRellenaHuecos(
      { nif: 'B00000000', poblacion: null, activo: true, productos_habituales: [] },
      { nif: null, poblacion: 'Gavà', activo: false, productos_habituales: ['pomes'], ref_externa: 'x' },
    )).toEqual({ poblacion: 'Gavà', productos_habituales: ['pomes'] })
  })
})

describe('Airtable', () => {
  const cap = 'Nombre transacción;Tipo registro;Ofertante;Producto;Variedad;Responsable interno;Fecha registro;Fecha disponibilidad;Estado comercial;Destino final;Transporte;Unidad reportada;Cantidad reportada;Formato logistico;Num. formatos;Peso x formato;Retorno caja/envase necesario?;Paletizado;€/ kg o unidad;Receptor;Calidad producto;Ubicación (Municipio);Dirección o link mapa;Observaciones;Mensaje comercial;Destinos;Codigo;INTERACCIONES'
  const linia = (n: string, of: string, desti: string, rec: string) =>
    `E-2026-${n}${of};Excedente confirmado;${of};Lima;;Resp;;;Cerrado;${desti};;KG;10;;;;;;;${rec};;;;Obs;;;;`
  const text = [
    '﻿' + cap,
    linia('001', 'Hort Prova', 'Venta', 'GRANJA PROVA'),
    'continuació de les observacions;;;;;;;;;;;;;;;;;;;;;;;;;;;',
    ';;;;;;;;;;;;;;;;;;;;;;;;;;;',
    // La forma real del registro roto (E-2026-018): la celda con coma, partida en dos y desplazada.
    `"E-2026-003""Cal Desplaçat";" S.L.""";Seguimiento productor;;;;;;;;;;;;;;;;;;;;;;;;;`,
    '"Hort Prova";;;;;;;;;;;;;;;;;;;;;;;;;;;',
    linia('004', 'Nou Ofertant', 'Alimentación animal', 'FUNDACIO PROVA SOLIDARIA'),
  ].join('\r\n')

  it('reconstruye por registro, solo se fía de la línea de inicio y lista los códigos sin registro', () => {
    const at = llegirAirtable(text)
    expect(at.registres.map((r) => [r.codi, r.ofertant, r.receptor, r.fiable])).toEqual([
      ['E-2026-001', 'Hort Prova', 'GRANJA PROVA', true],
      ['E-2026-003', 'Cal Desplaçat', null, false],
      ['E-2026-004', 'Nou Ofertant', 'FUNDACIO PROVA SOLIDARIA', true],
    ])
    expect(at.codisSenseRegistre).toEqual(['E-2026-002'])
  })
  it('exacto → casar (confirmar); parecido → revisar; ausente → crear inactivo con tipo propuesto', () => {
    const t = totesBuides()
    t.prod_actius = llegirFulla('prod_actius', csv(CAP_ACTIUS, [
      ',Joan,HORT PROVA,,,,,,,,,,,,,,,,', // exacto por la empresa
      ',Cal Desplacat SL,,,,,,,,,,,,,,,,,', // parecido
    ]))
    const creu = creuarAirtable(llegirAirtable(text).registres, HOJAS.flatMap((h) => t[h].files))
    const per = Object.fromEntries(creu.map((c) => [`${c.paper}:${c.nom}`, c]))
    expect(per['ofertant:Hort Prova'].decisio).toBe('casar_confirmar')
    expect(per['ofertant:Cal Desplaçat'].decisio).toBe('revisar')
    expect(per['ofertant:Nou Ofertant'].decisio).toBe('crear_inactiu')
    expect(per['receptor:GRANJA PROVA'].proposta).toMatch(/comercial/)
    expect(per['receptor:FUNDACIO PROVA SOLIDARIA'].proposta).toMatch(/social/)
  })
  it('tipo propuesto: social si es entidad social; animal si todo fue a alimentación animal', () => {
    expect(tipusProposat('FUNDACION AUREA', ['Donación'])).toBe('social')
    expect(tipusProposat('GRANJA', ['Alimentación animal'])).toBe('animal')
    expect(tipusProposat('EMPRESA', ['Venta'])).toBe('comercial')
  })
})

// Plan 2 B1 (20270518100000): el estado CRM con el que entra cada hoja, igual que el backfill.
describe('estatCrmDeHoja', () => {
  it('potencials → potencial; inactius → inactiu; actius y sda → en desenvolupament', () => {
    expect(estatCrmDeHoja('prod_potencials')).toBe('potencial')
    expect(estatCrmDeHoja('prod_inactius')).toBe('inactiu')
    expect(estatCrmDeHoja('sda_inactius')).toBe('inactiu')
    expect(estatCrmDeHoja('prod_actius')).toBe('en_desenvolupament')
    expect(estatCrmDeHoja('sda')).toBe('en_desenvolupament')
  })
  it('la segunda pasada no pisa el estado que haya puesto el equipo', () => {
    expect(pegatRellenaHuecos({ estat_crm: 'actiu' }, { estat_crm: 'potencial' })).toEqual({})
    expect(pegatRellenaHuecos({}, { estat_crm: 'potencial' })).toEqual({})
  })
})
