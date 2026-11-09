// El equipo de Redestina (09-11-2026): las cuentas con rol de plataforma —`super_admin`, `admin`,
// `tecnic`—, que NO son los usuarios de las organizaciones. Vocabulario y cálculos de la pantalla
// «Configuració › Equip», sin React ni Supabase (prueba en `tests/equip.test.ts`).
//
// Las escribe `canviar_rol_equip()` (`20270513100000`) y, desde `20270514100000`, editar, activar,
// desactivar, borrar y traspasar acciones (`*_membre_equip`, `traspassar_accions_equip`); las lee
// `equip_membres()`. Todas son solo del super_admin. Quién puede qué (reglas de la base, que esta
// pantalla solo anticipa para no ofrecer botones que acabarían en error):
//   · no puedes cambiarte el rol, ni activarte, desactivarte o borrarte a ti mismo;
//   · el equipo nunca se queda sin un super_admin activo;
//   · borrar a quien ha hecho cosas EXIGE decir a quién pasan (`cal_desti`);
//   · una cuenta del equipo no tiene organizaciones (ni, por tanto, ofertas);
//   · aquí no se dan de alta cuentas ni se convierte una externa en equipo.

/** El CHECK de `usuario_roles.rol`, del que más permisos tiene al que menos. */
export const ROLS_EQUIP = ['super_admin', 'admin', 'tecnic'] as const
export type RolEquip = (typeof ROLS_EQUIP)[number]

/** Lo que se manda a `canviar_rol_equip`: un rol o `cap` (sacar la cuenta del equipo). */
export type RolAAssignar = RolEquip | 'cap'

/** Una fila de `equip_membres()`. */
export interface MembreEquip {
  user_id: string
  email: string | null
  nom: string | null
  rol: RolEquip
  actiu: boolean
  ultim_acces: string | null
  des_de: string | null
  otorgat_per: string | null
  es_tu: boolean
  telefon: string | null
  /** Membresías de organización activas: una cuenta del equipo debería tener 0. */
  membresies: number
}

/** Qué se hizo en una fila de `equip_rols_hist` (el CHECK de `accio`). */
export const ACCIONS_HIST = ['rol', 'activa', 'desactiva', 'edita', 'esborra', 'traspas'] as const
export type AccioHist = (typeof ACCIONS_HIST)[number]

/** Una fila de `equip_rols_hist`. */
export interface CanviRol {
  id: string
  email: string | null
  rol_abans: RolEquip | null
  rol_despres: RolEquip | null
  accio: AccioHist
  detall: { traspassades?: number; desti_email?: string | null; total?: number } | null
  per_email: string | null
  at: string
}

/** Lo que puede aparecer en `equip_auditoria()`: lo de `equip_rols_hist` más cada traspaso (`mou_accions`). */
export const ACCIONS_AUDITORIA = ['rol', 'activa', 'desactiva', 'edita', 'esborra', 'mou_accions'] as const
export type AccioAuditoria = (typeof ACCIONS_AUDITORIA)[number]

/**
 * Un apunte de `equip_auditoria()` (20270516100000): sobrevive al borrado de las cuentas, con su
 * nombre y su correo de entonces (`esborrat` = la cuenta ya no existe).
 */
export interface ApuntAuditoria {
  at: string
  accio: AccioAuditoria
  user_id: string
  email: string | null
  nom: string | null
  esborrat: boolean
  rol_abans: RolEquip | null
  rol_despres: RolEquip | null
  desti_email: string | null
  desti_nom: string | null
  total: number | null
  detall: { desti_email?: string | null; motiu?: string } | null
  per_email: string | null
  per_nom: string | null
}

/** «Nom (correu)», o lo que haya. Cadena vacía si no hay nada (un apunte hecho por SQL). */
export function persona(nom: string | null | undefined, email: string | null | undefined): string {
  const n = (nom ?? '').trim()
  const e = (email ?? '').trim()
  if (n && e && n !== e) return `${n} (${e})`
  return n || e
}

/** Las personas que salen en la auditoría (para el filtro), incluidas las borradas, por nombre. */
export function personesAuditoria(apunts: readonly ApuntAuditoria[]): { user_id: string; text: string; esborrat: boolean }[] {
  const vistes = new Map<string, { user_id: string; text: string; esborrat: boolean }>()
  for (const a of apunts) {
    if (!vistes.has(a.user_id)) vistes.set(a.user_id, { user_id: a.user_id, text: persona(a.nom, a.email), esborrat: a.esborrat })
  }
  return [...vistes.values()].sort((x, y) => x.text.localeCompare(y.text))
}

/** Lo que devuelve `equip_accions()`: las filas que llevan el nombre de la cuenta, por columna. */
export interface AccionsCompte {
  accions: { taula: string; columna: string; n: number }[]
  total: number
  membresies: number
  es_equip: boolean
}

