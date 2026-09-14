// Diálogo de «escríbele un correo».
//
// Es el equivalente por correo de la consola de Mensajería: con WhatsApp apagado (§8) el
// equipo se queda sin ninguna forma de escribir a un productor o a una entidad desde la
// aplicación, y la alternativa —abrir el cliente de correo de cada uno— deja el envío sin
// rastro en `documento_envios` y sin los gates de §8.
//
// No es un chat y no pretende serlo: no hay respuesta entrante que capturar (no existe
// inbound de correo), así que esto manda un mensaje y lo registra. La conversación sigue
// en el buzón de quien responde.
//
// Controlado desde fuera (`obert` / `onObert`) como `DialegMotiu`: casi siempre lo abre la
// fila de una tabla, no un botón que esté al lado del diálogo.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { enviarEmail } from '../lib/email'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export interface DestinatariCorreu {
  /** null cuando la ficha no tiene correo: el diálogo lo dice y no deja enviar. */
  email: string | null
  nom: string | null
  tipus: 'productor' | 'entidad'
  id: string
}

export default function DialegCorreu({
  obert,
  onObert,
  destinatari,
  assumpteInicial = '',
}: {
  obert: boolean
  onObert: (v: boolean) => void
  destinatari: DestinatariCorreu | null
  assumpteInicial?: string
}) {
  const { t } = useT()
  const [assumpte, setAssumpte] = useState(assumpteInicial)
  const [text, setText] = useState('')
  const [enviant, setEnviant] = useState(false)

  // Al cerrarse se vacía: reabrirlo para otra ficha con el texto de la anterior es la
  // forma más fácil de mandarle a alguien un mensaje que no era para él.
  useEffect(() => {
    if (!obert) { setAssumpte(assumpteInicial); setText('') }
  }, [obert, assumpteInicial])

  const email = destinatari?.email?.trim() ?? ''
  const buit = assumpte.trim() === '' || text.trim() === ''

  async function envia() {
    if (!destinatari || !email || buit || enviant) return
    setEnviant(true)
    // El maquetado lo pone el servidor (cabecera, logo, pie): aquí solo va el contenido,
    // como en el envío de ofertas. `text` se escapa y se respeta tal cual se escribió.
    const r = await enviarEmail({
      to: email,
      subject: assumpte.trim(),
      text: text.trim(),
      plantilla: { titulo: assumpte.trim() },
      proposito: 'missatge',
      objeto_tipo: destinatari.tipus,
      objeto_id: destinatari.id,
    })
    setEnviant(false)
    if (r.ok) { toast.success(t('correu.sent', { email })); onObert(false); return }
    const data = r.data as { code?: string } | null
    if (data?.code === 'no_test_user') toast.error(t('od.not_test_toast', { name: destinatari.nom ?? email }))
    else if (data?.code === 'no_test_recipient') toast.error(t('od.email_no_test', { email }))
    else toast.error(t('od.no_send_email'))
  }

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('correu.title')}</DialogTitle>
          <DialogDescription>
            {email
              ? t('correu.to', { name: destinatari?.nom ?? '', email })
              : t('correu.no_email')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="correu-assumpte">{t('correu.subject')}</Label>
            {/* `Input` y `Textarea` de shadcn traen `text-base md:text-sm`: por debajo de
                16px iOS amplía la página al enfocar y no lo deshace (§2). */}
            <Input
              id="correu-assumpte"
              value={assumpte}
              onChange={(e) => setAssumpte(e.target.value)}
              disabled={!email}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correu-text">{t('correu.body')}</Label>
            <Textarea
              id="correu-text"
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!email}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onObert(false)} disabled={enviant}>
            {t('c.cancel')}
          </Button>
          <Button className="whitespace-normal" disabled={!email || buit || enviant} onClick={() => void envia()}>
            {enviant ? t('correu.sending') : t('correu.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
