// La recogida programada (05-10-2026, rebanada 3).
//
//   POST /recollides-programades  {}   cabecera: x-documentos-secret
//
// La llama pg_cron cada 15 minutos (`disparar_recollides_programades()`), así que va sin
// JWT y con el secreto compartido de los documentos. Hace dos cosas y las dos en la base:
//
//   1. `programar_albarans_recollida()`: emite y marca entregados los albaranes cuya hora de
//      recogida ha llegado (D3). Devuelve los enlaces de confirmación EN CLARO —es la única
//      vez que existen— y aquí se mandan por correo a cada parte.
//   2. `recordar_confirmacions_recollida()`: a las 4 h, si el enlace sigue sin usar, lo
//      renueva y se vuelve a mandar (el del primer correo deja de valer, y se dice).
//
// Gates de §8, como cualquier envío: con el modo test activo solo correos de fichas
// `es_test`, y la lista `email_test_recipients` si tiene filas. Un correo que no sale no
// deshace nada: el albarán está entregado y el enlace se puede reenviar desde el panel.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { bustiaEquip, enLlistaCorreuTest, esEmailTest, modoTestActivo } from "../_shared/gate.ts";
import { appUrl, escaparHtml, plantillaEmail, sendEmail } from "../_shared/resend.ts";
import { textConfirmacioRecollida } from "../_shared/textAvis.ts";
import { exigirSecreto, json } from "../_shared/http.ts";
import { canalsActius, esTelefonoTest, whatsappActivo } from "../_shared/gate.ts";
import { ventanaAbierta } from "../_shared/canal.ts";
import { enviaPreguntaConfirmacio } from "../_shared/confirmacionsWhatsapp.ts";
import type { ClienteSupabase } from "../_shared/cliente.ts";

interface Enllac {
  id: string; destinatari: string | null; nom: string | null; rol_part: string | null; token: string | null;
  /** 11-10-2026: una parte sin correo y con móvil recibe el enlace por WhatsApp. */
  canal?: string | null; telefon?: string | null;
}

interface Programat {
  albaran_id: string; tipo?: string; numero?: string | null; idioma?: string | null;
  reenviament?: boolean; enllacos?: Enllac[]; error?: string;
}

/**
 * Las preguntas con botones a las partes que solo tienen móvil (11-10-2026). Se recorren los
 * enlaces de WhatsApp vivos que todavía no la han recibido, vengan del job o de un «Marca
 * entregat» del panel. Fuera de la ventana de 24 h Meta solo entrega plantillas aprobadas, y
 * la de confirmación todavía no lo está (`plantillas-meta.md §4`): entonces no se manda, se
 * vuelve a intentar en la pasada siguiente y, mientras tanto, el equipo tiene «Confirma la
 * recollida», que es la vía asistida.
 */
