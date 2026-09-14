// Respuestas de las entidades a una oferta: los tres estados, por el camino real.
//
//   SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... SB_SECRET_KEY=... \
//     deno run -A scripts/crear-respuestas-prueba.ts [--dry-run]
//
// QUÉ CREA, Y POR QUÉ ESOS TRES CASOS. `crear-datos-documentales-prueba.ts` deja el
// circuito documental de la espigolada (REC + tres ENT + cierre), pero no toca el otro
// camino por el que nace una canalización: una entidad que responde a una oferta y el
// superadmin que decide. Sin esas filas, la tarjeta «Respostes de les entitats» del panel
// y la cola de aprobaciones se miran vacías, que es justo donde más se equivoca uno.
// Aquí quedan los tres estados que esa pantalla tiene que saber pintar:
//
//   1. ACEPTADA Y APROBADA  — la entidad social pide 120 kg de la oferta de donación, el
//      superadmin aprueba, nace la canalización y con ella (por el trigger de
//      `20261012100300`) el ENT en borrador y el REC del registro. El ENT se EMITE, así
//      que coge número de serie, congela las partes y encarga su PDF.
//   2. ACEPTADA, PENDIENTE DE APROBAR — el receptor comercial pide 150 kg de la oferta de
//      venta a 0,45 €/kg. Se queda en la cola: es el caso que enseña el botón «Aprovar i
//      canalitzar» con algo dentro.
//   3. RECHAZADA POR EL SUPERADMIN — sobre una segunda oferta de donación, con su motivo.
//      Rechazar no borra nada (§4bis): la fila se queda como auditoría.
//
// CÓMO, Y POR QUÉ NO CON LA SERVICE KEY. Las respuestas se crean con la SESIÓN de cada
// cuenta de prueba y pasan por `manifestar_interes()` y `aprovar_resposta()`, que son las
// RPC que usa la aplicación. Con `service_role` habría que replicar a mano lo que hacen
// (cantidades, bloqueo del excedente al cubrir los kilos, comprobación de convenios de las
// dos partes) y el fixture dejaría de demostrar nada: pasaría por un camino que ningún
// usuario recorre. La service key se usa SOLO para insertar la segunda oferta, porque
// `excedentes` no tiene GRANT de INSERT para `authenticated` (§4) y en la aplicación esa
// fila la crea la Edge Function `crear-oferta`.
//
// REQUISITOS. Antes hay que haber pasado `crear-usuarios-prueba.ts` (las cuentas y sus
// fichas) y `crear-datos-documentales-prueba.ts` (las dos ofertas TEST y los convenios).
// Si falta algo, el script lo dice y sale sin escribir nada.
//
// IDEMPOTENTE. La clave es `(excedente, entidad)`, que ya es UNIQUE en
// `oferta_respuestas`: si la respuesta existe, no se vuelve a crear ni se toca su estado.
// Un albarán ya emitido tampoco se reemite: tiene número, y los números no se repiten.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
const publishable = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
const secreto = Deno.env.get("SB_SECRET_KEY");
if (!url || !publishable || !secreto) {
  console.error("Faltan SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY o SB_SECRET_KEY.");
  console.error("Salen de .env.local y .secrets.env:");
  console.error("  set -a; . ./.env.local; . ./.secrets.env; set +a");
  console.error('  export SUPABASE_URL="$VITE_SUPABASE_URL"');
  Deno.exit(1);
}
const dryRun = Deno.args.includes("--dry-run");

// ---------------------------------------------------------------------------
// Cuentas y sesiones
// ---------------------------------------------------------------------------

interface Cuenta {
  etiqueta: string;
  email: string;
  password: string;
  rol: string;
}

const cuentas: Cuenta[] = JSON.parse(
  await Deno.readTextFile(new URL("./data/cuentas-prueba.json", import.meta.url)),
);

