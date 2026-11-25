// Enviar una DISPONIBILIDAD multiproducto a las entidades (plan DIC 26, fase 6a): UN mensaje por
// entidad con los productos que le encajan y un solo enlace al Mercat.
//
// El ranking es el de `priorizar-entidades { disponibilitat_id }`: una entidad entra si encaja en
// alguna oferta del grupo, y `ofertes_encaixen` dice en cuáles (se enseñan en su fila). El canal
// lo decide el servidor (§8bis) y los interruptores (§8) dejan gris lo que no puede salir.
//
// 🔴 El mensaje del grupo es TEXTO, así que WhatsApp solo sale con la ventana de 24 h abierta; si
//    `whatsapp-send` contesta `window_closed`, se manda por correo (`correuDisponibilitat`, con el
//    botón al Mercat). La plantilla de Meta `oferta_disponibilitat` (plantillas-meta.md §1bis) está
//    LISTA pero APAGADA (`PLANTILLA_DISPONIBILITAT_APROVADA = false`, checkpoint 2): con el flag
//    encendido, la ventana cerrada y opt-in, sale la plantilla antes que el correo. Con el flag
//    apagado no cambia nada.
//
// Queda constancia por oferta, como en el envío de una sola: una fila `pendent` de
// `oferta_respuestas` por cada oferta del mensaje. Por WhatsApp nace con `dialeg_pas = 'fet'`: el
// diálogo del bot (sí → kg → precio) es de UNA oferta y no se usa para grupos —se responde por el
// enlace—, así que esa fila no puede capturar lo que la entidad escriba después.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import { sendWhatsApp } from '../../lib/whatsapp'
import { enviarEmail } from '../../lib/email'
import { priorizarDisponibilitat, type EntidadPuntuada } from '../../lib/redestina'
import { registrarEnviamentManual } from '../../lib/canalitzacio'
import { textError } from '../../lib/textError'
import { algunCanal, motiuCanal, motiuTallServidor } from '../../lib/canals'
import { useCanals } from '../../hooks/useAppContext'
import {
  canalsGrup, componentsPlantillaGrup, esOberta, missatgeEntitat, plantillaDirectaGrup, potPlantillaGrup,
  type OfertaGrup,
} from '../../lib/disponibilitat'
import { PLANTILLA_DISPONIBILITAT, PLANTILLA_DISPONIBILITAT_APROVADA } from '../../lib/plantillas'
import { PAS_RANKING } from '../../lib/rankingEntitats'
import type { DadesDisponibilitat } from '../../hooks/useDisponibilitat'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import BotoCopiar from '../BotoCopiar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/** Color del canal recomendado (el mismo criterio que el ranking de una oferta). */
function canalClases(canal: string): string {
  if (canal === 'whatsapp') return 'text-exito'
  if (canal === 'email') return 'text-primary'
  return 'text-muted-foreground'
}

