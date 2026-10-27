// Cuándo se recoge una oferta: el día y la hora (rebanada 3; extraído el 27-10-2026).
//
// Uno solo para el Mercat del receptor y para el interés asistido del equipo: las dos
// pantallas tienen que ofrecer los MISMOS días y las MISMAS horas, porque la base
// (`comprova_hora_recollida`, dentro de `comprova_interes`) rechaza lo que caiga fuera de la
// disponibilidad o de la franja de la oferta. El día va de hoy a `disponible_hasta`; la hora,
// por cuartos dentro de la franja (`horesDins`). El instante lo compone `isoRecollida()`.
//
// Controlado desde fuera: quien lo usa guarda el día y la hora, y decide si con uno solo de
// los dos se puede enviar (el Mercat dice que no: `mk.need_dia_hora`).
//
// ⚠️ `grid-cols-1` explícito y `text-base md:text-sm` en el `<select>` (§2, reglas 1 y 5).

import { useT } from '../lib/i18n'
import { avuiLocal } from '../lib/format'
import { horesDins } from '../lib/franja'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  /** Prefijo de los `id` de los dos campos: dos formularios en la misma pantalla no los comparten. */
  idPrefix: string
  dia: string
  hora: string
  onDia: (v: string) => void
  onHora: (v: string) => void
  /** `excedentes.disponible_hasta`: el último día que se puede elegir. */
  disponibleFins: string | null | undefined
  /** La franja de la oferta (`hora_recollida_inici` / `_fi`). */
  inici: string | null | undefined
  fi: string | null | undefined
  /** La línea de ayuda de debajo. */
  ajuda?: string
}

export default function CampsRecollida({
  idPrefix, dia, hora, onDia, onHora, disponibleFins, inici, fi, ajuda,
}: Props) {
  const { t } = useT()
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${idPrefix}-dia`} className="mb-1.5 block text-xs text-muted-foreground">{t('mk.dia_rec')}</Label>
        <Input id={`${idPrefix}-dia`} type="date" value={dia} min={avuiLocal()}
          max={disponibleFins ? disponibleFins.slice(0, 10) : undefined}
          onChange={(e) => onDia(e.target.value)} />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-hora`} className="mb-1.5 block text-xs text-muted-foreground">{t('mk.hora_rec')}</Label>
        <select id={`${idPrefix}-hora`} value={hora} onChange={(e) => onHora(e.target.value)}
          className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-base md:h-9 md:text-sm">
          <option value="">—</option>
          {horesDins(inici, fi).map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
      </div>
      {ajuda && <p className="text-xs text-muted-foreground sm:col-span-2">{ajuda}</p>}
    </div>
  )
}
