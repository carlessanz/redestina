// Un bloque de campos de la ficha de una organización, pintado desde `campsFitxa.ts` (D8).
// Lo montan la ficha del equipo (`EntitatDetall`) y la del actor (`PerfilOrganitzacio`):
// el mismo control para el mismo campo, en las dos pantallas. Controlado: recibe los valores
// por clave de campo y devuelve cada cambio; quien lo monta decide cuándo y cómo se guarda.
//
// Los `id` llevan prefijo (`po-productor-nif`, `ed-nif`): con doble rol puede haber dos
// formularios en la misma página (la ficha del actor, una pestaña por papel).

import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n'
import { dataCurta } from '../../lib/format'
import { carregaMunicipis } from '../../lib/municipis'
import { TIPUS_EMPRESA } from '../../lib/perfilReceptor'
import { potEditar, type CampFitxa, type Veu } from '../../lib/campsFitxa'
import type { TipusActivitat } from '../../lib/organitzacio'
import SelectorMunicipi from '../SelectorMunicipi'
import XipsTria from '../XipsTria'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const MODALITATS = ['donacio', 'venda', 'maquila'] as const

export interface PropsBlocCamps {
  camps: readonly CampFitxa[]
  valors: Record<string, unknown>
  onChange: (clau: string, valor: unknown) => void
  veu: Veu
  /** Quien mira puede editar (el titular, el equipo); si no, todo en solo lectura. */
  potEditar: boolean
  /** Errores de validación por clave de campo (claves i18n). */
  errors?: Record<string, string>
  /** Prefijo de los `id` de los controles. */
  idPrefix: string
  /** El catálogo de actividades que aplica (para `xips_activitat`). */
  activitats?: readonly TipusActivitat[]
  /**
   * Con doble rol: lo que dice la OTRA ficha de un campo común cuando no coincide, para
   * decirlo junto al campo (`valorComu()`), por clave de campo.
   */
  discrepancies?: Record<string, { rol: 'ofertant' | 'receptor'; valor: unknown }>
  /** Texto que se sugiere en «nom comercial» cuando está vacío (la persona de contacto). */
  placeholderNom?: string
  /** Pantalla ancha (la ficha del equipo, `ample`): tres columnas desde `lg`. */
  tresColumnes?: boolean
}

