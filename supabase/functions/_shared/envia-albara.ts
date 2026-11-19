// Mandar un ALBARÁN por correo a sus partes, con el PDF adjunto. Lo usan DOS funciones y por eso
// vive aquí (19-11-2026, fase 5 de los puntos 4-6; antes estaba dentro de `enviar-albara`):
//
// · `enviar-albara`: el botón «Envia per correu» (MANUAL, §8: puede saltarse los interruptores si
//   quien pulsa lo acepta; el modo test, nunca).
// · `generar-documento`: AUTOMÁTICO, en cuanto existe por primera vez el PDF conciliado del ENT o
//   del REC de una recogida que DECLARÓ LA ENTIDAD y validó el equipo (nivel 2, Excel 6.5). Ver
//   `enviaAlbaraRecollidaValidada()`. Con los interruptores apagados no sale.
//
// Tenerlo en un solo sitio es lo que garantiza que el envío automático y el manual pasan por las
// MISMAS barreras (como `envia-document.ts` para el resto de documentos):
//   · documento de PRUEBA → `destinatariosPrueba()`: solo fichas `es_test` y el buzón del equipo,
//     esté como esté el modo test global (§8);
//   · la lista blanca `email_test_recipients`, si tiene filas;
//   · y en `sendEmail()`, los interruptores (salvo `manual`) y el modo test.
//
// CANAL: el PDF solo puede ir por CORREO (los adjuntos por WhatsApp están fuera de alcance y un
// enlace con token no viaja por WhatsApp, §9). No se consulta `_shared/canal.ts`: la parte con
// correo lo recibe por correo; la que no tiene, no recibe nada y lo tiene en su panel
// («Documents»). `preparar_enviament_albara()` ya descarta las partes sin correo.
//
// Nunca lanza. Cada intento que llega a `sendEmail()` queda en `documento_envios`
// (`proposito = 'albara'`, `objeto_tipo = 'albaran'`, con `documento_id`).

import { copiaBustiaLocal } from "./bustiaLocal.ts";
import { composaCorreuAlbara } from "./correu-albara.ts";
import { encodeBase64, MAX_ADJUNT_BYTES } from "./envia-document.ts";
import { bustiaEquip, destinatariosPrueba, enLlistaCorreuTest } from "./gate.ts";
import { plantillaEmail, sendEmail } from "./resend.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com").replace(/\/$/, "");

/** Lo que devuelve `preparar_enviament_albara()` (solo `service_role`). */
export interface AlbaraPreparat {
  numero: string | null;
  tipo: string;
  estado: string;
  idioma: string | null;
  document: { id: string; ruta: string | null; estado: string; fichero_at: string | null; modo: string } | null;
  /** `token` solo si a esa parte le falta confirmar (albarán `entregado`): va en el correo. */
  destinataris: { rol: string; email: string; nom: string | null; token: string | null }[];
}

/** Qué pasó con el correo de una parte (el contrato de `enviar-albara`, que el panel ya pinta). */
export type ResultatPart =
  | "enviat"
  | "enviat_sense_adjunt"
  | "simulat"
  | "desactivat"
  /** Modo test (no es una ficha de prueba) o documento de prueba a quien no lo es. */
  | "no_test_user"
  | "fora_llista_test"
  | "error";

export interface EnviamentPart {
  rol: string;
  destinatari: string;
  resultat: ResultatPart;
  amb_enllac: boolean;
}

/**
 * Manda el albarán ya preparado a cada parte. `bytes` es el PDF (lo descarga quien llama, o lo
 * acaba de generar). `modo` es el del documento: decide la barrera de prueba.
 */
