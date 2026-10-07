// Envía UN aviso de la tabla `avisos` (05-10-2026, rebanada 2).
//
//   POST /enviar-avis  { aviso_id }   cabecera: x-documentos-secret
//
// La llama la base (trigger `avisos_encola_envio` al insertar, y el job `avisos-pendents`
// para reintentar) con `pg_net`, así que va con `verify_jwt = false` y el MISMO secreto
// compartido que `generar-documento` (`DOCUMENTOS_SECRET`): uno más que configurar en dos
// sitios no compraba nada.
//
// POR DÓNDE: lo decide `decidirCanal()` (§8bis) con la preferencia de la organización y el
// interruptor de WhatsApp. WhatsApp solo con la ventana de 24 h abierta —fuera de ella Meta
// exige una plantilla aprobada que todavía no existe—, y si no, correo. Los gates de §8
// mandan igual que en cualquier otro envío: con el modo test activo, solo fichas `es_test`;
// y si la lista `email_test_recipients` tiene filas, solo esos correos.
//
// El aviso EXISTE aunque no salga: está en el panel (campana y badges). Por eso un fallo
// aquí no se reintenta sin fin (el job lo deja en tres) y se apunta en `error_envio`.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { decidirCanal, ventanaAbierta } from "../_shared/canal.ts";
import { enLlistaCorreuTest, bustiaEquip, modoTestActivo, whatsappActivo } from "../_shared/gate.ts";
import { preferenciasDeCanal } from "../_shared/organizacion.ts";
import { appUrl, escaparHtml, plantillaEmail, sendEmail } from "../_shared/resend.ts";
import { sendText } from "../_shared/whatsapp.ts";
import { TIPUS_AVIS, textAvis } from "../_shared/textAvis.ts";
import type { TipusAvis } from "../_shared/textAvis.ts";
import { exigirSecreto, json } from "../_shared/http.ts";
import type { ClienteSupabase } from "../_shared/cliente.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const rechazo = exigirSecreto(req, "x-documentos-secret", Deno.env.get("DOCUMENTOS_SECRET"));
  if (rechazo) return rechazo;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SECRET_KEY")!);

  let avisoId: string | null = null;
  try {
    avisoId = (await req.json())?.aviso_id ?? null;
  } catch { /* cuerpo vacío o no JSON */ }
  if (!avisoId) return json({ error: "Falta aviso_id" }, 400);

  // RECLAMAR EL AVISO DE FORMA ATÓMICA (B3, 07-10-2026). El trigger al insertar, el job
  // de cada 15 min y un reintento de `pg_net` pueden llegar a la vez: leer `enviat_at` y
  // decidir después dejaba a dos ejecuciones pasar la misma comprobación y mandar dos
  // veces. Ahora la primera que consigue el `update … where enviat_at is null` se queda
  // el aviso (lo marca con `error_envio = 'en_curs'`); las demás no encuentran fila.
  //   · Si algo falla con una excepción, se SUELTA (vuelve `enviat_at` a null) para que el
  //     job lo reintente, igual que antes.
  //   · Si el isolate muere a medias (corte por CPU), queda `enviat_at` puesto con
  //     `canal_enviat` null y `error_envio = 'en_curs'`: no se reintenta. Es el precio
  //     elegido —un aviso sin mandar antes que uno doble—, y el aviso sigue en el panel.
  const { data: reclamat, error: errReclamar } = await supabase.from("avisos")
    .update({ enviat_at: new Date().toISOString(), canal_enviat: null, error_envio: "en_curs" })
    .eq("id", avisoId).is("enviat_at", null)
    .select("*").maybeSingle();
  if (errReclamar) return json({ error: "No s'ha pogut reclamar l'avís" }, 500);
  if (!reclamat) {
    const { data: existeix } = await supabase.from("avisos").select("id").eq("id", avisoId).maybeSingle();
    return existeix ? json({ ok: true, ja_enviat: true }) : json({ error: "Avís inexistent" }, 404);
  }
  const aviso = reclamat;

  let marcat = false;
  const marca = async (canal: "email" | "whatsapp" | "cap", error: string | null) => {
    marcat = true;
    await supabase.from("avisos").update({
      canal_enviat: canal, enviat_at: new Date().toISOString(), error_envio: error,
    }).eq("id", avisoId);
  };

  try {
    return await enviarAviso(supabase, aviso, marca);
  } catch (e) {
    const missatge = e instanceof Error ? e.message : String(e);
    console.error("enviar-avis:", missatge);
    // Soltarlo, si no se llegó a marcar: el job lo reintentará (como mucho tres veces).
    if (!marcat) {
      await supabase.from("avisos").update({ enviat_at: null, error_envio: missatge.slice(0, 200) })
        .eq("id", avisoId);
    }
    return json({ error: "Error intern" }, 500);
  }
});

