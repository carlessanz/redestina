// El circuito de firma de los documentos (05-11-2026), en su parte PURA: qué se firma, cómo
// se dice cada estado y —sobre todo— qué botón sale a quién.
//
// QUÉ SE FIRMA. Cinco documentos tienen una contraparte que firma:
//   · CD  (certificado de donación)   — el donante;
//   · CR  (certificado de recepción)  — la entidad receptora;
//   · REC (albarán de recepción)      — el productor;
//   · ENT (albarán de entrega)        — la entidad receptora;
//   · CONV (convenio)                 — la organización, pero por SU circuito
//                                       (`DialegFirmaConveni`): aquí solo admite que el
//                                       equipo suba el PDF firmado.
//
// LOS TRES ESTADOS (`v_signatura_document`, «pendent» no se guarda, se deriva):
//   pendent  falta la firma;
//   signat   la contraparte ha SUBIDO el fichero firmado y espera al equipo;
//   tancat   cerrado: firmado con trazo (se cierra solo), subido por el equipo o revisado
//            y cerrado por él. La versión firmada es la vigente.
//
// QUIÉN DEL EQUIPO (proceso 0.1, 25-11-2026): la firma de un ALBARÁN (REC/ENT/OPE) la cierra,
// la rechaza o la sube también el Dinamitzador (`pot_aprovar()`); la de un CONV, CD, CDP o CR
// sigue siendo solo del Superadmin, porque va con la firma institucional de la Fundació.
//
// ⚠️ `accionsSignatura()` ES EL ÚNICO SITIO QUE DECIDE QUÉ BOTÓN SALE. Los componentes
//    (`AccionsSignatura`, «Pendent de tu», la cola de Aprovacions) le preguntan y pintan lo
//    que diga. Repartir la regla por cinco pantallas es como un CONV acaba ofreciendo «Signa»
//    a quien no puede firmarlo por aquí, o un Dinamitzador ve un «Tanca» que la base rechaza.
//
// Sin dependencias de Supabase ni de React: se prueba en `tests/signatures.test.ts`.

import type { EstatSignatura, PartSignant, TipusDocSignable, ViaSignatura } from '../types'

// Los mínimos de quien firma: los mismos que exige el servidor (`signar_document_per_enllac`,
// `firmar_convenio_por_enlace`). `FirmaConveni` los importa de aquí: dos copias de un mínimo
// son dos sitios donde el botón se enciende y el servidor responde 400.
export const MIN_NOM = 2
export const MIN_DNI = 5

/** Los que se pueden firmar con el trazo (en el panel o por el enlace del correo). */
export const TIPUS_CANVAS: readonly TipusDocSignable[] = ['CD', 'CR', 'REC', 'ENT']
/** Los que admiten subir el fichero firmado. El CONV, solo el equipo. */
export const TIPUS_PUJABLES: readonly TipusDocSignable[] = ['CD', 'CR', 'REC', 'ENT', 'CONV']

/** Lo que acepta `pujar-document-signat`: el PDF firmado o una foto del papel. */
export const MIMES_SIGNAT: readonly string[] = ['application/pdf', 'image/jpeg', 'image/png']
export const MAX_BYTES_SIGNAT = 10 * 1024 * 1024

export function esSignableCanvas(tipo: string | null | undefined): boolean {
  return (TIPUS_CANVAS as readonly string[]).includes(tipo ?? '')
}

export function esPujable(tipo: string | null | undefined): boolean {
  return (TIPUS_PUJABLES as readonly string[]).includes(tipo ?? '')
}

/** Los albaranes: su firma la gestiona también el Dinamitzador (25-11-2026). */
export const TIPUS_ALBARA: readonly string[] = ['REC', 'ENT', 'OPE']

export function esTipusAlbara(tipo: string | null | undefined): boolean {
  return TIPUS_ALBARA.includes(tipo ?? '')
}

/**
 * ¿Puede esta cuenta del equipo cerrar, rechazar o subir la firma de un documento de este tipo?
 * El Superadmin, siempre; el Dinamitzador (`pot_aprovar()`), solo la de un albarán. Es la misma
 * regla que `tancar_signatura`/`rebutjar_signatura` y `pujar-document-signat` en el servidor.
 */
export function potGestionarSignatura(c: { tipo: string | null | undefined; esSuperAdmin: boolean; potAprovar: boolean }): boolean {
  return c.esSuperAdmin || (c.potAprovar && esTipusAlbara(c.tipo))
}

/** Dónde firma la organización desde su panel: «Els meus documents» de su papel. */
export function panellQueSigna(tipoOrg: 'productor' | 'entidad'): string {
  return tipoOrg === 'productor' ? '/productor/documents' : '/receptor/documents'
}

/** «Signa el donant», «Signa l'entitat receptora»… */
export function clauQuiSigna(part: PartSignant): string {
  return `sgn.qui_${part}`
}

/**
 * Desde dónde se mira. El mismo estado se dice distinto: a la organización, `pendent` es
 * «te toca» (ámbar); al equipo es «espera a la otra parte» (neutro), y `signat` al revés.
 */
export type PerspectivaSignatura = 'usuari' | 'equip'

export function clauEstatSignatura(estat: EstatSignatura, perspectiva: PerspectivaSignatura): string {
  return estat === 'tancat' ? 'sgn.st_tancat' : `sgn.st_${estat}_${perspectiva}`
}

/**
 * El color de cada estado, de los tokens: ámbar lo que le toca a quien mira, verde lo
 * resuelto, neutro lo que espera a otro. Nunca rojo: una firma pendiente no es un error.
 */
