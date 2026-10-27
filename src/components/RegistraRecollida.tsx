// «Registra la recollida» (17-10-2026): el receptor, después de recoger, dice cuántos kilos
// se ha llevado (`registrar_recollida()`). Desde la regla de Carles del mismo día, eso NO
// genera los albaranes: el registro queda «pendent de validació de l'equip» y es un admin
// quien lo valida en Aprovacions —y entonces se emiten los dos, ofertant → Espigoladors y
// Espigoladors → receptor— o se lo devuelve con un motivo.
//
// Va DENTRO de la ficha de la operación y no en un diálogo propio: la ficha ya se abre en
// un diálogo (Interessos, Històric), y uno dentro de otro en un móvil es difícil de cerrar.
//
// ⚠️ No pide nada al ofertante: el REC se confirma por la declaración del receptor, validada
//    por el equipo. Si los kilos no coinciden con lo asignado, el motivo es obligatorio.
// ⚠️ Registrar NO gasta ningún número de la serie legal: el texto ya no puede decir que se
//    generan albaranes al pulsar (lo dijo hasta el 17-10-2026).
//
// 🔁 **`mode="assistit"`** (27-10-2026, gestión autónoma, fase 3): el MISMO formulario, para que
//    el equipo registre en nombre de la receptora con lo que ella le dice por teléfono. Llama a
//    `registrar_recollida_assistida()`, que registra con el mismo código que el receptor y
//    valida en la misma transacción: aquí SÍ salen los albaranes al pulsar, con número legal,
//    y el texto lo dice antes. Lo monta `DialegRegistraRecollida`. Dos diferencias más: la
//    foto opcional —se sube después, sobre el albarán ya emitido— y que se abre directamente.

