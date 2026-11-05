// Firmar un documento SIN salir de la aplicación (05-11-2026), de una de las dos maneras:
//
//   · «Signa aquí»     — con el dedo o el ratón (`FormulariSignaDocument`, el mismo que la
//                        página pública). Se cierra sola: queda `tancat`.
//   · «Puja'l signat»  — se descarga, se firma fuera y se sube (PDF o foto del papel). Queda
//                        `signat` hasta que el super_admin lo revisa.
//
// `mode='equip'` es el del super_admin («vía correo»): solo «Puja el signat», con una
// confirmación que dice que ese fichero pasará a ser el definitivo y el documento quedará
// cerrado al momento.
//
// ⚠️ EL ENLACE SE ACUÑA AL ENTRAR EN «Signa aquí», y una sola vez por apertura. Acuñar otro
//    revoca el anterior (lo hace la base), y con `StrictMode` o un cambio de idioma el efecto
//    se repite: se reutiliza la misma petición, como en `DialegFirmaConveni`. Quien solo
//    quiere subir el fichero no gasta ningún enlace.
//
// ⚠️ NO SE CIERRA AL PINCHAR FUERA: con un trazo hecho y tres campos escritos, un clic
//    despistado en el fondo sería caro.

import { useEffect, useRef, useState } from 'react'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { refrescaAvisos } from '../lib/refrescAvisos'
import { refrescaComptadors } from '../lib/pendentsEquip'
import { acunarEnllacSignatura } from '../lib/pendents'
import { pujarDocumentSignat } from '../lib/documents'
import { MAX_BYTES_SIGNAT, MIMES_SIGNAT, megues, signantValid, validaFitxerSignat } from '../lib/signatures'
import { cn } from '../lib/utils'
import FormulariSignaDocument from './FormulariSignaDocument'
import BlocSignant from './BlocSignant'
import { useConfirma } from './DialegConfirma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export type PestanyaSignatura = 'signa' | 'puja'

export interface DocASignar {
  id: string
  /** `CD` · `CR` · `REC` · `ENT` · `CONV`. */
  tipus: string
  numero: string | null
}

