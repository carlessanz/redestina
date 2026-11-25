// La tabla de «Interaccions i seguiment» (proceso 1.2, 25-11-2026): una por vista, con las
// columnas que pide el cliente.
//
//   · Pendents:   Data seguiment · Entitat · Tipus · Comentari (el próximo paso) · Fet
//   · Historial:  Data interacció · Entitat · Tipus · Comentari · Responsable (y, debajo del
//                 comentario, el próximo paso con su estado y su resultado, en pequeño)
//   · Previsions: Disponibilitat · Entitat · Producte · Quantitat (kg) · Ubicació
//
// El criterio de las tablas (AGENTS.md §2): sin scroll horizontal. En móvil quedan dos o tres
// columnas y lo demás baja a la celda principal como línea secundaria; las otras aparecen desde
// `md`/`lg`. La fila entera lleva a la ficha de la entidad, en «Gestió interna», que es donde vive
// su hilo (`FilaClicable` + `TitolFila` en el nombre, que da el teclado). La casilla «Fet» es un
// control: no abre la fila, abre el diálogo del resultado.

import { useNavigate } from 'react-router'
import { Building2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { dataCurta, kg } from '../../lib/format'
import { textDia } from '../../lib/sortides'
import {
  classeEstatSeguiment, clauEstatSeguiment, clauTipus, rutaFitxaInteraccions,
} from '../../lib/interaccions'
import type { FilaInteraccio, VistaInteraccions } from '../../types'
import { usePuntTall } from '../../hooks/usePuntTall'
import { FilaClicable, TitolFila } from '../FilaClicable'
import { Casella } from '../Casella'
import BotoIcona from '../BotoIcona'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Props {
  vista: VistaInteraccions
  files: readonly FilaInteraccio[]
  /** Clave i18n del mensaje sin filas (sin filtros o con filtros). */
  buitKey: string
  /** «Fet» en una fila de Pendents: abre el diálogo del resultado. */
  onFet: (f: FilaInteraccio) => void
  carregant?: boolean
}

/** El nombre de la entidad (o «—» si la ficha ya no tiene nombre). */
const nomOrg = (f: FilaInteraccio) => f.organitzacio ?? '—'

export default function TaulaInteraccions({ vista, files, buitKey, onFet, carregant }: Props) {
  const { t } = useT()
  const navigate = useNavigate()
  // Las columnas VISIBLES: la fila del mensaje vacío las ocupa todas (§2, `usePuntTall`).
  const md = usePuntTall('md')
  const lg = usePuntTall('lg')
  const nCols = vista === 'pendents'
    ? 3 + (md ? 2 : 0)
    : vista === 'historial'
      ? 2 + (md ? 2 : 0) + (lg ? 1 : 0)
      : 3 + (md ? 2 : 0) + (lg ? 1 : 0)

  const buit = (
    <TableRow>
      <TableCell colSpan={nCols} className="py-6 text-center text-sm whitespace-normal text-muted-foreground" data-testid="int-buit">
        {t(buitKey)}
      </TableCell>
    </TableRow>
  )
  const comu = { 'data-testid': 'int-taula', 'aria-busy': carregant || undefined, className: carregant ? 'opacity-60' : undefined }

  if (vista === 'pendents') {
    return (
      <Table {...comu}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24 md:w-28">{t('ixs.c_data_seguiment')}</TableHead>
            <TableHead>{t('ixs.c_entitat')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('ixs.c_tipus')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('ixs.c_comentari')}</TableHead>
            <TableHead className="w-14 text-center">{t('ixs.c_fet')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.length === 0 ? buit : files.map((f) => (
            <FilaClicable key={f.id} to={rutaFitxaInteraccions(f.organizacion_id)} data-testid="int-fila" data-id={f.id}>
              <TableCell className="align-top">
                <Badge className={`${classeEstatSeguiment(f.estat_seguiment)} max-w-full whitespace-normal tabular-nums`}
                  data-testid="int-estat" data-estat={f.estat_seguiment}>
                  {textDia(f.propera_data)}
                </Badge>
                {f.estat_seguiment === 'vencut' && (
                  <span className="mt-1 block text-xs text-aviso">{t('ixs.estat_vencut')}</span>
                )}
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <TitolFila to={rutaFitxaInteraccions(f.organizacion_id)} className="wrap-anywhere">{nomOrg(f)}</TitolFila>
                {/* Hasta `md`, el próximo paso va aquí. */}
                <span className="block text-sm wrap-anywhere md:hidden">{f.propera_accio}</span>
                {f.responsable_nom && <span className="block text-xs wrap-anywhere text-muted-foreground">{f.responsable_nom}</span>}
              </TableCell>
              <TableCell className="hidden align-top whitespace-nowrap md:table-cell">{t(clauTipus(f.tipus))}</TableCell>
              <TableCell className="hidden align-top whitespace-normal md:table-cell">
                <span className="wrap-anywhere" data-testid="int-comentari">{f.propera_accio}</span>
                <span className="block text-xs wrap-anywhere text-muted-foreground line-clamp-2">{f.text}</span>
              </TableCell>
              <TableCell className="text-center align-top">
                {/* 44 px de área táctil alrededor de la casilla de 20 (§2). */}
                <label className="inline-flex size-11 cursor-pointer items-center justify-center md:size-8" data-testid="int-fet">
                  <Casella checked={false} onChange={() => onFet(f)} aria-label={t('ni.fet')} />
                </label>
              </TableCell>
            </FilaClicable>
          ))}
        </TableBody>
      </Table>
    )
  }

  if (vista === 'historial') {
    return (
      <Table {...comu}>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden w-28 md:table-cell">{t('ixs.c_data_interaccio')}</TableHead>
            <TableHead>{t('ixs.c_entitat')}</TableHead>
            <TableHead className="hidden md:table-cell">{t('ixs.c_tipus')}</TableHead>
            <TableHead>{t('ixs.c_comentari')}</TableHead>
            <TableHead className="hidden lg:table-cell">{t('ixs.c_responsable')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.length === 0 ? buit : files.map((f) => (
            <FilaClicable key={f.id} to={rutaFitxaInteraccions(f.organizacion_id)} data-testid="int-fila" data-id={f.id}>
              <TableCell className="hidden align-top whitespace-nowrap tabular-nums md:table-cell">{dataCurta(f.data)}</TableCell>
              <TableCell className="align-top whitespace-normal">
                <TitolFila to={rutaFitxaInteraccions(f.organizacion_id)} className="wrap-anywhere">{nomOrg(f)}</TitolFila>
                <span className="block text-xs text-muted-foreground md:hidden">
                  {[dataCurta(f.data), t(clauTipus(f.tipus))].join(' · ')}
                </span>
              </TableCell>
              <TableCell className="hidden align-top whitespace-nowrap md:table-cell">{t(clauTipus(f.tipus))}</TableCell>
              <TableCell className="align-top whitespace-normal">
                <span className="wrap-anywhere whitespace-pre-wrap line-clamp-3" data-testid="int-comentari">{f.text}</span>
                {f.propera_accio && (
                  <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground" data-testid="int-seguiment">
                    <span className="wrap-anywhere">{t('ni.propera_accio')}: {f.propera_accio}</span>
                    <Badge className={`${classeEstatSeguiment(f.estat_seguiment)} max-w-full whitespace-normal`}
                      data-testid="int-estat" data-estat={f.estat_seguiment}>
                      {t(clauEstatSeguiment(f.estat_seguiment))}
                    </Badge>
                  </span>
                )}
                {f.resultat && (
                  <span className="mt-1 block text-xs wrap-anywhere text-muted-foreground" data-testid="int-resultat">
                    {t('ni.resultat')}: {f.resultat}
                  </span>
                )}
                {f.responsable_nom && (
                  <span className="mt-1 block text-xs wrap-anywhere text-muted-foreground lg:hidden">{f.responsable_nom}</span>
                )}
              </TableCell>
              <TableCell className="hidden align-top whitespace-normal lg:table-cell">
                <span className="wrap-anywhere">{f.responsable_nom ?? '—'}</span>
              </TableCell>
            </FilaClicable>
          ))}
        </TableBody>
      </Table>
    )
  }

  // Previsions
  return (
    <Table {...comu}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24 md:w-28">
            {/* En móvil, las cabeceras cortas: las largas empujaban los kilos fuera de la tabla. */}
            <span className="hidden md:inline">{t('ixs.c_disponibilitat')}</span>
            <span className="md:hidden">{t('ixs.c_data_interaccio')}</span>
          </TableHead>
          <TableHead className="hidden md:table-cell">{t('ixs.c_entitat')}</TableHead>
          <TableHead>{t('ixs.c_producte')}</TableHead>
          <TableHead className="text-right whitespace-nowrap">
            <span className="hidden md:inline">{t('ixs.c_quantitat')}</span>
            <span className="md:hidden" aria-label={t('ixs.c_quantitat')}>kg</span>
          </TableHead>
          <TableHead className="hidden lg:table-cell">{t('ixs.c_ubicacio')}</TableHead>
          <TableHead className="hidden w-12 md:table-cell"><span className="sr-only">{t('ixs.obre_fitxa')}</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.length === 0 ? buit : files.map((f) => (
          <FilaClicable key={f.id} to={rutaFitxaInteraccions(f.organizacion_id)} data-testid="int-fila" data-id={f.id}>
            <TableCell className="align-top whitespace-nowrap tabular-nums">{textDia(f.previsio_data)}</TableCell>
            <TableCell className="hidden align-top whitespace-normal md:table-cell">
              <TitolFila to={rutaFitxaInteraccions(f.organizacion_id)} className="wrap-anywhere">{nomOrg(f)}</TitolFila>
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <span className="font-medium wrap-anywhere" data-testid="int-producte">{f.previsio_producte}</span>
              {/* Hasta `md`, la entidad (con el enlace del teclado) y el lugar van aquí. */}
              <span className="block text-sm md:hidden">
                <TitolFila to={rutaFitxaInteraccions(f.organizacion_id)} className="wrap-anywhere">{nomOrg(f)}</TitolFila>
              </span>
              {f.previsio_ubicacio_nom && (
                <span className="block text-xs wrap-anywhere text-muted-foreground lg:hidden">{f.previsio_ubicacio_nom}</span>
              )}
            </TableCell>
            <TableCell className="text-right align-top whitespace-nowrap tabular-nums">{kg(f.previsio_kg)}</TableCell>
            <TableCell className="hidden align-top whitespace-normal lg:table-cell">
              <span className="wrap-anywhere">{f.previsio_ubicacio_nom ?? '—'}</span>
            </TableCell>
            <TableCell className="hidden align-top md:table-cell">
              {/* Una previsión no crea oferta: lo que se ofrece es ir a la ficha de la entidad. */}
              <BotoIcona icona={Building2} etiqueta={t('ixs.obre_fitxa')} data-testid="int-obre-fitxa"
                onClick={() => navigate(rutaFitxaInteraccions(f.organizacion_id))} />
            </TableCell>
          </FilaClicable>
        ))}
      </TableBody>
    </Table>
  )
}
