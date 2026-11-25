// «Fet» con su RESULTADO (proceso 1.2, 25-11-2026): dar por hecho el próximo paso de una
// interacción pide, en un diálogo corto, qué salió de él. Lo usan la ficha (`NotesInternes`) y la
// vista «Pendents» de `/equip/interaccions`, para que las dos cierren igual.
//
// El resultado es opcional (la base lo admite nulo: «Fet» sin más sigue valiendo) y va con un
// tope de 1.000 caracteres (`resultat_massa_llarg`). `tancar_seguiment()` es idempotente: cerrar
// uno ya cerrado no cambia nada salvo completar un resultado que faltaba.

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { MAX_RESULTAT, resultatValid } from '../../lib/notesInternes'
import DialegMotiu from '../DialegMotiu'

export interface SeguimentPerTancar {
  id: string
  /** El próximo paso, que se recuerda en el diálogo. */
  propera_accio: string | null
}

export default function DialegSeguimentFet({ seguiment, onTanca, onFet }: {
  /** El seguimiento que se cierra; `null` = diálogo cerrado. */
  seguiment: SeguimentPerTancar | null
  onTanca: () => void
  /** Tras cerrarlo en la base. */
  onFet: () => void
}) {
  const { t } = useT()
  const [ocupat, setOcupat] = useState(false)

  async function confirma(resultat: string) {
    if (!seguiment) return
    if (!resultatValid(resultat)) { toast.error(t('ni.err_resultat_llarg', { n: MAX_RESULTAT })); return }
    setOcupat(true)
    try {
      const { error } = await supabase.rpc('tancar_seguiment', {
        p_id: seguiment.id,
        ...(resultat ? { p_resultat: resultat } : {}),
      })
      if (error) { toast.error(textError(t, error.message)); return }
    } catch (e) {
      toast.error(textError(t, e instanceof Error ? e.message : String(e)))
      return
    } finally {
      setOcupat(false)
    }
    toast.success(t('ni.ok_fet'))
    onTanca()
    onFet()
  }

  return (
    <DialegMotiu
      obert={seguiment !== null}
      onObert={(v) => { if (!v) onTanca() }}
      titol={t('ni.fet_titol')}
      descripcio={seguiment?.propera_accio ?? undefined}
      etiqueta={t('ni.resultat')}
      confirmar={t('ni.marca_fet')}
      opcional
      ocupat={ocupat}
      onConfirma={(r) => void confirma(r)}
    />
  )
}
