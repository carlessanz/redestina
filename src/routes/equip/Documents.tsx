// Bandeja de documentos del equipo.
//
// Es la única ventana a `documentos` que tiene una persona: la tabla no se escribe desde
// aquí (nadie tiene INSERT ni UPDATE sobre ella; los documentos los emiten las RPC y los
// genera la Edge Function) y el PDF solo se baja por `descargar-documento`. O sea que
// esta pantalla lista y descarga, y no hace nada más a propósito.
//
// Las PESTAÑAS están puestas ya aunque dos de ellas salgan vacías hoy. No es adorno: la
// bandeja va a crecer con cada fase (fase 3 añade «Per conciliar» y «Confirmacions
// pendents», fase 4 los cierres), y el sitio donde eso aparece conviene que exista desde
// el principio. Vacías, cada una explica de qué se llenará; una pestaña en blanco se lee
// como algo roto.
//
// «Enllaços caducats» todavía no consulta nada: `enlaces_token` llega con la fase 2
// (firma de convenios). Preferimos una pestaña que diga honestamente que aún no hay
// enlaces a una consulta contra una tabla que no existe, que llenaría la pantalla de un
// error de PostgREST.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { descarregarDocument, esperarGeneracio } from '../../lib/documents'
import type { Documento, DocumentoEstado } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/** Lo que se pinta. `Pick` sobre `Documento` para que el tipo lo siga mandando types.ts. */
type Fila = Pick<
  Documento,
  | 'id' | 'tipo' | 'subtipo' | 'numero_completo' | 'version' | 'serie' | 'ejercicio'
  | 'modo' | 'idioma' | 'estado' | 'ultimo_error' | 'paginas' | 'emitido_at' | 'vigente'
>

/** Cada estado con su color de token. El error es rojo; el coral no significa fallo. */
const ESTIL_ESTAT: Record<DocumentoEstado, string> = {
  emitido: 'bg-exito-fondo text-exito',
  pendiente_fichero: 'bg-aviso-fondo text-aviso',
  error: 'bg-error-fondo text-error',
}

const CLAU_ESTAT: Record<DocumentoEstado, string> = {
  emitido: 'doc.st_emitido',
  pendiente_fichero: 'doc.st_pendent',
  error: 'doc.st_error',
}

