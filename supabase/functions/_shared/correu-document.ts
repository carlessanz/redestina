// El correo que acompaña a un documento emitido (28-09-2026, deuda §12.129).
//
// Hasta ese día NINGÚN documento salía por correo: `documentos.envio` se preparaba al
// emitir y no lo leía nadie. Ahora lo manda `generar-documento` en cuanto el PDF existe, con
// el PDF adjunto. Este módulo solo decide QUÉ se dice —asunto, título, cuerpo— según el tipo
// del documento y su idioma. Es puro (sin red ni Deno) para que Vitest lo pueda probar.
//
// Qué se envía y qué no, y por qué:
// · CONV (firmado y contrafirmado), RES, CD, CT y CR: llevan destinatario en `envio`.
// · REC, ENT y OPE NO: el albarán no se manda como PDF; lo que se manda es el ENLACE para
//   confirmarlo (`enviaEnllacosConfirmacio`, en el cliente, que es quien tiene el token).
// · PLA NO: se descarga al momento desde el panel, `envio` va a null a propósito.
// · El resumen anual NO pide la factura (decisión del 23-09-2026: el productor la gestiona
//   con su gestor y el certificado no depende de ella, §12.127).
// · Con `urlSignar` (05-11-2026, circuito de firma) el correo invita a firmar en línea y el
//   botón lleva a `/signar-document/<token>`; solo entonces se admiten también el REC y el
//   ENT (firma del donante y de la receptora), que sin enlace siguen sin mandarse.
// · El CD habla de su ámbito (05-11-2026): el ejercicio, el periodo o la donación de una
//   oferta, con las fechas del snapshot (`datos`). El CT ya no se emite, pero lo emitido se
//   puede reenviar y por eso conserva su texto.

import { abastDe, dataCurta } from "./certificatDonacio.ts";

export type Idioma = "ca" | "es";

export interface DocumentPerEnviar {
  tipo: string;
  subtipo: string | null;
  objeto_tipo: string;
  numero_completo: string | null;
  ejercicio: number | null;
  idioma: string | null;
  modo: string | null;
  envio: { destinatario?: string | null; nombre?: string | null } | null;
  /**
   * El snapshot (`documentos.datos`), solo para el CD: de él salen el ámbito (`abast`) y el
   * periodo del asunto. Opcional: sin él, el anual habla del ejercicio y el de
   * `cierre_periodo`, del periodo sin fechas.
   */
  datos?: { abast?: unknown; periode?: { des_de?: unknown; fins_a?: unknown } | null } | null;
  /**
   * El enlace para firmar en línea (`/signar-document/<token>`), si quien envía lo ha pedido
   * y el documento se puede firmar. Lo acuña `preparar_enviament_signatura()`; el token solo
   * viaja por correo, nunca por WhatsApp.
   */
  urlSignar?: string | null;
}

export interface CorreuDocument {
  destinatari: string;
  assumpte: string;
  titol: string;
  preheader: string;
  /** HTML ya escapado: los únicos datos que entran son número, año y nombre, escapados. */
  cosHtml: string;
  nota: string;
  boto: string;
  /** A dónde lleva el botón: el enlace de firma, o null (el panel, que pone quien envía). */
  urlBoto: string | null;
  fitxer: string;
  idioma: Idioma;
}

/** Los tipos que se mandan por correo. El resto se ignora sin error. */
const TIPUS_ENVIABLES = new Set(["CONV", "RES", "CD", "CT", "CR"]);
/** Los que, además, se mandan cuando llevan enlace de firma (el albarán firmable). */
const TIPUS_AMB_SIGNATURA = new Set(["CD", "CR", "REC", "ENT"]);

