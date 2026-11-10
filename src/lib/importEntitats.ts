// El importador de entidades desde Excel (super_admin, 06-11-2026): lo que hace el NAVEGADOR.
//
// PURO: sin React ni Supabase (los catálogos llegan por parámetro), con prueba
// (`tests/importEntitats.test.ts`). La pantalla es `routes/equip/ImportaEntitats.tsx`; el
// cliente de las dos RPC, `lib/importacions.ts`; la plantilla, `lib/plantillaEntitats.ts`.
//
// El reparto de trabajo, que es lo que ordena este fichero:
//   · El navegador LEE la hoja, reconoce las columnas por su cabecera (nunca por posición) y
//     deja cada fila en el contrato de `previsualitzar_importacio_entitats()` /
//     `importar_entitats()` (migración 20270511100000): CP con sus cinco cifras, teléfonos en
//     E.164, correos extraídos del texto, la forma jurídica en su código, y lo que no tiene
//     columna en la ficha, como líneas «Etiqueta: valor» de la nota.
//   · La BASE revalida todo y decide la identidad (ID Redestina → NIF → Airtable → clave sin NIF →
//     candidatos; B4, 20270519100000, y una existente se ACTUALIZA: D11):
//     aquí no se decide si una fila es nueva o existente, ni se descarta nada por inválido.
//
// Lo que manda en el mapeo de columnas es `COLUMNES_PLANTILLA`: la cabecera de la plantilla
// (en catalán) y sus alias —castellano, las cabeceras de la exportación de Airtable, las del
// ARA cuando encajan y las etiquetas de la ficha (`campsFitxa`) en los dos idiomas—. La
// plantilla descargada se reconoce entera por construcción (`tests/importEntitats.test.ts`).

import { CAMPS_FITXA } from './campsFitxa'
import { DICTS } from './i18n'
import { MODALITATS_IDS } from './modalitats'
import {
  extraerCorreos, extraerTelefonos, normalitzaCapcalera, normalitzaNom, parseCsv, senseAccents,
} from './normalitzaImport'
import { TIPUS_EMPRESA } from './perfilReceptor'
import { errorTelefon, netejaNif, normalitzaTelefon } from './validacio'
import { naturalesaDeText } from './naturalesa'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Paper = 'productor' | 'entidad'
/** Una celda tal como llega de `read-excel-file` o del CSV. */
export type Cella = string | number | boolean | Date | null | undefined

/** Las claves del contrato de una fila (las que lee `importacio_normalitza_fila()`). */
export type ClauContracte =
  | 'rols' | 'nom_comercial' | 'razon_social' | 'nif' | 'tipus_empresa' | 'tipus_activitat'
  | 'persona_contacte' | 'email' | 'email2' | 'telefon' | 'telefon2' | 'direccion' | 'codigo_postal'
  | 'municipi' | 'municipio_ine' | 'area_geografica' | 'tipo_receptor' | 'modalitats_interes' | 'airtable_id'
  | 'redestina_id' | 'data_alta' | 'naturalesa'
/** Columnas sin sitio en la ficha: van a la nota como «Etiqueta: valor». */
export type ClauNota =
  | 'carrec' | 'entitat' | 'registre_excedent' | 'web' | 'treballadors' | 'observacions'
  | 'responsable' | 'contacte_principal' | 'conveni_data' | 'conveni_signant'
/** «Tipo de entidad» de Airtable: no es la forma jurídica ni el papel, pero lo insinúa. */
export type ClauPista = 'tipus_entitat'
export type ClauColumna = ClauContracte | ClauNota | ClauPista

/** Una fila del contrato, tal como se manda a las dos RPC. */
export interface FilaContracte {
  fila: number
  rols: Paper[]
  nom_comercial: string | null
  razon_social?: string
  nif?: string
  tipus_empresa?: string
  tipus_activitat?: string[]
  persona_contacte?: string
  email?: string
  email2?: string
  telefon?: string
  telefon2?: string
  direccion?: string
  codigo_postal?: string
  municipi?: string
  municipio_ine?: string
  area_geografica?: string
  tipo_receptor?: string
  modalitats_interes?: string[]
  airtable_id?: string
  /** «ID Redestina» (B4): el `organizacion_id` que da la exportación; identifica antes que el NIF. */
  redestina_id?: string
  /** «Data d'alta a l'organització» (B4): `AAAA-MM-DD`, `D/M/AAAA` o solo el año (la base valida). */
  data_alta?: string
  /** «Naturalesa» (A5): `entitat_social` o `empresa`; importada, queda CONFIRMADA (la base decide). */
  naturalesa?: string
  nota?: string
  decisio?: string
}

export type Llista = 'rol' | 'tipo_receptor' | 'tipus_empresa' | 'tipus_activitat' | 'modalitats' | 'comarca' | 'municipi' | 'naturalesa'

export interface ColumnaPlantilla {
  clau: ClauColumna
  /** La cabecera de la plantilla, en catalán (es contrato del fichero: no se traduce). */
  capcalera: string
  /** Otras cabeceras que significan lo mismo (castellano, Airtable, ARA…). */
  alias: readonly string[]
  /** Sin ella no se puede importar el fichero. */
  obligatoria: boolean
  /** Sale en la plantilla descargable (las de Airtable que no aportan, no). */
  plantilla: boolean
  /** Admite varias columnas (dos «Telèfon», dos «Cargo»…): se juntan. */
  multiple: boolean
  /** Formato texto en la plantilla, para que Excel no se coma los ceros ni la letra. */
  text?: boolean
  /** La lista de valores admitidos (hoja «Llistes»). */
  llista?: Llista
  /** Un valor de ejemplo para la fila «EXEMPLE». */
  exemple: string
  /** El campo de la ficha (`campsFitxa`) del que salen las etiquetas que también se aceptan. */
  campFitxa?: string
  /** Solo las de nota: la etiqueta de la línea «Etiqueta: valor» (catalán: va a la base). */
  etiquetaNota?: string
}

/** El texto que marca la fila de ejemplo de la plantilla; el lector la salta. */
export const MARCA_EXEMPLE = 'EXEMPLE — esborra aquesta fila'

/** Tamaño máximo del fichero (el navegador lo lee entero) y filas por lote (tope de la RPC). */
export const MAX_BYTES = 5 * 1024 * 1024
export const MAX_FILES = 1000

// ---------------------------------------------------------------------------
// Las columnas
// ---------------------------------------------------------------------------

