// Configuració › Notificacions (27-10-2026): el interruptor general y uno por canal (§8).
//
// LA REGLA, que la impone la base y no esta pantalla (`fixar_notificacions`,
// `fixar_canal_notificacio`):
//   · apagar el general apaga también correo y WhatsApp;
//   · encender el general NO los enciende: se encienden uno a uno, a mano;
//   · con el general apagado, «Activat» de cada canal sale gris con el motivo.
//
// LO QUE NUNCA SE CORTA: lo transaccional —el acceso y la bienvenida al aprobar un alta,
// recuperar la contraseña—. Lo dice el texto de la tarjeta general, porque la pregunta
// «¿y si apago esto, la gente podrá entrar?» es la primera que se hace quien lo pulsa.

import { useEffect, useState } from 'react'
import { Bell, BellOff, Mail, MailX, MessageCircle, MessageCircleOff, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { useAppContext } from '../../hooks/useAppContext'
import type { Canal, Canals } from '../../lib/canals'
import {
  fitxesNoProva, fitxesSenseCorreuAmbTelefon, fitxesSenseTelefonAmbCorreu, fixarCanal, fixarNotificacions,
  getCanals, getTestMode, setTestMode,
} from '../../lib/settings'
import {
  anadirNumeroTest, borrarNumeroTest, listarNumerosTest, type MetaTestRecipient,
} from '../../lib/metaTest'
import {
  anadirEmailTest, borrarEmailTest, listarEmailsTest, type EmailTestRecipient,
} from '../../lib/emailTest'
import { useConfirma } from '../DialegConfirma'
import GestorWhitelist from '../GestorWhitelist'
import Interruptor from './Interruptor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SeccioNotificacions({ potCanviar }: { potCanviar: boolean }) {
  const { t } = useT()
  const { ctx, recarrega } = useAppContext()
  const { confirma, dialeg } = useConfirma()
  const motiu = potCanviar ? undefined : t('set.only_super')
  // Las listas de prueba las escribe `pot_aprovar()` (admin o super_admin).
  const motiuLlistes = (ctx?.potAprovar ?? false) ? undefined : t('wl.no_perm')
  const [canals, setCanals] = useState<Canals | null>(null)
  // El tercer paso: A QUIÉN (27-10-2026; antes vivía en General). `true` = solo usuarios de prueba.
  const [testMode, setTest] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  // Las dos whitelists del entorno de pruebas (§4, §8): van aquí porque son la otra mitad
  // de «a quién y por dónde se envía».
  const [lista, setLista] = useState<MetaTestRecipient[]>([])
  const [listaEmail, setListaEmail] = useState<EmailTestRecipient[]>([])

  useEffect(() => {
    void getCanals().then(setCanals)
    void getTestMode().then(setTest)
    void listarNumerosTest().then(setLista)
    void listarEmailsTest().then(setListaEmail)
  }, [])

  // Tras cada cambio: el estado real de la base (no lo que creemos haber escrito) y el
  // contexto de sesión, que es lo que esconde Missatgeria y apaga los botones de envío.
  async function refresca() {
    setCanals(await getCanals())
    await recarrega()
  }

  async function canviaGeneral(actives: boolean) {
    if (!canals || actives === canals.notificacions || saving) return
    if (!actives && !(await confirma({
      titol: t('set.not_confirm_off_t'),
      descripcio: t('set.not_confirm_off'),
      confirmar: t('set.turn_off'),
      destructiu: true,
    }))) return
    setSaving(true)
    const error = await fixarNotificacions(actives)
    await refresca()
    setSaving(false)
    if (error) { toast.error(t(error)); return }
    toast.success(actives ? t('set.not_saved_on') : t('set.not_saved_off'))
  }

  /**
   * Apagar un canal es la decisión con más precio de esta pantalla, así que antes de pedir
   * confirmación se cuenta lo que cuesta: las fichas que se quedan sin ninguna vía.
   */
  async function canviaCanal(canal: Canal, actiu: boolean) {
    if (!canals || actiu === canals[canal] || saving) return
    if (!actiu) {
      setSaving(true)
      const n = canal === 'whatsapp' ? await fitxesSenseCorreuAmbTelefon() : await fitxesSenseTelefonAmbCorreu()
      setSaving(false)
      if (!(await confirma({
        titol: t(canal === 'whatsapp' ? 'set.wa_confirm_off_t' : 'set.mail_confirm_off_t'),
        descripcio: t(canal === 'whatsapp' ? 'set.wa_confirm_off' : 'set.mail_confirm_off',
          { productors: n.productors, entitats: n.entitats }),
        confirmar: t('set.turn_off'),
        destructiu: true,
      }))) return
    }
    setSaving(true)
    const error = await fixarCanal(canal, actiu)
    await refresca()
    setSaving(false)
    if (error) { toast.error(t(error)); return }
    toast.success(t(canal === 'whatsapp'
      ? (actiu ? 'set.wa_saved_on' : 'set.wa_saved_off')
      : (actiu ? 'set.mail_saved_on' : 'set.mail_saved_off')))
  }

  /**
   * Abrir el modo test a todos es la decisión más cara de esta pestaña (más aún tras una
   * importación masiva): se cuenta antes cuántas fichas empezarían a recibir. Volver a «solo
   * prueba» no pide confirmación: siempre es la dirección segura.
   */
  async function canviaTestMode(nomesProva: boolean) {
    if (nomesProva === testMode || saving) return
    if (!nomesProva) {
      setSaving(true)
      const n = await fitxesNoProva()
      setSaving(false)
      if (!(await confirma({
        titol: t('set.confirm_off_t'),
        descripcio: t('set.dest_confirm_all', { productors: n.productors, entitats: n.entitats }),
        confirmar: t('set.dest_all'),
        destructiu: true,
      }))) return
    }
    setSaving(true)
    const error = await setTestMode(nomesProva)
    setTest(await getTestMode())
    setSaving(false)
    if (error) { toast.error(t(error)); return }
    toast.success(nomesProva ? t('set.saved_on') : t('set.saved_off'))
  }

  const bloquejat = saving || !potCanviar
  // Con el general apagado, encender un canal no se ofrece: la base lo rechazaría.
  const motiuCanal = canals && !canals.notificacions ? t('canal.motiu_notificacions') : undefined

  return (
    <div className="space-y-6">
      <Interruptor
        titol={t('set.not_title')}
        actiu={canals?.notificacions ?? null}
        estat={{
          on: t('set.not_on'), onDesc: t('set.not_on_desc'),
          off: t('set.not_off'), offDesc: t('set.not_off_desc'),
          iconaOn: Bell, iconaOff: BellOff, toOff: 'error',
        }}
        onCanvia={(a) => void canviaGeneral(a)}
        bloquejat={bloquejat}
        motiu={motiu}
        ajuda={<p>{t('set.not_help')}</p>}
      />

      <Interruptor
        titol={t('set.mail_title')}
        actiu={canals?.email ?? null}
        estat={{
          on: t('set.mail_on'), onDesc: t('set.mail_on_desc'),
          off: t('set.mail_off'), offDesc: t('set.mail_off_desc'),
          iconaOn: Mail, iconaOff: MailX, toOff: 'aviso',
        }}
        onCanvia={(a) => void canviaCanal('email', a)}
        bloquejat={bloquejat}
        motiu={motiu}
        motiuActivar={motiuCanal}
        ajuda={<p>{t('set.mail_help')}</p>}
      />

      <Interruptor
        titol={t('set.wa_title')}
        actiu={canals?.whatsapp ?? null}
        estat={{
          on: t('set.wa_on'), onDesc: t('set.wa_on_desc'),
          off: t('set.wa_off'), offDesc: t('set.wa_off_desc'),
          iconaOn: MessageCircle, iconaOff: MessageCircleOff, toOff: 'aviso',
        }}
        onCanvia={(a) => void canviaCanal('whatsapp', a)}
        bloquejat={bloquejat}
        motiu={motiu}
        motiuActivar={motiuCanal}
        ajuda={<p>{t('set.wa_help')}</p>}
      />

      {/* 3.º DESTINATARIOS: solo usuarios de prueba o todos, para los dos canales. Es lo que
          permite probar las notificaciones antes de abrirlas a todo el mundo, y la garantía
          de que una importación masiva no recibe nada. Abrirlo a todos exige el general
          encendido; volver a «solo prueba» se puede siempre. */}
      <Interruptor
        titol={t('set.dest_title')}
        actiu={testMode}
        estat={{
          on: t('set.test_on'), onDesc: t('set.test_on_desc'),
          off: t('set.test_off'), offDesc: t('set.test_off_desc'),
          iconaOn: ShieldCheck, iconaOff: ShieldAlert, toOff: 'error',
        }}
        etiquetaOn={t('set.dest_only_test')}
        etiquetaOff={t('set.dest_all')}
        onCanvia={(a) => void canviaTestMode(a)}
        bloquejat={bloquejat}
        motiu={motiu}
        motiuDesactivar={motiuCanal}
        ajuda={<p>{t('set.test_help')}</p>}
      />

      {/* Las listas de prueba: la segunda barrera técnica del entorno de test. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('set.lists_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('set.lists_help')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Con WhatsApp apagado (§8) la lista de Meta no decide nada: se atenúa y se dice,
              en vez de esconderla —sigue siendo el estado que hay que dejar bien antes de
              volver a encender el canal—. Igual con la de correo. */}
          <div className={cn('space-y-2', canals?.whatsapp === false && 'opacity-60')}>
            {canals?.whatsapp === false && <p className="text-xs text-aviso">{t('dash.wa_off')}</p>}
            <GestorWhitelist
              titulo={t('dash.meta_title')} ayuda={t('dash.meta_help')}
              items={lista.map((r) => ({ clave: r.phone, etiqueta: r.etiqueta }))}
              placeholderClave={t('dash.ph_phone')} placeholderEtiqueta={t('dash.ph_label')} max={5}
              addLabel={t('c.add')} noneLabel={t('dash.none_yet')}
              deleteLabel={t('c.delete')} motiuBloqueig={motiuLlistes}
              onAdd={async (c, e) => {
                const err = await anadirNumeroTest(c, e)
                if (!err) setLista(await listarNumerosTest())
                return err ? t(err) : null
              }}
              onDelete={async (c) => {
                const err = await borrarNumeroTest(c)
                setLista(await listarNumerosTest())
                return err ? t(err) : null
              }}
            />
          </div>
          <div className={cn('space-y-2', canals?.email === false && 'opacity-60')}>
            {canals?.email === false && <p className="text-xs text-aviso">{t('set.mail_off_list')}</p>}
            <GestorWhitelist
              titulo={t('dash.email_title')} ayuda={t('dash.email_help')}
              items={listaEmail.map((r) => ({ clave: r.email, etiqueta: r.etiqueta }))}
              placeholderClave={t('dash.ph_email')} placeholderEtiqueta={t('dash.ph_label')} max={20}
              addLabel={t('c.add')} noneLabel={t('dash.none_yet')}
              deleteLabel={t('c.delete')} motiuBloqueig={motiuLlistes}
              onAdd={async (c, e) => {
                const err = await anadirEmailTest(c, e)
                if (!err) setListaEmail(await listarEmailsTest())
                return err ? t(err) : null
              }}
              onDelete={async (c) => {
                const err = await borrarEmailTest(c)
                setListaEmail(await listarEmailsTest())
                return err ? t(err) : null
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Cómo se decide a quién se envía (para que quede claro). */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('set.sending_title')}</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>{t('set.sending_1')}</p>
          <p>{t('set.sending_2')}</p>
          <p>{t('set.sending_3b')}</p>
          <p>{t('set.sending_4')}</p>
        </CardContent>
      </Card>

      {dialeg}
    </div>
  )
}
