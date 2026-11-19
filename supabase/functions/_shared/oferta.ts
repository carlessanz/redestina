// Cierre del intake: identificador, alta del excedente y texto de la oferta.

import { sendText } from "./whatsapp.ts";
import { confirmarOfertaPerCorreu } from "./correu-oferta.ts";
import { ambPreu, modalitatsDe, principal } from "./modalitats.ts";
import { llegeixHorari } from "./franja.ts";
import {
  componerTextoOferta, diesValids, textCaixes, textoEnvasos, textoOfertaDeDades,
} from "./textOferta.ts";
import { TEXT_ERROR_INTAKE, textAgraimentIntake, textSenseConveniIntake } from "./textIntake.ts";

// El texto de la oferta vive en `textOferta.ts` (módulo hoja, 27-10-2026); se reexporta para
// que quien lo importaba de aquí no cambie nada.
export { componerTextoOferta, textCaixes, textoEnvasos, textoOfertaDeDades };

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

/**
 * El enlace de Maps PROPIO de la oferta (17-11-2026), o null: http(s) y como mucho 500
 * caracteres (el check `excedentes_gmaps_url` de la base dice lo mismo). Lo que no lo es se
 * descarta: el campo es opcional y `crear-oferta` ya rechaza antes un valor mal formado.
 */
export function mapsOferta(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return /^https?:\/\/\S+$/i.test(t) && t.length <= 500 ? t : null;
}

/**
 * Qué envases hay que devolver y cuántos (17-11-2026), solo si la respuesta al retorno es «Sí»:
 * con «No» o sin retorno, lo que quede escrito de antes no se guarda.
 */
/**
 * Las hectáreas aproximadas (19-11-2026, columna `hectarees`): un número > 0 con dos decimales
 * como mucho, o null. Acepta la coma decimal. Solo cuentan con el producto en el campo: si no,
 * null aunque llegue un valor (la pregunta no se hace y el dato no tendría sentido).
 */
