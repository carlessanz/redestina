// El archivo documental de una organización, en su ficha del equipo.
//
// QUÉ GUARDA Y POR QUÉ NO ES `documentos`. `documentos` son los PDF que **emite** Redestina,
// con su número de serie y su inmutabilidad; esto son papeles que vienen de fuera —un
// convenio firmado antes de la plataforma, un certificado de un ejercicio anterior, un plan
// de prevención hecho por otro— y que la Fundación quiere conservar y poder enseñar. Viven
// en `documentos_externos` colgando de la FICHA, no de una operación.
//
// ⚠️ A una ficha solo sube el EQUIPO (RLS de `documentos_externos`): esto no es algo que
//    aporte la organización, es archivo que la Fundación guarda sobre ella. La organización
//    sí lo LEE, desde su panel (`DocumentsDeLEquip`).
//
// ⚠️ SE LISTAN DOS ORÍGENES, y hacen falta los dos: lo que cuelga de la ficha y lo que
//    cuelga de sus CONVENIOS (el escaneado del convenio en papel). Son dos `objeto_tipo`
//    distintos, así que son dos consultas; juntarlas con un `or` sobre `objeto_id` daría
//    filas de otras organizaciones que compartieran identificador de convenio.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Download, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { descarregarDocumentExtern, pujarDocumentExtern } from '../../lib/documents'
import { dataCurta } from '../../lib/albarans'
import type { DocumentExternTipus, DocumentoExterno } from '../../types'
import BotoAmbMotiu from '../proces/BotoAmbMotiu'
import DialegConveniPaper from './DialegConveniPaper'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

/** Lo que el equipo archiva a mano. El `conveni_signat` no está: lo cuelga su diálogo. */
const TIPUS_PUJADA: DocumentExternTipus[] = ['certificat_previ', 'pla_previ', 'altre']

type Fila = Pick<
  DocumentoExterno,
  'id' | 'objeto_tipo' | 'objeto_id' | 'tipo' | 'numero' | 'fecha' | 'created_at'
>

/** En qué carpeta de ejercicio cae una fila: la fecha del papel manda sobre la de subida. */
function exerciciDe(f: Fila): number {
  return new Date(f.fecha ?? f.created_at).getFullYear()
}

