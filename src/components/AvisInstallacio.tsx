// Aviso de «instal·la Redestina al mòbil», para productores y receptores.
//
// Es un banner descartable, no un diálogo modal: interrumpir a alguien a media tarea
// para pedirle que instale una aplicación es justo lo que hace que se descarte sin
// leerlo. Aquí espera abajo, donde no tapa nada.
//
// ⚠️ NO es `fixed`. Se monta como hermana flex `shrink-0` del contenido, igual que
// BottomNav y por la misma razón (contrato de alturas, AGENTS.md §2): así resta alto al
// `main` en vez de superponerse, y ninguna de las siete pantallas necesita padding
// nuevo. Un banner flotante habría obligado a repasarlas todas.
//
// Quién lo ve y cuándo lo decide AppShell; aquí solo se pinta.

import { Download, Share, X } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useInstalacio } from '../hooks/useInstalacio'
import { Button } from '@/components/ui/button'

export default function AvisInstallacio({ ambBarraInferior }: { ambBarraInferior: boolean }) {
  const { t } = useT()
  const { mode, installa, descarta } = useInstalacio()

  if (mode === 'no') return null

  const ios = mode === 'manual-ios'

  return (
    <div
      className={[
        'shrink-0 border-t bg-primary px-4 py-2.5 text-primary-foreground md:hidden',
        // La barra inferior ya reserva el hueco del indicador de gestos del iPhone;
        // si no está, lo reserva este aviso, que pasa a ser el último elemento.
        ambBarraInferior ? '' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
      ].join(' ')}
      role="complementary"
      aria-label={t('inst.title')}
    >
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('inst.title')}</p>
          <p className="mt-0.5 text-xs opacity-90">{ios ? t('inst.ios_body') : t('inst.body')}</p>

          {ios && (
            // En iPhone no hay diálogo de instalación que abrir: Safari solo deja
            // hacerlo a mano, así que lo único útil es explicar los dos pasos.
            <ol className="mt-1 text-xs opacity-90">
              <li className="flex items-center gap-1.5">
                <span className="font-semibold">1.</span>
                {t('inst.ios_step1')}
                <Share className="size-3.5 shrink-0" aria-hidden />
              </li>
              <li>
                <span className="font-semibold">2.</span> {t('inst.ios_step2')}
              </li>
            </ol>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {ios ? (
              <Button size="sm" variant="secondary" className="h-10" onClick={descarta}>
                {t('inst.ok')}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" className="h-10" onClick={() => void installa()}>
                  {t('inst.install')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-10 text-primary-foreground hover:bg-white/15 hover:text-primary-foreground"
                  onClick={descarta}
                >
                  {t('inst.later')}
                </Button>
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={descarta}
          aria-label={t('inst.later')}
          className="-m-2 shrink-0 rounded-md p-2 opacity-80 transition-opacity hover:opacity-100"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
