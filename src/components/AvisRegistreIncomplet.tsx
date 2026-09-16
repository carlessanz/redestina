// «Acaba d'omplir la teva fitxa» — la banda que avisa de lo que el registro no preguntó.
//
// POR QUÉ EXISTE (16-09-2026). El alta de `/registre` pide lo mínimo para poder entrar
// —nombre, persona, correo, teléfono, población— y eso es deliberado: un formulario largo
// en la puerta es un formulario que nadie termina. Pero el NIF, el domicilio y el código
// postal **hacen falta enseguida**: son lo que el convenio imprime, y sin ellos la primera
// vez que alguien intenta firmar se encuentra el formulario a medias. El cliente lo pidió
// así: «un primer registro como el actual para poder acceder al panel, y después un mensaje
// tipo el de firmar el convenio que diga completa tu registro».
//
// ⚠️ MISMO PATRÓN QUE `AvisConveni`, Y NO POR PARECERSE: los dos dicen «te falta algo para
//    poder operar» y los dos viven encima de cualquier pantalla del panel. Lo que cambia es
//    que este **no bloquea nada** —se puede mirar el panel entero sin NIF— así que va en
//    tono de aviso y nunca en rojo.
//
// ⚠️ NO DUPLICA LA LISTA DE CAMPOS OBLIGATORIOS DEL CONVENIO. La autoridad de qué exige el
//    convenio es el servidor (`formulari.obligatoris`, ver `FirmaConveni`); aquí solo se
//    miran los cuatro que la ficha necesita para que ese formulario llegue relleno. Si
//    algún día el convenio pide uno más, este aviso no lo sabrá — y es preferible a que dos
//    sitios declaren la misma regla y se separen.

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ClipboardList } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useAppContext } from '../hooks/useAppContext'
import { Button } from '@/components/ui/button'

/**
 * Lo que el registro no pregunta y el convenio sí necesita. El nombre de la columna es el
 * mismo en las dos tablas salvo el teléfono, que aquí no se mira porque el alta sí lo pide.
 */
const NECESSARIS = ['nif', 'direccion', 'codigo_postal', 'poblacion'] as const

export default function AvisRegistreIncomplet() {
  const { t } = useT()
  const { ctx, rolActiu } = useAppContext()
  const [falten, setFalten] = useState<string[]>([])

  const extern = rolActiu === 'productor' || rolActiu === 'receptor'
  const orgs = ctx?.organitzacions ?? []

  useEffect(() => {
    if (!extern || orgs.length === 0) { setFalten([]); return }
    let viu = true

    void (async () => {
      const prods = orgs.filter((o) => o.tipo === 'productor').map((o) => o.id)
      const ents = orgs.filter((o) => o.tipo === 'entidad').map((o) => o.id)
      // Columnas explícitas y en un solo literal (§7): un `select('*')` aquí no compilaría
      // con el tipo de la fila.
      const [p, e] = await Promise.all([
        prods.length
          ? supabase.from('productores').select('nif, direccion, codigo_postal, poblacion').in('id', prods)
          : Promise.resolve({ data: [] }),
        ents.length
          ? supabase.from('entidades').select('nif, direccion, codigo_postal, poblacion').in('id', ents)
          : Promise.resolve({ data: [] }),
      ])
      if (!viu) return

      const files = [...(p.data ?? []), ...(e.data ?? [])] as Record<string, string | null>[]
      // Basta con que le falte a UNA ficha: con doble rol, las dos se firman.
      const buits = new Set<string>()
      for (const f of files) {
        for (const c of NECESSARIS) {
          if (!f[c] || String(f[c]).trim() === '') buits.add(c)
        }
      }
      setFalten([...buits])
    })()

    return () => { viu = false }
    // `orgs` es un array nuevo en cada render del contexto: se depende de su contenido.
  }, [extern, orgs.map((o) => `${o.tipo}:${o.id}`).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!extern || falten.length === 0) return null

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-accent bg-accent/30 px-4 py-3 text-sm"
    >
      <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0">
        <span className="font-medium">{t('reg_inc.titol')}</span>{' '}
        <span className="text-muted-foreground">
          {t('reg_inc.falten', { camps: falten.map((c) => t(`f.${c}`)).join(', ') })}
        </span>
      </p>
      <Button asChild size="sm" variant="outline" className="ml-auto h-11 shrink-0 whitespace-normal md:h-8">
        <Link to="/organitzacio">{t('reg_inc.completa')}</Link>
      </Button>
    </div>
  )
}