export function estilEstatSignatura(estat: EstatSignatura, perspectiva: PerspectivaSignatura): string {
  if (estat === 'tancat') return 'bg-exito-fondo text-exito'
  const meu = (estat === 'pendent' && perspectiva === 'usuari') || (estat === 'signat' && perspectiva === 'equip')
  return meu ? 'bg-aviso-fondo text-aviso' : 'bg-secondary text-secondary-foreground'
}

/**
 * ¿Se enseña el estado? Un CONV «pendent» no es «falta la firma» —el convenio ya se firma por
 * su circuito—: solo quiere decir que el equipo PUEDE subir el firmado en papel. Pintarlo como
 * pendiente llenaría cada convenio vigente de un ámbar que no pide nada a nadie.
 */
export function mostraEstatSignatura(estat: EstatSignatura | null | undefined, admetCanvas: boolean): boolean {
  if (!estat) return false
  return !(estat === 'pendent' && !admetCanvas)
}

export function clauVia(via: ViaSignatura): string {
  return `sgn.via_${via}`
}

/**
 * Quién mira, a efectos de firma. Lo deriva `rolSignatura()` del contexto de sesión.
 * `dinamitzador` = equipo con `pot_aprovar()` sin ser Superadmin; `equip`, el resto del equipo
 * (hoy nadie: el `tecnic` se retiró, pero un contexto sin `potAprovar` no concede nada).
 */
export type RolSignatura = 'titular' | 'operador' | 'super_admin' | 'dinamitzador' | 'equip'

export function rolSignatura(c: { esIntern: boolean; esSuperAdmin: boolean; potAprovar?: boolean; titular: boolean }): RolSignatura {
  if (c.esSuperAdmin) return 'super_admin'
  if (c.esIntern) return c.potAprovar === true ? 'dinamitzador' : 'equip'
  return c.titular ? 'titular' : 'operador'
}

/**
 * Las acciones posibles, en el orden en que se pintan:
 *   signa        firmar con el trazo (abre «Signa aquí»);
 *   puja         la organización sube su fichero firmado (queda `signat`);
 *   puja_equip   el equipo sube el que le devolvieron (queda `tancat`): el Superadmin
 *                cualquiera; el Dinamitzador, solo el de un albarán;
 *   veure_fitxer revisar el fichero subido antes de cerrar;
 *   tanca        darlo por bueno;
 *   rebutja      devolverlo a «pendent», con motivo.
 */
export type AccioSignatura = 'signa' | 'puja' | 'puja_equip' | 'veure_fitxer' | 'tanca' | 'rebutja'

export function accionsSignatura(a: {
  estat: EstatSignatura
  rol: RolSignatura
  tipo: string
  /** `false` en el CONV (`v_signatura_document.admet_canvas`). */
  admetCanvas: boolean
  /** La firma viva trae fichero (`fitxer_mime`): solo entonces hay algo que revisar. */
  ambPdf: boolean
}): AccioSignatura[] {
  if (!esPujable(a.tipo) || a.estat === 'tancat') return []

  if (a.rol === 'titular') {
    // El CONV se firma por su circuito (`DialegFirmaConveni`, «Pendent de tu»): ofrecerle aquí
    // otro botón sería un segundo camino para lo mismo, y la base lo rechaza
    // (`usa_firma_conveni`). Y con una firma ya enviada, lo que queda es esperar.
    if (a.estat !== 'pendent' || !a.admetCanvas || !esSignableCanvas(a.tipo)) return []
    return ['signa', 'puja']
  }

  if (a.rol === 'super_admin' || (a.rol === 'dinamitzador' && esTipusAlbara(a.tipo))) {
    if (a.estat === 'pendent') return ['puja_equip']
    return a.ambPdf ? ['veure_fitxer', 'tanca', 'rebutja'] : ['tanca', 'rebutja']
  }

  // El operador ve el documento pero no lo firma (como el convenio). El Dinamitzador no cierra
  // ni sube la firma de un CONV, CD o CR (es del Superadmin), y el resto del equipo, nada.
  return []
}

/**
 * ¿Vale este fichero? Devuelve la clave del motivo o `null`. Es una ayuda para no subir
 * 10 MB y esperar al 413: la autoridad es la Edge Function, que mira los bytes.
 */
export function validaFitxerSignat(f: { type: string; size: number } | null | undefined): string | null {
  if (!f) return 'sgn.err_falta_fitxer'
  if (f.size <= 0) return 'sgn.err_fitxer_buit'
  if (!MIMES_SIGNAT.includes(f.type)) return 'sgn.err_mime'
  if (f.size > MAX_BYTES_SIGNAT) return 'sgn.err_massa_gran'
  return null
}

/**
 * «2,4 MB» (o «340 KB» por debajo del mega: una foto pequeña no es «0 MB»). Para el tamaño
 * del fichero elegido, el de la cola y el límite.
 */
export function megues(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024)).toLocaleString('es-ES')} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`
}

/** Los mínimos de quien firma, campo a campo (para decir CUÁL falta, no solo que falta algo). */
export function signantValid(s: { nom: string; carrec: string; dni?: string | null; ambDni?: boolean }): {
  nomCurt: boolean
  carrecCurt: boolean
  dniCurt: boolean
  valid: boolean
} {
  const nomCurt = s.nom.trim().length < MIN_NOM
  const carrecCurt = s.carrec.trim().length < MIN_NOM
  const dniCurt = s.ambDni === false ? false : (s.dni ?? '').trim().length < MIN_DNI
  return { nomCurt, carrecCurt, dniCurt, valid: !nomCurt && !carrecCurt && !dniCurt }
}
