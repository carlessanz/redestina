// El CATÁLOGO de productos para pintar el icono de una oferta: nombre y familia, cargado una
// vez por sesión. La familia es el respaldo cuando un producto no tiene dibujo propio.
//
// ⚠️ Hasta el 29-09-2026 esto gestionaba además una FOTO por producto (bucket
//    `fotos-productes`, RPC `fixar_foto_producte`). Se sustituyeron por iconos propios
//    (`iconaProducte.ts`); el bucket, las columnas y la RPC siguen en la base sin uso.

import { supabase } from './supabase'
import type { ProducteFoto } from './fotoOferta'

export interface ProducteCataleg extends ProducteFoto {
  nombre: string
}

let promesa: Promise<Map<string, ProducteCataleg>> | null = null

/**
 * El catálogo UNA vez por sesión (patrón de `municipis.ts`). Si falla se olvida la promesa,
 * así la siguiente llamada lo reintenta en vez de quedarse vacía.
 */
export function carregaCataleg(): Promise<Map<string, ProducteCataleg>> {
  if (!promesa) {
    promesa = (async () => {
      const { data, error } = await supabase.from('productos').select('nombre, familia').order('nombre')
      if (error) { promesa = null; return new Map() }
      return new Map(((data ?? []) as ProducteCataleg[]).map((p) => [p.nombre, p]))
    })()
  }
  return promesa
}
