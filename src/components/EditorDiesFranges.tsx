// Días de la semana (ISO 1 = dilluns … 7 = diumenge) y franjas horarias (como mucho cuatro):
// el editor que tenía dentro `LlocsRecollida` (A4, fila 2.5), extraído en la fase 4 (25-11-2026,
// proceso 3.2) para que el mini-formulario de LUGAR NUEVO del alta de oferta guarde también los
// días y las franjas en la ficha (`creaUbicacio(extra)`).
//
// Controlado desde fuera: quien lo usa guarda `dies` y `franges` y decide qué se escribe (una
// franja a medias se queda en el formulario y no se guarda: `esFranjaValida`, la misma validación
// que el CHECK `franges_valides` de la base). Sin estado propio y sin red.
//
// `diesPermesos`: limita los días que se pueden marcar (los de un lugar, cuando la oferta los
// hereda); los demás salen deshabilitados, como los chips que llegan al máximo. Un día ya marcado
// que no está entre los permitidos se puede desmarcar (`XipsTria` no bloquea el que está puesto).

import { Plus, Trash2 } from 'lucide-react'
import { useT } from '../lib/i18n'
import { esFranjaValida, type Franja } from '../lib/franja'
import { DIES_SETMANA } from '../lib/diesRecollida'
import SelectorFranja from './SelectorFranja'
import XipsTria from './XipsTria'
import { Button } from '@/components/ui/button'

/** Como mucho cuatro franjas por lugar (CHECK `franges_valides`). */
export const MAX_FRANGES = 4

export interface PropsEditorDiesFranges {
  /** Prefijo de los `id` (dos editores en la misma pantalla no los comparten). */
  idPrefix: string
  /** Días marcados (ISO 1-7). */
  dies: readonly number[]
  /** Franjas, también las que están a medias (`null` = recién añadida). */
  franges: readonly (Partial<Franja> | null)[]
  onDies: (dies: number[]) => void
  onFranges: (franges: (Partial<Franja> | null)[]) => void
  /** Si se pasa, solo esos días se pueden marcar. Vacío o ausente = todos. */
  diesPermesos?: readonly number[] | null
  /** Clave i18n de la etiqueta de los días (por defecto, «Dies de recollida»). */
  etiquetaDiesKey?: string
  /** Clave i18n de la etiqueta de las franjas (por defecto, «Franges horàries (fins a 4)»). */
  etiquetaFrangesKey?: string
  disabled?: boolean
}

export default function EditorDiesFranges({
  idPrefix, dies, franges, onDies, onFranges, diesPermesos, disabled = false,
  etiquetaDiesKey = 'org.place_days', etiquetaFrangesKey = 'org.place_slots',
}: PropsEditorDiesFranges) {
  const { t } = useT()
  const permesos = diesPermesos && diesPermesos.length > 0 ? diesPermesos : null
  return (
    <>
      <div className="sm:col-span-2">
        <p id={`${idPrefix}-dies-l`} className="mb-1.5 text-xs text-muted-foreground">{t(etiquetaDiesKey)}</p>
        <XipsTria etiquetaId={`${idPrefix}-dies-l`} disabled={disabled}
          opcions={DIES_SETMANA.map((d) => ({
            valor: String(d), text: t(`org.dia_${d}`), desactivat: permesos ? !permesos.includes(d) : false,
          }))}
          triats={dies.map(String)}
          onChange={(v) => onDies(v.map(Number).sort((a, b) => a - b))} />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <p className="text-xs text-muted-foreground">{t(etiquetaFrangesKey)}</p>
        {franges.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <SelectorFranja id={`${idPrefix}-franja-${i}`} valor={f} disabled={disabled}
              invalid={f !== null && !esFranjaValida(f) && Boolean(f.inici && f.fi)}
              onChange={(nf) => onFranges(franges.map((x, j) => (j === i ? nf : x)))} />
            <Button variant="ghost" size="sm" className="h-11 md:h-8" aria-label={t('org.place_slot_delete')}
              disabled={disabled} onClick={() => onFranges(franges.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        {franges.length < MAX_FRANGES && (
          <Button variant="outline" size="sm" className="h-11 whitespace-nowrap md:h-8" disabled={disabled}
            onClick={() => onFranges([...franges, null])}>
            <Plus className="size-4" aria-hidden /> {t('org.place_slot_add')}
          </Button>
        )}
      </div>
    </>
  )
}
