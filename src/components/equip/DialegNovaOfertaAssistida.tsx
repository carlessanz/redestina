// El alta de una oferta EN NOMBRE DE otra organización, desde el índice del ciclo guiado.
//
// POR QUÉ EXISTE. `FormulariNovaOferta` ya acepta el productor por prop —es lo que permitió
// que el equipo publicara por otro (§6quater)— pero para llegar a él había que entrar en un
// lote que ya existiera. O sea: se podía continuar un ciclo, no empezarlo. Esto es la puerta
// que faltaba, y va en el índice porque es donde alguien va a buscar «un lote nuevo».
//
// ⚠️ **NO hay un segundo formulario de alta.** Es el mismo componente que usa el productor en
//    su panel, con el mismo descriptor servido por `crear-oferta/campos` y la misma llamada.
//    Lo único que cambia es de dónde sale `productorId`: aquí lo elige el equipo.
//
// ⚠️ **El bloqueo por convenio entra por PROP y no se lee aquí dentro**, igual que en el
//    panel: `useConveni` mira las organizaciones de la CUENTA, y la del equipo no tiene
//    ninguna. Leído dentro daría siempre «sin convenio» y dejaría al dinamizador delante de
//    un botón apagado que no le corresponde. Quien conoce el convenio del productor elegido
//    es la escalera del lote, que aún no existe: por eso aquí se publica y el bloqueo, si lo
//    hay, lo dice la base con su `42501` y lo explica la fase 1 del ciclo.

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import FormulariNovaOferta from '../FormulariNovaOferta'
import type { ResultatNovaOferta } from '../FormulariNovaOferta'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  obert: boolean
  onTancar: () => void
  /** La oferta recién creada: quien monta el diálogo decide a dónde lleva. */
  onCreada: (r: ResultatNovaOferta) => void
}

interface Fitxa { id: string; nom: string }

export default function DialegNovaOfertaAssistida({ obert, onTancar, onCreada }: Props) {
  const { t } = useT()
  const [productors, setProductors] = useState<Fitxa[]>([])
  const [carregant, setCarregant] = useState(true)
  const [cerca, setCerca] = useState('')
  const [triat, setTriat] = useState('')

  useEffect(() => {
    if (!obert) { setTriat(''); setCerca(''); return }
    let viu = true
    void (async () => {
      setCarregant(true)
      const { data } = await supabase
        .from('productores')
        .select('id, name, empresa')
        .eq('activo', true)
        .order('name')
      if (!viu) return
      const files = (data as { id: string; name: string | null; empresa: string | null }[] | null) ?? []
      setProductors(files.map((x) => ({ id: x.id, nom: x.empresa || x.name || '—' })))
      setCarregant(false)
    })()
    return () => { viu = false }
  }, [obert])

  const visibles = useMemo(() => {
    const q = cerca.trim().toLowerCase()
    if (!q) return productors
    return productors.filter((p) => p.nom.toLowerCase().includes(q))
  }, [productors, cerca])

  return (
    <Dialog open={obert} onOpenChange={(v) => { if (!v) onTancar() }}>
      {/* 80 × 88, y sin cerrar al pinchar fuera: el cuestionario tiene catorce campos y un
          clic despistado a media alta sería caro. Mismo criterio que los otros asistidos. */}
      <DialogContent
        className="flex h-[88vh] w-[80vw] max-w-none flex-col gap-4 p-6 sm:max-w-none"
        showCloseButton
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('canalz.nova_title')}</DialogTitle>
          <DialogDescription>{t('canalz.nova_hint')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Primero de quién es. Sin productor no hay descriptor que pedir: los catálogos
              de `crear-oferta/campos` dependen de sus ubicaciones. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">
                {t('canalz.nova_cerca')}
              </Label>
              <Input
                value={cerca}
                onChange={(e) => setCerca(e.target.value)}
                placeholder={t('canalz.nova_cerca')}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">
                {t('canalz.c_productor')}
              </Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-base md:text-sm"
                value={triat}
                onChange={(e) => setTriat(e.target.value)}
              >
                <option value="">—</option>
                {visibles.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </div>
          </div>

          {carregant && (
            <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />{t('c.loading')}
            </p>
          )}

          {!carregant && !triat && (
            <p className="mt-4 text-sm text-muted-foreground">{t('canalz.nova_tria')}</p>
          )}

          {triat && (
            <div className="mt-4">
              {/* `key` por productor: al cambiar de organización hay que volver a pedir el
                  descriptor y empezar de cero. Sin ella, React reutilizaría el formulario
                  con las respuestas de la anterior dentro. */}
              <FormulariNovaOferta
                key={triat}
                productorId={triat}
                onCreada={onCreada}
                onCancel={onTancar}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
