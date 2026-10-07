// Cierre del intake: identificador, alta del excedente y texto de la oferta.

import { sendText } from "./whatsapp.ts";
import { confirmarOfertaPerCorreu } from "./correu-oferta.ts";
import { ambPreu, etiquetaModalitats, modalitatsDe, principal } from "./modalitats.ts";
import { llegeixHorari } from "./franja.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

interface SesionCompleta {
  id: string;
  telefono: string;
  productor_id: string | null;
  datos_parciales: Record<string, unknown>;
}

// El texto que se publica usa las etiquetas de siempre, no los valores internos.
// Con mayúscula inicial: todos los demás valores del mensaje la llevan —PRODUCTE,
// PRODUCTOR, CAUSA— porque salen tal cual de la base o de lo que ha escrito la persona;
// esta era la única en minúscula, por venir de un mapa escrito a mano (deuda §12.122).

/**
 * ¿La oferta declara producto SIN COSECHAR? (`excedentes.producte_al_camp`, 20270328101000)
 *
 * Existe porque la respuesta llega de dos sitios con formas distintas y no se puede
 * confiar en ninguna: el intake guarda el `id` de la opción pulsada (`"si"` / `"no"`) y el
 * panel manda lo que el desplegable tenga seleccionado, que es ese mismo id pero podría
 * ser un boolean el día que la pantalla lo pinte como casilla. Un `Boolean(d.x)` a secas
 * diría que `"no"` es cierto, que es el error caro: marcaría como «hay que ir a collir»
 * una oferta de producto ya envasado.
 *
 * ⚠️ Ante cualquier otra cosa —ausente, vacío, un id que no reconoce— devuelve **false**,
 *    que es el default de la columna y lo que son todas las ofertas anteriores. Es el lado
 *    seguro por el mismo motivo: `false` deja el circuito como estaba; `true` inventado
 *    metería la oferta en la cola de espigolades del equipo y afirmaría al receptor algo
 *    que nadie ha dicho.
 */
