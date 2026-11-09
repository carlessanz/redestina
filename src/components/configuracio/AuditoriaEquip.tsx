// Auditoría del equipo (09-11-2026, 20270516100000, solo super_admin): todo lo que se ha hecho con
// las cuentas del equipo —cambios de rol, activar/desactivar, editar, borrar y cada traspaso de
// acciones—, con la fecha, quién lo hizo y a quién, con nombre y correo.
//
// Lo que pidió Carles: traspasar es solo para que otra persona pueda seguir lo pendiente; la
// auditoría conserva quién hizo cada cosa y cuándo, también cuando esa persona se borra. Por eso
// lee de `equip_auditoria()`, que resuelve los nombres desde el propio apunte (copiado al
// escribirlo) o desde `equip_persones_arxiu`, nunca solo desde `perfiles`.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { dataHora } from '../../lib/format'
import { persona, personesAuditoria, type ApuntAuditoria, type RolEquip } from '../../lib/equip'
import Desplegable from '../Desplegable'
import CarregantSeccio from '../CarregantSeccio'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const TOTS = '__tots'

export default function AuditoriaEquip({ refresc }: { refresc: number }) {
  const { t } = useT()
  const [apunts, setApunts] = useState<ApuntAuditoria[] | null>(null)
  const [error, setError] = useState(false)
  const [qui, setQui] = useState(TOTS)

  useEffect(() => {
    let viu = true
    void supabase.rpc('equip_auditoria', { p_user: null, p_limit: 500 }).then(({ data, error: err }) => {
      if (!viu) return
      setError(!!err)
      setApunts((data ?? []) as ApuntAuditoria[])
    })
    return () => { viu = false }
  }, [refresc])

  const persones = useMemo(() => personesAuditoria(apunts ?? []), [apunts])
  const visibles = useMemo(
    () => (apunts ?? []).filter((a) => qui === TOTS || a.user_id === qui),
    [apunts, qui],
  )

  const nomRol = (r: RolEquip | null) => (r ? t(`eq.rol_${r}`) : t('eq.cap'))

  /** El apunte, como una frase con nombres y correos. */
  function frase(a: ApuntAuditoria): string {
    const per = persona(a.per_nom, a.per_email) || t('eq.hist_algu')
    const email = persona(a.nom, a.email)
    if (a.accio === 'rol') return t('eq.h_rol', { per, email, abans: nomRol(a.rol_abans), despres: nomRol(a.rol_despres) })
    if (a.accio === 'mou_accions') {
      return t('eq.h_mou_accions', {
        per, email, total: a.total ?? 0,
        desti: persona(a.desti_nom, a.desti_email ?? a.detall?.desti_email),
        motiu: t(`eq.motiu_${a.detall?.motiu ?? 'traspas'}`),
      })
    }
    if (a.accio === 'esborra') return t('eq.h_esborra', { per, email, rol: nomRol(a.rol_abans) })
    return t(`eq.h_${a.accio}`, { per, email })
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{t('eq.aud_t')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('eq.aud_d')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {apunts === null && <CarregantSeccio />}
        {error && <p className="text-sm text-error" role="alert">{t('eq.aud_err')}</p>}
        {apunts !== null && persones.length > 0 && (
          <div className="max-w-sm space-y-1.5">
            <Desplegable
              value={qui} onChange={setQui} aria-label={t('eq.aud_filtre')} data-testid="eq-aud-qui"
              opcions={[
                { valor: TOTS, text: t('eq.aud_tothom') },
                ...persones.map((p) => ({ valor: p.user_id, text: p.esborrat ? `${p.text} · ${t('eq.aud_esborrat')}` : p.text })),
              ]}
            />
          </div>
        )}
        {apunts !== null && !error && visibles.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('eq.hist_buit')}</p>
        )}
        {visibles.length > 0 && (
          <ul className="divide-y divide-border text-sm" data-testid="eq-hist">
            {visibles.map((a, i) => (
              <li key={`${a.at}-${a.accio}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2" data-accio={a.accio}>
                <span className="min-w-0 flex-1 basis-60 [overflow-wrap:anywhere]">
                  {frase(a)}
                  {a.esborrat && <Badge className="ml-2 bg-muted text-muted-foreground">{t('eq.aud_esborrat')}</Badge>}
                </span>
                <span className="text-xs whitespace-nowrap text-muted-foreground">{dataHora(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
