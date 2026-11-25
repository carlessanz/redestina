// El texto de una oferta, sin red ni Deno: lo que se publica en el grupo y se manda a las
// entidades. Vivía en `oferta.ts`, que importa el cliente de WhatsApp y el de correo; aquí
// queda como módulo «hoja» (27-10-2026) para que el panel del equipo pueda componer y copiar
// EXACTAMENTE el mismo texto que el servidor, importándolo y no copiándolo (§7, la regla de
// los módulos hoja; lo vigila `tests/puresa.test.ts`). `oferta.ts` lo reexporta, así que
// nadie que ya lo usaba cambia su import.

import { textCausa } from "./causes.ts";
import { ambPreu, etiquetaModalitats, modalitatsDe } from "./modalitats.ts";

/** Lo que el texto necesita y la fila de `excedentes` no tiene: nombres resueltos en la base. */
export interface ContextTextOferta {
  /** El nombre de la organización (`empresa`, o `name` de respaldo). */
  productor: string;
  /** El municipio del lugar o, si no, el de la ficha. */
  municipi: string;
  /** El enlace de Maps del LUGAR (el propio de la oferta, `gmaps_url`, manda sobre él). */
  mapsLloc?: string | null;
  /** Nombre de la causa y de la subcausa, ya resueltos contra el catálogo. */
  causa?: string | null;
  subcausa?: string | null;
  /**
   * La fecha límite tal como la escribió quien la dio, para cuando `disponible_hasta` no se pudo
   * leer como fecha (un «finals de juliol» por WhatsApp). Con fecha, se imprime la fecha.
   */
  disponibleText?: string | null;
}

/**
 * 🔴 EL texto de una oferta a partir de su FILA (fase C del punto 3, 17-11-2026): una sola
 * función para el alta, la publicación de un esborrany y la edición, así que el mensaje que se
 * comparte dice siempre lo que dice la fila (fila 3.7.4 del Excel). Pura: la prueban
 * `tests/oferta.test.ts` y `tests/edicioOferta.test.ts`.
 */
export function textoOfertaDeDades(fila: Record<string, unknown>, ctx: ContextTextOferta): string {
  const modalitats = modalitatsDe(
    Array.isArray(fila.modalitats) && fila.modalitats.length > 0 ? fila.modalitats : fila.modalitat,
  );
  const kg = Number(fila.kg_total ?? 0);
  const preu = ambPreu(modalitats) && fila.preu_minim != null && fila.preu_minim !== ""
    ? Number(fila.preu_minim) : null;
  const data = typeof fila.disponible_hasta === "string" && /^\d{4}-\d{2}-\d{2}/.test(fila.disponible_hasta)
    ? fila.disponible_hasta.slice(0, 10).split("-").reverse().join("/")
    : String(ctx.disponibleText ?? "").trim();
  const mapsPropi = typeof fila.gmaps_url === "string" && /^https?:\/\/\S+$/i.test(fila.gmaps_url.trim())
    ? fila.gmaps_url.trim() : "";
  return componerTextoOferta({
    producte: String(fila.producto ?? ""),
    varietat: fila.variedad ? String(fila.variedad) : undefined,
    producteAlCamp: fila.producte_al_camp === true,
    espigolada: fila.espigolada_demanada === true,
    productor: ctx.productor,
    municipi: ctx.municipi,
    ubicacio: mapsPropi || ctx.mapsLloc || undefined,
    // Con coma decimal, como se escribe en catalán.
    quantitat: kg > 0 ? `${String(kg).replace(".", ",")} kg aprox` : undefined,
    disponible: data || undefined,
    dies: textDies(fila.dies_recollida) || undefined,
    horari: fila.horari_recollida ? String(fila.horari_recollida) : undefined,
    modalitat: modalitats.length > 0 ? etiquetaModalitats(modalitats) : undefined,
    preu: preu != null && Number.isFinite(preu) ? `${preu.toFixed(2).replace(".", ",")} €/kg` : undefined,
    causa: ctx.causa ?? (fila.causa ? String(fila.causa) : undefined),
    subcausa: ctx.subcausa ?? undefined,
    envasos: textoEnvasos(
      fila.format_entrega, fila.retorn_envasos, fila.retorn_envasos_detall,
      fila.retorn_envasos_quantitat, fila.num_caixes,
    ) || undefined,
    observacions: fila.observacions ? String(fila.observacions) : undefined,
  });
}