function escapa(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

type Textos = { assumpte: string; titol: string; cos: string };

function textos(d: DocumentPerEnviar, l: Idioma, num: string, any: string): Textos | null {
  const ca = l === "ca";
  const sub = (d.subtipo ?? "").toLowerCase();
  switch (d.tipo) {
    case "CONV":
      if (sub === "contrafirmat") {
        return ca
          ? {
            assumpte: `El teu conveni ja és vigent · ${num}`,
            titol: "El teu conveni ja és vigent",
            cos: `La Fundació Espigoladors ha contrasignat el conveni <strong>${num}</strong>. T’adjuntem la versió definitiva, signada per les dues parts. Des d’ara ja pots operar a Redestina.`,
          }
          : {
            assumpte: `Tu convenio ya está vigente · ${num}`,
            titol: "Tu convenio ya está vigente",
            cos: `La Fundació Espigoladors ha contrafirmado el convenio <strong>${num}</strong>. Te adjuntamos la versión definitiva, firmada por las dos partes. Desde ahora ya puedes operar en Redestina.`,
          };
      }
      return ca
        ? {
          assumpte: `Hem rebut el teu conveni signat · ${num}`,
          titol: "Hem rebut el teu conveni signat",
          cos: `T’adjuntem una còpia del conveni <strong>${num}</strong> tal com l’has signat. Ara l’ha de contrasignar la Fundació Espigoladors; quan ho faci, rebràs la versió definitiva.`,
        }
        : {
          assumpte: `Hemos recibido tu convenio firmado · ${num}`,
          titol: "Hemos recibido tu convenio firmado",
          cos: `Te adjuntamos una copia del convenio <strong>${num}</strong> tal como lo has firmado. Ahora tiene que contrafirmarlo la Fundació Espigoladors; cuando lo haga, recibirás la versión definitiva.`,
        };
    case "RES": {
      const provisional = sub === "provisional";
      return ca
        ? {
          assumpte: `${provisional ? "Resum provisional" : "Resum anual"} ${any} · ${num}`,
          titol: `El resum del teu ${any}`,
          cos: `T’adjuntem el resum de les donacions que has fet a través de Redestina el ${any}: els quilos i el seu valor.${
            provisional ? " <strong>És provisional</strong>: pot canviar fins al tancament de l’exercici." : ""
          }`,
        }
        : {
          assumpte: `${provisional ? "Resumen provisional" : "Resumen anual"} ${any} · ${num}`,
          titol: `El resumen de tu ${any}`,
          cos: `Te adjuntamos el resumen de las donaciones que has hecho a través de Redestina en ${any}: los kilos y su valor.${
            provisional ? " <strong>Es provisional</strong>: puede cambiar hasta el cierre del ejercicio." : ""
          }`,
        };
    }
    case "CD":
      return textosCd(d, ca, num, any);
    case "CT":
      return ca
        ? {
          assumpte: `Certificat d’aprofitament alimentari ${any} · ${num}`,
          titol: "El teu certificat d’aprofitament alimentari",
          cos: `T’adjuntem el certificat <strong>${num}</strong> de les operacions de venda i transformació fetes a través de Redestina el ${any}.`,
        }
        : {
          assumpte: `Certificado de aprovechamiento alimentario ${any} · ${num}`,
          titol: "Tu certificado de aprovechamiento alimentario",
          cos: `Te adjuntamos el certificado <strong>${num}</strong> de las operaciones de venta y transformación hechas a través de Redestina en ${any}.`,
        };
    case "REC":
      return ca
        ? {
          assumpte: `Albarà de recepció per signar · ${num}`,
          titol: "El teu albarà de recepció",
          cos: `T’adjuntem l’albarà <strong>${num}</strong> dels aliments que has donat a la Fundació Espigoladors a través de Redestina.`,
        }
        : {
          assumpte: `Albarán de recepción para firmar · ${num}`,
          titol: "Tu albarán de recepción",
          cos: `Te adjuntamos el albarán <strong>${num}</strong> de los alimentos que has donado a la Fundació Espigoladors a través de Redestina.`,
        };
    case "ENT":
      return ca
        ? {
          assumpte: `Albarà d’entrega per signar · ${num}`,
          titol: "El teu albarà d’entrega",
          cos: `T’adjuntem l’albarà <strong>${num}</strong> dels aliments que la teva entitat ha rebut a través de Redestina.`,
        }
        : {
          assumpte: `Albarán de entrega para firmar · ${num}`,
          titol: "Tu albarán de entrega",
          cos: `Te adjuntamos el albarán <strong>${num}</strong> de los alimentos que tu entidad ha recibido a través de Redestina.`,
        };
    case "CR":
      return ca
        ? {
          assumpte: `Certificat de recepció · ${num}`,
          titol: "El teu certificat de recepció",
          cos: `T’adjuntem el certificat <strong>${num}</strong> dels quilos que la teva entitat ha rebut a través de Redestina. El pots ensenyar a qui calgui: porta un codi per verificar-lo.`,
        }
        : {
          assumpte: `Certificado de recepción · ${num}`,
          titol: "Tu certificado de recepción",
          cos: `Te adjuntamos el certificado <strong>${num}</strong> de los kilos que tu entidad ha recibido a través de Redestina. Puedes enseñarlo a quien haga falta: lleva un código para verificarlo.`,
        };
  }
  return null;
}

/**
 * El certificado de donación según su ámbito (05-11-2026): el del ejercicio, el de un periodo
 * o el de una oferta. Sin mencionar el modelo 182: el certificado es lo que el donante se
 * lleva a su declaración, y la informativa la presenta la Fundació.
 */
function textosCd(d: DocumentPerEnviar, ca: boolean, num: string, any: string): Textos {
  const datos = (d.datos ?? {}) as Record<string, unknown>;
  const abast = datos.abast === undefined && d.objeto_tipo === "cierre_periodo"
    ? "periode"
    : abastDe(datos);
  const periode = d.datos?.periode ?? null;
  const desDe = escapa(dataCurta(periode?.des_de));
  const finsA = escapa(dataCurta(periode?.fins_a));
  const titol = ca ? "El teu certificat de donació" : "Tu certificado de donación";

  if (abast === "oferta") {
    // Una oferta se recoge casi siempre en un día; si fueron varios, se dicen los dos.
    const quan = desDe && finsA && desDe !== finsA
      ? `del ${desDe} al ${finsA}`
      : (desDe || finsA ? `del ${desDe || finsA}` : "");
    return ca
      ? {
        assumpte: `Certificat de donació de la teva donació${quan ? ` ${quan}` : ""} · ${num}`,
        titol,
        cos: `T’adjuntem el certificat <strong>${num}</strong> de la donació${quan ? ` ${quan}` : ""} que has fet a la Fundació Espigoladors a través de Redestina.`,
      }
      : {
        assumpte: `Certificado de donación de tu donación${quan ? ` ${quan}` : ""} · ${num}`,
        titol,
        cos: `Te adjuntamos el certificado <strong>${num}</strong> de la donación${quan ? ` ${quan}` : ""} que has hecho a la Fundació Espigoladors a través de Redestina.`,
      };
  }
  if (abast === "periode") {
    const interval = desDe && finsA ? ` ${desDe} – ${finsA}` : "";
    return ca
      ? {
        assumpte: `Certificat de donació del període${interval} · ${num}`,
        titol,
        cos: `T’adjuntem el certificat <strong>${num}</strong> de les donacions que has fet a la Fundació Espigoladors durant el període${interval}.`,
      }
      : {
        assumpte: `Certificado de donación del periodo${interval} · ${num}`,
        titol,
        cos: `Te adjuntamos el certificado <strong>${num}</strong> de las donaciones que has hecho a la Fundació Espigoladors durante el periodo${interval}.`,
      };
  }
  return ca
    ? {
      assumpte: `Certificat de donació de l’exercici ${any} · ${num}`,
      titol,
      cos: `T’adjuntem el certificat <strong>${num}</strong> de les donacions que has fet a la Fundació Espigoladors durant l’exercici ${any}.`,
    }
    : {
      assumpte: `Certificado de donación del ejercicio ${any} · ${num}`,
      titol,
      cos: `Te adjuntamos el certificado <strong>${num}</strong> de las donaciones que has hecho a la Fundació Espigoladors durante el ejercicio ${any}.`,
    };
}

/**
 * El correo de un documento, o `null` si ese documento no se manda (tipo que no va por
 * correo, o sin destinatario en `envio`). No decide SI se puede enviar —eso son los gates
 * de §8, que aplica quien envía—, solo qué se dice.
 */
export function composaCorreuDocument(d: DocumentPerEnviar): CorreuDocument | null {
  const urlSignar = (d.urlSignar ?? "").trim() || null;
  const ambSignatura = urlSignar !== null && TIPUS_AMB_SIGNATURA.has(d.tipo);
  if (!TIPUS_ENVIABLES.has(d.tipo) && !ambSignatura) return null;
  const destinatari = (d.envio?.destinatario ?? "").trim();
  if (!destinatari) return null;

  const idioma: Idioma = d.idioma === "es" ? "es" : "ca";
  const num = escapa(d.numero_completo ?? "");
  const any = d.ejercicio != null ? String(d.ejercicio) : "";
  const t = textos(d, idioma, num, any);
  if (!t) return null;

  const prova = d.modo === "prueba";
  const ca = idioma === "ca";
  const nom = (d.envio?.nombre ?? "").trim();
  const salutacio = nom ? `${ca ? "Hola" : "Hola"} ${escapa(nom)},` : "Hola,";
  const avisProva = prova
    ? `<p style="margin:0 0 12px"><strong>${
      ca ? "Document de prova, sense cap validesa." : "Documento de prueba, sin ninguna validez."
    }</strong></p>`
    : "";

  // La invitación a firmar en línea. El enlace NO entra en el cuerpo: va solo en el botón
  // (`urlBoto`), que compone `plantillaEmail()`.
  const signa = ambSignatura
    ? `<p style="margin:12px 0 0">${
      ca
        ? "<strong>Pots signar-lo en línia</strong>: obre’l amb el botó d’aquí sota, revisa’l i signa’l amb el dit o el ratolí. També el pots imprimir, signar-lo a mà i tornar-nos-el."
        : "<strong>Puedes firmarlo en línea</strong>: ábrelo con el botón de aquí abajo, revísalo y fírmalo con el dedo o el ratón. También puedes imprimirlo, firmarlo a mano y devolvérnoslo."
    }</p>`
    : "";

  return {
    destinatari,
    assumpte: `${prova ? (ca ? "[PROVA] " : "[PRUEBA] ") : ""}${
      t.assumpte.replace(/<[^>]+>/g, "")
    }`.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
    titol: t.titol,
    preheader: t.cos.replace(/<[^>]+>/g, "").slice(0, 120),
    cosHtml: `${avisProva}<p style="margin:0 0 12px">${salutacio}</p><p style="margin:0">${t.cos}</p>${signa}`,
    nota: ca
      ? "També el tens al teu panell de Redestina, a l’apartat de documents. Guarda aquest correu: el PDF adjunt porta un codi per verificar-ne l’autenticitat."
      : "También lo tienes en tu panel de Redestina, en el apartado de documentos. Guarda este correo: el PDF adjunto lleva un código para verificar su autenticidad.",
    boto: ambSignatura
      ? (ca ? "Signa’l en línia" : "Fírmalo en línea")
      : (ca ? "Entra al teu panell" : "Entra en tu panel"),
    urlBoto: ambSignatura ? urlSignar : null,
    fitxer: `${(d.numero_completo ?? "document").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`,
    idioma,
  };
}