export default function BlocCamps({
  camps, valors, onChange, veu, potEditar: potEditarTot, errors = {}, idPrefix, activitats = [], discrepancies = {}, placeholderNom, tresColumnes = false,
}: PropsBlocCamps) {
  const { t, lang } = useT()
  const idDe = (c: CampFitxa) => `${idPrefix}-${c.clau}`
  const selectClasses = 'w-full text-base md:text-sm'

  // Las comarcas, del mismo nomenclátor que el selector de población (cargado una vez).
  const ambComarca = camps.some((c) => c.tipus === 'comarca')
  const [comarques, setComarques] = useState<string[]>([])
  useEffect(() => {
    if (!ambComarca) return
    let viu = true
    void carregaMunicipis().then((ms) => {
      if (viu) setComarques([...new Set(ms.map((m) => m.comarca))].sort((a, b) => a.localeCompare(b, 'ca')))
    })
    return () => { viu = false }
  }, [ambComarca])

  function control(c: CampFitxa) {
    const tp = c.tipus ?? 'text'
    const v = valors[c.clau]
    const id = idDe(c)
    const disabled = !potEditarTot || !potEditar(c, veu)
    const invalid = Boolean(errors[c.clau])

    if (c.edita === 'ningu') {
      // Derivado o de sistema («Alta a la plataforma»): se enseña, no se teclea. Una fecha, dd/mm/aaaa.
      const text = v == null || v === '' ? '—' : tp === 'data' ? dataCurta(String(v)) : String(v)
      return <p id={id} className="text-sm font-medium tabular-nums">{text}</p>
    }
    if (tp === 'textarea') {
      return <Textarea id={id} name={c.clau} rows={3} value={(v as string) ?? ''} disabled={disabled}
        onChange={(e) => onChange(c.clau, e.target.value)} />
    }
    if (tp === 'number') {
      return <Input id={id} name={c.clau} type="number" value={v == null || v === '' ? '' : String(v)} disabled={disabled}
        onChange={(e) => onChange(c.clau, e.target.value === '' ? null : Number(e.target.value))} />
    }
    if (tp === 'data') {
      return <Input id={id} name={c.clau} type="date" value={(v as string) ?? ''} disabled={disabled}
        onChange={(e) => onChange(c.clau, e.target.value || null)} />
    }
    if (tp === 'bool') {
      return (
        <Select value={v ? 'si' : 'no'} disabled={disabled} onValueChange={(val) => onChange(c.clau, val === 'si')}>
          <SelectTrigger id={id} className={selectClasses}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="si">{t('c.yes')}</SelectItem>
            <SelectItem value="no">{t('c.no')}</SelectItem>
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'boolnull') {
      return (
        <Select value={v == null ? 'null' : v ? 'si' : 'no'} disabled={disabled}
          onValueChange={(val) => onChange(c.clau, val === 'null' ? null : val === 'si')}>
          <SelectTrigger id={id} className={selectClasses}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="null">—</SelectItem>
            <SelectItem value="si">{t('c.yes')}</SelectItem>
            <SelectItem value="no">{t('c.no')}</SelectItem>
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'select') {
      const val = (v as string) ?? ''
      return (
        <Select value={val === '' ? '__none' : val} disabled={disabled}
          onValueChange={(nv) => onChange(c.clau, nv === '__none' ? null : nv)}>
          <SelectTrigger id={id} className={selectClasses}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {(c.opcions ?? []).map((o) => (
              <SelectItem key={o} value={o}>{c.etiquetaOpcio ? t(`${c.etiquetaOpcio}${o}`) : o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'tipus_empresa') {
      // Un valor de antes de la lista (texto libre del import) se conserva como opción
      // propia: si no, el desplegable lo enseñaría vacío y se perdería al guardar. La RPC
      // `tipus_empresa_valid()` lo acepta por lo mismo.
      const val = (v as string | null) ?? ''
      const llegat = val && !(TIPUS_EMPRESA as readonly string[]).includes(val) ? val : null
      return (
        <Select value={val === '' ? '__none' : val} disabled={disabled}
          onValueChange={(nv) => onChange(c.clau, nv === '__none' ? null : nv)}>
          <SelectTrigger id={id} className={selectClasses}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {llegat && <SelectItem value={llegat}>{llegat}</SelectItem>}
            {TIPUS_EMPRESA.map((te) => <SelectItem key={te} value={te}>{t(`org.te_${te}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'municipi') {
      return (
        <>
          {/* Elegir la población pone su comarca en «Àrea geogràfica», que luego se puede
              cambiar (la base hace lo mismo si el área no llega en la misma escritura). */}
          <SelectorMunicipi id={id} valor={(v as string | null) ?? null} invalid={invalid}
            onChange={(m) => {
              if (disabled) return
              onChange(c.clau, m?.codi_ine ?? null)
              if (m && camps.some((x) => x.clau === 'area_geografica')) onChange('area_geografica', m.comarca)
            }} />
        </>
      )
    }
    if (tp === 'comarca') {
      // Un valor de antes de la lista (el «Terres Ebre» del import) se conserva como opción
      // propia, como en `tipus_empresa`; la RPC del actor también lo acepta.
      const val = (v as string | null) ?? ''
      const llegat = val && comarques.length > 0 && !comarques.includes(val) ? val : null
      return (
        <Select value={val === '' ? '__none' : val} disabled={disabled}
          onValueChange={(nv) => onChange(c.clau, nv === '__none' ? null : nv)}>
          <SelectTrigger id={id} className={selectClasses}><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {llegat && <SelectItem value={llegat}>{llegat}</SelectItem>}
            {/* Mientras carga la lista, el valor actual, para que el desplegable no salga vacío. */}
            {comarques.length === 0 && val && <SelectItem value={val}>{val}</SelectItem>}
            {comarques.map((co) => <SelectItem key={co} value={co}>{co}</SelectItem>)}
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'xips_activitat') {
      if (activitats.length === 0) return null
      return (
        <XipsTria etiquetaId={`${id}-l`} disabled={disabled}
          opcions={activitats.map((a) => ({ valor: a.codi, text: lang === 'es' ? a.nom_es : a.nom_ca }))}
          triats={Array.isArray(v) ? (v as string[]) : []}
          onChange={(nv) => onChange(c.clau, nv)} />
      )
    }
    if (tp === 'xips_modalitats') {
      return (
        <XipsTria etiquetaId={`${id}-l`} disabled={disabled}
          opcions={MODALITATS.map((m) => ({ valor: m, text: t(`org.mi_${m === 'venda' ? 'compra' : m}`) }))}
          triats={Array.isArray(v) ? (v as string[]) : []}
          onChange={(nv) => onChange(c.clau, nv)} />
      )
    }
    if (tp === 'list') {
      const texto = Array.isArray(v) ? (v as string[]).join(', ') : ((v as string) ?? '')
      return <Input id={id} name={c.clau} type="text" value={texto} disabled={disabled}
        onChange={(e) => onChange(c.clau, e.target.value)} />
    }
    return (
      <Input
        id={id}
        name={c.clau}
        value={(v as string) ?? ''}
        disabled={disabled}
        aria-invalid={invalid}
        maxLength={c.maxim}
        type={tp === 'email' ? 'email' : tp === 'tel' ? 'tel' : 'text'}
        placeholder={c.clau === 'nom_comercial' && !v ? placeholderNom : undefined}
        inputMode={tp === 'cp' ? 'numeric' : tp === 'tel' ? 'tel' : undefined}
        autoComplete={tp === 'email' ? 'email' : tp === 'tel' ? 'tel' : undefined}
        onChange={(e) => onChange(c.clau, e.target.value)}
      />
    )
  }

  const esXips = (c: CampFitxa) => c.tipus === 'xips_activitat' || c.tipus === 'xips_modalitats'

  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2${tresColumnes ? ' lg:grid-cols-3' : ''}`}>
      {camps.map((c) => {
        const ctrl = control(c)
        if (ctrl === null) return null
        const altre = discrepancies[c.clau]
        return (
          <div key={c.clau} className={c.ample === 'full' ? (tresColumnes ? 'sm:col-span-2 lg:col-span-3' : 'sm:col-span-2') : undefined}>
            {esXips(c)
              ? <p id={`${idDe(c)}-l`} className="mb-1.5 text-xs text-muted-foreground">{t(c.labelKey)}</p>
              : <Label htmlFor={idDe(c)} className="mb-1.5 block text-xs text-muted-foreground">{t(c.labelKey)}</Label>}
            {ctrl}
            {errors[c.clau] && <p className="mt-1 text-xs text-destructive">{t(errors[c.clau])}</p>}
            {c.ajudaKey && !errors[c.clau] && <p className="mt-1 text-xs text-muted-foreground">{t(c.ajudaKey)}</p>}
            {altre && (
              <p className="mt-1 text-xs text-aviso" data-testid={`${idDe(c)}-altra`}>
                {t('ef.altra_fitxa', {
                  rol: t(altre.rol === 'ofertant' ? 'ef.paper_ofertant' : 'ef.paper_receptor').toLowerCase(),
                  x: Array.isArray(altre.valor) ? (altre.valor as string[]).join(', ') : String(altre.valor ?? ''),
                })}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
