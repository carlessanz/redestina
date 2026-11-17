// Detalle de oferta del equipo. Carga el excedente por su id y se lo pasa a
// OfferDetail tal cual: el componente (con priorización, envíos, aprobación y cierre) no se toca.
//
// Un ESBORRANY (fase C del punto 3, 17-11-2026) no tiene detalle: no circula, no tiene `E-…` ni
// texto. Abrirlo es abrir el formulario del alta con lo que se guardó, para seguir, publicarlo o
// borrarlo. Al publicarlo, la misma ruta pasa a enseñar el detalle.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import type { Excedente } from '../../types'
import OfferDetail from '../../components/OfferDetail'
import FormulariNovaOferta from '../../components/FormulariNovaOferta'
import { Button } from '@/components/ui/button'

export default function OfertaDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [excedente, setExcedente] = useState<Excedente | null>(null)
  const [error, setError] = useState<string | null>(null)

  const carrega = useCallback(async () => {
    if (!id) return
    const { data, error: err } = await supabase.from('excedentes').select('*').eq('id', id).maybeSingle()
    if (err) setError(t('c.load_error'))
    else if (!data) setError(t('od.not_found'))
    else setExcedente(data as Excedente)
  }, [id, t])

  useEffect(() => { void carrega() }, [carrega])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!excedente) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  if (excedente.estado === 'esborrany') {
    const aEsborranys = () => navigate('/equip/ofertes?tab=esborranys')
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={aEsborranys} className="text-muted-foreground">
          <ArrowLeft className="size-4" /> {t('od.back')}
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{t('esb.titol', { producte: excedente.producto ?? '—' })}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('esb.intro')}</p>
        </div>
        <FormulariNovaOferta
          key={excedente.id}
          mode="esborrany"
          oferta={excedente}
          productorId={excedente.productor_id}
          onCreada={() => { setExcedente(null); void carrega() }}
          onEsborranyDesat={aEsborranys}
          onEsborrat={aEsborranys}
          onCancel={aEsborranys}
        />
      </div>
    )
  }
  return <OfferDetail excedente={excedente} onBack={() => navigate('/equip/ofertes')} />
}
