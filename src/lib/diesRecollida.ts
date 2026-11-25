// Los DÍAS DE RECOGIDA de una oferta (`excedentes.dies_recollida`, ISO 1 = dilluns … 7 = diumenge)
// frente al día que elige quien la recoge. Fase 4 (25-11-2026, proceso 3.2).
//
// La base ya lo exige (`comprova_hora_recollida`, 20270618100200: `22023 dia_fora_dies` cuando una
// sesión externa pide un día de la semana que no está en la lista; el equipo no se bloquea). Aquí
// vive lo mismo en el navegador, para que el Mercat no deje elegir lo que la base va a rechazar
// (`CampsRecollida`) y para que el equipo vea el aviso antes de registrar la realidad.
//
// ⚠️ El día de la semana se calcula sobre la FECHA (`AAAA-MM-DD`) en UTC, sin pasar por la hora
//    local del navegador: un `new Date('2026-11-30')` es medianoche UTC y en un navegador al oeste
//    de Greenwich caería en domingo. La base lo calcula en Madrid sobre el instante; con un día y
//    una hora dentro de la franja, el día es el mismo.
//
// Puro: se prueba desde Vitest (`tests/diesRecollida.test.ts`).

/** Los siete días ISO, en orden. */
export const DIES_SETMANA = [1, 2, 3, 4, 5, 6, 7] as const

/** Cuántos días como mucho ofrece el selector cuando la oferta no tiene fecha de fin (u otra muy lejana). */
export const MAX_DIES_SELECTOR = 60

const DIA_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** La fecha `AAAA-MM-DD` como día UTC, o null si no es un día que exista. */
function diaUtc(s: string | null | undefined): Date | null {
  const m = DIA_RE.exec((s ?? '').slice(0, 10))
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : null
}

const textDia = (d: Date) => d.toISOString().slice(0, 10)

/** El día ISO de la semana (1 = dilluns … 7 = diumenge) de `AAAA-MM-DD`, o null. */
export function diaSetmanaIso(s: string | null | undefined): number | null {
  const d = diaUtc(s)
  if (!d) return null
  const w = d.getUTCDay()
  return w === 0 ? 7 : w
}

/** Los días válidos de la lista (1-7, sin repetir, en orden). Vacía = sin restricción. */
export function normalitzaDies(dies: readonly (number | string | null | undefined)[] | null | undefined): number[] {
  if (!dies) return []
  const set = new Set<number>()
  for (const x of dies) {
    const n = Number(x)
    if (Number.isInteger(n) && n >= 1 && n <= 7) set.add(n)
  }
  return [...set].sort((a, b) => a - b)
}

/** ¿Se puede recoger ese día? Sin lista (o vacía), cualquiera; sin fecha válida, no. */
export function diaPermes(dia: string | null | undefined, dies: readonly number[] | null | undefined): boolean {
  const llista = normalitzaDies(dies)
  if (llista.length === 0) return diaUtc(dia) !== null
  const iso = diaSetmanaIso(dia)
  return iso !== null && llista.includes(iso)
}

/** Un día del selector: la fecha, su día de la semana y si se puede elegir. */
export interface OpcioDia {
  dia: string
  diaSetmana: number
  permes: boolean
}

/**
 * Los días entre `desDe` y `finsA` (inclusivos; sin `finsA`, `MAX_DIES_SELECTOR` días), cada uno
 * con si se puede elegir. Con `finsA` anterior a `desDe`, ninguno. Nunca más de `max`.
 */
export function opcionsDies(
  desDe: string, finsA: string | null | undefined, dies: readonly number[] | null | undefined,
  max = MAX_DIES_SELECTOR,
): OpcioDia[] {
  const ini = diaUtc(desDe)
  if (!ini) return []
  const fi = diaUtc(finsA)
  const llista = normalitzaDies(dies)
  const out: OpcioDia[] = []
  for (let i = 0; i < max; i++) {
    const d = new Date(ini.getTime() + i * 86_400_000)
    if (fi && d.getTime() > fi.getTime()) break
    const w = d.getUTCDay()
    const diaSetmana = w === 0 ? 7 : w
    out.push({ dia: textDia(d), diaSetmana, permes: llista.length === 0 || llista.includes(diaSetmana) })
  }
  return out
}

// --- Lo que el LUGAR permite a la oferta (fase 4, alta de oferta) -----------------------

/** Las franjas válidas de un lugar (`productor_ubicaciones.franges`, jsonb), en el orden guardado. */
export function frangesDelLloc(v: unknown): { inici: string; fi: string }[] {
  if (!Array.isArray(v)) return []
  const out: { inici: string; fi: string }[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const f = x as { inici?: unknown; fi?: unknown }
    const inici = typeof f.inici === 'string' ? f.inici.slice(0, 5) : ''
    const fi = typeof f.fi === 'string' ? f.fi.slice(0, 5) : ''
    if (/^\d{2}:\d{2}$/.test(inici) && /^\d{2}:\d{2}$/.test(fi) && fi > inici) out.push({ inici, fi })
  }
  return out
}

/**
 * ¿La franja de la oferta cabe dentro de alguna franja del lugar? Sin franjas en el lugar, o
 * con la de la oferta a medias, no hay nada que decir (`true`).
 */
export function franjaDinsDelLloc(
  f: { inici?: string | null; fi?: string | null } | null | undefined, franges: readonly { inici: string; fi: string }[],
): boolean {
  if (franges.length === 0) return true
  const inici = (f?.inici ?? '').slice(0, 5)
  const fi = (f?.fi ?? '').slice(0, 5)
  if (!/^\d{2}:\d{2}$/.test(inici) || !/^\d{2}:\d{2}$/.test(fi) || fi <= inici) return true
  return franges.some((x) => x.inici <= inici && fi <= x.fi)
}