/** Un coste por kilo positivo, o null si no se dijo o no es un número (acepta la coma). */
export function costDeclarat(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function esProducteAlCamp(valor: unknown): boolean {
  if (typeof valor === "boolean") return valor;
  const v = String(valor ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return v === "si" || v === "true" || v === "1";
}

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
  /** Solo cuando es cierto se imprime la línea: el silencio significa «ja està collit». */
  producteAlCamp?: boolean;
  productor: string;
  municipi: string;
  /** Sin enlace de Maps no se imprime el bloque entero (ver más abajo). */
  ubicacio?: string;
  quantitat: string;
  disponible: string;
  /** Campo libre y opcional del panel: sin respuesta, no se imprime la línea. */
  horari?: string;
  modalitat: string;
  preu?: string;
  causa: string;
  /** Formato de entrega y retorno, ya compuestos (`textoEnvasos`). Sin nada, no se imprime. */
  envasos?: string;
  /** Solo cuando el productor lo lleva: el silencio significa «cal venir a buscar-lo». */
  transportPropi?: boolean;
  /**
   * `responsable` y `observacions` SIEMPRE se imprimen, aunque estén vacías —al revés que
   * `ubicacio`/`horari`/`envasos` de aquí arriba—, y es una decisión distinta y ya tomada
   * (`tests/oferta.test.ts`, «un campo vacío deja su etiqueta, no borra la línea»): son
   * texto libre que alguien podría haber escrito, y una etiqueta vacía se lee como «no hi
   * ha», mientras que una línea que desaparece se lee como un fallo. No tocar sin revisar
   * ese test.
   */
  responsable: string;
  observacions: string;
}): string {
  const lineas = [
    "📢 *OFERTA DISPONIBLE*",
    "",
    `🌿 PRODUCTE: ${campos.producte}`,
  ];
  // Va pegada al producto, y no al final con las observaciones, porque califica QUÉ se
  // ofrece: la entidad tiene que saber que todavía no está collit **antes** de decir que
  // le interesa, no cuando llegue a la finca.
  //
  // ⚠️ Solo se imprime cuando es cierto, igual que el `preu mínim` de más abajo. Una línea
  //    «PRODUCTE AL CAMP: no» en el caso normal —que es la inmensa mayoría de las ofertas—
  //    sería ruido en un mensaje que se lee en un móvil, y esa asimetría es deliberada: el
  //    silencio significa «ja està collit», que es lo que la oferta ya daba a entender
  //    antes de que este campo existiera.
  if (campos.producteAlCamp) {
    lineas.push("🌱 PRODUCTE AL CAMP: sí (encara no s'ha collit)");
  }
  lineas.push(
    `👩‍🌾 PRODUCTOR: ${campos.productor}`,
    `📍 MUNICIPI: ${campos.municipi}`,
  );
  // Sin enlace de Maps no hay nada que poner bajo la etiqueta: un guion suelto en su
  // propia línea no dice nada y ocupa sitio en un mensaje que se lee en el móvil (mismo
  // criterio que `producte_al_camp`/`preu_minim`, deuda §12.122).
  if (campos.ubicacio) {
    lineas.push(`🗺️ UBICACIÓ:`, campos.ubicacio);
  }
  lineas.push(`📦 QUANTITAT: ${campos.quantitat}`, `📅 DISPONIBLE: ${campos.disponible}`);
  if (campos.horari) lineas.push(`⏰ HORARI RECOLLIDA: ${campos.horari}`);
  lineas.push(`💰 MODALITAT: ${campos.modalitat}`);
  // Preu mínim solo en venda/maquila (el productor lo fija en l'intake).
  if (campos.preu) lineas.push(`💶 PREU MÍNIM: ${campos.preu}`);
  lineas.push(`🔴 CAUSA: ${campos.causa}`);
  if (campos.envasos) lineas.push(`♻️ ENVASOS: ${campos.envasos}`);
  // Misma asimetría que `producte_al_camp`: solo se dice cuando cambia lo que hay que hacer.
  if (campos.transportPropi) lineas.push("🚚 TRANSPORT: el porta la productora");
  lineas.push(
    `👥 RESPONSABLE: ${campos.responsable}`,
    `📝 OBSERVACIONS: ${campos.observacions}`,
    "",
    "✅ Si t'interessa, prem *M'interessa* (o respon *SÍ*); si no, *Ara no*.",
  );
  return lineas.join("\n");
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
 * La línea ENVASOS: formato de entrega y, si aplica, si hay que devolverlos. Vacía si no se
 * preguntó (producto en el campo) — y entonces la línea no se imprime.
 */
export function textoEnvasos(format: unknown, retorn: unknown): string {
  const f = ETIQUETA_FORMAT[String(format ?? "")] ?? "";
  const r = String(retorn ?? "");
  const ret = r === "Sí" ? "cal retornar-los" : r === "No" ? "no cal retornar-los" : "";
  return [f, ret].filter(Boolean).join(" · ");
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
  /**
   * El estado con el que ha quedado: `publicada` o `pendent_validacio` (05-10-2026). Lo decide
   * la BASE (trigger `excedentes_validacio`), no esta función, así que quien llama lo lee
   * aquí para decirle al productor lo que de verdad ha pasado.
   */
  estado?: string;
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
  // Las modalidades, en plural desde el 05-10-2026 (`modalitats.ts`). `modalitat` sigue
  // guardando la PRINCIPAL para todo lo que todavía lee una sola.
  const modalitats = modalitatsDe(d.modalitat);
  const preuMinim = ambPreu(modalitats) && d.preu_minim != null && d.preu_minim !== ""
    ? Number(String(d.preu_minim).replace(",", "."))
    : null;
  // El coste que declara el productor (27-09-2026). Solo se pregunta si se ofrece en
  // donació; si no lo dice, null y la canalización toma la referencia del producto.
  const costKg = modalitats.includes("donacio") ? costDeclarat(d.cost_kg) : null;
  // La franja de recogida (05-10-2026): del panel llega `{inici, fi}`; del bot, texto, que
  // se intenta leer. El texto se guarda siempre (`horari_recollida`).
  const horari = llegeixHorari(d.horari);
  // Se resuelve UNA vez. El texto que circula y la columna que decide el flujo tienen que
  // decir lo mismo, y con dos lecturas del mismo campo eso deja de estar garantizado en
  // cuanto alguien cambie una de las dos.
  const alCamp = esProducteAlCamp(d.producte_al_camp);
  // Tres valores, a propósito: sí, no, o no se preguntó (producto en el campo).
  const transportPropi = d.transport === "si" ? true : d.transport === "no" ? false : null;
  const municipio = ubicacion?.municipio ?? fichaProductor?.poblacion ?? "";
  // El nombre de la ORGANIZACIÓN (`empresa`, el «Nom comercial»), con `name` de respaldo:
  // en una ficha del registro `name` es la persona de contacto, y el código de la oferta
  // salía con sus iniciales (28-09-2026). Es el mismo criterio que ya aplican en SQL
  // `crear_espigolada()` y el alta de albaranes (`coalesce(p.empresa, p.name)`).
  const nomOrganitzacio = fichaProductor?.empresa || productor.name;
  let idExcedente = await generarId(supabase, nomOrganitzacio, producto);

  const textoOferta = componerTextoOferta({
    producte: producto,
    producteAlCamp: alCamp,
    productor: nomOrganitzacio,
    municipi: municipio,
    ubicacio: ubicacion?.gmaps_url || undefined,
    quantitat: `${String(kg).replace(".", ",")} kg aprox${d.caixes ? ` · ${textCaixes(Number(d.caixes), d.format_entrega)}` : ""}`,
    disponible: String(d.disponible_fins ?? ""),
    horari: horari.text ?? undefined,
    modalitat: etiquetaModalitats(modalitats),
    // Con coma decimal, como se escribe en catalán: «0,45 €/kg» y no «0.45 €/kg».
    preu: preuMinim != null ? `${preuMinim.toFixed(2).replace(".", ",")} €/kg` : undefined,
    causa: causa?.nombre ?? String(d.causa ?? ""),
    envasos: textoEnvasos(d.format_entrega, d.retorn) || undefined,
    transportPropi: transportPropi === true,
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
  let fila: { id: string; estado: string } | null = null;
  let error: { message: string; code?: string } | null = null;
  for (let intento = 0; intento < 3; intento++) {
    const r = await supabase.from("excedentes").insert({
      id_excedente: idExcedente,
      productor_id: productor.id,
      ubicacion_id: d.ubicacio ?? null,
      familia: prod?.familia ?? d.familia ?? null,
      producto,
      variedad: d.varietat ?? null,
      producte_al_camp: alCamp,
      kg_total: kg || null,
      num_caixes: d.caixes ?? null,
      // `tipo_caixa` ya no se pregunta (revisión del 23-09-2026): el formato de entrega lo
      // sustituye, y las taras se fijan por línea en el albarán.
      format_entrega: d.format_entrega ?? null,
      retorn_envasos: d.retorn ?? null,
      transport_propi: transportPropi,
      // Solo llegan del panel (el bot no recibe imágenes todavía, brecha 8); `crear-oferta`
      // ya ha comprobado que son de la carpeta de este productor.
      fotos: Array.isArray(d.fotos) ? (d.fotos as string[]).slice(0, 3) : [],
      // Sin fotos propias, ¿se enseña la del catálogo? Solo un `false` explícito lo apaga.
      foto_producte: d.foto_producte !== false,
      modalitat: principal(modalitats),
      modalitats,
      preu_minim: preuMinim,
      coste_kg: costKg,
      causa: causa?.nombre ?? null,
      causa_codigo: d.causa ?? null,
      // Se intenta parsear la respuesta libre ("23/07"); si no es una fecha
      // reconocible queda null y el panel la normaliza a mano.
      disponible_hasta: parseDisponibleFins(String(d.disponible_fins ?? "")),
      horari_recollida: horari.text,
      hora_recollida_inici: horari.franja?.inici ?? null,
      hora_recollida_fi: horari.franja?.fi ?? null,
      observacions: d.observacions ?? null,
      valor_eur: kg ? kg * Number(prod?.eur_kg ?? 1) : null,
      texto_oferta: textoOferta,
      // De dónde viene esta oferta. La columna la añadió `20261012100100` con un check de
      // cuatro valores y default `'intake'`; escribirlo explícitamente es lo que hace que
      // el default deje de ser una suposición sobre el caso mayoritario.
      origen,
      // Se escribe `publicada` y la BASE decide si en realidad queda pendiente de validar
      // (trigger `excedentes_validacio`, 05-10-2026): así la regla vive en un solo sitio
      // aunque las ofertas entren por cuatro caminos, y el interruptor de Configuració manda
      // sobre todos ellos sin redesplegar nada.
      estado: "publicada",
    }).select("id, estado").single();
    fila = r.data;
    error = r.error;
    if (!error) break;
    if (error.code !== "23505") break;
    console.warn("excedentes: id_excedente ocupado, reintentando:", idExcedente);
    idExcedente = await generarId(supabase, nomOrganitzacio, producto);
  }

  if (error) {
    console.error("excedentes insert:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, idExcedente, excedenteId: fila?.id, estado: fila?.estado };
}

/**
 * Cierre del intake por WhatsApp: crea el excedente y avisa al productor.
 * La creación en sí vive en crearExcedente(), compartida con el panel.
 */
export async function crearExcedenteDesdeSesion(
  supabase: Cliente,
  sesion: SesionCompleta,
  /** `email` es opcional: solo 78 de 345 productores tienen, y sin él no se manda correo. */
  productor: { id: string; name: string; email?: string | null },
): Promise<void> {
  const producto = String(sesion.datos_parciales.producte ?? "");

  // El convenio que exige la modalidad a quien entrega, igual que `crear-oferta` desde el
  // panel (28-09-2026). Por aquí se publicaba sin él: el intake no pasa por aquella función.
  // Desde la fecha de corte, 42501; antes, solo un aviso que aquí no se usa.
  // Con varias modalidades (05-10-2026) basta con que UNA tenga su convenio vigente: la
  // oferta circula, y la que no lo tenga la para `aprovar_resposta()` al canalizar. Es la
  // misma regla que `crear-oferta` (`modalitatsAmbConveni()`).
  const modalitats = modalitatsDe(sesion.datos_parciales.modalitat);
  const cobertes = await modalitatsAmbConveni(supabase, productor.id, modalitats);
  if (cobertes.length === 0) {
    await supabase.from("intake_sessions").delete().eq("id", sesion.id);
    await sendText(
      supabase, sesion.telefono,
      modalitats.length === 1 && modalitats[0] === "donacio"
        ? "No podem publicar l'oferta: per a donacions cal tenir vigent el conveni de donació. " +
          "Demana'l a l'equip de Redestina i torna-ho a provar."
        : "No podem publicar l'oferta: cal tenir vigent el conveni de col·laboració per a " +
          "alguna de les modalitats triades. Demana'l a l'equip de Redestina.",
    );
    return;
  }

  const r = await crearExcedente(supabase, sesion.datos_parciales, productor, "intake");

  if (!r.ok) {
    await sendText(
      supabase, sesion.telefono,
      // La sesión se queda en el último paso: volver a escribir las observaciones reintenta
      // el alta. Antes decía «ho revisem i et diem alguna cosa», y no avisaba a nadie.
      "No hem pogut registrar l'oferta per un error tècnic. D'aquí a uns minuts, torna a " +
        "escriure les observacions per tornar-ho a provar, o escriu *Stop* per cancel·lar-la.",
    );
    return;
  }

  await supabase.from("intake_sessions").delete().eq("id", sesion.id);
  await sendText(
    supabase, sesion.telefono,
    `Gràcies! Hem registrat la teva oferta de ${producto} amb la referència ${r.idExcedente}. ` +
      (r.estado === "pendent_validacio"
        // Desde el 05-10-2026 una oferta nueva espera a que el equipo la revise antes de
        // salir al Mercat. Decir «la farem arribar» sin más sería prometer algo que todavía
        // no ha pasado.
        ? "L'equip de Redestina la revisarà i, un cop validada, la farà arribar a les entitats que la puguin aprofitar."
        : "L'equip de Redestina la farà arribar a les entitats que la puguin aprofitar."),
  );

  // Y por correo, si la ficha lo tiene (deuda §12.94). No sustituye al WhatsApp de arriba:
  // ese contesta la conversación en curso, y este deja el registro buscable de la referencia
  // más su traza en `documento_envios`. Hasta hoy la misma oferta se confirmaba de una manera
  // u otra según por dónde hubiera entrado, que es lo que §8bis dice que no decide el canal.
  //
  // No se comprueba el resultado a propósito: la oferta está creada y el productor ya tiene su
  // referencia por WhatsApp, así que un fallo de correo no cambia nada de lo que él ve. Queda
  // registrado en `documento_envios` con su motivo.
  await confirmarOfertaPerCorreu(
    productor, r.idExcedente ?? "", r.excedenteId ?? "", sesion.datos_parciales, supabase, "intake",
    r.estado,
  );
}

/**
 * De las modalidades de una oferta, las que el productor puede ofrecer HOY porque tiene el
 * convenio que exigen a quien entrega (`exigir_convenio`). Antes de la fecha de corte la RPC
 * solo avisa, así que todas cuentan; desde el corte, solo las cubiertas. Un error que no sea
 * el `42501` de «sin convenio» no se interpreta como «no cubierta» —sería bloquear por un
 * fallo de red—: cuenta como cubierta y lo registra.
 */
export async function modalitatsAmbConveni(
  supabase: Cliente,
  productorId: string,
  modalitats: readonly string[],
): Promise<string[]> {
  const cobertes: string[] = [];
  for (const m of modalitats) {
    const { error } = await supabase.rpc("exigir_convenio", {
      p_tipo: "productor", p_org: productorId, p_valorizacion: m, p_parte: "entrega",
    });
    if (error?.code === "42501") continue;
    if (error) console.error("modalitatsAmbConveni:", m, error.message);
    cobertes.push(m);
  }
  return cobertes;
}

/**
 * El `texto_oferta` de una oferta YA EXISTENTE, compuesto desde su fila (05-10-2026: editar
 * una oferta lo reescribe). Usa el mismo `componerTextoOferta()` que el alta, así que el
 * formato no puede divergir; lo que cambia es de dónde salen los datos: la fecha de
 * disponibilidad es la normalizada (`dd/mm/aaaa`) y no el texto que escribió el productor,
 * que no se guarda aparte.
 */
export async function textoOfertaDeFila(
  supabase: Cliente,
  fila: Record<string, unknown>,
): Promise<string> {
  const [{ data: prod }, { data: ubi }] = await Promise.all([
    supabase.from("productores").select("name, empresa, poblacion").eq("id", fila.productor_id).maybeSingle(),
    fila.ubicacion_id
      ? supabase.from("productor_ubicaciones").select("municipio, gmaps_url").eq("id", fila.ubicacion_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const modalitats = modalitatsDe(
    Array.isArray(fila.modalitats) && fila.modalitats.length > 0 ? fila.modalitats : fila.modalitat,
  );
  const kg = Number(fila.kg_total ?? 0);
  const preu = ambPreu(modalitats) && fila.preu_minim != null ? Number(fila.preu_minim) : null;
  const data = typeof fila.disponible_hasta === "string" && /^\d{4}-\d{2}-\d{2}/.test(fila.disponible_hasta)
    ? fila.disponible_hasta.slice(0, 10).split("-").reverse().join("/")
    : "";
  return componerTextoOferta({
    producte: String(fila.producto ?? ""),
    producteAlCamp: fila.producte_al_camp === true,
    productor: prod?.empresa || prod?.name || "",
    municipi: ubi?.municipio ?? prod?.poblacion ?? "",
    ubicacio: ubi?.gmaps_url || undefined,
    quantitat: `${String(kg).replace(".", ",")} kg aprox${fila.num_caixes ? ` · ${textCaixes(Number(fila.num_caixes), fila.format_entrega)}` : ""}`,
    disponible: data,
    horari: fila.horari_recollida ? String(fila.horari_recollida) : undefined,
    modalitat: etiquetaModalitats(modalitats),
    preu: preu != null ? `${preu.toFixed(2).replace(".", ",")} €/kg` : undefined,
    causa: String(fila.causa ?? ""),
    envasos: textoEnvasos(fila.format_entrega, fila.retorn_envasos) || undefined,
    transportPropi: fila.transport_propi === true,
    responsable: "",
    observacions: String(fila.observacions ?? ""),
  });
}

/**
 * Los cambios que acepta `editar_oferta()`, a partir de lo que manda el panel. Puro: lo
 * prueba `tests/oferta.test.ts`. La franja llega como `{inici, fi}` y se guarda en sus dos
 * columnas MÁS el texto, como en el alta. Lo que no se reconoce se descarta en silencio;
 * la RPC rechaza igualmente cualquier clave fuera de su lista.
 */
export function canvisOferta(entrada: Record<string, unknown>): Record<string, unknown> {
  const fora: Record<string, unknown> = {};
  const num = (v: unknown) => {
    if (v === null || v === "") return null;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  };
  if ("kg_total" in entrada) { const n = num(entrada.kg_total); if (n !== undefined) fora.kg_total = n; }
  if ("modalitats" in entrada) fora.modalitats = modalitatsDe(entrada.modalitats);
  if ("preu_minim" in entrada) { const n = num(entrada.preu_minim); if (n !== undefined) fora.preu_minim = n; }
  if ("coste_kg" in entrada) { const n = num(entrada.coste_kg); if (n !== undefined) fora.coste_kg = n; }
  if ("num_caixes" in entrada) { const n = num(entrada.num_caixes); if (n !== undefined) fora.num_caixes = n === null ? null : Math.round(n); }
  if ("disponible_hasta" in entrada) {
    const v = String(entrada.disponible_hasta ?? "");
    fora.disponible_hasta = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }
  for (const k of ["observacions", "variedad"]) {
    if (k in entrada) fora[k] = entrada[k] == null ? null : String(entrada[k]).trim().slice(0, 400);
  }
  if ("franja" in entrada) {
    const h = llegeixHorari(entrada.franja);
    fora.hora_recollida_inici = h.franja?.inici ?? null;
    fora.hora_recollida_fi = h.franja?.fi ?? null;
    fora.horari_recollida = h.text;
  }
  return fora;
}
