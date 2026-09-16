// «Pendent de tu»: lo que espera la firma o la confirmación de esta organización.
//
// Es la pieza que faltaba para que el panel externo sirva de algo más que de archivo. Hasta
// ahora, un convenio pendiente solo se podía firmar desde el enlace del correo; si ese
// correo se perdió o caducó, la persona veía un aviso que decía «mira el correu» y no tenía
// ninguna salida dentro de la aplicación.
//
// CÓMO FUNCIONA EL BOTÓN. No abre un formulario nuevo: pide a la base un enlace propio
// (`acunar_enllac_propi`, canal `panel`, una hora) y navega a `/signar/:token` o
// `/confirmar/:token`, que son las páginas públicas de siempre. Así el texto que se firma
// lo sigue componiendo el servidor, la huella es la misma y la evidencia queda igual: no
// hay un segundo circuito de firma, que sería un segundo sitio donde equivocarse.
//
// ⚠️ ACUÑAR REVOCA EL ENLACE ANTERIOR. Lo hace la base, como `enviar_convenio()`. El del
//    correo deja de valer, y por eso el botón dice lo que hace en vez de aparecer como un
//    «continuar» inocente.
//
// Sin nada pendiente no se pinta NADA: un bloque vacío en la cabecera de la pantalla le
// quitaría sitio a lo que sí hay que ver.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileSignature, Loader2, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { acunarEnllacPropi, carregaPendents } from '../../lib/pendents'
import DialegFirmaConveni from '../DialegFirmaConveni'
import type { Pendent } from '../../lib/pendents'
import { rutaPerProposit } from '../../lib/documentsPanell'
import { dataCurta } from '../../lib/albarans'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function PendentsDeTu({
  tipusOrg,
  tornarA,
}: {
  tipusOrg: 'productor' | 'entidad'
  /** A dónde vuelve la página pública al terminar. */
  tornarA: string
}) {
  const { t } = useT()
  const navigate = useNavigate()
  const [files, setFiles] = useState<Pendent[]>([])
  const [obrint, setObrint] = useState<string | null>(null)

  const carrega = useCallback(async () => {
    const r = await carregaPendents()
    // Un fallo aquí no se grita: esto es un bloque de aviso, y una pantalla de documentos
    // que no se pinta por no poder listar lo pendiente sería peor que el aviso que falta.
    if (r.ok) setFiles(r.data.filter((p) => p.tipo_org === tipusOrg))
  }, [tipusOrg])

  useEffect(() => { void carrega() }, [carrega])

  /** Identifica la fila: en un OPE hay dos, una por parte. */
  const clau = (p: Pendent) => `${p.objeto_id}:${p.rol_parte ?? ''}`

  // FIRMAR UN CONVENIO SE HACE AQUÍ MISMO, en un diálogo, desde el 16-09-2026: salir a la
  // página pública sacaba de la aplicación y metía el convenio en una columna de 28rem.
  // El diálogo acuña su propio enlace (`signar_conveni_propi`), así que este camino no
  // necesita `acunarEnllacPropi` — y por eso no se llama antes de abrirlo: serían dos
  // enlaces, y el segundo revocaría al primero.
  //
  // ⚠️ La CONFIRMACIÓN DE ALBARÁN sigue navegando a `/confirmar/:token`. No es olvido: esa
  //    pantalla se abre sobre todo desde el correo y desde una finca, y llevarla a un
  //    diálogo es el mismo trabajo otra vez. Queda pendiente.
  const [firmant, setFirmant] = useState<{ tipus: 'productor' | 'entidad'; org: string } | null>(null)

  async function obre(p: Pendent) {
    if (obrint) return
    if (p.proposito === 'firma_convenio') {
      setFirmant({ tipus: p.tipo_org === 'entidad' ? 'entidad' : 'productor', org: p.org_id })
      return
    }
    setObrint(clau(p))
    const r = await acunarEnllacPropi(p)
    setObrint(null)
    if (!r.ok) { toast.error(r.missatge || t('pend.err_generic')); return }
    // `url_path` lo compone la base; `rutaPerProposit` es el respaldo si un día no viniera.
    const desti = r.data.url_path || rutaPerProposit(p.proposito, r.data.token)
    navigate(desti, { state: { tornar: tornarA } })
  }

  if (files.length === 0) return null

  return (
    <Card className="border-aviso/30 bg-aviso-fondo">
      <CardHeader>
        <CardTitle className="text-base text-aviso">{t('pend.title')}</CardTitle>
        <p className="mt-1 text-sm text-aviso">{t('pend.subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {files.map((p) => {
          const esConveni = p.proposito === 'firma_convenio'
          const Icona = esConveni ? FileSignature : PackageCheck
          const titol = esConveni
            ? t(`sig.model_${p.tipus}`)
            : `${t(`doc.tipus_${p.tipus}`)}${p.numero ? ` · ${p.numero}` : ''}`
          const caducat = p.enlace_estado_efectivo === 'caducado'
          return (
            <div
              key={clau(p)}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Icona className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{titol}</span>
                  {esConveni && p.numero && (
                    <span className="text-sm text-muted-foreground tabular-nums">{p.numero}</span>
                  )}
                  {/* En un OPE la misma organización puede tener las dos partes: sin esto,
                      dos filas idénticas sin forma de saber cuál es cuál. */}
                  {p.rol_parte && (
                    <Badge variant="outline">{t(`pend.part_${p.rol_parte}`)}</Badge>
                  )}
                </div>
                {p.etiqueta && <p className="text-sm text-muted-foreground">{p.etiqueta}</p>}
                {p.estat_objecte === 'retornat' && p.motiu && (
                  <p className="text-sm text-aviso">{t('pend.returned', { motiu: p.motiu })}</p>
                )}
                {caducat
                  ? <p className="text-xs text-muted-foreground">{t('pend.link_expired')}</p>
                  : p.enlace_created_at && p.enlace_canal === 'email' && (
                    <p className="text-xs text-muted-foreground">
                      {t('pend.sent_on', { data: dataCurta(p.enlace_created_at) })}
                    </p>
                  )}
              </div>
              <Button
                className="h-11 shrink-0 whitespace-normal"
                disabled={obrint !== null}
                onClick={() => void obre(p)}
              >
                {obrint === clau(p) && <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />}
                {obrint === clau(p)
                  ? t('pend.opening')
                  : esConveni ? t('pend.sign') : t('pend.confirm')}
              </Button>
            </div>
          )
        })}
      </CardContent>

      {/* Firmar sin salir del panel. Al cerrar se relee la lista: el convenio que se acaba
          de firmar ya no está pendiente y la tarjeta desaparece sola. */}
      {firmant && (
        <DialegFirmaConveni
          obert
          tipusOrg={firmant.tipus}
          orgId={firmant.org}
          onTancar={() => setFirmant(null)}
          onFirmat={() => { setFirmant(null); void carrega() }}
        />
      )}
    </Card>
  )
}