/**
 * Las tablas de `equip_columnes_autoria()` agrupadas como se las explicaría una persona: «Convenis»,
 * «Documents»… Una tabla que no esté aquí cae en `altres` (una tabla nueva con autoría entra en el
 * traspaso sola, solo que con el rótulo genérico). Las claves `eq.g_<grup>` están declaradas en
 * `tests/i18n.test.ts`.
 */
export const GRUP_TAULA: Record<string, string> = {
  albaranes: 'albarans',
  canalizaciones: 'canalitzacions',
  cierres_donante: 'certificats', cierres_ejercicio: 'certificats', cierres_periodo: 'certificats', cierres_receptor: 'certificats',
  consentiments: 'consentiments',
  convenios: 'convenis',
  costes_producto: 'costos', costes_producto_hist: 'costos',
  diagnostics_historial: 'diagnostic', questionaris_diagnostic: 'diagnostic',
  documentos: 'documents', documentos_externos: 'documents',
  enlaces_token: 'enllacos',
  espigoladas: 'espigolades',
  evidencias: 'signatures', firmes_document: 'signatures',
  excedentes: 'ofertes', excedentes_canvis: 'ofertes', excedente_destins: 'ofertes',
  expedients_prevencion: 'prevencio', planes_prevencion: 'prevencio', pla_accions: 'prevencio', pla_objectius: 'prevencio',
  pla_processos: 'prevencio', pla_quantificacio: 'prevencio', pla_seguiments: 'prevencio', pla_verificacions: 'prevencio',
  pla_visites: 'prevencio',
  factors_impacte: 'configuracio', parametros_documentales: 'configuracio', plantillas_documento: 'configuracio',
  fitxa_estat_hist: 'fitxes', importacions_entitats: 'fitxes', organizaciones: 'fitxes',
  membresias: 'accessos', usuario_roles: 'accessos',
  notes_internes: 'notes',
}

/** Los grupos que existen (cada uno con su clave `eq.g_<grup>`). */
export const GRUPS_ACCIO = [
  'albarans', 'canalitzacions', 'certificats', 'consentiments', 'convenis', 'costos', 'diagnostic', 'documents',
  'enllacos', 'espigolades', 'ofertes', 'signatures', 'prevencio', 'configuracio', 'fitxes', 'accessos', 'notes', 'altres',
] as const

/** Las acciones de `equip_accions()` sumadas por grupo, de más a menos filas. */
export function agrupaAccions(accions: AccionsCompte['accions']): { grup: string; n: number }[] {
  const per: Record<string, number> = {}
  for (const a of accions) {
    const g = GRUP_TAULA[a.taula] ?? 'altres'
    per[g] = (per[g] ?? 0) + a.n
  }
  return Object.entries(per).map(([grup, n]) => ({ grup, n })).sort((a, b) => b.n - a.n || a.grup.localeCompare(b.grup))
}

/** El teléfono tal como lo guarda la base: E.164 sin «+», sin espacios, guiones ni paréntesis. */
export function normalitzaTelefon(s: string): string {
  return s.replace(/[\s+()-]/g, '')
}

/** ¿Vale? Vacío sí (sin teléfono); si no, 8 a 15 cifras sin cero inicial (la misma regla que la RPC). */
export function telefonValid(s: string): boolean {
  const t = normalitzaTelefon(s)
  return t === '' || /^[1-9][0-9]{7,14}$/.test(t)
}

const ORDRE: Record<RolEquip, number> = { super_admin: 0, admin: 1, tecnic: 2 }

/** El equipo ordenado: primero el rol con más permisos, y dentro de cada rol por correo. */
export function ordenaEquip(membres: readonly MembreEquip[]): MembreEquip[] {
  return [...membres].sort((a, b) =>
    ORDRE[a.rol] - ORDRE[b.rol] || (a.email ?? '').localeCompare(b.email ?? ''))
}

/** Cuántos hay de cada rol (para la cabecera). */
export function recompteRols(membres: readonly MembreEquip[]): Record<RolEquip, number> {
  const r: Record<RolEquip, number> = { super_admin: 0, admin: 0, tecnic: 0 }
  for (const m of membres) r[m.rol] += 1
  return r
}

/** Una opción del desplegable de cada fila: el rol, o `cap`, con su clave i18n. */
export interface OpcioRol { valor: RolAAssignar; clau: string }

/** ¿Es el único super_admin activo? Bajarlo, desactivarlo o borrarlo dejaría el equipo sin nadie que lo corrija. */
function esUltimSuper(m: MembreEquip, membres: readonly MembreEquip[]): boolean {
  return m.rol === 'super_admin' && m.actiu
    && !membres.some((x) => x.user_id !== m.user_id && x.rol === 'super_admin' && x.actiu)
}

