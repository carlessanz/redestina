// Antes de emitir un certificado ANUAL (uno o la tanda del cierre): la fecha de expedición y
// el anexo por producto. Sustituye a la confirmación simple que había: la pregunta sigue
// siendo «¿emito?», pero ahora con lo que se imprimirá.
//
// La fecha por defecto es el 31-12 del ejercicio (hoy, en un ensayo del ejercicio en curso)
// y la base solo acepta del fin del ejercicio a hoy (`data_expedicio_fora_rang`): el campo
// lleva el mismo rango y el botón no deja confirmar una fecha que la base rechazaría.

import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n'
import { avuiMadrid, dataCurta } from '../../lib/format'
import {
  dataExpedicioPerDefecte, dataExpedicioValida, rangDataExpedicio, rangPossible,
} from '../../lib/certificatsDonacio'
import { FilaCasella } from '../Casella'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export default function DialegExpedicio({
  obert, onObert, titol, descripcio, confirmar, exercici, mode, ocupat, onConfirma,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  titol: string
  descripcio: string
  confirmar: string
  exercici: number
  mode: 'prueba' | 'real'
  ocupat: boolean
  onConfirma: (dataExpedicio: string, annex: boolean) => void
}) {
  const { t } = useT()
  const avui = avuiMadrid()
  const rang = rangDataExpedicio('exercici', { avui, exercici, mode })
  const perDefecte = dataExpedicioPerDefecte('exercici', { avui, exercici, mode })
  const [data, setData] = useState(perDefecte)
  const [annex, setAnnex] = useState(false)

  useEffect(() => {
    if (obert) { setData(perDefecte); setAnnex(false) }
  }, [obert, perDefecte])

  const possible = rangPossible(rang)
  const ok = possible && dataExpedicioValida(data, rang)

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titol}</DialogTitle>
          <DialogDescription>{descripcio}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="exp-data">{t('cdon.f_data_exp')}</Label>
            <Input
              id="exp-data" type="date" value={data}
              min={rang.min ?? undefined} max={rang.max}
              aria-invalid={!ok}
              onChange={(e) => setData(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {possible && rang.min
                ? t('cdon.f_data_exp_rang', { min: dataCurta(rang.min), max: dataCurta(rang.max) })
                : t('cdon.why_rang_impossible')}
            </p>
          </div>
          <FilaCasella checked={annex} onChange={setAnnex}>{t('cdon.f_annex')}</FilaCasella>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11 whitespace-normal md:h-8" onClick={() => onObert(false)} disabled={ocupat}>
            {t('c.cancel')}
          </Button>
          <Button
            className="h-11 whitespace-normal md:h-8"
            variant={mode === 'real' ? 'destructive' : 'default'}
            disabled={ocupat || !ok}
            onClick={() => onConfirma(data, annex)}
          >
            {confirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
