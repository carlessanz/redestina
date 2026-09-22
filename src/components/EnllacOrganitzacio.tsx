// El deshacer del enlace: separar una ficha de la organización que comparte.
//
// POR QUÉ EXISTE. `enllacar_organitzacio()` fusiona dos organizaciones —mueve la ficha y sus
// convenios y retira la que queda vacía— y esa operación necesitaba vuelta atrás: sin ella, un
// enlace equivocado no se podía deshacer más que por SQL, porque la organización de origen ya
// no está y no hay ninguna otra forma de crear una. La RPC admite `p_organitzacio = null`
// justamente para eso; esto es su botón.
//
// DÓNDE SE VE. Solo cuando la organización tiene **las dos fichas**: si esta ficha está sola en
// la suya no hay nada que separar, y el componente no pinta nada. Se monta en la ficha del
// equipo (donde un enlace malo se descubre semanas después) y en la cola de Aprovacions (donde
// se acaba de hacer).
//
// ⚠️ Es del equipo: lee la otra tabla de fichas por `organizacion_id`, que una cuenta externa
// no puede. No montarlo en pantallas de productor o receptor.
//
// AVISO DE NOMBRE/NIF DIVERGENTE (22-09-2026, plan `2026-09-22-plan-organizacion-unificada.md`
// D1). `v_organizaciones` resuelve el nombre y el NIF con un `coalesce(productor, entidad)`
// —siempre gana el productor— sin decir nunca si las dos fichas discrepan. Medido en producción
// el 22-09-2026: de 4 organizaciones con doble rol, 1 ya tenía nombres distintos (mismo NIF). Es
// el único hueco de la brecha 2 con consecuencia legal concreta: un documento que un día lea el
// nombre «unificado» heredaría esa elección arbitraria sin que nadie lo supiera.
// NO corrige nada, solo lo dice: elegir cuál de los dos nombres es el bueno es una decisión del
// equipo, y una heurística que lo hiciera sola sería el mismo error que esto existe para evitar.
// Compara solo cuando los DOS lados tienen valor —una ficha con el campo vacío no es una
// divergencia, es una ficha incompleta— y con `trim()`, para no avisar por un espacio de más.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export default function EnllacOrganitzacio({
  tipus,
  fitxa,
  potAprovar = true,
  onCanviat,
}: {
  tipus: 'productor' | 'entidad'
  /** La ficha que se mira. `null` (alta nueva) no pinta nada. */
  fitxa: string | null
  potAprovar?: boolean
  /** Para que quien lo monta refresque lo suyo: la organización ha cambiado. */
  onCanviat?: () => void
}) {
  const { t } = useT()
  // La OTRA ficha de la misma organización: su existencia es lo que hace que haya algo que
  // separar, y su nombre es lo único que permite decir de quién se está separando.
  const [altra, setAltra] = useState<{ id: string; nom: string | null; nif: string | null } | null>(null)
  // La PROPIA ficha, solo nombre y NIF: lo mínimo para poder comparar contra `altra` sin una
  // tercera consulta. No se guarda nada más aquí; el resto de la ficha lo lee quien monta esto.
  const [meva, setMeva] = useState<{ nom: string | null; nif: string | null } | null>(null)
  const [obert, setObert] = useState(false)
  const [ocupat, setOcupat] = useState(false)

  const carrega = useCallback(async () => {
    if (!fitxa) { setAltra(null); setMeva(null); return }

    // Dos ramas completas, no una columna interpolada: la lista de un `.select()` va en UN
    // literal (§7) o supabase-js deja de poder tipar la fila.
    if (tipus === 'productor') {
      const { data: p } = await supabase.from('productores')
        .select('organizacion_id, name, nif').eq('id', fitxa).maybeSingle()
      const propi = p as { organizacion_id: string | null; name: string | null; nif: string | null } | null
      const org = propi?.organizacion_id ?? null
      if (!org) { setAltra(null); setMeva(null); return }
      setMeva({ nom: propi?.name ?? null, nif: propi?.nif ?? null })

      // Una sola consulta a la otra tabla: dice a la vez si comparten y con quién. No hace
      // falta `v_organizaciones`, que para esta ficha devolvería su propio nombre, no el de
      // la otra.
      const { data: e } = await supabase.from('entidades')
        .select('id, nombre, nif').eq('organizacion_id', org).maybeSingle()
      const ent = e as { id: string; nombre: string | null; nif: string | null } | null
      setAltra(ent ? { id: ent.id, nom: ent.nombre, nif: ent.nif } : null)
    } else {
      const { data: e } = await supabase.from('entidades')
        .select('organizacion_id, nombre, nif').eq('id', fitxa).maybeSingle()
      const propi = e as { organizacion_id: string | null; nombre: string | null; nif: string | null } | null
      const org = propi?.organizacion_id ?? null
      if (!org) { setAltra(null); setMeva(null); return }
      setMeva({ nom: propi?.nombre ?? null, nif: propi?.nif ?? null })

      const { data: p } = await supabase.from('productores')
        .select('id, name, empresa, nif').eq('organizacion_id', org).maybeSingle()
      const prod = p as { id: string; name: string | null; empresa: string | null; nif: string | null } | null
      setAltra(prod ? { id: prod.id, nom: prod.empresa || prod.name, nif: prod.nif } : null)
    }
  }, [tipus, fitxa])

  useEffect(() => { void carrega() }, [carrega])

  if (!fitxa || !altra) return null

  // Solo cuenta cuando los DOS lados tienen algo que comparar: una ficha con el campo vacío es
  // una ficha incompleta, no una discrepancia. `trim()` evita avisar por un espacio de más.
  const propiNom = meva?.nom?.trim() || null
  const altraNom = altra.nom?.trim() || null
  const divergeixNom = !!(propiNom && altraNom && propiNom !== altraNom)
  const propiNif = meva?.nif?.trim() || null
  const altraNif = altra.nif?.trim() || null
  const divergeixNif = !!(propiNif && altraNif && propiNif !== altraNif)

  async function desenllacar() {
    setOcupat(true)
    const { error } = await supabase.rpc('enllacar_organitzacio',
      { p_tipo: tipus, p_ficha: fitxa, p_organitzacio: null })
    setOcupat(false)
    setObert(false)
    if (error) {
      toast.error(error.code === '42501' ? t('appr.reg_no_perm') : error.message)
      return
    }
    toast.success(t('org.unlink_ok'))
    void carrega()
    onCanviat?.()
  }

  return (
    <>
      <div className="rounded-md bg-secondary p-2 text-xs text-secondary-foreground">
        <span className="font-medium">{t('org.shared_title')}</span>
        {' · '}
        {t('org.shared_with', { nom: altra.nom || '—' })}
        <Button size="sm" variant="outline" className="ml-2 h-8 whitespace-normal"
          disabled={!potAprovar || ocupat} onClick={() => setObert(true)}>
          {t('org.unlink')}
        </Button>
      </div>

      {/* Solo lo dice: no hay botón que lo arregle solo, porque elegir el nombre bueno es una
          decisión del equipo (ver la cabecera del fichero). Tono `aviso`, no `error`: no bloquea
          nada, es una discrepancia de datos, no un fallo del circuito (§2bis). */}
      {(divergeixNom || divergeixNif) && (
        <div className="mt-1 space-y-0.5 rounded-md bg-aviso-fondo p-2 text-xs text-aviso">
          {divergeixNom && <p>{t('org.nom_divergeix', { propi: propiNom ?? '—', altre: altraNom ?? '—' })}</p>}
          {divergeixNif && <p>{t('org.nif_divergeix', { propi: propiNif ?? '—', altre: altraNif ?? '—' })}</p>}
        </div>
      )}

      <Dialog open={obert} onOpenChange={(v) => { if (!v) setObert(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('org.unlink_title')}</DialogTitle>
            <DialogDescription>{t('org.unlink_desc', { nom: altra.nom || '—' })}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('org.unlink_warn')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setObert(false)}>{t('c.cancel')}</Button>
            <Button disabled={ocupat} onClick={() => void desenllacar()}>{t('org.unlink')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
