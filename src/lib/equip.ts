// El equipo de Redestina (09-11-2026): las cuentas con rol de plataforma —`super_admin`, `admin`,
// `tecnic`—, que NO son los usuarios de las organizaciones. Vocabulario y cálculos de la pantalla
// «Configuració › Equip», sin React ni Supabase (prueba en `tests/equip.test.ts`).
//
// Las escribe `canviar_rol_equip()` y las lee `equip_membres()` (`20270513100000`); las dos son
// solo del super_admin. Quién puede qué (reglas de la base, que esta pantalla solo anticipa para
// no ofrecer botones que acabarían en error):
//   · no puedes cambiarte el rol a ti mismo;
//   · el equipo nunca se queda sin un super_admin;
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
}

/** Una fila de `equip_rols_hist`. */
export interface CanviRol {
  id: string
  email: string | null
  rol_abans: RolEquip | null
  rol_despres: RolEquip | null
  per_email: string | null
  at: string
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

/**
 * Lo que se puede hacer con una cuenta, igual que lo va a exigir la base. `canvia` = false con
 * su `motiu` (clave i18n) cuando no hay nada que ofrecer: tú mismo, o el único super_admin
 * activo (bajarlo dejaría el equipo sin nadie que pueda corregirlo desde la interfaz).
 */
export function accionsMembre(
  m: MembreEquip,
  membres: readonly MembreEquip[],
): { canvia: boolean; motiu: string | null; opcions: OpcioRol[] } {
  if (m.es_tu) return { canvia: false, motiu: 'eq.m_tu', opcions: [] }
  const ultim = m.rol === 'super_admin'
    && !membres.some((x) => x.user_id !== m.user_id && x.rol === 'super_admin' && x.actiu)
  if (ultim) return { canvia: false, motiu: 'eq.m_ultim', opcions: [] }
  const opcions: OpcioRol[] = [
    ...ROLS_EQUIP.map((r) => ({ valor: r as RolAAssignar, clau: `eq.rol_${r}` })),
    { valor: 'cap', clau: 'eq.treu' },
  ]
  return { canvia: true, motiu: null, opcions }
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
])

/** Clave i18n de un error de `canviar_rol_equip()`: `eq.e_<codi>` o `eq.e_error`. */
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
