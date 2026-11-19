// Lo que el equipo puede hacer con una asignación ya hecha (puntos 4-6, fase 2): modificarla,
// anularla y, en una venta, fijar el precio acordado. Lo comparten la ficha de la oferta
// (`OfferDetail`, «Canalitzacions assignades») y el ciclo guiado (`fases/Aprovacio`): las dos
// pantallas tienen que ofrecer lo mismo y con los mismos grises.
//
//   · «Modifica» → `modificar_assignacio()`: kilos y fecha/hora de recogida. Solo antes de
//     registrar la recogida y con el ENT/OPE todavía en borrador (`ja_registrada`,
//     `albara_emes`); después, se anula y se vuelve a asignar.
//   · «Anul·la l'assignació» → `anular_assignacio()`, con motivo obligatorio (diálogo propio,
//     nunca `window.prompt`). No después de validar la recogida (`ja_validada`).
//   · Venta: el precio acordado y si el ofertante lo ha aceptado; «Fixa el preu acordat» →
//     `fixar_preu_acordat()`.
//
// Los grises anticipan lo que la base rechazaría; la autoridad sigue siendo la RPC. Todo exige
// `pot_aprovar()`: a un técnico se le dejan grises con el motivo, como en Aprovacions.

import { useEffect, useState } from 'react'
import { Ban, Euro, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { kg as fmtKg, preu as fmtPreu } from '../../lib/format'
import { localDateTime } from '../../lib/franja'
import { anularAssignacio, fixarPreuAcordat, modificarAssignacio } from '../../lib/canalitzacio'
import type { DatesValidacio } from '../../lib/registreRecollida'
import type { Canalizacion } from '../../types'
import BotoIcona from '../BotoIcona'
import DialegMotiu from '../DialegMotiu'
import { FilaCasella } from '../Casella'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** Lo justo de la canalización para decidir qué se puede hacer con ella. */
export type AssignacioFila = Pick<Canalizacion,
  'id' | 'estado' | 'kg_confirmados' | 'data_hora_recollida' | 'valorizacion'>
  & Partial<Pick<Canalizacion, 'preu_acordat_kg' | 'preu_acceptat_at' | 'motiu_anulacio'>>
  & DatesValidacio

/** Estados de un albarán que ya ha salido de borrador (y no está muerto). */
const ESTATS_EMES = ['emitido', 'entregado', 'confirmado', 'conciliado']
/** Estados de un albarán que cierran la asignación: ya no se anula. */
const ESTATS_VALIDATS = ['confirmado', 'conciliado']

/** ¿Por qué no se puede modificar? Clave i18n o `null` si se puede. */
export function motiuNoModificable(c: AssignacioFila, estatsAlbarans: readonly string[]): string | null {
  if (c.estado === 'anulada') return 'recol.err_anulada'
  if (c.recollida_registrada_at || c.recollida_validada_at || c.estado === 'conciliada') return 'asg.err_ja_registrada'
  if (estatsAlbarans.some((e) => ESTATS_EMES.includes(e))) return 'asg.err_albara_emes'
  return null
}

/** ¿Por qué no se puede anular? Clave i18n o `null` si se puede. */
export function motiuNoAnullable(c: AssignacioFila, estatsAlbarans: readonly string[]): string | null {
  if (c.estado === 'anulada') return 'recol.err_anulada'
  if (c.recollida_validada_at || c.estado === 'conciliada'
    || estatsAlbarans.some((e) => ESTATS_VALIDATS.includes(e))) return 'asg.err_ja_validada'
  return null
}

interface Props {
  c: AssignacioFila
  /** Los estados de TODOS los albaranes de esta canalización (ENT/OPE). */
  estatsAlbarans: readonly string[]
  /** El tope de kilos (los de la oferta), para el diálogo de modificar. */
  kgMaxim: number | null
  potAprovar: boolean
  /** Prefijo de los `id` de los campos. */
  idPrefix: string
  /** Tras cualquier cambio: la pantalla relee lo suyo. */
  onFet: () => void
}

/** El precio acordado de una venta, en una línea: cuánto y si el ofertante lo ha aceptado. */
export function PreuAcordat({ c }: { c: AssignacioFila }) {
  const { t } = useT()
  if (c.valorizacion !== 'venda') return null
  if (c.preu_acordat_kg == null) {
    return <span className="text-xs font-medium text-aviso">{t('asg.sense_preu')}</span>
  }
  return (
    <span className="text-xs">
      <span className="font-medium">{t('asg.preu', { preu: fmtPreu(c.preu_acordat_kg) })}</span>
      <span className={c.preu_acceptat_at ? 'text-exito' : 'text-aviso'}>
        {' · '}{t(c.preu_acceptat_at ? 'asg.preu_acceptat_si' : 'asg.preu_pendent')}
      </span>
    </span>
  )
}

export default function AccionsAssignacio({ c, estatsAlbarans, kgMaxim, potAprovar, idPrefix, onFet }: Props) {
  const { t } = useT()
  const [modificant, setModificant] = useState(false)
  const [anullant, setAnullant] = useState(false)
  const [fixantPreu, setFixantPreu] = useState(false)
  const [ocupat, setOcupat] = useState(false)

  if (c.estado === 'anulada') return null

  const noMod = motiuNoModificable(c, estatsAlbarans)
  const noAnul = motiuNoAnullable(c, estatsAlbarans)
  const motiuRol = potAprovar ? undefined : t('asg.need_approver')
  const esVenda = c.valorizacion === 'venda'
  // El precio se puede fijar mientras la recogida no esté validada (`ja_validada`).
  const noPreu = c.recollida_validada_at || c.estado === 'conciliada' ? 'asg.err_ja_validada' : null

  async function anulla(motiu: string) {
    // El diálogo no deja confirmar vacío, pero el `cal_motiu` de la base no se traduce bien.
    if (motiu.trim() === '') { toast.error(t('alb.reason_required')); return }
    setOcupat(true)
    const r = await anularAssignacio(c.id, motiu)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    setAnullant(false)
    toast.success(t('asg.ok_anula'))
    onFet()
  }

  return (
    <>
      <BotoIcona icona={Pencil} etiqueta={t('asg.modifica')}
        disabled={ocupat || !potAprovar || Boolean(noMod)}
        motiu={motiuRol ?? (noMod ? t(noMod) : undefined)}
        onClick={() => setModificant(true)} />
      {esVenda && (
        <BotoIcona icona={Euro} etiqueta={t('asg.fixa_preu')}
          disabled={ocupat || !potAprovar || Boolean(noPreu)}
          motiu={motiuRol ?? (noPreu ? t(noPreu) : undefined)}
          onClick={() => setFixantPreu(true)} />
      )}
      <BotoIcona icona={Ban} etiqueta={t('asg.anula')} className="text-error"
        disabled={ocupat || !potAprovar || Boolean(noAnul)}
        motiu={motiuRol ?? (noAnul ? t(noAnul) : undefined)}
        onClick={() => setAnullant(true)} />

      <DialegModificaAssignacio
        obert={modificant}
        onObert={setModificant}
        c={c}
        kgMaxim={kgMaxim}
        idPrefix={`${idPrefix}-mod`}
        onFet={() => { setModificant(false); onFet() }}
      />
      {esVenda && (
        <DialegPreuAcordat
          obert={fixantPreu}
          onObert={setFixantPreu}
          c={c}
          idPrefix={`${idPrefix}-preu`}
          onFet={() => { setFixantPreu(false); onFet() }}
        />
      )}
      <DialegMotiu
        obert={anullant}
        onObert={setAnullant}
        titol={t('asg.anula')}
        descripcio={t('asg.anula_desc')}
        etiqueta={t('alb.cancel_reason')}
        confirmar={t('asg.anula')}
        destructiu
        ocupat={ocupat}
        onConfirma={(m) => void anulla(m)}
      />
    </>
  )
}

/** «Modifica»: kilos y fecha/hora de recogida. Solo se manda lo que ha cambiado. */
function DialegModificaAssignacio({ obert, onObert, c, kgMaxim, idPrefix, onFet }: {
  obert: boolean
  onObert: (v: boolean) => void
  c: AssignacioFila
  kgMaxim: number | null
  idPrefix: string
  onFet: () => void
}) {
  const { t } = useT()
  const kgInicial = c.kg_confirmados != null ? String(c.kg_confirmados) : ''
  const recInicial = localDateTime(c.data_hora_recollida)
  const [kg, setKg] = useState(kgInicial)
  const [rec, setRec] = useState(recInicial)
  const [ocupat, setOcupat] = useState(false)

  // Cada vez que se abre, parte de lo que hay ahora (no de lo que se tecleó la vez anterior).
  useEffect(() => {
    if (obert) { setKg(kgInicial); setRec(recInicial) }
  }, [obert, kgInicial, recInicial])

  async function desa() {
    const nKg = Number(kg.replace(',', '.'))
    if (!nKg || nKg <= 0) { toast.error(t('appr.need_kg')); return }
    if (kgMaxim != null && nKg > Number(kgMaxim)) { toast.error(t('mk.max_kg', { n: fmtKg(kgMaxim) })); return }
    const canviaKg = nKg !== Number(c.kg_confirmados ?? 0)
    const canviaRec = rec !== '' && rec !== recInicial
    if (!canviaKg && !canviaRec) { toast.error(t('asg.err_cal_canvi')); return }
    setOcupat(true)
    const r = await modificarAssignacio({
      canalitzacioId: c.id,
      kg: canviaKg ? nKg : null,
      recollida: canviaRec ? new Date(rec).toISOString() : null,
    })
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('asg.ok_modifica'))
    onFet()
  }

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('asg.modifica_t')}</DialogTitle>
          <DialogDescription>{t('asg.modifica_desc')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-kg`}>{t('od.f_kg_assignats')}</Label>
            <Input id={`${idPrefix}-kg`} type="number" inputMode="decimal" min="0" step="0.01"
              max={kgMaxim != null ? String(kgMaxim) : undefined}
              value={kg} onChange={(e) => setKg(e.target.value)} />
            {kgMaxim != null && (
              <p className="text-xs text-muted-foreground">{t('mk.max_kg', { n: fmtKg(kgMaxim) })}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-rec`}>{t('appr.recollida')}</Label>
            <Input id={`${idPrefix}-rec`} type="datetime-local"
              value={rec} onChange={(e) => setRec(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-8" onClick={() => onObert(false)} disabled={ocupat}>
            {t('c.cancel')}
          </Button>
          <Button className="h-11 whitespace-normal md:h-8" disabled={ocupat} onClick={() => void desa()}>
            {t('c.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** «Fixa el preu acordat» de una venta, con la aceptación del ofertante. */
function DialegPreuAcordat({ obert, onObert, c, idPrefix, onFet }: {
  obert: boolean
  onObert: (v: boolean) => void
  c: AssignacioFila
  idPrefix: string
  onFet: () => void
}) {
  const { t } = useT()
  const preuInicial = c.preu_acordat_kg != null ? String(c.preu_acordat_kg) : ''
  const acceptatInicial = Boolean(c.preu_acceptat_at)
  const [preu, setPreu] = useState(preuInicial)
  const [acceptat, setAcceptat] = useState(acceptatInicial)
  const [ocupat, setOcupat] = useState(false)

  useEffect(() => {
    if (obert) { setPreu(preuInicial); setAcceptat(acceptatInicial) }
  }, [obert, preuInicial, acceptatInicial])

  async function desa() {
    const n = Number(preu.replace(',', '.'))
    if (preu.trim() === '' || Number.isNaN(n) || n < 0) { toast.error(t('asg.err_cal_preu')); return }
    setOcupat(true)
    const r = await fixarPreuAcordat(c.id, n, acceptat)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('asg.ok_preu'))
    onFet()
  }

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('asg.fixa_preu')}</DialogTitle>
          <DialogDescription>{t('asg.fixa_preu_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-preu`}>{t('asg.preu_acordat')}</Label>
            <Input id={`${idPrefix}-preu`} type="number" inputMode="decimal" min="0" step="0.01"
              value={preu} onChange={(e) => setPreu(e.target.value)} />
          </div>
          <FilaCasella checked={acceptat} onChange={setAcceptat}>{t('asg.preu_acceptat')}</FilaCasella>
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11 md:h-8" onClick={() => onObert(false)} disabled={ocupat}>
            {t('c.cancel')}
          </Button>
          <Button className="h-11 whitespace-normal md:h-8" disabled={ocupat} onClick={() => void desa()}>
            {t('c.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
