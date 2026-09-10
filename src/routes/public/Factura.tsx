// `/factura/:token` — la parte pública del cierre anual.
//
// LA ABRE EL DONANTE, casi siempre desde el móvil y desde el correo que le mandamos con su
// resumen anual. No tiene cuenta. Es hermana de `/confirmar/:token` y comparte con ella
// todo lo que allí se decidió: fuera de `RequireSessio`, sin `AppContextProvider`, una
// columna, controles de 44 px, `text-base` en todo lo que se enfoca, y un mensaje propio
// para cada final del enlace (no existe, ya usado, caducado) porque lo que hay que hacer
// después es distinto en cada caso.
//
// LO QUE ESTA PANTALLA TIENE QUE HACER BIEN ES UNA COSA: **enseñar el importe esperado
// antes de que suba nada**. La factura que no cuadra no es un fallo de la persona, es un
// fallo de la pantalla que se lo escondió: el servidor compara con `valor_total` a dos
// decimales y, si no coincide, la operación queda en `discrepancia` y alguien del equipo
// tiene que llamar por teléfono. Por eso el importe va en grande y arriba, antes del
// formulario, y no como una nota al pie.
//
// AQUÍ SÍ HAY DINERO, al revés que en el albarán. Es exactamente el sitio donde lo hay.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { FileUp, Loader2, Upload } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { carregaFactura, pujaFactura } from '../../lib/enllacPublic'
import type { DadesFactura, ResultatFactura } from '../../lib/enllacPublic'
// El formateador de euros vive con el cierre porque es donde nació; es una función pura y
// no hay motivo para tener dos.
import { euros } from '../../lib/tancament'
import LayoutAcces from '../../components/LayoutAcces'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Los kilos, con separador de miles y sin decimales de más. */
function kilos(v: number | null): string {
  if (v === null) return '—'
  return `${v.toLocaleString('es-ES', { maximumFractionDigits: 2 })} kg`
}

