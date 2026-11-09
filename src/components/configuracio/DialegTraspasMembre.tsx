// Desactivar o borrar una cuenta del equipo, preguntando antes qué se hace con lo que ha hecho
// (09-11-2026, `desactivar_membre_equip()` / `esborrar_membre_equip()`).
//
// «Lo que ha hecho» son todas las columnas de autoría de la base (el convenio que contrafirmó, los
// documentos que emitió, las notas, las aprobaciones…), que `equip_accions()` cuenta por tabla y
// aquí se enseñan agrupadas. Se puede pasar todo a otra cuenta ACTIVA del equipo, a elegir.
//
//   · DESACTIVAR: traspasar es opcional (la cuenta sigue existiendo y puede volver a activarse).
//   · BORRAR: si la cuenta ha hecho algo, traspasar es OBLIGATORIO. Se probó dejarlo sin autor y la
//     base lo rechaza (un convenio «declarado» exige constar quién lo declaró), además de dejar lo
//     emitido sin responsable. Y pide escribir «esborrar»/«borrar», como al borrar una ficha.
//
// El cuerpo es un componente aparte con `key` por cuenta y modo: se reinicia solo (§7).

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { useT } from '../../lib/i18n'
import {
  agrupaAccions, clauErrorEquip, destiPerDefecte, destinsPossibles,
  type AccionsCompte, type MembreEquip,
} from '../../lib/equip'
import { FilaCasella } from '../Casella'
import Desplegable from '../Desplegable'
import CarregantSeccio from '../CarregantSeccio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

export type ModeMembre = 'desactiva' | 'esborra'

