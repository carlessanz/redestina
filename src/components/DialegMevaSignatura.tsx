// «La meva signatura» (proceso 0.1, 25-11-2026): la firma PROPIA de una cuenta del equipo, la que
// se estampa en los albaranes que valida o emite (el PDF congela quién firmó y con qué imagen;
// cambiarla después no toca lo emitido). Se abre desde el menú de la persona (`UserMenu`), solo
// para las cuentas del equipo.
//
// Dos maneras de darla, como al firmar un documento: dibujarla con el dedo o el ratón
// (`SignaturePad`, PNG con fondo transparente) o subir una imagen PNG/JPEG (≤ 1 MB, una foto o
// un escaneo de la firma en papel). La guarda `firma-equip` (`lib/firmaEquip.ts`, nunca lanza).
//
// ⚠️ NO SE CIERRA AL PINCHAR FUERA: con un trazo hecho, un clic despistado en el fondo sería caro
//    (mismo criterio que `DialegSignaDocument`).

import { useEffect, useRef, useState } from 'react'
import { FileUp, Loader2, PenLine, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { dataCurta } from '../lib/format'
import { megues } from '../lib/signatures'
import {
  desaFirmaEquip, esborraFirmaEquip, fitxerADataUri, llegeixFirmaEquip, MAX_BYTES_FIRMA, MIMES_FIRMA,
  validaImatgeFirma, type FirmaEquip,
} from '../lib/firmaEquip'
import SignaturePad from './SignaturePad'
import { useConfirma } from './DialegConfirma'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Pestanya = 'dibuixa' | 'puja'

/** La imagen de una firma sobre la tarjeta (fondo de los tokens: la tinta transparente se ve). */
function ImatgeFirma({ src, alt, testId }: { src: string; alt: string; testId: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-md border bg-card p-3">
      <img src={src} alt={alt} className="max-h-32 w-auto max-w-full object-contain" data-testid={testId} />
    </div>
  )
}

export default function DialegMevaSignatura({ obert, onTancar }: { obert: boolean; onTancar: () => void }) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const input = useRef<HTMLInputElement | null>(null)
  const [actual, setActual] = useState<FirmaEquip | null>(null)
  const [carregant, setCarregant] = useState(false)
  const [errorCarrega, setErrorCarrega] = useState<string | null>(null)
  const [pestanya, setPestanya] = useState<Pestanya>('dibuixa')
  const [trac, setTrac] = useState<string | null>(null)
  const [pujada, setPujada] = useState<{ nom: string; bytes: number; dataUri: string } | null>(null)
  const [errorFitxer, setErrorFitxer] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)
  // Cambia tras desar: el lienzo se monta de nuevo, en blanco.
  const [versio, setVersio] = useState(0)

  // Al abrir, la firma guardada; al cerrar, se olvida lo que estaba a medias.
  useEffect(() => {
    if (!obert) {
      setTrac(null); setPujada(null); setErrorFitxer(null); setPestanya('dibuixa')
      return
    }
    let viu = true
    setCarregant(true)
    setErrorCarrega(null)
    void llegeixFirmaEquip().then((r) => {
      if (!viu) return
      setCarregant(false)
      if (!r.ok) { setErrorCarrega(r.motiuKey); setActual(null); return }
      setActual(r.data)
    })
    return () => { viu = false }
  }, [obert])

  async function tria(f: File | null) {
    setPujada(null)
    if (!f) { setErrorFitxer(null); return }
    const motiu = validaImatgeFirma(f)
    setErrorFitxer(motiu)
    if (motiu) return
    const dataUri = await fitxerADataUri(f)
    if (!dataUri) { setErrorFitxer('fe.err_format'); return }
    setPujada({ nom: f.name, bytes: f.size, dataUri })
  }

  const imatge = pestanya === 'dibuixa' ? trac : pujada?.dataUri ?? null

  async function desa() {
    if (!imatge) return
    setOcupat(true)
    const r = await desaFirmaEquip(imatge)
    setOcupat(false)
    if (!r.ok) { toast.error(t(r.motiuKey, { max: megues(MAX_BYTES_FIRMA) })); return }
    setActual(r.data)
    setTrac(null)
    setPujada(null)
    setVersio((v) => v + 1)
    toast.success(t('fe.ok_desada'))
  }

  async function esborra() {
    const ok = await confirma({
      titol: t('fe.confirm_esborra_t'),
      descripcio: t('fe.confirm_esborra'),
      confirmar: t('fe.esborra'),
      destructiu: true,
    })
    if (!ok) return
    setOcupat(true)
    const r = await esborraFirmaEquip()
    setOcupat(false)
    if (!r.ok) { toast.error(t(r.motiuKey, { max: megues(MAX_BYTES_FIRMA) })); return }
    setActual(r.data)
    toast.success(t('fe.ok_esborrada'))
  }

  const teFirma = !!actual?.ruta

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
      <DialogContent
        className="flex max-h-[88dvh] flex-col gap-4 p-4 sm:p-6"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="dialeg-meva-signatura"
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="whitespace-normal">{t('fe.title')}</DialogTitle>
          <DialogDescription>{t('fe.desc')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {/* ── La que hay guardada ── */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('fe.actual')}</h3>
            {carregant ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />{t('c.loading')}
              </p>
            ) : errorCarrega ? (
              <p className="rounded-md bg-error-fondo p-3 text-sm text-error" role="alert">{t('fe.err_carrega')}</p>
            ) : teFirma && actual?.url ? (
              <div className="space-y-2">
                <ImatgeFirma src={actual.url} alt={t('fe.alt')} testId="fe-actual" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {actual.actualitzada_at && (
                    <p className="text-xs text-muted-foreground">{t('fe.actualitzada', { data: dataCurta(actual.actualitzada_at) })}</p>
                  )}
                  <Button type="button" variant="outline" className="h-11 whitespace-normal text-error hover:text-error md:h-8"
                    disabled={ocupat} data-testid="fe-esborra" onClick={() => void esborra()}>
                    <Trash2 className="size-4" aria-hidden />{t('fe.esborra')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="fe-cap">{t('fe.cap')}</p>
            )}
          </section>

          {/* ── Una nueva: dibujada o subida ── */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t('fe.nova')}</h3>
            <Tabs value={pestanya} onValueChange={(v) => setPestanya(v === 'puja' ? 'puja' : 'dibuixa')}>
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="dibuixa" className="whitespace-normal" data-testid="fe-tab-dibuixa">
                  <PenLine className="size-4" aria-hidden />{t('fe.tab_dibuixa')}
                </TabsTrigger>
                <TabsTrigger value="puja" className="whitespace-normal" data-testid="fe-tab-puja">
                  <FileUp className="size-4" aria-hidden />{t('fe.tab_puja')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="dibuixa" className="space-y-2 pt-2" data-testid="fe-dibuixa">
                <Label id="fe-pad-label">{t('fe.dibuixa_label')}</Label>
                <SignaturePad key={versio} etiquetaId="fe-pad-label" onCanvi={setTrac} deshabilitat={ocupat} />
              </TabsContent>
              <TabsContent value="puja" className="space-y-2 pt-2">
                <input
                  ref={input}
                  type="file"
                  accept={MIMES_FIRMA.join(',')}
                  className="hidden"
                  data-testid="fe-fitxer"
                  onChange={(e) => { void tria(e.target.files?.[0] ?? null); e.target.value = '' }}
                />
                <Button type="button" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto"
                  disabled={ocupat} onClick={() => input.current?.click()}>
                  <FileUp className="size-4" aria-hidden />{t(pujada ? 'fe.puja_canvia' : 'fe.puja_tria')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('fe.puja_hint', { max: megues(MAX_BYTES_FIRMA) })}</p>
                {errorFitxer && (
                  <p className="text-sm text-error" role="alert">{t(errorFitxer, { max: megues(MAX_BYTES_FIRMA) })}</p>
                )}
                {pujada && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t('fe.previsualitzacio')}</p>
                    <ImatgeFirma src={pujada.dataUri} alt={t('fe.alt')} testId="fe-previsualitzacio" />
                    <p className="break-all text-xs text-muted-foreground">
                      {pujada.nom} · <span className="tabular-nums">{megues(pujada.bytes)}</span>
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto md:h-8" onClick={onTancar}>
            {t('c.close')}
          </Button>
          <Button type="button" className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
            disabled={!imatge || ocupat} data-testid="fe-desa" onClick={() => void desa()}>
            {ocupat && <Loader2 className="size-4 animate-spin" aria-hidden />}{t('fe.desa')}
          </Button>
        </div>
        {dialeg}
      </DialogContent>
    </Dialog>
  )
}