export default function EnviamentDisponibilitat({ grup, onEnviat }: {
  grup: DadesDisponibilitat
  /** Tras registrar un envío (para releer las respuestas de la oferta que se mira). */
  onEnviat?: () => void
}) {
  const { t } = useT()
  const canals = useCanals()
  const motiuEmail = motiuCanal(canals, 'email')
  const [ranking, setRanking] = useState<EntidadPuntuada[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [testMode, setTestMode] = useState(true)
  const [whatsappActiu, setWhatsappActiu] = useState(true)
  const [enviant, setEnviant] = useState<string | null>(null)
  const [mostrats, setMostrats] = useState(PAS_RANKING)
  const hiHaObertes = grup.ofertes.some((o) => esOberta(o.estado))

  useEffect(() => {
    let viu = true
    setCarregant(true)
    void priorizarDisponibilitat(grup.id).then((r) => {
      if (!viu) return
      setRanking(r.ranking)
      setTestMode(r.modoTest)
      setWhatsappActiu(r.whatsappActiu)
      setError(r.error)
      setCarregant(false)
    })
    return () => { viu = false }
  }, [grup.id])

  // Primero a quien SÍ se puede contactar; dentro, el orden del servidor.
  const ordenat = useMemo(() => {
    const contactable = (e: EntidadPuntuada) => (!testMode || e.es_test) && e.canal !== 'cap'
    return [...ranking].sort((a, b) => Number(contactable(b)) - Number(contactable(a)))
  }, [ranking, testMode])

  const encaixen = (ent: EntidadPuntuada) => (ent.ofertes_encaixen ?? []).map((o) => o.excedente_id)

  /** Una fila `pendent` por oferta del mensaje (ver la cabecera). */
  async function registra(ent: EntidadPuntuada, files: OfertaGrup[], canal: 'whatsapp' | 'email'): Promise<boolean> {
    const ara = new Date().toISOString()
    const { data, error: err } = await supabase.from('oferta_respuestas').upsert(files.map((f) => ({
      excedente_id: f.id,
      entidad_id: ent.id,
      telefono: ent.telefono,
      canal,
      estado: 'pendent',
      enviado_at: ara,
      respondido_at: null,
      mensaje_respuesta: null,
      dialeg_pas: canal === 'whatsapp' ? 'fet' : null,
      dialeg_dades: { disponibilitat_id: grup.id },
      kg_solicitados: null,
      caixes_solicitades: null,
      preu_ofert: null,
    })), { onConflict: 'excedente_id,entidad_id' }).select('id')
    onEnviat?.()
    if (err || !data || data.length === 0) {
      toast.warning(t('od.sent_not_logged', { name: ent.nombre }))
      return false
    }
    return true
  }

  async function envia(ent: EntidadPuntuada) {
    const m = missatgeEntitat(grup.ofertes, encaixen(ent), grup.ctx)
    if (!m) { toast.error(t('mp.res_per_enviar')); return }
    if (testMode && !ent.es_test) { toast.error(t('od.not_test_toast', { name: ent.nombre })); return }
    const pla = canalsGrup(ent, { email: canals.email, whatsapp: canals.whatsapp && whatsappActiu })
    if (!pla.primer) { toast.error(t('od.no_channel', { name: ent.nombre })); return }

    if (pla.primer === 'whatsapp' && ent.telefono) {
      const telefon = ent.telefono
      // La plantilla (fuera de la ventana): solo con el flag encendido y opt-in; si no, no se
      // llama nunca y todo sigue como siempre.
      const perPlantilla = () => sendWhatsApp({
        to: telefon, type: 'template', template: PLANTILLA_DISPONIBILITAT.name,
        language: PLANTILLA_DISPONIBILITAT.language, components: componentsPlantillaGrup(m.files, grup.ctx),
      })
      let ambPlantilla = plantillaDirectaGrup(ent, PLANTILLA_DISPONIBILITAT_APROVADA)
      let r = ambPlantilla ? await perPlantilla() : await sendWhatsApp({ to: telefon, type: 'text', body: m.text })
      let code = (r.data as { code?: string } | null)?.code
      if (!r.ok && !ambPlantilla && code === 'window_closed' && potPlantillaGrup(ent, PLANTILLA_DISPONIBILITAT_APROVADA)) {
        ambPlantilla = true
        r = await perPlantilla()
        code = (r.data as { code?: string } | null)?.code
      }
      if (r.ok) {
        // Igual que el texto: una fila por oferta, `dialeg_pas = 'fet'` (se responde por el enlace).
        if (await registra(ent, m.files, 'whatsapp')) {
          if (r.simulat) toast.info(t('od.wa_simulat'))
          else toast.success(ambPlantilla ? t('mp.enviat_plantilla', { name: ent.nombre }) : t('mp.enviat_wa', { name: ent.nombre }))
        }
        return
      }
      // Sin ventana (o la plantilla sin opt-in): al correo si lo hay.
      const tancada = code === 'window_closed' || (ambPlantilla && code === 'no_opt_in')
      if (tancada && pla.alternativa) {
        toast.info(t('mp.finestra_tancada', { name: ent.nombre }))
      } else {
        const tall = motiuTallServidor(code)
        if (tall) toast.error(t(tall))
        else if (code === 'window_closed') toast.error(t('mp.finestra_sense_correu', { name: ent.nombre }))
        else if (code === 'no_opt_in') toast.error(t('od.no_optin_toast', { name: ent.nombre }))
        else if (code === 'opt_out') toast.error(t('od.optout_toast', { name: ent.nombre }))
        else if (code === 'no_test_user') toast.error(t('od.not_test_toast', { name: ent.nombre }))
        else if (code === 'no_test_recipient') toast.error(t('od.no_test_meta', { name: ent.nombre }))
        else if (code === 'unknown_contact') toast.error(t('od.must_write', { name: ent.nombre }))
        else toast.error(t('od.no_send_wa'))
        return
      }
    }

    if (!ent.email) { toast.error(t('od.no_email_toast', { name: ent.nombre })); return }
    const c = m.correu
    const r = await enviarEmail({
      to: ent.email, subject: c.assumpte, text: c.cos,
      // El texto del grupo va en catalán (como el de la oferta): el pie, también.
      plantilla: { idioma: 'ca', titulo: c.titol, preheader: c.preheader, boton: c.boto },
    })
    if (r.ok) {
      if (await registra(ent, m.files, 'email')) {
        if (r.simulat) toast.info(t('doc.resend_simulat'))
        else toast.success(t('mp.enviat_correu', { name: ent.nombre }))
      }
      return
    }
    const code = (r.data as { code?: string } | null)?.code
    const tall = motiuTallServidor(code)
    if (tall) toast.error(t(tall))
    else if (code === 'no_test_user') toast.error(t('od.not_test_toast', { name: ent.nombre }))
    else if (code === 'no_test_recipient') toast.error(t('od.email_no_test', { email: ent.email }))
    else toast.error(t('od.no_send_email'))
  }

  /** «Copia i marca com a enviada»: el texto se pega a mano y cada oferta consta como ofrecida. */
  async function marcaAMa(ent: EntidadPuntuada, files: OfertaGrup[]) {
    const rs = await Promise.all(files.map((f) => registrarEnviamentManual(f.id, ent.id)))
    onEnviat?.()
    const ko = rs.find((r) => !r.ok)
    if (ko) { toast.error(textError(t, ko)); return }
    toast.success(t('manual.ok_nom', { name: ent.nombre }))
  }

  async function ambBloqueig(id: string, fn: () => Promise<unknown>) {
    if (enviant === id) return
    setEnviant(id)
    try { await fn() } finally { setEnviant(null) }
  }

  return (
    <details data-testid="enviament-disponibilitat" className="rounded-lg border p-3">
      <summary className="cursor-pointer font-titulos text-sm font-semibold">{t('mp.envia_titol')}</summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">{t('mp.envia_hint')}</p>
        {carregant && <p className="text-sm text-muted-foreground">{t('od.calculating')}</p>}
        {error && <p className="text-sm text-destructive">{t('od.rank_error')}</p>}
        {!carregant && !error && !hiHaObertes && <p className="text-sm text-muted-foreground">{t('od.send_closed')}</p>}
        {!carregant && !error && ordenat.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('mp.cap_entitat')}</p>
        )}
        {!carregant && !error && ordenat.slice(0, mostrats).map((ent) => {
          const m = missatgeEntitat(grup.ofertes, encaixen(ent), grup.ctx)
          const potTest = !testMode || ent.es_test
          const gris = enviant === ent.id || !m
          return (
            <div key={ent.id} data-testid="disp-ranking-fila"
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5 ${ent.pendiente ? 'bg-aviso-fondo opacity-80' : ''}`}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-6 shrink-0 text-center text-lg font-bold text-primary">{ent.puntuacion}</span>
                <div className="min-w-0">
                  <div className="font-medium break-words">{ent.nombre}{ent.poblacion ? ` · ${ent.poblacion}` : ''}</div>
                  {/* En qué productos del grupo encaja (`ofertes_encaixen`). */}
                  <div className="mt-1 flex flex-wrap gap-1" data-testid="disp-encaixen">
                    {(ent.ofertes_encaixen ?? []).map((o) => (
                      <Badge key={o.excedente_id} variant="outline" className="max-w-full whitespace-normal">
                        {o.producto ?? '—'}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-1 text-xs">
                    <span className={`font-medium ${canalClases(ent.canal)}`}>{t(`od.canal_${ent.canal}`)}</span>
                    <span className="text-muted-foreground"> · {t(`od.canal_why_${ent.motiu_canal}`)}</span>
                  </div>
                  {!potTest && <div className="text-xs text-muted-foreground">{t('od.not_test')}</div>}
                  {ent.sense_conveni && <div className="mt-1 text-xs text-aviso">{t('od.sense_conveni')}</div>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <BotoAmbMotiu size="sm" disabled={gris || !algunCanal(canals) || (ent.canal === 'email' && !!motiuEmail)}
                  motiu={!m ? t('od.send_closed') : !algunCanal(canals) ? t('canal.motiu_notificacions')
                    : ent.canal === 'email' && motiuEmail ? t(motiuEmail) : undefined}
                  data-testid="disp-envia"
                  onClick={() => void ambBloqueig(ent.id, () => envia(ent))}>
                  {enviant === ent.id ? t('od.sending') : t('od.send')}
                </BotoAmbMotiu>
                <BotoCopiar text={m?.text ?? ''} etiqueta={t('manual.copy_mark')} className="whitespace-normal"
                  disabled={gris}
                  onCopiat={() => { if (m) void ambBloqueig(ent.id, () => marcaAMa(ent, m.files)) }} />
              </div>
            </div>
          )
        })}
        {!carregant && !error && ordenat.length > mostrats && (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setMostrats((n) => n + PAS_RANKING)}>
            {t('od.more', { n: Math.min(PAS_RANKING, ordenat.length - mostrats), total: ordenat.length })}
          </Button>
        )}
      </div>
    </details>
  )
}
