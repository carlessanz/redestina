// Núcleo PURO de la importación del ARA 2026 (plan 1, rebanada 1E) y del cruce con Airtable.
//
// Sin `Deno.`, sin red y sin imports `jsr:`/`npm:`: lo usa `scripts/import-ara-2026.ts` (Deno)
// y lo prueba `tests/importAra2026.test.ts` (Vitest, Node). Todo lo que decide QUÉ se crea, con
// qué NIF, teléfono o correo, y qué va al informe vive aquí; el script solo lee los CSV, consulta
// la base y escribe.
//
// Reglas (AGENTS §6 y §1E del plan):
//   · Mapeo por NOMBRE de cabecera (normalizado: minúsculas, sin acentos, espacios colapsados),
//     nunca por posición. Las cabeceras repetidas se piden por su ocurrencia (`telefon` #0 y #1)
//     y las vacías, por ocurrencia de la cabecera vacía: es la única forma de nombrarlas.
//   · Todo entra INACTIVO (D2). NIF inválido → sin NIF + informe; repetido entre filas → lo
//     conserva la primera; ya en la base (en una ficha no importada) → no se crea («ja existeix»).
//   · Doble rol: una fila de Prod y una de SDA con el MISMO NIF → una organización con las dos
//     fichas. Sin NIF, nunca se juntan por nombre (§4).
//   · Idempotente por `ref_externa = ARA26:<hoja>:<línea del CSV>` (la cabecera es la línea 1).

import { errorNif, netejaNif } from '../../src/lib/validacio.ts'

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** CSV RFC 4180 (comillas dobles, `""` escapado, celdas de varias líneas). */
export function parseCsv(texto: string, sep = ','): string[][] {
  const t = texto.replace(/^﻿/, '')
  const files: string[][] = []
  let fila: string[] = []
  let cel = ''
  let cometes = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (cometes) {
      if (c === '"') {
        if (t[i + 1] === '"') { cel += '"'; i++ } else cometes = false
      } else cel += c
    } else if (c === '"' && cel === '') cometes = true
    else if (c === sep) { fila.push(cel); cel = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      fila.push(cel); files.push(fila); fila = []; cel = ''
    } else cel += c
  }
  if (cel !== '' || fila.length) { fila.push(cel); files.push(fila) }
  return files
}

// ---------------------------------------------------------------------------
// Normalizadores
// ---------------------------------------------------------------------------

const senseAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Cabecera comparable: «Tipo  Empresa» → «tipo empresa», «Data\nAlta» → «data alta». */
export function normalitzaCapcalera(h: string): string {
  return senseAccents(h).toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Nombre comparable para casar: sin acentos, mayúsculas y sin signos. */
export function normalitzaNom(s: string): string {
  return senseAccents(s).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/** Similitud de trigramas como `pg_trgm.similarity()` (palabras con dos espacios delante y uno detrás). */
export function similitud(a: string, b: string): number {
  const tri = (s: string) => {
    const set = new Set<string>()
    for (const w of normalitzaNom(s).toLowerCase().split(' ').filter(Boolean)) {
      const p = `  ${w} `
      for (let i = 0; i + 3 <= p.length; i++) set.add(p.slice(i, i + 3))
    }
    return set
  }
  const A = tri(a), B = tri(b)
  if (!A.size || !B.size) return 0
  let comuns = 0
  for (const x of A) if (B.has(x)) comuns++
  return comuns / (A.size + B.size - comuns)
}

const net = (v: string | undefined): string | null => {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}

/**
 * Los teléfonos de una celda de texto libre, en E.164 sin «+». Es el `extraerTelefonos()` de
 * `scripts/import-ara.ts` (que no se puede importar: ejecuta la carga de julio al cargarse):
 * se quitan paréntesis y extensiones, y se buscan secuencias de 9 cifras con separadores, sin
 * fundir dos números seguidos en uno.
 */
export function extraerTelefonos(raw: string | null | undefined): string[] {
  if (!raw) return []
  let s = raw.replace(/\([^)]*\)/g, ' ')
  s = s.replace(/ext\.?\s*\d+/gi, ' ')
  const out: string[] = []
  for (const m of s.matchAll(/(?:\d[\s.-]*){9,}/g)) {
    let d = m[0].replace(/\D/g, '')
    while (d.length >= 9) {
      if (d.startsWith('34') && d.length >= 11) { out.push(d.slice(0, 11)); d = d.slice(11) }
      else if (/^[6789]/.test(d)) { out.push('34' + d.slice(0, 9)); d = d.slice(9) }
      else d = d.slice(1)
    }
  }
  return [...new Set(out)]
}

const RE_CORREU = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export function extraerCorreos(raw: string | null | undefined): string[] {
  if (!raw) return []
  return [...new Set((raw.match(RE_CORREU) ?? []).map((c) => c.trim()))]
}

/** Texto libre sí/no de las capacidades del SDA: boolean solo cuando es concluyente. */
export function derivarBoolean(txt: string | null): boolean | null {
  const t = (txt ?? '').trim().toLowerCase()
  if (!t) return null
  if (/(^|[^a-z])s[ií]([^a-z]|$)/.test(t)) return true
  if (t.startsWith('no')) return false
  return null
}

/**
 * La fecha de alta del Excel: ISO (las celdas con formato de fecha), un número de serie de Excel
 * (las que no lo tenían: «43795») o un año suelto («2022»). Devuelve la fecha si la hay y el
 * texto original si no es fecha.
 */
export function dataAlta(raw: string | null): { iso: string | null; text: string | null } {
  const v = (raw ?? '').trim()
  if (!v) return { iso: null, text: null }
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return { iso: m[1], text: m[1] }
  if (/^\d{5}$/.test(v)) {
    const n = Number(v)
    if (n > 30000 && n < 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000)
      const iso = d.toISOString().slice(0, 10)
      return { iso, text: iso }
    }
  }
  return { iso: null, text: v }
}

