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
  /** Alguna de sus organizaciones tiene un convenio pendiente de firmar o devuelto. */
  conveni_pendent?: boolean
  /**
   * Interruptor global de WhatsApp (`app_settings.whatsapp_activo`, §8). Viaja en el
   * contexto de sesión y no se consulta aparte porque `app_settings` solo la lee el
   * equipo (RLS `es_intern()`) y esto lo necesitan los tres paneles.
   *
   * **Fail-safe ENCENDIDO**: una RPC vieja que no devuelva la clave deja la app como
   * estaba, que es lo correcto mientras la migración no esté aplicada.
   */
  whatsappActiu: boolean
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
  registre_rebutjat?: boolean
  /** Alguna de sus organizaciones tiene un convenio pendiente de firmar o devuelto. */
  conveni_pendent?: boolean
  /** Interruptor global de WhatsApp (20270317100000); sin esa migración llega `undefined`. */
  whatsapp_actiu?: boolean
}

export function mapejaContext(cru: ContextCru): ContextSessio {
  const organitzacions = cru.organizaciones ?? []
  const rols: Rol[] = []
  if (cru.es_intern === true) rols.push('intern')
  if (organitzacions.some((o) => o.tipo === 'productor')) rols.push('productor')
  if (organitzacions.some((o) => o.tipo === 'entidad')) rols.push('receptor')

  return {
    userId: cru.user_id,
    email: cru.email,
    nombre: cru.nombre,
    idioma: cru.idioma ?? 'ca',
    rol: cru.rol,
    // `=== true` y no el valor tal cual: una RPC que llegue sin la clave (o con un null)
    // no concede nada. Los permisos se conceden explícitamente o no se conceden.
    esIntern: cru.es_intern === true,
    potAprovar: cru.pot_aprovar === true,
    esSuperAdmin: cru.es_super_admin === true,
    rolesActivos: cru.roles_activos,
    organitzacions,
    rols,
    // Solo se acepta si la cuenta tiene de verdad ese panel: un `vista_defecto` viejo que ya
    // no corresponde (una membresía retirada) no debe mandar a ningún sitio.
    vistaDefecte: cru.vista_defecto && rols.includes(cru.vista_defecto) ? cru.vista_defecto : null,
    registrePendent: cru.registre_pendent ?? false,
    registreRebutjat: cru.registre_rebutjat ?? false,
    whatsappActiu: cru.whatsapp_actiu !== false,
  }
}

/**
 * Qué hacer con la respuesta de `get_my_session_context()`.
 *
 * 🔴 **FAIL-CERRADO.** Hasta el 07-10-2026, si la RPC fallaba se montaba un «contexto
 * degradado» que simulaba equipo interno con todos los permisos (`esSuperAdmin` incluido):
 * era el puente de cuando la migración de roles todavía no estaba desplegada, y se quedó
 * puesto meses después de que dejara de hacer falta. Consecuencia: un corte de red o un
 * error transitorio de la base le enseñaba a un productor el panel del equipo —sin datos,
 * porque la RLS sigue cortando, pero con los botones y la navegación de un super_admin—.
 *
 * Ahora un fallo es un fallo: `{ ok: false }`, sin contexto y sin permisos, y quien lo
 * consume enseña «no s'ha pogut carregar el teu compte» con un botón para reintentar.
 */
export type ResultatContext = { ok: true; ctx: ContextSessio } | { ok: false }

export function resolContext(data: unknown, error: unknown): ResultatContext {
  if (error || !data || typeof data !== 'object') return { ok: false }
  return { ok: true, ctx: mapejaContext(data as ContextCru) }
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

/** Lo único que identifica una organización: su tipo de ficha y su id. */
export type RefOrganitzacio = Pick<Organitzacio, 'tipo' | 'id'>

/**
 * Clave estable de un conjunto de organizaciones: `tipo:id,tipo:id`. `ctx.organitzacions`
 * es un array NUEVO en cada render del contexto, así que un efecto que dependa de él se
 * relanzaría con cada `SIGNED_IN` que supabase-js reemite; uno que dependa de esta cadena,
 * solo cuando cambian de verdad. El efecto recupera la lista con `organitzacionsDeClau`.
 */
export function clauOrganitzacions(orgs: readonly RefOrganitzacio[]): string {
  return orgs.map((o) => `${o.tipo}:${o.id}`).join(',')
}

/** La inversa de `clauOrganitzacions`. Una clave vacía es ninguna organización. */
export function organitzacionsDeClau(clau: string): RefOrganitzacio[] {
  if (clau === '') return []
  return clau.split(',').map((parell) => {
    const i = parell.indexOf(':')
    return { tipo: parell.slice(0, i) as Organitzacio['tipo'], id: parell.slice(i + 1) }
  })
}
