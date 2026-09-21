// «Pendent de l'equip»: lo que espera una acción de alguien del equipo, hoy.
//
// POR QUÉ EXISTE. El tablero enseñaba volumen (cuántas ofertas, cuántos kg, cuántos
// mensajes) y las dos whitelists de pruebas, o sea: lo que ya ha pasado y un ajuste que se
// toca dos veces al año. «Qué tengo que hacer hoy» no estaba en ninguna pantalla — estaba
// repartido en ocho listados que había que abrir uno a uno para descubrir si tenían algo.
//
// ES LA MISMA CIFRA QUE EL BADGE DEL MENÚ, no una consulta paralela: las dos leen el store
// de `pendentsEquip.ts`, que se alimenta de `pendents_equip()`. Si esta tarjeta dice 3 y el
// menú dice 2, es que alguien ha roto el store; no puede pasar por divergencia de consultas.
//
// EL COLOR ES EL DE `PendentsDeTu`, y significa lo mismo: **ámbar = te toca a ti**. Esta es
// la versión de equipo de aquella tarjeta, y comparte su forma a propósito, para que quien
// pasa de un panel a otro reconozca el bloque sin leerlo.
//
// ⚠️ SIN DATOS NO SE PINTA NADA. Mientras el store no haya cargado (`carregat === false`)
//    no se enseña ni la tarjeta verde: decir «res pendent» antes de saberlo sería mentir
//    durante el medio segundo en que más se mira la pantalla.

import { Link } from 'react-router'
import { CheckCircle2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { useComptadorsEquip } from '../../hooks/useComptadorsEquip'
import type { CuaEquip, PendentEquip } from '../../lib/pendentsEquip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface FilaCua {
  cua: CuaEquip
  /** A dónde se resuelve. Las tres primeras colas viven en la misma pantalla. */
  desti: string
  /**
   * Aprobar exige `pot_aprovar()` (§4bis): un técnico ve la cola pero no puede vaciarla.
   * Se dice con un badge en vez de esconder la fila — saber que hay trabajo esperando es
   * útil aunque no lo puedas hacer tú.
   */
  nomesAdmin?: boolean
}

/**
 * Las doce colas accionables, en orden de proceso (el mismo de `pendents_equip()`).
 *
 * `albarans_esperant` no está: no es una fila, es el subtítulo de `albarans_conciliar`.
 * Un albarán entregado espera a la OTRA parte, así que ponerlo como tarea del equipo
 * llenaría esta tarjeta de cosas que nadie puede resolver desde aquí.
 */
const FILES: readonly FilaCua[] = [
  { cua: 'registres', desti: '/equip/aprovacions', nomesAdmin: true },
  { cua: 'convenis_contrasignar', desti: '/equip/aprovacions', nomesAdmin: true },
  { cua: 'respostes', desti: '/equip/aprovacions', nomesAdmin: true },
  { cua: 'missatges', desti: '/equip/missatgeria' },
  { cua: 'ofertes_sense_enviar', desti: '/equip/ofertes' },
  { cua: 'ofertes_vencudes', desti: '/equip/ofertes' },
  // F3. Va al listado de ofertas y NO a `/equip/espigolades`: la jornada todavía no
  // existe —crearla es justamente lo que falta—, y se crea desde la oferta, que es donde
  // están la productora, la finca y los kilos previstos. El listado marca cuáles son.
  { cua: 'espigolades_per_convertir', desti: '/equip/ofertes' },
  // `?tab=` son los nombres reales de las pestañas de `Albarans.tsx`.
  { cua: 'albarans_esborrany', desti: '/equip/albarans?tab=esborranys' },
  { cua: 'albarans_conciliar', desti: '/equip/albarans?tab=conciliar' },
  { cua: 'costos', desti: '/equip/costos' },
  { cua: 'tancament', desti: '/equip/tancament' },
  { cua: 'documents_error', desti: '/equip/documents' },
] as const

