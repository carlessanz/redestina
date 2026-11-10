// El diagnóstico operativo de un productor, en LECTURA (A1, `20270520100000`).
//
// Lo pintan dos sitios con el mismo dato: la pestaña «Diagnòstic i perfil» de la ficha del
// equipo (`EntitatDetall`, `veu="equip"`) y «El meu diagnòstic» del propio productor
// (`routes/Diagnostic.tsx`, `veu="extern"`). Desde A1 el diagnóstico lo conduce el equipo
// (D5) y el productor lo lee: aquí no hay ni un control de formulario.
//
// Las respuestas llegan YA COMPUESTAS por el servidor (`diagnostic_datos()`: pregunta y
// etiquetas `{ca, es}` congeladas en el sobre), así que esta pantalla no necesita el
// cuestionario para leerlas y enseña exactamente lo que imprimirá el PDF (A2).
//
// A4 (`20270521100000`): arriba va la OPERATIVA de la ficha (clave `operativa`), que ya no es
// parte del cuestionario sino columnas de `productores` (T4): `filesOperativa()` la pone en
// filas. Se enseña aunque el cuestionario esté vacío.
//
// A2: «Descarrega el PDF» pide a `diagnostic-pdf` el PDF de ESTE estado (`lib/diagnosticPdf.ts`),
// sin documento emitido (D2). Lo tienen las dos voces: el equipo y el propio productor.

import { useEffect, useMemo, useState } from 'react'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { dataCurta } from '../../lib/format'
import { agrupaRespostes, estilEstatDiagnostic, respostaLlegible, textBilingue } from '../../lib/diagnostic'
import { diagnosticDatos } from '../../lib/diagnosticApi'
import { filesOperativa } from '../../lib/operativaLlegible'
import { descarregarDiagnosticPdf } from '../../lib/diagnosticPdf'
import { carregaTipusActivitat, type TipusActivitat } from '../../lib/organitzacio'
import type { DiagnosticDatos } from '../../types'
import CarregantSeccio from '../CarregantSeccio'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Download, Loader2 } from 'lucide-react'

export default function ResumDiagnostic({
  productorId, veu,
}: {
  productorId: string
  /** Quién lee: el equipo (tercera persona) o el propio productor (segunda). */
  veu: 'equip' | 'extern'
}) {
  const { t, lang } = useT()
  const [dades, setDades] = useState<DiagnosticDatos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [activitats, setActivitats] = useState<TipusActivitat[]>([])
  useEffect(() => { void carregaTipusActivitat().then(setActivitats) }, [])
  const [generantPdf, setGenerantPdf] = useState(false)
  const [errorPdf, setErrorPdf] = useState<string | null>(null)

  async function descarregaPdf() {
    setGenerantPdf(true)
    setErrorPdf(null)
    const r = await descarregarDiagnosticPdf(productorId, lang)
    setGenerantPdf(false)
    if (!r.ok) setErrorPdf(r.motiuKey)
  }

  useEffect(() => {
    let viu = true
    setCarregant(true)
    void diagnosticDatos('productor', productorId).then((r) => {
      if (!viu) return
      if (r.ok) { setDades(r.data); setError(null) } else { setDades(null); setError(r.missatge) }
      setCarregant(false)
    })
    return () => { viu = false }
  }, [productorId])

  const operativa = useMemo(() => {
    const noms = new Map(activitats.map((a) => [a.codi, lang === 'es' ? a.nom_es : a.nom_ca]))
    return filesOperativa(dades?.operativa, t, lang, (c) => noms.get(c) ?? c)
  }, [activitats, dades, lang, t])

  if (carregant) return <CarregantSeccio files={3} ambCapcalera={false} />
  // Se traduce al pintar: el mensaje puede ser una clave i18n.
  if (error || !dades) return <p className="text-sm text-destructive">{textError(t, error ?? 'diag.err_generic')}</p>

  const seccions = agrupaRespostes(dades.respostes ?? [])

  // El PDF lleva lo mismo que esta pantalla: si no hay nada que enseñar, no hay botón.
  const botoPdf = (dades.diagnostic_id || operativa.length > 0) && (
    <div className="space-y-1">
      <Button
        type="button" variant="outline" size="sm" onClick={() => void descarregaPdf()}
        disabled={generantPdf} data-testid="diagnostic-pdf"
      >
        {generantPdf ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
        {generantPdf ? t('diag.pdf_generant') : t('diag.pdf_descarrega')}
      </Button>
      {errorPdf && <p className="text-sm text-destructive" role="alert">{t(errorPdf)}</p>}
    </div>
  )

  const seccioOperativa = operativa.length > 0 && (
    <section className="space-y-1" aria-labelledby="resum-operativa" data-testid="resum-operativa">
      <h4 id="resum-operativa" className="text-sm font-semibold">{t('diag.sec_operativa')}</h4>
      <dl className="divide-y divide-border">
        {operativa.map((f) => (
          <div key={f.clau} className="grid gap-1 py-2 sm:grid-cols-2 sm:gap-4">
            <dt className="text-sm text-muted-foreground">{t(f.clau)}</dt>
            <dd className="text-sm break-words whitespace-pre-line">{f.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  )

  // Sin ninguna respuesta guardada no hay resumen: se dice qué pasa y quién lo hace (y la
  // Operativa, si la ficha ya la tiene, se enseña igual).
  if (!dades.diagnostic_id || seccions.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground" data-testid="resum-diagnostic-buit">
          {t(veu === 'equip' ? 'diag.resum_buit_equip' : 'diag.resum_buit_extern')}
        </p>
        {seccioOperativa}
        {botoPdf}
      </div>
    )
  }

  const estat = dades.complet ? 'complet' : 'incomplet'
  const data = dataCurta(dades.actualitzat_at)

  return (
    <div className="space-y-4" data-testid="resum-diagnostic">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={estilEstatDiagnostic(estat)}>{t(`diag.st_${estat}`)}</Badge>
        {/* Que el cuestionario sea texto de trabajo se dice también aquí: el PDF lo llevará impreso. */}
        {dades.provisional && <Badge variant="outline">{t('diag.provisional_badge')}</Badge>}
        <span className="text-sm text-muted-foreground">
          {dades.actualitzat_per_nom
            ? t('diag.actualitzat_per', { data, nom: dades.actualitzat_per_nom })
            : t('diag.actualitzat', { data })}
        </span>
      </div>

      {botoPdf}

      {!dades.complet && dades.falten.length > 0 && (
        <p className="text-sm text-aviso">{t('diag.missing', { n: dades.falten.length })}</p>
      )}

      {seccioOperativa}

      {seccions.map((s) => (
        <section key={s.seccio} className="space-y-1" aria-labelledby={`resum-${s.seccio}`}>
          <h4 id={`resum-${s.seccio}`} className="text-sm font-semibold">{s.clau ? t(s.clau) : s.seccio}</h4>
          <dl className="divide-y divide-border">
            {s.respostes.map((r) => (
              <div key={r.id} className="grid gap-1 py-2 sm:grid-cols-2 sm:gap-4">
                <dt className="text-sm text-muted-foreground">{textBilingue(r.pregunta, lang) || r.id}</dt>
                <dd className="text-sm break-words whitespace-pre-line">{respostaLlegible(r, lang) || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      {dades.notes && dades.notes.trim() !== '' && (
        <section className="space-y-1">
          <h4 className="text-sm font-semibold">{t('diag.resum_notes')}</h4>
          <p className="text-sm break-words whitespace-pre-line">{dades.notes}</p>
        </section>
      )}
    </div>
  )
}
