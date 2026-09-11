// El deshacer del enlace: separar una ficha de la organización que comparte.
//
// POR QUÉ EXISTE. `enllacar_organitzacio()` fusiona dos organizaciones —mueve la ficha y sus
// convenios y retira la que queda vacía— y esa operación necesitaba vuelta atrás: sin ella, un
// enlace equivocado no se podía deshacer más que por SQL, porque la organización de origen ya
// no está y no hay ninguna otra forma de crear una. La RPC admite `p_organitzacio = null`
// justamente para eso; esto es su botón.
//
// DÓNDE SE VE. Solo cuando la organización tiene **las dos fichas**: si esta ficha está sola en
// la suya no hay nada que separar, y el componente no pinta nada. Se monta en la ficha del
// equipo (donde un enlace malo se descubre semanas después) y en la cola de Aprovacions (donde
// se acaba de hacer).
//
// ⚠️ Es del equipo: lee la otra tabla de fichas por `organizacion_id`, que una cuenta externa
// no puede. No montarlo en pantallas de productor o receptor.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export default function EnllacOrganitzacio({
  tipus,
  fitxa,
  potAprovar = true,
  onCanviat,
}: {
  tipus: 'productor' | 'entidad'
  /** La ficha que se mira. `null` (alta nueva) no pinta nada. */
  fitxa: string | null
  potAprovar?: boolean
  /** Para que quien lo monta refresque lo suyo: la organización ha cambiado. */
  onCanviat?: () => void
}) {
  const { t } = useT()
  // La OTRA ficha de la misma organización: su existencia es lo que hace que haya algo que
  // separar, y su nombre es lo único que permite decir de quién se está separando.
  const [altra, setAltra] = useState<{ id: string; nom: string | null } | null>(null)
  const [obert, setObert] = useState(false)
  const [ocupat, setOcupat] = useState(false)

  const carrega = useCallback(async () => {
    if (!fitxa) { setAltra(null); return }
    const meva = tipus === 'productor' ? 'productores' : 'entidades'
    const { data: f } = await supabase.from(meva).select('organizacion_id').eq('id', fitxa).maybeSingle()
    const org = (f as { organizacion_id: string | null } | null)?.organizacion_id ?? null
    if (!org) { setAltra(null); return }

    // Una sola consulta a la otra tabla: dice a la vez si comparten y con quién. No hace falta
    // `v_organizaciones`, que para esta ficha devolvería su propio nombre, no el de la otra.
    if (tipus === 'productor') {
      const { data } = await supabase.from('entidades').select('id, nombre').eq('organizacion_id', org).maybeSingle()
      const e = data as { id: string; nombre: string | null } | null
      setAltra(e ? { id: e.id, nom: e.nombre } : null)
    } else {
      const { data } = await supabase.from('productores').select('id, name, empresa').eq('organizacion_id', org).maybeSingle()
      const p = data as { id: string; name: string | null; empresa: string | null } | null
      setAltra(p ? { id: p.id, nom: p.empresa || p.name } : null)
    }
  }, [tipus, fitxa])

  useEffect(() => { void carrega() }, [carrega])

  if (!fitxa || !altra) return null

  async function desenllacar() {
    setOcupat(true)
    const { error } = await supabase.rpc('enllacar_organitzacio',
      { p_tipo: tipus, p_ficha: fitxa, p_organitzacio: null })
    setOcupat(false)
    setObert(false)
    if (error) {
      toast.error(error.code === '42501' ? t('appr.reg_no_perm') : error.message)
      return
    }
    toast.success(t('org.unlink_ok'))
    void carrega()
    onCanviat?.()
  }

  return (
    <>
      <div className="rounded-md bg-secondary p-2 text-xs text-secondary-foreground">
        <span className="font-medium">{t('org.shared_title')}</span>
        {' · '}
        {t('org.shared_with', { nom: altra.nom || '—' })}
        <Button size="sm" variant="outline" className="ml-2 h-8 whitespace-normal"
          disabled={!potAprovar || ocupat} onClick={() => setObert(true)}>
          {t('org.unlink')}
        </Button>
      </div>

      <Dialog open={obert} onOpenChange={(v) => { if (!v) setObert(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('org.unlink_title')}</DialogTitle>
            <DialogDescription>{t('org.unlink_desc', { nom: altra.nom || '—' })}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('org.unlink_warn')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setObert(false)}>{t('c.cancel')}</Button>
            <Button disabled={ocupat} onClick={() => void desenllacar()}>{t('org.unlink')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
