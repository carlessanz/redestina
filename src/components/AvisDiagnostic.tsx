// «Fes el teu diagnòstic de prevenció» — la banda que lo recuerda en el panel externo.
//
// 🔴 VA EN `aviso`, NO EN ROJO, y esa es la diferencia que hay que conservar frente a sus
//    dos vecinas. `AvisConveni` y `AvisRegistreIncomplet` son rojas porque lo que anuncian
//    **impide operar**: desde la fecha de corte, sin convenio vigente no se puede publicar
//    ni mostrar interés, y sin NIF ni domicilio ese convenio no se firma en condiciones. El
//    diagnóstico no corta nada: se puede trabajar sin él. Pintarlo del mismo color
//    devaluaría la única señal que dice «esto te bloquea».
//
// 🔴 Y POR ESO MISMO SE PUEDE DESCARTAR, al revés que las otras dos (22-09-2026, revisión
//    transversal). Las dos rojas desaparecen solas en cuanto se hace lo que piden —firmar,
//    completar cuatro campos— y hasta entonces tienen que estar delante. Esta no: el
//    diagnóstico es un servicio opcional que la mayoría de las organizaciones no va a
//    tener hecho nunca, así que sin descarte sería una tercera banda permanente **encima de
//    todas las pantallas del panel**, apilada sobre las dos que sí bloquean — exactamente el
//    argumento con el que `useDiagnosticPendent` se negó a entrar en `pendents_equip()`
//    («ahogaría las colas que sí bloquean el circuito»), aplicado al otro lado.
//
// ⚠️ DESCARTAR NO ES HACERLO, y por eso la marca del menú NO se toca: el punto de
//    `/organitzacio/diagnostic` sigue ahí hasta que el diagnóstico esté emitido. Lo que
//    caduca a los 30 días es la interrupción, no el recordatorio.
//
// ⚠️ Mismo mecanismo que `AvisInstallacio` (`useInstalacio.ts`): se guarda la **fecha**, no
//    un booleano, porque un booleano no sabe expresar «vuelve a preguntármelo dentro de un
//    mes». Y el `try/catch` no es decorativo: Safari en navegación privada lanza al tocar
//    `localStorage`, y ahí es mejor enseñar la banda de más que romper la pantalla.
//
// ⚠️ NO CALCULA NADA: recibe el estado de `useDiagnosticPendent`, que se llama una sola vez
//    en `AppShell` y alimenta también la marca del menú. Calculado por separado, la banda y
//    la marca podrían decir cosas distintas.
//
// Orden en la pantalla: debajo del convenio y de la ficha incompleta. Ese es el orden en
// que importan —firmar desbloquea operar, completar la ficha hace que firmar salga bien, y
// el diagnóstico es lo que aporta valor cuando lo demás ya está—.

import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ClipboardList, X } from 'lucide-react'
import { useT } from '../lib/i18n'
import type { EstatDiagnostic } from '../types'
import { Button } from '@/components/ui/button'

const CLAU_DESCARTAT = 'redestina-diagnostic-descartat'
const DIES_ESPERA = 30

// Dónde NO se pinta, aunque el diagnóstico siga pendiente. Son las dos pantallas en las
// que la banda repetiría lo que ya tienes delante: la del propio diagnóstico —te invita a
// ir donde ya estás— y la ficha de la organización, que monta `TargetaDiagnostic` con el
// mismo estado y el mismo botón. Medido el 22-09-2026 a 320x812: con las tres bandas
// apiladas, el primer encabezado de contenido de `/organitzacio/diagnostic` caía a 794 px
// de los 812 de la ventana, así que se abría el cuestionario sin ver ni una pregunta.
const RUTES_MUDES = ['/organitzacio/diagnostic', '/organitzacio']

function descartatFaPoc(): boolean {
  try {
    const quan = Number(localStorage.getItem(CLAU_DESCARTAT))
    return Number.isFinite(quan) && quan > 0 && Date.now() - quan < DIES_ESPERA * 86_400_000
  } catch {
    return false
  }
}

export default function AvisDiagnostic({ estat }: { estat: EstatDiagnostic | null }) {
  const { t } = useT()
  const { pathname } = useLocation()
  const [amagat, setAmagat] = useState(descartatFaPoc)

  if (estat === null || amagat || RUTES_MUDES.includes(pathname)) return null

  function descarta() {
    try { localStorage.setItem(CLAU_DESCARTAT, String(Date.now())) } catch { /* ver arriba */ }
    setAmagat(true)
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-aviso/30 bg-aviso-fondo px-4 py-3 text-sm text-aviso"
    >
      <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{t('diag.banner_t')}</span>{' '}
        <span>{t(`diag.banner_${estat}`)}</span>
      </p>
      {/* 🔴 EN MÓVIL BAJA A SU PROPIA LÍNEA, y `whitespace-normal` no bastaba: `shrink-0`
          fija el ancho preferido del botón y no lo deja encoger, así que el `min-w-0` del
          párrafo se comía todo el recorte. Es el espejo exacto del `li` de la barra
          inferior (§2), donde `truncate` estaba puesto y tampoco llegaba a actuar.
          Medido a 320 px con la fila entera: al texto le quedaban 50 px y 16 líneas —una
          palabra por línea—; a 390 px, 120 px y 8 líneas. Con `w-full` el botón fuerza el
          salto, y desde `sm` vuelve a la derecha de la misma fila. */}
      <Button asChild size="sm" className="order-1 h-11 w-full shrink-0 whitespace-normal sm:order-none sm:ml-auto sm:h-8 sm:w-auto">
        <Link to="/organitzacio/diagnostic">{t('diag.banner_go')}</Link>
      </Button>
      {/* 44 px de área táctil en móvil con `-m-2 p-2`, sin ocupar 44 px de ancho en la
          fila: el mismo truco de `AvisInstallacio`. */}
      <button
        type="button"
        onClick={descarta}
        aria-label={t('diag.banner_later')}
        title={t('diag.banner_later')}
        className="-m-2 shrink-0 rounded-md p-2 opacity-80 transition-opacity hover:opacity-100"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