type Marca = (canal: "email" | "whatsapp" | "cap", error: string | null) => Promise<void>;

/** El envío de un aviso YA reclamado. Toda salida pasa por `marca()`. */
// deno-lint-ignore no-explicit-any
async function enviarAviso(supabase: ClienteSupabase, aviso: any, marca: Marca): Promise<Response> {
  if (!TIPUS_AVIS.includes(aviso.tipus as TipusAvis)) {
    await marca("cap", "tipus_desconegut");
    return json({ error: "Tipus desconegut" }, 400);
  }

  // La ficha destinataria.
  const tipo = aviso.destinatari_tipo as "productor" | "entidad";
  const { data: ficha } = tipo === "productor"
    ? await supabase.from("productores").select("id, email, phone, es_test").eq("id", aviso.destinatari_id).maybeSingle()
    : await supabase.from("entidades").select("id, email, telefono, es_test").eq("id", aviso.destinatari_id).maybeSingle();
  if (!ficha) { await marca("cap", "fitxa_inexistent"); return json({ ok: false, motiu: "fitxa_inexistent" }); }

  // Gate de §8: con el modo test activo, solo las fichas de prueba reciben algo.
  if (await modoTestActivo(supabase) && !ficha.es_test) {
    await marca("cap", "no_test_user");
    return json({ ok: false, motiu: "no_test_user" });
  }

  // El idioma: el de la primera cuenta activa de la organización; catalán si no hay.
  const columna = tipo === "productor" ? "productor_id" : "entidad_id";
  const { data: membres } = await supabase.from("membresias")
    .select("user_id").eq(columna, ficha.id).eq("activo", true).limit(5);
  let idioma: "ca" | "es" = "ca";
  const ids = (membres ?? []).map((m: { user_id: string }) => m.user_id);
  if (ids.length > 0) {
    const { data: perfils } = await supabase.from("perfiles").select("idioma").in("id", ids);
    if ((perfils ?? []).some((p: { idioma: string | null }) => p.idioma === "es")
        && !(perfils ?? []).some((p: { idioma: string | null }) => p.idioma === "ca")) idioma = "es";
  }

  const telefono = ("phone" in ficha ? ficha.phone : ficha.telefono) as string | null;
  const { data: contacto } = telefono
    ? await supabase.from("wa_contacts").select("opt_in, last_inbound_at").eq("phone", telefono.replace(/\D/g, "")).maybeSingle()
    : { data: null };
  const prefs = await preferenciasDeCanal(supabase, tipo, [ficha.id]);
  const decision = decidirCanal({
    telefono,
    email: ficha.email,
    opt_in: contacto?.opt_in ?? false,
    last_inbound_at: contacto?.last_inbound_at ?? null,
    canal_preferido: prefs.get(ficha.id) ?? null,
    whatsapp_activo: await whatsappActivo(supabase),
  });

  const t = textAvis(aviso.tipus as TipusAvis, aviso.params ?? {}, idioma, aviso.objecte_id);
  const enllac = `${appUrl()}${t.ruta}`;

  // WhatsApp solo dentro de la ventana: fuera haría falta una plantilla aprobada.
  if (decision.canal === "whatsapp" && telefono && ventanaAbierta(contacto?.last_inbound_at ?? null)) {
    const r = await sendText(supabase, telefono.replace(/\D/g, ""), `*${t.titulo}*\n\n${t.cuerpo}\n\n${enllac}`);
    if (r.ok) { await marca("whatsapp", null); return json({ ok: true, canal: "whatsapp" }); }
    // Si falla, se intenta por correo: el aviso no se pierde por un canal.
  }

  if (ficha.email && decision.emailPosible) {
    if (!(await enLlistaCorreuTest(supabase, ficha.email))) {
      await marca("cap", "no_test_recipient");
      return json({ ok: false, motiu: "no_test_recipient" });
    }
    const html = plantillaEmail({
      titulo: t.titulo,
      cuerpoHtml: t.cuerpo.split("\n").map((l) => `<p style="margin:0 0 12px">${escaparHtml(l)}</p>`).join(""),
      preheader: t.cuerpo.split("\n")[0],
      boton: { texto: t.boton, url: enllac },
      idioma,
    });
    const r = await sendEmail(
      { to: ficha.email, subject: t.asunto, html, text: `${t.cuerpo}\n\n${enllac}`, replyTo: await bustiaEquip(supabase) },
      { supabase, proposito: "avis", objetoTipo: aviso.objecte_tipo, objetoId: aviso.objecte_id, funcion: "enviar-avis" },
    );
    await marca("email", r.ok ? null : `resend_${r.status}`);
    return json({ ok: r.ok, canal: "email", simulat: r.simulado ?? false });
  }

  await marca("cap", decision.motivo);
  return json({ ok: false, motiu: decision.motivo });
}
