// El CRM en el bloque «Gestió interna» de la ficha del equipo (plan 1, 1F, D4; completado el
// 04-11-2026 con la Taula mestra 1.5): cada interacción con fecha, canal, tipo, responsable y
// comentario, y si hace falta la próxima acción con su fecha. Arriba, la última interacción y
// los seguimientos pendientes (con «Fet»); después el formulario y el hilo, lo último arriba.
// Sin edición: una nota se corrige escribiendo otra; lo único que cambia después es que su
// seguimiento se da por hecho (`tancar_seguiment()`). Borrar es del super_admin.
//
// Solo se monta en `EntitatDetall` (rutas del equipo). La tabla la protege la RLS
// (`es_intern()`), no esta pantalla: la ficha del actor no la pinta y, si la pidiera, le
// llegarían 0 filas. 🔴 Nada de aquí sale por ningún canal (AGENTS §8).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { avuiLocal, dataCurta, dataHora } from '../../lib/format'
import {
  CANALS_NOTA, MAX_ACCIO, MAX_TEXT_NOTA, TIPUS_NOTA, dataPerEnviar, estatSeguiment, faTemps, seguimentPerEnviar, textValid,
  type CanalNota, type TipusNota,
} from '../../lib/notesInternes'
import { useSessio } from '../../hooks/useSessio'
import { useConfirma } from '../DialegConfirma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const COLS = 'id, data, canal, tipus, text, created_at, responsable, propera_accio, propera_data, seguiment_fet_at, autor:perfiles(id, nombre, email)'

interface Nota {
  id: string
  data: string
  canal: CanalNota
  tipus: TipusNota
  text: string
  created_at: string
  responsable: string | null
  propera_accio: string | null
  propera_data: string | null
  seguiment_fet_at: string | null
  autor: { id: string; nombre: string | null; email: string | null } | null
}

interface Membre { id: string; nom: string }

