// Motor del intake conversacional de Redestina.
//
// Un productor escribe al número de Redestina y, paso a paso, compone una oferta de
// excedente. El estado vive en `intake_sessions` (una fila por teléfono), de modo
// que cada mensaje entrante se interpreta según el paso en curso.
//
// Todo ocurre dentro de la ventana de servicio de 24 h —la abre el propio
// productor al escribir—, así que no hacen falta plantillas ni opt-in.
//
// Vive fuera de `whatsapp-webhook/index.ts` a propósito: son diecisiete pasos —varios
// condicionales, como el `preu_minim` (venda y maquila) o el `cost_kg` (donació)— con paginación,
// reintentos y caducidad, y embutirlos en el bucle del webhook lo haría inmanejable.

import { sendBotones, sendLista, sendText } from "./whatsapp.ts";
import type { FilaLista } from "./whatsapp.ts";
import { crearExcedenteDesdeSesion } from "./oferta.ts";
// Los pasos y los vocabularios cerrados viven en camposOferta.ts, compartidos con el
// formulario del panel del productor: una sola lista, dos interfaces.
import {
  aplica, CAMPOS, FORMATS_ENTREGA, MODALITATS, OPCIONS_AL_CAMP, OPCIONS_TRANSPORT, PASOS,
} from "./camposOferta.ts";
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

/**
 * Qué se pregunta después de un paso: el siguiente de `PASOS` **que aplique** a lo que ya se
 * ha contestado. Las condiciones son las del descriptor (`CAMPOS[].condicion`), las mismas
 * que usa el panel, así que los dos canales se saltan exactamente las mismas preguntas:
 * el preu mínim en donació, el formato de entrega si el producto sigue en el campo, la
 * ubicación si el productor lo lleva, el retorno si el receptor trae sus envases…
 *
 * ⚠️ Se EXPORTA para poder probarla. Es la única lógica del cuestionario que no se ve en el
 * mensaje que llega al móvil —el aspecto de la pregunta sí, el salto no—, así que probarla por
 * WhatsApp exige recorrer muchos pasos; y equivocarse aquí sale caro en los dos sentidos:
 * pedirle un precio a quien dona, o publicar una venta **sin preu_minim**, que es el campo
 * que la entidad confirma al aceptar (§5).
 */
export function siguientePaso(paso: Paso, datos: Record<string, unknown>): Paso | null {
  const i = PASOS.indexOf(paso);
  if (i < 0) return null;
  for (let j = i + 1; j < PASOS.length; j++) {
    // ⚠️ El preu mínim NO sigue la regla general: solo se salta con una donación EXPLÍCITA.
    //    Con la modalidad ausente o desconocida se pregunta, porque publicar una venta sin
    //    precio es peor que pedirle un precio de más a quien dona (lo fija un test).
    if (PASOS[j] === "preu_minim") {
      if (datos.modalitat === "donacio") continue;
      return PASOS[j];
    }
    const campo = CAMPOS.find((c) => c.clave === PASOS[j]);
    if (!campo || aplica(campo, datos)) return PASOS[j];
  }
  return null;
}

/** El coste de referencia de un producto (pantalla «Productes»), o null si no tiene. */
async function referenciaCost(supabase: Cliente, producte: string): Promise<number | null> {
  if (!producte) return null;
  const { data } = await supabase
    .from("costes_producto").select("coste_kg").eq("producto", producte).limit(1).maybeSingle();
  return data?.coste_kg != null ? Number(data.coste_kg) : null;
}

/**
 * «de Tomàquet» / «d'Albercoc»: la preposición apostrofada ante vocal o h, como se escribe.
 * Sin esto el bot decía «de Horta Fulla» o «de Enciam» (4 familias y muchos productos).
 */
export function de(nom: string): string {
  return /^[aeiouàèéíòóúh]/i.test(nom.trim()) ? `d'${nom}` : `de ${nom}`;
}

