// Las ACCIONES del diagnóstico de un productor (Plan 2, A3, `20270522100000`): una por destino
// de cada excedente (decisión b), agrupadas producto → causa → destino, con su estado y su nota
// de seguimiento.
//
// Se monta en dos sitios del equipo: la sección 3 de `FormulariDiagnostic` (con los datos que ya
// tiene, sin recargar) y la pestaña «Gestió interna» de la ficha (`EntitatDetall`, carga sola).
// Con `editable`, el estado (`Desplegable`) se guarda AL MOMENTO con `fixar_estat_accio`, y la
// nota con su botón: independiente de «Desa el diagnòstic». Sin `editable`, solo se lee.
//
// 🔴 La nota de seguimiento la VE LA ORGANIZACIÓN («El meu diagnòstic»): la etiqueta lo dice.
//    Lo que solo es del equipo va a las notas internas, no aquí.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { dataCurta } from '../../lib/format'
import { diagnosticDatos, fixarEstatAccio } from '../../lib/diagnosticApi'
import {
  ESTATS_ACCIO, blocsExcedents, nomCausa, textDesti, textEstatAccio, titolBloc,
  type AccioExcedentLlegible, type BlocExcedentsLlegible,
} from '../../lib/excedentsLlegible'
import { estilEstatAccio } from '../../lib/excedentsDiagnostic'
import CarregantSeccio from '../CarregantSeccio'
import Desplegable from '../Desplegable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export default function AccionsDiagnostic({
  productorId, editable, excedents,
}: {
  productorId: string
  editable: boolean
  /**
   * Los bloques que ya tiene quien lo monta (`diagnostic_datos().excedents`). Sin ellos, se
   * cargan aquí. Cuando cambian (p. ej. tras «Desa»), la lista se rehace con ellos.
   */
  excedents?: unknown
}) {
  const { t, lang } = useT()
  const [propis, setPropis] = useState<BlocExcedentsLlegible[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtre, setFiltre] = useState('')
  /** Lo cambiado aquí (estado y nota), por id de acción, encima de lo que llega. */
  const [canvis, setCanvis] = useState<Record<string, Partial<AccioExcedentLlegible>>>({})

  const carrega = useCallback(async () => {
    const r = await diagnosticDatos('productor', productorId)
    if (!r.ok) { setError(r.missatge); setPropis([]); return }
    setError(null)
    setPropis(blocsExcedents(r.data.excedents))
  }, [productorId])

  useEffect(() => {
    if (excedents === undefined) void carrega()
  }, [carrega, excedents])

  // Unos datos nuevos de quien lo monta mandan sobre lo cambiado aquí (ya lo llevan dentro).
  useEffect(() => { setCanvis({}) }, [excedents])

  const blocs = useMemo(() => {
    const base = excedents !== undefined ? blocsExcedents(excedents) : (propis ?? [])
    return base.map((b) => ({
      ...b,
      causes: b.causes.map((c) => ({
        ...c, accions: c.accions.map((a) => ({ ...a, ...(canvis[a.id] ?? {}) })),
      })),
    }))
  }, [canvis, excedents, propis])

  const onDesat = useCallback((a: AccioExcedentLlegible) => {
    setCanvis((c) => ({ ...c, [a.id]: a }))
  }, [])

  if (excedents === undefined && propis === null) return <CarregantSeccio files={2} ambCapcalera={false} />
  if (error) return <p className="text-sm text-destructive">{textError(t, error)}</p>

  const total = blocs.reduce((n, b) => n + b.causes.reduce((m, c) => m + c.accions.length, 0), 0)
  if (total === 0) {
    return <p className="text-sm text-muted-foreground" data-testid="accions-buit">{t('dexc.accions_buit')}</p>
  }

  const visibles = blocs
    .map((b) => ({
      ...b,
      causes: b.causes
        .map((c) => ({ ...c, accions: c.accions.filter((a) => filtre === '' || a.estat === filtre) }))
        .filter((c) => c.accions.length > 0),
    }))
    .filter((b) => b.causes.length > 0)

  return (
    <div className="space-y-4" data-testid="accions-diagnostic">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor={`filtre-accions-${productorId}`} className="text-sm">{t('dexc.estat')}</Label>
        <Desplegable
          id={`filtre-accions-${productorId}`}
          data-testid="filtre-accions"
          mida="sm"
          value={filtre}
          onChange={setFiltre}
          buit={t('dexc.filtre_totes')}
          opcions={ESTATS_ACCIO.map((e) => ({ valor: e, text: textEstatAccio(e, t) }))}
        />
      </div>

      {visibles.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('dexc.accions_cap_filtre')}</p>
      )}

      {visibles.map((b) => (
        <section key={b.producte} className="space-y-3" aria-label={b.producte}>
          <h4 className="text-sm font-semibold break-words">{titolBloc(b, t)}</h4>
          {b.causes.map((c) => (
            <div key={c.causa} className="space-y-2 border-l-2 border-border pl-3">
              <p className="text-sm font-medium break-words">{nomCausa(c, lang)}</p>
              <ul className="space-y-2">
                {c.accions.map((a) => (
                  <FilaAccio key={a.id} accio={a} editable={editable} onDesat={onDesat} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

/** Una acción: destino, texto, estado y nota (editables con `editable`). */
function FilaAccio({
  accio, editable, onDesat,
}: {
  accio: AccioExcedentLlegible
  editable: boolean
  onDesat: (a: AccioExcedentLlegible) => void
}) {
  const { t } = useT()
  const [nota, setNota] = useState(accio.notes ?? '')
  const [desant, setDesant] = useState<'estat' | 'nota' | null>(null)
  useEffect(() => { setNota(accio.notes ?? '') }, [accio.notes])

  async function desa(estat: string, notes: string | null) {
    setDesant(notes === null ? 'estat' : 'nota')
    const r = await fixarEstatAccio(accio.id, estat, notes)
    setDesant(null)
    if (!r.ok) { toast.error(textError(t, r)); return }
    toast.success(t(notes === null ? 'dexc.desat_estat' : 'dexc.nota_desada'))
    onDesat({
      ...accio,
      estat: r.data.estat,
      notes: r.data.notes,
      feta_at: r.data.feta_at,
      actualitzat_at: r.data.actualitzat_at,
    })
  }

  const notaCanviada = nota.trim() !== (accio.notes ?? '').trim()

  return (
    <li className="space-y-2 rounded-lg border border-border p-3" data-testid={`accio-${accio.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{textDesti(accio.desti, t)}</Badge>
        <Badge className={estilEstatAccio(accio.estat)} data-testid="accio-estat">{textEstatAccio(accio.estat, t)}</Badge>
        {accio.estat === 'feta' && accio.feta_at && (
          <span className="text-xs text-muted-foreground">{t('dexc.feta_el', { data: dataCurta(accio.feta_at) })}</span>
        )}
      </div>
      <p className="text-sm break-words whitespace-pre-line">{accio.descripcio}</p>

      {editable ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={`accio-estat-${accio.id}`} className="text-sm">{t('dexc.estat')}</Label>
            <Desplegable
              id={`accio-estat-${accio.id}`}
              value={accio.estat}
              disabled={desant !== null}
              onChange={(v) => { if (v && v !== accio.estat) void desa(v, null) }}
              opcions={ESTATS_ACCIO.map((e) => ({ valor: e, text: textEstatAccio(e, t) }))}
            />
          </div>
          <div className="min-w-0 space-y-1.5 sm:col-span-2">
            <Label htmlFor={`accio-nota-${accio.id}`} className="text-sm">{t('dexc.nota_seguiment')}</Label>
            <Textarea
              id={`accio-nota-${accio.id}`}
              rows={2}
              maxLength={2000}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
            />
            <Button
              type="button" variant="outline" size="sm"
              disabled={!notaCanviada || desant !== null}
              onClick={() => void desa(accio.estat, nota)}
              className="h-11 whitespace-normal md:h-8"
              data-testid={`accio-desa-nota-${accio.id}`}
            >
              {desant === 'nota' && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('dexc.desa_nota')}
            </Button>
          </div>
        </div>
      ) : accio.notes && (
        <p className="text-sm break-words whitespace-pre-line text-muted-foreground">
          <span className="font-medium text-foreground">{t('dexc.seguiment')}:</span> {accio.notes}
        </p>
      )}
    </li>
  )
}
