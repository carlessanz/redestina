// A quién va cada salida de una oferta, cuánto y cuándo (fase 2 de la revisión del cliente
// del 08-10-2026): «Fundació X · 250 kg · Recollida 10/10 · 10:00 · Recollida pendent».
//
// «El productor nunca debería tener que entrar a buscar qué está pasando con su oferta»: por
// eso esto va en la lista, en Inici y en el detalle, y no solo dentro de la ficha. Sale de
// `contraparts_canalitzacions()` (D1: después de aprobar, las partes se ven).

import { useT } from '../lib/i18n'
import { kg } from '../lib/format'
import { quanAvis } from '../lib/avisos'
import type { Contrapart } from '../lib/avisos'

export default function LiniesSortida({ sortides, onObre }: {
  sortides: Contrapart[]
  /** Si se pasa, cada línea abre la ficha de la operación. */
  onObre?: (canalizacionId: string) => void
}) {
  const { t } = useT()
  if (sortides.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-sm" data-testid="linies-sortida">
      {sortides.map((s) => {
        const text = [
          s.contrapart ?? '—',
          `${kg(s.kg)} kg`,
          s.data_hora_recollida ? t('pi.recollida', { quan: quanAvis(s.data_hora_recollida) }) : null,
          s.estat_recollida ? t(`op.estat_${s.estat_recollida}`) : null,
        ].filter(Boolean).join(' · ')
        return (
          <li key={s.canalizacion_id}>
            {onObre ? (
              <button type="button" className="text-left text-primary hover:underline"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onObre(s.canalizacion_id) }}>
                {text}
              </button>
            ) : text}
          </li>
        )
      })}
    </ul>
  )
}
