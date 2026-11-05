// «Qui signa»: nombre, cargo y documento de identidad de quien firma.
//
// Salió de `FirmaConveni` el 05-11-2026, cuando el circuito de firma lo necesitó también
// para los certificados y los albaranes (`FormulariSignaDocument`) y para la subida de un
// fichero firmado (sin DNI: lo que acredita es el papel). Un solo bloque para que los tres
// pidan lo mismo con los mismos mínimos (`lib/signatures.ts`).
//
// ⚠️ LOS IDS IMPORTAN. El convenio sigue con `sig-signant-*` —lo usan sus E2E—; los
//    documentos pasan `prefix="sgn-signant"`. Dos bloques en la misma página con el mismo
//    prefijo romperían los `<label htmlFor>`.
//
// ⚠️ EL DNI muere en `evidencias`, fuera del GRANT de SELECT: se pide porque la firma lo
//    necesita, no porque nadie vaya a consultarlo.

import { useT } from '../lib/i18n'
import { cn } from '../lib/utils'
import { signantValid } from '../lib/signatures'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function BlocSignant({
  nom, carrec, dni = '', onNom, onCarrec, onDni,
  prefix = 'sig-signant', ample = false, ambDni = true, obligatori = true,
}: {
  nom: string
  carrec: string
  dni?: string
  onNom: (v: string) => void
  onCarrec: (v: string) => void
  onDni?: (v: string) => void
  /** Prefijo de los ids (`<prefix>-nom`, `-carrec`, `-dni`). */
  prefix?: string
  /** Con sitio, de dos en dos desde `sm`; si no, una columna (ver `FirmaConveni`). */
  ample?: boolean
  /** Sin DNI en la subida de un fichero firmado: lo que acredita es el papel. */
  ambDni?: boolean
  /** Obligatorios en la firma con trazo; opcionales al subir un fichero. */
  obligatori?: boolean
}) {
  const { t } = useT()
  const { nomCurt, carrecCurt, dniCurt } = signantValid({ nom, carrec, dni, ambDni })
  const marca = obligatori ? ' *' : ''

  return (
    <div className={cn('grid grid-cols-1 gap-3', ample && 'sm:grid-cols-2')}>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-nom`}>{t('sig.f_signer_name')}{marca}</Label>
        <Input id={`${prefix}-nom`} className="h-11" autoComplete="name"
          value={nom} onChange={(e) => onNom(e.target.value)} />
        {nom.trim() !== '' && nomCurt && (
          <p className="text-xs text-error">{t('sig.err_nom_curt')}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-carrec`}>{t('sig.f_signer_role')}{marca}</Label>
        <Input id={`${prefix}-carrec`} className="h-11"
          value={carrec} onChange={(e) => onCarrec(e.target.value)} />
        {carrec.trim() !== '' && carrecCurt && (
          <p className="text-xs text-error">{t('sig.err_carrec_curt')}</p>
        )}
      </div>
      {ambDni && (
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-dni`}>{t('sig.f_dni')}{marca}</Label>
          <Input id={`${prefix}-dni`} className="h-11"
            value={dni} onChange={(e) => onDni?.(e.target.value)} />
          {dni.trim() !== '' && dniCurt
            ? <p className="text-xs text-error">{t('sig.err_dni_curt')}</p>
            : <p className="text-xs text-muted-foreground">{t('sig.dni_hint')}</p>}
        </div>
      )}
    </div>
  )
}
