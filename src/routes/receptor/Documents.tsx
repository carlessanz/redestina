// Los documentos de una entidad receptora: lo que le falta hacer, sus convenios, las
// entregas que ha recibido, sus certificados de recepción y su plan de prevención.
//
// NI UN IMPORTE, Y NO POR OLVIDO. El valor de una donación es un dato del donante y de la
// Fundación: dice cuánto vale fiscalmente lo que ha dado. La entidad que lo recibe no tiene
// ninguna necesidad —ni ningún derecho— de verlo, así que esta pantalla no consulta
// `cierres_donante` ni `costes_producto`, y ni `albaran_lineas` ni `cierres_receptor` tienen
// ninguna columna de dinero. Es la única diferencia de fondo con la pantalla hermana del
// productor.
//
// Comparte con ella los componentes de `components/documents/`: lo que cambia es qué se le
// pide a cada uno, no cómo se pinta.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useDescarregaDocument } from '../../hooks/useDescarregaDocument'
import { kgRebutsExercici } from '../../lib/certificatRecepcio'
import { codiVerificacio } from '../../lib/codiVerificacio'
import { dataCurta, kg, type AlbaranBandeja } from '../../lib/albarans'
import type { CierreReceptor, Convenio, Documento, KgRebutsExercici } from '../../types'
import PendentsDeTu from '../../components/documents/PendentsDeTu'
import LlistaConvenis from '../../components/documents/LlistaConvenis'
import LlistaDocuments from '../../components/documents/LlistaDocuments'
import TaulaAlbarans from '../../components/documents/TaulaAlbarans'
import SegellRedestina from '../../components/documents/SegellRedestina'
import CarregantSeccio from '../../components/CarregantSeccio'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// `sha256_datos` entra en la lista por una sola cosa: es de donde sale el código de
// verificación impreso, y sin él no se puede componer el sello (`SegellRedestina`).
type DocFila = Pick<
  Documento,
  'id' | 'objeto_id' | 'objeto_tipo' | 'tipo' | 'subtipo' | 'numero_completo' | 'estado' | 'vigente' | 'ejercicio' | 'emitido_at' | 'sha256_datos'
>

type ConveniFila = Pick<
  Convenio,
  'id' | 'tipo' | 'tipo_org' | 'estado' | 'numero_completo' | 'ejercicio'
  | 'enviado_at' | 'firmado_at' | 'contrafirmado_at' | 'created_at'
>

type CertificatFila = Pick<
  CierreReceptor,
  'id' | 'periodo_desde' | 'periodo_hasta' | 'estado' | 'certificado_numero' | 'ejercicio'
>

