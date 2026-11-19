// «Proposta de canvis de l'equip», del lado de la entidad (fase 5 de los puntos 4-6, Excel 5.2
// nivel 2). El equipo le ha propuesto otros kilos, otra modalidad u otra hora para su interés, con
// un motivo; aquí ve lo que pidió → lo propuesto y decide:
//
//   · «Accepta» — fuera de la venta, la asignación queda confirmada en el acto; en una venta,
//     vuelve al equipo para cerrar el precio (`respondre_proposta` → `pendent_preu`).
//   · «Rebutja» — con un motivo opcional: el interés vuelve al equipo tal como lo pidió.
//
// Lo pintan «Els meus interessos» (en la tarjeta y en el diálogo de `?resposta=<id>`). Cualquier
// miembro de la entidad puede responder (la base lo comprueba: `mis_entidades()`).

import { useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { respondreProposta } from '../lib/propostaCanvisApi'
import type { RespostaProposta } from '../lib/propostaCanvisApi'
import type { RespostaAmbProposta } from '../lib/propostaCanvis'
import CanvisProposta from './CanvisProposta'
import DialegMotiu from './DialegMotiu'
import { useConfirma } from './DialegConfirma'
import { Button } from '@/components/ui/button'

export default function PropostaEntitat({ resposta, onFet }: {
  resposta: RespostaAmbProposta & { id: string }
  onFet: (resultat: RespostaProposta['resultat']) => void
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [ocupat, setOcupat] = useState(false)
  const [rebutjant, setRebutjant] = useState(false)

  async function accepta() {
    // Aceptar compromete a recoger lo propuesto: se dice antes, y en una venta que falta el precio.
    if (!(await confirma({
      titol: t('prop.e_accepta_t'),
      descripcio: t(resposta.proposta_modalitat === 'venda' ? 'prop.e_accepta_desc_venda' : 'prop.e_accepta_desc'),
      confirmar: t('prop.e_accepta'),
    }))) return
    setOcupat(true)
    const r = await respondreProposta({ resposta: resposta.id, accepta: true })
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t(r.data.resultat === 'pendent_preu' ? 'prop.e_ok_acceptada_preu' : 'prop.e_ok_acceptada'))
    onFet(r.data.resultat)
  }

  async function rebutja(motiu: string) {
    setOcupat(true)
    const r = await respondreProposta({ resposta: resposta.id, accepta: false, motiu })
    setOcupat(false)
    setRebutjant(false)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t('prop.e_ok_rebutjada'))
    onFet(r.data.resultat)
  }

  return (
    <div className="space-y-2 rounded-lg border border-coral/40 bg-coral-suave p-3" data-testid="proposta-entitat">
      <p className="text-sm font-semibold text-coral-texto">{t('prop.e_titol')}</p>
      <CanvisProposta resposta={resposta} />
      <p className="text-xs text-muted-foreground">{t('prop.e_ajuda')}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className="h-11 w-full whitespace-normal sm:w-auto md:h-9" disabled={ocupat} onClick={() => void accepta()}>
          {t('prop.e_accepta')}
        </Button>
        <Button variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-9" disabled={ocupat}
          onClick={() => setRebutjant(true)}>
          {t('prop.e_rebutja')}
        </Button>
      </div>
      <DialegMotiu
        obert={rebutjant}
        onObert={setRebutjant}
        titol={t('prop.e_rebutja_t')}
        descripcio={t('prop.e_rebutja_desc')}
        etiqueta={t('prop.e_rebutja_motiu')}
        confirmar={t('prop.e_rebutja')}
        opcional
        ocupat={ocupat}
        onConfirma={(m) => void rebutja(m)}
      />
      {dialeg}
    </div>
  )
}