/**
 * Lo que se puede hacer con una cuenta, igual que lo va a exigir la base. `canvia` = false con su
 * `motiu` (clave i18n) cuando no hay rol que ofrecer: tú mismo, o el único super_admin activo.
 * `pot` dice cuáles de las demás acciones salen, y `motiuTocar` por qué no salen las tres últimas.
 */
export function accionsMembre(
  m: MembreEquip,
  membres: readonly MembreEquip[],
): {
  canvia: boolean
  motiu: string | null
  opcions: OpcioRol[]
  pot: { edita: boolean; activa: boolean; desactiva: boolean; esborra: boolean }
  motiuTocar: string | null
} {
  const motiuTocar = m.es_tu ? 'eq.m_tu_tocar' : esUltimSuper(m, membres) ? 'eq.m_ultim' : null
  const pot = {
    edita: true,
    activa: !m.actiu && !m.es_tu,
    desactiva: m.actiu && motiuTocar === null,
    esborra: motiuTocar === null,
  }
  if (m.es_tu) return { canvia: false, motiu: 'eq.m_tu', opcions: [], pot, motiuTocar }
  if (esUltimSuper(m, membres)) return { canvia: false, motiu: 'eq.m_ultim', opcions: [], pot, motiuTocar }
  const opcions: OpcioRol[] = [
    ...ROLS_EQUIP.map((r) => ({ valor: r as RolAAssignar, clau: `eq.rol_${r}` })),
    { valor: 'cap', clau: 'eq.treu' },
  ]
  return { canvia: true, motiu: null, opcions, pot, motiuTocar }
}

/**
 * A quién se pueden pasar las acciones de `origen`: cuentas del equipo ACTIVAS que no son él
 * (`desti_no_equip`/`desti_igual` en la base), ordenadas por rol.
 */
export function destinsPossibles(membres: readonly MembreEquip[], origenId: string): MembreEquip[] {
  return ordenaEquip(membres.filter((x) => x.actiu && x.user_id !== origenId))
}

/**
 * El destino que se propone: alguien del MISMO ROL que el origen (lo que pidió Carles: «a otro
 * usuario del mismo rol»), y entre ellos quien está pulsando si lo es («me las quedo yo»); si no
 * hay nadie del mismo rol activo, quien pulsa, y si no, el primero. Solo se propone: el
 * desplegable deja elegir a cualquier cuenta activa del equipo (la autoría no tiene efectos
 * fiscales; ver `20270515100000`).
 */
export function destiPerDefecte(membres: readonly MembreEquip[], origenId: string): string {
  const v = destinsPossibles(membres, origenId)
  const rol = membres.find((x) => x.user_id === origenId)?.rol
  const mateixRol = v.filter((x) => x.rol === rol)
  return (mateixRol.find((x) => x.es_tu) ?? mateixRol[0] ?? v.find((x) => x.es_tu) ?? v[0])?.user_id ?? ''
}

/** Las cuentas de una pestaña de Configuració › Equip: activas (por defecto) o desactivadas. */
export function filtraEquip(membres: readonly MembreEquip[], pestanya: 'actius' | 'inactius'): MembreEquip[] {
  return ordenaEquip(membres.filter((m) => m.actiu === (pestanya === 'actius')))
}

/**
 * ¿Sube o baja permisos? Decide si el diálogo de confirmación es rojo: bajar a alguien o sacarlo
 * del equipo le quita acceso (y puede dejarlo a media tarea), subirlo da acceso a más de lo que
 * tenía y por eso también se pregunta, pero sin alarma.
 */
export function esBaixada(abans: RolEquip, despres: RolAAssignar): boolean {
  if (despres === 'cap') return true
  return ORDRE[despres] > ORDRE[abans]
}

/** Los códigos que levanta `canviar_rol_equip()` y que la pantalla sabe explicar. */
const CODIS = new Set([
  'rol_invalid', 'no_et_pots_canviar', 'usuari_inexistent', 'no_es_de_lequip', 'ultim_super_admin',
  'no_et_pots_tocar', 'cal_desti', 'desti_igual', 'desti_no_equip', 'telefon_invalid', 'nom_massa_llarg',
  'compte_equip', 'te_membresies',
])

/** Clave i18n de un error de las RPC del equip: `eq.e_<codi>` o `eq.e_error`. */
export function clauErrorEquip(missatge: string | null | undefined): string {
  const codi = [...CODIS].find((c) => (missatge ?? '').includes(c))
  return codi ? `eq.e_${codi}` : 'eq.e_error'
}

/**
 * El rol de plataforma de una cuenta del equipo, tal como lo da el contexto de sesión (`ctx.rol`),
 * o null si no lo tiene (un usuario externo). Un valor desconocido también es null: no se pinta
 * un rol que la pantalla no sabe explicar.
 */
export function rolEquipDe(rol: string | null | undefined): RolEquip | null {
  return (ROLS_EQUIP as readonly string[]).includes(rol ?? '') ? (rol as RolEquip) : null
}
