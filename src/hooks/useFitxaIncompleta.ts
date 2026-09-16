// Qué le falta a la ficha de la organización para poder operar.
//
// POR QUÉ ES UN HOOK Y NO VIVE DENTRO DE LA BANDA (16-09-2026). Lo miran DOS sitios —la
// banda de aviso y el badge de «La meva organització» en el menú— y si cada uno lo
// calculara por su cuenta podrían decir cosas distintas: el clásico contador que marca 2 y
// una pantalla que enseña 3. Se calcula una vez en `AppShell` y se reparte, igual que los
// contadores del equipo (§6ter).
//
// ⚠️ NO DUPLICA LA LISTA DE OBLIGATORIOS DEL CONVENIO. Quién decide qué exige el convenio es
//    el servidor (`formulari.obligatoris`, ver `FirmaConveni`); aquí solo están los cuatro
//    que la ficha necesita para que ese formulario llegue relleno. Si mañana el convenio
//    pide uno más, este aviso no lo sabrá — y es preferible a que dos sitios declaren la
//    misma regla y se separen sin que nadie lo note.
//
// ⚠️ POR QUÉ AHORA ES ROJO Y ANTES NO. Nació en tono de aviso porque «no bloquea nada». Eso
//    dejó de ser cierto el mismo día: con `fecha_corte_convenios` puesta, sin convenio
//    vigente no se puede publicar ni mostrar interés, y sin NIF ni domicilio el convenio no
//    se puede firmar en condiciones. O sea que una ficha a medias **sí impide operar**, solo
//    que con un paso de por medio.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAppContext } from './useAppContext'

/** Lo que el registro no pregunta y el convenio sí imprime. */
export const CAMPS_NECESSARIS = ['nif', 'direccion', 'codigo_postal', 'poblacion'] as const

export function useFitxaIncompleta(): { falten: string[]; carregant: boolean } {
  const { ctx, rolActiu } = useAppContext()
  const [falten, setFalten] = useState<string[]>([])
  const [carregant, setCarregant] = useState(true)

  const extern = rolActiu === 'productor' || rolActiu === 'receptor'
  const orgs = ctx?.organitzacions ?? []
  // Clave estable del contenido: `orgs` es un array nuevo en cada render del contexto.
  const clau = orgs.map((o) => `${o.tipo}:${o.id}`).join(',')

  useEffect(() => {
    if (!extern || clau === '') { setFalten([]); setCarregant(false); return }
    let viu = true

    void (async () => {
      const prods = orgs.filter((o) => o.tipo === 'productor').map((o) => o.id)
      const ents = orgs.filter((o) => o.tipo === 'entidad').map((o) => o.id)
      // Columnas explícitas y en UN literal (§7): con una expresión, supabase-js devuelve
      // `GenericStringError` y la fila se queda sin columnas.
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
      // Basta con que le falte a UNA ficha: con doble rol se firman las dos.
      const buits = new Set<string>()
      for (const f of files) {
        for (const c of CAMPS_NECESSARIS) {
          if (!f[c] || String(f[c]).trim() === '') buits.add(c)
        }
      }
      setFalten([...buits])
      setCarregant(false)
    })()

    return () => { viu = false }
  }, [extern, clau]) // eslint-disable-line react-hooks/exhaustive-deps

  return { falten, carregant }
}
