// El certificado de UNA VENTANA DE FECHAS. Un diálogo, dos documentos:
//
//   · **entidad productora** → certificado de DONACIÓN a demanda (`CDP`, `cierres_periodo`):
//     «lo que este donante lleva donado a fecha de hoy», con su importe.
//   · **entidad receptora**  → certificado de RECEPCIÓN (`CR`, `cierres_receptor`, fase F4):
//     los kilos que le han entrado, donación y compra desglosadas, **y ni un importe**.
//
// POR QUÉ EXISTE. El backend del `CDP` estaba entero desde la fase 5 y **no lo llamaba
// nadie**: la única forma de emitir uno era SQL a mano. Al `CR` le habría pasado lo mismo.
//
// POR QUÉ NO SON DOS DIÁLOGOS. El gesto es exactamente el mismo —elige ventana, calcula,
// mira los bloqueos, emite— y lo que cambia son dos RPC y una línea de resumen. Duplicarlo
// significaría mantener dos veces las guardas que impiden emitir: la de los datos
// provisionales, la de los bloqueos rojos y la de los cero kilos. Y una guarda que falta no
// se nota fallando: se nota emitiendo.
//
// ⚠️ **CALCULAR YA ESCRIBE.** Las dos RPC insertan su fila antes de que nadie decida
//    emitir: es lo que permite enseñar kilos y bloqueos *antes* de quemar un número de
//    serie. El precio es que probar tres ventanas deja tres borradores sin número (deuda
//    §12.112), y por eso el botón de emitir exige haber calculado.
//
// ⚠️ **El modo NO se elige aquí**, se deduce de `es_test` de la ficha. Un desplegable de
//    prueba/real en esta pantalla sería una forma de mandarle a una organización real un
//    certificado con marca de agua, o al revés: uno de verdad a una ficha de prueba.
//
// ⚠️ Los errores de la base se enseñan **tal cual**. Los que salen de verdad —la ventana
//    cruza dos ejercicios, termina en el futuro, esa ventana ya tiene certificado— vienen
//    redactados y con las fechas dentro; cualquier texto nuestro diría menos.

import { useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { calcularCertificatPeriode, emetreCertificatPeriode, bloqueja, euros } from '../../lib/tancament'
import { calcularCertificatRecepcio, emetreCertificatRecepcio } from '../../lib/certificatRecepcio'
import { kg } from '../../lib/albarans'
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

/** Hoy en hora de Madrid. `sv-SE` da `AAAA-MM-DD`, que es lo que espera un input de fecha. */
function avui(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
}

/**
 * Lo que las dos pantallas necesitan del cálculo.
 *
 * `CierrePeriodo` y `CierreReceptor` son dos tablas distintas y comparten solo esto: el id,
 * los kilos y los bloqueos. Lo demás se lee por su nombre en la rama que corresponde, y
 * `valor_total` **no está aquí a propósito** — el certificado de recepción no tiene esa
 * columna, y no es que no se imprima: es que no existe (§4).
 */
interface Calcul {
  id: string
  kg_total: number
  bloqueos: BloqueigCierre[]
  /** Solo en la donación a demanda. En recepción es siempre `undefined`. */
  valor_total?: number
  /** Solo en recepción: el desglose que da sentido a sumar donación y compra en un papel. */
  kg_donacio?: number
  kg_compra?: number
}

const PERFIL = {
  productor: {
    serie: 'CDP',
    titolKey: 'cdp.title',
    descKey: 'cdp.desc',
    accioKey: 'cdp.a_emit',
    buitKey: 'cdp.no_kg',
  },
  entidad: {
    serie: 'CR',
    titolKey: 'crec.title',
    descKey: 'crec.desc',
    accioKey: 'crec.a_emit',
    buitKey: 'crec.no_kg',
  },
} as const

interface Props {
  obert: boolean
  onTancar: () => void
  tipus: 'productor' | 'entidad'
  /** El id de la FICHA: `productores.id` o `entidades.id`. */
  orgId: string
  /** Deducido de `es_test`: decide la serie, la marca de agua y a quién se escribe. */
  modo: 'prueba' | 'real'
  /** Con datos fiscales provisionales la base se niega en modo real (42501): mejor decirlo antes. */
  provisionals: boolean
  onEmes: () => void
}

export default function DialegCertificatPeriode(
  { obert, onTancar, tipus, orgId, modo, provisionals, onEmes }: Props,
) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const perfil = PERFIL[tipus]
  const hoy = avui()
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
    const res = tipus === 'productor'
      ? await calcularCertificatPeriode({ productor: orgId, desde, hasta, modo })
      : await calcularCertificatRecepcio({ entitat: orgId, desde, hasta, modo })
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    setCalcul(res.data as Calcul)
  }

  async function emet() {
    if (!calcul) return
    // En modo real se pregunta: consume numeración legal y no se deshace. En prueba no,
    // porque el ensayo se repite y una confirmación por gesto deja de leerse.
    if (modo === 'real') {
      const ok = await confirma({
        titol: t('cdp.confirm_t', { desde, fins: hasta }),
        descripcio: t('cdp.confirm', { serie: perfil.serie }),
        confirmar: t(perfil.accioKey),
        destructiu: true,
      })
      if (!ok) return
    }
    setOcupat(true)
    const res = tipus === 'productor'
      ? await emetreCertificatPeriode(calcul.id)
      : await emetreCertificatRecepcio(calcul.id)
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
          <DialogTitle>{t(perfil.titolKey)}</DialogTitle>
          <DialogDescription>{t(perfil.descKey)}</DialogDescription>
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
            {t(perfil.accioKey)}
          </BotoAmbMotiu>
        </div>

        {/* El motivo, además, VISIBLE: en táctil no hay hover y el tooltip no cuenta como
            haberlo dicho (§6ter). */}
        {motiuEmetre && <p className="text-sm text-muted-foreground">{motiuEmetre}</p>}

        {calcul && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm">
              {senseKg
                ? t(perfil.buitKey)
                : tipus === 'productor'
                  ? t('cdp.calculated', { kg: kg(calcul.kg_total), v: euros(calcul.valor_total) })
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