export default function ReceptorDocuments() {
  const { t } = useT()
  const org = useOrganitzacio('entidad')
  const orgId = org?.id ?? null

  const [albarans, setAlbarans] = useState<AlbaranBandeja[]>([])
  const [docs, setDocs] = useState<DocFila[]>([])
  const [convenis, setConvenis] = useState<ConveniFila[]>([])
  const [certificats, setCertificats] = useState<CertificatFila[]>([])
  const [acumulat, setAcumulat] = useState<KgRebutsExercici | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const carrega = useCallback(async () => {
    // ⚠️ Cada lista de columnas, en UN literal (§7, deuda 46).
    // `ENT` y `R-ENT`: una entrega rectificada sigue siendo una entrega suya, y esconderla
    // dejaría a la entidad sin el documento que de verdad vale.
    const { data: albData, error: err } = await supabase
      .from('v_albaranes_bandeja')
      .select('id, tipo, numero_completo, estado, ejercicio, excedente_id, espigolada_id, canalizacion_id, id_excedente, producto, productor_id, entidad_id, codigo_lote, emitido_at, entregado_at, confirmado_at, conciliado_at, rechazo, kg_previstos, kg_neto, kg_confirmados, kg_validados, dias_esperando')
      .in('tipo', ['ENT', 'R-ENT'])
      .order('emitido_at', { ascending: false, nullsFirst: true })
    if (err) return { err }

    // Sin filtrar por `objeto_tipo`: hacen falta también los convenios, el plan y los
    // certificados de recepción, y la RLS ya devuelve solo los documentos de sus
    // organizaciones (`documents_meus()`).
    const { data: docData } = await supabase
      .from('documentos')
      .select('id, objeto_id, objeto_tipo, tipo, subtipo, numero_completo, estado, vigente, ejercicio, emitido_at, sha256_datos')
      .eq('vigente', true)
      .order('emitido_at', { ascending: false })

    // Por columna, como en el panel del productor: una cuenta con doble rol vería si no
    // los convenios de su ficha de productor, que no son de esta pantalla.
    const { data: convData } = orgId
      ? await supabase
        .from('convenios')
        .select('id, tipo, tipo_org, estado, numero_completo, ejercicio, enviado_at, firmado_at, contrafirmado_at, created_at')
        .eq('entidad_id', orgId)
        .order('created_at', { ascending: false })
      : { data: [] }

    // Los certificados de recepción EMITIDOS. Los borradores sin número no se enseñan: son
    // cálculos del equipo probando una ventana, no un papel que exista (deuda §12.112).
    const { data: certData } = orgId
      ? await supabase
        .from('cierres_receptor')
        .select('id, periodo_desde, periodo_hasta, estado, certificado_numero, ejercicio')
        .eq('entidad_id', orgId)
        .not('certificado_numero', 'is', null)
        .order('periodo_hasta', { ascending: false })
      : { data: [] }

    // 🔴 El acumulado del año lo calcula la BASE (`kg_rebuts_exercici`), no este navegador.
    //    Sumar aquí las canalizaciones sería la forma de que esta cifra y la del
    //    certificado acaben diciendo cosas distintas sobre exactamente lo mismo.
    const acum = orgId ? await kgRebutsExercici(orgId) : null

    return {
      albarans: (albData as AlbaranBandeja[] | null) ?? [],
      docs: (docData as DocFila[] | null) ?? [],
      convenis: (convData as ConveniFila[] | null) ?? [],
      certificats: (certData as CertificatFila[] | null) ?? [],
      acumulat: acum && acum.ok ? acum.data : null,
      err: null,
    }
  }, [orgId])

  const aplica = useCallback((r: Awaited<ReturnType<typeof carrega>>) => {
    setAlbarans(r.albarans ?? [])
    setDocs(r.docs ?? [])
    setConvenis(r.convenis ?? [])
    setCertificats(r.certificats ?? [])
    setAcumulat(r.acumulat ?? null)
  }, [])

  const refresca = useCallback(async () => {
    const r = await carrega()
    if (r.err) { setError(r.err.message); return }
    aplica(r)
  }, [carrega, aplica])

  useEffect(() => {
    let viu = true
    void (async () => {
      const r = await carrega()
      if (!viu) return
      if (r.err) { setError(r.err.message); setCarregant(false); return }
      aplica(r)
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega, aplica])

  const descarregador = useDescarregaDocument(refresca)

  if (!org) return <p className="text-sm text-muted-foreground">{t('mydoc.no_org_entity')}</p>
  if (carregant) return <CarregantSeccio />
  if (error) return <p className="text-sm text-destructive">{error}</p>

  const docsCr = docs.filter((d) => d.objeto_tipo === 'cierre_receptor')
  const perCertificat = Object.fromEntries(certificats.map((c) => [c.id, c]))
  // El sello se ofrece del certificado VIGENTE, que es el primero de la lista: los
  // `cierres_receptor` vienen ordenados por fin de periodo y `documentos` solo trae los
  // `vigente`. Ofrecer uno por cada certificado pondría en una web el sello de un papel
  // que otro posterior ya ha sustituido.
  const docSegell = docsCr.find((d) => d.estado === 'emitido' && codiVerificacio(d.sha256_datos))
  const codiSegell = docSegell ? codiVerificacio(docSegell.sha256_datos) : null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t('entdoc.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('entdoc.subtitle')}</p>
      </div>

      {/* Lo único de esta pantalla que le pide algo. El resto es archivo. */}
      <PendentsDeTu tipusOrg="entidad" tornarA="/receptor/documents" />

      <LlistaConvenis files={convenis} docs={docs} descarregador={descarregador} />

      {/* --- Lo que ha recibido este año, en kilos --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('entdoc.kg_title', { any: acumulat?.ejercicio ?? new Date().getFullYear() })}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('entdoc.kg_hint')}</p>
        </CardHeader>
        <CardContent>
          {!acumulat || Number(acumulat.kg_total) <= 0
            ? <p className="text-sm text-muted-foreground">{t('entdoc.kg_empty')}</p>
            : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Xifra etiqueta={t('entdoc.kg_total')} valor={`${kg(acumulat.kg_total)} kg`} gran />
                  <Xifra etiqueta={t('entdoc.kg_donacio')} valor={`${kg(acumulat.kg_donacio)} kg`} />
                  <Xifra etiqueta={t('entdoc.kg_compra')} valor={`${kg(acumulat.kg_compra)} kg`} />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t('entdoc.kg_ops', { n: acumulat.operacions })}
                </p>

                {/* 🔴 Lo pendiente de conciliar NO es oficial (D13), y hay que decirlo: si
                    no, la entidad suma las dos cifras y pide un certificado por un número
                    que el documento nunca va a dar. En ámbar, no en rojo: no está roto,
                    está a medias. */}
                {Number(acumulat.kg_pendents) > 0 && (
                  <p className="mt-3 rounded-md bg-aviso-fondo p-2 text-sm text-aviso">
                    {t('entdoc.kg_pending', {
                      kg: kg(acumulat.kg_pendents),
                      n: acumulat.operacions_pendents,
                    })}
                  </p>
                )}
              </>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('entdoc.alb_title')}</CardTitle></CardHeader>
        <CardContent>
          {albarans.length === 0
            ? <p className="text-sm text-muted-foreground">{t('entdoc.empty')}</p>
            : <TaulaAlbarans files={albarans} docs={docs} descarregador={descarregador} />}
        </CardContent>
      </Card>

      {/* --- Sus certificados de recepción (`CR`): lo que puede enseñar a un tercero --- */}
      <LlistaDocuments
        files={docsCr}
        descarregador={descarregador}
        titolKey="entdoc.cr_title"
        buitKey="entdoc.cr_empty"
        extra={(d) => {
          const c = perCertificat[d.objeto_id]
          if (!c) return null
          return (
            <p className="text-xs">
              {t('mydoc.cdp_period', {
                desde: dataCurta(c.periodo_desde),
                fins: dataCurta(c.periodo_hasta),
              })}
              {/* Un certificado sustituido por otro posterior sigue siendo auténtico, pero
                  ya no es el que vale: decirlo aquí evita que se enseñe el que no toca. */}
              {c.estado === 'substituit' && (
                <span className="ml-1 text-muted-foreground">{t('entdoc.cr_substituit')}</span>
              )}
            </p>
          )
        }}
      />

      {codiSegell && (
        <SegellRedestina codi={codiSegell} numero={docSegell?.numero_completo ?? null} />
      )}

      {/* Se lista desde `documentos` porque no hay pantalla de planes: lo único que existe
          del plan de prevención es su PDF. */}
      <LlistaDocuments
        files={docs.filter((d) => d.objeto_tipo === 'plan')}
        descarregador={descarregador}
        titolKey="mydoc.pla_title"
        buitKey="mydoc.pla_empty"
      />

      {/* El visor de PDF. Una sola vez por pantalla: el hook es uno y el modal también. */}
      {descarregador.visor}
    </div>
  )
}

function Xifra({ etiqueta, valor, gran }: { etiqueta: string; valor: string; gran?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className={`font-titulos tabular-nums ${gran ? 'text-2xl font-semibold' : 'text-lg'}`}>
        {valor}
      </p>
    </div>
  )
}