function Cos({ membre, mode, membres, onTanca, onFet }: {
  membre: MembreEquip
  mode: ModeMembre
  membres: readonly MembreEquip[]
  onTanca: () => void
  onFet: () => void
}) {
  const { t } = useT()
  const [dades, setDades] = useState<AccionsCompte | null>(null)
  const [error, setError] = useState(false)
  const [traspassa, setTraspassa] = useState(false)
  const [desti, setDesti] = useState(() => destiPerDefecte(membres, membre.user_id))
  const [paraula, setParaula] = useState('')
  const [ocupat, setOcupat] = useState(false)

  const destins = destinsPossibles(membres, membre.user_id)
  const email = membre.email ?? membre.nom ?? ''

  useEffect(() => {
    let viu = true
    void supabase.rpc('equip_accions', { p_user: membre.user_id }).then(({ data, error: err }) => {
      if (!viu) return
      if (err || !data) { setError(true); return }
      const d = data as AccionsCompte
      setDades(d)
      // Lo normal es pasarlas: se propone marcado cuando hay algo que pasar y alguien a quien pasarlo.
      setTraspassa(d.total > 0 && destins.length > 0)
    })
    return () => { viu = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir (la cuenta y el modo son la `key`)
  }, [])

  const total = dades?.total ?? 0
  // Borrar a quien ha hecho algo: no hay opción de dejarlo sin responsable.
  const obligat = mode === 'esborra' && total > 0
  const sensePossibleDesti = (traspassa || obligat) && destins.length === 0
  const paraulaOk = mode === 'desactiva'
    || paraula.trim().toLocaleLowerCase() === t('esb.paraula').toLocaleLowerCase()
  const potConfirmar = dades !== null && !ocupat && paraulaOk
    && (!obligat || traspassa) && (!traspassa || desti !== '') && !sensePossibleDesti

  async function confirma() {
    if (!potConfirmar) return
    setOcupat(true)
    const { data, error: err } = await supabase.rpc(
      mode === 'desactiva' ? 'desactivar_membre_equip' : 'esborrar_membre_equip',
      { p_user: membre.user_id, p_desti: traspassa ? desti : null },
    )
    setOcupat(false)
    if (err) { toast.error(t(clauErrorEquip(err.message))); return }
    const mogudes = Number((data as { traspassades?: number } | null)?.traspassades ?? 0)
    const nomDesti = destins.find((d) => d.user_id === desti)?.email ?? ''
    toast.success(mogudes > 0
      ? t(mode === 'desactiva' ? 'eq.ok_desactiva_t' : 'eq.ok_esborra_t', { email, total: mogudes, desti: nomDesti })
      : t(mode === 'desactiva' ? 'eq.ok_desactiva' : 'eq.ok_esborra', { email }))
    onFet()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="[overflow-wrap:anywhere]">{t(mode === 'desactiva' ? 'eq.t_desactiva_t' : 'eq.t_esborra_t', { email })}</DialogTitle>
        <DialogDescription>{t(mode === 'desactiva' ? 'eq.t_desactiva_d' : 'eq.t_esborra_d')}</DialogDescription>
      </DialogHeader>

      {dades === null && !error && <CarregantSeccio />}
      {error && <p className="text-sm text-error" role="alert">{t('eq.e_error')}</p>}

      {dades !== null && (
        <div className="space-y-3">
          {total === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="eq-t-cap">{t('eq.t_cap_accio')}</p>
          ) : (
            <>
              <div className="space-y-1.5 text-sm" data-testid="eq-t-accions">
                <p className="font-medium">{t('eq.t_te_accions', { total })}</p>
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {agrupaAccions(dades.accions).map((g) => (
                    <li key={g.grup}>{t('eq.t_linia', { grup: t(`eq.g_${g.grup}`), n: g.n })}</li>
                  ))}
                </ul>
              </div>

              <FilaCasella checked={traspassa || obligat} onChange={setTraspassa} disabled={obligat || destins.length === 0}>
                {t('eq.t_traspassa')}
              </FilaCasella>
              {obligat && <p className="text-xs text-muted-foreground">{t('eq.t_traspassa_obl')}</p>}
              {sensePossibleDesti && <p className="text-sm text-error" role="alert">{t('eq.t_sense_equip')}</p>}

              {(traspassa || obligat) && destins.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="eq-t-desti">{t('eq.t_a_qui')}</Label>
                  <Desplegable
                    id="eq-t-desti" value={desti} onChange={setDesti} data-testid="eq-t-desti"
                    opcions={destins.map((d) => ({
                      valor: d.user_id,
                      text: `${d.nom || d.email || ''} · ${t(`eq.rol_${d.rol}`)}${d.es_tu ? ` (${t('eq.tu')})` : ''}`,
                    }))}
                  />
                </div>
              )}
              {!traspassa && !obligat && <p className="text-xs text-muted-foreground">{t('eq.t_deixa')}</p>}
              <p className="text-xs text-muted-foreground">{t('eq.t_nota_pdf')}</p>
            </>
          )}

          {dades.membresies > 0 && mode === 'esborra' && (
            <p className="rounded-md bg-aviso-fondo p-3 text-sm text-aviso">{t('eq.t_membresies', { total: dades.membresies })}</p>
          )}

          {mode === 'esborra' && (
            <div className="space-y-1.5">
              <Label htmlFor="eq-t-paraula">{t('esb.escriu', { paraula: t('esb.paraula') })}</Label>
              <Input
                id="eq-t-paraula" value={paraula} autoComplete="off" autoCapitalize="none" spellCheck={false}
                onChange={(e) => setParaula(e.target.value)} data-testid="eq-t-paraula"
              />
            </div>
          )}
        </div>
      )}

      <DialogFooter className="flex-col gap-2 sm:flex-row">
        <Button variant="outline" className="h-11 md:h-8" onClick={onTanca}>{t('c.cancel')}</Button>
        <Button
          variant={mode === 'esborra' ? 'destructive' : 'default'} className="h-11 whitespace-normal md:h-8"
          disabled={!potConfirmar} onClick={() => void confirma()} data-testid="eq-t-confirma"
        >
          {t(mode === 'desactiva' ? 'eq.t_go_desactiva' : 'eq.t_go_esborra')}
        </Button>
      </DialogFooter>
    </>
  )
}

export default function DialegTraspasMembre({ membre, mode, membres, onTanca, onFet }: {
  membre: MembreEquip | null
  mode: ModeMembre
  membres: readonly MembreEquip[]
  onTanca: () => void
  onFet: () => void
}) {
  return (
    <Dialog open={membre !== null} onOpenChange={(o) => { if (!o) onTanca() }}>
      {/* `grid-cols-[minmax(0,1fr)]`: sin él, un correo largo en el título ensancha la columna y el diálogo se sale de la pantalla (medido a 375 px). */}
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto" data-testid="eq-t-dialeg">
        {membre && <Cos key={`${membre.user_id}-${mode}`} membre={membre} mode={mode} membres={membres} onTanca={onTanca} onFet={onFet} />}
      </DialogContent>
    </Dialog>
  )
}