/**
 * Texto que se publica en el grupo de canalizaciones y que se comparte (botón «Comparteix»).
 * Reproduce el formato que el equipo usa hoy a mano, emojis incluidos.
 *
 * 🔴 NINGUNA LÍNEA CON LA ETIQUETA VACÍA (punto 3, fase C, filas 3.7.5 y 3.7.6 del Excel de la
 *    Fundació, 17-11-2026): un campo sin valor no imprime su línea. Hasta entonces
 *    `responsable` y `observacions` se imprimían siempre (una etiqueta vacía «se lee como no hi
 *    ha»); la Fundació pide lo contrario y quitar «RESPONSABLE» del todo. Fuera también la
 *    línea de TRANSPORTE (la pregunta está oculta desde la fase A).
 *
 * Orden de la fila 3.7.6: producto, productor, municipio, punto de recogida (enlace), cantidad,
 * fecha límite, horario (días y franja), modalidad, precio mínimo (solo con venta, lo decide quien
 * llama), causa, envases y observaciones.
 */
export function componerTextoOferta(campos: {
  producte: string;
  /** La variedad va con el producto, entre paréntesis. */
  varietat?: string;
  /** Solo cuando es cierto se imprime la línea: el silencio significa «ja està collit». */
  producteAlCamp?: boolean;
  /**
   * Es una ESPIGOLADA (`espigolada_demanada`, fase 3): una donación más, pero la línea del campo
   * lo dice, porque quien la recoge también la cosecha (la entidad o su voluntariado).
   */
  espigolada?: boolean;
  productor?: string;
  municipi?: string;
  /** El enlace de Maps (el propio de la oferta o, si no, el del lugar). */
  ubicacio?: string;
  quantitat?: string;
  disponible?: string;
  /** Días de recogida ya compuestos (`textDies`). Van en la línea del horario. */
  dies?: string;
  /** La franja en texto («de 8:00 a 12:00»). */
  horari?: string;
  modalitat?: string;
  /** Solo con venta (quien llama lo decide con `ambPreu`). */
  preu?: string;
  causa?: string;
  /** La subcausa (fase B del punto 3): con ella, «CAUSA: Categoria — Subcausa». */
  subcausa?: string;
  /** Formato, cantidad y retorno, ya compuestos (`textoEnvasos`). */
  envasos?: string;
  observacions?: string;
}): string {
  const ple = (v: string | undefined | null): v is string => typeof v === "string" && v.trim() !== "";
  const varietat = ple(campos.varietat) ? ` (${campos.varietat.trim()})` : "";
  const lineas = [
    "📢 *OFERTA DISPONIBLE*",
    "",
    `🌿 PRODUCTE: ${campos.producte}${varietat}`,
  ];
  // Va pegada al producto porque califica QUÉ se ofrece: la entidad tiene que saber que
  // todavía no está collit antes de decir que le interesa.
  if (campos.espigolada) {
    lineas.push("🌱 ESPIGOLADA: el producte és al camp i el cull qui el reculli (entitat o voluntariat)");
  } else if (campos.producteAlCamp) {
    lineas.push("🌱 PRODUCTE AL CAMP: sí (encara no s'ha collit)");
  }
  if (ple(campos.productor)) lineas.push(`👩‍🌾 PRODUCTOR: ${campos.productor}`);
  if (ple(campos.municipi)) lineas.push(`📍 MUNICIPI: ${campos.municipi}`);
  // El enlace en su propia línea: así WhatsApp y el correo lo hacen pulsable entero.
  if (ple(campos.ubicacio)) lineas.push("🗺️ PUNT DE RECOLLIDA:", campos.ubicacio.trim());
  if (ple(campos.quantitat)) lineas.push(`📦 QUANTITAT: ${campos.quantitat}`);
  if (ple(campos.disponible)) lineas.push(`📅 DISPONIBLE FINS: ${campos.disponible}`);
  const horari = [campos.dies, campos.horari].filter(ple).map((x) => x.trim()).join(" · ");
  if (horari) lineas.push(`⏰ HORARI DE RECOLLIDA: ${horari}`);
  if (ple(campos.modalitat)) lineas.push(`💰 MODALITAT: ${campos.modalitat}`);
  if (ple(campos.preu)) lineas.push(`💶 PREU MÍNIM: ${campos.preu}`);
  if (ple(campos.causa)) lineas.push(`🔴 CAUSA: ${textCausa(campos.causa, campos.subcausa)}`);
  if (ple(campos.envasos)) lineas.push(`♻️ ENVASOS: ${campos.envasos}`);
  if (ple(campos.observacions)) lineas.push(`📝 OBSERVACIONS: ${campos.observacions.trim()}`);
  lineas.push("", TANCAMENT_BOT);
  return lineas.join("\n");
}

