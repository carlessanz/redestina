// Lo que la Fundación guarda de TU organización, en tu panel. Solo lectura.
//
// La quinta pieza compartida por los dos paneles externos (§6ter), junto con `PendentsDeTu`,
// `LlistaConvenis`, `LlistaDocuments` y `TaulaAlbarans`: productor y receptor la enseñan
// igual, porque un certificado de 2023 o un convenio firmado en papel no cambian según
// quién los mire.
//
// SOLO LECTURA, Y NO ES UNA SIMPLIFICACIÓN: a una ficha sube el equipo y nadie más (RLS de
// `documentos_externos`). Esto no es documentación que aporte la organización —esa va a su
// albarán o a su cierre—, es archivo que la Fundación conserva sobre ella. Lo que sí puede
// hacer la organización es descargarlo, que hasta ahora no podía.
//
// La lista se calla si está vacía: una tarjeta que dice «no hay nada» en un panel que ya
// tiene seis es ruido, y aquí el caso normal es que no haya ninguno.

import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { descarregarDocumentExtern } from '../../lib/documents'
import { dataCurta } from '../../lib/albarans'
import type { DocumentoExterno } from '../../types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Fila = Pick<DocumentoExterno, 'id' | 'tipo' | 'numero' | 'fecha' | 'created_at'>

export default function DocumentsDeLEquip({
  tipusOrg, orgId,
}: {
  tipusOrg: 'productor' | 'entidad'
  orgId: string | null
}) {
  const { t } = useT()
  const [files, setFiles] = useState<Fila[]>([])
  const [descarregant, setDescarregant] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) { setFiles([]); return }
    let viu = true
    // Columnas en UN literal (§7). La RLS ya filtra por organización: lo que se pide aquí
    // es solo lo de esta ficha, y el `objeto_tipo` distingue el archivo de la ficha de los
    // externos de una operación (la factura, el albarán del productor), que se ven en su
    // propio sitio.
    void supabase
      .from('documentos_externos')
      .select('id, tipo, numero, fecha, created_at')
      .eq('objeto_tipo', tipusOrg)
      .eq('objeto_id', orgId)
      .then(({ data }) => {
        if (!viu) return
        const totes = (data as Fila[] | null) ?? []
        totes.sort((a, b) => (a.fecha ?? a.created_at) < (b.fecha ?? b.created_at) ? 1 : -1)
        setFiles(totes)
      })
    return () => { viu = false }
  }, [orgId, tipusOrg])

  async function descarrega(id: string) {
    setDescarregant(id)
    const res = await descarregarDocumentExtern(id)
    setDescarregant(null)
    if (!res.ok) toast.error(t(res.motiuKey))
  }

  if (files.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('orgdoc.from_team')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('orgdoc.from_team_desc')}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-input p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t(`orgdoc.t_${f.tipo}`)}</p>
                <p className="text-xs text-muted-foreground">
                  {f.numero ?? '—'} · {dataCurta(f.fecha ?? f.created_at)}
                </p>
              </div>
              {/* El botón ocupa su línea en móvil y vuelve a la fila desde `sm`: con
                  `shrink-0` no desbordaría, pero aplastaría el texto (§2, regla 4). */}
              <Button
                size="sm"
                variant="outline"
                className="order-1 h-11 w-full whitespace-normal sm:order-none sm:ml-auto sm:h-8 sm:w-auto"
                disabled={descarregant === f.id}
                onClick={() => void descarrega(f.id)}
              >
                {descarregant === f.id
                  ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
                  : <Download className="mr-1 size-4" aria-hidden />}
                {t('orgdoc.download')}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
