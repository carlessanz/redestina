// Borrar una organización desde la ficha del equipo: el único camino es
// `borrar_ficha_completa()` (§4/§7, deuda 108), una RPC transaccional que se niega con el
// motivo si hay ofertas, documentos, albaranes o cierres, y que arrastra las dos fichas del
// doble rol a la vez si se pide —nada de dos `.delete()` sueltos que dejen media organización
// borrada—.
//
// Desde el 04-11-2026 (decisión de Carles, `20270508100000`) el recorrido es:
//   1. PREGUNTAR ANTES qué bloquea (`bloqueigs_esborrat_fitxa`, de solo lectura). Si lo que se
//      quiere borrar tiene ofertas o documentación, no se ofrece borrar: se dice por qué y se
//      propone DESACTIVAR (`desactivar_organitzacio`, o `desactivar_fitxa` para un solo papel),
//      que es reversible y conserva el historial.
//   2. Con doble rol, elegir un papel o los dos (solo entre lo que se puede borrar).
//   3. Confirmación fuerte: qué se pierde, y el botón solo se enciende al escribir la palabra
//      («esborrar» / «borrar», `esb.paraula`). Al lado, «Desactiva-la» como salida recomendada.
// La RPC vuelve a comprobar los bloqueos dentro de su transacción: si entre medias aparece uno,
// su `bloqueig_esborrat` abre el mismo diálogo del paso 1.

import { useState } from 'react'
import { toast } from 'sonner'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { textError } from '../lib/textError'
import { useTria } from '../components/DialegConfirma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Tipus = 'productor' | 'entidad'
type T = (k: string, p?: Record<string, string | number>) => string

export interface FitxesOrganitzacio {
  orgId: string
  productorId: string | null
  entidadId: string | null
  /** Si cada papel está activo: decide si «Desactiva» tiene algo que hacer. */
  productorActiu: boolean
  entidadActiu: boolean
  nom: string
}

/** Lo que hace el botón «Desactiva»: la RPC, sus argumentos y su rótulo. */
interface Desactivacio { rpc: string; args: Record<string, unknown>; text: string }

type Estat =
  | { fase: 'bloquejat'; nom: string; motius: string[]; desactiva: Desactivacio | null }
  | {
      fase: 'confirma'; nom: string; tipus: Tipus; tambeGermana: boolean
      /** La ficha que se pasa a `borrar_ficha_completa` (la del papel elegido). */
      fitxaId: string
      /** Con doble rol y un solo papel: la organización se queda con el otro. */
      quedaAltre: boolean
      comptes: number
      desactiva: Desactivacio | null
    }

/**
 * Un código de bloqueo (`ofertes`, `albarans`… con `@germana` si lo aporta la hermana) en
 * texto. `rol` antepone el papel cuando, con doble rol, se listan los de las dos fichas.
 */
function textMotiu(t: T, codi: string, rol?: string): string {
  const [base, germana] = codi.split('@')
  const text = t(`rec.block_${base}`) + (germana ? t('rec.block_germana') : '')
  return rol ? `${rol}: ${text}` : text
}

/**
 * `borrar_ficha_completa()` responde `22023 bloqueig_esborrat: <codis>` cuando la ficha —o su
 * hermana— tiene ofertas o documentación. Los códigos van en el MESSAGE separados por comas,
 * con el sufijo `@germana` cuando el bloqueo lo aporta la otra ficha. `null` si no es eso.
 */
export function codisBloqueig(err: { message: string }): string[] | null {
  const marca = 'bloqueig_esborrat:'
  const i = err.message.indexOf(marca)
  if (i === -1) return null
  return err.message.slice(i + marca.length).split(',').map((c) => c.trim()).filter(Boolean)
}

/** El texto de un error de borrado en una línea (para lo que no abre el diálogo). */
export function missatgeEsborrat(t: T, err: { code?: string; message: string }): string {
  const codis = codisBloqueig(err)
  if (!codis) {
    if (err.code === '42501') return t('rec.no_permission_delete')
    return textError(t, err.message)
  }
  return `${t('rec.blocked')} ${codis.map((c) => textMotiu(t, c)).join('; ')}`
}