/** Sesión real de una cuenta de prueba, como la abriría el navegador. */
async function sesion(etiqueta: string): Promise<SupabaseClient> {
  const cuenta = cuentas.find((c) => c.etiqueta === etiqueta);
  if (!cuenta) {
    console.error(`No está la cuenta «${etiqueta}» en scripts/data/cuentas-prueba.json.`);
    Deno.exit(1);
  }
  const cliente = createClient(url!, publishable!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await cliente.auth.signInWithPassword({
    email: cuenta.email,
    password: cuenta.password,
  });
  if (error) {
    console.error(`No se pudo entrar como ${cuenta.email}: ${error.message}`);
    console.error("Pasa antes `deno run -A scripts/crear-usuarios-prueba.ts`.");
    Deno.exit(1);
  }
  return cliente;
}

const db = createClient(url, secreto, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function paso(titulo: string) {
  console.log(`\n── ${titulo}`);
}

// ---------------------------------------------------------------------------
// 1. Lo que tiene que existir ya
// ---------------------------------------------------------------------------

paso("Comprobando el punto de partida");

async function entidadPorCodigo(codigo: string): Promise<string> {
  const { data } = await db.from("entidades").select("id, nombre").eq("codigo", codigo).maybeSingle();
  if (!data) {
    console.error(`Falta la entidad ${codigo}. Pasa antes crear-usuarios-prueba.ts.`);
    Deno.exit(1);
  }
  console.log(`  ${codigo}: ${data.nombre}`);
  return data.id as string;
}

interface Oferta {
  id: string;
  id_excedente: string;
  productor_id: string;
  ubicacion_id: string | null;
}

// Todas las ofertas del fixture de una vez. Se filtran en JavaScript y no con `like` a
// propósito: `E-TEST-DONACIO-2` es prefijo de `E-TEST-DONACIO-2026`, así que un `like`
// confundiría la segunda oferta con la primera.
const { data: ofertasTest } = await db.from("excedentes")
  .select("id, id_excedente, productor_id, ubicacion_id")
  .like("id_excedente", "E-TEST-%");
const ofertas = (ofertasTest ?? []) as Oferta[];

const ejercicio = new Date().getFullYear();
const idDonacio2 = `E-TEST-DONACIO-2-${ejercicio}`;

const entSocial = await entidadPorCodigo("TEST-ENT-SOCIAL");
const entComercial = await entidadPorCodigo("TEST-ENT-COMERCIAL");

const donacio2Ya = ofertas.find((o) => o.id_excedente === idDonacio2) ?? null;
const donacio1 = ofertas.find((o) =>
  o.id_excedente.startsWith("E-TEST-DONACIO-") && o.id_excedente !== idDonacio2
) ?? null;
const venda = ofertas.find((o) => o.id_excedente.startsWith("E-TEST-VENDA-")) ?? null;

if (!donacio1 || !venda) {
  console.error("Faltan las ofertas TEST de donación y venta.");
  console.error("Pasa antes `deno run -A scripts/crear-datos-documentales-prueba.ts`.");
  Deno.exit(1);
}
console.log(`  ${donacio1.id_excedente} y ${venda.id_excedente}: las dos ofertas del fixture`);

// ---------------------------------------------------------------------------
// 2. La segunda oferta de donación, para poder rechazar una respuesta
// ---------------------------------------------------------------------------
// Rechazar la respuesta de la oferta 1 dejaría el caso aprobado sin fila que enseñar, y
// `(excedente, entidad)` es UNIQUE, así que la misma entidad no puede responder dos veces
// al mismo lote. Con una segunda oferta caben los tres estados a la vez.

paso("Segunda oferta de donación (para el caso rechazado)");

let donacio2: Oferta | null = donacio2Ya;

if (donacio2) {
  console.log(`  ${idDonacio2}: ya existía`);
} else if (dryRun) {
  console.log(`  [dry-run] crearía ${idDonacio2}: 180 kg de pera en donació`);
} else {
  const { data, error } = await db.from("excedentes").insert({
    id_excedente: idDonacio2,
    productor_id: donacio1.productor_id,
    ubicacion_id: donacio1.ubicacion_id,
    familia: "Fruita Dolça",
    producto: "Pera",
    variedad: "Conference",
    kg_total: 180,
    num_caixes: 8,
    modalitat: "donacio",
    causa: "Criteris Estètics",
    estado: "publicada",
    origen: "asistido",
    texto_oferta: "OFERTA DISPONIBLE (fixture de proves)",
  }).select("id, id_excedente, productor_id, ubicacion_id").single();
  if (error) throw new Error(`segunda oferta de donació: ${error.message}`);
  donacio2 = data as Oferta;
  console.log(`  ${idDonacio2}: 180 kg de pera en donació`);
}

// ---------------------------------------------------------------------------
// 3. Las tres respuestas
// ---------------------------------------------------------------------------

interface Caso {
  etiqueta: string;
  cuenta: string;
  excedente: { id: string; id_excedente: string } | null;
  entidad: string;
  kg: number;
  preu: number | null;
  caixes: number | null;
  /** Qué hace después el superadmin. */
  decision: "aprovar" | "rebutjar" | "deixar-pendent";
  motiu?: string;
}

const casos: Caso[] = [
  {
    etiqueta: "aprobada",
    cuenta: "receptor-social",
    excedente: donacio1,
    entidad: entSocial,
    kg: 120,
    preu: null,
    caixes: 5,
    decision: "aprovar",
  },
  {
    etiqueta: "pendiente de aprobar",
    cuenta: "receptor-comercial",
    excedente: venda,
    entidad: entComercial,
    kg: 150,
    preu: 0.45,
    caixes: 6,
    decision: "deixar-pendent",
  },
  {
    etiqueta: "rechazada",
    cuenta: "receptor-social",
    excedente: donacio2,
    entidad: entSocial,
    kg: 80,
    preu: null,
    caixes: 4,
    decision: "rebutjar",
    motiu: "Aquesta setmana no tenim cambra per a la fruita (fixture de proves)",
  },
];

paso("Respuestas de las entidades");

/** Respuestas creadas o encontradas, para la fase de decisión. */
const respuestas = new Map<string, string>();

for (const caso of casos) {
  if (!caso.excedente) {
    console.log(`  ${caso.etiqueta}: sin oferta (dry-run sobre una que aún no existe)`);
    continue;
  }
  const { data: ya } = await db.from("oferta_respuestas")
    .select("id, estado, aprovacio")
    .eq("excedente_id", caso.excedente.id)
    .eq("entidad_id", caso.entidad)
    .maybeSingle();

  if (ya) {
    console.log(`  ${caso.etiqueta}: ya existía (${ya.estado}/${ya.aprovacio})`);
    respuestas.set(caso.etiqueta, ya.id as string);
    continue;
  }
  if (dryRun) {
    console.log(`  [dry-run] ${caso.etiqueta}: ${caso.cuenta} pediría ${caso.kg} kg de ${caso.excedente.id_excedente}`);
    continue;
  }

  const cliente = await sesion(caso.cuenta);
  const { data, error } = await cliente.rpc("manifestar_interes", {
    p_excedente: caso.excedente.id,
    p_entidad: caso.entidad,
    p_kg: caso.kg,
    p_preu: caso.preu,
    p_caixes: caso.caixes,
  });
  if (error) throw new Error(`${caso.etiqueta}: ${error.message}`);
  const fila = Array.isArray(data) ? data[0] : data;
  respuestas.set(caso.etiqueta, fila.id);
  console.log(`  ${caso.etiqueta}: ${caso.kg} kg de ${caso.excedente.id_excedente}`);
}

// ---------------------------------------------------------------------------
// 4. La decisión del superadmin
// ---------------------------------------------------------------------------
// `aprovar_resposta()` exige `pot_aprovar()`, así que aquí hace falta la sesión del
// superadmin: con la service key la comprobación fallaría (auth.uid() es null) y el
// camino no sería el de la aplicación.

paso("Decisión del superadmin");

let canalizacion: string | null = null;

if (!dryRun) {
  const admin = await sesion("superadmin");

  for (const caso of casos) {
    const id = respuestas.get(caso.etiqueta);
    if (!id) continue;

    const { data: r } = await admin.from("oferta_respuestas")
      .select("id, estado, aprovacio, canalizacion_id").eq("id", id).maybeSingle();
    if (!r) continue;

    if (caso.decision === "deixar-pendent") {
      console.log(`  ${caso.etiqueta}: se queda en la cola, sin tocar`);
      continue;
    }
    if (r.aprovacio !== "pendent") {
      console.log(`  ${caso.etiqueta}: ya estaba decidida (${r.aprovacio})`);
      if (caso.decision === "aprovar") canalizacion = r.canalizacion_id as string | null;
      continue;
    }

    if (caso.decision === "aprovar") {
      const { data, error } = await admin.rpc("aprovar_resposta", {
        p_resposta: id,
        p_kg: caso.kg,
        p_preu: caso.preu,
        p_motiu: null,
      });
      if (error) throw new Error(`aprobar ${caso.etiqueta}: ${error.message}`);
      const c = Array.isArray(data) ? data[0] : data;
      canalizacion = c.id;
      console.log(`  ${caso.etiqueta}: aprobada, canalización ${c.id}`);
    } else {
      const { error } = await admin.from("oferta_respuestas").update({
        aprovacio: "rebutjada",
        motiu_aprovacio: caso.motiu ?? null,
        aprovat_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw new Error(`rechazar ${caso.etiqueta}: ${error.message}`);
      console.log(`  ${caso.etiqueta}: rechazada con su motivo`);
    }
  }
} else {
  console.log("  [dry-run] el superadmin aprobaría una, rechazaría otra y dejaría la tercera pendiente");
}

// ---------------------------------------------------------------------------
// 5. El albarán de la canalización aprobada
// ---------------------------------------------------------------------------
// El trigger `canalizaciones_crea_albaranes` ya dejó el ENT (y el REC del registro) en
// BORRADOR al insertar la canalización. Emitirlo es lo que le da número, congela las
// partes y encarga el PDF (`albaran_emet_document` → trigger de encolado).

paso("Emisión del albarán de entrega");

if (dryRun) {
  console.log("  [dry-run] emitiría el ENT de la canalización aprobada");
} else if (!canalizacion) {
  console.log("  sin canalización aprobada: nada que emitir");
} else {
  const admin = await sesion("superadmin");
  const { data: albarans } = await admin.from("albaranes")
    .select("id, tipo, estado, numero_completo")
    .eq("canalizacion_id", canalizacion);

  for (const a of albarans ?? []) {
    if (a.estado !== "borrador") {
      console.log(`  ${a.tipo} ${a.numero_completo ?? ""}: ya estaba ${a.estado}`);
      continue;
    }
    const { data, error } = await admin.rpc("emitir_albaran", {
      p_id: a.id,
      p_recogida: { fecha_hora: new Date().toISOString() },
      p_lineas: null,
      p_idioma: "ca",
    });
    if (error) throw new Error(`emitir ${a.tipo}: ${error.message}`);
    const emitido = Array.isArray(data) ? data[0] : data;
    console.log(`  ${a.tipo} emitido: ${emitido.numero_completo}`);
  }
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

paso("Resumen");
console.log("  Tres respuestas de entidad: una aprobada y canalizada, una pendiente de");
console.log("  aprobar en la cola y una rechazada con su motivo.");
console.log("  El albarán de entrega de la aprobada queda emitido, con número y con su");
console.log("  documento encargado. El PDF lo genera la Edge Function `generar-documento`,");
console.log("  así que si el secreto `documentos_secret` no está puesto, el documento se");
console.log("  queda en «pendent» y no es un fallo del fixture.");
if (dryRun) console.log("\n  (dry-run: no se ha escrito nada)");
