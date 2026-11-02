// Las notas internas del CRM mínimo (plan 1, rebanada 1F, D4): el vocabulario y los cálculos
// de la pantalla, sin React ni Supabase (prueba en `tests/notesInternes.test.ts`).
//
// La tabla es `notes_internes` (20270502100000): solo la lee el equipo, se escribe por
// `afegir_nota_interna()` y se borra por `esborrar_nota_interna()` (super_admin). 🔴 Las notas
// nunca salen por ningún canal (AGENTS §8).

/** El CHECK de `notes_internes.canal`, en el orden del desplegable. */
export const CANALS_NOTA = ['telefon', 'whatsapp', 'email', 'visita', 'reunio', 'altres'] as const
export type CanalNota = (typeof CANALS_NOTA)[number]

/** El tope de la RPC (`nota_massa_llarga`). */
export const MAX_TEXT_NOTA = 2000

/**
 * «Fa 3 dies»: la clave i18n y el número, por días de calendario LOCALES (una nota de ayer a
 * las 23:00 es «ahir» aunque solo hayan pasado dos horas). Una fecha futura —el reloj del
 * navegador adelantado— cuenta como hoy.
 */
export function faTemps(iso: string, ara: Date = new Date()): { clau: string; n: number } {
  const d = new Date(iso)
  const dia = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())
  const dies = Math.max(0, Math.round((dia(ara) - dia(d)) / 86_400_000))
  if (dies === 0) return { clau: 'ni.avui', n: 0 }
  if (dies === 1) return { clau: 'ni.ahir', n: 1 }
  if (dies < 31) return { clau: 'ni.fa_dies', n: dies }
  if (dies < 365) return { clau: 'ni.fa_mesos', n: Math.floor(dies / 30) }
  return { clau: 'ni.fa_anys', n: Math.floor(dies / 365) }
}

/**
 * Lo que se manda como `p_data` desde el campo de fecha (`AAAA-MM-DD`, hoy por defecto).
 * Hoy → `undefined`: la RPC pone `now()` y dos notas del mismo día quedan en el orden en que
 * se escribieron. Otro día → ese día a las 12:00 locales (lejos de los cambios de día por
 * zona horaria). Una fecha mal formada también cae a `now()`.
 */
export function dataPerEnviar(dia: string, avui: string): string | undefined {
  if (!dia || dia === avui || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return undefined
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(a, m - 1, d, 12, 0, 0).toISOString()
}

/** El texto se puede enviar: no vacío y dentro del tope. */
export function textValid(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && t.length <= MAX_TEXT_NOTA
}
