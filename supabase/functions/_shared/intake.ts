// Motor del intake conversacional de Redestina.
//
// Un productor escribe al número de Redestina y, paso a paso, compone una oferta de
// excedente. El estado vive en `intake_sessions` (una fila por teléfono), de modo
// que cada mensaje entrante se interpreta según el paso en curso.
//
// Todo ocurre dentro de la ventana de servicio de 24 h —la abre el propio
// productor al escribir—, así que no hacen falta plantillas ni opt-in.
//
// Vive fuera de `whatsapp-webhook/index.ts` a propósito: son trece pasos con
// paginación, reintentos y caducidad, y embutirlos en el bucle del webhook lo
// haría inmanejable.

import { sendBotones, sendLista, sendText } from "./whatsapp.ts";
import type { FilaLista } from "./whatsapp.ts";
import { crearExcedenteDesdeSesion } from "./oferta.ts";
// Los pasos y los vocabularios cerrados viven en camposOferta.ts, compartidos con el
// formulario del panel del productor: una sola lista, dos interfaces.
import { PASOS, TIPOS_CAIXA } from "./camposOferta.ts";
import type { Paso } from "./camposOferta.ts";

// Una sesión sin actividad se da por abandonada y se empieza de cero.
const CADUCIDAD_HORAS = 12;
// Tras dos respuestas que no encajan, se ofrece cancelar en vez de insistir.
const MAX_INTENTOS = 2;
// Se dejan 9 opciones visibles y la décima fila es "Més…".
const OPCIONES_POR_PAGINA = 9;

interface Sesion {
  id: string;
  telefono: string;
  productor_id: string | null;
  paso_actual: string | null;
  datos_parciales: Record<string, unknown>;
  updated_at: string;
}

// deno-lint-ignore no-explicit-any
type Cliente = any;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Extrae lo que ha respondido el usuario, sea texto o pulsación interactiva. */
export function leerRespuesta(
  // deno-lint-ignore no-explicit-any
  message: any,
): { texto: string | null; id: string | null } {
  if (message?.type === "interactive") {
    const i = message.interactive ?? {};
    const r = i.button_reply ?? i.list_reply;
    return { texto: r?.title ?? null, id: r?.id ?? null };
  }
  return { texto: message?.text?.body ?? null, id: null };
}

export function esCancelar(texto: string | null): boolean {
  const t = (texto ?? "").trim().toUpperCase().replace("·", "");
  // "STOP" es la palabra oficial; CANCELAR/CANCEL·LAR se mantienen como alias.
  return t === "STOP" || t === "CANCELLAR" || t === "CANCELAR";
}

function siguientePaso(paso: Paso, datos: Record<string, unknown>): Paso | null {
  const i = PASOS.indexOf(paso);
  let sig: Paso | null = i >= 0 && i < PASOS.length - 1 ? PASOS[i + 1] : null;
  // El preu mínim solo se pregunta en venda/maquila; en donació se salta.
  if (sig === "preu_minim" && datos.modalitat === "donacio") {
    const j = PASOS.indexOf("preu_minim");
    sig = j >= 0 && j < PASOS.length - 1 ? PASOS[j + 1] : null;
  }
  return sig;
}

/** Trocea las opciones en páginas de 9 y añade "Més…" cuando queda resto. */
export function paginar(
  opciones: FilaLista[],
  pagina: number,
  prefijoMas: string,
): FilaLista[] {
  const inicio = pagina * OPCIONES_POR_PAGINA;
  const trozo = opciones.slice(inicio, inicio + OPCIONES_POR_PAGINA);
  if (inicio + OPCIONES_POR_PAGINA < opciones.length) {
    trozo.push({ id: `${prefijoMas}:mes`, titulo: "Més…" });
  }
  return trozo;
}

async function guardar(
  supabase: Cliente,
  sesion: Sesion,
  cambios: Partial<Sesion> & { datos_parciales?: Record<string, unknown> },
): Promise<void> {
  // Cada actividad reinicia el reloj del recordatorio: se reenviará 10 min
  // después de la última interacción, no de la creación de la sesión.
  const { error } = await supabase
    .from("intake_sessions")
    .update({ ...cambios, updated_at: new Date().toISOString(), recordatorio_enviado_at: null })
    .eq("id", sesion.id);
  if (error) console.error("intake_sessions update:", error.message);
}

