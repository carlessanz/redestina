// Los consentimientos RGPD de las cuentas de una organización (`consentiments`), en el bloque
// de gestión interna de la ficha del equipo (1C; cierra la parte «pantalla» de la deuda
// §12.142: se guardaban y nadie podía verlos). Solo lectura: una fila por consentimiento
// registrado, la más reciente arriba. La RLS deja leer al equipo y a cada cuenta lo suyo.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { Badge } from '@/components/ui/badge'

interface Fila {
  id: string
  tipus: 'privacitat' | 'comunicacions_plataforma' | 'comunicacions_espigoladors'
  valor: boolean
  versio_text: string
  idioma: string
  origen: 'registre' | 'alta_assistida'
  created_at: string
}

export default function Consentiments({ organitzacioId }: { organitzacioId: string }) {
  const { t, lang } = useT()
  const [files, setFiles] = useState<Fila[]>([])
  const [carregat, setCarregat] = useState(false)

  useEffect(() => {
    let viu = true
    setCarregat(false)
    void supabase.from('consentiments')
      .select('id, tipus, valor, versio_text, idioma, origen, created_at')
      .eq('organizacion_id', organitzacioId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!viu) return
        setFiles((data ?? []) as Fila[])
        setCarregat(true)
      })
    return () => { viu = false }
  }, [organitzacioId])

  if (!carregat) return null
  return (
    <div className="space-y-2" data-testid="consentiments">
      <h4 className="text-sm font-semibold">{t('ef.consentiments')}</h4>
      {files.length === 0
        ? <p className="text-sm text-muted-foreground">{t('ef.cons_cap')}</p>
        : (
          <ul className="space-y-1 text-sm">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <span>{t(`ef.cons_${f.tipus}`)}</span>
                <Badge className={f.valor ? 'bg-exito-fondo text-exito' : 'bg-muted text-muted-foreground'}>
                  {t(f.valor ? 'ef.cons_acceptat' : 'ef.cons_rebutjat')}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(f.created_at).toLocaleDateString(lang === 'es' ? 'es-ES' : 'ca-ES')} · {t(`ef.cons_origen_${f.origen}`)} · v{f.versio_text} · {f.idioma}
                </span>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
