// La tabla de albaranes de una organización, compartida por los dos paneles externos.
//
// Al productor le enseña los REC (lo que se le recogió) y al receptor los ENT y los OPE (lo
// que se le entregó), y en ninguno de los dos casos hay una sola columna de dinero — `albaran_lineas`
// no la tiene, a propósito: un albarán con un precio convierte una donación en una venta a
// ojos de quien lo lea.
//
// Vivía dentro de `productor/Documents.tsx` y el panel del receptor la importaba de allí,
// cruzando los dos paneles. Aquí no le pertenece a ninguno.

import { useMemo } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { dataCurta, estilEstatAlbara, kg } from '../../lib/albarans'
import type { AlbaranBandeja } from '../../lib/albarans'
import type { Documento } from '../../types'
import BotoIcona from '../BotoIcona'
import { Badge } from '@/components/ui/badge'
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
  // Solo lo que se pinta: el panel del receptor no pide a la bandeja las columnas que
  // nombran a la productora (D3), y no tiene por qué para usar esta tabla.
  files: Pick<
    AlbaranBandeja,
    'id' | 'numero_completo' | 'producto' | 'estado' | 'emitido_at'
    | 'kg_validados' | 'kg_confirmados' | 'kg_neto' | 'kg_previstos'
  >[]
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

  // El criterio de las tablas (03-11-2026, AGENTS.md §2): cabe sin scroll horizontal. En
  // móvil quedan el número (con el producto, los kilos y la fecha debajo), el estado y las
  // acciones en icono, apiladas; los kilos salen desde `sm`, la fecha desde `md` y el
  // producto desde `lg`.
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('alb.c_number')}</TableHead>
          <TableHead className="hidden lg:table-cell">{t('alb.c_product')}</TableHead>
          <TableHead className="hidden w-20 sm:table-cell">{t('alb.c_kg')}</TableHead>
          <TableHead className="w-24 sm:w-32">{t('alb.c_status')}</TableHead>
          <TableHead className="hidden w-28 md:table-cell">{t('doc.c_date')}</TableHead>
          <TableHead className="w-15 md:w-24"><span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((f) => {
          const docId = perAlbara[f.id]
          const kilos = kg(f.kg_validados ?? f.kg_confirmados ?? f.kg_neto ?? f.kg_previstos)
          return (
            <TableRow key={f.id}>
              <TableCell>
                <span className="font-medium tabular-nums sm:whitespace-nowrap">
                  {f.numero_completo ?? t('alb.no_number')}
                </span>
                <span className="block text-xs text-muted-foreground lg:hidden">{f.producto ?? '—'}</span>
                <span className="block text-xs text-muted-foreground tabular-nums md:hidden">
                  <span className="sm:hidden">{kilos} kg · </span>{dataCurta(f.emitido_at)}
                </span>
              </TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">{f.producto ?? '—'}</TableCell>
              <TableCell className="hidden text-center tabular-nums whitespace-nowrap sm:table-cell">
                {kilos}
              </TableCell>
              <TableCell className="text-center">
                <Badge className={`${estilEstatAlbara(f.estado)} max-w-full whitespace-normal`}>{t(`alb.st_${f.estado}`)}</Badge>
              </TableCell>
              <TableCell className="hidden text-center whitespace-nowrap tabular-nums text-muted-foreground md:table-cell">
                {dataCurta(f.emitido_at)}
              </TableCell>
              <TableCell>
                {/* «Veure» delante de «Descarrega»: repasar un albarán es lo que se hace
                    a diario, guardarlo es la excepción. Sin PDF no hay ninguno de los dos. */}
                {docId
                  ? (
                    <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                      <BotoIcona
                        icona={FileText}
                        etiqueta={t('alb.a_view_pdf')}
                        disabled={descarregador.ocupat === docId}
                        onClick={() => void descarregador.mostra(docId)}
                      />
                      <BotoIcona
                        icona={descarregador.generant === docId ? Loader2 : Download}
                        etiqueta={t('alb.a_download_pdf')}
                        className={descarregador.generant === docId ? '[&_svg]:animate-spin' : undefined}
                        disabled={descarregador.ocupat === docId}
                        motiu={descarregador.generant === docId ? t('doc.generating') : undefined}
                        onClick={() => void descarregador.descarrega(docId)}
                      />
                    </div>
                  )
                  : <p className="text-center text-xs text-muted-foreground">{t('mydoc.no_pdf')}</p>}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
