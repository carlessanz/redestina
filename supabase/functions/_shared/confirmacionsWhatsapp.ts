// Confirmar un albarán por WhatsApp: la parte con red. La lógica de qué se acepta vive en
// `confirmacions.ts` (pura, con pruebas); aquí se busca el enlace, se registra la
// confirmación con `registrar_confirmacion()` —la misma función que el enlace del correo y
// el panel— y se contesta.
//
// Lo que autoriza no es un token —por WhatsApp no viaja, quedaría publicado en la consola de
// Mensajería—, sino que el botón llega desde el teléfono de la ficha al que se mandó
// (`enlaces_token.destinatario_telefono`). Es la misma confianza que ya tiene el intake.

import type { ClienteSupabase } from "./cliente.ts";
import { leerRespuesta, type MensajeEntrante } from "./intake.ts";
import { sendBotones, sendText } from "./whatsapp.ts";
import {
  BOTO_DIF, BOTO_OK, idsBotonsConfirmacio, llegirIdConfirmacio, llegirKg, TEXT_NO_ACTIVA,
  textConfirmat, textDemanaKg, textPreguntaConfirmacio,
} from "./confirmacions.ts";

interface EnllacWa {
  id: string;
  objeto_id: string;
  rol_parte: string | null;
  destinatario_nombre: string | null;
  estado: string;
  usado_at: string | null;
  caduca_at: string;
  wa_pas: string | null;
}

const COLS = "id, objeto_id, rol_parte, destinatario_nombre, estado, usado_at, caduca_at, wa_pas";

function viu(e: EnllacWa): boolean {
  return e.estado === "activo" && !e.usado_at && new Date(e.caduca_at).getTime() > Date.now();
}

async function numeroAlbara(supabase: ClienteSupabase, albaran: string): Promise<string | null> {
  const { data } = await supabase.from("albaranes").select("numero_completo").eq("id", albaran).maybeSingle();
  return (data as { numero_completo: string | null } | null)?.numero_completo ?? null;
}

async function registra(supabase: ClienteSupabase, e: EnllacWa, telefon: string, kg: number | null): Promise<string | null> {
  let kgLinies: unknown;
  if (kg == null) {
    // «Tot correcte»: cada línea con lo que ya consta (neto o previsto).
    const { data } = await supabase.from("albaran_lineas")
      .select("id, kg_neto, kg_previstos").eq("albaran_id", e.objeto_id);
    kgLinies = ((data ?? []) as { id: string; kg_neto: number | null; kg_previstos: number | null }[])
      .map((l) => ({ linea_id: l.id, kg: l.kg_neto ?? l.kg_previstos ?? 0 }));
  } else {
    const { data, error } = await supabase.rpc("repartir_kg_linies", { p_albaran: e.objeto_id, p_kg: kg });
    if (error) return error.message;
    kgLinies = data;
  }
  const { error } = await supabase.rpc("registrar_confirmacion", {
    p_enlace: e.id,
    p_payload: {
      kg_confirmados: kgLinies,
      rechazo: kg === 0 ? "total" : "cap",
      motivo_rechazo: kg === 0 ? "Sense producte (confirmat per WhatsApp)" : null,
    },
    p_evidencia: {
      nombre: e.destinatario_nombre,
      payload: { via: "whatsapp", telefon, diferencies: kg != null },
    },
  });
  return error ? error.message : null;
}

/**
 * Atiende un mensaje entrante si es una confirmación de albarán. Devuelve `true` si lo ha
 * consumido (y entonces el webhook no lo pasa ni a la respuesta de oferta ni al intake).
 */
export async function procesarConfirmacio(
  supabase: ClienteSupabase,
  from: string,
  message: MensajeEntrante,
): Promise<boolean> {
  const { texto, id } = leerRespuesta(message);
  const boto = llegirIdConfirmacio(id);

  if (boto) {
    const { data } = await supabase.from("enlaces_token").select(COLS)
      .eq("id", boto.enlace).eq("canal", "whatsapp").eq("destinatario_telefono", from)
      .eq("proposito", "confirmacion_albaran").maybeSingle();
    const e = data as EnllacWa | null;
    if (!e || !viu(e)) {
      await sendText(supabase, from, TEXT_NO_ACTIVA);
      return true;
    }
    const numero = await numeroAlbara(supabase, e.objeto_id);
    if (boto.accio === "dif") {
      await supabase.from("enlaces_token").update({ wa_pas: "kg" }).eq("id", e.id);
      await sendText(supabase, from, textDemanaKg(e.rol_parte));
      return true;
    }
    const err = await registra(supabase, e, from, null);
    if (err) {
      console.error("confirmacio whatsapp:", err);
      await sendText(supabase, from, TEXT_NO_ACTIVA);
    } else {
      await sendText(supabase, from, textConfirmat(numero, null));
    }
    return true;
  }

  // Texto libre: solo el número de kilos, y solo con UNA confirmación esperándolo.
  const kg = llegirKg(texto);
  if (kg == null) return false;
  const { data } = await supabase.from("enlaces_token").select(COLS)
    .eq("canal", "whatsapp").eq("destinatario_telefono", from)
    .eq("proposito", "confirmacion_albaran").eq("wa_pas", "kg");
  const vius = ((data ?? []) as EnllacWa[]).filter(viu);
  if (vius.length !== 1) return false;
  const e = vius[0];
  const err = await registra(supabase, e, from, kg);
  if (err) {
    console.error("confirmacio whatsapp (kg):", err);
    await sendText(supabase, from, TEXT_NO_ACTIVA);
  } else {
    await sendText(supabase, from, textConfirmat(await numeroAlbara(supabase, e.objeto_id), kg));
  }
  return true;
}

/** Manda la pregunta con los dos botones. La llama `recollides-programades`. */
export async function enviaPreguntaConfirmacio(
  supabase: ClienteSupabase,
  to: string,
  enlace: string,
  dades: { numero: string | null; rol: string | null; producte?: string | null; kg?: number | null; quan?: string | null },
) {
  const ids = idsBotonsConfirmacio(enlace);
  return await sendBotones(supabase, to, textPreguntaConfirmacio(dades), [
    { id: ids.ok, titulo: BOTO_OK },
    { id: ids.dif, titulo: BOTO_DIF },
  ]);
}