export function hectareesDe(d: Record<string, unknown>): number | null {
  if (!esProducteAlCamp(d.producte_al_camp)) return null;
  const v = d.hectarees;
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function retornDetall(d: Record<string, unknown>): { detall: string | null; quantitat: number | null } {
  if (d.retorn !== "Sí") return { detall: null, quantitat: null };
  const detall = String(d.retorn_envasos ?? "").trim().slice(0, 400) || null;
  const q = Number(d.retorn_quantitat);
  return { detall, quantitat: Number.isInteger(q) && q > 0 ? q : null };
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

/** La causa de una oferta, resuelta contra el catálogo (fase B del punto 3). */
export interface CausaResolta {
  causaCodigo: string | null;
  subcausaCodigo: string | null;
  /** Nombre catalán de la causa (la columna `causa` y la línea CAUSA del texto). */
  causa: string | null;
  subcausa: string | null;
}

/**
 * El código que llega en `causa` puede ser una SUBCAUSA (`C4.2`, el panel) o una CAUSA (`C4`,
 * WhatsApp; o una de las de antes en una sesión de intake a medias). Se mira primero en
 * `subcausas`; si no está, en `causas`. Un código que no está en ninguna se guarda tal cual
 * como `causa_codigo` (como hasta hoy) y sin nombre.
 */
export async function resolCausa(supabase: Cliente, valor: unknown): Promise<CausaResolta> {
  const codi = typeof valor === "string" ? valor.trim() : "";
  if (!codi) return { causaCodigo: null, subcausaCodigo: null, causa: null, subcausa: null };
  const { data: sub } = await supabase.from("subcausas")
    .select("codigo, causa_codigo, nombre").eq("codigo", codi).maybeSingle();
  const causaCodigo = (sub as { causa_codigo: string } | null)?.causa_codigo ?? codi;
  const { data: c } = await supabase.from("causas").select("nombre").eq("codigo", causaCodigo).maybeSingle();
  return {
    causaCodigo,
    subcausaCodigo: sub ? codi : null,
    causa: (c as { nombre: string | null } | null)?.nombre ?? null,
    subcausa: (sub as { nombre: string } | null)?.nombre ?? null,
  };
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
  /**
   * Fase C del punto 3 (17-11-2026): publicar un ESBORRANY ya guardado. La fila existe (estado
   * `esborrany`, sin `id_excedente`): se reescribe entera con lo validado y pasa a `publicada`
   * —la base decide si en realidad queda `pendent_validacio`, igual que en el alta directa—.
   */
  opcions: { esborranyId?: string } = {},
): Promise<ResultadoCreacion> {
  const producto = String(d.producte ?? "");

  // Datos que no se le piden al productor porque ya están en la base.
  const [{ data: prod }, { data: ubicacion }, causa] = await Promise.all([
    supabase.from("productos").select("eur_kg, familia").eq("nombre", producto).maybeSingle(),
    d.ubicacio
      ? supabase.from("productor_ubicaciones").select("*").eq("id", d.ubicacio).maybeSingle()
      : Promise.resolve({ data: null }),
    resolCausa(supabase, d.causa),
  ]);

  const { data: fichaProductor } = await supabase
    .from("productores").select("poblacion, empresa").eq("id", productor.id).maybeSingle();

  // El nombre de la ORGANIZACIÓN (`empresa`, el «Nom comercial»), con `name` de respaldo:
  // en una ficha del registro `name` es la persona de contacto, y el código de la oferta
  // salía con sus iniciales (28-09-2026). Es el mismo criterio que ya aplican en SQL
  // `crear_espigolada()` y el alta de albaranes (`coalesce(p.empresa, p.name)`).
  const nomOrganitzacio = fichaProductor?.empresa || productor.name;
  const fila = filaDeDades(d, prod?.familia ?? null, causa);
  const kg = Number(fila.kg_total ?? 0);
  let idExcedente = await generarId(supabase, nomOrganitzacio, producto);

  // 🔴 El texto sale de la FILA (fase C del punto 3): la misma función que al editar, así que
  //    lo que se comparte dice siempre lo que dice la oferta.
  const textoOferta = textoOfertaDeDades(fila, {
    productor: nomOrganitzacio,
    municipi: ubicacion?.municipio ?? fichaProductor?.poblacion ?? "",
    mapsLloc: ubicacion?.gmaps_url ?? null,
    causa: causa.causa ?? (d.causa ? String(d.causa) : null),
    subcausa: causa.subcausa,
    // Lo que se escribió, para cuando no es una fecha que se pueda leer (WhatsApp).
    disponibleText: String(d.disponible_fins ?? ""),
  });

  // El alta, con reintento ante colisión del correlativo.
  //
  // ⚠️ POR QUÉ HACE FALTA AUNQUE EL CONTADOR SEA ATÓMICO. `siguiente_numero()` garantiza
  //    que dos altas simultáneas reciben N distintas, pero no sabe nada de los
  //    `id_excedente` que ya existen: los de antes de este cambio se numeraron contando
  //    filas, y la serie `E-AAMMDD-XXX-YYY` de ese día nace con el contador a cero. Con el
  //    reintento, ese caso se resuelve solo: el `unique` de `id_excedente` rechaza el
  //    duplicado (23505), se pide el número siguiente y se vuelve a intentar. Tres intentos:
  //    si tres números seguidos chocan, el problema no es una carrera.
  let creada: { id: string; estado: string } | null = null;
  let error: { message: string; code?: string } | null = null;
  for (let intento = 0; intento < 3; intento++) {
    const valors = {
      ...fila,
      id_excedente: idExcedente,
      productor_id: productor.id,
      valor_eur: kg ? kg * Number(prod?.eur_kg ?? 1) : null,
      texto_oferta: textoOferta,
      // De dónde viene esta oferta (check de cuatro valores, default `'intake'`). Un
      // esborrany publicado toma el de quien lo publica.
      origen,
      // Se escribe `publicada` y la BASE decide si en realidad queda pendiente de validar
      // (trigger `excedentes_validacio`, 05-10-2026; desde la fase C también al publicar un
      // esborrany): la regla vive en un solo sitio aunque las ofertas entren por varios caminos.
      estado: "publicada",
    };
    const r = opcions.esborranyId
      ? await supabase.from("excedentes").update(valors)
        .eq("id", opcions.esborranyId).eq("estado", "esborrany")
        .select("id, estado").maybeSingle()
      : await supabase.from("excedentes").insert(valors).select("id, estado").single();
    creada = r.data;
    error = r.error;
    if (!error && !creada) error = { message: "esborrany_inexistent" };
    if (!error) break;
    if (error.code !== "23505") break;
    console.warn("excedentes: id_excedente ocupado, reintentando:", idExcedente);
    idExcedente = await generarId(supabase, nomOrganitzacio, producto);
  }

  if (error) {
    console.error("excedentes alta:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, idExcedente, excedenteId: creada?.id, estado: creada?.estado };
}

/**
 * Las columnas de `excedentes` a partir de lo que contesta el cuestionario (intake o panel),
 * SIN identificador, texto, origen ni estado. Pura: la usan el alta, la publicación de un
 * esborrany y el guardado de un esborrany (que, con datos a medias, deja nulo lo que falta).
 */
export function filaDeDades(
  d: Record<string, unknown>,
  familiaCataleg: string | null,
  causa: CausaResolta,
): Record<string, unknown> {
  const kgN = Number(String(d.kg ?? "").replace(",", "."));
  const kg = Number.isFinite(kgN) && kgN > 0 ? kgN : null;
  // Las modalidades, en plural desde el 05-10-2026 (`modalitats.ts`). `modalitat` sigue
  // guardando la PRINCIPAL para todo lo que todavía lee una sola.
  const modalitats = modalitatsDe(d.modalitat);
  const preuN = ambPreu(modalitats) && d.preu_minim != null && d.preu_minim !== ""
    ? Number(String(d.preu_minim).replace(",", "."))
    : null;
  // El coste que declara el productor (27-09-2026). Solo se pregunta si se ofrece en
  // donació; si no lo dice, null y la canalización toma la referencia del producto.
  const costKg = modalitats.includes("donacio") ? costDeclarat(d.cost_kg) : null;
  // La franja de recogida (05-10-2026): del panel llega `{inici, fi}`; del bot, texto, que
  // se intenta leer. El texto se guarda siempre (`horari_recollida`).
  const horari = llegeixHorari(d.horari);
  // 17-11-2026: el retorno con su detalle, los días de recogida (solo del panel) y el enlace de
  // Maps propio de la oferta, que manda sobre el del lugar (la ficha del lugar no se toca).
  const retorn = retornDetall(d);
  const dies = diesValids(d.dies_recollida);
  const caixes = Number(d.caixes);
  return {
    ubicacion_id: d.ubicacio || null,
    familia: familiaCataleg ?? d.familia ?? null,
    producto: String(d.producte ?? "").trim() || null,
    variedad: typeof d.varietat === "string" && d.varietat.trim() ? d.varietat.trim().slice(0, 400) : null,
    // Se resuelve UNA vez: el texto que circula y la columna que decide el flujo dicen lo mismo.
    producte_al_camp: esProducteAlCamp(d.producte_al_camp),
    hectarees: hectareesDe(d),
    kg_total: kg,
    num_caixes: Number.isInteger(caixes) && caixes > 0 ? caixes : null,
    // `tipo_caixa` ya no se pregunta (23-09-2026): el formato de entrega lo sustituye.
    format_entrega: d.format_entrega || null,
    retorn_envasos: d.retorn === "Sí" || d.retorn === "No" ? d.retorn : null,
    retorn_envasos_detall: retorn.detall,
    retorn_envasos_quantitat: retorn.quantitat,
    dies_recollida: dies.length > 0 ? dies : null,
    gmaps_url: mapsOferta(d.gmaps_url),
    // Tres valores, a propósito: sí, no, o no se preguntó (la pregunta está oculta desde la
    // fase A del punto 3; se conserva lo que llegue por compatibilidad).
    transport_propi: d.transport === "si" ? true : d.transport === "no" ? false : null,
    // Solo llegan del panel (el bot no recibe imágenes todavía, brecha 8); `crear-oferta`
    // ya ha comprobado que son de la carpeta de este productor.
    fotos: Array.isArray(d.fotos) ? (d.fotos as string[]).slice(0, 3) : [],
    // Sin fotos propias, ¿se enseña la del catálogo? Solo un `false` explícito lo apaga.
    foto_producte: d.foto_producte !== false,
    modalitat: principal(modalitats),
    modalitats: modalitats.length > 0 ? modalitats : null,
    preu_minim: preuN != null && Number.isFinite(preuN) ? preuN : null,
    coste_kg: costKg,
    // Fase B del punto 3: del panel llega una SUBCAUSA (`C4.2`) y de WhatsApp una categoría
    // (`C4`). Con subcausa, la causa es la suya (el trigger `excedentes_subcausa` lo impone).
    causa: causa.causa,
    causa_codigo: causa.causaCodigo,
    subcausa_codigo: causa.subcausaCodigo,
    // Se intenta parsear la respuesta libre ("23/07"); si no es una fecha reconocible queda
    // null y el panel la normaliza a mano.
    disponible_hasta: parseDisponibleFins(String(d.disponible_fins ?? "")),
    horari_recollida: horari.text,
    hora_recollida_inici: horari.franja?.inici ?? null,
    hora_recollida_fi: horari.franja?.fi ?? null,
    observacions: typeof d.observacions === "string" && d.observacions.trim() ? d.observacions.trim() : null,
  };
}

/**
 * Guarda un ESBORRANY (fase C del punto 3, 17-11-2026): crea la fila o la reescribe. Basta con
 * productor y producto; el resto se guarda tal cual en `dades_esborrany` (para reabrir el
 * formulario como estaba) y, lo que se entiende, también en sus columnas. Sin identificador ni
 * texto: los dos nacen al publicar. No dispara nada: ni validación, ni avisos, ni correo.
 */
export async function desarEsborrany(
  supabase: Cliente,
  d: Record<string, unknown>,
  productorId: string,
  origen: OrigenExcedente,
  id?: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const producto = String(d.producte ?? "").trim();
  const [{ data: prod }, causa] = await Promise.all([
    supabase.from("productos").select("familia").eq("nombre", producto).maybeSingle(),
    resolCausa(supabase, d.causa),
  ]);
  const valors = {
    ...filaDeDades(d, prod?.familia ?? null, causa),
    // Un código de causa que no está en el catálogo no se guarda en la columna (la base lo
    // rechazaría); se queda en `dades_esborrany` y la publicación lo volverá a mirar.
    ...(causa.causa ? {} : { causa: null, causa_codigo: null, subcausa_codigo: null }),
    dades_esborrany: d,
  };
  if (id) {
    const { data, error } = await supabase.from("excedentes").update(valors)
      .eq("id", id).eq("estado", "esborrany").eq("productor_id", productorId)
      .select("id").maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "esborrany_inexistent" };
    return { ok: true, id: data.id };
  }
  const { data, error } = await supabase.from("excedentes")
    .insert({ ...valors, productor_id: productorId, origen, estado: "esborrany" })
    .select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
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
    await sendText(supabase, sesion.telefono, textSenseConveniIntake(modalitats));
    return;
  }

  const r = await crearExcedente(supabase, sesion.datos_parciales, productor, "intake");

  if (!r.ok) {
    // La sesión se queda en el último paso: volver a escribir las observaciones reintenta
    // el alta. Antes decía «ho revisem i et diem alguna cosa», y no avisaba a nadie.
    await sendText(supabase, sesion.telefono, TEXT_ERROR_INTAKE);
    return;
  }

  await supabase.from("intake_sessions").delete().eq("id", sesion.id);
  await sendText(supabase, sesion.telefono, textAgraimentIntake(producto, r.idExcedente ?? "", r.estado));

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
  const [{ data: prod }, { data: ubi }, causa] = await Promise.all([
    supabase.from("productores").select("name, empresa, poblacion").eq("id", fila.productor_id).maybeSingle(),
    fila.ubicacion_id
      ? supabase.from("productor_ubicaciones").select("municipio, gmaps_url").eq("id", fila.ubicacion_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Con subcausa (fase B del punto 3), «Categoria — Subcausa»; si no, la causa guardada.
    fila.subcausa_codigo ? resolCausa(supabase, fila.subcausa_codigo) : Promise.resolve(null),
  ]);
  return textoOfertaDeDades(fila, {
    productor: prod?.empresa || prod?.name || "",
    municipi: ubi?.municipio ?? prod?.poblacion ?? "",
    mapsLloc: ubi?.gmaps_url ?? null,
    causa: causa?.causa ?? null,
    subcausa: causa?.subcausa ?? null,
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
  // La subcausa (fase B del punto 3): un código; vacío viaja vacío y la RPC lo rechaza.
  if ("subcausa_codigo" in entrada) fora.subcausa_codigo = String(entrada.subcausa_codigo ?? "").trim();
  for (const k of ["observacions", "variedad"]) {
    if (k in entrada) fora[k] = entrada[k] == null ? null : String(entrada[k]).trim().slice(0, 400);
  }
  if ("franja" in entrada) {
    const h = llegeixHorari(entrada.franja);
    fora.hora_recollida_inici = h.franja?.inici ?? null;
    fora.hora_recollida_fi = h.franja?.fi ?? null;
    fora.horari_recollida = h.text;
  }
  // Fase C del punto 3 (17-11-2026): todo lo de la ficha salvo producto y entidad. La RPC
  // vuelve a comprobar cada valor (lugar del mismo productor, fotos de su carpeta…).
  if ("ubicacion_id" in entrada) {
    const v = String(entrada.ubicacion_id ?? "").trim();
    fora.ubicacion_id = v || null;
  }
  if ("gmaps_url" in entrada) {
    const v = String(entrada.gmaps_url ?? "").trim();
    // Vacío = sin enlace propio; mal formado viaja tal cual y la RPC lo rechaza (`maps_invalid`).
    fora.gmaps_url = v || null;
  }
  if ("format_entrega" in entrada) fora.format_entrega = entrada.format_entrega ? String(entrada.format_entrega) : null;
  if ("retorn_envasos" in entrada) {
    fora.retorn_envasos = entrada.retorn_envasos === "Sí" || entrada.retorn_envasos === "No"
      ? entrada.retorn_envasos : entrada.retorn_envasos ? String(entrada.retorn_envasos) : null;
  }
  if ("retorn_envasos_detall" in entrada) {
    const v = String(entrada.retorn_envasos_detall ?? "").trim();
    fora.retorn_envasos_detall = v ? v.slice(0, 400) : null;
  }
  if ("retorn_envasos_quantitat" in entrada) {
    const n = num(entrada.retorn_envasos_quantitat);
    if (n !== undefined) fora.retorn_envasos_quantitat = n;
  }
  if ("producte_al_camp" in entrada) fora.producte_al_camp = esProducteAlCamp(entrada.producte_al_camp);
  // Hectáreas (19-11-2026): vacío = sin dato; mal formado viaja tal cual y la RPC lo rechaza.
  if ("hectarees" in entrada) {
    const n = num(entrada.hectarees);
    fora.hectarees = n === undefined ? String(entrada.hectarees) : n;
  }
  if ("dies_recollida" in entrada) fora.dies_recollida = diesValids(entrada.dies_recollida);
  if ("fotos" in entrada) {
    fora.fotos = Array.isArray(entrada.fotos) ? entrada.fotos.filter((f) => typeof f === "string") : [];
  }
  if ("foto_producte" in entrada) fora.foto_producte = entrada.foto_producte !== false;
  return fora;
}
