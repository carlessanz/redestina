// Datos de prueba del sistema documental: la espigolada del plan, de punta a punta.
//
//   SUPABASE_URL=... SB_SECRET_KEY=... deno run -A scripts/crear-datos-documentales-prueba.ts [--dry-run]
//
// QUÉ CREA, Y POR QUÉ ESE CASO Y NO OTRO. Es exactamente el caso de aceptación de la fase
// 3 (§4 del plan funcional): una espigolada de **1.000 kg de tomate en 29 cajas** en la
// finca de `TEST-PROD-1`, repartida en **lotes de 400, 400 y 200 kg con nota**, con su
// albarán de recepción y un albarán de entrega por lote, uno de ellos confirmado con
// **10 kg rechazados** y su motivo. Recorrer ese caso es lo que demuestra que la cadena
// entera funciona: número de serie → partes congeladas → documento → enlace de
// confirmación → evidencia → propuesta de conciliación.
//
// Y ADEMÁS ES EL FIXTURE DEL ARNÉS. `scripts/comprobar-rls.ts` no puede afirmar «el
// productor ve SUS albaranes» sobre una tabla vacía: con RLS activa, 0 filas es
// indistinguible de «la política me bloquea» (§12.48), así que esas comprobaciones salen
// SALTADAS mientras no haya datos. Lo que crea este script es justo lo que las devuelve a
// verde:
//   · un REC emitido del productor TEST-PROD-1        -> productor ve sus albaranes
//   · tres ENT de entidades TEST-*                    -> receptor ve sus ENT
//   · documentos, enlaces_token y evidencias reales   -> los tres «requiereFixture» del equipo
//   · una oferta de `venda` publicada de TEST-PROD-2  -> el receptor comercial deja de ver
//     un mercado vacío, que era la última saltada estructural del arnés (deuda §12.32)
//   · un **cierre de prueba de 2026 ya calculado**     -> los dos productores ven su
//     acumulado anual y sus líneas (fase 4), con TEST-PROD-1 certificable y TEST-PROD-2
//     bloqueado por datos fiscales: los dos casos de la pantalla de cierre
//
// TODO LO QUE TOCA LLEVA PREFIJO `TEST-`. No crea ni modifica ninguna organización real, y
// el tipo de caja que activa es uno inventado (`TEST-CAIXA`): las taras de verdad las
// tiene que dar la Fundación (fase 0) y sembrar una inventada en `tipos_caja` falsearía el
// neto de entregas reales.
//
// IDEMPOTENTE. La clave es `espigoladas.ref_externa = 'TEST-ESPIGOLADA-1'`: si ya existe,
// no vuelve a crear nada y sale diciendo qué hay. Para volver a empezar hay que borrar a
// mano (los albaranes emitidos no se borran a propósito: son documentos con número).

import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY en el entorno.");
  Deno.exit(1);
}
const dryRun = Deno.args.includes("--dry-run");

const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// El caso, declarativo
// ---------------------------------------------------------------------------

const REF = "TEST-ESPIGOLADA-1";
const PRODUCTO = "Tomàquet";
const KG_TOTAL = 1000;
const CAJAS = 29;
const TIPO_CAJA = "TEST-CAIXA";      // inventado a propósito (ver cabecera)
const TARA_CAJA = 1.5;               // kg por caja -> 43,5 kg de tara en el REC
const COSTE_KG = 0.85;               // €/kg de referencia del fixture

const LOTES = [
  { entidad: "TEST-ENT-SOCIAL", kg: 400, nota: "Lot per al menjador social — repartiment de dijous" },
  { entidad: "TEST-ENT-OBRADOR", kg: 400, nota: "Lot per a l'obrador — conserva de tomàquet" },
  { entidad: "TEST-ENT-SOCIAL", kg: 200, nota: "Lot petit de reforç — divendres" },
];

// El lote que se confirma con rechazo parcial: 10 kg en mal estado.
const KG_RECHAZADOS = 10;

// El segundo donante del cierre: existe para que el ensayo tenga un caso BLOQUEADO y una
// línea `retroactiva`. Ver `prepararCierre()`.
const PRODUCTO_2 = "Carbassa";
const COSTE_KG_2 = 0.6;
const KG_DONACIO_2 = 120;
const KG_RETRO_2 = 118;

// Datos fiscales de la organización de prueba que SÍ tiene que poder certificar. Son
// inventados a propósito y se leen como tales: el NIF no es válido (el dígito de control
// no cuadra), igual que el CIF `G00000000` de `parametros_documentales`.
const FISCAL_PROD_1 = {
  nif: "B00000000",
  direccion: "Carrer de Prova, 1",
  codigo_postal: "08850",
  poblacion: "Gavà",
};

const ejercicio = new Date().getFullYear();

// ---------------------------------------------------------------------------

function paso(txt: string) {
  console.log(`\n· ${txt}`);
}

async function idOrg(tabla: "productores" | "entidades", codigo: string): Promise<string> {
  const { data, error } = await db.from(tabla).select("id, codigo").eq("codigo", codigo).maybeSingle();
  if (error) throw new Error(`${tabla}/${codigo}: ${error.message}`);
  if (!data) {
    console.error(`No existe ${tabla} con codigo ${codigo}.`);
    console.error("Ejecuta antes: deno run -A scripts/crear-usuarios-prueba.ts");
    Deno.exit(1);
  }
  return data.id as string;
}

/** Lanza si la RPC falla: aquí un error no es un caso a manejar, es un fixture roto. */
async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(nombre, args);
  if (error) throw new Error(`rpc ${nombre}: ${error.message} (${error.code ?? "?"})`);
  return data as T;
}