import { useState } from 'react'
import { Loader2, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { kg as fmtKg } from '../lib/format'
import { localDateTime } from '../lib/franja'
import { textError } from '../lib/textError'
import { pujarDocumentExtern } from '../lib/documents'
import { refrescaComptadors } from '../lib/pendentsEquip'
import { registraRecollida, registraRecollidaAssistida } from '../lib/operacio'
import type { Operacio } from '../lib/operacio'
import {
  campsAssistit, clauErrorAssistit, clauErrorBase, diferenciaKg, kgDelRegistre, validaRegistre,
  validaRegistreAssistit,
} from '../lib/registreRecollida'
import type { ResultatRecollida } from '../lib/registreRecollida'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Los errores que son del campo de los kilos (para marcarlo). */
const ERRORS_KG: string[] = ['rrec.err_kg', 'rrec.err_kg_zero', 'rrec.err_no_menys', 'rrec.err_no_mes']

export type ModeRegistre = 'propi' | 'assistit'

/** La hora acordada si ya pasó; si no, ahora (se recogió antes de lo previsto). */
function dataInicial(op: Operacio): string {
  const prevista = op.data_hora_recollida && new Date(op.data_hora_recollida) <= new Date()
    ? op.data_hora_recollida : new Date().toISOString()
  return localDateTime(prevista)
}

export default function RegistraRecollida({
  op, onFet, mode = 'propi', onCancel,
}: {
  op: Operacio
  onFet: () => void
  /** `assistit`: el equipo, en nombre de la receptora; registra Y valida. */
  mode?: ModeRegistre
  /** Solo en `assistit`: «Cancel·la» cierra quien lo contiene (el diálogo). */
  onCancel?: () => void
}) {
  const { t } = useT()
  const assistit = mode === 'assistit'
  const assignats = op.kg_assignats != null ? Number(op.kg_assignats) : null
  const kgInicial = assignats != null ? String(assignats).replace('.', ',') : ''
  // En el modo asistido se abre directamente: ya va dentro de un diálogo que se abrió a eso.
  const [obert, setObert] = useState(assistit)
  const [resultat, setResultat] = useState<ResultatRecollida>('coincideix')
  const [kg, setKg] = useState(assistit ? kgInicial : '')
  const [obs, setObs] = useState('')
  const [data, setData] = useState(() => (assistit ? dataInicial(op) : ''))
  const [foto, setFoto] = useState<File | null>(null)
  const [ocupat, setOcupat] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intentat, setIntentat] = useState(false)

  const venda = op.modalitat === 'venda' || op.modalitat === 'maquila'

  const obre = () => {
    setResultat('coincideix')
    setKg(kgInicial)
    setObs('')
    setData(dataInicial(op))
    setFoto(null)
    setError(null)
    setIntentat(false)
    setObert(true)
  }

  const tanca = () => {
    if (assistit) onCancel?.()
    else setObert(false)
  }

  const dataIso = data ? new Date(data).toISOString() : null
  const entrada = { resultat, kg, kgAssignats: assignats, observacions: obs, data: dataIso }
  const problema = assistit ? validaRegistreAssistit(entrada) : validaRegistre(entrada)
  const kgFinal = kgDelRegistre(entrada)
  const dif = diferenciaKg(entrada)
  const ambDiferencia = resultat !== 'coincideix'

  const tria = (r: ResultatRecollida) => {
    setResultat(r)
    setError(null)
    // Al pasar a «menys»/«més» se deja el número para que lo corrija, no vacío.
    if (r !== 'coincideix' && kg.trim() === '' && assignats != null) setKg(String(assignats).replace('.', ','))
  }

  const confirmaPropi = async () => {
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
    // Lo que ha quedado registrado, y que ahora le toca al equipo. Sin números de albarán:
    // todavía no existen.
    const kgDecl = r.data?.kg_declarats ?? kgFinal
    toast.success(t(ambDiferencia ? 'rrec.ok_diferencia' : 'rrec.ok', { kg: fmtKg(kgDecl) }))
    setObert(false)
    onFet()
  }

  const confirmaAssistit = async () => {
    const { observacions, motiu } = campsAssistit(entrada)
    const r = await registraRecollidaAssistida({
      canalitzacio: op.canalizacion_id,
      resultat,
      kgReals: resultat === 'coincideix' ? null : kgFinal,
      data: dataIso,
      observacions,
      motiu,
    })
    if (!r.ok) {
      setOcupat(false)
      const clau = clauErrorAssistit(r.missatge, r.codi)
      setError(clau ? t(clau) : textError(t, r))
      return
    }
    // La foto, sobre el albarán de salida YA emitido: un borrador no tiene ejercicio, y la
    // carpeta de un documento externo sale del ejercicio de su objeto.
    if (foto && r.data.albara_id) {
      const p = await pujarDocumentExtern({
        fitxer: foto, objecteTipus: 'albaran', objecteId: r.data.albara_id, tipus: 'foto_incidencia',
      })
      if (!p.ok) toast.warning(`${t('recol.foto_no')} ${t(p.motiuKey)}`)
    }
    setOcupat(false)
    // Los números que han salido, que es lo que hay que poder decirle a la entidad.
    const nums = [r.data.albara, r.data.rec?.numero].filter(Boolean).join(' · ')
    toast.success(t(r.data.conciliat ? 'rrec.as_ok_conciliat' : 'rrec.as_ok', { num: nums || '—' }))
    if (r.data.esperant_altres && !r.data.rec?.numero) toast.info(t('vrec.fet_esperant'))
    void refrescaComptadors()
    onFet()
  }

  const confirma = async () => {
    setIntentat(true)
    if (problema) return
    setOcupat(true)
    setError(null)
    if (assistit) await confirmaAssistit()
    else await confirmaPropi()
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
  // Las etiquetas del texto: la receptora cuenta qué pasó; el equipo deja el motivo, que es a
  // la vez el de la incidencia y el de la validación (`campsAssistit`).
  const etiquetaObs = assistit
    ? t(ambDiferencia ? 'rrec.as_motiu' : 'rrec.obs')
    : t(ambDiferencia ? 'rrec.motiu' : 'rrec.obs')
  const resum = assistit
    ? t(venda ? 'rrec.as_resum_venda' : 'rrec.as_resum', { kg: kgFinal != null ? fmtKg(kgFinal) : '—', entitat: op.entitat_nom ?? '' })
    : t(venda ? 'rrec.resum_venda' : 'rrec.resum', { kg: kgFinal != null ? fmtKg(kgFinal) : '—', entitat: op.entitat_nom ?? '' })

  return (
    <div className="space-y-4 rounded-lg border p-3" data-testid="registra-recollida">
      {!assistit && (
        <div>
          <p className="font-medium">{t('rrec.title')}</p>
          <p className="text-sm text-muted-foreground">{t('rrec.desc')}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-sm font-medium" id={`rrec-resultat-${mode}`}>{t('rrec.resultat')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby={`rrec-resultat-${mode}`}>
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
            <Label htmlFor={`rrec-kg-${mode}`}>{t('rrec.kg')}</Label>
            <Input id={`rrec-kg-${mode}`} inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)}
              aria-invalid={errorCamp != null && ERRORS_KG.includes(errorCamp)} />
            {assignats != null && dif != null && (
              <p className={dif !== 0 ? 'text-xs text-aviso' : 'text-xs text-muted-foreground'}>
                {t('rrec.diferencia', { assignats: fmtKg(assignats), dif: dif > 0 ? `+${fmtKg(dif)}` : fmtKg(dif) })}
              </p>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor={`rrec-data-${mode}`}>{t('rrec.data')}</Label>
          <Input id={`rrec-data-${mode}`} type="datetime-local" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`rrec-obs-${mode}`}>{etiquetaObs}</Label>
          <Textarea id={`rrec-obs-${mode}`} rows={3} value={obs} onChange={(e) => setObs(e.target.value)}
            placeholder={t(assistit ? 'recol.obs_ph' : (ambDiferencia ? 'rrec.motiu_ph' : 'rrec.obs_ph'))} />
          {ambDiferencia && !assistit && <p className="text-xs text-muted-foreground">{t('rrec.incidencia_nota')}</p>}
        </div>
        {assistit && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rrec-foto-assistit">{t('recol.foto')}</Label>
            <Input id="rrec-foto-assistit" type="file" accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setFoto(e.target.files?.[0] ?? null)} />
          </div>
        )}
      </div>

      {/* Lo que va a pasar, dicho antes de pulsar. La receptora: se registra y lo revisa el
          equipo. El equipo: se registra y se valida, y salen albaranes con número legal. */}
      {kgFinal != null && (
        <p className={cn('rounded-md px-3 py-2 text-sm', assistit ? 'bg-aviso-fondo text-aviso' : 'bg-muted/60')}>
          {resum}
        </p>
      )}

      {errorCamp && <p role="alert" className="text-sm text-error">{t(errorCamp)}</p>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" className="h-11 md:h-9" onClick={tanca} disabled={ocupat}>{t('c.cancel')}</Button>
        <Button className="h-11 whitespace-normal md:h-9" onClick={confirma} disabled={ocupat}>
          {ocupat && <Loader2 className="animate-spin" />}
          {t(assistit ? 'rrec.as_go' : 'rrec.go')}
        </Button>
      </div>
    </div>
  )
}
