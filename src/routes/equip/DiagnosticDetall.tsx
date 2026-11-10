// `/equip/diagnostics/:tipus/:id` — el diagnóstico operativo de UN productor, conducido por el
// equipo (A1, `20270520100000`).
//
// Dos cosas en una pantalla, en el orden en que se trabajan con la persona delante:
//   1. ARRIBA, el Pla de Prevenció si lo tiene abierto (el expediente, D4: el plan básico ya
//      no existe), o una tarjeta para abrirlo (`obrir_expedient`, solo `pot_aprovar()`); al
//      abrirlo, el expediente queda enlazado a este diagnóstico (`diagnostic_id`).
//   2. DEBAJO, el formulario del diagnóstico (`FormulariDiagnostic assistit`), que solo el
//      equipo puede guardar (D5).
//
// ⚠️ SOLO PRODUCTORES. Una receptora ya no tiene diagnóstico (fase 9): su perfil de recepción
//    vive en la pestaña «Diagnòstic i perfil» de su ficha, y allí se la lleva. El `:tipus`
//    se conserva en la URL para no romper enlaces antiguos.

import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { ArrowLeft, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { useAppContext } from '../../hooks/useAppContext'
import { expedientDelProductor, obrirExpedient } from '../../lib/expedientApi'
import FormulariDiagnostic from '../../components/FormulariDiagnostic'
import ExpedientVista from '../../components/expedient/ExpedientVista'
import CarregantSeccio from '../../components/CarregantSeccio'
import BotoAmbMotiu from '../../components/proces/BotoAmbMotiu'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function DiagnosticDetall() {
  const { t } = useT()
  const { tipus, id } = useParams<{ tipus: string; id: string }>()

  // El tipo entra por la URL, así que se valida: `/equip/diagnostics/cualquier-cosa/x`
  // no puede llegar hasta la RPC.
  if (!id || (tipus !== 'productor' && tipus !== 'entidad')) {
    return <p className="text-sm text-destructive">{t('diagd.bad_url')}</p>
  }
  // La ficha única resuelve el id de una ficha de rol a su organización (`EntitatDetall`).
  if (tipus === 'entidad') return <Navigate to={`/equip/entitats/${id}?pestanya=diagnostic`} replace />
  return <DiagnosticProductor key={id} id={id} />
}

function DiagnosticProductor({ id }: { id: string }) {
  const { t } = useT()
  const [fitxa, setFitxa] = useState<Record<string, unknown> | null>(null)
  // El prefill entra en el `carrega()` del formulario, así que llegar tarde significaría
  // recargarlo con lo tecleado dentro: se espera a la ficha.
  const [fitxaCarregada, setFitxaCarregada] = useState(false)

  useEffect(() => {
    let viu = true
    // `select('*')`: qué columnas sirven de prefill lo declara el cuestionario, que vive en
    // la base y cambia sin que cambie el software.
    void supabase.from('productores').select('*').eq('id', id).maybeSingle()
      .then(({ data }) => {
        if (!viu) return
        setFitxa((data as Record<string, unknown>) ?? null)
        setFitxaCarregada(true)
      })
    return () => { viu = false }
  }, [id])

  const nom = (fitxa?.empresa as string | null) || (fitxa?.name as string | null) || null
  // De vuelta a la ORGANIZACIÓN (la ficha única), no al id de la ficha de rol.
  const orgId = (fitxa?.organizacion_id as string | null) ?? id
  const fitxaUrl = `/equip/entitats/${orgId}?pestanya=diagnostic`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold break-words">{nom ?? t('diagd.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('org.paper_productor')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="h-11 whitespace-normal md:h-8">
            <Link to="/equip/diagnostics">
              <ArrowLeft className="size-4" aria-hidden />
              {t('diagd.back_list')}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="h-11 whitespace-normal md:h-8">
            <Link to={fitxaUrl}>{t('diagd.go_record')}</Link>
          </Button>
        </div>
      </div>

      <ExpedientDelDiagnostic productorId={id} />

      {!fitxaCarregada ? <CarregantSeccio /> : (
        <FormulariDiagnostic key={id} orgId={id} assistit prefill={fitxa} />
      )}
    </div>
  )
}

/** El expediente abierto del productor, o la tarjeta para abrirlo. */
function ExpedientDelDiagnostic({ productorId }: { productorId: string }) {
  const { t } = useT()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false
  const [estat, setEstat] = useState<{ carregant: boolean; id: string | null; error: string | null }>(
    { carregant: true, id: null, error: null })
  const [obrint, setObrint] = useState(false)

  const carrega = useCallback(async () => {
    const r = await expedientDelProductor(productorId)
    if (!r.ok) { setEstat({ carregant: false, id: null, error: r.missatge }); return }
    // El último expediente; uno cerrado ya no es «el abierto» (se puede abrir otro).
    const obert = r.data && r.data.estat !== 'tancat' ? r.data.id : null
    setEstat({ carregant: false, id: obert, error: null })
  }, [productorId])

  useEffect(() => { void carrega() }, [carrega])

  async function obre() {
    setObrint(true)
    const r = await obrirExpedient(productorId, 'basic')
    setObrint(false)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    toast.success(t('diagd.expedient_obert'))
    await carrega()
  }

  if (estat.carregant) return <CarregantSeccio files={2} />
  if (estat.error) return <p className="text-sm text-destructive">{textError(t, estat.error)}</p>
  if (estat.id) {
    return <ExpedientVista key={estat.id} expedientId={estat.id} editable potAprovar={potAprovar} />
  }
  return (
    <Card data-testid="sense-expedient">
      <CardHeader>
        <CardTitle className="text-base">{t('diagd.sense_expedient_t')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('diagd.sense_expedient')}</p>
        <BotoAmbMotiu
          onClick={() => void obre()}
          disabled={!potAprovar || obrint}
          motiu={potAprovar ? undefined : t('pe.only_admin')}
          className="min-h-11 whitespace-normal md:min-h-8"
        >
          <FolderOpen className="size-4" aria-hidden />
          {t('exp.obre')}
        </BotoAmbMotiu>
      </CardContent>
    </Card>
  )
}
