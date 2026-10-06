// Los avisos que salen cuando el equipo aprueba un interés (reunión del 06-10-2026).
//
// Hasta hoy aprobar no avisaba a nadie: la receptora veía el cambio, en pequeño, si entraba
// en «Els meus interessos», y el productor veía el estado nuevo en «Les meves ofertes».
// Se acordó:
//
//   · a la RECEPTORA, cuántos kg se le han aprobado — y, si no son los que pidió, decirlo
//     así («de 1.000 kg sol·licitats, se n'han aprovat 500»);
//   · al PRODUCTOR, que su oferta ya tiene sortida: cuántos kg, quién viene y cuándo.
//
// ⚠️ El segundo NOMBRA a la receptora ante el productor, y es una decisión nueva de la
//    reunión: hasta ahora el productor solo veía cifras sin nombres (`progres_meves_ofertes`).
//    Va en sentido contrario a D3 (que protege al DONANTE frente al receptor), así que no la
//    rompe, pero conviene saberlo.
//
// Va por correo con `enviar-email`, que aplica los gates del modo test (§8) igual que a
// cualquier otro envío. Por WhatsApp no: fuera de la ventana de 24 h haría falta una
// plantilla aprobada que no existe (§12.2). En la plataforma lo dicen los badges y la
// pantalla de interessos. NUNCA hace fallar la aprobación: ya ha ocurrido cuando se avisa.

import { supabase } from './supabase'
import { enviarEmail } from './email'

const fmtKg = (n: number) => new Intl.NumberFormat('ca-ES', { maximumFractionDigits: 2 }).format(n)

/** «dimarts 7/10 a les 10:15», en hora de Madrid. */
export function textRecollida(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const dia = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'numeric' }).format(d)
  const hora = new Intl.DateTimeFormat('ca-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(d)
  return `${dia} a les ${hora}`
}

export interface ResultatAvisos {
  entitat: 'enviat' | 'omes' | 'error'
  productor: 'enviat' | 'omes' | 'error'
}

/**
 * Avisa a las dos partes de un interés recién aprobado. Lee lo que necesita con la sesión del
 * equipo (que lo ve todo) y nunca lanza.
 */
export async function avisaInteresAprovat(respostaId: string): Promise<ResultatAvisos> {
  const res: ResultatAvisos = { entitat: 'omes', productor: 'omes' }
  try {
    const { data: r } = await supabase
      .from('oferta_respuestas')
      .select('id, excedente_id, entidad_id, kg_solicitados, recollida_prevista, canalizacion_id')
      .eq('id', respostaId).maybeSingle()
    if (!r?.excedente_id) return res

    const [{ data: canal }, { data: exc }, { data: ent }] = await Promise.all([
      r.canalizacion_id
        ? supabase.from('canalizaciones').select('kg_confirmados, recollida_prevista').eq('id', r.canalizacion_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('excedentes').select('id, id_excedente, producto, productor_id').eq('id', r.excedente_id).maybeSingle(),
      r.entidad_id
        ? supabase.from('entidades').select('nombre, email').eq('id', r.entidad_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    if (!exc) return res
    const { data: prod } = exc.productor_id
      ? await supabase.from('productores').select('name, empresa, email').eq('id', exc.productor_id).maybeSingle()
      : { data: null }

    const aprovats = Number(canal?.kg_confirmados ?? 0)
    const demanats = Number(r.kg_solicitados ?? 0)
    const producte = exc.producto ?? ''
    const ref = exc.id_excedente ?? ''
    const quan = textRecollida(canal?.recollida_prevista ?? r.recollida_prevista)
    const appUrl = window.location.origin

    // --- A la receptora ---
    const correuEnt = (ent?.email ?? '').trim()
    if (correuEnt) {
      const kgLinia = demanats > 0 && Math.abs(demanats - aprovats) > 0.001
        ? `De ${fmtKg(demanats)} kg sol·licitats, se n'han aprovat ${fmtKg(aprovats)}.`
        : `Se t'han assignat ${fmtKg(aprovats)} kg.`
      const cos = [
        `L'equip de Redestina ha aprovat el teu interès per ${producte} (${ref}).`,
        kgLinia,
        quan ? `Recollida prevista: ${quan}.` : "L'equip et confirmarà l'hora de recollida.",
      ].join('\n\n')
      const e = await enviarEmail({
        to: correuEnt,
        subject: `Interès aprovat: ${producte} (${ref})`,
        text: cos,
        html: cos.split('\n\n').map((p) => `<p>${escapa(p)}</p>`).join(''),
        plantilla: {
          titulo: 'El teu interès s’ha aprovat',
          preheader: kgLinia,
          boton: { texto: 'Veure els meus interessos', url: `${appUrl}/receptor/interessos` },
        },
        proposito: 'avis_interes_aprovat',
        objeto_tipo: 'excedente',
        objeto_id: exc.id,
      })
      res.entitat = e.ok ? 'enviat' : 'error'
    }

    // --- Al productor ---
    const correuProd = (prod?.email ?? '').trim()
    if (correuProd) {
      const cos = [
        `Hem trobat sortida per a la teva oferta de ${producte} (${ref}).`,
        `${fmtKg(aprovats)} kg aniran a ${ent?.nombre ?? 'una entitat'}.`,
        quan ? `Vindran a recollir: ${quan}.` : "L'equip et confirmarà l'hora de recollida.",
      ].join('\n\n')
      const e = await enviarEmail({
        to: correuProd,
        subject: `La teva oferta ${ref} té sortida`,
        text: cos,
        html: cos.split('\n\n').map((p) => `<p>${escapa(p)}</p>`).join(''),
        plantilla: {
          titulo: 'La teva oferta té sortida',
          preheader: `${fmtKg(aprovats)} kg de ${producte}`,
          boton: { texto: 'Veure les meves ofertes', url: `${appUrl}/productor/ofertes` },
        },
        proposito: 'avis_sortida_productor',
        objeto_tipo: 'excedente',
        objeto_id: exc.id,
      })
      res.productor = e.ok ? 'enviat' : 'error'
    }
  } catch {
    // Best-effort: la aprobación ya está hecha.
  }
  return res
}

function escapa(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
