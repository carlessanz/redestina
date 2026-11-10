// Una franja horaria «de hh:mm a hh:mm» con cuatro desplegables (hora y cuarto).
//
// Salió de `FormulariNovaOferta` (05-10-2026) para usarlo también en los lugares de recogida
// (A4, `20270521100000`: franjas por lugar, `productor_ubicaciones.franges`). Un
// `<input type="time">` deja escribir cualquier minuto y en iOS sale una rueda de 60; la unidad
// mínima es el cuarto de hora (lo confirmó la Fundació).
//
// Cada punta («de hh:mm», «a hh:mm») va en un bloque que no se parte: en un móvil estrecho la
// fila salta entre las dos puntas, nunca entre la hora y sus minutos. Los minutos no tienen
// opción vacía: sin hora se leen «--» y están apagados.

import { useT } from '../lib/i18n'
import { HORES, QUARTS, type Franja } from '../lib/franja'
import Desplegable from './Desplegable'

const OPCIONS_HORES = HORES.map((h) => ({ valor: h, text: h }))
const OPCIONS_QUARTS = QUARTS.map((q) => ({ valor: q, text: q }))

export default function SelectorFranja({
  id, valor, onChange, invalid = false, disabled = false,
}: {
  id: string
  valor: Partial<Franja> | null | undefined
  /** null cuando las dos puntas quedan vacías. */
  onChange: (f: Partial<Franja> | null) => void
  invalid?: boolean
  disabled?: boolean
}) {
  const { t } = useT()
  const f = (valor && typeof valor === 'object' ? valor : {}) as Partial<Franja>
  const [hi, mi] = (f.inici ?? '').split(':')
  const [hf, mf] = (f.fi ?? '').split(':')
  const posa = (clau: 'inici' | 'fi', h: string | undefined, m: string | undefined) => {
    const nou: Partial<Franja> = { ...f }
    nou[clau] = h ? `${h}:${m || '00'}` : ''
    onChange(nou.inici || nou.fi ? nou : null)
  }
  // «De» y «a» con el mismo ancho mínimo, para que en móvil las dos filas queden alineadas.
  return (
    <div id={id} role="group" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="flex items-center gap-1.5">
        <span className="min-w-6 text-muted-foreground">{t('po.franja_de')}</span>
        <Desplegable aria-label={t('po.franja_h_inici')} className="w-18" aria-invalid={invalid} disabled={disabled}
          value={hi ?? ''} onChange={(v) => posa('inici', v, mi)} buit="--" opcions={OPCIONS_HORES} />
        <span aria-hidden>:</span>
        <Desplegable aria-label={t('po.franja_m_inici')} className="w-18" aria-invalid={invalid}
          value={mi ?? ''} disabled={disabled || !hi} onChange={(v) => posa('inici', hi, v)} placeholder="--"
          opcions={OPCIONS_QUARTS} />
      </span>
      <span className="flex items-center gap-1.5">
        <span className="min-w-6 text-muted-foreground">{t('po.franja_a')}</span>
        <Desplegable aria-label={t('po.franja_h_fi')} className="w-18" aria-invalid={invalid} disabled={disabled}
          value={hf ?? ''} onChange={(v) => posa('fi', v, mf)} buit="--" opcions={OPCIONS_HORES} />
        <span aria-hidden>:</span>
        <Desplegable aria-label={t('po.franja_m_fi')} className="w-18" aria-invalid={invalid}
          value={mf ?? ''} disabled={disabled || !hf} onChange={(v) => posa('fi', hf, v)} placeholder="--"
          opcions={OPCIONS_QUARTS} />
      </span>
    </div>
  )
}
