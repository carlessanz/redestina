// Registrar un convenio que ya estaba firmado EN PAPEL, desde la ficha de la organización.
//
// POR QUÉ EXISTE. Hasta aquí, un convenio solo podía llegar a `vigent` recorriendo el
// circuito electrónico (preparar → enviar → firmar → contrafirmar). Las organizaciones que
// ya habían firmado con la Fundación antes de Redestina no tenían ninguna forma de constar
// como vigentes, así que con la fecha de corte puesta se quedaban sin poder operar aunque
// tuvieran el papel firmado encima de la mesa. Lo único que faltaba era poder decirlo.
//
// 🔴 SON TRES PASOS Y EL ORDEN ES LA GARANTÍA, no una preferencia de implementación:
//    1. `preparar_conveni_en_paper` crea el borrador marcado como `paper` → da el `id`
//    2. se sube el escaneado, que cuelga de ese `id`
//    3. `registrar_conveni_en_paper` lo da por vigente, y **se niega con `falta_escanejat`
//       si el papel no está**
//    Al revés, «registrar un convenio en papel» sería declararlo vigente de palabra, y lo
//    único que lo acredita es el papel. Por eso si falla un paso se para y se dice cuál.
//
// ⚠️ Molde de `DialegFirmaAssistida`: 80 vw × 88 vh y **no se cierra al pinchar fuera**.
//    Con seis campos rellenados y un fichero elegido, un clic despistado sería caro.

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { motiuConveniPaper, prepararConveniEnPaper, registrarConveniEnPaper } from '../../lib/convenis'
import { pujarDocumentExtern } from '../../lib/documents'
import type { ConvenioTipo } from '../../types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const MODELS: ConvenioTipo[] = ['don_gen', 'don_rec', 'com']

/**
 * Qué modelo le toca por defecto a esta ficha.
 *
 * Mismo criterio que `conveniQueCalRebre` en `CanalitzacioDetall`, pero por el lado de
 * quien ENTREGA: una entidad productora dona (`don_gen`) y una receptora recibe
 * (`don_rec`). Es solo el valor inicial —el comercial se elige a mano— porque la donación
 * es el caso normal y el papel que se registra es casi siempre ese.
 */
function modelPerDefecte(tipusOrg: 'productor' | 'entidad'): ConvenioTipo {
  return tipusOrg === 'productor' ? 'don_gen' : 'don_rec'
}

