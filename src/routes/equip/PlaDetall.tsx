// `/equip/plans/:id` — un expediente de prevención, para el equipo (fase 11).

import { Link, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import ExpedientVista from '../../components/expedient/ExpedientVista'
import { Button } from '@/components/ui/button'

export default function PlaDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const { ctx } = useAppContext()
  if (!id) return <p className="text-sm text-destructive">{t('diagd.bad_url')}</p>
  return (
    <div className="space-y-4">
      <Button asChild variant="outline" size="sm" className="h-11 md:h-9">
        <Link to="/equip/plans"><ArrowLeft className="size-4" aria-hidden /> {t('exp.tornar')}</Link>
      </Button>
      <ExpedientVista key={id} expedientId={id} editable potAprovar={ctx?.potAprovar ?? false} />
    </div>
  )
}