export default function DocumentacioOrganitzacio({
  tipusOrg, orgId, nom,
}: {
  tipusOrg: 'productor' | 'entidad'
  orgId: string
  nom?: string | null
}) {
  const { t } = useT()
  const { ctx } = useAppContext()
  const fitxerRef = useRef<HTMLInputElement | null>(null)

  const [files, setFiles] = useState<Fila[]>([])
  const [carregant, setCarregant] = useState(true)
  const [formulari, setFormulari] = useState(false)
  const [tipus, setTipus] = useState<DocumentExternTipus>('certificat_previ')
  const [exercici, setExercici] = useState<string>(() => String(new Date().getFullYear()))
  const [numero, setNumero] = useState('')
  const [data, setData] = useState('')
  const [fitxer, setFitxer] = useState<File | null>(null)
  const [pujant, setPujant] = useState(false)
  const [dialeg, setDialeg] = useState(false)
  const [descarregant, setDescarregant] = useState<string | null>(null)

  /**
   * Registrar un convenio en papel lo exige la RPC (`no_autoritzat`), así que aquí solo se
   * refleja. Fail-open mientras el contexto no ha llegado, como el resto del panel del
   * equipo (`Aprovacions`): quien decide de verdad es la base, y esto es para no enseñar un
   * botón que va a fallar — no para sustituir la guarda.
   */
  const esSuperAdmin = ctx?.esSuperAdmin ?? true

  const carrega = useCallback(async () => {
    setCarregant(true)

    // Lista de columnas en UN literal (§7): supabase-js deduce el tipo de la fila
    // analizándolo, y ante una expresión se queda sin columnas.
    const propis = await supabase
      .from('documentos_externos')
      .select('id, objeto_tipo, objeto_id, tipo, numero, fecha, created_at')
      .eq('objeto_tipo', tipusOrg)
      .eq('objeto_id', orgId)

    const columna = tipusOrg === 'productor' ? 'productor_id' : 'entidad_id'
    const { data: convenis } = await supabase
      .from('convenios')
      .select('id')
      .eq(columna, orgId)
    const idsConveni = ((convenis as { id: string }[] | null) ?? []).map((c) => c.id)

    // Sin convenios no se pregunta: un `.in()` con lista vacía es una consulta que no puede
    // devolver nada y aun así viaja.
    const deConvenis = idsConveni.length === 0
      ? { data: [] as Fila[] }
      : await supabase
        .from('documentos_externos')
        .select('id, objeto_tipo, objeto_id, tipo, numero, fecha, created_at')
        .eq('objeto_tipo', 'convenio')
        .in('objeto_id', idsConveni)

    const totes = [
      ...((propis.data as Fila[] | null) ?? []),
      ...((deConvenis.data as Fila[] | null) ?? []),
    ]
    totes.sort((a, b) => (a.fecha ?? a.created_at) < (b.fecha ?? b.created_at) ? 1 : -1)
    setFiles(totes)
    setCarregant(false)
  }, [orgId, tipusOrg])

  useEffect(() => { void carrega() }, [carrega])

  async function descarrega(id: string) {
    setDescarregant(id)
    const res = await descarregarDocumentExtern(id)
    setDescarregant(null)
    if (!res.ok) toast.error(t(res.motiuKey))
  }

  async function puja() {
    if (!fitxer || pujant) return
    setPujant(true)
    const res = await pujarDocumentExtern({
      fitxer,
      objecteTipus: tipusOrg,
      objecteId: orgId,
      tipus,
      numero: numero.trim() || null,
      data: data || null,
      exercici: Number(exercici) || null,
    })
    setPujant(false)
    if (!res.ok) { toast.error(t(res.motiuKey)); return }

    toast.success(t('orgdoc.done'))
    setFormulari(false)
    setNumero('')
    setData('')
    setFitxer(null)
    if (fitxerRef.current) fitxerRef.current.value = ''
    await carrega()
  }

  // Por ejercicio y de más reciente a más antiguo: el papel que se busca casi siempre es el
  // del año en curso o el del anterior.
  const exercicis = [...new Set(files.map(exerciciDe))].sort((a, b) => b - a)

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-base">{t('orgdoc.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('orgdoc.subtitle')}</p>
        </div>
        {/* 🔴 `w-full sm:w-auto` en los dos botones, y NO basta con `whitespace-normal`:
            el `Button` de shadcn trae **`shrink-0` de serie** (`ui/button.tsx:8`), así que
            fija su ancho preferido (`max-content`) y no lo deja encoger — medido el
            22-09-2026 a 320 px: «Registra un conveni signat en paper» pedía 264 px dentro
            de un contenedor de 238 y se salía de la tarjeta, **sin desbordar la página**.
            Es el mecanismo de §2 regla 4 visto por el otro lado: allí aplasta el texto de
            al lado, aquí se sale él. Un ancho explícito sí manda sobre el preferido. */}
        <div className="order-1 flex w-full flex-wrap gap-2 sm:order-none sm:ml-auto sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
            onClick={() => setFormulari((v) => !v)}
          >
            <Upload className="mr-1 size-4" aria-hidden />
            {t('orgdoc.upload')}
          </Button>
          {/* Gris con el motivo, no escondido: quien no puede registrarlo tiene que saber
              que existe y por qué no le toca a él (§6ter). */}
          <BotoAmbMotiu
            size="sm"
            className="h-11 w-full whitespace-normal sm:w-auto md:h-8"
            disabled={!esSuperAdmin}
            motiu={t('conv.paper_err_permis')}
            onClick={() => setDialeg(true)}
          >
            {t('conv.paper_open')}
          </BotoAmbMotiu>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {formulari && (
          <div className="space-y-4 rounded-md border border-input p-4">
            {/* `grid-cols-1` EXPLÍCITO, y no es redundante: sin él la única columna de
                móvil es `auto` y la dimensiona el contenido más ancho —aquí el
                `input[type=file]`, que trae un ancho intrínseco grande por el botón del
                navegador—, así que todas las celdas pedían 254 px dentro de 202 y se
                salían del diálogo sin desbordar la página. `grid-cols-1` genera
                `minmax(0, 1fr)`, que sí se deja encoger. Medido el 22-09-2026 a 320 px. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="od-tipus" className="mb-1.5 block text-xs text-muted-foreground">
                  {t('orgdoc.type')}
                </Label>
                {/* `w-full text-base md:text-sm` a mano: el `SelectTrigger` de shadcn nace
                    `w-fit` y en `text-sm` (§2bis). */}
                <Select value={tipus} onValueChange={(v) => setTipus(v as DocumentExternTipus)}>
                  <SelectTrigger id="od-tipus" className="w-full text-base md:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPUS_PUJADA.map((x) => (
                      <SelectItem key={x} value={x}>{t(`orgdoc.t_${x}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="od-exercici" className="mb-1.5 block text-xs text-muted-foreground">
                  {t('orgdoc.year')}
                </Label>
                <Input
                  id="od-exercici"
                  name="exercici"
                  type="number"
                  value={exercici}
                  onChange={(e) => setExercici(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('orgdoc.year_hint')}</p>
              </div>

              <div>
                <Label htmlFor="od-numero" className="mb-1.5 block text-xs text-muted-foreground">
                  {t('orgdoc.number')}
                </Label>
                <Input
                  id="od-numero"
                  name="numero"
                  type="text"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="od-data" className="mb-1.5 block text-xs text-muted-foreground">
                  {t('orgdoc.date')}
                </Label>
                <Input
                  id="od-data"
                  name="data"
                  type="date"
                  value={data}
                  onChange={(e) => setData(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="od-fitxer" className="mb-1.5 block text-xs text-muted-foreground">
                  {t('orgdoc.file')}
                </Label>
                <input
                  ref={fitxerRef}
                  id="od-fitxer"
                  name="fitxer"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  className="block w-full text-base md:text-sm"
                  onChange={(e) => setFitxer(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>

            {/* Un PDF antiguo es archivo, no un diagnóstico: el cuestionario sigue sin
                contestar y hay que decirlo justo aquí, no en otra pantalla. */}
            {tipus === 'pla_previ' && (
              <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">
                {t('orgdoc.diag_hint')}{' '}
                <Link to={`/equip/diagnostics/${tipusOrg}/${orgId}`} className="underline">
                  {t('orgdoc.diag_link')}
                </Link>
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-11 whitespace-normal md:h-8"
                disabled={!fitxer || pujant}
                onClick={() => void puja()}
              >
                {pujant && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />}
                {t('orgdoc.submit')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-11 whitespace-normal md:h-8"
                disabled={pujant}
                onClick={() => setFormulari(false)}
              >
                {t('c.cancel')}
              </Button>
            </div>
          </div>
        )}

        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}

        {!carregant && files.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('orgdoc.empty')}</p>
        )}

        {exercicis.map((any) => (
          <div key={any}>
            <h3 className="text-sm font-medium">{t('mydoc.year_title', { y: any })}</h3>
            <ul className="mt-2 space-y-2">
              {files.filter((f) => exerciciDe(f) === any).map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-input p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t(`orgdoc.t_${f.tipo}`)}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.numero ?? '—'} · {dataCurta(f.fecha ?? f.created_at)}
                    </p>
                  </div>
                  {/* Fila con texto y botón: el botón salta de línea en móvil y vuelve a su
                      sitio desde `sm`. Nada de `shrink-0`, que aplastaría el texto (§2). */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="order-1 h-11 w-full whitespace-normal sm:order-none sm:ml-auto sm:h-8 sm:w-auto"
                    disabled={descarregant === f.id}
                    onClick={() => void descarrega(f.id)}
                  >
                    {descarregant === f.id
                      ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
                      : <Download className="mr-1 size-4" aria-hidden />}
                    {t('orgdoc.download')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>

      <DialegConveniPaper
        obert={dialeg}
        tipusOrg={tipusOrg}
        orgId={orgId}
        nom={nom}
        onTancar={() => setDialeg(false)}
        onFet={() => void carrega()}
      />
    </Card>
  )
}