/** Hoy en `AAAA-MM-DD`, en hora local: es el `max` de la fecha de firma. */
function avui(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

interface Props {
  obert: boolean
  tipusOrg: 'productor' | 'entidad'
  orgId: string
  nom?: string | null
  onTancar: () => void
  /** Se llama solo cuando el convenio ha quedado vigente de verdad. */
  onFet?: () => void
}

export default function DialegConveniPaper({
  obert, tipusOrg, orgId, nom, onTancar, onFet,
}: Props) {
  const { t } = useT()
  const fitxerRef = useRef<HTMLInputElement | null>(null)
  const [tipus, setTipus] = useState<ConvenioTipo>(() => modelPerDefecte(tipusOrg))
  const [dataFirma, setDataFirma] = useState('')
  const [referencia, setReferencia] = useState('')
  const [signantNom, setSignantNom] = useState('')
  const [signantCarrec, setSignantCarrec] = useState('')
  const [notes, setNotes] = useState('')
  const [fitxer, setFitxer] = useState<File | null>(null)
  const [ocupat, setOcupat] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cada apertura empieza en blanco: los datos de un papel no se heredan del anterior.
  useEffect(() => {
    if (obert) return
    setTipus(modelPerDefecte(tipusOrg))
    setDataFirma('')
    setReferencia('')
    setSignantNom('')
    setSignantCarrec('')
    setNotes('')
    setFitxer(null)
    setError(null)
    setOcupat(false)
    if (fitxerRef.current) fitxerRef.current.value = ''
  }, [obert, tipusOrg])

  const complet = dataFirma !== '' && referencia.trim() !== ''
    && signantNom.trim() !== '' && fitxer !== null

  async function registrar() {
    if (!fitxer || ocupat) return
    setError(null)
    setOcupat(true)

    // Paso 1 — el borrador marcado como `paper`, del que colgará el escaneado.
    const prep = await prepararConveniEnPaper(tipusOrg, orgId, tipus)
    if (!prep.ok) {
      setOcupat(false)
      setError(t(motiuConveniPaper(prep)))
      return
    }
    const conveniId = prep.data.id

    // Paso 2 — el papel. Sin él, el paso 3 se niega con `falta_escanejat`.
    const pujada = await pujarDocumentExtern({
      fitxer,
      objecteTipus: 'convenio',
      objecteId: conveniId,
      tipus: 'conveni_signat',
      numero: referencia.trim(),
      data: dataFirma,
      // El convenio todavía no tiene ni ejercicio ni fecha de firma —los dos llegan en el
      // paso 3—, así que sin esto un papel de 2024 se archivaría en la carpeta del año en
      // que alguien lo escanea. La fecha de la firma es la que manda.
      exercici: Number(dataFirma.slice(0, 4)) || null,
    })
    if (!pujada.ok) {
      setOcupat(false)
      setError(t(pujada.motiuKey))
      return
    }

    // Paso 3 — darlo por vigente. Ni consume número de serie ni emite PDF nuestro.
    const reg = await registrarConveniEnPaper({
      conveni: conveniId,
      dataFirma,
      referencia: referencia.trim(),
      signantNom: signantNom.trim(),
      signantCarrec: signantCarrec.trim() || null,
      notes: notes.trim() || null,
    })
    setOcupat(false)
    if (!reg.ok) {
      setError(t(motiuConveniPaper(reg)))
      return
    }

    toast.success(t('conv.paper_done'))
    onFet?.()
    onTancar()
  }

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v && !ocupat) onTancar() }}>
      <DialogContent
        className="flex h-[88vh] w-[80vw] max-w-none flex-col gap-4 p-6 sm:max-w-none"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('conv.paper_title')}{nom ? ` · ${nom}` : ''}</DialogTitle>
          <DialogDescription>{t('conv.paper_desc')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {error && (
            <p className="rounded-md bg-error-fondo p-3 text-sm text-error">{error}</p>
          )}

          {/* `grid-cols-1` EXPLÍCITO, y no es redundante: sin él la única columna de
              móvil es `auto` y la dimensiona el contenido más ancho —aquí el
              `input[type=file]`, que trae un ancho intrínseco grande por el botón del
              navegador—, así que todas las celdas pedían 254 px dentro de 202 y se
              salían del diálogo sin desbordar la página. `grid-cols-1` genera
              `minmax(0, 1fr)`, que sí se deja encoger. Medido el 22-09-2026 a 320 px. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="cp-model" className="mb-1.5 block text-xs text-muted-foreground">
                {t('conv.paper_model')}
              </Label>
              {/* `SelectTrigger` no trae `text-base md:text-sm` ni ancho: los dos van aquí
                  (§2bis), o iOS amplía la página al enfocarlo y no la devuelve. */}
              <Select value={tipus} onValueChange={(v) => setTipus(v as ConvenioTipo)}>
                <SelectTrigger id="cp-model" className="w-full text-base md:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m} value={m}>{t(`sig.model_${m}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="cp-data" className="mb-1.5 block text-xs text-muted-foreground">
                {t('conv.paper_date')}
              </Label>
              {/* `max` = hoy: la base rechaza una firma futura (`data_futura`), y es mejor
                  que el control no deje escribirla que enterarse al enviar. */}
              <Input
                id="cp-data"
                name="data_firma"
                type="date"
                max={avui()}
                value={dataFirma}
                onChange={(e) => setDataFirma(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="cp-ref" className="mb-1.5 block text-xs text-muted-foreground">
                {t('conv.paper_ref')}
              </Label>
              <Input
                id="cp-ref"
                name="referencia"
                type="text"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('conv.paper_ref_hint')}</p>
            </div>

            <div>
              <Label htmlFor="cp-signant" className="mb-1.5 block text-xs text-muted-foreground">
                {t('conv.paper_signer')}
              </Label>
              <Input
                id="cp-signant"
                name="signant_nom"
                type="text"
                value={signantNom}
                onChange={(e) => setSignantNom(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="cp-carrec" className="mb-1.5 block text-xs text-muted-foreground">
                {t('conv.paper_role')}
              </Label>
              <Input
                id="cp-carrec"
                name="signant_carrec"
                type="text"
                value={signantCarrec}
                onChange={(e) => setSignantCarrec(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="cp-notes" className="mb-1.5 block text-xs text-muted-foreground">
                {t('conv.paper_notes')}
              </Label>
              <Textarea
                id="cp-notes"
                name="notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="cp-fitxer" className="mb-1.5 block text-xs text-muted-foreground">
                {t('conv.paper_file')}
              </Label>
              {/* El único control que el sistema de diseño no pinta; lo que sí se respeta es
                  el tamaño mínimo de 16 px en móvil, como cualquier otro campo. */}
              <input
                ref={fitxerRef}
                id="cp-fitxer"
                name="fitxer"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="block w-full text-base md:text-sm"
                onChange={(e) => setFitxer(e.target.files?.[0] ?? null)}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t('conv.paper_file_hint')}</p>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            className="h-11 whitespace-normal md:h-8"
            disabled={ocupat}
            onClick={onTancar}
          >
            {t('c.cancel')}
          </Button>
          <Button
            className="h-11 whitespace-normal md:h-8"
            disabled={!complet || ocupat}
            onClick={() => void registrar()}
          >
            {ocupat && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />}
            {t('conv.paper_submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
