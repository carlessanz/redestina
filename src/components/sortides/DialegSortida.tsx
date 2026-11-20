// La ficha de una salida en «Entrades i sortides» (punto 6.7): el diálogo con `FitxaOperacio`
// —la misma ficha que ven las partes, que al equipo le llega por `operacio_detall`— y, debajo,
// los enlaces a la oferta y a los albaranes de esa salida.
//
// Los enlaces van AQUÍ y no dentro de `FitxaOperacio`: la ficha la comparten el receptor y el
// productor, que no tienen esas rutas. Salen de la fila de la tabla; si el diálogo se abre desde
// un enlace compartido (`?canalitzacio=<id>`) y la salida no está en la página que se ve, se
// leen aparte: la oferta de la canalización y sus albaranes vivos (ENT/OPE y el REC propio; el
// REC heredado de la oferta solo lo da la fila).

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { FileText, Package } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import type { AlbaraSortida, FilaSortida } from '../../types'
import FitxaOperacio from '../FitxaOperacio'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Enllacos {
  excedenteId: string | null
  ent: AlbaraSortida | null
  rec: AlbaraSortida | null
}

interface Props {
  /** La canalización abierta (de la URL), o null. */
  canalizacionId: string | null
  /** Su fila, si está en la página que se ve. */
  fila: FilaSortida | undefined
  onTanca: () => void
  /** La ficha ha cambiado algo (p. ej. un registro de recogida): la tabla se relee. */
  onCanvi: () => void
}

/** Las filas de `albaranes` que se leen para los enlaces. */
interface FilaAlbara { id: string; tipo: string; numero_completo: string | null; estado: string }

/** Los enlaces de una salida que no está en la página (nunca lanza: sin datos, sin enlaces). */
async function carregaEnllacos(id: string): Promise<Enllacos> {
  try {
    // ⚠️ Cada lista de columnas, en UN literal (§7).
    const [canal, albs] = await Promise.all([
      supabase.from('canalizaciones').select('excedente_id').eq('id', id).maybeSingle(),
      supabase.from('albaranes').select('id, tipo, numero_completo, estado')
        .eq('canalizacion_id', id)
        .not('estado', 'in', '(anulado,rectificado)')
        .order('created_at', { ascending: false }),
    ])
    const files = (albs.data ?? []) as FilaAlbara[]
    const com = (a: FilaAlbara | undefined): AlbaraSortida | null => (a
      ? { id: a.id, tipo: a.tipo === 'REC' ? 'REC' : a.tipo === 'OPE' ? 'OPE' : 'ENT', numero: a.numero_completo, estado: a.estado }
      : null)
    return {
      excedenteId: (canal.data as { excedente_id: string | null } | null)?.excedente_id ?? null,
      ent: com(files.find((a) => a.tipo === 'ENT' || a.tipo === 'OPE')),
      rec: com(files.find((a) => a.tipo === 'REC')),
    }
  } catch {
    return { excedenteId: null, ent: null, rec: null }
  }
}

export default function DialegSortida({ canalizacionId, fila, onTanca, onCanvi }: Props) {
  const { t } = useT()
  // Los enlaces leídos aparte, por la canalización a la que pertenecen.
  const [llegits, setLlegits] = useState<{ id: string; e: Enllacos } | null>(null)
  useEffect(() => {
    if (!canalizacionId || fila) return
    let viu = true
    void carregaEnllacos(canalizacionId).then((e) => { if (viu) setLlegits({ id: canalizacionId, e }) })
    return () => { viu = false }
  }, [canalizacionId, fila])

  const enllacos: Enllacos | null = fila
    ? { excedenteId: fila.excedente_id, ent: fila.albara_ent, rec: fila.albara_rec }
    : llegits && llegits.id === canalizacionId ? llegits.e : null

  const textAlbara = (a: AlbaraSortida, clau: 'sort.albara_ent' | 'sort.albara_rec') =>
    t(clau, { numero: a.numero ?? t('sort.esborrany') })

  return (
    <Dialog open={canalizacionId !== null} onOpenChange={(v) => { if (!v) onTanca() }}>
      {canalizacionId && (
        <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="es-dialeg">
          <DialogHeader><DialogTitle>{t('op.title')}</DialogTitle></DialogHeader>
          <FitxaOperacio key={canalizacionId} canalizacionId={canalizacionId} onCanvi={onCanvi} />
          {enllacos && (enllacos.excedenteId || enllacos.ent || enllacos.rec) && (
            <div className="flex flex-wrap gap-2 border-t pt-3" data-testid="es-enllacos">
              {enllacos.excedenteId && (
                <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal md:min-h-8">
                  <Link to={`/equip/ofertes/${enllacos.excedenteId}`}>
                    <Package className="size-4" aria-hidden /> {t('sort.obre_oferta')}
                  </Link>
                </Button>
              )}
              {enllacos.ent && (
                <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal md:min-h-8">
                  <Link to={`/equip/albarans/${enllacos.ent.id}`}>
                    <FileText className="size-4" aria-hidden /> {textAlbara(enllacos.ent, 'sort.albara_ent')}
                  </Link>
                </Button>
              )}
              {enllacos.rec && (
                <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal md:min-h-8">
                  <Link to={`/equip/albarans/${enllacos.rec.id}`}>
                    <FileText className="size-4" aria-hidden /> {textAlbara(enllacos.rec, 'sort.albara_rec')}
                  </Link>
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  )
}
