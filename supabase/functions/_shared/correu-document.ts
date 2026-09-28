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
  fitxer: string;
  idioma: Idioma;
}

/** Los tipos que se mandan por correo. El resto se ignora sin error. */
const TIPUS_ENVIABLES = new Set(["CONV", "RES", "CD", "CT", "CR"]);

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
      if (d.objeto_tipo === "cierre_periodo") {
        return ca
          ? {
            assumpte: `Certificat de donació · ${num}`,
            titol: "El teu certificat de donació",
            cos: `T’adjuntem el certificat <strong>${num}</strong> de les donacions del període que ens vas demanar.`,
          }
          : {
            assumpte: `Certificado de donación · ${num}`,
            titol: "Tu certificado de donación",
            cos: `Te adjuntamos el certificado <strong>${num}</strong> de las donaciones del periodo que nos pediste.`,
          };
      }
      return ca
        ? {
          assumpte: `Certificat de donació ${any} · ${num}`,
          titol: "El teu certificat de donació",
          cos: `T’adjuntem el certificat <strong>${num}</strong> de les donacions que has fet a la Fundació Espigoladors el ${any}.`,
        }
        : {
          assumpte: `Certificado de donación ${any} · ${num}`,
          titol: "Tu certificado de donación",
          cos: `Te adjuntamos el certificado <strong>${num}</strong> de las donaciones que has hecho a la Fundació Espigoladors en ${any}.`,
        };
    case "CT":
      return ca
        ? {
          assumpte: `Certificat de transacció ${any} · ${num}`,
          titol: "El teu certificat de transacció",
          cos: `T’adjuntem el certificat <strong>${num}</strong> de les operacions de venda i transformació fetes a través de Redestina el ${any}.`,
        }
        : {
          assumpte: `Certificado de transacción ${any} · ${num}`,
          titol: "Tu certificado de transacción",
          cos: `Te adjuntamos el certificado <strong>${num}</strong> de las operaciones de venta y transformación hechas a través de Redestina en ${any}.`,
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
 * El correo de un documento, o `null` si ese documento no se manda (tipo que no va por
 * correo, o sin destinatario en `envio`). No decide SI se puede enviar —eso son los gates
 * de §8, que aplica quien envía—, solo qué se dice.
 */
export function composaCorreuDocument(d: DocumentPerEnviar): CorreuDocument | null {
  if (!TIPUS_ENVIABLES.has(d.tipo)) return null;
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

  return {
    destinatari,
    assumpte: `${prova ? (ca ? "[PROVA] " : "[PRUEBA] ") : ""}${
      t.assumpte.replace(/<[^>]+>/g, "")
    }`.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
    titol: t.titol,
    preheader: t.cos.replace(/<[^>]+>/g, "").slice(0, 120),
    cosHtml: `${avisProva}<p style="margin:0 0 12px">${salutacio}</p><p style="margin:0">${t.cos}</p>`,
    nota: ca
      ? "També el tens al teu panell de Redestina, a l’apartat de documents. Guarda aquest correu: el PDF adjunt porta un codi per verificar-ne l’autenticitat."
      : "También lo tienes en tu panel de Redestina, en el apartado de documentos. Guarda este correo: el PDF adjunto lleva un código para verificar su autenticidad.",
    boto: ca ? "Entra al teu panell" : "Entra en tu panel",
    fitxer: `${(d.numero_completo ?? "document").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`,
    idioma,
  };
}
