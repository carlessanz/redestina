// `/organitzacio/diagnostic` — el diagnóstico de prevención de la propia organización.
//
// Cuelga de `/organitzacio` y no de un panel, por lo mismo que la ficha: una organización
// es una, y sus papeles son un detalle suyo. Con doble rol son **dos diagnósticos de
// verdad** —el cuestionario del generador y el del receptor no se parecen en nada, y
// `planes_prevencion` guarda un borrador por tipo—, así que aquí sí hay dos pestañas y cada
// una lleva su formulario y su plan.
//
// ⚠️ `key` POR PESTAÑA, y aquí importa tanto como en `PerfilOrganitzacio`: es el mismo
//    componente con otro `tipusOrg`, y sin `key` React reutilizaría la instancia. Cambiarían
//    el cuestionario y las preguntas pero las respuestas tecleadas seguirían siendo las de
//    la otra ficha, y «Desa» las escribiría en el diagnóstico equivocado.
//
// ⚠️ LA FICHA SE PIDE CON `select('*')` a propósito. Qué columnas se usan para proponer un
//    valor inicial lo declara el CUESTIONARIO (`prefill: "<taula>.<columna>"`), que vive en
//    la base y cambia sin que cambie el software: una lista fija aquí se quedaría vieja el
//    día que la Fundación publique su anexo B, y el prefill dejaría de funcionar sin que
//    nada fallara. Ninguna de las dos tablas tiene GRANT por columnas (§4).

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import FormulariDiagnostic from '../components/FormulariDiagnostic'
import PlaPrevencio from '../components/PlaPrevencio'
import CarregantSeccio from '../components/CarregantSeccio'
import TriaPaper from '../components/TriaPaper'
import { diagnosticEstat } from '../lib/diagnosticApi'
import type { TipusOrg } from '../lib/diagnosticApi'

export default function Diagnostic() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const [tria, setTria] = useState<TipusOrg | null>(null)

  const orgs = ctx?.organitzacions ?? []
  const te: TipusOrg[] = []
  if (orgs.some((o) => o.tipo === 'productor')) te.push('productor')
  if (orgs.some((o) => o.tipo === 'entidad')) te.push('entidad')

  // El equipo no tiene organización propia: opera en nombre de otros y su camino es
  // `/equip/diagnostics`. El menú no le pinta esta entrada, pero la ruta existe.
  if (te.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('org.cap_fitxa')}</p>
  }

  const actiu = tria && te.includes(tria) ? tria : te[0]
  const org = orgs.find((o) => o.tipo === actiu)
  if (!org) return <p className="text-sm text-muted-foreground">{t('org.cap_fitxa')}</p>

  return (
    <div className="space-y-4">
      {te.length > 1 && (
        <>
          <p className="text-sm text-muted-foreground">{t('diag.two_roles')}</p>
          <TriaPaper opcions={te} actiu={actiu} onTria={setTria} />
        </>
      )}

      <PanellDiagnostic key={actiu} tipusOrg={actiu} orgId={org.id} />
    </div>
  )
}

/** El formulario y el plan de UN papel. Separado para que el `key` de arriba lo remonte. */
function PanellDiagnostic({ tipusOrg, orgId }: { tipusOrg: TipusOrg; orgId: string }) {
  const [fitxa, setFitxa] = useState<Record<string, unknown> | null>(null)
  // ⚠️ SE ESPERA A LA FICHA ANTES DE MONTAR EL FORMULARIO, y no es una preferencia estética:
  //    `prefill` es una prop del formulario y entra en su `carrega()`. Si llegara tarde,
  //    `carrega()` se volvería a ejecutar y se llevaría por delante lo que se hubiera
  //    tecleado entretanto — el mismo fallo que documenta `PerfilOrganitzacio` con el
  //    contexto de sesión, pero aquí con una consulta que siempre tarda un poco.
  const [fitxaCarregada, setFitxaCarregada] = useState(false)
  const [plaVigent, setPlaVigent] = useState<string | null>(null)
  // Cambia al guardar: es lo que hace que el plan se recargue sin recargar el formulario.
  const [versio, setVersio] = useState(0)

  const taula = tipusOrg === 'productor' ? 'productores' : 'entidades'

  useEffect(() => {
    let viu = true
    setFitxaCarregada(false)
    void supabase.from(taula).select('*').eq('id', orgId).maybeSingle()
      .then(({ data }) => {
        if (!viu) return
        setFitxa((data as Record<string, unknown>) ?? null)
        setFitxaCarregada(true)
      })
    return () => { viu = false }
  }, [taula, orgId])

  useEffect(() => {
    let viu = true
    void diagnosticEstat(tipusOrg, orgId).then((r) => {
      if (viu && r.ok) setPlaVigent(r.data.pla_vigent)
    })
    return () => { viu = false }
  }, [tipusOrg, orgId, versio])

  if (!fitxaCarregada) return <CarregantSeccio />

  return (
    <div className="space-y-4">
      <FormulariDiagnostic
        tipusOrg={tipusOrg}
        orgId={orgId}
        prefill={fitxa}
        onDesat={() => setVersio((v) => v + 1)}
      />
      {/* El plan solo se pinta cuando ya hay algo que enseñar: un bloque vacío debajo de un
          cuestionario a medias solo añade ruido. `PlaPrevencio` decide eso por su cuenta a
          partir de lo que encuentre, así que aquí se monta siempre y se le pasa la versión
          para que se recargue tras cada guardado. */}
      <PlaPrevencio
        key={`pla-${versio}`}
        tipusOrg={tipusOrg}
        orgId={orgId}
        plaVigentId={plaVigent}
        onCanvi={() => setVersio((v) => v + 1)}
      />
    </div>
  )
}