// ---------------------------------------------------------------------------
// Lo que el CIERRE ANUAL necesita (fase 4)
// ---------------------------------------------------------------------------
// Se ejecuta SIEMPRE, exista ya la espigolada o no: es idempotente y hace falta que se
// reaplique al añadir cosas al fixture (mismo criterio que los catálogos y las ofertas).
//
// Tres cosas que el cierre no puede calcular sin ellas:
//
//   1. **Fecha de recogida.** `cierre_base()` filtra por `data_hora_recollida`, y ni el
//      reparto de una espigolada ni `aprovar_resposta()` la escriben. La RPC cae a
//      `conciliada_at`, así que el cierre saldría igual — pero entonces el camino
//      principal no lo probaría nadie. Aquí se rellena.
//   2. **Datos fiscales.** Sin NIF y domicilio, `calcular_cierre()` bloquea al donante y
//      no se puede llegar al certificado. TEST-PROD-1 los recibe; **TEST-PROD-2 no**, a
//      propósito: es el caso bloqueado que hay que ver en la pantalla.
//   3. **Un donante con conciliación retroactiva.** Es la fuente 2 del plan (las
//      canalizaciones de 2026 que no tienen albarán). Sirve para comprobar lo único que
//      distingue un cierre de prueba de uno real: en prueba entra, en real no.
/** Id del cierre de prueba en curso; lo fija `prepararCierre()` y lo usa el CT (fase 5). */
let cierrePrueba: string | null = null;

async function prepararCierre() {
  paso("Preparación del cierre anual");

  // (0) Buzón del equipo: en modo prueba es el destinatario de TODO. La migración lo deja
  //     null a propósito (§7: ninguna migración lleva un correo real), así que sin esto
  //     `emitir_resumen` falla diciendo que no hay a dónde enviar. `.invalid` es un TLD
  //     reservado: no se puede entregar en ningún sitio, que es lo que se quiere de un
  //     valor de relleno.
  const { data: par } = await db.from("parametros_documentales")
    .select("id, email_equipo").eq("id", 1).maybeSingle();
  if (par && !par.email_equipo) {
    await db.from("parametros_documentales")
      .update({ email_equipo: "equip-proves@example.invalid" }).eq("id", 1);
    console.log("  email_equipo ← equip-proves@example.invalid (RELLENO: cámbialo en Configuració)");
  }

  // (1) Datos fiscales del donante que sí certifica.
  await db.from("productores").update(FISCAL_PROD_1).eq("id", productor);
  console.log(`  TEST-PROD-1: NIF ${FISCAL_PROD_1.nif}, ${FISCAL_PROD_1.codigo_postal} ${FISCAL_PROD_1.poblacion}`);
  console.log("  TEST-PROD-2: SIN dades fiscals (cas bloquejat, a propòsit)");

  // (2) Coste del segundo producto.
  await rpc("fijar_coste_producto", {
    p_producto: PRODUCTO_2,
    p_ejercicio: ejercicio,
    p_coste: COSTE_KG_2,
    p_motivo: `Fixture de proves ${ejercicio} — NO es una referencia real de mercat`,
  });

  // (3) La donación de TEST-PROD-2, conciliada retroactivamente.
  const idDon2 = `E-TEST-RETRO-${ejercicio}`;
  let exc2: string | null = null;
  const { data: ya2 } = await db.from("excedentes")
    .select("id").eq("id_excedente", idDon2).maybeSingle();
  if (ya2) {
    exc2 = ya2.id as string;
  } else {
    const { data, error } = await db.from("excedentes").insert({
      id_excedente: idDon2,
      productor_id: productor2,
      familia: "Horta Fruit",
      producto: PRODUCTO_2,
      variedad: "Violina",
      kg_total: KG_DONACIO_2,
      modalitat: "donacio",
      causa: "Excedent de collita",
      estado: "bloqueada",
      origen: "asistido",
      texto_oferta: "OFERTA DISPONIBLE (fixture de proves — conciliació retroactiva)",
    }).select("id").single();
    if (error) throw new Error(`donació retroactiva: ${error.message}`);
    exc2 = data.id as string;
  }

  const entSocial = await idOrg("entidades", "TEST-ENT-SOCIAL");
  const { data: can2ya } = await db.from("canalizaciones")
    .select("id, estado").eq("excedente_id", exc2).maybeSingle();
  let can2 = can2ya?.id as string | undefined;
  if (!can2) {
    const { data, error } = await db.from("canalizaciones").insert({
      excedente_id: exc2,
      entidad_id: entSocial,
      kg_confirmados: KG_DONACIO_2,
      valorizacion: "donacio",
      estado: "confirmada",
      data_hora_recollida: new Date().toISOString(),
    }).select("id").single();
    if (error) throw new Error(`canalització retroactiva: ${error.message}`);
    can2 = data.id as string;
  }
  if (can2ya?.estado !== "conciliada") {
    await rpc("conciliacion_retroactiva", {
      p_canalizacion: can2,
      p_kg: KG_RETRO_2,
      p_coste: COSTE_KG_2,
      p_motivo: "Fixture: canalització de 2026 sense albarans, conciliada a posteriori",
    });
  }
  console.log(`  ${idDon2}: ${KG_RETRO_2} kg conciliats retroactivament (${COSTE_KG_2} €/kg)`);

  // (4) Fecha de recogida en las canalizaciones de donación que no la tengan.
  const { data: sinFecha } = await db.from("canalizaciones")
    .select("id").eq("valorizacion", "donacio").is("data_hora_recollida", null);
  for (const c of sinFecha ?? []) {
    await db.from("canalizaciones")
      .update({ data_hora_recollida: new Date().toISOString() }).eq("id", c.id);
  }
  if ((sinFecha ?? []).length) {
    console.log(`  data_hora_recollida omplerta en ${(sinFecha ?? []).length} canalitzacions`);
  }

  // (5) Un cierre de prueba YA CALCULADO. Es lo que da sentido a las comprobaciones
  //     `requiereFixture` del arnés: sin una fila en `cierres_donante`, «el productor ve
  //     SU acumulat anual» sale SALTADA, porque 0 filas no distingue «la política me
  //     bloquea» de «no hay nada que ver» (§12.48). Se reutiliza el que ya esté abierto.
  {
    let cierre: string;
    const { data: abierto } = await db.from("cierres_ejercicio")
      .select("id").eq("ejercicio", ejercicio).eq("modo", "prueba").eq("estado", "obert")
      .order("created_at").limit(1).maybeSingle();
    if (abierto) {
      cierre = abierto.id as string;
    } else {
      const nuevo = await rpc<{ id: string }>("abrir_cierre",
        { p_ejercicio: ejercicio, p_modo: "prueba" });
      cierre = nuevo.id;
    }
    const res = await rpc<Record<string, unknown>>("calcular_cierre", { p_cierre: cierre });
    console.log(`  tancament de prova ${cierre}`);
    console.log(`  calculat: ${res.donants} donants, ${res.linies} línies, ` +
      `${res.kg_total} kg, ${res.valor_total} € (${res.bloquejats} bloquejats)`);
    cierrePrueba = cierre;
  }

  const { data: base } = await db.rpc("cierre_base", { p_ejercicio: ejercicio, p_modo: "prueba" });
  const kg = (base ?? []).reduce((a: number, l: { kg_neto: number }) => a + Number(l.kg_neto), 0);
  const valor = (base ?? []).reduce((a: number, l: { valor: number }) => a + Number(l.valor), 0);
  console.log(`  base del tancament de prova ${ejercicio}: ${(base ?? []).length} línies, ` +
    `${kg.toFixed(2)} kg, ${valor.toFixed(2)} €`);
}

