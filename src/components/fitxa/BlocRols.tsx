// El bloque «Estat i papers» de la ficha del EQUIPO (1C; en «Gestió interna» desde el
// 04-11-2026): primero el estado GLOBAL de la entidad —activar o desactivar todos sus papeles a
// la vez (`activar_organitzacio` / `desactivar_organitzacio`, D7)—, y debajo cada papel por
// separado: su ESTADO CRM (Plan 2, B1, 10-11-2026) —Potencial · En desenvolupament · Actiu ·
// Inactiu, `fixar_estat_crm()`— y añadir el otro papel (`afegir_paper_org_equip`).
//
// D8: el estado CRM MANDA y `activo` lo deriva la base (`activo = estat_crm = 'actiu'`); solo
// Actiu opera (Mercat, priorización, selectores). Pasar a Actiu exige NIF válido y razón social:
// lo corta el trigger y aquí solo se traduce (`textError`: `falta_nif`, `nif_invalid`,
// `falta_rao_social`). Todo cambio queda en `fitxa_estat_hist` (quién, cuándo, estado).
//
// Solo `pot_aprovar()` (admin y super_admin) puede cambiar el estado: a los demás el selector y
// los botones les salen grises con el motivo. El actor tiene su propio bloque (`RolRedestina`),
// que pide el otro papel con membresía pendiente.

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { useConfirma } from '../DialegConfirma'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import Desplegable from '../Desplegable'
import { ESTATS_CRM, classeEstatCrm, estatCrm, estatOrganitzacio, type EstatCrm } from '../../lib/estatCrm'
import { Badge } from '@/components/ui/badge'
import type { OrganizacioVista } from '../../types'

type Paper = 'productor' | 'entidad'

