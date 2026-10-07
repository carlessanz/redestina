// Las fotos de una oferta: el hook que firma las URLs, la miniatura que las pinta, el icono
// del producto cuando no hay ninguna (29-09-2026; la regla en `lib/fotoOferta.ts`) y el
// selector para subirlas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Apple, Camera, Carrot, Cherry, Citrus, Banana, LeafyGreen, Loader2, Nut, Salad, Sprout, Wheat, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { cn } from '../lib/utils'
import { BUCKET_FOTOS, MAX_FOTOS, esborraFoto, pujaFoto, urlsFotos } from '../lib/fotos'
import { carregaCataleg } from '../lib/fotosProducte'
import { urlIconaProducte } from '../lib/iconaProducte'
import type { ProducteCataleg } from '../lib/fotosProducte'
import { classeIcona, fotoPrincipal } from '../lib/fotoOferta'
import type { ClasseIcona, OfertaAmbFotos } from '../lib/fotoOferta'
import { Button } from '@/components/ui/button'
import { useConfirma } from './DialegConfirma'

/** URLs firmadas de un conjunto de rutas de UN bucket, pedidas en UN lote. */
export function useUrlsFotos(rutes: string[], bucket = BUCKET_FOTOS): Record<string, string> {
  const clau = useMemo(() => [...new Set(rutes)].sort().join('|'), [rutes])
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!clau) return
    let viu = true
    void urlsFotos(clau.split('|'), bucket).then((u) => { if (viu) setUrls((a) => ({ ...a, ...u })) })
    return () => { viu = false }
  }, [clau, bucket])
  return urls
}

const ICONES: Record<ClasseIcona, LucideIcon> = {
  citric: Citrus,
  fruita: Apple,
  vermella: Cherry,
  seca: Nut,
  exotica: Banana,
  fulla: LeafyGreen,
  arrel: Carrot,
  horta: Salad,
  gra: Wheat,
  // La hoja de la marca: el hueco sin foto sigue siendo Redestina, no un «error de imagen».
  generic: Sprout,
}

/** El hueco sin foto: un icono de la familia del producto, en verde sobre crema. */
export function FotoGenerica({ familia, className }: { familia?: string | null; className?: string }) {
  const Icona = ICONES[classeIcona(familia)]
  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-md bg-secondary text-primary', className)}
      aria-hidden>
      <Icona className="size-1/2 max-h-16 max-w-16" strokeWidth={1.5} />
    </div>
  )
}

/**
 * El icono propio del producto (`public/icones-productes/`), sobre el mismo crema que el
 * genérico. Si ese producto no tiene dibujo, el fichero falla y sale el de su familia.
 */
export function IconaProducte({
  producto, familia, className,
}: { producto: string; familia?: string | null; className?: string }) {
  const [falta, setFalta] = useState(false)
  if (falta) return <FotoGenerica familia={familia} className={className} />
  return (
    <div className={cn('flex shrink-0 items-center justify-center rounded-md bg-secondary', className)}>
      <img src={urlIconaProducte(producto)} alt={producto} onError={() => setFalta(true)}
        className="size-4/5 max-h-48 max-w-48 object-contain" />
    </div>
  )
}

/** Una foto, o el icono del producto (o de su familia) si no hay o no se puede ver. */
export function FotoOferta({
  url, alt, className, familia, producto,
}: { url?: string | null; alt: string; className?: string; familia?: string | null; producto?: string | null }) {
  const [trencada, setTrencada] = useState(false)
  if (!url || trencada) {
    return producto
      ? <IconaProducte producto={producto} familia={familia} className={className} />
      : <FotoGenerica familia={familia} className={className} />
  }
  return (
    <img src={url} alt={alt} loading="lazy" onError={() => setTrencada(true)}
      className={cn('shrink-0 rounded-md bg-muted object-cover', className)} />
  )
}

/** El catálogo con sus fotos, cargado una vez por sesión. */
export function useCataleg(): Map<string, ProducteCataleg> {
  const [cataleg, setCataleg] = useState<Map<string, ProducteCataleg>>(new Map())
  useEffect(() => {
    let viu = true
    void carregaCataleg().then((c) => { if (viu) setCataleg(c) })
    return () => { viu = false }
  }, [])
  return cataleg
}

export interface FotoResolta {
  url: string | null
  /** Sin foto propia, el icono de este producto (y, si no tiene dibujo, el de su familia). */
  producto: string | null
  familia: string | null
}

/**
 * La foto de cada oferta de una pantalla, firmada en lote. Devuelve una función:
 * `foto(oferta)`. Las ofertas que no se pasan aquí no tienen URL firmada: hay que incluirlas
 * todas. (El segundo argumento, «grande», se conserva para quien lo pasa: con iconos da igual.)
 */
