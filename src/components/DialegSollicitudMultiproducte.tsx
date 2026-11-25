// «Demana diversos productes» (ofertas multiproducto, proceso 3.3, fase 6b, 25-11-2026).
//
// El enlace del mensaje único de una disponibilidad (`/receptor/mercat?disponibilitat=<id>`) abre
// este diálogo: las ofertas del grupo que ESTA entidad puede pedir (`ofertes_disponibilitat()`:
// publicadas o parciales y con alguna modalidad suya —compatibilidad y P8 ya cruzadas en la base—),
// una casilla y los kg por producto (con lo que queda libre como referencia), la modalidad si hay
// varias, UNA fecha y franja para todos y UN envío → `manifestar_interes_multiple()`.
//
// 🔴 Todo o nada, y lo decide la base: cada línea pasa por `manifestar_interes()` (convenio,
//    `kg_maxim`, precio mínimo, día y franja…). Si una falla no queda nada, y la línea que falló
//    se marca aquí leyendo `error.details` (`{"linia": n, "excedente_id": …}`).
//
// LOS DÍAS. `CampsRecollida` limita el día con `dies_recollida`; aquí se le pasan los días COMUNES
// de las ofertas elegidas (`diesComuns`). Si no comparten ninguno, los de la primera, y se explica:
// la base rechazará con `dia_fora_dies` la que no se recoja ese día. La franja, la común.
//
// Una cuenta con varias entidades elige con cuál pide (`p_entidad`); con una, no se pregunta.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { kg as fmtKg, preu as fmtPreu } from '../lib/format'
import { isoRecollida } from '../lib/franja'
import {
  diesComuns, disponibleFinsComu, franjaComuna, idLiniaFallida, modalitatsDemanables, modalitatTriada,
  liniesPerEnviar, ofertaViva, validaLiniesSollicitud,
  type ErrorLinia, type LiniaSollicitud,
} from '../lib/sollicitudMultiproducte'
import { manifestaInteresMultiple, ofertesDisponibilitat, textErrorMultiple } from '../lib/sollicituds'
import type { Modalitat, OfertaDisponibilitat } from '../types'
import CampsRecollida from './CampsRecollida'
import SelectorModalitat from './SelectorModalitat'
import Desplegable from './Desplegable'
import { FilaCasella } from './Casella'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  /** La disponibilidad de la URL; `null` = cerrado. */
  disponibilitatId: string | null
  /** Las fichas de entidad de la cuenta (para elegir con cuál se pide si hay varias). */
  entitats: readonly { id: string; nombre: string | null }[]
  /** La del panel activo. */
  entitatInicial: string | null
  /** Desde la fecha de corte, solo las modalidades con su convenio (el Mercat lo sabe). */
  potDemanar?: (m: Modalitat) => boolean
  /** Ofertas que esta entidad ya ha pedido: no se vuelven a pedir aquí. */
  jaDemanades?: ReadonlySet<string>
  onTanca: () => void
  /** Tras enviar: la pantalla relee lo suyo. */
  onFet: () => void
}

/** Una línea vacía para una oferta: kg = lo que queda libre (o el total), modalidad si solo hay una. */
function liniaInicial(o: OfertaDisponibilitat, mods: Modalitat[]): LiniaSollicitud {
  const kg = o.kg_lliures ?? o.kg_total
  return {
    excedente_id: o.excedente_id, triada: false, kg: kg != null ? String(kg) : '',
    modalitats: mods, modalitat: mods.length === 1 ? mods[0] : '',
    kgMax: o.kg_total != null ? Number(o.kg_total) : null,
    preu: o.preu_minim != null ? String(o.preu_minim) : '',
  }
}

