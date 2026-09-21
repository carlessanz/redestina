// El formulario de confirmación de un albarán. Se usa en DOS sitios y es el mismo código:
//
//   · `/confirmar/:token`, la página pública — la abre quien recibe la entrega, casi
//     siempre desde el móvil y con el camión delante.
//   · Dentro de un diálogo, desde el panel del equipo — la confirmación **asistida**, que
//     el dinamizador conduce con la persona al teléfono (`acunar_enllac_assistit`, §9).
//
// Es hermano de `FirmaConveni` y se partió por lo mismo: NO PUEDE HABER DOS FORMULARIOS.
// Lo que se confirma, la huella que viaja de vuelta y la evidencia que se escribe son los
// mismos pasen por donde pasen; lo único que cambia es el marco, y lo dice `ample`.
//
// ⚠️ `ample` NO es «pantalla grande», es «tengo sitio». En la página pública va a `false`
//    SIEMPRE, incluso en un escritorio: esto se rellena de pie en una finca, y la columna
//    única con controles de 44 px es lo que lo hace posible.
//
// ⚠️ **Embeberlo en el panel NO lo convierte en una acción con sesión**: `enllacPublic.ts`
//    no manda `Authorization` en ninguno de sus `fetch`, y lo que autoriza sigue siendo el
//    token. Es lo que hace que la evidencia valga lo mismo por los dos caminos.
//
// LO QUE DECIDE CASI TODO LO DE ABAJO es que quien lo abre puede no tener cuenta:
//
//   · Móvil primero de verdad: una columna, controles de 44 px, `text-base` en todo lo que
//     se enfoca (por debajo de 16 px iOS amplía la página y no lo deshace, §2 regla 1).
//   · Los tres finales del enlace —no existe (404), ya usado (409), caducado (410)— tienen
//     cada uno su mensaje. Son situaciones distintas y lo que hay que hacer después también:
//     un enlace ya usado significa «esto ya está hecho», y un caducado, «pídenos otro».
//     Un «ha habido un error» los mete a los tres en el mismo saco y no ayuda a nadie.
//   · El motivo del rechazo es obligatorio cuando hay rechazo, y lo comprueba también el
//     servidor: la persona que recibe media tonelada de tomate en mal estado tiene que poder
//     decir por qué, y esa frase acaba en el correo al donante.
//
// NI UN IMPORTE, tampoco aquí. Un albarán no lleva dinero.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Loader2 } from 'lucide-react'
import { useT } from '../lib/i18n'
import { carregaEnllac, confirmaEnllac } from '../lib/enllacPublic'
import type { DadesEnllac } from '../lib/enllacPublic'
import { useSessio } from '../hooks/useSessio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Rebuig = 'cap' | 'parcial' | 'total'

export interface PropsFormulariConfirmacio {
  token: string | undefined
  /** A dónde vuelve quien llegó desde el panel. Solo se pinta con sesión y fuera del diálogo. */
  tornar?: string
  /** `true` = hay sitio (diálogo). Ver la nota de la cabecera: no es «pantalla grande». */
  ample?: boolean
  /** Lo llama al confirmar con éxito. El diálogo lo usa para refrescar el panel de detrás. */
  onConfirmat?: () => void
}

