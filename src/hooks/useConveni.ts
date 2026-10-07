// ¿La organización activa puede operar, o le falta el convenio?
//
// LA REGLA, EN UN SITIO (§3.2.2 del plan y D7). Sin convenio vigente:
//   · antes de la fecha de corte  → se AVISA, y se puede operar;
//   · desde la fecha de corte      → se BLOQUEA.
// Es exactamente lo que hace `exigir_convenio()` en la base, que antes del corte devuelve
// texto y después levanta 42501. Aquí no se decide nada nuevo: se lee lo mismo para poder
// enseñarlo y para no dejar al usuario delante de un botón que va a fallar.
//
// POR QUÉ NO SE COMPRUEBA CON `convenio_vigente()`. Esa RPC responde por valorización y
// por parte (entrega o recibe), que es lo que necesita una operación concreta. El panel no
// tiene todavía ninguna operación entre manos: quiere saber si la organización está en
// regla. Así que se leen sus convenios —la RLS ya solo le deja ver los suyos— y se mira el
// estado más avanzado, igual que hace `BadgeConveni` en la ficha.
//
// El equipo no pasa por aquí: trabaja en nombre de otros y no tiene organización propia.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAppContext } from './useAppContext'
import { useTicAvisos } from '../lib/refrescAvisos'
import type { ConvenioEstado, ConvenioTipo } from '../types'
import { ORDRE_CONVENI as ORDRE } from '../lib/documentsPanell'

/** Lo que el panel necesita saber, ya masticado. */
export interface EstatConveni {
  /** Estado más avanzado de sus convenios, o null si no tiene ninguno. */
  estat: ConvenioEstado | null
  /** La fecha de corte, o null si la Fundación todavía no la ha puesto. */
  dataTall: string | null
  /** Sin convenio vigente. Es el que decide si se avisa. */
  avisa: boolean
  /** Sin convenio vigente Y con el corte ya pasado. Es el que decide si se bloquea. */
  bloqueja: boolean
  /**
   * Los TIPOS de convenio vigentes. `estat` dice el más avanzado de todos, y eso no basta
   * en el Mercat: una entidad con `don_rec` vigente sale «vigent», pero una oferta de venta
   * o maquila le exige además el `com` (`convenios_exigidos`, parte `recibe`).
   */
  tipusVigents: ConvenioTipo[]
  /** La fecha de corte ya ha pasado: desde ahí, la base rechaza con 42501 (`sense_conveni`). */
  tallPassat: boolean
  carregant: boolean
  /**
   * La última lectura FALLÓ (red, base). No se sabe si tiene convenio, y lo que no se sabe
   * no bloquea ni avisa: `avisa`, `bloqueja` y `tallPassat` valen `false` y se reintenta
   * solo. Antes un error se leía como «cero convenios» y, con el corte pasado, apagaba
   * «Publicar» o «M'interessa» a una organización con el convenio vigente. Quien decide de
   * verdad es la base (`exigir_convenio()`), que sigue cortando si de verdad falta.
   */
  desconegut: boolean
  /**
   * Vuelve a leer el estado. Hace falta desde que se puede firmar sin salir del panel
   * (`DialegFirmaConveni`): al cerrar el diálogo, la banda tiene que dejar de avisar sin
   * que nadie recargue la página a mano.
   */
  recarrega: () => void
}


