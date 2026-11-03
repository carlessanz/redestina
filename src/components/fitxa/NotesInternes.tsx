// El CRM mínimo en el bloque «Gestió interna» de la ficha del equipo (plan 1, rebanada 1F, D4):
// un formulario de una línea (canal, fecha —hoy por defecto— y texto) y el hilo debajo, lo más
// reciente arriba: «fa 3 dies · WhatsApp · Nom». Sin edición: una nota se corrige escribiendo
// otra; borrarla es del super_admin (`esborrar_nota_interna()`).
//
// Solo se monta en `EntitatDetall` (rutas del equipo). La tabla la protege la RLS
// (`es_intern()`), no esta pantalla: la ficha del actor no la pinta y, si la pidiera, le
// llegarían 0 filas. 🔴 Nada de aquí sale por ningún canal (AGENTS §8).

import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { avuiLocal, dataHora } from '../../lib/format'
import { CANALS_NOTA, MAX_TEXT_NOTA, dataPerEnviar, faTemps, textValid, type CanalNota } from '../../lib/notesInternes'
import { useConfirma } from '../DialegConfirma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const COLS = 'id, data, canal, text, created_at, autor:perfiles(nombre)'

interface Nota {
  id: string
  data: string
  canal: CanalNota
  text: string
  created_at: string
  autor: { nombre: string | null } | null
}

export default function NotesInternes({ orgId, potEsborrar, onCanviat, onCompte }: {
  orgId: string
  /** Solo el super_admin borra (la RPC lo vuelve a comprobar). */
  potEsborrar: boolean
  onCanviat?: () => void
  /** Cuántas notas hay, para el contador de la pestaña de la ficha. */
  onCompte?: (n: number) => void
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [notes, setNotes] = useState<Nota[] | null>(null)
  const [errCarrega, setErrCarrega] = useState(false)
  const [canal, setCanal] = useState<CanalNota>('telefon')
  const [dia, setDia] = useState(avuiLocal())
  const [text, setText] = useState('')
  const [ocupat, setOcupat] = useState(false)

  const carrega = useCallback(async () => {
    const { data, error } = await supabase.from('notes_internes').select(COLS)
      .eq('organizacion_id', orgId)
      .order('data', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) { setErrCarrega(true); return }
    setErrCarrega(false)
    setNotes((data ?? []) as unknown as Nota[])
    onCompte?.((data ?? []).length)
  }, [orgId, onCompte])
  useEffect(() => { void carrega() }, [carrega])

  async function afegeix(e: React.FormEvent) {
    e.preventDefault()
    if (!textValid(text)) return
    setOcupat(true)
    // Hoy no se manda `p_data`: la RPC pone `now()` y el orden del día es el de escritura.
    const pData = dataPerEnviar(dia, avuiLocal())
    const { error } = await supabase.rpc('afegir_nota_interna', {
      p_org: orgId,
      p_canal: canal,
      p_text: text.trim(),
      ...(pData ? { p_data: pData } : {}),
    })
    setOcupat(false)
    if (error) { toast.error(textError(t, error.message)); return }
    setText('')
    setDia(avuiLocal())
    toast.success(t('ni.ok_afegida'))
    await carrega()
    onCanviat?.()
  }

  async function esborra(n: Nota) {
    if (!(await confirma({
      titol: t('ni.confirm_t'),
      descripcio: t('ni.confirm_d'),
      confirmar: t('ni.esborrar'),
      destructiu: true,
    }))) return
    const { error } = await supabase.rpc('esborrar_nota_interna', { p_id: n.id })
    if (error) { toast.error(textError(t, error.message)); return }
    toast.success(t('ni.ok_esborrada'))
    await carrega()
    onCanviat?.()
  }

  const massaLlarg = text.trim().length > MAX_TEXT_NOTA

  return (
    <div className="space-y-3 border-t pt-4" data-testid="notes-internes">
      <div>
        <p className="text-sm font-medium">{t('ni.titol')}</p>
        <p className="text-xs text-muted-foreground">{t('ni.ajuda')}</p>
      </div>

      <form onSubmit={(e) => void afegeix(e)} className="flex flex-wrap items-start gap-2" data-testid="nota-form">
        <Select value={canal} onValueChange={(v) => setCanal(v as CanalNota)}>
          <SelectTrigger id="nota-canal" aria-label={t('ni.canal')} className="w-full text-base sm:w-40 md:text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CANALS_NOTA.map((c) => <SelectItem key={c} value={c}>{t(`ni.canal_${c}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input id="nota-data" type="date" aria-label={t('ni.data')} value={dia} max={avuiLocal()}
          onChange={(e) => setDia(e.target.value)} className="w-full sm:w-auto" />
        <Input id="nota-text" aria-label={t('ni.text')} placeholder={t('ni.placeholder')} value={text}
          onChange={(e) => setText(e.target.value)} aria-invalid={massaLlarg}
          className="min-w-0 flex-1 basis-full sm:basis-60" />
        <Button type="submit" disabled={ocupat || !textValid(text)} className="w-full sm:w-auto">
          {ocupat ? t('c.saving') : t('ni.afegir')}
        </Button>
        {massaLlarg && <p className="basis-full text-xs text-destructive">{t('ni.err_llarg', { n: MAX_TEXT_NOTA })}</p>}
      </form>

      {errCarrega && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
      {notes && notes.length === 0 && <p className="text-sm text-muted-foreground">{t('ni.buit')}</p>}
      {notes && notes.length > 0 && (
        <ul className="space-y-3" data-testid="notes-fil">
          {notes.map((n) => {
            const fa = faTemps(n.data)
            return (
              <li key={n.id} className="flex items-start gap-2 rounded-md border border-border p-3" data-testid="nota">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground" title={dataHora(n.data)} data-testid="nota-cap">
                    {[t(fa.clau, { n: fa.n }), t(`ni.canal_${n.canal}`), n.autor?.nombre || t('ni.autor_desconegut')].join(' · ')}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{n.text}</p>
                </div>
                {potEsborrar && (
                  <Button variant="ghost" size="icon" aria-label={t('ni.esborrar')} title={t('ni.esborrar')}
                    className="text-destructive" onClick={() => void esborra(n)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {dialeg}
    </div>
  )
}
