// Verificación pública de un certificado de recepción (F4).
//
//   GET /verificar-certificat?codi=<codi de verificació imprès>
//     200 { valid: true, numero, entitat, periode: { des_de, fins_a }, kg, vigent, mode, emes_el }
//     404 { valid: false }
//
// PARA QUÉ SIRVE. Un certificado de recepción acaba en manos de un tercero —un
// ayuntamiento, una financiadora, un auditor— que no tiene cuenta en Redestina y que
// necesita saber dos cosas: que ese papel salió de aquí, y que **sigue siendo el vigente**.
// Lo segundo es lo que un PDF no puede decir por sí mismo: al emitir un certificado que
// contiene a otro, el anterior queda sustituido (`emetre_certificat_recepcio()`), y su
// copia impresa no se entera.
//
// SE DESPLIEGA `verify_jwt = false` porque quien la usa no tiene ni tendrá cuenta. Lo que
// autoriza es **conocer el código impreso**: 16 dígitos hexadecimales del `sha256_datos`
// del documento, o sea 64 bits. No hay enumeración posible y no hace falta fingir que la
// hay: el mínimo aceptado son esos 16 dígitos, nunca un prefijo más corto.
//
// 🔴 LO QUE ESTA FUNCIÓN NO DEVUELVE, Y NO ES UNA OMISIÓN:
//     · el PDF, ni una URL firmada. Para eso está `descargar-documento`, con sesión y
//       `puede_ver_documento()`.
//     · `documentos.datos` entero, el detalle por producto, o CUALQUIERA de las dos
//       listas de procedencia. La de compra **nombra a los generadores** y la de donación
//       lleva municipios de origen: son terceros que no han pedido salir en una página
//       pública que se abre sin ninguna sesión. El papel los lleva porque lo tiene quien
//       tiene derecho a tenerlo; una API abierta, no.
//     · nada de otros tipos de documento. Un código de un CD o de un albarán responde
//       exactamente igual que uno inventado (ver abajo).
//   Se devuelven los OCHO campos del contrato y ni uno más. Añadir aquí un campo «porque
//   es útil» es publicarlo: esto no tiene ninguna capa de autorización detrás.
//
// ⚠️ UN CÓDIGO DESCONOCIDO Y UNO MAL FORMADO RESPONDEN LO MISMO (`404 { valid: false }`).
//    Distinguirlos convertiría esto en un oráculo: «este número de certificado existe» ya
//    es información sobre una organización. Por eso no hay `code`, ni mensaje, ni detalle
//    — y por eso tampoco se distingue un código de otro tipo de documento.
//
// Corre con `service_role` porque `documentos` está cerrada a `anon` (no tiene ni un
// privilegio, §9) y aquí no hay sesión que ninguna política pueda mirar. La restricción
// la pone este fichero, y por eso la lista de columnas del `select` es corta a propósito.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { corsPara } from "../_shared/cors.ts";

// Sin tipos generados de la base (misma nota que `registro/index.ts`).
// deno-lint-ignore no-explicit-any
type Cliente = any;

/**
 * Los dígitos que imprime `codigoVerificacion()` en el PDF: los 16 primeros del sha256 del
 * snapshot, en grupos de cuatro (`A1B2-C3D4-E5F6-7890`). El mínimo que se acepta aquí.
 *
 * ⚠️ Si algún día cambia el largo impreso, hay que cambiarlo en los DOS sitios: aquí y en
 *    `_shared/pdf/render/cierre.ts`. Un código más corto que este mínimo se rechaza.
 */
const LARGO_CODIGO = 16;
const LARGO_SHA = 64;

// ---------------------------------------------------------------------------
// Anti-abuso — el mismo molde que `enlace-publico`, con los topes de una lectura
// ---------------------------------------------------------------------------
// Límite por IP EN MEMORIA, y hay que decir lo que es: best-effort de verdad. El isolate
// se recicla y hay varios a la vez, así que ni es global ni sobrevive a un arranque en
// frío. No hace falta más: esta función no escribe nada, no manda ningún correo y no
// consume ninguna serie. Está para el ruido y para no pagar consultas de más.
//
// Lo que de verdad hace inviable adivinar un código son los 64 bits del propio código.
const FINESTRA_MS = 10 * 60 * 1000;
const MAX_PER_IP = 30;

const intentsPerIp = new Map<string, number[]>();

