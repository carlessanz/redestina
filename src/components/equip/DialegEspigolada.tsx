// Convertir una oferta «producte al camp» en jornada de espigueo, sin salir de la pantalla.
//
// POR QUÉ EXISTE (F3). El caso real más común del espigueo es el intermedio: un generador
// avisa de que tiene un campo sin cosechar, eso se publica como oferta para ver quién la
// quiere, y DESPUÉS se monta la jornada. Hasta hoy el equipo tenía dos salidas y las dos
// eran malas: repartir la oferta como si el producto estuviera recogido —el REC que nace
// del trigger declara una entrada que nadie ha pesado— o crear la espigolada aparte, con
// dos entradas del mismo producto y la conciliación contando los kilos dos veces.
//
// 🔴 **NO INSERTA NADA.** Llama a `crear_espigolada(..., p_excedente => la oferta)`, que
//    REUTILIZA ese excedente en vez de crear otro: le pone `espigolada_id`, lo pasa a
//    `origen = 'espigolament'` y a `borrador`, y crea el REC de la jornada con su línea.
//    Todas las guardas —que el productor coincida, que declare producto al campo, que no
//    tenga ya canalizaciones ni albaranes— están en la base y se ven aquí traducidas.
//
// ⚠️ **EL MOLDE ES `DialegAssistit`**: 80 vw × 88 vh y **no se cierra al pinchar fuera**.
//    Con los kilos de la jornada tecleados, un clic despistado en el fondo sería caro.
//
// ⚠️ **UNA SOLA LÍNEA, y la impone la base** (`massa_linies`). Una oferta es un producto;
//    más de una línea obligaría a decidir en silencio qué se hace con las demás. Por eso
//    este formulario no tiene «afegeix línia», al revés que `NovaEspigolada`.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import { crearEspigolada } from '../../lib/albarans'
import type { LiniaEntrada } from '../../lib/albarans'
import { motiuConversio } from '../../lib/conversioEspigolada'
import type { Excedente } from '../../types'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** `text-base md:text-sm` es obligatorio: sin él, iOS amplía la página al enfocar (§2). */
const SELECT = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm'

interface Props {
  obert: boolean
  /** La oferta que se convierte. De ella salen productora, finca y la línea prellenada. */
  oferta: Excedente
  /** Ya resuelto por quien abre el diálogo: aquí solo se enseña. */
  productorNom?: string | null
  onTancar: () => void
  /** Hecho: la pantalla de detrás decide si navega a la jornada o se recarga. */
  onCreada: (espigoladaId: string) => void
}