export type EstatNif = 'ok' | 'buit' | 'invalid'

/** El NIF como lo guardaría el trigger `trg_fitxa_nif` (sin espacios, puntos ni guiones). */
export function nifNet(raw: string | null): { nif: string | null; estat: EstatNif } {
  const n = netejaNif(raw ?? '')
  if (n === '') return { nif: null, estat: 'buit' }
  return errorNif(n) === null ? { nif: n, estat: 'ok' } : { nif: null, estat: 'invalid' }
}

/** Un código del Excel solo si lo parece («PR015», «E000», «AD001»); «??», «-», «pendent», no. */
export function codiValid(raw: string | null): string | null {
  const v = (raw ?? '').trim()
  return /^[A-Z]{1,3}\s?\d{1,4}$/i.test(v) ? v.toUpperCase().replace(/\s/g, '') : null
}

/**
 * `tipo_receptor` desde la familia del SDA (análisis del 21-09-2026, §6.2 paso 3):
 * SDA/Xarxa/Cuines/BDA/Centre Social/Ajuntament → social; Animal → animal; E.I. → transformador;
 * Ind. Agroalimentària → comercial. Otra o vacía → null.
 */
export function tipoReceptorDeFamilia(familia: string | null): string | null {
  const f = normalitzaNom(familia ?? '')
  if (!f) return null
  if (/^(SDA|XARXA|CUINES|BDA|CENTRE SOCIAL|AJUNTAMENT)$/.test(f)) return 'social'
  if (f === 'ANIMAL') return 'animal'
  if (f.startsWith('E I')) return 'transformador'
  if (f.startsWith('IND')) return 'comercial'
  return null
}

// ---------------------------------------------------------------------------
// Hojas
// ---------------------------------------------------------------------------

export type Hoja = 'prod_actius' | 'prod_inactius' | 'prod_potencials' | 'sda' | 'sda_inactius'
export const HOJAS: readonly Hoja[] = ['prod_actius', 'prod_inactius', 'prod_potencials', 'sda', 'sda_inactius']
export const esProd = (h: Hoja) => h.startsWith('prod_')

/** Una columna por su cabecera normalizada y su ocurrencia (0 = la primera con ese nombre). */
type Col = readonly [capcalera: string, ocurrencia: number]

/**
 * Qué columna del CSV alimenta cada campo, hoja por hoja. Las diferencias entre hojas son
 * reales (exportación del 02-11-2026):
 *   · `prod_actius`: la columna 0 va sin cabecera y es la fecha de alta.
 *   · `prod_inactius`: dos columnas sin cabecera: la 0 es el motivo de baja y la 1 el nombre.
 *   · `prod_potencials`: «Producte» #0 es el tipo (`Potencial`, `Pot.NoContac`) y #1 el
 *     producto; «C.P.» #0 es el código postal y #1 el área geográfica.
 *   · `sda`/`sda_inactius`: «Telefon» #0 es el teléfono de la entidad (va a `telefono`) y
 *     «Telèfon» #1 —se normalizan igual— el de la persona de «Contactes» (va a `telefono2`);
 *     «Telèfon 2» va a `telefono3` con «Contacte 2» y «Mail 2». El personal se llama
 *     «Treballador/es» en una hoja y «Personal contractat» en la otra.
 */
const MAPA_PROD: Record<'prod_actius' | 'prod_inactius' | 'prod_potencials', Record<string, Col | null>> = {
  prod_actius: {
    data_alta: ['', 0], baixa: null, name: ['nom', 0], empresa: ['empresa', 0], codi: ['codi', 0],
    comentari: ['comentari', 0], visitat: ['visitat', 0], conveni: ['conveni', 0], tipus: ['tipo empresa', 0],
    movils: ['movils', 0], fix: ['fix', 0], adreca: ['adreca', 0], cp: ['c.p.', 0], nif: ['nif', 0],
    area: ['area geografica', 0], poblacio: ['poblacio', 0], coord: ['coord', 0], coord2: ['coord 2', 0],
    producte: ['producte', 0],
  },
  prod_inactius: {
    data_alta: null, baixa: ['', 0], name: ['', 1], empresa: ['empresa', 0], codi: ['codi', 0],
    comentari: ['comentari', 0], visitat: ['visitat', 0], conveni: ['conveni', 0], tipus: ['tipo empresa', 0],
    movils: ['movils', 0], fix: ['fix', 0], adreca: ['adreca', 0], cp: ['c.p.', 0], nif: ['nif', 0],
    area: ['area geografica', 0], poblacio: ['poblacio', 0], coord: ['coord', 0], coord2: ['coord 2', 0],
    producte: ['producte', 0],
  },
  prod_potencials: {
    data_alta: ['data alta', 0], baixa: null, name: ['productor/a', 0], empresa: ['empresa', 0], codi: ['codi', 0],
    comentari: ['comentari', 0], visitat: ['visitat', 0], conveni: ['conveni', 0], tipus: ['producte', 0],
    movils: ['movils', 0], fix: ['fix', 0], adreca: ['adreca', 0], cp: ['c.p.', 0], nif: ['nif', 0],
    area: ['c.p.', 1], poblacio: ['poblacio', 0], coord: null, coord2: null, producte: ['producte', 1],
  },
}

