// La organización detrás de una ficha, para las Edge Functions.
//
// Desde la etapa 1 de la organización unificada (migración 20270310100000) existe
// `organizaciones`, con `productores.organizacion_id` y `entidades.organizacion_id`. Este
// módulo es el único sitio del servidor que sabe leerla, para que las funciones no repitan
// la consulta ni la interpreten cada una a su manera.
//
// Hace dos cosas, y las dos son consecuencia de la etapa 1:
//
//   1. **La preferencia de canal** (`canal_preferido`, deuda §12.22). `_shared/canal.ts` es
//      pura y no consulta nada: la preferencia se la tiene que dar quien la llama, y de
//      aquí sale.
//   2. **Saber que dos fichas son la misma organización** (deuda §12.16). Antes, «doble
//      rol» era que dos filas compartieran un teléfono; ahora es un hecho comprobable.
//
// ⚠️ TODO AQUÍ ES FAIL-SOFT, A PROPÓSITO. Ni la preferencia de canal ni el nombre de la
//    organización son datos sin los que no se pueda seguir: si la consulta falla —por un
//    error de red o porque la base todavía no tiene la migración aplicada— se registra y se
//    devuelve «no se sabe», que es exactamente el comportamiento de antes de la etapa 1.
//    Una preferencia que no se puede leer no debe dejar sin ranking al equipo ni sin acceso
//    a una persona.

import type { CanalPreferido } from "./canal.ts";

// deno-lint-ignore no-explicit-any
type Cliente = any;

type TipoFicha = "productor" | "entidad";

const TABLA: Record<TipoFicha, string> = {
  productor: "productores",
  entidad: "entidades",
};

/** Lo que se guarda en `organizaciones.canal_preferido`, validado. */
function normalizarPreferencia(valor: unknown): CanalPreferido {
  return valor === "whatsapp" || valor === "email" ? valor : null;
}

/**
 * Preferencia de canal de las organizaciones de un lote de fichas.
 *
 * Devuelve un mapa `id de ficha -> canal preferido`; las fichas sin organización, sin
 * preferencia o que no se hayan podido leer sencillamente no están en el mapa, que para
 * quien lo consulta es lo mismo que `null` (deducir el canal como siempre).
 *
 * Dos consultas y no 111: se piden los `organizacion_id` del lote y luego las
 * organizaciones de golpe. La alternativa —preguntar ficha por ficha— es el error que ya
 * se evitó en `sense_conveni` (`priorizar-entidades`).
 */
export async function preferenciasDeCanal(
  supabase: Cliente,
  tipo: TipoFicha,
  fichaIds: string[],
): Promise<Map<string, CanalPreferido>> {
  const fuera = new Map<string, CanalPreferido>();
  if (fichaIds.length === 0) return fuera;

  const { data: fichas, error: errFichas } = await supabase
    .from(TABLA[tipo]).select("id, organizacion_id").in("id", fichaIds);
  if (errFichas) {
    console.error(`${TABLA[tipo]}.organizacion_id select:`, errFichas.message);
    return fuera;
  }

  const orgPorFicha = new Map<string, string>();
  for (const f of (fichas ?? []) as Array<{ id: string; organizacion_id: string | null }>) {
    if (f.organizacion_id) orgPorFicha.set(f.id, f.organizacion_id);
  }
  if (orgPorFicha.size === 0) return fuera;

  const { data: orgs, error: errOrgs } = await supabase
    .from("organizaciones").select("id, canal_preferido")
    .in("id", [...new Set(orgPorFicha.values())]);
  if (errOrgs) {
    console.error("organizaciones select:", errOrgs.message);
    return fuera;
  }

  const preferenciaPorOrg = new Map<string, CanalPreferido>();
  for (const o of (orgs ?? []) as Array<{ id: string; canal_preferido: string | null }>) {
    preferenciaPorOrg.set(o.id, normalizarPreferencia(o.canal_preferido));
  }
  for (const [ficha, org] of orgPorFicha) {
    const p = preferenciaPorOrg.get(org) ?? null;
    if (p) fuera.set(ficha, p);
  }
  return fuera;
}

