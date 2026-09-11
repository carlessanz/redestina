// Tipos y reglas del contexto de sesión: qué panel ve cada persona.
//
// El rol NO viaja en el JWT a propósito (AGENTS.md §4bis): se resuelve con una
// llamada a get_my_session_context() al entrar. Así, desactivar una cuenta o
// cambiarle el rol tiene efecto inmediato, sin esperar a que caduque el token.

/** Panel: el equipo interno, un productor o una entidad receptora. */
export type Rol = 'intern' | 'productor' | 'receptor'

export type RolPlataforma = 'super_admin' | 'admin' | 'tecnic'
export type TipusReceptor = 'social' | 'animal' | 'transformador' | 'comercial'

export interface Organitzacio {
  tipo: 'productor' | 'entidad'
  id: string
  nombre: string | null
  rol_org: 'titular' | 'operador'
  tipo_receptor: TipusReceptor | null
  modalitat: string | null
  poblacion: string | null
}

export interface ContextSessio {
  userId: string
  email: string | null
  nombre: string | null
  idioma: 'ca' | 'es'
  /** Rol de plataforma; null si es un usuario externo. */
  rol: RolPlataforma | null
  esIntern: boolean
  potAprovar: boolean
  esSuperAdmin: boolean
  /** ¿Está encendido el modelo de roles en la base? (§4bis) */
  rolesActivos: boolean
  organitzacions: Organitzacio[]
  /** Paneles a los que esta cuenta tiene acceso; puede ser más de uno (doble rol). */
  rols: Rol[]
  /**
   * Panel preferido **de la cuenta**, elegido en su ficha (`perfiles.vista_defecto`).
   *
   * La base lo devolvía desde el principio y `mapejaContext` no lo copiaba (deuda §12.38),
   * así que era lógica servida y descartada — y peor que inofensiva: la pantalla de perfil
   * deja escribir ese campo, o sea que **había un ajuste que no hacía nada**. Distinto de la
   * preferencia de `localStorage`, que es de ESTE dispositivo; el orden entre las dos lo
   * decide `rolInicial()`.
   */
  vistaDefecte: Rol | null
  /**
   * Alta hecha desde el registro público y todavía sin validar por el equipo. No sale en
   * `organitzacions` —la RPC solo devuelve las membresías activas—, así que sin esta marca
   * la persona vería la pantalla genérica de «sin panel» y no entendería que hay algo en
   * curso.
   */
  registrePendent: boolean
  /** El equipo rechazó el alta y la cuenta no tiene ninguna otra membresía activa. */
  registreRebutjat: boolean
  /**
   * true cuando no se ha podido leer el contexto (la migración de roles aún no está
   * desplegada, o la RPC falla). Se trata como equipo interno: es el comportamiento
   * que la app ha tenido siempre, y con `roles_activos` apagado es además el correcto.
   */
  degradat: boolean  /** Alguna de sus organizaciones tiene un convenio pendiente de firmar o devuelto */
  conveni_pendent?: boolean

}

/** Forma cruda que devuelve la RPC (snake_case, como en la base). */
export interface ContextCru {
  user_id: string
  email: string | null
  nombre: string | null
  idioma: 'ca' | 'es' | null
  activo: boolean
  rol: RolPlataforma | null
  roles_activos: boolean
  es_intern: boolean
  pot_aprovar: boolean
  es_super_admin: boolean
  vista_defecto: Rol | null
  organizaciones: Organitzacio[]
  /** Opcionales: los añade la migración del registro público; sin ella llegan `undefined`. */
  registre_pendent?: boolean
  registre_rebutjat?: boolean  /** Alguna de sus organizaciones tiene un convenio pendiente de firmar o devuelto */
  conveni_pendent?: boolean

}

