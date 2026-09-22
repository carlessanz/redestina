import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Mail, MessageCircle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import { useConfirma, useTria } from './DialegConfirma'
import type { CampoDef } from '../lib/crudCampos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useWhatsappActiu } from '../hooks/useAppContext'
import DialegCorreu from './DialegCorreu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type Registro = Record<string, unknown> & { id: string }

interface Props {
  tipoKey: string // 'rec.producer' | 'rec.entity'
  femenino: boolean
  volverKey: string // 'nav.producers' | 'nav.entities'
  tabla: 'productores' | 'entidades'
  campos: CampoDef[]
  registro: Registro | null
  nombreKey: string
  telefonoKey?: string
  /** Campo del correo de la ficha. Sin él no se ofrece «Correu». */
  emailKey?: string
  onBack: () => void
  onSaved: () => void
  onSendMessage?: (phone: string, name: string | null) => void
  /**
   * Lo que hay que saber de esta ficha ANTES de tocarla y que no es un campo suyo: hoy,
   * el estado del convenio (fase 2). Va bajo la cabecera y no en la rejilla de campos
   * porque no se edita aquí —el convenio se firma, no se teclea— y porque `RecordDetail`
   * es genérico: si supiera de convenios dejaría de servir para la siguiente tabla.
   */
  avisos?: ReactNode
}

