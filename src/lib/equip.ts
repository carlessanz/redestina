// El equipo de Redestina (09-11-2026): las cuentas con rol de plataforma —`super_admin`
// («Superadmin») y `admin` («Dinamitzador»)—, que NO son los usuarios de las organizaciones.
// El `tecnic` se retiró el 25-11-2026 (proceso 0.1): la base lo pasó a `admin` y ya no lo admite,
// pero la historia (`equip_rols_hist`, la auditoría) lo conserva, y por eso existe `RolHistoric`. Vocabulario y cálculos de la pantalla
// «Configuració › Equip», sin React (prueba en `tests/equip.test.ts`). Todo es puro salvo
// `altaMembreEquip`, el cliente de la Edge Function `alta-equip` (deuda 169), que nunca lanza.
//
// El alta la hace `alta-equip` (Admin API + `alta_membre_equip()`, `20270621100000`, apunte 'alta');
// los cambios, `canviar_rol_equip()` (`20270513100000`) y, desde `20270514100000`, editar, activar,
// desactivar, borrar y traspasar acciones (`*_membre_equip`, `traspassar_accions_equip`); las lee
// `equip_membres()`. Todas son solo del super_admin. Quién puede qué (reglas de la base, que esta
// pantalla solo anticipa para no ofrecer botones que acabarían en error):
//   · no puedes cambiarte el rol, ni activarte, desactivarte o borrarte a ti mismo;
//   · el equipo nunca se queda sin un super_admin activo;
//   · borrar a quien ha hecho cosas EXIGE decir a quién pasan (`cal_desti`);
//   · una cuenta del equipo no tiene organizaciones (ni, por tanto, ofertas), y por eso el alta
//     no convierte en equipo el correo de una cuenta de organización (`compte_existent`).

import { supabase, supabaseUrl } from './supabase'

/** El CHECK de `usuario_roles.rol`, del que más permisos tiene al que menos. */
export const ROLS_EQUIP = ['super_admin', 'admin'] as const
export type RolEquip = (typeof ROLS_EQUIP)[number]

/** Lo que puede salir en la historia: los roles de hoy y los retirados (el `tecnic`). */
export type RolHistoric = RolEquip | 'tecnic'

/**
 * La clave i18n de un rol, también de uno retirado: `eq.rol_<rol>` para los vigentes y
 * `eq.rol_retirat_<rol>` para los de antes (la auditoría no se reescribe). Un valor que nadie
 * conoce cae en el retirado genérico del técnico: mejor eso que la clave cruda.
 */
export function clauRol(rol: RolHistoric | string): string {
  return (ROLS_EQUIP as readonly string[]).includes(rol) ? `eq.rol_${rol}` : 'eq.rol_retirat_tecnic'
}

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
export const ACCIONS_HIST = ['alta', 'rol', 'activa', 'desactiva', 'edita', 'esborra', 'traspas'] as const
export type AccioHist = (typeof ACCIONS_HIST)[number]

/** Una fila de `equip_rols_hist`. */
export interface CanviRol {
  id: string
  email: string | null
  rol_abans: RolHistoric | null
  rol_despres: RolHistoric | null
  accio: AccioHist
  detall: { traspassades?: number; desti_email?: string | null; total?: number } | null
  per_email: string | null
  at: string
}

/** Lo que puede aparecer en `equip_auditoria()`: lo de `equip_rols_hist` más cada traspaso (`mou_accions`). */
export const ACCIONS_AUDITORIA = ['alta', 'rol', 'activa', 'desactiva', 'edita', 'esborra', 'mou_accions'] as const
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
  rol_abans: RolHistoric | null
  rol_despres: RolHistoric | null
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
  // Precios de referencia por mes (punto 3, D1): las columnas de autoría del equipo.
  preus_carregues: 'costos', preus_referencia: 'costos', preus_referencia_hist: 'costos',
  productes_fonts: 'costos', preus_fonts_estat: 'costos',
  diagnostics: 'diagnostic', diagnostic_accions: 'diagnostic',
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

const ORDRE: Record<RolEquip, number> = { super_admin: 0, admin: 1 }

/** El equipo ordenado: primero el rol con más permisos, y dentro de cada rol por correo. */
export function ordenaEquip(membres: readonly MembreEquip[]): MembreEquip[] {
  return [...membres].sort((a, b) =>
    (ORDRE[a.rol] ?? 9) - (ORDRE[b.rol] ?? 9) || (a.email ?? '').localeCompare(b.email ?? ''))
}

/** Cuántos hay de cada rol (para la cabecera). */
export function recompteRols(membres: readonly MembreEquip[]): Record<RolEquip, number> {
  const r: Record<RolEquip, number> = { super_admin: 0, admin: 0 }
  // Un rol que la pantalla no conoce (una base por delante o por detrás) no suma NaN.
  for (const m of membres) if (m.rol in r) r[m.rol] += 1
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
  return ORDRE[despres] > (ORDRE[abans] ?? 9)
}

/**
 * Los códigos que levantan las RPC del equipo y `alta-equip`, y que la pantalla sabe explicar.
 * Se buscan por `includes` en orden: ningún código es parte de otro (`compte_existent` no está
 * dentro de `compte_inexistent`; lo comprueba el test).
 */
export const CODIS_EQUIP = [
  'rol_invalid', 'no_et_pots_canviar', 'usuari_inexistent', 'no_es_de_lequip', 'ultim_super_admin',
  'no_et_pots_tocar', 'cal_desti', 'desti_igual', 'desti_no_equip', 'telefon_invalid', 'nom_massa_llarg',
  'compte_equip', 'te_membresies',
  // Alta (`alta-equip`, deuda 169).
  'compte_existent', 'compte_inexistent', 'correu_invalid', 'nom_buit', 'correu_fallit',
] as const
const CODIS = new Set<string>(CODIS_EQUIP)

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

