// «Registra la recollida» (17-10-2026): el receptor, después de recoger, dice cuántos kilos
// se ha llevado. Con eso la base genera los dos albaranes —ofertant → Espigoladors y
// Espigoladors → receptor— por los kilos reales (`registrar_recollida()`, 20270426100000).
//
// Va DENTRO de la ficha de la operación y no en un diálogo propio: la ficha ya se abre en
// un diálogo (Interessos, Històric), y uno dentro de otro en un móvil es difícil de cerrar.
//
// ⚠️ No pide nada al ofertante: el REC se confirma por la declaración del receptor y la
//    evidencia lo dice así. Si los kilos no coinciden con lo asignado, se registra igual,
//    pero como incidencia: la operación no se cierra hasta que la revise el equipo.
// ⚠️ Confirmar EMITE los albaranes y consume números de la serie legal. El texto lo dice
//    antes de pulsar, y el botón se bloquea mientras la llamada está en marcha.

import { useState } from 'react'
import { Loader2, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { kg as fmtKg } from '../lib/format'
import { localDateTime } from '../lib/franja'
import { textError } from '../lib/textError'
import { registraRecollida } from '../lib/operacio'
import type { Operacio } from '../lib/operacio'
import {
  clauErrorBase, diferenciaKg, kgDelRegistre, validaRegistre,
} from '../lib/registreRecollida'
import type { ResultatRecollida } from '../lib/registreRecollida'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Los errores que son del campo de los kilos (para marcarlo). */
const ERRORS_KG: string[] = ['rrec.err_kg', 'rrec.err_kg_zero', 'rrec.err_no_menys', 'rrec.err_no_mes']

export default function RegistraRecollida({ op, onFet }: { op: Operacio; onFet: () => void }) {
  const { t } = useT()
  const [obert, setObert] = useState(false)
  const [resultat, setResultat] = useState<ResultatRecollida>('coincideix')
  const [kg, setKg] = useState('')
  const [obs, setObs] = useState('')
  const [data, setData] = useState('')
  const [ocupat, setOcupat] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intentat, setIntentat] = useState(false)

  const assignats = op.kg_assignats != null ? Number(op.kg_assignats) : null
  const venda = op.modalitat === 'venda' || op.modalitat === 'maquila'

  const obre = () => {
    // La hora acordada si ya pasó; si no, ahora (se recogió antes de lo previsto).
    const prevista = op.data_hora_recollida && new Date(op.data_hora_recollida) <= new Date()
      ? op.data_hora_recollida : new Date().toISOString()
    setResultat('coincideix')
    setKg(assignats != null ? String(assignats).replace('.', ',') : '')
    setObs('')
    setData(localDateTime(prevista))
    setError(null)
    setIntentat(false)
    setObert(true)
  }

  const dataIso = data ? new Date(data).toISOString() : null
  const entrada = { resultat, kg, kgAssignats: assignats, observacions: obs, data: dataIso }
  const problema = validaRegistre(entrada)
  const kgFinal = kgDelRegistre(entrada)
  const dif = diferenciaKg(entrada)
  const ambDiferencia = resultat !== 'coincideix'

  const tria = (r: ResultatRecollida) => {
    setResultat(r)
    setError(null)
    // Al pasar a «menys»/«més» se deja el número para que lo corrija, no vacío.
    if (r !== 'coincideix' && kg.trim() === '' && assignats != null) setKg(String(assignats).replace('.', ','))
  }

  const confirma = async () => {
    setIntentat(true)
    if (problema) return
    setOcupat(true)
    setError(null)
    const r = await registraRecollida({
      canalitzacio: op.canalizacion_id,
      resultat,
      kgReals: resultat === 'coincideix' ? null : kgFinal,
      data: dataIso,
      observacions: obs.trim() || null,
    })
    setOcupat(false)
    if (!r.ok) {
      const clau = clauErrorBase(r.missatge, r.codi)
      setError(clau ? t(clau) : textError(t, r))
      return
    }
    const num = r.data.albara ?? ''
    if (r.data.en_revisio) toast.warning(t('rrec.ok_revisio', { num }))
    else if (r.data.esperant_altres) toast.success(t('rrec.ok_esperant', { num }))
    else toast.success(t(venda ? 'rrec.ok_venda' : 'rrec.ok', { num, rec: r.data.rec?.numero ?? '' }))
    setObert(false)
    onFet()
  }

  if (!obert) {
    return (
      <div className="space-y-2 rounded-lg border border-aviso bg-aviso-fondo p-3" data-testid="registra-recollida">
        <p className="flex items-center gap-1.5 text-sm font-medium text-aviso">
          <PackageCheck className="size-4 shrink-0" aria-hidden />{t('rrec.crida_t')}
        </p>
        <p className="text-sm">{t(venda ? 'rrec.crida_venda' : 'rrec.crida')}</p>
        <Button className="h-11 w-full sm:w-auto md:h-9" onClick={obre}>{t('rrec.obre')}</Button>
      </div>
    )
  }

  const opcions: { valor: ResultatRecollida; text: string }[] = [
    { valor: 'coincideix', text: assignats != null ? t('rrec.op_coincideix', { kg: fmtKg(assignats) }) : t('rrec.op_coincideix_sense') },
    { valor: 'menys', text: t('rrec.op_menys') },
    { valor: 'mes', text: t('rrec.op_mes') },
  ]
  const errorCamp = intentat ? problema : null

  return (
    <div className="space-y-4 rounded-lg border p-3" data-testid="registra-recollida">
      <div>
        <p className="font-medium">{t('rrec.title')}</p>
        <p className="text-sm text-muted-foreground">{t('rrec.desc')}</p>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium" id="rrec-resultat">{t('rrec.resultat')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="rrec-resultat">
          {opcions.map((o) => (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={resultat === o.valor}
              onClick={() => tria(o.valor)}
              className={cn(
                'min-h-11 rounded-md border px-3 py-2 text-left text-base whitespace-normal md:min-h-9 md:text-sm',
                resultat === o.valor ? 'border-primary bg-secondary text-secondary-foreground font-medium' : 'border-input bg-background',
              )}
            >
              {o.text}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ambDiferencia && (
          <div className="space-y-1.5">
            <Label htmlFor="rrec-kg">{t('rrec.kg')}</Label>
            <Input id="rrec-kg" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)}
              aria-invalid={errorCamp != null && ERRORS_KG.includes(errorCamp)} />
            {assignats != null && dif != null && (
              <p className={dif !== 0 ? 'text-xs text-aviso' : 'text-xs text-muted-foreground'}>
                {t('rrec.diferencia', { assignats: fmtKg(assignats), dif: dif > 0 ? `+${fmtKg(dif)}` : fmtKg(dif) })}
              </p>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="rrec-data">{t('rrec.data')}</Label>
          <Input id="rrec-data" type="datetime-local" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rrec-obs">{t(ambDiferencia ? 'rrec.motiu' : 'rrec.obs')}</Label>
          <Textarea id="rrec-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)}
            placeholder={t(ambDiferencia ? 'rrec.motiu_ph' : 'rrec.obs_ph')} />
          {ambDiferencia && <p className="text-xs text-muted-foreground">{t('rrec.incidencia_nota')}</p>}
        </div>
      </div>

      {/* Lo que va a pasar, dicho antes de pulsar: se emiten documentos con número legal. */}
      {kgFinal != null && (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
          {t(venda ? 'rrec.resum_venda' : 'rrec.resum', { kg: fmtKg(kgFinal), entitat: op.entitat_nom ?? '' })}
        </p>
      )}

      {errorCamp && <p role="alert" className="text-sm text-error">{t(errorCamp)}</p>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" className="h-11 md:h-9" onClick={() => setObert(false)} disabled={ocupat}>{t('c.cancel')}</Button>
        <Button className="h-11 whitespace-normal md:h-9" onClick={confirma} disabled={ocupat}>
          {ocupat && <Loader2 className="animate-spin" />}
          {t('rrec.go')}
        </Button>
      </div>
    </div>
  )
}
