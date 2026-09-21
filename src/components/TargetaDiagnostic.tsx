// El estado del diagnóstico de una organización, y el botón que lo mueve.
//
// Dos sitios, un componente, y por eso `mode`:
//   · `equip`  → en el slot `avisos` de la ficha (`FitxaRegistre`), junto a `BadgeConveni`.
//   · `extern` → encima de la ficha propia, en `/organitzacio`.
//
// Lo que cambia entre los dos no es el dato sino la VOZ y el destino: al equipo se le habla
// de esa organización en tercera persona y se le lleva a `/equip/diagnostics/:tipus/:id`; a
// la organización se le habla de lo suyo y se la lleva a `/organitzacio/diagnostic`. El
// estado sale de la misma RPC (`diagnostic_estat`), así que las dos pantallas no pueden
// decir cosas distintas del mismo diagnóstico.
//
// ⚠️ NUNCA EN ROJO. El diagnóstico **no bloquea operar**: se puede publicar una oferta y
//    mostrar interés sin haberlo hecho. El rojo está reservado a lo que sí corta —la ficha
//    incompleta, el convenio que falta desde la fecha de corte—, y gastarlo aquí devaluaría
//    la única señal que dice «esto te impide trabajar».
//
// ⚠️ Y NO CARGA NADA SI FALTA EL `orgId`: en el alta de una ficha (`/equip/productors/nou`)
//    todavía no hay a qué colgar un diagnóstico, igual que `CertificatsFitxa`.

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ClipboardList } from 'lucide-react'
import { useT } from '../lib/i18n'
import { estilEstatDiagnostic } from '../lib/diagnostic'
import { diagnosticEstat } from '../lib/diagnosticApi'
import type { TipusOrg } from '../lib/diagnosticApi'
import type { DiagnosticEstat } from '../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function TargetaDiagnostic({
  tipusOrg, orgId, mode,
}: {
  tipusOrg: TipusOrg
  orgId: string | null
  mode: 'equip' | 'extern'
}) {
  const { t } = useT()
  const [estat, setEstat] = useState<DiagnosticEstat | null>(null)
  const [carregat, setCarregat] = useState(false)

  useEffect(() => {
    if (!orgId) { setEstat(null); setCarregat(true); return }
    let viu = true
    setCarregat(false)
    void diagnosticEstat(tipusOrg, orgId).then((r) => {
      if (!viu) return
      setEstat(r.ok ? r.data : null)
      setCarregat(true)
    })
    return () => { viu = false }
  }, [tipusOrg, orgId])

  // Mientras carga no se pinta nada: una tarjeta que aparece con un texto y lo cambia dos
  // segundos después se lee como un fallo (§2, el salto de alto que arregló `CarregantSeccio`).
  if (!carregat || !estat) return null

  const desti = mode === 'equip'
    ? `/equip/diagnostics/${tipusOrg}/${orgId}`
    : '/organitzacio/diagnostic'
  const prefix = mode === 'equip' ? 'e' : 'o'
  const fet = estat.estat === 'emes'

  return (
    <Card className="border-border">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <ClipboardList className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t('diag.card_t')}</span>
              <Badge className={estilEstatDiagnostic(estat.estat)}>
                {t(`diag.st_${estat.estat}`)}
              </Badge>
              {/* Que el cuestionario sea texto de trabajo se dice también aquí: es lo que
                  determina si el PDF sale marcado como borrador. */}
              {estat.provisional && (
                <Badge variant="outline">{t('diag.provisional_badge')}</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`diag.${prefix}_card_${estat.estat}`, {
                n: estat.falten.length,
                m: estat.mesures_n,
                numero: estat.numero ?? '—',
              })}
            </p>
          </div>
        </div>

        <Button
          asChild
          variant={fet ? 'outline' : 'default'}
          className="h-11 shrink-0 whitespace-normal md:h-9"
        >
          <Link to={desti}>
            {t(fet ? 'diag.card_open' : 'diag.card_do')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
