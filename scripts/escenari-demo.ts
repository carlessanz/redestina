// El escenario de demostración: deja la base de staging contando una historia coherente.
//
//   SUPABASE_URL=... SB_SECRET_KEY=... deno run -A scripts/escenari-demo.ts [--dry-run]
//
// QUÉ HACE Y POR QUÉ. Los datos que había eran restos de fixtures de fases distintas:
// ofertas sueltas, intereses sin patrón y cuatro cuentas con los dos papeles a la vez. Esto
// los sustituye por un escenario donde **cada estado del circuito está representado al
// menos una vez**, para poder enseñar la aplicación sin ir inventando el contexto.
//
// 🔴 **NO BORRA TODO, Y NO PUEDE.** Una oferta con un documento emitido detrás no se borra:
//    `documentos_no_esborrar` lo impide por trigger y la numeración legal no admite huecos
//    (§4). Esas ofertas se quedan **a propósito** y hacen de histórico ya cerrado del
//    escenario, que además es un estado que hay que poder enseñar. Lo mismo con la que
//    sostiene una línea de cierre de donante.
//
// ⚠️ **UNA CUENTA, UN PAPEL.** Las fichas se mantienen todas —no se borra ninguna
//    organización— pero cada cuenta de prueba se queda con una sola membresía activa. El
//    doble rol existe y funciona (§6ter), pero tenerlo en cuatro de las once cuentas hacía
//    imposible enseñar el panel de un productor sin que saliera también el de receptor.
//    Las fichas del papel retirado quedan **sin cuenta**: las opera el equipo, que es el
//    modelo asistido (§1bis).
//
// ⚠️ **CONSUME NUMERACIÓN LEGAL.** Los convenios que deja vigentes piden número de la serie
//    CONV, y eso es irreversible. Es el precio de tener un escenario donde se pueda
//    aprobar un interés con la fecha de corte encendida (§4bis).
//
// IDEMPOTENTE en lo que puede serlo: las ofertas llevan referencia `E-DEMO-*` y no se
// duplican; el reparto de papeles y los convenios se comprueban antes de tocar nada.

import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY en el entorno.");
  Deno.exit(1);
}
const dryRun = Deno.args.includes("--dry-run");
const db = createClient(url, key, { auth: { persistSession: false } });

/**
 * Una sesión REAL de super_admin, para las RPC que comprueban el rol aunque quien llame
 * sea `service_role`.
 *
 * ⚠️ `aprovar_resposta()` es una de ellas: exige `pot_aprovar()` **sin la salida de
 *    «`auth.uid()` es null significa service_role»** que sí tienen las del circuito
 *    documental. No es un descuido de la función: aprobar es un acto con autor, y un
 *    aprobador nulo no es ninguno. Así que el escenario aprueba con una cuenta de verdad.
 */
// El tipo lo infiere `createClient` con parámetros genéricos que no encajan entre dos
// llamadas distintas; aquí solo se usa `.rpc()`, así que basta con eso.
let sessio: { rpc: (n: string, a: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }> } | null = null;
async function comSuperAdmin() {
  if (sessio) return sessio;
  // Mismo patrón que `comprobar-rls.ts`: la publishable key, no la secreta, porque
  // firmar por enlace pasa por `enlace-publico`, que valida con esa credencial.
  const pub = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const cuentas = JSON.parse(await Deno.readTextFile("scripts/data/cuentas-prueba.json"));
  const sa = (cuentas as { etiqueta: string; email: string; password: string }[])
    .find((c) => c.etiqueta === "superadmin");
  if (!pub || !sa) throw new Error("Falta PUBLISHABLE o la cuenta superadmin");
  const c = createClient(url!, pub);
  const { error } = await c.auth.signInWithPassword({ email: sa.email, password: sa.password });
  if (error) throw new Error(`login superadmin: ${error.message}`);
  // `createClient` infiere genéricos distintos en cada llamada y no encajan entre sí;
  // de esta sesión solo se usa `.rpc()`, que es lo que declara el tipo de arriba.
  sessio = c as unknown as typeof sessio;
  return sessio!;
}

function paso(txt: string) { console.log(`\n── ${txt}`); }
function ok(txt: string) { console.log(`   ✓ ${txt}`); }
function avis(txt: string) { console.log(`   ⚠ ${txt}`); }