export async function enviaAlbaraAParts(
  supabase: Cliente,
  o: {
    albaranId: string;
    preparat: AlbaraPreparat;
    bytes: Uint8Array;
    documentoId: string;
    modo: string | null;
    funcion: string;
    manual?: boolean;
  },
): Promise<EnviamentPart[]> {
  const p = o.preparat;
  const adjunt = o.bytes.length <= MAX_ADJUNT_BYTES;
  const resultats: EnviamentPart[] = [];
  let replyTo: string | null = null;
  try {
    replyTo = await bustiaEquip(supabase);
  } catch { /* sin buzón del equipo, el correo sale sin reply_to */ }

  for (const d of p.destinataris) {
    const ambEnllac = d.token !== null;
    const res = (resultat: ResultatPart) => resultats.push({ rol: d.rol, destinatari: d.email, resultat, amb_enllac: ambEnllac });
    try {
      // 🔴 Un documento de PRUEBA solo a fichas de prueba o al buzón del equipo (§8), aunque el
      //    modo test esté apagado. `sendEmail()` solo mira el modo test global.
      if (o.modo === "prueba") {
        const r = await destinatariosPrueba(supabase, { id: o.documentoId, modo: "prueba" }, [d.email]);
        if (r.permitidos.length === 0) { res("no_test_user"); continue; }
      }
      if (!(await enLlistaCorreuTest(supabase, d.email))) { res("fora_llista_test"); continue; }

      const c = composaCorreuAlbara({
        tipo: p.tipo, numero: p.numero, idioma: p.idioma, rol: d.rol, nom: d.nom,
        urlConfirmar: d.token ? `${APP_URL}/confirmar/${d.token}` : null,
        urlPanell: `${APP_URL}/login`,
      });
      const html = plantillaEmail({
        titulo: c.titol, preheader: c.preheader, cuerpoHtml: c.cosHtml,
        boton: c.boto, nota: c.nota, idioma: c.idioma,
      });
      const attachments = adjunt ? [{ filename: c.fitxer, content: encodeBase64(o.bytes) }] : undefined;
      const r = await sendEmail({
        to: d.email,
        subject: c.assumpte,
        html,
        replyTo,
        ...(attachments ? { attachments } : {}),
      }, {
        supabase, proposito: "albara", documentoId: o.documentoId,
        objetoTipo: "albaran", objetoId: o.albaranId, funcion: o.funcion,
      }, { manual: o.manual === true });
      // En el clon, el correo simulado se copia a Mailpit (solo con `MAILPIT_URL`).
      if (r.simulado) await copiaBustiaLocal({ to: d.email, subject: c.assumpte, html, attachments });
      const tall = (r.data as { code?: string } | null)?.code;
      res(r.desactivado
        ? (tall === "no_test_user" ? "no_test_user" : "desactivat")
        : !r.ok ? "error" : r.simulado ? "simulat" : adjunt ? "enviat" : "enviat_sense_adjunt");
    } catch (e) {
      console.error(`${o.funcion}: correu de l'albarà:`, o.albaranId, d.rol, e instanceof Error ? e.message : String(e));
      res("error");
    }
  }
  return resultats;
}

/** Lo que el log de `generar-documento` apunta del envío automático. */
export type ResultatAutomatic =
  | { enviat: false; motiu: string }
  | { enviat: true; parts: string[] };

/** Lo que hace falta de la fila de `documentos` que se acaba de generar. */
export interface DocumentGenerat {
  id: string;
  tipo: string;
  subtipo: string | null;
  objeto_tipo: string;
  objeto_id: string;
  version: number;
  modo: string;
}

/**
 * EL ENVÍO AUTOMÁTICO tras validar una recogida declarada por la entidad (nivel 2, Excel 6.5).
 *
 * `validar_recollida()` emite y concilia el ENT y el REC de la recogida en un acto, y cada albarán
 * deja DOS filas en `documentos` en la misma transacción: la versión `emes` (que queda no vigente)
 * y la `conciliat` (la vigente, la definitiva). Se manda **solo la `conciliat`** y solo si es la
 * primera de ese albarán: una regeneración (`regenerar_documents_fundacio`, versión n+1 con el
 * mismo subtipo), una rectificación (`R-*`) o una versión firmada (`signat`) no vuelven a salir.
 *
 * Solo sale si, además:
 *   · el albarán es de una RECOGIDA (`canalizacion_id`): ni el REC heredado de la oferta ni el de
 *     una espigolada;
 *   · `canalizaciones.recollida_origen = 'entitat_receptora'` (en nivel 1 —la registró el equipo—
 *     lo comparte el super_admin a mano) y la recogida está validada;
 *   · el albarán está `confirmado` o `conciliado`: así `preparar_enviament_albara()` no acuña
 *     ningún enlace de confirmación (solo lo hace con `entregado`);
 *   · no hay ya un envío automático de ese albarán en `documento_envios` (reintentos).
 *
 * Nunca lanza: devuelve qué pasó, para el log. Un fallo de correo no toca el documento.
 */