function data(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function casa(d: Fila, q: string): boolean {
  if (!q) return true
  const camps = [d.numero_completo, d.tipo, d.subtipo, d.serie, String(d.ejercicio)]
  return camps.some((c) => (c ?? '').toLowerCase().includes(q))
}

export default function Documents() {
  const { t } = useT()
  const [documents, setDocuments] = useState<Fila[]>([])
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cerca, setCerca] = useState('')
  /** Id de la fila cuya descarga está en curso, para no dejar pulsar dos veces. */
  const [ocupat, setOcupat] = useState<string | null>(null)
  /** Id de la fila cuyo PDF estamos esperando («Generant…»). */
  const [generant, setGenerant] = useState<string | null>(null)
  // La espera puede durar 30 s: si la pantalla se desmonta antes, hay que cortarla.
  const avortar = useRef<AbortController | null>(null)

  const carrega = useCallback(async () => {
    // ⚠️ La lista de columnas va en UN literal: partida, supabase-js pierde el tipo de
    // la fila y deja de compilar (§7, deuda 46).
    const { data: files, error: errCarrega } = await supabase
      .from('documentos')
      .select('id, tipo, subtipo, numero_completo, version, serie, ejercicio, modo, idioma, estado, ultimo_error, paginas, emitido_at, vigente')
      .order('emitido_at', { ascending: false })
    return { files: (files as Fila[] | null) ?? [], errCarrega }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { files, errCarrega } = await carrega()
      if (cancelled) return
      if (errCarrega) setError(errCarrega.message)
      else setDocuments(files)
      setCarregant(false)
    })()
    return () => { cancelled = true }
  }, [carrega])

  useEffect(() => () => avortar.current?.abort(), [])

  /** Recarga silenciosa: tras generarse un PDF, la fila ya no dice «Generant…». */
  const refresca = useCallback(async () => {
    const { files, errCarrega } = await carrega()
    if (!errCarrega) setDocuments(files)
  }, [carrega])

  async function descarrega(fila: Fila) {
    setOcupat(fila.id)
    const res = await descarregarDocument(fila.id)

    if (res.ok) {
      toast.success(t('doc.downloaded', { name: res.data.nombre }))
      setOcupat(null)
      return
    }
    // Cualquier motivo que no sea «todavía no hay fichero» se cuenta y se acaba aquí.
    if (res.codi !== 'sense_fitxer') {
      toast.error(t(res.motiuKey))
      setOcupat(null)
      return
    }

    // El documento existe y se puede ver, pero el PDF aún se está generando: se espera
    // por polling (2 s / 30 s) y se reintenta una vez. Sin esto, el equipo solo vería un
    // error confuso en el segundo que separa la emisión de la generación.
    setGenerant(fila.id)
    toast.info(t('doc.generating_wait'))
    avortar.current?.abort()
    const control = new AbortController()
    avortar.current = control

    const espera = await esperarGeneracio(fila.id, control.signal)
    setGenerant(null)

    if (espera.resultat === 'cancellat') { setOcupat(null); return }
    if (espera.resultat !== 'emitido') {
      if (espera.motiuKey) toast.error(t(espera.motiuKey))
      await refresca()
      setOcupat(null)
      return
    }

    const segon = await descarregarDocument(fila.id)
    if (segon.ok) toast.success(t('doc.downloaded', { name: segon.data.nombre }))
    else toast.error(t(segon.motiuKey))
    await refresca()
    setOcupat(null)
  }

  const { tots, ambError } = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    const tots = documents.filter((d) => casa(d, q))
    return { tots, ambError: tots.filter((d) => d.estado === 'error') }
  }, [documents, cerca])

  function taula(llista: Fila[], buitKey: string) {
    if (llista.length === 0) {
      return <p className="text-sm text-muted-foreground">{t(buitKey)}</p>
    }
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('doc.c_number')}</TableHead>
              <TableHead>{t('doc.c_type')}</TableHead>
              <TableHead>{t('doc.c_subtype')}</TableHead>
              <TableHead>{t('doc.c_version')}</TableHead>
              <TableHead>{t('doc.c_mode')}</TableHead>
              <TableHead>{t('doc.c_status')}</TableHead>
              <TableHead>{t('doc.c_date')}</TableHead>
              <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {llista.map((d) => {
              const esperant = generant === d.id
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-medium whitespace-nowrap tabular-nums">
                    {d.numero_completo ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="tabular-nums">{d.tipo}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.subtipo ? t(`doc.sub_${d.subtipo}`) : '—'}
                  </TableCell>
                  <TableCell className="tabular-nums">v{d.version}</TableCell>
                  <TableCell>
                    {d.modo === 'prueba'
                      ? <Badge className="bg-coral-suave text-coral-texto">{t('doc.mode_test')}</Badge>
                      : <span className="text-muted-foreground">{t('doc.mode_real')}</span>}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={ESTIL_ESTAT[d.estado]}
                      title={d.estado === 'error' ? (d.ultimo_error ?? undefined) : undefined}
                    >
                      {t(esperant ? 'doc.st_generating' : CLAU_ESTAT[d.estado])}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {data(d.emitido_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      {/* `h-11` en móvil: es la acción principal de la fila y 32 px es
                          poco para un pulgar. En escritorio vuelve al alto del resto. */}
                      <Button
                        size="sm"
                        className="h-11 whitespace-normal md:h-8"
                        disabled={ocupat === d.id}
                        onClick={() => void descarrega(d)}
                      >
                        {ocupat === d.id
                          ? <Loader2 className="size-4 animate-spin" />
                          : <Download className="size-4" />}
                        {esperant ? t('doc.generating') : t('doc.download')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    )
  }

  const buitKey = documents.length === 0 ? 'doc.empty' : 'doc.no_match'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('doc.title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('doc.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          type="search"
          placeholder={t('doc.search')}
          value={cerca}
          onChange={(e) => setCerca(e.target.value)}
        />
        {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!carregant && !error && (
          <Tabs defaultValue="tots">
            {/* Las tres etiquetas no caben a 360 px: la lista scrollea ella sola en vez
                de empujar la página entera hacia la derecha. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="tots">{t('doc.tab_all', { n: tots.length })}</TabsTrigger>
                <TabsTrigger value="error">{t('doc.tab_error', { n: ambError.length })}</TabsTrigger>
                <TabsTrigger value="enllacos">{t('doc.tab_links')}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="tots" className="space-y-2">
              {taula(tots, buitKey)}
            </TabsContent>

            <TabsContent value="error" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('doc.error_hint')}</p>
              {taula(ambError, 'doc.empty_error')}
            </TabsContent>

            <TabsContent value="enllacos" className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('doc.empty_links')}</p>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}
