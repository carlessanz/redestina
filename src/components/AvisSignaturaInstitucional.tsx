// «Pendent de la signatura institucional (Superadmin)» (proceso 0.1, 25-11-2026).
//
// Contrasignar un convenio o emitir un certificado real estampa la firma de la apoderada de la
// Fundació: es la firma INSTITUCIONAL y solo la hace el Superadmin (la base responde `42501` a
// cualquier otra cuenta). El Dinamitzador no ve el botón: ve este estado, en neutro porque no
// le toca a él (§6ter: el ámbar es «et toca a tu»).

import { ShieldCheck } from 'lucide-react'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'

export default function AvisSignaturaInstitucional({ className }: { className?: string }) {
  const { t } = useT()
  return (
    <p
      className={cn('flex items-start gap-2 rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground', className)}
      data-testid="avis-signatura-institucional"
    >
      <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{t('conv.pendent_institucional')}</span>
    </p>
  )
}
