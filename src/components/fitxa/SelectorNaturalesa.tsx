// La NATURALESA de la organización (Plan 2 A5, 10-11-2026; fila 2.7): «Entitat social» o
// «Empresa», sugerida por el NIF y confirmable. Un solo componente para los tres sitios donde se
// decide: «Dades de l'entitat» (ficha del equipo), «La meva organització» (titular) y, sin
// organización todavía, «Nova entitat» (modo controlado sin `orgId`: la pantalla la fija al crear).
//
// Con `orgId` guarda AL MOMENTO por `fixar_naturalesa()` (como el estado CRM de «Estat i papers»):
// elegir un valor —o pulsar «Confirma-la» sobre la sugerida— la deja CONFIRMADA. El titular solo
// mientras no lo esté; después lo ve en solo lectura (la base le daría `naturalesa_confirmada`).
//
// No es el rol ni el tipo de receptor: lo dice la ayuda. Confirmada, decide qué puede recibir
// (P8: una empresa, compra y maquila; nunca donación) y qué perfil de recepción se pide. Sugerida,
// solo se enseña: no cambia nada (`naturalesaEfectiva()`).

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { NATURALESES, esNaturalesa, type Naturalesa, type OrigenNaturalesa } from '../../lib/naturalesa'
import Desplegable from '../Desplegable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface ValorNaturalesa {
  naturalesa: Naturalesa | null
  origen: OrigenNaturalesa | null
}

export default function SelectorNaturalesa({
  orgId, valor, onCanviat, potEditar, esEquip, idPrefix, ajudaKey = 'nat.h',
}: {
  /** La organización; sin ella (alta), no se guarda: solo se avisa con `onCanviat`. */
  orgId: string | null
  valor: ValorNaturalesa
  onCanviat: (v: ValorNaturalesa) => void
  /** Quien mira puede tocarla (equipo; titular). */
  potEditar: boolean
  /** El equipo puede cambiar una ya confirmada; el titular, no. */
  esEquip: boolean
  idPrefix: string
  ajudaKey?: string
}) {
  const { t } = useT()
  const [ocupat, setOcupat] = useState(false)
  const id = `${idPrefix}-naturalesa`
  const bloquejada = !esEquip && valor.origen === 'confirmada'
  const editable = potEditar && !bloquejada && !ocupat

  async function fixa(n: Naturalesa) {
    if (!orgId) { onCanviat({ naturalesa: n, origen: 'confirmada' }); return }
    setOcupat(true)
    const { error } = await supabase.rpc('fixar_naturalesa', { p_org: orgId, p_naturalesa: n })
    setOcupat(false)
    if (error) { toast.error(textError(t, error.message)); return }
    toast.success(t('nat.ok'))
    onCanviat({ naturalesa: n, origen: 'confirmada' })
  }

  return (
    <div className="space-y-1.5" data-testid="naturalesa">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-xs text-muted-foreground">{t('nat.label')}</label>
        {valor.naturalesa && (
          <Badge variant={valor.origen === 'confirmada' ? 'secondary' : 'outline'} data-testid="naturalesa-origen">
            {t(valor.origen === 'confirmada' ? 'nat.confirmada' : 'nat.suggerida')}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Desplegable
          id={id}
          className="w-full sm:w-64"
          value={valor.naturalesa ?? ''}
          placeholder={t('nat.sense')}
          disabled={!editable}
          opcions={NATURALESES.map((n) => ({ valor: n, text: t(`nat.${n}`) }))}
          onChange={(v) => { if (esNaturalesa(v) && (v !== valor.naturalesa || valor.origen !== 'confirmada')) void fixa(v) }}
        />
        {editable && valor.naturalesa && valor.origen === 'suggerida' && (
          <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8"
            onClick={() => void fixa(valor.naturalesa!)} data-testid="naturalesa-confirma">
            {t('nat.confirma')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t(bloquejada && potEditar ? 'nat.bloquejada' : ajudaKey)}</p>
    </div>
  )
}
