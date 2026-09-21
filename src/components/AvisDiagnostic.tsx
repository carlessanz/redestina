// «Fes el teu diagnòstic de prevenció» — la banda que lo recuerda en el panel externo.
//
// 🔴 VA EN `aviso`, NO EN ROJO, y esa es la diferencia que hay que conservar frente a sus
//    dos vecinas. `AvisConveni` y `AvisRegistreIncomplet` son rojas porque lo que anuncian
//    **impide operar**: desde la fecha de corte, sin convenio vigente no se puede publicar
//    ni mostrar interés, y sin NIF ni domicilio ese convenio no se firma en condiciones. El
//    diagnóstico no corta nada: se puede trabajar sin él. Pintarlo del mismo color
//    devaluaría la única señal que dice «esto te bloquea».
//
// ⚠️ NO CALCULA NADA: recibe el estado de `useDiagnosticPendent`, que se llama una sola vez
//    en `AppShell` y alimenta también la marca del menú. Calculado por separado, la banda y
//    la marca podrían decir cosas distintas.
//
// Orden en la pantalla: debajo del convenio y de la ficha incompleta. Ese es el orden en
// que importan —firmar desbloquea operar, completar la ficha hace que firmar salga bien, y
// el diagnóstico es lo que aporta valor cuando lo demás ya está—.

import { Link } from 'react-router'
import { ClipboardList } from 'lucide-react'
import { useT } from '../lib/i18n'
import type { EstatDiagnostic } from '../types'
import { Button } from '@/components/ui/button'

export default function AvisDiagnostic({ estat }: { estat: EstatDiagnostic | null }) {
  const { t } = useT()
  if (estat === null) return null

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-aviso/30 bg-aviso-fondo px-4 py-3 text-sm text-aviso"
    >
      <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0">
        <span className="font-medium">{t('diag.banner_t')}</span>{' '}
        <span>{t(`diag.banner_${estat}`)}</span>
      </p>
      <Button asChild size="sm" className="ml-auto h-11 shrink-0 whitespace-normal md:h-8">
        <Link to="/organitzacio/diagnostic">{t('diag.banner_go')}</Link>
      </Button>
    </div>
  )
}