export default function DialegSollicitudMultiproducte({
  disponibilitatId, entitats, entitatInicial, potDemanar, jaDemanades, onTanca, onFet,
}: Props) {
  const { t } = useT()
  const [ofertes, setOfertes] = useState<OfertaDisponibilitat[]>([])
  const [carregant, setCarregant] = useState(false)
  const [errorCarrega, setErrorCarrega] = useState(false)
  const [linies, setLinies] = useState<Record<string, LiniaSollicitud>>({})
  const [dia, setDia] = useState('')
  const [hora, setHora] = useState('')
  const [entitat, setEntitat] = useState(entitatInicial ?? '')
  const [enviant, setEnviant] = useState(false)
  const [errors, setErrors] = useState<Record<string, ErrorLinia | string>>({})
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null)

  // Las modalidades que se pueden pedir de cada oferta (las de la entidad, y con convenio).
  const modsDe = useMemo(
    () => (o: OfertaDisponibilitat) => modalitatsDemanables(o, potDemanar),
    [potDemanar],
  )

  useEffect(() => {
    if (!disponibilitatId) return
    let viu = true
    setCarregant(true)
    setErrors({})
    setErrorGeneral(null)
    setDia('')
    setHora('')
    setEntitat(entitatInicial ?? '')
    void ofertesDisponibilitat(disponibilitatId).then((r) => {
      if (!viu) return
      setCarregant(false)
      if (!r.ok) { setErrorCarrega(true); setOfertes([]); return }
      setErrorCarrega(false)
      setOfertes(r.data ?? [])
      const ls: Record<string, LiniaSollicitud> = {}
      for (const o of r.data ?? []) ls[o.excedente_id] = liniaInicial(o, modsDe(o))
      setLinies(ls)
    })
    return () => { viu = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir otra disponibilidad
  }, [disponibilitatId])

  const demanables = ofertes.filter((o) => ofertaViva(o) && modsDe(o).length > 0 && !jaDemanades?.has(o.excedente_id))
  const altres = ofertes.filter((o) => !demanables.includes(o))
  const triades = demanables.filter((o) => linies[o.excedente_id]?.triada)
  // Los días y la franja, de las elegidas; sin ninguna elegida, de todas las que se pueden pedir.
  const base = triades.length > 0 ? triades : demanables
  const dies = diesComuns(base)
  const franja = franjaComuna(base)
  const fins = disponibleFinsComu(base)

  function canvia(id: string, c: Partial<LiniaSollicitud>) {
    setLinies((p) => ({ ...p, [id]: { ...p[id], ...c } }))
    setErrors((e) => { const n = { ...e }; delete n[id]; return n })
    setErrorGeneral(null)
  }

  async function envia() {
    if (!disponibilitatId) return
    const llista = demanables.map((o) => linies[o.excedente_id]).filter(Boolean)
    const v = validaLiniesSollicitud(llista, { fmtKg })
    setErrors(v.perLinia)
    if (v.general) { setErrorGeneral(t(v.general)); return }
    if (Object.keys(v.perLinia).length > 0) { setErrorGeneral(t('smp.err_revisa')); return }
    const recollida = isoRecollida(dia, hora)
    if (!recollida) { setErrorGeneral(t('smp.err_cal_recollida')); return }
    if (entitats.length > 1 && !entitat) { setErrorGeneral(t('smp.err_cal_entitat')); return }
    const enviades = liniesPerEnviar(llista)
    setEnviant(true)
    const r = await manifestaInteresMultiple({
      disponibilitat: disponibilitatId,
      linies: enviades as unknown as Record<string, unknown>[],
      recollida,
      entitat: entitat || entitatInicial,
    })
    setEnviant(false)
    if (!r.ok) {
      const text = textErrorMultiple(t, r, 'interes')
      const id = idLiniaFallida(r.detall, enviades.map((l) => l.excedente_id))
      if (id) setErrors((e) => ({ ...e, [id]: text }))
      setErrorGeneral(text)
      toast.error(text)
      return
    }
    toast.success(t('smp.enviada'))
    onFet()
  }

  const textError = (e: ErrorLinia | string | undefined) =>
    e == null ? null : typeof e === 'string' ? e : t(e.clau, e.vars)

  return (
    <Dialog open={disponibilitatId != null} onOpenChange={(v) => { if (!v && !enviant) onTanca() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="dialeg-sollicitud"
        onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('smp.titol')}</DialogTitle>
          <DialogDescription>{t('smp.desc')}</DialogDescription>
        </DialogHeader>

        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {!carregant && errorCarrega && <p className="text-sm text-error">{t('c.load_error')}</p>}
        {!carregant && !errorCarrega && demanables.length === 0 && (
          <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso" data-testid="smp-res">{t('smp.res_per_demanar')}</p>
        )}

        {!carregant && demanables.length > 0 && (
          <div className="space-y-4">
            {entitats.length > 1 && (
              <div>
                <Label htmlFor="smp-entitat" className="mb-1.5 block text-xs text-muted-foreground">{t('smp.entitat')}</Label>
                <Desplegable id="smp-entitat" value={entitat} onChange={setEntitat}
                  placeholder={t('smp.entitat_tria')}
                  opcions={entitats.map((e) => ({ valor: e.id, text: e.nombre ?? '—' }))} />
              </div>
            )}

            <ul className="space-y-2">
              {demanables.map((o, i) => {
                const l = linies[o.excedente_id]
                if (!l) return null
                const mods = l.modalitats
                const triada = modalitatTriada(l)
                const venda = triada ? triada === 'venda' : mods.includes('venda')
                const err = textError(errors[o.excedente_id])
                return (
                  <li key={o.excedente_id} data-testid="smp-linia" data-excedent={o.excedente_id}
                    className={cn('space-y-3 rounded-lg border p-3', err && 'border-error')}>
                    <FilaCasella checked={l.triada} onChange={(v) => canvia(o.excedente_id, { triada: v })}>
                      <span className="font-medium">{o.producto}{o.variedad ? ` · ${o.variedad}` : ''}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('smp.disponibles', { n: fmtKg(o.kg_lliures ?? o.kg_total) })}
                        {o.estado === 'parcial' ? ` · ${t('smp.parcial')}` : ''}
                      </span>
                    </FilaCasella>
                    {l.triada && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <Label htmlFor={`smp-kg-${i}`} className="mb-1.5 block text-xs text-muted-foreground">{t('mk.kg')}</Label>
                          <Input id={`smp-kg-${i}`} name={`kg-${i}`} type="number" min="0" step="0.01" inputMode="decimal"
                            className="text-base md:text-sm" aria-invalid={err ? true : undefined}
                            max={o.kg_total != null ? String(o.kg_total) : undefined}
                            value={l.kg} onChange={(e) => canvia(o.excedente_id, { kg: e.target.value })} />
                        </div>
                        {mods.length > 1 && (
                          <div>
                            <Label htmlFor={`smp-mode-${i}`} className="mb-1.5 block text-xs text-muted-foreground">{t('mk.mode_q')}</Label>
                            <SelectorModalitat id={`smp-mode-${i}`} modalitats={mods} valor={l.modalitat} ambBuit
                              className="h-11 w-full md:h-8" onCanvi={(m) => canvia(o.excedente_id, { modalitat: m })} />
                          </div>
                        )}
                        {venda && (
                          <div>
                            <Label htmlFor={`smp-preu-${i}`} className="mb-1.5 block text-xs text-muted-foreground">
                              {o.preu_minim != null ? t('mk.price', { min: fmtPreu(o.preu_minim) }) : t('mk.price_free')}
                            </Label>
                            <Input id={`smp-preu-${i}`} name={`preu-${i}`} type="number" min="0" step="0.01" inputMode="decimal"
                              className="text-base md:text-sm"
                              value={l.preu} onChange={(e) => canvia(o.excedente_id, { preu: e.target.value })} />
                          </div>
                        )}
                      </div>
                    )}
                    {err && <p role="alert" className="text-sm text-error" data-testid="smp-error-linia">{err}</p>}
                  </li>
                )
              })}
            </ul>

            {altres.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('smp.no_demanables', { productes: altres.map((o) => o.producto).join(', ') })}
              </p>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('smp.quan')}</p>
              <CampsRecollida idPrefix="smp" dia={dia} hora={hora} onDia={setDia} onHora={setHora}
                disponibleFins={fins} inici={franja.inici} fi={franja.fi}
                diesRecollida={dies.dies} ajuda={t('smp.quan_help')} />
              {dies.motiu === 'primera' && (
                <p className="rounded-md bg-aviso-fondo p-2 text-xs text-aviso" role="status">{t('smp.dies_no_comuns')}</p>
              )}
              {dies.motiu === 'interseccio' && triades.length > 1 && (
                <p className="text-xs text-muted-foreground">{t('smp.dies_comuns')}</p>
              )}
              {!franja.comuna && (
                <p className="rounded-md bg-aviso-fondo p-2 text-xs text-aviso" role="status">{t('smp.franja_no_comuna')}</p>
              )}
            </div>
          </div>
        )}

        {errorGeneral && <p role="alert" className="text-sm text-error" data-testid="smp-error">{errorGeneral}</p>}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" className="h-11 md:h-8" disabled={enviant} onClick={onTanca}>{t('c.cancel')}</Button>
          {demanables.length > 0 && (
            <Button className="h-11 whitespace-normal md:h-8" disabled={enviant || triades.length === 0}
              data-testid="smp-envia" onClick={() => void envia()}>
              {enviant ? t('c.sending') : t('smp.envia', { n: triades.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