// ---------------------------------------------------------------------------
// Lo que los CONVENIOS necesitan (fase 2)
// ---------------------------------------------------------------------------
// Dos convenios, y a propósito en estados distintos, porque las dos cosas que hay que
// poder mirar en la pantalla y en el arnés son distintas:
//
//   · TEST-PROD-1 → conveni de donació del generador, firmat y **contrasignat**: es el
//     único estado que desbloquea de verdad `exigir_convenio()`, así que es lo que hace
//     que el bloqueo del corte se pueda probar por los dos lados (con y sin convenio).
//   · TEST-ENT-SOCIAL → conveni d'entitat receptora, enviat y **pendent de firma**: deja
//     un `enlaces_token` vivo de propósito `firma_convenio` y una fila en la bandeja de
//     la campaña. Sin él, «l'equip veu l'estat dels enllaços» seguiría dependiendo de que
//     hubiera pasado antes una espigolada.
//
// ⚠️ EL TOKEN EN CLARO SE IMPRIME. Es la única vez que existe (en la base solo queda su
//    sha256), y aquí se imprime porque es lo que permite abrir `/signar/<token>` a mano
//    para probar la página de firma. Solo pasa con fixtures `TEST-*`: ninguna
//    organización real entra por aquí.
//
// IDEMPOTENTE: si ya hay un convenio vigente (o en curso) de ese modelo, no se toca.
// ---------------------------------------------------------------------------
// Lo que el CERTIFICADO DE TRANSACCIÓN necesita (fase 5)
// ---------------------------------------------------------------------------
// Una venta conciliada **con su albarán de operación**, no una conciliación retroactiva:
// es el camino real del CT (los kilos salen del `OPE`) y es el que conviene ejercitar.
// Recorre el ciclo entero —emitir, entregar, confirmar por enlace, conciliar— igual que
// los ENT de la espigolada, y termina calculando las transacciones del cierre de prueba,
// que es lo que deja una fila `cierres_donante` con `tipo = 'transaccio'`.
//
// ⚠️ NO emite el certificado. `emitir_certificado_transaccion()` exige que
//    `parametros_documentales.datos_provisionales` sea `false`, y el fixture no toca ese
//    interruptor: ponerlo a `false` con el CIF de relleno sería justo lo que la
//    comprobación existe para impedir. El certificado se emite a mano cuando la
//    Configuración esté completa.
//
// IDEMPOTENTE: si la oferta de venta del fixture ya existe, no se rehace nada.
async function prepararTransaccio(cierre: string) {
  paso("Venta conciliada para el certificado de transacción (fase 5)");

  const idCT = `E-TEST-CT-${ejercicio}`;
  const { data: ya } = await db.from("excedentes")
    .select("id").eq("id_excedente", idCT).maybeSingle();

  if (ya) {
    console.log("  la venda del fixture ja existeix; no es refà");
  } else {
    const entComercial = await idOrg("entidades", "TEST-ENT-COMERCIAL");
    const { data: exc, error: errExc } = await db.from("excedentes").insert({
      id_excedente: idCT,
      productor_id: productor,
      familia: "Horta Fruit",
      producto: "Carbassó",
      variedad: "Verd",
      kg_total: 200,
      num_caixes: 10,
      tipo_caixa: TIPO_CAJA,
      modalitat: "venda",
      preu_minim: 0.4,
      causa: "Calibre no comercial",
      estado: "bloqueada",
      origen: "asistido",
      texto_oferta: "OFERTA DISPONIBLE (fixture de proves — venda per al CT)",
    }).select("id").single();
    if (errExc) throw new Error(`oferta de venda del CT: ${errExc.message}`);

    // La canalización dispara el trigger que crea el OPE en borrador.
    const { data: can, error: errCan } = await db.from("canalizaciones").insert({
      excedente_id: exc.id,
      entidad_id: entComercial,
      kg_confirmados: 200,
      valorizacion: "venda",
      estado: "confirmada",
      data_hora_recollida: new Date().toISOString(),
    }).select("id").single();
    if (errCan) throw new Error(`canalització de venda: ${errCan.message}`);

    const { data: ope, error: errOpe } = await db.from("albaranes")
      .select("id").eq("canalizacion_id", can.id).eq("tipo", "OPE").single();
    if (errOpe) throw new Error(`albarà d'operació: ${errOpe.message}`);

    const emitido = await rpc<{ numero_completo: string }>("emitir_albaran", {
      p_id: ope.id,
      p_recogida: { fecha_hora: new Date().toISOString(), quien_recoge: "TEST-ENT-COMERCIAL" },
      p_lineas: [{
        producto: "Carbassó",
        variedad: "Verd",
        familia: "Horta Fruit",
        num_cajas: 10,
        tipo_caja: TIPO_CAJA,
        kg_bruto: 200 + 10 * TARA_CAJA,
        kg_previstos: 200,
      }],
      p_idioma: "ca",
    });

    await rpc("marcar_entregado", { p_id: ope.id });

    // En un OPE confirman las dos partes; con una basta para poder conciliar.
    const { data: enlaces } = await db.from("enlaces_token")
      .select("id").eq("objeto_tipo", "albaran").eq("objeto_id", ope.id)
      .eq("proposito", "confirmacion_albaran").order("created_at");
    const enlace = (enlaces ?? [])[0];

    if (enlace) {
      const { data: lineas } = await db.from("albaran_lineas")
        .select("id, kg_neto").eq("albaran_id", ope.id);
      await rpc("registrar_confirmacion", {
        p_enlace: enlace.id,
        p_payload: {
          kg_confirmados: (lineas ?? []).map((l) => ({ linea_id: l.id, kg: 195 })),
          rechazo: "cap",
        },
        p_evidencia: {
          nombre: "Responsable de TEST-ENT-COMERCIAL (fixture)",
          cargo: "Compres",
          ip: "127.0.0.1",
          user_agent: "crear-datos-documentales-prueba.ts",
          sha256_texto: "0".repeat(64),
        },
      });
      await rpc("conciliar_albaran", {
        p_id: ope.id, p_kg_validados: null, p_motivo: null, p_destino_final: null,
      });
      console.log(`  ${emitido.numero_completo}  200 kg venuts → 195 kg conciliats`);
    } else {
      console.log(`  ${emitido.numero_completo} emès, sense enllaç (la fitxa no té correu)`);
    }
  }

  const res = await rpc<Record<string, unknown>>("calcular_cierre_transacciones", { p_cierre: cierre });
  console.log(`  transaccions calculades: ${res.generadors} generadors, ${res.linies} línies, ` +
    `${res.kg_total} kg (valor intern ${res.valor_intern} €, ${res.bloquejats} bloquejats)`);
  console.log("  el certificat NO s'emet: cal desmarcar datos_provisionales a Configuració");
}

