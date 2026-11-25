// Alta de una cuenta del equipo (deuda 169), en Configuració › Equip, solo super_admin. Antes era
// SQL a mano o `scripts/crear-usuario.ts` desde el terminal.
//
// Nombre, correo, teléfono (opcional), rol e idioma → `alta-equip` (`altaMembreEquip`), que crea la
// cuenta con la Admin API, le da el rol (apunte 'alta' en la auditoría) y le manda el correo para
// crear la contraseña. Lo que se puede comprobar aquí se comprueba antes (`validaAltaMembre`); lo
// que solo sabe el servidor vuelve con su código, que se pinta bajo su campo (`campErrorAlta`) o
// arriba. Un correo que ya es de una organización no se convierte en equipo (`compte_existent`).
//
// El formulario es un componente aparte que solo se monta con el diálogo abierto: así nace vacío
// cada vez, sin un efecto que lo reinicie (y sin definir un componente dentro de otro, §7).

import { useState } from 'react'
import { toast } from 'sonner'
import { useT } from '../../lib/i18n'
import {
  altaMembreEquip, campErrorAlta, clauErrorAlta, MAX_NOM_EQUIP, ROLS_EQUIP, validaAltaMembre,
  type CampAlta, type IdiomaEquip, type RolEquip,
} from '../../lib/equip'
import Desplegable from '../Desplegable'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/** El texto de error bajo un campo (o nada). */
function ErrorCamp({ clau, id }: { clau: string | undefined; id: string }) {
  const { t } = useT()
  if (!clau) return null
  return <p id={id} className="text-xs text-error" role="alert">{t(clau)}</p>
}

