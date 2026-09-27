// Las fotos de una oferta: el hook que firma las URLs, la miniatura que las pinta y el
// selector para subirlas (alta de oferta y detalle del productor).

import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ImageOff, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { MAX_FOTOS, esborraFoto, pujaFoto, urlsFotos } from '../lib/fotos'
import { Button } from '@/components/ui/button'

/** URLs firmadas de un conjunto de rutas, pedidas en UN lote. */
export function useUrlsFotos(rutes: string[]): Record<string, string> {
  const clau = useMemo(() => [...new Set(rutes)].sort().join('|'), [rutes])
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!clau) return
    let viu = true
    void urlsFotos(clau.split('|')).then((u) => { if (viu) setUrls((a) => ({ ...a, ...u })) })
    return () => { viu = false }
  }, [clau])
  return urls
}

/** Una foto, o un hueco neutro si no hay (o no se puede ver). */
export function FotoOferta({
  url, alt, className,
}: { url?: string | null; alt: string; className?: string }) {
  const [trencada, setTrencada] = useState(false)
  if (!url || trencada) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground', className)}
        aria-hidden>
        <ImageOff className="size-5" />
      </div>
    )
  }
  return (
    <img src={url} alt={alt} loading="lazy" onError={() => setTrencada(true)}
      className={cn('shrink-0 rounded-md bg-muted object-cover', className)} />
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
  onChange: (rutes: string[]) => void
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
      else toast.error(r.error.startsWith('foto.') ? t(r.error) : r.error)
    }
    setPujant(false)
    if (noves.length) onChange([...rutes, ...noves])
  }

  async function treu(ruta: string) {
    onChange(rutes.filter((r) => r !== ruta))
    await esborraFoto(ruta)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
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
