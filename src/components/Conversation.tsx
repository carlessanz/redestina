import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { ArrowLeft, Lock, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { sendWhatsApp } from '../lib/whatsapp'
import { plantillaPrimerContacte, textoSalutacio } from '../lib/plantillas'
import type { RolContacte } from '../lib/plantillas'
import { cn } from '../lib/utils'
import { useT } from '../lib/i18n'
import type { WaContact, WaMessage } from '../types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props {
  contact: WaContact
  onBack?: () => void
  onDeleted?: () => void
}

interface Notice {
  kind: 'error' | 'warning' | 'success'
  text: string
}

type Tfn = (key: string, params?: Record<string, string | number>) => string

function noticeFromError(data: unknown, t: Tfn): Notice {
  const payload = data as { error?: unknown; code?: string } | null
  const err = payload?.error
  switch (payload?.code) {
    case 'window_closed': return { kind: 'warning', text: t('msg.w_closed') }
    case 'no_opt_in': return { kind: 'warning', text: t('msg.w_optin') }
    case 'no_test_user': return { kind: 'warning', text: t('msg.w_no_test') }
    case 'unknown_contact': return { kind: 'error', text: t('msg.w_unknown') }
    case 'unauthorized': return { kind: 'error', text: t('msg.w_unauth') }
  }
  if (typeof err === 'string') return { kind: 'error', text: err }
  if (err && typeof err === 'object') {
    const meta = err as { code?: number; message?: string; error_data?: { details?: string } }
    const details = meta.error_data?.details ?? ''
    if (meta.code === 131047 || details.toLowerCase().includes('24 hours')) {
      return { kind: 'warning', text: t('msg.w_closed') }
    }
    return { kind: 'error', text: `Meta (${meta.code ?? '?'}): ${meta.message ?? '?'}${details ? ` — ${details}` : ''}` }
  }
  return { kind: 'error', text: 'Error' }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  if (date.toDateString() === new Date().toDateString()) return time
  return `${date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })} ${time}`
}

/**
 * Cuántos mensajes se traen de golpe. No es un número mágico: es «lo que cabe en pantalla
 * con margen», y lo que evita que abrir un contacto con meses de conversación descargue el
 * hilo entero para enseñar los últimos diez (deuda §12.6).
 */
const PAGINA = 50

/**
 * El error de Meta que hay dentro de `wa_messages.raw`, en una línea legible.
 *
 * La Graph API lo devuelve como `{ error: { code, message, error_subcode } }`. Se enseña el
 * código porque es lo que distingue las tres causas que desde el panel se ven iguales: 190
 * es un token caducado, 131030 un destinatario fuera de los verificados y 131047 la ventana
 * de 24 h cerrada (§8ter). Sin él, «no se ha enviado» no dice qué arreglar.
 */
function motiuMeta(m: WaMessage): string | null {
  const err = (m.raw as { error?: { code?: unknown; message?: unknown } } | null)?.error
  if (!err) return null
  const codi = err.code != null ? `[${String(err.code)}] ` : ''
  const text = typeof err.message === 'string' ? err.message : ''
  const linia = `${codi}${text}`.trim()
  return linia === '' ? null : linia
}

