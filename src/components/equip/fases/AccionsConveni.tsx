// Los botones que resuelven el convenio de UNA organización desde el ciclo guiado: prepararlo,
// firmarlo con la persona delante, darlo por vigente (super_admin) y contrafirmarlo. Los usan
// la fase 1 (el de quien entrega) y la fase 4 (el de cada receptora), que antes los tenían
// copiados uno a uno.
//
// 🔴 Cada botón llama a la RPC real del circuito (`preparar_convenio`, `contrafirmar_convenio`,
//    la firma por enlace asistido, `declarar_conveni`): sale el mismo PDF y la misma
//    numeración que si lo hiciera la organización.

import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useT } from '../../../lib/i18n'
import { textError } from '../../../lib/textError'
import { contrafirmarConveni, prepararConveni } from '../../../lib/convenis'
import { refrescaComptadors } from '../../../lib/pendentsEquip'
import type { ConvenioTipo } from '../../../types'
import { useConfirma } from '../../DialegConfirma'
import BotoAmbMotiu from '../../proces/BotoAmbMotiu'
import DialegFirmaAssistida from '../DialegFirmaAssistida'
import DialegConveniDeclarat from '../DialegConveniDeclarat'
import { Button } from '@/components/ui/button'
import type { ConveniFase } from './tipus'

/** Un convenio se puede declarar mientras nadie ha firmado: sin él, en borrador o enviado. */
export function declarable(estat: string | null | undefined): boolean {
  return !estat || estat === 'esborrany' || estat === 'pendent_firma'
}

export default function AccionsConveni({
  tipusOrg, orgId, nom, conveni, tipusCal, potAprovar, esSuperAdmin, onCanvi, petit = false,
}: {
  tipusOrg: 'productor' | 'entidad'
  orgId: string
  nom: string | null
  conveni: ConveniFase | null
  /** El tipo que hay que preparar si no hay ninguno (`col_productor`/`col_receptor`). */
  tipusCal: ConvenioTipo | null
  potAprovar: boolean
  esSuperAdmin: boolean
  onCanvi: () => void
  /** Botones pequeños, para dentro de una fila. */
  petit?: boolean
}) {
  const { t } = useT()
  const [ocupat, setOcupat] = useState(false)
  const [firma, setFirma] = useState(false)
  const [declarat, setDeclarat] = useState(false)
  const { confirma, dialeg } = useConfirma()
  const mida = petit ? 'sm' as const : 'default' as const
  const classe = petit ? 'h-11 whitespace-normal md:h-8' : 'h-11 whitespace-normal md:h-9'

  async function prepara() {
    if (!tipusCal) return
    setOcupat(true)
    const r = await prepararConveni(tipusOrg, orgId, tipusCal)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('canalz.ok_preparat'))
    void refrescaComptadors()
    onCanvi()
  }

  async function contrasigna(id: string) {
    // Contrasignar estampa la firma de la Fundación y manda el PDF: no se deshace.
    if (!(await confirma({
      titol: t('conv.countersign_confirm_t'),
      descripcio: t('conv.countersign_confirm'),
      confirmar: t('canalz.b_contrasignar'),
    }))) return
    setOcupat(true)
    const r = await contrafirmarConveni(id)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('canalz.ok_contrasignat'))
    void refrescaComptadors()
    onCanvi()
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!conveni && tipusCal && (
        <Button size={mida} className={classe} disabled={ocupat} onClick={() => void prepara()}>
          {t('canalz.b_preparar')}
        </Button>
      )}
      {conveni && !['firmat', 'vigent'].includes(conveni.estado) && (
        <Button size={mida} className={classe} onClick={() => setFirma(true)}>
          {t('canalz.b_firma_assistida')}
        </Button>
      )}
      {/* Sin la persona delante: el super_admin lo da por vigente con los datos de la ficha.
          Mismo PDF y numeración; la página de evidencias dice que es declarado. */}
      {declarable(conveni?.estado) && (
        <BotoAmbMotiu
          size={mida}
          variant="outline"
          className={classe}
          disabled={!esSuperAdmin}
          motiu={t('cdecl.need_super')}
          onClick={() => setDeclarat(true)}
        >
          {t('cdecl.open')}
        </BotoAmbMotiu>
      )}
      {conveni?.estado === 'firmat' && (
        <BotoAmbMotiu
          size={mida}
          className={classe}
          disabled={ocupat || !potAprovar}
          motiu={potAprovar ? undefined : t('conv.need_approver')}
          onClick={() => void contrasigna(conveni.id)}
        >
          {t('canalz.b_contrasignar')}
        </BotoAmbMotiu>
      )}
      {conveni && (
        <Button asChild size={mida} variant="outline" className={classe}>
          <Link to={`/equip/convenis/${conveni.id}`}>{t('canalz.b_veure_conveni')}</Link>
        </Button>
      )}

      {firma && conveni && (
        <DialegFirmaAssistida
          obert
          conveniId={conveni.id}
          onTancar={() => setFirma(false)}
          onFirmat={() => { setFirma(false); onCanvi() }}
        />
      )}
      {declarat && (
        <DialegConveniDeclarat
          obert
          tipusOrg={tipusOrg}
          orgId={orgId}
          nom={nom}
          onTancar={() => setDeclarat(false)}
          onFet={() => { void refrescaComptadors(); onCanvi() }}
        />
      )}
      {dialeg}
    </div>
  )
}