// ---------------------------------------------------------------------------
// 1. Limpieza: solo lo que NO deja rastro documental
// ---------------------------------------------------------------------------
// La lista de qué se puede borrar se CALCULA, no se escribe a mano: una oferta con un
// documento emitido, o citada por una línea de cierre, se queda. Escribirla a mano sería
// correcto hoy y falso en cuanto alguien emita algo más.
async function netejar(): Promise<void> {
  paso("Limpieza de ofertas sin rastro documental");

  const { data: totes } = await db.from("excedentes").select("id, id_excedente, estado");
  const ofertes = (totes ?? []) as { id: string; id_excedente: string; estado: string }[];

  const aBorrar: typeof ofertes = [];
  for (const o of ofertes) {
    const { data: cans } = await db.from("canalizaciones").select("id").eq("excedente_id", o.id);
    const canIds = (cans ?? []).map((c) => c.id as string);

    // Albaranes del excedente o de sus canalizaciones.
    const { data: albs } = await db.from("albaranes")
      .select("id, estado").or(
        canIds.length
          ? `excedente_id.eq.${o.id},canalizacion_id.in.(${canIds.join(",")})`
          : `excedente_id.eq.${o.id}`,
      );
    const albIds = (albs ?? []).map((a) => a.id as string);

    let docs = 0;
    if (albIds.length) {
      const { count } = await db.from("documentos")
        .select("id", { count: "exact", head: true })
        .eq("objeto_tipo", "albaran").in("objeto_id", albIds);
      docs = count ?? 0;
    }
    let linies = 0;
    if (canIds.length) {
      const { count } = await db.from("cierre_donante_lineas")
        .select("id", { count: "exact", head: true }).in("canalizacion_id", canIds);
      linies = count ?? 0;
      const { count: c2 } = await db.from("cierre_periodo_lineas")
        .select("id", { count: "exact", head: true }).in("canalizacion_id", canIds);
      linies += c2 ?? 0;
    }

    if (docs > 0 || linies > 0) {
      avis(`${o.id_excedente} se queda: ${docs} documento(s), ${linies} línea(s) de cierre`);
      continue;
    }
    aBorrar.push(o);
  }

  if (dryRun) { ok(`se borrarían ${aBorrar.length} ofertas`); return; }

  for (const o of aBorrar) {
    const { data: cans } = await db.from("canalizaciones").select("id").eq("excedente_id", o.id);
    const canIds = (cans ?? []).map((c) => c.id as string);
    // El orden importa: lo que apunta antes que lo apuntado.
    if (canIds.length) {
      await db.from("albaranes").delete().in("canalizacion_id", canIds);
    }
    await db.from("albaranes").delete().eq("excedente_id", o.id);
    await db.from("oferta_respuestas").delete().eq("excedente_id", o.id);
    await db.from("canalizaciones").delete().eq("excedente_id", o.id);
    const { error } = await db.from("excedentes").delete().eq("id", o.id);
    if (error) { avis(`${o.id_excedente}: ${error.message}`); continue; }
    ok(`borrada ${o.id_excedente}`);
  }
}


// ---------------------------------------------------------------------------
// 2. Una cuenta, un papel
// ---------------------------------------------------------------------------
// Decisión del 21-09-2026: las cinco cuentas con doble rol se quedan con uno. Sebas y
// Raquel productores; Laura y Carles (sus dos cuentas) receptores. No se borra ninguna
// ficha: se desactiva la membresía del papel retirado, y esa ficha pasa a operarla el
// equipo.
//
// ⚠️ Se DESACTIVA (`activo = false`), no se borra: la membresía es también la traza de
//    quién tuvo acceso a qué, y borrarla perdería esa historia sin ganar nada.
const PAPER_QUE_ES_QUEDA: Record<string, "productor" | "entidad"> = {
  "hola+wa-sebas@carlessanz.com": "productor",
  "hola+wa-raquel@carlessanz.com": "productor",
  "hola+wa-laura@carlessanz.com": "entidad",
  "hola+wa-carles@carlessanz.com": "entidad",
  "hola+productor-receptor@carlessanz.com": "entidad",
};

