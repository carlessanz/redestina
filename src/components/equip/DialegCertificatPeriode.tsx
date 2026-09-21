// Certificado de donación A DEMANDA: «lo que este donante lleva donado a fecha de hoy».
//
// POR QUÉ EXISTE. El backend está entero desde la fase 5 —`cierres_periodo`, seis RPC, la
// plantilla `CD/parcial`, el renderizador— y hasta hoy **no lo llamaba nadie**: no había
// ninguna pantalla, así que la única forma de emitir uno era SQL a mano. El equipo lo pedía
// para poder dar a una organización su certificado sin esperar al cierre de diciembre.
//
// ⚠️ **CALCULAR YA ESCRIBE.** `calcular_certificado_periodo()` inserta la fila de
//    `cierres_periodo` antes de que nadie decida emitir: es lo que permite enseñar kilos,
//    importe y bloqueos *antes* de quemar un número de serie. El precio es que probar tres
//    ventanas deja tres borradores sin número (deuda §12.112), y por eso el botón de emitir
//    exige haber calculado: sin ese paso no hay nada que emitir.
//
// ⚠️ **El modo NO se elige aquí**, se deduce de `es_test` de la ficha. Un desplegable de
//    prueba/real en esta pantalla sería una forma de mandarle a un donante real un
//    certificado con marca de agua, o al revés: uno con efecto fiscal a una ficha de prueba.
//
// ⚠️ Los errores de la base se enseñan **tal cual**. Los tres que salen de verdad —la ventana
//    cruza dos ejercicios, termina en el futuro, esa ventana ya tiene certificado— vienen
//    redactados y con las fechas dentro; cualquier texto nuestro diría menos.

import { useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { calcularCertificatPeriode, emetreCertificatPeriode, bloqueja, euros } from '../../lib/tancament'
import { kg } from '../../lib/albarans'
import { useConfirma } from '../DialegConfirma'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import Bloquejos from './Bloquejos'
import { bloquejaProvisionals } from '../../lib/canalitzacio'
import type { CierrePeriodo } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** Hoy en hora de Madrid. `sv-SE` da `AAAA-MM-DD`, que es lo que espera un input de fecha. */
function avui(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
}

interface Props {
  obert: boolean
  onTancar: () => void
  productorId: string
  /** Deducido de `es_test`: decide la serie, la marca de agua y a quién se escribe. */
  modo: 'prueba' | 'real'
  /** Con datos fiscales provisionales la base se niega (42501): mejor decirlo antes. */
  provisionals: boolean
  onEmes: () => void
}

export default function DialegCertificatPeriode(
  { obert, onTancar, productorId, modo, provisionals, onEmes }: Props,
) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const hoy = avui()
  const [desde, setDesde] = useState(`${hoy.slice(0, 4)}-01-01`)
  const [hasta, setHasta] = useState(hoy)
  const [calcul, setCalcul] = useState<CierrePeriodo | null>(null)
  const [ocupat, setOcupat] = useState(false)

  // Cambiar una fecha invalida el cálculo: si no, se emitiría una ventana distinta de la
  // que el equipo está viendo en pantalla.
  function canviaData(quin: 'desde' | 'hasta', valor: string) {
    if (quin === 'desde') setDesde(valor); else setHasta(valor)
    setCalcul(null)
  }

  async function calcula() {
    setOcupat(true)
    const res = await calcularCertificatPeriode({ productor: productorId, desde, hasta, modo })
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    setCalcul(res.data)
  }

  async function emet() {
    if (!calcul) return
    if (modo === 'real') {
      const ok = await confirma({
        titol: t('cdp.confirm_t', { desde, fins: hasta }),
        descripcio: t('cdp.confirm', { serie: 'CDP' }),
        confirmar: t('cdp.a_emit'),
        destructiu: true,
      })
      if (!ok) return
    }
    setOcupat(true)
    const res = await emetreCertificatPeriode(calcul.id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('cdp.done', { n: res.data.numero ?? '' }))
    if ((res.data.substitueix ?? 0) > 0) {
      toast.info(t('cdp.done_subst', { m: res.data.substitueix ?? 0 }))
    }
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
          <DialogTitle>{t('cdp.title')}</DialogTitle>
          <DialogDescription>{t('cdp.desc')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground" htmlFor="cdp-desde">
              {t('cdp.f_from')}
            </Label>
            <Input
              id="cdp-desde" type="date" value={desde} max={hoy}
              onChange={(e) => canviaData('desde', e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground" htmlFor="cdp-hasta">
              {t('cdp.f_to')}
            </Label>
            {/* `max` es hoy: la base rechaza una ventana que acabe en el futuro, y es mejor
                no dejar escribirla que explicar después por qué no vale. */}
            <Input
              id="cdp-hasta" type="date" value={hasta} max={hoy}
              onChange={(e) => canviaData('hasta', e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={calcul ? 'outline' : 'default'}
            className="h-11 whitespace-normal md:h-9"
            disabled={ocupat}
            onClick={() => void calcula()}
          >
            {t('cdp.a_calc')}
          </Button>
          <BotoAmbMotiu
            className="h-11 whitespace-normal md:h-9"
            disabled={ocupat || motiuEmetre !== undefined}
            motiu={motiuEmetre}
            onClick={() => void emet()}
          >
            {t('cdp.a_emit')}
          </BotoAmbMotiu>
        </div>

        {/* El motivo, además, VISIBLE: en táctil no hay hover y el tooltip no cuenta como
            haberlo dicho (§6ter). */}
        {motiuEmetre && <p className="text-sm text-muted-foreground">{motiuEmetre}</p>}

        {calcul && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm">
              {senseKg
                ? t('cdp.no_kg')
                : t('cdp.calculated', { kg: kg(calcul.kg_total), v: euros(calcul.valor_total) })}
            </p>
            <Bloquejos llista={calcul.bloqueos} />
          </div>
        )}

        {dialeg}
      </DialogContent>
    </Dialog>
  )
}
