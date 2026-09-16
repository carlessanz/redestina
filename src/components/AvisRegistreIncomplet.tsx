// «Acaba d'omplir la teva fitxa» — la banda que avisa de lo que el registro no preguntó.
//
// POR QUÉ EXISTE (16-09-2026). El alta de `/registre` pide lo mínimo para poder entrar y eso
// es deliberado: un formulario largo en la puerta es un formulario que nadie termina. Pero
// el NIF, el domicilio, el código postal y la población **hacen falta enseguida**: son lo
// que el convenio imprime.
//
// 🔴 VA EN ROJO, y eso cambió el mismo día en que se escribió. Nació en tono de aviso
//    porque «no bloquea nada»; con `fecha_corte_convenios` puesta eso dejó de ser cierto:
//    sin convenio vigente no se puede publicar ni mostrar interés, y sin estos campos el
//    convenio no se firma en condiciones. Una ficha a medias **sí impide operar**, con un
//    paso de por medio. El cliente lo pidió así: «en el inicio, también ponerlo en rojo».
//
// ⚠️ NO CALCULA NADA: recibe la lista de `useFitxaIncompleta`, que se llama una sola vez en
//    `AppShell` y alimenta también el badge del menú. Si lo calculara aquí, el contador y la
//    banda podrían decir cosas distintas.

import { Link } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'

export default function AvisRegistreIncomplet({ falten }: { falten: string[] }) {
  const { t } = useT()
  if (falten.length === 0) return null

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-error bg-error-fondo px-4 py-3 text-sm text-error"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0">
        <span className="font-medium">{t('reg_inc.titol')}</span>{' '}
        <span>{t('reg_inc.falten', { camps: falten.map((c) => t(`f.${c}`)).join(', ') })}</span>
      </p>
      <Button asChild size="sm" className="ml-auto h-11 shrink-0 whitespace-normal md:h-8">
        <Link to="/organitzacio">{t('reg_inc.completa')}</Link>
      </Button>
    </div>
  )
}
