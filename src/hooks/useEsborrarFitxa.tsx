// Borrar una organización desde la ficha del equipo: el único camino es
// `borrar_ficha_completa()` (§4/§7, deuda 108), una RPC transaccional que se niega con el
// motivo si hay documentos, albaranes o cierres, y que arrastra las dos fichas del doble rol
// a la vez si se pide —nada de dos `.delete()` sueltos que dejen media organización borrada—.
//
// Vivía dentro de `RecordDetail` (retirado en 1C); es un hook para que la ficha única lo
// monte sin cargar con la lógica. Con doble rol pregunta si se borra un papel o los dos, y
// avisa de cuántas cuentas de usuario se quedan sin panel (`membresias`, en cascada).

import { useState } from 'react'
import { toast } from 'sonner'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { useConfirma, useTria } from '../components/DialegConfirma'

export interface FitxesOrganitzacio {
  productorId: string | null
  entidadId: string | null
  nom: string
}

/**
 * `borrar_ficha_completa()` responde `22023 bloqueig_esborrat: <codis>` cuando la ficha —o su
 * hermana— tiene documentación que no se borra jamás. Los códigos van en el MESSAGE separados
 * por comas, con el sufijo `@germana` cuando el bloqueo lo aporta la otra ficha.
 */
export function missatgeEsborrat(t: (k: string, p?: Record<string, string | number>) => string, err: { code?: string; message: string }): string {
  const marca = 'bloqueig_esborrat:'
  const i = err.message.indexOf(marca)
  if (i === -1) {
    if (err.code === '42501') return t('rec.no_permission_delete')
    return textError(t, err.message)
  }
  const motius = err.message
    .slice(i + marca.length)
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [base, germana] = c.split('@')
      const text = t(`rec.block_${base}`)
      return germana ? text + t('rec.block_germana') : text
    })
  return `${t('rec.blocked')} ${motius.join('; ')}`
}

export function useEsborrarFitxa(onEsborrat: () => void): {
  esborra: (f: FitxesOrganitzacio) => Promise<void>
  ocupat: boolean
  error: string | null
  dialegs: ReactNode
} {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const { tria, dialeg: dialegTria } = useTria()
  const [ocupat, setOcupat] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function esborra(f: FitxesOrganitzacio) {
    const dues = Boolean(f.productorId && f.entidadId)
    // Cuántas cuentas cuelgan de estas fichas: borrarlas las deja sin panel, y eso se dice ANTES.
    const comptes = new Set<string>()
    for (const [col, id] of [['productor_id', f.productorId], ['entidad_id', f.entidadId]] as const) {
      if (!id) continue
      const { data } = await supabase.from('membresias').select('user_id').eq(col, id)
      for (const m of (data as { user_id: string }[] | null) ?? []) comptes.add(m.user_id)
    }
    const avisComptes = comptes.size > 0 ? `\n\n${t('rec.delete_accounts', { n: comptes.size })}` : ''

    // Con doble rol: solo un papel o los dos. Con uno, el «¿seguro?» de siempre.
    let tipus: 'productor' | 'entidad' = f.productorId ? 'productor' : 'entidad'
    let tambeGermana = false
    if (dues) {
      const opcio = await tria({
        titol: t('rec.confirm_delete_t', { name: f.nom }),
        descripcio: t('rec.dual_delete_q') + avisComptes,
        opcions: [
          { valor: 'productor', text: t('rec.dual_only_producer'), destructiu: true },
          { valor: 'entidad', text: t('rec.dual_only_entity'), destructiu: true },
          { valor: 'dues', text: t('rec.dual_both'), destructiu: true },
        ],
      })
      if (!opcio) return
      if (opcio === 'dues') tambeGermana = true
      else tipus = opcio as 'productor' | 'entidad'
    } else if (!(await confirma({
      titol: t('rec.confirm_delete_t', { name: f.nom }),
      descripcio: t('rec.confirm_delete') + avisComptes,
      confirmar: t('c.delete'),
      destructiu: true,
    }))) return

    setError(null)
    setOcupat(true)
    const { error: delError } = await supabase.rpc('borrar_ficha_completa', {
      p_tipo: tipus,
      p_ficha_id: tipus === 'productor' ? f.productorId : f.entidadId,
      p_tambe_germana: tambeGermana,
    })
    setOcupat(false)
    if (delError) { setError(missatgeEsborrat(t, delError)); return }
    toast.success(tambeGermana ? t('rec.dual_deleted') : t('rec.deleted'))
    onEsborrat()
  }

  return { esborra, ocupat, error, dialegs: <>{dialeg}{dialegTria}</> }
}
