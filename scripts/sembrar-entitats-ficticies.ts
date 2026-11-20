// Las organizaciones FICTICIAS del piloto (fase 6 de los puntos 4-6), después del vaciado.
//
//   eval "$(bash scripts/local/entorno-local.sh)"                 # el CLON (nunca source .env.local)
//   deno run -A scripts/sembrar-entitats-ficticies.ts --dry-run    # qué crearía, sin escribir
//   deno run -A scripts/sembrar-entitats-ficticies.ts              # crearlas (idempotente)
//
//   # En PRODUCCIÓN (sesión del token, tras `reiniciar-dades.ts --executar --produccio`):
//   deno run -A scripts/sembrar-entitats-ficticies.ts --dry-run
//   deno run -A scripts/sembrar-entitats-ficticies.ts --produccio
//
// QUÉ CREA. Un juego pequeño de organizaciones cuyo NOMBRE DICE EL TIPO, con datos completos,
// verosímiles y FICTICIOS: razón social, NIF de prueba válido (pasa `nif_valid`; los `B0000…`
// sostienen el check `cerca_entitats` del arnés), domicilio y datos fiscales, contacto y
// facturación (`@example.com`), municipio INE real, operativa de producción y comercialización y
// uno o dos lugares de recogida con días y franja; la naturalesa confirmada; y el **Conveni de
// col·laboració DECLARAT vigent** de cada papel, para poder publicar y mostrar interés con la fecha
// de corte encendida. `es_test = true` en todas. Diagnóstico y perfil de recepción, VACÍOS.
//
//   codigo              nombre                              papel           cuenta (etiqueta del arnés)
//   TEST-PROD-1         Ofertant de prova                   productor       productor-titular
//   TEST-PROD-2         Segon ofertant de prova             productor       productor-altre
//   TEST-ENT-SOCIAL     Entitat social receptora de prova   receptora social (entitat_social)   receptor-social
//   TEST-ENT-COMERCIAL  Empresa receptora de prova          receptora comercial (empresa: P8)  receptor-comercial
//   TEST-ENT-OBRADOR    Obrador de prova (maquila)          receptora transformador             receptor-carles
//   TEST-DOBLE-*        Doble rol de prova                  productor + receptora social       hola+productor-receptor@ (doble rol de Carles)
//
// Los `codigo` son los de siempre a propósito: los fixtures del clon (`crear-datos-documentales-
// prueba.ts`, `crear-respuestas-prueba.ts`) y el arnés buscan las fichas por ellos.
//
// POR LOS CAMINOS QUE EXISTEN, NO POR INSERT A MANO:
//   · la ficha y su organización, `crear_entitat()` con la sesión del super_admin (como «Nova entitat»);
//   · los datos que `crear_entitat` no recoge (fiscales, operativa, `codigo`), el UPDATE de la ficha
//     con esa misma sesión, como `EntitatDetall` (la RLS del equipo lo permite; `productores_operativa`
//     poda y valida);
//   · los lugares, `productor_ubicaciones` con esa sesión, como `LlocsRecollida`;
//   · la naturalesa, `fixar_naturalesa()`; el convenio, `declarar_conveni()` (consume un número de la
//     serie CONV-COL-*, como en la pantalla);
//   · el acceso, `concedir_acces_org()` (solo `service_role`: es lo que hace `donar-acces`, sin el correo);
//
// NO CREA CUENTAS. Las siete del arnés (`scripts/data/cuentas-prueba.json`) y la del doble rol ya
// existen; si falta alguna, avisa y sigue. `hola@carlessanz.com` (super_admin) NO puede tener
// organización: `trg_membresia_no_equip` lo impide (`compte_equip`); por eso el doble rol va a su
// cuenta de pruebas `hola+productor-receptor@`.
//
// IDEMPOTENTE: cada paso mira antes si ya está (ficha por `codigo`, lugar por alias, convenio
// vigente por tipo, membresía activa). Una segunda pasada no duplica nada ni consume números.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const args = Deno.args;
const DRY_RUN = args.includes("--dry-run");
const PRODUCCIO = args.includes("--produccio");

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
const publishable = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
if (!url || !key || !publishable) {
  console.error("Faltan SUPABASE_URL, SB_SECRET_KEY o la publishable key (clon: eval \"$(bash scripts/local/entorno-local.sh)\").");
  Deno.exit(1);
}
const host = new URL(url).hostname;
const esLocal = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
if (!esLocal && !DRY_RUN && !PRODUCCIO) {
  console.error(`SUPABASE_URL apunta a ${host}, que no es el clon. Sin --dry-run hace falta --produccio (y la aprobación de Carles).`);
  Deno.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// ---------------------------------------------------------------------------
// El juego, declarativo
// ---------------------------------------------------------------------------

type Paper = "productor" | "entidad";

interface Lloc {
  alias: string;
  municipi: string;      // código INE
  direccion: string;
  dies: number[];        // 1 = dilluns … 7 = diumenge
  franges: { inici: string; fi: string }[];
  observaciones?: string;
}

interface OrgFicticia {
  nom: string;
  rols: Paper[];
  codis: Partial<Record<Paper, string>>;
  rao: string;
  nif: string;
  tipusEmpresa: string;
  persona: string;
  carrec: string;
  municipi: string;
  direccio: string;
  cp: string;
  tipusActivitat: string[];
  tipoReceptor?: "social" | "animal" | "transformador" | "comercial";
  naturalesa: "entitat_social" | "empresa";
  /** Correo de la cuenta que la gestiona (`concedir_acces_org` lo escribe también en la ficha). */
  compte: string;
  regimIva: "general" | "reagp" | "simplificat" | "exempt" | "altres";
  facturacio: { nom: string; email: string };
  /** Solo productores: la Operativa (A4). Los nombres de producto, del catálogo. */
  operativa?: Record<string, unknown>;
  llocs?: Lloc[];
}

const correu = (s: string) => `hola+${s}@carlessanz.com`;

const ORGS: OrgFicticia[] = [
  {
    nom: "Ofertant de prova",
    rols: ["productor"],
    codis: { productor: "TEST-PROD-1" },
    rao: "Ofertant de Prova SL",
    nif: "B00000109",
    tipusEmpresa: "sl",
    persona: "Marta Prova Ofertant",
    carrec: "Gerent",
    municipi: "08089", // Gavà
    direccio: "Camí de la Riera, 12",
    cp: "08850",
    tipusActivitat: ["productor_agricola"],
    naturalesa: "empresa",
    compte: correu("prodowner-masprova"),
    regimIva: "reagp",
    facturacio: { nom: "Administració d'Ofertant de Prova", email: "facturacio.ofertant@example.com" },
    operativa: {
      productos_habituales: ["Tomàquet", "Carbassa", "Carbassó", "Avellana"],
      productes_principals: ["Tomàquet", "Carbassa"],
      varietats: { "Tomàquet": ["Pera", "Cor de bou"], "Carbassa": ["Violina"] },
      volum_produccio: { "Tomàquet": 40000, "Carbassa": 15000 },
      temporada: { "Tomàquet": [6, 7, 8, 9], "Carbassa": [9, 10, 11] },
      envasos_habituals: ["caixes", "palets"],
      canals_comercials: ["mercats_majoristes", "venda_directa"],
      tipologia_clients: ["majoristes_distribuidors", "consumidors_finals"],
      facturacio_rang: "100k-500k",
      volum_comercialitzat_kg: 50000,
      suport_interes: ["donacions", "compradors"],
    },
    llocs: [
      // El alias lo busca `crear-datos-documentales-prueba.ts` (la finca de la espigolada).
      { alias: "Finca de Prova", municipi: "08089", direccion: "Camí de Can Prova, s/n", dies: [1, 3, 5],
        franges: [{ inici: "08:00", fi: "13:00" }], observaciones: "Accés per la pista de terra; avisar en arribar." },
      { alias: "Magatzem de Viladecans", municipi: "08301", direccion: "Carrer de la Indústria de Prova, 4", dies: [2, 4],
        franges: [{ inici: "16:00", fi: "19:00" }] },
    ],
  },
  {
    nom: "Segon ofertant de prova",
    rols: ["productor"],
    codis: { productor: "TEST-PROD-2" },
    rao: "Segon Ofertant de Prova SL",
    nif: "B00000208",
    tipusEmpresa: "sl",
    persona: "Jordi Prova Segon",
    carrec: "Administrador",
    municipi: "25137", // Mollerussa
    direccio: "Carretera de Prova, km 3",
    cp: "25230",
    tipusActivitat: ["productor_agricola", "comercialitzador"],
    naturalesa: "empresa",
    compte: correu("prodowner-hortaprova"),
    regimIva: "general",
    facturacio: { nom: "Comptabilitat de Segon Ofertant", email: "facturacio.segon-ofertant@example.com" },
    operativa: {
      productos_habituales: ["Poma", "Pera", "Préssec"],
      productes_principals: ["Poma", "Pera"],
      varietats: { "Poma": ["Golden"], "Pera": ["Conference"] },
      volum_produccio: { "Poma": 120000, "Pera": 60000 },
      temporada: { "Poma": [8, 9, 10], "Pera": [7, 8, 9] },
      envasos_habituals: ["caixes", "granel"],
      canals_comercials: ["cooperatives_productors", "distribucio_gran_superficie"],
      tipologia_clients: ["supermercats_cadenes", "industria_transformadora"],
      facturacio_rang: "500k-2M",
      volum_comercialitzat_kg: 170000,
      suport_interes: ["transformacio", "compradors"],
    },
    llocs: [
      { alias: "Finca del Pla", municipi: "25137", direccion: "Partida de Prova, parcel·la 7", dies: [1, 2, 3, 4, 5],
        franges: [{ inici: "07:30", fi: "12:30" }] },
    ],
  },
  {
    nom: "Entitat social receptora de prova",
    rols: ["entidad"],
    codis: { entidad: "TEST-ENT-SOCIAL" },
    rao: "Associació Entitat Social Receptora de Prova",
    nif: "G00000307",
    tipusEmpresa: "associacio",
    persona: "Laia Prova Social",
    carrec: "Presidenta",
    municipi: "08019", // Barcelona
    direccio: "Carrer del Menjador de Prova, 21",
    cp: "08001",
    tipusActivitat: ["menjador_social", "distribucio_social"],
    tipoReceptor: "social",
    naturalesa: "entitat_social",
    compte: correu("recowner-social"),
    regimIva: "exempt",
    facturacio: { nom: "Tresoreria de l'Entitat Social", email: "facturacio.entitat-social@example.com" },
  },
  {
    nom: "Empresa receptora de prova",
    rols: ["entidad"],
    codis: { entidad: "TEST-ENT-COMERCIAL" },
    rao: "Empresa Receptora de Prova SL",
    nif: "B00000406",
    tipusEmpresa: "sl",
    persona: "Pau Prova Empresa",
    carrec: "Responsable de compres",
    municipi: "08019", // Barcelona (Mercabarna)
    direccio: "Mercabarna, pavelló de Prova, parada 3",
    cp: "08040",
    tipusActivitat: ["majorista", "distribuidor"],
    tipoReceptor: "comercial",
    naturalesa: "empresa", // P8: confirmada empresa → solo compra y maquila, nunca donación
    compte: correu("recowner-comercial"),
    regimIva: "general",
    facturacio: { nom: "Administració d'Empresa Receptora", email: "facturacio.empresa-receptora@example.com" },
  },
  {
    nom: "Obrador de prova (maquila)",
    rols: ["entidad"],
    codis: { entidad: "TEST-ENT-OBRADOR" },
    rao: "Obrador de Prova SCCL",
    nif: "F00000505",
    tipusEmpresa: "cooperativa",
    persona: "Núria Prova Obrador",
    carrec: "Coordinadora de producció",
    municipi: "08187", // Sabadell
    direccio: "Carrer de l'Obrador de Prova, 9",
    cp: "08201",
    tipusActivitat: ["transformador_obrador"],
    tipoReceptor: "transformador",
    // Cooperativa d'iniciativa social: recibe donación (la usa `receptor-carles` en las E2E), compra
    // y maquila. Confirmada para que la ficha quede completa.
    naturalesa: "entitat_social",
    compte: correu("wa-carles"),
    regimIva: "general",
    facturacio: { nom: "Administració de l'Obrador", email: "facturacio.obrador@example.com" },
  },
  {
    nom: "Doble rol de prova",
    rols: ["productor", "entidad"],
    codis: { productor: "TEST-DOBLE-PROD", entidad: "TEST-DOBLE-ENT" },
    rao: "Associació Doble Rol de Prova",
    nif: "G00000604",
    tipusEmpresa: "associacio",
    persona: "Martí Prova Doble",
    carrec: "Director",
    municipi: "08298", // Vic
    direccio: "Mas de Prova del Doble Rol, s/n",
    cp: "08500",
    tipusActivitat: ["productor_agricola", "distribucio_social"],
    tipoReceptor: "social",
    naturalesa: "entitat_social",
    compte: correu("productor-receptor"),
    regimIva: "exempt",
    facturacio: { nom: "Tresoreria del Doble Rol", email: "facturacio.doble-rol@example.com" },
    operativa: {
      productos_habituales: ["Patata", "Ceba", "Enciam"],
      productes_principals: ["Patata", "Ceba"],
      varietats: { "Patata": ["Monalisa"] },
      volum_produccio: { "Patata": 20000, "Ceba": 8000 },
      temporada: { "Patata": [6, 7, 8], "Ceba": [7, 8, 9] },
      envasos_habituals: ["sacs", "caixes"],
      canals_comercials: ["venda_directa", "comerc_minorista"],
      tipologia_clients: ["comercos_botigues", "consumidors_finals"],
      facturacio_rang: "<100k",
      volum_comercialitzat_kg: 25000,
      suport_interes: ["donacions", "logistica"],
    },
    llocs: [
      { alias: "Horts del Mas", municipi: "08298", direccion: "Camí del Mas de Prova, s/n", dies: [2, 4],
        franges: [{ inici: "09:00", fi: "12:00" }, { inici: "16:00", fi: "18:00" }] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function pas(t: string) { console.log(`\n── ${t}`); }
function ok(t: string) { console.log(`   ✓ ${t}`); }
function avis(t: string) { console.log(`   ⚠ ${t}`); }
function fa(t: string) { console.log(`   [dry-run] ${t}`); }

const usuaris = new Map<string, string>();
async function carregaUsuaris() {
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email) usuaris.set(u.email.toLowerCase(), u.id);
    if (data.users.length < 200) break;
  }
}

/** Sesión real del super_admin del arnés: `crear_entitat` y `declarar_conveni` exigen `auth.uid()`. */
async function sessioSuperAdmin(): Promise<SupabaseClient> {
  const cuentas = JSON.parse(await Deno.readTextFile(new URL("./data/cuentas-prueba.json", import.meta.url))) as
    { etiqueta: string; email: string; password: string }[];
  const sa = cuentas.find((c) => c.etiqueta === "superadmin");
  if (!sa) throw new Error("Falta la cuenta «superadmin» en scripts/data/cuentas-prueba.json");
  const c = createClient(url!, publishable!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: sa.email, password: sa.password });
  if (error) throw new Error(`login superadmin: ${error.message}`);
  return c;
}

async function rpc<T>(c: SupabaseClient, nom: string, a: Record<string, unknown>): Promise<T> {
  const { data, error } = await c.rpc(nom, a);
  if (error) throw new Error(`${nom}: ${error.message} (${error.code ?? "?"})`);
  return data as T;
}

const taula = (p: Paper) => (p === "productor" ? "productores" : "entidades");

async function fitxaPerCodi(p: Paper, codi: string): Promise<{ id: string; organizacion_id: string } | null> {
  const { data, error } = await admin.from(taula(p)).select("id, organizacion_id").eq("codigo", codi).maybeSingle();
  if (error) throw new Error(`${taula(p)}/${codi}: ${error.message}`);
  return data as { id: string; organizacion_id: string } | null;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

console.log(`sembrar-entitats-ficticies.ts ${DRY_RUN ? "(dry-run, no escribe)" : "(escribe)"} contra ${host}${esLocal ? " (clon local)" : " (PRODUCCIÓN)"}`);

await carregaUsuaris();
const sa = DRY_RUN ? null : await sessioSuperAdmin();
const saId = (await (async () => {
  const cuentas = JSON.parse(await Deno.readTextFile(new URL("./data/cuentas-prueba.json", import.meta.url))) as { etiqueta: string; email: string }[];
  const e = cuentas.find((c) => c.etiqueta === "superadmin")?.email;
  return e ? usuaris.get(e.toLowerCase()) ?? null : null;
})());

const resum: string[] = [];

for (const o of ORGS) {
  pas(`${o.nom} (${o.rols.join(" + ")})`);

  // 1. La ficha y su organización.
  const ids: Partial<Record<Paper, string>> = {};
  let orgId: string | null = null;
  for (const p of o.rols) {
    const f = await fitxaPerCodi(p, o.codis[p]!);
    if (f) { ids[p] = f.id; orgId = f.organizacion_id; }
  }
  if (Object.keys(ids).length === o.rols.length) {
    ok(`ja existeix (organització ${orgId})`);
  } else if (Object.keys(ids).length > 0) {
    avis(`només hi ha una part de les fitxes (${Object.keys(ids).join(", ")}): revisa-ho a mà, no es toca`);
    continue;
  } else if (DRY_RUN) {
    fa(`crear_entitat: ${o.nom} · ${o.rao} · ${o.nif} · ${o.rols.join("+")}${o.tipoReceptor ? ` · ${o.tipoReceptor}` : ""}`);
  } else {
    const r = await rpc<{ organizacion_id: string; productor_id: string | null; entidad_id: string | null }>(sa!, "crear_entitat", {
      p_dades: {
        rols: o.rols,
        nom_comercial: o.nom,
        razon_social: o.rao,
        nif: o.nif,
        tipus_empresa: o.tipusEmpresa,
        persona_contacte: o.persona,
        email: o.compte,
        direccion: o.direccio,
        codigo_postal: o.cp,
        municipio_ine: o.municipi,
        tipo_receptor: o.tipoReceptor ?? null,
        tipus_activitat: o.tipusActivitat,
        es_test: true,
      },
    });
    orgId = r.organizacion_id;
    if (r.productor_id) ids.productor = r.productor_id;
    if (r.entidad_id) ids.entidad = r.entidad_id;
    ok(`creada (organització ${orgId})`);
  }

  // 2. Lo que `crear_entitat` no recoge: el código, los datos fiscales y la Operativa. Con la sesión
  //    del equipo, como la ficha del panel (`EntitatDetall`).
  for (const p of o.rols) {
    const comuns = {
      codigo: o.codis[p],
      regim_iva: o.regimIva,
      domicili_fiscal: o.direccio,
      codi_postal_fiscal: o.cp,
      poblacio_fiscal: null as string | null,
      contacte_facturacio_nom: o.facturacio.nom,
      contacte_facturacio_email: o.facturacio.email,
    };
    if (DRY_RUN || !ids[p]) { fa(`${taula(p)}: codi ${o.codis[p]}, dades fiscals${p === "productor" && o.operativa ? " i operativa" : ""}`); continue; }
    const { data: muni } = await admin.from("municipios").select("nom").eq("codi_ine", o.municipi).maybeSingle();
    comuns.poblacio_fiscal = (muni?.nom as string | undefined) ?? null;
    const canvis: Record<string, unknown> = p === "productor" ? { ...comuns, ...(o.operativa ?? {}) } : { ...comuns, contacto: o.persona };
    const { data, error } = await sa!.from(taula(p)).update(canvis).eq("id", ids[p]!).select("id");
    if (error || !data?.length) throw new Error(`${taula(p)} ${o.codis[p]}: ${error?.message ?? "0 files (RLS?)"}`);
    ok(`${taula(p)}: codi, dades fiscals${p === "productor" && o.operativa ? " i operativa" : ""}`);
  }

  // 3. La naturalesa, confirmada.
  if (DRY_RUN || !orgId) {
    fa(`fixar_naturalesa: ${o.naturalesa}`);
  } else {
    const { data: org } = await admin.from("organizaciones").select("naturalesa, naturalesa_origen").eq("id", orgId).maybeSingle();
    if (org?.naturalesa === o.naturalesa && org?.naturalesa_origen === "confirmada") ok(`naturalesa ${o.naturalesa} ja confirmada`);
    else { await rpc(sa!, "fixar_naturalesa", { p_org: orgId, p_naturalesa: o.naturalesa }); ok(`naturalesa ${o.naturalesa} confirmada`); }
  }

  // 4. Los lugares de recogida (productor), como `LlocsRecollida`. El primero queda principal.
  for (const l of o.llocs ?? []) {
    if (DRY_RUN || !ids.productor) { fa(`lloc «${l.alias}» (${l.municipi}), dies ${l.dies.join(",")}, ${l.franges.map((f) => `${f.inici}-${f.fi}`).join(" i ")}`); continue; }
    const { data: ja } = await admin.from("productor_ubicaciones").select("id").eq("productor_id", ids.productor).eq("alias", l.alias).maybeSingle();
    if (ja) { ok(`lloc «${l.alias}» ja existeix`); continue; }
    const { data: muni } = await admin.from("municipios").select("nom").eq("codi_ine", l.municipi).maybeSingle();
    const { error } = await sa!.from("productor_ubicaciones").insert({
      productor_id: ids.productor,
      alias: l.alias,
      municipio: muni?.nom ?? null,
      municipio_ine: l.municipi,
      direccion: l.direccion,
      dies_setmana: l.dies,
      franges: l.franges,
      observaciones: l.observaciones ?? null,
      contacto_nombre: o.persona,
    });
    if (error) throw new Error(`lloc ${l.alias}: ${error.message}`);
    ok(`lloc «${l.alias}» (${muni?.nom ?? l.municipi})`);
  }

  // 5. El Conveni de col·laboració DECLARAT vigent de cada papel (consume un número CONV-COL-*).
  for (const p of o.rols) {
    const tipus = p === "productor" ? "col_productor" : "col_receptor";
    if (DRY_RUN || !ids[p]) { fa(`declarar_conveni ${tipus} (signant ${o.persona}, ${o.carrec})`); continue; }
    const { data: vig } = await admin.from("convenios").select("numero_completo")
      .eq(p === "productor" ? "productor_id" : "entidad_id", ids[p]!).eq("tipo", tipus).eq("estado", "vigent").maybeSingle();
    if (vig) { ok(`conveni ${tipus} ja vigent (${vig.numero_completo})`); continue; }
    const c = await rpc<{ numero_completo: string }>(sa!, "declarar_conveni", {
      p_tipo_org: p, p_org: ids[p], p_tipo: tipus,
      p_signant_nom: o.persona, p_signant_carrec: o.carrec,
      p_data_firma: null, p_referencia: "Organització ficticia del pilot",
      p_notes: "Declarat per scripts/sembrar-entitats-ficticies.ts (fase 6): organització de prova",
    });
    ok(`conveni ${tipus} declarat vigent: ${c.numero_completo}`);
  }

  // 6. El acceso de su cuenta: `concedir_acces_org` (lo que hace `donar-acces`, sin el correo).
  const userId = usuaris.get(o.compte.toLowerCase());
  if (!userId) {
    avis(`no existeix el compte ${o.compte}: l'organització queda sense accés`);
  } else if (DRY_RUN || !orgId) {
    fa(`concedir_acces_org → ${o.compte}`);
  } else {
    const r = await rpc<{ canvis: boolean }>(admin, "concedir_acces_org", {
      p_org: orgId, p_user: userId, p_email: o.compte, p_per: saId,
    });
    ok(`accés de ${o.compte}${r.canvis ? "" : " (ja el tenia)"}`);
  }

  // 7. El correo de la ficha, en la whitelist de correo de prueba (§8), como `crear-usuarios-prueba.ts`.
  if (!DRY_RUN) {
    const { error } = await admin.from("email_test_recipients")
      .upsert([{ email: o.compte, etiqueta: o.codis.productor ?? o.codis.entidad! }], { onConflict: "email", ignoreDuplicates: true });
    if (error) avis(`email_test_recipients: ${error.message}`);
  }

  resum.push(`${o.nom} · ${o.rols.join("+")} · ${o.nif} · ${o.compte}`);
}

pas("Resum");
for (const r of resum) console.log(`   ${r}`);
console.log(DRY_RUN ? "\n(dry-run: no s'ha escrit res)\n" : "\nFet.\n");
if (sa) await sa.auth.signOut({ scope: "local" });
