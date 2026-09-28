// Los lugares de recogida de una entidad productora (`productor_ubicaciones`): la lista, el
// alta y la baja.
//
// UN SOLO COMPONENTE para la ficha propia (`PerfilOrganitzacio`) y la del equipo
// (`FitxaRegistre`, 28-09-2026), con el mismo criterio que `CampsPerfilReceptor`. Carga y
// guarda por su cuenta: cada lugar es una fila propia, no un campo de la ficha, así que no
// espera al «Desar» de nadie.
//
// El alta va por `creaUbicacio()` —la misma del alta de oferta—, con el municipio de la lista
// oficial: es lo que hace que la comarca de una oferta salga exacta (§4, `municipi_ine`).

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { creaUbicacio } from '../lib/ofertes'
import type { Municipi } from '../lib/municipis'
import SelectorMunicipi from './SelectorMunicipi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Ubicacio { id: string; alias: string | null; municipio: string | null; gmaps_url: string | null }

export default function LlocsRecollida({
  productorId, potEditar = true, idPrefix = 'lloc',
}: {
  productorId: string
  potEditar?: boolean
  /** Prefijo de los `id` del formulario de alta. */
  idPrefix?: string
}) {
  const { t } = useT()
  const [ubicacions, setUbicacions] = useState<Ubicacio[]>([])
  const [llocNou, setLlocNou] = useState<{ alias: string; maps: string; municipi: Municipi | null } | null>(null)

  useEffect(() => {
    let viu = true
    void supabase.from('productor_ubicaciones')
      .select('id, alias, municipio, gmaps_url').eq('productor_id', productorId).order('alias')
      .then(({ data }) => { if (viu) setUbicacions((data ?? []) as Ubicacio[]) })
    return () => { viu = false }
  }, [productorId])

  async function afegeix() {
    if (!llocNou) return
    if (!llocNou.alias.trim()) { toast.error(t('po.place_need_name')); return }
    const r = await creaUbicacio({
      productorId,
      alias: llocNou.alias.trim(),
      gmapsUrl: llocNou.maps.trim() || null,
      municipi: llocNou.municipi ? { codi_ine: llocNou.municipi.codi_ine, nom: llocNou.municipi.nom } : null,
    })
    if (!r.ok || !r.data) { toast.error(textError(t, r.error)); return }
    setUbicacions((u) => [...u, { ...r.data!, gmaps_url: llocNou.maps.trim() || null }])
    setLlocNou(null)
    toast.success(t('org.place_added'))
  }

  async function esborra(u: Ubicacio) {
    const { error } = await supabase.from('productor_ubicaciones').delete().eq('id', u.id)
    // 23503: alguna oferta apunta a este lugar. No se borra: se diría que la oferta ya no
    // tiene dónde recogerse.
    if (error) { toast.error(error.code === '23503' ? t('org.place_in_use') : t('c.error')); return }
    setUbicacions((l) => l.filter((x) => x.id !== u.id))
  }

  return (
    <>
      {ubicacions.length === 0 && <p className="text-sm text-muted-foreground">{t('org.no_places')}</p>}
      <ul className="space-y-2">
        {ubicacions.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="font-medium">{u.alias ?? '—'}</p>
              <p className="text-xs text-muted-foreground">
                {u.municipio ?? '—'}
                {u.gmaps_url && <> · <a href={u.gmaps_url} target="_blank" rel="noreferrer" className="text-primary underline">{t('org.see_map')}</a></>}
              </p>
            </div>
            {potEditar && (
              <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={() => void esborra(u)}
                aria-label={t('org.place_delete', { x: u.alias ?? '' })}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {potEditar && !llocNou && (
        <Button variant="outline" className="h-11 whitespace-normal md:h-9"
          onClick={() => setLlocNou({ alias: '', maps: '', municipi: null })}>
          <Plus className="size-4" aria-hidden /> {t('po.place_add')}
        </Button>
      )}
      {llocNou && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${idPrefix}-nom`} className="mb-1.5 block text-xs text-muted-foreground">{t('po.place_name')}</Label>
            <Input id={`${idPrefix}-nom`} value={llocNou.alias} placeholder={t('po.place_name_ph')}
              onChange={(e) => setLlocNou((l) => (l ? { ...l, alias: e.target.value } : l))} />
          </div>
          <div>
            <Label htmlFor={`${idPrefix}-municipi`} className="mb-1.5 block text-xs text-muted-foreground">{t('po.place_town')}</Label>
            <SelectorMunicipi id={`${idPrefix}-municipi`} valor={llocNou.municipi?.codi_ine ?? null}
              onChange={(m) => setLlocNou((l) => (l ? { ...l, municipi: m } : l))} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor={`${idPrefix}-maps`} className="mb-1.5 block text-xs text-muted-foreground">
              {t('po.place_maps')} <span className="ml-1">{t('po.optional')}</span>
            </Label>
            <Input id={`${idPrefix}-maps`} type="url" inputMode="url" value={llocNou.maps} placeholder="https://maps.app.goo.gl/…"
              onChange={(e) => setLlocNou((l) => (l ? { ...l, maps: e.target.value } : l))} />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button className="h-11 whitespace-normal md:h-9" onClick={() => void afegeix()}>{t('po.place_save')}</Button>
            <Button variant="ghost" className="h-11 md:h-9" onClick={() => setLlocNou(null)}>{t('c.cancel')}</Button>
          </div>
        </div>
      )}
    </>
  )
}