export default function Conversation({ contact, onBack, onDeleted }: Props) {
  const { t } = useT()
  const [messages, setMessages] = useState<WaMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hiHaMes, setHiHaMes] = useState(false)
  const [carregantMes, setCarregantMes] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  // Tras enviar la plantilla, se bloquea el botón un rato para no reenviarla por error.
  const [justSent, setJustSent] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    // Se piden los ÚLTIMOS `PAGINA` y se le da la vuelta, en vez de traer el hilo entero
    // (deuda §12.6). Un contacto con meses de conversación cargaba todo en cada apertura
    // para enseñar los últimos diez mensajes.
    supabase.from('wa_messages')
      .select('id, wa_message_id, contact_phone, direction, type, body, status, raw, created_at')
      .eq('contact_phone', contact.phone).order('created_at', { ascending: false }).limit(PAGINA)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setLoadError(error.message)
        else {
          const filas = ((data as WaMessage[]) ?? []).slice().reverse()
          setMessages(filas)
          // Si ha venido la página entera, es que probablemente hay más por detrás.
          setHiHaMes(filas.length === PAGINA)
        }
        setLoading(false)
      })
    const channel = supabase
      .channel(`wa-messages-${contact.phone}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'wa_messages', filter: `contact_phone=eq.${contact.phone}` },
        (payload) => {
          const message = payload.new as WaMessage
          setMessages((prev) => prev.some((m) => m.id === message.id) ? prev : [...prev, message])
        })
      .subscribe()
    return () => { cancelled = true; void supabase.removeChannel(channel) }
  }, [contact.phone])

  // ⚠️ El salto al fondo mira el ÚLTIMO mensaje, no el array entero: al cargar más hacia
  // atrás el array cambia pero el último sigue siendo el mismo, así que la vista se queda
  // donde estaba. Con `[messages]` a secas, pedir historial te devolvía al final de golpe.
  const ultimId = messages.length ? messages[messages.length - 1].id : null
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [ultimId])

  /** Trae la página anterior, desde el mensaje más antiguo que haya en pantalla. */
  async function carregaMes() {
    if (carregantMes || messages.length === 0) return
    setCarregantMes(true)
    const { data } = await supabase.from('wa_messages')
      .select('id, wa_message_id, contact_phone, direction, type, body, status, raw, created_at')
      .eq('contact_phone', contact.phone)
      .lt('created_at', messages[0].created_at)
      .order('created_at', { ascending: false }).limit(PAGINA)
    const filas = ((data as WaMessage[]) ?? []).slice().reverse()
    setMessages((prev) => [...filas, ...prev])
    setHiHaMes(filas.length === PAGINA)
    setCarregantMes(false)
  }

  async function enviarTexto() {
    // trim quita espacios/saltos sobrantes al principio y final, pero conserva los
    // saltos internos: al pegar una oferta multilínea se envía con su formato.
    const body = draft.trim()
    if (!body || sending || !ventanaAbierta) return
    setSending(true)
    setNotice(null)
    const result = await sendWhatsApp({ to: contact.phone, type: 'text', body })
    setSending(false)
    if (result.ok) setDraft('')
    else setNotice(noticeFromError(result.data, t))
  }

  function handleSubmitText(e: FormEvent) {
    e.preventDefault()
    void enviarTexto()
  }

  function handleTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envía; Shift+Enter (o Alt+Enter) inserta un salto de línea, como en WhatsApp.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      void enviarTexto()
    }
  }

  // Borra el hilo entero de la consola: todos los mensajes del contacto y su ficha
  // de wa_contacts. Si el contacto vuelve a escribir, el webhook lo recrea.
  async function borrarHilo() {
    if (!onDeleted) return
    if (!window.confirm(t('msg.confirm_delete_thread', { name: contact.name ?? contact.phone }))) return
    const { error: msgError } = await supabase.from('wa_messages').delete().eq('contact_phone', contact.phone)
    if (msgError) { setNotice({ kind: 'error', text: msgError.message }); return }
    const { error: contactError } = await supabase.from('wa_contacts').delete().eq('phone', contact.phone)
    if (contactError) { setNotice({ kind: 'error', text: contactError.message }); return }
    toast.success(t('msg.thread_deleted'))
    onDeleted()
  }

  const ventanaAbierta = contact.last_inbound_at != null &&
    Date.now() - new Date(contact.last_inbound_at).getTime() < 24 * 60 * 60 * 1000

  async function handleSendTemplate() {
    if (sending) return
    setSending(true)
    setNotice(null)
    // Rol del destinatario para el texto/plantilla adecuados. La entidad tiene
    // prioridad si el número es a la vez productor y entidad.
    const [ent, prod] = await Promise.all([
      supabase.from('entidades').select('id').eq('telefono', contact.phone).maybeSingle(),
      supabase.from('productores').select('id').eq('phone', contact.phone).maybeSingle(),
    ])
    const rol: RolContacte = ent.data ? 'entitat' : prod.data ? 'productor' : null
    // Con la ventana de 24 h abierta se envía el texto de salutació directamente
    // (en català, amb «respon OK») y se ve el mensaje real; fuera de la ventana
    // solo cabe una plantilla aprobada por Meta (en test, hello_world).
    let result
    if (ventanaAbierta) {
      result = await sendWhatsApp({ to: contact.phone, type: 'text', body: textoSalutacio(rol) })
    } else {
      const p = plantillaPrimerContacte(rol)
      result = await sendWhatsApp({
        to: contact.phone, type: 'template', template: p.name, language: p.language, components: [],
      })
    }
    setSending(false)
    if (!result.ok) { setNotice(noticeFromError(result.data, t)); return }
    // Éxito: confirmar (faltaba feedback) y evitar reenvíos accidentales.
    const nombre = contact.name ?? t('msg.this_contact')
    if (ventanaAbierta) {
      toast.success(t('msg.greeting_sent'))
    } else {
      toast.success(t('msg.template_sent', { name: nombre }))
      setNotice({ kind: 'success', text: t('msg.template_sent', { name: nombre }) })
    }
    setJustSent(true)
    setTimeout(() => setJustSent(false), 30000)
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-2 border-b bg-card px-4 py-3 md:px-5">
        {onBack && (
          <button type="button" onClick={onBack} aria-label={t('c.back')}
            className="-ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted md:hidden">
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{contact.name ?? contact.phone}</h2>
          {contact.name && <span className="text-xs text-muted-foreground">{contact.phone}</span>}
        </div>
        <Badge variant={contact.opt_in ? 'default' : 'secondary'}>
          {contact.opt_in ? t('msg.optin') : t('msg.no_consent')}
        </Badge>
        {onDeleted && (
          <button type="button" onClick={() => void borrarHilo()}
            aria-label={t('msg.delete_thread')} title={t('msg.delete_thread')}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <Trash2 className="size-4" />
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-5">
        {loading && <p className="text-sm text-muted-foreground">{t('msg.loading')}</p>}
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {!loading && !loadError && messages.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('msg.no_messages')}</p>
        )}
        {hiHaMes && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" className="h-11 md:h-8"
              disabled={carregantMes} onClick={() => void carregaMes()}>
              {t(carregantMes ? 'msg.loading' : 'msg.load_more')}
            </Button>
          </div>
        )}
        {messages.map((m) => {
          // Un envío que Meta rechazó se marca en rojo y con etiqueta propia: si se
          // pintara como un saliente normal, parecería entregado y nadie sabría que
          // el destinatario no ha recibido nada (§8ter).
          const fallido = m.direction === 'outbound' && m.status === 'error'
          return (
            <div key={m.id} className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[70%] rounded-2xl px-3 py-2 text-sm shadow-sm',
                fallido ? 'rounded-br-sm border border-destructive/40 bg-destructive/10 text-destructive'
                  : m.direction === 'outbound' ? 'rounded-br-sm bg-secondary text-secondary-foreground'
                  : 'rounded-bl-sm bg-card')}>
                <p className="whitespace-pre-wrap wrap-break-word">{m.body ?? <em>[{m.type ?? '—'}]</em>}</p>
                <span className={cn('mt-1 block text-right text-[0.65rem]',
                  fallido ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                  {formatTime(m.created_at)}
                  {fallido ? <> · {t('msg.not_delivered')}</>
                    : m.direction === 'outbound' && m.status && <> · {m.status}</>}
                </span>
                {/* El motivo que devolvió Meta. Estaba en `raw` desde siempre y el panel no
                    lo modelaba (§12.9), así que «NO ENVIAT» no distinguía un token caducado
                    de un número fuera de la lista de prueba — tres causas con tres arreglos
                    distintos (§8ter). */}
                {fallido && motiuMeta(m) && (
                  <span className="mt-1 block text-[0.65rem] text-destructive/80">
                    {motiuMeta(m)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {notice && (
        <div className={cn('mx-5 rounded-md px-3 py-2 text-sm',
          notice.kind === 'success' ? 'bg-exito-fondo text-exito'
            : notice.kind === 'warning' ? 'bg-aviso-fondo text-aviso'
            : 'bg-error-fondo text-error')}>
          {notice.text}
        </div>
      )}

      {!ventanaAbierta && (
        <div className="mx-5 mb-1 flex items-start gap-2 rounded-md border border-aviso/30 bg-aviso-fondo px-3 py-2 text-sm text-aviso">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>{t('msg.banner', { name: contact.name ?? t('msg.this_contact') })}</span>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t bg-card px-3 py-2.5 md:px-5 md:py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant={ventanaAbierta ? 'outline' : 'default'}
              onClick={handleSendTemplate} disabled={sending || justSent}>
              {justSent ? t('msg.sent_wait') : ventanaAbierta ? t('msg.greeting') : t('msg.first_msg')}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-center">{t('msg.tooltip')}</TooltipContent>
        </Tooltip>
        <form className="flex min-w-0 flex-1 basis-full items-end gap-2 md:basis-auto" onSubmit={handleSubmitText}>
          <Textarea
            rows={1}
            className="max-h-40 min-h-10 min-w-0 resize-none py-2"
            placeholder={ventanaAbierta ? t('msg.write_ph') : t('msg.start_first_ph')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            disabled={sending || !ventanaAbierta}
          />
          <Button type="submit" disabled={sending || !draft.trim() || !ventanaAbierta}>
            {sending ? t('c.sending') : t('c.send')}
          </Button>
        </form>
      </footer>
    </main>
  )
}