export default function FormulariConfirmacio(
  { token, tornar = '/panell', ample = false, onConfirmat }: PropsFormulariConfirmacio,
) {
  const { t } = useT()
  // Pública y lo seguirá siendo —lo que autoriza es el token—, pero desde el 14-09-2026
  // también se llega desde el panel con sesión (`acunar_enllac_propi`), y desde el
  // 21-09-2026 desde el diálogo asistido del equipo.
  const { session } = useSessio()

  const [dades, setDades] = useState<DadesEnllac | null>(null)
  const [carregant, setCarregant] = useState(true)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [fet, setFet] = useState(false)
  const [enviant, setEnviant] = useState(false)

  const [kgPerLinia, setKgPerLinia] = useState<Record<string, string>>({})
  const [nom, setNom] = useState('')
  const [carrec, setCarrec] = useState('')
  const [caixes, setCaixes] = useState('')
  const [incidencies, setIncidencies] = useState('')
  const [rebuig, setRebuig] = useState<Rebuig>('cap')
  const [motiu, setMotiu] = useState('')
  // Honeypot. Una persona nunca lo ve ni lo rellena; un robot que rellena el formulario
  // entero, sí. Mismo mecanismo que el registro público (§9).
  const [web, setWeb] = useState('')

  const carrega = useCallback(async () => {
    if (!token) { setErrorKey('conf.err_no_existeix'); setCarregant(false); return }
    const res = await carregaEnllac(token)
    if (!res.ok) { setErrorKey(res.motiuKey); setCarregant(false); return }

    setDades(res.data)
    // Los kilos arrancan con lo entregado: quien recibe casi siempre confirma lo que dice
    // el albarán, y hacerle teclear cinco cifras que ya están escritas es cómo se consigue
    // que no confirme nadie. Corregir un número es fácil; escribirlos todos, no.
    const inicial: Record<string, string> = {}
    for (const l of res.data.linies) inicial[l.id] = l.kg_neto != null ? String(l.kg_neto) : ''
    setKgPerLinia(inicial)
    setCarregant(false)
  }, [token])

  useEffect(() => { void carrega() }, [carrega])

  async function envia() {
    if (!token) return
    if (nom.trim() === '') { setErrorKey(null); return }

    setEnviant(true)
    const res = await confirmaEnllac(token, {
      nom: nom.trim(),
      carrec: carrec.trim() || null,
      kg: Object.entries(kgPerLinia)
        .map(([linea_id, v]) => ({ linea_id, kg: Number(v.replace(',', '.')) }))
        .filter((x) => !Number.isNaN(x.kg)),
      caixesRetornades: caixes.trim() === '' ? null : Number(caixes),
      incidencies: incidencies.trim() || null,
      rebuig,
      motiuRebuig: rebuig === 'cap' ? null : motiu.trim(),
      sha256Texto: dades?.sha256Texto ?? null,
      web,
    })
    setEnviant(false)

    if (!res.ok) { setErrorKey(res.motiuKey); return }
    setFet(true)
    onConfirmat?.()
  }

  // ── Estados terminales ──
  if (carregant) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />{t('c.loading')}
      </div>
    )
  }

  // El «torna al panell» solo tiene sentido en la PÁGINA. Dentro del diálogo la vuelta es
  // cerrarlo, y un botón que navega cerraría el panel que hay detrás.
  const mostraTornar = session && !ample

  if (!dades || errorKey) {
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('conf.problem')}</h2>
        <p className="text-sm">{t(errorKey ?? 'conf.err_generic')}</p>
        <p className="text-sm text-muted-foreground">{t('conf.problem_help')}</p>
        {dades && (
          <Button variant="outline" className="h-11 w-full whitespace-normal"
            onClick={() => { setErrorKey(null) }}>
            {t('conf.retry')}
          </Button>
        )}
        {mostraTornar && (
          <Button asChild variant="outline" className="h-11 w-full whitespace-normal">
            <Link to={tornar}>{t('pub.back_panel')}</Link>
          </Button>
        )}
      </div>
    )
  }

  if (fet) {
    return (
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t('conf.done_title')}</h2>
        <p className="text-sm">{t('conf.done_body')}</p>
        {dades.albara.numero_completo && (
          <p className="text-sm tabular-nums text-muted-foreground">{dades.albara.numero_completo}</p>
        )}
        {mostraTornar && (
          <Button asChild variant="outline" className="h-11 w-full whitespace-normal">
            <Link to={tornar}>{t('pub.back_panel')}</Link>
          </Button>
        )}
      </div>
    )
  }

  const faltaMotiu = rebuig !== 'cap' && motiu.trim() === ''
  const potEnviar = nom.trim() !== '' && !faltaMotiu && !enviant

  return (
    <div className="space-y-5">
      {/* En el diálogo el título lo pone su propia cabecera; el número del albarán no,
          que es lo que dice DE QUÉ entrega se está hablando. */}
      <div>
        {!ample && <h2 className="text-lg font-semibold">{t('conf.title')}</h2>}
        <p className="mt-1 text-sm text-muted-foreground">
          {dades.albara.numero_completo ?? t('conf.no_number')}
          {dades.albara.entrega ? ` · ${dades.albara.entrega}` : ''}
        </p>
      </div>

      {/* Lo dice ANTES de que se confirme nada: el acto va a quedar etiquetado como
          asistido en la evidencia y en el PDF, y quien firma tiene derecho a saberlo.
          Lo decide el servidor por `enlaces_token.canal`, no esta pantalla. */}
      {dades.assistida && (
        <p className="rounded-md bg-secondary p-3 text-sm text-secondary-foreground">
          {t('conf.assisted_note')}
        </p>
      )}

      <p className="text-sm">{t('conf.intro')}</p>

      {dades.pdf_url && (
        <Button asChild variant="outline" className="h-11 w-full whitespace-normal">
          {/* URL firmada de 60 s que da el servidor. Nunca se compone una de Storage. */}
          <a href={dades.pdf_url} target="_blank" rel="noopener noreferrer">{t('conf.see_pdf')}</a>
        </Button>
      )}

      {/* ── Kilos por línea ── */}
      <div className="space-y-3">
        <h3 className="text-base">{t('conf.received')}</h3>
        {dades.linies.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('conf.no_lines')}</p>
        )}
        {dades.linies.map((l) => (
          <div key={l.id} className="space-y-1.5 rounded-md border p-3">
            <Label htmlFor={`kg-${l.id}`}>
              {l.producto ?? '—'}{l.variedad ? ` · ${l.variedad}` : ''}
            </Label>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('conf.expected', {
                kg: l.kg_neto ?? '—',
                boxes: l.num_cajas ?? '—',
              })}
            </p>
            <Input
              id={`kg-${l.id}`}
              type="number"
              inputMode="decimal"
              step="0.01"
              className="h-11"
              value={kgPerLinia[l.id] ?? ''}
              onChange={(e) => setKgPerLinia((p) => ({ ...p, [l.id]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      {/* ── Envases ── */}
      <div className="space-y-1.5">
        <Label htmlFor="conf-caixes">{t('conf.boxes_returned')}</Label>
        <Input id="conf-caixes" type="number" inputMode="numeric" className="h-11"
          value={caixes} onChange={(e) => setCaixes(e.target.value)} />
        {dades.albara.retorn_envasos && (
          <p className="text-xs text-muted-foreground">{dades.albara.retorn_envasos}</p>
        )}
      </div>

      {/* ── Rechazo ── */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('conf.rejection')}</legend>
        {(['cap', 'parcial', 'total'] as const).map((v) => (
          // 44 px de alto en toda la fila, no solo en el círculo del radio: a 16 px de
          // diámetro esto es imposible de acertar con un dedo.
          <label key={v} className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-base">
            <input
              type="radio"
              name="rebuig"
              className="size-5 accent-primary"
              checked={rebuig === v}
              onChange={() => setRebuig(v)}
            />
            <span>{t(`conf.rj_${v}`)}</span>
          </label>
        ))}
      </fieldset>

      {rebuig !== 'cap' && (
        <div className="space-y-1.5">
          <Label htmlFor="conf-motiu">{t('conf.reject_reason')}</Label>
          <Textarea id="conf-motiu" rows={3} value={motiu} onChange={(e) => setMotiu(e.target.value)} />
          {faltaMotiu && <p className="text-sm text-error">{t('conf.reject_reason_required')}</p>}
        </div>
      )}

      {/* ── Incidencias ── */}
      <div className="space-y-1.5">
        <Label htmlFor="conf-inc">{t('conf.incidents')}</Label>
        <Textarea id="conf-inc" rows={3} value={incidencies}
          onChange={(e) => setIncidencies(e.target.value)} />
      </div>

      {/* ── Quién confirma ── */}
      <div className="space-y-1.5">
        <Label htmlFor="conf-nom">{t('conf.who')}</Label>
        <Input id="conf-nom" className="h-11" autoComplete="name"
          value={nom} onChange={(e) => setNom(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="conf-carrec">{t('conf.role')}</Label>
        <Input id="conf-carrec" className="h-11"
          value={carrec} onChange={(e) => setCarrec(e.target.value)} />
      </div>

      {/* Trampa para robots: una persona no ve este campo y por tanto no lo rellena.
          Mismo mecanismo (y misma clase `hidden`) que el registro público. */}
      <input
        type="text" name="web" value={web} onChange={(e) => setWeb(e.target.value)}
        tabIndex={-1} autoComplete="off" aria-hidden="true"
        className="hidden"
      />

      {/* EL ACTA, LITERAL. Su huella (`sha256_texto`) viaja de vuelta al confirmar y es
          lo que convierte un «confirmó» en un «confirmó ESTO». Se pinta con
          `whitespace-pre-wrap` porque el servidor la manda ya maquetada en líneas; ni
          una palabra se reescribe aquí. */}
      {dades.textConfirmacio && (
        <div className="rounded-md bg-secondary p-3">
          <p className="whitespace-pre-wrap text-sm text-secondary-foreground">
            {dades.textConfirmacio}
          </p>
          {dades.codiVerificacio && (
            <p className="mt-2 text-xs tabular-nums text-muted-foreground">
              {t('conf.verification', { code: dades.codiVerificacio })}
            </p>
          )}
        </div>
      )}

      <Button className="h-11 w-full whitespace-normal" disabled={!potEnviar}
        onClick={() => void envia()}>
        {enviant && <Loader2 className="size-4 animate-spin" />}
        {enviant ? t('c.sending') : t('conf.submit')}
      </Button>
      {nom.trim() === '' && (
        <p className="text-xs text-muted-foreground">{t('conf.who_required')}</p>
      )}
      <p className="text-xs text-muted-foreground">{t('conf.legal')}</p>
    </div>
  )
}
