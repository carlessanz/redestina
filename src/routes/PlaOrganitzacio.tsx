// `/organitzacio/pla` — «El meu pla de prevenció» (fase 11 de la revisión del 08-10-2026): el
// expediente de la propia organización, en SOLO LECTURA. Es una sección distinta de «El meu
// diagnòstic», como pidió la Fundació (§7): el diagnóstico lo contesta la organización; el
// plan es un servicio que lleva el equipo.

import { useEffect, useState } from 'react'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { useOrganitzacio } from '../hooks/useAppContext'
import { expedientDelProductor } from '../lib/expedientApi'
import ExpedientVista from '../components/expedient/ExpedientVista'
import CarregantSeccio from '../components/CarregantSeccio'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function PlaOrganitzacio() {
  const { t } = useT()
  const org = useOrganitzacio('productor')
  const idOrg = org?.id ?? null
  const [estat, setEstat] = useState<{ carregant: boolean; id: string | null; error: string | null }>(
    { carregant: true, id: null, error: null })

  useEffect(() => {
    if (!idOrg) { setEstat({ carregant: false, id: null, error: null }); return }
    let viu = true
    void expedientDelProductor(idOrg).then((r) => {
      if (!viu) return
      setEstat(r.ok ? { carregant: false, id: r.data?.id ?? null, error: null } : { carregant: false, id: null, error: r.missatge })
    })
    return () => { viu = false }
  }, [idOrg])

  if (!org) return <p className="text-sm text-muted-foreground">{t('org.cap_fitxa')}</p>
  if (estat.carregant) return <CarregantSeccio />
  if (estat.error) return <p className="text-sm text-destructive">{textError(t, estat.error)}</p>
  if (!estat.id) {
    return (
      <Card>
        <CardHeader><CardTitle>{t('nav.my_pla')}</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">{t('exp.org_sense')}</p></CardContent>
      </Card>
    )
  }
  return <ExpedientVista key={estat.id} expedientId={estat.id} editable={false} potAprovar={false} />
}
