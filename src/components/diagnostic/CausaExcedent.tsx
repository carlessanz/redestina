// Una CAUSA de excedente de un producto, en edición (Plan 2, A3, `20270522100000`): frecuencia,
// kilos aproximados cada vez (P7), gestión actual, destinos de interés (= modalidades de las
// ofertas) y detalle; y, por cada destino marcado, el texto de SU acción (decisión b: una por
// destino). Lo pinta `BlocExcedentsProducte` dentro de `FormulariDiagnostic`; el estado vive
// arriba (`lib/excedentsDiagnostic.ts`), aquí solo se pinta y se avisa.

import { useT } from '../../lib/i18n'
import { DESTINS, FREQUENCIES, GESTIONS, textDesti } from '../../lib/excedentsLlegible'
import { volumValid, type CampCausa, type CausaEdicio } from '../../lib/excedentsDiagnostic'
import Desplegable from '../Desplegable'
import XipsTria from '../XipsTria'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export default function CausaExcedent({
  causa, nom, idPrefix, falta, onCamp, onGestio, onDestins, onAccio,
}: {
  causa: CausaEdicio
  /** El nombre de la causa en el idioma de la interfaz. */
  nom: string
  /** Prefijo de los `id` (estables para las E2E): `diag-exc-<i>-<causa>`. */
  idPrefix: string
  /** Le falta frecuencia, kilos o gestión actual (se señala, no bloquea). */
  falta: boolean
  onCamp: (camp: CampCausa, valor: string) => void
  onGestio: (gestio: string[]) => void
  onDestins: (destins: string[]) => void
  onAccio: (desti: string, text: string) => void
}) {
  const { t } = useT()
  const volumMal = causa.volum.trim() !== '' && !volumValid(causa.volum)

  return (
    <div
      className={falta ? 'space-y-4 rounded-lg border border-aviso/40 bg-aviso-fondo/40 p-3' : 'space-y-4 rounded-lg border border-border p-3'}
      data-testid={`causa-${causa.causa}`}
    >
      <h5 className="text-sm font-semibold break-words">{nom}</h5>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${idPrefix}-freq`} className="text-sm">{t('dexc.frequencia')}</Label>
          <Desplegable
            id={`${idPrefix}-freq`}
            value={causa.frequencia}
            onChange={(v) => onCamp('frequencia', v)}
            buit={t('diag.unanswered')}
            opcions={FREQUENCIES.map((f) => ({ valor: f, text: t(`dexc.freq_${f}`) }))}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${idPrefix}-volum`} className="text-sm">{t('dexc.volum_kg')}</Label>
          <Input
            id={`${idPrefix}-volum`}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            className="max-w-48"
            value={causa.volum}
            aria-invalid={volumMal || undefined}
            aria-describedby={`${idPrefix}-volum-nota`}
            onChange={(e) => onCamp('volum', e.target.value)}
          />
          <p id={`${idPrefix}-volum-nota`} className="text-xs text-muted-foreground">{t('dexc.volum_nota')}</p>
          {volumMal && <p className="text-xs text-destructive">{t('dexc.err_volum')}</p>}
        </div>
      </div>

      <div className="space-y-1.5">
        <p id={`${idPrefix}-gestio-l`} className="text-sm font-medium">{t('dexc.pregunta_gestio')}</p>
        <XipsTria
          etiquetaId={`${idPrefix}-gestio-l`}
          opcions={GESTIONS.map((g) => ({ valor: g, text: t(`dexc.gestio_${g}`) }))}
          triats={causa.gestio}
          onChange={onGestio}
        />
      </div>

      <div className="space-y-1.5">
        <p id={`${idPrefix}-destins-l`} className="text-sm font-medium">{t('dexc.pregunta_destins')}</p>
        <XipsTria
          etiquetaId={`${idPrefix}-destins-l`}
          opcions={DESTINS.map((d) => ({ valor: d, text: textDesti(d, t) }))}
          triats={causa.destins}
          onChange={onDestins}
        />
      </div>

      {causa.destins.map((d) => (
        <div key={d} className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-accio-${d}`} className="text-sm">
            {t('dexc.accio_per', { desti: textDesti(d, t) })}
          </Label>
          <Textarea
            id={`${idPrefix}-accio-${d}`}
            rows={2}
            maxLength={2000}
            value={causa.accions[d] ?? ''}
            placeholder={t('dexc.accio_ph')}
            onChange={(e) => onAccio(d, e.target.value)}
          />
        </div>
      ))}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-detall`} className="text-sm">{t('dexc.detall')}</Label>
        <Input
          id={`${idPrefix}-detall`}
          maxLength={500}
          value={causa.detall}
          placeholder={t('dexc.detall_ph')}
          onChange={(e) => onCamp('detall', e.target.value)}
        />
      </div>
    </div>
  )
}
