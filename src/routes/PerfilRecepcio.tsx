// `/organitzacio/perfil-recepcio` — «El meu perfil de recepció» (fase 9 de la revisión del
// 08-10-2026, §3: «“El meu diagnòstic” → “El meu perfil de recepció”»).
//
// Responde a una sola pregunta: ¿qué necesita, qué puede recibir y cómo le podemos hacer
// llegar excedentes a esta entidad? Por eso reúne lo que sirve para el matching —las
// modalidades que le interesan, las preferencias de recepción (fase 7) y las condiciones
// propias de su tipo— y NADA de plan de prevención: al receptor no se le hace un plan.
//
// ⚠️ Los datos son los mismos de siempre (`entidades.perfil_receptor` y
//    `entidades.modalitats_interes`) y se guardan con la misma RPC de la ficha
//    (`actualitzar_fitxa_entitat`), que solo toca las claves que recibe. Lo único que cambia
//    es DÓNDE se editan: salieron de «La meva organització» para que no haya dos formularios
//    del mismo dato.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { useOrganitzacio } from '../hooks/useAppContext'
import { CLAUS_PREFERENCIES, PERFIL_RECEPTOR, PREFERENCIES_RECEPCIO } from '../lib/perfilReceptor'
import CampsPerfilReceptor from '../components/CampsPerfilReceptor'
import CarregantSeccio from '../components/CarregantSeccio'
import XipsTria from '../components/XipsTria'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface FilaRecepcio {
  tipo_receptor: string | null
  perfil_receptor: Record<string, unknown> | null
  modalitats_interes: string[] | null
}

export default function PerfilRecepcio() {
  const { t } = useT()
  const organitzacio = useOrganitzacio('entidad')
  const idOrg = organitzacio?.id ?? null
  const potEditar = organitzacio?.rol_org === 'titular'
  const [fila, setFila] = useState<FilaRecepcio | null>(null)
  const [perfil, setPerfil] = useState<Record<string, unknown>>({})
  const [modalitats, setModalitats] = useState<string[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState(false)
  const [desant, setDesant] = useState(false)

  useEffect(() => {
    if (!idOrg) { setCarregant(false); return }
    let viu = true
    setCarregant(true)
    void supabase.from('entidades')
      .select('tipo_receptor, perfil_receptor, modalitats_interes')
      .eq('id', idOrg).maybeSingle()
      .then(({ data, error: e }) => {
        if (!viu) return
        const f = (data as FilaRecepcio | null) ?? null
        setError(Boolean(e) || !f)
        setFila(f)
        setPerfil(f?.perfil_receptor ?? {})
        setModalitats(f?.modalitats_interes ?? [])
        setCarregant(false)
      })
    return () => { viu = false }
  }, [idOrg])

  async function desa() {
    if (!idOrg) return
    setDesant(true)
    const { error: e } = await supabase.rpc('actualitzar_fitxa_entitat', {
      p_id: idOrg,
      p_dades: { perfil_receptor: perfil, modalitats_interes: modalitats },
    })
    setDesant(false)
    if (e) { toast.error(textError(t, e.message)); return }
    toast.success(t('rec.saved'))
  }

  if (!organitzacio) return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>
  if (carregant) return <CarregantSeccio />
  if (error || !fila) return <p className="text-sm text-destructive">{t('org.err_load')}</p>

  const tipusReceptor = fila.tipo_receptor ?? ''
  const campsTipus = (PERFIL_RECEPTOR[tipusReceptor] ?? []).filter((c) => !CLAUS_PREFERENCIES.has(c.clau))

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{t('nav.perfil_recepcio')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('precep.intro')}</p>
        </div>
        {potEditar && (
          <Button onClick={() => void desa()} disabled={desant} className="min-h-11 w-full whitespace-normal sm:w-auto">
            {desant ? t('c.saving') : t('c.save')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-3" data-testid="preferencies-recepcio">
          <div>
            <h3 className="text-base font-semibold">{t('org.sec_preferencies')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t('org.h_preferencies')}</p>
          </div>
          <div>
            <p id="pr-mod-int-l" className="mb-1.5 text-xs text-muted-foreground">{t('org.f_modalitats_interes')}</p>
            <XipsTria etiquetaId="pr-mod-int-l" disabled={!potEditar}
              opcions={[
                { valor: 'venda', text: t('org.mi_compra') },
                { valor: 'donacio', text: t('org.mi_donacio') },
                { valor: 'maquila', text: t('org.mi_maquila') },
              ]}
              triats={modalitats}
              onChange={setModalitats} />
            <p className="mt-1 text-xs text-muted-foreground">{t('org.h_modalitats_interes')}</p>
          </div>
          <CampsPerfilReceptor tipusReceptor={tipusReceptor} camps={PREFERENCIES_RECEPCIO} perfil={perfil}
            onChange={setPerfil} disabled={!potEditar} idPrefix="pref" />
        </section>

        {campsTipus.length > 0 && (
          <section className="space-y-3 border-t border-border pt-6">
            <div>
              <h3 className="text-base font-semibold">{t('precep.sec_condicions')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`org.sec_perfil_${tipusReceptor}`)} · {t('org.h_perfil')}</p>
            </div>
            <CampsPerfilReceptor tipusReceptor={tipusReceptor} perfil={perfil}
              onChange={setPerfil} disabled={!potEditar} excloure={CLAUS_PREFERENCIES} />
          </section>
        )}

        <p className="text-sm text-muted-foreground">
          {t('org.tipus_receptor', { x: tipusReceptor ? t(`org.tr_${tipusReceptor}`) : '—' })}
        </p>
      </CardContent>
    </Card>
  )
}
