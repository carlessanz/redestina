// El estado del convenio de una organización, en la cabecera de su ficha.
//
// EXISTE POR UNA CONFUSIÓN QUE HAY QUE EVITAR. `productores.conveni` y `entidades.estat`
// son texto libre heredado del Excel («Signat», «Pendent de signar», «Sí»…) y **no son un
// convenio**: son la nota de que en algún momento hubo uno en papel. No se migran ni se
// interpretan (decisión D del plan), porque la campaña vuelve a firmarlo todo. Así que
// aquí se enseñan como lo que son —«conveni en paper (històric)»— y en un tono neutro,
// nunca en verde: el verde es de `vigent`, y un papel de hace tres años no habilita a
// nadie a operar a partir de la fecha de corte.
//
// Lo que sí cuenta vive en `convenios`. Se piden **solo los de esta organización**, con el
// estado más avanzado por modelo, que es la misma regla que usa la vista de la campaña.

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { estilEstatConveni } from '../lib/convenis'
import type { ConvenioEstado, ConvenioTipo } from '../types'
import { Badge } from '@/components/ui/badge'

interface Fila {
  id: string
  tipo: ConvenioTipo
  estado: ConvenioEstado
}

/** Orden del circuito: el estado más avanzado es el que describe a la organización. */
const ORDRE: ConvenioEstado[] = [
  'substituit', 'resolt', 'esborrany', 'retornat', 'pendent_firma', 'firmat', 'vigent',
]

export default function BadgeConveni({
  tipusOrg,
  orgId,
  conveniPaper,
}: {
  tipusOrg: 'productor' | 'entidad'
  orgId: string | null
  /** `productores.conveni` o `entidades.estat`, tal cual. Texto libre heredado. */
  conveniPaper: string | null
}) {
  const { t } = useT()
  const [files, setFiles] = useState<Fila[]>([])
  const [carregat, setCarregat] = useState(false)

  useEffect(() => {
    if (!orgId) { setFiles([]); setCarregat(true); return }
    let viu = true
    const columna = tipusOrg === 'productor' ? 'productor_id' : 'entidad_id'
    void supabase
      .from('convenios')
      .select('id, tipo, estado')
      .eq(columna, orgId)
      .then(({ data }) => {
        if (!viu) return
        setFiles((data as Fila[] | null) ?? [])
        setCarregat(true)
      })
    return () => { viu = false }
  }, [orgId, tipusOrg])

  if (!carregat) return null

  // Uno por modelo, con su estado más avanzado.
  const perModel = new Map<ConvenioTipo, Fila>()
  for (const f of files) {
    const previ = perModel.get(f.tipo)
    if (!previ || ORDRE.indexOf(f.estado) > ORDRE.indexOf(previ.estado)) perModel.set(f.tipo, f)
  }
  const vius = [...perModel.values()].filter((f) => f.estado !== 'substituit')
  const teVigent = vius.some((f) => f.estado === 'vigent')
  const paper = (conveniPaper ?? '').trim()

  if (vius.length === 0 && paper === '') return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {vius.map((f) => (
        <Link key={f.id} to={`/equip/convenis/${f.id}`}>
          <Badge className={estilEstatConveni(f.estado)}>
            {t(`sig.model_${f.tipo}`)} · {t(`conv.st_${f.estado}`)}
          </Badge>
        </Link>
      ))}
      {/* El histórico solo se enseña cuando NO hay convenio vigente: con uno firmado de
          verdad, la nota del Excel ya no informa de nada y solo confunde. */}
      {!teVigent && paper !== '' && (
        <Badge className="bg-secondary text-secondary-foreground">
          {t('conv.paper_badge', { valor: paper })}
        </Badge>
      )}
      {!teVigent && (
        <Link to="/equip/convenis/campanya" className="text-xs underline text-muted-foreground">
          {t('conv.paper_hint')}
        </Link>
      )}
    </div>
  )
}
