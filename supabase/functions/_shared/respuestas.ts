// Diálogo de aceptación de una entidad a una oferta.
//
// El panel, al enviar una oferta a una entidad, deja una fila 'pendent' en
// `oferta_respuestas`. Cuando la entidad responde por WhatsApp, esta función
// conduce un diálogo corto —SÍ → quants kg → (si venda/maquila) confirmar el preu
// mínim— y deja la fila lista para que el superadmin la apruebe desde el panel y
// la convierta en canalización. Devuelve true si ha gestionado el mensaje: entonces
// el webhook NO sigue con el intake, lo que da prioridad a la respuesta de oferta y
// resuelve el doble rol (un productor que también es entidad y contesta a una oferta
// se atiende aquí).
//
// Esa prioridad se mantiene, pero **condicionada a que la oferta sea la última pregunta
// que le hemos hecho**: si el intake habló después, contesta el intake. La regla, lo que
// se midió para llegar a ella y sus dos guardas están en el bloque de `atendreElDialeg()`,
// unas líneas más abajo (deuda §12.16).
//
// El estado del diálogo vive en oferta_respuestas.dialeg_pas/dialeg_dades, igual
// que intake_sessions para el intake. Mientras el diálogo está en curso la fila
// sigue 'pendent' (así el emparejamiento "última pendent del teléfono" la sigue
// encontrando); al terminar pasa a 'acceptada'/'rebutjada'.

import { sendBotones, sendText } from "./whatsapp.ts";
import { leerRespuesta } from "./intake.ts";
import { rolesDelTelefono } from "./organizacion.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

// ---------------------------------------------------------------------------
// Quién atiende el mensaje: el diálogo de la oferta o el intake (deuda §12.16)
// ---------------------------------------------------------------------------
// LA REGLA, EN UNA LÍNEA: **un mensaje contesta a la última pregunta que le hicimos.**
//
// La prioridad de siempre —oferta antes que intake— es la respuesta correcta en el caso
// normal, y no se toca: una oferta pendiente es una pregunta concreta que ya le hemos
// hecho, y el intake es un formulario que la persona empieza. Lo que estaba mal era
// aplicarla SIN MIRAR si esa pregunta seguía siendo la última.
//
// ⚠️ LO QUE SE MIDIÓ (11-09-2026). De 17 respuestas plausibles a preguntas del intake,
//    `clasificar()` resuelve 7 como sí/no, y todas ellas cerrarían la oferta pendiente de
//    un número de doble rol en vez de contestar al formulario:
//      · «no ho sé» a «quina varietat és?»        → rebutjada
//      · «No» a «alguna observació?»              → rebutjada
//      · «Sí» / «No» escritos (no polsats) en `retorn` → acceptada / rebutjada
//      · «ok matins» a «quin horari va bé?»       → acceptada
//    Y la aceptación es la cara cara: abre el paso `kg`, que **consume todos los mensajes
//    siguientes**, así que a partir de ahí el productor no puede publicar nada. El
//    diálogo, además, no caducaba nunca (el intake sí, a las 12 h), o sea que ese bloqueo
//    era permanente.
//
// Dos guardas, las dos con los datos que ya existen en la base (ninguna columna nueva):
//
//   1. **El intake tiene la palabra si habló después de enviarse la oferta.** Se compara
//      `intake_sessions.updated_at` con `oferta_respuestas.enviado_at`. Es monótono: en
//      cuanto el diálogo arranca, el intake deja de avanzar, así que la comparación no se
//      da la vuelta sola.
//   2. **El diálogo caduca a las 12 h**, las mismas que el intake. La marca de tiempo va
//      en `dialeg_dades.darrer_missatge_at`, una columna jsonb que ya existía y estaba sin
//      usar. Un diálogo caducado no resuelve la fila —sigue `pendent` para el panel—: solo
//      deja de secuestrar el número, y el mensaje se vuelve a clasificar desde cero, igual
//      que hace el intake con una sesión olvidada.
//
// La organización unificada NO decide nada aquí, y es importante: la elección no depende
// de quién escribe sino de qué se le preguntó el último. Lo que la etapa 1 aporta es poder
// **decir** que el número es de doble rol de verdad (las dos fichas comparten
// organización) en vez de deducirlo de que dos filas compartan teléfono — y eso se
// registra en el log, donde se puede auditar.