const MAPA_SDA_BASE: Record<string, Col | null> = {
  data_alta: ['data alta', 0], nombre: ['nom', 0], familia: ['familia', 0], prioritat: ['prioritat', 0],
  codi: ['codi', 0], estat: ['estat', 0], comentaris: ['comentaris', 0], gestio: ['gestio', 0],
  area: ['area geografica', 0], poblacio: ['poblacio', 0], adreca: ['adreca', 0], cp: ['codi postal', 0],
  horari: ['horari', 0], nif: ['nif', 0], telefon: ['telefon', 0], contacte: ['contactes', 0],
  telefon_contacte: ['telefon', 1], mail: ['mail', 0], contacte2: ['contacte 2', 0], telefon2: ['telefon 2', 0],
  mail2: ['mail 2', 0], calendari: ['calendari de repartiment', 0], frescos: ['repartiment de productes frescos', 0],
  plataforma: ['transport amb plataforma?', 0], toro: ['descarrega amb toro', 0],
  // Sin columna propia en `entidades`: van, con su etiqueta, al bloque «ARA 2026» de `comentarios`.
  frigo: ['camara frigo (m3)', 0], neveres: ['neveres repartiment', 0], observacions: ['observacions', 0],
  beneficiaris: ['nombre beneficiaris atesos', 0], voluntaris: ['voluntaris', 0],
  voluntaris_espigolar: ['voluntaris per espigolar', 0], curs: ['curs manip.aliments', 0],
  // `Saldo` y `Saldo 30/6/25` (cajas) no se importan: es histórico (plan del 21-09).
}
const MAPA_SDA: Record<'sda' | 'sda_inactius', Record<string, Col | null>> = {
  sda: { ...MAPA_SDA_BASE, personal: ['treballador/es', 0] },
  sda_inactius: { ...MAPA_SDA_BASE, personal: ['personal contractat', 0] },
}

/** Etiquetas (en catalán, como la interfaz) de lo que va al bloque de comentarios. */
const ETIQUETES_SDA: Record<string, string> = {
  observacions: 'Observacions', frigo: 'Càmera frigorífica (m3)', neveres: 'Neveres de repartiment',
  beneficiaris: 'Beneficiaris atesos', personal: 'Personal', voluntaris: 'Voluntaris',
  voluntaris_espigolar: 'Voluntaris per espigolar', curs: 'Curs de manipulació d\'aliments',
}

/** Índice de cada columna pedida; lanza si una cabecera esperada no está (exportación cambiada). */
export function resolCapcaleres(hoja: Hoja, capcalera: string[]): Record<string, number | null> {
  const mapa = esProd(hoja) ? MAPA_PROD[hoja as keyof typeof MAPA_PROD] : MAPA_SDA[hoja as keyof typeof MAPA_SDA]
  const norm = capcalera.map(normalitzaCapcalera)
  const out: Record<string, number | null> = {}
  const falten: string[] = []
  for (const [camp, col] of Object.entries(mapa)) {
    if (!col) { out[camp] = null; continue }
    const [nom, oc] = col
    const idx = norm.flatMap((h, i) => (h === nom ? [i] : []))[oc]
    if (idx === undefined) falten.push(`${camp} («${nom}» #${oc})`)
    out[camp] = idx ?? null
  }
  if (falten.length) throw new Error(`${hoja}: faltan cabeceras: ${falten.join(', ')}`)
  return out
}

// ---------------------------------------------------------------------------
// Fila leída
// ---------------------------------------------------------------------------

/** Lo que dice una fila del Excel, ya normalizado, antes de mirar la base. */
export interface FilaAra {
  hoja: Hoja
  linia: number // línea del CSV (la cabecera es la 1)
  ref: string // ARA26:<hoja>:<línea>
  nom: string // el nombre que se enseña y con el que se casa
  nifOrigen: string | null
  nif: string | null
  estatNif: EstatNif
  telefons: string[]
  correus: string[]
  telefonsSenseExtreure: string[] // celdas con texto en las que no se reconoció ningún teléfono
  correusNoValids: string[]
  anotacions: string[] // van al bloque «ARA 2026» del comentario de la ficha
  camps: Record<string, unknown> // columnas de la tabla, sin teléfono/correo/NIF (los decide el plan)
  /** Solo SDA: los teléfonos de cada columna, en orden. */
  telefonsEntitat?: { telefono: string[]; telefono2: string[]; telefono3: string[] }
  /** Solo SDA: correo de cada columna. */
  correusEntitat?: { email: string[]; email2: string[] }
}