export const COLUMNES_PLANTILLA: readonly ColumnaPlantilla[] = [
  { clau: 'rols', capcalera: 'Rol', alias: ['Rols', 'Paper', 'Papers', 'Papel', 'Papeles', 'Rol a Redestina'],
    obligatoria: false, plantilla: true, multiple: false, llista: 'rol', exemple: 'Tots dos' },
  { clau: 'nom_comercial', capcalera: 'Nom comercial', alias: ['Nombre comercial', 'Nom', 'Nombre', 'Empresa'],
    obligatoria: true, plantilla: true, multiple: false, campFitxa: 'nom_comercial', exemple: 'Cal Exemple' },
  { clau: 'razon_social', capcalera: 'Raó social', alias: ['Razón social', 'Nombre fiscal', 'Nom fiscal', 'Rao social'],
    obligatoria: false, plantilla: true, multiple: false, campFitxa: 'razon_social', exemple: 'Cal Exemple, SL' },
  { clau: 'nif', capcalera: 'NIF', alias: ['CIF', 'NIF/CIF', 'CIF/NIF', 'DNI', 'NIE'],
    obligatoria: false, plantilla: true, multiple: false, text: true, campFitxa: 'nif', exemple: 'B00000000' },
  { clau: 'tipus_empresa', capcalera: 'Forma jurídica', alias: ['Forma juridica', 'Tipo empresa', 'Tipus empresa', 'Tipo de empresa'],
    obligatoria: false, plantilla: true, multiple: false, llista: 'tipus_empresa', campFitxa: 'tipus_empresa', exemple: 'SL' },
  { clau: 'tipo_receptor', capcalera: 'Tipus de receptor', alias: ['Tipo de receptor', 'Tipus receptor', 'Tipo receptor'],
    obligatoria: false, plantilla: true, multiple: false, llista: 'tipo_receptor', campFitxa: 'tipo_receptor', exemple: 'Entitat social' },
  { clau: 'tipus_activitat', capcalera: "Tipus d'activitat", alias: ['Tipo de actividad', 'Actividad', 'Activitat', 'Actividades', 'Activitats'],
    obligatoria: false, plantilla: true, multiple: false, llista: 'tipus_activitat', campFitxa: 'tipus_activitat', exemple: 'Productor agrícola' },
  { clau: 'modalitats_interes', capcalera: "Modalitats d'interès", alias: ['Modalidades de interés', 'Modalitats', 'Modalidades'],
    obligatoria: false, plantilla: true, multiple: false, llista: 'modalitats', campFitxa: 'modalitats_interes', exemple: 'Donació' },
  { clau: 'persona_contacte', capcalera: 'Persona de contacte', alias: ['Persona de contacto', 'Contacte', 'Contacto', 'Contactes'],
    obligatoria: false, plantilla: true, multiple: false, campFitxa: 'persona_contacte', exemple: 'Anna Exemple' },
  { clau: 'carrec', capcalera: 'Càrrec', alias: ['Cargo', 'Cargo (contacto)', 'Càrrec (contacte)', 'Carrec'],
    obligatoria: false, plantilla: true, multiple: true, etiquetaNota: 'Càrrec', exemple: 'Gerent' },
  { clau: 'email', capcalera: 'Correu', alias: ['Correo', 'Correo (contacto)', 'Correu (contacte)', 'Correu electrònic', 'Correo electrónico', 'Email', 'E-mail', 'Mail'],
    obligatoria: false, plantilla: true, multiple: true, campFitxa: 'email', exemple: 'anna@exemple.invalid' },
  { clau: 'email2', capcalera: 'Correu secundari', alias: ['Correo secundario', 'Email general', 'Correu general', 'Correo general', 'Mail 2', 'Email 2'],
    obligatoria: false, plantilla: true, multiple: true, campFitxa: 'email2', exemple: '' },
  { clau: 'telefon', capcalera: 'Mòbil (WhatsApp)', alias: ['Móvil (WhatsApp)', 'Mòbil', 'Móvil', 'Movil', 'Movils', 'Telèfon', 'Teléfono', 'Telefon', 'Telefono', 'Teléfono móvil'],
    obligatoria: false, plantilla: true, multiple: true, text: true, campFitxa: 'telefon', exemple: '600000000' },
  { clau: 'telefon2', capcalera: 'Telèfon fix', alias: ['Teléfono fijo', 'Número fijo', 'Numero fijo', 'Fix', 'Fijo', 'Telèfon 2', 'Teléfono 2', 'Otro teléfono'],
    obligatoria: false, plantilla: true, multiple: true, text: true, campFitxa: 'telefon2', exemple: '930000000' },
  { clau: 'direccion', capcalera: 'Adreça', alias: ['Dirección', 'Dirección fiscal', 'Adreça fiscal', 'Domicilio', 'Adreca'],
    obligatoria: false, plantilla: true, multiple: false, campFitxa: 'direccion', exemple: 'Carrer Major, 1' },
  { clau: 'codigo_postal', capcalera: 'Codi postal', alias: ['Código postal', 'C.P.', 'CP'],
    obligatoria: false, plantilla: true, multiple: false, text: true, campFitxa: 'codigo_postal', exemple: '08380' },
  { clau: 'municipi', capcalera: 'Municipi', alias: ['Municipio', 'Població', 'Población', 'Poblacio', 'Localitat', 'Localidad'],
    obligatoria: false, plantilla: true, multiple: false, llista: 'municipi', campFitxa: 'municipio_ine', exemple: 'Malgrat de Mar' },
  { clau: 'municipio_ine', capcalera: 'Codi INE', alias: ['Código INE', 'INE', 'Codi INE del municipi'],
    obligatoria: false, plantilla: false, multiple: false, text: true, exemple: '' },
  { clau: 'area_geografica', capcalera: 'Comarca', alias: ['Área (intern)', 'Àrea (intern)', 'Àrea geogràfica', 'Área geográfica', 'Area geografica', 'Àrea'],
    obligatoria: false, plantilla: true, multiple: false, llista: 'comarca', campFitxa: 'area_geografica', exemple: 'Maresme' },
  { clau: 'airtable_id', capcalera: 'ID Airtable', alias: ['Airtable ID', 'Airtable', 'Record ID', 'ID del registre'],
    obligatoria: false, plantilla: true, multiple: false, text: true, exemple: '' },
  { clau: 'registre_excedent', capcalera: "Registre d'excedents", alias: ['Registro excedente', 'Registro de excedentes', 'Registre excedent'],
    obligatoria: false, plantilla: false, multiple: true, etiquetaNota: "Registre d'excedents (origen)", exemple: '' },
  { clau: 'tipus_entitat', capcalera: "Tipus d'entitat (origen)", alias: ['Tipo de entidad', "Tipus d'entitat"],
    obligatoria: false, plantilla: false, multiple: false, exemple: '' },
  { clau: 'entitat', capcalera: 'Entitat', alias: ['Entidad'],
    obligatoria: false, plantilla: false, multiple: false, etiquetaNota: 'Entitat', exemple: '' },
  { clau: 'web', capcalera: 'Web', alias: ['Pàgina web', 'Página web', 'Lloc web', 'Sitio web'],
    obligatoria: false, plantilla: true, multiple: false, etiquetaNota: 'Web', exemple: 'https://exemple.invalid' },
  { clau: 'treballadors', capcalera: 'Nombre de treballadors', alias: ['Número de trabajadores', 'Numero de trabajadores', 'Treballadors', 'Trabajadores', 'Treballador/es', 'Personal contractat'],
    obligatoria: false, plantilla: true, multiple: false, etiquetaNota: 'Nombre de treballadors', exemple: '' },
  { clau: 'responsable', capcalera: 'Responsable intern', alias: ['Responsable interno', 'Responsable'],
    obligatoria: false, plantilla: true, multiple: false, etiquetaNota: 'Responsable intern', exemple: '' },
  { clau: 'contacte_principal', capcalera: 'Contacte principal', alias: ['Contacto principal'],
    obligatoria: false, plantilla: false, multiple: false, etiquetaNota: 'Contacte principal', exemple: '' },
  { clau: 'conveni_data', capcalera: 'Conveni signat (data)', alias: ['Convenio firmado (fecha)', 'Conveni signat', 'Convenio firmado', 'Data del conveni', 'Fecha del convenio'],
    obligatoria: false, plantilla: true, multiple: false, etiquetaNota: 'Conveni signat (data)', exemple: '' },
  { clau: 'conveni_signant', capcalera: 'Signant del conveni', alias: ['Firmante del convenio', 'Signant', 'Firmante'],
    obligatoria: false, plantilla: true, multiple: false, etiquetaNota: 'Signant del conveni', exemple: '' },
  { clau: 'observacions', capcalera: 'Observacions', alias: ['Observaciones', 'Comentari', 'Comentaris', 'Comentario', 'Comentarios', 'Notes', 'Nota', 'Notas'],
    obligatoria: false, plantilla: true, multiple: true, etiquetaNota: 'Observacions', exemple: MARCA_EXEMPLE },
  // B4 (10-11-2026, D11): las dos que la exportación de B3 ya ponía en Z y AA, ahora importables.
  // Van al final para no mover ninguna letra de la plantilla (los desplegables de B2). Sin
  // `campFitxa`: los alias ya cubren las etiquetas de la ficha en los dos idiomas.
  { clau: 'redestina_id', capcalera: 'ID Redestina', alias: ['Redestina ID', 'Id Redestina', 'ID de Redestina'],
    obligatoria: false, plantilla: true, multiple: false, text: true, exemple: '' },
  { clau: 'data_alta', capcalera: "Data d'alta a l'organització",
    alias: ["Data d'alta", 'Fecha de alta', 'Fecha de alta en la organización', 'Alta'],
    obligatoria: false, plantilla: true, multiple: false, text: true, exemple: '' },
  // A5 (10-11-2026): opcional y al final, por lo mismo (no mover letras). Lo que se importe queda
  // CONFIRMADO; vacía, la base sigue sugiriéndola por el NIF.
  { clau: 'naturalesa', capcalera: 'Naturalesa', alias: ['Naturaleza', 'Naturalesa jurídica', 'Naturaleza jurídica'],
    obligatoria: false, plantilla: true, multiple: false, llista: 'naturalesa', exemple: '' },
]

