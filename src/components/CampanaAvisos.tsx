// La campana de avisos de la barra superior (05-10-2026, rebanada 2).
//
// Solo para cuentas con organización (productor o receptor): el equipo no recibe avisos,
// trabaja con su cola. Lista los últimos avisos del store (`lib/avisos.ts`); abrir uno lleva
// a donde se mira y lo marca como leído. «Marca-ho tot com a llegit» vacía el badge.
//
// El texto sale de `avis.t_<tipus>` con los parámetros del aviso: es la versión del panel
// del mismo texto que `enviar-avis` manda por correo (`_shared/textAvis.ts`).

import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useT } from '../lib/i18n'
import { esParcial, marcaLlegits, rutaAvis, useAvisos, varsAvis } from '../lib/avisos'
import { dataCurta } from '../lib/albarans'
import { cn } from '../lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function CampanaAvisos() {
  const { t } = useT()
  const navigate = useNavigate()
  const avisos = useAvisos()
  const noLlegits = avisos.filter((a) => !a.llegit_at).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-11 md:size-9"
          aria-label={noLlegits > 0 ? t('avis.campana_n', { n: noLlegits }) : t('avis.campana')}>
          <Bell className="size-5" />
          {noLlegits > 0 && (
            // Chip blanco con el texto en coral (§2bis: un badge sobre fondo de color).
            <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full border border-coral bg-white px-1 text-center text-xs font-semibold text-coral-texto">
              {noLlegits}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>{t('avis.titol')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {avisos.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">{t('avis.buit')}</p>
        )}
        {avisos.slice(0, 10).map((a) => (
          <DropdownMenuItem key={a.id} className="flex flex-col items-start gap-0.5 whitespace-normal py-2"
            onSelect={() => { void marcaLlegits({ ids: [a.id] }); navigate(rutaAvis(a)) }}>
            <span className={cn('text-sm', !a.llegit_at && 'font-semibold')}>
              {t(esParcial(a) ? 'avis.t_interes_aprovat_parcial' : `avis.t_${a.tipus}`, varsAvis(a))}
            </span>
            <span className="text-xs text-muted-foreground">{dataCurta(a.created_at)}</span>
          </DropdownMenuItem>
        ))}
        {noLlegits > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void marcaLlegits({})}>{t('avis.tot_llegit')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
