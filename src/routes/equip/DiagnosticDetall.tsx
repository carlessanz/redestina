// `/equip/diagnostics/:tipus/:id` — el diagnóstico de UNA organización, conducido por el
// equipo.
//
// Es la misma pantalla que ve la organización en su panel, con dos diferencias que no son
// cosméticas: se monta con `assistit` —así el formulario dice quién está contestando y el
// «què toca ara» habla en tercera persona— y con `potEditar`, que es lo que abre el ajuste
// a mano de las medidas y el nivel del plan.
//
// 🔴 NO HAY UN SEGUNDO CIRCUITO. Las dos vías llaman a `desar_diagnostic()` y a
//    `emitir_plan_basico()`, o sea que producen el mismo borrador, el mismo snapshot y el
//    mismo PDF. Lo único que cambia es quién está delante del teclado, que es exactamente
//    el modelo asistido (§1bis) — y por eso este fichero es un marco de treinta líneas y no
//    una copia del formulario.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import FormulariDiagnostic from '../../components/FormulariDiagnostic'
import PlaPrevencio from '../../components/PlaPrevencio'
import CarregantSeccio from '../../components/CarregantSeccio'
import { diagnosticEstat } from '../../lib/diagnosticApi'
import type { TipusOrg } from '../../lib/diagnosticApi'
import { Button } from '@/components/ui/button'

export default function DiagnosticDetall() {
  const { t } = useT()
  const { tipus, id } = useParams<{ tipus: string; id: string }>()
  const [fitxa, setFitxa] = useState<Record<string, unknown> | null>(null)
  // Ver la nota de `routes/Diagnostic.tsx`: el prefill entra en el `carrega()` del
  // formulario, así que llegar tarde significaría recargarlo con lo tecleado dentro.
  const [fitxaCarregada, setFitxaCarregada] = useState(false)
  const [nom, setNom] = useState<string | null>(null)
  const [plaVigent, setPlaVigent] = useState<string | null>(null)
  const [versio, setVersio] = useState(0)

  // El tipo entra por la URL, así que se valida: `/equip/diagnostics/cualquier-cosa/x`
  // llegaría hasta la RPC y respondería `22023`, que es un error correcto pero ilegible.
  const tipusOrg: TipusOrg | null =
    tipus === 'productor' || tipus === 'entidad' ? tipus : null
  const taula = tipusOrg === 'productor' ? 'productores' : 'entidades'

  useEffect(() => {
    if (!tipusOrg || !id) return
    let viu = true
    // `select('*')`: qué columnas sirven de prefill lo declara el cuestionario, que vive en
    // la base (ver la nota de `routes/Diagnostic.tsx`).
    setFitxaCarregada(false)
    void supabase.from(taula).select('*').eq('id', id).maybeSingle()
      .then(({ data }) => {
        if (!viu) return
        const f = (data as Record<string, unknown>) ?? null
        setFitxa(f)
        setFitxaCarregada(true)
        setNom(
          (f?.empresa as string | null)
          || (f?.name as string | null)
          || (f?.nombre as string | null)
          || null,
        )
      })
    return () => { viu = false }
  }, [taula, id, tipusOrg])

  useEffect(() => {
    if (!tipusOrg || !id) return
    let viu = true
    void diagnosticEstat(tipusOrg, id).then((r) => {
      if (viu && r.ok) setPlaVigent(r.data.pla_vigent)
    })
    return () => { viu = false }
  }, [tipusOrg, id, versio])

  if (!tipusOrg || !id) {
    return <p className="text-sm text-destructive">{t('diagd.bad_url')}</p>
  }

  const tornar = tipusOrg === 'productor' ? '/equip/productors' : '/equip/entitats'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{nom ?? t('diagd.title')}</h2>
          <p className="text-sm text-muted-foreground">
            {t(tipusOrg === 'productor' ? 'org.paper_productor' : 'org.paper_receptor')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="h-11 whitespace-normal md:h-9">
            <Link to="/equip/diagnostics">
              <ArrowLeft className="size-4" aria-hidden />
              {t('diagd.back_list')}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-11 whitespace-normal md:h-9">
            <Link to={`${tornar}/${id}`}>{t('diagd.go_record')}</Link>
          </Button>
        </div>
      </div>

      {!fitxaCarregada ? <CarregantSeccio /> : (
      <FormulariDiagnostic
        key={`${tipusOrg}-${id}`}
        tipusOrg={tipusOrg}
        orgId={id}
        assistit
        prefill={fitxa}
        onDesat={() => setVersio((v) => v + 1)}
      />
      )}

      <PlaPrevencio
        key={`pla-${tipusOrg}-${id}-${versio}`}
        tipusOrg={tipusOrg}
        orgId={id}
        potEditar
        plaVigentId={plaVigent}
        onCanvi={() => setVersio((v) => v + 1)}
      />
    </div>
  )
}