function Formulari({ onTanca, onFet, onRecarrega }: {
  onTanca: () => void
  onFet: () => void
  onRecarrega: () => void
}) {
  const { t, lang } = useT()
  const [nom, setNom] = useState('')
  const [email, setEmail] = useState('')
  const [telefon, setTelefon] = useState('')
  const [rol, setRol] = useState<RolEquip>('admin')
  const [idioma, setIdioma] = useState<IdiomaEquip>(lang === 'es' ? 'es' : 'ca')
  const [ocupat, setOcupat] = useState(false)
  // Se valida al primer intento de enviar, no mientras se escribe el primer carácter.
  const [intentat, setIntentat] = useState(false)
  // Lo que ha dicho el servidor: bajo un campo o arriba. Se borra al tocar ese campo.
  const [errServidor, setErrServidor] = useState<{ camp: CampAlta | null; clau: string } | null>(null)

  const errLocals = validaAltaMembre({ email, nom, telefon })
  const errCamp = (c: CampAlta): string | undefined =>
    (intentat ? errLocals[c] : undefined) ?? (errServidor?.camp === c ? errServidor.clau : undefined)
  const errGeneral = errServidor && errServidor.camp === null ? errServidor.clau : null

  /** Al tocar un campo, su error del servidor deja de valer. */
  function toca(c: CampAlta) {
    if (errServidor && (errServidor.camp === c || errServidor.camp === null)) setErrServidor(null)
  }

  async function envia() {
    if (ocupat) return
    setIntentat(true)
    if (Object.keys(errLocals).length > 0) return
    setOcupat(true)
    setErrServidor(null)
    const r = await altaMembreEquip({ email, nom, telefon, rol, idioma })
    setOcupat(false)
    if (!r.ok) {
      setErrServidor({ camp: campErrorAlta(r.error), clau: clauErrorAlta(r.error) })
      // Si el correo es lo que ha fallado, puede que la cuenta ya exista: se enseña el estado real.
      if (r.error === 'correu_fallit') onRecarrega()
      return
    }
    toast.success(t(r.simulat ? 'eq.alta_ok_simulat' : 'eq.alta_ok', { email: r.email }))
    onFet()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('eq.alta_t')}</DialogTitle>
        <DialogDescription>{t('eq.alta_d')}</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-3"
        noValidate
        onSubmit={(e) => { e.preventDefault(); void envia() }}
        data-testid="eq-alta-form"
      >
        {errGeneral && (
          <p className="rounded-md bg-error-fondo p-3 text-sm text-error" role="alert" data-testid="eq-alta-error">
            {t(errGeneral)}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="eq-alta-nom">{t('eq.alta_nom')}</Label>
            <Input
              id="eq-alta-nom" value={nom} maxLength={MAX_NOM_EQUIP} autoComplete="off" required
              aria-invalid={!!errCamp('nom')} aria-describedby={errCamp('nom') ? 'eq-alta-nom-err' : undefined}
              onChange={(e) => { setNom(e.target.value); toca('nom') }}
              data-testid="eq-alta-nom"
            />
            <ErrorCamp clau={errCamp('nom')} id="eq-alta-nom-err" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eq-alta-email">{t('eq.alta_email')}</Label>
            <Input
              id="eq-alta-email" type="email" value={email} autoComplete="off" inputMode="email" required
              aria-invalid={!!errCamp('email')} aria-describedby={errCamp('email') ? 'eq-alta-email-err' : undefined}
              onChange={(e) => { setEmail(e.target.value); toca('email') }}
              data-testid="eq-alta-email"
            />
            <ErrorCamp clau={errCamp('email')} id="eq-alta-email-err" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eq-alta-tel">{t('eq.alta_telefon')}</Label>
            <Input
              id="eq-alta-tel" value={telefon} inputMode="tel" autoComplete="off"
              aria-invalid={!!errCamp('telefon')} aria-describedby={errCamp('telefon') ? 'eq-alta-tel-err' : undefined}
              onChange={(e) => { setTelefon(e.target.value); toca('telefon') }}
              data-testid="eq-alta-telefon"
            />
            <ErrorCamp clau={errCamp('telefon')} id="eq-alta-tel-err" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eq-alta-rol">{t('eq.alta_rol')}</Label>
            <Desplegable
              id="eq-alta-rol" value={rol}
              onChange={(v) => { setRol(v === 'super_admin' ? 'super_admin' : 'admin'); toca('rol') }}
              opcions={ROLS_EQUIP.map((r) => ({ valor: r, text: t(`eq.rol_${r}`) }))}
              aria-invalid={!!errCamp('rol')}
              data-testid="eq-alta-rol"
            />
            <p className="text-xs text-muted-foreground">{t(`eq.d_${rol}`)}</p>
            <ErrorCamp clau={errCamp('rol')} id="eq-alta-rol-err" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eq-alta-idioma">{t('eq.alta_idioma')}</Label>
            <Desplegable
              id="eq-alta-idioma" value={idioma}
              onChange={(v) => setIdioma(v === 'es' ? 'es' : 'ca')}
              opcions={[
                { valor: 'ca', text: t('eq.alta_idioma_ca') },
                { valor: 'es', text: t('eq.alta_idioma_es') },
              ]}
              data-testid="eq-alta-idioma"
            />
            <p className="text-xs text-muted-foreground">{t('eq.alta_idioma_d')}</p>
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-11 md:h-8" onClick={onTanca}>{t('c.cancel')}</Button>
          <Button type="submit" className="h-11 whitespace-normal md:h-8" disabled={ocupat} data-testid="eq-alta-envia">
            {t(ocupat ? 'eq.alta_enviant' : 'eq.alta_envia')}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

export default function DialegAltaMembre({ obert, onTanca, onFet, onRecarrega }: {
  obert: boolean
  onTanca: () => void
  /** Alta hecha y correo enviado (o simulado): se cierra y se recarga el equipo. */
  onFet: () => void
  /** Recargar sin cerrar (el correo ha fallado y la cuenta quizá ya existe). */
  onRecarrega: () => void
}) {
  // Cerrado, el formulario se desmonta: cada apertura nace vacía.
  return (
    <Dialog open={obert} onOpenChange={(o) => { if (!o) onTanca() }}>
      <DialogContent className="grid-cols-[minmax(0,1fr)]" data-testid="eq-alta-dialeg">
        {obert && <Formulari onTanca={onTanca} onFet={onFet} onRecarrega={onRecarrega} />}
      </DialogContent>
    </Dialog>
  )
}
