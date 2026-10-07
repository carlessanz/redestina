// Una whitelist de pruebas (números de Meta, correos de Resend) con su alta y su baja.
//
// Vivía dentro de `Dashboard.tsx` y ocupaba media pantalla de la landing del equipo. No es
// trabajo del día: es un ajuste del entorno de pruebas, de los que se tocan una vez cada
// varios meses (§4, §8). Desde el 14-09-2026 se monta en **Configuració**, junto al modo
// test y al interruptor de WhatsApp, que es donde están los otros interruptores que
// deciden a quién se envía. El componente no cambió al mudarse: mismos props, mismos
// textos.
//
// No sabe de qué lista es: recibe los elementos ya normalizados a `{clave, etiqueta}` y
// dos funciones. Así sirve igual para `meta_test_recipients` y para
// `email_test_recipients`, que son dos tablas distintas con el mismo gesto.

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useT } from '../lib/i18n'
import { useConfirma } from './DialegConfirma'

export default function GestorWhitelist({
  titulo, ayuda, items, placeholderClave, placeholderEtiqueta, max, onAdd, onDelete,
  addLabel, noneLabel, deleteLabel, motiuBloqueig,
}: {
  titulo: string; ayuda: string; items: { clave: string; etiqueta: string | null }[]
  placeholderClave: string; placeholderEtiqueta: string; max: number
  addLabel: string; noneLabel: string
  /** Etiqueta accesible del aspa de cada fila (ya traducida). */
  deleteLabel: string
  /**
   * Si viene, la lista es de solo lectura y esto dice por qué (ya traducido). Escribir exige
   * `pot_aprovar()` (§4bis): un técnico la ve, pero sus altas y bajas las rechaza la base —
   * las altas con un error y las bajas en silencio, con cero filas borradas—.
   */
  motiuBloqueig?: string
  /** Devuelven el mensaje de error ya traducido, o `null` si fue bien. */
  onAdd: (clave: string, etiqueta: string) => Promise<string | null>
  onDelete: (clave: string) => Promise<string | null>
}) {
  const [clave, setClave] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  return (
    <Card>
      {dialeg}
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {items.length === 0 && <p className="text-sm text-muted-foreground">{noneLabel}</p>}
          {items.map((r) => (
            <div key={r.clave} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              {/* El correo y su etiqueta, uno encima del otro en una columna que SÍ encoge
                  (`min-w-0`): en una sola fila, un correo largo no bajaba de su ancho y
                  empujaba el aspa fuera de la tarjeta en el móvil. Desde `sm`, en línea. */}
              <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
                <span className="break-all font-medium tabular-nums">{r.clave}</span>
                <span className="break-words text-muted-foreground">{r.etiqueta ?? '—'}</span>
              </div>
              {!motiuBloqueig && (
                <Button variant="ghost" size="icon" className="size-11 shrink-0 md:size-7" aria-label={deleteLabel}
                  onClick={async () => {
                    if (!(await confirma({
                      titol: t('wl.remove_t', { x: r.clave }),
                      descripcio: t('wl.remove_d'),
                      confirmar: t('wl.remove_ok'),
                      destructiu: true,
                    }))) return
                    const err = await onDelete(r.clave)
                    setError(err)
                  }}>
                  <X className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {motiuBloqueig && <p className="text-xs text-aviso">{motiuBloqueig}</p>}
        {!motiuBloqueig && items.length < max && (
          <div className="flex flex-wrap gap-2">
            <Input className="flex-1" placeholder={placeholderClave} value={clave}
              onChange={(e) => { setClave(e.target.value); setError(null) }} />
            <Input className="flex-1" placeholder={placeholderEtiqueta} value={etiqueta}
              onChange={(e) => setEtiqueta(e.target.value)} />
            <Button className="h-11 whitespace-normal md:h-9" onClick={async () => {
              const err = await onAdd(clave, etiqueta)
              if (err) { setError(err); return }
              setClave(''); setEtiqueta('')
            }}>{addLabel}</Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