// ---------------------------------------------------------------------------
// Preguntas
// ---------------------------------------------------------------------------

/**
 * Hace la pregunta del paso. **Devuelve si salió** (deuda §12.3).
 *
 * Antes no devolvía nada y ninguna de las 14 llamadas miraba el resultado, así que un
 * fallo de red dejaba al productor sin la pregunta **con la sesión ya avanzada**: su
 * siguiente mensaje se interpretaba contra un paso que él no había visto nunca. Ahora
 * quien llama decide, y la regla es una: **el paso solo avanza si la pregunta salió.**
 */
async function preguntar(
  supabase: Cliente,
  sesion: Sesion,
  paso: Paso,
  pagina = 0,
): Promise<boolean> {
  const to = sesion.telefono;
  const datos = sesion.datos_parciales ?? {};

  switch (paso) {
    case "familia": {
      const { data } = await supabase.from("productos").select("familia");
      const familias = [...new Set((data ?? []).map((p: { familia: string }) => p.familia))]
        .filter(Boolean).sort() as string[];
      const r = await sendLista(
        supabase, to,
        "De quina família és el producte?",
        "Tria família",
        paginar(familias.map((f) => ({ id: `familia:${f}`, titulo: f })), pagina, "familia"),
      );
      return r.ok;
    }
    case "producte": {
      const { data } = await supabase
        .from("productos").select("nombre").eq("familia", datos.familia).order("nombre");
      const productos = (data ?? []).map((p: { nombre: string }) => p.nombre) as string[];
      const r = await sendLista(
        supabase, to,
        `Quin producte de ${datos.familia}?`,
        "Tria producte",
        paginar(productos.map((n) => ({ id: `producte:${n}`, titulo: n })), pagina, "producte"),
      );
      return r.ok;
    }
    case "varietat":
      return (await sendText(supabase, to, "Quina varietat és? (escriu '-' si no aplica)")).ok;
    case "kg":
      return (await sendText(
        supabase, to,
        "Quants kg aproximadament? Si ho tens en unitats o manats, digue-ho i ho convertim.",
      )).ok;
    case "caixes":
      return (await sendText(supabase, to, "Quantes caixes són? (escriu '-' si no ho saps)")).ok;
    case "tipus_caixa":
      return (await sendLista(
        supabase, to, "Quin tipus de caixa?", "Tria tipus",
        TIPOS_CAIXA.map((t) => ({ id: `tipus_caixa:${t}`, titulo: t })),
      )).ok;
    case "retorn":
      return (await sendBotones(supabase, to, "Cal retornar els envasos?", [
        { id: "retorn:Sí", titulo: "Sí" },
        { id: "retorn:No", titulo: "No" },
        { id: "retorn:Caixes pròpies", titulo: "Caixes pròpies" },
      ])).ok;
    case "ubicacio": {
      const { data } = await supabase
        .from("productor_ubicaciones")
        .select("id, alias, municipio")
        .eq("productor_id", sesion.productor_id);
      const ubis = (data ?? []) as Array<{ id: string; alias: string; municipio: string }>;
      // Con cero ubicaciones no se puede enviar una lista vacía: Meta la rechaza.
      if (ubis.length === 0) {
        return (await sendText(
          supabase, to,
          "On es recull? Comparteix un punt de Google Maps (enganxa l'enllaç).",
        )).ok;
      }
      const filas: FilaLista[] = ubis.map((u) => ({
        id: `ubicacio:${u.id}`,
        titulo: u.alias ?? u.municipio ?? "Ubicació",
        descripcion: u.municipio ?? undefined,
      }));
      filas.push({ id: "ubicacio:nova", titulo: "Comparteix un punt" });
      return (await sendLista(supabase, to, "On es recull?", "Tria ubicació", filas)).ok;
    }
    case "disponible_fins":
      return (await sendText(supabase, to, "Fins quin dia està disponible? (per exemple 23/07)")).ok;
    case "horari":
      return (await sendText(supabase, to, "Quin horari de recollida va bé? (matí, tarda, hores…)")).ok;
    case "modalitat":
      return (await sendBotones(supabase, to, "Quina modalitat és?", [
        { id: "modalitat:donacio", titulo: "Donació" },
        { id: "modalitat:venda", titulo: "Venda" },
        { id: "modalitat:maquila", titulo: "Maquila" },
      ])).ok;
    case "preu_minim":
      return (await sendText(
        supabase, to,
        "A quin preu mínim (€/kg) la vols oferir? Escriu un número (p. ex. 0.80).",
      )).ok;
    case "causa": {
      const { data } = await supabase.from("causas").select("codigo, nombre").order("nombre");
      const causas = (data ?? []) as Array<{ codigo: string; nombre: string }>;
      const r = await sendLista(
        supabase, to, "Quina és la causa de l'excedent?", "Tria causa",
        paginar(
          causas.map((c) => ({ id: `causa:${c.codigo}`, titulo: c.nombre, descripcion: c.codigo })),
          pagina, "causa",
        ),
      );
      return r.ok;
    }
    case "observacions":
      return (await sendText(supabase, to, "Alguna observació? (escriu '-' si no n'hi ha)")).ok;
  }

  // Paso sin pregunta: no se ha enviado nada, así que tampoco se puede avanzar.
  console.error("intake: paso sin pregunta:", paso);
  return false;
}

