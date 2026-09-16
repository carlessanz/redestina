// Menú de la persona: idioma, ficha y salir, en la barra superior.
//
// «Salir» está TAMBIÉN en el pie del menú lateral desde el 14-09-2026, a petición de uso:
// cruzar toda la pantalla hasta el avatar para cerrar sesión es incómodo, y es la única
// acción que se repite a propósito. El idioma y la ficha siguen viviendo solo aquí.

import { LogOut, User } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import type { Lang } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function inicials(nom: string | null, email: string | null): string {
  const base = (nom ?? email ?? '?').trim()
  const parts = base.split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase()
}

export default function UserMenu() {
  const { t, lang, setLang } = useT()
  const { ctx, organitzacio } = useAppContext()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label={t('nav.profile')}>
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {ctx ? inicials(ctx.nombre, ctx.email) : <User className="size-4" />}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{ctx?.nombre ?? ctx?.email ?? '—'}</div>
          {/* El correo es CON QUÉ CUENTA estás dentro, y eso no se podía leer en ninguna
              pantalla: con varias cuentas de prueba abiertas en pestañas distintas —o con
              la del equipo y la de la organización— no había forma de saber en cuál
              estabas sin cerrar sesión. Se omite si el nombre ya ES el correo, para no
              escribir dos veces la misma línea. Pedido el 16-09-2026. */}
          {ctx?.email && ctx.email !== ctx.nombre && (
            <div className="truncate text-xs text-muted-foreground">{ctx.email}</div>
          )}
          {organitzacio?.nombre && (
            <div className="truncate text-xs text-muted-foreground">{organitzacio.nombre}</div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t('set.language')}
        </DropdownMenuLabel>
        {(['ca', 'es'] as Lang[]).map((l) => (
          <DropdownMenuItem key={l} onClick={() => setLang(l)}>
            <span className={cn('w-full', lang === l && 'font-semibold text-primary')}>
              {l === 'ca' ? 'Català' : 'Castellano'}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void supabase.auth.signOut()}>
          <LogOut className="size-4" /> {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