export function mapejaContext(cru: ContextCru): ContextSessio {
  const organitzacions = cru.organizaciones ?? []
  const rols: Rol[] = []
  if (cru.es_intern) rols.push('intern')
  if (organitzacions.some((o) => o.tipo === 'productor')) rols.push('productor')
  if (organitzacions.some((o) => o.tipo === 'entidad')) rols.push('receptor')

  return {
    userId: cru.user_id,
    email: cru.email,
    nombre: cru.nombre,
    idioma: cru.idioma ?? 'ca',
    rol: cru.rol,
    esIntern: cru.es_intern,
    potAprovar: cru.pot_aprovar,
    esSuperAdmin: cru.es_super_admin,
    rolesActivos: cru.roles_activos,
    organitzacions,
    rols,
    // Solo se acepta si la cuenta tiene de verdad ese panel: un `vista_defecto` viejo que ya
    // no corresponde (una membresía retirada) no debe mandar a ningún sitio.
    vistaDefecte: cru.vista_defecto && rols.includes(cru.vista_defecto) ? cru.vista_defecto : null,
    registrePendent: cru.registre_pendent ?? false,
    registreRebutjat: cru.registre_rebutjat ?? false,
    degradat: false,
  }
}

/** Contexto de emergencia: la app se comporta como siempre (equipo interno). */
export function contextDegradat(userId: string, email: string | null): ContextSessio {
  return {
    userId,
    email,
    nombre: null,
    idioma: 'ca',
    rol: 'admin',
    esIntern: true,
    potAprovar: true,
    esSuperAdmin: true,
    rolesActivos: false,
    organitzacions: [],
    rols: ['intern'],
    vistaDefecte: null,
    registrePendent: false,
    registreRebutjat: false,
    degradat: true,
  }
}

/**
 * Panel que se abre al entrar, por orden de precedencia:
 *
 *   1. **`preferit`** — el último que se usó en ESTE dispositivo (`localStorage`). Manda
 *      porque es la decisión más reciente y la más concreta: quien acaba de trabajar en el
 *      panel de receptor espera volver a él.
 *   2. **`ctx.vistaDefecte`** — el que la cuenta tiene elegido en su ficha. Es lo que hace
 *      que ese ajuste sirva para algo en un dispositivo nuevo, donde no hay `localStorage`.
 *   3. El primero que tenga.
 *
 * Antes el paso 2 no existía: `vista_defecto` llegaba del servidor y se descartaba
 * (deuda §12.38). El comentario de esta función decía «`vista_defecto` manda si el usuario
 * la ha elegido», y no era verdad.
 */
export function rolInicial(ctx: ContextSessio, preferit: Rol | null): Rol | null {
  if (preferit && ctx.rols.includes(preferit)) return preferit
  if (ctx.vistaDefecte && ctx.rols.includes(ctx.vistaDefecte)) return ctx.vistaDefecte
  return ctx.rols[0] ?? null
}

export function rutaArrel(rol: Rol | null): string {
  switch (rol) {
    case 'intern': return '/equip/tauler'
    case 'productor': return '/productor/inici'
    case 'receptor': return '/receptor/mercat'
    default: return '/sense-acces'
  }
}

/** Prefijo de ruta → panel. Es la inversa de `rutaArrel`, por eso viven juntas. */
const PREFIX_ROL: Record<string, Rol> = {
  equip: 'intern',
  productor: 'productor',
  receptor: 'receptor',
}

/**
 * Qué panel estás mirando, según la URL. Devuelve `null` fuera de los tres paneles
 * (`/panell`, `/sense-acces`).
 *
 * Se compara el **primer segmento entero**, no un `startsWith`: si algún día hubiera una
 * ruta `/productors` (el listado del equipo vive hoy en `/equip/productors`, pero nada
 * impide que se mueva), un prefijo la confundiría con el panel del productor.
 */
export function rolDeLaRuta(pathname: string): Rol | null {
  return PREFIX_ROL[pathname.split('/')[1] ?? ''] ?? null
}

/** La organización sobre la que trabaja el panel activo (la primera de su tipo). */
export function organitzacioActiva(ctx: ContextSessio, rol: Rol | null): Organitzacio | null {
  if (rol === 'productor') return ctx.organitzacions.find((o) => o.tipo === 'productor') ?? null
  if (rol === 'receptor') return ctx.organitzacions.find((o) => o.tipo === 'entidad') ?? null
  return null
}
