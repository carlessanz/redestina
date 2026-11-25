// Lo puro de `alta-equip` (deuda 169): qué se acepta en la petición y qué correo se escribe.
// Sin red ni Deno, para probarlo desde Vitest (`tests/altaEquip.test.ts`).

import { escaparHtml, plantillaEmail } from "../_shared/resend.ts";

export type Idioma = "ca" | "es";
export type RolEquip = "super_admin" | "admin";

/** El formato mínimo de un correo: algo@algo.algo, sin espacios. El mismo que `donar-acces`. */
const RE_CORREU = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** E.164 sin «+» (§7): 8 a 15 cifras, sin cero inicial. La misma regla que `equip_editar_persona`. */
const RE_TELEFON = /^[1-9][0-9]{7,14}$/;

export const NOM_MAX = 120;

/**
 * El teléfono tal como lo guarda la base: sin «+», espacios, guiones ni paréntesis. Copia de
 * `normalitzaTelefon` de `src/lib/equip.ts` (no hay módulo hoja en `_shared/` con esta regla).
 */
export function normalitzaTelefon(s: string): string {
  return s.replace(/[\s+()-]/g, "");
}

export interface DadesAlta {
  email: string;
  nombre: string;
  /** Normalizado, o null si no se ha dado. */
  telefon: string | null;
  rol: RolEquip;
  idioma: Idioma;
}

export type Validacio =
  | { ok: true; dades: DadesAlta }
  | { ok: false; code: "correu_invalid" | "nom_buit" | "nom_massa_llarg" | "rol_invalid" | "telefon_invalid" | "idioma_invalid" };

/**
 * Lo que manda la pantalla, validado y normalizado. En este orden: correo, nombre, rol, idioma,
 * teléfono (el primero que falla es el que se devuelve).
 */
export function validaEntrada(body: unknown): Validacio {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!RE_CORREU.test(email)) return { ok: false, code: "correu_invalid" };

  const nombre = typeof b.nombre === "string" ? b.nombre.trim().replace(/\s+/g, " ") : "";
  if (!nombre) return { ok: false, code: "nom_buit" };
  if (nombre.length > NOM_MAX) return { ok: false, code: "nom_massa_llarg" };

  if (b.rol !== "super_admin" && b.rol !== "admin") return { ok: false, code: "rol_invalid" };
  const rol = b.rol;

  let idioma: Idioma = "ca";
  if (b.idioma != null && b.idioma !== "") {
    if (b.idioma !== "ca" && b.idioma !== "es") return { ok: false, code: "idioma_invalid" };
    idioma = b.idioma;
  }

  let telefon: string | null = null;
  if (b.telefon != null && b.telefon !== "") {
    if (typeof b.telefon !== "string") return { ok: false, code: "telefon_invalid" };
    const t = normalitzaTelefon(b.telefon);
    if (t !== "") {
      if (!RE_TELEFON.test(t)) return { ok: false, code: "telefon_invalid" };
      telefon = t;
    }
  }

  return { ok: true, dades: { email, nombre, telefon, rol, idioma } };
}

/** El 22023/42501 de `alta_membre_equip()`, a estado HTTP y código para la pantalla. */
export function errorAlta(sqlCode: string | null | undefined, missatge: string | null | undefined): {
  status: number;
  code: string;
} {
  if (sqlCode === "42501") return { status: 403, code: "forbidden" };
  const m = missatge ?? "";
  if (m.includes("rol_invalid")) return { status: 400, code: "rol_invalid" };
  if (m.includes("compte_equip")) return { status: 409, code: "compte_equip" };
  if (m.includes("te_membresies")) return { status: 409, code: "te_membresies" };
  if (m.includes("compte_inexistent")) return { status: 500, code: "error_intern" };
  return { status: 500, code: "error_intern" };
}

