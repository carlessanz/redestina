// «Contacte i accés» de la ficha del equipo (plan 1, 1D): del estado de la cuenta
// (`estat_acces_org()`) y de lo que hay en la ficha, qué botones salen y por qué están grises.
// Puro, para Vitest (`tests/donarAcces.test.ts`); el componente es `components/fitxa/AccesEntitat`.

/** Lo que devuelve `estat_acces_org()`. */
export type EstatAcces = 'sense' | 'pendent' | 'enviat' | 'actiu' | 'desactivat'

export interface CondicionsAcces {
  estat: EstatAcces
  /** admin o super_admin: el `tecnic` ve el estado pero no da ni quita acceso. */
  potAprovar: boolean
  /** Alguna ficha de la organización activa (`v_organizaciones.activa`). */
  entitatActiva: boolean
  /** El correo de la ficha, tal como está en el formulario. */
  correu: string
  /** El correo del formulario no es el guardado: primero se desa. */
  correuCanviat: boolean
  /**
   * Clave i18n de `motiuCanal(…, 'email')` si el correo está apagado (§8), o null. Ya NO pone
   * gris el botón (04-11-2026): «Dona-li accés» es un envío manual, y el componente pide la
   * confirmación (`acceptaEnviament`).
   */
  motiuCorreu: string | null
}

/** Una acción: `motiu` (clave i18n) si sale gris; null si se puede pulsar. */
export interface Accio { motiu: string | null }

export interface AccionsAcces {
  donar: Accio | null
  reenviar: Accio | null
  desactivar: Accio | null
}

/** Por qué no se puede mandar el correo de acceso ahora, o null si se puede. */
function motiuEnviar(c: CondicionsAcces): string | null {
  if (!c.potAprovar) return 'appr.need_approver'
  if (!c.entitatActiva) return 'acc.m_inactiva'
  if (!c.correu.trim()) return 'acc.m_sense_correu'
  if (c.correuCanviat) return 'acc.m_desa_correu'
  return null
}

/**
 * Las acciones del bloque. «Dona-li accés» sin cuenta o con la cuenta desactivada; «Torna a
 * enviar» y «Desactiva l'accés» con el acceso dado (haya entrado o no). Con un alta pendiente,
 * ninguna: eso se decide en Aprovacions.
 */
export function accionsAcces(c: CondicionsAcces): AccionsAcces {
  const enviar = { motiu: motiuEnviar(c) }
  const ambAcces = c.estat === 'enviat' || c.estat === 'actiu'
  return {
    donar: c.estat === 'sense' || c.estat === 'desactivat' ? enviar : null,
    reenviar: ambAcces ? enviar : null,
    desactivar: ambAcces ? { motiu: c.potAprovar ? null : 'appr.need_approver' } : null,
  }
}

/** Los códigos que devuelve `donar-acces` y que la pantalla sabe explicar. */
const CODIS = new Set([
  'falta_correu', 'correus_diferents', 'correu_invalid', 'correu_desactivat', 'no_test_user',
  'entitat_inactiva', 'registre_pendent', 'compte_equip', 'compte_en_altra_org',
  'altre_compte_actiu', 'compte_existent', 'dades_en_us', 'correu_no_enviat', 'forbidden',
])

/** El código de error de `donar-acces`, como clave i18n. */
export function clauErrorAcces(codi: string | null): string {
  return codi && CODIS.has(codi) ? `acc.e_${codi}` : 'acc.e_error'
}