/**
 * Las columnas que la EXPORTACIÓN (Plan 2 B3, `lib/exportEntitats.ts`) añade detrás de las de la
 * plantilla: el estado CRM de cada papel. Son informativas y al reimportar se ignoran a propósito
 * (P9: el estado se cambia en la ficha). «ID Redestina» y «Data d'alta a l'organització», que B3
 * también ponía aquí, son desde B4 columnas de `COLUMNES_PLANTILLA`.
 */
export const CAPCALERES_EXPORTACIO = {
  estat_crm_productor: 'Estat CRM (ofertant)',
  estat_crm_entidad: 'Estat CRM (receptor)',
} as const

/** Cabeceras conocidas que se ignoran a propósito (no son una errata del fichero). */
const IGNORADES_A_PROPOSIT = [
  // «Contactos» de Airtable es una lista de registros enlazados, no una persona.
  'Contactos', 'Provincia', 'Província', 'Provincia (from Municipio)', 'Coord', 'Coord 2', 'Codi', 'Código',
  ...Object.values(CAPCALERES_EXPORTACIO),
]

/** Valores que en el Excel quieren decir «no hay dato». */
const VALORS_BUITS = new Set([
  'no disponible', 'no disponibles', 'no localizada', 'no localizado', 'no localitzada', 'no localitzat',
  'n/a', 'n/d', 'na', 'nd', '-', '--', '---', '—', '–', '?', '??', '???', '.', 'x',
  'sin datos', 'sense dades', 'desconocido', 'desconegut', 'ninguno', 'cap', 'null', 'none',
])