async function repartirPapers(): Promise<void> {
  paso("Una cuenta, un papel");
  for (const [email, queEsQueda] of Object.entries(PAPER_QUE_ES_QUEDA)) {
    const { data: u } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
    const usuari = u?.users.find((x) => x.email === email);
    if (!usuari) { avis(`${email}: no existe esa cuenta`); continue; }

    const { data: mems } = await db.from("membresias")
      .select("id, tipo, activo").eq("user_id", usuari.id);
    const sobren = (mems ?? []).filter((m) => m.tipo !== queEsQueda && m.activo);
    if (sobren.length === 0) { ok(`${email}: ya es solo ${queEsQueda}`); continue; }
    if (dryRun) { ok(`${email}: se retiraría ${sobren.map((m) => m.tipo).join(", ")}`); continue; }

    const { error } = await db.from("membresias")
      .update({ activo: false }).in("id", sobren.map((m) => m.id));
    if (error) { avis(`${email}: ${error.message}`); continue; }
    ok(`${email}: se queda como ${queEsQueda}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Convenios: los que el escenario necesita vigentes
// ---------------------------------------------------------------------------
// Con `fecha_corte_convenios` encendida (§4bis), sin convenio vigente no se puede publicar
// ni aprobar un interés. Así que el escenario necesita que casi todos lo tengan… menos los
// dos que protagonizan el ciclo guiado, que se dejan a medias A PROPÓSITO para poder
// enseñar la fase 1 entera.
const SENSE_CONVENI_A_PROPOSIT = new Set([
  "Horta de Prova SL",            // sin ninguno: se ve preparar + firmar + contrafirmar
  "Menjador Social de Prova",     // en pendent_firma: se ve firmar + contrafirmar
  "TEST-PENDENT-ARNES",           // §9: esta ficha NO se toca nunca
]);

/** El camino real y entero: preparar → enviar → firmar por enlace → contrafirmar. */
async function conveniVigent(
  tipusOrg: "productor" | "entidad", orgId: string, nom: string, tipus: string,
): Promise<void> {
  const taula = tipusOrg === "productor" ? "productor_id" : "entidad_id";
  const { data: ja } = await db.from("convenios")
    .select("id, estado").eq(taula, orgId).eq("tipo", tipus).neq("estado", "substituit");
  const vigent = (ja ?? []).find((c) => c.estado === "vigent");
  if (vigent) { ok(`${nom}: ${tipus} ya vigente`); return; }
  if (dryRun) { ok(`${nom}: se firmaría ${tipus}`); return; }

  const { data: prep, error: e1 } = await db.rpc("preparar_convenio", {
    p_tipo_org: tipusOrg, p_org: orgId, p_tipo: tipus, p_idioma: "ca", p_roles_com: null,
  });
  if (e1) { avis(`${nom} preparar: ${e1.message}`); return; }
  const convId = (prep as Record<string, unknown>).id as string;

  const { data: env, error: e2 } = await db.rpc("enviar_convenio", { p_id: convId, p_email: null });
  if (e2 && !String(e2.message).includes("pendent_firma")) { avis(`${nom} enviar: ${e2.message}`); return; }
  const enllac = env ? (env as Record<string, unknown>).enllac as Record<string, unknown> : null;
  if (!enllac) { avis(`${nom}: sin enlace de firma`); return; }

  // ⚠️ LA HUELLA SE PIDE AL SERVIDOR, NO SE INVENTA. `evidencias.sha256_texto` responde a
  //    «QUÉ se firmó», y escribir ahí un valor cualquiera convertiría la evidencia en una
  //    afirmación falsa — que es justo lo que esa columna existe para impedir. El GET
  //    público del enlace devuelve el sha del texto que el servidor compone, así que lo que
  //    se guarda es la huella de verdad, igual que si lo hubiera firmado una persona.
  const resposta = await fetch(`${url}/functions/v1/enlace-publico?t=${enllac.token}`);
  const cos = await resposta.json() as Record<string, unknown>;
  const sha = typeof cos.sha256_texto === "string" ? cos.sha256_texto : "";
  if (sha === "") { avis(`${nom}: el servidor no ha dado la huella del texto`); return; }

  const { data: org } = await db.rpc("convenio_datos_org", { p_conv: convId });
  const { error: e3 } = await db.rpc("firmar_convenio_por_enlace", {
    p_enlace: enllac.id,
    p_datos: { organitzacio: org ?? {}, nom: "Escenari de demostració", carrec: "Apoderat/da" },
    p_evidencia: {
      nombre: "Escenari de demostració",
      cargo: "Apoderat/da",
      // Quien firma declara que puede obligar a la organización: sin esto no hay firma.
      declaracion_representacion: true,
      sha256_texto: sha,
      ip: null,
      // Dice lo que es. Una evidencia de un escenario de demostración no debe poder
      // confundirse con una firma real al leer la tabla.
      user_agent: "escenari-demo (dades simulades)",
    },
  });
  if (e3) { avis(`${nom} firmar: ${e3.code} ${e3.message}`); return; }

  const { error: e4 } = await db.rpc("contrafirmar_convenio", { p_id: convId });
  if (e4) { avis(`${nom} contrasignar: ${e4.message}`); return; }
  ok(`${nom}: ${tipus} vigente`);
}

async function convenis(): Promise<void> {
  paso("Convenios vigentes (menos los del ciclo guiado)");
  const { data: prods } = await db.from("productores")
    .select("id, name, empresa").eq("es_test", true);
  const { data: memsProd } = await db.from("membresias")
    .select("productor_id").eq("tipo", "productor").eq("activo", true);
  const prodAmbCompte = new Set((memsProd ?? []).map((m) => m.productor_id as string));
  for (const p of (prods ?? []) as { id: string; name: string; empresa: string | null }[]) {
    const nom = p.empresa ?? p.name;
    if (SENSE_CONVENI_A_PROPOSIT.has(nom)) { avis(`${nom}: se deja sin convenio a propósito`); continue; }
    if (!prodAmbCompte.has(p.id)) { avis(`${nom}: sin cuenta de productor, no publica`); continue; }
    await conveniVigent("productor", p.id, nom, "don_gen");
  }
  const { data: ents } = await db.from("entidades")
    .select("id, nombre, tipo_receptor").eq("es_test", true);
  // Solo las que van a RECIBIR en el escenario: una ficha de entidad que quedó sin cuenta
  // al repartir los papeles no opera, y darle convenio sería ruido con número de serie.
  const { data: memsAct } = await db.from("membresias")
    .select("entidad_id").eq("tipo", "entidad").eq("activo", true);
  const ambCompte = new Set((memsAct ?? []).map((m) => m.entidad_id as string));
  for (const e of (ents ?? []) as { id: string; nombre: string; tipo_receptor: string | null }[]) {
    if (SENSE_CONVENI_A_PROPOSIT.has(e.nombre)) { avis(`${e.nombre}: se deja a medias a propósito`); continue; }
    if (!ambCompte.has(e.id)) { avis(`${e.nombre}: sin cuenta de receptor, no recibe`); continue; }
    // El tipo que le toca lo decide la matriz `convenios_exigidos`: una receptora
    // comercial opera con `com`, no con `don_rec`.
    const tipus = e.tipo_receptor === "comercial" ? "com" : "don_rec";
    await conveniVigent("entidad", e.id, e.nombre, tipus);
  }
}


// ---------------------------------------------------------------------------
// 4. Las ofertas: un estado del circuito en cada una
// ---------------------------------------------------------------------------
// La lista no es un muestrario aleatorio: **cada fila representa un estado que hay que
// poder enseñar**, y entre todas cubren el ciclo salvo las dos puntas —lo ya cerrado, que
// lo aporta el histórico que no se pudo borrar, y lo que está por empezar, que es el lote
// que se monta desde la pantalla guiada—.
//
// ⚠️ **Horta de Prova SL no tiene ninguna, y es a propósito**: es el generador del ciclo
//    guiado, y su lote se crea desde el panel del equipo para poder recorrerlo entero.
interface Guio {
  ref: string;
  productor: string;
  familia: string;
  producte: string;
  kg: number;
  modalitat: "donacio" | "venda" | "maquila";
  preuMinim?: number;
  estat: string;
  causa: string;
  motiu?: string;
  /** Qué pasa con cada receptora: el estado del interés que se le deja. */
  interessos?: {
    entitat: string;
    /** `enviat` = se le mandó y no ha contestado · `acceptat` = espera aprobación
     *  · `aprovat` = ya canalizado · `rebutjat` = dijo que no · `sense_preu` = acepta
     *  pero no el precio mínimo, que es el caso que el panel deja para una persona. */
    com: "enviat" | "acceptat" | "aprovat" | "rebutjat" | "sense_preu";
    kg?: number;
  }[];
}

const GUIO: Guio[] = [
  {
    ref: "E-DEMO-PUB-1", productor: "Mas de Prova SCP",
    familia: "Horta Fulla", producte: "Enciam", kg: 120, modalitat: "donacio",
    estat: "publicada", causa: "Excedent de collita",
    // Recién publicada y sin enviar a nadie: es lo que ve el equipo en «ofertes sense enviar».
  },
  {
    ref: "E-DEMO-ESPERA-1", productor: "Mas de Prova SCP",
    familia: "Fruita Dolça", producte: "Poma", kg: 400, modalitat: "donacio",
    estat: "publicada", causa: "Calibre no comercial",
    interessos: [
      { entitat: "Menjador Social de Prova", com: "enviat" },
      { entitat: "Anna Garreta", com: "enviat" },
    ],
  },
  {
    ref: "E-DEMO-CUA-1", productor: "Sebas Sale",
    familia: "Horta Tub/Bul/Arr", producte: "Pastanaga", kg: 300, modalitat: "donacio",
    estat: "publicada", causa: "Excedent de collita",
    interessos: [
      // Este es el que sale en la cola de Aprovacions del equipo.
      { entitat: "Anna Garreta", com: "acceptat", kg: 150 },
      { entitat: "Laura Masdeu", com: "rebutjat" },
    ],
  },
  {
    ref: "E-DEMO-PARCIAL-1", productor: "Sebas Sale",
    familia: "Horta Fruit", producte: "Carbassa", kg: 500, modalitat: "donacio",
    estat: "publicada", causa: "Excedent de collita",
    interessos: [
      { entitat: "Laura Masdeu", com: "aprovat", kg: 200 },
      { entitat: "Organització Carles Sanz", com: "enviat" },
    ],
  },
  {
    ref: "E-DEMO-COBERTA-1", productor: "Raquel Diaz",
    familia: "Fruita Cítrics", producte: "Taronja", kg: 200, modalitat: "donacio",
    estat: "publicada", causa: "Excés de producció",
    interessos: [
      // Cubre los 200 kg: la oferta pasa sola a `bloqueada` al aprobar.
      { entitat: "Organització Carles Sanz", com: "aprovat", kg: 200 },
    ],
  },
  {
    ref: "E-DEMO-VENDA-1", productor: "Raquel Diaz",
    familia: "Horta Fruit", producte: "Carbassó", kg: 350, modalitat: "venda", preuMinim: 0.45,
    estat: "publicada", causa: "Excedent de collita",
    interessos: [
      { entitat: "Comercial de Prova SL", com: "acceptat", kg: 350 },
    ],
  },
  {
    ref: "E-DEMO-MAQUILA-1", productor: "Mas de Prova SCP",
    familia: "Fruita Dolça", producte: "Préssec", kg: 600, modalitat: "maquila", preuMinim: 0.30,
    estat: "publicada", causa: "Fruita massa madura per a venda",
    interessos: [
      // Acepta, pero no el precio: la fila se queda para que decida una persona (§5).
      { entitat: "Obrador de Prova", com: "sense_preu", kg: 600 },
    ],
  },
  {
    ref: "E-DEMO-SENSEDESTI-1", productor: "Sebas Sale",
    familia: "Horta Flor", producte: "Bròquil", kg: 250, modalitat: "donacio",
    estat: "no_colocada", causa: "Excedent de collita",
    motiu: "Cap entitat podia recollir-lo a temps.",
    interessos: [{ entitat: "Menjador Social de Prova", com: "rebutjat" }],
  },
  {
    ref: "E-DEMO-CANCEL-1", productor: "Mas de Prova SCP",
    familia: "Horta Tub/Bul/Arr", producte: "Ceba", kg: 150, modalitat: "donacio",
    estat: "cancelada", causa: "Excedent de collita",
    motiu: "El productor ha pogut vendre-la abans de la recollida.",
  },
];

async function idProductor(nom: string): Promise<string | null> {
  const { data } = await db.from("productores").select("id, name, empresa");
  const f = (data ?? []).find((p) => (p.empresa ?? p.name) === nom);
  return (f?.id as string) ?? null;
}
async function idEntitat(nom: string): Promise<string | null> {
  const { data } = await db.from("entidades").select("id, nombre").eq("nombre", nom).maybeSingle();
  return (data?.id as string) ?? null;
}

async function ofertes(): Promise<void> {
  paso("Ofertas del escenario");
  for (const g of GUIO) {
    const { data: ja } = await db.from("excedentes")
      .select("id").eq("id_excedente", g.ref).maybeSingle();
    if (ja) { ok(`${g.ref} ya existe`); continue; }
    if (dryRun) { ok(`${g.ref}: se crearía (${g.estat})`); continue; }

    const prod = await idProductor(g.productor);
    if (!prod) { avis(`${g.ref}: no encuentro a ${g.productor}`); continue; }

    const { data: exc, error } = await db.from("excedentes").insert({
      id_excedente: g.ref,
      productor_id: prod,
      familia: g.familia,
      producto: g.producte,
      kg_total: g.kg,
      modalitat: g.modalitat,
      preu_minim: g.preuMinim ?? null,
      causa: g.causa,
      // Se crea `publicada` SIEMPRE y el estado final se aplica después: las salidas
      // (`no_colocada`, `cancelada`) son una bifurcación del camino, no un punto de
      // partida, y crear una oferta directamente cancelada contaría una historia que no
      // ha pasado.
      estado: "publicada",
      origen: "asistido",
      motivo_no_colocada: g.motiu ?? null,
      texto_oferta: `OFERTA DISPONIBLE\n\nPRODUCTE: ${g.producte}\nQUANTITAT: ${g.kg} kg\n`
        + `MODALITAT: ${g.modalitat}\nCAUSA: ${g.causa}\n\n(dades simulades — escenari de demostració)`,
    }).select("id").single();
    if (error) { avis(`${g.ref}: ${error.message}`); continue; }

    await interessosDe(g, exc.id as string);

    if (g.estat === "no_colocada" || g.estat === "cancelada") {
      await db.from("excedentes").update({ estado: g.estat }).eq("id", exc.id);
    }
    ok(`${g.ref} · ${g.producte} ${g.kg} kg · ${g.modalitat} · ${g.estat}`);
  }
}

/** Los intereses de una oferta, cada uno por el camino real del circuito. */
async function interessosDe(g: Guio, excId: string): Promise<void> {
  for (const i of g.interessos ?? []) {
    const ent = await idEntitat(i.entitat);
    if (!ent) { avis(`  ${i.entitat}: no existe`); continue; }
    const { data: fitxa } = await db.from("entidades")
      .select("telefono, email").eq("id", ent).maybeSingle();

    if (i.com === "enviat") {
      // Enviada y sin contestar: la fila que deja `OfferDetail` al mandar la oferta.
      await db.from("oferta_respuestas").insert({
        excedente_id: excId, entidad_id: ent,
        telefono: fitxa?.telefono ?? null,
        canal: fitxa?.telefono ? "whatsapp" : "email",
        estado: "pendent", aprovacio: "pendent", enviado_at: new Date().toISOString(),
      });
      continue;
    }

    if (i.com === "rebutjat") {
      await db.from("oferta_respuestas").insert({
        excedente_id: excId, entidad_id: ent,
        telefono: fitxa?.telefono ?? null, canal: "email",
        estado: "rebutjada", aprovacio: "pendent",
        enviado_at: new Date().toISOString(), respondido_at: new Date().toISOString(),
        mensaje_respuesta: "Aquesta setmana no podem recollir.",
      });
      continue;
    }

    if (i.com === "sense_preu") {
      // ⚠️ ESTE CASO NO LO PUEDE PRODUCIR LA RPC, Y ESO ES CORRECTO.
      //    `manifestar_interes_assistit` exige el precio mínimo —es una de las tres
      //    comprobaciones que la hacen valer—, así que una fila «acepta el producto pero
      //    NO el precio» no puede salir de ahí. La produce el diálogo de WhatsApp (§5),
      //    que deja `estado='acceptada'` con `preu_ofert` nulo para que lo decida una
      //    persona. Se inserta tal cual porque es el único camino que la genera.
      await db.from("oferta_respuestas").insert({
        excedente_id: excId, entidad_id: ent,
        telefono: fitxa?.telefono ?? null, canal: "whatsapp",
        estado: "acceptada", aprovacio: "pendent",
        kg_solicitados: i.kg ?? g.kg, preu_ofert: null,
        enviado_at: new Date().toISOString(), respondido_at: new Date().toISOString(),
        mensaje_respuesta: "L'entitat no accepta el preu mínim (a revisar per l'equip).",
      });
      continue;
    }

    // Los que quedan pasan por la RPC real: conserva estado de la oferta, compatibilidad
    // de modalidad y precio mínimo, que es lo que un insert se salta.
    const { error } = await db.rpc("manifestar_interes_assistit", {
      p_excedente: excId, p_entidad: ent,
      p_kg: i.kg ?? g.kg,
      p_preu: g.preuMinim ?? null,
      p_caixes: null,
    });
    if (error) { avis(`  ${i.entitat}: ${error.code} ${error.message.slice(0, 60)}`); continue; }

    if (i.com === "aprovat") {
      const { data: resp } = await db.from("oferta_respuestas")
        .select("id").eq("excedente_id", excId).eq("entidad_id", ent).maybeSingle();
      if (!resp) continue;
      const sa = await comSuperAdmin();
      const { error: e2 } = await sa.rpc("aprovar_resposta", {
        p_resposta: resp.id, p_kg: i.kg ?? g.kg,
        p_preu: g.preuMinim ?? null, p_motiu: null,
      });
      if (e2) avis(`  ${i.entitat} aprovar: ${e2.code} ${e2.message.slice(0, 60)}`);
    }
  }
}


// ---------------------------------------------------------------------------
// 5. `tipo_empresa`: campo libre, hoy vacío en las 7 fichas de test
// ---------------------------------------------------------------------------
// ⚠️ NO es un catálogo cerrado como `tipo_receptor`: `crudCampos.ts` lo declara como texto
//    (`{ key: 'tipo_empresa', label: 'f.tipo_empresa' }`, sin `opciones`), así que aquí solo
//    se rellena con valores de ejemplo razonables para que el listado no salga en blanco.
//    Cambiarlo no exige tocar ningún catálogo.
const TIPUS_EMPRESA: Record<string, string> = {
  "Horta de Prova SL": "Explotació hortícola",
  "Mas de Prova SCP": "Explotació mixta (fruita i horta)",
  "Sebas Sale": "Explotació hortícola",
  "Raquel Diaz": "Explotació de fruita",
  "Laura Masdeu": "Cooperativa agrícola",
  "Organització Carles Sanz": "Explotació hortícola",
  "TEST-PENDENT-ARNES": "Explotació de prova (arnès)",
};

async function tipusEmpresa(): Promise<void> {
  paso("tipo_empresa (campo libre) para las fichas de test");
  const { data } = await db.from("productores")
    .select("id, name, empresa, tipo_empresa").eq("es_test", true);
  for (const p of (data ?? []) as { id: string; name: string; empresa: string | null; tipo_empresa: string | null }[]) {
    const nom = p.empresa ?? p.name;
    if (p.tipo_empresa) { ok(`${nom}: ya tiene «${p.tipo_empresa}»`); continue; }
    const valor = TIPUS_EMPRESA[nom];
    if (!valor) { avis(`${nom}: sin valor previsto`); continue; }
    if (dryRun) { ok(`${nom}: se pondría «${valor}»`); continue; }
    const { error } = await db.from("productores").update({ tipo_empresa: valor }).eq("id", p.id);
    if (error) { avis(`${nom}: ${error.message}`); continue; }
    ok(`${nom}: «${valor}»`);
  }
}

if (import.meta.main) {
  console.log(dryRun ? "ESCENARI DEMO (simulació)" : "ESCENARI DEMO");
  await netejar();
  await repartirPapers();
  await convenis();
  await ofertes();
  await tipusEmpresa();
}
