// Los cierres del ejercicio: la lista y la apertura de uno nuevo.
//
// UN CIERRE NO ES UN INFORME, ES UN ACTO. Abrir el cierre **real** de un año consume las
// series legales de ese año (`RES-2026-…`, `CD-2026-…`), y esos números no se devuelven:
// por eso la base solo deja abrirlo al super_admin y por eso aquí el modo se elige con dos
// opciones separadas, con su aviso, y no con un desplegable donde `real` esté a un pixel
// de `prova`.
//
// Los de prueba se pueden abrir tantas veces como haga falta —uno por ensayo— y se
// reinician enteros desde el detalle. Los kilos y los euros que enseña esta pantalla salen
// de `cierres_donante`, o sea del cálculo ya hecho: aquí no se suma nada en el cliente.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { useAppContext } from '../../hooks/useAppContext'
import {
  dataTancament, estilEstatTancament, euros, obrirTancament,
} from '../../lib/tancament'
import { kg } from '../../lib/albarans'
import type { CierreEjercicio } from '../../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

/** Lo que se pinta de la cabecera. `Pick` para que el tipo lo siga mandando types.ts. */
type Fila = Pick<
  CierreEjercicio,
  'id' | 'ejercicio' | 'modo' | 'estado' | 'abierto_at' | 'calculado_at' | 'cerrado_at' | 'declarado_at' | 'notas'
>

/** Totales por cierre, que salen de `cierres_donante` (una consulta, no una por fila). */
interface Totals {
  donants: number
  kg: number
  valor: number
  certificats: number
}

/**
 * El badge del modo.
 *
 * Es la pieza que más importa de toda la pantalla: un cierre de prueba y uno real se
 * parecen en todo menos en lo único que cuenta. Por eso el de prueba lleva icono, fondo de
 * aviso y la frase entera («PROVA · sense validesa fiscal»), no la palabra sola.
 */
export function BadgeMode({ mode, gran = false }: { mode: 'prueba' | 'real'; gran?: boolean }) {
  const { t } = useT()
  if (mode === 'real') {
    return (
      <Badge className={`bg-primary text-primary-foreground ${gran ? 'text-sm' : ''}`}>
        {t('tan.mode_real')}
      </Badge>
    )
  }
  return (
    <Badge className={`bg-aviso-fondo text-aviso whitespace-normal ${gran ? 'text-sm' : ''}`}>
      <AlertTriangle className="mr-1 size-3.5 shrink-0" aria-hidden />
      {t('tan.mode_test')}
    </Badge>
  )
}