/** La cabecera como se compara: la de `normalitzaImport` y los apóstrofos unificados. */
export function clauCapcalera(h: string): string {
  return normalitzaCapcalera(h).replace(/[’‘`´]/g, "'")
}

function campFitxaLabel(clau: string | undefined): string | null {
  if (!clau) return null
  const c = CAMPS_FITXA.find((x) => x.clau === clau)
  if (!c) throw new Error(`importEntitats: campFitxa desconegut «${clau}»`)
  return c.labelKey
}

/** Cabecera normalizada → columna. Se construye una vez. */
let indexCapcaleres: Map<string, ClauColumna> | null = null
function index(): Map<string, ClauColumna> {
  if (indexCapcaleres) return indexCapcaleres
  const m = new Map<string, ClauColumna>()
  // Primero las cabeceras y los alias explícitos (mandan); luego las etiquetas de la ficha.
  for (const c of COLUMNES_PLANTILLA) {
    for (const h of [c.capcalera, ...c.alias]) {
      const k = clauCapcalera(h)
      if (m.has(k) && m.get(k) !== c.clau) throw new Error(`importEntitats: capçalera repetida «${h}»`)
      m.set(k, c.clau)
    }
  }
  for (const c of COLUMNES_PLANTILLA) {
    const label = campFitxaLabel(c.campFitxa)
    if (!label) continue
    for (const d of [DICTS.ca, DICTS.es]) {
      const k = clauCapcalera(d[label] ?? '')
      if (k && !m.has(k)) m.set(k, c.clau)
    }
  }
  indexCapcaleres = m
  return m
}

const IGNORADES = new Set(IGNORADES_A_PROPOSIT.map(clauCapcalera))
const COLUMNA = new Map(COLUMNES_PLANTILLA.map((c) => [c.clau, c]))
export const columnaDe = (clau: ClauColumna): ColumnaPlantilla => COLUMNA.get(clau)!

// ---------------------------------------------------------------------------
// Celdas
// ---------------------------------------------------------------------------

/** Una celda como texto limpio; vacía o «No disponible» → null. */
export function valorText(c: Cella): string | null {
  if (c === null || c === undefined) return null
  let s: string
  if (c instanceof Date) s = Number.isNaN(c.getTime()) ? '' : c.toISOString().slice(0, 10)
  else if (typeof c === 'number') s = Number.isFinite(c) ? String(c) : ''
  else if (typeof c === 'boolean') s = c ? 'sí' : 'no'
  else s = String(c)
  s = s.replace(/ /g, ' ').trim()
  if (s === '') return null
  return VALORS_BUITS.has(senseAccents(s).toLowerCase().replace(/\s+/g, ' ')) ? null : s
}

/** El código postal con sus cinco cifras: 8380 (número) o «8380» → «08380». */
export function valorCp(c: Cella): string | null {
  if (typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < 100000) return String(c).padStart(5, '0')
  const s = valorText(c)
  if (s === null) return null
  if (/^\d{4,5}$/.test(s)) return s.padStart(5, '0')
  const m = s.match(/(?:^|\D)(\d{5})(?:\D|$)/)
  return m ? m[1] : s
}

/** El día 0 de los seriales de Excel (30-12-1899), en milisegundos UTC. */
const EPOCH_EXCEL = Date.UTC(1899, 11, 30)

/**
 * «Data d'alta a l'organització» (B4): una fecha de Excel → `AAAA-MM-DD` (UTC, como `valorText`);
 * un entero entre 1900 y 2100 es un AÑO («2021», no un serial); un entero ≥ 20000 es un serial de
 * Excel (una fecha guardada sin formato); el texto pasa tal cual: la base lo valida y avisa.
 */
export function valorData(c: Cella): string | null {
  if (c instanceof Date) return valorText(c)
  if (typeof c === 'number' && Number.isInteger(c)) {
    if (c >= 1900 && c <= 2100) return String(c)
    if (c >= 20000 && c < 2958466) return new Date(EPOCH_EXCEL + c * 86_400_000).toISOString().slice(0, 10)
  }
  return valorText(c)
}

// ---------------------------------------------------------------------------
// Cabeceras
// ---------------------------------------------------------------------------

export interface ColumnaReconeguda { index: number; capcalera: string; clau: ClauColumna; ocurrencia: number }
export interface ColumnaIgnorada { index: number; capcalera: string; motiu: 'desconeguda' | 'a_proposit' | 'repetida' }
export interface MapaCapcaleres {
  reconegudes: ColumnaReconeguda[]
  ignorades: ColumnaIgnorada[]
  /** Las obligatorias que no aparecen. */
  falten: ClauColumna[]
}

/**
 * Qué columna es cada cabecera. Una cabecera repetida cuenta por ocurrencia: dos «Cargo» o
 * dos «Telèfon» son dos columnas de lo mismo; las que admiten varias (`multiple`) se juntan, y
 * en las demás manda la primera (la segunda se ignora y se dice).
 */
export function mapaCapcaleres(capcaleres: readonly Cella[]): MapaCapcaleres {
  const idx = index()
  const reconegudes: ColumnaReconeguda[] = []
  const ignorades: ColumnaIgnorada[] = []
  const vistes = new Map<ClauColumna, number>()
  capcaleres.forEach((c, i) => {
    const text = c === null || c === undefined ? '' : String(c).replace(/ /g, ' ').trim()
    if (text === '') return
    const k = clauCapcalera(text)
    const clau = idx.get(k)
    if (!clau) {
      ignorades.push({ index: i, capcalera: text, motiu: IGNORADES.has(k) ? 'a_proposit' : 'desconeguda' })
      return
    }
    const oc = vistes.get(clau) ?? 0
    if (oc > 0 && !columnaDe(clau).multiple) {
      ignorades.push({ index: i, capcalera: text, motiu: 'repetida' })
      return
    }
    vistes.set(clau, oc + 1)
    reconegudes.push({ index: i, capcalera: text, clau, ocurrencia: oc })
  })
  const falten = COLUMNES_PLANTILLA.filter((c) => c.obligatoria && !vistes.has(c.clau)).map((c) => c.clau)
  return { reconegudes, ignorades, falten }
}

/** ¿Fila sin nada escrito? */
const filaBuida = (f: readonly Cella[]) => f.every((c) => valorText(c) === null)

/**
 * La fila de las cabeceras: la primera (de las 20 de arriba) donde se reconoce el nombre
 * comercial; si ninguna, la que más columnas reconoce; si tampoco, la primera con algo. Así se
 * toleran filas de título encima de la tabla.
 */
export function localitzaCapcalera(files: readonly (readonly Cella[])[]): number {
  let millor = -1
  let millorN = 0
  for (let i = 0; i < Math.min(files.length, 20); i++) {
    if (filaBuida(files[i])) continue
    const m = mapaCapcaleres(files[i])
    if (m.falten.length === 0) return i
    if (m.reconegudes.length > millorN) { millor = i; millorN = m.reconegudes.length }
  }
  if (millor >= 0 && millorN >= 2) return millor
  return Math.max(0, files.findIndex((f) => !filaBuida(f)))
}

export interface FullaLlegida {
  /** Índice (0) de la fila de cabeceras. */
  filaCapcalera: number
  mapa: MapaCapcaleres
  /** Las filas con datos, con su número de fila del Excel (1 = la primera). */
  files: { numero: number; celles: Cella[] }[]
  /** Filas que se saltan por ser la de ejemplo de la plantilla. */
  exemples: number
}

/** ¿Es la fila «EXEMPLE» de la plantilla? */
export function esExemple(f: readonly Cella[]): boolean {
  return f.some((c) => typeof c === 'string' && /^\s*exemple\s*[—–-]/i.test(c))
}

/** Lee una hoja: cabeceras, mapa y filas con datos en alguna columna reconocida. */
export function llegeixFulla(files: readonly (readonly Cella[])[]): FullaLlegida {
  const filaCapcalera = localitzaCapcalera(files)
  const mapa = mapaCapcaleres(files[filaCapcalera] ?? [])
  const cols = mapa.reconegudes.map((r) => r.index)
  const out: FullaLlegida['files'] = []
  let exemples = 0
  for (let i = filaCapcalera + 1; i < files.length; i++) {
    const f = files[i] ?? []
    // Una fila con algo solo en columnas sin cabecera reconocida (las cabeceras sueltas de
    // la fila 11 del Excel de Airtable, por ejemplo) no es una fila de datos.
    if (cols.every((c) => valorText(f[c]) === null)) continue
    if (esExemple(f)) { exemples++; continue }
    out.push({ numero: i + 1, celles: [...f] })
  }
  return { filaCapcalera, mapa, files: out, exemples }
}

/** Un CSV del Excel en español (`;`) o internacional (`,`), con o sin BOM. */
export function llegeixCsv(text: string): Cella[][] {
  const net = text.replace(/^﻿/, '')
  const primera = net.split(/\r?\n/, 1)[0] ?? ''
  const sep = (primera.match(/;/g)?.length ?? 0) >= (primera.match(/,/g)?.length ?? 0) ? ';' : ','
  return parseCsv(net, sep)
}

// ---------------------------------------------------------------------------
// Listas cerradas
// ---------------------------------------------------------------------------

const n = (s: string) => normalitzaNom(s).toLowerCase()

/** Los papeles escritos en la columna «Rol» (o en castellano, o como código). */
export function rolsDeText(text: string | null): Paper[] | null {
  if (!text) return null
  const t = n(text)
  if (/\b(tots dos|ambdos|ambos|los dos|totes dues|les dues|las dos)\b/.test(t)) return ['productor', 'entidad']
  const trossos = t.split(/\s*(?:,|;|\/|\+|\bi\b|\by\b|&)\s*/).filter(Boolean)
  const out = new Set<Paper>()
  for (const p of trossos.length ? trossos : [t]) {
    if (/^(ofertant|ofertante|productor|productora|donant|donante|generador|generadora)/.test(p)) out.add('productor')
    else if (/^(receptor|receptora|entitat receptora|entidad receptora|entidad|entitat)/.test(p)) out.add('entidad')
  }
  return out.size ? (['productor', 'entidad'] as Paper[]).filter((x) => out.has(x)) : null
}

/** Las opciones de `tipo_receptor`, de la ficha (`campsFitxa`). */
export const TIPUS_RECEPTOR: readonly string[] = CAMPS_FITXA.find((c) => c.clau === 'tipo_receptor')?.opcions ?? []

function perEtiqueta(text: string, codis: readonly string[], prefix: string): string | null {
  const t = n(text)
  for (const c of codis) {
    if (n(c) === t) return c
    for (const d of [DICTS.ca, DICTS.es]) if (d[`${prefix}${c}`] && n(d[`${prefix}${c}`]) === t) return c
  }
  return null
}

/** El tipo de receptor: código o etiqueta (ca/es); si no casa, el texto (la base avisa). */
export function tipusReceptorDe(text: string | null): string | null {
  if (!text) return null
  return perEtiqueta(text, TIPUS_RECEPTOR, 'org.tr_') ?? text.toLowerCase()
}

/**
 * La forma jurídica → `tipus_empresa` (`TIPUS_EMPRESA`). Lo que no se reconoce va a `altres`
 * con el texto original en la nota.
 */
export function tipusEmpresaDe(text: string | null): { codi: string | null; aNota: boolean } {
  if (!text) return { codi: null, aNota: false }
  const exacte = perEtiqueta(text, TIPUS_EMPRESA, 'org.te_')
  if (exacte) return { codi: exacte, aNota: false }
  const t = ` ${n(text)} `
  if (/ (autonom|autonoma|autonomo|persona fisica|empresari individual|empresario individual) /.test(t)) return { codi: 'autonom', aNota: false }
  // SAT antes que SA («s a t» contiene «s a») y la cooperativa antes que la sociedad civil
  // («s c c l» contiene «s c»).
  if (/ (sat|s a t|societat agraria de transformacio|sociedad agraria de transformacion) /.test(t)) return { codi: 'sat', aNota: false }
  if (/ (societat limitada|sociedad limitada|s l|sl|slu|s l u|slp|s l p|slne) /.test(t)) return { codi: 'sl', aNota: false }
  if (/ (societat anonima|sociedad anonima|s a|sa|sau|s a u) /.test(t)) return { codi: 'sa', aNota: false }
  if (/ (cooperativa|sccl|s c c l|s coop|scoop) /.test(t)) return { codi: 'cooperativa', aNota: false }
  if (/ (comunitat de bens|comunidad de bienes|cb|c b) /.test(t)) return { codi: 'cb', aNota: false }
  if (/ (societat civil|sociedad civil|sc|s c|scp|s c p) /.test(t)) return { codi: 'sc', aNota: false }
  if (/ (fundacio|fundacion) /.test(t)) return { codi: 'fundacio', aNota: false }
  if (/ (associacio|asociacion) /.test(t)) return { codi: 'associacio', aNota: false }
  return { codi: 'altres', aNota: true }
}

/** Las modalidades (código o etiqueta, ca/es; «totes» = las tres). Lo desconocido pasa tal cual. */
export function modalitatsDeText(text: string | null): string[] {
  if (!text) return []
  const out: string[] = []
  for (const tros of text.split(/[,;/\n]|\s+i\s+|\s+y\s+/).map((x) => x.trim()).filter(Boolean)) {
    const t = n(tros)
    let codi: string | null = null
    if (/^(totes|todas|totes les modalitats|todas las modalidades)$/.test(t)) { out.push(...MODALITATS_IDS); continue }
    if (/^donaci/.test(t)) codi = 'donacio'
    else if (/^(venda|venta)/.test(t)) codi = 'venda'
    else if (/^maquila/.test(t)) codi = 'maquila'
    out.push(codi ?? tros.toLowerCase())
  }
  return [...new Set(out)]
}

/** `aplica`: productor · entidad · ambdos (si falta, vale para los dos papeles). */
export interface ActivitatCataleg { codi: string; nom_ca: string; nom_es: string; aplica?: string | null }

/** ¿La actividad vale para alguno de los papeles de la fila? Sin papel todavía, sí. */
function activitatAplica(a: ActivitatCataleg, rols: readonly Paper[]): boolean {
  if (rols.length === 0 || !a.aplica || a.aplica === 'ambdos') return true
  return rols.includes(a.aplica as Paper)
}

/** Las actividades que casan con el catálogo (código o nombre ca/es) y el resto, para la nota. */
export function activitatsDe(
  text: string | null, cataleg: readonly ActivitatCataleg[], rols: readonly Paper[] = [],
): { codis: string[]; resta: string[] } {
  if (!text) return { codis: [], resta: [] }
  const codis: string[] = []
  const resta: string[] = []
  for (const tros of text.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const t = n(tros)
    // Solo las del papel de la fila: «Explotación agrícola» es del catálogo de receptores y, en un
    // ofertant, la base la descartaría con aviso; mejor que vaya a la nota con su texto.
    const a = cataleg.find((c) => activitatAplica(c, rols) && (n(c.codi) === t || n(c.nom_ca) === t || n(c.nom_es) === t))
    if (a) { if (!codis.includes(a.codi)) codis.push(a.codi) } else resta.push(tros)
  }
  return { codis, resta }
}

// ---------------------------------------------------------------------------
// Teléfonos y correos
// ---------------------------------------------------------------------------

/**
 * Los teléfonos de una celda («937620135 / 629381497», «93 762 01 35 (Joan)»): cada trozo con
 * `normalitzaTelefon()` (E.164 sin «+»); lo que no se deja, por `extraerTelefonos()`; lo que
 * tampoco, a `noReconeguts`.
 */
export function telefonsDe(text: string | null): { telefons: string[]; noReconeguts: string[] } {
  if (!text) return { telefons: [], noReconeguts: [] }
  const telefons: string[] = []
  const noReconeguts: string[] = []
  for (const tros of text.split(/\s*(?:[/,;|\n]|\s-\s|\s+o\s+|\s+y\s+|\s+i\s+)\s*/).map((x) => x.trim()).filter(Boolean)) {
    const net = normalitzaTelefon(tros)
    if (net && errorTelefon(tros) === null && /^[\d\s.+()-]+$/.test(tros)) { telefons.push(net); continue }
    const extrets = extraerTelefonos(tros)
    if (extrets.length) telefons.push(...extrets)
    else if (/\d/.test(tros)) noReconeguts.push(tros)
  }
  return { telefons: [...new Set(telefons)], noReconeguts }
}

// ---------------------------------------------------------------------------
// Una fila
// ---------------------------------------------------------------------------

export type OrigenRols = 'columna' | 'deduit' | 'cap'

/** Avisos que pone el navegador (los demás los da la base): `ie.al_<codi>`. */
export type AvisLocal =
  | 'telefons_a_nota' | 'telefon_no_reconegut' | 'correus_a_nota' | 'correu_no_reconegut'
  | 'forma_juridica_a_nota' | 'activitat_a_nota' | 'rol_desconegut' | 'nom_de_rao'

export interface FilaNormalitzada {
  /** Número de fila del Excel. */
  fila: number
  /** El contrato, sin los papeles (los decide la revisión) ni la decisión. */
  contracte: Omit<FilaContracte, 'rols' | 'decisio'>
  rols: Paper[]
  origenRols: OrigenRols
  nom: string | null
  nif: string | null
  avisosLocals: AvisLocal[]
  /** «Conveni signat (data)» y «Signant del conveni», solo informativos. */
  conveni: { data: string | null; signant: string | null } | null
}

export interface ContextFila {
  activitats: readonly ActivitatCataleg[]
}

/**
 * Los papeles: la columna «Rol» si la hay y dice algo; si no, se deducen: «Entidad social» →
 * receptor; «Productor individual» o un «Registro excedente» → ofertant; un tipo de receptor →
 * receptor. Si nada lo dice, ninguno: la revisión obliga a elegirlo.
 */
export function proposaRols(valors: {
  rol?: string | null; tipusEntitat?: string | null; registreExcedent?: string | null; tipoReceptor?: string | null
}): { rols: Paper[]; origen: OrigenRols } {
  const explicit = rolsDeText(valors.rol ?? null)
  if (explicit) return { rols: explicit, origen: 'columna' }
  const out = new Set<Paper>()
  const te = n(valors.tipusEntitat ?? '')
  if (/\bsocial\b/.test(te)) out.add('entidad')
  if (/\bproductor/.test(te)) out.add('productor')
  if (valors.registreExcedent) out.add('productor')
  if (valors.tipoReceptor) out.add('entidad')
  const rols = (['productor', 'entidad'] as Paper[]).filter((x) => out.has(x))
  return { rols, origen: rols.length ? 'deduit' : 'cap' }
}

/** Una fila de la hoja en el contrato. */
export function normalitzaFila(fila: number, celles: readonly Cella[], mapa: MapaCapcaleres, ctx: ContextFila): FilaNormalitzada {
  const valors = (clau: ClauColumna): string[] => mapa.reconegudes
    .filter((r) => r.clau === clau).map((r) => valorText(celles[r.index])).filter((v): v is string => v !== null)
  const primer = (clau: ClauColumna) => valors(clau)[0] ?? null
  const crua = (clau: ClauColumna): Cella => {
    const r = mapa.reconegudes.find((x) => x.clau === clau)
    return r ? celles[r.index] : null
  }

  const avisos = new Set<AvisLocal>()
  const linies: string[] = []
  const linia = (etiqueta: string, v: string | null) => {
    if (v && !linies.includes(`${etiqueta}: ${v}`)) linies.push(`${etiqueta}: ${v}`)
  }

  // Nombre: el comercial; si falta, el de «Entidad» o la razón social.
  const nomComercial = primer('nom_comercial')
  const entitat = primer('entitat')
  const rao = primer('razon_social')
  const nom = nomComercial ?? entitat ?? rao
  if (!nomComercial && nom) avisos.add('nom_de_rao')

  // Papeles y tipo de receptor (una «Entidad social» de Airtable es una receptora social).
  const tipusEntitat = primer('tipus_entitat')
  let tipoReceptor = tipusReceptorDe(primer('tipo_receptor'))
  if (!tipoReceptor && /\bsocial\b/.test(n(tipusEntitat ?? ''))) tipoReceptor = 'social'
  const registre = valors('registre_excedent').join(', ') || null
  const rolText = primer('rols')
  const { rols, origen } = proposaRols({ rol: rolText, tipusEntitat, registreExcedent: registre, tipoReceptor: primer('tipo_receptor') })
  if (rolText && origen !== 'columna') avisos.add('rol_desconegut')
  if (tipusEntitat && !/\b(social|productor)/.test(n(tipusEntitat))) linia("Tipus d'entitat (origen)", tipusEntitat)

  // Correos: todos los de las columnas de correo, en orden; el 1.º y el 2.º a su sitio.
  const correus: string[] = []
  for (const clau of ['email', 'email2'] as const) {
    for (const v of valors(clau)) {
      const cs = extraerCorreos(v).map((c) => c.toLowerCase())
      if (cs.length === 0) { avisos.add('correu_no_reconegut'); linia('Correu no reconegut', v) }
      for (const c of cs) if (!correus.includes(c)) correus.push(c)
    }
  }
  if (correus.length > 2) { avisos.add('correus_a_nota'); linia('Altres correus', correus.slice(2).join(', ')) }

  // Teléfonos: igual, el móvil primero.
  const telefons: string[] = []
  for (const clau of ['telefon', 'telefon2'] as const) {
    for (const v of valors(clau)) {
      const { telefons: ts, noReconeguts } = telefonsDe(v)
      for (const tl of ts) if (!telefons.includes(tl)) telefons.push(tl)
      if (noReconeguts.length) { avisos.add('telefon_no_reconegut'); linia('Telèfon no reconegut', noReconeguts.join(' | ')) }
    }
  }
  // El móvil delante (es el que sirve para WhatsApp): «937620135 / 629381497» → 629…, 937….
  // Orden estable: entre móviles, o entre fijos, se respeta el del fichero.
  const esMobil = (tl: string) => /^34[67]\d{8}$/.test(tl)
  telefons.sort((a, b) => Number(esMobil(b)) - Number(esMobil(a)))
  if (telefons.length > 2) { avisos.add('telefons_a_nota'); linia('Altres telèfons', telefons.slice(2).join(' / ')) }

  // Forma jurídica.
  const formaText = primer('tipus_empresa')
  const forma = tipusEmpresaDe(formaText)
  if (forma.aNota) { avisos.add('forma_juridica_a_nota'); linia('Forma jurídica', formaText) }

  // Actividad: lo que casa con el catálogo, a la ficha; el resto, a la nota.
  const act = activitatsDe(valors('tipus_activitat').join(', ') || null, ctx.activitats, rols)
  if (act.resta.length) { avisos.add('activitat_a_nota'); linia('Activitat', act.resta.join(', ')) }

  // Lo que no tiene columna en la ficha.
  if (entitat && nomComercial && normalitzaNom(entitat) !== normalitzaNom(nomComercial)) linia('Entitat', entitat)
  for (const c of COLUMNES_PLANTILLA) {
    if (!c.etiquetaNota || c.clau === 'entitat') continue
    for (const v of valors(c.clau)) {
      if (c.clau === 'observacions' && v === MARCA_EXEMPLE) continue
      linia(c.etiquetaNota, v)
    }
  }

  const cp = valorCp(crua('codigo_postal'))
  const nif = primer('nif')
  const nifNet = nif ? netejaNif(nif) : null
  const conveniData = primer('conveni_data')
  const conveniSignant = primer('conveni_signant')

  const contracte: FilaNormalitzada['contracte'] = { fila, nom_comercial: nom }
  const posa = <K extends keyof FilaNormalitzada['contracte']>(k: K, v: FilaNormalitzada['contracte'][K] | null | undefined) => {
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0) || v === '') return
    contracte[k] = v
  }
  posa('razon_social', rao)
  posa('nif', nifNet)
  posa('tipus_empresa', forma.codi)
  posa('tipus_activitat', act.codis)
  posa('persona_contacte', primer('persona_contacte'))
  posa('email', correus[0])
  posa('email2', correus[1])
  posa('telefon', telefons[0])
  posa('telefon2', telefons[1])
  posa('direccion', primer('direccion'))
  posa('codigo_postal', cp)
  posa('municipi', primer('municipi'))
  posa('municipio_ine', primer('municipio_ine'))
  posa('area_geografica', primer('area_geografica'))
  posa('tipo_receptor', tipoReceptor)
  posa('modalitats_interes', modalitatsDeText(primer('modalitats_interes')))
  posa('airtable_id', primer('airtable_id'))
  posa('redestina_id', primer('redestina_id')?.toLowerCase())
  posa('data_alta', valorData(crua('data_alta')))
  // El código si casa (ca/es); si no, el texto tal cual, para que la base lo marque (`naturalesa_desconeguda`).
  { const nt = primer('naturalesa'); posa('naturalesa', naturalesaDeText(nt) ?? nt) }
  posa('nota', linies.join('\n'))

  return {
    fila,
    contracte,
    rols,
    origenRols: origen,
    nom,
    nif: nifNet,
    avisosLocals: [...avisos],
    conveni: conveniData || conveniSignant ? { data: conveniData, signant: conveniSignant } : null,
  }
}

/** Todas las filas de una hoja ya leída. */
export function normalitzaFulla(fulla: FullaLlegida, ctx: ContextFila): FilaNormalitzada[] {
  return fulla.files.map((f) => normalitzaFila(f.numero, f.celles, fulla.mapa, ctx))
}

// ---------------------------------------------------------------------------
// Lo que se manda
// ---------------------------------------------------------------------------

/** Las filas que no tienen ningún papel (con los elegidos en la revisión). */
export function filesSensePaper(files: readonly FilaNormalitzada[], rols: Readonly<Record<number, Paper[]>>): number[] {
  return files.filter((f) => (rols[f.fila] ?? f.rols).length === 0).map((f) => f.fila)
}

/**
 * El lote para las RPC: cada fila con sus papeles (los elegidos en la revisión o los
 * propuestos) y, si se decidió, la decisión de una fila dudosa (`crear`, `ometre` o el id de
 * la organización candidata).
 */
export function filesPerEnviar(
  files: readonly FilaNormalitzada[],
  rols: Readonly<Record<number, Paper[]>>,
  decisions: Readonly<Record<number, string>>,
): FilaContracte[] {
  return files.map((f) => {
    const out: FilaContracte = { ...f.contracte, rols: [...(rols[f.fila] ?? f.rols)] }
    const d = decisions[f.fila]
    if (d) out.decisio = d
    return out
  })
}

/** La huella del fichero (hex, 64), para saber si ya se importó. */
export async function sha256Hex(dades: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = dades instanceof Uint8Array ? dades : new Uint8Array(dades)
  const h = await crypto.subtle.digest('SHA-256', buf as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Lo que contesta la base
// ---------------------------------------------------------------------------

/**
 * Un aviso o error de la base («semblant_a_fila:4», «error_bd:23505:…») como clave i18n
 * (`ie.c_<codi>`) y su detalle (lo que va tras el primer «:»).
 */
export function clauCodi(codi: string): { clau: string; detall: string } {
  const i = codi.indexOf(':')
  const base = i < 0 ? codi : codi.slice(0, i)
  return { clau: `ie.c_${base}`, detall: i < 0 ? '' : codi.slice(i + 1) }
}

/** Los códigos que la base devuelve (avisos y errores de fila), para el test de i18n. */
export const CODIS_BASE = [
  'cal_paper', 'paper_desconegut', 'cal_nom_comercial', 'repetit_al_fitxer', 'decisio_no_candidata',
  'decisio_invalida', 'error_bd', 'sense_nif', 'nif_invalid', 'nif_diferent_germana', 'correu_invalid',
  'correu2_invalid', 'telefon_invalid', 'telefon2_invalid', 'correu_en_us', 'telefon_en_us', 'correu2_a_nota',
  'tipus_empresa_desconegut', 'tipus_activitat_desconegut', 'modalitat_desconeguda', 'sense_tipus_receptor',
  'tipus_receptor_desconegut', 'codi_postal_invalid', 'municipi_ine_desconegut', 'municipi_no_trobat',
  'area_desconeguda', 'area_no_coincideix', 'ref_externa_en_us', 'semblant_a_fila',
  // B4 (20270519100000): «ID Redestina» y «Data d'alta a l'organització».
  'id_redestina_invalid', 'id_redestina_inexistent', 'id_nif_contradictoris', 'data_alta_invalida', 'data_alta_nomes_any',
  // A5 (20270523100000).
  'naturalesa_desconeguda',
] as const

/** Los errores de lote (22023) de las dos RPC. */
export const ERRORS_LOT = ['dades_invalides', 'massa_files', 'fila_invalida', 'fila_repetida', 'sense_files'] as const

/**
 * La columna real de un campo escrito («omplira») («entidades.telefono2») → la clave del
 * contrato. Es el espejo de `importacio_camp()` de la migración.
 */
export function campDeColumna(columna: string): string {
  const c = columna.includes('.') ? columna.slice(columna.indexOf('.') + 1) : columna
  const mapa: Record<string, string> = {
    name: 'persona_contacte', contacto: 'persona_contacte', empresa: 'nom_comercial', nombre: 'nom_comercial',
    tipo_empresa: 'tipus_empresa', tipo_entidad: 'tipus_empresa', phone: 'telefon', telefono: 'telefon',
    telefono_alt: 'telefon2', telefono2: 'telefon2', municipio_ine: 'municipi', ubicacio: 'municipi',
    comentario: 'nota', comentarios: 'nota',
  }
  return mapa[c] ?? c
}

/** Los campos del contrato que pueden salir en los campos escritos y en `canvis[].camp` (`ie.camp_<x>`). */
export const CAMPS_RESULTAT = [
  'nom_comercial', 'razon_social', 'nif', 'tipus_empresa', 'tipus_activitat', 'persona_contacte', 'email',
  'email2', 'telefon', 'telefon2', 'direccion', 'codigo_postal', 'municipi', 'area_geografica', 'tipo_receptor',
  'modalitats_interes', 'data_alta', 'naturalesa', 'nota',
] as const

/** Los campos (sin repetir, en el orden del contrato) de una lista de columnas rellenadas. */
export function campsOmplerts(columnes: readonly string[]): string[] {
  const set = new Set(columnes.map(campDeColumna))
  return CAMPS_RESULTAT.filter((c) => set.has(c))
}

/** Un cambio de `canvis` (B4) tal como lo usa la pantalla: el campo, el valor de antes y el nuevo. */
export interface CanviCamp { camp: string; abans: string | null; despres: string | null }

/**
 * Los cambios sin repetir: una organización de doble rol da el mismo cambio dos veces (uno por
 * ficha). Se agrupan por (campo, antes, después), en el orden en que llegan.
 */
export function agrupaCanvis<T extends CanviCamp>(canvis: readonly T[]): T[] {
  const vistos = new Set<string>()
  return canvis.filter((c) => {
    const k = JSON.stringify([c.camp, c.abans, c.despres])
    if (vistos.has(k)) return false
    vistos.add(k)
    return true
  })
}

/** Los campos que cambian, sin repetir, en el orden del contrato (el resumen de la fila). */
export function campsCanviats(canvis: readonly CanviCamp[]): string[] {
  const set = new Set(canvis.map((c) => c.camp))
  const coneguts: readonly string[] = CAMPS_RESULTAT
  return [...coneguts.filter((c) => set.has(c)), ...[...set].filter((c) => !coneguts.includes(c))]
}

/** La primera línea con texto de un bloque (la nota se resume así en el informe). */
export function primeraLinia(text: string | null): string {
  return (text ?? '').split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
}

/**
 * Los cambios de una fila en una celda del informe: «camp: abans → després» separados por « | »
 * (un hueco, «— → després»; la nota, «camp: +<primera línea>»). `nomCamp` da la etiqueta.
 */
export function textCanvisInforme(canvis: readonly CanviCamp[], nomCamp: (camp: string) => string): string {
  return agrupaCanvis(canvis).map((c) => (c.camp === 'nota'
    ? `${nomCamp(c.camp)}: +${primeraLinia(c.despres)}`
    : `${nomCamp(c.camp)}: ${c.abans ?? '—'} → ${c.despres ?? '—'}`)).join(' | ')
}

// ---------------------------------------------------------------------------
// El informe CSV
// ---------------------------------------------------------------------------

/**
 * Una celda del informe, con `;`: comillas dobladas y entrecomillado si hace falta. Un texto
 * que empiece por `=`, `+`, `-`, `@` (o tabulador/retorno) se precede de un apóstrofo: es la
 * inyección de fórmulas de CSV (molde: `cella()` de `tancamentFormat.ts`). El informe repite
 * lo que vino del Excel de otra persona, así que no es un caso teórico.
 */
export function cellaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  let text = String(valor)
  if (typeof valor !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export interface FilaInforme {
  fila: number
  nom: string | null
  nif: string | null
  accio: string
  organitzacio: string | null
  camps: string
  canvis: string
  avisos: string
  errors: string
  conveni: string
}

const COLUMNES_INFORME: (keyof FilaInforme)[] = ['fila', 'nom', 'nif', 'accio', 'organitzacio', 'camps', 'canvis', 'avisos', 'errors', 'conveni']

/** El CSV del informe (con BOM, `;` y `\r\n`, para el Excel en español). */
export function csvInforme(files: readonly FilaInforme[], capcaleres: Record<keyof FilaInforme, string>): string {
  const linies = [
    COLUMNES_INFORME.map((c) => cellaCsv(capcaleres[c])).join(';'),
    ...files.map((f) => COLUMNES_INFORME.map((c) => cellaCsv(f[c])).join(';')),
  ]
  return `﻿${linies.join('\r\n')}\r\n`
}
