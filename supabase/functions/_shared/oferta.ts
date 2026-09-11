// Cierre del intake: identificador, alta del excedente y texto de la oferta.

import { sendText } from "./whatsapp.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

interface SesionCompleta {
  id: string;
  telefono: string;
  productor_id: string | null;
  datos_parciales: Record<string, unknown>;
}

// El texto que se publica usa las etiquetas de siempre, no los valores internos.
const ETIQUETA_MODALITAT: Record<string, string> = {
  donacio: "donació",
  venda: "venda",
  maquila: "maquila",
};

/** Tres letras en mayúsculas, sin acentos ni espacios, para el identificador. */
export function siglas(texto: string): string {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
}

/**
 * Convierte la respuesta libre del productor a "Fins quin dia està disponible?"
 * en una fecha ISO (YYYY-MM-DD) para `excedentes.disponible_hasta`. Reconoce
 * dd/mm y dd/mm/aaaa con separadores `/`, `-` o `.` (p. ej. "23/07", "23-7",
 * "23.07.2026"). Sin año usa el actual; si esa fecha ya pasó, salta al siguiente.
 * Devuelve null si no reconoce una fecha (el panel la normaliza a mano, como
 * hasta ahora, y el texto de la oferta ya muestra el original).
 */
export function parseDisponibleFins(texto: string): string | null {
  const m = texto.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  const hoy = new Date();
  let anio = m[3] ? Number(m[3]) : hoy.getFullYear();
  if (anio < 100) anio += 2000; // "26" → 2026
  // Sin año explícito y con la fecha ya pasada, se entiende el año siguiente.
  if (!m[3]) {
    const finAny = new Date(anio, mes - 1, dia);
    const hoySolo = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    if (finAny < hoySolo) anio += 1;
  }
  // Rechaza fechas inexistentes (31/02, 30/02…).
  const fecha = new Date(anio, mes - 1, dia);
  if (fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * E-AAMMDD-XXX-YYY-N, donde N es el orden de la oferta ese día para ese productor y
 * producto. **El formato no cambia**; lo que cambia es de dónde sale la N.
 *
 * ANTES (deuda 39): se contaban las filas que ya empezaban por ese prefijo y se sumaba
 * uno. Con eso, dos altas simultáneas del mismo productor y producto contaban lo mismo,
 * proponían el mismo N y la segunda chocaba con el `unique` de `id_excedente`. El
 * comentario decía que «reintenta con N+1», pero no había ningún reintento: fallaba.
 * Además, el conteo `like` crece con la tabla y se hace desde fuera de la transacción,
 * así que la carrera no se podía cerrar sin un reintento explícito.
 *
 * AHORA: el mismo mecanismo que numera albaranes y certificados,
 * `siguiente_numero(serie, ejercicio)` — un `insert … on conflict do update … returning`
 * que **bloquea la fila del contador** y devuelve un número que nadie más va a recibir.
 * La serie de cada oferta es su propio prefijo (`E-260910-CAR-TOM`) y el ejercicio, el
 * año: así el contador se reinicia solo cada día y por producto, que es exactamente lo
 * que el formato pide, sin ninguna lógica de fechas propia.
 *
 * ⚠️ **No se usa `formato_numero()`** aunque exista y sea el compañero natural de
 *    `siguiente_numero()`: rellena con ceros a la izquierda (`00001`) y aquí la N va
 *    desnuda. El formato de `id_excedente` es anterior al sistema documental y circula
 *    por WhatsApp desde julio; cambiarlo ahora rompería referencias que ya están en
 *    conversaciones reales.
 *
 * ⚠️ `siguiente_numero()` solo la puede ejecutar `service_role` (20260928100000). Da
 *    igual: los dos caminos que crean un excedente —el intake por el webhook y el panel
 *    por `crear-oferta`— son Edge Functions y ya lo son. Desde el navegador no se puede
 *    crear un excedente (§4: `authenticated` no tiene INSERT sobre `excedentes`).
 *
 * Si la RPC fallara, se cae al conteo de antes en vez de no dar de alta la oferta: un
 * identificador con riesgo de colisión es peor que uno bueno, pero mucho mejor que
 * perder el excedente que el productor acaba de dictar.
 */
export async function generarId(
  supabase: Cliente,
  productor: string,
  producto: string,
): Promise<string> {
  const hoy = new Date();
  const fecha = [
    String(hoy.getFullYear()).slice(2),
    String(hoy.getMonth() + 1).padStart(2, "0"),
    String(hoy.getDate()).padStart(2, "0"),
  ].join("");
  const prefijo = `E-${fecha}-${siglas(productor)}-${siglas(producto)}`;

  const { data, error } = await supabase.rpc("siguiente_numero", {
    p_serie: prefijo,
    p_ejercicio: hoy.getFullYear(),
  });
  if (!error && typeof data === "number") return `${prefijo}-${data}`;

  console.error("siguiente_numero:", error?.message ?? "respuesta inesperada", data);
  const { data: previas } = await supabase
    .from("excedentes").select("id_excedente").like("id_excedente", `${prefijo}-%`);
  return `${prefijo}-${(previas?.length ?? 0) + 1}`;
}

/**
 * Texto que se publica en el grupo de canalizaciones.
 * Reproduce el formato que el equipo usa hoy a mano, emojis incluidos.
 */
export function componerTextoOferta(campos: {
  producte: string;
  productor: string;
  municipi: string;
  ubicacio: string;
  quantitat: string;
  disponible: string;
  horari: string;
  modalitat: string;
  preu?: string;
  causa: string;
  envasos: string;
  responsable: string;
  observacions: string;
}): string {
  const lineas = [
    "📢 *OFERTA DISPONIBLE*",
    "",
    `🌿 PRODUCTE: ${campos.producte}`,
    `👩‍🌾 PRODUCTOR: ${campos.productor}`,
    `📍 MUNICIPI: ${campos.municipi}`,
    `🗺️ UBICACIÓ:`,
    campos.ubicacio,
    `📦 QUANTITAT: ${campos.quantitat}`,
    `📅 DISPONIBLE: ${campos.disponible}`,
    `⏰ HORARI RECOLLIDA: ${campos.horari}`,
    `💰 MODALITAT: ${campos.modalitat}`,
  ];
  // Preu mínim solo en venda/maquila (el productor lo fija en l'intake).
  if (campos.preu) lineas.push(`💶 PREU MÍNIM: ${campos.preu}`);
  lineas.push(
    `🔴 CAUSA: ${campos.causa}`,
    `♻️ ENVASOS: ${campos.envasos}`,
    `👥 RESPONSABLE: ${campos.responsable}`,
    `📝 OBSERVACIONS: ${campos.observacions}`,
    "",
    "✅ Per acceptar aquesta oferta respon *SÍ* (o *NO* per descartar-la).",
  );
  return lineas.join("\n");
}

/**
 * De dónde sale la oferta (`excedentes.origen`, 20261012100100):
 *   · `intake`        el productor la dicta por WhatsApp
 *   · `panel`         la da de alta él mismo desde su panel
 *   · `asistido`      la introduce el equipo en su nombre (modelo asistido, §1bis)
 *   · `espigolament`  nace de una espigolada, no de una oferta (la crea SQL)
 */
export type OrigenExcedente = "intake" | "panel" | "asistido" | "espigolament";

/** Resultado de crear un excedente, para que quien llame decida qué contar. */
export interface ResultadoCreacion {
  ok: boolean;
  /** Identificador legible (E-AAMMDD-XXX-YYY-N) cuando ok. */
  idExcedente?: string;
  excedenteId?: string;
  error?: string;
}

/**
 * Alta de un excedente a partir de los datos del cuestionario, vengan de donde vengan:
 * del intake por WhatsApp o del formulario del panel del productor.
 *
 * Es el ÚNICO sitio donde se generan `id_excedente`, `texto_oferta` y `valor_eur`. Si
 * el panel lo duplicara en TypeScript, las dos versiones divergirían en semanas.
 */
export async function crearExcedente(
  supabase: Cliente,
  d: Record<string, unknown>,
  productor: { id: string; name: string },
  origen: OrigenExcedente = "intake",
): Promise<ResultadoCreacion> {
  const producto = String(d.producte ?? "");

  // Datos que no se le piden al productor porque ya están en la base.
  const [{ data: prod }, { data: ubicacion }, { data: causa }] = await Promise.all([
    supabase.from("productos").select("eur_kg, familia").eq("nombre", producto).maybeSingle(),
    d.ubicacio
      ? supabase.from("productor_ubicaciones").select("*").eq("id", d.ubicacio).maybeSingle()
      : Promise.resolve({ data: null }),
    d.causa
      ? supabase.from("causas").select("nombre").eq("codigo", d.causa).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: fichaProductor } = await supabase
    .from("productores").select("poblacion, empresa").eq("id", productor.id).maybeSingle();

  const kg = Number(d.kg ?? 0);
  const preuMinim = d.preu_minim != null ? Number(d.preu_minim) : null;
  const municipio = ubicacion?.municipio ?? fichaProductor?.poblacion ?? "";
  let idExcedente = await generarId(supabase, productor.name, producto);

  const textoOferta = componerTextoOferta({
    producte: producto,
    productor: fichaProductor?.empresa || productor.name,
    municipi: municipio,
    ubicacio: ubicacion?.gmaps_url ?? "-",
    quantitat: `${kg}kg aprox${d.caixes ? ` · ${d.caixes} caixes` : ""}`,
    disponible: String(d.disponible_fins ?? ""),
    horari: String(d.horari ?? ""),
    modalitat: ETIQUETA_MODALITAT[String(d.modalitat ?? "")] ?? String(d.modalitat ?? ""),
    preu: preuMinim != null ? `${preuMinim} €/kg` : undefined,
    causa: causa?.nombre ?? String(d.causa ?? ""),
    envasos: String(d.retorn ?? ""),
    // Se asigna en el panel; el productor no lo elige.
    responsable: "",
    observacions: String(d.observacions ?? ""),
  });

  // El alta, con reintento ante colisión del correlativo.
  //
  // ⚠️ POR QUÉ HACE FALTA AUNQUE EL CONTADOR SEA ATÓMICO. `siguiente_numero()` garantiza
  //    que dos altas simultáneas reciben N distintas, pero no sabe nada de los
  //    `id_excedente` que ya existen: los de antes de este cambio se numeraron contando
  //    filas, y la serie `E-AAMMDD-XXX-YYY` de ese día nace con el contador a cero. El
  //    día del despliegue, una oferta creada por la mañana con el método viejo y otra por
  //    la tarde con el nuevo pedirían las dos el N=1. La ventana es estrecha —el prefijo
  //    lleva la fecha, así que solo afecta al mismo día— pero existe.
  //
  //    Con el reintento, ese caso se resuelve solo: el `unique` de `id_excedente` rechaza
  //    el duplicado (23505), se pide el número siguiente y se vuelve a intentar. Es
  //    exactamente lo que el comentario de esta función decía que pasaba desde julio y
  //    no pasaba. Tres intentos: si tres números seguidos chocan, el problema no es una
  //    carrera.
  let fila: { id: string } | null = null;
  let error: { message: string; code?: string } | null = null;
  for (let intento = 0; intento < 3; intento++) {
    const r = await supabase.from("excedentes").insert({
      id_excedente: idExcedente,
      productor_id: productor.id,
      ubicacion_id: d.ubicacio ?? null,
      familia: prod?.familia ?? d.familia ?? null,
      producto,
      variedad: d.varietat ?? null,
      kg_total: kg || null,
      num_caixes: d.caixes ?? null,
      tipo_caixa: d.tipus_caixa ?? null,
      retorn_envasos: d.retorn ?? null,
      modalitat: d.modalitat ?? null,
      preu_minim: preuMinim,
      causa: causa?.nombre ?? null,
      causa_codigo: d.causa ?? null,
      // Se intenta parsear la respuesta libre ("23/07"); si no es una fecha
      // reconocible queda null y el panel la normaliza a mano.
      disponible_hasta: parseDisponibleFins(String(d.disponible_fins ?? "")),
      horari_recollida: d.horari ?? null,
      observacions: d.observacions ?? null,
      valor_eur: kg ? kg * Number(prod?.eur_kg ?? 1) : null,
      texto_oferta: textoOferta,
      // De dónde viene esta oferta. La columna la añadió `20261012100100` con un check de
      // cuatro valores y default `'intake'`; escribirlo explícitamente es lo que hace que
      // el default deje de ser una suposición sobre el caso mayoritario.
      origen,
      estado: "publicada",
    }).select("id").single();
    fila = r.data;
    error = r.error;
    if (!error) break;
    if (error.code !== "23505") break;
    console.warn("excedentes: id_excedente ocupado, reintentando:", idExcedente);
    idExcedente = await generarId(supabase, productor.name, producto);
  }

  if (error) {
    console.error("excedentes insert:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, idExcedente, excedenteId: fila?.id };
}

/**
 * Cierre del intake por WhatsApp: crea el excedente y avisa al productor.
 * La creación en sí vive en crearExcedente(), compartida con el panel.
 */
export async function crearExcedenteDesdeSesion(
  supabase: Cliente,
  sesion: SesionCompleta,
  productor: { id: string; name: string },
): Promise<void> {
  const producto = String(sesion.datos_parciales.producte ?? "");
  const r = await crearExcedente(supabase, sesion.datos_parciales, productor, "intake");

  if (!r.ok) {
    await sendText(
      supabase, sesion.telefono,
      "Hi ha hagut un problema en registrar l'oferta. Ho revisem i et diem alguna cosa.",
    );
    return;
  }

  await supabase.from("intake_sessions").delete().eq("id", sesion.id);
  await sendText(
    supabase, sesion.telefono,
    `Gràcies! Hem registrat la teva oferta de ${producto} amb la referència ${r.idExcedente}. ` +
      `T'avisarem quan estigui canalitzada.`,
  );
}
