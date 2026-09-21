// `/organitzacio` — la ficha de la organización, UNA sola y fuera de los dos paneles.
//
// POR QUÉ SE MOVIÓ AQUÍ (16-09-2026). Estaba dentro de cada panel: «La meva explotació» en
// el de productor y «La meva entitat» en el de receptor. Con doble rol eso daba **dos
// entradas de menú para una misma organización**, con dos nombres distintos, y la persona
// tenía que entender que eran dos caras de lo mismo. El cliente lo dijo así: «haz que mi
// entidad aparezca solo una vez cuando tienes el doble rol y con el mismo nombre cuando
// tienes roles diferentes; tiene que ser un apartado que no dependa ni del panel de
// productor ni del de entidad receptora».
//
// LO QUE ESTO NO ES: una fusión de las dos fichas. `productores` y `entidades` siguen
// siendo dos filas con sus columnas propias —una tiene explotación y la otra capacidad de
// recepción—, y cada una se guarda con su RPC. Lo que se unifica es **dónde se entra**: una
// organización es una, y sus papeles son un detalle suyo. Es la misma dirección que la
// brecha 2 de §1bis, vista desde la interfaz.
//
// ⚠️ CON UN SOLO PAPEL NO SE PINTA NINGUNA PESTAÑA. Enseñar una pestaña sola es preguntarle
//    a alguien por una elección que no tiene: la pantalla es idéntica a la de antes salvo
//    por el título, que ahora es el mismo para todos.
//
// ⚠️ EL `key` DE CADA FICHA SIGUE SIENDO IMPRESCINDIBLE, y por el mismo motivo que cuando
//    eran dos rutas: `PerfilOrganitzacio` es el mismo componente con otro `tipus`, y sin
//    `key` React reutilizaría la instancia. Cambiaban la tabla y los campos pero la fila
//    seguía siendo la anterior, así que «Desar» sobrescribía una ficha con los datos de la
//    otra (§6ter). Aquí conviven en la misma pantalla, así que el riesgo es mayor, no menor.

import { useState } from 'react'
import { Building2, UserCircle } from 'lucide-react'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import PerfilOrganitzacio from './PerfilOrganitzacio'
import TargetaDiagnostic from '../components/TargetaDiagnostic'
import { cn } from '../lib/utils'

type Tipus = 'productor' | 'entidad'

export default function LaMevaOrganitzacio() {
  const { t, ctx } = useTContext()
  const [tria, setTria] = useState<Tipus | null>(null)

  const te: Tipus[] = []
  if (ctx.rols.includes('productor')) te.push('productor')
  if (ctx.rols.includes('receptor')) te.push('entidad')

  // Sin ninguna ficha no hay nada que enseñar. Pasa con el equipo, que opera en nombre de
  // otros y no tiene organización propia: el menú no le pinta esta entrada, pero la ruta
  // existe y alguien puede llegar por la URL.
  if (te.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('org.cap_fitxa')}</p>
  }

  if (te.length === 1) {
    return (
      <div className="space-y-4">
        <Diagnostic tipus={te[0]} />
        <PerfilOrganitzacio key={te[0]} tipus={te[0]} />
      </div>
    )
  }

  const actiu = tria ?? te[0]
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('org.dos_papers')}</p>
      {/* Dos papeles, dos juegos de campos, una sola organización. Se reparten en pestañas
          y no uno debajo del otro: son formularios con su propio «Desar», y verlos a la vez
          invita a rellenar los dos y guardar solo uno. */}
      <div role="tablist" className="flex gap-2">
        {te.map((tipus) => {
          const sel = tipus === actiu
          const Icona = tipus === 'productor' ? UserCircle : Building2
          return (
            <button
              key={tipus}
              role="tab"
              aria-selected={sel}
              onClick={() => setTria(tipus)}
              className={cn(
                'flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-sm whitespace-normal transition-colors md:min-h-9 md:flex-none',
                sel ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background hover:bg-accent',
              )}
            >
              <Icona className="size-4 shrink-0" aria-hidden />
              {t(tipus === 'productor' ? 'org.paper_productor' : 'org.paper_receptor')}
            </button>
          )
        })}
      </div>
      {/* El diagnóstico va ARRIBA: es lo que hay que hacer con esta organización, y la
          ficha es lo que ya está hecho. Es una tarjeta de estado con su enlace, no un
          formulario más: quien entra aquí a corregir el NIF no tiene que perderlo. */}
      <Diagnostic key={`diag-${actiu}`} tipus={actiu} />
      {/* `key` por pestaña: ver la nota de la cabecera. Es lo que impide guardar una ficha
          con los datos de la otra. */}
      <PerfilOrganitzacio key={actiu} tipus={actiu} />
    </div>
  )
}

/** La tarjeta del diagnóstico de UN papel, con su organización resuelta desde el contexto. */
function Diagnostic({ tipus }: { tipus: Tipus }) {
  const { ctx } = useAppContext()
  const org = ctx?.organitzacions.find((o) => o.tipo === tipus) ?? null
  return <TargetaDiagnostic tipusOrg={tipus} orgId={org?.id ?? null} mode="extern" />
}

/** `useT` y el contexto en una línea, que es lo único que esta pantalla necesita de fuera. */
function useTContext() {
  const { t } = useT()
  const { ctx } = useAppContext()
  return { t, ctx: ctx ?? { rols: [] as string[] } }
}
