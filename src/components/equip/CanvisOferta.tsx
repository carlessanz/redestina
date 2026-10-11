// «Oferta modificada per l'entitat productora» (fase 2 de la revisión del cliente del
// 08-10-2026): «si se modifica una oferta ya publicada, REDESTINA debería recibir una
// notificación para que el equipo pueda tenerlo en cuenta y, si ya había una gestión en
// curso, revisar si afecta a la canalización».
//
// Enseña los cambios sin revisar de ESTA oferta hechos por quien no es del equipo (los del
// equipo ya los sabe quien los hizo: es la misma regla que la cola `ofertes_modificades` de
// `pendents_equip()`) y deja marcarlos revisados.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { dataHora } from '../../lib/format'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import { Button } from '@/components/ui/button'

interface Canvi { id: string; user_id: string | null; abans: Record<string, unknown>; despres: Record<string, unknown>; created_at: string }

/** «12 → 20», con los vacíos dichos como tales. */
const fmt = (v: unknown) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v))

export default function CanvisOferta({ excedenteId }: { excedenteId: string }) {
  const { t } = useT()
  const [canvis, setCanvis] = useState<Canvi[]>([])
  const [desant, setDesant] = useState(false)

  const carrega = useCallback(async () => {
    const { data } = await supabase.from('excedentes_canvis')
      .select('id, user_id, abans, despres, created_at, revisat_at')
      .eq('excedente_id', excedenteId).is('revisat_at', null)
      .order('created_at', { ascending: false })
    const files = (data ?? []) as Canvi[]
    // Los del equipo no cuentan (la RLS de `usuario_roles` deja al equipo leerlas todas).
    const users = [...new Set(files.map((f) => f.user_id).filter((u): u is string => !!u))]
    const { data: rols } = users.length
      ? await supabase.from('usuario_roles').select('user_id').in('user_id', users)
      : { data: [] as { user_id: string }[] }
    const equip = new Set((rols ?? []).map((r) => r.user_id))
    setCanvis(files.filter((f) => !f.user_id || !equip.has(f.user_id)))
  }, [excedenteId])

  useEffect(() => { void carrega() }, [carrega])

  if (canvis.length === 0) return null

  async function revisat() {
    setDesant(true)
    const { error } = await supabase.rpc('marcar_canvis_revisats', { p_excedente: excedenteId })
    setDesant(false)
    if (error) { toast.error(t('c.error')); return }
    toast.success(t('canvis.ok'))
    void refrescaComptadors()
    await carrega()
  }

  return (
    <div className="space-y-2 rounded-lg border border-aviso/30 bg-aviso-fondo p-3 text-sm">
      <p className="font-medium text-aviso">{t('canvis.titol')}</p>
      <ul className="space-y-1">
        {canvis.map((c) => (
          <li key={c.id}>
            <span className="text-muted-foreground">{dataHora(c.created_at)}: </span>
            {Object.keys(c.despres).map((k) => `${t(`canvis.camp_${k}`)} ${fmt(c.abans[k])} → ${fmt(c.despres[k])}`).join(' · ')}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{t('canvis.hint')}</p>
      <Button size="sm" variant="outline" className="h-11 md:h-8" disabled={desant} onClick={() => void revisat()}>
        {t('canvis.revisat')}
      </Button>
    </div>
  )
}