export default function BlocRols({ org, potAprovar, onCanviat }: {
  org: OrganizacioVista
  potAprovar: boolean
  /** Algo ha cambiado en la base (estado o papel nuevo): quien monta esto recarga. */
  onCanviat: () => void
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [ocupat, setOcupat] = useState(false)
  const motiu = potAprovar ? undefined : t('appr.need_approver')

  async function crida(rpc: string, args: Record<string, unknown>, okKey: string) {
    setOcupat(true)
    const { error } = await supabase.rpc(rpc, args)
    setOcupat(false)
    if (error) { toast.error(textError(t, error.message)); return }
    toast.success(t(okKey))
    onCanviat()
  }

  async function canviaEstat(paper: Paper, id: string, estat: EstatCrm) {
    const rolKey = paper === 'productor' ? 'ef.paper_ofertant' : 'ef.paper_receptor'
    // Dejar de ser Actiu saca al papel del Mercat y de la priorización: se pregunta antes.
    const actual = estatCrm(paper === 'productor' ? org.productor_estat_crm : org.entidad_estat_crm)
    if (actual === 'actiu' && estat !== 'actiu' && !(await confirma({
      titol: t('ef.confirm_desactiva_t', { rol: t(rolKey).toLowerCase() }),
      descripcio: t('ef.confirm_estat_d', { estat: t(`ef.estat_${estat}`) }),
      confirmar: t('ef.confirm_estat_ok'),
      destructiu: true,
    }))) return
    await crida('fixar_estat_crm', { p_tipus: paper, p_id: id, p_estat: estat }, 'ef.estat_canviat')
  }

  async function afegeix(paper: Paper) {
    const rolKey = paper === 'productor' ? 'ef.paper_ofertant' : 'ef.paper_receptor'
    if (!(await confirma({
      titol: t('ef.confirm_afegeix_t', { rol: t(rolKey).toLowerCase() }),
      descripcio: t('ef.confirm_afegeix_d'),
      confirmar: t(paper === 'productor' ? 'ef.afegeix_ofertant' : 'ef.afegeix_receptor'),
    }))) return
    await crida('afegir_paper_org_equip', { p_org: org.id, p_paper: paper }, 'ef.paper_afegit')
  }

  async function desactivaTot() {
    if (!(await confirma({
      titol: t('ef.confirm_desactiva_org_t', { name: org.nom_comercial ?? org.nombre ?? '' }),
      descripcio: t('ef.confirm_desactiva_org_d'),
      confirmar: t('ef.desactiva_org'),
      destructiu: true,
    }))) return
    await crida('desactivar_organitzacio', { p_org: org.id }, 'ef.estat_canviat')
  }

  // Sin confirmación: activar no quita nada, y si a una ficha le falta el NIF o la razón social
  // el trigger corta todo y lo dice.
  const activaTot = () => crida('activar_organitzacio', { p_org: org.id }, 'ef.estat_canviat')

  const opcionsEstat = ESTATS_CRM.map((e) => ({ valor: e, text: t(`ef.estat_${e}`) }))

  function fila(paper: Paper, id: string | null, valor: string | null) {
    const rolKey = paper === 'productor' ? 'ef.paper_ofertant' : 'ef.paper_receptor'
    const estat = estatCrm(valor)
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid={`rols-${paper}`}>
        <span className="min-w-28 font-medium">{t(rolKey)}</span>
        {id !== null && estat ? (
          <>
            <Badge className={classeEstatCrm(estat)} data-testid={`rols-${paper}-badge`}>{t(`ef.estat_${estat}`)}</Badge>
            <span className="flex-1" />
            <Desplegable mida="sm" className="w-52" value={estat} opcions={opcionsEstat}
              disabled={ocupat || !potAprovar} aria-label={t('ef.estat_crm_de', { rol: t(rolKey).toLowerCase() })}
              data-testid={`rols-${paper}-estat`}
              onChange={(v) => { const e = estatCrm(v); if (e && e !== estat) void canviaEstat(paper, id, e) }} />
          </>
        ) : (
          <>
            <Badge variant="outline" className="text-muted-foreground">—</Badge>
            <span className="flex-1" />
            <BotoAmbMotiu variant="outline" size="sm" disabled={ocupat || !potAprovar} motiu={motiu}
              onClick={() => void afegeix(paper)}>
              {t(paper === 'productor' ? 'ef.afegeix_ofertant' : 'ef.afegeix_receptor')}
            </BotoAmbMotiu>
          </>
        )}
      </div>
    )
  }

  // Los papeles que tiene y cómo están: la entidad está activa si lo está alguno (D7), y «en
  // part» si con doble rol uno está activo y el otro no. El badge de la organización es su
  // estado CRM (el más avanzado de sus papeles) salvo ese caso.
  const estats = [
    org.productor_id ? Boolean(org.productor_activo) : null,
    org.entidad_id ? Boolean(org.entidad_activo) : null,
  ].filter((x): x is boolean => x !== null)
  const algunActiu = estats.some(Boolean)
  const algunInactiu = estats.some((x) => !x)
  const estatOrg = estatOrganitzacio(org.productor_estat_crm, org.entidad_estat_crm)

  return (
    <div className="space-y-5">
      <div className="space-y-2" data-testid="estat-entitat">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-28 font-medium">{t('ef.estat_entitat')}</span>
          <Badge className={classeEstatCrm(estatOrg)} data-testid="estat-entitat-badge">
            {algunActiu && algunInactiu ? t('ef.estat_parcial') : t(`ef.estat_${estatOrg}`)}
          </Badge>
          <span className="flex-1" />
          {algunInactiu && (
            <BotoAmbMotiu variant="outline" size="sm" disabled={ocupat || !potAprovar} motiu={motiu}
              onClick={() => void activaTot()}>
              {t('ef.activa_org')}
            </BotoAmbMotiu>
          )}
          {algunActiu && (
            <BotoAmbMotiu variant="outline" size="sm" className="text-destructive" disabled={ocupat || !potAprovar} motiu={motiu}
              onClick={() => void desactivaTot()}>
              {t('ef.desactiva_org')}
            </BotoAmbMotiu>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{t('ef.h_estat_entitat')}</p>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <p className="text-sm font-medium">{t('ef.per_paper')}</p>
        <p className="text-sm text-muted-foreground">{t('ef.h_rols')}</p>
        {fila('productor', org.productor_id, org.productor_estat_crm)}
        {fila('entidad', org.entidad_id, org.entidad_estat_crm)}
      </div>
      {dialeg}
    </div>
  )
}