/** «2,4 MB». Para decir el límite y el tamaño del fichero elegido con la misma unidad. */
function megues(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`
}

export default function Factura() {
  const { t } = useT()
  const { token } = useParams<{ token: string }>()

  const [dades, setDades] = useState<DadesFactura | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [resultat, setResultat] = useState<ResultatFactura | null>(null)
  const [enviant, setEnviant] = useState(false)

  const [numero, setNumero] = useState('')
  const [data, setData] = useState('')
  const [importe, setImporte] = useState('')
  const [nom, setNom] = useState('')
  const [fitxer, setFitxer] = useState<File | null>(null)
  const [errorFitxer, setErrorFitxer] = useState<string | null>(null)
  // Honeypot. Una persona nunca lo ve ni lo rellena; un robot que rellena el formulario
  // entero, sí. Mismo mecanismo que `/confirmar` y que el registro público (§9).
  const [web, setWeb] = useState('')

  const inputFitxer = useRef<HTMLInputElement | null>(null)

  const carrega = useCallback(async () => {
    if (!token) { setErrorKey('conf.err_no_existeix'); setCarregant(false); return }
    const res = await carregaFactura(token)
    if (!res.ok) { setErrorKey(res.motiuKey); setCarregant(false); return }
    setDades(res.data)
    setCarregant(false)
  }, [token])

  useEffect(() => { void carrega() }, [carrega])

  /** Se comprueba el fichero aquí antes de gastar la subida: en 4G, 10 MB de más son
   *  medio minuto tirado para acabar leyendo el mismo «no cabe» que diría el servidor. */
  function triaFitxer(f: File | null) {
    setErrorFitxer(null)
    if (!f) { setFitxer(null); return }
    const mimes = dades?.formulari.mimes ?? []
    if (mimes.length > 0 && !mimes.includes(f.type)) {
      setFitxer(null); setErrorFitxer('fact.err_mime'); return
    }
    const max = dades?.formulari.maxBytes ?? 0
    if (max > 0 && f.size > max) {
      setFitxer(null); setErrorFitxer('fact.err_massa_gran'); return
    }
    setFitxer(f)
  }

  async function envia() {
    if (!token || !fitxer) return
    setEnviant(true)
    const net = importe.trim().replace(/\s/g, '').replace(',', '.')
    const res = await pujaFactura(token, {
      numero: numero.trim(),
      data: data || null,
      importe: net === '' || Number.isNaN(Number(net)) ? null : Number(net),
      nom: nom.trim() || null,
      fitxer,
      web,
    })
    setEnviant(false)
    if (!res.ok) { setErrorKey(res.motiuKey); return }
    setResultat(res.data)
  }

  // ── Estados terminales ──
  if (carregant) {
    return (
      <LayoutAcces ample>
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />{t('c.loading')}
          </CardContent>
        </Card>
      </LayoutAcces>
    )
  }

  if (!dades || errorKey) {
    return (
      <LayoutAcces ample>
        <Card>
          <CardHeader><CardTitle>{t('fact.problem')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{t(errorKey ?? 'conf.err_generic')}</p>
            <p className="text-sm text-muted-foreground">{t('fact.problem_help')}</p>
            {/* Con los datos ya cargados, el error es del envío y se puede reintentar sin
                perder lo escrito. Sin ellos no hay a qué volver. */}
            {dades && (
              <Button variant="outline" className="h-11 w-full whitespace-normal"
                onClick={() => { setErrorKey(null) }}>
                {t('conf.retry')}
              </Button>
            )}
          </CardContent>
        </Card>
      </LayoutAcces>
    )
  }

  if (resultat) {
    // Tres finales, y solo uno es «ya está». Decir «rebuda» cuando el importe no cuadra
    // haría que la persona se olvidara del asunto justo cuando hay que arreglarlo.
    const cuadra = resultat.estat === 'coincident'
    const discrepa = resultat.estat === 'discrepancia'
    return (
      <LayoutAcces ample>
        <Card>
          <CardHeader><CardTitle>{t(cuadra ? 'fact.done_title' : 'fact.done_title_check')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              {t(cuadra ? 'fact.done_ok' : discrepa ? 'fact.done_diff' : 'fact.done_noamount')}
            </p>
            {discrepa && (
              <div className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">
                <p className="tabular-nums">
                  {t('fact.done_diff_detail', {
                    yours: euros(resultat.importe),
                    ours: euros(resultat.importEsperat),
                  })}
                </p>
              </div>
            )}
            <p className="text-sm tabular-nums text-muted-foreground">
              {t('fact.done_number', { number: resultat.numero })}
            </p>
          </CardContent>
        </Card>
      </LayoutAcces>
    )
  }

  const potEnviar = numero.trim() !== '' && fitxer !== null && !enviant
  const r = dades.resum

  return (
    <LayoutAcces ample>
      <Card>
        <CardHeader>
          <CardTitle>{t('fact.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {r.numero ?? t('fact.no_number')}
            {r.exercici !== null ? ` · ${r.exercici}` : ''}
          </p>
        </CardHeader>

        {/* Una sola columna, siempre: a 360 px dos columnas obligan a hacer zoom. */}
        <CardContent className="space-y-5">
          {/* ── Ensayo ──
              Va lo primero, antes incluso del importe: quien abre una prueba tiene que
              saberlo ANTES de ponerse a buscar su factura. La filigrana del PDF dice lo
              mismo; esto no puede decir menos. */}
          {r.mode !== 'real' && (
            <div className="rounded-md bg-aviso-fondo p-3">
              <p className="text-sm font-medium text-aviso">{t('fact.test_title')}</p>
              <p className="mt-1 text-sm text-aviso">{t('fact.test_body')}</p>
            </div>
          )}

          <p className="text-sm">{t('fact.intro')}</p>

          {/* ── EL IMPORTE ──
              La cifra que la factura tiene que llevar, en grande y antes del formulario.
              `tabular-nums` para que no baile, y `break-words` porque en una donación
              grande esto son ocho caracteres a 360 px. */}
          <div className="rounded-md bg-secondary p-4">
            <p className="text-sm text-secondary-foreground">{t('fact.expected_amount')}</p>
            <p className="mt-1 break-words font-titulos text-3xl font-semibold tabular-nums text-secondary-foreground">
              {euros(r.importEsperat)}
            </p>
            <p className="mt-2 text-sm tabular-nums text-secondary-foreground">
              {t('fact.expected_kg', { kg: kilos(r.kgTotal) })}
            </p>
          </div>

          {(r.donant || r.nif) && (
            <div className="space-y-1 text-sm text-muted-foreground">
              {r.donant && <p>{r.donant}</p>}
              {r.nif && <p className="tabular-nums">{r.nif}</p>}
            </div>
          )}

          {/* ── Bloqueos ──
              Los pone el cierre: si algo impide cerrar esta donación, la persona lo sabe
              aquí y no después de subir un documento que no servirá de nada. */}
          {r.bloquejos.length > 0 && (
            <div className="rounded-md bg-aviso-fondo p-3">
              <p className="text-sm font-medium text-aviso">{t('fact.blocked')}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-aviso">
                {r.bloquejos.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </div>
          )}

          {dades.pdf_url && (
            <Button asChild variant="outline" className="h-11 w-full whitespace-normal">
              {/* URL firmada de 60 s que da el servidor. Nunca se compone una de Storage. */}
              <a href={dades.pdf_url} target="_blank" rel="noopener noreferrer">{t('fact.see_pdf')}</a>
            </Button>
          )}

          {/* Ya hay una factura registrada: no se impide subir otra —puede ser una
              rectificativa— pero se dice, para que nadie la mande dos veces sin querer. */}
          {r.facturaNumero && (
            <p className="text-sm tabular-nums text-muted-foreground">
              {t('fact.already', { number: r.facturaNumero })}
            </p>
          )}

          {/* ── El formulario ── */}
          <div className="space-y-1.5">
            <Label htmlFor="fact-numero">{t('fact.f_number')}</Label>
            <Input id="fact-numero" className="h-11" value={numero}
              onChange={(e) => setNumero(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fact-data">{t('fact.f_date')}</Label>
            <Input id="fact-data" type="date" className="h-11" value={data}
              onChange={(e) => setData(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fact-importe">{t('fact.f_amount')}</Label>
            {/* NO se rellena con el importe esperado a propósito: un campo precargado con
                la cifra que queremos oír convierte la comprobación en una formalidad y
                deja pasar facturas que dicen otra cosa. */}
            <Input id="fact-importe" type="number" inputMode="decimal" step="0.01" className="h-11"
              value={importe} onChange={(e) => setImporte(e.target.value)} />
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('fact.f_amount_hint', { amount: euros(r.importEsperat) })}
            </p>
          </div>

          {/* ── El fichero ──
              El `<input type=file>` va escondido y lo dispara el botón: es el único
              control que no se puede pintar con el sistema de diseño, y aquí además es la
              acción principal. Mismo patrón que `productor/Documents.tsx`. */}
          <div className="space-y-1.5">
            <Label htmlFor="fact-fitxer">{t('fact.f_file')}</Label>
            <input
              ref={inputFitxer}
              id="fact-fitxer"
              type="file"
              accept={dades.formulari.mimes.join(',')}
              className="hidden"
              onChange={(e) => { triaFitxer(e.target.files?.[0] ?? null); e.target.value = '' }}
            />
            <Button type="button" variant="outline" className="h-11 w-full whitespace-normal"
              onClick={() => inputFitxer.current?.click()}>
              <FileUp className="mr-1 size-4" aria-hidden />
              {t(fitxer ? 'fact.f_file_change' : 'fact.f_file_pick')}
            </Button>
            {fitxer && (
              <p className="break-all text-sm text-muted-foreground">
                {fitxer.name} · <span className="tabular-nums">{megues(fitxer.size)}</span>
              </p>
            )}
            {errorFitxer && <p className="text-sm text-error">{t(errorFitxer)}</p>}
            <p className="text-xs text-muted-foreground">
              {t('fact.f_file_hint', { max: megues(dades.formulari.maxBytes) })}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fact-nom">{t('fact.f_who')}</Label>
            <Input id="fact-nom" className="h-11" autoComplete="name" value={nom}
              onChange={(e) => setNom(e.target.value)} />
          </div>

          {/* Trampa para robots: una persona no ve este campo y por tanto no lo rellena. */}
          <input
            type="text" name="web" value={web} onChange={(e) => setWeb(e.target.value)}
            tabIndex={-1} autoComplete="off" aria-hidden="true"
            className="hidden"
          />

          <Button className="h-11 w-full whitespace-normal" disabled={!potEnviar}
            onClick={() => void envia()}>
            {enviant
              ? <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
              : <Upload className="mr-1 size-4" aria-hidden />}
            {enviant ? t('fact.sending') : t('fact.submit')}
          </Button>
          {!potEnviar && !enviant && (
            <p className="text-xs text-muted-foreground">
              {t(numero.trim() === '' ? 'fact.need_number' : 'fact.need_file')}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t('fact.legal')}</p>
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}
