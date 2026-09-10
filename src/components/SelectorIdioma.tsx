// Selector de idioma suelto, para las pantallas públicas.
//
// Dentro de la aplicación el idioma vive en UserMenu, pero ahí hay sesión y ficha de
// persona. En la landing y en los accesos hace falta poder elegir idioma antes de tener
// nada de eso.

import { Languages } from 'lucide-react'
import { useT } from '../lib/i18n'
import type { Lang } from '../lib/i18n'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** `clar` = va sobre el fondo verde (hero de la landing, pie de los accesos). */
export default function SelectorIdioma({ clar = false }: { clar?: boolean }) {
  const { t, lang, setLang } = useT()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('set.language')}
          className={cn('gap-1.5', clar && 'text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground')}
        >
          <Languages className="size-4" />
          <span className="text-xs font-medium uppercase">{lang}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(['ca', 'es'] as Lang[]).map((l) => (
          <DropdownMenuItem key={l} onClick={() => setLang(l)}>
            <span className={cn('w-full', lang === l && 'font-semibold text-primary')}>
              {l === 'ca' ? 'Català' : 'Castellano'}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
