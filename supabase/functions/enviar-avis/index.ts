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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const esperado = Deno.env.get("DOCUMENTOS_SECRET");
  if (!esperado || req.headers.get("x-documentos-secret") !== esperado) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SECRET_KEY")!);

  let avisoId: string | null = null;
  try {
    avisoId = (await req.json())?.aviso_id ?? null;
  } catch { /* cuerpo vacío o no JSON */ }
  if (!avisoId) return json({ error: "Falta aviso_id" }, 400);

  const { data: aviso } = await supabase.from("avisos").select("*").eq("id", avisoId).maybeSingle();
  if (!aviso) return json({ error: "Avís inexistent" }, 404);
  if (aviso.enviat_at) return json({ ok: true, ja_enviat: true });
  if (!TIPUS_AVIS.includes(aviso.tipus as TipusAvis)) return json({ error: "Tipus desconegut" }, 400);

  const marca = async (canal: "email" | "whatsapp" | "cap", error: string | null) => {
    await supabase.from("avisos").update({
      canal_enviat: canal, enviat_at: new Date().toISOString(), error_envio: error,
    }).eq("id", avisoId);
  };

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

  const telefono = (tipo === "productor" ? ficha.phone : ficha.telefono) as string | null;
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
});