/** El cierre que guarda `texto_oferta`: el del bot, que pone los botones «M'interessa / Ara no». */
export const TANCAMENT_BOT = "✅ Si t'interessa, prem *M'interessa* (o respon *SÍ*); si no, *Ara no*.";

/**
 * El texto de la oferta para COPIARLO a mano (grupo o mensaje individual, fase 4 de los puntos
 * 4-6, Excel 4.2): cambia el cierre del bot —que fuera de su conversación no tiene botones— por
 * uno que se puede cumplir. Con enlace, a la oferta en el panel de la entidad; sin él, que
 * responda al mensaje. Si el texto no termina en el cierre del bot (uno antiguo o editado), se
 * le añade el nuevo igualmente.
 */
export function textOfertaPerCopiar(texto: string, enllac?: string | null): string {
  const cos = texto.trimEnd();
  const base = cos.endsWith(TANCAMENT_BOT) ? cos.slice(0, -TANCAMENT_BOT.length).trimEnd() : cos;
  const url = typeof enllac === "string" ? enllac.trim() : "";
  const tancament = url
    ? `✅ Si t'interessa, obre l'enllaç i indica els kg que vols recollir, el dia i l'hora de recollida:\n${url}`
    : "✅ Si t'interessa, respon aquest missatge amb els kg que vols recollir, el dia i l'hora de recollida.";
  return `${base}\n\n${tancament}`;
}

// ---------------------------------------------------------------------------
// Ofertas MULTIPRODUCTO (proceso 3.3, fase 6a, 25-11-2026): UN mensaje por disponibilidad
// ---------------------------------------------------------------------------

/** Los productos de un grupo en una frase: «Tomàquet, Pebrot i Albergínia». */
export function llistaProductes(noms: readonly string[]): string {
  const n = noms.map((x) => x.trim()).filter(Boolean);
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} i ${n[n.length - 1]}`;
}

/** El enlace ÚNICO de una disponibilidad: el Mercat del receptor con el diálogo de solicitud. */
export function enllacDisponibilitat(appUrl: string, disponibilitatId: string): string {
  return `${appUrl.replace(/\/+$/, "")}/receptor/mercat?disponibilitat=${encodeURIComponent(disponibilitatId)}`;
}

/** Lo que el texto de una disponibilidad necesita además del de una oferta. */
export interface ContextTextDisponibilitat extends ContextTextOferta {
  /** `disponibilitats.id`: va en el enlace. */
  disponibilitatId: string;
  /** La URL pública de la aplicación (`APP_URL` en el servidor, `window.location.origin` en el panel). */
  appUrl: string;
}

/** El cierre del mensaje de grupo: no hay diálogo del bot, se responde por el enlace. */
export function tancamentDisponibilitat(url: string): string {
  return `✅ Si t'interessa, obre l'enllaç, tria els productes i indica els kg que vols recollir, el dia i l'hora de recollida:\n${url}`;
}

