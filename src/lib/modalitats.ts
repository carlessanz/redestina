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

/**
 * Las modalidades de una oferta que una entidad PUEDE pedir.
 *
 * Dos filtros, en este orden: las que su tipo de receptor puede recibir (`compat`; `null` =
 * no se sabe, y entonces no se filtra: decide la base) y, si se pasa `potDemanar`, las que
 * además puede pedir hoy (desde la fecha de corte, solo las que tienen su convenio).
 *
 * Solo vive en el navegador, a propósito: es una ayuda de pantalla —el Mercat del receptor y
 * el interés asistido del equipo— y la autoridad sigue siendo `comprova_interes()` en la
 * base. Por eso no tiene copia en `_shared/` ni entra en el test de paridad.
 */
export function modalitatsPossibles(
  o: Pick<Excedente, 'modalitat'> & { modalitats?: Modalitat[] | null },
  compat: readonly Modalitat[] | null,
  potDemanar?: (m: Modalitat) => boolean,
): Modalitat[] {
  const ms = modalitatsOferta(o)
  const compatibles = compat ? ms.filter((m) => compat.includes(m)) : ms
  return potDemanar ? compatibles.filter(potDemanar) : compatibles
}

/**
 * Qué modalidades admite un tipo de receptor, según la matriz `modalitat_receptor_compat`
 * (§4bis). Sin tipo, ninguna: una entidad sin `tipo_receptor` no ve ninguna oferta, y la
 * base rechazaría su interés.
 */
export function modalitatsDelTipus(
  tipus: string | null | undefined,
  matriu: readonly { modalitat: string; tipo_receptor: string }[],
): Modalitat[] {
  if (!tipus) return []
  const hi = new Set(matriu.filter((f) => f.tipo_receptor === tipus).map((f) => f.modalitat))
  return MODALITATS_IDS.filter((m) => hi.has(m))
}
