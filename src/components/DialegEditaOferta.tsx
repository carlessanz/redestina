// Editar una oferta ya creada (reunión del 06-10-2026). Uno solo para el equipo (detalle de
// la oferta) y para el productor (su detalle): el caso real que lo pidió fue un cero de más
// en los kg.
//
// Solo manda lo que ha CAMBIADO: el servidor (`crear-oferta`, PATCH) valida cada campo,
// recompone el `texto_oferta` con la misma función del alta y deja rastro en
// `excedente_edicions`. Lo que ya se envió por WhatsApp o correo no se puede retirar, y el
// diálogo lo dice antes de guardar.
//
// La modalidad solo se edita mientras la oferta espera validación: después decide qué
// entidades la ven y qué documento se emite.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { editaOferta } from '../lib/ofertes'
import type { Excedente, Modalitat } from '../types'
import { SelectorFranja } from './FormulariNovaOferta'
import { FilaCasella } from './Casella'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const MODALITATS: Modalitat[] = ['donacio', 'venda', 'maquila']

const comuns = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm'

/** Lo que el diálogo deja tocar, con las claves del cuestionario. */
interface Valors {
  kg: string
  varietat: string
  caixes: string
  disponible_fins: string
  horari: string
  preu_minim: string
  cost_kg: string
  observacions: string
  modalitat: Modalitat[]
}

function inicials(e: Excedente): Valors {
  const hm = (v: string | null | undefined) => (v ? v.slice(0, 5) : '')
  return {
    kg: e.kg_total != null ? String(e.kg_total) : '',
    varietat: e.variedad ?? '',
    caixes: e.num_caixes != null ? String(e.num_caixes) : '',
    disponible_fins: e.disponible_hasta ?? '',
    horari: e.horari_desde && e.horari_fins ? `${hm(e.horari_desde)}-${hm(e.horari_fins)}` : '',
    preu_minim: e.preu_minim != null ? String(e.preu_minim) : '',
    cost_kg: e.coste_kg != null ? String(e.coste_kg) : '',
    observacions: e.observacions ?? '',
    modalitat: (e.modalitats && e.modalitats.length ? e.modalitats : (e.modalitat ? [e.modalitat] : [])),
  }
}

export default function DialegEditaOferta({
  obert, onObert, oferta, onDesada,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  oferta: Excedente
  onDesada: () => void
}) {
  const { t } = useT()
  const [v, setV] = useState<Valors>(() => inicials(oferta))
  const [desant, setDesant] = useState(false)

  // Cada vez que se abre, desde la oferta tal como está ahora.
  useEffect(() => { if (obert) setV(inicials(oferta)) }, [obert, oferta])

  const set = <K extends keyof Valors>(k: K, val: Valors[K]) => setV((x) => ({ ...x, [k]: val }))
  const potModalitat = oferta.estado === 'pendent_validacio'
  const ambPreu = v.modalitat.some((m) => m === 'venda' || m === 'maquila')
  const ambCost = v.modalitat.includes('donacio')

  async function desa() {
    const ini = inicials(oferta)
    const canvis: Record<string, unknown> = {}
    const iso2ddmm = (iso: string) => {
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
    }
    if (v.kg !== ini.kg) canvis.kg = v.kg
    if (v.varietat !== ini.varietat) canvis.varietat = v.varietat
    if (v.caixes !== ini.caixes) canvis.caixes = v.caixes
    if (v.disponible_fins !== ini.disponible_fins) canvis.disponible_fins = iso2ddmm(v.disponible_fins)
    if (v.horari !== ini.horari) {
      if (!v.horari) { toast.error(t('po.franja_err')); return }
      canvis.horari = v.horari
    }
    if (v.preu_minim !== ini.preu_minim) canvis.preu_minim = v.preu_minim
    if (v.cost_kg !== ini.cost_kg) canvis.cost_kg = v.cost_kg
    if (v.observacions !== ini.observacions) canvis.observacions = v.observacions
    if (potModalitat && [...v.modalitat].sort().join() !== [...ini.modalitat].sort().join()) {
      canvis.modalitat = v.modalitat
    }
    if (Object.keys(canvis).length === 0) { toast.info(t('edit.nothing')); return }

    setDesant(true)
    const r = await editaOferta(oferta.id, canvis)
    setDesant(false)
    if (!r.ok) { toast.error(textError(t, r.error)); return }
    toast.success(t('edit.saved'))
    onObert(false)
    onDesada()
  }

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('edit.title')}</DialogTitle>
          <DialogDescription>{t('edit.desc')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ed-kg" className="mb-1.5 block text-xs text-muted-foreground">{t('edit.kg')}</Label>
            <Input id="ed-kg" type="number" step="0.01" min="0" value={v.kg} onChange={(e) => set('kg', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ed-varietat" className="mb-1.5 block text-xs text-muted-foreground">{t('edit.varietat')}</Label>
            <Input id="ed-varietat" value={v.varietat} onChange={(e) => set('varietat', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ed-caixes" className="mb-1.5 block text-xs text-muted-foreground">{t('edit.caixes')}</Label>
            <Input id="ed-caixes" type="number" step="1" min="0" value={v.caixes} onChange={(e) => set('caixes', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ed-disp" className="mb-1.5 block text-xs text-muted-foreground">{t('edit.disponible')}</Label>
            <Input id="ed-disp" type="date" value={v.disponible_fins} onChange={(e) => set('disponible_fins', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ed-franja" className="mb-1.5 block text-xs text-muted-foreground">{t('edit.franja')}</Label>
            <SelectorFranja key={obert ? 'o' : 'c'} id="ed-franja" valor={v.horari} comuns={comuns}
              onChange={(x) => set('horari', x)} />
          </div>
          {potModalitat && (
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-xs text-muted-foreground">{t('edit.modalitats')}</p>
              {MODALITATS.map((m) => (
                <FilaCasella key={m} checked={v.modalitat.includes(m)}
                  onChange={(on) => set('modalitat', on ? [...v.modalitat.filter((x) => x !== m), m] : v.modalitat.filter((x) => x !== m))}>
                  {t(`od.mod_${m}`)}
                </FilaCasella>
              ))}
            </div>
          )}
          {ambPreu && (
            <div>
              <Label htmlFor="ed-preu" className="mb-1.5 block text-xs text-muted-foreground">{t('edit.preu')}</Label>
              <Input id="ed-preu" type="number" step="0.01" min="0" value={v.preu_minim} onChange={(e) => set('preu_minim', e.target.value)} />
            </div>
          )}
          {ambCost && (
            <div>
              <Label htmlFor="ed-cost" className="mb-1.5 block text-xs text-muted-foreground">{t('edit.cost')}</Label>
              <Input id="ed-cost" type="number" step="0.01" min="0" value={v.cost_kg} onChange={(e) => set('cost_kg', e.target.value)} />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="ed-obs" className="mb-1.5 block text-xs text-muted-foreground">{t('edit.obs')}</Label>
            <Textarea id="ed-obs" rows={3} value={v.observacions} onChange={(e) => set('observacions', e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onObert(false)}>{t('c.cancel')}</Button>
          <Button disabled={desant} onClick={() => void desa()}>{desant ? t('c.saving') : t('edit.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