/** «0,60 €/kg»: como se lee en català. */
export function eurKg(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €/kg`;
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
        `Quin producte ${de(String(datos.familia ?? ""))}?`,
        "Tria producte",
        paginar(productos.map((n) => ({ id: `producte:${n}`, titulo: n })), pagina, "producte"),
      );
      return r.ok;
    }
    case "varietat":
      return (await sendText(supabase, to, "Quina varietat és? (escriu '-' si no ho saps)")).ok;
    case "producte_al_camp":
      // Lista y no botones, por lo mismo que `modalitat` (deuda §12.105): un botón solo
      // lleva título, y aquí el título solo dice «sí» o «no» a una pregunta que decide un
      // flujo entero —si el equipo puede convertir la oferta en una espigolada, y si la
      // entidad se está comprometiendo a ir a collir—. La `description` es la que lo
      // explica, y es la misma que lee el panel bajo el desplegable.
      return (await sendLista(
        supabase, to, "El producte encara és al camp?", "Tria una opció",
        OPCIONS_AL_CAMP.map((o) => ({
          id: `producte_al_camp:${o.id}`,
          titulo: o.titulo,
          descripcion: o.descripcion,
        })),
      )).ok;
    case "kg":
      return (await sendText(
        supabase, to,
        "Quants kg aproximadament? Si ho tens en unitats o manats, digue-ho i ho convertim.",
      )).ok;
    case "format_entrega":
      // Lista: son cuatro opciones y un mensaje de botones admite tres.
      return (await sendLista(
        supabase, to, "Com es farà l'entrega?", "Tria una opció",
        FORMATS_ENTREGA.map((f) => ({
          id: `format_entrega:${f.id}`,
          titulo: f.titulo,
          descripcion: f.descripcion,
        })),
      )).ok;
    case "caixes":
      return (await sendText(supabase, to, "Quantes caixes o palets són? (escriu '-' si no ho saps)")).ok;
    case "retorn":
      return (await sendBotones(supabase, to, "Cal retornar els envasos?", [
        { id: "retorn:Sí", titulo: "Sí" },
        { id: "retorn:No", titulo: "No" },
      ])).ok;
    case "transport":
      return (await sendBotones(
        supabase, to, "Pots encarregar-te del transport? Si el portes tu, no cal dir on es recull.",
        OPCIONS_TRANSPORT.map((o) => ({ id: `transport:${o.id}`, titulo: o.titulo })),
      )).ok;
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
          "On s'ha de recollir? Envia la ubicació des de WhatsApp (📎 → Ubicació) o enganxa " +
            "l'enllaç de Google Maps.",
        )).ok;
      }
      const filas: FilaLista[] = ubis.map((u) => ({
        id: `ubicacio:${u.id}`,
        titulo: u.alias ?? u.municipio ?? "Ubicació",
        descripcion: u.municipio ?? undefined,
      }));
      // ⚠️ Una lista admite 10 filas: con 10 ubicaciones o más, «Un altre lloc» se quedaría
      //    fuera sin avisar. Se enseñan las 9 primeras y esa opción siempre.
      filas.splice(9);
      filas.push({ id: "ubicacio:nova", titulo: "Un altre lloc", descripcion: "Ubicació de WhatsApp o enllaç de Maps" });
      return (await sendLista(supabase, to, "On s'ha de recollir?", "Tria ubicació", filas)).ok;
    }
    case "disponible_fins":
      return (await sendText(supabase, to, "Fins quin dia està disponible? (per exemple 23/07)")).ok;
    case "horari":
      return (await sendText(supabase, to, "Quin horari de recollida va bé? (matí, tarda, hores…)")).ok;
    case "modalitat":
      // Lista y no botones, aunque solo sean tres opciones: un botón de WhatsApp admite
      // título y nada más, así que por aquí se elegía a ciegas entre tres palabras
      // —«Donació», «Venda», «Maquila»— mientras el panel sí explicaba cada una. Y es el
      // paso que decide qué entidades pueden recibir la oferta y qué documento se emite:
      // equivocarse no se nota hasta el cierre. La fila de lista sí lleva `description`,
      // que es la de `MODALITATS`, la misma que lee el panel (deuda §12.105).
      return (await sendLista(
        supabase, to, "Quina modalitat és?", "Tria modalitat",
        MODALITATS.map((m) => ({
          id: `modalitat:${m.id}`,
          titulo: m.titulo,
          descripcion: m.descripcion,
        })),
      )).ok;
    case "preu_minim":
      return (await sendText(
        supabase, to,
        "A quin preu mínim (€/kg) la vols oferir? Escriu un número (p. ex. 0,80).",
      )).ok;
    case "cost_kg": {
      // El coste lo decide el productor; la pantalla «Productes» solo da la REFERENCIA
      // (27-09-2026). Con referencia, dos botones: quedársela o dar otro valor. Sin ella, se
      // le pide el número directamente, y puede decir que no lo sabe.
      const ref = await referenciaCost(supabase, String(datos.producte ?? ""));
      if (ref !== null) {
        return (await sendBotones(
          supabase, to,
          `Quin és el cost per quilo? És el valor amb què es calcula la donació al certificat.\n\n` +
            `El valor de referència ${de(String(datos.producte ?? ""))} és ${eurKg(ref)}.`,
          [
            { id: "cost_kg:ref", titulo: `Mantenir ${eurKg(ref)}`.slice(0, 20) },
            { id: "cost_kg:altre", titulo: "Un altre valor" },
          ],
        )).ok;
      }
      return (await sendText(
        supabase, to,
        "Quin és el cost per quilo (€/kg)? És el valor amb què es calcula la donació al " +
          "certificat. Escriu un número (p. ex. 0,60) o '-' si no el saps.",
      )).ok;
    }
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
  // ⚠️ `producte_al_camp` NO colisiona con `producte` aunque lo tenga de prefijo: el
  //    guardia compara contra `producte:` con los dos puntos, y `producte_al_camp:si`
  //    empieza por `producte_`. Conviene saberlo antes de añadir otro paso con el mismo
  //    principio.
  const conOpciones: Paso[] = [
    "familia", "producte", "producte_al_camp", "format_entrega", "retorn", "transport", "modalitat",
    "causa",
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
        // Sin equivalencia no se inventa: «20 manats» no son 20 kg. Se pide el número en kg.
        if (!factor?.kg_por_unidad) return SENSE_FACTOR;
        kg = kg * Number(factor.kg_por_unidad);
      }
      return kg;
    }
    case "cost_kg": {
      if (id === "cost_kg:ref") {
        const ref = await referenciaCost(supabase, String(sesion.datos_parciales.producte ?? ""));
        return ref ?? null_ok();
      }
      if (t === "-") return null_ok();
      const num = t.match(/\d+([.,]\d+)?/);
      if (!num) return null;
      const n = Number(num[0].replace(",", "."));
      return n > 0 ? n : null;
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
          // Con fecha: si no, cada enlace nuevo añadía otra fila idéntica a la lista.
          alias: `Compartida el ${new Date().toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit", timeZone: "Europe/Madrid" })}`,
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
// Ha dado la cantidad en unidades o manats de un producto sin factor de conversión.
const SENSE_FACTOR = Symbol("sense_factor");
/** Tope de un texto libre: el `texto_oferta` entero no puede pasar de 1024 en un interactivo. */
const MAX_TEXT_LLIURE = 400;
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
  // `email` hace falta para la confirmación por correo de la oferta (§12.94): sin él,
  // `confirmarOfertaPerCorreu` devolvería siempre "omes" y el intake seguiría confirmando
  // solo por WhatsApp. La lista de columnas va en UN literal (§7).
  const { data: productor } = await supabase
    .from("productores").select("id, name, email").eq("phone", from).maybeSingle();
  if (!productor) return false;

  const lectura = leerRespuesta(message);
  const id = lectura.id;
  let texto = lectura.texto;
  // La ubicación compartida desde WhatsApp (📎 → Ubicació) se convierte en un enlace de
  // Maps: antes se tomaba por respuesta inválida y se repetía la pregunta.
  if (message?.type === "location" && message.location?.latitude != null) {
    texto = `https://www.google.com/maps?q=${message.location.latitude},${message.location.longitude}`;
  }

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
    if (sesion) {
      await supabase.from("intake_sessions").delete().eq("id", sesion.id);
      await sendText(supabase, from, "D'acord, ho hem cancel·lat. Escriu quan vulguis. 👋");
    } else {
      await sendText(supabase, from, "No tens cap oferta a mig fer. Escriu quan vulguis. 👋");
    }
    return true;
  }

  // «Continuar» sobre una sesión que ya caducó: decirlo, en vez de la guía genérica.
  if (id === "intake:continuar" && !sesion) {
    await sendBotones(
      supabase, from,
      "La teva oferta a mig fer ha caducat. Vols començar-ne una de nova?",
      [
        { id: "intake:si", titulo: "Sí" },
        { id: "intake:no", titulo: "Ara no" },
      ],
    );
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
      await sendText(supabase, from, "Cap problema. Quan vulguis publicar una oferta, escriu-nos.");
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
      `Hola ${productor.name}! 👋 Sóc l'assistent de Redestina, d'Espigoladors.\n\n` +
        "T'ajudo a publicar una oferta en un moment: et faré unes preguntes senzilles " +
        "(producte, quantitat, ubicació…) i crearé l'oferta automàticament. 🥬📦\n\n" +
        "✍️ Escriu *Stop* quan vulguis per aturar el procés.\n\n" +
        "Vols publicar una oferta ara?",
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

  // «Un altre lloc» no es una respuesta: es pedir la forma de dar una ubicación nueva. Antes
  // se interpretaba como respuesta inválida y el bot volvía a mandar la misma lista, así que
  // quien tenía ubicaciones no podía añadir otra por aquí (§6bis). No cuenta como intento.
  if (paso === "ubicacio" && id === "ubicacio:nova") {
    await sendText(supabase, from, "Enganxa l'enllaç de Google Maps del lloc on s'ha de recollir.");
    return true;
  }

  // «Un altre valor» del coste: tampoco es una respuesta, es pedir escribir el número.
  if (paso === "cost_kg" && id === "cost_kg:altre") {
    await sendText(supabase, from, "Escriu el cost per quilo en €/kg (p. ex. 0,60).");
    return true;
  }

  // Un texto libre demasiado largo haría que el mensaje de la oferta pasara de los 1024
  // caracteres que admite un interactivo de Meta, y la entidad no lo recibiría.
  if ((paso === "observacions" || paso === "varietat" || paso === "horari") &&
    (texto ?? "").trim().length > MAX_TEXT_LLIURE) {
    await sendText(supabase, from, `És massa llarg: escriu-ho en menys de ${MAX_TEXT_LLIURE} caràcters.`);
    return true;
  }

  const valor = await interpretar(supabase, sesion, paso, texto, id);

  if (valor === SENSE_FACTOR) {
    await sendText(
      supabase, from,
      `No tinc l'equivalència en kg ${de(String(datos.producte ?? ""))}. ` +
        "Escriu els kg aproximats (p. ex. 150).",
    );
    return true;
  }

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
      // El aviso Y la pregunta: antes solo salía el aviso, en bucle, y la persona dejaba de
      // ver qué se le estaba preguntando.
      await sendText(
        supabase, from,
        "No acabo d'entendre la resposta. Torna-ho a provar; si vols aturar, escriu *Stop*.",
      );
      if (!(await preguntar(supabase, { ...sesion, datos_parciales: datos }, paso))) {
        console.error("intake: no se pudo repetir la pregunta", paso, "a", from);
      }
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