/** Lee una hoja entera; las filas sin nombre se devuelven aparte (descartadas). */
export function llegirFulla(hoja: Hoja, files: string[][]): { files: FilaAra[]; descartades: number[] } {
  const [cap, ...dades] = files
  const idx = resolCapcaleres(hoja, cap)
  const out: FilaAra[] = []
  const descartades: number[] = []
  dades.forEach((r, i) => {
    const linia = i + 2
    if (!r.some((c) => c.trim() !== '')) return
    const v = (camp: string) => { const k = idx[camp]; return k === null || k === undefined ? null : net(r[k]) }
    const fila = esProd(hoja) ? llegirProd(hoja, linia, v) : llegirSda(hoja, linia, v)
    if (fila) out.push(fila); else descartades.push(linia)
  })
  return { files: out, descartades }
}

type Llegeix = (camp: string) => string | null

function comuns(hoja: Hoja, linia: number, nom: string, nifRaw: string | null) {
  const { nif, estat } = nifNet(nifRaw)
  const anotacions: string[] = []
  if (estat === 'invalid') anotacions.push(`NIF de l'origen no vàlid: ${nifRaw}`)
  return { hoja, linia, ref: `ARA26:${hoja}:${linia}`, nom, nifOrigen: nifRaw, nif, estatNif: estat, anotacions }
}

function llegirProd(hoja: Hoja, linia: number, v: Llegeix): FilaAra | null {
  const name = v('name') ?? v('empresa')
  if (!name) return null
  const base = comuns(hoja, linia, name, v('nif'))
  const anot = base.anotacions
  const da = dataAlta(v('data_alta'))
  if (da.text && !da.iso) anot.push(`Data d'alta (ARA): ${da.text}`)
  if (v('baixa')) anot.push(`Motiu de baixa (ARA): ${v('baixa')}`)
  const codiRaw = v('codi')
  const codigo = codiValid(codiRaw)
  if (codiRaw && !codigo) anot.push(`Codi de l'origen: ${codiRaw}`)
  if (v('coord') || v('coord2')) anot.push(`Coordenades (ARA): ${[v('coord'), v('coord2')].filter(Boolean).join(', ')}`)

  // «Movils» y «Fix» son texto libre: llevan teléfonos y, a veces, correos (en `prod_actius`
  // la columna «Fix» trae sobre todo correos). En `prod_potencials` el tipo a veces es un correo.
  let tipus = v('tipus')
  const celes = [v('movils'), v('fix')]
  if (tipus && extraerCorreos(tipus).length) { celes.push(tipus); tipus = null }
  const telefons = celes.flatMap((c) => extraerTelefonos(c))
  const correus = celes.flatMap((c) => extraerCorreos(c))
  const senseExtreure = celes.filter((c): c is string => !!c
    && extraerTelefonos(c).length === 0 && extraerCorreos(c).length === 0)

  const producte = v('producte')
  return {
    ...base,
    telefons: [...new Set(telefons)],
    correus: [...new Set(correus)],
    telefonsSenseExtreure: senseExtreure,
    correusNoValids: [],
    camps: {
      name,
      empresa: v('empresa'),
      codigo,
      comentario: v('comentari'),
      visitado: v('visitat'),
      conveni: v('conveni'),
      tipo_empresa: tipus,
      direccion: v('adreca'),
      codigo_postal: v('cp'),
      area_geografica: v('area'),
      poblacion: v('poblacio'),
      productos_habituales: producte ? [producte] : null,
      data_alta: da.iso,
    },
  }
}