/** El color de la fecha de un seguimiento, según cómo va. */
const COLOR_SEGUIMENT: Record<ReturnType<typeof estatSeguiment>, string> = {
  vencut: 'bg-error-fondo text-error',
  avui: 'bg-aviso-fondo text-aviso',
  previst: 'bg-muted text-muted-foreground',
  fet: 'bg-exito-fondo text-exito',
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
  const { session } = useSessio()
  const jo = session?.user.id ?? ''
  const { confirma, dialeg } = useConfirma()
  const [notes, setNotes] = useState<Nota[] | null>(null)
  const [equip, setEquip] = useState<Membre[]>([])
  const [errCarrega, setErrCarrega] = useState(false)
  const [tipus, setTipus] = useState<TipusNota>('seguiment')
  const [canal, setCanal] = useState<CanalNota>('telefon')
  const [dia, setDia] = useState(avuiLocal())
  const [responsable, setResponsable] = useState('')
  const [text, setText] = useState('')
  const [accio, setAccio] = useState('')
  const [diaAccio, setDiaAccio] = useState('')
  const [ocupat, setOcupat] = useState(false)
  const avui = avuiLocal()

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

  // Quién puede ser responsable: las cuentas con un rol del equipo (la RPC lo vuelve a mirar).
  // `usuario_roles` no tiene FK a `perfiles`: dos consultas.
  useEffect(() => {
    void (async () => {
      const { data: rols } = await supabase.from('usuario_roles').select('user_id')
      const ids = [...new Set(((rols ?? []) as { user_id: string }[]).map((r) => r.user_id))]
      if (ids.length === 0) return
      const { data: perfils } = await supabase.from('perfiles').select('id, nombre, email').in('id', ids).eq('activo', true)
      const llista = ((perfils ?? []) as { id: string; nombre: string | null; email: string | null }[])
        .map((p) => ({ id: p.id, nom: p.nombre?.trim() || p.email || '—' }))
        .sort((a, b) => a.nom.localeCompare(b.nom))
      setEquip(llista)
    })()
  }, [])
  const nomDe = useMemo(() => new Map(equip.map((m) => [m.id, m.nom])), [equip])
  const respTriat = responsable || jo

  async function afegeix(e: React.FormEvent) {
    e.preventDefault()
    if (!textValid(text)) return
    const seg = seguimentPerEnviar(accio, diaAccio)
    if (seg === 'incompleta') { toast.error(t('ni.err_seguiment_incomplet')); return }
    setOcupat(true)
    // Hoy no se manda `p_data`: la RPC pone `now()` y el orden del día es el de escritura.
    const pData = dataPerEnviar(dia, avuiLocal())
    const { error } = await supabase.rpc('afegir_nota_interna', {
      p_org: orgId,
      p_canal: canal,
      p_text: text.trim(),
      p_tipus: tipus,
      ...(respTriat ? { p_responsable: respTriat } : {}),
      ...(pData ? { p_data: pData } : {}),
      ...(seg ? { p_propera_accio: seg.accio, p_propera_data: seg.data } : {}),
    })
    setOcupat(false)
    if (error) { toast.error(textError(t, error.message)); return }
    setText('')
    setAccio('')
    setDiaAccio('')
    setDia(avuiLocal())
    toast.success(t('ni.ok_afegida'))
    await carrega()
    onCanviat?.()
  }

  async function tanca(n: Nota) {
    const { error } = await supabase.rpc('tancar_seguiment', { p_id: n.id })
    if (error) { toast.error(textError(t, error.message)); return }
    toast.success(t('ni.ok_fet'))
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
  const pendents = (notes ?? [])
    .filter((n) => n.propera_accio && n.propera_data && !n.seguiment_fet_at)
    .sort((a, b) => (a.propera_data! < b.propera_data! ? -1 : a.propera_data! > b.propera_data! ? 1 : 0))
  const darrera = notes?.[0] ?? null

  /** «12/11/2026» con el color de cómo va. */
  function dataSeguiment(n: Nota) {
    const estat = estatSeguiment(n.propera_data!, avui, Boolean(n.seguiment_fet_at))
    return (
      <Badge className={COLOR_SEGUIMENT[estat]} data-testid="seguiment-estat" data-estat={estat}>
        {dataCurta(`${n.propera_data}T12:00:00`)}{estat === 'previst' ? '' : ` · ${t(`ni.seg_${estat}`)}`}
      </Badge>
    )
  }

  return (
    <div className="space-y-5" data-testid="notes-internes">
      <div>
        <h3 className="text-base font-semibold">{t('ni.titol')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('ni.ajuda')}</p>
      </div>

      {/* Lo que pide 1.5 a la vista: la última interacción y lo que queda por hacer. */}
      {notes && notes.length > 0 && (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3" data-testid="crm-resum">
          {darrera && (
            <p className="text-sm" data-testid="darrera-interaccio">
              <span className="font-medium">{t('ni.darrera')}: </span>
              {[t(faTemps(darrera.data).clau, { n: faTemps(darrera.data).n }), t(`ni.canal_${darrera.canal}`), t(`ni.tipus_${darrera.tipus}`)].join(' · ')}
            </p>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t('ni.pendents')} <span className="tabular-nums text-muted-foreground">({pendents.length})</span>
            </p>
            {pendents.length === 0 && <p className="text-sm text-muted-foreground">{t('ni.cap_pendent')}</p>}
            {pendents.length > 0 && (
              <ul className="space-y-2" data-testid="seguiments-pendents">
                {pendents.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center gap-2" data-testid="seguiment">
                    {dataSeguiment(n)}
                    <span className="min-w-0 flex-1 basis-48 text-sm wrap-anywhere">{n.propera_accio}</span>
                    {n.responsable && <span className="text-xs text-muted-foreground">{nomDe.get(n.responsable) ?? t('ni.autor_desconegut')}</span>}
                    <Button variant="outline" size="sm" onClick={() => void tanca(n)}>
                      <Check className="size-4" /> {t('ni.fet')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <form onSubmit={(e) => void afegeix(e)} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="nota-form">
        <div className="space-y-1.5">
          <Label htmlFor="nota-tipus">{t('ni.tipus')}</Label>
          <Select value={tipus} onValueChange={(v) => setTipus(v as TipusNota)}>
            <SelectTrigger id="nota-tipus" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIPUS_NOTA.map((c) => <SelectItem key={c} value={c}>{t(`ni.tipus_${c}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nota-canal">{t('ni.canal')}</Label>
          <Select value={canal} onValueChange={(v) => setCanal(v as CanalNota)}>
            <SelectTrigger id="nota-canal" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CANALS_NOTA.map((c) => <SelectItem key={c} value={c}>{t(`ni.canal_${c}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nota-data">{t('ni.data')}</Label>
          <Input id="nota-data" type="date" value={dia} max={avui} onChange={(e) => setDia(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nota-responsable">{t('ni.responsable')}</Label>
          <Select value={respTriat} onValueChange={setResponsable} disabled={equip.length === 0}>
            <SelectTrigger id="nota-responsable" className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {equip.map((m) => <SelectItem key={m.id} value={m.id}>{m.nom}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="nota-text">{t('ni.text')}</Label>
          <Textarea id="nota-text" rows={2} placeholder={t('ni.placeholder')} value={text}
            onChange={(e) => setText(e.target.value)} aria-invalid={massaLlarg} />
          {massaLlarg && <p className="text-xs text-destructive">{t('ni.err_llarg', { n: MAX_TEXT_NOTA })}</p>}
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <Label htmlFor="nota-accio">{t('ni.propera_accio')}</Label>
          <Input id="nota-accio" placeholder={t('ni.propera_placeholder')} value={accio} maxLength={MAX_ACCIO}
            onChange={(e) => setAccio(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nota-accio-data">{t('ni.propera_data')}</Label>
          <Input id="nota-accio-data" type="date" value={diaAccio} min={avui} onChange={(e) => setDiaAccio(e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" disabled={ocupat || !textValid(text)} className="w-full sm:w-auto">
            {ocupat ? t('c.saving') : t('ni.afegir')}
          </Button>
        </div>
      </form>

      {errCarrega && <p className="text-sm text-destructive">{t('c.load_error')}</p>}
      {notes && notes.length === 0 && <p className="text-sm text-muted-foreground">{t('ni.buit')}</p>}
      {notes && notes.length > 0 && (
        <ul className="space-y-3" data-testid="notes-fil">
          {notes.map((n) => {
            const fa = faTemps(n.data)
            const autor = n.autor?.nombre?.trim() || n.autor?.email || t('ni.autor_desconegut')
            const resp = n.responsable ? nomDe.get(n.responsable) : undefined
            return (
              <li key={n.id} className="flex items-start gap-2 rounded-md border border-border p-3" data-testid="nota">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" data-testid="nota-tipus">{t(`ni.tipus_${n.tipus}`)}</Badge>
                    <p className="text-xs text-muted-foreground" title={dataHora(n.data)} data-testid="nota-cap">
                      {[t(fa.clau, { n: fa.n }), t(`ni.canal_${n.canal}`), autor].join(' · ')}
                    </p>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm">{n.text}</p>
                  {resp && n.responsable !== n.autor?.id && (
                    <p className="text-xs text-muted-foreground">{t('ni.responsable')}: {resp}</p>
                  )}
                  {n.propera_accio && n.propera_data && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-sm" data-testid="nota-seguiment">
                      <span className="font-medium">{t('ni.propera_accio')}:</span>
                      <span className="min-w-0 wrap-anywhere">{n.propera_accio}</span>
                      {dataSeguiment(n)}
                    </div>
                  )}
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
