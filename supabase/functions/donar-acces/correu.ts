// Lo puro de `donar-acces` (plan 1, 1D): qué correo se usa y qué se escribe. Sin red ni
// Deno, para probarlo desde Vitest (`tests/donarAcces.test.ts`).

import { escaparHtml, plantillaEmail } from "../_shared/resend.ts";

export type Idioma = "ca" | "es";

/** El formato mínimo de un correo: algo@algo.algo, sin espacios. El mismo que la RPC. */
const RE_CORREU = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type CorreuResolt =
  | { ok: true; email: string }
  | { ok: false; code: "falta_correu" | "correus_diferents" | "correu_invalid" };

/**
 * El correo al que se da acceso. El que manda la pantalla, si lo manda; si no, el de las
 * fichas ACTIVAS cuando todas dicen lo mismo. Con dos correos distintos no se elige por nadie:
 * la pantalla tiene que decir cuál (y `concedir_acces_org` lo escribe en las dos).
 */
export function resoldreCorreu(demanat: unknown, deLesFitxes: (string | null | undefined)[]): CorreuResolt {
  const net = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  let email = net(demanat);
  if (!email) {
    const distints = [...new Set(deLesFitxes.map(net).filter(Boolean))];
    if (distints.length === 0) return { ok: false, code: "falta_correu" };
    if (distints.length > 1) return { ok: false, code: "correus_diferents" };
    email = distints[0];
  }
  return RE_CORREU.test(email) ? { ok: true, email } : { ok: false, code: "correu_invalid" };
}

const TEXTOS: Record<Idioma, {
  assumpte: string;
  titol: string;
  preheader: string;
  salutacio: (nom: string | null) => string;
  cos: (org: string | null) => string;
  boto: string;
  nota: string;
  text: (enllac: string) => string;
}> = {
  ca: {
    assumpte: "Benvingut/da a REDESTINA · Estableix la teva contrasenya",
    titol: "Benvingut/da a REDESTINA",
    preheader: "Tria la contrasenya del teu accés a la plataforma de Redestina.",
    salutacio: (nom) => (nom ? `Hola ${nom},` : "Hola,"),
    cos: (org) =>
      `L'equip de la Fundació Espigoladors t'ha donat accés a la plataforma de REDESTINA` +
      (org ? ` en nom de <strong>${org}</strong>` : "") +
      `. Per entrar, primer tria la teva contrasenya.`,
    boto: "Estableix la contrasenya",
    nota: "L'enllaç només es pot fer servir una vegada i caduca aviat. Si caduca, demana a l'equip que te'l torni a enviar. Si no esperaves aquest correu, pots ignorar-lo.",
    text: (enllac) => `Benvingut/da a REDESTINA. Tria la teva contrasenya obrint aquest enllaç: ${enllac}`,
  },
  es: {
    assumpte: "Bienvenido/a a REDESTINA · Establece tu contraseña",
    titol: "Bienvenido/a a REDESTINA",
    preheader: "Elige la contraseña de tu acceso a la plataforma de Redestina.",
    salutacio: (nom) => (nom ? `Hola ${nom}:` : "Hola:"),
    cos: (org) =>
      `El equipo de la Fundació Espigoladors te ha dado acceso a la plataforma de REDESTINA` +
      (org ? ` en nombre de <strong>${org}</strong>` : "") +
      `. Para entrar, primero elige tu contraseña.`,
    boto: "Establecer la contraseña",
    nota: "El enlace solo se puede usar una vez y caduca pronto. Si caduca, pide al equipo que te lo vuelva a enviar. Si no esperabas este correo, puedes ignorarlo.",
    text: (enllac) => `Bienvenido/a a REDESTINA. Elige tu contraseña abriendo este enlace: ${enllac}`,
  },
};

export interface DadesCorreu {
  /** El enlace de recuperación de `generateLink`. Es una credencial: nunca a un log. */
  enllac: string;
  idioma?: string | null;
  /** La persona de contacto de la ficha, si la hay. */
  nom?: string | null;
  /** El nombre de la organización, si lo hay. */
  organitzacio?: string | null;
}

/**
 * El correo de bienvenida con el enlace para poner la contraseña. Sin código de 6 cifras: es un
 * enlace de recuperación (`type: 'recovery'`), no un acceso mágico. Los datos de la ficha se
 * escapan; el enlace va tal cual en el botón (lo compone GoTrue).
 */
export function composaCorreu(d: DadesCorreu): { subject: string; html: string; text: string } {
  const idioma: Idioma = d.idioma === "es" ? "es" : "ca";
  const t = TEXTOS[idioma];
  const nom = d.nom?.trim() ? escaparHtml(d.nom.trim()) : null;
  const org = d.organitzacio?.trim() ? escaparHtml(d.organitzacio.trim()) : null;
  const html = plantillaEmail({
    titulo: t.titol,
    preheader: t.preheader,
    idioma,
    cuerpoHtml: `<p style="margin:0 0 12px">${t.salutacio(nom)}</p><p style="margin:0">${t.cos(org)}</p>`,
    boton: { texto: t.boto, url: d.enllac },
    nota: t.nota,
  });
  return { subject: t.assumpte, html, text: t.text(d.enllac) };
}

/** El código 22023 de `concedir_acces_org()`, a estado HTTP y código para la pantalla. */
export function errorConcedir(missatge: string | null | undefined): { status: number; code: string } {
  const m = missatge ?? "";
  for (const code of [
    "entitat_inactiva", "registre_pendent", "compte_equip", "compte_en_altra_org",
    "altre_compte_actiu", "organitzacio_inexistent",
  ]) {
    if (m.includes(code)) return { status: code === "organitzacio_inexistent" ? 404 : 409, code };
  }
  if (m.includes("correu_invalid")) return { status: 400, code: "correu_invalid" };
  // `productores.email` es único: el correo ya es de otra ficha de productor.
  if (/duplicate key|23505|unique/i.test(m)) return { status: 409, code: "dades_en_us" };
  return { status: 500, code: "error_intern" };
}
