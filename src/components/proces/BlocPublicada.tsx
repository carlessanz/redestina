// Lo que se ve justo después de publicar una oferta.
//
// Antes de esto, publicar terminaba con un toast y una redirección: la persona se quedaba
// sin saber su referencia, sin saber qué pasa a continuación y sin un camino evidente para
// publicar otra —que es lo normal en un día de recogida—. Aquí se dan las tres cosas.
//
// La referencia va en `<code>` y no en un `<p>`: es un identificador que alguien va a leer
// por teléfono al equipo, así que se pinta en monoespaciada y seleccionable.

import { CheckCircle2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import type { PuntProces } from '../../lib/procesOferta'
import QueTocaAra from './QueTocaAra'
import { Button } from '@/components/ui/button'

export default function BlocPublicada({
  referencia,
  punt,
  correuEnviat,
  onInici,
  onAltra,
}: {
  /** El `id_excedente`, tal cual lo devuelve el servidor. */
  referencia: string
  /** El punto del proceso en el que queda: la etapa 1 vista por el productor. */
  punt: PuntProces
  /** Solo se promete el correo si de verdad ha salido (§8: puede estar apagado). */
  correuEnviat: boolean
  onInici: () => void
  onAltra: () => void
}) {
  const { t } = useT()

  return (
    <div className="space-y-4 rounded-xl border border-exito/30 bg-exito-fondo p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-exito" aria-hidden />
        <div className="min-w-0 space-y-1">
          <h2 className="font-titulos text-lg font-semibold text-exito">
            {t('proc.publicada_ok_t')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('proc.publicada_ref')}:{' '}
            <code className="rounded bg-card px-1.5 py-0.5 text-sm text-foreground">
              {referencia}
            </code>
          </p>
        </div>
      </div>

      <QueTocaAra punt={punt} compacte />

      {correuEnviat && (
        <p className="text-sm text-muted-foreground">{t('proc.publicada_email')}</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="h-11 whitespace-normal md:h-9" onClick={onInici}>
          {t('proc.publicada_home')}
        </Button>
        <Button
          variant="outline"
          className="h-11 whitespace-normal md:h-9"
          onClick={onAltra}
        >
          {t('proc.publicada_another')}
        </Button>
      </div>
    </div>
  )
}
