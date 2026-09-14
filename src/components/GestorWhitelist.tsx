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

export default function GestorWhitelist({
  titulo, ayuda, items, placeholderClave, placeholderEtiqueta, max, onAdd, onDelete,
  addLabel, noneLabel,
}: {
  titulo: string; ayuda: string; items: { clave: string; etiqueta: string | null }[]
  placeholderClave: string; placeholderEtiqueta: string; max: number
  addLabel: string; noneLabel: string
  /** Devuelve el mensaje de error, o `null` si fue bien. */
  onAdd: (clave: string, etiqueta: string) => Promise<string | null>
  onDelete: (clave: string) => Promise<void>
}) {
  const [clave, setClave] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {items.length === 0 && <p className="text-sm text-muted-foreground">{noneLabel}</p>}
          {items.map((r) => (
            <div key={r.clave} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="font-medium tabular-nums">{r.clave}</span>
              <span className="flex-1 text-muted-foreground">{r.etiqueta ?? '—'}</span>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => void onDelete(r.clave)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        {items.length < max && (
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