/**
 * Preferencia de canal de la organización a la que pertenece una CUENTA.
 *
 * La cuenta llega a su organización por `membresias` (§4bis), que puede tener más de una
 * fila: una organización con doble rol tiene ficha de productor y de entidad. Si las dos
 * apuntan a la misma organización —que es lo que la etapa 1 permite comprobar— la
 * preferencia es una sola y no hay nada que desempatar. Si apuntan a organizaciones
 * distintas y cada una pide una cosa, **manda la del productor**, por el mismo criterio
 * con el que `v_organizaciones` elige el nombre: es la ficha que firma el convenio y la
 * que el equipo ha revisado.
 */
export async function preferenciaDeCuenta(
  supabase: Cliente,
  userId: string,
): Promise<CanalPreferido> {
  const { data: ms, error } = await supabase
    .from("membresias").select("productor_id, entidad_id")
    .eq("user_id", userId).eq("activo", true);
  if (error) {
    console.error("membresias select:", error.message);
    return null;
  }

  const productores = (ms ?? [])
    .map((m: { productor_id: string | null }) => m.productor_id).filter(Boolean) as string[];
  const entidades = (ms ?? [])
    .map((m: { entidad_id: string | null }) => m.entidad_id).filter(Boolean) as string[];

  const [pref_p, pref_e] = await Promise.all([
    preferenciasDeCanal(supabase, "productor", productores),
    preferenciasDeCanal(supabase, "entidad", entidades),
  ]);
  for (const id of productores) {
    const p = pref_p.get(id);
    if (p) return p;
  }
  for (const id of entidades) {
    const p = pref_e.get(id);
    if (p) return p;
  }
  return null;
}

/** Qué papeles tiene un teléfono, y si son la misma organización. */
export interface RolesDelTelefono {
  productor: { id: string; nombre: string | null; organizacion_id: string | null } | null;
  entidad: { id: string; nombre: string | null; organizacion_id: string | null } | null;
  /** `true` solo si hay las dos fichas Y comparten organización (doble rol de verdad). */
  mismaOrganizacion: boolean;
}

/**
 * Las fichas de un teléfono (deuda §12.16).
 *
 * Antes de la etapa 1, dos fichas con el mismo teléfono podían ser la misma organización o
 * dos que comparten una centralita, y no había forma de distinguirlo. Ahora sí: se comparan
 * los `organizacion_id`. Se usa para **poder decirlo** en el log cuando el webhook atiende a
 * un número de doble rol, no para decidir nada — la decisión la toma `atendreElDialeg()`,
 * que es pura y no necesita saber de quién es el teléfono.
 */
export async function rolesDelTelefono(
  supabase: Cliente,
  telefono: string,
): Promise<RolesDelTelefono> {
  const [p, e] = await Promise.all([
    supabase.from("productores").select("id, name, organizacion_id").eq("phone", telefono).maybeSingle(),
    supabase.from("entidades").select("id, nombre, organizacion_id").eq("telefono", telefono).maybeSingle(),
  ]);
  if (p.error) console.error("productores por teléfono:", p.error.message);
  if (e.error) console.error("entidades por teléfono:", e.error.message);

  const productor = p.data
    ? { id: p.data.id, nombre: p.data.name ?? null, organizacion_id: p.data.organizacion_id ?? null }
    : null;
  const entidad = e.data
    ? { id: e.data.id, nombre: e.data.nombre ?? null, organizacion_id: e.data.organizacion_id ?? null }
    : null;

  return {
    productor,
    entidad,
    mismaOrganizacion: !!productor?.organizacion_id && !!entidad?.organizacion_id &&
      productor.organizacion_id === entidad.organizacion_id,
  };
}