// ---------------------------------------------------------------------------
// Lo que el PLAN DE PREVENCIÓN necesita (fase 5)
// ---------------------------------------------------------------------------
// Un plan emitido por organización, para que «ve EL SEU pla» del arnés tenga con qué
// probarse por los dos lados (un productor y una entidad).
//
// ⚠️ LAS RESPUESTAS SON UN RELLENO RECONOCIBLE. El cuestionario real es el anexo B del
//    funcional y todavía no existe (ver la cabecera de 20270301100000): `versio_questionari`
//    va a 0 y los identificadores son `pendent-1…3` a propósito, para que nadie los
//    confunda nunca con preguntas de negocio.
//
// IDEMPOTENTE: si la organización ya tiene un plan vigente, no se hace otro (emitir un
// segundo consumiría un número de la serie PLA, que es real: los planes no tienen modo
// prueba).
async function prepararPlans() {
  paso("Planes de prevención (fase 5)");

  const orgs: { tipo: "productor" | "entidad"; id: string; etiqueta: string }[] = [
    { tipo: "productor", id: productor, etiqueta: "TEST-PROD-1" },
    { tipo: "entidad", id: await idOrg("entidades", "TEST-ENT-SOCIAL"), etiqueta: "TEST-ENT-SOCIAL" },
  ];

  for (const org of orgs) {
    const columna = org.tipo === "productor" ? "productor_id" : "entidad_id";
    const { data: vigente } = await db.from("planes_prevencion")
      .select("numero_completo").eq(columna, org.id).eq("vigente", true).maybeSingle();
    if (vigente) {
      console.log(`  ${org.etiqueta}: ja té el pla ${vigente.numero_completo}`);
      continue;
    }

    await rpc("guardar_plan_basico", {
      p_tipo_org: org.tipo,
      p_org: org.id,
      p_respuestas: {
        questionari: "basic",
        versio_questionari: 0,
        respostes: [
          { id: "pendent-1", pregunta: "(pendent de l'annex B del funcional)", valor: null },
          { id: "pendent-2", pregunta: "(pendent de l'annex B del funcional)", valor: null },
          { id: "pendent-3", pregunta: "(pendent de l'annex B del funcional)", valor: null },
        ],
        notes: "Fixture de proves — el qüestionari real encara no existeix",
      },
      p_idioma: "ca",
      p_nivel: "basic",
    });

    const { data: esborrany } = await db.from("planes_prevencion")
      .select("id").eq(columna, org.id).eq("estado", "esborrany").single();

    const emitido = await rpc<{ numero: string; versio: number; document: string }>(
      "emitir_plan_basico", { p_plan: esborrany!.id });
    console.log(`  ${org.etiqueta}: ${emitido.numero} (v${emitido.versio}), document ${emitido.document}`);
  }
}

