// Registro público self-service: alta de cuenta + ficha + membresía PENDIENTE.
//
// Se despliega con --no-verify-jwt: la llama alguien que todavía no tiene cuenta. Es la
// primera función pública que ESCRIBE (recuperar-password solo lee y manda un correo),
// así que todo lo que hay aquí gira alrededor de eso: validar antes de tocar nada,
// frenar el abuso, y no dejar residuos si algo falla a medias.
//
// Crea cuatro cosas, en este orden, porque es el único que permite compensar:
//   1. la cuenta de Auth (Admin API; el trigger on_auth_user_created crea el perfil)
//   2. la fila de `organizaciones` (identidad de la organización; solo si es un alta nueva)
//   3. la ficha de `productores` o `entidades`, apuntando a esa organización
//   4. la `membresias` con activo = false y aprovacio = 'pendent'
// Si falla el paso 3 se borran la organización y la cuenta; si falla el 4, la ficha, la
// organización y la cuenta. El peor residuo posible —una cuenta de Auth sin membresía— es
// inocuo: sin membresía activa no ve absolutamente nada (mis_productores/mis_entidades
// filtran por `activo`). El paso 2 es ADEMÁS best-effort: si no se puede crear la
// organización, la ficha nace sin ella —exactamente como las que se crean a mano— antes
// que perder un alta por una identidad que el equipo puede enlazar después.
//
// Y DESDE LA FASE 2, una quinta cosa que **no se compensa a propósito**: el convenio en
// `esborrany` y su enlace de firma (§3.2.4, «Dentro del registro»). Si ese paso falla, el
// alta se da por buena igualmente y el equipo prepara el convenio desde la campaña: negar
// un registro entero porque no se pudo preparar un contrato que todavía nadie ha leído
// sería tirar a la basura lo único que la persona vino a hacer.
//
// ⚠️ EL TOKEN DE FIRMA SOLO SE DEVUELVE SI FIRMA AHORA MISMO. Cuando la persona dice ser
//    la representante legal, la respuesta trae el token para que la propia pantalla siga
//    a `/signar/<token>`: no viaja por ningún sitio, es la misma sesión y la misma
//    persona. Cuando indica el correo de otra persona, el enlace se crea y se queda
//    esperando: esta función NO envía correo (ver abajo) y quien lo manda es el equipo
//    desde la bandeja de la campaña.
//
// NO ENVÍA NINGÚN CORREO, y es deliberado. Con el modo test activo (§8) la cuenta recién
// creada no pasaría `esCuentaPermitida` —su organización nace con es_test = false—, así
// que el correo se descartaría en silencio y el alta quedaría a medias: una persona
// esperando un mensaje que nunca llega. La validación la hace el equipo desde el panel,
// y es ahí donde se decide cómo se le avisa. Por eso esta función no importa
// `_shared/resend.ts` ni `_shared/gate.ts`.
//
// TAMPOCO VINCULA con una ficha existente aunque el correo coincida: eso convertiría
// «conozco el email de esta organización» en «soy esta organización». Un duplicado lo
// resuelve el equipo al aprobar; una suplantación, no.
//
// ⚠️ DESDE LA ETAPA 2 DE LA ORGANIZACIÓN UNIFICADA (§1bis brecha 2, deuda §12.28) SÍ DETECTA
//    que la organización ya consta, que es cosa distinta de vincularla. Antes solo veía los
//    choques con `productores` —y los veía porque `email` y `phone` son UNIQUE allí—, así que
//    una entidad ya fichada se registraba otra vez sin que nada lo notara. Ahora se consultan
//    las fichas de las dos tablas y `v_organizaciones`, y salen tres caminos (el detalle del
//    criterio, en `coincidencies.ts`):
//      1. nada coincide → alta normal, y la ficha estrena su fila en `organizaciones`
//      2. coincide una organización que NO tiene ficha de este tipo → es la misma
//         organización estrenando papel: **se da el alta, SIN enlazar**, con una nota en el
//         comentario de la ficha para que lo decida el equipo (ver abajo)
//      3. coincide una organización que YA tiene ficha de este tipo → 409 `dades_en_us`
//
//    El caso 2 no se enlaza solo, y no es timidez: enlazar sería exactamente lo que el
//    párrafo de arriba prohíbe, solo que con un rodeo. Hoy el acceso lo da `membresias`, que
//    apunta a una ficha, así que enlazar no abriría nada todavía; pero la unificación existe
//    para que mañana los convenios, los albaranes y los certificados se resuelvan POR
//    ORGANIZACIÓN, y ese día el enlace se convierte, sin que nadie lo vuelva a mirar, en
//    acceso a los kilos y al certificado fiscal de la otra ficha — creado por un POST sin
//    sesión de quien solo sabía un correo. Aprobar un alta es un clic y nada en esa pantalla
//    diría que además se está confirmando una identidad. Así que se detecta, se avisa y se
//    deja la decisión donde tiene dueño.

