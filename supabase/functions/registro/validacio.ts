// La validación del cuerpo del alta: lo único que decide qué llega a la base. Separado de
// `index.ts` el 07-10-2026 sin cambiar una línea de lógica.

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------
export const ROLS = ["productor", "receptor"] as const;
export const TIPUS_RECEPTOR = ["social", "animal", "transformador", "comercial"] as const;

export type Rol = typeof ROLS[number];

export interface Dades {
  /**
   * Los papeles que estrena esta organización. **Puede ser más de uno**: hasta el
   * 16-09-2026 el registro obligaba a elegir productor O receptora, y quien era las dos
   * cosas —que es el caso normal de media docena de organizaciones reales— tenía que
   * registrarse dos veces, con dos correos, y acababa con dos organizaciones distintas
   * que el equipo luego tenía que fusionar a mano con `enllacar_organitzacio()`. Ahora
   * las dos fichas nacen **bajo la misma `organizaciones`**, que es exactamente lo que
   * el índice único parcial de esa tabla permite: una ficha de cada tipo, no más.
   */
  rols: Rol[];
  nomOrganitzacio: string;
  nomPersona: string;
  email: string;
  password: string;
  /** Obligatorio desde el 16-09-2026: sin teléfono, WhatsApp no alcanza a la organización. */
  telefon: string;
  poblacio: string | null;
  tipoReceptor: string | null;
  // --- fase 2: lo que el convenio necesita de la ficha, y quién lo firma
  nif: string | null;
  domicili: string | null;
  codiPostal: string | null;
  representant: string | null;
  carrec: string | null;
  /** `true` = la persona que registra dice ser la representante legal y firma ya. */
  firmarAra: boolean;
  /** Correo de quien firmará, si no es quien registra. */
  emailSignant: string | null;
}

export type Validacio = { ok: true; dades: Dades } | { ok: false; camp: string; error: string };

export function textNet(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Escapa los comodines de LIKE antes de usar el valor como patrón de `ilike`.
 * No es cosmético: el '_' es corriente en un correo (`joan_puig@…`) y sin escapar
 * casaría con cualquier carácter, dando por duplicado un alta que no lo es.
 */
export function patroLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (c) => "\\" + c);
}

