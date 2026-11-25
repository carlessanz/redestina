// Una DISPONIBILIDAD multiproducto vista desde el panel (plan DIC 26, fase 6a, proceso 3.3).
// PURO, con test (`tests/disponibilitatPanell.test.ts`); la lectura vive en
// `hooks/useDisponibilitat.ts`.
//
// Cada producto sigue siendo UNA oferta (`excedentes`, su `E-…`); la disponibilidad
// (`disponibilitats`, código `D-…`) solo las agrupa. El panel la usa para tres cosas: el
// distintivo del listado («Multiproducte · 3»), el bloque de las hermanas en el detalle y el
// MENSAJE ÚNICO (`textDisponibilitat()` de `_shared/textOferta.ts`, importado y no copiado, §7),
// que se comparte y se envía a cada entidad UNA vez con un solo enlace al Mercat.

import {
  correuDisponibilitat, textDisponibilitat, type ContextTextDisponibilitat,
} from '../../supabase/functions/_shared/textOferta.ts'
import type { EstadoExcedente } from '../types'

/**
 * Las columnas de las ofertas del grupo: lo que pide el texto único y lo que enseña el bloque.
 * ⚠️ En UN literal (§7).
 */
export const COLUMNES_GRUP = 'id, id_excedente, estado, producto, variedad, kg_total, num_caixes, format_entrega, retorn_envasos, retorn_envasos_detall, retorn_envasos_quantitat, modalitat, modalitats, preu_minim, producte_al_camp, espigolada_demanada, gmaps_url, disponible_hasta, dies_recollida, horari_recollida, causa, subcausa_codigo, observacions, ubicacion_id, productor_id, created_at'

/** Una oferta del grupo, con las columnas de `COLUMNES_GRUP`. */
export interface OfertaGrup {
  id: string
  id_excedente: string | null
  estado: EstadoExcedente
  producto: string | null
  variedad: string | null
  kg_total: number | null
  num_caixes: number | null
  format_entrega: string | null
  retorn_envasos: string | null
  retorn_envasos_detall: string | null
  retorn_envasos_quantitat: number | null
  modalitat: string | null
  modalitats: string[] | null
  preu_minim: number | null
  producte_al_camp: boolean | null
  espigolada_demanada: boolean | null
  gmaps_url: string | null
  disponible_hasta: string | null
  dies_recollida: number[] | null
  horari_recollida: string | null
  causa: string | null
  subcausa_codigo: string | null
  observacions: string | null
  ubicacion_id: string | null
  productor_id: string | null
  created_at: string
}

/** Las que circulan: a una entidad solo se le puede ofrecer lo que admite interés. */
export function esOberta(estado: string | null | undefined): boolean {
  return estado === 'publicada' || estado === 'parcial'
}

/**
 * En el orden del servidor (`ofertes_disponibilitat`, `priorizar-entidades`): nacen con el mismo
 * `created_at`, así que desempata el `E-…`.
 */
export function ordenaGrup<T extends { created_at: string; id_excedente: string | null }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => a.created_at.localeCompare(b.created_at)
    || String(a.id_excedente ?? '').localeCompare(String(b.id_excedente ?? '')))
}

/** Cuántas ofertas tiene cada disponibilidad entre unas filas (para el distintivo del listado). */
export function midesGrups(files: readonly { disponibilitat_id?: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const f of files) if (f.disponibilitat_id) out[f.disponibilitat_id] = (out[f.disponibilitat_id] ?? 0) + 1
  return out
}

/**
 * Las filas del texto único: las que circulan. Con menos de dos no hay mensaje de grupo (el de
 * la oferta suelta ya dice lo mismo).
 */
export function filesDelText<T extends OfertaGrup>(files: readonly T[]): T[] {
  const obertes = ordenaGrup(files.filter((f) => esOberta(f.estado)))
  return obertes.length >= 2 ? obertes : []
}

/**
 * Lo que recibe UNA entidad: las ofertas que circulan y en las que encaja (`ofertes_encaixen`
 * de `priorizar-entidades`). Si encaja en una sola, va el grupo entero que circula: un mensaje
 * de «1 producte» con el enlace del grupo diría menos que el de la oferta suelta, y en el Mercat
 * la entidad solo verá lo que puede recibir.
 */