function modalitatsFila(fila: Record<string, unknown>) {
  return modalitatsDe(
    Array.isArray(fila.modalitats) && fila.modalitats.length > 0 ? fila.modalitats : fila.modalitat,
  );
}

/** «300 kg aprox» con la coma decimal; vacío sin kilos. */
function kgText(v: unknown): string {
  const kg = Number(v ?? 0);
  return Number.isFinite(kg) && kg > 0 ? `${String(kg).replace(".", ",")} kg aprox` : "";
}

/**
 * La línea de un producto del grupo: «• Tomàquet (Cor de bou): 300 kg aprox (12 caixes) · 0,80 €/kg».
 * El precio, solo si ESA oferta incluye venta; la modalidad, solo si no es la misma que la del
 * grupo (`modalitatComuna`), que va en su propia línea.
 */
function liniaProducteText(fila: Record<string, unknown>, modalitatComuna: string): string {
  const varietat = fila.variedad ? ` (${String(fila.variedad).trim()})` : "";
  const parts: string[] = [];
  const kg = kgText(fila.kg_total);
  const n = Number(fila.num_caixes);
  const caixes = (fila.format_entrega === "caixes" || fila.format_entrega === "palet") && Number.isInteger(n) && n > 0
    ? ` (${textCaixes(n, fila.format_entrega)})` : "";
  if (kg) parts.push(`${kg}${caixes}`);
  const ms = modalitatsFila(fila);
  const preu = ambPreu(ms) && fila.preu_minim != null && fila.preu_minim !== "" ? Number(fila.preu_minim) : null;
  if (preu != null && Number.isFinite(preu)) parts.push(`${preu.toFixed(2).replace(".", ",")} €/kg`);
  const etiqueta = etiquetaModalitats(ms);
  if (etiqueta && etiqueta !== modalitatComuna) parts.push(etiqueta);
  const cap = `• ${String(fila.producto ?? "").trim()}${varietat}`;
  return parts.length > 0 ? `${cap}: ${parts.join(" · ")}` : cap;
}

/**
 * 🔴 EL texto de una DISPONIBILIDAD (varias ofertas de un productor publicadas a la vez): UN solo
 * mensaje por entidad, con la lista de productos y UN enlace al Mercat
 * (`/receptor/mercat?disponibilitat=<id>`), donde la entidad elige productos y kg. Pura.
 *
 * `ofertes` son las filas de `excedentes` del grupo (o lo que devuelve `ofertes_disponibilitat`),
 * en su orden. Lo común —producto en el campo, municipio, lugar, fecha, días y franja, modalidad,
 * causa, envases y observaciones— se lee de la PRIMERA (en el alta es idéntico en todas); por
 * producto van los kilos, las cajas, el precio (si esa oferta tiene venta) y la modalidad si no
 * coincide con la común. Ninguna línea con la etiqueta vacía, como en `componerTextoOferta()`.
 *
 * Sin el cierre del bot: el diálogo de WhatsApp (sí → kg → precio) es de UNA oferta y no se usa
 * para grupos; se responde por el enlace.
 */
export function textDisponibilitat(
  ofertes: readonly Record<string, unknown>[],
  ctx: ContextTextDisponibilitat,
): string {
  return `${cosDisponibilitat(ofertes, ctx)}\n\n${
    tancamentDisponibilitat(enllacDisponibilitat(ctx.appUrl, ctx.disponibilitatId))
  }`;
}

