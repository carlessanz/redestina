// Los mensajes de un paso del ciclo (27-10-2026, fase 4 del plan de gestión autónoma).
//
// Para el equipo: «Missatges d'aquest pas», cada uno con su botón de copiar, agrupados por
// destinatario. Con las notificaciones apagadas es como se avisa a mano. Para ofertante y
// receptor (`nomesLectura`): el texto íntegro de lo que se les dirigió, sin botones.

import { MessageSquareText } from 'lucide-react'
import { useT } from '../lib/i18n'
import type { DestinatariMissatge, FaseMissatge, Missatge } from '../lib/missatgesOferta'
import MissatgeACopiar from './MissatgeACopiar'

interface Props {
  missatges: Missatge[]
  /** Solo los de esta fase (o fases) del ciclo. */
  fase?: FaseMissatge | readonly FaseMissatge[]
  /** Solo los dirigidos a este destinatario (los paneles externos). */
  destinatari?: DestinatariMissatge
  nomesLectura?: boolean
  /** Solo los que vienen de un aviso de verdad (en los paneles externos). */
  nomesAvisos?: boolean
  /** Sin la cabecera: cuando quien lo envuelve ya pone el título. */
  senseTitol?: boolean
}

const ORDRE: readonly DestinatariMissatge[] = ['productor', 'entidad', 'grup']

export default function MissatgesDelPunt({
  missatges, fase, destinatari, nomesLectura = false, nomesAvisos = false, senseTitol = false,
}: Props) {
  const { t } = useT()
  const fases = fase === undefined ? null : (Array.isArray(fase) ? fase : [fase])
  const llista = missatges.filter((m) =>
    (!fases || fases.includes(m.fase))
    && (!destinatari || m.destinatari === destinatari)
    && (!nomesAvisos || m.origen === 'avis'))
  if (llista.length === 0) return null

  return (
    <section className="min-w-0 space-y-3" aria-label={t(nomesLectura ? 'msg.titol_lectura' : 'msg.titol')}>
      {!senseTitol && <div className="flex items-start gap-2">
        <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <h3 className="font-titulos text-sm font-semibold">{t(nomesLectura ? 'msg.titol_lectura' : 'msg.titol')}</h3>
          {!nomesLectura && <p className="text-xs text-muted-foreground">{t('msg.ajuda')}</p>}
        </div>
      </div>}
      {nomesLectura || destinatari
        ? llista.map((m) => <MissatgeACopiar key={m.id} missatge={m} nomesLectura={nomesLectura} />)
        : ORDRE.map((d) => llista.filter((m) => m.destinatari === d)).filter((g) => g.length > 0).map((g) => (
          <div key={g[0].destinatari} className="space-y-2">
            {g.map((m) => <MissatgeACopiar key={m.id} missatge={m} />)}
          </div>
        ))}
    </section>
  )
}
