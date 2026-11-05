// El certificado de RECEPCIÓN (`CR`, `cierres_receptor`, fase F4) de una entidad receptora:
// los kilos que le han entrado en una ventana de fechas, donación y compra desglosadas, **y
// ni un importe**.
//
// Hasta el 05-11-2026 compartía diálogo con el certificado de donación a demanda
// (`DialegCertificatPeriode`). La donación creció —ámbito oferta/intervalo/ejercicio, fecha de
// expedición, anexo, exclusiones— y se fue a `DialegCertificatDonacio`; el gesto de este, en
// cambio, sigue siendo el mismo de siempre: elige ventana, calcula, mira los bloqueos, emite.
//
// ⚠️ **CALCULAR YA ESCRIBE** (inserta la fila antes de que nadie decida emitir): por eso el
//    botón de emitir exige haber calculado.
// ⚠️ **El modo NO se elige aquí**, se deduce de `es_test` de la ficha.
// ⚠️ Los errores de la base se enseñan tal cual: vienen redactados y con las fechas dentro.

import { useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import AvisCorreuDesactivat from '../AvisCorreuDesactivat'
import { avuiMadrid } from '../../lib/format'
import { textError } from '../../lib/textError'
import { bloqueja } from '../../lib/tancament'
import { calcularCertificatRecepcio, emetreCertificatRecepcio } from '../../lib/certificatRecepcio'
import { dataCurta, kg } from '../../lib/albarans'
import { useConfirma } from '../DialegConfirma'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import Bloquejos from './Bloquejos'
import { bloquejaProvisionals } from '../../lib/canalitzacio'
import type { BloqueigCierre } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** Lo que se pinta del cálculo. Sin `valor_total`: el CR no tiene esa columna (§4). */
interface Calcul {
  id: string
  kg_total: number
  bloqueos: BloqueigCierre[]
  kg_donacio?: number
  kg_compra?: number
}

interface Props {
  obert: boolean
  onTancar: () => void
  /** El id de la FICHA receptora (`entidades.id`). */
  entitatId: string
  /** Deducido de `es_test`: decide la serie, la marca de agua y a quién se escribe. */
  modo: 'prueba' | 'real'
  /** Con datos fiscales provisionales la base se niega en modo real (42501): mejor decirlo antes. */
  provisionals: boolean
  onEmes: () => void
}

export default function DialegCertificatRecepcio(
  { obert, onTancar, entitatId, modo, provisionals, onEmes }: Props,
) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const hoy = avuiMadrid()
  const [desde, setDesde] = useState(`${hoy.slice(0, 4)}-01-01`)
  const [hasta, setHasta] = useState(hoy)
  const [calcul, setCalcul] = useState<Calcul | null>(null)
  const [ocupat, setOcupat] = useState(false)

  // Cambiar una fecha invalida el cálculo: si no, se emitiría una ventana distinta de la
  // que el equipo está viendo en pantalla.
  function canviaData(quin: 'desde' | 'hasta', valor: string) {
    if (quin === 'desde') setDesde(valor); else setHasta(valor)
    setCalcul(null)
  }

  async function calcula() {
    setOcupat(true)
    const res = await calcularCertificatRecepcio({ entitat: entitatId, desde, hasta, modo })
    setOcupat(false)
    if (!res.ok) { toast.error(textError(t, res)); return }
    setCalcul(res.data as Calcul)
  }

  async function emet() {
    if (!calcul) return
    // En modo real se pregunta: consume numeración y no se deshace.
    if (modo === 'real') {
      const ok = await confirma({
        titol: t('crec.confirm_t', { desde: dataCurta(desde), fins: dataCurta(hasta) }),
        descripcio: t('crec.confirm', { serie: 'CR' }),
        confirmar: t('crec.a_emit'),
        destructiu: true,
      })
      if (!ok) return
    }
    setOcupat(true)
    const res = await emetreCertificatRecepcio(calcul.id)
    setOcupat(false)
    if (!res.ok) { toast.error(textError(t, res)); return }
    toast.success(t('cdp.done', { num: res.data.numero ?? '' }))
    onEmes()
    onTancar()
  }

  const senseKg = calcul !== null && Number(calcul.kg_total) <= 0
  const motiuEmetre = !calcul
    ? t('cdp.why_calc_first')
    : bloqueja(calcul.bloqueos)
      ? t('tan.why_blocked')
      : senseKg
        ? t('cdp.why_no_kg')
        : bloquejaProvisionals(provisionals, modo) ? t('tan.why_provisional') : undefined

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('crec.title')}</DialogTitle>
          <DialogDescription>{t('crec.desc')}</DialogDescription>
        </DialogHeader>
        <AvisCorreuDesactivat />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground" htmlFor="crec-desde">
              {t('cdp.f_from')}
            </Label>
            <Input
              id="crec-desde" type="date" value={desde} max={hoy}
              onChange={(e) => canviaData('desde', e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground" htmlFor="crec-hasta">
              {t('cdp.f_to')}
            </Label>
            {/* `max` es hoy: la base rechaza una ventana que acabe en el futuro. */}
            <Input
              id="crec-hasta" type="date" value={hasta} max={hoy}
              onChange={(e) => canviaData('hasta', e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={calcul ? 'outline' : 'default'}
            className="h-11 whitespace-normal md:h-8"
            disabled={ocupat}
            onClick={() => void calcula()}
          >
            {t('cdp.a_calc')}
          </Button>
          <BotoAmbMotiu
            className="h-11 whitespace-normal md:h-8"
            disabled={ocupat || motiuEmetre !== undefined}
            motiu={motiuEmetre}
            onClick={() => void emet()}
          >
            {t('crec.a_emit')}
          </BotoAmbMotiu>
        </div>

        {/* El motivo, además, VISIBLE: en táctil no hay hover (§6ter). */}
        {motiuEmetre && <p className="text-sm text-muted-foreground">{motiuEmetre}</p>}

        {calcul && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm">
              {senseKg
                ? t('crec.no_kg')
                : t('crec.calculated', {
                  kg: kg(calcul.kg_total),
                  d: kg(calcul.kg_donacio),
                  c: kg(calcul.kg_compra),
                })}
            </p>
            <Bloquejos llista={calcul.bloqueos} />
          </div>
        )}

        {dialeg}
      </DialogContent>
    </Dialog>
  )
}