/** El cuerpo de `textDisponibilitat()` sin el cierre ni el enlace (el correo lleva botón). */
export function cosDisponibilitat(
  ofertes: readonly Record<string, unknown>[],
  ctx: ContextTextOferta,
): string {
  const ple = (v: string | undefined | null): v is string => typeof v === "string" && v.trim() !== "";
  const primera = ofertes[0] ?? {};
  // La modalidad común: la de la primera si TODAS dicen lo mismo; si no, cada línea la suya.
  const etiquetes = ofertes.map((f) => etiquetaModalitats(modalitatsFila(f)));
  const modalitatComuna = etiquetes.every((e) => e === etiquetes[0]) ? etiquetes[0] ?? "" : "";

  const lineas = [
    `📢 *OFERTA DISPONIBLE · ${ofertes.length} PRODUCTES*`,
    "",
    "🌿 PRODUCTES:",
    ...ofertes.map((f) => liniaProducteText(f, modalitatComuna)),
  ];
  if (primera.espigolada_demanada === true) {
    lineas.push("🌱 ESPIGOLADA: el producte és al camp i el cull qui el reculli (entitat o voluntariat)");
  } else if (primera.producte_al_camp === true) {
    lineas.push("🌱 PRODUCTE AL CAMP: sí (encara no s'ha collit)");
  }
  if (ple(ctx.productor)) lineas.push(`👩‍🌾 PRODUCTOR: ${ctx.productor}`);
  if (ple(ctx.municipi)) lineas.push(`📍 MUNICIPI: ${ctx.municipi}`);
  const mapsPropi = typeof primera.gmaps_url === "string" && /^https?:\/\/\S+$/i.test(primera.gmaps_url.trim())
    ? primera.gmaps_url.trim() : "";
  const maps = mapsPropi || (ctx.mapsLloc ?? "").trim();
  if (maps) lineas.push("🗺️ PUNT DE RECOLLIDA:", maps);
  const data = typeof primera.disponible_hasta === "string" && /^\d{4}-\d{2}-\d{2}/.test(primera.disponible_hasta)
    ? primera.disponible_hasta.slice(0, 10).split("-").reverse().join("/")
    : String(ctx.disponibleText ?? "").trim();
  if (data) lineas.push(`📅 DISPONIBLE FINS: ${data}`);
  const horari = [textDies(primera.dies_recollida), primera.horari_recollida ? String(primera.horari_recollida) : ""]
    .filter(ple).map((x) => x.trim()).join(" · ");
  if (horari) lineas.push(`⏰ HORARI DE RECOLLIDA: ${horari}`);
  if (modalitatComuna) lineas.push(`💰 MODALITAT: ${modalitatComuna}`);
  const causa = ctx.causa ?? (primera.causa ? String(primera.causa) : "");
  if (ple(causa)) lineas.push(`🔴 CAUSA: ${textCausa(causa, ctx.subcausa)}`);
  // Los envases sin el número de cajas, que va en la línea de cada producto.
  const envasos = textoEnvasos(
    primera.format_entrega, primera.retorn_envasos, primera.retorn_envasos_detall,
    primera.retorn_envasos_quantitat, null,
  );
  if (envasos) lineas.push(`♻️ ENVASOS: ${envasos}`);
  if (primera.observacions && String(primera.observacions).trim()) {
    lineas.push(`📝 OBSERVACIONS: ${String(primera.observacions).trim()}`);
  }
  return lineas.join("\n");
}

/**
 * La versión de CORREO de una disponibilidad (lo que el panel pasa a `enviar-email`): el asunto,
 * el título, el cuerpo sin el cierre (el enlace va en el botón) y el texto plano completo. En
 * catalán, como el texto de la oferta.
 */
