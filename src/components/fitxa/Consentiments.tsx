// Los consentimientos RGPD de una organización (`consentiments`), en el bloque de gestión
// interna de la ficha del equipo (1C; cierra la parte «pantalla» de la deuda §12.142).
// Una fila por consentimiento registrado, la más reciente arriba. La RLS deja leer al equipo
// y a cada cuenta lo suyo.
//
// 🔴 EL EQUIPO NO LO MARCA (04-11-2026, 20270506100000): lo PIDE. «Demana el consentiment»
//    manda un enlace por correo a la ficha; la persona responde en `/consentiment/:token` y
//    hasta entonces no consta nada. Debajo se ve el estado de la última petición (enviada,
//    abierta, respondida, caducada).
//    Con las notificaciones apagadas (§8) es un envío MANUAL: el botón sigue funcionando y
//    pide la confirmación (`acceptaEnviament`); al lado sale «Copia l’enllaç», que crea el
//    mismo enlace y da el texto para mandarlo desde un correo propio (`EnllacPerCopiar`).

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { copiarAlPortapapeles } from '../../lib/copiar'
import { crearEnllacConsentiment, demanarConsentiment, textCopiaConsentiment } from '../../lib/consentiments'
import { acceptaEnviament } from '../../lib/enviamentManual'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import { useConfirma } from '../DialegConfirma'
import EnllacPerCopiar from './EnllacPerCopiar'
import { Badge } from '@/components/ui/badge'

interface Fila {
  id: string
  tipus: 'privacitat' | 'comunicacions_plataforma' | 'comunicacions_espigoladors'
  valor: boolean
  versio_text: string
  idioma: string
  origen: 'registre' | 'alta_assistida' | 'enllac'
  email: string | null
  created_at: string
}

interface Peticio {
  destinatario_email: string | null
  estado: string
  created_at: string
  abierto_at: string | null
  usado_at: string | null
  caduca_at: string
}