export async function enviaAlbaraRecollidaValidada(
  supabase: Cliente,
  doc: DocumentGenerat,
  bytes: Uint8Array,
  funcion: string,
): Promise<ResultatAutomatic> {
  const no = (motiu: string): ResultatAutomatic => ({ enviat: false, motiu });
  try {
    if (doc.objeto_tipo !== "albaran" || (doc.tipo !== "ENT" && doc.tipo !== "REC")) return no("no_s_envia");
    if (doc.subtipo !== "conciliat") return no("no_conciliat");

    // ¿Es la PRIMERA versión conciliada y la vigente?
    const { data: versions, error: errVer } = await supabase
      .from("documentos")
      .select("id, version, subtipo, vigente")
      .eq("objeto_tipo", "albaran").eq("objeto_id", doc.objeto_id).eq("tipo", doc.tipo);
    if (errVer) return no(`error_bd:${errVer.code ?? "?"}`);
    const files = (versions ?? []) as { id: string; version: number; subtipo: string | null; vigente: boolean }[];
    if (files.some((v) => v.subtipo === "conciliat" && v.version < doc.version)) return no("regeneracio");
    if (!files.find((v) => v.id === doc.id)?.vigente) return no("no_vigent");

    const { data: alb, error: errAlb } = await supabase
      .from("albaranes").select("id, canalizacion_id").eq("id", doc.objeto_id).maybeSingle();
    if (errAlb) return no(`error_bd:${errAlb.code ?? "?"}`);
    const canalizacionId = (alb as { canalizacion_id: string | null } | null)?.canalizacion_id ?? null;
    if (!canalizacionId) return no("sense_recollida");

    const { data: recollida, error: errRec } = await supabase.rpc("albarans_recollida", { p_canalizacion: canalizacionId });
    if (errRec) return no(`error_bd:${errRec.code ?? "?"}`);
    const fila = ((recollida ?? []) as {
      albaran_id: string; estado: string; recollida_origen: string | null; recollida_validada_at: string | null;
    }[]).find((r) => r.albaran_id === doc.objeto_id);
    if (!fila) return no("no_emes");
    if (fila.recollida_origen !== "entitat_receptora") return no(`origen_${fila.recollida_origen ?? "desconegut"}`);
    if (!fila.recollida_validada_at) return no("no_validada");
    if (fila.estado !== "confirmado" && fila.estado !== "conciliado") return no(`estat_${fila.estado}`);

    // Un reintento (pg_net + el job) no lo vuelve a mandar.
    const { count, error: errCount } = await supabase
      .from("documento_envios")
      .select("id", { count: "exact", head: true })
      .eq("objeto_tipo", "albaran").eq("objeto_id", doc.objeto_id)
      .eq("proposito", "albara").eq("funcion", funcion);
    if (errCount) return no(`error_bd:${errCount.code ?? "?"}`);
    if ((count ?? 0) > 0) return no("ja_enviat");

    const { data, error } = await supabase.rpc("preparar_enviament_albara", { p_albaran: doc.objeto_id, p_per: null });
    if (error) return no(`preparar:${(error.message ?? "").trim().slice(0, 60)}`);
    const p = data as AlbaraPreparat;
    if (!p?.destinataris?.length) return no("sense_correu");

    const parts = await enviaAlbaraAParts(supabase, {
      albaranId: doc.objeto_id, preparat: p, bytes, documentoId: doc.id, modo: doc.modo, funcion,
    });
    return { enviat: true, parts: parts.map((x) => `${x.rol}:${x.resultat}`) };
  } catch (e) {
    console.error(`${funcion}: enviament automàtic de l'albarà:`, doc.id, e instanceof Error ? e.message : String(e));
    return no("error");
  }
}
