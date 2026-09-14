// Alta de oferta desde el panel del productor.
//
// Hace exactamente las mismas preguntas que el bot de WhatsApp porque no las lleva
// escritas: las pide a la Edge Function `crear-oferta`, que las sirve desde el mismo
// descriptor (`_shared/camposOferta.ts`). Si mañana el intake gana un paso, este
// formulario lo gana solo.
//
// Se presenta como una sola página con todos los campos, no como un asistente paso a
// paso: en WhatsApp la conversación impone el ritmo, pero en pantalla ver el conjunto
// y poder corregir es mejor.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import { useOrganitzacio } from '../../hooks/useAppContext'
import { useConveni } from '../../hooks/useConveni'
import { carregaCamps, creaOferta } from '../../lib/ofertes'
import type { CampoOferta, CatalogosOferta } from '../../lib/ofertes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Datos = Record<string, unknown>

function aplica(campo: CampoOferta, datos: Datos): boolean {
  if (!campo.condicion) return true
  return campo.condicion.en.includes(String(datos[campo.condicion.campo] ?? ''))
}

export default function NovaOferta() {
  const { t } = useT()
  const { bloqueja } = useConveni()
  const navigate = useNavigate()
  const organitzacio = useOrganitzacio('productor')
  const [campos, setCampos] = useState<CampoOferta[]>([])
  const [catalogos, setCatalogos] = useState<CatalogosOferta | null>(null)
  const [datos, setDatos] = useState<Datos>({})
  const [carregant, setCarregant] = useState(true)
  const [enviant, setEnviant] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const productorId = organitzacio?.id ?? null

  useEffect(() => {
    if (!productorId) { setCarregant(false); return }
    let viu = true
    void carregaCamps(productorId).then((r) => {
      if (!viu) return
      if (!r.ok || !r.data) setError(r.error ?? t('c.error'))
      else { setCampos(r.data.campos); setCatalogos(r.data.catalogos) }
      setCarregant(false)
    })
    return () => { viu = false }
  }, [productorId, t])

  const productesDeFamilia = useMemo(() => {
    const familia = String(datos.familia ?? '')
    return (catalogos?.productos ?? []).filter((p) => !familia || p.familia === familia)
  }, [catalogos, datos.familia])

  function set(clave: string, valor: unknown) {
    setDatos((d) => {
      const nou = { ...d, [clave]: valor }
      // Cambiar de familia invalida el producto elegido.
      if (clave === 'familia') delete nou.producte
      return nou
    })
  }

  async function enviar() {
    if (!productorId) return
    setEnviant(true)
    setError(null)
    const r = await creaOferta(productorId, datos)
    setEnviant(false)
    if (!r.ok) {
      setError(r.error ?? t('c.error'))
      toast.error(r.error ?? t('c.error'))
      return
    }
    toast.success(t('po.created', { ref: r.data?.id_excedente ?? '' }))
    // La confirmación por correo es el equivalente del mensaje que el intake manda por
    // WhatsApp. Solo se dice cuando ha salido de verdad: anunciar un correo que no se ha
    // enviado (sin correo en la ficha, o modo test) haría esperar algo que no llega.
    if (r.data?.confirmacio_email === 'enviat') toast.success(t('po.created_email'))
    navigate('/productor/ofertes')
  }

  if (!productorId) {
    return <p className="text-sm text-muted-foreground">{t('po.no_org')}</p>
  }
  if (carregant) return <p className="text-sm text-muted-foreground">{t('c.loading')}</p>

  function control(campo: CampoOferta) {
    const valor = datos[campo.clave]
    // ⚠️ `text-base md:text-sm` NO es cosmético: iOS Safari amplía la página al enfocar
    // cualquier control por debajo de 16px, y como el viewport renuncia a propósito a
    // `maximum-scale` (accesibilidad), NO deshace el zoom al salir del campo. Con
    // `text-sm` a secas, tocar el primer desplegable dejaba el resto del formulario —13
    // campos— ampliado y desplazándose en horizontal. Es el mismo patrón que ya usa
    // `components/ui/input.tsx`, y por eso los <input> nunca tuvieron el problema.
    // La altura pasa de h-10 a h-9 para que dejen de alternar con los Input.
    const comuns = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm'

    switch (campo.tipo) {
      case 'familia':
        return (
          <select className={comuns}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
            <option value="">—</option>
            {(catalogos?.familias ?? []).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )
      case 'producte':
        return (
          <select className={comuns}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}
            disabled={!datos.familia}>
            <option value="">—</option>
            {productesDeFamilia.map((p) => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
          </select>
        )
      case 'causa':
        return (
          <select className={comuns}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
            <option value="">—</option>
            {(catalogos?.causas ?? []).map((c) => (
              <option key={c.codigo} value={c.codigo}>{c.nombre ?? c.codigo}</option>
            ))}
          </select>
        )
      case 'ubicacio':
        return (catalogos?.ubicaciones ?? []).length > 0 ? (
          <select className={comuns}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
            <option value="">—</option>
            {(catalogos?.ubicaciones ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.alias ?? u.municipio ?? 'Ubicació'}</option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-muted-foreground">{t('po.no_locations')}</p>
        )
      case 'opcions':
        return (
          <select className={comuns}
            value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)}>
            <option value="">—</option>
            {(campo.opciones ?? []).map((o) => <option key={o.id} value={o.id}>{o.titulo}</option>)}
          </select>
        )
      case 'numero':
        return (
          <Input type="number" step="0.01" min="0" value={valor == null ? '' : String(valor)}
            onChange={(e) => set(campo.clave, e.target.value === '' ? null : Number(e.target.value))} />
        )
      default:
        return campo.clave === 'observacions'
          ? <Textarea rows={3} value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)} />
          : <Input type="text" value={String(valor ?? '')} onChange={(e) => set(campo.clave, e.target.value)} />
    }
  }

  const visibles = campos.filter((c) => aplica(c, datos))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('po.new_title')}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('po.new_subtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {visibles.map((campo) => (
            <div key={campo.clave} className={campo.clave === 'observacions' ? 'sm:col-span-2' : undefined}>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                {campo.etiqueta}{campo.obligatorio && ' *'}
              </Label>
              {control(campo)}
              {campo.ayuda && <p className="mt-1 text-xs text-muted-foreground">{campo.ayuda}</p>}
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {/* Desde la fecha de corte, sin convenio vigente la RPC devuelve 42501: el
              botón se apaga para no dejar al productor delante de un error. */}
          <Button onClick={() => void enviar()} disabled={enviant || bloqueja} title={bloqueja ? t('avis_conv.bloquejat') : undefined}>
            {enviant ? t('c.saving') : t('po.publish')}
          </Button>
          <Button variant="outline" onClick={() => navigate('/productor/ofertes')}>{t('c.cancel')}</Button>
        </div>
      </CardContent>
    </Card>
  )
}
