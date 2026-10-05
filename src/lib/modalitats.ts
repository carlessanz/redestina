// Las modalidades de una oferta, en el navegador. COPIA de `supabase/functions/_shared/
// modalitats.ts` (el bundle no importa Deno): mismo vocabulario y mismo orden canónico.
// `tests/modalitats.test.ts` comprueba que las dos copias dicen lo mismo.

import type { Excedente, Modalitat } from '../types'

export const MODALITATS_IDS: readonly Modalitat[] = ['donacio', 'venda', 'maquila']

export function esModalitat(v: unknown): v is Modalitat {
  return typeof v === 'string' && (MODALITATS_IDS as readonly string[]).includes(v)
}

/** Lo que llegue (lista, una, «totes»), como lista ordenada y sin repetidos. */
export function modalitatsDe(valor: unknown): Modalitat[] {
  if (valor === 'totes') return [...MODALITATS_IDS]
  const crus: unknown[] = Array.isArray(valor) ? valor : valor == null || valor === '' ? [] : [valor]
  const hi = new Set(crus.map((v) => String(v).trim().toLowerCase()))
  if (hi.has('totes')) return [...MODALITATS_IDS]
  return MODALITATS_IDS.filter((m) => hi.has(m))
}

/** Las de una oferta: la lista si la trae, si no la única de siempre. */
export function modalitatsOferta(o: Pick<Excedente, 'modalitat'> & { modalitats?: Modalitat[] | null }): Modalitat[] {
  return modalitatsDe(o.modalitats && o.modalitats.length > 0 ? o.modalitats : o.modalitat)
}

/** ¿Alguna con precio (venda o maquila)? */
export function ambPreu(ms: readonly Modalitat[]): boolean {
  return ms.includes('venda') || ms.includes('maquila')
}

/**
 * Las modalidades en palabras: «Donació», «Donació o venda». `t` traduce cada una con su
 * clave `od.mod_*`, y el conector sale de `conn` («o» / «o»). La primera va con mayúscula y
 * las demás en minúscula, como se escribe.
 */
export function textModalitats(ms: readonly Modalitat[], t: (k: string) => string): string {
  const noms = ms.map((m, i) => {
    const n = t(`od.mod_${m}`)
    return i === 0 ? n : n.toLowerCase()
  })
  if (noms.length <= 1) return noms[0] ?? ''
  return `${noms.slice(0, -1).join(', ')} ${t('mod.o')} ${noms[noms.length - 1]}`
}