async function prepararConvenis() {
  paso("Convenios (fase 2)");

  async function ciclo(
    tipoOrg: "productor" | "entidad",
    orgId: string,
    tipo: "don_gen" | "don_rec" | "com",
    etiqueta: string,
    hastaVigent: boolean,
  ) {
    const { data: ya } = await db.from("convenios")
      .select("id, estado, numero_completo")
      .eq("tipo", tipo)
      .eq(tipoOrg === "productor" ? "productor_id" : "entidad_id", orgId)
      .not("estado", "in", "(resolt,substituit)")
      .maybeSingle();
    if (ya) {
      console.log(`  ${etiqueta}: ya existía (${ya.estado}${ya.numero_completo ? ` ${ya.numero_completo}` : ""})`);
      return;
    }

    const conv = await rpc<{ id: string }>("preparar_convenio", {
      p_tipo_org: tipoOrg,
      p_org: orgId,
      p_tipo: tipo,
      p_idioma: "ca",
    });

    const env = await rpc<{ enllac: { id: string; token: string; destinatari: string } }>(
      "enviar_convenio",
      { p_id: conv.id },
    );
    if (!hastaVigent) {
      console.log(`  ${etiqueta}: pendent de firma → /signar/${env.enllac.token}`);
      return;
    }

    // La firma, con la evidencia completa: sin `sha256_texto` y sin la declaración de
    // representación la RPC se niega, y con razón — son las dos cosas que convierten un
    // «va firmar» en un «va firmar AIXÒ, i deia poder fer-ho».
    const texto = `Text del conveni ${tipo} (fixture de proves)`;
    const huella = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto))),
    ).map((b) => b.toString(16).padStart(2, "0")).join("");

    const firmado = await rpc<{ id: string; numero_completo: string }>(
      "firmar_convenio_por_enlace",
      {
        p_enlace: env.enllac.id,
        p_datos: {
          raso_social: etiqueta,
          nif: FISCAL_PROD_1.nif,
          domicili: FISCAL_PROD_1.direccion,
          codi_postal: FISCAL_PROD_1.codigo_postal,
          poblacio: FISCAL_PROD_1.poblacion,
          representant: "Titular de prova",
          carrec: "Administrador",
          email: env.enllac.destinatari,
        },
        p_evidencia: {
          nombre: "Titular de prova",
          cargo: "Administrador",
          // DNI inventado y NO válido (la letra no cuadra), como el CIF G00000000 de
          // `parametros_documentales`. Va solo a `evidencias.documento_identidad`, que
          // está fuera del GRANT de SELECT de `authenticated`.
          documento_identidad: "00000000T",
          declaracion_representacion: true,
          ip: "127.0.0.1",
          user_agent: "crear-datos-documentales-prueba.ts",
          sha256_texto: huella,
        },
      },
    );

    const vigent = await rpc<{ numero_completo: string; estado: string }>(
      "contrafirmar_convenio",
      { p_id: firmado.id },
    );
    console.log(`  ${etiqueta}: ${vigent.numero_completo} ${vigent.estado}`);
  }

  await ciclo("productor", productor, "don_gen", "TEST-PROD-1 (donació generador)", true);
  await ciclo("entidad", await idOrg("entidades", "TEST-ENT-SOCIAL"), "don_rec",
              "TEST-ENT-SOCIAL (entitat receptora)", false);

  const { data: camp } = await db.from("v_campanya_convenis")
    .select("tipo_org, tipo, comarca, organitzacions, vigents, pendents_firma, sense_conveni");
  const tot = (camp ?? []).reduce((a, c) => a + Number(c.organitzacions), 0);
  const vig = (camp ?? []).reduce((a, c) => a + Number(c.vigents), 0);
  console.log(`  campanya: ${vig}/${tot} organitzacions amb conveni vigent`);
}

// ---------------------------------------------------------------------------
// 0. Simulación
// ---------------------------------------------------------------------------