const ROL: Record<Idioma, Record<RolEquip, string>> = {
  // Los mismos nombres que la interfaz (§4bis: `super_admin` «Superadmin», `admin` «Dinamitzador»).
  ca: { super_admin: "Superadmin", admin: "Dinamitzador" },
  es: { super_admin: "Superadmin", admin: "Dinamizador" },
};

/** El nombre del rol tal como sale en el correo. */
export function nomRol(rol: RolEquip, idioma: Idioma): string {
  return ROL[idioma][rol];
}

const TEXTOS: Record<Idioma, {
  assumpte: string;
  titol: string;
  preheader: string;
  salutacio: (nom: string) => string;
  cos: (rol: string) => string;
  boto: string;
  nota: string;
  text: (nom: string, rol: string, enllac: string) => string;
}> = {
  ca: {
    assumpte: "Benvingut/da a l'equip de Redestina · Crea la teva contrasenya",
    titol: "Benvingut/da a l'equip de Redestina",
    preheader: "Tria la contrasenya del teu accés al panell de l'equip de Redestina.",
    salutacio: (nom) => `Hola ${nom},`,
    cos: (rol) =>
      `T'hem donat d'alta a l'equip de la Fundació Espigoladors a REDESTINA amb el rol de ` +
      `<strong>${rol}</strong>. Per entrar, primer crea la teva contrasenya.`,
    boto: "Crea la contrasenya",
    nota: "L'enllaç només es pot fer servir una vegada i caduca aviat. Si caduca, fes servir «He oblidat la contrasenya» a la pàgina d'accés. Si no esperaves aquest correu, pots ignorar-lo.",
    text: (nom, rol, enllac) =>
      `Hola ${nom}, t'hem donat d'alta a l'equip de Redestina amb el rol de ${rol}. ` +
      `Crea la teva contrasenya obrint aquest enllaç: ${enllac}`,
  },
  es: {
    assumpte: "Bienvenido/a al equipo de Redestina · Crea tu contraseña",
    titol: "Bienvenido/a al equipo de Redestina",
    preheader: "Elige la contraseña de tu acceso al panel del equipo de Redestina.",
    salutacio: (nom) => `Hola ${nom}:`,
    cos: (rol) =>
      `Te hemos dado de alta en el equipo de la Fundació Espigoladors en REDESTINA con el rol de ` +
      `<strong>${rol}</strong>. Para entrar, primero crea tu contraseña.`,
    boto: "Crea la contraseña",
    nota: "El enlace solo se puede usar una vez y caduca pronto. Si caduca, usa «He olvidado la contraseña» en la página de acceso. Si no esperabas este correo, puedes ignorarlo.",
    text: (nom, rol, enllac) =>
      `Hola ${nom}, te hemos dado de alta en el equipo de Redestina con el rol de ${rol}. ` +
      `Crea tu contraseña abriendo este enlace: ${enllac}`,
  },
};

export interface DadesCorreu {
  /** El enlace de recuperación de `generateLink`. Es una credencial: nunca a un log. */
  enllac: string;
  nombre: string;
  rol: RolEquip;
  idioma?: string | null;
}

/**
 * El correo de bienvenida al equipo con el enlace para crear la contraseña. El nombre se escapa
 * en el HTML; el enlace va tal cual en el botón (lo compone GoTrue).
 */
export function composaCorreu(d: DadesCorreu): { subject: string; html: string; text: string } {
  const idioma: Idioma = d.idioma === "es" ? "es" : "ca";
  const t = TEXTOS[idioma];
  const rol = nomRol(d.rol, idioma);
  const nom = d.nombre.trim();
  const html = plantillaEmail({
    titulo: t.titol,
    preheader: t.preheader,
    idioma,
    cuerpoHtml: `<p style="margin:0 0 12px">${t.salutacio(escaparHtml(nom))}</p>` +
      `<p style="margin:0">${t.cos(escaparHtml(rol))}</p>`,
    boton: { texto: t.boto, url: d.enllac },
    nota: t.nota,
  });
  return { subject: t.assumpte, html, text: t.text(nom, rol, d.enllac) };
}
