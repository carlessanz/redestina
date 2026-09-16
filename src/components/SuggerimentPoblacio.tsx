// Del código postal a la población, sin teclearla.
//
// POR QUÉ (16-09-2026). El registro dejó de preguntar la población —se rellena después, en
// la ficha— así que ese momento tiene que ser fácil. Y escribirla a mano produce «Sant
// Cugat», «St. Cugat del Vallès» y «SANT CUGAT» para el mismo sitio, que es exactamente lo
// que impide que el «mismo municipio +2» de la priorización deje de comparar cadenas (§4).
//
// ⚠️ UN CÓDIGO POSTAL NO SIEMPRE ES UN MUNICIPIO, y eso manda en el diseño. Medido sobre el
//    dataset oficial: **936 de 1.132 (82 %) apuntan a uno solo** —ahí se rellena sin
//    preguntar— y los otros 196 a varios, que es el caso de los códigos compartidos entre
//    pueblos pequeños. Para esos se **ofrece a elegir**: poner el primero sería escribir un
//    dato que nadie ha dicho, y encima parecería confirmado.
//
// ⚠️ NO PISA LO QUE YA HAY ESCRITO sin avisar. Si la población está puesta y no coincide
//    con el código postal, se ofrece el cambio como sugerencia; cambiarlo por su cuenta le
//    borraría a alguien una corrección que había hecho a propósito.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'

interface Municipi { codi_ine: string; nom: string; comarca: string | null }

export default function SuggerimentPoblacio({
  codiPostal,
  poblacio,
  onTria,
  disabled,
}: {
  codiPostal: string
  poblacio: string
  onTria: (nom: string) => void
  disabled?: boolean
}) {
  const { t } = useT()
  const [opcions, setOpcions] = useState<Municipi[]>([])

  const cp = codiPostal.replace(/\D/g, '')

  useEffect(() => {
    if (cp.length !== 5) { setOpcions([]); return }
    let viu = true
    void (async () => {
      // Un solo literal de columnas (§7). El embed funciona porque hay FK real a
      // `municipios`, que es lo que PostgREST necesita para resolverlo.
      const { data } = await supabase
        .from('codis_postals')
        .select('municipios(codi_ine, nom, comarca)')
        .eq('codi_postal', cp)
      if (!viu) return
      const files = (data ?? []) as unknown as { municipios: Municipi | null }[]
      setOpcions(files.map((f) => f.municipios).filter((m): m is Municipi => m !== null))
    })()
    return () => { viu = false }
  }, [cp])

  // Rellenar solo cuando NO hay duda y el campo está vacío. Con algo escrito, se sugiere.
  useEffect(() => {
    if (disabled) return
    if (opcions.length === 1 && poblacio.trim() === '') onTria(opcions[0].nom)
    // `onTria` viene del padre y cambia en cada render; depender de él relanzaría esto en
    // bucle. Lo que decide es el código postal y lo que hay escrito.
  }, [opcions, poblacio, disabled]) // eslint-disable-line react-hooks/exhaustive-deps

  if (disabled || opcions.length === 0) return null

  const jaHiEs = opcions.some((m) => m.nom.toLowerCase() === poblacio.trim().toLowerCase())
  if (jaHiEs) return null

  return (
    <div className="mt-1.5 space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {t(opcions.length === 1 ? 'cp.un' : 'cp.diversos', { n: opcions.length })}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {opcions.map((m) => (
          <button
            key={m.codi_ine}
            type="button"
            onClick={() => onTria(m.nom)}
            className="min-h-11 rounded-md border border-input bg-background px-2 text-xs whitespace-normal hover:bg-accent md:min-h-8"
          >
            {m.nom}
            {m.comarca && <span className="ml-1 text-muted-foreground">· {m.comarca}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
