// El cierre de un ejercicio, donante a donante: el sitio donde nace un certificado.
//
// EL ORDEN NO ES DECORATIVO, ES LA REGLA. Calcular → resumen → factura → certificado, y la
// base no deja saltárselo: `emitir_certificado()` exige que no quede ningún bloqueo
// `bloqueja: true` y que la factura coincida al céntimo; sin coincidencia solo pasa el
// super_admin, y con motivo escrito (D4). Esta pantalla no reimplementa ninguna de esas
// comprobaciones —lo haría mal y se desincronizaría—: las **enseña antes** para que nadie
// pulse a ciegas, y cuando la base dice que no, se lee su frase tal cual.
//
// LOS BLOQUEOS SON LA COLUMNA QUE HAY QUE MIRAR. Los que impiden el certificado se pintan
// en rojo con su detalle («3 canalitzacions sense conciliar (412.0 kg)»); los que solo
// avisan, en ámbar. La diferencia la decide el dato (`bloqueja`), no un criterio de aquí.
//
// Y EL MODO. Un cierre de prueba tiene su propia serie (`P-RES`, `P-CD`), su marca de agua
// y sus destinatarios, y se puede reiniciar entero. Confundirlo con el real sería emitir
// certificados de donación de verdad: por eso el badge no dice «prova», dice «PROVA · sense
// validesa fiscal», y aparece en la cabecera y en cada documento de la tabla.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AlertTriangle, ArrowLeft, Download, Eye, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { kg } from '../../lib/albarans'
import {
  bloqueja, calcularTancament, compararTancamentProva, tancarTancament, csv182, dades182,
  dataTancament, descarregarText, emetreCertificat, emetreCertificatsTancament, emetreResum,
  estilEstatDonant,
  estilEstatTancament, euros, marcarDeclarat, marcarEnviat, rectificarCertificat,
  registrarFactura, reiniciarTancamentProva, simularFactura,
} from '../../lib/tancament'
import type { FilaComparacio, ResultatCertificatsMassius } from '../../lib/tancament'
import {
  PASSOS_EXERCICI_CLAUS, seguentPasDonant, seguentPasExercici,
} from '../../lib/seguentPas'
import { refrescaComptadors } from '../../lib/pendentsEquip'
import type {
  CierreDonante, CierreEjercicio, Documento, EstatCierreDonante,
} from '../../types'
import DialegMotiu from '../../components/DialegMotiu'
import { useConfirma } from '../../components/DialegConfirma'
import BotoAmbMotiu from '../../components/proces/BotoAmbMotiu'
import PasosProces from '../../components/proces/PasosProces'
import QueTocaAra from '../../components/proces/QueTocaAra'
import { dadesFiscalsProvisionals } from '../../lib/canalitzacio'
import { BadgeMode } from './Tancament'
import DialegAssistit from '../../components/equip/DialegAssistit'
import Bloquejos from '../../components/equip/Bloquejos'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type Capcalera = Pick<
  CierreEjercicio,
  'id' | 'ejercicio' | 'modo' | 'estado' | 'abierto_at' | 'calculado_at' | 'cerrado_at' | 'declarado_at' | 'notas'
>

type Donant = Pick<
  CierreDonante,
  | 'id' | 'productor_id' | 'datos_fiscales' | 'kg_total' | 'valor_total' | 'estado' | 'bloqueos'
  | 'resumen_numero' | 'certificado_numero' | 'certificado_at' | 'factura_numero' | 'factura_fecha'
  | 'factura_importe' | 'excepcion_sin_factura' | 'excepcion_motivo' | 'recordatorios'
  | 'requiere_llamada' | 'rectificaciones' | 'enviado_at'
>

type DocFila = Pick<
  Documento,
  'id' | 'objeto_id' | 'tipo' | 'subtipo' | 'numero_completo' | 'version' | 'estado' | 'vigente' | 'emitido_at'
>

function nom(d: Donant): string {
  const f = d.datos_fiscales ?? {}
  return (f['raó_social'] as string | null) || (f.nombre as string | null) || '—'
}

function nif(d: Donant): string {
  return ((d.datos_fiscales ?? {}).nif as string | null) || '—'
}

