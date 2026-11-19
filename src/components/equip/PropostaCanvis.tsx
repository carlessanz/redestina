// La propuesta de cambios del equipo a un interés, del lado del equipo (fase 5 de los puntos
// 4-6, Excel 5.2 nivel 2). Tres piezas, las tres con la misma lógica (`lib/propostaCanvis.ts`):
//
//   · `DialegProposarCanvis` — «Proposa canvis»: kilos, modalidad, día y hora de recogida y el
//     motivo (obligatorio), precargados con lo que pidió la entidad → `proposar_canvis`. Lo abre
//     `FormulariAprovacio`, así que está en Aprovacions, la ficha de la oferta y el ciclo guiado.
//   · `PropostaEsperant` — la ficha de la oferta, con la propuesta hecha y la entidad sin
//     contestar: lo que cambia y el motivo, y dos acciones por la vía asistida: «Accepta en nom
//     de l'entitat» y «Retira la proposta» (= rechazarla en su nombre, con motivo).
//   · `AvisPropostaResposta` — la cola de Aprovacions cuando el interés ha vuelto: la entidad la
//     rechazó (y por qué) o la aceptó en una venta y falta el precio.
//
// Solo `pot_aprovar()`: el técnico no ve «Proposa canvis» (lo decide quien llama), y la base
// lo vuelve a comprobar (42501).
//
// ⚠️ La hora propuesta NO se limita a la franja de la oferta: el equipo puede haberlo hablado
//    con las partes (misma regla que asignar o modificar). La franja sale como guía y, si la hora
//    cae fuera, se avisa sin bloquear.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { kg as fmtKg } from '../../lib/format'
import { hhmm, textFranja } from '../../lib/franja'
import { modalitatsOferta } from '../../lib/modalitats'
import { argsProposta, estatProposta, formInicialProposta } from '../../lib/propostaCanvis'
import type { FormProposta, RespostaAmbProposta } from '../../lib/propostaCanvis'
import { proposarCanvis, respondreProposta } from '../../lib/propostaCanvisApi'
import type { Modalitat } from '../../types'
import { useConfirma } from '../DialegConfirma'
import DialegMotiu from '../DialegMotiu'
import SelectorModalitat from '../SelectorModalitat'
import CanvisProposta from '../CanvisProposta'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** Lo que hace falta de la oferta: sus modalidades y la franja (como guía). */
export interface OfertaProposable {
  modalitat: string | null
  modalitats?: Modalitat[] | string[] | null
  hora_recollida_inici?: string | null
  hora_recollida_fi?: string | null
}

/** Y de la respuesta: lo que pidió la entidad. */
export interface RespostaProposable {
  id: string
  kg_solicitados: number | null
  modalitat?: Modalitat | string | null
  recollida_at?: string | null
}

const ERRORS_FORM: Record<'cal_kg' | 'cal_motiu' | 'cal_canvi' | 'motiu_llarg', string> = {
  cal_kg: 'appr.need_kg',
  cal_motiu: 'prop.err_cal_motiu',
  cal_canvi: 'asg.err_cal_canvi',
  motiu_llarg: 'prop.err_motiu_llarg',
}

