// Configuració › Equip (09-11-2026, solo super_admin): las cuentas con rol de plataforma
// —`super_admin`, `admin`, `tecnic`—, aparte de los usuarios de las organizaciones, y el cambio
// de rol. Antes subir a alguien a super_admin era SQL a mano con la service key.
//
// Lo que impone la base (`canviar_rol_equip()`, 20270513100000) y esta pantalla solo anticipa
// para no ofrecer un botón que acabaría en error: no te cambias el rol a ti mismo, el equipo
// nunca se queda sin un super_admin, y aquí no se dan de alta cuentas (nota al pie).
// Cada cambio queda en `equip_rols_hist`, que se enseña debajo.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { dataCurta } from '../../lib/format'
import { faTemps } from '../../lib/notesInternes'
import {
  accionsMembre, clauErrorEquip, esBaixada, ordenaEquip, recompteRols, ROLS_EQUIP,
  type CanviRol, type MembreEquip, type RolAAssignar, type RolEquip,
} from '../../lib/equip'
import { useConfirma } from '../DialegConfirma'
import Desplegable from '../Desplegable'
import CarregantSeccio from '../CarregantSeccio'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Traductor = (clau: string, params?: Record<string, string | number>) => string

const COLOR_ROL: Record<RolEquip, string> = {
  super_admin: 'bg-coral-suave text-coral-texto',
  admin: 'bg-muted text-foreground',
  tecnic: 'bg-muted text-muted-foreground',
}

function FilaMembre({ m, membres, ocupat, onCanvia, t }: {
  m: MembreEquip
  membres: readonly MembreEquip[]
  ocupat: boolean
  onCanvia: (m: MembreEquip, rol: RolAAssignar) => void
  t: Traductor
}) {
  const acc = accionsMembre(m, membres)
  const qui = m.nom || m.email || ''
  const acces = m.ultim_acces
    ? t('eq.ultim_acces', { quan: t(faTemps(m.ultim_acces).clau, { n: faTemps(m.ultim_acces).n }) })
    : t('eq.cap_acces')
  const rolDes = [
    m.des_de ? t('eq.des_de', { data: dataCurta(m.des_de) }) : null,
    m.otorgat_per ? t('eq.per', { qui: m.otorgat_per }) : null,
  ].filter(Boolean).join(' ')

  return (
    <li
      className="flex flex-wrap items-start justify-between gap-3 py-3"
      data-testid="eq-fila"
      data-email={m.email ?? ''}
      data-rol={m.rol}
    >
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{qui}</span>
          <Badge className={COLOR_ROL[m.rol]} data-testid="eq-rol">{t(`eq.rol_${m.rol}`)}</Badge>
          {m.es_tu && <Badge variant="outline">{t('eq.tu')}</Badge>}
          {!m.actiu && <Badge className="bg-error-fondo text-error">{t('eq.inactiu')}</Badge>}
        </div>
        {m.nom && m.email && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{m.email}</p>}
        <p className="text-xs text-muted-foreground">{[acces, rolDes].filter(Boolean).join(' · ')}</p>
      </div>

      <div className="w-full sm:w-56">
        {acc.canvia ? (
          <Desplegable
            value={m.rol}
            onChange={(v) => onCanvia(m, v as RolAAssignar)}
            opcions={acc.opcions.map((o) => ({ valor: o.valor, text: t(o.clau) }))}
            disabled={ocupat}
            aria-label={t('eq.rol_aria', { qui })}
            data-testid="eq-rol-tria"
          />
        ) : (
          <p className="text-xs text-muted-foreground sm:text-right">{acc.motiu ? t(acc.motiu) : ''}</p>
        )}
      </div>
    </li>
  )
}

