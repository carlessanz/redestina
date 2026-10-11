// «Confirma la recollida» (equipo, 11-10-2026, fase 3 de la revisión del 08-10-2026).
//
// El equipo confirma una recogida en nombre de las partes, con lo que le han dicho por
// teléfono o lo que ha visto: los kilos reales, la fecha y hora, lo que haya pasado y, si
// hay, una foto. Una sola llamada, `confirmar_recollida()`, que en una transacción emite y
// entrega el albarán de salida si hacía falta, confirma por cada parte que falte —con la
// evidencia de siempre y `asistido_por`—, confirma el albarán de recepción cuando ya no le
// falta ninguna salida y concilia si cuadra dentro de la tolerancia.
//
// ⚠️ Si el albarán está en borrador, confirmar lo EMITE: consume un número de la serie
//    legal. El diálogo lo dice antes de pulsar.
// ⚠️ La foto se sube DESPUÉS, sobre el albarán ya emitido: un borrador no tiene ejercicio,
//    y la carpeta de un documento externo sale del ejercicio de su objeto.
// ⚠️ No se cierra al pinchar fuera, como los otros diálogos asistidos.

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { confirmarRecollida } from '../../lib/albarans'
import { pujarDocumentExtern } from '../../lib/documents'
import { localDateTime } from '../../lib/franja'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  canalitzacio: string
  /** Los kilos asignados: se proponen como reales, y la diferencia se enseña. */
  kgAssignats: number | null
  /** La hora de recogida acordada, si la hay. */
  dataPrevista: string | null
  /** Contra quién: «Fundació X · Tomàquet». Solo para el título. */
  descripcio?: string | null
  /** El albarán de salida todavía no está emitido: confirmar consume número. */
  esborrany: boolean
  onTancar: () => void
  onFet?: () => void
}

export default function DialegConfirmaRecollida(
  { obert, canalitzacio, kgAssignats, dataPrevista, descripcio, esborrany, onTancar, onFet }: Props,
) {
  const { t } = useT()
  const [kg, setKg] = useState('')
  const [data, setData] = useState('')
  const [obs, setObs] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [ocupat, setOcupat] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!obert) return
    setKg(kgAssignats != null ? String(kgAssignats) : '')
    setData(localDateTime(dataPrevista && new Date(dataPrevista) <= new Date() ? dataPrevista : new Date().toISOString()))
    setObs('')
    setFoto(null)
    setError(null)
  }, [obert, kgAssignats, dataPrevista])

  const kgNum = Number(kg.replace(',', '.'))
  const kgValid = kg.trim() !== '' && Number.isFinite(kgNum) && kgNum >= 0
  const diferencia = kgValid && kgAssignats != null ? Math.round((kgNum - kgAssignats) * 100) / 100 : 0

  const confirma = async () => {
    if (!kgValid) { setError(t('recol.err_kg')); return }
    setOcupat(true)
    setError(null)
    const r = await confirmarRecollida({
      canalitzacio,
      kgReals: kgNum,
      data: data ? new Date(data).toISOString() : null,
      observacions: obs.trim() || null,
    })
    if (!r.ok) {
      setOcupat(false)
      setError(textError(t, r))
      return
    }
    if (foto) {
      const p = await pujarDocumentExtern({
        fitxer: foto, objecteTipus: 'albaran', objecteId: r.data.albara_id, tipus: 'foto_incidencia',
      })
      if (!p.ok) toast.warning(`${t('recol.foto_no')} ${t(p.motiuKey)}`)
    }
    setOcupat(false)
    if (r.data.conciliat) toast.success(t('recol.ok_conciliat', { num: r.data.albara ?? '' }))
    else if (r.data.fora_tolerancia) toast.warning(t('recol.ok_fora', { num: r.data.albara ?? '' }))
    else toast.success(t('recol.ok', { num: r.data.albara ?? '' }))
    void refrescaComptadors()
    onFet?.()
    onTancar()
  }

  return (
    <Dialog open={obert} onOpenChange={(o) => { if (!o && !ocupat) onTancar() }}>
      <DialogContent
        className="max-h-[88dvh] overflow-y-auto sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('recol.title')}</DialogTitle>
          <DialogDescription>{descripcio ? `${descripcio}. ` : ''}{t('recol.desc')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="crec-kg">{t('recol.kg')}</Label>
            <Input id="crec-kg" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} />
            {kgAssignats != null && (
              <p className={diferencia !== 0 ? 'text-xs text-aviso' : 'text-xs text-muted-foreground'}>
                {diferencia !== 0
                  ? t('recol.diferencia', { assignats: kgAssignats, dif: diferencia > 0 ? `+${diferencia}` : diferencia })
                  : t('recol.assignats', { assignats: kgAssignats })}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crec-data">{t('recol.data')}</Label>
            <Input id="crec-data" type="datetime-local" value={data} onChange={(e) => setData(e.target.value)} />
            {!esborrany && <p className="text-xs text-muted-foreground">{t('recol.data_ja_emes')}</p>}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="crec-obs">{t('recol.obs')}</Label>
            <Textarea id="crec-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)}
              placeholder={t('recol.obs_ph')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="crec-foto">{t('recol.foto')}</Label>
            <Input id="crec-foto" type="file" accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
          </div>
        </div>

        {esborrany && (
          <p className="rounded-md bg-aviso-fondo px-3 py-2 text-sm text-aviso">{t('recol.avis_numeracio')}</p>
        )}
        {error && <p role="alert" className="text-sm text-error">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onTancar} disabled={ocupat}>{t('c.cancel')}</Button>
          <Button onClick={confirma} disabled={ocupat || !kgValid}>
            {ocupat && <Loader2 className="animate-spin" />}
            {t('recol.go')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
