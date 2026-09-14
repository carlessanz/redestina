// La confirmación por correo de una oferta registrada, en un solo sitio.
//
// POR QUÉ SE MUEVE AQUÍ (deuda §12.94). Esta función nació dentro de `crear-oferta`, que es
// el alta desde el panel, y allí resolvía el problema de que ese camino no tiene ninguna
// conversación abierta donde confirmar. El intake por WhatsApp sí la tiene, así que
// confirmaba solo por WhatsApp — y el resultado era que **la misma oferta se confirmaba de
// una manera u otra según por dónde hubiera entrado**, que es justo lo que §8bis dice que no
// debe decidir el canal.
//
// ⚠️ EL INTAKE MANDA LOS DOS, Y NO ES REDUNDANCIA POR DESCUIDO. El WhatsApp es la respuesta
// a una conversación en curso: alguien acaba de escribirte y merece contestación inmediata
// por donde escribió. El correo es otra cosa —el registro duradero y buscable de una
// referencia (`E-AAMMDD-XXX-YYY-N`) que hará falta dentro de semanas, cuando el hilo de
// WhatsApp haya bajado veinte mensajes— y además deja traza en `documento_envios` (§12.25),
// que el WhatsApp no deja. En la práctica se duplica poco: solo 78 de 345 productores tienen
// correo.
//
// NUNCA HACE FALLAR A QUIEN LA LLAMA: la oferta ya está creada y su referencia ya se ha
// dado, así que un problema de correo no puede convertirse en un error que haga pensar al
// productor que no se ha guardado nada. Devuelve qué pasó y quien llama decide si lo dice.

import { appUrl, escaparHtml, plantillaEmail, sendEmail } from "./resend.ts";
import { esEmailTest, modoTestActivo } from "./gate.ts";

export type ResultatConfirmacio = "enviat" | "simulat" | "omes" | "error";

/**
 * Confirma por correo una oferta recién registrada.
 *
 * Respeta los gates de §8 igual que cualquier otro envío: con el modo test activo solo sale
 * hacia fichas `es_test`. Sin correo en la ficha, `omes` — que es el caso mayoritario.
 */
export async function confirmarOfertaPerCorreu(
  productor: { name?: string | null; email?: string | null },
  idExcedente: string,
  excedenteId: string,
  // deno-lint-ignore no-explicit-any
  datos: any,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  /** Qué función lo manda, para que `documento_envios` diga por dónde entró la oferta. */
  funcion: string,
): Promise<ResultatConfirmacio> {
  const destino = (productor.email ?? "").trim();
  if (!destino) return "omes";
  if ((await modoTestActivo(supabase)) && !(await esEmailTest(supabase, destino))) return "omes";

  const producte = String(datos?.producte ?? datos?.familia ?? "").trim();
  const r = await sendEmail({
    to: destino,
    subject: `Oferta registrada: ${idExcedente}`,
    html: plantillaEmail({
      titulo: "Hem registrat la teva oferta",
      preheader: `Referència ${idExcedente}`,
      cuerpoHtml: `<p>Hola ${escaparHtml(productor.name ?? "")},</p>` +
        `<p>Hem registrat la teva oferta${producte ? ` de ${escaparHtml(producte)}` : ""} ` +
        `amb la referència <strong>${escaparHtml(idExcedente)}</strong>.</p>` +
        `<p>L'equip de Redestina buscarà qui la pugui aprofitar i t'avisarem quan estigui canalitzada.</p>`,
      boton: { texto: "Veure les meves ofertes", url: `${appUrl()}/productor/ofertes` },
    }),
  }, {
    supabase,
    proposito: "oferta_confirmacio",
    objetoTipo: "excedente",
    objetoId: excedenteId,
    funcion,
  });
  if (!r.ok) return "error";
  return r.simulado ? "simulat" : "enviat";
}
