// Los chips de sección del formulario del diagnóstico (A1, T3): uno por sección, con un punto
// lleno si está completa, y un clic que lleva a ella.
//
// Sustituye a la escalera del proceso (`PasosProces` + `QueTocaAra`), que contaba un plan que
// ya no existe en pantalla. Lo que necesita quien rellena un cuestionario largo con la
// persona delante es saber QUÉ secciones quedan y llegar a ellas sin recorrer la página.
//
// Accesible con teclado: son `button` nativos (Tab, Intro, Espacio) y, al llegar, el foco
// pasa al título de la sección (`tabIndex={-1}`), para que quien usa lector de pantalla o
// teclado siga desde allí y no desde arriba. El estado del punto se dice también en texto
// (`sr-only`): un punto lleno o vacío no lo lee nadie.

import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { idSeccio, type EstatSeccio } from '../../lib/diagnostic'

export default function NavSeccionsDiagnostic({ seccions }: { seccions: EstatSeccio[] }) {
  const { t } = useT()
  if (seccions.length === 0) return null

  function vesA(seccio: string) {
    const el = document.getElementById(idSeccio(seccio))
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }

  return (
    // En móvil la fila se desliza en horizontal (sin desbordar la página); desde `md`, se parte.
    <nav aria-label={t('diag.nav_seccions')} className="-mx-1 min-w-0 overflow-x-auto px-1 pb-1">
      <ul className="flex w-max gap-2 md:w-auto md:flex-wrap">
        {seccions.map((s) => (
          <li key={s.seccio}>
            <button
              type="button"
              onClick={() => vesA(s.seccio)}
              data-testid={`xip-seccio-${s.seccio}`}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm whitespace-nowrap transition-colors md:min-h-8',
                'hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                s.completa ? 'border-exito/40' : 'border-border',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-2.5 shrink-0 rounded-full border',
                  s.completa ? 'border-exito bg-exito' : 'border-muted-foreground bg-transparent',
                )}
              />
              <span>{s.clau ? t(s.clau) : s.seccio}</span>
              <span className="sr-only">
                {s.completa
                  ? t('diag.seccio_completa')
                  : s.falten > 0 ? t('diag.seccio_pendent', { n: s.falten }) : t('diag.seccio_buida')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