export default function RecordDetail({
  tipoKey, femenino, volverKey, tabla, campos, registro, nombreKey, telefonoKey, emailKey, onBack, onSaved,
  onSendMessage, avisos,
}: Props) {
  const { t } = useT()
  const { confirma, dialeg } = useConfirma()
  const { tria, dialeg: dialegTria } = useTria()
  const waActiu = useWhatsappActiu()
  const [correuObert, setCorreuObert] = useState(false)
  const esNuevo = registro == null
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...(registro ?? {}) }))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tipo = t(tipoKey)
  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }))

  function mensajeError(err: { code?: string; message: string }): string {
    return err.code === '23505' ? t('rec.err_unique') : err.message
  }

  /**
   * `borrar_ficha_completa()` (§4/§7, deuda 108) responde `22023 bloqueig_esborrat: <codis>`
   * cuando la ficha —o su hermana de doble rol— tiene documentación que no se borra jamás.
   * Los códigos van en el MESSAGE separados por comas, con el sufijo `@germana` cuando el
   * bloqueo lo aporta la otra ficha.
   */
  function missatgeEsborrat(err: { code?: string; message: string }): string {
    const marca = 'bloqueig_esborrat:'
    const i = err.message.indexOf(marca)
    if (i === -1) {
      if (err.code === '42501') return t('rec.no_permission_delete')
      return mensajeError(err)
    }
    const motius = err.message
      .slice(i + marca.length)
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const [base, germana] = c.split('@')
        const text = t(`rec.block_${base}`)
        return germana ? text + t('rec.block_germana') : text
      })
    return `${t('rec.blocked')} ${motius.join('; ')}`
  }

  function normalizar(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const c of campos) {
      const tp = c.tipo ?? 'text'
      let v = form[c.key]
      if (tp === 'list') {
        if (typeof v === 'string') {
          const arr = v.split(',').map((s) => s.trim()).filter(Boolean)
          v = arr.length ? arr : null
        } else if (Array.isArray(v)) v = v.length ? v : null
        else v = null
      } else if (tp === 'number') {
        v = v == null || v === '' ? null : Number(v)
      } else if (tp === 'bool') {
        v = Boolean(v)
      } else if (tp === 'boolnull') {
        v = v == null ? null : Boolean(v)
      } else {
        const s = typeof v === 'string' ? v.trim() : v
        v = s === '' || s == null ? null : s
      }
      out[c.key] = v
    }
    return out
  }

  async function guardar() {
    setError(null)
    const datos = normalizar()
    if (!datos[nombreKey]) { setError(t('rec.name_required')); return }
    setGuardando(true)
    const resp = registro
      ? await supabase.from(tabla).update(datos).eq('id', registro.id)
      : await supabase.from(tabla).insert(datos)
    setGuardando(false)
    if (resp.error) { setError(mensajeError(resp.error)); return }
    toast.success(esNuevo ? t('rec.created') : t('rec.saved'))
    onSaved()
  }

  /**
   * La ficha del OTRO papel de la misma organización (doble rol: productora + receptora), si
   * existe. Se enlazan por `organizacion_id` (§ organizaciones); sin él, la ficha está sola.
   */
  async function fitxaGermana(): Promise<{ id: string; nom: string | null } | null> {
    const org = (registro?.organizacion_id as string | null | undefined) ?? null
    if (!org) return null
    if (tabla === 'productores') {
      const { data } = await supabase.from('entidades').select('id, nombre').eq('organizacion_id', org).maybeSingle()
      const e = data as { id: string; nombre: string | null } | null
      return e ? { id: e.id, nom: e.nombre } : null
    }
    const { data } = await supabase.from('productores').select('id, name, empresa').eq('organizacion_id', org).maybeSingle()
    const p = data as { id: string; name: string | null; empresa: string | null } | null
    return p ? { id: p.id, nom: p.empresa || p.name } : null
  }

  async function borrar() {
    if (!registro) return
    const nombre = String(form[nombreKey] ?? tipo)
    const germana = await fitxaGermana()
    const tipusPropi: 'productor' | 'entidad' = tabla === 'productores' ? 'productor' : 'entidad'

    // Cuántas cuentas de usuario cuelgan de estas fichas (`membresias`, que se borran en cascada).
    // Borrar la ficha deja a esas cuentas sin panel —y sin acceso—, y eso tiene que saberse ANTES.
    const idsProd = [tabla === 'productores' ? registro.id : germana?.id].filter(Boolean) as string[]
    const idsEnt = [tabla === 'entidades' ? registro.id : germana?.id].filter(Boolean) as string[]
    const comptesDe = async (col: 'productor_id' | 'entidad_id', ids: string[]) => {
      if (!ids.length) return [] as string[]
      const { data } = await supabase.from('membresias').select('user_id').in(col, ids)
      return ((data as { user_id: string }[] | null) ?? []).map((m) => m.user_id)
    }
    const comptesAquesta = new Set(await comptesDe(tabla === 'productores' ? 'productor_id' : 'entidad_id', [registro.id]))
    const comptesTotes = new Set([...await comptesDe('productor_id', idsProd), ...await comptesDe('entidad_id', idsEnt)])
    const avisComptes = (n: number) => (n > 0 ? `\n\n${t('rec.delete_accounts', { n })}` : '')

    // Doble rol: se pregunta si se borra solo este papel o los dos. Con uno solo, el «¿seguro?» de siempre.
    let tambeGermana = false
    if (germana) {
      const esProd = tabla === 'productores'
      const opcio = await tria({
        titol: t('rec.confirm_delete_t', { name: nombre }),
        descripcio: t('rec.dual_delete_desc', { role: t(esProd ? 'rec.role_receptora' : 'rec.role_productora') }) + avisComptes(comptesTotes.size),
        opcions: [
          { valor: 'aquesta', text: t(esProd ? 'rec.dual_only_producer' : 'rec.dual_only_entity'), destructiu: true },
          { valor: 'dues', text: t('rec.dual_both'), destructiu: true },
        ],
      })
      if (!opcio) return
      tambeGermana = opcio === 'dues'
    } else if (!(await confirma({
      titol: t('rec.confirm_delete_t', { name: nombre }),
      descripcio: t('rec.confirm_delete') + avisComptes(comptesAquesta.size),
      confirmar: t('c.delete'),
      destructiu: true,
    }))) return

    setError(null)
    setGuardando(true)
    // Único camino de borrado (§4/§7, deuda 108): una sola RPC transaccional que se niega
    // con el motivo si hay documentos, albaranes o cierres, y que arrastra las dos fichas
    // del doble rol a la vez si se pidió — nada de dos `.delete()` sueltos que puedan dejar
    // media organización borrada.
    const { error: delError } = await supabase.rpc('borrar_ficha_completa', {
      p_tipo: tipusPropi,
      p_ficha_id: registro.id,
      p_tambe_germana: tambeGermana,
    })
    setGuardando(false)
    if (delError) { setError(missatgeEsborrat(delError)); return }
    toast.success(tambeGermana ? t('rec.dual_deleted') : t('rec.deleted'))
    onSaved()
  }

  function enviarMensaje() {
    const tel = telefonoKey ? (form[telefonoKey] as string | null) : null
    const limpio = (tel ?? '').replace(/\D/g, '')
    if (!limpio) return
    onSendMessage?.(limpio, (form[nombreKey] as string) ?? null)
  }

  const telValor = telefonoKey ? String(form[telefonoKey] ?? '').replace(/\D/g, '') : ''
  const emailValor = emailKey ? String(form[emailKey] ?? '').trim() : ''

  function control(c: CampoDef) {
    const tp = c.tipo ?? 'text'
    const v = form[c.key]
    if (tp === 'textarea') return <Textarea rows={3} value={(v as string) ?? ''} onChange={(e) => set(c.key, e.target.value)} />
    if (tp === 'number') {
      return <Input type="number" value={v == null || v === '' ? '' : String(v)}
        onChange={(e) => set(c.key, e.target.value === '' ? null : Number(e.target.value))} />
    }
    if (tp === 'bool') {
      return (
        <Select value={v ? 'si' : 'no'} onValueChange={(val) => set(c.key, val === 'si')}>
          <SelectTrigger className="w-full text-base md:text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="si">{t('c.yes')}</SelectItem>
            <SelectItem value="no">{t('c.no')}</SelectItem>
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'boolnull') {
      return (
        <Select value={v == null ? 'null' : v ? 'si' : 'no'}
          onValueChange={(val) => set(c.key, val === 'null' ? null : val === 'si')}>
          <SelectTrigger className="w-full text-base md:text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="null">—</SelectItem>
            <SelectItem value="si">{t('c.yes')}</SelectItem>
            <SelectItem value="no">{t('c.no')}</SelectItem>
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'select') {
      const val = (v as string) ?? ''
      return (
        <Select value={val === '' ? '__none' : val} onValueChange={(nv) => set(c.key, nv === '__none' ? null : nv)}>
          <SelectTrigger className="w-full text-base md:text-sm"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">—</SelectItem>
            {(c.opciones ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      )
    }
    if (tp === 'list') {
      const texto = Array.isArray(v) ? (v as string[]).join(', ') : ((v as string) ?? '')
      return <Input type="text" value={texto} onChange={(e) => set(c.key, e.target.value)} />
    }
    return <Input type={tp === 'email' ? 'email' : 'text'} value={(v as string) ?? ''} onChange={(e) => set(c.key, e.target.value)} />
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
        <ArrowLeft className="size-4" /> {t(volverKey)}
      </Button>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>
              {esNuevo ? (femenino ? t('rec.new_f', { x: tipo }) : t('rec.new', { x: tipo })) : String(form[nombreKey] ?? tipo)}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {esNuevo ? t('rec.alta') : t('rec.editing', { x: tipo })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Con WhatsApp apagado (§8) desaparece; el correo ocupa su sitio. */}
            {waActiu && telefonoKey && telValor && onSendMessage && (
              <Button variant="outline" onClick={enviarMensaje}>
                <MessageCircle className="size-4" /> {t('c.message')}
              </Button>
            )}
            {emailKey && emailValor && !esNuevo && (
              <Button variant="outline" onClick={() => setCorreuObert(true)}>
                <Mail className="size-4" /> {t('c.email_action')}
              </Button>
            )}
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? t('c.saving') : t('c.save')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {avisos}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {campos.map((c) => (
              <div key={c.key} className={c.ancho === 'full' ? 'sm:col-span-2' : undefined}>
                <Label className="mb-1.5 block text-xs text-muted-foreground">{t(c.label)}</Label>
                {control(c)}
              </div>
            ))}
          </div>
          {!esNuevo && (
            <div className="border-t pt-4">
              <Button variant="destructive" onClick={() => void borrar()} disabled={guardando}>
                <Trash2 className="size-4" /> {t('rec.delete_x', { x: tipo })}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <DialegCorreu
        obert={correuObert}
        onObert={setCorreuObert}
        destinatari={{
          email: emailValor || null,
          nom: String(form[nombreKey] ?? '') || null,
          tipus: tabla === 'productores' ? 'productor' : 'entidad',
          id: String(registro?.id ?? ''),
        }}
      />

      {dialeg}
      {dialegTria}
    </div>
  )
}