// ⚠️ DESDE EL 07-10-2026 EL ALTA ESTÁ REPARTIDA, sin un cambio de lógica:
//      · `validacio.ts`     — qué se acepta del cuerpo (`validar`)
//      · `deteccio.ts`      — las consultas que deciden si la organización ya existe
//      · `coincidencies.ts` — la regla de esa decisión, pura y con pruebas
//      · `conveni.ts`       — el convenio que se prepara dentro del alta
//      · `alta.ts`          — (27-10-2026) el orden de los pasos y su compensación, más los
//                             consentimientos RGPD; lo comparte la función `alta-assistida`
//    Aquí queda el anti-abuso, que es lo propio de la puerta pública.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import type { Cliente } from "./cliente.ts";
import { textNet, validar } from "./validacio.ts";
import { executarAlta } from "./alta.ts";

// ---------------------------------------------------------------------------
// Anti-abuso
// ---------------------------------------------------------------------------
// Sin captcha todavía (queda anotado como deuda). Tres frenos de coste creciente:
//   · honeypot: un campo que ningún humano ve; si viene relleno, 200 y a la basura
//   · límite por IP EN MEMORIA: best-effort de verdad. El isolate se recicla y hay
//     varios a la vez, así que el contador se pierde y no es global. Frena el script
//     tonto, no una campaña repartida; para eso está el freno de abajo
//   · freno global DURABLE: si ya hay 20 registros pendientes de la última hora, se
//     corta. Ese sí vive en la base y no depende de qué isolate atienda la petición
const FINESTRA_MS = 10 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_PENDENTS_HORA = 20;

const intentsPerIp = new Map<string, number[]>();

function massaIntentsIp(ip: string): boolean {
  if (!ip) return false;
  const ara = Date.now();

  // Poda perezosa: sin esto el Map crece hasta que el isolate muere.
  if (intentsPerIp.size > 500) {
    for (const [clau, marques] of intentsPerIp) {
      if (marques.every((t) => ara - t >= FINESTRA_MS)) intentsPerIp.delete(clau);
    }
  }

  const recents = (intentsPerIp.get(ip) ?? []).filter((t) => ara - t < FINESTRA_MS);
  recents.push(ara);
  intentsPerIp.set(ip, recents);
  return recents.length > MAX_PER_IP;
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    // Honeypot: se responde 200 como si hubiera ido bien. Decirle a un bot que lo
    // hemos detectado solo sirve para que ajuste el siguiente intento.
    if (textNet(body.web)) {
      console.warn("[registro] honeypot relleno, descartado");
      return responder({ ok: true }, 200);
    }

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    if (massaIntentsIp(ip)) {
      return responder(
        { error: "Has fet massa intents. Torna-ho a provar d'aqui una estona.", code: "massa_solicituds" },
        429,
      );
    }

    const v = validar(body);
    if (!v.ok) return responder({ error: v.error, code: "dades_invalides", camp: v.camp }, 400);
    const d = v.dades;

    const supabase: Cliente = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SB_SECRET_KEY")!,
    );

    // Freno global durable: si la cola ya está desbordada, lo que llegue detrás es
    // ruido para el equipo. Se corta aquí, antes de crear nada.
    const { count } = await supabase
      .from("membresias")
      .select("id", { count: "exact", head: true })
      .eq("aprovacio", "pendent")
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if ((count ?? 0) >= MAX_PENDENTS_HORA) {
      console.warn("[registro] freno global:", count, "pendientes en la ultima hora");
      return responder(
        { error: "Ara mateix no podem processar mes sol·licituds. Torna-ho a provar mes tard.", code: "massa_solicituds" },
        429,
      );
    }

    // Los pasos del alta, su orden y su compensación viven en `alta.ts`, que comparte el
    // alta asistida del equipo. `executarAlta` nunca lanza: lo que se crea a medias lo
    // deshace ella.
    const r = await executarAlta(supabase, d, {
      origen: "registre",
      ip,
      userAgent: req.headers.get("user-agent"),
    });
    return responder(r.body, r.status);
  } catch (err) {
    console.error("[registro] error:", err instanceof Error ? err.message : String(err));
    return responder({ error: "Error intern", code: "error_intern" }, 500);
  }
});
