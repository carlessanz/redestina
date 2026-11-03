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
import { Download, FileText, Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import BotoIcona from '../BotoIcona'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { etiquetaTipusDocument } from '../../lib/documentsPanell'
import { dataCurta } from '../../lib/albarans'
import type { Documento, DocumentoEstado } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

export type DocFila = Pick<
  Documento,
  'id' | 'objeto_id' | 'objeto_tipo' | 'tipo' | 'numero_completo' | 'estado' | 'vigente' | 'ejercicio' | 'emitido_at'
>

/**
 * Esta lista solo la montan los paneles EXTERNOS, y ahí «Error» o «Pendent de PDF» no
 * dicen nada útil a quien mira: el documento existe, su PDF se está preparando o el
 * equipo lo está reintentando (el job reencola los fallidos, §4). Las dos cosas se dicen
 * igual, «En preparació», en ámbar. La bandeja del equipo conserva los estados finos.
 */
const CLAU_ESTAT: Record<DocumentoEstado, string> = {
  emitido: 'doc.st_emitido',
  pendiente_fichero: 'doc.st_preparant',
  error: 'doc.st_preparant',
}

const ESTIL_ESTAT: Record<DocumentoEstado, string> = {
  emitido: 'bg-exito-fondo text-exito',
  pendiente_fichero: 'bg-aviso-fondo text-aviso',
  error: 'bg-aviso-fondo text-aviso',
}

export default function LlistaDocuments({
  files, descarregador, titolKey, buitKey, descKey, extra, substituit, accio,
}: {
  files: DocFila[]
  descarregador: ReturnType<typeof useDescarregaDocument>
  titolKey: string
  buitKey: string
  /** Una frase bajo el título que diga PARA QUÉ sirve la sección, si no es obvio. */
  descKey?: string
  extra?: (d: DocFila) => ReactNode
  /** Un documento que sigue vigente como PDF pero cuyo objeto ya se sustituyó (un plan de
      prevención reemplazado por otro): sin esto salía «Emès» igual que el bueno. */
  substituit?: (d: DocFila) => boolean
  /** Un enlace junto al título: a la pantalla donde ese documento se trabaja. */
  accio?: ReactNode
}) {
  const { t } = useT()

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">{t(titolKey)}</CardTitle>
          {accio}
        </div>
        {descKey && <p className="mt-1 text-sm text-muted-foreground">{t(descKey)}</p>}
      </CardHeader>
      <CardContent>
        {files.length === 0
          ? <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
          : (
            // Criterio de las tablas (03-11-2026, AGENTS.md §2): a 360 px quedan número,
            // estado y acciones; el tipo (con su `extra`) y la fecha van bajo el número hasta
            // que tienen columna —la fecha desde `md`, el tipo desde `lg`—.
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('alb.c_number')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('doc.c_type')}</TableHead>
                  <TableHead>{t('alb.c_status')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('doc.c_date')}</TableHead>
                  <TableHead className="w-15 md:w-22">
                    <span className="sr-only md:not-sr-only">{t('doc.c_actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((d) => {
                  const gris = descarregador.ocupat === d.id || d.estado === 'error'
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <span className="font-medium whitespace-nowrap tabular-nums">{d.numero_completo}</span>
                        {/* El tipo se esconde en `lg` y la fecha en `md`: por eso el «·» va
                            delante de la fecha y nunca queda colgando. */}
                        <span className="block text-xs text-muted-foreground lg:hidden">
                          {t(etiquetaTipusDocument(d.tipo))}
                          <span className="md:hidden"> · {dataCurta(d.emitido_at)}</span>
                        </span>
                        {extra && <div className="text-muted-foreground lg:hidden">{extra(d)}</div>}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        <div>{t(etiquetaTipusDocument(d.tipo))}</div>
                        {extra?.(d)}
                      </TableCell>
                      <TableCell className="text-center">
                        {substituit?.(d)
                          ? <Badge className="whitespace-normal bg-secondary text-secondary-foreground">{t('tan.ds_substituit')}</Badge>
                          : <Badge className={`whitespace-normal ${ESTIL_ESTAT[d.estado]}`}>{t(CLAU_ESTAT[d.estado])}</Badge>}
                      </TableCell>
                      <TableCell className="hidden text-center whitespace-nowrap text-muted-foreground md:table-cell">
                        {dataCurta(d.emitido_at)}
                      </TableCell>
                      <TableCell>
                        {/* «Veure el PDF» va primero: mirar el documento es lo frecuente y
                            guardarlo la excepción. Se apagan los dos a la vez, porque los
                            dos piden la misma URL firmada. */}
                        <div className="flex flex-col items-center justify-center gap-1 md:flex-row">
                          <BotoIcona
                            icona={FileText}
                            etiqueta={t('doc.a_view_pdf')}
                            disabled={gris}
                            onClick={() => void descarregador.mostra(d.id)}
                          />
                          <BotoIcona
                            icona={descarregador.generant === d.id ? Loader2 : Download}
                            etiqueta={t('doc.download')}
                            className={descarregador.generant === d.id ? '[&_svg]:animate-spin' : undefined}
                            disabled={gris}
                            onClick={() => void descarregador.descarrega(d.id)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
      </CardContent>
    </Card>
  )
}