function massaIntentsIp(ip: string): boolean {
  if (!ip) return false;
  const ara = Date.now();
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

function ipDe(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
}

/**
 * El código tal como se teclea → el prefijo hexadecimal con el que se busca.
 *
 * Se aceptan guiones, espacios y mayúsculas porque es lo que hay impreso y lo que la gente
 * copia; lo que no se acepta es nada más corto que `LARGO_CODIGO`. `null` = no es un
 * código, y el que llama no distingue ese caso de «no existe».
 */
function prefijoDe(bruto: string): string | null {
  const hex = bruto.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (hex.length < LARGO_CODIGO || hex.length > LARGO_SHA) return null;
  return hex;
}

interface FilaDocumento {
  numero_completo: string | null;
  modo: string;
  vigente: boolean;
  emitido_at: string | null;
  datos: Record<string, unknown> | null;
}

/** Lo que devuelve el contrato, y nada más. */
interface Certificado {
  valid: true;
  numero: string | null;
  entitat: string | null;
  periode: { des_de: string | null; fins_a: string | null };
  kg: number | null;
  vigent: boolean;
  mode: string;
  emes_el: string | null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/**
 * Del snapshot congelado a los campos del contrato. Se leen uno a uno por su clave y **nunca se
 * copia el objeto entero**: es lo que garantiza que un campo nuevo en `documentos.datos`
 * no se publique solo el día que alguien lo añada en SQL.
 */
function resumir(doc: FilaDocumento): Certificado {
  const datos = (doc.datos ?? {}) as Record<string, unknown>;
  // `receptora` es la copia congelada de la ficha (`cierres_receptor.datos_fiscales`), con
  // la clave acentuada tal como la escribe SQL. De ella sale SOLO el nombre: ni el NIF, ni
  // el domicilio, ni el correo.
  const receptora = (datos.receptora ?? {}) as Record<string, unknown>;
  const periodo = (datos.periode ?? {}) as Record<string, unknown>;
  return {
    valid: true,
    numero: doc.numero_completo,
    entitat: texto(receptora["raó_social"]),
    periode: { des_de: texto(periodo.des_de), fins_a: texto(periodo.fins_a) },
    kg: numero(datos.kg),
    // `documentos.vigente` pasa a false cuando otro certificado lo sustituye. Es el único
    // dato que el papel impreso no puede llevar, y la razón de que esto exista.
    vigent: doc.vigente === true,
    // `real` | `prueba`. Un ensayo lleva filigrana y serie `P-CR`, pero quien recibe el
    // JSON no ve el PDF: si no se dijera, un certificado de prueba se leería como válido.
    mode: doc.modo,
    emes_el: doc.emitido_at,
  };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const t0 = performance.now();
  const cors = corsPara(req, "GET, OPTIONS");
  const responder = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  // La única respuesta negativa que existe. Se usa para todo: código mal formado, código
  // desconocido, documento de otro tipo. Sin `code` y sin mensaje, a propósito.
  const noExiste = () => responder({ valid: false }, 404);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return responder({ error: "Method Not Allowed" }, 405);

  const ip = ipDe(req);
  if (massaIntentsIp(ip)) {
    return responder(
      { error: "Has fet massa consultes. Torna-ho a provar d'aquí una estona.", code: "massa_solicituds" },
      429,
    );
  }

  const prefijo = prefijoDe(new URL(req.url).searchParams.get("codi") ?? "");
  if (!prefijo) return noExiste();

  const supabase: Cliente = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  try {
    // ⚠️ La lista de columnas va en UN literal (§7, deuda 46) y es CORTA a propósito:
    //    esto es una API pública, así que lo que no se pide no se puede publicar por
    //    descuido. `datos` entra porque de ahí salen el nombre, el periodo y los kilos —y
    //    `resumir()` extrae esos cuatro campos, nunca el objeto.
    //
    // `tipo = 'CR'` no es un filtro de conveniencia: los ocho campos del contrato son los
    // de un certificado de recepción (`entitat` es quien recibió). Un CD o un albarán
    // tienen otro sujeto y saldrían con `entitat` en blanco, afirmando un vacío que no es
    // cierto. Responden como un código desconocido.
    //
    // Se piden DOS filas para poder distinguir la colisión de prefijo del caso normal.
    const { data, error } = await supabase
      .from("documentos")
      .select("numero_completo, modo, vigente, emitido_at, datos")
      .eq("tipo", "CR")
      .ilike("sha256_datos", `${prefijo}%`)
      .limit(2);

    if (error) {
      console.error("verificar-certificat: select:", error.message);
      return responder({ error: "Hi ha hagut un problema. Torna-ho a provar.", code: "error_intern" }, 500);
    }

    const filas = (data ?? []) as FilaDocumento[];

    // Dos documentos con el mismo prefijo de 64 bits no puede pasar en la práctica, pero
    // si pasara no se puede elegir uno: decir «este es» sería inventarse cuál. Se responde
    // como desconocido y se deja escrito en el log, que es el único sitio donde alguien
    // podría enterarse.
    if (filas.length > 1) {
      console.warn(
        JSON.stringify({ fn: "verificar-certificat", avis: "prefix_ambigu", prefix: prefijo.length }),
      );
      return noExiste();
    }
    if (filas.length === 0) return noExiste();

    const ms = performance.now() - t0;
    if (ms > 500) {
      console.warn(JSON.stringify({ fn: "verificar-certificat", avis: "lent", ms: Number(ms.toFixed(1)) }));
    }
    // ⚠️ NI EL CÓDIGO NI EL NÚMERO VAN AL LOG. El primero es la credencial de esta
    //    función; el segundo identifica a una organización, y los logs los lee el equipo.
    console.log(JSON.stringify({
      fn: "verificar-certificat",
      trobat: true,
      vigent: filas[0].vigente === true,
      mode: filas[0].modo,
      ms: Number(ms.toFixed(1)),
    }));

    return responder(resumir(filas[0]), 200);
  } catch (e) {
    console.error("verificar-certificat:", e instanceof Error ? e.message : String(e));
    return responder({ error: "Hi ha hagut un problema. Torna-ho a provar.", code: "error_intern" }, 500);
  }
});
