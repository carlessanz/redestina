// Configuració › General › «Pantalla de protecció prèvia a la home» (09-11-2026): la cortina de
// contraseña que hay delante de toda la web. Solo el super_admin la ve: encenderla, apagarla y
// cambiarle la contraseña, que aquí se VE en claro (a petición del cliente).
//
// Nace APAGADA. Si la contraseña vigente es la de antes de esta pantalla (la huella del repo),
// no se puede mostrar: se dice y se invita a poner una nueva.
//
// Los cambios tardan hasta 30 s en notarse (caché del middleware, `lib/cortina.ts`).

import { useCallback, useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import {
  MAX_CONTRASENYA, MIN_CONTRASENYA, SEGONS_PROPAGACIO, canviaContrasenyaCortina, claveContrasenyaInvalida,
  fixaCortinaActiva, llegeixCortina,
} from '../../lib/cortina'
import type { ConfigCortina } from '../../lib/cortina'
import { dataHora } from '../../lib/format'
import { useConfirma } from '../DialegConfirma'
import Interruptor from './Interruptor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function SeccioCortina() {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const [cfg, setCfg] = useState<ConfigCortina | null>(null)
  const [errorLectura, setErrorLectura] = useState(false)
  const [ocupat, setOcupat] = useState(false)
  const [visible, setVisible] = useState(false)
  const [nova, setNova] = useState('')

  const carrega = useCallback(async () => {
    const c = await llegeixCortina()
    setErrorLectura(c === null)
    setCfg(c)
  }, [])
  useEffect(() => { void carrega() }, [carrega])

  const params = { min: MIN_CONTRASENYA, max: MAX_CONTRASENYA }

  async function canviaActiva(activa: boolean) {
    if (!cfg || activa === cfg.activa || ocupat) return
    if (!activa) {
      const ok = await confirma({
        titol: t('cor.c_off_t'), descripcio: t('cor.c_off_d'), confirmar: t('cor.c_off_go'), destructiu: true,
      })
      if (!ok) return
    }
    setOcupat(true)
    const r = await fixaCortinaActiva(activa)
    setOcupat(false)
    if ('error' in r) { toast.error(t(r.error)); return }
    setCfg(r.config)
    toast.success(activa ? t('cor.desa_on') : t('cor.desa_off'))
  }

  async function canviaContrasenya() {
    if (ocupat) return
    const ok = await confirma({ titol: t('cor.c_pw_t'), descripcio: t('cor.c_pw_d'), confirmar: t('cor.c_pw_go') })
    if (!ok) return
    setOcupat(true)
    const err = await canviaContrasenyaCortina(nova)
    setOcupat(false)
    if (err) { toast.error(t(err, params)); return }
    setNova('')
    setVisible(true)
    toast.success(t('cor.canviada'))
    await carrega()
  }

  async function copia() {
    if (!cfg?.contrasenya) return
    try {
      await navigator.clipboard.writeText(cfg.contrasenya)
      toast.success(t('cor.copiada'))
    } catch {
      toast.error(t('c.error'))
    }
  }

  const clauNova = nova ? claveContrasenyaInvalida(nova) : null

  return (
    <div data-testid="cortina">
      <Interruptor
        titol={t('cor.titol')}
        actiu={errorLectura ? false : cfg ? cfg.activa : null}
        estat={{
          on: t('cor.on'), onDesc: t('cor.on_desc'), off: t('cor.off'), offDesc: t('cor.off_desc'),
          iconaOn: Lock, iconaOff: LockOpen, toOff: 'aviso',
        }}
        onCanvia={(a) => void canviaActiva(a)}
        bloquejat={ocupat || !cfg}
        ajuda={<p>{t('cor.ajuda', { s: SEGONS_PROPAGACIO })}</p>}
      >
        {errorLectura && <p className="text-sm text-error" role="alert">{t('c.error')}</p>}
        {cfg && (
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-1.5">
              <div className="text-sm font-semibold">{t('cor.password')}</div>
              {cfg.propia && cfg.contrasenya ? (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 break-all rounded-md border bg-muted px-2.5 py-1 text-sm" data-testid="cortina-pw">
                    {visible ? cfg.contrasenya : '•'.repeat(Math.min(cfg.contrasenya.length, 16))}
                  </code>
                  <Button type="button" variant="outline" size="sm" className="h-10 md:h-8" onClick={() => setVisible((v) => !v)}
                    data-testid="cortina-mostra" aria-pressed={visible}>
                    {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    {visible ? t('cor.amaga') : t('cor.mostra')}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-10 md:h-8" onClick={() => void copia()} data-testid="cortina-copia">
                    <Copy className="size-4" aria-hidden /> {t('cor.copia')}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="cortina-sense-propia">{t('cor.sense_propia')}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cortina-nova" className="text-sm font-semibold">{t('cor.nova')}</label>
              <div className="flex flex-wrap items-start gap-2">
                <Input id="cortina-nova" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="off"
                  spellCheck={false} maxLength={MAX_CONTRASENYA + 20} className="max-w-xs" aria-invalid={!!clauNova}
                  data-testid="cortina-nova" />
                <Button type="button" className="h-10 md:h-8" disabled={ocupat || !nova || !!clauNova}
                  onClick={() => void canviaContrasenya()} data-testid="cortina-canvia">
                  {ocupat ? t('c.saving') : t('cor.canvia')}
                </Button>
              </div>
              <p className={clauNova ? 'text-xs text-error' : 'text-xs text-muted-foreground'} role={clauNova ? 'alert' : undefined}>
                {clauNova ? t(clauNova, params) : t('cor.nova_ajuda', params)}
              </p>
            </div>

            {cfg.updated_by && cfg.updated_at && (
              <p className="text-xs text-muted-foreground" data-testid="cortina-ultim">
                {t('cor.ultim', { quan: dataHora(cfg.updated_at), qui: cfg.updated_by })}
              </p>
            )}
          </div>
        )}
      </Interruptor>
      {dialeg}
    </div>
  )
}
