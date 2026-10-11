// Una sección del expediente de prevención (fase 11): la lista de sus elementos (visitas,
// procesos, cuantificación, objetivos, acciones, seguimientos) y, para el equipo, el alta,
// la edición y el borrado. Genérica sobre una lista de campos: las columnas que de verdad se
// guardan las decide la base (`columnes_element_expedient`), no esta pantalla.

import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { dataCurta, nombre } from '../../lib/format'
import {
  desarElement, elements, esborrarElement, type Element, type TaulaExpedient,
} from '../../lib/expedientApi'
import { useConfirma } from '../DialegConfirma'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export interface CampElement {
  clau: string
  labelKey: string
  tipus: 'text' | 'textarea' | 'date' | 'mes' | 'number' | 'select'
  opcions?: { valor: string; text: string }[]
  obligatori?: boolean
  /** No sale como columna de la tabla (sí en el formulario). */
  nomesFormulari?: boolean
}

const SELECT = 'h-11 w-full rounded-md border border-input bg-transparent px-3 text-base md:h-9 md:text-sm'

/** Del valor guardado al del control, y al revés. */
function aControl(c: CampElement, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (c.tipus === 'mes') return String(v).slice(0, 7)
  if (c.tipus === 'date') return String(v).slice(0, 10)
  return String(v)
}
function deControl(c: CampElement, v: string): unknown {
  const net = v.trim()
  if (net === '') return null
  if (c.tipus === 'mes') return `${net}-01`
  if (c.tipus === 'number') return Number.isFinite(Number(net)) ? Number(net) : null
  return net
}

export default function TaulaElements({
  taula, expedientId, titolKey, ajudaKey, camps, editable, onCanvi, testId,
}: {
  taula: TaulaExpedient
  expedientId: string
  titolKey: string
  ajudaKey?: string
  camps: CampElement[]
  editable: boolean
  onCanvi?: (files: Element[]) => void
  testId?: string
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [files, setFiles] = useState<Element[]>([])
  const [error, setError] = useState<string | null>(null)
  const [obert, setObert] = useState<{ id: string | null; valors: Record<string, string> } | null>(null)
  const [desant, setDesant] = useState(false)
  const avisa = useCallback((f: Element[]) => onCanvi?.(f), [onCanvi])

  const carrega = useCallback(async () => {
    const r = await elements(taula, expedientId)
    if (!r.ok) { setError(r.missatge); return }
    setError(null)
    setFiles(r.data)
    avisa(r.data)
  }, [taula, expedientId, avisa])

  useEffect(() => { void carrega() }, [carrega])

  const textCel = (c: CampElement, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—'
    if (c.tipus === 'date') return dataCurta(String(v))
    if (c.tipus === 'mes') return String(v).slice(0, 7)
    if (c.tipus === 'number') return nombre(Number(v), 0)
    if (c.tipus === 'select') return c.opcions?.find((o) => o.valor === String(v))?.text ?? String(v)
    return String(v)
  }

  function nou() {
    setObert({ id: null, valors: Object.fromEntries(camps.map((c) => [c.clau, ''])) })
  }
  function edita(f: Element) {
    setObert({ id: f.id, valors: Object.fromEntries(camps.map((c) => [c.clau, aControl(c, f[c.clau])])) })
  }

  async function desa() {
    if (!obert) return
    const falta = camps.find((c) => c.obligatori && obert.valors[c.clau].trim() === '')
    if (falta) { toast.error(t('exp.falta_camp', { x: t(falta.labelKey) })); return }
    setDesant(true)
    const dades = Object.fromEntries(camps.map((c) => [c.clau, deControl(c, obert.valors[c.clau])]))
    const r = await desarElement(taula, expedientId, obert.id, dades)
    setDesant(false)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    toast.success(t('rec.saved'))
    setObert(null)
    await carrega()
  }

  async function esborra(f: Element) {
    if (!(await confirma({ titol: t('exp.esborrar_t'), descripcio: t('exp.esborrar_d'), destructiu: true, confirmar: t('c.delete') }))) return
    const r = await esborrarElement(taula, f.id)
    if (!r.ok) { toast.error(textError(t, r.missatge)); return }
    await carrega()
  }

  const columnes = camps.filter((c) => !c.nomesFormulari)

  return (
    <Card data-testid={testId}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="text-base">{t(titolKey)}</CardTitle>
          {ajudaKey && <p className="mt-1 text-sm text-muted-foreground">{t(ajudaKey)}</p>}
        </div>
        {editable && !obert && (
          <Button variant="outline" className="h-11 w-full sm:w-auto md:h-9" onClick={nou}>
            <Plus className="size-4" aria-hidden /> {t('exp.afegeix')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{textError(t, error)}</p>}

        {obert && (
          <div className="space-y-3 rounded-lg border border-border bg-secondary/40 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {camps.map((c) => {
                const id = `${taula}-${c.clau}`
                const valor = obert.valors[c.clau]
                const posa = (v: string) => setObert((o) => (o ? { ...o, valors: { ...o.valors, [c.clau]: v } } : o))
                return (
                  <div key={c.clau} className={c.tipus === 'textarea' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
                    <Label htmlFor={id} className="text-xs text-muted-foreground">{t(c.labelKey)}</Label>
                    {c.tipus === 'textarea' ? (
                      <Textarea id={id} rows={2} value={valor} onChange={(e) => posa(e.target.value)} />
                    ) : c.tipus === 'select' ? (
                      <select id={id} className={SELECT} value={valor} onChange={(e) => posa(e.target.value)}>
                        <option value="">—</option>
                        {(c.opcions ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.text}</option>)}
                      </select>
                    ) : (
                      <Input id={id} value={valor} onChange={(e) => posa(e.target.value)}
                        type={c.tipus === 'date' ? 'date' : c.tipus === 'mes' ? 'month' : c.tipus === 'number' ? 'number' : 'text'}
                        inputMode={c.tipus === 'number' ? 'decimal' : undefined} />
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="h-11 md:h-9" disabled={desant} onClick={() => void desa()}>
                {desant ? t('c.saving') : t('c.save')}
              </Button>
              <Button variant="outline" className="h-11 md:h-9" onClick={() => setObert(null)}>{t('c.cancel')}</Button>
            </div>
          </div>
        )}

        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('exp.buit')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columnes.map((c) => <TableHead key={c.clau}>{t(c.labelKey)}</TableHead>)}
                  {editable && <TableHead className="text-right">{t('doc.c_actions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f) => (
                  <TableRow key={f.id}>
                    {columnes.map((c) => (
                      <TableCell key={c.clau} className="min-w-28 max-w-80 whitespace-normal">{textCel(c, f[c.clau])}</TableCell>
                    ))}
                    {editable && (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="size-11 md:size-8" aria-label={t('exp.edita')} onClick={() => edita(f)}>
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-11 md:size-8" aria-label={t('c.delete')} onClick={() => void esborra(f)}>
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {dialeg}
    </Card>
  )
}
