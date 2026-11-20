// La tabla de la pestaña «Resum» de «Entrades i sortides» (punto 6.7): un grupo por fila
// (entidad productora, receptora, producto, modalidad, mes, zona o estado) con sus salidas, sus
// kilos y los kilos recogidos de cada modalidad, como la hoja «Indicadors» del ARA. Al pie, el
// total de lo filtrado. En móvil, solo el grupo, las salidas y los kilos de salida.
//
// Sin detalle: un grupo no abre nada (AGENTS.md §2, «sin detalle, no»).

import { useT } from '../../lib/i18n'
import { kg, nombre } from '../../lib/format'
import { MODALITATS_SORTIDA, clauAgrupacio, clauModalitatCurta, textGrup } from '../../lib/sortides'
import type { AgrupacioSortides, ResumSortides, XifresSortides } from '../../types'
import { usePuntTall } from '../../hooks/usePuntTall'
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Props {
  resum: ResumSortides
  per: AgrupacioSortides
  buitKey: string
  carregant?: boolean
}

/** Las celdas de cifras de una fila (grupo o total). */
function celles(x: XifresSortides) {
  return (
    <>
      <TableCell className="text-right whitespace-nowrap tabular-nums">{nombre(x.sortides, 0)}</TableCell>
      <TableCell className="text-right whitespace-nowrap tabular-nums">{kg(x.kg_sortida)}</TableCell>
      <TableCell className="hidden text-right whitespace-nowrap tabular-nums md:table-cell">{kg(x.kg_recollits)}</TableCell>
      {MODALITATS_SORTIDA.map((m) => (
        <TableCell key={m} className="hidden text-right whitespace-nowrap tabular-nums xl:table-cell">{kg(x.per_modalitat[m].kg_recollits)}</TableCell>
      ))}
    </>
  )
}

export default function TaulaResum({ resum, per, buitKey, carregant }: Props) {
  const { t } = useT()
  const md = usePuntTall('md')
  const xl = usePuntTall('xl')
  const nCols = xl ? 8 : md ? 4 : 3
  return (
    <Table data-testid="es-resum" aria-busy={carregant || undefined} className={carregant ? 'opacity-60' : undefined}>
      <TableHeader>
        <TableRow>
          <TableHead>{t(clauAgrupacio(per))}</TableHead>
          <TableHead className="text-right">{t('sort.x_sortides')}</TableHead>
          <TableHead className="text-right">{t('sort.x_kg_sortida')}</TableHead>
          <TableHead className="hidden text-right md:table-cell">{t('sort.x_kg_recollits')}</TableHead>
          {MODALITATS_SORTIDA.map((m) => (
            <TableHead key={m} className="hidden text-right xl:table-cell">{t(clauModalitatCurta(m))}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {resum.grups.length === 0 ? (
          <TableRow>
            <TableCell colSpan={nCols} className="py-6 text-center text-sm whitespace-normal text-muted-foreground" data-testid="es-buit">
              {t(buitKey)}
            </TableCell>
          </TableRow>
        ) : resum.grups.map((g) => (
          <TableRow key={g.clau ?? '∅'} data-testid="es-grup">
            <TableCell className="whitespace-normal"><span className="break-words">{textGrup(per, g, t)}</span></TableCell>
            {celles(g)}
          </TableRow>
        ))}
      </TableBody>
      {resum.grups.length > 0 && (
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">{t('sort.total')}</TableCell>
            {celles(resum.total)}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  )
}