// ---------------------------------------------------------------------------
// Interpretación de respuestas
// ---------------------------------------------------------------------------

/** Devuelve el valor validado, o null si la respuesta no encaja con el paso. */
async function interpretar(
  supabase: Cliente,
  sesion: Sesion,
  paso: Paso,
  texto: string | null,
  id: string | null,
): Promise<unknown | null> {
  // Los pasos con opciones exigen pulsación: el id lleva el valor.
  const conOpciones: Paso[] = [
    "familia", "producte", "tipus_caixa", "retorn", "modalitat", "causa",
  ];
  if (conOpciones.includes(paso)) {
    if (!id?.startsWith(`${paso}:`)) return null;
    return id.slice(paso.length + 1);
  }

  const t = (texto ?? "").trim();

  switch (paso) {
    case "kg": {
      // Acepta "150", "150-200", "20 manats"… Se queda con el primer número y,
      // si menciona unidades o manats, aplica el factor de conversión.
      const num = t.match(/\d+([.,]\d+)?/);
      if (!num) return null;
      let kg = Number(num[0].replace(",", "."));
      if (/unitat|manat|u\b/i.test(t)) {
        const { data } = await supabase
          .from("factores_conversion").select("producto, kg_por_unidad");
        const producto = String(sesion.datos_parciales.producte ?? "").toUpperCase();
        const factor = (data ?? []).find((f: { producto: string }) =>
          f.producto.toUpperCase().startsWith(producto.slice(0, 4))
        );
        if (factor?.kg_por_unidad) kg = kg * Number(factor.kg_por_unidad);
      }
      return kg;
    }
    case "preu_minim": {
      // Preu mínim en €/kg: se queda con el primer número.
      const num = t.match(/\d+([.,]\d+)?/);
      if (!num) return null;
      return Number(num[0].replace(",", "."));
    }
    case "caixes":
      if (t === "-") return null_ok();
      return t.match(/\d+/) ? Number(t.match(/\d+/)![0]) : null;
    case "ubicacio": {
      if (id?.startsWith("ubicacio:") && id !== "ubicacio:nova") {
        return id.slice("ubicacio:".length);
      }
      // Un enlace de Google Maps crea una ubicación nueva para el productor.
      const enlace = t.match(/https?:\/\/\S*(maps\.app\.goo\.gl|google\.[a-z.]+\/maps)\S*/i);
      if (!enlace) return null;
      const { data: ficha } = await supabase
        .from("productores").select("poblacion").eq("id", sesion.productor_id).maybeSingle();
      const { data, error } = await supabase
        .from("productor_ubicaciones")
        .insert({
          productor_id: sesion.productor_id,
          alias: "Compartida per WhatsApp",
          gmaps_url: enlace[0],
          municipio: ficha?.poblacion ?? null,
        })
        .select("id").single();
      if (error) {
        console.error("productor_ubicaciones insert:", error.message);
        return null;
      }
      return data.id;
    }
    case "varietat":
    case "observacions":
      return t === "" ? null : (t === "-" ? null_ok() : t);
    default:
      return t === "" ? null : t;
  }
}

