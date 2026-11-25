// Las cuentas del equipo que pueden ser RESPONSABLES de una interacción (CRM, 1.5 y proceso 1.2):
// las que tienen un rol del equipo y siguen activas, por nombre. La RPC lo vuelve a comprobar
// (`responsable_no_equip`). Lo usan el formulario de interacción y el hilo de la ficha.
//
// `usuario_roles` no tiene FK a `perfiles`: dos consultas. Nunca lanza: si falla, lista vacía.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface MembreEquip { id: string; nom: string }

export function useMembresEquip(): { membres: MembreEquip[]; nomDe: Map<string, string> } {
  const [membres, setMembres] = useState<MembreEquip[]>([])
  useEffect(() => {
    let viu = true
    void (async () => {
      try {
        const { data: rols } = await supabase.from('usuario_roles').select('user_id')
        const ids = [...new Set(((rols ?? []) as { user_id: string }[]).map((r) => r.user_id))]
        if (ids.length === 0 || !viu) return
        const { data: perfils } = await supabase.from('perfiles').select('id, nombre, email').in('id', ids).eq('activo', true)
        if (!viu) return
        setMembres(((perfils ?? []) as { id: string; nombre: string | null; email: string | null }[])
          .map((p) => ({ id: p.id, nom: p.nombre?.trim() || p.email || '—' }))
          .sort((a, b) => a.nom.localeCompare(b.nom)))
      } catch {
        // Sin lista: el responsable cae en quien escribe (la RPC pone `auth.uid()`).
      }
    })()
    return () => { viu = false }
  }, [])
  const nomDe = useMemo(() => new Map(membres.map((m) => [m.id, m.nom])), [membres])
  return { membres, nomDe }
}
