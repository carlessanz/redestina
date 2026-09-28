// Los campos propios de cada tipo de receptor (`entidades.perfil_receptor`), pintados desde
// la lista declarativa de `lib/perfilReceptor.ts`.
//
// UN SOLO COMPONENTE para los dos sitios donde se editan: la ficha de la propia organización
// (`PerfilOrganitzacio`) y la del equipo (`RecordDetail`, 28-09-2026). Estaba escrito dentro
// de la primera, y copiarlo en la segunda habría dado dos formularios del mismo dato que
// acabarían guardándolo distinto.
//
// Controlado: recibe el objeto y devuelve el objeto entero en cada cambio. Quien lo monta
// decide cuándo y cómo se guarda.

import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { PERFIL_RECEPTOR } from '../lib/perfilReceptor'
import type { CampPerfil } from '../lib/perfilReceptor'
import { Casella } from './Casella'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

export default function CampsPerfilReceptor({
  tipusReceptor, perfil, onChange, disabled = false, idPrefix = 'pr',
}: {
  tipusReceptor: string | null | undefined
  perfil: Record<string, unknown>
  onChange: (perfil: Record<string, unknown>) => void
  disabled?: boolean
  /** Prefijo de los `id`: con doble rol puede haber dos formularios en la misma página. */
  idPrefix?: string
}) {
  const { t } = useT()
  const camps: readonly CampPerfil[] = PERFIL_RECEPTOR[tipusReceptor ?? ''] ?? []
  if (camps.length === 0) return null

  function control(c: CampPerfil) {
    const id = `${idPrefix}-${c.clau}`
    const v = perfil[c.clau]
    const set = (nou: unknown) => onChange({ ...perfil, [c.clau]: nou })
    if (c.tipus === 'multi') {
      const triats = Array.isArray(v) ? (v as string[]) : []
      return (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-l`}>
          {c.opcions!.map((o) => {
            const on = triats.includes(o)
            return (
              <button
                key={o}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => set(on ? triats.filter((x) => x !== o) : [...triats, o])}
                className={cn(
                  'min-h-11 rounded-full border px-3 text-base md:min-h-9 md:text-sm',
                  on ? 'border-primary bg-secondary text-secondary-foreground' : 'border-input bg-background',
                )}
              >
                {t(`pr.o_${o}`)}
              </button>
            )
          })}
        </div>
      )
    }
    if (c.tipus === 'select') {
      return (
        <Select value={typeof v === 'string' ? v : undefined} disabled={disabled} onValueChange={set}>
          <SelectTrigger id={id} className="w-full text-base md:text-sm"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {c.opcions!.map((o) => <SelectItem key={o} value={o} className="text-base md:text-sm">{t(`pr.o_${o}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      )
    }
    if (c.tipus === 'sino') {
      return (
        <div className="flex gap-4" role="group" aria-labelledby={`${id}-l`}>
          {[true, false].map((b) => (
            <label key={String(b)} className="flex min-h-11 items-center gap-2 text-base md:min-h-9 md:text-sm">
              <Casella checked={v === b} disabled={disabled} onChange={() => set(v === b ? null : b)} />
              {t(b ? 'pr.si' : 'pr.no')}
            </label>
          ))}
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2">
        <Input id={id} value={v == null ? '' : String(v)} disabled={disabled}
          type={c.tipus === 'numero' ? 'number' : 'text'} min={c.tipus === 'numero' ? 0 : undefined}
          onChange={(e) => set(c.tipus === 'numero'
            ? (e.target.value === '' ? null : Number(e.target.value))
            : e.target.value)} />
        {c.unitatKey && <span className="shrink-0 text-sm text-muted-foreground">{t(c.unitatKey)}</span>}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {camps.map((c) => (
        <div key={c.clau} className={c.tipus === 'multi' ? 'sm:col-span-2' : undefined}>
          <Label id={`${idPrefix}-${c.clau}-l`} htmlFor={`${idPrefix}-${c.clau}`}
            className="mb-1.5 block text-xs text-muted-foreground">
            {t(`pr.${c.clau}`)}
          </Label>
          {control(c)}
        </div>
      ))}
    </div>
  )
}