// Distingue "respondió válidamente que no aplica" de "no entendí la respuesta".
const OMITIDO = Symbol("omitido");
function null_ok(): unknown {
  return OMITIDO;
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

/**
 * Procesa un mensaje entrante dentro del flujo de intake.
 * Devuelve true si lo ha gestionado (y el webhook no debe hacer nada más).
 */
export async function procesarIntake(
  supabase: Cliente,
  from: string,
  // deno-lint-ignore no-explicit-any
  message: any,
): Promise<boolean> {
  // Solo se atiende a productores dados de alta.
  const { data: productor } = await supabase
    .from("productores").select("id, name").eq("phone", from).maybeSingle();
  if (!productor) return false;

  const { texto, id } = leerRespuesta(message);

  const { data: sesiones } = await supabase
    .from("intake_sessions").select("*").eq("telefono", from)
    .order("updated_at", { ascending: false }).limit(1);
  let sesion: Sesion | null = (sesiones ?? [])[0] ?? null;

  // Sesión olvidada: se descarta y se empieza como si no hubiera nada.
  if (sesion && Date.now() - new Date(sesion.updated_at).getTime() > CADUCIDAD_HORAS * 3600_000) {
    await supabase.from("intake_sessions").delete().eq("id", sesion.id);
    sesion = null;
  }

  // Cancelar en cualquier momento: por palabra clave o por el botón del recordatorio.
  if (esCancelar(texto) || id === "intake:cancelar") {
    if (sesion) await supabase.from("intake_sessions").delete().eq("id", sesion.id);
    await sendText(supabase, from, "D'acord, ho hem cancel·lat. Escriu quan vulguis. 👋");
    return true;
  }

  // Botón "Continuar" del recordatorio: se reanuda el paso donde se dejó.
  if (id === "intake:continuar" && sesion) {
    const datos = { ...(sesion.datos_parciales ?? {}) };
    datos._intentos = 0;
    await guardar(supabase, sesion, { datos_parciales: datos });
    const pasoActual = (sesion.paso_actual ?? "familia") as Paso;
    // Aquí no se avanza de paso, así que un fallo de envío no descoloca nada: solo deja
    // el recordatorio sin efecto y el siguiente volverá a intentarlo.
    if (!(await preguntar(supabase, { ...sesion, datos_parciales: datos }, pasoActual))) {
      console.error("intake: no se pudo reanudar el paso", pasoActual, "de", from);
    }
    return true;
  }

  // Sin sesión: se pregunta antes de arrancar, para no secuestrar con un
  // formulario a quien solo quería comentar algo.
  if (!sesion) {
    if (id === "intake:no") {
      await sendText(supabase, from, "Cap problema. Si més tard tens excedent, escriu-nos.");
      return true;
    }
    if (id === "intake:si") {
      const { data, error } = await supabase
        .from("intake_sessions")
        .insert({
          telefono: from,
          productor_id: productor.id,
          paso_actual: "familia",
          datos_parciales: {},
        })
        .select("*").single();
      if (error) {
        console.error("intake_sessions insert:", error.message);
        return true;
      }
      // Si la primera pregunta no sale, la sesión queda en `familia` sin haberla hecho.
      // No se borra: el recordatorio de los 10 minutos ofrece «Continuar», que la repite.
      if (!(await preguntar(supabase, data as Sesion, "familia"))) {
        console.error("intake: no se pudo enviar la primera pregunta a", from);
      }
      return true;
    }
    await sendBotones(
      supabase, from,
      `Hola ${productor.name}! 👋 Sóc l'assistent d'excedents d'Espigoladors.\n\n` +
        "T'ajudo a publicar un excedent en un moment: et faré unes preguntes senzilles " +
        "(producte, quantitat, ubicació…) i crearé l'oferta automàticament. 🥬📦\n\n" +
        "✍️ Escriu *Stop* quan vulguis per aturar el procés.\n\n" +
        "Vols oferir un excedent ara?",
      [
        { id: "intake:si", titulo: "Sí" },
        { id: "intake:no", titulo: "Ara no" },
      ],
    );
    return true;
  }

  const paso = (sesion.paso_actual ?? "familia") as Paso;
  const datos = { ...(sesion.datos_parciales ?? {}) };

  // "Més…": misma pregunta, página siguiente.
  if (id === `${paso}:mes`) {
    const pagina = Number(datos[`_pagina_${paso}`] ?? 0) + 1;
    datos[`_pagina_${paso}`] = pagina;
    // Se pregunta ANTES de guardar la página: si la lista no sale, el contador no se
    // mueve y volver a pulsar «Més…» ofrece la misma página, no la siguiente.
    if (!(await preguntar(supabase, { ...sesion, datos_parciales: datos }, paso, pagina))) {
      console.error("intake: no se pudo enviar la página", pagina, "de", paso, "a", from);
      return true;
    }
    await guardar(supabase, sesion, { datos_parciales: datos });
    return true;
  }

  const valor = await interpretar(supabase, sesion, paso, texto, id);

  if (valor === null) {
    // ⚠️ El contador sube porque la RESPUESTA no se ha entendido, que es lo que cuenta
    //    aquí. Un fallo de envío nunca lo toca: las dos ramas de abajo pueden fallar y
    //    `_intentos` ya está escrito con lo que decidió `interpretar()`, no con lo que
    //    decida la red. Confundir las dos cosas expulsaría del formulario a quien
    //    contesta bien y tiene mala cobertura.
    const intentos = Number(datos._intentos ?? 0) + 1;
    datos._intentos = intentos;
    await guardar(supabase, sesion, { datos_parciales: datos });
    if (intentos > MAX_INTENTOS) {
      await sendText(
        supabase, from,
        "No acabo d'entendre la resposta. Escriu *Stop* per aturar.",
      );
    } else if (!(await preguntar(supabase, { ...sesion, datos_parciales: datos }, paso))) {
      console.error("intake: no se pudo repetir la pregunta", paso, "a", from);
    }
    return true;
  }

  datos[paso] = valor === OMITIDO ? null : valor;
  datos._intentos = 0;

  const siguiente = siguientePaso(paso, datos);
  if (siguiente) {
    // ⚠️ EL ORDEN ES EL ARREGLO (deuda §12.3). Antes se guardaba el paso nuevo y DESPUÉS
    //    se preguntaba, sin mirar si la pregunta salía: con un fallo de red el productor
    //    se quedaba sin verla y su siguiente mensaje se leía contra un paso que no había
    //    visto —una fecha respondida como si fuera un horario—. Ahora se pregunta primero
    //    y el paso solo avanza si salió.
    //
    //    `preguntar()` no necesita la fila guardada: recibe el estado por parámetro, así
    //    que preguntar antes de escribir no cambia ninguna pregunta.
    const salio = await preguntar(supabase, { ...sesion, datos_parciales: datos }, siguiente);
    if (!salio) {
      // La respuesta SÍ se guarda —está entendida y validada— pero el paso no avanza. Es
      // idempotente: cuando la persona vuelva a contestar (o pulse «Continuar» en el
      // recordatorio de los 10 minutos) se reescribe el mismo valor y se reintenta.
      console.error("intake: no se pudo preguntar", siguiente, "a", from, "— el paso no avanza");
      await guardar(supabase, sesion, { datos_parciales: datos });
      return true;
    }
    await guardar(supabase, sesion, { paso_actual: siguiente, datos_parciales: datos });
    return true;
  }

  // Último paso contestado: se crea la oferta.
  await guardar(supabase, sesion, { datos_parciales: datos });
  await crearExcedenteDesdeSesion(supabase, { ...sesion, datos_parciales: datos }, productor);
  return true;
}
