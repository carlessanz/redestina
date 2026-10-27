// Aprobar (o rechazar) el interés de una entidad: un solo formulario para el detalle de la
// oferta, la cola de Aprovacions y el ciclo guiado (gestión autónoma, fase 2).
//
// POR QUÉ UNO SOLO. Había tres: `OfferDetail` y `Aprovacions` pedían kilos, modalidad, hora
// de recogida y precio; el ciclo guiado aprobaba **a ciegas** con los kilos que pidió la
// entidad, sin hora ni precio. Tres formularios del mismo acto acaban aprobando cosas
// distintas. La operación —el aviso de canalizar de más, la comprobación previa de convenios
// y la RPC transaccional— vive en `src/lib/aprovarResposta.ts`; aquí, los campos y los dos
// diálogos (confirmar y motivo del rechazo).
//
// Campos, con lo que pidió la entidad precargado:
//   · kilos asignados (por defecto, los solicitados);
//   · modalidad de la entrega, si la oferta tiene varias (la que pidió, o la única);
//   · fecha y hora de recogida (`datetime-local`, la que pidió; solo se manda si se cambia);
//   · precio, solo si la modalidad elegida es venta o maquila.
//
// ⚠️ `text-base md:text-sm` en todo control (§2, regla 1) y botones a 44 px en móvil.

import { useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { kg as fmtKg } from '../../lib/format'
import { localDateTime } from '../../lib/franja'
import { modalitatsOferta } from '../../lib/modalitats'
import { aprovarResposta, comprovaConvenis, rebutjarResposta } from '../../lib/aprovarResposta'
import type { Modalitat } from '../../types'
import { useConfirma } from '../DialegConfirma'
import DialegMotiu from '../DialegMotiu'
import SelectorModalitat from '../SelectorModalitat'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import { Input } from '@/components/ui/input'

/** Lo que hace falta de la respuesta: lo que pidió la entidad. */
export interface RespostaAprovable {
  id: string
  entidad_id: string | null
  kg_solicitados: number | null
  preu_ofert?: number | null
  modalitat?: Modalitat | string | null
  recollida_at?: string | null
}

/** Y de la oferta: qué modalidades tiene, quién entrega y el precio mínimo. */
export interface OfertaAprovable {
  modalitat: string | null
  modalitats?: Modalitat[] | string[] | null
  productor_id: string | null
  preu_minim: number | null
}

interface Props {
  resposta: RespostaAprovable
  oferta: OfertaAprovable
  /** Lo que falta por cubrir de la oferta: es contra lo que se avisa al canalizar de más. */
  faltan: number
  potAprovar: boolean
  /** Un motivo que impide aprobar ahora (p. ej. sin convenio vigente), ya traducido. */
  bloqueig?: string
  /** Prefijo de los `id` de los campos. */
  idPrefix: string
  /** Tras aprobar o rechazar: la pantalla relee lo suyo. */
  onFet: (resultat: 'aprovada' | 'rebutjada') => void
  /** Acciones de más al lado de los botones (p. ej. «Obre l'oferta» en la cola). */
  children?: ReactNode
}

export default function FormulariAprovacio({
  resposta, oferta, faltan, potAprovar, bloqueig, idPrefix, onFet, children,
}: Props) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const mods = modalitatsOferta({
    modalitat: oferta.modalitat as Modalitat | null,
    modalitats: (oferta.modalitats ?? null) as Modalitat[] | null,
  })
  const demanada = resposta.modalitat && (mods as string[]).includes(resposta.modalitat)
    ? resposta.modalitat as Modalitat
    : null
  const [kg, setKg] = useState(resposta.kg_solicitados != null ? String(resposta.kg_solicitados) : '')
  const [modalitat, setModalitat] = useState<Modalitat | ''>(demanada ?? (mods.length === 1 ? mods[0] : ''))
  const recollidaInicial = localDateTime(resposta.recollida_at)
  const [recollida, setRecollida] = useState(recollidaInicial)
  // Si la entidad no dijo precio, se parte del mínimo del productor, que es el suelo.
  const preuDefecte = resposta.preu_ofert ?? oferta.preu_minim
  const [preu, setPreu] = useState(preuDefecte != null ? String(preuDefecte) : '')
  const [ocupat, setOcupat] = useState(false)
  const [rebutjant, setRebutjant] = useState(false)

  const triada: Modalitat | '' = modalitat || (mods.length === 1 ? mods[0] : '')
  const ambPreuTriat = triada === 'venda' || triada === 'maquila'
  const motiuRol = potAprovar ? undefined : t('appr.need_approver')
  const motiu = motiuRol ?? bloqueig
  const bloquejat = ocupat || !potAprovar || Boolean(bloqueig)

  async function aprova() {
    const nKg = Number(kg.replace(',', '.'))
    if (!resposta.entidad_id || !nKg || nKg <= 0) { toast.error(t('appr.need_kg')); return }
    if (mods.length > 1 && !triada) { toast.error(t('appr.cal_modalitat')); return }
    // Aviso no bloqueante: canalizar más de lo que falta puede ser intencionado.
    if (nKg > faltan && !(await confirma({
      titol: t('od.over_alloc_t'),
      descripcio: t('od.over_alloc', { n: fmtKg(faltan) }),
    }))) return
    // Antes, no después: desde la fecha de corte la base lo rechaza con `sense_conveni` a
    // mitad de operación, y antes solo avisa con un `notice` que nadie ve (§12.78).
    const falta = await comprovaConvenis(
      { modalitat: triada || oferta.modalitat, productor_id: oferta.productor_id },
      resposta.entidad_id, t,
    )
    if (falta && !(await confirma({
      titol: t('od.conv_missing_t'),
      descripcio: t('od.conv_missing', { parts: falta }),
    }))) return

    setOcupat(true)
    const res = await aprovarResposta({
      id: resposta.id,
      kg: nKg,
      preu: ambPreuTriat && preu.trim() !== '' ? Number(preu.replace(',', '.')) : null,
      modalitat: triada || null,
      // Solo si se ha cambiado: si no, vale la que pidió la entidad.
      recollida: recollida && recollida !== recollidaInicial ? new Date(recollida).toISOString() : null,
    })
    setOcupat(false)
    if (!res.ok) { toast.error(textError(t, res)); return }
    toast.success(t('od.approved'))
    onFet('aprovada')
  }

  async function rebutja(motiuRebuig: string) {
    setRebutjant(false)
    setOcupat(true)
    const res = await rebutjarResposta({ id: resposta.id, motiu: motiuRebuig })
    setOcupat(false)
    if (!res.ok) { toast.error(textError(t, res)); return }
    toast.success(t('od.rejected_ok'))
    onFet('rebutjada')
  }

  return (
    // Cada campo con su etiqueta y su unidad a la vista (revisión del 08-10-2026, §3.3).
    <div className="flex flex-wrap items-end gap-2">
      <label htmlFor={`${idPrefix}-kg`} className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('od.f_kg_assignats')}
        <Input id={`${idPrefix}-kg`} type="number" inputMode="decimal" min="0" step="0.01"
          className="h-11 w-24 text-base md:h-9 md:text-sm"
          value={kg} placeholder={t('od.kg_ph')} onChange={(e) => setKg(e.target.value)} />
      </label>
      {mods.length > 1 && (
        <label htmlFor={`${idPrefix}-mode`} className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('mod.entrega')}
          <SelectorModalitat id={`${idPrefix}-mode`} modalitats={mods} valor={triada} ambBuit
            className="h-11 md:h-9" onCanvi={setModalitat} />
        </label>
      )}
      <label htmlFor={`${idPrefix}-rec`} className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('appr.recollida')}
        <Input id={`${idPrefix}-rec`} type="datetime-local"
          className="h-11 w-48 text-base md:h-9 md:text-sm"
          value={recollida} onChange={(e) => setRecollida(e.target.value)} />
      </label>
      {ambPreuTriat && (
        <label htmlFor={`${idPrefix}-preu`} className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('od.rs_preu_venda')}
          <Input id={`${idPrefix}-preu`} type="number" inputMode="decimal" step="0.01" min="0"
            className="h-11 w-24 text-base md:h-9 md:text-sm"
            value={preu} placeholder={t('od.rs_preu')} onChange={(e) => setPreu(e.target.value)} />
        </label>
      )}
      <BotoAmbMotiu size="sm" className="h-11 whitespace-normal md:h-9"
        disabled={bloquejat} motiu={motiu}
        onClick={() => void aprova()}>
        {t('od.approve')}
      </BotoAmbMotiu>
      <BotoAmbMotiu size="sm" variant="outline" className="h-11 whitespace-normal md:h-9"
        disabled={ocupat || !potAprovar} motiu={motiuRol}
        onClick={() => setRebutjant(true)}>
        {t('od.reject_appr')}
      </BotoAmbMotiu>
      {children}

      <DialegMotiu
        obert={rebutjant}
        onObert={setRebutjant}
        titol={t('od.reject_appr')}
        descripcio={t('appr.rej_desc')}
        etiqueta={t('appr.rej_reason')}
        confirmar={t('od.reject_appr')}
        destructiu
        onConfirma={(m) => void rebutja(m)}
      />
      {dialeg}
    </div>
  )
}
