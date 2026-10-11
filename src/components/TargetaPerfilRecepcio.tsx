// La tarjeta que lleva al «Meu perfil de recepció» desde la ficha de la organización
// receptora (fase 9 de la revisión del 08-10-2026). Ocupa el sitio que tenía el diagnóstico:
// el receptor ya no tiene diagnóstico, tiene sus preferencias de recepción.

import { Link } from 'react-router'
import { ArrowRight, Inbox } from 'lucide-react'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function TargetaPerfilRecepcio() {
  const { t } = useT()
  return (
    <Card className="border-border py-0">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <Inbox className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">{t('precep.card_t')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('precep.card_d')}</p>
          </div>
        </div>
        <Button asChild variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-9">
          <Link to="/organitzacio/perfil-recepcio">
            {t('precep.card_go')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