export function correuDisponibilitat(
  ofertes: readonly Record<string, unknown>[],
  ctx: ContextTextDisponibilitat,
): { assumpte: string; titol: string; preheader: string; cos: string; text: string; boto: { texto: string; url: string } } {
  const productes = llistaProductes(ofertes.map((f) => String(f.producto ?? "")));
  const url = enllacDisponibilitat(ctx.appUrl, ctx.disponibilitatId);
  return {
    assumpte: `Oferta disponible: ${productes}`,
    titol: "Oferta disponible",
    preheader: ctx.productor ? `${ofertes.length} productes de ${ctx.productor}` : `${ofertes.length} productes`,
    cos: cosDisponibilitat(ofertes, ctx),
    text: textDisponibilitat(ofertes, ctx),
    boto: { texto: "Tria els productes", url },
  };
}

/** «1 caixa», «3 caixes», «1 palet», «2 palets». */
export function textCaixes(n: number, format: unknown): string {
  const palet = format === "palet";
  return `${n} ${palet ? (n === 1 ? "palet" : "palets") : (n === 1 ? "caixa" : "caixes")}`;
}

/** El formato de entrega en palabras, para el texto de la oferta. */
const ETIQUETA_FORMAT: Record<string, string> = {
  caixes: "Caixes",
  palet: "Palet",
  envasos_propis: "Cal portar envasos propis",
  altres: "Altres (vegeu observacions)",
};

/**
 * La línea ENVASOS: formato de entrega, cuántos (cajas o palets) y, si aplica, si hay que
 * devolverlos. Vacía si no se preguntó (producto en el campo) — y entonces la línea no se imprime.
 *
 * Con retorno, también QUÉ y CUÁNTOS, entre paréntesis: «12 caixes · cal retornar-los (20 ·
 * caixes de plàstic verdes)». Desde la fase C del punto 3 el número de cajas va aquí y no en
 * QUANTITAT (fila 3.7.6: «formato y cantidad de envases»).
 */
export function textoEnvasos(
  format: unknown, retorn: unknown, detall?: unknown, quantitat?: unknown, caixes?: unknown,
): string {
  const n = Number(caixes);
  const ambNombre = (format === "caixes" || format === "palet") && Number.isInteger(n) && n > 0;
  const f = ambNombre ? textCaixes(n, format) : ETIQUETA_FORMAT[String(format ?? "")] ?? "";
  const r = String(retorn ?? "");
  let ret = r === "Sí" ? "cal retornar-los" : r === "No" ? "no cal retornar-los" : "";
  if (r === "Sí") {
    const q = Number(quantitat);
    const que = [
      Number.isInteger(q) && q > 0 ? String(q) : "",
      String(detall ?? "").trim(),
    ].filter(Boolean).join(" · ");
    if (que) ret = `${ret} (${que})`;
  }
  return [f, ret].filter(Boolean).join(" · ");
}

/** Los días, como se escriben en catalán: 1 = dl … 7 = dg (los de `productor_ubicaciones`). */
const DIES_CURTS = ["dl", "dt", "dc", "dj", "dv", "ds", "dg"];

/**
 * Los días de recogida en una línea («dl, dc, dv»), en orden y sin repetir; lo que no es un día
 * válido se descarta. Vacío si no hay ninguno (y la línea no se imprime).
 */
export function textDies(dies: unknown): string {
  return diesValids(dies).map((d) => DIES_CURTS[d - 1]).join(", ");
}

/**
 * Los días de recogida que llegan del panel, normalizados: enteros del 1 al 7, ordenados y sin
 * repetir. Cualquier otra cosa (un texto de un panel anterior, un 8…) se descarta en silencio:
 * el campo es opcional y un valor raro no puede impedir publicar.
 */
export function diesValids(dies: unknown): number[] {
  if (!Array.isArray(dies)) return [];
  const ok = new Set<number>();
  for (const d of dies) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 1 && n <= 7) ok.add(n);
  }
  return [...ok].sort((a, b) => a - b);
}