/** Un diálogo de aceptación inactivo tanto tiempo se da por olvidado (como el intake). */
export const CADUCIDAD_DIALOGO_HORAS = 12;

export interface ContextoAtencion {
  /** `oferta_respuestas.dialeg_pas`: null, 'kg', 'preu' o 'fet'. */
  pas: string | null;
  /** `oferta_respuestas.enviado_at`: cuándo se le mandó la oferta. */
  enviadoAt: string | null;
  /** `dialeg_dades.darrer_missatge_at`: último mensaje del diálogo, si lo hubo. */
  ultimoDialogoAt?: string | null;
  /** `intake_sessions.updated_at` de este teléfono, o null si no hay sesión. */
  intakeAt?: string | null;
}

export type MotivoAtencion =
  | "dialeg_en_curs"
  | "dialeg_caducat"
  | "intake_te_la_paraula"
  | "oferta_pendent";

export interface Atencion {
  /** `true` = lo atiende el diálogo de la oferta; `false` = pasa al intake. */
  dialogo: boolean;
  /** `true` si hay que reclasificar el sí/no inicial (diálogo caducado). */
  reiniciarDialogo: boolean;
  motivo: MotivoAtencion;
}

function instante(valor: string | null | undefined): number | null {
  if (!valor) return null;
  const t = new Date(valor).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Decide quién atiende el mensaje. PURA y sin red, como `canal.ts` y `priorizacion.ts`:
 * recibe los cuatro instantes y devuelve la decisión, para poder razonarla y probarla.
 */
export function atendreElDialeg(ctx: ContextoAtencion, ahora = Date.now()): Atencion {
  const enCurso = ctx.pas === "kg" || ctx.pas === "preu";
  const limite = CADUCIDAD_DIALOGO_HORAS * 3600_000;

  if (enCurso) {
    // Sin marca propia se usa el envío de la oferta: las filas anteriores a este cambio
    // no tienen `darrer_missatge_at`, y son justo las que pueden llevar meses bloqueando
    // un número. Dar por vivo lo que no se puede fechar sería conservar el problema.
    const referencia = instante(ctx.ultimoDialogoAt) ?? instante(ctx.enviadoAt);
    if (referencia === null || ahora - referencia <= limite) {
      return { dialogo: true, reiniciarDialogo: false, motivo: "dialeg_en_curs" };
    }
    // Caducado: se trata como si no hubiera diálogo, y se vuelve a mirar quién habló
    // el último antes de clasificar nada.
    if (intakeHaHabladoDespues(ctx, ahora)) {
      return { dialogo: false, reiniciarDialogo: true, motivo: "intake_te_la_paraula" };
    }
    return { dialogo: true, reiniciarDialogo: true, motivo: "dialeg_caducat" };
  }

  if (intakeHaHabladoDespues(ctx, ahora)) {
    return { dialogo: false, reiniciarDialogo: false, motivo: "intake_te_la_paraula" };
  }
  return { dialogo: true, reiniciarDialogo: false, motivo: "oferta_pendent" };
}

/** ¿La última cosa que se habló con este número fue el intake, y sigue vivo? */
function intakeHaHabladoDespues(ctx: ContextoAtencion, ahora: number): boolean {
  const intake = instante(ctx.intakeAt);
  if (intake === null) return false;
  // Una sesión olvidada no reclama nada: el intake también la descarta a las 12 h.
  if (ahora - intake > CADUCIDAD_DIALOGO_HORAS * 3600_000) return false;
  const enviado = instante(ctx.enviadoAt);
  // Sin fecha de envío no se puede afirmar que la oferta sea posterior; la oferta es la
  // pregunta explícita, así que ante la duda se queda con ella.
  if (enviado === null) return false;
  return intake > enviado;
}

// Normaliza para comparar: quita acentos, signos y espacios de más.
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // quita diacríticos: í→i, y también ç→c
    .toLowerCase()
    .replace(/[!¡.,;:·’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Afirmativos y negativos habituales (català/castellà), ya normalizados.
const AFIRMATIVOS = [
  "si", "ok", "okay", "vale", "d acord", "dacord", "accepto", "acceptu",
  "la vull", "ho vull", "vull", "correcte", "perfecte", "endavant", "si la vull",
  "si gracies", "em va be",
];
const NEGATIVOS = [
  "no", "no puc", "no la vull", "no ho vull", "no em va be", "rebutjo",
  "descarto", "ara no", "no gracies", "no interessa",
];

/**
 * Giros en los que el "si" inicial NO es un sí: es la conjunción condicional.
 *
 * `normalizar()` quita los acentos antes de comparar —hace falta para que «SI» en mayúsculas
 * funcione—, así que el `si` átono y el `sí` tónico son indistinguibles. Sin esta lista,
 * «si us plau» («por favor») se leía como una aceptación y comprometía kilos que nadie
 * había pedido.
 */
const SI_CONDICIONAL = [
  "si us plau", "si de cas", "si cal", "si pot ser", "si fos", "si poguessim",
  "si es possible", "si acaso", "si puede ser", "si hace falta", "si fuera",
];

/**
 * Frases donde el "no" inicial no niega la oferta, sino un obstáculo: son aceptaciones.
 * «No hi ha problema» se leía como rechazo, se contestaba «gràcies per contestar» y nadie
 * lo revisaba.
 */
const NO_QUE_ACEPTA = [
  "no hi ha problema", "no hi ha cap problema", "no hay problema",
  "no hay ningun problema", "no hay ningun inconveniente", "no hi ha cap inconvenient",
];

/**
 * Exportada para poder probarla: es una heurística por lista de palabras (deuda 14), o sea
 * el sitio con más probabilidad de clasificar mal un mensaje real. Sin test, esa fragilidad
 * solo se descubre cuando una entidad acepta una oferta y el sistema entiende que la rechaza.
 *
 * ⚠️ TRES CASOS QUE SE MEDIERON Y SE ARREGLARON, porque los tres cerraban mal una oferta
 * sin que nadie lo revisara —la fila queda resuelta y se contesta «gràcies per contestar»—:
 *
 *   · «si no ens va be» («sí, pero no nos va bien») se leía **acceptada**: el «no» iba en
 *     medio y no casaba por empieza/termina, pero el «si » inicial sí. Es el caro: compromete
 *     kilos que nadie pidió.
 *   · «no hi ha problema» se leía **rebutjada**, siendo una aceptación.
 *   · «si us plau» se leía **acceptada**, siendo una cortesía.
 *
 * La regla que los cubre sin inventar comprensión del lenguaje: **ante señales de los dos
 * signos, no se decide**. Devolver `null` deja el mensaje en la consola para una persona,
 * que es el resultado correcto cuando la máquina no sabe. Es preferible una fila pendiente
 * a una fila resuelta al revés.
 */
export function clasificar(texto: string): "acceptada" | "rebutjada" | null {
  const t = normalizar(texto);
  if (!t) return null;

  // Las excepciones van ANTES que todo: son frases enteras cuyo significado no se compone
  // de sus palabras sueltas.
  if (NO_QUE_ACEPTA.some((p) => t === p || t.startsWith(p + " "))) return "acceptada";
  const condicional = SI_CONDICIONAL.some((p) => t === p || t.startsWith(p + " "));

  // Solo mensajes cortos disparan por "empieza/termina por"; un párrafo largo
  // exige coincidencia exacta (que no se dará) para no crear falsos positivos.
  const corto = t.split(" ").length <= 5;
  const casa = (lista: string[]) =>
    lista.some((p) =>
      t === p || (corto && (t.startsWith(p + " ") || t.endsWith(" " + p)))
    );

  // El negativo va PRIMERO y gana: "no la vull" no debe leerse como "vull". Esto no se
  // toca; es lo que hace que las negaciones compuestas se clasifiquen bien.
  if (casa(NEGATIVOS)) return "rebutjada";

  // Un "si" condicional no cuenta como afirmación: lo que sigue es una condición, no un sí.
  if (condicional || !casa(AFIRMATIVOS)) return null;

  // Afirmativo, pero con una negación suelta por medio: «si no ens va be» es un rechazo que
  // ninguna frase de NEGATIVOS recoge —el «no» va en el centro, no al principio ni al final—
  // y que el «si » inicial convertía en aceptación. No se adivina: se deja para una persona.
  if (/(^| )no( |$)/.test(t)) return null;

  return "acceptada";
}

// Botones de confirmación del preu mínim.
const BOTONS_PREU = [
  { id: "accept:preu_si", titulo: "Sí, accepto" },
  { id: "accept:preu_no", titulo: "No" },
];

/**
 * Primer número del texto: "200", "150,5", "uns 300 kg", "1.500".
 *
 * ⚠️ EL PUNTO ES SEPARADOR DE MILLARES, no decimal, y esto es lo que se arregló aquí.
 * Antes la expresión aceptaba `[.,]` indistintamente como coma decimal, así que **«1.500 kg»
 * se leía como 1,5 kg**: una entidad que pedía tonelada y media quedaba registrada con kilo
 * y medio, y el diálogo lo daba por bueno porque `kg > 0` y no repreguntaba. En catalán y en
 * castellano el millar se escribe con punto y el decimal con coma, que es justo al revés de
 * lo que hacía el código.
 *
 * La regla, en el orden en que se aplica:
 *   · un punto seguido de EXACTAMENTE tres cifras y no seguido de más dígitos es millar y se
 *     quita — `1.500` → 1500, `12.345.678` → 12345678;
 *   · la coma siempre es decimal — `150,5` → 150.5;
 *   · un punto que no cumple lo del millar se respeta como decimal, porque quien escribe
 *     `1.5` casi seguro quiere uno y medio — no hay forma de distinguirlo, y ese caso pierde
 *     mucho menos que el otro (1,5 kg en vez de 1.500 es un error de mil veces).
 */
export function parseNumero(texto: string | null): number | null {
  const m = (texto ?? "").match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const bruto = m[0];
  // Con separador de millares reconocido, los puntos se van y la coma pasa a punto.
  const normalizado = /\d\.\d{3}(?!\d)/.test(bruto)
    ? bruto.replace(/\./g, "").replace(",", ".")
    : bruto.replace(",", ".");
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Marca de tiempo del diálogo, dentro de `dialeg_dades` (jsonb que ya existía y no se
 * usaba). Se escribe cuando el diálogo AVANZA de paso; si se queda atascado repitiendo la
 * misma pregunta, la marca no se mueve y a las 12 h el número se libera solo.
 */
function marcaDialogo(previas: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return { ...(previas ?? {}), darrer_missatge_at: new Date().toISOString() };
}

/**
 * Deja constancia de a quién se está atendiendo cuando el número tiene los dos papeles.
 *
 * No decide nada: solo hace auditable lo que hasta ahora era invisible. Y desde la etapa 1
 * de la organización unificada puede afirmar si las dos fichas son **la misma
 * organización** —comparando `organizacion_id`— en vez de deducirlo de que compartan
 * teléfono, que es lo que nunca se pudo distinguir de dos fichas con la misma centralita.
 */
async function registrarDobleRol(
  supabase: Cliente,
  telefono: string,
  motivo: MotivoAtencion,
): Promise<void> {
  try {
    const roles = await rolesDelTelefono(supabase, telefono);
    if (!roles.productor || !roles.entidad) {
      console.log(`[respuestas] ${telefono}: ${motivo}`);
      return;
    }
    const org = roles.mismaOrganizacion
      ? `organització ${roles.productor.organizacion_id}`
      : "dues organitzacions diferents amb el mateix telèfon";
    console.log(
      `[respuestas] doble rol (${org}): ${roles.productor.nombre ?? roles.productor.id} · ` +
        `${roles.entidad.nombre ?? roles.entidad.id} → ${motivo}`,
    );
  } catch (err) {
    // El log no puede romper la conversación.
    console.error("registrarDobleRol:", err instanceof Error ? err.message : String(err));
  }
}

/** Cierra la aceptación: la fila queda 'acceptada' y pendiente de aprobación. */
async function finalizarAceptacion(
  supabase: Cliente,
  from: string,
  filaId: string,
  kg: number,
  preu: number | null,
  nota: string | null,
): Promise<void> {
  const cambios: Record<string, unknown> = {
    estado: "acceptada",
    aprovacio: "pendent",
    kg_solicitados: kg,
    preu_ofert: preu,
    dialeg_pas: "fet",
    respondido_at: new Date().toISOString(),
  };
  if (nota) cambios.mensaje_respuesta = nota;
  const { error } = await supabase.from("oferta_respuestas").update(cambios).eq("id", filaId);
  if (error) console.error("oferta_respuestas finalizar:", error.message);
  await sendText(
    supabase, from,
    `Perfecte, hem registrat que en vols ${kg} kg. L'equip de Redestina ho confirmarà i ` +
      "coordinarà la recollida. 🚚",
  );
}

/** Marca la fila 'rebutjada' y cierra el diálogo. */
async function rechazar(
  supabase: Cliente,
  from: string,
  filaId: string,
  texto: string,
): Promise<void> {
  await supabase.from("oferta_respuestas").update({
    estado: "rebutjada",
    dialeg_pas: "fet",
    respondido_at: new Date().toISOString(),
    mensaje_respuesta: texto,
  }).eq("id", filaId);
  await sendText(
    supabase, from,
    "D'acord, gràcies per contestar. Ho tindrem en compte per a properes ofertes. 🙌",
  );
}

export async function procesarRespuestaOferta(
  supabase: Cliente,
  from: string,
  // deno-lint-ignore no-explicit-any
  message: any,
): Promise<boolean> {
  const { texto, id } = leerRespuesta(message);

  // Los taps interactivos que no son de este diálogo (p. ej. 'familia:' del
  // intake) no se tocan: se dejan pasar al intake.
  if (id && !id.startsWith("accept:")) return false;

  // La respuesta se vincula a la última oferta pendiente enviada a este número.
  const { data: filas } = await supabase
    .from("oferta_respuestas")
    .select("id, excedente_id, entidad_id, dialeg_pas, dialeg_dades, enviado_at")
    .eq("telefono", from)
    .eq("estado", "pendent")
    .order("enviado_at", { ascending: false })
    .limit(1);
  const fila = (filas ?? [])[0];
  if (!fila) return false;

  // ¿A quién le toca contestar este mensaje? (deuda §12.16, ver la cabecera del módulo)
  // Solo se pregunta cuando hay una oferta pendiente, que es cuando puede haber conflicto.
  const { data: sesiones } = await supabase
    .from("intake_sessions").select("updated_at").eq("telefono", from)
    .order("updated_at", { ascending: false }).limit(1);
  const atencion = atendreElDialeg({
    pas: fila.dialeg_pas ?? null,
    enviadoAt: fila.enviado_at ?? null,
    ultimoDialogoAt: (fila.dialeg_dades ?? {}).darrer_missatge_at ?? null,
    intakeAt: (sesiones ?? [])[0]?.updated_at ?? null,
  });

  if (!atencion.dialogo || atencion.reiniciarDialogo) {
    await registrarDobleRol(supabase, from, atencion.motivo);
  }
  if (!atencion.dialogo) return false;

  // Un diálogo caducado se reclasifica desde cero: la fila sigue `pendent`, pero deja de
  // consumir todo lo que escriba este número.
  const pas: string | null = atencion.reiniciarDialogo ? null : (fila.dialeg_pas ?? null);

  // ---- Paso: quants kg ----
  if (pas === "kg") {
    // Cambio de idea: un "no" claro cancela la aceptación.
    if (clasificar(texto ?? "") === "rebutjada") {
      await rechazar(supabase, from, fila.id, texto ?? "");
      return true;
    }
    const kg = parseNumero(texto);
    if (kg === null || kg <= 0) {
      await sendText(supabase, from, "Escriu quants kg en vols, només el número (p. ex. 200).");
      return true;
    }
    const { data: exc } = await supabase
      .from("excedentes").select("modalitat, preu_minim").eq("id", fila.excedente_id).maybeSingle();
    const conPreu = !!exc && (exc.modalitat === "venda" || exc.modalitat === "maquila") &&
      exc.preu_minim != null;
    if (conPreu) {
      await supabase.from("oferta_respuestas")
        .update({ kg_solicitados: kg, dialeg_pas: "preu", dialeg_dades: marcaDialogo(fila.dialeg_dades) })
        .eq("id", fila.id);
      await sendBotones(
        supabase, from,
        `El preu mínim d'aquesta oferta és ${Number(exc.preu_minim)} €/kg. Hi estàs d'acord?`,
        BOTONS_PREU,
      );
      return true;
    }
    await finalizarAceptacion(supabase, from, fila.id, kg, null, null);
    return true;
  }

  // ---- Paso: confirmar preu (botones, o un sí/no de texto) ----
  if (pas === "preu") {
    const acepta = id === "accept:preu_si" || clasificar(texto ?? "") === "acceptada";
    const rechaza = id === "accept:preu_no" || clasificar(texto ?? "") === "rebutjada";
    if (!acepta && !rechaza) {
      await sendBotones(
        supabase, from, "Tria una opció: hi estàs d'acord amb el preu mínim?", BOTONS_PREU,
      );
      return true;
    }
    const { data: f2 } = await supabase
      .from("oferta_respuestas").select("kg_solicitados").eq("id", fila.id).maybeSingle();
    const kg = Number(f2?.kg_solicitados ?? 0);
    if (acepta) {
      const { data: exc } = await supabase
        .from("excedentes").select("preu_minim").eq("id", fila.excedente_id).maybeSingle();
      await finalizarAceptacion(supabase, from, fila.id, kg, Number(exc?.preu_minim ?? 0), null);
    } else {
      await finalizarAceptacion(
        supabase, from, fila.id, kg, null,
        "L'entitat no accepta el preu mínim (a revisar per l'equip).",
      );
    }
    return true;
  }

  // ---- Sin diálogo iniciado: clasificar el sí/no inicial ----
  const inicial = clasificar(texto ?? "");
  if (!inicial) return false;

  if (inicial === "rebutjada") {
    await rechazar(supabase, from, fila.id, texto ?? "");
    return true;
  }

  // Aceptación: arranca el diálogo pidiendo kg (la fila sigue 'pendent' para que
  // el próximo mensaje la vuelva a emparejar).
  const { data: exc } = await supabase
    .from("excedentes").select("kg_total").eq("id", fila.excedente_id).maybeSingle();
  const { data: cans } = await supabase
    .from("canalizaciones").select("kg_confirmados").eq("excedente_id", fila.excedente_id);
  const usados = (cans ?? []).reduce(
    (s: number, c: { kg_confirmados: number | null }) => s + Number(c.kg_confirmados ?? 0), 0);
  const disp = Math.max(0, Number(exc?.kg_total ?? 0) - usados);

  await supabase.from("oferta_respuestas")
    .update({ dialeg_pas: "kg", mensaje_respuesta: texto, dialeg_dades: marcaDialogo(fila.dialeg_dades) })
    .eq("id", fila.id);
  await sendText(
    supabase, from,
    `Perfecte! Quants kg en vols?${disp ? ` (disponibles: ${disp} kg aprox)` : ""} ` +
      "Escriu un número.",
  );
  return true;
}
