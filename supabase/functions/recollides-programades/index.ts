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

interface Enllac { id: string; destinatari: string | null; nom: string | null; rol_part: string | null; token: string }
interface Programat {
  albaran_id: string; tipo?: string; numero?: string | null; idioma?: string | null;
  reenviament?: boolean; enllacos?: Enllac[]; error?: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const rechazo = exigirSecreto(req, "x-documentos-secret", Deno.env.get("DOCUMENTOS_SECRET"));
  if (rechazo) return rechazo;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SECRET_KEY")!);

  const [prog, rec] = await Promise.all([
    supabase.rpc("programar_albarans_recollida"),
    supabase.rpc("recordar_confirmacions_recollida"),
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
      if (!e.destinatari) { saltats++; continue; }
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
  return json({ ok: true, albarans: llista.length, enviats, saltats, errors });
});
