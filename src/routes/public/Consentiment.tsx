// `/consentiment/:token` — la página pública donde la persona da (o no) su consentimiento RGPD.
//
// Llega aquí desde el correo que le manda el equipo desde la ficha de su organización
// (Gestió interna › Consentiments, `demanar_consentiment`, 04-11-2026). No tiene cuenta y no
// la necesita: el único permiso es el token.
//
// 🔴 HASTA QUE NO RESPONDE AQUÍ NO CONSTA NINGÚN CONSENTIMIENTO. La privacidad es obligatoria
//    para responder; las dos comunicaciones salen desmarcadas y las marca ella si quiere.
// ⚠️ Los textos son los que manda el servidor en el GET, que es quien los hashea al guardar:
//    se pintan tal cual, en el idioma de la pantalla.

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import {
  carregaConsentiment, enviaConsentiment, type DadesConsentiment, type TipusRgpd,
} from '../../lib/enllacPublic'
import LayoutAcces from '../../components/LayoutAcces'
import { FilaCasella } from '../../components/Casella'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const BUIT: Record<TipusRgpd, boolean> = {
  privacitat: false, comunicacions_plataforma: false, comunicacions_espigoladors: false,
}

export default function Consentiment() {
  const { token = '' } = useParams<{ token: string }>()
  const { t, lang } = useT()
  const [dades, setDades] = useState<DadesConsentiment | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [marques, setMarques] = useState(BUIT)
  const [web, setWeb] = useState('')
  const [enviant, setEnviant] = useState(false)
  const [fet, setFet] = useState(false)

  useEffect(() => {
    let viu = true
    void carregaConsentiment(token).then((r) => {
      if (!viu) return
      if (r.ok) setDades(r.data)
      else setErrorKey(r.motiuKey)
      setCarregant(false)
    })
    return () => { viu = false }
  }, [token])

  async function desa() {
    if (!marques.privacitat) { setErrorKey('rgpd.err_privacitat'); return }
    setEnviant(true)
    const r = await enviaConsentiment(token, { ...marques, idioma: lang, web })
    setEnviant(false)
    if (!r.ok) { setErrorKey(r.motiuKey); return }
    setFet(true)
  }

  const textos = dades?.textos[lang] ?? dades?.textos.ca

  return (
    <LayoutAcces ample>
      <Card>
        <CardContent className="space-y-4 pt-6" data-testid="consentiment-public">
          {carregant ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />{t('c.loading')}
            </div>
          ) : fet ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">{t('cons.ok_titol')}</h2>
              <p className="text-sm">{t('cons.ok_text')}</p>
            </div>
          ) : !dades || !textos ? (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">{t('cons.problema')}</h2>
              <p className="text-sm">{t(errorKey ?? 'conf.err_generic')}</p>
              <p className="text-sm text-muted-foreground">{t('cons.problema_ajuda')}</p>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">{t('rgpd.title')}</h2>
                <p className="text-sm text-muted-foreground">
                  {t('cons.intro', { entitat: dades.entitat ?? '—' })}
                </p>
              </div>
              <div className="space-y-3">
                <FilaCasella checked={marques.privacitat}
                  onChange={(v) => { setMarques((m) => ({ ...m, privacitat: v })); setErrorKey(null) }}>
                  {textos.privacitat}{' '}
                  <Link to="/privacitat" target="_blank" className="underline">{t('rgpd.llegeix')}</Link>
                </FilaCasella>
                <FilaCasella checked={marques.comunicacions_plataforma}
                  onChange={(v) => setMarques((m) => ({ ...m, comunicacions_plataforma: v }))}>
                  {textos.comunicacions_plataforma}
                </FilaCasella>
                <FilaCasella checked={marques.comunicacions_espigoladors}
                  onChange={(v) => setMarques((m) => ({ ...m, comunicacions_espigoladors: v }))}>
                  {textos.comunicacions_espigoladors}
                </FilaCasella>
                <p className="text-xs text-muted-foreground">{t('rgpd.no_operatives')}</p>
              </div>
              {/* Honeypot: una persona no lo ve ni lo rellena. */}
              <input type="text" name="web" value={web} onChange={(e) => setWeb(e.target.value)}
                tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
              {errorKey && <p className="text-sm text-destructive" role="alert">{t(errorKey)}</p>}
              <Button className="h-11 w-full whitespace-normal" disabled={enviant} onClick={() => void desa()}>
                {enviant && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />}
                {t('cons.desa')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}
