// El doble del cliente de Supabase que usan las pruebas de `_shared/`.
//
// No es un mock del módulo: los módulos de `_shared/` reciben el cliente por parámetro
// justamente para esto. Es una base de datos en memoria con los mismos filtros que usan
// las consultas reales (`eq`, `ilike`, `in`, `limit`, `maybeSingle`), así que lo que se
// prueba es la lógica de las consultas —qué tablas se miran y con qué condiciones— y no
// una respuesta escrita a mano, que daría igual lo que el módulo pidiera.
//
// Vive aquí y no dentro de un fichero de pruebas porque lo comparten `gate.test.ts` y
// `whatsapp.test.ts`, y este segundo necesita además saber qué tablas se ESCRIBEN: la
// diferencia entre «no se ha enviado» y «no se ha enviado y tampoco se ha registrado un
// fallo que no existe» solo se ve mirando eso.

export type Fila = Record<string, unknown>
/** Una tabla son sus filas, o la palabra `error` si se quiere simular que falla. */
export type Tabla = Fila[] | 'error'
export type BaseFalsa = Record<string, Tabla>

export class Consulta {
  private filtros: ((f: Fila) => boolean)[] = []
  private tope: number | null = null

  constructor(private tabla: Tabla) {}

  select(_columnas?: string) { return this }

  eq(columna: string, valor: unknown) {
    this.filtros.push((f) => f[columna] === valor)
    return this
  }

  /** `ilike` sin comodines, que es como lo usa el gate: igualdad sin distinguir mayúsculas. */
  ilike(columna: string, valor: unknown) {
    const v = String(valor).toLowerCase()
    this.filtros.push((f) => String(f[columna] ?? '').toLowerCase() === v)
    return this
  }

  in(columna: string, valores: unknown[]) {
    this.filtros.push((f) => valores.includes(f[columna]))
    return this
  }

  limit(n: number) {
    this.tope = n
    return this
  }

  private resolver(): { data: Fila[] | null; error: { message: string } | null } {
    if (this.tabla === 'error') return { data: null, error: { message: 'consulta fallida' } }
    let filas = this.tabla.filter((f) => this.filtros.every((p) => p(f)))
    if (this.tope !== null) filas = filas.slice(0, this.tope)
    return { data: filas, error: null }
  }

  maybeSingle(): Promise<{ data: Fila | null; error: { message: string } | null }> {
    const { data, error } = this.resolver()
    return Promise.resolve({ data: data?.[0] ?? null, error })
  }

  // Thenable: `await consulta` y `Promise.all([...])` funcionan igual que con supabase-js.
  then<R>(
    alCumplir: (v: { data: Fila[] | null; error: { message: string } | null }) => R,
    alFallar?: (e: unknown) => R,
  ): Promise<R> {
    return Promise.resolve(this.resolver()).then(alCumplir, alFallar)
  }
}

/** Una escritura registrada, para poder afirmar que NO se ha escrito nada. */
export interface Escritura {
  tabla: string
  operacion: 'insert' | 'upsert'
  valores: unknown
}

// El tipo del cliente es `any` en los propios módulos de `_shared/` (no hay tipos de Deno
// aquí), así que el doble lo devuelve igual: es el único `any` de estas pruebas.
// deno-lint-ignore no-explicit-any
export type ClienteFalso = any

export function crearCliente(base: BaseFalsa): {
  cliente: ClienteFalso
  consultadas: string[]
  escrituras: Escritura[]
} {
  const consultadas: string[] = []
  const escrituras: Escritura[] = []
  const cliente = {
    from(tabla: string) {
      consultadas.push(tabla)
      const consulta = new Consulta(base[tabla] ?? []) as unknown as Record<string, unknown>
      consulta.insert = (valores: unknown) => {
        escrituras.push({ tabla, operacion: 'insert', valores })
        return Promise.resolve({ data: null, error: null })
      }
      consulta.upsert = (valores: unknown) => {
        escrituras.push({ tabla, operacion: 'upsert', valores })
        return Promise.resolve({ data: null, error: null })
      }
      return consulta
    },
  }
  return { cliente, consultadas, escrituras }
}
