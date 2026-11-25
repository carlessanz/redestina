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
// ⚠️ `grid-cols-1` explícito (§2, regla 5); el `text-base md:text-sm` de la hora ya lo trae
//    el `Desplegable` (regla 1).
//
// DÍAS DE RECOGIDA (fase 4, 25-11-2026): si la oferta los tiene (`dies_recollida`, ISO 1-7), el
// día deja de ser un calendario libre —el `<input type="date">` no sabe deshabilitar días sueltos—
// y pasa a ser un desplegable de los días de la disponibilidad con los que NO se recogen
// deshabilitados, y una línea que dice cuáles sí: la base rechazaría los otros (`dia_fora_dies`).
// El equipo (`nomesAvisa`) registra la realidad: conserva el calendario y solo ve un aviso.

import { useT } from '../lib/i18n'
import { avuiLocal } from '../lib/format'
import { horesDins } from '../lib/franja'
import { diaPermes, normalitzaDies, opcionsDies } from '../lib/diesRecollida'
import { textDia } from '../lib/sortides'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import Desplegable from './Desplegable'

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
  /** `excedentes.dies_recollida` (ISO 1-7). Vacío o ausente = cualquier día. */
  diesRecollida?: readonly number[] | null
  /**
   * El equipo registra lo que pasó: no se le deshabilita nada, solo se le avisa de que el día
   * está fuera de los de la oferta (la base no le bloquea).
   */
  nomesAvisa?: boolean
}

export default function CampsRecollida({
  idPrefix, dia, hora, onDia, onHora, disponibleFins, inici, fi, ajuda, diesRecollida, nomesAvisa = false,
}: Props) {
  const { t } = useT()
  const dies = normalitzaDies(diesRecollida)
  const textDies = dies.map((d) => t(`org.dia_${d}`)).join(', ')
  const restringeix = dies.length > 0 && !nomesAvisa
  const avui = avuiLocal()
  const opcions = restringeix ? opcionsDies(avui, disponibleFins, dies) : []
  const capPermes = restringeix && !opcions.some((o) => o.permes)
  const foraDies = dies.length > 0 && nomesAvisa && dia !== '' && !diaPermes(dia, dies)
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={`${idPrefix}-dia`} className="mb-1.5 block text-xs text-muted-foreground">{t('mk.dia_rec')}</Label>
        {restringeix ? (
          <Desplegable id={`${idPrefix}-dia`} value={dia} onChange={onDia} buit="—"
            opcions={opcions.map((o) => ({
              valor: o.dia, text: `${t(`org.dia_${o.diaSetmana}`)} ${textDia(o.dia)}`, disabled: !o.permes,
            }))} />
        ) : (
          <Input id={`${idPrefix}-dia`} type="date" value={dia} min={avui}
            max={disponibleFins ? disponibleFins.slice(0, 10) : undefined}
            onChange={(e) => onDia(e.target.value)} />
        )}
        {restringeix && (
          <p className="mt-1 text-xs text-muted-foreground" data-testid={`${idPrefix}-dies-nomes`}>
            {t(capPermes ? 'mk.dies_cap' : 'mk.dies_nomes', { dies: textDies })}
          </p>
        )}
        {foraDies && (
          <p className="mt-1 text-xs text-aviso" role="status" data-testid={`${idPrefix}-dia-fora`}>
            {t('mk.dia_fora_avis', { dies: textDies })}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-hora`} className="mb-1.5 block text-xs text-muted-foreground">{t('mk.hora_rec')}</Label>
        <Desplegable id={`${idPrefix}-hora`} value={hora} onChange={onHora} buit="—"
          opcions={horesDins(inici, fi).map((h) => ({ valor: h, text: h }))} />
      </div>
      {ajuda && <p className="text-xs text-muted-foreground sm:col-span-2">{ajuda}</p>}
    </div>
  )
}
