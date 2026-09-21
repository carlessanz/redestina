import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, Loader2, MessageCircle, MessageCircleOff } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { useConfirma } from './DialegConfirma'
import type { Lang } from '../lib/i18n'
import {
  fitxesSenseCorreuAmbTelefon, getTestMode, getWhatsappActiu, setTestMode, setWhatsappActiu,
} from '../lib/settings'
import { useAppContext } from '../hooks/useAppContext'
import {
  anadirNumeroTest, borrarNumeroTest, listarNumerosTest, type MetaTestRecipient,
} from '../lib/metaTest'
import {
  anadirEmailTest, borrarEmailTest, listarEmailsTest, type EmailTestRecipient,
} from '../lib/emailTest'
import GestorWhitelist from './GestorWhitelist'
import DadesFundacio from './equip/DadesFundacio'
import EditorDiagnostic from './equip/EditorDiagnostic'
import { cn } from '../lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function Settings() {
  const { t, lang, setLang } = useT()
  const { confirma, dialeg } = useConfirma()
  const { recarrega } = useAppContext()
  const [testMode, setTest] = useState<boolean | null>(null)
  const [waActiu, setWaActiu] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  // Las dos whitelists del entorno de pruebas (§4, §8). Vivían en el Tauler y ocupaban
  // media pantalla de la landing del equipo: no son trabajo del día, son el ajuste que
  // acompaña al modo de pruebas de aquí arriba.
  const [lista, setLista] = useState<MetaTestRecipient[]>([])
  const [listaEmail, setListaEmail] = useState<EmailTestRecipient[]>([])

  useEffect(() => {
    void getTestMode().then(setTest)
    void getWhatsappActiu().then(setWaActiu)
    void listarNumerosTest().then(setLista)
    void listarEmailsTest().then(setListaEmail)
  }, [])

  async function cambiarTestMode(activo: boolean) {
    if (activo === testMode || saving) return
    // Apagarlo es sensible: pasa a enviarse a TODOS. Confirmación explícita.
    if (!activo && !(await confirma({
      titol: t('set.confirm_off_t'),
      descripcio: t('set.confirm_off'),
      confirmar: t('set.turn_off'),
      destructiu: true,
    }))) return
    setSaving(true)
    const error = await setTestMode(activo)
    setSaving(false)
    if (error) { toast.error(error); return }
    setTest(activo)
    toast.success(activo ? t('set.saved_on') : t('set.saved_off'))
  }

  /**
   * Apagar WhatsApp es la decisión más grande de esta pantalla, así que antes de pedir
   * confirmación se cuenta lo que cuesta: las fichas con teléfono y sin correo quedan
   * incontactables. Que ese número salga DESPUÉS de pulsar no serviría de nada.
   */
  async function cambiarWhatsapp(activo: boolean) {
    if (activo === waActiu || saving) return
    if (!activo) {
      setSaving(true)
      const n = await fitxesSenseCorreuAmbTelefon()
      setSaving(false)
      if (!(await confirma({
        titol: t('set.wa_confirm_off_t'),
        descripcio: t('set.wa_confirm_off', { productors: n.productors, entitats: n.entitats }),
        confirmar: t('set.turn_off'),
        destructiu: true,
      }))) return
    }
    setSaving(true)
    const error = await setWhatsappActiu(activo)
    setSaving(false)
    if (error) { toast.error(error); return }
    setWaActiu(activo)
    // El interruptor viaja en el contexto de sesión: sin recargarlo, el resto de la
    // aplicación (botones, banners) seguiría pintando el estado anterior.
    await recarrega()
    toast.success(activo ? t('set.wa_saved_on') : t('set.wa_saved_off'))
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t('set.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('set.subtitle')}</p>
      </div>

      {/* Modo test: la garantía de no enviar a usuarios que no sean de prueba. */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('set.test_mode')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {testMode === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t('c.loading')}
            </p>
          ) : (
            <>
              <div className={cn('flex items-start gap-3 rounded-lg border p-3',
                testMode ? 'border-exito/30 bg-exito-fondo' : 'border-error/30 bg-error-fondo')}>
                {testMode
                  ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-exito" />
                  : <ShieldAlert className="mt-0.5 size-5 shrink-0 text-error" />}
                <div className="text-sm">
                  <div className={cn('font-semibold', testMode ? 'text-exito' : 'text-error')}>
                    {testMode ? t('set.test_on') : t('set.test_off')}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {testMode ? t('set.test_on_desc') : t('set.test_off_desc')}
                  </p>
                </div>
              </div>

              <div className="inline-flex rounded-md border p-0.5">
                <button type="button" disabled={saving} onClick={() => void cambiarTestMode(true)}
                  className={cn('rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
                    testMode ? 'bg-exito text-white' : 'text-muted-foreground hover:bg-muted')}>
                  {t('set.on')}
                </button>
                <button type="button" disabled={saving} onClick={() => void cambiarTestMode(false)}
                  className={cn('rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
                    !testMode ? 'bg-error text-white' : 'text-muted-foreground hover:bg-muted')}>
                  {t('set.off')}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">{t('set.test_help')}</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* WhatsApp: el canal entero, encendido o apagado. */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('set.wa_title')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {waActiu === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t('c.loading')}
            </p>
          ) : (
            <>
              <div className={cn('flex items-start gap-3 rounded-lg border p-3',
                waActiu ? 'border-exito/30 bg-exito-fondo' : 'border-aviso/30 bg-aviso-fondo')}>
                {waActiu
                  ? <MessageCircle className="mt-0.5 size-5 shrink-0 text-exito" />
                  : <MessageCircleOff className="mt-0.5 size-5 shrink-0 text-aviso" />}
                <div className="text-sm">
                  <div className={cn('font-semibold', waActiu ? 'text-exito' : 'text-aviso')}>
                    {waActiu ? t('set.wa_on') : t('set.wa_off')}
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {waActiu ? t('set.wa_on_desc') : t('set.wa_off_desc')}
                  </p>
                </div>
              </div>

              <div className="inline-flex rounded-md border p-0.5">
                <button type="button" disabled={saving} onClick={() => void cambiarWhatsapp(true)}
                  className={cn('rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
                    waActiu ? 'bg-exito text-white' : 'text-muted-foreground hover:bg-muted')}>
                  {t('set.on')}
                </button>
                <button type="button" disabled={saving} onClick={() => void cambiarWhatsapp(false)}
                  className={cn('rounded px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-60',
                    !waActiu ? 'bg-aviso text-white' : 'text-muted-foreground hover:bg-muted')}>
                  {t('set.off')}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">{t('set.wa_help')}</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Los datos de la Fundación: lo que encabeza todos los documentos y lo que
          desbloquea la emisión con efecto fiscal. Va antes que las listas de prueba
          porque pesa más: sin esta fila rellenada no se puede certificar nada. */}
      <DadesFundacio />

      {/* El cuestionario, las medidas y las reglas del diagnóstico (F2). Va aquí y no en
          una pantalla propia por lo mismo que los datos de la Fundación: es configuración
          del servicio, no trabajo del día a día. */}
      <EditorDiagnostic />

      {/* Las listas de prueba: la segunda barrera técnica del entorno de test. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('set.lists_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('set.lists_help')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Con WhatsApp apagado (§8) la lista de Meta no decide nada: se atenúa y se dice,
              en vez de esconderla —sigue siendo el estado que hay que dejar bien antes de
              volver a encender el canal—. */}
          <div className={cn('space-y-2', waActiu === false && 'opacity-60')}>
            {waActiu === false && <p className="text-xs text-aviso">{t('dash.wa_off')}</p>}
            <GestorWhitelist
              titulo={t('dash.meta_title')} ayuda={t('dash.meta_help')}
              items={lista.map((r) => ({ clave: r.phone, etiqueta: r.etiqueta }))}
              placeholderClave={t('dash.ph_phone')} placeholderEtiqueta={t('dash.ph_label')} max={5}
              addLabel={t('c.add')} noneLabel={t('dash.none_yet')}
              onAdd={async (c, e) => {
                const err = await anadirNumeroTest(c, e)
                if (!err) setLista(await listarNumerosTest())
                return err
              }}
              onDelete={async (c) => { await borrarNumeroTest(c); setLista(await listarNumerosTest()) }}
            />
          </div>
          <GestorWhitelist
            titulo={t('dash.email_title')} ayuda={t('dash.email_help')}
            items={listaEmail.map((r) => ({ clave: r.email, etiqueta: r.etiqueta }))}
            placeholderClave={t('dash.ph_email')} placeholderEtiqueta={t('dash.ph_label')} max={20}
            addLabel={t('c.add')} noneLabel={t('dash.none_yet')}
            onAdd={async (c, e) => {
              const err = await anadirEmailTest(c, e)
              if (!err) setListaEmail(await listarEmailsTest())
              return err
            }}
            onDelete={async (c) => { await borrarEmailTest(c); setListaEmail(await listarEmailsTest()) }}
          />
        </CardContent>
      </Card>

      {/* Idioma */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('set.language')}</CardTitle></CardHeader>
        <CardContent>
          <div className="inline-flex rounded-md border p-0.5">
            {(['ca', 'es'] as Lang[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)}
                className={cn('rounded px-4 py-1.5 text-sm font-semibold transition-colors',
                  lang === l ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-muted')}>
                {l === 'ca' ? 'Català' : 'Castellano'}
              </button>
            ))}
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
        </CardContent>
      </Card>

      {dialeg}
    </div>
  )
}