// ── Alta de una cuenta del equipo (deuda 169) ─────────────────────────────────────────────────

/** Los idiomas de la cuenta (`perfiles.idioma`): deciden el del correo de acceso. */
export const IDIOMES_EQUIP = ['ca', 'es'] as const
export type IdiomaEquip = (typeof IDIOMES_EQUIP)[number]

/** Lo que pide el formulario de alta. */
export interface DadesAltaMembre {
  email: string
  nom: string
  telefon: string
  rol: RolEquip
  idioma: IdiomaEquip
}

/** El campo del formulario al que pertenece un error (o `null`: va arriba, sobre el formulario). */
export type CampAlta = 'email' | 'nom' | 'telefon' | 'rol'

/** Máximo del nombre (la misma regla que `editar_membre_equip`: `nom_massa_llarg`). */
export const MAX_NOM_EQUIP = 120

/** El correo como lo guarda Auth: sin espacios y en minúsculas. */
export function normalitzaCorreu(s: string): string {
  return s.trim().toLowerCase()
}

/** ¿Tiene forma de correo? Lo justo para no mandar basura: el servidor vuelve a validarlo. */
export function correuValid(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalitzaCorreu(s))
}

/**
 * Los errores del formulario de alta, por campo (clave i18n), antes de llamar al servidor. Vacío =
 * se puede enviar. El teléfono es opcional y sigue `telefonValid`.
 */
export function validaAltaMembre(d: Pick<DadesAltaMembre, 'email' | 'nom' | 'telefon'>): Partial<Record<CampAlta, string>> {
  const e: Partial<Record<CampAlta, string>> = {}
  const nom = d.nom.trim()
  if (!nom) e.nom = 'eq.e_nom_buit'
  else if (nom.length > MAX_NOM_EQUIP) e.nom = 'eq.e_nom_massa_llarg'
  if (!correuValid(d.email)) e.email = 'eq.e_correu_invalid'
  if (!telefonValid(d.telefon)) e.telefon = 'eq.e_telefon_invalid'
  return e
}

/** Dónde se enseña un código de `alta-equip`: bajo su campo, o arriba (`null`). */
export function campErrorAlta(codi: string): CampAlta | null {
  switch (codi) {
    case 'correu_invalid':
    case 'compte_equip':
    case 'compte_existent':
    case 'te_membresies':
      return 'email'
    case 'nom_buit':
    case 'nom_massa_llarg':
      return 'nom'
    case 'telefon_invalid':
      return 'telefon'
    case 'rol_invalid':
      return 'rol'
    default:
      return null
  }
}

/**
 * La clave i18n de un código de `alta-equip`. `compte_equip` aquí quiere decir «ya es del equipo»
 * (en las RPC de membresías, otra cosa), y el genérico no es el de cambiar el rol: los dos tienen
 * su clave propia del alta. Sin sesión, sin permiso o sin red, también.
 */
export function clauErrorAlta(codi: string): string {
  if (codi === 'compte_equip') return 'eq.e_alta_compte_equip'
  if (codi === 'unauthorized' || codi === 'http_401') return 'eq.e_alta_sessio'
  if (codi === 'forbidden' || codi === 'http_403') return 'eq.e_alta_forbidden'
  if (codi === 'xarxa') return 'eq.e_alta_xarxa'
  const clau = clauErrorEquip(codi)
  return clau === 'eq.e_error' ? 'eq.e_alta_error' : clau
}

/** Lo que devuelve `altaMembreEquip`: nunca lanza. */
export type ResultatAlta =
  | { ok: true; user_id: string; email: string; rol: RolEquip; simulat: boolean }
  | { ok: false; error: string }

/**
 * «Afegeix una persona» (Configuració › Equip, solo super_admin): `alta-equip` crea la cuenta,
 * le da el rol y le manda el correo para crear la contraseña. Con el JWT de la sesión, como
 * `donarAcces` (`acces.ts`). Nunca lanza: devuelve `{ ok: false, error: <codi> }` con el código
 * del servidor (`compte_existent`, `correu_fallit`…), `http_<status>` si no lo trae, o `xarxa`.
 */
export async function altaMembreEquip(d: DadesAltaMembre): Promise<ResultatAlta> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { ok: false, error: 'unauthorized' }
    const telefon = normalitzaTelefon(d.telefon)
    const res = await fetch(`${supabaseUrl}/functions/v1/alta-equip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        email: normalitzaCorreu(d.email),
        nombre: d.nom.trim(),
        ...(telefon ? { telefon } : {}),
        rol: d.rol,
        idioma: d.idioma,
      }),
    })
    const cos = (await res.json().catch(() => null)) as
      { ok?: boolean; error?: string; code?: string; user_id?: string; email?: string; rol?: RolEquip; simulat?: boolean } | null
    if (!res.ok || !cos?.ok) {
      if (res.status === 401) return { ok: false, error: 'unauthorized' }
      return { ok: false, error: cos?.error ?? cos?.code ?? `http_${res.status}` }
    }
    return {
      ok: true,
      user_id: cos.user_id ?? '',
      email: cos.email ?? normalitzaCorreu(d.email),
      rol: cos.rol ?? d.rol,
      simulat: cos.simulat === true,
    }
  } catch {
    return { ok: false, error: 'xarxa' }
  }
}
