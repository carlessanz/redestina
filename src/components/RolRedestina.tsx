// «Rol a REDESTINA» (revisión del 08-10-2026): ☐ Ofereixo excedents · ☐ Busco / rebo
// excedents. Una misma organización puede ser las dos cosas. El papel de esta ficha sale
// marcado y fijo; marcar el otro crea la ficha hermana con los datos comunes y una membresía
// PENDIENTE: el equipo la valida como un alta (`afegir_paper_organitzacio`). Desmarcar no se
// ofrece: retirar un papel con operaciones vivas es una conversación con el equipo.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { afegeixPaper } from '../lib/organitzacio'
import { useAppContext } from '../hooks/useAppContext'
import { useConfirma } from './DialegConfirma'
import { FilaCasella } from './Casella'

export default function RolRedestina({ tipus, fitxaId, potEditar }: { tipus: 'productor' | 'entidad'; fitxaId: string; potEditar: boolean }) {
  const { t } = useT()
  const { ctx } = useAppContext()
  const { confirma, dialeg } = useConfirma()
  const [pendents, setPendents] = useState<string[]>([])
  const [ocupat, setOcupat] = useState(false)

  useEffect(() => {
    let viu = true
    void supabase.from('membresias').select('tipo').eq('aprovacio', 'pendent').then(({ data }) => {
      if (viu) setPendents(((data ?? []) as { tipo: string }[]).map((m) => m.tipo))
    })
    return () => { viu = false }
  }, [])

  const te = (p: 'productor' | 'entidad') => p === tipus || (ctx?.organitzacions ?? []).some((o) => o.tipo === p)
  const altre = tipus === 'productor' ? 'entidad' : 'productor'

  const marca = async () => {
    if (!(await confirma({
      titol: t(altre === 'entidad' ? 'rol.confirm_rep_t' : 'rol.confirm_ofer_t'),
      descripcio: t('rol.confirm_d'),
      confirmar: t('rol.confirm_go'),
    }))) return
    setOcupat(true)
    const r = await afegeixPaper(tipus, fitxaId)
    setOcupat(false)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    toast.success(t('rol.ok'))
    setPendents((p) => [...p, altre])
  }

  const fila = (p: 'productor' | 'entidad', clau: string) => {
    const pendent = !te(p) && pendents.includes(p)
    return (
      <FilaCasella checked={te(p) || pendent} disabled={te(p) || pendent || !potEditar || ocupat}
        onChange={(v) => { if (v && p === altre) void marca() }}>
        {t(clau)}
        {pendent && <span className="ml-2 text-xs text-aviso">{t('rol.pendent')}</span>}
      </FilaCasella>
    )
  }

  return (
    <div className="space-y-1" data-testid="rol-redestina">
      {fila('productor', 'rol.ofereixo')}
      {fila('entidad', 'rol.rebo')}
      {dialeg}
    </div>
  )
}
