// Una lista simple de documentos emitidos: número, tipo, estado, fecha y descarga.
//
// La usan las secciones del panel externo que no necesitan nada más que eso —el plan de
// prevención y los certificados a demanda—, donde el documento ES la fila: no hay un objeto
// de dominio que enseñar al lado, como sí lo hay en albaranes o convenios.
//
// `extra` existe para el único caso que sí tiene algo que añadir: un certificado a demanda
// cubre un periodo concreto, y sin esa línea dos certificados del mismo año serían
// indistinguibles.

import type { ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { etiquetaTipusDocument } from '../../lib/documentsPanell'
import { dataCurta } from '../../lib/albarans'
import type { Documento, DocumentoEstado } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

export type DocFila = Pick<
  Documento,
  'id' | 'objeto_id' | 'objeto_tipo' | 'tipo' | 'numero_completo' | 'estado' | 'vigente' | 'ejercicio' | 'emitido_at'
>

/** Mismo vocabulario que la bandeja del equipo: los estados no se renombran por panel. */
const CLAU_ESTAT: Record<DocumentoEstado, string> = {
  emitido: 'doc.st_emitido',
  pendiente_fichero: 'doc.st_pendent',
  error: 'doc.st_error',
}

const ESTIL_ESTAT: Record<DocumentoEstado, string> = {
  emitido: 'bg-exito-fondo text-exito',
  pendiente_fichero: 'bg-aviso-fondo text-aviso',
  error: 'bg-error-fondo text-error',
}

export default function LlistaDocuments({
  files, descarregador, titolKey, buitKey, extra,
}: {
  files: DocFila[]
  descarregador: ReturnType<typeof useDescarregaDocument>
  titolKey: string
  buitKey: string
  extra?: (d: DocFila) => ReactNode
}) {
  const { t } = useT()

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t(titolKey)}</CardTitle></CardHeader>
      <CardContent>
        {files.length === 0
          ? <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
          : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('alb.c_number')}</TableHead>
                    <TableHead>{t('doc.c_type')}</TableHead>
                    <TableHead>{t('alb.c_status')}</TableHead>
                    <TableHead>{t('doc.c_date')}</TableHead>
                    <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium whitespace-nowrap tabular-nums">
                        {d.numero_completo}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div>{t(etiquetaTipusDocument(d.tipo))}</div>
                        {extra?.(d)}
                      </TableCell>
                      <TableCell>
                        <Badge className={ESTIL_ESTAT[d.estado]}>{t(CLAU_ESTAT[d.estado])}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dataCurta(d.emitido_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-11 whitespace-normal md:h-8"
                            disabled={descarregador.ocupat === d.id || d.estado === 'error'}
                            onClick={() => void descarregador.descarrega(d.id)}
                          >
                            {descarregador.generant === d.id
                              ? <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                              : <Download className="mr-1 size-3.5" aria-hidden />}
                            {t('doc.download')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </CardContent>
    </Card>
  )
}
