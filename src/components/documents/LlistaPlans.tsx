// El plan de prevención en los dos paneles externos: sus PDF y el enlace al diagnóstico.
//
// UNO SOLO para productor y receptor (28-09-2026), por dos cosas que las dos pantallas
// hacían mal igual:
//
// · Un plan SUSTITUIDO salía «Emès», igual que el vigente. Su PDF sigue siendo vigente como
//   documento —`documentos.vigente` es por objeto, y cada versión del plan es otro objeto—,
//   así que lo que dice si vale es `planes_prevencion.estado`. La RLS («plans: intern o
//   meus») ya deja leer los propios.
// · Ninguna enlazaba a la pantalla del diagnóstico (deuda 99): desde aquí no había forma
//   de llegar al plan que se trabaja, solo a sus PDF.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ClipboardList } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import LlistaDocuments, { type DocFila } from './LlistaDocuments'
import { Button } from '@/components/ui/button'

export default function LlistaPlans({ files, descarregador }: {
  /** Los documentos de `objeto_tipo = 'plan'`. */
  files: DocFila[]
  descarregador: ReturnType<typeof useDescarregaDocument>
}) {
  const { t } = useT()
  const [substituits, setSubstituits] = useState<Set<string>>(new Set())

  const ids = useMemo(() => [...new Set(files.map((d) => d.objeto_id))], [files])
  const clau = ids.join(',')

  useEffect(() => {
    if (ids.length === 0) return
    let viu = true
    void supabase
      .from('planes_prevencion')
      .select('id, estado')
      .in('id', ids)
      .eq('estado', 'substituit')
      .then(({ data }) => {
        if (viu) setSubstituits(new Set(((data ?? []) as { id: string }[]).map((p) => p.id)))
      })
    return () => { viu = false }
    // `clau` resume `ids`: el array es nuevo en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clau])

  // El vigente primero y los sustituidos al final, cada grupo por fecha.
  const ordenats = useMemo(
    () => [...files].sort((a, b) =>
      Number(substituits.has(a.objeto_id)) - Number(substituits.has(b.objeto_id))),
    [files, substituits],
  )

  return (
    <LlistaDocuments
      files={ordenats}
      descarregador={descarregador}
      titolKey="mydoc.pla_title"
      buitKey="mydoc.pla_empty"
      substituit={(d) => substituits.has(d.objeto_id)}
      accio={(
        <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
          <Link to="/organitzacio/diagnostic">
            <ClipboardList className="mr-1 size-3.5" aria-hidden />
            {t('mydoc.pla_open')}
          </Link>
        </Button>
      )}
    />
  )
}