export function useConveni(): EstatConveni {
  const { rolActiu, organitzacio } = useAppContext()
  const [estat, setEstat] = useState<ConvenioEstado | null>(null)
  const [tipusVigents, setTipusVigents] = useState<ConvenioTipo[]>([])
  const [dataTall, setDataTall] = useState<string | null>(null)
  // Qué combinación de organización y recargas está leída. `carregant` se DERIVA de ella y no
  // es un estado aparte: con un estado aparte hay un render —justo cuando el contexto de
  // sesión termina de llegar— en que aún vale `false` sin haber leído nada, y la banda
  // enseñaba un instante «de moment pots seguir operant» antes del mensaje de bloqueo.
  const [clauLlegida, setClauLlegida] = useState<string | null>(null)
  // Un contador y no un booleano: dos firmas seguidas tienen que provocar dos lecturas, y
  // un flag que ya está a `true` no vuelve a disparar el efecto.
  const [tic, setTic] = useState(0)
  const recarrega = useCallback(() => setTic((n) => n + 1), [])
  // Y el de todo el panel: firmar desde «Pendent de tu» tiene que apagar también esta banda.
  const ticAvisos = useTicAvisos()
  const [desconegut, setDesconegut] = useState(false)
  // Reintentos tras un fallo: 3 s, 10 s, 30 s y 60 s, y ahí se para (la siguiente
  // navegación o acción vuelve a leer igualmente). Se pone a 0 en cuanto una lectura sale.
  const intents = useRef(0)

  const orgId = organitzacio?.id ?? null
  const extern = rolActiu === 'productor' || rolActiu === 'receptor'
  const columna = rolActiu === 'productor' ? 'productor_id' : 'entidad_id'
  const clau = extern && orgId ? `${columna}:${orgId}:${tic}:${ticAvisos}` : 'cap'
  const carregant = clauLlegida !== clau

  useEffect(() => {
    if (!extern || !orgId) { setEstat(null); setTipusVigents([]); setDesconegut(false); setClauLlegida('cap'); return }
    let viu = true
    let reintent: ReturnType<typeof setTimeout> | null = null

    void (async () => {
      const [convenis, tall] = await Promise.all([
        supabase.from('convenios').select('estado, tipo').eq(columna, orgId),
        supabase.rpc('data_tall_convenis'),
      ])
      if (!viu) return

      if (convenis.error || tall.error) {
        console.warn('useConveni:', (convenis.error ?? tall.error)?.message)
        // Se conserva lo último que se supo; solo se marca que ahora no se sabe.
        setDesconegut(true)
        setClauLlegida(`${columna}:${orgId}:${tic}:${ticAvisos}`)
        const esperes = [3000, 10000, 30000, 60000]
        if (intents.current < esperes.length) {
          reintent = setTimeout(() => setTic((n) => n + 1), esperes[intents.current])
          intents.current += 1
        }
        return
      }
      intents.current = 0
      setDesconegut(false)

      const files = (convenis.data as { estado: ConvenioEstado; tipo: ConvenioTipo }[] | null) ?? []
      let millor: ConvenioEstado | null = null
      for (const f of files) {
        if (f.estado === 'substituit') continue
        if (!millor || ORDRE.indexOf(f.estado) > ORDRE.indexOf(millor)) millor = f.estado
      }
      setEstat(millor)
      setTipusVigents([...new Set(files.filter((f) => f.estado === 'vigent').map((f) => f.tipo))])
      setDataTall((tall.data as string | null) ?? null)
      setClauLlegida(`${columna}:${orgId}:${tic}:${ticAvisos}`)
    })()

    return () => { viu = false; if (reintent) clearTimeout(reintent) }
  }, [extern, orgId, columna, tic, ticAvisos])

  // Sin organización todavía (el contexto de sesión llega en dos tiempos) no se sabe nada:
  // no se avisa. Antes se avisaba con «encara no tens conveni» durante ese instante.
  const avisa = extern && orgId !== null && !carregant && !desconegut && estat !== 'vigent'
  // `new Date('2027-04-01')` es medianoche UTC y aquí basta: la fecha de corte es un día
  // entero, no un instante, y la base decide de verdad con `current_date`.
  // Sin saber qué convenios tiene, tampoco se aplica el corte en la pantalla: `tallPassat`
  // es lo que Mercat y NovaOferta usan para filtrar por tipo de convenio.
  const passat = !desconegut && dataTall !== null && new Date(dataTall) <= new Date()

  return {
    estat, dataTall, avisa, bloqueja: avisa && passat, tipusVigents, tallPassat: passat, carregant, desconegut, recarrega,
  }
}
