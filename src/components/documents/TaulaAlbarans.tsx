// La tabla de albaranes de una organización, compartida por los dos paneles externos.
//
// Al productor le enseña los REC (lo que se le recogió) y al receptor los ENT (lo que se le
// entregó), y en ninguno de los dos casos hay una sola columna de dinero — `albaran_lineas`
// no la tiene, a propósito: un albarán con un precio convierte una donación en una venta a
// ojos de quien lo lea.
//
// Vivía dentro de `productor/Documents.tsx` y el panel del receptor la importaba de allí,
// cruzando los dos paneles. Aquí no le pertenece a ninguno.

import { useMemo } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { dataCurta, estilEstatAlbara, kg } from '../../lib/albarans'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { Documento } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/**
 * Tabla de albaranes de una organización. La comparten los dos paneles: al productor le
 * enseña los REC (lo que se le recogió) y al receptor los ENT (lo que se le entregó), y en
 * ninguno de los dos casos hay una sola columna de dinero — `albaran_lineas` no la tiene, a
 * propósito: un albarán con un precio convierte una donación en una venta a ojos de quien
 * lo lea.
 */
export default function TaulaAlbarans({
  files, docs, descarregador,
}: {
  files: AlbaranBandeja[]
  docs: Pick<Documento, 'id' | 'objeto_id' | 'objeto_tipo' | 'numero_completo' | 'estado' | 'vigente'>[]
  descarregador: ReturnType<typeof useDescarregaDocument>
}) {
  const { t } = useT()
  const perAlbara = useMemo(() => {
    const mapa: Record<string, string> = {}
    for (const d of docs) {
      if (d.objeto_tipo === 'albaran' && d.vigente) mapa[d.objeto_id] = d.id
    }
    return mapa
  }, [docs])

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('alb.c_number')}</TableHead>
            <TableHead>{t('alb.c_product')}</TableHead>
            <TableHead className="text-right">{t('alb.c_kg')}</TableHead>
            <TableHead>{t('alb.c_status')}</TableHead>
            <TableHead>{t('doc.c_date')}</TableHead>
            <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((f) => {
            const docId = perAlbara[f.id]
            return (
              <TableRow key={f.id}>
                <TableCell className="font-medium whitespace-nowrap tabular-nums">
                  {f.numero_completo ?? t('alb.no_number')}
                </TableCell>
                <TableCell className="text-muted-foreground">{f.producto ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {kg(f.kg_validados ?? f.kg_confirmados ?? f.kg_neto ?? f.kg_previstos)}
                </TableCell>
                <TableCell>
                  <Badge className={estilEstatAlbara(f.estado)}>{t(`alb.st_${f.estado}`)}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {dataCurta(f.emitido_at)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    {docId
                      ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11 whitespace-normal md:h-8"
                          disabled={descarregador.ocupat === docId}
                          onClick={() => void descarregador.descarrega(docId)}
                        >
                          {descarregador.generant === docId
                            ? <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                            : <Download className="mr-1 size-3.5" aria-hidden />}
                          {t('doc.download')}
                        </Button>
                      )
                      : <span className="text-xs text-muted-foreground">{t('mydoc.no_pdf')}</span>}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
