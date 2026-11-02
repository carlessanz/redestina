// La ficha de la organización: el catálogo de actividades, las personas de contacto y el
// otro papel (fase 7 de la revisión del 08-10-2026). Mismo contrato que el resto de `lib/`:
// nunca lanza.

import { supabase } from './supabase'

export interface TipusActivitat { codi: string; nom_ca: string; nom_es: string; aplica: 'productor' | 'entidad' | 'ambdos'; ordre: number }

let catalegActivitats: Promise<TipusActivitat[]> | null = null

/** El catálogo, una vez por sesión. Si falla, la próxima llamada lo vuelve a pedir. */
export function carregaTipusActivitat(): Promise<TipusActivitat[]> {
  if (!catalegActivitats) {
    catalegActivitats = (async () => {
      const { data, error } = await supabase.from('tipus_activitat').select('codi, nom_ca, nom_es, aplica, ordre').order('ordre')
      if (error) { catalegActivitats = null; return [] }
      return (data ?? []) as TipusActivitat[]
    })()
  }
  return catalegActivitats
}

/** Las que aplican a un papel. */
export function activitatsPerPaper(cat: readonly TipusActivitat[], paper: 'productor' | 'entidad'): TipusActivitat[] {
  return cat.filter((a) => a.aplica === paper || a.aplica === 'ambdos')
}

// D3 (plan 1, 02-11-2026): un solo contacto por entidad, el de la ficha. Las «Persones de
// contacte» (`organizacion_contactos`) se retiraron de la pantalla y sus RPC ya no las puede
// ejecutar `authenticated` (20270501100000); la tabla se conserva hasta decidir P6.

/** Estrenar el otro papel: ficha hermana y membresía pendiente de validar por el equipo. */
export async function afegeixPaper(tipusActual: 'productor' | 'entidad', id: string): Promise<{ ok: boolean; missatge?: string }> {
  const { error } = await supabase.rpc('afegir_paper_organitzacio', { p_tipo_actual: tipusActual, p_id_actual: id })
  return error ? { ok: false, missatge: error.message } : { ok: true }
}