async function preguntesWhatsapp(supabase: ClienteSupabase, testMode: boolean): Promise<{ enviats: number; saltats: number }> {
  let enviats = 0;
  let saltats = 0;
  if (!(await whatsappActivo(supabase))) return { enviats, saltats };
  const { data, error } = await supabase.from("enlaces_token")
    .select("id, objeto_id, rol_parte, destinatario_telefono")
    .eq("canal", "whatsapp").eq("estado", "activo").is("usado_at", null).is("wa_preguntat_at", null)
    .gt("caduca_at", new Date().toISOString()).limit(50);
  if (error) { console.error("preguntes whatsapp:", error.message); return { enviats, saltats } }
  for (const e of (data ?? []) as { id: string; objeto_id: string; rol_parte: string | null; destinatario_telefono: string | null }[]) {
    const tel = e.destinatario_telefono;
    if (!tel || (testMode && !(await esTelefonoTest(supabase, tel)))) { saltats++; continue }
    const { data: ct } = await supabase.from("wa_contacts").select("last_inbound_at").eq("phone", tel).maybeSingle();
    if (!ventanaAbierta((ct as { last_inbound_at: string | null } | null)?.last_inbound_at)) { saltats++; continue }
    const [{ data: alb }, { data: ls }] = await Promise.all([
      supabase.from("albaranes").select("numero_completo").eq("id", e.objeto_id).maybeSingle(),
      supabase.from("albaran_lineas").select("producto, kg_neto, kg_previstos").eq("albaran_id", e.objeto_id),
    ]);
    const linies = (ls ?? []) as { producto: string | null; kg_neto: number | null; kg_previstos: number | null }[];
    const kg = linies.reduce((a, l) => a + Number(l.kg_neto ?? l.kg_previstos ?? 0), 0);
    const r = await enviaPreguntaConfirmacio(supabase, tel, e.id, {
      numero: (alb as { numero_completo: string | null } | null)?.numero_completo ?? null,
      rol: e.rol_parte,
      producte: [...new Set(linies.map((l) => l.producto).filter(Boolean))].join(", ") || null,
      kg: kg || null,
    });
    if (r.ok) {
      enviats++;
      await supabase.from("enlaces_token").update({ wa_preguntat_at: new Date().toISOString() }).eq("id", e.id);
    } else saltats++;
  }
  return { enviats, saltats };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const rechazo = exigirSecreto(req, "x-documentos-secret", Deno.env.get("DOCUMENTOS_SECRET"));
  if (rechazo) return rechazo;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SECRET_KEY")!);

  // Con el correo apagado (§8) NO se renuevan los tokens: `recordar_confirmacions_recollida`
  // deja muerto el enlace anterior y devuelve el nuevo para mandarlo, y sin correo ese nuevo
  // no llegaría a nadie. Se renovará en la primera pasada con el correo encendido.
  const canals = await canalsActius(supabase);
  const [prog, rec] = await Promise.all([
    supabase.rpc("programar_albarans_recollida"),
    canals.email
      ? supabase.rpc("recordar_confirmacions_recollida")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (prog.error) console.error("programar_albarans_recollida:", prog.error.message);
  if (rec.error) console.error("recordar_confirmacions_recollida:", rec.error.message);

  const llista: Programat[] = [
    ...((prog.data ?? []) as Programat[]),
    ...((rec.data ?? []) as Programat[]),
  ];
  const testMode = await modoTestActivo(supabase);
  const replyTo = await bustiaEquip(supabase);
  let enviats = 0;
  let saltats = 0;
  const errors = llista.filter((p) => p.error).map((p) => ({ albaran_id: p.albaran_id, error: p.error }));

  for (const p of llista) {
    for (const e of p.enllacos ?? []) {
      // Los de WhatsApp los recoge `preguntesWhatsapp()`, abajo, con todos los demás.
      if (e.canal === "whatsapp") continue;
      if (!e.destinatari || !e.token) { saltats++; continue; }
      if (testMode && !(await esEmailTest(supabase, e.destinatari))) { saltats++; continue; }
      if (!(await enLlistaCorreuTest(supabase, e.destinatari))) { saltats++; continue; }
      const idioma = p.idioma === "es" ? "es" : "ca";
      const enllac = `${appUrl()}/confirmar/${e.token}`;
      const t = textConfirmacioRecollida(p.numero ?? "", idioma, p.reenviament === true);
      const r = await sendEmail(
        {
          to: e.destinatari,
          subject: t.asunto,
          html: plantillaEmail({
            titulo: t.titulo,
            cuerpoHtml: t.cuerpo.split("\n").map((l) => `<p style="margin:0 0 12px">${escaparHtml(l)}</p>`).join(""),
            preheader: t.cuerpo.split("\n")[0],
            boton: { texto: t.boton, url: enllac },
            nota: t.nota,
            idioma,
          }),
          text: `${t.cuerpo}\n\n${enllac}`,
          replyTo,
        },
        { supabase, proposito: "confirmacio_albara", objetoTipo: "albaran", objetoId: p.albaran_id, funcion: "recollides-programades" },
      );
      if (r.ok) enviats++; else saltats++;
    }
  }
  const wa = await preguntesWhatsapp(supabase, testMode);
  return json({ ok: true, albarans: llista.length, enviats, saltats, whatsapp: wa, errors });
});
