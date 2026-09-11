// Política de canal: por dónde se contacta a un productor o a un receptor.
//
// REGLA (2026-07-30): **el correo es el canal por defecto.** WhatsApp solo se usa
// cuando de verdad se puede: hace falta un móvil Y, o bien un opt-in explícito, o
// bien la ventana de servicio de 24 h abierta (que es la persona escribiéndonos a
// nosotros, así que el consentimiento es implícito y el envío es gratis). En
// cualquier otro caso —sin teléfono, con un fijo, sin opt-in y sin ventana— se cae
// al correo. Así nadie se queda sin recibir la oferta porque su ficha no tenga
// WhatsApp o no lo haya aceptado nunca.
//
// LA PREFERENCIA DE LA ORGANIZACIÓN (§12.22, 11-09-2026). Desde la etapa 1 de la
// organización unificada hay dónde guardar lo que la organización PIDE:
// `organizaciones.canal_preferido`. Antes el canal solo se deducía de la ficha y la
// persona no podía decir el suyo.
//
// ⚠️ LA PREFERENCIA NO ES UN PERMISO. Pedir WhatsApp no abre la ventana de 24 h ni
//    sustituye al opt-in: esos son requisitos de Meta, no gustos, y saltárselos
//    significa que Meta rechaza el envío (131047) o que mandamos una plantilla sin
//    consentimiento. Así que la preferencia solo elige ENTRE LOS CANALES VIABLES; si
//    el pedido no lo es, se cae al otro y **se dice por qué** (`preferenciaRespetada:
//    false` + `motivo`). Una preferencia que se ignora en silencio es peor que no
//    tenerla: la persona cree haber elegido y el equipo no sabe que no se cumplió.
//
// `null` = seguir deduciendo, que es el comportamiento de siempre y el de las 464
// fichas de hoy. Compatible hacia atrás.
//
// Función PURA, sin red: recibe los datos ya cargados y decide. Igual que
// `priorizacion.ts`, para poder razonarla y probarla aislada. **La preferencia entra
// por parámetro**: este módulo no consulta `organizaciones` ni ninguna otra tabla; la
// leen quienes lo llaman (`_shared/organizacion.ts`). Quién PUEDE recibir
// es otra cosa y vive en `gate.ts` (es_test + modo test): esto decide el canal,
// aquel decide el permiso. Los dos se aplican; ninguno sustituye al otro.

export type Canal = "whatsapp" | "email" | "cap";

/** Lo que la organización pide (`organizaciones.canal_preferido`). null = deducirlo. */
export type CanalPreferido = "whatsapp" | "email" | null;

/** Ventana de servicio de WhatsApp: 24 h desde el último mensaje del contacto. */
export const VENTANA_MS = 24 * 60 * 60 * 1000;

export interface DatosContacto {
  telefono?: string | null;
  email?: string | null;
  /** De `wa_contacts`: consentimiento explícito para plantillas. */
  opt_in?: boolean | null;
  /** De `wa_contacts`: última vez que el contacto nos escribió. */
  last_inbound_at?: string | null;
  /**
   * De `organizaciones.canal_preferido`: el canal que la organización PIDE.
   * `null`/ausente = no lo ha dicho, se deduce como siempre.
   */
  canal_preferido?: CanalPreferido;
}

/**
 * Códigos estables (los traduce el frontend); el texto es el respaldo en català.
 *
 * `preferencia_whatsapp` / `preferencia_email` son los dos únicos que significan «se ha
 * elegido esto porque lo pidió». Cuando la preferencia NO se puede respetar, el motivo
 * es el de siempre —el que explica por qué el canal pedido no era viable— y lo que lo
 * marca como incumplimiento es `preferenciaRespetada: false`.
 */
export type MotivoCanal =
  | "finestra_oberta"
  | "opt_in"
  | "sense_telefon"
  | "telefon_no_mobil"
  | "sense_optin_ni_finestra"
  | "sense_correu"
  | "sense_canal"
  | "preferencia_whatsapp"
  | "preferencia_email";

export interface DecisionCanal {
  canal: Canal;
  /** Por qué se ha elegido ese canal (o por qué no hay ninguno). */
  motivo: MotivoCanal;
  /** Motivo por el que WhatsApp no es viable, cuando no lo es. */
  motivoWhatsapp: MotivoCanal | null;
  whatsappPosible: boolean;
  emailPosible: boolean;
  /** Lo que la organización pidió, tal cual entró (para poder pintarlo). */
  preferido: CanalPreferido;
  /**
   * `true` si se ha respetado, `false` si el canal pedido no era viable y se ha caído
   * al otro, `null` si no hay preferencia. Es lo que impide que un incumplimiento pase
   * en silencio.
   */
  preferenciaRespetada: boolean | null;
}

