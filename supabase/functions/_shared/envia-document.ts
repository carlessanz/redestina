// Mandar un documento emitido por correo, con el PDF adjunto (§4 «Envío de documentos por
// correo»). Lo usan DOS funciones y por eso vive aquí:
//
// · `generar-documento`, en cuanto el PDF existe por primera vez;
// · `reenviar-documento`, cuando alguien del equipo pulsa «Reenvia» (28-09-2026).
//
// Tenerlo en un solo sitio es lo que garantiza que un reenvío pasa por las MISMAS barreras
// que el envío original: con dos copias, bastaría con que una se quedara atrás para que el
// botón de reenviar fuera la forma de saltarse el modo test.
//
// Nunca lanza: devuelve un código que dice qué pasó. Cada intento que llega a Resend queda
// en `documento_envios` (`proposito = 'document'`, con `documento_id`).

import { composaCorreuDocument } from "./correu-document.ts";
import {
  bustiaEquip, destinatariosPrueba, enLlistaCorreuTest, esEmailTest, modoTestActivo,
} from "./gate.ts";
import { plantillaEmail, sendEmail } from "./resend.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com").replace(/\/$/, "");

/** El PDF adjunto no puede pasar de aquí: Resend limita el correo a 40 MB y base64 infla un 33 %. */
export const MAX_ADJUNT_BYTES = 25 * 1024 * 1024;

/** Lo que hace falta de la fila de `documentos` (con `envio`, que solo lee `service_role`). */
export interface DocumentAEnviar {
  id: string;
  tipo: string;
  subtipo: string | null;
  objeto_tipo: string;
  objeto_id: string;
  numero_completo: string | null;
  ejercicio: number | null;
  idioma: string | null;
  modo: string;
  envio: Record<string, unknown> | null;
}

/**
 * Qué pasó con el correo. `enviat*` y `simulat` son éxito; el resto dice por qué no salió.
 * · `no_s_envia`: ese tipo no va por correo (albaranes, plan) o no tiene destinatario.
 * · `bloquejat_prova`: documento de prueba a quien no es de prueba ni el buzón del equipo.
 * · `bloquejat_mode_test`: documento real con el modo test activo y ficha no `es_test`.
 * · `fora_llista_test`: la lista `email_test_recipients` tiene filas y no está en ella.
 */
export type ResultatEnviament =
  | "enviat"
  | "enviat_sense_adjunt"
  | "simulat"
  | "no_s_envia"
  | "bloquejat_prova"
  | "bloquejat_mode_test"
  | "fora_llista_test"
  | "error";

/** Base64 por trozos: `String.fromCharCode(...bytes)` de golpe revienta la pila. */
function encodeBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Manda el documento a quien dice `documentos.envio`. Las barreras, las de siempre (§8):
 * · documento de PRUEBA → `destinatariosPrueba()`: solo organizaciones `es_test` y el
 *   buzón del equipo, esté como esté el modo test global;
 * · documento REAL → con el modo test global activo, solo fichas `es_test`;
 * · y en los dos, la lista blanca `email_test_recipients` si tiene filas.
 */
export async function enviaDocument(
  supabase: Cliente,
  doc: DocumentAEnviar,
  bytes: Uint8Array,
  funcion: string,
): Promise<ResultatEnviament> {
  try {
    const c = composaCorreuDocument({
      tipo: doc.tipo,
      subtipo: doc.subtipo,
      objeto_tipo: doc.objeto_tipo,
      numero_completo: doc.numero_completo,
      ejercicio: doc.ejercicio,
      idioma: doc.idioma,
      modo: doc.modo,
      envio: doc.envio as { destinatario?: string | null; nombre?: string | null } | null,
    });
    if (!c) return "no_s_envia";

    if (doc.modo === "prueba") {
      const r = await destinatariosPrueba(supabase, doc, [c.destinatari]);
      if (r.permitidos.length === 0) return "bloquejat_prova";
    } else if ((await modoTestActivo(supabase)) && !(await esEmailTest(supabase, c.destinatari))) {
      return "bloquejat_mode_test";
    }
    if (!(await enLlistaCorreuTest(supabase, c.destinatari))) return "fora_llista_test";

    const adjunt = bytes.length <= MAX_ADJUNT_BYTES;
    const html = plantillaEmail({
      titulo: c.titol,
      preheader: c.preheader,
      cuerpoHtml: c.cosHtml,
      boton: { texto: c.boto, url: `${APP_URL}/login` },
      nota: c.nota,
      idioma: c.idioma,
    });
    const r = await sendEmail({
      to: c.destinatari,
      subject: c.assumpte,
      html,
      replyTo: await bustiaEquip(supabase),
      ...(adjunt ? { attachments: [{ filename: c.fitxer, content: encodeBase64(bytes) }] } : {}),
    }, {
      supabase,
      proposito: "document",
      documentoId: doc.id,
      objetoTipo: doc.objeto_tipo,
      objetoId: doc.objeto_id,
      funcion,
    });
    if (!r.ok) return "error";
    return r.simulado ? "simulat" : adjunt ? "enviat" : "enviat_sense_adjunt";
  } catch (e) {
    console.error(`${funcion}: correu:`, doc.id, e instanceof Error ? e.message : String(e));
    return "error";
  }
}
