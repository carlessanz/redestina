// Las fotos de una oferta: el hook que firma las URLs, la miniatura que las pinta, el icono
// genérico cuando no hay ninguna, la resolución «foto propia → foto del producto → icono»
// (27-09-2026, la regla en `lib/fotoOferta.ts`) y el selector para subirlas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Apple, Camera, Carrot, Cherry, Citrus, Banana, LeafyGreen, Loader2, Nut, Salad, Sprout, Wheat, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { cn } from '../lib/utils'
import { BUCKET_FOTOS, MAX_FOTOS, esborraFoto, fixaFotos, pujaFoto, urlsFotos } from '../lib/fotos'
import { FilaCasella } from './Casella'
import { BUCKET_PRODUCTES, carregaCataleg } from '../lib/fotosProducte'
import type { ProducteCataleg } from '../lib/fotosProducte'
import { classeIcona, fotoPrincipal } from '../lib/fotoOferta'
import type { ClasseIcona, OfertaAmbFotos } from '../lib/fotoOferta'
import { Button } from '@/components/ui/button'

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

/** Una foto, o el icono genérico si no hay (o no se puede ver). */
export function FotoOferta({
  url, alt, className, familia,
}: { url?: string | null; alt: string; className?: string; familia?: string | null }) {
  const [trencada, setTrencada] = useState(false)
  if (!url || trencada) return <FotoGenerica familia={familia} className={className} />
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
  /** Es la foto del catálogo, no la del lote: quien la pinta en grande lo dice. */
  deProducte: boolean
  familia: string | null
}

/**
 * La foto de cada oferta de una pantalla, firmada en lote en los dos buckets. Devuelve una
 * función: `foto(oferta)` da la miniatura (listas y tarjetas) y `foto(oferta, true)` la
 * grande. Las ofertas que no se pasan aquí no tienen URL firmada: hay que incluirlas todas.
 */
export function useFotosOfertes(
  ofertes: OfertaAmbFotos[],
): (o: OfertaAmbFotos, gran?: boolean) => FotoResolta {
  const cataleg = useCataleg()
  const resoltes = ofertes.map((o) => fotoPrincipal(o, cataleg))
  const urlsOf = useUrlsFotos(resoltes.flatMap((f) => (f.tipus === 'oferta' ? [f.ruta] : [])))
  const urlsProd = useUrlsFotos(
    resoltes.flatMap((f) => (f.tipus === 'producte' ? [f.ruta, f.mini] : [])),
    BUCKET_PRODUCTES,
  )
  return useCallback((o: OfertaAmbFotos, gran = false) => {
    const f = fotoPrincipal(o, cataleg)
    const familia = (o.producto ? cataleg.get(o.producto)?.familia : null) ?? null
    if (f.tipus === 'oferta') return { url: urlsOf[f.ruta] ?? null, deProducte: false, familia }
    if (f.tipus === 'producte') {
      return { url: urlsProd[gran ? f.ruta : f.mini] ?? null, deProducte: true, familia }
    }
    return { url: null, deProducte: false, familia: f.familia }
  }, [cataleg, urlsOf, urlsProd])
}

/** La foto de una oferta ya resuelta, con la etiqueta «orientativa» si es del catálogo. */
export function FotoOfertaResolta({
  foto, alt, className, etiqueta = false,
}: { foto: FotoResolta; alt: string; className?: string; etiqueta?: boolean }) {
  const { t } = useT()
  if (!etiqueta || !foto.deProducte || !foto.url) {
    return <FotoOferta url={foto.url} alt={alt} familia={foto.familia} className={className} />
  }
  return (
    <div className="relative">
      <FotoOferta url={foto.url} alt={alt} familia={foto.familia} className={className} />
      <span className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-0.5 text-xs text-muted-foreground">
        {t('foto.orientativa')}
      </span>
    </div>
  )
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
    // Primero se desenlaza y solo después se borra: al revés, un fallo al guardar dejaba la
    // oferta citando un fichero que ya no existe (la foto salía rota a las entidades).
    const ok = await onChange(rutes.filter((r) => r !== ruta))
    if (ok === false) return
    await esborraFoto(ruta)
  }

  return (
    <div className="space-y-2">
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
              <button type="button" onClick={() => void treu(r)}
                className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full border bg-background shadow"
                aria-label={t('foto.remove')}>
                <X className="size-4" aria-hidden />
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

/**
 * «Si no hi ha fotos, mostra la del producte»: la preferencia de UNA oferta ya publicada
 * (`excedentes.foto_producte`, 20270405100100). Solo se pinta mientras la oferta no tiene
 * fotos propias: con fotos, la del catálogo no sale nunca. Se guarda al momento por RPC,
 * sin tocar las fotos (`p_fotos = null`).
 */
export function CasellaFotoProducte({
  excedenteId, fotos, fotoProducte, disabled, onCanvi,
}: {
  excedenteId: string
  fotos: string[]
  fotoProducte: boolean
  disabled?: boolean
  onCanvi: (valor: boolean) => void
}) {
  const { t } = useT()
  const [desant, setDesant] = useState(false)
  if (fotos.length > 0) return null
  return (
    <div>
      <FilaCasella checked={fotoProducte} disabled={disabled || desant}
        onChange={async (v) => {
          setDesant(true)
          const r = await fixaFotos(excedenteId, null, v)
          setDesant(false)
          if (!r.ok) { toast.error(textError(t, r.error)); return }
          onCanvi(v)
          toast.success(t('foto.use_product_saved'))
        }}>
        {t('foto.use_product')}
      </FilaCasella>
      {!fotoProducte && <p className="text-xs text-muted-foreground">{t('foto.use_product_hint')}</p>}
    </div>
  )
}