/** Las colas que además de la cifra tienen una frase que explica la consecuencia. */
const AMB_SUBTITOL: readonly CuaEquip[] = [
  'registres', 'convenis_contrasignar', 'respostes', 'ofertes_vencudes', 'costos',
  'espigolades_per_convertir',
]

export default function PendentsEquip() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const { pendents, carregat } = useComptadorsEquip()

  const quants = (cua: CuaEquip) => pendents.find((p) => p.cua === cua)?.n ?? 0
  const fila = (cua: CuaEquip): PendentEquip | undefined => pendents.find((p) => p.cua === cua)

  const visibles = FILES.filter((f) => quants(f.cua) > 0)

  // ⚠️ `carregat` sin una sola fila NO es «no hay nada pendiente»: es que la RPC falló o
  // todavía no está desplegada (§11: la base va antes que el frontend, pero entre las dos
  // publicaciones hay una ventana). `pendents_equip()` devuelve SIEMPRE las trece colas,
  // aunque valgan 0, así que una lista vacía solo puede significar que no se pudo leer — y
  // afirmar «res pendent» en ese caso sería exactamente la mentira que más cuesta detectar.
  if (!carregat || pendents.length === 0) return null

  if (visibles.length === 0) {
    return (
      <Card className="border-exito/30 bg-exito-fondo">
        <CardContent className="flex items-start gap-3 pt-6">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-exito" aria-hidden />
          <p className="text-sm font-medium text-exito">{t('pe.empty')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-aviso/30 bg-aviso-fondo">
      <CardHeader>
        <CardTitle className="text-base text-aviso">{t('pe.title')}</CardTitle>
        <p className="mt-1 text-sm text-aviso">{t('pe.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibles.map((f) => {
          const n = quants(f.cua)
          const esTancament = f.cua === 'tancament'
          const detall = esTancament ? (fila('tancament')?.detall ?? null) : null
          const ref = esTancament ? (fila('tancament')?.ref ?? null) : null

          // El cierre no se cuenta, se describe: «1» no dice de qué ejercicio es, si es el
          // ensayo o el real, ni cuántos donantes llevan un bloqueo que impide certificar.
          const modo = String(detall?.modo ?? 'prueba')
          const estado = String(detall?.estado ?? 'obert')
          const text = esTancament
            ? t('pe.tancament', {
              ejercicio: String(detall?.ejercicio ?? '—'),
              modo: t(modo === 'real' ? 'pe.mode_real' : 'pe.mode_prova'),
              estado: t(`tan.st_${estado}`),
              bloquejats: Number(detall?.bloquejats ?? 0),
            })
            : t(`pe.${f.cua}`)

          // La única cola con subtítulo variable: cuántos esperan a la otra parte.
          const esperant = f.cua === 'albarans_conciliar' ? quants('albarans_esperant') : 0
          const sub = esperant > 0
            ? t('pe.albarans_conciliar_sub', { m: esperant })
            : AMB_SUBTITOL.includes(f.cua) ? t(`pe.${f.cua}_sub`) : null

          const desti = esTancament && ref ? `/equip/tancament/${ref}` : f.desti

          return (
            <div
              key={f.cua}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                {/* La cifra va fuera de la frase, como en los KPI: es lo que se lee de un
                    vistazo, y una frase con el número dentro obliga a leerla entera. */}
                {/* `min-w-9`, no `w-9`: una cola de tres cifras (345 missatges sense
                    contestar es un número real) desbordaría un ancho fijo. */}
                {!esTancament && (
                  <span className="min-w-9 shrink-0 text-right text-2xl font-bold leading-7 tabular-nums text-aviso">
                    {n}
                  </span>
                )}
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{text}</span>
                    {f.nomesAdmin && ctx && !ctx.potAprovar && (
                      <Badge variant="outline">{t('pe.only_admin')}</Badge>
                    )}
                  </div>
                  {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
                </div>
              </div>
              <Button asChild className="h-11 shrink-0 whitespace-normal md:h-9">
                <Link to={desti}>{t(`pe.${f.cua}_cta`)}</Link>
              </Button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
