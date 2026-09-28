// Detalle de oferta del equipo. Carga el excedente por su id y se lo pasa a
// OfferDetail tal cual: el componente (609 líneas, con priorización, envíos,
// aprobación y cierre) no se toca.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import type { Excedente } from '../../types'
import OfferDetail from '../../components/OfferDetail'

export default function OfertaDetall() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [excedente, setExcedente] = useState<Excedente | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let viu = true
    void supabase.from('excedentes').select('*').eq('id', id).maybeSingle()
      .then(({ data, error: err }) => {
        if (!viu) return
        if (err) setError(t('c.load_error'))
        else if (!data) setError(t('od.not_found'))
        else setExcedente(data as Excedente)
      })
    return () => { viu = false }
  }, [id, t])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!excedente) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  return <OfferDetail excedente={excedente} onBack={() => navigate('/equip/ofertes')} />
}
