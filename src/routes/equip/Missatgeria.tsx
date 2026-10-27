// Mensajería del equipo: lista de contactos ↔ conversación.
//
// Conserva literalmente el patrón responsive que ya tenía en App.tsx (en móvil la
// lista ocupa la pantalla y, al elegir contacto, la conversación pasa a pantalla
// completa). Dos cambios, los dos a mejor:
//   · el contacto seleccionado vive en la URL, así que el gesto «atrás» del sistema
//     funciona —que es justo lo que faltaba en una PWA—
//   · el `h-dvh` desaparece de aquí: lo pone el shell (ruta marcada `fullBleed`)

import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { supabase } from '../../lib/supabase'
import { cn } from '../../lib/utils'
import { useT } from '../../lib/i18n'
import type { WaContact } from '../../types'
import { useCanals } from '../../hooks/useAppContext'
import ContactList from '../../components/ContactList'
import Conversation from '../../components/Conversation'

// Con WhatsApp apagado (o todas las notificaciones, §8) esta consola no existe: el menú ya no
// la enseña, y un enlace guardado o un marcador vuelven al tablero en vez de abrir una
// pantalla donde nada funciona.
export default function Missatgeria() {
  const canals = useCanals()
  if (!canals.whatsapp) return <Navigate to="/equip/tauler" replace />
  return <ConsolaMissatgeria />
}

function ConsolaMissatgeria() {
  const { t } = useT()
  const { phone } = useParams<{ phone?: string }>()
  const navigate = useNavigate()
  const [contacts, setContacts] = useState<WaContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadContacts = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('wa_contacts')
      .select('*')
      .order('name', { ascending: true, nullsFirst: false })
      .order('phone', { ascending: true })
    if (err) {
      setError(t('c.load_error'))
      setContacts([])
    } else {
      setContacts(data ?? [])
    }
    setLoading(false)
  }, [t])

  useEffect(() => { void loadContacts() }, [loadContacts])

  const selected = contacts.find((c) => c.phone === phone) ?? null

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className={cn(
        'flex min-h-0 w-full flex-col overflow-hidden md:w-80 md:shrink-0 md:border-r',
        selected && 'hidden md:flex',
      )}>
        <ContactList
          contacts={contacts}
          loading={loading}
          error={error}
          selectedPhone={phone ?? null}
          onSelect={(p) => navigate(`/equip/missatgeria/${p}`)}
          onReload={loadContacts}
        />
      </div>
      <div className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        !selected && 'hidden md:flex',
      )}>
        {selected ? (
          <Conversation
            key={selected.phone}
            contact={selected}
            onBack={() => navigate('/equip/missatgeria')}
            onDeleted={() => { navigate('/equip/missatgeria'); void loadContacts() }}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <p>{t('msg.select')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
