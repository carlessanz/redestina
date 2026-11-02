// El acceso a la plataforma en el bloque «Contacte i accés» de la ficha del equipo (plan 1, 1D).
//
// Estado de la cuenta por `estat_acces_org()` —el correo de la cuenta llega enmascarado y la
// pantalla no consulta `auth`— y tres acciones: «Dona-li accés» y «Torna a enviar» llaman a la
// Edge Function `donar-acces` (crea la cuenta si no la hay y manda el correo para poner la
// contraseña); «Desactiva l'accés», a `desactivar_acces_org()`. Qué sale y por qué está gris,
// en `lib/accesEntitat.ts`.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { dataCurta } from '../../lib/format'
import { donarAcces } from '../../lib/acces'
import { accionsAcces, clauErrorAcces, type EstatAcces } from '../../lib/accesEntitat'
import { useConfirma } from '../DialegConfirma'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import { Badge } from '@/components/ui/badge'

interface Estat {
  estat: EstatAcces
  compte_email: string | null
  enviat_at: string | null
  darrer_acces_at: string | null
}

const COLOR: Record<EstatAcces, string> = {
  sense: 'bg-muted text-muted-foreground',
  pendent: 'bg-aviso-fondo text-aviso',
  enviat: 'bg-aviso-fondo text-aviso',
  actiu: 'bg-exito-fondo text-exito',
  desactivat: 'bg-muted text-muted-foreground',
}

export default function AccesEntitat({ orgId, correu, correuCanviat, entitatActiva, potAprovar, motiuCorreu, onCanviat }: {
  orgId: string
  /** El correo de la ficha, tal como está en el formulario. */
  correu: string
  correuCanviat: boolean
  entitatActiva: boolean
  potAprovar: boolean
  motiuCorreu: string | null
  /** El acceso ha cambiado: quien monta esto recarga la ficha (estado del listado, correo). */
  onCanviat: () => void
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [estat, setEstat] = useState<Estat | null>(null)
  const [ocupat, setOcupat] = useState(false)

  const carrega = useCallback(async () => {
    const { data, error } = await supabase.rpc('estat_acces_org', { p_org: orgId })
    if (error) { setEstat(null); return }
    const fila = (Array.isArray(data) ? data[0] : data) as Estat | undefined
    setEstat(fila ?? null)
  }, [orgId])
  useEffect(() => { void carrega() }, [carrega])

  async function envia(reenviar: boolean) {
    setOcupat(true)
    const r = await donarAcces(orgId, correu.trim())
    setOcupat(false)
    if (!r.ok) { toast.error(t(clauErrorAcces(r.codi))); return }
    toast.success(t(reenviar ? 'acc.ok_reenviat' : 'acc.ok_donat', { email: correu.trim() }))
    await carrega()
    onCanviat()
  }

  async function desactiva() {
    if (!(await confirma({
      titol: t('acc.confirm_t'),
      descripcio: t('acc.confirm_d'),
      confirmar: t('acc.desactivar'),
      destructiu: true,
    }))) return
    setOcupat(true)
    const { error } = await supabase.rpc('desactivar_acces_org', { p_org: orgId })
    setOcupat(false)
    if (error) { toast.error(textError(t, error.message)); return }
    toast.success(t('acc.ok_desactivat'))
    await carrega()
    onCanviat()
  }

  if (!estat) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  const accions = accionsAcces({ estat: estat.estat, potAprovar, entitatActiva, correu, correuCanviat, motiuCorreu })
  const detall = [
    estat.compte_email && t('acc.d_compte', { email: estat.compte_email }),
    estat.estat === 'enviat' && estat.enviat_at && t('acc.d_enviat', { data: dataCurta(estat.enviat_at) }),
    estat.estat === 'actiu' && estat.darrer_acces_at && t('acc.d_darrer', { data: dataCurta(estat.darrer_acces_at) }),
  ].filter(Boolean).join(' · ')
  // El primer motivo, también fuera del tooltip: en el móvil no hay hover (`BotoAmbMotiu`).
  const motiu = (accions.donar ?? accions.reenviar)?.motiu ?? null

  return (
    <div className="space-y-2 text-sm" data-testid="acces-entitat">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t('ef.compte')}:</span>
        <Badge className={COLOR[estat.estat]} data-testid="compte-estat" data-estat={estat.estat}>
          {t(`acc.estat_${estat.estat}`)}
        </Badge>
      </div>
      {detall && <p className="text-xs text-muted-foreground">{detall}</p>}
      {estat.estat === 'pendent' && <p className="text-xs text-muted-foreground">{t('acc.h_pendent')}</p>}
      <div className="flex flex-wrap gap-2">
        {accions.donar && (
          <BotoAmbMotiu variant="outline" size="sm" disabled={ocupat || !!accions.donar.motiu}
            motiu={accions.donar.motiu ? t(accions.donar.motiu) : undefined} onClick={() => void envia(false)}>
            {t('acc.donar')}
          </BotoAmbMotiu>
        )}
        {accions.reenviar && (
          <BotoAmbMotiu variant="outline" size="sm" disabled={ocupat || !!accions.reenviar.motiu}
            motiu={accions.reenviar.motiu ? t(accions.reenviar.motiu) : undefined} onClick={() => void envia(true)}>
            {t('acc.reenviar')}
          </BotoAmbMotiu>
        )}
        {accions.desactivar && (
          <BotoAmbMotiu variant="ghost" size="sm" className="text-destructive" disabled={ocupat || !!accions.desactivar.motiu}
            motiu={accions.desactivar.motiu ? t(accions.desactivar.motiu) : undefined} onClick={() => void desactiva()}>
            {t('acc.desactivar')}
          </BotoAmbMotiu>
        )}
      </div>
      {motiu && <p className="text-xs text-muted-foreground" data-testid="acces-motiu">{t(motiu)}</p>}
      <p className="text-xs text-muted-foreground">{t('ef.h_compte')}</p>
      {dialeg}
    </div>
  )
}
