// Los controles de la Operativa del productor que no son un campo plano (Plan 2, A4,
// `20270521100000`; filas 2.1, 2.2 y 2.5). Los pinta `BlocCamps` para los tipos `xips`,
// `productes`, `principals`, `varietats`, `kg_producte` y `mesos_producte` de `campsFitxa.ts`.
//
// UN SOLO ORIGEN (T4): estos controles editan columnas de `productores`, y se montan igual en
// la pestaña Operativa de la ficha del equipo, en «La meva organització» del productor y en la
// sección 1 del formulario del diagnóstico. Cada uno lee los valores HERMANOS del mismo
// formulario (los principales salen de los habituales; el volumen y la temporada, de los
// principales), por eso recibe `valors` entero.
//
// Al cambiar los habituales o los principales se poda lo que deja de colgar de ellos
// (`podaOperativa`): es lo mismo que hará el trigger `productores_operativa`, y así la pantalla
// no enseña un volumen de un producto que ya no es principal.

import { useEffect, useMemo, useState } from 'react'
import { useT } from '../../lib/i18n'
import { carregaCataleg, type ProducteCataleg } from '../../lib/fotosProducte'
import { podaOperativa, type CampFitxa } from '../../lib/campsFitxa'
import XipsTria from '../XipsTria'
import Desplegable from '../Desplegable'
import { Input } from '@/components/ui/input'

/** Recomendación de la fila 2.2 («recomanació ≤5»): una ayuda, no un tope. */
export const MAX_PRINCIPALS_RECOMANAT = 5

const MESOS: Record<'ca' | 'es', string[]> = {
  ca: ['gen', 'feb', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'des'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
}

const llista = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [])
const mapa = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export const TIPUS_OPERATIVA: ReadonlySet<string> = new Set([
  'xips', 'productes', 'principals', 'varietats', 'kg_producte', 'mesos_producte',
])