function llegirSda(hoja: Hoja, linia: number, v: Llegeix): FilaAra | null {
  const nombre = v('nombre')
  if (!nombre) return null
  const base = comuns(hoja, linia, nombre, v('nif'))
  const anot = base.anotacions
  const da = dataAlta(v('data_alta'))
  const codiRaw = v('codi')
  const codigo = codiValid(codiRaw)
  if (codiRaw && !codigo) anot.push(`Codi de l'origen: ${codiRaw}`)
  const prioritatRaw = v('prioritat')
  const prioritat = prioritatRaw && /^\d+$/.test(prioritatRaw) ? Number(prioritatRaw) : null
  if (prioritatRaw && prioritat === null) anot.push(`Prioritat (ARA): ${prioritatRaw}`)

  const telCols = { telefono: v('telefon'), telefono2: v('telefon_contacte'), telefono3: v('telefon2') }
  const telefonsEntitat = {
    telefono: extraerTelefonos(telCols.telefono),
    telefono2: extraerTelefonos(telCols.telefono2),
    telefono3: extraerTelefonos(telCols.telefono3),
  }
  const senseExtreure = Object.values(telCols).filter((c): c is string => !!c && extraerTelefonos(c).length === 0)
  // Un número que sobra en una celda (dos teléfonos en «Telefon») no tiene columna: al comentario.
  for (const [col, tels] of Object.entries(telefonsEntitat)) {
    if (tels.length > 1) anot.push(`Altres telèfons (${col}): ${tels.slice(1).join(' / ')}`)
  }
  if (senseExtreure.length) anot.push(`Telèfons no reconeguts: ${senseExtreure.join(' | ')}`)

  const mailCols = { email: v('mail'), email2: v('mail2') }
  const correusEntitat = { email: extraerCorreos(mailCols.email), email2: extraerCorreos(mailCols.email2) }
  const correusNoValids = Object.values(mailCols).filter((c): c is string => !!c && extraerCorreos(c).length === 0)
  if (correusNoValids.length) anot.push(`Correu no reconegut: ${correusNoValids.join(' | ')}`)
  for (const [col, cs] of Object.entries(correusEntitat)) {
    if (cs.length > 1) anot.push(`Altres correus (${col}): ${cs.slice(1).join(', ')}`)
  }
  for (const [camp, etiqueta] of Object.entries(ETIQUETES_SDA)) {
    if (v(camp)) anot.push(`${etiqueta}: ${v(camp)}`)
  }

  return {
    ...base,
    telefons: [...new Set(Object.values(telefonsEntitat).flat())],
    correus: [...new Set(Object.values(correusEntitat).flat())],
    telefonsSenseExtreure: senseExtreure,
    correusNoValids,
    telefonsEntitat,
    correusEntitat,
    camps: {
      nombre,
      data_alta: da.text, // `entidades.data_alta` es texto: un año suelto se conserva
      familia: v('familia'),
      prioritat,
      codigo,
      estat: v('estat'),
      comentarios: v('comentaris'),
      gestio: v('gestio'),
      area_geografica: v('area'),
      poblacion: v('poblacio'),
      direccion: v('adreca'),
      codigo_postal: v('cp'),
      horario: v('horari'),
      contacto: v('contacte'),
      contacto2: v('contacte2'),
      calendari_repartiment: v('calendari'),
      productes_frescos: derivarBoolean(v('frescos')),
      productes_frescos_txt: v('frescos'),
      transport_plataforma: derivarBoolean(v('plataforma')),
      transport_plataforma_txt: v('plataforma'),
      descarrega_toro: derivarBoolean(v('toro')),
      descarrega_toro_txt: v('toro'),
      tipo_receptor: tipoReceptorDeFamilia(v('familia')),
    },
  }
}

// ---------------------------------------------------------------------------
// Municipios
// ---------------------------------------------------------------------------

export interface Municipi { codi_ine: string; nom: string }

