// Editar una oferta ya publicada (05-10-2026, rebanada 2). Lo usan el productor, desde el
// detalle de su oferta, y el equipo, desde el suyo.
//
// Solo lo que se puede cambiar sin rehacer la oferta: kilos, modalidades, precio mínimo,
// disponibilidad, franja de recogida, variedad y observaciones. El producto no: cambiaría
// la referencia y lo que ya vieron las entidades (para eso se cancela y se publica otra).
//
// La regla vive en la base (`editar_oferta()`): los kilos no bajan de lo ya canalizado, no
// se quita una modalidad con entregas aprobadas, y si el PRODUCTOR cambia kilos o
// modalidades, la oferta vuelve a validación (D4). Aquí se anticipa lo que se puede y se
// avisa ANTES de guardar de que volverá a revisión.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { CODIS_EDICIO, editaOferta } from '../lib/ofertes'
import { HORES, QUARTS, esFranjaValida, hhmm } from '../lib/franja'
import { MODALITATS_IDS, ambPreu, modalitatsOferta } from '../lib/modalitats'
import { FilaCasella } from './Casella'
import type { Excedente, Modalitat } from '../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

const SEL = 'h-11 rounded-md border border-input bg-background px-2 text-base md:h-9 md:text-sm'

export default function DialegEditaOferta({
  obert, onObert, oferta, kgCanalitzats, esEquip, onFet,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  oferta: Excedente
  /** Lo ya canalizado: los kilos no pueden bajar de aquí. */
  kgCanalitzats: number
  /** El equipo no revalida (es quien valida). */
  esEquip: boolean
  onFet: () => void | Promise<unknown>
}) {
  const { t } = useT()
  const [kg, setKg] = useState('')
  const [mods, setMods] = useState<Modalitat[]>([])
  const [preu, setPreu] = useState('')
  const [fins, setFins] = useState('')
  const [inici, setInici] = useState('')
  const [fi, setFi] = useState('')
  const [varietat, setVarietat] = useState('')
  const [obs, setObs] = useState('')
  const [desant, setDesant] = useState(false)

  // Al abrir, los valores de la oferta: reabrir tras guardar enseña lo guardado.
  useEffect(() => {
    if (!obert) return
    setKg(oferta.kg_total != null ? String(oferta.kg_total) : '')
    setMods(modalitatsOferta(oferta))
    setPreu(oferta.preu_minim != null ? String(oferta.preu_minim) : '')
    setFins(oferta.disponible_hasta ?? '')
    setInici(hhmm(oferta.hora_recollida_inici))
    setFi(hhmm(oferta.hora_recollida_fi))
    setVarietat(oferta.variedad ?? '')
    setObs(oferta.observacions ?? '')
  }, [obert, oferta])

  const kgNum = Number(kg.replace(',', '.'))
  const modsAbans = modalitatsOferta(oferta)
  const canviaClau = Number(oferta.kg_total ?? 0) !== kgNum || modsAbans.join() !== mods.join()
  const revalidara = !esEquip && canviaClau && oferta.estado !== 'pendent_validacio'
  const franjaBuida = !inici && !fi
  const errorFranja = !franjaBuida && !esFranjaValida({ inici, fi })
  const errorKg = !kgNum || kgNum <= 0 ? t('edit.err_kg_invalids')
    : kgNum < kgCanalitzats ? t('edit.err_kg_menys', { n: kgCanalitzats }) : null

  async function desa() {
    if (errorKg || mods.length === 0 || errorFranja) return
    const canvis: Record<string, unknown> = {}
    if (kgNum !== Number(oferta.kg_total ?? 0)) canvis.kg_total = kgNum
    if (modsAbans.join() !== mods.join()) canvis.modalitats = mods
    const preuAra = ambPreu(mods) && preu !== '' ? Number(preu.replace(',', '.')) : null
    if (preuAra !== (oferta.preu_minim != null ? Number(oferta.preu_minim) : null)) canvis.preu_minim = preuAra
    if ((fins || null) !== (oferta.disponible_hasta ?? null)) canvis.disponible_hasta = fins || null
    if (inici !== hhmm(oferta.hora_recollida_inici) || fi !== hhmm(oferta.hora_recollida_fi)) {
      canvis.franja = franjaBuida ? null : { inici, fi }
    }
    if (varietat.trim() !== (oferta.variedad ?? '')) canvis.variedad = varietat.trim()
    if (obs.trim() !== (oferta.observacions ?? '')) canvis.observacions = obs.trim()
    if (Object.keys(canvis).length === 0) { onObert(false); return }

    setDesant(true)
    const r = await editaOferta(oferta.id, canvis)
    setDesant(false)
    if (!r.ok) {
      const code = (r as { code?: string }).code
      toast.error(code && (CODIS_EDICIO as readonly string[]).includes(code) ? t(`edit.err_${code}`) : t('c.error'))
      return
    }
    toast.success(r.data?.estado === 'pendent_validacio' && oferta.estado !== 'pendent_validacio'
      ? t('edit.ok_revalidar') : t('edit.ok'))
    onObert(false)
    await onFet()
  }

  const toggle = (m: Modalitat, on: boolean) =>
    setMods((ms) => MODALITATS_IDS.filter((x) => (x === m ? on : ms.includes(x))))

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('edit.titol')}</DialogTitle>
          <DialogDescription>{t('edit.desc', { producte: oferta.producto ?? '—' })}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ed-kg">{t('edit.kg')}</Label>
            <Input id="ed-kg" type="number" inputMode="decimal" min="0" value={kg} onChange={(e) => setKg(e.target.value)} />
            {kgCanalitzats > 0 && <p className="text-xs text-muted-foreground">{t('edit.kg_canalitzats', { n: kgCanalitzats })}</p>}
            {errorKg && <p className="text-xs text-error">{errorKg}</p>}
          </div>

          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">{t('edit.modalitats')}</legend>
            {MODALITATS_IDS.map((m) => (
              <FilaCasella key={m} checked={mods.includes(m)} onChange={(v) => toggle(m, v)}>
                {t(`od.mod_${m}`)}
              </FilaCasella>
            ))}
            {mods.length === 0 && <p className="text-xs text-error">{t('edit.err_modalitats_buides')}</p>}
          </fieldset>

          {ambPreu(mods) && (
            <div className="space-y-1.5">
              <Label htmlFor="ed-preu">{t('edit.preu')}</Label>
              <Input id="ed-preu" type="number" inputMode="decimal" step="0.01" min="0" value={preu} onChange={(e) => setPreu(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ed-fins">{t('edit.fins')}</Label>
            <Input id="ed-fins" type="date" value={fins} onChange={(e) => setFins(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t('edit.franja')}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('po.franja_de')}</span>
              <select aria-label={t('po.franja_h_inici')} className={SEL} value={inici}
                onChange={(e) => setInici(e.target.value)}>
                <option value="">—</option>
                {HORES.flatMap((h) => QUARTS.map((q) => `${h}:${q}`)).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <span className="text-muted-foreground">{t('po.franja_a')}</span>
              <select aria-label={t('po.franja_h_fi')} className={SEL} value={fi}
                onChange={(e) => setFi(e.target.value)}>
                <option value="">—</option>
                {HORES.flatMap((h) => QUARTS.map((q) => `${h}:${q}`)).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            {errorFranja && <p className="text-xs text-error">{t('po.franja_invalida')}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ed-var">{t('edit.varietat')}</Label>
            <Input id="ed-var" value={varietat} maxLength={400} onChange={(e) => setVarietat(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ed-obs">{t('edit.obs')}</Label>
            <Textarea id="ed-obs" value={obs} maxLength={400} onChange={(e) => setObs(e.target.value)} />
          </div>

          {revalidara && (
            <p className="rounded-md bg-aviso-fondo p-2 text-sm text-aviso">{t('edit.avis_revalidar')}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-9" onClick={() => onObert(false)}>{t('c.cancel')}</Button>
          <Button className="h-11 md:h-9" disabled={desant || Boolean(errorKg) || mods.length === 0 || errorFranja}
            onClick={() => void desa()}>
            {desant ? t('c.saving') : t('edit.desa')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