export default function Consentiments({ organitzacioId, correu, motiuCorreu }: {
  organitzacioId: string
  /** El correo de la ficha (el del formulario): ahí va la petición. */
  correu?: string
  /** Clave i18n del motivo por el que el correo no puede salir (interruptores, §8). */
  motiuCorreu?: string | null
}) {
  const { t, lang } = useT()
  const [files, setFiles] = useState<Fila[]>([])
  const [peticio, setPeticio] = useState<Peticio | null>(null)
  const [carregat, setCarregat] = useState(false)
  const [enviant, setEnviant] = useState(false)
  const [copia, setCopia] = useState<{ text: string; correu: string } | null>(null)
  const { confirma, dialeg } = useConfirma()

  const carrega = useCallback(async () => {
    const [cons, enll] = await Promise.all([
      supabase.from('consentiments')
        .select('id, tipus, valor, versio_text, idioma, origen, email, created_at')
        .eq('organizacion_id', organitzacioId)
        .order('created_at', { ascending: false }),
      supabase.from('enlaces_token')
        .select('destinatario_email, estado, created_at, abierto_at, usado_at, caduca_at')
        .eq('objeto_tipo', 'organizacion').eq('objeto_id', organitzacioId)
        .eq('proposito', 'consentiment_rgpd')
        .order('created_at', { ascending: false }).limit(1),
    ])
    setFiles((cons.data ?? []) as Fila[])
    setPeticio(((enll.data ?? []) as Peticio[])[0] ?? null)
    setCarregat(true)
  }, [organitzacioId])

  useEffect(() => { void carrega() }, [carrega])

  const data = (s: string) => new Date(s).toLocaleDateString(lang === 'es' ? 'es-ES' : 'ca-ES')

  async function demana() {
    const desti = (correu ?? '').trim()
    if (!desti) return
    const acceptat = await acceptaEnviament(confirma, t, motiuCorreu, motiuCorreu
      ? { titol: t('cons.b_demana'), descripcio: t('cons.confirm_manual', { correu: desti }), confirmar: t('man.envia') }
      : undefined)
    if (!acceptat) return
    setEnviant(true)
    const r = await demanarConsentiment(organitzacioId, desti, {
      assumpte: t('cons.mail_assumpte'),
      titol: t('cons.mail_titol'),
      preheader: t('cons.mail_preheader'),
      cos: t('cons.mail_cos'),
      boto: t('cons.mail_boto'),
      nota: t('cons.mail_nota'),
    }, lang, acceptat.manual)
    setEnviant(false)
    if (!r.ok) {
      toast.error(r.fase === 'enllac'
        ? t(r.codi === 'sense_correu' ? 'cons.err_sense_correu' : 'cons.err_enllac')
        : t('cons.err_correu', { motiu: r.missatge ?? r.codi ?? '—' }))
    } else {
      toast.success(t(r.simulat ? 'cons.ok_simulat' : 'cons.ok_enviat', { correu: desti }))
    }
    await carrega()
  }

  // Correo apagado: el mismo enlace, para pegarlo en un correo propio.
  async function creaPerCopiar() {
    const desti = (correu ?? '').trim()
    if (!desti) return
    setEnviant(true)
    const r = await crearEnllacConsentiment(organitzacioId, desti)
    setEnviant(false)
    if (!r.ok) {
      toast.error(t(r.codi === 'sense_correu' ? 'cons.err_sense_correu' : 'cons.err_enllac'))
      return
    }
    const text = textCopiaConsentiment({ cos: t('cons.copia_cos'), boto: t('cons.mail_boto'), nota: t('cons.mail_nota') }, r.enllac.token)
    setCopia({ text, correu: r.enllac.destinatari })
    toast.success(t(await copiarAlPortapapeles(text) ? 'epc.ok_copiat' : 'epc.ok_creat'))
    await carrega()
  }

  if (!carregat) return null

  // El estado de la última petición, en una frase.
  let estatPeticio: string | null = null
  if (peticio) {
    const caducada = peticio.estado === 'activo' && new Date(peticio.caduca_at) < new Date()
    estatPeticio = peticio.usado_at
      ? t('cons.pet_resposta', { data: data(peticio.usado_at) })
      : peticio.estado === 'revocado'
        ? null
        : caducada
          ? t('cons.pet_caducada', { data: data(peticio.caduca_at) })
          : peticio.abierto_at
            ? t('cons.pet_oberta', { data: data(peticio.created_at), correu: peticio.destinatario_email ?? '—' })
            : t('cons.pet_enviada', { data: data(peticio.created_at), correu: peticio.destinatario_email ?? '—' })
  }
  const senseCorreu = !(correu ?? '').trim()
  const motiu = senseCorreu ? t('cons.need_correu') : undefined
  const pendent = !!peticio && !peticio.usado_at && peticio.estado === 'activo'

  return (
    <div className="space-y-2" data-testid="consentiments">
      <h4 className="text-sm font-semibold">{t('ef.consentiments')}</h4>
      <p className="text-sm text-muted-foreground">{t('cons.h_fitxa')}</p>
      {files.length === 0
        ? <p className="text-sm text-muted-foreground">{t('ef.cons_cap')}</p>
        : (
          <ul className="space-y-1 text-sm">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                <span>{t(`ef.cons_${f.tipus}`)}</span>
                <Badge className={f.valor ? 'bg-exito-fondo text-exito' : 'bg-muted text-muted-foreground'}>
                  {t(f.valor ? 'ef.cons_acceptat' : 'ef.cons_rebutjat')}
                </Badge>
                <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {data(f.created_at)} · {t(`ef.cons_origen_${f.origen}`)}{f.email ? ` · ${f.email}` : ''} · v{f.versio_text} · {f.idioma}
                </span>
              </li>
            ))}
          </ul>
        )}
      {estatPeticio && (
        <p className="text-sm [overflow-wrap:anywhere]" data-testid="consentiment-peticio">{estatPeticio}</p>
      )}
      {copia && <EnllacPerCopiar text={copia.text} correu={copia.correu} testid="consentiment-copia" />}
      {motiuCorreu && <p className="text-xs text-muted-foreground">{t(motiuCorreu)} {t('man.alternativa')}</p>}
      <div className="flex flex-wrap gap-2">
        <BotoAmbMotiu size="sm" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
          disabled={enviant || !!motiu} motiu={motiu} onClick={() => void demana()}>
          {t(pendent ? 'cons.b_reenvia' : 'cons.b_demana')}
        </BotoAmbMotiu>
        {motiuCorreu && (
          <BotoAmbMotiu size="sm" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
            disabled={enviant || !!motiu} motiu={motiu} onClick={() => void creaPerCopiar()}>
            {t(pendent ? 'cons.b_copia_nou' : 'cons.b_copia')}
          </BotoAmbMotiu>
        )}
      </div>
      {dialeg}
    </div>
  )
}