function num(v: string): number | null {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

// ---------------------------------------------------------------------------
// Diálogo de factura
// ---------------------------------------------------------------------------
// Aparte de `DialegMotiu` porque lo que pide no es un motivo: son tres campos que van a
// una comparación al céntimo. El importe se teclea con coma o con punto —quien copia de
// una factura española escribe coma— y se normaliza al leerlo.
function DialegFactura({
  obert, onObert, valorEsperat, ocupat, onConfirma,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  valorEsperat: number
  ocupat: boolean
  onConfirma: (numero: string, data: string | null, importe: number | null) => void
}) {
  const { t } = useT()
  const [numero, setNumero] = useState('')
  const [data, setData] = useState('')
  const [importe, setImporte] = useState('')

  useEffect(() => {
    if (!obert) { setNumero(''); setData(''); setImporte('') }
  }, [obert])

  const imp = num(importe)
  const coincideix = imp !== null && Math.round(imp * 100) === Math.round(valorEsperat * 100)

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('tan.inv_title')}</DialogTitle>
          <DialogDescription>{t('tan.inv_desc', { v: euros(valorEsperat) })}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="fac-numero">{t('tan.f_inv_number')}</Label>
            <Input id="fac-numero" value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fac-data">{t('tan.f_inv_date')}</Label>
            <Input id="fac-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fac-import">{t('tan.f_inv_amount')}</Label>
            <Input
              id="fac-import"
              inputMode="decimal"
              value={importe}
              onChange={(e) => setImporte(e.target.value)}
              placeholder={String(valorEsperat)}
            />
            {imp !== null && (
              <p className={`text-xs ${coincideix ? 'text-exito' : 'text-error'}`}>
                {t(coincideix ? 'tan.inv_match' : 'tan.inv_mismatch')}
              </p>
            )}
            {imp === null && <p className="text-xs text-muted-foreground">{t('tan.inv_no_amount')}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onObert(false)} disabled={ocupat}>{t('c.cancel')}</Button>
          <Button
            className="whitespace-normal"
            disabled={ocupat || numero.trim() === ''}
            onClick={() => onConfirma(numero.trim(), data || null, imp)}
          >
            {t('tan.inv_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Diálogo de simulación
// ---------------------------------------------------------------------------
function DialegSimula({
  obert, onObert, ocupat, onConfirma,
}: {
  obert: boolean
  onObert: (v: boolean) => void
  ocupat: boolean
  onConfirma: (desviacio: number) => void
}) {
  const { t } = useT()
  const [pct, setPct] = useState('0')
  useEffect(() => { if (!obert) setPct('0') }, [obert])
  const v = num(pct)

  return (
    <Dialog open={obert} onOpenChange={onObert}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tan.sim_title')}</DialogTitle>
          <DialogDescription>{t('tan.sim_desc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {['0', '5', '-10'].map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={pct === p ? 'default' : 'outline'}
                className="h-11 whitespace-normal md:h-9"
                onClick={() => setPct(p)}
              >
                {t(p === '0' ? 'tan.sim_exact' : 'tan.sim_dev', { p })}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sim-pct">{t('tan.f_deviation')}</Label>
            <Input id="sim-pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onObert(false)} disabled={ocupat}>{t('c.cancel')}</Button>
          <Button className="whitespace-normal" disabled={ocupat || v === null} onClick={() => onConfirma(v ?? 0)}>
            {t('tan.sim_do')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------
export default function TancamentDetall() {
  const { t } = useT()
  const { id = '' } = useParams()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false

  const [cap, setCap] = useState<Capcalera | null>(null)
  const [donants, setDonants] = useState<Donant[]>([])
  const [docs, setDocs] = useState<DocFila[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupat, setOcupat] = useState(false)

  // Diálogos, cada uno con el donante sobre el que actúa.
  const [factura, setFactura] = useState<Donant | null>(null)
  // La subida conducida por teléfono: el donante dicta el número y el importe y el
  // equipo sube el PDF que le acaba de mandar. Queda como asistida, con su nombre.
  const [facturaAssistida, setFacturaAssistida] = useState<Donant | null>(null)
  const [simula, setSimula] = useState<Donant | null>(null)
  const [rectifica, setRectifica] = useState<Donant | null>(null)
  const [reinici, setReinici] = useState(false)

  // Informe de comparación (solo cierres de prueba).
  const [reals, setReals] = useState('')
  const [comparacio, setComparacio] = useState<FilaComparacio[] | null>(null)

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    const { data: capData, error: errCap } = await supabase
      .from('cierres_ejercicio')
      .select('id, ejercicio, modo, estado, abierto_at, calculado_at, cerrado_at, declarado_at, notas')
      .eq('id', id)
      .maybeSingle()
    if (errCap) return { errCap }

    // ⚠️ `.eq('tipo', 'donacio')` no es un adorno. Desde que existe el certificado de
    // transacción, esta tabla guarda los dos acumulados; sin el filtro, las filas
    // `transaccio` salían mezcladas con las de donación y sus botones llamaban a las RPC de
    // donación, que responden `22023` por el trigger guardián. Esta pantalla es la del
    // cierre de DONACIONES; el CT tiene la suya.
    const { data: donData } = await supabase
      .from('cierres_donante')
      .select('id, productor_id, datos_fiscales, kg_total, valor_total, estado, bloqueos, resumen_numero, certificado_numero, certificado_at, factura_numero, factura_fecha, factura_importe, excepcion_sin_factura, excepcion_motivo, recordatorios, requiere_llamada, rectificaciones, enviado_at')
      .eq('cierre_id', id)
      .eq('tipo', 'donacio')

    const llista = (donData as Donant[] | null) ?? []

    // Los documentos se piden por los ids que hay en pantalla, no por la tabla entera
    // (§12.5). `documentos` es polimórfica y no tiene FK, así que no se puede embeber.
    const ids = llista.map((d) => d.id)
    const { data: docData } = ids.length
      ? await supabase
        .from('documentos')
        .select('id, objeto_id, tipo, subtipo, numero_completo, version, estado, vigente, emitido_at')
        .eq('objeto_tipo', 'cierre_donante')
        .in('objeto_id', ids)
        .order('emitido_at', { ascending: false })
      : { data: [] }

    return {
      cap: (capData as Capcalera | null) ?? null,
      donants: llista,
      docs: (docData as DocFila[] | null) ?? [],
      errCap: null,
    }
  }, [id])

  const refresca = useCallback(async () => {
    const r = await carrega()
    if (r.errCap) { setError(r.errCap.message); return }
    setCap(r.cap ?? null)
    setDonants(r.donants ?? [])
    setDocs(r.docs ?? [])
  }, [carrega])

  useEffect(() => {
    let viu = true
    void (async () => {
      const r = await carrega()
      if (!viu) return
      if (r.errCap) { setError(r.errCap.message); setCarregant(false); return }
      setCap(r.cap ?? null)
      setDonants(r.donants ?? [])
      setDocs(r.docs ?? [])
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega])

  const descarregador = useDescarregaDocument(refresca)

  const perDonant = useMemo(() => {
    const mapa: Record<string, DocFila[]> = {}
    for (const d of docs) {
      const llista = mapa[d.objeto_id] ?? []
      llista.push(d)
      mapa[d.objeto_id] = llista
    }
    return mapa
  }, [docs])

  /**
   * ¿Siguen siendo provisionales los datos fiscales de Espigoladors?
   *
   * `emitir_certificado()` se niega mientras lo sean, uno a uno y en bloque (42501). Se lee
   * aquí para poder APAGAR el botón con su motivo en vez de dejar que la base lo rechace N
   * veces: el equipo vería una lista de saltados con el mismo texto repetido y ningún
   * camino. Ante la duda vale `true` — decir «ya puedes certificar» cuando no se puede es
   * el único error caro.
   */
  const [provisionals, setProvisionals] = useState(true)
  const [resultatMassiu, setResultatMassiu] = useState<ResultatCertificatsMassius | null>(null)
  const { confirma, dialeg: dialegConfirma } = useConfirma()

  useEffect(() => {
    let viu = true
    void dadesFiscalsProvisionals().then((v) => { if (viu) setProvisionals(v) })
    return () => { viu = false }
  }, [])

  const totals = useMemo(() => donants.reduce(
    (acc, d) => ({
      kg: acc.kg + Number(d.kg_total ?? 0),
      valor: acc.valor + Number(d.valor_total ?? 0),
      bloquejats: acc.bloquejats + (bloqueja(d.bloqueos) ? 1 : 0),
      certificats: acc.certificats + (d.certificado_numero ? 1 : 0),
      // Quién puede recibir certificado y aún no lo tiene. La factura NO entra: dejó de
      // ser condición el 21-09-2026. Es el mismo criterio que aplica la base en
      // `emitir_certificados_cierre()`, y por eso la cifra del botón cuadra con lo emitido.
      pendentsCert: acc.pendentsCert
        + (!d.certificado_numero && !bloqueja(d.bloqueos) && Number(d.kg_total ?? 0) > 0 ? 1 : 0),
    }),
    { kg: 0, valor: 0, bloquejats: 0, certificats: 0, pendentsCert: 0 },
  ), [donants])

  const esProva = cap?.modo === 'prueba'
  const editable = cap?.estado === 'obert' || cap?.estado === 'provisional'

  /**
   * En qué punto está el ejercicio.
   *
   * ⚠️ `obert` son TRES situaciones y el estado no las distingue, así que las dos cosas que
   * faltan se calculan aquí: **`calculat`** es `calculado_at` —la marca que deja
   * `calcular_cierre()`, y la única prueba de que se ha pasado— y **`bloquejats`** es el
   * número de donantes con algún bloqueo `bloqueja: true`, que es exactamente el mismo
   * recuento que ya alimenta la tarjeta «Bloquejats» (`totals.bloquejats`): dos recuentos
   * del mismo hecho acabarían discrepando.
   */
  const puntExercici = useMemo(() => seguentPasExercici({
    estado: cap?.estado ?? 'obert',
    calculat: cap?.calculado_at != null,
    bloquejats: totals.bloquejats,
    certificatsPendents: totals.pendentsCert,
  }), [cap?.estado, cap?.calculado_at, totals.bloquejats, totals.pendentsCert])

  // Cuál de los cuatro botones globales es «el siguiente». Sale del mismo punto que la
  // frase de arriba, para que el botón resaltado y el texto no puedan decir cosas distintas.
  const accioSeguent = puntExercici.etapa === 'obert_net' ? 'resum'
    : puntExercici.etapa === 'provisional' ? 'tanca'
      : puntExercici.etapa === 'tancat_certs' ? 'certificats'
        : puntExercici.etapa === 'tancat' ? 'declara'
          : puntExercici.etapa === 'declarat' ? null
            : 'calcula'   // obert_sense_calcul y obert_bloquejats: recalcular

  const motiuTancat = editable ? undefined : t('tan.why_closed')

  /**
   * Por qué no se puede emitir en bloque, EN ESTE ORDEN.
   *
   * El orden importa: es el mismo que aplica la base, así que el motivo que lee el equipo es
   * el que de verdad le va a frenar. Primero hay que cerrar el ejercicio, después hacen falta
   * los datos fiscales reales, y solo entonces tiene sentido decir que no queda nadie.
   */
  const motiuCertificatsTots = cap?.estado !== 'tancat'
    ? t('tan.why_close_first')
    : provisionals
      ? t('tan.why_provisional')
      : totals.pendentsCert === 0 ? t('tan.why_no_cert_candidates') : undefined
  // 🔴 «Marca com a declarat» estaba habilitado con el ejercicio abierto: se podía dar por
  // presentado ante Hacienda un cierre que ni siquiera se había calculado. La base lo
  // rechazaba, pero el botón no lo decía. Declarar es lo último del circuito, después de
  // cerrar.
  const potDeclarar = cap?.estado === 'tancat'
  const motiuDeclarar = potDeclarar
    ? undefined
    : t(cap?.estado === 'declarat' ? 'tan.why_already_declared' : 'tan.why_close_first')

  // --- Acciones de la cabecera --------------------------------------------

  async function calcula() {
    setOcupat(true)
    const res = await calcularTancament(id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('tan.calculated', {
      n: res.data.donants, kg: kg(res.data.kg_total), b: res.data.bloquejats,
    }))
    void refrescaComptadors()
    await refresca()
  }

  /**
   * El resumen provisional de todos los que pueden recibirlo.
   *
   * Se salta a quien tenga un bloqueo bloqueante o 0 kg, exactamente como hace
   * `congelar_ejercicio()` con los definitivos, y por el mismo motivo: pedirle una factura
   * a alguien por un importe que va a cambiar es peor que no pedírsela todavía.
   */
  async function resumsProvisionals() {
    const candidats = donants.filter((d) => !bloqueja(d.bloqueos) && Number(d.kg_total) > 0)
    if (candidats.length === 0) { toast.error(t('tan.no_candidates')); return }
    setOcupat(true)
    let fets = 0
    const fallits: string[] = []
    for (const d of candidats) {
      const res = await emetreResum(d.id, true)
      if (res.ok) fets += 1
      else fallits.push(`${nom(d)}: ${res.missatge}`)
    }
    setOcupat(false)
    if (fets > 0) { toast.success(t('tan.summaries_sent', { n: fets })); void refrescaComptadors() }
    if (fallits.length > 0) toast.error(fallits.join(' · '))
    await refresca()
  }

  async function tanca() {
    if (!cap) return
    setOcupat(true)
    // Por `id`, no por ejercicio: se cierra el que se tiene delante. Ver `tancament.ts`.
    const res = await tancarTancament(id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('tan.closed'))
    void refrescaComptadors()
    await refresca()
  }

  async function declara() {
    setOcupat(true)
    const res = await marcarDeclarat(id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('tan.declared'))
    void refrescaComptadors()
    await refresca()
  }

  async function reinicia(motiu: string) {
    setOcupat(true)
    const res = await reiniciarTancamentProva(id)
    setOcupat(false)
    setReinici(false)
    if (!res.ok) { toast.error(res.missatge); return }
    // Las dos cifras que hay que poder leer: el reinicio NO toca canalizaciones ni
    // albaranes, y esto es lo que lo demuestra sin abrir la base.
    toast.success(t('tan.reset_done', {
      d: res.data.documents, c: res.data.canalitzacions, a: res.data.albarans,
    }))
    void refrescaComptadors()
    console.info('reiniciar_cierre_prueba', motiu, res.data)
    await refresca()
  }

  async function exporta182() {
    const res = await dades182(id)
    if (!res.ok) { toast.error(res.missatge); return }
    if (res.data.length === 0) { toast.error(t('tan.no_182')); return }
    const capceleres: Record<string, string> = {
      nif: t('tan.h182_nif'), razon_social: t('tan.h182_name'),
      codigo_postal: t('tan.h182_cp'), provincia: t('tan.h182_province'),
      importe: t('tan.h182_amount'), kg: t('tan.h182_kg'),
      en_especie: t('tan.h182_kind'), certificado_numero: t('tan.h182_cert'),
      fecha: t('tan.h182_date'), modo: t('tan.h182_mode'),
    }
    const prefix = esProva ? 'PROVA-' : ''
    descarregarText(
      `${prefix}182-${cap?.ejercicio ?? ''}.csv`,
      csv182(res.data, capceleres),
      'text/csv;charset=utf-8',
    )
    toast.success(t('tan.exported_182', { n: res.data.length }))
  }

  /** Plantilla del contraste: los donantes calculados, con las dos columnas reales vacías. */
  function plantillaComparacio() {
    const linies = [
      'codi;nif;kg_real;valor_real',
      ...donants.map((d) => `;${nif(d) === '—' ? '' : nif(d)};;`),
    ]
    descarregarText(
      `contrast-${cap?.ejercicio ?? ''}.csv`,
      `\uFEFF${linies.join('\r\n')}\r\n`,
      'text/csv;charset=utf-8',
    )
  }

  /**
   * Lo que se pega en el recuadro → el `jsonb` que espera `comparar_cierre_prueba`.
   *
   * Cuatro columnas explícitas (`codi;nif;kg;valor`) y no adivinar: con un solo
   * identificador habría que decidir por la forma del texto si «B12345678» es un NIF o un
   * código interno, y equivocarse ahí compara al donante que no es. Las dos primeras
   * pueden ir vacías; la RPC resuelve con la que venga.
   */
  function parseReals(text: string): { codigo?: string; nif?: string; kg: number; valor: number }[] {
    const net = text.trim()
    if (net === '') return []
    if (net.startsWith('[')) return JSON.parse(net) as never
    const files: { codigo?: string; nif?: string; kg: number; valor: number }[] = []
    for (const linia of net.split(/\r?\n/)) {
      const parts = linia.split(/[;\t]/).map((p) => p.trim())
      if (parts.length < 4) continue
      const kgN = num(parts[2])
      const valorN = num(parts[3])
      if (kgN === null && valorN === null) continue   // la cabecera cae aquí
      files.push({
        codigo: parts[0] || undefined,
        nif: parts[1] || undefined,
        kg: kgN ?? 0,
        valor: valorN ?? 0,
      })
    }
    return files
  }

  async function compara() {
    let entrada: unknown[]
    try {
      entrada = parseReals(reals)
    } catch {
      toast.error(t('tan.cmp_bad_input'))
      return
    }
    if (entrada.length === 0) { toast.error(t('tan.cmp_bad_input')); return }
    const res = await compararTancamentProva(id, entrada)
    if (!res.ok) { toast.error(res.missatge); return }
    setComparacio(res.data)
  }

  // --- Acciones por donante ------------------------------------------------

  async function resum(d: Donant, provisional: boolean) {
    setOcupat(true)
    const res = await emetreResum(d.id, provisional)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('tan.summary_done', { n: res.data.numero ?? '' }))
    void refrescaComptadors()
    await refresca()
  }

  async function guardaFactura(numero: string, data: string | null, importe: number | null) {
    if (!factura) return
    setOcupat(true)
    const res = await registrarFactura({ cd: factura.id, numero, data, import: importe, docExtern: null })
    setOcupat(false)
    setFactura(null)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t(res.data.estado === 'coincident' ? 'tan.inv_ok' : 'tan.inv_diff'))
    void refrescaComptadors()
    await refresca()
  }

  async function simulaFactura(desviacio: number) {
    if (!simula) return
    setOcupat(true)
    const res = await simularFactura(simula.id, desviacio)
    setOcupat(false)
    setSimula(null)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t(res.data.estado === 'coincident' ? 'tan.inv_ok' : 'tan.inv_diff'))
    void refrescaComptadors()
    await refresca()
  }

  /**
   * Todos los certificados del cierre, de una vez.
   *
   * ⚠️ **Es un botón APARTE de «Tanca l'exercici», a propósito.** Cerrar ya es el acto
   * irreversible; encadenarle la emisión quitaría el momento de revisar la lista antes de
   * quemar N números de serie legal. La base tampoco lo encadena: `cerrar_cierre()` y el
   * job del 31 de diciembre siguen emitiendo solo resúmenes.
   *
   * Los saltados NO son un fallo: son donantes que la base ha dejado fuera por bloqueo o
   * por no tener kilos, y vienen con su motivo para poder enseñarlos uno a uno.
   */
  async function certificatsTots() {
    if (!id) return
    const ok = await confirma({
      titol: t('tan.certs_confirm_t', { n: totals.pendentsCert }),
      descripcio: t('tan.certs_confirm', { serie: esProva ? 'P-CD' : 'CD' }),
      confirmar: t('tan.a_certificates_all'),
      destructiu: !esProva,
    })
    if (!ok) return
    setOcupat(true)
    const res = await emetreCertificatsTancament(id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    setResultatMassiu(res.data)
    toast.success(t('tan.certs_done', {
      n: res.data.emesos, m: res.data.saltats.length,
    }))
    void refrescaComptadors()
    await refresca()
  }

  async function certificat(d: Donant) {
    setOcupat(true)
    const res = await emetreCertificat(d.id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('tan.cert_done', { n: res.data.numero ?? '' }))
    void refrescaComptadors()
    await refresca()
  }

  async function rectificaCertificat(motiu: string) {
    if (!rectifica) return
    setOcupat(true)
    const res = await rectificarCertificat(rectifica.id, motiu)
    setOcupat(false)
    setRectifica(null)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('tan.cert_rectified', { n: res.data.numero ?? '' }))
    void refrescaComptadors()
    await refresca()
  }

  async function enviat(d: Donant) {
    setOcupat(true)
    const res = await marcarEnviat(d.id)
    setOcupat(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t('tan.marked_sent'))
    void refrescaComptadors()
    await refresca()
  }

  // --- Render --------------------------------------------------------------

  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!cap) return <p className="text-sm text-muted-foreground">{t('tan.not_found')}</p>

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="h-11 -ml-2 md:h-9">
        <Link to="/equip/tancament"><ArrowLeft className="mr-1 size-4" />{t('c.back')}</Link>
      </Button>

      {esProva && (
        <div className="flex items-start gap-2 rounded-md border border-aviso bg-aviso-fondo p-3 text-sm text-aviso">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{t('tan.test_banner')}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{t('tan.detail_title', { y: cap.ejercicio })}</CardTitle>
            <BadgeMode mode={cap.modo} gran />
            <Badge className={estilEstatTancament(cap.estado)}>{t(`tan.st_${cap.estado}`)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <PasosProces etapes={PASSOS_EXERCICI_CLAUS} actual={puntExercici.index} />
          <QueTocaAra punt={puntExercici} compacte />

          {/* El resultado de la última emisión en bloque.
              Se enseña ENTERO —emitidos, los que ya lo tenían y cada saltado con su
              motivo— porque un «3 emesos» a secas deja sin saber qué pasó con los otros
              dos, y esos dos son justo los que necesitan una decisión. */}
          {resultatMassiu && (
            <div className="rounded-md border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-titulos text-sm font-semibold">{t('tan.certs_result')}</p>
                <Button
                  size="sm" variant="ghost" className="h-11 whitespace-normal md:h-8"
                  onClick={() => setResultatMassiu(null)}
                >
                  {t('c.close')}
                </Button>
              </div>
              <p className="mt-1 text-sm text-exito">
                {t('tan.certs_done', {
                  n: resultatMassiu.emesos, m: resultatMassiu.saltats.length,
                })}
              </p>
              {resultatMassiu.ja_tenien > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('tan.certs_had', { n: resultatMassiu.ja_tenien })}
                </p>
              )}
              {resultatMassiu.saltats.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {resultatMassiu.saltats.map((x) => (
                    <li key={x.cd} className="rounded-md bg-aviso-fondo p-2 text-sm text-aviso">
                      <span className="font-medium">{x.donant ?? '—'}</span>
                      {' · '}{t(`tan.skip_${x.codi}`)}
                      {x.motiu ? ` · ${x.motiu}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Dada etiqueta={t('tan.c_donors')} valor={String(donants.length)} />
            <Dada etiqueta={t('tan.c_kg')} valor={kg(totals.kg)} />
            <Dada etiqueta={t('tan.c_value')} valor={euros(totals.valor)} />
            <Dada etiqueta={t('tan.c_certs')} valor={String(totals.certificats)} />
            <Dada etiqueta={t('tan.c_blocked')} valor={String(totals.bloquejats)} />
            <Dada etiqueta={t('tan.c_calculated')} valor={dataTancament(cap.calculado_at)} />
            <Dada etiqueta={t('tan.c_closed')} valor={dataTancament(cap.cerrado_at)} />
            <Dada etiqueta={t('tan.c_declared')} valor={dataTancament(cap.declarado_at)} />
          </div>

          {potAprovar && (
            <div className="space-y-3">
              {/* Los cuatro pasos del cierre, en su orden. Antes iban mezclados con el
                  export y el reinicio, así que la secuencia había que saberla de memoria. */}
              <div className="flex flex-wrap gap-2">
                <BotoAmbMotiu
                  variant={accioSeguent === 'calcula' ? 'default' : 'outline'}
                  className="h-11 whitespace-normal md:h-9"
                  disabled={ocupat || !editable}
                  motiu={motiuTancat}
                  onClick={() => void calcula()}
                >
                  {t('tan.a_calculate')}
                </BotoAmbMotiu>
                <BotoAmbMotiu
                  variant={accioSeguent === 'resum' ? 'default' : 'outline'}
                  className="h-11 whitespace-normal md:h-9"
                  disabled={ocupat || !editable}
                  motiu={motiuTancat}
                  onClick={() => void resumsProvisionals()}
                >
                  {t('tan.a_provisional')}
                </BotoAmbMotiu>
                <BotoAmbMotiu
                  variant={accioSeguent === 'tanca' ? 'default' : 'outline'}
                  className="h-11 whitespace-normal md:h-9"
                  disabled={ocupat || !editable}
                  motiu={motiuTancat}
                  onClick={() => void tanca()}
                >
                  {t('tan.a_close')}
                </BotoAmbMotiu>
                <BotoAmbMotiu
                  variant={accioSeguent === 'certificats' ? 'default' : 'outline'}
                  className="h-11 whitespace-normal md:h-9"
                  disabled={ocupat || cap?.estado !== 'tancat' || provisionals
                    || totals.pendentsCert === 0}
                  motiu={motiuCertificatsTots}
                  onClick={() => void certificatsTots()}
                >
                  {t('tan.a_certificates_all')}
                </BotoAmbMotiu>
                <BotoAmbMotiu
                  variant={accioSeguent === 'declara' ? 'default' : 'outline'}
                  className="h-11 whitespace-normal md:h-9"
                  disabled={ocupat || !potDeclarar}
                  motiu={motiuDeclarar}
                  onClick={() => void declara()}
                >
                  {t('tan.a_declare')}
                </BotoAmbMotiu>
              </div>

              {/* Lo que no es un paso: consultar el 182 y deshacer un ensayo. */}
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">{t('tan.actions_other')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="h-11 whitespace-normal md:h-9"
                    onClick={() => void exporta182()}
                  >
                    {t('tan.a_export_182')}
                  </Button>
                  {esProva && (
                    <Button
                      variant="destructive"
                      className="h-11 whitespace-normal md:h-9"
                      disabled={ocupat}
                      onClick={() => setReinici(true)}
                    >
                      {t('tan.a_reset')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
          {!potAprovar && <p className="text-sm text-muted-foreground">{t('tan.readonly')}</p>}
        </CardContent>
      </Card>

      {/* --- Donantes --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('tan.donors_title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('tan.donors_hint')}</p>
        </CardHeader>
        <CardContent>
          {donants.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('tan.no_donors')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('tan.c_donor')}</TableHead>
                    <TableHead className="text-right">{t('tan.c_kg')}</TableHead>
                    <TableHead className="text-right">{t('tan.c_value')}</TableHead>
                    <TableHead>{t('tan.c_status')}</TableHead>
                    <TableHead>{t('tan.c_blocks')}</TableHead>
                    <TableHead>{t('tan.c_invoice')}</TableHead>
                    <TableHead>{t('tan.c_docs')}</TableHead>
                    <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {donants.map((d) => (
                    <FilaDonant
                      key={d.id}
                      d={d}
                      docs={perDonant[d.id] ?? []}
                      esProva={esProva}
                      provisionals={provisionals}
                      potAprovar={potAprovar}
                      ocupat={ocupat}
                      descarregant={descarregador.ocupat}
                      generant={descarregador.generant}
                      onDescarrega={(docId) => void descarregador.descarrega(docId)}
                      onMostra={(docId) => void descarregador.mostra(docId)}
                      onResum={(prov) => void resum(d, prov)}
                      onFactura={() => setFactura(d)}
                      onFacturaAssistida={() => setFacturaAssistida(d)}
                      onSimula={() => setSimula(d)}
                      onCertificat={() => void certificat(d)}
                      onRectifica={() => setRectifica(d)}
                      onEnviat={() => void enviat(d)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {facturaAssistida && (
        <DialegAssistit
          obert
          que="factura"
          objecteId={facturaAssistida.id}
          onTancar={() => setFacturaAssistida(null)}
          onFet={() => { setFacturaAssistida(null); void carrega() }}
        />
      )}

      {/* --- Contraste con las cifras reales (solo en prueba) --- */}
      {esProva && potAprovar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('tan.cmp_title')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t('tan.cmp_hint')}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cmp-reals">{t('tan.f_real_figures')}</Label>
              <Textarea
                id="cmp-reals"
                rows={5}
                value={reals}
                onChange={(e) => setReals(e.target.value)}
                placeholder={'codi;nif;kg_real;valor_real'}
              />
              <p className="text-xs text-muted-foreground">{t('tan.cmp_format')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="h-11 whitespace-normal md:h-9" onClick={() => void compara()}>
                {t('tan.cmp_do')}
              </Button>
              <Button
                variant="outline"
                className="h-11 whitespace-normal md:h-9"
                onClick={plantillaComparacio}
              >
                {t('tan.cmp_template')}
              </Button>
            </div>

            {comparacio && (
              comparacio.length === 0
                ? <p className="text-sm text-muted-foreground">{t('tan.cmp_empty')}</p>
                : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('tan.c_donor')}</TableHead>
                          <TableHead className="text-right">{t('tan.cmp_kg_calc')}</TableHead>
                          <TableHead className="text-right">{t('tan.cmp_kg_real')}</TableHead>
                          <TableHead className="text-right">{t('tan.cmp_dif_kg')}</TableHead>
                          <TableHead className="text-right">{t('tan.cmp_val_calc')}</TableHead>
                          <TableHead className="text-right">{t('tan.cmp_val_real')}</TableHead>
                          <TableHead className="text-right">{t('tan.cmp_dif_val')}</TableHead>
                          <TableHead>{t('tan.cmp_match')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {comparacio.map((f, i) => (
                          <TableRow key={`${f.nif ?? ''}-${i}`}>
                            <TableCell className="max-w-56 truncate">{f.donante ?? '—'}</TableCell>
                            <TableCell className="text-right tabular-nums">{kg(f.kg_calculado)}</TableCell>
                            <TableCell className="text-right tabular-nums">{kg(f.kg_real)}</TableCell>
                            <TableCell className="text-right tabular-nums">{kg(f.dif_kg)}</TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap">{euros(f.valor_calculado)}</TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap">{euros(f.valor_real)}</TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap">{euros(f.dif_valor)}</TableCell>
                            <TableCell>
                              <Badge className={f.coincide ? 'bg-exito-fondo text-exito' : 'bg-error-fondo text-error'}>
                                {t(f.coincide ? 'c.yes' : 'c.no')}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )
            )}
          </CardContent>
        </Card>
      )}

      <DialegFactura
        obert={factura !== null}
        onObert={(v) => { if (!v) setFactura(null) }}
        valorEsperat={Number(factura?.valor_total ?? 0)}
        ocupat={ocupat}
        onConfirma={(n, f, i) => void guardaFactura(n, f, i)}
      />

      <DialegSimula
        obert={simula !== null}
        onObert={(v) => { if (!v) setSimula(null) }}
        ocupat={ocupat}
        onConfirma={(p) => void simulaFactura(p)}
      />

      <DialegMotiu
        obert={rectifica !== null}
        onObert={(v) => { if (!v) setRectifica(null) }}
        titol={t('tan.rect_title')}
        descripcio={t('tan.rect_desc')}
        etiqueta={t('tan.f_rect_reason')}
        confirmar={t('tan.rect_do')}
        ocupat={ocupat}
        onConfirma={(motiu) => void rectificaCertificat(motiu)}
      />

      <DialegMotiu
        obert={reinici}
        onObert={setReinici}
        titol={t('tan.reset_title')}
        descripcio={t('tan.reset_desc')}
        etiqueta={t('tan.f_reset_reason')}
        confirmar={t('tan.a_reset')}
        destructiu
        ocupat={ocupat}
        onConfirma={(motiu) => void reinicia(motiu)}
      />

      {/* Confirmación de la emisión en bloque: consume N números de serie legal. */}
      {dialegConfirma}

      {/* El visor de PDF. Una sola vez por pantalla. */}
      {descarregador.visor}
    </div>
  )
}

function Dada({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="font-medium tabular-nums">{valor}</p>
    </div>
  )
}

/** Los bloqueos de un donante, cada uno con su color según si impide o solo avisa. */
function FilaDonant({
  d, docs, esProva, provisionals, potAprovar, ocupat, descarregant, generant,
  onDescarrega, onMostra, onResum, onFactura, onFacturaAssistida, onSimula, onCertificat, onRectifica,
  onEnviat,
}: {
  d: Donant
  docs: DocFila[]
  esProva: boolean
  /** Sin datos fiscales reales, `emitir_certificado()` se niega: mejor decirlo antes. */
  provisionals: boolean
  potAprovar: boolean
  ocupat: boolean
  descarregant: string | null
  generant: string | null
  onDescarrega: (docId: string) => void
  onMostra: (docId: string) => void
  onResum: (provisional: boolean) => void
  onFactura: () => void
  /** La vía asistida: acuña el enlace y abre el formulario del donante en un diálogo. */
  onFacturaAssistida: () => void
  onSimula: () => void
  onCertificat: () => void
  onRectifica: () => void
  onEnviat: () => void
}) {
  const { t } = useT()
  const bloquejat = bloqueja(d.bloqueos)
  const teCertificat = d.certificado_numero !== null

  // Qué toca con ESTE donante. La frase va junto al badge, no en un tooltip: son nueve
  // estados y «Factura pendent» no dice por cuánto ni que hay que registrarla.
  const punt = seguentPasDonant({ estado: d.estado, importe: euros(d.valor_total) })

  /** Cuál de los botones de la fila es el siguiente. El resto van en `outline`. */
  const seguent: Record<EstatCierreDonante, 'resum' | 'factura' | 'certificat' | 'enviat' | null> = {
    calculat: 'resum',
    // Desde el 21-09-2026 la factura dejó de condicionar el certificado, así que en cuanto
    // el resumen ha salido el siguiente paso ya es certificar. La factura sigue
    // registrándose —y su botón sigue ahí— pero deja de ser lo que toca.
    resum_enviat: 'certificat',
    factura_pendent: 'certificat',
    factura_rebuda: 'certificat',
    coincident: 'certificat',
    // La discrepancia se habla con el donante, pero tampoco frena el certificado.
    discrepancia: 'certificat',
    certificat_emes: 'enviat',
    enviat: null,
    declarat: null,
  }
  const ara = seguent[d.estado]

  const motiuResum = bloquejat
    ? t('tan.why_blocked')
    : Number(d.kg_total) <= 0 ? t('tan.why_no_kg') : undefined
  /**
   * Qué frena el certificado de ESTE donante, en el orden en que lo frena la base.
   *
   * ⚠️ La factura ya NO está en esta lista (21-09-2026). Antes el motivo era «falta la
   * factura» y era cierto; hoy sería mentira, y un botón gris con un motivo falso es peor
   * que un botón gris sin motivo.
   */
  const motiuCertificat = bloquejat
    ? t('tan.why_blocked')
    : Number(d.kg_total) <= 0
      ? t('tan.why_no_kg')
      : provisionals ? t('tan.why_provisional') : undefined

  return (
    <TableRow>
      <TableCell className="max-w-56">
        <p className="truncate font-medium">{nom(d)}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{nif(d)}</p>
        {d.requiere_llamada && (
          <Badge className="mt-1 bg-aviso-fondo text-aviso whitespace-normal">{t('tan.needs_call')}</Badge>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums whitespace-nowrap">{kg(d.kg_total)}</TableCell>
      <TableCell className="text-right tabular-nums whitespace-nowrap">{euros(d.valor_total)}</TableCell>
      <TableCell className="max-w-52">
        <Badge className={estilEstatDonant(d.estado)}>{t(`tan.ds_${d.estado}`)}</Badge>
        {d.excepcion_sin_factura && (
          <Badge className="ml-1 bg-aviso-fondo text-aviso whitespace-normal">{t('tan.exception')}</Badge>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{t(punt.claus.toca, punt.vars)}</p>
      </TableCell>
      <TableCell><Bloquejos llista={d.bloqueos ?? []} /></TableCell>
      <TableCell className="text-sm">
        {d.factura_numero
          ? (
            <>
              <p className="tabular-nums">{d.factura_numero}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {euros(d.factura_importe)} · {dataTancament(d.factura_fecha)}
              </p>
            </>
          )
          : <span className="text-muted-foreground">{t('tan.no_invoice')}</span>}
      </TableCell>
      <TableCell>
        {docs.length === 0
          ? <span className="text-sm text-muted-foreground">—</span>
          : (
            <div className="space-y-1">
              {docs.filter((doc) => doc.vigente).map((doc) => (
                // «Veure» primero: al repasar un cierre se abre el resumen o el
                // certificado para leerlo, no para guardarlo. El número sigue en el botón
                // de descarga, que es donde ya estaba; los dos van en el mismo grupo para
                // que se lea que son del mismo documento.
                <div key={doc.id} className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-11 whitespace-normal md:h-8"
                    disabled={descarregant === doc.id}
                    onClick={() => onMostra(doc.id)}
                  >
                    <Eye className="mr-1 size-3.5" aria-hidden />
                    {t('doc.view')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-11 justify-start whitespace-normal md:h-8"
                    disabled={descarregant === doc.id}
                    onClick={() => onDescarrega(doc.id)}
                  >
                    {generant === doc.id
                      ? <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
                      : <Download className="mr-1 size-3.5" aria-hidden />}
                    <span className="tabular-nums">{doc.numero_completo}</span>
                    {doc.version > 1 && <span className="ml-1 text-muted-foreground">v{doc.version}</span>}
                  </Button>
                </div>
              ))}
            </div>
          )}
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-stretch gap-1">
          {potAprovar && (
            <>
              <BotoAmbMotiu
                size="sm" variant={ara === 'resum' ? 'default' : 'outline'}
                className="h-11 whitespace-normal md:h-8"
                disabled={ocupat || bloquejat || Number(d.kg_total) <= 0}
                motiu={motiuResum}
                onClick={() => onResum(true)}
              >
                {t('tan.a_summary')}
              </BotoAmbMotiu>
              <BotoAmbMotiu
                size="sm" variant="outline"
                className="h-11 whitespace-normal md:h-8"
                disabled={ocupat || bloquejat || Number(d.kg_total) <= 0}
                motiu={motiuResum}
                onClick={() => onResum(false)}
              >
                {t('tan.a_summary_final')}
              </BotoAmbMotiu>
              <Button
                size="sm" variant={ara === 'factura' ? 'default' : 'outline'}
                className="h-11 whitespace-normal md:h-8"
                disabled={ocupat}
                onClick={onFactura}
              >
                {t('tan.a_invoice')}
              </Button>
              {/* La misma factura, pero subida CON el donante al teléfono: el formulario
                  que él vería, dentro de un diálogo, y la evidencia marcada como asistida
                  con el nombre de quien la conduce (§9). */}
              <Button
                size="sm" variant="outline"
                className="h-11 whitespace-normal md:h-8"
                disabled={ocupat}
                onClick={onFacturaAssistida}
              >
                {t('tan.a_invoice_assisted')}
              </Button>
              {esProva && (
                <Button
                  size="sm" variant="outline"
                  className="h-11 whitespace-normal md:h-8"
                  disabled={ocupat}
                  onClick={onSimula}
                >
                  {t('tan.a_simulate')}
                </Button>
              )}
              {!teCertificat && (
                <BotoAmbMotiu
                  size="sm"
                  variant={ara === 'certificat' ? 'default' : 'outline'}
                  className="h-11 whitespace-normal md:h-8"
                  disabled={ocupat || bloquejat || Number(d.kg_total) <= 0 || provisionals}
                  motiu={motiuCertificat}
                  onClick={onCertificat}
                >
                  {t('tan.a_certificate')}
                </BotoAmbMotiu>
              )}
              {teCertificat && (
                <>
                  <Button
                    size="sm" variant="outline"
                    className="h-11 whitespace-normal md:h-8"
                    disabled={ocupat}
                    onClick={onRectifica}
                  >
                    {t('tan.a_rectify')}
                  </Button>
                  {d.enviado_at === null && (
                    <Button
                      size="sm" variant={ara === 'enviat' ? 'default' : 'outline'}
                      className="h-11 whitespace-normal md:h-8"
                      disabled={ocupat}
                      onClick={onEnviat}
                    >
                      {t('tan.a_mark_sent')}
                    </Button>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
