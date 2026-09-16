// Menú de la persona: idioma, ficha y salir, en la barra superior.
//
// «Salir» está TAMBIÉN en el pie del menú lateral desde el 14-09-2026, a petición de uso:
// cruzar toda la pantalla hasta el avatar para cerrar sesión es incómodo, y es la única
// acción que se repite a propósito. El idioma y la ficha siguen viviendo solo aquí.

import { LogOut, User } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import type { Lang } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import { useCanalPropi } from '../hooks/useCanalPropi'
import type { TriaCanal } from '../hooks/useCanalPropi'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function inicials(nom: string | null, email: string | null): string {
  const base = (nom ?? email ?? '?').trim()
  const parts = base.split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase()
}

export default function UserMenu() {
  const { t, lang, setLang } = useT()
  const { ctx, organitzacio } = useAppContext()
  const { canal, desa, disponible, desant } = useCanalPropi()

  // ── Las notificaciones, como DOS casillas y no como una lista de tres ──
  //
  // El cliente lo pidió así: «un solo idioma, pero dos tipos de notificaciones». Y encaja
  // con el modelo si se traduce bien, porque `canal_preferido` guarda UN valor:
  //   · las dos marcadas  → `null` (auto): se usa la que sea posible en cada momento
  //   · una sola          → ese canal, forzado
  //   · ninguna           → no se permite; nadie puede quedarse incontactable
  //
  // ⚠️ «Las dos» NO significa mandar el mensaje dos veces. `decidirCanal()` elige UN canal
  //    por envío (§8bis); marcar las dos es decir «me da igual cuál, usad el que funcione».
  //    El texto de ayuda lo dice, porque la casilla sola sugeriría lo contrario.
  const waMarcat = canal === 'auto' || canal === 'whatsapp'
  const mailMarcat = canal === 'auto' || canal === 'email'

  async function commutaCanal(quin: 'whatsapp' | 'email') {
    const wa = quin === 'whatsapp' ? !waMarcat : waMarcat
    const mail = quin === 'email' ? !mailMarcat : mailMarcat
    if (!wa && !mail) { toast.error(t('perf.channel_min')); return }
    const nou: TriaCanal = wa && mail ? 'auto' : wa ? 'whatsapp' : 'email'
    const ok = await desa(nou)
    toast[ok ? 'success' : 'error'](t(ok ? 'perf.channel_saved' : 'c.error'))
  }

  // El idioma se guarda TAMBIÉN en el perfil, no solo en este navegador. No es cosmético:
  // `preparar_convenio()` elige el idioma del documento con `perfiles.idioma`, así que con
  // esto solo en `localStorage` alguien podía leer la aplicación en castellano y recibir el
  // convenio en catalán sin haber elegido nunca esa lengua.
  async function triaIdioma(l: Lang) {
    setLang(l)
    if (ctx?.userId) await supabase.from('perfiles').update({ idioma: l }).eq('id', ctx.userId)
  }

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
          <DropdownMenuItem key={l} onClick={() => void triaIdioma(l)}>
            <span className={cn('w-full', lang === l && 'font-semibold text-primary')}>
              {l === 'ca' ? 'Català' : 'Castellano'}
            </span>
          </DropdownMenuItem>
        ))}

        {/* Las notificaciones solo las ve quien tiene organización: el equipo opera en
            nombre de otros y no tiene canal propio que elegir. */}
        {disponible && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {t('perf.channel_title')}
            </DropdownMenuLabel>
            {/* `onSelect` prevenido: un menú que se cierra al marcar la primera casilla
                obliga a volver a abrirlo para marcar la segunda. */}
            <DropdownMenuCheckboxItem
              checked={waMarcat}
              disabled={desant}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => void commutaCanal('whatsapp')}
            >
              {t('perf.channel_wa')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={mailMarcat}
              disabled={desant}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => void commutaCanal('email')}
            >
              {t('perf.channel_mail')}
            </DropdownMenuCheckboxItem>
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t(canal === 'auto' ? 'perf.channel_both_hint' : 'perf.channel_one_hint')}
            </p>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void supabase.auth.signOut()}>
          <LogOut className="size-4" /> {t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