export function filesPerEntitat<T extends OfertaGrup>(files: readonly T[], encaixen: readonly string[]): T[] {
  const obertes = filesDelText(files)
  const seves = obertes.filter((f) => encaixen.includes(f.id))
  return seves.length >= 2 ? seves : obertes
}

/** Lo que el texto necesita del productor, el lugar y la causa (resuelto por quien llama). */
export interface ContextGrup {
  productor: { name: string | null; empresa: string | null; poblacion: string | null } | null
  lloc: { municipio: string | null; gmaps_url: string | null } | null
  /** Nombre catalán de la subcausa de la oferta (el texto va en catalán). */
  subcausa: string | null
}

/** El mismo contexto que compone `crearDisponibilitat()` en el servidor (`_shared/oferta.ts`). */
export function contextText(
  primera: OfertaGrup | undefined, c: ContextGrup, disponibilitatId: string, appUrl: string,
): ContextTextDisponibilitat {
  return {
    productor: c.productor?.empresa || c.productor?.name || '',
    municipi: c.lloc?.municipio ?? c.productor?.poblacion ?? '',
    mapsLloc: c.lloc?.gmaps_url ?? null,
    causa: primera?.causa ?? null,
    subcausa: c.subcausa,
    disponibilitatId,
    appUrl,
  }
}

/** El mensaje único para copiar o compartir; null si no circulan al menos dos ofertas. */
export function textDelGrup(files: readonly OfertaGrup[], ctx: ContextTextDisponibilitat): string | null {
  const f = filesDelText(files)
  return f.length > 0 ? textDisponibilitat(f as unknown as Record<string, unknown>[], ctx) : null
}

/** El texto y el correo de lo que se manda a una entidad concreta. */
export function missatgeEntitat(
  files: readonly OfertaGrup[], encaixen: readonly string[], ctx: ContextTextDisponibilitat,
): { files: OfertaGrup[]; text: string; correu: ReturnType<typeof correuDisponibilitat> } | null {
  const f = filesPerEntitat(files, encaixen)
  if (f.length === 0) return null
  const rows = f as unknown as Record<string, unknown>[]
  return { files: f, text: textDisponibilitat(rows, ctx), correu: correuDisponibilitat(rows, ctx) }
}

/**
 * Por dónde sale el mensaje del grupo a una entidad, según lo que dice el servidor del ranking
 * (`canal`, §8bis) y los interruptores (§8). 🔴 El mensaje del grupo es TEXTO: no hay plantilla
 * de Meta (checkpoint de negocio), así que WhatsApp solo vale con la ventana de 24 h abierta;
 * si `whatsapp-send` contesta `window_closed`, se cae al correo (`alternativa`).
 */
export function canalsGrup(
  ent: { canal: string; telefono: string | null; email: string | null; email_possible: boolean },
  canals: { email: boolean; whatsapp: boolean },
): { primer: 'whatsapp' | 'email' | null; alternativa: 'email' | null } {
  const correu = canals.email && ent.email_possible && Boolean(ent.email)
  if (ent.canal === 'whatsapp' && canals.whatsapp && ent.telefono) {
    return { primer: 'whatsapp', alternativa: correu ? 'email' : null }
  }
  return { primer: correu ? 'email' : null, alternativa: null }
}

/**
 * Cuántos productos lleva un ESBORRANY multiproducto (`dades_esborrany.productes`). Mientras es
 * esborrany el grupo todavía no existe (una sola fila, sin `disponibilitat_id`): esto deja marcarlo
 * igual en la lista. 0 si no es de grupo.
 */
export function productesEsborrany(dades: unknown): number {
  if (!dades || typeof dades !== 'object' || Array.isArray(dades)) return 0
  const p = (dades as { productes?: unknown }).productes
  return Array.isArray(p) && p.length >= 2 ? p.length : 0
}

/** El tamaño del grupo de una fila del listado: el de su disponibilidad o el de su esborrany. */
export function midaGrupDeFila(
  o: { disponibilitat_id?: string | null; estado: string; dades_esborrany?: unknown },
  mides: Record<string, number>,
): number {
  if (o.disponibilitat_id) return mides[o.disponibilitat_id] ?? 2
  return o.estado === 'esborrany' ? productesEsborrany(o.dades_esborrany) : 0
}
