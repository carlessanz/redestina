// «Registra la recollida (en nom de X)» (27-10-2026, gestión autónoma, fase 3). Sustituye a
// «Confirma la recollida», que pedía los kilos en un formulario propio y los confirmaba por un
// camino distinto del de la receptora.
//
// Arriba, la ficha de la operación (`FitxaOperacio`): qué, cuánto, quién y dónde, lo mismo
// que ven las partes. Debajo, según en qué punto esté la recogida:
//
// - **sin registrar** → el MISMO formulario que ve la receptora (`RegistraRecollida`) en modo
//   asistido: `registrar_recollida_assistida()` registra y valida en una transacción, y salen
//   las mismas filas y los mismos albaranes que si lo hubiera hecho ella (R1);
// - **registrada por la entidad y sin validar** → lo que falta es validar: el formulario de
//   «Recollides per validar» de Aprovacions, con la misma RPC (`validar_recollida()`);
// - **validada** → se dice, y se enseña lo que ha salido (fase 3 de los puntos 4-6): en una
//   donación, su ENT y su REC ya conciliados con «Veure», «Descarrega» y «Comparteix»
//   (`AlbaransRecollida`); en una venta o maquila, que no tiene albarán, sus documentos propios
//   (`DocumentsCanalitzacio`).
//
// Lo abren la ficha de la oferta («Registrar la recollida», por canalización), el ciclo guiado y
// la ficha del albarán.
//
// ⚠️ No se cierra al pinchar fuera, como los otros diálogos asistidos: con los kilos tecleados
//    y a media llamada, un clic despistado sería caro.

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { kg as kgFmt } from '../../lib/format'
import { textError } from '../../lib/textError'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import { carregaOperacio, validaRecollida } from '../../lib/operacio'
import type { Operacio, ResultatValidaRecollida } from '../../lib/operacio'
import {
  clauErrorValidacio, estatValidacio, llegeixKg, validacioCalMotiu,
} from '../../lib/registreRecollida'
import { esVendaOMaquila } from '../../lib/albaransRecollida'
import FitxaOperacio from '../FitxaOperacio'
import RegistraRecollida from '../RegistraRecollida'
import CarregantSeccio from '../CarregantSeccio'
import DocumentsCanalitzacio from '../DocumentsCanalitzacio'
import AlbaransRecollida from './AlbaransRecollida'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export default function DialegRegistraRecollida({
  canalitzacio, entitat, onTancar, onFet,
}: {
  /** La canalización; `null` = cerrado. */
  canalitzacio: string | null
  /** Para el título, mientras la ficha carga. */
  entitat?: string | null
  onTancar: () => void
  onFet?: () => void
}) {
  const { t } = useT()
  const [op, setOp] = useState<Operacio | null | undefined>(undefined)
  // Sube al acabar: la ficha de arriba vuelve a leerse con los kilos y los números nuevos.
  const [versio, setVersio] = useState(0)

  useEffect(() => {
    if (!canalitzacio) { setOp(undefined); return }
    let viu = true
    setOp(undefined)
    void carregaOperacio(canalitzacio).then((o) => { if (viu) setOp(o) })
    return () => { viu = false }
  }, [canalitzacio, versio])

  const nom = op?.entitat_nom ?? entitat ?? ''
  const fet = () => { setVersio((v) => v + 1); onFet?.() }

  return (
    <Dialog open={canalitzacio != null} onOpenChange={(o) => { if (!o) onTancar() }}>
      <DialogContent
        className="max-h-[88dvh] w-[95vw] max-w-none overflow-y-auto p-4 sm:max-w-none sm:p-6 md:w-[80vw]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('rrec.as_title', { entitat: nom })}</DialogTitle>
          <DialogDescription>{t('rrec.as_desc')}</DialogDescription>
        </DialogHeader>

        {canalitzacio && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <FitxaOperacio key={`${canalitzacio}-${versio}`} canalizacionId={canalitzacio} />
            </div>
            <div className="min-w-0">
              {op === undefined ? <CarregantSeccio files={2} ambCapcalera={false} />
                : op === null ? <p className="text-sm text-error">{t('op.err')}</p>
                  : <AccioRecollida op={op} versio={versio} onTancar={onTancar} onFet={fet} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Qué se puede hacer con esta recogida, según en qué punto está. Validada, lo que queda es lo
 * que ha salido (fase 3 de los puntos 4-6): en una donación, su ENT y su REC con «Veure»,
 * «Descarrega» y «Comparteix»; en una venta o maquila sin albarán, los documentos propios.
 */
function AccioRecollida({ op, versio, onTancar, onFet }: {
  op: Operacio; versio: number; onTancar: () => void; onFet: () => void
}) {
  const { t } = useT()
  const estat = estatValidacio(op)
  // Sin albarán de salida: una venta o maquila del modelo nuevo (un OPE heredado sí lo tiene).
  const senseAlbara = esVendaOMaquila(op.modalitat) && !op.albara_numero

  if (estat === 'validada' || op.estat_recollida === 'confirmada' || op.estat_recollida === 'conciliada') {
    return (
      <div className="space-y-3" data-testid="recollida-validada">
        <div className="flex items-start gap-2 rounded-lg bg-exito-fondo p-3 text-sm text-exito">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0">
            {senseAlbara
              ? t('rrec.as_ja_validada_venda', { kg: kgFmt(op.kg_rebuts) })
              : t('rrec.as_ja_validada')}
          </p>
        </div>
        {senseAlbara ? (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">{t('dcan.title')}</p>
            <DocumentsCanalitzacio canalitzacio={op.canalizacion_id} idPrefix={`drr-doc-${op.canalizacion_id}`} />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('arec.title')}</p>
            <AlbaransRecollida canalitzacio={op.canalizacion_id} excedentId={op.excedente_id} versio={versio} />
          </div>
        )}
      </div>
    )
  }
  if (estat === 'pendent_validacio') return <FormulariValidacio op={op} onFet={onFet} />
  return <RegistraRecollida op={op} mode="assistit" onCancel={onTancar} onFet={onFet} />
}

/**
 * Validar lo que ya registró la entidad: el formulario de «Recollides per validar»
 * (Aprovacions), aquí sin salir del ciclo. Los kilos salen prellenados con lo declarado; el
 * motivo es obligatorio si hay diferencia con lo asignado o si se corrige lo declarado (la
 * base lo exige igual: `cal_motiu_validacio`).
 */
function FormulariValidacio({ op, onFet }: { op: Operacio; onFet: () => void }) {
  const { t } = useT()
  const assignats = op.kg_assignats != null ? Number(op.kg_assignats) : null
  const declaratsRaw = op.kg_declarats ?? op.incidencia_recollida?.kg_reals ?? null
  const declarats = declaratsRaw != null ? Number(declaratsRaw) : null
  const [kg, setKg] = useState(declarats != null ? String(declarats).replace('.', ',') : '')
  const [motiu, setMotiu] = useState('')
  const [intentat, setIntentat] = useState(false)
  const [ocupat, setOcupat] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fet, setFet] = useState<ResultatValidaRecollida | null>(null)

  const kgFinal = kg.trim() === '' ? declarats : llegeixKg(kg)
  const calMotiu = validacioCalMotiu({ kg: kgFinal, kgAssignats: assignats, kgDeclarats: declarats })
  const errKg = intentat && (kgFinal == null || kgFinal <= 0)
  const errMotiu = intentat && calMotiu && motiu.trim() === ''
  const dif = kgFinal != null && assignats != null ? Math.round((kgFinal - assignats) * 100) / 100 : null
  // Venta o maquila: sin albarán desde la fase 3; con un OPE heredado, el camino de antes.
  const venda = esVendaOMaquila(op.modalitat)
  const senseAlbara = venda && !op.albara_numero
  const motiuReceptor = op.incidencia_recollida?.descripcion ?? null

  async function valida() {
    setIntentat(true)
    setError(null)
    if (kgFinal == null || kgFinal <= 0) return
    if (calMotiu && motiu.trim() === '') return
    setOcupat(true)
    const r = await validaRecollida({
      canalitzacio: op.canalizacion_id,
      // Null = lo que declaró la entidad; solo se manda si el admin lo ha corregido.
      kg: declarats != null && Math.abs(kgFinal - declarats) < 0.001 ? null : kgFinal,
      motiu: motiu.trim() || null,
    })
    setOcupat(false)
    if (!r.ok) {
      const clau = clauErrorValidacio(r.missatge, r.codi)
      setError(clau ? t(clau) : textError(t, r))
      return
    }
    setFet(r.data)
    toast.success(t('vrec.ok'))
    void refrescaComptadors()
    onFet()
  }

  if (fet) {
    return (
      <div className="space-y-2 rounded-lg bg-exito-fondo p-3 text-sm text-exito" data-testid="validacio-feta">
        <p className="font-medium">
          {t(fet.sense_albara ? 'vrec.fet_sense_albara' : fet.conciliat ? 'vrec.fet_conciliat' : 'vrec.fet')}
        </p>
        {fet.albara && <p>{t('vrec.fet_sortida', { num: fet.albara })}</p>}
        {fet.rec?.numero && <p>{t('vrec.fet_rec', { num: fet.rec.numero })}</p>}
        {fet.esperant_altres && !fet.rec?.numero && <p>{t('vrec.fet_esperant')}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div>
        <p className="font-medium">{t('rrec.as_validar_t')}</p>
        <p className="text-sm tabular-nums text-muted-foreground">
          {t('vrec.kg', {
            a: assignats != null ? kgFmt(assignats) : '—',
            d: declarats != null ? kgFmt(declarats) : '—',
          })}
        </p>
        {motiuReceptor && (
          <p className="mt-1 text-sm">{t('vrec.motiu_receptor', { motiu: motiuReceptor })}</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="drr-kg">{t('vrec.f_kg')}</Label>
          <Input id="drr-kg" inputMode="decimal" className="text-base md:text-sm"
            value={kg} onChange={(e) => setKg(e.target.value)} aria-invalid={errKg || undefined} />
          {dif != null && dif !== 0 && assignats != null && (
            <p className="text-xs text-aviso">
              {t('vrec.dif_assignats', { a: kgFmt(assignats), dif: dif > 0 ? `+${kgFmt(dif)}` : kgFmt(dif) })}
            </p>
          )}
          {errKg && <p role="alert" className="text-sm text-error">{t('rrec.err_kg')}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="drr-motiu">{t(calMotiu ? 'vrec.f_motiu_obl' : 'vrec.f_motiu')}</Label>
          <Textarea id="drr-motiu" rows={3} value={motiu} onChange={(e) => setMotiu(e.target.value)}
            aria-invalid={errMotiu || undefined} placeholder={t('vrec.f_motiu_ph')} />
          {errMotiu && <p role="alert" className="text-sm text-error">{t('vrec.err_cal_motiu')}</p>}
        </div>
      </div>
      {/* Lo que va a pasar, antes de pulsar: documentos con número legal (o, en una venta o
          maquila sin albarán, la recogida conciliada sin documento de Redestina). */}
      <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">
        {t(senseAlbara ? 'vrec.avis_venda' : venda ? 'vrec.avis_ope' : 'vrec.avis', { kg: kgFinal != null ? kgFmt(kgFinal) : '—' })}
      </p>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <div className="flex justify-end">
        <Button className="h-11 w-full whitespace-normal sm:w-auto md:h-8" disabled={ocupat} onClick={() => void valida()}>
          {ocupat && <Loader2 className="size-4 animate-spin" />}{t(senseAlbara ? 'vrec.dlg_go_venda' : 'vrec.dlg_go')}
        </Button>
      </div>
    </div>
  )
}
