// «Nova organització amb compte»: el alta asistida (27-10-2026). El equipo da de alta una
// organización CON SU CUENTA y contraseña inicial, ya aprobada, y con los consentimientos
// RGPD que declara en nombre de la persona. Es el mismo formulario de `/registre`
// (`FormulariAlta`, modo `assistit`) contra la función `alta-assistida`.
//
// Después, si se pidió, manda el acceso (`enviar-acceso`): es TRANSACCIONAL (§8), así que
// sale aunque las notificaciones estén apagadas — salvo el gate de pruebas, que se dice.

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { enviarAcces } from '../../lib/acces'
import FormulariAlta, { type AltaFeta, type RolRegistre } from '../FormulariAlta'
import DialegConveniDeclarat from './DialegConveniDeclarat'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  onTancar: () => void
  /** El papel que se preselecciona según desde dónde se abre. */
  rolInicial?: RolRegistre
  /** Para recargar el listado de quien lo abrió. */
  onCreada?: () => void
}

/** La ficha recién creada a la que se le puede declarar el convenio. */
interface FitxaNova { tipusOrg: 'productor' | 'entidad'; orgId: string; nom: string | null }

/**
 * Las fichas que el alta acaba de crear, a partir de sus convenios en borrador (uno por
 * papel). Si `preparar_convenio` no pudo prepararlos, se buscan por el correo, que en el alta
 * es el mismo para las dos fichas.
 */
async function fitxesNoves(r: AltaFeta): Promise<FitxaNova[]> {
  if (r.convenis.length > 0) {
    const { data } = await supabase.from('convenios')
      .select('tipo_org, productor_id, entidad_id, datos_org')
      .in('id', r.convenis.map((c) => c.id))
    return ((data ?? []) as { tipo_org: string; productor_id: string | null; entidad_id: string | null; datos_org: Record<string, unknown> | null }[])
      .filter((c) => c.productor_id || c.entidad_id)
      .map((c) => ({
        tipusOrg: c.productor_id ? 'productor' : 'entidad',
        orgId: (c.productor_id ?? c.entidad_id)!,
        nom: typeof c.datos_org?.raso_social === 'string' ? c.datos_org.raso_social : null,
      }))
  }
  const [p, e] = await Promise.all([
    supabase.from('productores').select('id, empresa, name').eq('email', r.email).limit(1),
    supabase.from('entidades').select('id, nombre').eq('email', r.email).limit(1),
  ])
  const fitxes: FitxaNova[] = []
  const prod = p.data?.[0] as { id: string; empresa: string | null; name: string | null } | undefined
  const ent = e.data?.[0] as { id: string; nombre: string | null } | undefined
  if (prod) fitxes.push({ tipusOrg: 'productor', orgId: prod.id, nom: prod.empresa || prod.name })
  if (ent) fitxes.push({ tipusOrg: 'entidad', orgId: ent.id, nom: ent.nombre })
  return fitxes
}

export default function DialegAltaAssistida({ obert, onTancar, rolInicial = 'productor', onCreada }: Props) {
  const { t } = useT()
  // «Dona per vigent el conveni» desde el aviso de después del alta (gestión autónoma, fase 1).
  // Vive aquí y no en el formulario: el diálogo del alta ya se ha cerrado cuando se pulsa.
  const [declarant, setDeclarant] = useState<FitxaNova | null>(null)

  /** Un aviso por ficha nueva, con la acción de declarar su convenio. */
  async function ofereixDeclarar(r: AltaFeta) {
    // Un alta que coincide con una organización ya existente la revisa el equipo antes: no se
    // ofrece declarar nada encima de una identidad que todavía no está clara.
    if (r.revisio) return
    for (const f of await fitxesNoves(r)) {
      toast(t('cdecl.toast_alta', { nom: f.nom ?? r.email }), {
        duration: 15000,
        action: { label: t('cdecl.toast_accio'), onClick: () => setDeclarant(f) },
      })
    }
  }

  async function fet(r: AltaFeta) {
    onTancar()
    onCreada?.()
    void ofereixDeclarar(r)
    if (r.revisio) toast.info(t('alta.ok_revisio'))
    if (!r.enviaAcces) { toast.success(t('alta.ok')); return }
    const enviat = await enviarAcces(r.email)
    if (enviat.ok) toast.success(t('alta.ok_mail', { email: r.email }))
    // Creada, pero hay que avisar a mano: un solo aviso ámbar (como en Aprovacions).
    else toast.warning(t(enviat.codi === 'no_test_user' ? 'appr.mail_test' : 'appr.mail_ko'))
  }

  return (
    <>
    <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
      {/* Sin cerrar al pinchar fuera: diez campos y una contraseña, como los otros asistidos. */}
      <DialogContent
        className="flex max-h-[88dvh] w-[92vw] max-w-2xl flex-col gap-4 p-6 sm:max-w-2xl"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('alta.title')}</DialogTitle>
          <DialogDescription>{t('alta.hint')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {/* `key`: al reabrirlo, formulario limpio (no la contraseña de la anterior). */}
          {obert && (
            <FormulariAlta key={rolInicial} mode="assistit" idPrefix="alta" rolsInicials={[rolInicial]}
              onFet={(r) => void fet(r)} />
          )}
        </div>
      </DialogContent>
    </Dialog>
    {declarant && (
      <DialegConveniDeclarat
        obert
        tipusOrg={declarant.tipusOrg}
        orgId={declarant.orgId}
        nom={declarant.nom}
        onTancar={() => setDeclarant(null)}
        onFet={() => onCreada?.()}
      />
    )}
    </>
  )
}
