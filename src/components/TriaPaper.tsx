// El conmutador «entitat productora / entitat receptora»: UNO, no tres.
//
// POR QUÉ EXISTE. El mismo control estaba escrito tres veces —`/organitzacio`,
// `/organitzacio/diagnostic` y el editor del cuestionario en Configuració—, dos de ellas
// copiadas literalmente y la tercera ya divergida: sin icono y sin el reparto a partes
// iguales en móvil. Tres copias de un control son tres sitios donde el área táctil, el
// color del seleccionado o el `aria-selected` pueden dejar de coincidir, y eso no falla en
// ningún build: se nota mirando dos pantallas seguidas y viendo dos botones distintos para
// la misma elección.
//
// ⚠️ NO ES `ui/tabs` de shadcn a propósito. Aquel lleva su propio `TabsContent` y monta el
//    panel dentro; aquí el contenido va FUERA, con un `key` que lo remonta —es lo que
//    impide guardar una ficha con los datos de la otra (§6ter)—, así que lo único que hace
//    falta es el conmutador. Lo mismo que decidió `/registre` con sus dos papeles.
//
// ⚠️ `min-h-11` en móvil: 44 px de área táctil (§12.34). Y `whitespace-normal`, porque una
//    etiqueta larga dentro de un botón fija un ancho mínimo que se propaga por la rejilla y
//    termina desplazando la página entera (§2, regla 2).

import { Building2, UserCircle } from 'lucide-react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'

/** El mismo vocabulario que `TipusOrg` y que la columna `tipo` de las organizaciones. */
export type Paper = 'productor' | 'entidad'

export default function TriaPaper({ opcions, actiu, onTria }: {
  opcions: readonly Paper[]
  actiu: Paper
  onTria: (paper: Paper) => void
}) {
  const { t } = useT()

  return (
    <div role="tablist" className="flex gap-2">
      {opcions.map((paper) => {
        const sel = paper === actiu
        const Icona = paper === 'productor' ? UserCircle : Building2
        return (
          <button
            key={paper}
            type="button"
            role="tab"
            aria-selected={sel}
            onClick={() => onTria(paper)}
            className={cn(
              'flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-md border px-3',
              'text-sm whitespace-normal transition-colors md:min-h-9 md:flex-none',
              sel
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background hover:bg-accent',
            )}
          >
            <Icona className="size-4 shrink-0" aria-hidden />
            {t(paper === 'productor' ? 'org.paper_productor' : 'org.paper_receptor')}
          </button>
        )
      })}
    </div>
  )
}
