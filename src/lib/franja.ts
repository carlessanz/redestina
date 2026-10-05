// La franja de recogida en el navegador (05-10-2026). Solo lo que necesita la pantalla:
// las horas y los cuartos de los desplegables y cómo se escribe. Leer texto libre es cosa
// del servidor (`supabase/functions/_shared/franja.ts`), que es quien recibe el del bot.

export interface Franja { inici: string; fi: string }

/** 06 … 22: fuera de esas horas no se recoge fruta. Si hiciera falta, se amplía aquí. */
export const HORES = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, '0'))
/** La unidad mínima es el cuarto de hora (lo confirmó la Fundació). */
export const QUARTS = ['00', '15', '30', '45']

/** «09:00:00» o «09:00» → «09:00». Vacío si no es una hora. */
export function hhmm(v: string | null | undefined): string {
  const m = (v ?? '').match(/^(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : ''
}

export function minuts(h: string): number {
  const [a, b] = h.split(':').map(Number)
  return a * 60 + b
}

/** ¿Las dos horas están y el final va después? */
export function esFranjaValida(f: Partial<Franja> | null | undefined): f is Franja {
  if (!f?.inici || !f?.fi) return false
  if (!/^\d{2}:\d{2}$/.test(f.inici) || !/^\d{2}:\d{2}$/.test(f.fi)) return false
  return minuts(f.fi) > minuts(f.inici)
}

/** «9:00–12:30». */
export function textFranja(inici: string | null | undefined, fi: string | null | undefined): string {
  const a = hhmm(inici).replace(/^0(\d)/, '$1')
  const b = hhmm(fi).replace(/^0(\d)/, '$1')
  return a && b ? `${a}–${b}` : ''
}