if (dryRun) {
  console.log("\n--dry-run: se crearía la espigolada de 1.000 kg de tomate en 29 cajas,");
  console.log(`lotes de ${LOTES.map((l) => l.kg).join("/")} kg, con REC + 3 ENT y una confirmación`);
  console.log(`con ${KG_RECHAZADOS} kg rechazados. Nada escrito.`);
  console.log(`Y la preparación del cierre: dades fiscals de TEST-PROD-1, cost de ${PRODUCTO_2},`);
  console.log(`una donació de ${KG_RETRO_2} kg conciliada retroactivament i les dates de recollida.`);
  console.log("I dos convenis: TEST-PROD-1 vigent (firmat i contrasignat) i TEST-ENT-SOCIAL pendent de firma.\n");
  Deno.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Las piezas de catálogo que el caso necesita
// ---------------------------------------------------------------------------

paso("Tipo de caja de prueba y coste por kilo del ejercicio");

await rpc("fijar_tipo_caja", {
  p_codigo: TIPO_CAJA,
  p_nombre: "Caixa de prova (fixture)",
  p_tara: TARA_CAJA,
  p_retornable: true,
  p_activo: true,
});
console.log(`  ${TIPO_CAJA}: tara ${TARA_CAJA} kg/caixa`);

await rpc("fijar_coste_producto", {
  p_producto: PRODUCTO,
  p_ejercicio: ejercicio,
  p_coste: COSTE_KG,
  p_motivo: `Fixture de proves ${ejercicio} — NO es una referencia real de mercat`,
});
console.log(`  ${PRODUCTO} ${ejercicio}: ${COSTE_KG} €/kg`);

// ---------------------------------------------------------------------------
// 2. La finca
// ---------------------------------------------------------------------------

paso("Ubicación de la finca de TEST-PROD-1");

const productor = await idOrg("productores", "TEST-PROD-1");
const productor2 = await idOrg("productores", "TEST-PROD-2");

let ubicacion: string | null = null;
{
  const { data: existe } = await db.from("productor_ubicaciones")
    .select("id").eq("productor_id", productor).eq("alias", "Finca de Prova").maybeSingle();
  if (existe) {
    ubicacion = existe.id as string;
  } else {
    const { data: muni } = await db.from("municipios")
      .select("codi_ine, nom").eq("nom", "Gavà").maybeSingle();
    const { data, error } = await db.from("productor_ubicaciones").insert({
      productor_id: productor,
      alias: "Finca de Prova",
      municipio: muni?.nom ?? "Gavà",
      municipio_ine: muni?.codi_ine ?? null,
      es_principal: true,
    }).select("id").single();
    if (error) throw new Error(`ubicación: ${error.message}`);
    ubicacion = data.id as string;
  }
  console.log(`  Finca de Prova (Gavà) → ${ubicacion}`);
}

// ---------------------------------------------------------------------------
// 3. Las ofertas publicadas que le faltaban a los receptores
// ---------------------------------------------------------------------------
// No es parte del caso de la espigolada: es la cobertura que le falta al arnés. El
// receptor comercial solo ve ofertas de `venda`, y no había ninguna publicada, así que su
// comprobación de mercado salía SALTADA desde el 31-07-2026 (deuda §12.32/§12.48).
//
// `excedentes` no tiene GRANT de INSERT para nadie que no sea el servidor (§4), y aquí se
// escribe con `SB_SECRET_KEY`, que es exactamente el camino por el que lo crea la Edge
// Function `crear-oferta`.

paso("Ofertas publicadas (cobertura del mercado de los receptores)");

// Una de donación para el receptor social y el transformador, y otra de venta para el
// comercial. Cada receptor solo ve las modalidades compatibles con su `tipo_receptor`
// (matriz `modalitat_receptor_compat`), así que sin una de cada, la mitad de las cuentas
// de prueba abre un mercado vacío y su comprobación del arnés sale SALTADA.
const idDonacio = `E-TEST-DONACIO-${ejercicio}`;
const { data: yaDonacio } = await db.from("excedentes")
  .select("id").eq("id_excedente", idDonacio).maybeSingle();

if (yaDonacio) {
  console.log("  donació: ya existía");
} else {
  const { error } = await db.from("excedentes").insert({
    id_excedente: idDonacio,
    productor_id: productor,
    ubicacion_id: ubicacion,
    familia: "Horta Fruit",
    producto: "Carbassa",
    variedad: "Violina",
    kg_total: 250,
    num_caixes: 10,
    tipo_caixa: TIPO_CAJA,
    modalitat: "donacio",
    causa: "Excedent de collita",
    estado: "publicada",
    origen: "asistido",
    texto_oferta: "OFERTA DISPONIBLE (fixture de proves)",
  });
  if (error) throw new Error(`oferta de donació: ${error.message}`);
  console.log(`  ${idDonacio}: 250 kg de carbassa en donació`);
}

const idVenda = `E-TEST-VENDA-${ejercicio}`;
const { data: yaVenda } = await db.from("excedentes")
  .select("id").eq("id_excedente", idVenda).maybeSingle();

if (yaVenda) {
  console.log("  venda: ya existía");
} else {
  const { error } = await db.from("excedentes").insert({
    id_excedente: idVenda,
    productor_id: productor2,
    familia: "Horta Fruit",
    producto: "Carbassó",
    variedad: "Verd",
    kg_total: 300,
    num_caixes: 12,
    tipo_caixa: TIPO_CAJA,
    modalitat: "venda",
    preu_minim: 0.4,
    causa: "Calibre no comercial",
    estado: "publicada",
    origen: "asistido",
    texto_oferta: "OFERTA DISPONIBLE (fixture de proves)",
  });
  if (error) throw new Error(`oferta de venda: ${error.message}`);
  console.log(`  ${idVenda}: 300 kg de carbassó, 0,40 €/kg mínim`);
}

// ---------------------------------------------------------------------------
// 4. La espigolada y su albarán de recepción
// ---------------------------------------------------------------------------
// ⚠️ La comprobación de idempotencia va AQUÍ y no al principio del script a propósito:
//    todo lo anterior (catálogos, finca) y todo lo de la sección 6 (las ofertas
//    publicadas) es idempotente por su cuenta y **conviene que se reaplique** —así, al
//    añadir un dato nuevo al fixture, basta con volver a ejecutar el script sin tener que
//    borrar la espigolada, que es justamente lo que no se puede borrar—.

const { data: yaExiste } = await db.from("espigoladas")
  .select("id, fecha").eq("ref_externa", REF).maybeSingle();

if (yaExiste) {
  const { data: albs } = await db.from("albaranes")
    .select("tipo, numero_completo, estado").order("created_at");
  console.log(`\n  La espigolada de prueba ya existe (${yaExiste.fecha}); no se rehace.`);
  for (const a of albs ?? []) {
    console.log(`  ${a.tipo.padEnd(4)} ${(a.numero_completo ?? "(esborrany)").padEnd(18)} ${a.estado}`);
  }
  // Lo del cierre y los convenios sí se reaplica: es idempotente y es lo que se añade
  // sobre lo que ya hay.
  await prepararCierre();
  if (cierrePrueba) await prepararTransaccio(cierrePrueba);
  await prepararPlans();
  await prepararConvenis();
  console.log();
  Deno.exit(0);
}


paso("Espigolada de 1.000 kg de tomate en 29 cajas");

const espigolada = await rpc<{
  espigolada_id: string;
  albara_rec: string;
  registres: { excedente_id: string; producte: string; kg: number }[];
}>("crear_espigolada", {
  p_productor: productor,
  p_ubicacion: ubicacion,
  p_fecha: new Date().toISOString().slice(0, 10),
  p_num_voluntarios: 12,
  p_notas: "Espigolada de prova del sistema documental",
  p_lineas: [{
    producto: PRODUCTO,
    variedad: "Pera",
    causa: "Excedent de collita",
    num_cajas: CAJAS,
    tipo_caja: TIPO_CAJA,
    kg_bruto: KG_TOTAL + CAJAS * TARA_CAJA,
    tara_kg: CAJAS * TARA_CAJA,
    kg: KG_TOTAL,
  }],
  p_ref_externa: REF,
});

console.log(`  espigolada ${espigolada.espigolada_id}`);
console.log(`  registro   ${espigolada.registres[0].excedente_id} (${KG_TOTAL} kg)`);

// El REC se emite con los kilos pesados en la recogida: bruto menos tara.
const rec = await rpc<{ numero_completo: string }>("emitir_albaran", {
  p_id: espigolada.albara_rec,
  p_recogida: {
    fecha_hora: new Date().toISOString(),
    responsable_origen: "Responsable de prova",
    quien_recoge: "Voluntariat d'Espigoladors",
  },
  p_lineas: [{
    producto: PRODUCTO,
    variedad: "Pera",
    familia: "Horta Fruit",
    causa: "Excedent de collita",
    num_cajas: CAJAS,
    tipo_caja: TIPO_CAJA,
    kg_bruto: KG_TOTAL + CAJAS * TARA_CAJA,
    kg_previstos: KG_TOTAL,
  }],
  p_idioma: "ca",
});
console.log(`  albarà de recepció ${rec.numero_completo}`);

// El REC también se entrega y se confirma: quien confirma una recepción es el generador,
// y sin esa confirmación no se puede conciliar (o hay que esperar a que venza el plazo).
// La ficha de TEST-PROD-1 tiene correo, así que sale enlace.
{
  const entregaRec = await rpc<{ enllacos: { id: string }[] }>("marcar_entregado", {
    p_id: espigolada.albara_rec,
  });
  const enlaceRec = entregaRec.enllacos?.[0];
  if (enlaceRec) {
    const { data: lineas } = await db.from("albaran_lineas")
      .select("id, kg_neto").eq("albaran_id", espigolada.albara_rec);
    await rpc("registrar_confirmacion", {
      p_enlace: enlaceRec.id,
      p_payload: {
        kg_confirmados: (lineas ?? []).map((l) => ({ linea_id: l.id, kg: Number(l.kg_neto ?? KG_TOTAL) })),
        rechazo: "cap",
      },
      p_evidencia: {
        nombre: "Titular de Mas de Prova (fixture)",
        cargo: "Titular",
        ip: "127.0.0.1",
        user_agent: "crear-datos-documentales-prueba.ts",
        sha256_texto: "0".repeat(64),
      },
    });
    console.log("  confirmat pel generador");
  }
}

// ---------------------------------------------------------------------------
// 5. El reparto en lotes
// ---------------------------------------------------------------------------

paso(`Reparto en lotes de ${LOTES.map((l) => l.kg).join(", ")} kg`);

const entidades: Record<string, string> = {};
for (const codigo of new Set(LOTES.map((l) => l.entidad))) {
  entidades[codigo] = await idOrg("entidades", codigo);
}

const reparto = await rpc<{ lots: { canalitzacio_id: string; kg: number }[]; avisos: string[] }>(
  "repartir_espigolada",
  {
    p_id: espigolada.espigolada_id,
    p_lotes: LOTES.map((l, i) => ({
      excedente_id: espigolada.registres[0].excedente_id,
      entidad_id: entidades[l.entidad],
      kg: l.kg,
      nota: l.nota,
      codigo_lote: `${REF}-L${i + 1}`,
    })),
  },
);
for (const a of reparto.avisos ?? []) console.log(`  ⚠️  ${a}`);
console.log(`  ${reparto.lots.length} lotes → ${reparto.lots.length} albaranes de entrega en borrador`);

// ---------------------------------------------------------------------------
// 6. Emitir, entregar y confirmar los ENT
// ---------------------------------------------------------------------------

paso("Emisión y confirmación de los albaranes de entrega");

const { data: ents, error: errEnts } = await db.from("albaranes")
  .select("id, tipo, canalizacion_id, estado")
  .eq("tipo", "ENT").eq("estado", "borrador").order("created_at");
if (errEnts) throw new Error(errEnts.message);

let i = 0;
const entsEmitidos: string[] = [];
for (const ent of ents ?? []) {
  const lote = LOTES[i];
  if (!lote) break;
  const cajas = Math.round((lote.kg / KG_TOTAL) * CAJAS);

  const emitido = await rpc<{ numero_completo: string }>("emitir_albaran", {
    p_id: ent.id,
    p_recogida: { fecha_hora: new Date().toISOString(), quien_recoge: lote.entidad },
    p_lineas: [{
      producto: PRODUCTO,
      variedad: "Pera",
      familia: "Horta Fruit",
      num_cajas: cajas,
      tipo_caja: TIPO_CAJA,
      kg_bruto: lote.kg + cajas * TARA_CAJA,
      kg_previstos: lote.kg,
      lote_origen: `${REF}-L${i + 1}`,
    }],
    p_idioma: "ca",
  });

  // Marcar entregado crea el enlace de confirmación. El token en claro solo existe aquí:
  // en la base queda su sha256 (por eso el fixture puede confirmar y una fuga de la tabla
  // no podría).
  const entrega = await rpc<{ enllacos: { id: string; token: string; destinatari: string }[] }>(
    "marcar_entregado",
    { p_id: ent.id },
  );

  const enlace = entrega.enllacos?.[0];
  let sufijo = "sense enllaç (la fitxa no té correu)";

  // Las TRES se confirman, como el caso de aceptación del plan, y **la primera con
  // rechazo parcial**: es la que ejercita el aviso al donante y la discrepancia de la
  // propuesta de conciliación (1.000 kg entrados frente a 990 llegados).
  if (enlace) {
    const rechaza = i === 0;
    const { data: lineas } = await db.from("albaran_lineas")
      .select("id, kg_neto").eq("albaran_id", ent.id);
    await rpc("registrar_confirmacion", {
      p_enlace: enlace.id,
      p_payload: {
        kg_confirmados: (lineas ?? []).map((l) => ({
          linea_id: l.id,
          kg: Number(l.kg_neto ?? lote.kg) - (rechaza ? KG_RECHAZADOS : 0),
        })),
        caixes_retornades: cajas,
        incidencias: rechaza ? [{ descripcion: `${KG_RECHAZADOS} kg en mal estat, retornats` }] : null,
        rechazo: rechaza ? "parcial" : "cap",
        motivo_rechazo: rechaza ? `${KG_RECHAZADOS} kg de tomàquet en mal estat a l'arribada` : null,
      },
      p_evidencia: {
        nombre: `Responsable de ${lote.entidad} (fixture)`,
        cargo: "Coordinació",
        ip: "127.0.0.1",
        user_agent: "crear-datos-documentales-prueba.ts",
        sha256_texto: "0".repeat(64),
      },
    });
    sufijo = rechaza
      ? `confirmat amb rebuig parcial de ${KG_RECHAZADOS} kg`
      : "confirmat sense incidencies";
  }

  entsEmitidos.push(ent.id as string);
  console.log(`  ${emitido.numero_completo}  ${lote.kg} kg → ${lote.entidad}: ${sufijo}`);
  i++;
}

// ---------------------------------------------------------------------------
// 7. Resumen
// ---------------------------------------------------------------------------

paso("Conciliación");

// Los tres ENT están confirmados, así que se concilian sin motivo: los kilos validados
// son los confirmados. (Sin confirmación habría que esperar a que venciera el plazo del
// parámetro —7 días— y dejar motivo; esa regla no se salta ni para el fixture.)
for (const id of entsEmitidos) {
  await rpc("conciliar_albaran", {
    p_id: id, p_kg_validados: null, p_motivo: null, p_destino_final: null,
  });
}
console.log(`  ${entsEmitidos.length} ENT confirmats → conciliats (kg validats = els confirmats)`);

// El REC se concilia por los 1.000 kg que entraron: los kilos que se certifican son los
// del albarán de recepción (D13). La diferencia con lo que llegó a las entidades queda
// registrada con su destino final.
await rpc("conciliar_albaran", {
  p_id: espigolada.albara_rec,
  p_kg_validados: null,
  p_motivo: `Diferència de ${KG_RECHAZADOS} kg rebutjats per l'entitat`,
  p_destino_final: "Alimentació animal",
});
console.log(`  REC conciliat per ${KG_TOTAL} kg, ${KG_RECHAZADOS} kg amb destí final`);

paso("Propuesta de conciliación del albarán de recepción");

const propuesta = await rpc<Record<string, unknown>>("propuesta_conciliacion", {
  p_rec: espigolada.albara_rec,
});
console.log(`  recepció ${propuesta.kg_recepcio} kg · entregues ${propuesta.kg_entregues} kg`);
console.log(`  diferència ${propuesta.diferencia} kg (${propuesta.diferencia_pct} %), ` +
  `tolerància ${propuesta.tolerancia_pct} % → ${propuesta.dins_tolerancia ? "dins" : "FORA"}`);

await prepararCierre();
if (cierrePrueba) await prepararTransaccio(cierrePrueba);
await prepararPlans();
await prepararConvenis();

const { count: nDocs } = await db.from("documentos")
  .select("id", { count: "exact", head: true }).eq("objeto_tipo", "albaran");

console.log(`\nListo. ${(ents ?? []).length} albaranes de entrega, 1 de recepción, ${nDocs} documentos.`);
console.log("El arnés ya tiene con qué comprobar los albaranes de un productor y de un receptor.\n");