export default function ControlOperativa({
  camp, valors, onChange, disabled, id,
}: {
  camp: CampFitxa
  valors: Record<string, unknown>
  onChange: (clau: string, valor: unknown) => void
  disabled: boolean
  id: string
}) {
  const { t, lang } = useT()
  const etiquetaId = `${id}-l`
  const v = valors[camp.clau]

  // El catálogo de productos, una vez por sesión (`carregaCataleg`). Solo lo pide el control
  // de los habituales.
  const [cataleg, setCataleg] = useState<ProducteCataleg[]>([])
  const ambCataleg = camp.tipus === 'productes'
  useEffect(() => {
    if (!ambCataleg) return
    let viu = true
    void carregaCataleg().then((m) => { if (viu) setCataleg([...m.values()]) })
    return () => { viu = false }
  }, [ambCataleg])

  /** Cambia un campo y poda lo que deja de colgar de él. */
  function canvia(valor: unknown) {
    onChange(camp.clau, valor)
    if (camp.clau === 'productos_habituales' || camp.clau === 'productes_principals') {
      for (const [k, x] of Object.entries(podaOperativa({ ...valors, [camp.clau]: valor }))) onChange(k, x)
    }
  }

  const triats = useMemo(() => llista(v), [v])
  const opcionsAfegir = useMemo(() => cataleg
    .filter((p) => !triats.includes(p.nombre))
    .sort((a, b) => (a.familia ?? '').localeCompare(b.familia ?? '', 'ca') || a.nombre.localeCompare(b.nombre, 'ca'))
    .map((p) => ({ valor: p.nombre, text: p.nombre, grup: p.familia ?? undefined })), [cataleg, triats])

  if (camp.tipus === 'xips') {
    return (
      <XipsTria etiquetaId={etiquetaId} disabled={disabled}
        opcions={(camp.opcions ?? []).map((o) => ({ valor: o, text: camp.etiquetaOpcio ? t(`${camp.etiquetaOpcio}${o}`) : o }))}
        triats={triats} onChange={(nv) => onChange(camp.clau, nv.length ? nv : null)} />
    )
  }

  if (camp.tipus === 'productes') {
    // Los marcados (un clic los quita) y, debajo, un desplegable por familia para añadir. Un
    // valor que no es del catálogo (texto libre de un import antiguo) sale igual: se conserva
    // mientras no se quite.
    return (
      <div className="space-y-2">
        {triats.length === 0
          ? <p className="text-sm text-muted-foreground">{t('op.cap_producte')}</p>
          : <XipsTria etiquetaId={etiquetaId} disabled={disabled}
              opcions={triats.map((p) => ({ valor: p, text: p }))} triats={triats}
              onChange={(nv) => canvia(nv.length ? nv : null)} />}
        {!disabled && (
          <Desplegable id={id} aria-label={t('op.afegeix_producte')} value="" placeholder={t('op.afegeix_producte')}
            className="max-w-sm" opcions={opcionsAfegir}
            onChange={(nom) => { if (nom) canvia([...triats, nom]) }} />
        )}
      </div>
    )
  }

  if (camp.tipus === 'principals') {
    const habituals = llista(valors.productos_habituales)
    if (habituals.length === 0) return <p className="text-sm text-muted-foreground">{t('op.primer_habituals')}</p>
    const marcats = triats.filter((p) => habituals.includes(p))
    return (
      <div className="space-y-1">
        <XipsTria etiquetaId={etiquetaId} disabled={disabled}
          opcions={habituals.map((p) => ({ valor: p, text: p }))} triats={marcats}
          onChange={(nv) => canvia(nv.length ? nv : null)} />
        {marcats.length > MAX_PRINCIPALS_RECOMANAT && (
          <p className="text-xs text-aviso">{t('op.massa_principals', { n: MAX_PRINCIPALS_RECOMANAT })}</p>
        )}
      </div>
    )
  }

  // Los tres mapas por producto: una fila por producto (habituales para las variedades,
  // principales para volumen y temporada).
  const productes = camp.tipus === 'varietats' ? llista(valors.productos_habituales) : llista(valors.productes_principals)
  if (productes.length === 0) {
    return <p className="text-sm text-muted-foreground">
      {t(camp.tipus === 'varietats' ? 'op.primer_habituals' : 'op.primer_principals')}
    </p>
  }
  const m = mapa(v)
  const posa = (producte: string, x: unknown) => {
    const seg = { ...m }
    if (x === undefined) delete seg[producte]
    else seg[producte] = x
    onChange(camp.clau, Object.keys(seg).length ? seg : null)
  }

  if (camp.tipus === 'varietats') {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-labelledby={etiquetaId}>
        {productes.map((p, i) => (
          <div key={p} className="flex min-w-0 items-center gap-2">
            <label htmlFor={`${id}-${i}`} className="w-32 shrink-0 truncate text-sm">{p}</label>
            <Input id={`${id}-${i}`} disabled={disabled} placeholder={t('op.ph_varietats')}
              // Se edita como texto separado por comas y se guarda como lista al desar
              // (`normalitzaValor`): partirlo en cada tecla se comería la coma recién escrita.
              value={Array.isArray(m[p]) ? (m[p] as string[]).join(', ') : String(m[p] ?? '')}
              onChange={(e) => posa(p, e.target.value.trim() === '' ? undefined : e.target.value)} />
          </div>
        ))}
      </div>
    )
  }

  if (camp.tipus === 'kg_producte') {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-labelledby={etiquetaId}>
        {productes.map((p, i) => (
          <div key={p} className="flex min-w-0 items-center gap-2">
            <label htmlFor={`${id}-${i}`} className="w-32 shrink-0 truncate text-sm">{p}</label>
            <Input id={`${id}-${i}`} type="number" inputMode="decimal" min={0} className="max-w-40" disabled={disabled}
              value={typeof m[p] === 'number' || typeof m[p] === 'string' ? String(m[p]) : ''}
              onChange={(e) => {
                const txt = e.target.value.trim()
                posa(p, txt === '' || !Number.isFinite(Number(txt)) ? undefined : Number(txt))
              }} />
            <span className="text-sm text-muted-foreground">{t('op.kg_any')}</span>
          </div>
        ))}
      </div>
    )
  }

  // `mesos_producte`
  const opcionsMesos = MESOS[lang === 'es' ? 'es' : 'ca'].map((nom, i) => ({ valor: String(i + 1), text: nom }))
  return (
    <div className="space-y-3">
      {productes.map((p, i) => (
        <div key={p} className="space-y-1">
          <p id={`${id}-${i}-l`} className="text-sm font-medium">{p}</p>
          <XipsTria etiquetaId={`${id}-${i}-l`} disabled={disabled} opcions={opcionsMesos}
            triats={llista(m[p]).map(String)}
            onChange={(nv) => {
              const mesos = nv.map(Number).filter((x) => x >= 1 && x <= 12).sort((a, b) => a - b)
              posa(p, mesos.length ? mesos : undefined)
            }} />
        </div>
      ))}
    </div>
  )
}
