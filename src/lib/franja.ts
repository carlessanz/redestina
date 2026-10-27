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

/** Un instante ISO como valor de `<input type="datetime-local">`, en hora local (rebanada 3). */
export function localDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Las horas por cuartos dentro de la franja de una oferta (o de 06:00 a 22:45 si no tiene).
 * Es lo que ofrece el desplegable de la hora de recogida, en el Mercat y en el interés
 * asistido del equipo: las dos pantallas tienen que ofrecer las mismas horas, porque la base
 * (`comprova_hora_recollida`) rechaza las que caen fuera de la franja.
 */
export function horesDins(inici: string | null | undefined, fi: string | null | undefined): string[] {
  const a = hhmm(inici) || '06:00'
  const b = hhmm(fi) || '22:45'
  return HORES.flatMap((h) => QUARTS.map((q) => `${h}:${q}`)).filter((x) => x >= a && x <= b)
}

/**
 * El instante de recogida a partir del día (`aaaa-mm-dd`) y la hora (`hh:mm`) que se eligen
 * en pantalla, en hora LOCAL del navegador y como ISO. Sin los dos, `null` (no se dice).
 * Es exactamente lo que el Mercat componía a mano: si cambiara aquí, el receptor y el equipo
 * guardarían la misma hora con un desfase.
 */
export function isoRecollida(dia: string, hora: string): string | null {
  if (!dia || !hora) return null
  const d = new Date(`${dia}T${hora}:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