export default function SeccioEquip() {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [membres, setMembres] = useState<MembreEquip[] | null>(null)
  const [hist, setHist] = useState<CanviRol[]>([])
  const [error, setError] = useState(false)
  const [ocupat, setOcupat] = useState(false)

  const carrega = useCallback(async () => {
    const [m, h] = await Promise.all([
      supabase.rpc('equip_membres'),
      supabase.from('equip_rols_hist').select('id, email, rol_abans, rol_despres, per_email, at')
        .order('at', { ascending: false }).limit(15),
    ])
    if (m.error) { setError(true); setMembres([]); return }
    setError(false)
    setMembres(m.data as MembreEquip[])
    setHist((h.data ?? []) as CanviRol[])
  }, [])

  useEffect(() => { void carrega() }, [carrega])

  const equip = useMemo(() => ordenaEquip(membres ?? []), [membres])
  const recompte = useMemo(() => recompteRols(membres ?? []), [membres])

  async function canvia(m: MembreEquip, rol: RolAAssignar) {
    if (rol === m.rol || ocupat) return
    const email = m.email ?? m.nom ?? ''
    const baixa = esBaixada(m.rol, rol)
    const rolText = rol === 'cap' ? '' : t(`eq.rol_${rol}`)
    const d = rol === 'cap' ? 'eq.c_d_treu' : rol === 'super_admin' ? 'eq.c_d_super' : baixa ? 'eq.c_d_baixa' : 'eq.c_d_puja'
    const ok = await confirma({
      titol: t(rol === 'cap' ? 'eq.c_t_treu' : baixa ? 'eq.c_t_baixa' : 'eq.c_t_puja', { email, rol: rolText }),
      descripcio: t(d),
      confirmar: t(rol === 'cap' ? 'eq.c_go_treu' : 'eq.c_go'),
      destructiu: baixa,
    })
    if (!ok) return
    setOcupat(true)
    const { error: err } = await supabase.rpc('canviar_rol_equip', { p_user: m.user_id, p_rol: rol })
    setOcupat(false)
    // Se recarga también en error: lo que se enseña es el estado real de la base.
    await carrega()
    if (err) { toast.error(t(clauErrorEquip(err.message))); return }
    toast.success(rol === 'cap' ? t('eq.ok_treu', { email }) : t('eq.ok', { email, rol: rolText }))
  }

  const nomRol = (r: RolEquip | null) => (r ? t(`eq.rol_${r}`) : t('eq.cap'))

  return (
    <div className="space-y-4" data-testid="seccio-equip">
      <Card>
        <CardHeader>
          <CardTitle>{t('eq.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('eq.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{t('eq.rols_t')}</p>
            <dl className="space-y-1">
              {ROLS_EQUIP.map((r) => (
                <div key={r} className="flex flex-wrap gap-x-2">
                  <dt className="font-medium">{t(`eq.rol_${r}`)}:</dt>
                  <dd className="min-w-0 flex-1 basis-60 text-muted-foreground">{t(`eq.d_${r}`)}</dd>
                </div>
              ))}
            </dl>
          </div>

          {membres === null && <CarregantSeccio />}
          {error && <p className="text-sm text-error" role="alert">{t('eq.carrega_err')}</p>}
          {membres !== null && !error && equip.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('eq.buit')}</p>
          )}
          {equip.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground" data-testid="eq-resum">
                {t('eq.resum', { sa: recompte.super_admin, a: recompte.admin, t: recompte.tecnic })}
              </p>
              <ul className="divide-y divide-border" data-testid="eq-llista">
                {equip.map((m) => (
                  <FilaMembre key={m.user_id} m={m} membres={equip} ocupat={ocupat} onCanvia={(x, r) => void canvia(x, r)} t={t} />
                ))}
              </ul>
            </>
          )}
          <p className="text-xs text-muted-foreground">{t('eq.nota_alta')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('eq.hist_t')}</CardTitle>
        </CardHeader>
        <CardContent>
          {hist.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('eq.hist_buit')}</p>
          ) : (
            <ul className="space-y-2 text-sm" data-testid="eq-hist">
              {hist.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 flex-1 basis-60 [overflow-wrap:anywhere]">
                    {t('eq.hist_linia', {
                      per: c.per_email ?? t('eq.hist_algu'),
                      email: c.email ?? '',
                      abans: nomRol(c.rol_abans),
                      despres: nomRol(c.rol_despres),
                    })}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(faTemps(c.at).clau, { n: faTemps(c.at).n })}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {dialeg}
    </div>
  )
}