export default function DialegProposarCanvis({
  obert, onObert, resposta, oferta, entitat, idPrefix, onFet,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  resposta: RespostaProposable
  oferta: OfertaProposable
  /** El nombre de la entidad, para la descripción. */
  entitat?: string | null
  idPrefix: string
  onFet: () => void
}) {
  const { t } = useT()
  const mods = modalitatsOferta({
    modalitat: oferta.modalitat as Modalitat | null,
    modalitats: (oferta.modalitats ?? null) as Modalitat[] | null,
  })
  const [form, setForm] = useState<FormProposta>(() => formInicialProposta(resposta, mods))
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)

  // Cada vez que se abre, desde lo que pidió la entidad: reabrirlo no arrastra lo de antes.
  useEffect(() => {
    if (!obert) return
    setForm(formInicialProposta(resposta, mods))
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, [obert])

  const canvia = (c: Partial<FormProposta>) => { setForm((f) => ({ ...f, ...c })); setError(null) }

  // La franja como guía: si la hora propuesta cae fuera, se dice (no bloquea).
  const franja = textFranja(oferta.hora_recollida_inici, oferta.hora_recollida_fi)
  const horaTriada = form.recollida.slice(11, 16)
  const foraFranja = Boolean(franja && horaTriada
    && (horaTriada < hhmm(oferta.hora_recollida_inici) || horaTriada > hhmm(oferta.hora_recollida_fi)))

  async function envia() {
    const a = argsProposta(form, resposta)
    if (!a.ok) { setError(t(ERRORS_FORM[a.error])); return }
    setOcupat(true)
    const r = await proposarCanvis({
      resposta: resposta.id, kg: a.kg, modalitat: a.modalitat, recollidaAt: a.recollidaAt, motiu: a.motiu,
    })
    setOcupat(false)
    if (!r.ok) { setError(textError(t, r)); return }
    toast.success(t('prop.ok_proposada'))
    onObert(false)
    onFet()
  }

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!ocupat) onObert(v) }}>
      {/* No se cierra al pinchar fuera: con un motivo escrito, un clic despistado es caro. */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}
        data-testid="dialeg-proposar-canvis">
        <DialogHeader>
          <DialogTitle>{t('prop.titol')}</DialogTitle>
          <DialogDescription>{t('prop.desc', { entitat: entitat ?? '—' })}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-kg`}>{t('prop.f_kg')}</Label>
            <Input id={`${idPrefix}-kg`} type="number" inputMode="decimal" min="0" step="0.01"
              className="h-11 text-base md:h-9 md:text-sm"
              value={form.kg} onChange={(e) => canvia({ kg: e.target.value })} />
            {resposta.kg_solicitados != null && (
              <p className="text-xs text-muted-foreground">{t('prop.demanat_kg', { kg: fmtKg(resposta.kg_solicitados) })}</p>
            )}
          </div>
          {mods.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-mode`}>{t('mod.entrega')}</Label>
              <SelectorModalitat id={`${idPrefix}-mode`} modalitats={mods} valor={form.modalitat} ambBuit
                className="h-11 w-full md:h-9" onCanvi={(m) => canvia({ modalitat: m })} />
              {resposta.modalitat && (
                <p className="text-xs text-muted-foreground">{t('prop.demanat_mod', { mod: t(`od.mod_${resposta.modalitat}`) })}</p>
              )}
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${idPrefix}-rec`}>{t('prop.f_recollida')}</Label>
            <Input id={`${idPrefix}-rec`} type="datetime-local"
              className="h-11 text-base md:h-9 md:text-sm"
              value={form.recollida} onChange={(e) => canvia({ recollida: e.target.value })} />
            <p className="text-xs text-muted-foreground">
              {franja ? t('prop.franja', { franja }) : t('prop.sense_franja')}
            </p>
            {foraFranja && <p className="text-xs text-aviso">{t('prop.fora_franja')}</p>}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`${idPrefix}-motiu`}>{t('prop.f_motiu')}</Label>
            <Textarea id={`${idPrefix}-motiu`} rows={3} value={form.motiu} maxLength={1000}
              placeholder={t('prop.f_motiu_ph')}
              onChange={(e) => canvia({ motiu: e.target.value })} />
            <p className="text-xs text-muted-foreground">{t('prop.f_motiu_ajuda')}</p>
          </div>
        </div>

        <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('prop.que_passa')}</p>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" className="h-11 md:h-9" disabled={ocupat} onClick={() => onObert(false)}>
            {t('c.cancel')}
          </Button>
          <Button className="h-11 whitespace-normal md:h-9" disabled={ocupat} onClick={() => void envia()}>
            {t(ocupat ? 'c.sending' : 'prop.envia')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * La ficha de la oferta del equipo con una propuesta esperando a la entidad: qué cambia, por qué
 * y las dos acciones asistidas. «Retira» es rechazarla en nombre de la entidad: el interés vuelve
 * a la cola con lo que pidió.
 */
export function PropostaEsperant({ resposta, potAprovar, onFet }: {
  resposta: RespostaAmbProposta & { id: string }
  potAprovar: boolean
  onFet: () => void
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [ocupat, setOcupat] = useState(false)
  const [retirant, setRetirant] = useState(false)

  async function accepta() {
    if (!(await confirma({
      titol: t('prop.accepta_nom_t'),
      descripcio: t('prop.accepta_nom_desc'),
      confirmar: t('prop.accepta_nom'),
    }))) return
    setOcupat(true)
    const r = await respondreProposta({ resposta: resposta.id, accepta: true })
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t(r.data.resultat === 'pendent_preu' ? 'prop.ok_acceptada_preu' : 'prop.ok_acceptada'))
    onFet()
  }

  async function retira(motiu: string) {
    setOcupat(true)
    const r = await respondreProposta({ resposta: resposta.id, accepta: false, motiu })
    setOcupat(false)
    setRetirant(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('prop.ok_retirada'))
    onFet()
  }

  return (
    <div className="w-full space-y-2 rounded-md bg-aviso-fondo p-3 text-aviso" data-testid="proposta-esperant">
      <p className="text-sm font-medium">{t('prop.esperant')}</p>
      <div className="text-foreground"><CanvisProposta resposta={resposta} /></div>
      {potAprovar && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="h-11 whitespace-normal md:h-8" disabled={ocupat} onClick={() => void accepta()}>
            {t('prop.accepta_nom')}
          </Button>
          <Button size="sm" variant="outline" className="h-11 whitespace-normal md:h-8" disabled={ocupat}
            onClick={() => setRetirant(true)}>
            {t('prop.retira')}
          </Button>
        </div>
      )}
      <DialegMotiu
        obert={retirant}
        onObert={setRetirant}
        titol={t('prop.retira')}
        descripcio={t('prop.retira_desc')}
        etiqueta={t('prop.retira_motiu')}
        confirmar={t('prop.retira')}
        ocupat={ocupat}
        onConfirma={(m) => void retira(m)}
      />
      {dialeg}
    </div>
  )
}

/**
 * En la cola de Aprovacions, un interés que ha vuelto de una propuesta: la entidad la rechazó
 * (con su motivo, si lo dio) o la aceptó en una venta y lo que falta es aprobar con el precio.
 * Nada si no viene de ninguna propuesta.
 */
export function AvisPropostaResposta({ resposta }: { resposta: RespostaAmbProposta }) {
  const { t } = useT()
  const e = estatProposta(resposta)
  if (e === 'rebutjada') {
    return (
      <p className="rounded-md bg-aviso-fondo px-2 py-1 text-sm text-aviso" data-testid="proposta-rebutjada">
        {resposta.proposta_resposta_motiu
          ? t('prop.rebutjada_motiu', { motiu: resposta.proposta_resposta_motiu })
          : t('prop.rebutjada')}
      </p>
    )
  }
  if (e === 'acceptada_preu') {
    return (
      <div className="space-y-1 rounded-md bg-exito-fondo px-2 py-1 text-sm text-exito" data-testid="proposta-acceptada-preu">
        <p>{t('prop.acceptada_preu')}</p>
        <div className="text-foreground"><CanvisProposta resposta={resposta} ambMotiu={false} /></div>
      </div>
    )
  }
  return null
}