/** Un número escrito a mano, con coma o con punto. `''` es «no lo digo», no «cero». */
function num(v: string): number | null {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

export default function DialegEspigolada(
  { obert, oferta, productorNom, onTancar, onCreada }: Props,
) {
  const { t } = useT()

  const [ubicacions, setUbicacions] = useState<
    { id: string; alias: string | null; municipio: string | null }[]
  >([])
  const [productes, setProductes] = useState<string[]>([])
  const [caixes, setCaixes] = useState<{ codigo: string; nombre: string }[]>([])

  const [ubicacio, setUbicacio] = useState('')
  const [data, setData] = useState('')
  const [voluntaris, setVoluntaris] = useState('')
  const [notes, setNotes] = useState('')
  const [refExterna, setRefExterna] = useState('')
  const [producte, setProducte] = useState('')
  const [varietat, setVarietat] = useState('')
  const [caixesNum, setCaixesNum] = useState('')
  const [tipusCaixa, setTipusCaixa] = useState('')
  const [brut, setBrut] = useState('')
  const [tara, setTara] = useState('')
  const [net, setNet] = useState('')
  const [ocupat, setOcupat] = useState(false)

  // Los catálogos y la finca, solo al ABRIR: un diálogo montado y cerrado no tiene por qué
  // pedir las ubicaciones de nadie.
  useEffect(() => {
    if (!obert) return
    let viu = true
    void (async () => {
      // ⚠️ Cada lista de columnas en UN literal (§7, deuda 46).
      const [u, pr, c] = await Promise.all([
        oferta.productor_id
          ? supabase.from('productor_ubicaciones')
            .select('id, alias, municipio')
            .eq('productor_id', oferta.productor_id)
            .order('es_principal', { ascending: false })
          : Promise.resolve({ data: [] }),
        supabase.from('productos').select('nombre').order('nombre'),
        supabase.from('tipos_caja').select('codigo, nombre').eq('activo', true).order('orden'),
      ])
      if (!viu) return
      setUbicacions((u.data as { id: string; alias: string | null; municipio: string | null }[] | null) ?? [])
      setProductes(((pr.data as { nombre: string }[] | null) ?? []).map((x) => x.nombre))
      setCaixes((c.data as { codigo: string; nombre: string }[] | null) ?? [])
    })()
    return () => { viu = false }
  }, [obert, oferta.productor_id])

  // Lo que la oferta ya declaraba, prellenado. Se puede corregir todo: después de una
  // jornada se PESA, y lo pesado no tiene por qué parecerse a lo estimado sobre el campo.
  useEffect(() => {
    if (!obert) return
    setUbicacio(oferta.ubicacion_id ?? '')
    setData(new Date().toISOString().slice(0, 10))
    setVoluntaris('')
    setNotes('')
    setRefExterna('')
    setProducte(oferta.producto ?? '')
    setVarietat(oferta.variedad ?? '')
    setCaixesNum(oferta.num_caixes != null ? String(oferta.num_caixes) : '')
    setTipusCaixa(oferta.tipo_caixa ?? '')
    setBrut('')
    setTara('')
    setNet(oferta.kg_total != null ? String(oferta.kg_total) : '')
  }, [obert, oferta])

  /** El neto se deduce del bruto menos la tara mientras nadie lo escriba a mano. */
  function tocaPes(quin: 'brut' | 'tara', valor: string) {
    const b = quin === 'brut' ? valor : brut
    const ta = quin === 'tara' ? valor : tara
    if (quin === 'brut') setBrut(valor); else setTara(valor)
    const nb = num(b)
    if (nb != null) setNet(String(Math.max(0, nb - (num(ta) ?? 0))))
  }

  async function desa() {
    if (!oferta.productor_id) { toast.error(t('esp.need_producer')); return }
    if (!producte || num(net) == null) { toast.error(t('esp.need_lines')); return }

    const linia: LiniaEntrada = {
      producto: producte,
      variedad: varietat || null,
      familia: oferta.familia,
      causa: oferta.causa,
      num_cajas: num(caixesNum),
      tipo_caja: tipusCaixa || null,
      kg_bruto: num(brut),
      tara_kg: num(tara),
      // `kg` (no `kg_neto`): es lo que `crear_espigolada()` lee, y va a la vez al registro
      // y a la línea del albarán de recepción.
      kg: num(net),
    }

    setOcupat(true)
    const r = await crearEspigolada({
      productor: oferta.productor_id,
      ubicacio: ubicacio || null,
      data: data || null,
      voluntaris: num(voluntaris),
      notes: notes || null,
      refExterna: refExterna || null,
      linies: [linia],
      excedent: oferta.id,
    })
    setOcupat(false)

    if (!r.ok) {
      // Los siete rechazos de la conversión se enseñan traducidos POR SU CÓDIGO; lo demás,
      // como siempre, con el mensaje que dio la base.
      const clau = motiuConversio(r.missatge)
      toast.error(clau ? t(clau) : r.missatge)
      return
    }
    toast.success(t('conv_esp.done'))
    onCreada(r.data.espigolada_id)
  }

  // Un producto que ya no está en el catálogo (o que se escribió a mano en el intake) no
  // puede desaparecer del desplegable: sería cambiar el producto del lote sin decirlo.
  const opcions = producte && !productes.includes(producte) ? [producte, ...productes] : productes

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
      <DialogContent
        className="flex h-[88vh] w-[80vw] max-w-none flex-col gap-4 p-6 sm:max-w-none"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('conv_esp.title')}</DialogTitle>
          <DialogDescription>
            {t('conv_esp.subtitle', {
              ref: oferta.id_excedente ?? '—',
              qui: productorNom ?? '—',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <p className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
            {t('conv_esp.hint')}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ce-ubi">{t('esp.location')}</Label>
              <select
                id="ce-ubi" className={SELECT} value={ubicacio}
                onChange={(e) => setUbicacio(e.target.value)}
                disabled={ubicacions.length === 0}
              >
                <option value="">
                  {ubicacions.length === 0 ? t('esp.no_locations') : t('c.none')}
                </option>
                {ubicacions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.alias || u.municipio || u.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-data">{t('esp.date')}</Label>
              <Input id="ce-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-vol">{t('esp.volunteers')}</Label>
              <Input
                id="ce-vol" type="number" inputMode="numeric" value={voluntaris}
                onChange={(e) => setVoluntaris(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-ref">{t('esp.ref')}</Label>
              <Input id="ce-ref" value={refExterna} onChange={(e) => setRefExterna(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ce-notes">{t('esp.notes')}</Label>
              <Textarea id="ce-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <h3 className="text-base">{t('conv_esp.line')}</h3>
            <p className="text-sm text-muted-foreground">{t('conv_esp.line_hint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ce-prod">{t('alb.ln_product')}</Label>
                <select
                  id="ce-prod" className={SELECT} value={producte}
                  onChange={(e) => setProducte(e.target.value)}
                >
                  <option value="">{t('c.none')}</option>
                  {opcions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-var">{t('alb.ln_variety')}</Label>
                <Input id="ce-var" value={varietat} onChange={(e) => setVarietat(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-cx">{t('alb.ln_boxes')}</Label>
                <Input
                  id="ce-cx" type="number" inputMode="numeric" value={caixesNum}
                  onChange={(e) => setCaixesNum(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-tc">{t('alb.ln_boxtype')}</Label>
                <select
                  id="ce-tc" className={SELECT} value={tipusCaixa}
                  onChange={(e) => setTipusCaixa(e.target.value)}
                >
                  <option value="">{t('c.none')}</option>
                  {caixes.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-brut">{t('alb.ln_gross')}</Label>
                <Input
                  id="ce-brut" type="number" inputMode="decimal" step="0.01" value={brut}
                  onChange={(e) => tocaPes('brut', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ce-tara">{t('alb.ln_tare')}</Label>
                <Input
                  id="ce-tara" type="number" inputMode="decimal" step="0.01" value={tara}
                  onChange={(e) => tocaPes('tara', e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ce-net">{t('alb.ln_net')}</Label>
                <Input
                  id="ce-net" type="number" inputMode="decimal" step="0.01" value={net}
                  onChange={(e) => setNet(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button
            variant="outline" className="h-11 whitespace-normal md:h-9"
            disabled={ocupat} onClick={onTancar}
          >
            {t('c.cancel')}
          </Button>
          <Button
            className="h-11 whitespace-normal md:h-9"
            disabled={ocupat} onClick={() => void desa()}
          >
            {ocupat ? t('c.saving') : t('conv_esp.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