export function useFotosOfertes(
  ofertes: OfertaAmbFotos[],
): (o: OfertaAmbFotos, gran?: boolean) => FotoResolta {
  const cataleg = useCataleg()
  const resoltes = ofertes.map((o) => fotoPrincipal(o, cataleg))
  const urlsOf = useUrlsFotos(resoltes.flatMap((f) => (f.tipus === 'oferta' ? [f.ruta] : [])))
  return useCallback((o: OfertaAmbFotos) => {
    const f = fotoPrincipal(o, cataleg)
    const familia = (o.producto ? cataleg.get(o.producto)?.familia : null) ?? null
    if (f.tipus === 'oferta') return { url: urlsOf[f.ruta] ?? null, producto: o.producto ?? null, familia }
    return { url: null, producto: f.producto, familia: f.familia }
  }, [cataleg, urlsOf])
}

/** La foto de una oferta ya resuelta: la suya, o el icono de su producto. */
export function FotoOfertaResolta({
  foto, alt, className,
}: { foto: FotoResolta; alt: string; className?: string }) {
  return <FotoOferta url={foto.url} alt={alt} familia={foto.familia} producto={foto.producto} className={className} />
}

/**
 * Subir, ver y quitar hasta tres fotos. La primera es la principal (la que sale en la
 * tarjeta del Mercat). Las fotos se suben al elegirlas; lo que se guarda en la oferta es la
 * lista de rutas, que devuelve `onChange`.
 */
export function SelectorFotos({
  productorId, rutes, onChange, disabled,
}: {
  productorId: string
  rutes: string[]
  /**
   * Devolver `false` (también dentro de una promesa) = el cambio NO se guardó: al quitar una
   * foto, el fichero no se borra, porque la oferta todavía la cita.
   */
  onChange: (rutes: string[]) => void | boolean | Promise<void | boolean>
  disabled?: boolean
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const input = useRef<HTMLInputElement>(null)
  const [pujant, setPujant] = useState(false)
  const urls = useUrlsFotos(rutes)

  async function tria(fitxers: FileList | null) {
    if (!fitxers || fitxers.length === 0) return
    const lliures = MAX_FOTOS - rutes.length
    const llista = [...fitxers].slice(0, lliures)
    setPujant(true)
    const noves: string[] = []
    for (const f of llista) {
      const r = await pujaFoto(productorId, f)
      if (r.ok) noves.push(r.ruta)
      else toast.error(textError(t, r.error))
    }
    if (noves.length) {
      const ok = await onChange([...rutes, ...noves])
      // Si la oferta no las ha aceptado, las subidas se quedarían huérfanas en el bucket.
      if (ok === false) await Promise.all(noves.map((r) => esborraFoto(r)))
    }
    setPujant(false)
  }

  async function treu(ruta: string) {
    if (!(await confirma({
      titol: t('foto.remove_t'),
      descripcio: t('foto.remove_d'),
      confirmar: t('foto.remove'),
      destructiu: true,
    }))) return
    // Primero se desenlaza y solo después se borra: al revés, un fallo al guardar dejaba la
    // oferta citando un fichero que ya no existe (la foto salía rota a las entidades).
    const ok = await onChange(rutes.filter((r) => r !== ruta))
    if (ok === false) return
    await esborraFoto(ruta)
  }

  return (
    <div className="space-y-2">
      {dialeg}
      {/* `gap-4`: el aspa de quitar sobresale 8 px (`-right-2`); con `gap-2` tocaba la foto
          siguiente. Así queda el mismo aire a los dos lados. */}
      <div className="flex flex-wrap gap-4">
        {rutes.map((r, i) => (
          <div key={r} className="relative">
            <FotoOferta url={urls[r]} alt={t('foto.alt_n', { n: i + 1 })} className="size-24" />
            {i === 0 && rutes.length > 1 && (
              <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-xs">{t('foto.principal')}</span>
            )}
            {!disabled && (
              // El botón mide 44 px en móvil (área táctil) y el círculo visible sigue siendo
              // de 28: el hueco extra es transparente y centrado sobre él, así que con el
              // `gap-4` llega justo al borde de la foto siguiente sin taparla.
              <button type="button" onClick={() => void treu(r)}
                className="absolute -right-4 -top-4 flex size-11 items-center justify-center md:-right-2 md:-top-2 md:size-7"
                aria-label={t('foto.remove')}>
                <span className="flex size-7 items-center justify-center rounded-full border bg-background shadow">
                  <X className="size-4" aria-hidden />
                </span>
              </button>
            )}
          </div>
        ))}
        {!disabled && rutes.length < MAX_FOTOS && (
          <Button type="button" variant="outline" className="size-24 flex-col gap-1 whitespace-normal text-xs"
            disabled={pujant} onClick={() => input.current?.click()}>
            {pujant ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Camera className="size-5" aria-hidden />}
            {pujant ? t('foto.uploading') : t('foto.add')}
          </Button>
        )}
      </div>
      {/* `accept="image/*"` sin `capture`: en el móvil deja elegir entre cámara y galería. */}
      <input ref={input} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { const f = e.target.files; void tria(f); e.target.value = '' }} />
      <p className="text-xs text-muted-foreground">{t('foto.hint', { n: MAX_FOTOS })}</p>
    </div>
  )
}
