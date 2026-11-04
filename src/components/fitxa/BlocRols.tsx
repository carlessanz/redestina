// El bloque «Estat i papers» de la ficha del EQUIPO (1C; en «Gestió interna» desde el
// 04-11-2026): primero el estado GLOBAL de la entidad —activar o desactivar todos sus papeles a
// la vez (`activar_organitzacio` / `desactivar_organitzacio`, D7)—, y debajo cada papel por
// separado —activar o desactivar uno (`activar_fitxa` / `desactivar_fitxa`) y añadir el otro
// (`afegir_paper_org_equip`)—.
//
// `activo` NO es un campo del formulario a propósito (deuda §12.147): se cambia aquí, por
// RPC, con quién y cuándo en `fitxa_estat_hist`; el alta no lo manda y la columna toma su
// `default true`. Las reglas (NIF válido, razón social) las pone el trigger y aquí solo se
// traducen (`textError`: `falta_nif`, `nif_invalid`, `falta_rao_social`).
//
// Solo `pot_aprovar()` (admin y super_admin) puede cambiar el estado: a los demás los botones
// les salen grises con el motivo. El actor tiene su propio bloque (`RolRedestina`), que pide
// el otro papel con membresía pendiente.

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { useConfirma } from '../DialegConfirma'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
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

  async function canviaEstat(paper: Paper, id: string, activar: boolean) {
    const rolKey = paper === 'productor' ? 'ef.paper_ofertant' : 'ef.paper_receptor'
    if (!activar && !(await confirma({
      titol: t('ef.confirm_desactiva_t', { rol: t(rolKey).toLowerCase() }),
      descripcio: t('ef.confirm_desactiva_d'),
      confirmar: t('ef.btn_desactiva'),
      destructiu: true,
    }))) return
    await crida(activar ? 'activar_fitxa' : 'desactivar_fitxa', { p_tipus: paper, p_id: id }, 'ef.estat_canviat')
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

  function fila(paper: Paper, id: string | null, actiu: boolean | null) {
    const te = id !== null
    const rolKey = paper === 'productor' ? 'ef.paper_ofertant' : 'ef.paper_receptor'
    return (
      <div className="flex flex-wrap items-center gap-2" data-testid={`rols-${paper}`}>
        <span className="min-w-28 font-medium">{t(rolKey)}</span>
        {te ? (
          <Badge className={actiu ? 'bg-exito-fondo text-exito' : 'bg-muted text-muted-foreground'}>
            {t(actiu ? 'ef.estat_activa' : 'ef.estat_inactiva')}
          </Badge>
        ) : <Badge variant="outline" className="text-muted-foreground">—</Badge>}
        <span className="flex-1" />
        {te ? (
          <BotoAmbMotiu variant="outline" size="sm" disabled={ocupat || !potAprovar} motiu={motiu}
            onClick={() => void canviaEstat(paper, id, !actiu)}>
            {t(actiu ? 'ef.btn_desactiva' : 'ef.btn_activa')}
          </BotoAmbMotiu>
        ) : (
          <BotoAmbMotiu variant="outline" size="sm" disabled={ocupat || !potAprovar} motiu={motiu}
            onClick={() => void afegeix(paper)}>
            {t(paper === 'productor' ? 'ef.afegeix_ofertant' : 'ef.afegeix_receptor')}
          </BotoAmbMotiu>
        )}
      </div>
    )
  }

  // Los papeles que tiene y cómo están: la entidad está activa si lo está alguno (D7), y «en
  // part» si con doble rol uno está activo y el otro no.
  const estats = [
    org.productor_id ? Boolean(org.productor_activo) : null,
    org.entidad_id ? Boolean(org.entidad_activo) : null,
  ].filter((x): x is boolean => x !== null)
  const algunActiu = estats.some(Boolean)
  const algunInactiu = estats.some((x) => !x)

  return (
    <div className="space-y-5">
      <div className="space-y-2" data-testid="estat-entitat">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-28 font-medium">{t('ef.estat_entitat')}</span>
          <Badge className={algunActiu ? 'bg-exito-fondo text-exito' : 'bg-muted text-muted-foreground'} data-testid="estat-entitat-badge">
            {t(!algunActiu ? 'ef.estat_inactiva' : algunInactiu ? 'ef.estat_parcial' : 'ef.estat_activa')}
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
        {fila('productor', org.productor_id, org.productor_activo)}
        {fila('entidad', org.entidad_id, org.entidad_activo)}
      </div>
      {dialeg}
    </div>
  )
}