/** «Prat de Llobregat, el» y «El Prat de Llobregat» dan la misma clave. */
export function claveMunicipi(s: string): string {
  const n = normalitzaNom(s.replace(/,\s*(l'|el|la|els|les)\s*$/i, ''))
  return n.replace(/^(EL|LA|ELS|LES|L) /, '')
}

/** Índice nombre → INE, solo con los nombres que no se repiten. */
export function indexMunicipis(ms: Municipi[]): Map<string, string> {
  const vistos = new Map<string, string | null>()
  for (const m of ms) {
    const k = claveMunicipi(m.nom)
    vistos.set(k, vistos.has(k) ? null : m.codi_ine)
  }
  return new Map([...vistos].filter((e): e is [string, string] => e[1] !== null))
}

// ---------------------------------------------------------------------------
// Plan de carga
// ---------------------------------------------------------------------------

/** Lo que ya hay en la base y condiciona la carga. */
export interface Existent {
  /** NIF normalizado → organización, de las fichas que NO son de esta importación. */
  nifsAliens: Map<string, string>
  /** Correos (en minúsculas) y teléfonos de `productores`, que son únicos en la tabla. */
  correusProductors: Set<string>
  telefonsProductors: Set<string>
  /** Fichas ya importadas, por `ref_externa`. */
  importats: Map<string, { taula: 'productores' | 'entidades'; id: string; organizacion_id: string; nom: string }>
}

export interface FitxaPlanejada {
  fila: FilaAra
  taula: 'productores' | 'entidades'
  dades: Record<string, unknown> // la fila completa a insertar (sin organizacion_id)
  existent?: { id: string; organizacion_id: string }
}

export interface OrgPlanejada {
  clau: string // NIF o ref de la fila
  productor?: FitxaPlanejada
  entitat?: FitxaPlanejada
}

export interface Incidencia { ref: string; hoja: Hoja; nom: string; detall: string }

export interface PlaCarrega {
  orgs: OrgPlanejada[]
  descartades: { hoja: Hoja; linia: number }[]
  jaExisteix: Incidencia[] // NIF que ya tiene una ficha no importada
  refDesquadrada: Incidencia[] // la ref existe pero con otro nombre: la exportación cambió de orden
  senseNif: Incidencia[] // sin NIF en el origen (los inválidos y repetidos van aparte)
  nifInvalid: Incidencia[]
  nifRepetit: Incidencia[]
  dobleRol: { nif: string; productor: Incidencia; entitat: Incidencia }[]
  telefonsSenseExtreure: Incidencia[]
  correusNoValids: Incidencia[]
  telefonEnUs: Incidencia[] // productores.phone es único
  correuEnUs: Incidencia[] // productores.email es único
  municipiCasat: number
  municipiSenseCasar: Incidencia[]
  nomsRepetits: { nom: string; refs: string[] }[] // mismo nombre normalizado en varias filas (no se juntan)
}

const inc = (f: FilaAra, detall = ''): Incidencia => ({ ref: f.ref, hoja: f.hoja, nom: f.nom, detall })

/** El bloque «ARA 2026» que se añade al comentario de la ficha. */
export function blocAnotacions(f: FilaAra, extra: string[] = []): string | null {
  const linies = [...f.anotacions, ...extra]
  if (!linies.length) return null
  return `[ARA 2026 · ${f.hoja} · línia ${f.linia}]\n${linies.map((l) => `· ${l}`).join('\n')}`
}

const ajunta = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join('\n\n') || null

/**
 * Decide qué se crea, con qué NIF, teléfono y correo. Puro: recibe lo leído y lo que ya hay en
 * la base, y devuelve el plan y las incidencias del informe.
 */
export function planificar(filesPerHoja: Record<Hoja, { files: FilaAra[]; descartades: number[] }>,
  existent: Existent, municipis: Map<string, string>): PlaCarrega {
  const pla: PlaCarrega = {
    orgs: [], descartades: [], jaExisteix: [], refDesquadrada: [], senseNif: [], nifInvalid: [], nifRepetit: [],
    dobleRol: [], telefonsSenseExtreure: [], correusNoValids: [], telefonEnUs: [], correuEnUs: [],
    municipiCasat: 0, municipiSenseCasar: [], nomsRepetits: [],
  }
  for (const h of HOJAS) for (const l of filesPerHoja[h].descartades) pla.descartades.push({ hoja: h, linia: l })

  // 1. NIF: el primero de cada papel lo conserva; Prod + SDA con el mismo NIF = doble rol.
  const primerNif = { prod: new Map<string, FilaAra>(), sda: new Map<string, FilaAra>() }
  const nifFinal = new Map<FilaAra, string | null>()
  const extres = new Map<FilaAra, string[]>()
  const afegeix = (f: FilaAra, s: string) => extres.set(f, [...(extres.get(f) ?? []), s])
  const totes = HOJAS.flatMap((h) => filesPerHoja[h].files)
  for (const f of totes) {
    if (f.estatNif === 'invalid') pla.nifInvalid.push(inc(f, f.nifOrigen ?? ''))
    if (!f.nif) { nifFinal.set(f, null); if (f.estatNif === 'buit') pla.senseNif.push(inc(f)); continue }
    const grup = esProd(f.hoja) ? primerNif.prod : primerNif.sda
    const primer = grup.get(f.nif)
    if (primer) {
      pla.nifRepetit.push(inc(f, `${f.nif} (el conserva ${primer.ref})`))
      afegeix(f, `NIF repetit a l'origen (el conserva ${primer.ref}): ${f.nif}`)
      nifFinal.set(f, null)
      continue
    }
    grup.set(f.nif, f)
    nifFinal.set(f, f.nif)
  }

  // 2. Organizaciones: por NIF (con doble rol) o una por fila.
  const perNif = new Map<string, OrgPlanejada>()
  const correusUsats = new Set(existent.correusProductors)
  const telefonsUsats = new Set(existent.telefonsProductors)

  for (const f of totes) {
    const nif = nifFinal.get(f) ?? null
    const taula = esProd(f.hoja) ? 'productores' : 'entidades'
    const ja = existent.importats.get(f.ref)
    if (ja && normalitzaNom(ja.nom) !== normalitzaNom(f.nom)) {
      pla.refDesquadrada.push(inc(f, `a la base: «${ja.nom}»`))
      continue
    }
    if (!ja && nif && existent.nifsAliens.has(nif)) {
      pla.jaExisteix.push(inc(f, nif))
      continue
    }

    // Municipio por nombre exacto (sin artículo), único en el catálogo.
    const poblacio = f.camps.poblacion as string | null
    let municipio_ine: string | null = null
    if (poblacio) {
      municipio_ine = municipis.get(claveMunicipi(poblacio)) ?? null
      if (municipio_ine) pla.municipiCasat++
      else pla.municipiSenseCasar.push(inc(f, poblacio))
    }
    if (f.telefonsSenseExtreure.length) pla.telefonsSenseExtreure.push(inc(f, f.telefonsSenseExtreure.join(' | ')))
    if (f.correusNoValids.length) pla.correusNoValids.push(inc(f, f.correusNoValids.join(' | ')))

    let dades: Record<string, unknown>
    if (taula === 'productores') {
      // `phone` y `email` son ÚNICOS en `productores`: el primero libre va a la columna; los
      // demás teléfonos a `telefono_alt`, y un correo ya usado, al comentario.
      const phone = f.telefons.find((t) => !telefonsUsats.has(t)) ?? null
      if (f.telefons.length && !phone) pla.telefonEnUs.push(inc(f, f.telefons.join(' / ')))
      if (phone) telefonsUsats.add(phone)
      const alt = f.telefons.filter((t) => t !== phone)
      const telefono_alt = ajunta(alt.length ? alt.join(' / ') : null,
        f.telefonsSenseExtreure.length ? f.telefonsSenseExtreure.join(' | ') : null)
      const email = f.correus.find((c) => !correusUsats.has(c.toLowerCase())) ?? null
      if (f.correus.length && f.correus[0] !== email) {
        pla.correuEnUs.push(inc(f, f.correus[0]))
        afegeix(f, `Correu ja en ús en una altra fitxa: ${f.correus[0]}`)
      }
      if (email) correusUsats.add(email.toLowerCase())
      const altres = f.correus.filter((c) => c !== email && c !== f.correus[0])
      if (altres.length) afegeix(f, `Altres correus: ${altres.join(', ')}`)
      dades = {
        ...f.camps,
        phone, email, telefono_alt, nif,
        comentario: ajunta(f.camps.comentario as string | null, blocAnotacions(f, extres.get(f))),
      }
    } else {
      const te = f.telefonsEntitat!, ce = f.correusEntitat!
      dades = {
        ...f.camps,
        telefono: te.telefono[0] ?? null, telefono2: te.telefono2[0] ?? null, telefono3: te.telefono3[0] ?? null,
        email: ce.email[0] ?? null, email2: ce.email2[0] ?? null, nif,
        comentarios: ajunta(f.camps.comentarios as string | null, blocAnotacions(f, extres.get(f))),
      }
    }
    if (municipio_ine) dades.municipio_ine = municipio_ine
    dades.ref_externa = f.ref
    dades.activo = false // D2: todo entra inactivo
    dades.es_test = false

    const fitxa: FitxaPlanejada = { fila: f, taula, dades, existent: ja ? { id: ja.id, organizacion_id: ja.organizacion_id } : undefined }
    let org = nif ? perNif.get(nif) : undefined
    if (!org) {
      org = { clau: nif ?? f.ref }
      pla.orgs.push(org)
      if (nif) perNif.set(nif, org)
    }
    if (taula === 'productores') org.productor = fitxa; else org.entitat = fitxa
    if (nif && org.productor && org.entitat) {
      pla.dobleRol.push({ nif, productor: inc(org.productor.fila), entitat: inc(org.entitat.fila) })
    }
  }

  // 3. Nombres repetidos (informativo: sin NIF nunca se juntan).
  const perNom = new Map<string, string[]>()
  for (const f of totes) {
    const k = normalitzaNom(f.nom)
    perNom.set(k, [...(perNom.get(k) ?? []), f.ref])
  }
  pla.nomsRepetits = [...perNom].filter(([, r]) => r.length > 1).map(([nom, refs]) => ({ nom, refs }))
  return pla
}

/**
 * En una segunda pasada solo se rellenan los huecos: lo que el equipo haya corregido o completado
 * en la ficha (NIF, razón social, teléfono, activarla) no se pisa con el Excel.
 */
export function pegatRellenaHuecos(actual: Record<string, unknown>, nou: Record<string, unknown>): Record<string, unknown> {
  const buit = (x: unknown) => x === null || x === undefined || x === '' || (Array.isArray(x) && x.length === 0)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(nou)) {
    if (k === 'activo' || k === 'es_test' || k === 'ref_externa') continue
    if (buit(actual[k]) && !buit(v)) out[k] = v
  }
  return out
}

// ---------------------------------------------------------------------------
// Airtable
// ---------------------------------------------------------------------------

export interface RegistreAirtable {
  codi: string // E-2026-NNN
  linia: number
  ofertant: string
  receptor: string | null
  desti: string | null
  fiable: boolean // la línea de cabecera del registro llegó entera (28 campos en su sitio)
}

/**
 * La exportación de Airtable (`;`) llega ROTA: cada línea de una celda multilínea se convirtió en
 * una fila del CSV, con sus `;` de relleno. Reconstruirla celda a celda no es fiable, así que se
 * agrupa por registro: un registro empieza en la línea que comienza por `E-2026-NNN` y se lleva
 * todas las líneas siguientes hasta el próximo (son la continuación de sus «Observaciones» y su
 * «Mensaje comercial»). Del registro se fía solo de la línea de inicio:
 *   · el ofertante sale de «Nombre transacción» (`E-2026-NNN` + nombre), que no se desplaza;
 *   · el receptor y el destino, solo si la línea tiene sus 28 campos y la columna «Ofertante»
 *     coincide con el nombre: si no, la línea está desplazada y se marcan como no fiables.
 */
export function llegirAirtable(texto: string): { registres: RegistreAirtable[]; liniesFora: number; codisSenseRegistre: string[] } {
  const linies = texto.replace(/^﻿/, '').split(/\r?\n/)
  const cap = parseCsv(linies[0], ';')[0].map(normalitzaCapcalera)
  const iOf = cap.indexOf('ofertante'), iRec = cap.indexOf('receptor'), iDes = cap.indexOf('destino final')
  if (iOf < 0 || iRec < 0 || iDes < 0) throw new Error('airtable: faltan las columnas Ofertante/Receptor/Destino final')
  const registres: RegistreAirtable[] = []
  let liniesFora = 0
  let dinsRegistre = false
  for (let i = 1; i < linies.length; i++) {
    const l = linies[i]
    const m = l.match(/^"?(E-2026-\d{3})/)
    if (!m) { if (!dinsRegistre && l.replace(/;/g, '').trim()) liniesFora++; continue }
    dinsRegistre = true
    const camps = parseCsv(l, ';')[0] ?? []
    // El nombre, del primer tramo antes de `;` y sin comillas: una comilla suelta (registro roto)
    // no debe tragarse la línea entera.
    const nom0 = l.split(';')[0].replace(/^"?E-2026-\d{3}/, '').replace(/"/g, '').trim()
    const fiable = camps.length === cap.length && normalitzaNom(camps[iOf] ?? '') === normalitzaNom(nom0)
    registres.push({
      codi: m[1], linia: i + 1, ofertant: nom0,
      receptor: fiable ? net(camps[iRec]) : null,
      desti: fiable ? net(camps[iDes]) : null,
      fiable,
    })
  }
  const vistos = new Set(registres.map((r) => Number(r.codi.slice(-3))))
  const max = Math.max(0, ...vistos)
  const codisSenseRegistre = Array.from({ length: max }, (_, k) => k + 1).filter((n) => !vistos.has(n))
    .map((n) => `E-2026-${String(n).padStart(3, '0')}`)
  return { registres, liniesFora, codisSenseRegistre }
}

export interface CandidatAra { ref: string; hoja: Hoja; nom: string; altresNoms: string[]; nif: string | null; sim: number }

export interface CreuAirtable {
  nom: string
  paper: 'ofertant' | 'receptor'
  registres: number
  destins: string[]
  exactes: CandidatAra[]
  semblants: CandidatAra[]
  decisio: 'casar_confirmar' | 'revisar' | 'crear_inactiu'
  proposta: string
}

const UMBRAL_SEMBLANT = 0.4 // el mismo que `cerca_entitats()` (1A)

/**
 * Cruza cada nombre de Airtable con las filas del ARA. Regla de §4: por parecido de nombre NUNCA
 * se une solo; la coincidencia EXACTA tras normalizar se propone («casar, confirmar») y aun así
 * va al informe. Lo que no está en el ARA se propone crear inactivo; nada de esto se carga.
 */
export function creuarAirtable(registres: RegistreAirtable[], files: FilaAra[]): CreuAirtable[] {
  const noms = (f: FilaAra) => [f.nom, ...(esProd(f.hoja) && f.camps.empresa ? [f.camps.empresa as string] : [])]
  const grups = new Map<string, { nom: string; paper: 'ofertant' | 'receptor'; n: number; destins: Set<string> }>()
  const suma = (nom: string, paper: 'ofertant' | 'receptor', desti: string | null) => {
    const k = `${paper}|${normalitzaNom(nom)}`
    const g = grups.get(k) ?? { nom: nom.trim(), paper, n: 0, destins: new Set<string>() }
    g.n++
    if (desti) g.destins.add(desti)
    grups.set(k, g)
  }
  for (const r of registres) {
    if (r.ofertant) suma(r.ofertant, 'ofertant', r.desti)
    if (r.receptor) suma(r.receptor, 'receptor', r.desti)
  }
  const out: CreuAirtable[] = []
  for (const g of grups.values()) {
    const clau = normalitzaNom(g.nom)
    const cands: CandidatAra[] = files.map((f) => {
      const ns = noms(f)
      const sim = Math.max(...ns.map((n) => {
        const nn = normalitzaNom(n)
        if (nn === clau) return 1
        const conte = nn.length >= 4 && clau.length >= 4 && (nn.includes(clau) || clau.includes(nn))
        return Math.max(similitud(n, g.nom), conte ? UMBRAL_SEMBLANT : 0)
      }))
      return { ref: f.ref, hoja: f.hoja, nom: f.nom, altresNoms: ns.slice(1), nif: f.nif ?? f.nifOrigen, sim }
    })
    const exactes = cands.filter((c) => c.sim === 1)
    const semblants = cands.filter((c) => c.sim < 1 && c.sim >= UMBRAL_SEMBLANT).sort((a, b) => b.sim - a.sim).slice(0, 5)
    const destins = [...g.destins]
    let decisio: CreuAirtable['decisio']
    let proposta: string
    if (exactes.length === 1) {
      decisio = 'casar_confirmar'
      proposta = `Casar amb ${exactes[0].ref} (coincidència exacta): cal que Carles ho confirmi`
    } else if (exactes.length > 1 || semblants.length) {
      decisio = 'revisar'
      proposta = exactes.length > 1 ? `${exactes.length} coincidències exactes: triar-ne una` : 'Revisar els semblants: no es casa sol'
    } else {
      decisio = 'crear_inactiu'
      proposta = g.paper === 'ofertant'
        ? 'Crear inactiu com a ofertant (productores)'
        : `Crear inactiu com a receptor, tipo_receptor «${tipusProposat(g.nom, destins)}»`
    }
    out.push({ nom: g.nom, paper: g.paper, registres: g.n, destins, exactes, semblants, decisio, proposta })
  }
  return out.sort((a, b) => a.paper.localeCompare(b.paper) || a.nom.localeCompare(b.nom))
}

/**
 * Receptor que no está en el ARA: `comercial` salvo que sea una entidad social (análisis del
 * 21-09, punto 7), o `animal` si todo lo que recibió fue a alimentación animal.
 */
export function tipusProposat(nom: string, destins: string[]): string {
  const n = normalitzaNom(nom)
  if (/\b(FUNDACIO|FUNDACION|ASSOCIACIO|ASOCIACION|CARITAS|CARITES|CREU ROJA|BANC|BANCO|SOLIDARI|SOLIDARIOS)\b/.test(n)) return 'social'
  const ds = destins.map(normalitzaNom)
  if (ds.length && ds.every((d) => d.includes('ANIMAL'))) return 'animal'
  return 'comercial'
}