export function validar(body: Record<string, unknown>): Validacio {
  // `rols` es lo nuevo; `rol` se sigue aceptando porque el contrato es público y una
  // pantalla vieja servida desde una caché no tiene por qué romperse en el alta.
  const brut = Array.isArray(body.rols)
    ? body.rols
    : (textNet(body.rol) ? [body.rol] : []);
  const rols = [...new Set(brut.map((r) => textNet(r)))] as Rol[];
  if (rols.length === 0 || rols.some((r) => !ROLS.includes(r))) {
    return { ok: false, camp: "rol", error: "Cal triar si ets productor, receptor o totes dues coses" };
  }

  const nomOrganitzacio = textNet(body.nom_organitzacio);
  if (nomOrganitzacio.length < 2 || nomOrganitzacio.length > 120) {
    return { ok: false, camp: "nom_organitzacio", error: "El nom de l'organitzacio ha de tenir entre 2 i 120 caracters" };
  }

  const nomPersona = textNet(body.nom_persona);
  if (nomPersona.length < 2 || nomPersona.length > 120) {
    return { ok: false, camp: "nom_persona", error: "El nom de la persona ha de tenir entre 2 i 120 caracters" };
  }

  const email = textNet(body.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return { ok: false, camp: "email", error: "El correu no es valid" };
  }

  const password = typeof body.password === "string" ? body.password : "";
  // 6 es el mínimo que acepta GoTrue (auth.minimum_password_length en config.toml):
  // pedir menos aquí solo serviría para que el error lo diera la Admin API.
  if (password.length < 6) {
    return { ok: false, camp: "password", error: "La contrasenya ha de tenir com a minim 6 caracters" };
  }

  // 🔴 EL TELÉFONO ES OBLIGATORIO desde el 16-09-2026. Era opcional, y eso dejaba entrar
  // organizaciones a las que **el canal principal del producto no puede alcanzar**: sin
  // móvil no hay intake, ni recordatorio, ni oferta por WhatsApp, y la ficha nace muda sin
  // que nada lo diga. Pedido por el cliente: «quitar opcional del registro, porque si no el
  // WhatsApp no va a funcionar».
  //
  // ⚠️ Se exige TENERLO, no que sea un móvil: `esMovil()` descarta los fijos españoles
  //    (§8bis), pero fuera de España el prefijo no lo dice, y rechazar aquí un número
  //    extranjero legítimo sería peor que aceptarlo y que lo decida la política de canal.
  const telBrut = textNet(body.telefon);
  const telNet = telBrut.replace(/\D/g, "");
  if (!telNet) {
    return { ok: false, camp: "telefon", error: "Cal un telefon de contacte" };
  }
  if (!/^[1-9]\d{6,14}$/.test(telNet)) {
    return { ok: false, camp: "telefon", error: "El telefon no es valid" };
  }
  const telefon: string = telNet;

  // La POBLACIÓN ya no se pide en el alta (16-09-2026): se rellena después, desde la ficha,
  // donde se elige de la lista real de municipios junto con el domicilio y el código postal.
  // Preguntarla en la puerta obligaba a teclearla a mano y sin validar, y luego había que
  // corregirla igualmente. **Se sigue ACEPTANDO** por si llega de una pantalla vieja servida
  // desde una caché: el contrato es público.
  const poblacioBruta = textNet(body.poblacio);
  if (poblacioBruta.length > 120) {
    return { ok: false, camp: "poblacio", error: "La poblacio es massa llarga" };
  }
  const poblacio = poblacioBruta || null;

  // `tipo_receptor` decide qué ofertas verá (matriz modalitat_receptor_compat), así
  // que es obligatorio para un receptor; en un productor no significa nada y se
  // rechaza en vez de ignorarse, para que un formulario mal cableado se note.
  const tipoBrut = textNet(body.tipo_receptor);
  let tipoReceptor: string | null = null;
  if (rols.includes("receptor")) {
    if (!(TIPUS_RECEPTOR as readonly string[]).includes(tipoBrut)) {
      return { ok: false, camp: "tipo_receptor", error: "Cal triar quin tipus de receptor ets" };
    }
    tipoReceptor = tipoBrut;
  } else if (tipoBrut) {
    return { ok: false, camp: "tipo_receptor", error: "Un productor no te tipus de receptor" };
  }

  // -------------------------------------------------------------------------
  // Fase 2: los datos del convenio. TODOS opcionales, y no es una laxitud.
  // -------------------------------------------------------------------------
  // `preparar_convenio()` no exige ficha completa a propósito (§3.2.6, paso 2): lo que
  // falte se pide en la página de firma, y descubrir qué falta es justo lo que la campaña
  // quiere. Exigir el NIF aquí convertiría un formulario de alta en una gestoría y dejaría
  // fuera a quien no lo tenga a mano.
  const corto = (v: unknown, max: number) => textNet(v).slice(0, max) || null;
  const nif = corto(body.nif, 20);
  const domicili = corto(body.domicili ?? body.domicilio, 200);
  const codiPostal = corto(body.codi_postal ?? body.codigo_postal, 10);
  const representant = corto(body.representant ?? body.representante, 120);
  const carrec = corto(body.carrec ?? body.cargo, 120);

  const firmarAra = body.firmar_ara === true;
  let emailSignant: string | null = null;
  const signantBrut = textNet(body.email_signant).toLowerCase();
  if (signantBrut) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signantBrut) || signantBrut.length > 200) {
      return { ok: false, camp: "email_signant", error: "El correu de qui signa no es valid" };
    }
    emailSignant = signantBrut;
  }
  if (firmarAra && emailSignant && emailSignant !== email) {
    return {
      ok: false,
      camp: "email_signant",
      error: "O signes tu ara mateix o indiques el correu d'una altra persona, no les dues coses",
    };
  }

  return {
    ok: true,
    dades: {
      rols, nomOrganitzacio, nomPersona, email, password, telefon, poblacio, tipoReceptor,
      nif, domicili, codiPostal, representant, carrec, firmarAra, emailSignant,
    },
  };
}
