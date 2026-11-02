// El canal preferido de la organización (`organizaciones.canal_preferido`), en la ficha del
// actor y en la del equipo (1C). Era parte de `PerfilOrganitzacio`; se saca a un componente
// para que las dos fichas lo enseñen igual. Controlado: el valor y los avisos; quien lo
// monta lo guarda con `actualizar_meu_canal` (que admite al titular y al equipo).
//
// Tres cosas que este diseño da por sentadas (etapa 3 de la organización unificada):
//   1. **Es una preferencia, no una garantía.** WhatsApp exige ventana de 24 h abierta u
//      opt-in (§8). Si no se cumplen, el envío cae al correo igualmente, y se dice arriba.
//   2. **`null` no es un hueco, es una opción con nombre**: «que lo decida Redestina».
//   3. Un canal apagado en Configuració (§8) no se ofrece como preferencia nueva; la que ya
//      estaba guardada se sigue enseñando con su aviso, para no cambiarla a escondidas.

import { Info } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useCanals } from '../../hooks/useAppContext'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

/** `auto` es el sentinela de `canal_preferido = null`: Radix no admite `value=""`. */
export type TriaCanal = 'auto' | 'whatsapp' | 'email' | 'telefon'

const OPCIONS: { valor: TriaCanal; labelKey: string; descKey: string }[] = [
  { valor: 'auto', labelKey: 'perf.channel_auto', descKey: 'perf.channel_auto_desc' },
  { valor: 'whatsapp', labelKey: 'perf.channel_whatsapp', descKey: 'perf.channel_whatsapp_desc' },
  { valor: 'email', labelKey: 'perf.channel_email', descKey: 'perf.channel_email_desc' },
  // Una preferencia para el EQUIPO: los avisos automáticos no pueden llamar, así que para
  // ellos vale como «auto» (20270402100000).
  { valor: 'telefon', labelKey: 'perf.channel_telefon', descKey: 'perf.channel_telefon_desc' },
]

export default function CanalPreferit({
  canal, onChange, potEditar, telefon, correu, id = 'canal-preferit',
}: {
  canal: TriaCanal
  onChange: (c: TriaCanal) => void
  potEditar: boolean
  /** Lo que hay EN EL FORMULARIO, no lo guardado: los avisos siguen lo que se teclea. */
  telefon: string
  correu: string
  id?: string
}) {
  const { t } = useT()
  const canals = useCanals()
  if (!canals.email && !canals.whatsapp) return null
  const descripcio = OPCIONS.find((o) => o.valor === canal)?.descKey ?? 'perf.channel_auto_desc'

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold">{t('perf.channel_title')}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{t('perf.channel_help')}</p>
      </div>
      <div className="max-w-sm">
        <Label htmlFor={id} className="mb-1.5 block text-xs text-muted-foreground">{t('perf.channel_label')}</Label>
        <Select value={canal} disabled={!potEditar} onValueChange={(v) => onChange(v as TriaCanal)}>
          <SelectTrigger id={id} className="w-full text-base md:text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {OPCIONS.filter((o) => (o.valor !== 'whatsapp' || canals.whatsapp || canal === 'whatsapp')
              && (o.valor !== 'email' || canals.email || canal === 'email')).map((o) => (
              <SelectItem key={o.valor} value={o.valor} className="text-base md:text-sm">{t(o.labelKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-2 text-sm text-muted-foreground">{t(descripcio)}</p>
      </div>

      {canal === 'whatsapp' && (
        <Alert className="border-aviso/30 bg-aviso-fondo text-aviso">
          <Info />
          <AlertTitle className="line-clamp-none whitespace-normal">{t('perf.channel_limits_title')}</AlertTitle>
          <AlertDescription className="text-aviso">
            <p>{t('perf.channel_limits')}</p>
            {!telefon && <p>{t('perf.channel_no_phone')}</p>}
            {!canals.whatsapp && <p>{t('perf.channel_wa_off')}</p>}
          </AlertDescription>
        </Alert>
      )}
      {!correu && (
        <Alert className="border-aviso/30 bg-aviso-fondo text-aviso">
          <Info />
          <AlertTitle className="line-clamp-none whitespace-normal">{t('perf.channel_no_email_title')}</AlertTitle>
          <AlertDescription className="text-aviso"><p>{t('perf.channel_no_email')}</p></AlertDescription>
        </Alert>
      )}
      {canal === 'email' && !canals.email && (
        <Alert className="border-aviso/30 bg-aviso-fondo text-aviso">
          <Info />
          <AlertDescription className="text-aviso"><p>{t('perf.channel_mail_off')}</p></AlertDescription>
        </Alert>
      )}
    </div>
  )
}