/**
 * ¿Este número puede recibir WhatsApp? Un fijo no, y en el import de ARA hay 6
 * (§6). Fuera de España no se puede saber por el prefijo, así que se acepta:
 * más vale intentarlo y que Meta lo rechace que descartarlo por nuestra cuenta.
 */
export function esMovil(telefono: string | null | undefined): boolean {
  const t = (telefono ?? "").replace(/\D/g, "");
  if (t.length < 9) return false;
  if (t.startsWith("34")) return /^34[67]/.test(t); // móviles españoles: 6xx y 7xx
  return true;
}

export function ventanaAbierta(lastInboundAt: string | null | undefined, ahora = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  return Number.isFinite(t) && ahora - t <= VENTANA_MS;
}

export function decidirCanal(d: DatosContacto, ahora = Date.now()): DecisionCanal {
  const telefono = (d.telefono ?? "").trim();
  const email = (d.email ?? "").trim();
  const emailPosible = email.includes("@");

  let whatsappPosible = false;
  let motivoWhatsapp: MotivoCanal | null = null;
  let motivoWa: MotivoCanal = "sense_telefon";

  if (!telefono) {
    motivoWhatsapp = "sense_telefon";
  } else if (!esMovil(telefono)) {
    motivoWhatsapp = "telefon_no_mobil";
  } else if (ventanaAbierta(d.last_inbound_at, ahora)) {
    // Nos ha escrito hace menos de 24 h: texto libre permitido y gratis (§8).
    whatsappPosible = true;
    motivoWa = "finestra_oberta";
  } else if (d.opt_in === true) {
    // Sin ventana solo entran plantillas, y esas sí exigen consentimiento.
    whatsappPosible = true;
    motivoWa = "opt_in";
  } else {
    motivoWhatsapp = "sense_optin_ni_finestra";
  }

  const preferido: CanalPreferido = d.canal_preferido ?? null;
  const base = { motivoWhatsapp, whatsappPosible, emailPosible, preferido };

  // --- La preferencia, cuando la hay: elige ENTRE LOS VIABLES ----------------
  // Va antes que la regla por defecto, y solo puede mover la decisión hacia un canal
  // que el bloque de arriba ya ha declarado posible. Nunca inventa uno.
  if (preferido === "whatsapp") {
    if (whatsappPosible) {
      return { ...base, canal: "whatsapp", motivo: "preferencia_whatsapp", preferenciaRespetada: true };
    }
    // Ha pedido WhatsApp y no se puede (sin móvil, o sin opt-in y con la ventana
    // cerrada). El motivo sigue siendo el de siempre —eso es lo accionable: completa
    // la ficha, consigue el opt-in— y `preferenciaRespetada: false` dice que además
    // se le está incumpliendo lo que pidió.
    if (emailPosible) {
      return { ...base, canal: "email", motivo: motivoWhatsapp!, preferenciaRespetada: false };
    }
    return { ...base, canal: "cap", motivo: "sense_canal", preferenciaRespetada: false };
  }

  if (preferido === "email") {
    if (emailPosible) {
      return { ...base, canal: "email", motivo: "preferencia_email", preferenciaRespetada: true };
    }
    // Pidió correo y no hay correo en la ficha. `sense_correu` existía en el
    // vocabulario desde el principio y hasta hoy no lo producía nadie: este es su caso.
    if (whatsappPosible) {
      return { ...base, canal: "whatsapp", motivo: "sense_correu", preferenciaRespetada: false };
    }
    return { ...base, canal: "cap", motivo: "sense_canal", preferenciaRespetada: false };
  }

  // --- Sin preferencia: la regla de siempre (§8bis) --------------------------
  if (whatsappPosible) {
    return { ...base, canal: "whatsapp", motivo: motivoWa, motivoWhatsapp: null, preferenciaRespetada: null };
  }
  if (emailPosible) {
    // El correo es el canal por defecto: el motivo que se enseña es POR QUÉ no
    // ha sido WhatsApp, que es lo que el equipo necesita saber.
    return { ...base, canal: "email", motivo: motivoWhatsapp!, preferenciaRespetada: null };
  }
  return { ...base, canal: "cap", motivo: "sense_canal", preferenciaRespetada: null };
}