export function useEsborrarFitxa(onEsborrat: () => void, onDesactivat: () => void): {
  esborra: (f: FitxesOrganitzacio) => Promise<void>
  ocupat: boolean
  error: string | null
  dialegs: ReactNode
} {
  const { t } = useT()
  const { tria, dialeg: dialegTria } = useTria()
  const [ocupat, setOcupat] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estat, setEstat] = useState<Estat | null>(null)
  const [paraula, setParaula] = useState('')

  const rolText = (tipus: Tipus) => t(tipus === 'productor' ? 'ef.paper_ofertant' : 'ef.paper_receptor')

  /** Desactivar lo que se quería borrar: la organización entera, o un papel con doble rol. */
  function desactivacio(f: FitxesOrganitzacio, nomesPaper: Tipus | null): Desactivacio | null {
    if (nomesPaper) {
      const id = nomesPaper === 'productor' ? f.productorId : f.entidadId
      const actiu = nomesPaper === 'productor' ? f.productorActiu : f.entidadActiu
      if (!id || !actiu) return null
      return {
        rpc: 'desactivar_fitxa', args: { p_tipus: nomesPaper, p_id: id },
        text: t('esb.desactiva_paper', { rol: rolText(nomesPaper).toLowerCase() }),
      }
    }
    if (!f.productorActiu && !f.entidadActiu) return null
    return { rpc: 'desactivar_organitzacio', args: { p_org: f.orgId }, text: t('ef.desactiva_org') }
  }

  async function bloqueigs(tipus: Tipus, id: string | null): Promise<string[] | null> {
    if (!id) return []
    const { data, error: e } = await supabase.rpc('bloqueigs_esborrat_fitxa', { p_tipo: tipus, p_ficha: id })
    if (e) { setError(missatgeEsborrat(t, e)); return null }
    return ((data as { codi: string }[] | null) ?? []).map((b) => b.codi)
  }

  async function esborra(f: FitxesOrganitzacio) {
    setError(null)
    setOcupat(true)
    const bP = await bloqueigs('productor', f.productorId)
    const bE = bP === null ? null : await bloqueigs('entidad', f.entidadId)
    setOcupat(false)
    if (bP === null || bE === null) return

    const dues = Boolean(f.productorId && f.entidadId)
    const motius = [
      ...bP.map((c) => textMotiu(t, c, dues ? rolText('productor') : undefined)),
      ...bE.map((c) => textMotiu(t, c, dues ? rolText('entidad') : undefined)),
    ]

    // Paso 1: nada que se pueda borrar → por qué, y desactivar en su lugar.
    const bloqP = bP.length > 0
    const bloqE = bE.length > 0
    if ((!dues && motius.length > 0) || (dues && bloqP && bloqE)) {
      setEstat({ fase: 'bloquejat', nom: f.nom, motius, desactiva: desactivacio(f, null) })
      return
    }

    // Paso 2: con doble rol, un papel o los dos — solo entre lo que no está bloqueado.
    let tipus: Tipus = f.productorId ? 'productor' : 'entidad'
    let tambeGermana = false
    if (dues) {
      const bloquejat: Tipus | null = bloqP ? 'productor' : bloqE ? 'entidad' : null
      const opcions = [
        ...(!bloqP ? [{ valor: 'productor', text: t('rec.dual_only_producer'), destructiu: true }] : []),
        ...(!bloqE ? [{ valor: 'entidad', text: t('rec.dual_only_entity'), destructiu: true }] : []),
        ...(!bloquejat ? [{ valor: 'dues', text: t('rec.dual_both'), destructiu: true }] : []),
      ]
      const desactivaBloquejat = bloquejat ? desactivacio(f, bloquejat) : null
      if (desactivaBloquejat) opcions.push({ valor: 'desactiva', text: desactivaBloquejat.text, destructiu: false })
      const avisBloqueig = bloquejat
        ? `\n\n${t('esb.paper_bloquejat', { rol: rolText(bloquejat).toLowerCase() })}\n· ${motius.join('\n· ')}`
        : ''
      const opcio = await tria({
        titol: t('rec.confirm_delete_t', { name: f.nom }),
        descripcio: t('rec.dual_delete_q') + avisBloqueig,
        opcions,
      })
      if (!opcio) return
      if (opcio === 'desactiva' && desactivaBloquejat) { await desactiva(desactivaBloquejat); return }
      if (opcio === 'dues') tambeGermana = true
      else tipus = opcio as Tipus
    }

    // Cuántas cuentas cuelgan de lo que se borra: se quedan sin panel, y eso se dice ANTES.
    const comptes = new Set<string>()
    for (const [col, id, tip] of [['productor_id', f.productorId, 'productor'], ['entidad_id', f.entidadId, 'entidad']] as const) {
      if (!id || (!tambeGermana && tip !== tipus)) continue
      const { data } = await supabase.from('membresias').select('user_id').eq(col, id)
      for (const m of (data as { user_id: string }[] | null) ?? []) comptes.add(m.user_id)
    }

    // Paso 3: la confirmación fuerte.
    setParaula('')
    setEstat({
      fase: 'confirma', nom: f.nom, tipus, tambeGermana,
      fitxaId: (tipus === 'productor' ? f.productorId : f.entidadId) as string,
      quedaAltre: dues && !tambeGermana,
      comptes: comptes.size,
      desactiva: desactivacio(f, dues && !tambeGermana ? tipus : null),
    })
  }

  async function desactiva(d: Desactivacio) {
    setOcupat(true)
    const { error: e } = await supabase.rpc(d.rpc, d.args)
    setOcupat(false)
    if (e) { toast.error(textError(t, e.message)); return }
    setEstat(null)
    toast.success(t('ef.estat_canviat'))
    onDesactivat()
  }

  async function confirmaEsborrat(e: Extract<Estat, { fase: 'confirma' }>) {
    setOcupat(true)
    const { error: delError } = await supabase.rpc('borrar_ficha_completa', {
      p_tipo: e.tipus,
      p_ficha_id: e.fitxaId,
      p_tambe_germana: e.tambeGermana,
    })
    setOcupat(false)
    if (delError) {
      // Un bloqueo aparecido entre la pregunta y el borrado: el mismo diálogo del paso 1.
      const codis = codisBloqueig(delError)
      if (codis) {
        setEstat({ fase: 'bloquejat', nom: e.nom, motius: codis.map((c) => textMotiu(t, c)), desactiva: e.desactiva })
        return
      }
      setEstat(null)
      setError(missatgeEsborrat(t, delError))
      return
    }
    setEstat(null)
    toast.success(e.tambeGermana ? t('rec.dual_deleted') : t('rec.deleted'))
    onEsborrat()
  }

  const coincideix = paraula.trim().toLocaleLowerCase() === t('esb.paraula').toLocaleLowerCase()
  const tanca = () => { if (!ocupat) setEstat(null) }

  const dialeg = (
    <Dialog open={estat !== null} onOpenChange={(v) => { if (!v) tanca() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="dialeg-esborrar">
        {estat?.fase === 'bloquejat' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('esb.bloquejat_t', { name: estat.nom })}</DialogTitle>
              <DialogDescription>{t('esb.bloquejat_d')}</DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="esborrar-motius">
              {estat.motius.map((m) => <li key={m}>{m}</li>)}
            </ul>
            <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">
              {estat.desactiva ? t('esb.recomana_desactivar') : t('esb.ja_inactiva')}
            </p>
            <DialogFooter>
              <Button variant="outline" className="h-11 whitespace-normal md:h-8" onClick={tanca}>{t('c.close')}</Button>
              {estat.desactiva && (
                <Button className="h-11 whitespace-normal md:h-8" disabled={ocupat}
                  onClick={() => estat.desactiva && void desactiva(estat.desactiva)}>
                  {estat.desactiva.text}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
        {estat?.fase === 'confirma' && (
          <>
            <DialogHeader>
              <DialogTitle>{t('rec.confirm_delete_t', { name: estat.nom })}</DialogTitle>
              <DialogDescription>{t('esb.que_es_perd')}</DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm" data-testid="esborrar-consequencies">
              <li>{estat.tambeGermana ? t('esb.conseq_dues') : t('esb.conseq_fitxa', { fitxa: t(`esb.fitxa_${estat.tipus}`) })}</li>
              {estat.comptes > 0 && <li>{t('esb.conseq_comptes', { n: estat.comptes })}</li>}
              <li>{estat.quedaAltre ? t('esb.conseq_queda_altre') : t('esb.conseq_org')}</li>
              <li className="font-medium">{t('esb.conseq_irreversible')}</li>
            </ul>
            <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('esb.recomana_desactivar')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="esborrar-paraula">{t('esb.escriu', { paraula: t('esb.paraula') })}</Label>
              <Input id="esborrar-paraula" value={paraula} autoComplete="off" autoCapitalize="none" spellCheck={false}
                onChange={(ev) => setParaula(ev.target.value)} />
            </div>
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button variant="outline" className="h-11 whitespace-normal md:h-8" onClick={tanca}>{t('c.cancel')}</Button>
              {estat.desactiva && (
                <Button variant="outline" className="h-11 whitespace-normal md:h-8" disabled={ocupat}
                  onClick={() => estat.desactiva && void desactiva(estat.desactiva)}>
                  {estat.desactiva.text}
                </Button>
              )}
              <Button variant="destructive" className="h-11 whitespace-normal md:h-8"
                disabled={!coincideix || ocupat}
                onClick={() => void confirmaEsborrat(estat)}>
                {t('esb.esborra_definitivament')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )

  return { esborra, ocupat, error, dialegs: <>{dialeg}{dialegTria}</> }
}
