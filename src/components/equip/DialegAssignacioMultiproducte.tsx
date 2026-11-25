// Nivel 1 multiproducto: el equipo asigna VARIOS productos de una disponibilidad a una entidad en
// un acto (proceso 3.3, fase 6b, 25-11-2026) → `assignar_directe_multiple()`: una solicitud ya
// resuelta, una canalización confirmada por producto y UN aviso (`sollicitud_resolta`).
//
// Es el `FormulariInteresAssistit` del grupo: la entidad con el buscador predictivo, las
// modalidades que ESA entidad puede recibir (tipo y naturalesa, como el Mercat), kg por producto,
// precio acordado y aceptación del ofertante en venta, y una fecha opcional (el equipo registra la
// realidad: `CampsRecollida` solo avisa del día fuera de los de la oferta).
//
// 🔴 Todo o nada: cada línea pasa por `assignar_directe()` en la base; si una falla, no queda nada
//    y se marca su línea (`error.details`).
//
// Se monta donde el equipo ve la disponibilidad (la ficha de la oferta): `{ disponibilitatId,
// abert, onTanca, onFet }`.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useEntitatsAssignables } from '../../hooks/useEntitatsAssignables'
import { useT } from '../../lib/i18n'
import { kg as fmtKg } from '../../lib/format'
import { isoRecollida } from '../../lib/franja'
import { modalitatsDelTipus, modalitatsOferta, modalitatsPossibles } from '../../lib/modalitats'
import { modalitatsDeLaNaturalesa } from '../../lib/naturalesa'
import { opcioFitxa } from '../../lib/opcionsSelector'
import {
  diesComuns, disponibleFinsComu, franjaComuna, idLiniaFallida, liniesPerEnviar, modalitatTriada, ofertaViva,
  validaLiniesSollicitud, type ErrorLinia, type LiniaSollicitud,
} from '../../lib/sollicitudMultiproducte'
import { assignaDirecteMultiple, ofertesDisponibilitat, textErrorMultiple } from '../../lib/sollicituds'
import { cn } from '../../lib/utils'
import type { Modalitat, OfertaDisponibilitat } from '../../types'
import CampsRecollida from '../CampsRecollida'
import SelectorEntitat from '../SelectorEntitat'
import SelectorModalitat from '../SelectorModalitat'
import { FilaCasella } from '../Casella'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export interface PropsDialegAssignacioMultiproducte {
  disponibilitatId: string | null
  abert: boolean
  onTanca: () => void
  /** Tras asignar: la pantalla relee lo suyo. */
  onFet: () => void
}