export default function Tancament() {
  const { t } = useT()
  const { ctx } = useAppContext()
  const potAprovar = ctx?.potAprovar ?? false
  const esSuperAdmin = ctx?.esSuperAdmin ?? false

  const [files, setFiles] = useState<Fila[]>([])
  const [totals, setTotals] = useState<Record<string, Totals>>({})
  const [carregant, setCarregant] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const anyActual = new Date().getFullYear()
  const [exercici, setExercici] = useState(String(anyActual))
  const [obrint, setObrint] = useState(false)

  const carrega = useCallback(async () => {
    // ⚠️ La lista de columnas va en UN literal (§7, deuda 46).
    const { data, error: err } = await supabase
      .from('cierres_ejercicio')
      .select('id, ejercicio, modo, estado, abierto_at, calculado_at, cerrado_at, declarado_at, notas')
      .order('ejercicio', { ascending: false })
      .order('abierto_at', { ascending: false })
    if (err) return { llista: [] as Fila[], err }
    return { llista: (data as Fila[] | null) ?? [], err: null }
  }, [])

  const carregaTotals = useCallback(async () => {
    // Se trae también `tipo` para poder separar donación de transacción: sumarlos daría un
    // total que no es de ninguno de los dos, y «donants» contaría dos veces a una
    // organización que este año haya donado Y vendido.
    const { data } = await supabase
      .from('cierres_donante')
      .select('cierre_id, tipo, kg_total, valor_total, certificado_numero')
    const acumulat: Record<string, Totals> = {}
    for (const d of (data as { cierre_id: string; tipo: string | null; kg_total: number | string; valor_total: number | string; certificado_numero: string | null }[] | null) ?? []) {
      if ((d.tipo ?? 'donacio') !== 'donacio') continue
      const t0 = acumulat[d.cierre_id] ?? { donants: 0, kg: 0, valor: 0, certificats: 0 }
      t0.donants += 1
      t0.kg += Number(d.kg_total ?? 0)
      t0.valor += Number(d.valor_total ?? 0)
      if (d.certificado_numero) t0.certificats += 1
      acumulat[d.cierre_id] = t0
    }
    return acumulat
  }, [])

  const refresca = useCallback(async () => {
    const [{ llista, err }, sumes] = await Promise.all([carrega(), carregaTotals()])
    if (err) { setError(err.message); setCarregant(false); return }
    setError(null)
    setFiles(llista)
    setTotals(sumes)
    setCarregant(false)
  }, [carrega, carregaTotals])

  useEffect(() => {
    let viu = true
    void (async () => {
      const [{ llista, err }, sumes] = await Promise.all([carrega(), carregaTotals()])
      if (!viu) return
      if (err) { setError(err.message); setCarregant(false); return }
      setFiles(llista)
      setTotals(sumes)
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [carrega, carregaTotals])

  const any = useMemo(() => {
    const n = Number(exercici)
    return Number.isInteger(n) && n >= 2020 && n <= anyActual ? n : null
  }, [exercici, anyActual])

  async function obre(mode: 'prueba' | 'real') {
    if (any === null) { toast.error(t('tan.bad_year')); return }
    setObrint(true)
    const res = await obrirTancament(any, mode)
    setObrint(false)
    if (!res.ok) { toast.error(res.missatge); return }
    toast.success(t(mode === 'real' ? 'tan.opened_real' : 'tan.opened_test', { y: any }))
    await refresca()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('tan.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('tan.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {carregant && <p className="text-sm text-muted-foreground">{t('c.loading')}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {!carregant && !error && files.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('tan.empty')}</p>
          )}

          {files.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('tan.c_year')}</TableHead>
                    <TableHead>{t('tan.c_mode')}</TableHead>
                    <TableHead>{t('tan.c_status')}</TableHead>
                    <TableHead className="text-right">{t('tan.c_donors')}</TableHead>
                    <TableHead className="text-right">{t('tan.c_kg')}</TableHead>
                    <TableHead className="text-right">{t('tan.c_value')}</TableHead>
                    <TableHead className="text-right">{t('tan.c_certs')}</TableHead>
                    <TableHead>{t('tan.c_opened')}</TableHead>
                    <TableHead className="text-right">{t('doc.c_actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((f) => {
                    const s = totals[f.id]
                    return (
                      <TableRow key={f.id}>
                        <TableCell className="font-medium tabular-nums">{f.ejercicio}</TableCell>
                        <TableCell><BadgeMode mode={f.modo} /></TableCell>
                        <TableCell>
                          <Badge className={estilEstatTancament(f.estado)}>
                            {t(`tan.st_${f.estado}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s?.donants ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">{kg(s?.kg ?? 0)}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">{euros(s?.valor ?? 0)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s?.certificats ?? 0}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {dataTancament(f.abierto_at)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button asChild size="sm" variant="outline" className="h-11 whitespace-normal md:h-8">
                              <Link to={`/equip/tancament/${f.id}`}>{t('c.detail')}</Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {potAprovar && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('tan.open_title')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t('tan.open_hint')}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tan-exercici">{t('tan.f_year')}</Label>
                <Input
                  id="tan-exercici"
                  inputMode="numeric"
                  value={exercici}
                  onChange={(e) => setExercici(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-input p-3">
                <p className="font-medium">{t('tan.open_test')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('tan.open_test_hint')}</p>
                <Button
                  className="mt-3 h-11 w-full whitespace-normal md:h-9"
                  disabled={obrint || any === null}
                  onClick={() => void obre('prueba')}
                >
                  {t('tan.open_test_do')}
                </Button>
              </div>

              {/* El real solo se le enseña a quien puede hacerlo: un botón que siempre
                  responde 42501 no informa de nada, solo invita a pulsarlo. */}
              <div className="rounded-md border border-error bg-error-fondo p-3">
                <p className="font-medium text-error">{t('tan.open_real')}</p>
                <p className="mt-1 text-sm text-error">{t('tan.open_real_hint')}</p>
                {esSuperAdmin ? (
                  <Button
                    variant="destructive"
                    className="mt-3 h-11 w-full whitespace-normal md:h-9"
                    disabled={obrint || any === null}
                    onClick={() => void obre('real')}
                  >
                    {t('tan.open_real_do')}
                  </Button>
                ) : (
                  <p className="mt-3 text-sm text-error">{t('tan.open_real_denied')}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
