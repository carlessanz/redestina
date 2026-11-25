// La tabla de la pestaña «Sortides» de «Entrades i sortides» (punto 6.7): una fila por salida.
//
// El criterio de las tablas (AGENTS.md §2): sin scroll horizontal. En móvil quedan tres columnas
// —«ofertante → receptor», el producto con la fecha debajo y los kilos de salida—: con la fecha en
// su propia columna, a 360 px la de los kilos se salía de la tabla (medido). La fecha tiene columna
// desde `md`; el receptor, los kilos recogidos y el estado desde `lg`, y la modalidad desde `xl` (los
// puntos de corte miran la ventana, no el contenido: a 800 px el menú lateral se come un tercio y
// con las ocho columnas la tabla se salía por la derecha, medido). La fila entera abre la ficha de la
// operación (`FilaClicable` + `TitolFila` en el producto, que da el teclado).
//
// FASE 4 (25-11-2026): el TIPUS D'OPERACIÓ no tiene columna (es secundario y la tabla ya va justa):
// una espigolada lleva su etiqueta bajo el producto, a todos los anchos; un excedente ya cosechado,
// que es lo normal, no lleva nada. En el Excel sí es columna.

import { useT } from '../../lib/i18n'
import { kg } from '../../lib/format'
import { classeEstat, clauEstat, clauModalitat, textDia } from '../../lib/sortides'
import BadgeEspigolada from '../BadgeEspigolada'
import BadgeRegistrePosteriori from '../BadgeRegistrePosteriori'
import type { FilaSortida } from '../../types'
import { usePuntTall } from '../../hooks/usePuntTall'
import { FilaClicable, TitolFila } from '../FilaClicable'
import BadgeEstat from '../proces/BadgeEstat'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

interface Props {
  files: readonly FilaSortida[]
  /** Clave i18n del mensaje sin filas (sin filtros o con filtros). */
  buitKey: string
  onObre: (f: FilaSortida) => void
  carregant?: boolean
}

export default function TaulaSortides({ files, buitKey, onObre, carregant }: Props) {
  const { t } = useT()
  // Las columnas VISIBLES: la fila del mensaje vacío las ocupa todas (§2, `usePuntTall`).
  const md = usePuntTall('md')
  const lg = usePuntTall('lg')
  const xl = usePuntTall('xl')
  const nCols = 3 + (md ? 1 : 0) + (lg ? 3 : 0) + (xl ? 1 : 0)
  return (
    <Table data-testid="es-taula" aria-busy={carregant || undefined} className={carregant ? 'opacity-60' : undefined}>
      <TableHeader>
        <TableRow>
          <TableHead className="hidden w-24 md:table-cell">{t('sort.x_data')}</TableHead>
          <TableHead>{t('sort.x_ofertant')}</TableHead>
          <TableHead>{t('sort.x_producte')}</TableHead>
          <TableHead className="hidden lg:table-cell">{t('sort.x_receptor')}</TableHead>
          <TableHead className="text-right whitespace-nowrap">
            {/* En móvil, la unidad sola: la cabecera larga partía en tres líneas. */}
            <span className="hidden md:inline">{t('sort.x_kg_sortida')}</span>
            <span className="md:hidden" aria-label={t('sort.x_kg_sortida')}>kg</span>
          </TableHead>
          <TableHead className="hidden text-right lg:table-cell">{t('sort.x_kg_recollits')}</TableHead>
          <TableHead className="hidden xl:table-cell">{t('sort.x_modalitat')}</TableHead>
          <TableHead className="hidden lg:table-cell">{t('sort.x_estat')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.length === 0 ? (
          <TableRow>
            <TableCell colSpan={nCols} className="py-6 text-center text-sm whitespace-normal text-muted-foreground" data-testid="es-buit">
              {t(buitKey)}
            </TableCell>
          </TableRow>
        ) : files.map((f) => (
          <FilaClicable key={f.canalizacion_id} onObre={() => onObre(f)} data-testid="es-fila">
            <TableCell className="hidden align-top whitespace-nowrap tabular-nums md:table-cell">{textDia(f.data_sortida)}</TableCell>
            <TableCell className="align-top whitespace-normal">
              <span className="break-words">{f.productor_nom ?? '—'}</span>
              {/* Hasta `lg`, el receptor va aquí: «ofertante → receptor». */}
              <span className="block text-xs break-words text-muted-foreground lg:hidden">→ {f.entidad_nom ?? '—'}</span>
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <TitolFila onObre={() => onObre(f)} className="break-words">{f.producto ?? '—'}</TitolFila>
              {f.variedad && <span className="block text-xs break-words text-muted-foreground">{f.variedad}</span>}
              <span className="block text-xs text-muted-foreground tabular-nums md:hidden">{textDia(f.data_sortida)}</span>
              {f.tipus_operacio === 'espigolada' && (
                <span className="mt-1 block" data-testid="es-tipus-espigolada">
                  <BadgeEspigolada className="max-w-full whitespace-normal" />
                </span>
              )}
              {/* Proceso 3.7: la oferta se registró a posteriori (`origen = 'registre'`). */}
              {f.registre_posteriori && (
                <span className="mt-1 block" data-testid="es-registre-posteriori">
                  <BadgeRegistrePosteriori className="max-w-full whitespace-normal" />
                </span>
              )}
            </TableCell>
            <TableCell className="hidden align-top whitespace-normal lg:table-cell">
              <span className="break-words">{f.entidad_nom ?? '—'}</span>
            </TableCell>
            <TableCell className="text-right align-top whitespace-nowrap tabular-nums">{kg(f.kg_sortida)}</TableCell>
            <TableCell className="hidden text-right align-top whitespace-nowrap tabular-nums lg:table-cell">{kg(f.kg_recollits)}</TableCell>
            <TableCell className="hidden align-top xl:table-cell">
              <Badge variant="outline" className="max-w-full whitespace-normal">{t(clauModalitat(f.modalitat))}</Badge>
            </TableCell>
            <TableCell className="hidden align-top lg:table-cell">
              <BadgeEstat clase={`${classeEstat(f.estat)} max-w-full whitespace-normal`}>{t(clauEstat(f.estat))}</BadgeEstat>
            </TableCell>
          </FilaClicable>
        ))}
      </TableBody>
    </Table>
  )
}