export default function DialegAssignacioMultiproducte({ disponibilitatId, abert, onTanca, onFet }: PropsDialegAssignacioMultiproducte) {
  const { t } = useT()
  const obert = abert && disponibilitatId != null
  const { entitats, matriu, reglaNat } = useEntitatsAssignables(obert)
  const [ofertes, setOfertes] = useState<OfertaDisponibilitat[]>([])
  const [carregant, setCarregant] = useState(false)
  const [entitat, setEntitat] = useState('')
  const [linies, setLinies] = useState<Record<string, LiniaSollicitud>>({})
  const [dia, setDia] = useState('')
  const [hora, setHora] = useState('')
  const [ocupat, setOcupat] = useState(false)
  const [errors, setErrors] = useState<Record<string, ErrorLinia | string>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  useEffect(() => {
    if (!obert || !disponibilitatId) return
    let viu = true
    setCarregant(true)
    setEntitat(''); setDia(''); setHora(''); setErrors({}); setErrorGeneral(null)
    void ofertesDisponibilitat(disponibilitatId).then((r) => {
      if (!viu) return
      setCarregant(false)
      setOfertes(r.ok ? (r.data ?? []).filter(ofertaViva) : [])
    })
    return () => { viu = false }
  }, [obert, disponibilitatId])

  const triadaEnt = entitats.find((e) => e.id === entitat) ?? null
  const opcionsEnt = useMemo(
    () => entitats.map((e) => opcioFitxa({ id: e.id, nom: e.nombre, poblacio: e.poblacion, nif: e.nif, rao: e.razon_social })),
    [entitats],
  )

  // Las modalidades que ESA entidad puede recibir de cada oferta (tipo y naturalesa confirmada),
  // como `FormulariInteresAssistit`. Sin entidad elegida, las de la oferta.
  const modsDe = (o: OfertaDisponibilitat): Modalitat[] => {
    const base = { modalitat: o.modalitat, modalitats: o.modalitats }
    if (!triadaEnt) return modalitatsOferta(base)
    const perTipus = modalitatsPossibles(base, matriu ? modalitatsDelTipus(triadaEnt.tipo_receptor, matriu) : null)
    const org = triadaEnt.organizaciones
    const perNat = modalitatsDeLaNaturalesa(org?.naturalesa, org?.naturalesa_origen, reglaNat)
    return perNat ? perTipus.filter((m) => perNat.includes(m)) : perTipus
  }

  // Al cambiar de entidad, las líneas se rehacen con sus modalidades (conservan lo tecleado).
  useEffect(() => {
    setLinies((prev) => {
      const out: Record<string, LiniaSollicitud> = {}
      for (const o of ofertes) {
        const mods = modsDe(o)
        const p = prev[o.excedente_id]
        const kg = o.kg_lliures ?? o.kg_total
        out[o.excedente_id] = {
          excedente_id: o.excedente_id,
          triada: p?.triada ?? false,
          kg: p?.kg ?? (kg != null ? String(kg) : ''),
          modalitats: mods,
          modalitat: p?.modalitat && mods.includes(p.modalitat) ? p.modalitat : mods.length === 1 ? mods[0] : '',
          kgMax: o.kg_total != null ? Number(o.kg_total) : null,
          preu: p?.preu ?? (o.preu_minim != null ? String(o.preu_minim) : ''),
          preuAcceptat: p?.preuAcceptat ?? false,
        }
      }
      return out
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `modsDe` depende de estas mismas
  }, [ofertes, triadaEnt, matriu, reglaNat])

  const triades = ofertes.filter((o) => linies[o.excedente_id]?.triada)
  const base = triades.length > 0 ? triades : ofertes
  const dies = diesComuns(base)
  const franja = franjaComuna(base)

  function canvia(id: string, c: Partial<LiniaSollicitud>) {
    setLinies((p) => ({ ...p, [id]: { ...p[id], ...c } }))
    setErrors((e) => { const n = { ...e }; delete n[id]; return n })
    setErrorGeneral(null)
  }

  async function assigna() {
    if (!disponibilitatId) return
    if (!entitat) { setErrorGeneral(t('smp.err_cal_entitat')); return }
    const llista = ofertes.map((o) => linies[o.excedente_id]).filter(Boolean)
    // Una línea elegida sin ninguna modalidad posible para esa entidad no se puede asignar.
    const senseMods = llista.filter((l) => l.triada && l.modalitats.length === 0)
    if (senseMods.length > 0) {
      setErrors(Object.fromEntries(senseMods.map((l) => [l.excedente_id, { clau: 'canalz.interes_sense_compat' }])))
      setErrorGeneral(t('smp.err_revisa'))
      return
    }
    const v = validaLiniesSollicitud(llista, { nivell1: true, fmtKg })
    setErrors(v.perLinia)
    if (v.general) { setErrorGeneral(t(v.general)); return }
    if (Object.keys(v.perLinia).length > 0) { setErrorGeneral(t('smp.err_revisa')); return }
    if ((dia && !hora) || (!dia && hora)) { setErrorGeneral(t('mk.need_dia_hora')); return }
    const enviades = liniesPerEnviar(llista, { nivell1: true })
    setOcupat(true)
    const r = await assignaDirecteMultiple({
      disponibilitat: disponibilitatId, entitat,
      linies: enviades as unknown as Record<string, unknown>[],
      recollida: isoRecollida(dia, hora),
    })
    setOcupat(false)
    if (!r.ok) {
      const text = textErrorMultiple(t, r, 'interes')
      const id = idLiniaFallida(r.detall, enviades.map((l) => l.excedente_id))
      if (id) setErrors((e) => ({ ...e, [id]: text }))
      setErrorGeneral(text)
      toast.error(text)
      return
    }
    toast.success(t('smp.assignada', { n: enviades.length }))
    onFet()
  }

  const textErr = (e: ErrorLinia | string | undefined) =>
    e == null ? null : typeof e === 'string' ? e : t(e.clau, e.vars)

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v && !ocupat) onTanca() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="dialeg-assignacio-multi"
        onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('smp.asg_titol')}</DialogTitle>
          <DialogDescription>{t('smp.asg_desc')}</DialogDescription>
        </DialogHeader>

        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && ofertes.length === 0 && (
          <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('smp.asg_res')}</p>
        )}

        {!carregant && ofertes.length > 0 && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="smp-asg-entitat" className="mb-1.5 block text-xs text-muted-foreground">{t('canalz.interes_entitat')}</Label>
              <SelectorEntitat id="smp-asg-entitat" valor={entitat} onChange={setEntitat}
                buit={t('c.none')} placeholder={t('sel.entitat')} opcions={opcionsEnt} />
            </div>

            <ul className="space-y-2">
              {ofertes.map((o, i) => {
                const l = linies[o.excedente_id]
                if (!l) return null
                const triada = modalitatTriada(l)
                const venda = triada === 'venda'
                const err = textErr(errors[o.excedente_id])
                const senseCompat = triadaEnt !== null && l.modalitats.length === 0
                return (
                  <li key={o.excedente_id} data-testid="smp-asg-linia" data-excedent={o.excedente_id}
                    className={cn('space-y-3 rounded-lg border p-3', err && 'border-error')}>
                    <FilaCasella checked={l.triada} disabled={senseCompat}
                      onChange={(v) => canvia(o.excedente_id, { triada: v })}>
                      <span className="font-medium">{o.producto}{o.variedad ? ` · ${o.variedad}` : ''}</span>
                      {o.id_excedente && <code className="ml-2 text-xs text-muted-foreground">{o.id_excedente}</code>}
                      <span className="block text-xs text-muted-foreground">
                        {t('smp.disponibles', { n: fmtKg(o.kg_lliures ?? o.kg_total) })}
                        {senseCompat ? ` · ${t('canalz.interes_sense_compat')}` : ''}
                      </span>
                    </FilaCasella>
                    {l.triada && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <Label htmlFor={`smp-asg-kg-${i}`} className="mb-1.5 block text-xs text-muted-foreground">{t('canalz.interes_kg')}</Label>
                          <Input id={`smp-asg-kg-${i}`} type="number" min="0" step="0.01" inputMode="decimal"
                            className="text-base md:text-sm" aria-invalid={err ? true : undefined}
                            value={l.kg} onChange={(e) => canvia(o.excedente_id, { kg: e.target.value })} />
                        </div>
                        {l.modalitats.length > 1 && (
                          <div>
                            <Label htmlFor={`smp-asg-mode-${i}`} className="mb-1.5 block text-xs text-muted-foreground">{t('mod.entrega')}</Label>
                            <SelectorModalitat id={`smp-asg-mode-${i}`} modalitats={l.modalitats} valor={l.modalitat} ambBuit
                              className="h-11 w-full md:h-8" onCanvi={(m) => canvia(o.excedente_id, { modalitat: m })} />
                          </div>
                        )}
                        {venda && (
                          <div>
                            <Label htmlFor={`smp-asg-preu-${i}`} className="mb-1.5 block text-xs text-muted-foreground">{t('asg.preu_acordat')}</Label>
                            <Input id={`smp-asg-preu-${i}`} type="number" min="0" step="0.01" inputMode="decimal"
                              className="text-base md:text-sm"
                              value={l.preu} onChange={(e) => canvia(o.excedente_id, { preu: e.target.value })} />
                          </div>
                        )}
                        {venda && (
                          <div className="sm:col-span-3">
                            <FilaCasella checked={Boolean(l.preuAcceptat)} onChange={(v) => canvia(o.excedente_id, { preuAcceptat: v })}>
                              {t('asg.preu_acceptat')}
                            </FilaCasella>
                          </div>
                        )}
                      </div>
                    )}
                    {err && <p role="alert" className="text-sm text-error">{err}</p>}
                  </li>
                )
              })}
            </ul>

            <CampsRecollida idPrefix="smp-asg" dia={dia} hora={hora} onDia={setDia} onHora={setHora}
              disponibleFins={disponibleFinsComu(base)} inici={franja.inici} fi={franja.fi}
              diesRecollida={dies.dies} nomesAvisa ajuda={t('asg.rec_help')} />
          </div>
        )}

        {errorGeneral && <p role="alert" className="text-sm text-error" data-testid="smp-asg-error">{errorGeneral}</p>}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" className="h-11 md:h-8" disabled={ocupat} onClick={onTanca}>{t('c.cancel')}</Button>
          {ofertes.length > 0 && (
            <Button className="h-11 whitespace-normal md:h-8" disabled={ocupat || !entitat || triades.length === 0}
              data-testid="smp-asg-envia" onClick={() => void assigna()}>
              {t('smp.asg_go', { n: triades.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
