// El trazo de la firma, sobre un `<canvas>` y sin ninguna librería.
//
// SE FIRMA CON EL DEDO, EN UNA FINCA, en un móvil de 360 px. Eso decide todo lo de abajo:
//
//   · **Pointer events y no touch/mouse por separado.** Un `onTouchStart` + `onMouseDown`
//     obliga a distinguir a mano el dedo del ratón y a lidiar con los eventos de ratón
//     sintéticos que el navegador emite después de un toque (el trazo salía duplicado).
//     `pointerdown/move/up` cubre dedo, lápiz y ratón con el mismo código.
//   · **`touch-none` es obligatorio, no cosmético.** Sin él, arrastrar el dedo por el
//     lienzo hace scroll de la página y no dibuja nada: el navegador se queda el gesto.
//   · **`setPointerCapture`.** Firmar rápido saca el dedo del lienzo a media letra; sin
//     captura, el `pointerup` cae fuera y el trazo se queda «pegado», dibujando al volver.
//   · **El lienzo se dimensiona en píxeles reales** (`clientWidth × devicePixelRatio`).
//     Un canvas CSS-escalado se ve borroso, y aquí el PNG acaba impreso en un PDF.
//
// EL COLOR SALE DE LOS TOKENS, aunque un canvas no entienda de clases: se lee el `color`
// computado del propio elemento (que va con `text-foreground`) y se usa como `strokeStyle`.
// Así no hay ni un hex escrito a mano (§2bis) y si el token cambia, el trazo cambia.
//
// Devuelve **PNG en data URI** o `null` si no hay trazo. El fondo se queda transparente:
// lo que se estampa en el convenio es la tinta, no un rectángulo blanco.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Eraser } from 'lucide-react'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'

export default function SignaturePad({
  onCanvi,
  etiquetaId,
  deshabilitat = false,
}: {
  /** Se llama con el PNG (data URI) o `null` al borrar. */
  onCanvi: (png: string | null) => void
  /** Id del `<label>` que describe el lienzo, para `aria-labelledby`. */
  etiquetaId?: string
  deshabilitat?: boolean
}) {
  const { t } = useT()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dibuixant = useRef(false)
  const ultim = useRef<{ x: number; y: number } | null>(null)
  const [teTrac, setTeTrac] = useState(false)

  // El callback en una ref: las pantallas lo pasan inline, y meterlo en las dependencias
  // del efecto de dimensionado recrearía el lienzo (y borraría la firma) en cada render.
  const avisa = useRef(onCanvi)
  avisa.current = onCanvi

  /** Reajusta el lienzo al ancho disponible. ⚠️ Redimensionar BORRA lo dibujado. */
  const dimensiona = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const ample = c.clientWidth
    const alt = c.clientHeight
    if (ample === 0 || alt === 0) return
    if (c.width === Math.round(ample * dpr) && c.height === Math.round(alt * dpr)) return
    c.width = Math.round(ample * dpr)
    c.height = Math.round(alt * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = getComputedStyle(c).color
  }, [])

  useEffect(() => {
    dimensiona()
    // Girar el móvil cambia el ancho y con él el lienzo. Se avisa de que la firma se ha
    // ido en vez de dejar un PNG que ya no corresponde a lo que se ve.
    const observador = new ResizeObserver(() => {
      const c = canvasRef.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      if (c.width === Math.round(c.clientWidth * dpr)) return
      dimensiona()
      setTeTrac(false)
      avisa.current(null)
    })
    if (canvasRef.current) observador.observe(canvasRef.current)
    return () => observador.disconnect()
  }, [dimensiona])

  function punt(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function comenca(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (deshabilitat) return
    // `setPointerCapture` lanza si el puntero ya no está activo (pasa con un gesto que
    // acaba fuera de la ventana). Si lanzara aquí, el trazo no empezaría **y** no se
    // sabría por qué: la captura es una mejora, no un requisito para dibujar.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* sin captura, igual dibuja */ }
    dibuixant.current = true
    ultim.current = punt(e)
    // Un toque seco sin arrastre también es un trazo (un punto sobre la «i»): se pinta
    // aquí mismo, o firmar con puntos no dejaría nada.
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx || !ultim.current) return
    ctx.beginPath()
    ctx.moveTo(ultim.current.x, ultim.current.y)
    ctx.lineTo(ultim.current.x + 0.1, ultim.current.y)
    ctx.stroke()
  }

  function mou(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dibuixant.current || deshabilitat) return
    const ctx = e.currentTarget.getContext('2d')
    const p = punt(e)
    const previ = ultim.current
    if (!ctx || !previ) return
    ctx.beginPath()
    ctx.moveTo(previ.x, previ.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ultim.current = p
  }

  function acaba(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dibuixant.current) return
    dibuixant.current = false
    ultim.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setTeTrac(true)
    avisa.current(e.currentTarget.toDataURL('image/png'))
  }

  function esborra() {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    setTeTrac(false)
    avisa.current(null)
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-card">
        <canvas
          ref={canvasRef}
          // `h-40` (160 px) es lo mínimo con lo que una firma cabe entera con el dedo;
          // `touch-none` es lo que permite arrastrar sin que la página haga scroll.
          className="h-40 w-full touch-none text-foreground"
          aria-labelledby={etiquetaId}
          role="img"
          onPointerDown={comenca}
          onPointerMove={mou}
          onPointerUp={acaba}
          onPointerCancel={acaba}
          onPointerLeave={acaba}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t(teTrac ? 'sig.pad_done' : 'sig.pad_hint')}
        </p>
        {/* 44 px de alto: es un control que se toca con el dedo, como el resto. */}
        <Button
          type="button"
          variant="outline"
          className="h-11 whitespace-normal"
          disabled={!teTrac || deshabilitat}
          onClick={esborra}
        >
          <Eraser className="size-4" /> {t('sig.pad_clear')}
        </Button>
      </div>
    </div>
  )
}
