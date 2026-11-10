// La Operativa del productor en LECTURA (Plan 2, A4, `20270521100000`): de la clave
// `operativa` de `diagnostic_datos()` a filas «etiqueta → texto» para el resumen del
// diagnóstico (`ResumDiagnostic`), el del equipo y el del productor.
//
// PURO (sin red ni React), con pruebas en `tests/operativaLlegible.test.ts`. Recibe la función
// de traducción y, para la actividad, los nombres del catálogo `tipus_activitat`.
//
// Solo salen las filas con algo: un resumen lleno de «—» no dice nada a quien lo lee.

import type { LlocOperativa, OperativaDiagnostic } from '../types'

type T = (clau: string, vars?: Record<string, string | number>) => string

export interface FilaOperativa {
  /** Clave i18n de la etiqueta (la misma que en la ficha). */
  clau: string
  text: string
}

const MESOS: Record<'ca' | 'es', string[]> = {
  ca: ['gen', 'feb', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'des'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
}

const llista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter((x) => x.trim() !== '') : [])
const mapa = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** «1.200» en ca/es (punto de miles, sin decimales si no hacen falta). */
function nombre(n: number, lang: 'ca' | 'es'): string {
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'ca-ES', { maximumFractionDigits: 2 }).format(n)
}

/** Meses 1–12 → «gen, feb, mar». */
export function textMesos(mesos: unknown, lang: 'ca' | 'es'): string {
  return (Array.isArray(mesos) ? mesos : [])
    .map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
    .sort((a, b) => a - b).map((m) => MESOS[lang][m - 1]).join(', ')
}

/** «dl, dc · 08:00–12:00» de un lugar (días y franjas); vacío si no hay ninguno. */
export function textDiesFranges(l: Pick<LlocOperativa, 'dies' | 'franges'>, t: T): string {
  const dies = (l.dies ?? []).filter((d) => d >= 1 && d <= 7).map((d) => t(`org.dia_${d}`)).join(', ')
  const franges = (l.franges ?? []).map((f) => `${f.inici}–${f.fi}`).join(', ')
  return [dies, franges].filter(Boolean).join(' · ')
}

export function filesOperativa(
  op: OperativaDiagnostic | null | undefined,
  t: T,
  lang: 'ca' | 'es',
  nomActivitat: (codi: string) => string = (c) => c,
): FilaOperativa[] {
  if (!op) return []
  const out: FilaOperativa[] = []
  const posa = (clau: string, text: string) => { if (text.trim() !== '') out.push({ clau, text }) }
  // Cada prefijo, escrito entero en su plantilla: así `tests/cobertura.test.ts` ve las claves.
  const opcions = (v: unknown, clau: (x: string) => string) => llista(v).map((x) => t(clau(x))).join(', ')

  posa('org.f_activitat', llista(op.activitat).map(nomActivitat).join(', '))
  posa('f.productos_habituales', llista(op.productes).join(', '))
  posa('op.f_principals', llista(op.principals).join(', '))

  const varietats = Object.entries(mapa(op.varietats))
    .map(([p, v]) => [p, llista(v).join(', ')] as const).filter(([, v]) => v !== '')
    .map(([p, v]) => `${p}: ${v}`)
  posa('op.f_varietats', varietats.join('\n'))

  const volum = Object.entries(mapa(op.volum))
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([p, v]) => `${p}: ${nombre(v as number, lang)} ${t('op.kg_any')}`)
  posa('op.f_volum', volum.join('\n'))

  const temporada = Object.entries(mapa(op.temporada))
    .map(([p, m]) => [p, textMesos(m, lang)] as const).filter(([, m]) => m !== '')
    .map(([p, m]) => `${p}: ${m}`)
  posa('op.f_temporada', temporada.join('\n'))

  posa('op.f_envasos', opcions(op.envasos, (x) => `op.env_${x}`))
  posa('op.f_canals', opcions(op.canals, (x) => `op.canal_${x}`))
  posa('op.f_clients', opcions(op.clients, (x) => `op.client_${x}`))
  if (typeof op.facturacio_eur === 'number') posa('op.f_facturacio_eur', `${nombre(op.facturacio_eur, lang)} €`)
  if (op.facturacio_rang) posa('op.f_facturacio_rang', op.facturacio_rang)
  if (typeof op.volum_comercialitzat_kg === 'number') {
    posa('op.f_volum_comercialitzat', `${nombre(op.volum_comercialitzat_kg, lang)} kg`)
  }
  posa('op.f_suport', opcions(op.suport, (x) => `op.suport_${x}`))

  // Los lugares, el principal primero (ya viene así) y marcado.
  const llocs = (op.llocs ?? []).map((l) => {
    const nom = [l.alias, l.municipi].filter(Boolean).join(' · ') || '—'
    const extra = textDiesFranges(l, t) || (l.horari ?? '')
    return `${nom}${l.principal ? ` (${t('org.place_principal')})` : ''}${extra ? ` — ${extra}` : ''}`
  })
  posa('diag.operativa_llocs', llocs.join('\n'))
  return out
}
