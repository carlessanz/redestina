// El bloque de EXCEDENTES de un producto, en edición (Plan 2, A3, `20270522100000`): «Sense
// excedent» o las causas del catálogo `causas` (chips, nombre según idioma) y, por causa, su
// `CausaExcedent`; y las observaciones del producto. Un bloque de un producto que ya no es
// principal (conservat, decisión a) lleva la marca «Ja no és principal» y el botón «Treu-lo».
//
// Sin estado propio: todo viaja por los callbacks a `FormulariDiagnostic`, que aplica las
// operaciones puras de `lib/excedentsDiagnostic.ts`.

import { Trash2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import type { BlocEdicio, CampCausa } from '../../lib/excedentsDiagnostic'
import type { CausaCataleg } from '../../types'
import { FilaCasella } from '../Casella'
import XipsTria from '../XipsTria'
import CausaExcedent from './CausaExcedent'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export default function BlocExcedentsProducte({
  bloc, index, cataleg, falten, onSenseExcedent, onCauses, onCamp, onGestio, onDestins, onAccio,
  onObservacions, onTreu,
}: {
  bloc: BlocEdicio
  /** Posición del bloque: da los `id` estables (`diag-exc-<index>-…`). */
  index: number
  cataleg: readonly CausaCataleg[]
  /** Los códigos de `falten` (locales) de este producto, para señalar lo pendiente. */
  falten: readonly string[]
  onSenseExcedent: (v: boolean) => void
  onCauses: (codis: string[]) => void
  onCamp: (causa: string, camp: CampCausa, valor: string) => void
  onGestio: (causa: string, gestio: string[]) => void
  onDestins: (causa: string, destins: string[]) => void
  onAccio: (causa: string, desti: string, text: string) => void
  onObservacions: (text: string) => void
  /** Solo los conservados (no principales) se pueden quitar desde aquí. */
  onTreu?: () => void
}) {
  const { t, lang } = useT()
  const id = `diag-exc-${index}`
  const nomDe = (codi: string) => {
    const c = cataleg.find((x) => x.codigo === codi)
    if (c) return (lang === 'es' ? c.nombre_es || c.nombre : c.nombre) || codi
    const propi = bloc.causes.find((x) => x.causa === codi)?.causa_nom
    return (lang === 'es' ? propi?.es || propi?.ca : propi?.ca || propi?.es) || codi
  }
  // Las causas guardadas que el catálogo ya no tiene, también como chip (para poder quitarlas).
  const codis = [...cataleg.map((c) => c.codigo)]
  for (const c of bloc.causes) if (!codis.includes(c.causa)) codis.push(c.causa)
  const faltaBloc = falten.includes(`excedents:${bloc.producte}`)

  return (
    <section
      className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0"
      aria-labelledby={`${id}-t`}
      data-testid={`bloc-exc-${bloc.producte}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={`${id}-t`} className="min-w-0 text-base font-semibold break-words">{bloc.producte}</h4>
        {!bloc.principal && (
          <Badge variant="outline" data-testid="exc-ja-no-principal">{t('dexc.ja_no_principal')}</Badge>
        )}
        {!bloc.principal && onTreu && (
          <Button
            type="button" variant="outline" size="sm" onClick={onTreu}
            className="ml-auto h-11 whitespace-normal md:h-8" data-testid={`${id}-treu`}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('dexc.treu')}
          </Button>
        )}
      </div>

      <FilaCasella checked={bloc.sense_excedent} onChange={onSenseExcedent}>
        {t('dexc.sense_excedent')}
      </FilaCasella>

      {!bloc.sense_excedent && (
        <div className={faltaBloc ? 'space-y-1.5 rounded-lg border border-aviso/40 bg-aviso-fondo/40 p-3' : 'space-y-1.5'}>
          <p id={`${id}-causes-l`} className="text-sm font-medium">{t('dexc.pregunta_causes')}</p>
          <XipsTria
            etiquetaId={`${id}-causes-l`}
            opcions={codis.map((c) => ({ valor: c, text: nomDe(c) }))}
            triats={bloc.causes.map((c) => c.causa)}
            onChange={onCauses}
          />
        </div>
      )}

      {!bloc.sense_excedent && bloc.causes.map((c) => (
        <CausaExcedent
          key={c.causa}
          causa={c}
          nom={nomDe(c.causa)}
          idPrefix={`${id}-${c.causa}`}
          falta={falten.includes(`dades:${bloc.producte}:${c.causa}`)}
          onCamp={(camp, valor) => onCamp(c.causa, camp, valor)}
          onGestio={(g) => onGestio(c.causa, g)}
          onDestins={(d) => onDestins(c.causa, d)}
          onAccio={(desti, text) => onAccio(c.causa, desti, text)}
        />
      ))}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-obs`} className="text-sm">{t('dexc.observacions')}</Label>
        <Textarea
          id={`${id}-obs`}
          rows={2}
          maxLength={2000}
          value={bloc.observacions}
          onChange={(e) => onObservacions(e.target.value)}
        />
      </div>
    </section>
  )
}
