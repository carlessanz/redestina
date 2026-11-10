// El estado CRM de cada papel de una entidad (Plan 2, B1, 10-11-2026; D8 de Carles).
//
// `estat_crm` MANDA y `activo` se deriva en la base (`activo = estat_crm = 'actiu'`, trigger
// `*_estat`, 20270518100000): Potencial y En desenvolupament no operan (ni Mercat, ni
// priorización, ni selectores). Pasar a Actiu exige NIF válido y razón social (el trigger lo
// corta con `falta_nif` · `nif_invalid` · `falta_rao_social`).
//
// Módulo puro: lo usan «Estat i papers» (`BlocRols`), la cabecera de la ficha y el listado
// «Entitats». Los textos son `ef.estat_<valor>` (badge) y `fl.v_<valor>` (filtro), declarados
// como claves compuestas en `tests/i18n.test.ts`.

export const ESTATS_CRM = ['potencial', 'en_desenvolupament', 'actiu', 'inactiu'] as const
export type EstatCrm = (typeof ESTATS_CRM)[number]

/** El valor de la base, o null si no es uno de los cuatro (fila sin ese papel). */
export function estatCrm(v: string | null | undefined): EstatCrm | null {
  return (ESTATS_CRM as readonly string[]).includes(v ?? '') ? (v as EstatCrm) : null
}

/**
 * Las clases del badge (tokens del sistema de diseño, §2bis): actiu = éxito, en
 * desenvolupament = aviso, potencial = secundario, inactiu = atenuado.
 */
export function classeEstatCrm(e: EstatCrm): string {
  switch (e) {
    case 'actiu': return 'bg-exito-fondo text-exito'
    case 'en_desenvolupament': return 'bg-aviso-fondo text-aviso'
    case 'potencial': return 'bg-secondary text-secondary-foreground'
    case 'inactiu': return 'bg-muted text-muted-foreground'
  }
}

/**
 * El estado de la ORGANIZACIÓN, igual que `v_entitats_llistat.estat_crm`: `actiu` si algún
 * papel lo es; si no, el más avanzado (en_desenvolupament > potencial > inactiu).
 */
export function estatOrganitzacio(...papers: (string | null | undefined)[]): EstatCrm {
  const es = papers.map(estatCrm).filter((x): x is EstatCrm => x !== null)
  for (const e of ['actiu', 'en_desenvolupament', 'potencial'] as const) if (es.includes(e)) return e
  return 'inactiu'
}

/**
 * La dimensión «Estat» del listado: con `?rol=` (o el filtro de papel) manda el estado de ese
 * papel; sin él, el de la organización.
 */
export function estatPerFiltre(
  fila: { productor_estat_crm: string | null; entidad_estat_crm: string | null; estat_crm: string | null },
  rol: string | undefined,
): EstatCrm | null {
  if (rol === 'ofertant') return estatCrm(fila.productor_estat_crm)
  if (rol === 'receptor') return estatCrm(fila.entidad_estat_crm)
  return estatCrm(fila.estat_crm) ?? estatOrganitzacio(fila.productor_estat_crm, fila.entidad_estat_crm)
}
