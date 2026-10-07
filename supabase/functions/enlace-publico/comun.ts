// Lo que comparten las tres ramas de `enlace-publico` (albarán, factura y convenio): el
// cliente, el token y su estado, el anti-abuso, la URL firmada del PDF y el fichero que
// llega en base64. Se separó de `index.ts` el 07-10-2026 sin cambiar una línea de lógica:
// el fichero tenía 2.195 líneas y tres propósitos que no se tocan entre sí.
//
// ⚠️ `intentsPerIp` es estado de MÓDULO: vive aquí y no en cada rama, así que sigue
//    habiendo un solo contador por isolate, igual que cuando todo estaba en `index.ts`.

import { urlPublica } from "../_shared/url-publica.ts";

// Sin tipos generados de la base (misma nota que `registro/index.ts`).
// deno-lint-ignore no-explicit-any
export type Cliente = any;

export const BUCKET = "documentos";
export const SEGUNDOS_FIRMA = 60;
export const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Anti-abuso — copiado de `registro/index.ts`, con los topes de la fase 3
// ---------------------------------------------------------------------------
// Mismos tres frenos y las mismas limitaciones, que conviene no olvidar:
//   · honeypot `web`: si viene relleno se responde 200 falso y no se escribe nada
//   · límite por IP EN MEMORIA: best-effort de verdad — el isolate se recicla y hay
//     varios a la vez, así que ni es global ni sobrevive a un arranque en frío
//   · freno DURABLE sobre `evidencias`: ≥ 50 en la última hora corta en seco. Ese sí
//     vive en la base y no depende de qué isolate atienda la petición
//
// Lo que de verdad hace inviable enumerar enlaces no es ninguno de los tres: es que el
// token son 256 bits. Los frenos están para el ruido y para no pagar consultas.
const FINESTRA_MS = 10 * 60 * 1000;
const MAX_PER_IP = 10;
export const MAX_EVIDENCIES_HORA = 50;

const intentsPerIp = new Map<string, number[]>();

export function massaIntentsIp(ip: string): boolean {
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

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export async function sha256Hex(texto: string): Promise<string> {
  const resumen = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(resumen))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function ipDe(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
}

export function textNet(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function numeroOpcional(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export interface Enlace {
  id: string;
  proposito: string;
  objeto_tipo: string;
  objeto_id: string;
  destinatario_email: string | null;
  destinatario_nombre: string | null;
  canal: string;
  caduca_at: string;
  /** Fase 2: el segundo factor de la firma asistida. `resolver_enlace` NO da el hash. */
  codigo_caduca_at: string | null;
  tiene_codigo: boolean | null;
  abierto_at: string | null;
  usado_at: string | null;
  estado: string;
  estado_efectivo: string;
}

/** Hashea el token y pregunta a la base. `null` = ese token no existe. */
export async function resolver(supabase: Cliente, token: string): Promise<Enlace | null> {
  const hash = await sha256Hex(token);
  const { data, error } = await supabase.rpc("resolver_enlace", { p_token_hash: hash });
  if (error) {
    console.error("enlace-publico: resolver_enlace:", error.message);
    throw new Error(error.message);
  }
  const filas = (data ?? []) as Enlace[];
  return filas.length > 0 ? filas[0] : null;
}

/** El estado efectivo, traducido al código HTTP que le corresponde. */
export function estadoAHttp(estado: string): { status: number; code: string; error: string } | null {
  if (estado === "caducado") {
    return { status: 410, code: "caducat", error: "Aquest enllaç ha caducat." };
  }
  if (estado === "usado") {
    return { status: 409, code: "ja_usat", error: "Aquest enllaç ja s'ha fet servir." };
  }
  if (estado === "revocado") {
    return { status: 409, code: "revocat", error: "Aquest enllaç s'ha anul·lat." };
  }
  return null;
}

export type Responder = (body: unknown, status?: number) => Response;

/** El PDF vigente del objeto, firmado 60 s. `null` si todavía no se ha generado. */
export async function urlPdf(
  supabase: Cliente,
  objetoId: string,
  objetoTipo = "albaran",
  // ⚠️ Un `cierre_donante` tiene DOS documentos vigentes a la vez (el RES y el CD), así
  //    que sin filtrar por tipo el `maybeSingle()` de abajo devolvería error en cuanto se
  //    emitiera el certificado. Un albarán solo tiene uno y no necesita el filtro.
  tipo?: string,
): Promise<string | null> {
  let consulta = supabase
    .from("documentos")
    .select("id, tipo, numero_completo, version, ruta, estado, fichero_at, vigente")
    .eq("objeto_tipo", objetoTipo)
    .eq("objeto_id", objetoId)
    .eq("vigente", true);
  if (tipo) consulta = consulta.eq("tipo", tipo);
  const { data, error } = await consulta.maybeSingle();
  if (error || !data?.ruta || !data?.fichero_at) return null;
  const { data: firma } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.ruta as string, SEGUNDOS_FIRMA);
  return firma?.signedUrl ? urlPublica(firma.signedUrl, Deno.env.get("URL_PUBLICA_STORAGE")) : null;
}

/** El fichero que llega, venga por multipart o en base64. */
export interface FicheroSubido {
  bytes: Uint8Array;
  mime: string;
  nombre: string;
}

export function decodificarBase64(
  valor: string,
  mimeDeclarado: string,
): { fichero: FicheroSubido | null; error?: string } {
  // Se admite tal cual o como data URI (`data:application/pdf;base64,…`), que es lo que
  // devuelve un `FileReader` en el navegador.
  let datos = valor;
  let mime = mimeDeclarado;
  const dataUri = valor.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
  if (dataUri) {
    mime = mime || dataUri[1];
    datos = dataUri[3];
  }
  try {
    const binario = atob(datos.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return { fichero: { bytes, mime: (mime || "").toLowerCase(), nombre: "factura" } };
  } catch {
    return { fichero: null, error: "base64_invalid" };
  }
}