export default function DialegSignaDocument({
  obert, doc, mode, pestanya: pestanyaInicial = 'signa', onTancar, onFet,
}: {
  obert: boolean
  doc: DocASignar
  /** `titular`: las dos vías. `equip`: el super_admin sube el que le devolvieron. */
  mode: 'titular' | 'equip'
  pestanya?: PestanyaSignatura
  onTancar: () => void
  /** Tras firmar o subir: la pantalla de detrás relee el estado. */
  onFet?: () => void
}) {
  const { t } = useT()
  const [pestanya, setPestanya] = useState<PestanyaSignatura>(mode === 'equip' ? 'puja' : pestanyaInicial)
  const [token, setToken] = useState<string | null>(null)
  const [errorToken, setErrorToken] = useState<string | null>(null)
  const peticio = useRef<{ doc: string; p: ReturnType<typeof acunarEnllacSignatura> } | null>(null)

  // Al abrir, la pestaña pedida; al cerrar, se olvida todo (y el enlace acuñado con ello).
  useEffect(() => {
    if (obert) { setPestanya(mode === 'equip' ? 'puja' : pestanyaInicial); return }
    setToken(null); setErrorToken(null); peticio.current = null
  }, [obert, mode, pestanyaInicial])

  // UNA acuñación por apertura, y solo si se entra en «Signa aquí».
  useEffect(() => {
    if (!obert || mode !== 'titular' || pestanya !== 'signa') return
    let viu = true
    if (peticio.current?.doc !== doc.id) {
      peticio.current = { doc: doc.id, p: acunarEnllacSignatura(doc.id) }
    }
    const enCurs = peticio.current.p
    void (async () => {
      const r = await enCurs
      if (!viu) return
      if (!r.ok) { setErrorToken(textError(t, r)); return }
      setToken(r.data.url_path.replace('/signar-document/', ''))
    })()
    return () => { viu = false }
  }, [obert, mode, pestanya, doc.id, t])

  function fet() {
    onFet?.()
    refrescaAvisos()
    void refrescaComptadors()
  }

  const nomDoc = t(`doc.tipus_${doc.tipus}`)
  const gran = mode === 'titular'

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
      {/* Con «Signa aquí», el marco grande del convenio (80 % × 88 %, una columna en móvil); el
          del equipo solo sube un fichero y cabe en el diálogo normal. `max-w-none` es
          imprescindible: `DialogContent` trae un ancho estrecho de serie. */}
      <DialogContent
        className={cn(
          'flex max-h-[88dvh] flex-col gap-4 p-4 sm:p-6',
          gran && 'h-[88dvh] w-[calc(100vw-1rem)] max-w-none sm:w-[80vw] sm:max-w-none',
        )}
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="dialeg-signa-document"
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle className="whitespace-normal">
            {t(mode === 'equip' ? 'sgn.dlg_title_equip' : 'sgn.dlg_title', { doc: nomDoc, num: doc.numero ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t(mode === 'equip' ? 'sgn.dlg_desc_equip' : 'sgn.dlg_desc')}
          </DialogDescription>
        </DialogHeader>

        {mode === 'equip' ? (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <PujaSignat doc={doc} mode="equip" onFet={() => { fet(); onTancar() }} />
          </div>
        ) : (
          <Tabs value={pestanya} onValueChange={(v) => setPestanya(v as PestanyaSignatura)}
            className="flex min-h-0 flex-1 flex-col">
            <TabsList className="w-full shrink-0 sm:w-auto">
              <TabsTrigger value="signa" className="whitespace-normal">{t('sgn.tab_signa')}</TabsTrigger>
              <TabsTrigger value="puja" className="whitespace-normal">{t('sgn.tab_puja')}</TabsTrigger>
            </TabsList>
            <TabsContent value="signa" className="min-h-0 flex-1 overflow-y-auto pr-1">
              {errorToken ? (
                <p className="rounded-md bg-error-fondo p-3 text-sm text-error">{errorToken}</p>
              ) : token ? (
                <FormulariSignaDocument token={token} ample
                  onSignat={() => { fet(); toast.success(t('sgn.done_title')) }} />
              ) : (
                <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />{t('c.loading')}
                </p>
              )}
            </TabsContent>
            <TabsContent value="puja" className="min-h-0 flex-1 overflow-y-auto pr-1">
              <PujaSignat doc={doc} mode="titular" onFet={() => { fet(); onTancar() }} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * «Puja'l signat» / «Puja el signat»: el fichero (escondido, lo dispara el botón: es el único
 * control que no se puede pintar con el sistema de diseño), quién firmó y cuándo —opcionales:
 * lo que acredita es el papel— y el botón.
 */
function PujaSignat({ doc, mode, onFet }: {
  doc: DocASignar
  mode: 'titular' | 'equip'
  onFet: () => void
}) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const input = useRef<HTMLInputElement | null>(null)
  const [fitxer, setFitxer] = useState<File | null>(null)
  const [errorFitxer, setErrorFitxer] = useState<string | null>(null)
  const [nom, setNom] = useState('')
  const [carrec, setCarrec] = useState('')
  const [data, setData] = useState('')
  const [pujant, setPujant] = useState(false)
  const avui = new Date().toISOString().slice(0, 10)

  function tria(f: File | null) {
    setFitxer(f)
    setErrorFitxer(f ? validaFitxerSignat(f) : null)
  }

  // Los datos de quien firmó son opcionales, pero si se escriben, que sean válidos.
  const { nomCurt, carrecCurt } = signantValid({ nom, carrec, ambDni: false })
  const signantMal = (nom.trim() !== '' && nomCurt) || (carrec.trim() !== '' && carrecCurt)
  const dataMal = data !== '' && data > avui
  const potPujar = fitxer !== null && errorFitxer === null && !signantMal && !dataMal && !pujant

  async function puja() {
    if (!fitxer) return
    if (mode === 'equip') {
      const ok = await confirma({
        titol: t('sgn.confirm_equip_t', { num: doc.numero ?? '—' }),
        descripcio: t('sgn.confirm_equip'),
        confirmar: t('sgn.a_puja_equip'),
      })
      if (!ok) return
    }
    setPujant(true)
    const r = await pujarDocumentSignat({
      fitxer, documentoId: doc.id,
      signantNom: nom, signantCarrec: carrec, dataSignatura: data || null,
    })
    setPujant(false)
    if (!r.ok) { toast.error(t(r.motiuKey)); return }
    toast.success(t(r.data.firma.estat === 'tancat' ? 'sgn.ok_tancat' : 'sgn.ok_pujat'))
    onFet()
  }

  return (
    <div className="space-y-4" data-testid="sgn-puja">
      <p className="text-sm text-muted-foreground">
        {t(mode === 'equip' ? 'sgn.puja_hint_equip' : 'sgn.puja_hint')}
      </p>

      <div className="space-y-1.5">
        <Label htmlFor={`sgn-fitxer-${doc.id}`}>{t('sgn.f_fitxer')}</Label>
        <input
          ref={input}
          id={`sgn-fitxer-${doc.id}`}
          data-testid="sgn-fitxer"
          type="file"
          accept={MIMES_SIGNAT.join(',')}
          className="hidden"
          onChange={(e) => { tria(e.target.files?.[0] ?? null); e.target.value = '' }}
        />
        <Button type="button" variant="outline" className="h-11 w-full whitespace-normal sm:w-auto"
          onClick={() => input.current?.click()}>
          <FileUp className="mr-1 size-4" aria-hidden />
          {t(fitxer ? 'sgn.f_fitxer_canvia' : 'sgn.f_fitxer_tria')}
        </Button>
        {fitxer && (
          <p className="break-all text-sm text-muted-foreground">
            {fitxer.name} · <span className="tabular-nums">{megues(fitxer.size)}</span>
          </p>
        )}
        {errorFitxer && <p className="text-sm text-error">{t(errorFitxer)}</p>}
        <p className="text-xs text-muted-foreground">{t('sgn.f_fitxer_hint', { max: megues(MAX_BYTES_SIGNAT) })}</p>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t('sgn.puja_qui')}</h3>
        <BlocSignant prefix={`sgn-puja-${doc.id}`} nom={nom} carrec={carrec}
          onNom={setNom} onCarrec={setCarrec} ambDni={false} obligatori={false} ample />
        <div className="space-y-1.5 sm:max-w-xs">
          <Label htmlFor={`sgn-data-${doc.id}`}>{t('sgn.f_data')}</Label>
          <Input id={`sgn-data-${doc.id}`} type="date" className="h-11" max={avui}
            value={data} onChange={(e) => setData(e.target.value)} />
          {dataMal && <p className="text-xs text-error">{t('sgn.err_data_futura')}</p>}
        </div>
      </section>

      <Button className="h-11 w-full whitespace-normal sm:w-auto" disabled={!potPujar}
        data-testid="sgn-puja-submit" onClick={() => void puja()}>
        {pujant && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />}
        {t(mode === 'equip' ? 'sgn.a_puja_equip' : 'sgn.a_puja')}
      </Button>
      {dialeg}
    </div>
  )
}
