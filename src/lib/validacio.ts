// Validar lo que se teclea en la ficha de la organización (revisión funcional del
// 23-09-2026: «NIF → campo abierto + validación/formato», «correo/teléfono + validación»).
//
// PURO y sin dependencias, para poder probarlo desde Vitest. Devuelve CLAVES i18n de error
// (o null si vale), nunca textos: la ficha es bilingüe.
//
// ⚠️ Es una ayuda para quien teclea, no una barrera de seguridad: el servidor guarda lo que
//    le llega (la RPC no valida el NIF). Lo que se quiere evitar es la errata, no el abuso.

const LLETRES_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE'

/** Sin espacios, guiones ni puntos, y en mayúsculas: «12.345.678-z» → «12345678Z». */
export function netejaNif(nif: string): string {
  return nif.replace(/[\s.\-]/g, '').toUpperCase()
}

/**
 * NIF de persona (DNI), NIE o CIF de entidad, con su dígito de control.
 * Devuelve null si es válido o está vacío; si no, la clave del error.
 */
export function errorNif(nif: string): string | null {
  const n = netejaNif(nif)
  if (n === '') return null

  // DNI: 8 cifras + letra de control.
  if (/^\d{8}[A-Z]$/.test(n)) {
    return LLETRES_DNI[Number(n.slice(0, 8)) % 23] === n[8] ? null : 'val.nif_control'
  }
  // NIE: X/Y/Z + 7 cifras + letra; la inicial vale 0/1/2.
  if (/^[XYZ]\d{7}[A-Z]$/.test(n)) {
    const num = Number(`${'XYZ'.indexOf(n[0])}${n.slice(1, 8)}`)
    return LLETRES_DNI[num % 23] === n[8] ? null : 'val.nif_control'
  }
  // CIF: letra de tipo + 7 cifras + control (cifra o letra según el tipo).
  if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(n)) {
    const cos = n.slice(1, 8)
    let parells = 0
    let senars = 0
    for (let i = 0; i < 7; i++) {
      const d = Number(cos[i])
      if (i % 2 === 1) parells += d
      else { const x = d * 2; senars += Math.floor(x / 10) + (x % 10) }
    }
    const control = (10 - ((parells + senars) % 10)) % 10
    const lletra = 'JABCDEFGHI'[control]
    const c = n[8]
    // Unas letras de tipo exigen letra, otras cifra; muchas admiten las dos.
    if ('KPQRSNW'.includes(n[0])) return c === lletra ? null : 'val.nif_control'
    if ('ABEH'.includes(n[0])) return c === String(control) ? null : 'val.nif_control'
    return c === String(control) || c === lletra ? null : 'val.nif_control'
  }
  return 'val.nif_format'
}

/**
 * El teléfono como lo guarda la base (E.164 sin «+»): se aceptan espacios, puntos, guiones y
 * el «+», y un número español de 9 cifras recibe el 34 delante. Vacío si no queda nada.
 */
export function normalitzaTelefon(tel: string): string {
  const digits = tel.replace(/\D/g, '')
  if (digits === '') return ''
  if (/^[6789]\d{8}$/.test(digits)) return `34${digits}`
  return digits
}

/** Null si vale (o está vacío). La forma que exige el resto del proyecto (§7). */
export function errorTelefon(tel: string): string | null {
  const n = normalitzaTelefon(tel)
  if (n === '') return null
  return /^[1-9]\d{8,14}$/.test(n) ? null : 'val.phone'
}

export function errorCorreu(correu: string): string | null {
  const c = correu.trim()
  if (c === '') return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c) ? null : 'val.email'
}

export function errorCp(cp: string): string | null {
  const c = cp.trim()
  if (c === '') return null
  return /^\d{5}$/.test(c) ? null : 'val.cp'
}
