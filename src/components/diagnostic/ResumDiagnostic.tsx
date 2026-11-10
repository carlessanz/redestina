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
//
// A3 (`20270522100000`): después de la Operativa, los EXCEDENTES por producto principal × causa
// (clave `excedents`, leída con `lib/excedentsLlegible.ts`, lo mismo que imprime el PDF): por
// producto, «Sense excedent» o sus causas con frecuencia, kilos, gestión actual, destinos y
// detalle, y las acciones con su estado y su nota de seguimiento. Las respuestas del cuestionario
// v3 solo salen, como «Respostes del qüestionari anterior», si no hay ningún bloque (como el PDF).
// Lo que falta (`falten`) se dice en texto (`dexc.falta_*`), no como código.

import { useEffect, useMemo, useState } from 'react'
import { useT } from '../../lib/i18n'
import { textError } from '../../lib/textError'
import { dataCurta } from '../../lib/format'
import { agrupaRespostes, estilEstatDiagnostic, respostaLlegible, textBilingue } from '../../lib/diagnostic'
import { diagnosticDatos } from '../../lib/diagnosticApi'
import { filesOperativa } from '../../lib/operativaLlegible'
import {
  blocsExcedents, filesAccions, filesCausa, nomCausa, titolBloc, type BlocExcedentsLlegible,
} from '../../lib/excedentsLlegible'
import { estilEstatAccio, textFalta } from '../../lib/excedentsDiagnostic'
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

  const blocs = blocsExcedents(dades.excedents)
  // El legado v3, solo si no hay ningún bloque (el mismo criterio que el PDF).
  const seccions = blocs.length > 0 ? [] : agrupaRespostes(dades.respostes ?? [])
  // Los nombres de las causas, para traducir `dades:<producte>:<causa>`.
  const nomsCausa = new Map(blocs.flatMap((b) => b.causes.map((c) => [c.causa, nomCausa(c, lang)] as const)))

  // El PDF lleva lo mismo que esta pantalla: si no hay nada que enseñar, no hay botón.
  const botoPdf = (dades.diagnostic_id || operativa.length > 0 || blocs.length > 0) && (
    <div className="space-y-1">
      <Button
        type="button" variant="outline" size="sm" onClick={() => void descarregaPdf()}
        disabled={generantPdf} data-testid="diagnostic-pdf"
        className="h-11 whitespace-normal md:h-8"
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

  const seccioExcedents = blocs.length > 0 && (
    <section className="space-y-3" aria-labelledby="resum-excedents" data-testid="resum-excedents">
      <h4 id="resum-excedents" className="text-sm font-semibold">{t('dexc.titol')}</h4>
      {blocs.map((b) => <ResumBlocExcedents key={b.producte} bloc={b} />)}
    </section>
  )

  // Sin diagnóstico guardado no hay resumen: se dice qué pasa y quién lo hace (y la Operativa,
  // si la ficha ya la tiene, se enseña igual).
  if (!dades.diagnostic_id) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground" data-testid="resum-diagnostic-buit">
          {t(veu === 'equip' ? 'diag.resum_buit_equip' : 'diag.resum_buit_extern')}
        </p>
        {seccioOperativa}
        {seccioExcedents}
        {botoPdf}
      </div>
    )
  }

  const estat = dades.complet ? 'complet' : 'incomplet'
  const data = dataCurta(dades.actualitzat_at)

  return (
    <div className="space-y-4" data-testid="resum-diagnostic">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={estilEstatDiagnostic(estat)} data-testid="resum-estat">{t(`diag.st_${estat}`)}</Badge>
        {/* Que el cuestionario sea texto de trabajo se dice también aquí: el PDF lo llevará impreso. */}
        {dades.provisional && seccions.length > 0 && <Badge variant="outline">{t('diag.provisional_badge')}</Badge>}
        {dades.actualitzat_at && (
          <span className="text-sm text-muted-foreground">
            {dades.actualitzat_per_nom
              ? t('diag.actualitzat_per', { data, nom: dades.actualitzat_per_nom })
              : t('diag.actualitzat', { data })}
          </span>
        )}
      </div>

      {botoPdf}

      {!dades.complet && dades.falten.length > 0 && (
        <div className="space-y-1 rounded-lg border border-aviso/30 bg-aviso-fondo px-3 py-2" data-testid="resum-falten">
          <p className="text-sm font-medium text-aviso">{t('dexc.falten_t')}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {dades.falten.map((f) => (
              <li key={f} className="break-words">{textFalta(f, t, (c) => nomsCausa.get(c) ?? c)}</li>
            ))}
          </ul>
        </div>
      )}

      {seccioOperativa}
      {seccioExcedents}

      {seccions.length > 0 && (
        <section className="space-y-3" aria-labelledby="resum-anteriors" data-testid="resum-respostes-anteriors">
          <h4 id="resum-anteriors" className="text-sm font-semibold">{t('dexc.respostes_anteriors')}</h4>
          {seccions.map((s) => (
            <section key={s.seccio} className="space-y-1" aria-labelledby={`resum-${s.seccio}`}>
              <h5 id={`resum-${s.seccio}`} className="text-sm font-medium text-muted-foreground">{s.clau ? t(s.clau) : s.seccio}</h5>
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
        </section>
      )}

      {dades.notes && dades.notes.trim() !== '' && (
        <section className="space-y-1">
          <h4 className="text-sm font-semibold">{t('diag.resum_notes')}</h4>
          <p className="text-sm break-words whitespace-pre-line">{dades.notes}</p>
        </section>
      )}
    </div>
  )
}

/** Un producto en lectura: «Sense excedent» o sus causas, con las acciones y su estado. */
function ResumBlocExcedents({ bloc }: { bloc: BlocExcedentsLlegible }) {
  const { t, lang } = useT()
  const causes = filesCausa(bloc, t, lang)
  const accions = filesAccions(bloc, t, lang)
  return (
    <div className="space-y-2 rounded-lg border border-border p-3" data-testid={`resum-exc-${bloc.producte}`}>
      <h5 className="text-sm font-semibold break-words">{titolBloc(bloc, t)}</h5>
      {bloc.sense_excedent && <p className="text-sm">{t('dexc.sense_excedent')}</p>}
      {!bloc.sense_excedent && causes.map((c) => (
        <div key={c.codi} className="space-y-1 border-l-2 border-border pl-3">
          <p className="text-sm font-medium break-words">{c.causa}</p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {([
              ['dexc.frequencia', c.frequencia],
              ['dexc.volum_kg', c.volum],
              ['dexc.gestio', c.gestio],
              ['dexc.destins', c.destins],
              ['dexc.detall', c.detall],
            ] as const).filter(([, v]) => v !== '').map(([clau, v]) => (
              <div key={clau} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{t(clau)}</dt>
                <dd className="text-sm break-words whitespace-pre-line">{v}</dd>
              </div>
            ))}
          </dl>
          {accions.filter((a) => a.causa === c.causa).length > 0 && (
            <ul className="space-y-1.5 pt-1">
              {accions.filter((a) => a.causa === c.causa).map((a) => (
                <li key={a.id || `${a.causa}-${a.destiCodi}`} className="space-y-1 rounded-md bg-muted/50 px-2 py-1.5" data-testid="resum-accio">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">{t('dexc.accio')} · {a.desti}</span>
                    <Badge className={estilEstatAccio(a.estatCodi)}>{a.estat}</Badge>
                  </div>
                  <p className="text-sm break-words whitespace-pre-line">{a.descripcio}</p>
                  {a.notes && (
                    <p className="text-sm break-words whitespace-pre-line text-muted-foreground">
                      <span className="font-medium text-foreground">{t('dexc.seguiment')}:</span> {a.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {bloc.observacions && (
        <p className="text-sm break-words whitespace-pre-line">
          <span className="text-muted-foreground">{t('dexc.observacions')}:</span> {bloc.observacions}
        </p>
      )}
    </div>
  )
}
