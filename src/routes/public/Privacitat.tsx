// `/privacitat` — la política de privacidad (27-10-2026). Pública: la enlazan las casillas
// RGPD del alta y el pie de la portada, y la lee quien todavía no tiene cuenta.
//
// ⚠️ TEXTO DE TRABAJO, NO VALIDADO POR LA ASESORÍA, y lo dice arriba del todo, como los
//    convenios. Cuando llegue el texto definitivo se sustituye aquí y se sube `VERSIO_RGPD`
//    (`textosRgpd.ts`): las altas guardan qué versión se aceptó.

import { Link } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { VERSIO_RGPD } from '../../lib/textosRgpd'
import SelectorIdioma from '../../components/SelectorIdioma'
import { Card, CardContent } from '@/components/ui/card'

const SECCIONS = ['responsable', 'finalitats', 'base', 'destinataris', 'conservacio', 'comunicacions', 'drets'] as const

export default function Privacitat() {
  const { t } = useT()
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
        <Link to="/" aria-label="Redestina">
          <img src="/logo-redestina.svg" alt="Redestina" className="h-9 w-auto" />
        </Link>
        <SelectorIdioma />
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 pb-12">
        <h1 className="text-2xl font-bold">{t('priv.title')}</h1>
        <div className="flex items-start gap-2 rounded-md border border-aviso/30 bg-aviso-fondo p-3 text-sm text-aviso">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0">{t('priv.provisional')}</p>
        </div>
        <Card>
          <CardContent className="space-y-5 pt-6 text-sm leading-relaxed">
            {SECCIONS.map((s) => (
              <section key={s} className="space-y-1.5">
                <h2 className="text-base font-semibold">{t(`priv.${s}_t`)}</h2>
                <p className="text-muted-foreground">{t(`priv.${s}`)}</p>
              </section>
            ))}
            <p className="text-xs text-muted-foreground">{t('priv.versio', { v: VERSIO_RGPD })}</p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
