// `/organitzacio/diagnostic` — el «Diagnòstic operatiu» de la propia organización productora.
//
// Cuelga de `/organitzacio` y no de un panel, por lo mismo que la ficha. Desde la fase 9
// solo existe para el papel de productor (ver el comentario del componente).
//
// ⚠️ LA FICHA SE PIDE CON `select('*')` a propósito: qué columnas se usan para proponer un
//    valor inicial lo declara el CUESTIONARIO (`prefill: "<taula>.<columna>"`), que vive en
//    la base y cambia sin que cambie el software.

import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import FormulariDiagnostic from '../components/FormulariDiagnostic'
import CarregantSeccio from '../components/CarregantSeccio'

/**
 * Desde la fase 9 (revisión del 08-10-2026) es el «Diagnòstic operatiu» del PRODUCTOR: una
 * ficha viva y nada más. Ni pla proposat ni «Emet el pla» —el Pla de Prevenció es un
 * servicio que prepara el equipo— y el receptor ya no tiene diagnóstico: su sitio es «El meu
 * perfil de recepció», adonde se le redirige.
 */
export default function Diagnostic() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const orgs = ctx?.organitzacions ?? []
  const productor = orgs.find((o) => o.tipo === 'productor')

  if (!productor) {
    if (orgs.some((o) => o.tipo === 'entidad')) return <Navigate to="/organitzacio/perfil-recepcio" replace />
    return <p className="text-sm text-muted-foreground">{t('org.cap_fitxa')}</p>
  }
  return <PanellDiagnostic key={productor.id} orgId={productor.id} />
}

/** El formulario. Espera a la ficha porque `prefill` entra en su `carrega()`. */
function PanellDiagnostic({ orgId }: { orgId: string }) {
  const [fitxa, setFitxa] = useState<Record<string, unknown> | null>(null)
  const [fitxaCarregada, setFitxaCarregada] = useState(false)

  useEffect(() => {
    let viu = true
    setFitxaCarregada(false)
    void supabase.from('productores').select('*').eq('id', orgId).maybeSingle()
      .then(({ data }) => {
        if (!viu) return
        setFitxa((data as Record<string, unknown>) ?? null)
        setFitxaCarregada(true)
      })
    return () => { viu = false }
  }, [orgId])

  if (!fitxaCarregada) return <CarregantSeccio />
  return <FormulariDiagnostic tipusOrg="productor" orgId={orgId} prefill={fitxa} />
}
