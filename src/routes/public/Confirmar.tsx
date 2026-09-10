// `/confirmar/:token` — la parte pública del albarán.
//
// LA ABRE ALGUIEN QUE NO TIENE CUENTA, desde el móvil, con el camión delante. Esa frase
// decide casi todo lo de abajo:
//
//   · NO monta `AppContextProvider` ni nada que exija sesión. Va fuera de `RequireSessio`
//     en el router. El único permiso es el token del correo.
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
import { useParams } from 'react-router'
import { Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { carregaEnllac, confirmaEnllac } from '../../lib/enllacPublic'
import type { DadesEnllac } from '../../lib/enllacPublic'
import LayoutAcces from '../../components/LayoutAcces'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Rebuig = 'cap' | 'parcial' | 'total'

export default function Confirmar() {
  const { t } = useT()
  const { token } = useParams<{ token: string }>()

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
          <CardHeader><CardTitle>{t('conf.problem')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{t(errorKey ?? 'conf.err_generic')}</p>
            <p className="text-sm text-muted-foreground">{t('conf.problem_help')}</p>
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

  if (fet) {
    return (
      <LayoutAcces ample>
        <Card>
          <CardHeader><CardTitle>{t('conf.done_title')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{t('conf.done_body')}</p>
            {dades.albara.numero_completo && (
              <p className="text-sm tabular-nums text-muted-foreground">{dades.albara.numero_completo}</p>
            )}
          </CardContent>
        </Card>
      </LayoutAcces>
    )
  }

  const faltaMotiu = rebuig !== 'cap' && motiu.trim() === ''
  const potEnviar = nom.trim() !== '' && !faltaMotiu && !enviant

  return (
    <LayoutAcces ample>
      <Card>
        <CardHeader>
          <CardTitle>{t('conf.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {dades.albara.numero_completo ?? t('conf.no_number')}
            {dades.albara.entrega ? ` · ${dades.albara.entrega}` : ''}
          </p>
        </CardHeader>

        {/* Una sola columna, siempre: a 360 px dos columnas obligan a hacer zoom, y esto se
            rellena de pie en una finca. */}
        <CardContent className="space-y-5">
          <p className="text-sm">{t('conf.intro')}</p>

          {dades.pdf_url && (
            <Button asChild variant="outline" className="h-11 w-full whitespace-normal">
              {/* URL firmada de 60 s que da el servidor. Nunca se compone una de Storage. */}
              <a href={dades.pdf_url} target="_blank" rel="noopener noreferrer">{t('conf.see_pdf')}</a>
            </Button>
          )}

          {/* ── Kilos por línea ── */}
          <div className="space-y-3">
            <h2 className="text-base">{t('conf.received')}</h2>
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
        </CardContent>
      </Card>
    </LayoutAcces>
  )
}
