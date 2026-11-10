// El estado del diagnóstico operativo del propio productor, encima de su ficha en
// «La meva organització», con el enlace para consultarlo.
//
// Desde A1 (`20270520100000`, D5) el diagnóstico lo actualiza el equipo y el productor lo
// LEE: la tarjeta ya no invita a hacerlo ni a continuarlo, invita a consultarlo. El equipo ya
// no la usa: en su ficha ve el resumen entero (`ResumDiagnostic`).
//
// ⚠️ NUNCA EN ROJO. El diagnóstico **no bloquea operar**: el rojo está reservado a lo que sí
//    corta —la ficha incompleta, el convenio que falta—, y gastarlo aquí devaluaría la única
//    señal que dice «esto te impide trabajar».
//
// ⚠️ Y NO CARGA NADA SI FALTA EL `orgId`.

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ClipboardList } from 'lucide-react'
import { useT } from '../lib/i18n'
import { estilEstatDiagnostic } from '../lib/diagnostic'
import { diagnosticEstat } from '../lib/diagnosticApi'
import type { DiagnosticEstat } from '../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function TargetaDiagnostic({ orgId }: { orgId: string | null }) {
  const { t } = useT()
  const [estat, setEstat] = useState<DiagnosticEstat | null>(null)
  const [carregat, setCarregat] = useState(false)

  useEffect(() => {
    if (!orgId) { setEstat(null); setCarregat(true); return }
    let viu = true
    setCarregat(false)
    void diagnosticEstat('productor', orgId).then((r) => {
      if (!viu) return
      setEstat(r.ok ? r.data : null)
      setCarregat(true)
    })
    return () => { viu = false }
  }, [orgId])

  // Mientras carga no se pinta nada: una tarjeta que aparece con un texto y lo cambia dos
  // segundos después se lee como un fallo (§2, el salto de alto que arregló `CarregantSeccio`).
  if (!carregat || !estat) return null

  const e = estat.estat

  return (
    // `py-0`: el `Card` de shadcn trae `py-6` y el contenido ya lleva su `py-4`.
    <Card className="border-border py-0">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <ClipboardList className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t('diag.card_t')}</span>
              <Badge className={estilEstatDiagnostic(e)}>{t(`diag.st_${e}`)}</Badge>
              {estat.provisional && (
                <Badge variant="outline">{t('diag.provisional_badge')}</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t(`diag.o_card_${e}`)}</p>
          </div>
        </div>

        <Button asChild variant="outline" className="h-11 shrink-0 whitespace-normal md:h-8">
          <Link to="/organitzacio/diagnostic">
            {t('diag.card_consulta')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
