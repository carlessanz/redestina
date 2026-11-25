// Priorización de entidades receptoras para un excedente.
//
// Función pura y sin dependencias de red: recibe el excedente y las entidades ya
// cargadas, y devuelve el ranking. Así se puede probar aislada.

// --- Pesos (documentados y en un solo sitio para poder ajustarlos) ----------
const PESO_MISMA_AREA = 3;
const PESO_MISMA_POBLACION = 2; // adicional, encima de la misma área
const PESO_TRANSPORT = 1;
const PESO_TORO = 1;
const PESO_FRESCOS = 2;
/**
 * La entidad ha dicho en su perfil que le interesa esta categoría de producto (C3 v1,
 * 05-10-2026). Pesa como los frescos: es una declaración de la propia entidad, no una
 * deducción, y con la misma fuerza que la otra señal de «esto le sirve».
 */
export const PESO_PRODUCTE = 2;
const UMBRAL_KG_GRANDE = 500; // por encima, la capacidad de transporte pesa doble
const PRIORITAT_MAX = 3; // prioritat 1 es la más alta; suma (3 - prioritat)

// La única familia que NO se considera fresca.
const FAMILIA_NO_FRESCA = "Varis";

// Quién entra y quién va al final (deuda §12.168, 09-11-2026):
//   · «al final, con aviso» = sin el convenio vigente que exige la modalidad de la oferta
//     (`conveni_vigent`, calculado en `priorizar-entidades` con `convenios_exigidos`: el mismo
//     que alimenta `sense_conveni` y que pide la fecha de corte para mostrar interés).
//   · excluida = la que no es `activo`, y eso lo hace la CONSULTA de `priorizar-entidades`, no
//     este módulo. Desde el Plan 2 B1 (20270518100000) `activo` lo deriva el estado CRM
//     (`estat_crm = 'actiu'`): Potencial, En desenvolupament e Inactiu no entran. El «No
//     procedeix» de la columna `estat` del antiguo Excel —lo único que excluía aquí— pasó a
//     `inactiu` en el backfill, y la columna queda sin uso (deuda §12.172).

export interface EntidadPriorizable {
  id: string;
  nombre: string;
  poblacion: string | null;
  telefono: string | null;
  opt_in: boolean | null;
  area_geografica: string | null;
  /** ¿Tiene el convenio vigente que exige la modalidad? Sin él, va al final con aviso. */
  conveni_vigent: boolean;
  prioritat: number | null;
  productes_frescos: boolean | null;
  transport_plataforma: boolean | null;
  descarrega_toro: boolean | null;
  /** `entidades.perfil_receptor` (jsonb): de aquí salen las categorías que le interesan. */
  perfil_receptor?: Record<string, unknown> | null;
}

export interface ExcedenteContexto {
  familia: string | null;
  area_geografica: string | null; // del excedente/ubicación
  poblacion: string | null;
  kg_total: number | null;
}

export interface EntidadPuntuada {
  id: string;
  nombre: string;
  poblacion: string | null;
  telefono: string | null;
  opt_in: boolean;
  puntuacion: number;
  motivos: string[];
  /** Sin convenio vigente: candidata pero avisada, va al final del ranking. */
  pendiente: boolean;
  /**
   * ¿Ha dicho la entidad que le interesa esta categoría de producto? `null` si no ha
   * declarado ninguna (perfil sin rellenar): no se le puede atribuir ni un sí ni un no.
   */
  interessa_producte: boolean | null;
}

/** Las categorías del perfil del receptor (`perfilReceptor.ts`), el mismo vocabulario. */
export type CategoriaProducte = "fruita" | "verdura" | "tuberculs" | "fruita_seca" | "altres";

/**
 * La categoría de una familia del catálogo. COPIA de `categoriaDeFamilia()` de
 * `src/lib/filtresMercat.ts` (el navegador no importa Deno); `tests/priorizacion.test.ts`
 * comprueba que dicen lo mismo.
 */
export function categoriaDeFamilia(familia: string | null | undefined): CategoriaProducte {
  const f = (familia ?? "").trim();
  if (f === "Fruita Seca") return "fruita_seca";
  if (f.startsWith("Fruita")) return "fruita";
  if (f === "Horta Tub/Bul/Arr") return "tuberculs";
  if (f.startsWith("Horta")) return "verdura";
  return "altres";
}

/** Las tres claves del perfil que dicen qué productos quiere, según el tipo de receptor. */
const CLAUS_PRODUCTES = ["productes_rebre", "productes_interes", "productes_transformar"];

/**
 * Las categorías que declara el perfil, o null si no declara ninguna. `tots` = todas.
 */
export function categoriesInteres(perfil: Record<string, unknown> | null | undefined): Set<string> | null {
  if (!perfil || typeof perfil !== "object") return null;
  const fora = new Set<string>();
  for (const k of CLAUS_PRODUCTES) {
    const v = perfil[k];
    if (Array.isArray(v)) for (const x of v) fora.add(String(x));
  }
  if (fora.size === 0) return null;
  if (fora.has("tots")) return new Set(["fruita", "verdura", "tuberculs", "fruita_seca", "altres"]);
  return fora;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Puntúa una entidad frente a un excedente. Devuelve null si se excluye. */
export function puntuarEntidad(
  entidad: EntidadPriorizable,
  excedente: ExcedenteContexto,
): EntidadPuntuada | null {
  const pendiente = !entidad.conveni_vigent;

  let puntuacion = 0;
  const motivos: string[] = [];

  // Proximidad
  const mismaArea = norm(entidad.area_geografica) === norm(excedente.area_geografica) &&
    norm(excedente.area_geografica) !== "";
  if (mismaArea) {
    puntuacion += PESO_MISMA_AREA;
    motivos.push(`Mateixa àrea (${entidad.area_geografica})`);
    if (norm(entidad.poblacion) === norm(excedente.poblacion) && norm(excedente.poblacion) !== "") {
      puntuacion += PESO_MISMA_POBLACION;
      motivos.push(`Mateix municipi (${entidad.poblacion})`);
    }
  }

  // Capacidad, con peso doble para excedentes grandes
  const factorKg = (excedente.kg_total ?? 0) > UMBRAL_KG_GRANDE ? 2 : 1;
  if (entidad.transport_plataforma) {
    puntuacion += PESO_TRANSPORT * factorKg;
    motivos.push(factorKg > 1 ? "Transport amb plataforma (excedent gran)" : "Transport amb plataforma");
  }
  if (entidad.descarrega_toro) {
    puntuacion += PESO_TORO * factorKg;
    motivos.push(factorKg > 1 ? "Descàrrega amb toro (excedent gran)" : "Descàrrega amb toro");
  }

  // Tipo: producto fresco y entidad que acepta frescos
  const esFresco = norm(excedente.familia) !== norm(FAMILIA_NO_FRESCA);
  if (esFresco && entidad.productes_frescos) {
    puntuacion += PESO_FRESCOS;
    motivos.push("Accepta productes frescos");
  }

  // Producto declarado en su perfil (C3 v1)
  const cats = categoriesInteres(entidad.perfil_receptor);
  const catExc = categoriaDeFamilia(excedente.familia);
  const interessa = cats === null ? null : cats.has(catExc);
  if (interessa) {
    puntuacion += PESO_PRODUCTE;
    motivos.push("Li interessa aquest producte");
  }

  // Prioritat (1 = más alta)
  if (entidad.prioritat != null) {
    const p = Math.max(0, PRIORITAT_MAX - entidad.prioritat);
    if (p > 0) {
      puntuacion += p;
      motivos.push(`Prioritat ${entidad.prioritat}`);
    }
  }

  if (pendiente) motivos.push("⚠️ Conveni pendent");
  if (!entidad.opt_in) motivos.push("Sense opt-in: no es pot enviar per API");

  return {
    id: entidad.id,
    nombre: entidad.nombre,
    poblacion: entidad.poblacion,
    telefono: entidad.telefono,
    opt_in: entidad.opt_in ?? false,
    puntuacion,
    motivos,
    pendiente,
    interessa_producte: interessa,
  };
}

/**
 * Ordena las entidades candidatas: primero las activas por puntuación
 * descendente, y al final las de conveni pendiente (también por puntuación).
 */
export function priorizar(
  entidades: EntidadPriorizable[],
  excedente: ExcedenteContexto,
): EntidadPuntuada[] {
  const puntuadas = entidades
    .map((e) => puntuarEntidad(e, excedente))
    .filter((e): e is EntidadPuntuada => e !== null);

  return puntuadas.sort((a, b) => {
    if (a.pendiente !== b.pendiente) return a.pendiente ? 1 : -1;
    return b.puntuacion - a.puntuacion;
  });
}

/**
 * La regla P8 en el ranking (deuda §12.176, 10-11-2026): ¿puede recibir una entidad ESTA oferta
 * por su naturalesa? Es el mismo cruce que hacen `modalitats_compatibles_meves()` (Mercat) y
 * `comprova_interes()` (interés): solo restringe la naturalesa CONFIRMADA, y basta con que UNA de
 * las modalidades de la oferta la admita. Una empresa confirmada no entra en una oferta que solo es
 * de donación; en una de donación y compra, sí (puede comprarla).
 *
 * `regla` = `modalitat_naturalesa_compat` (naturalesa → modalidades). `null` = no se pudo leer:
 * no se filtra, porque la base sigue siendo la que corta al mostrar interés.
 */
export function admesaPerNaturalesa(
  modalitatsOferta: readonly string[],
  naturalesa: string | null | undefined,
  origen: string | null | undefined,
  regla: ReadonlyMap<string, ReadonlySet<string>> | null,
): boolean {
  if (!regla || origen !== "confirmada" || !naturalesa || modalitatsOferta.length === 0) return true;
  const admeses = regla.get(naturalesa);
  if (!admeses) return true;
  return modalitatsOferta.some((m) => admeses.has(m));
}

/** Las filas de `modalitat_naturalesa_compat` como mapa naturalesa → modalidades. */
export function reglaNaturalesa(
  files: readonly { modalitat: string; naturalesa: string }[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const f of files) {
    if (!m.has(f.naturalesa)) m.set(f.naturalesa, new Set());
    m.get(f.naturalesa)!.add(f.modalitat);
  }
  return m;
}

/** Las filas de `modalitat_receptor_compat` como mapa tipo de receptor → modalidades. */
export function matriuReceptor(
  files: readonly { modalitat: string; tipo_receptor: string }[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const f of files) {
    if (!m.has(f.tipo_receptor)) m.set(f.tipo_receptor, new Set());
    m.get(f.tipo_receptor)!.add(f.modalitat);
  }
  return m;
}

/**
 * Las modalidades de ESTA oferta que una entidad puede recibir, para el filtro «Modalitat» del
 * ranking (fase 1 del feedback del 08-10-2026, informe del 16-11-2026). Solo filtra; no puntúa.
 *
 * - Por su tipo de receptor, la matriz `modalitat_receptor_compat` (la de la RLS del Mercat). Sin
 *   tipo, o sin fila para su tipo, no se le quita ninguna: no se sabe.
 * - Por su naturalesa CONFIRMADA, P8 (`modalitat_naturalesa_compat`), como `admesaPerNaturalesa`.
 *
 * Un mapa `null` = no se pudo leer: esa regla no recorta. Lo que diga la entidad que le interesa
 * (`modalitats_interes`) va aparte: es preferencia, no permiso.
 */
export function modalitatsAdmeses(
  modalitatsOferta: readonly string[],
  tipoReceptor: string | null | undefined,
  matriu: ReadonlyMap<string, ReadonlySet<string>> | null,
  naturalesa: string | null | undefined,
  origen: string | null | undefined,
  regla: ReadonlyMap<string, ReadonlySet<string>> | null,
): string[] {
  let ms = [...modalitatsOferta];
  const perTipus = matriu && tipoReceptor ? matriu.get(tipoReceptor) : undefined;
  if (perTipus) ms = ms.filter((m) => perTipus.has(m));
  const perNaturalesa = regla && origen === "confirmada" && naturalesa ? regla.get(naturalesa) : undefined;
  if (perNaturalesa) ms = ms.filter((m) => perNaturalesa.has(m));
  return ms;
}

// ---------------------------------------------------------------------------
// Disponibilidades multiproducto (proceso 3.3, fase 6a, 25-11-2026)
// ---------------------------------------------------------------------------

/** Una oferta del grupo, tal como se nombra en el ranking unido. */
export interface OfertaDelGrup {
  excedente_id: string;
  id_excedente: string | null;
  producto: string | null;
  /** Las modalidades de esa oferta. */
  modalitats: readonly string[];
}

/** Lo que el ranking de UNA oferta necesita de cada fila para unirse con los demás. */
export interface FilaRankingUnible {
  id: string;
  puntuacion: number;
  pendiente: boolean;
  sense_conveni: boolean;
  modalitats_possibles: string[];
  interessa_producte: boolean | null;
}

/** Cómo encaja una entidad en una oferta concreta del grupo. */
export interface EncaixOferta {
  excedente_id: string;
  id_excedente: string | null;
  producto: string | null;
  puntuacion: number;
  sense_conveni: boolean;
  modalitats_possibles: string[];
}

const ORDRE_MODALITATS = ["donacio", "venda", "maquila"];

/**
 * El ranking de una DISPONIBILIDAD a partir del de cada una de sus ofertas (el de siempre, que
 * no cambia). Pura: la prueba `tests/disponibilitat.test.ts`.
 *
 * - Una entidad ENCAJA en una oferta si está en su ranking (activa, revisada, P8) y puede recibir
 *   alguna de sus modalidades (`modalitats_possibles`, la matriz del Mercat y P8); una oferta sin
 *   modalidades no descarta a nadie. Entra en el grupo si encaja en ALGUNA.
 * - Su fila es la de la oferta donde mejor encaja (con convenio antes que sin él; después, más
 *   puntuación; a igualdad, la primera del grupo): puntuación, motivos y canal salen de ahí, como
 *   hoy.
 * - Sobre esa fila: `pendiente`/`sense_conveni` solo si le falta el convenio en TODAS las que
 *   encaja; `modalitats_possibles` = la unión; `interessa_producte` = sí si alguna, no si alguna
 *   dice que no y ninguna que sí, null si no se sabe; y `ofertes_encaixen`, las ofertas del grupo
 *   que encajan, en el orden del grupo.
 * - Orden final como `priorizar()`: con convenio primero, por puntuación descendente.
 */
export function uneixRankings<T extends FilaRankingUnible>(
  perOferta: readonly { oferta: OfertaDelGrup; ranking: readonly T[] }[],
): (T & { ofertes_encaixen: EncaixOferta[] })[] {
  const millor = new Map<string, T>();
  const encaixos = new Map<string, EncaixOferta[]>();
  const interessos = new Map<string, (boolean | null)[]>();
  const ordre: string[] = [];
  for (const { oferta, ranking } of perOferta) {
    for (const fila of ranking) {
      const encaixa = oferta.modalitats.length === 0 || fila.modalitats_possibles.length > 0;
      if (!encaixa) continue;
      if (!encaixos.has(fila.id)) {
        encaixos.set(fila.id, []);
        interessos.set(fila.id, []);
        ordre.push(fila.id);
      }
      interessos.get(fila.id)!.push(fila.interessa_producte);
      encaixos.get(fila.id)!.push({
        excedente_id: oferta.excedente_id,
        id_excedente: oferta.id_excedente,
        producto: oferta.producto,
        puntuacion: fila.puntuacion,
        sense_conveni: fila.sense_conveni,
        modalitats_possibles: [...fila.modalitats_possibles],
      });
      const ant = millor.get(fila.id);
      const millora = !ant
        || (ant.pendiente && !fila.pendiente)
        || (ant.pendiente === fila.pendiente && fila.puntuacion > ant.puntuacion);
      if (millora) millor.set(fila.id, fila);
    }
  }
  const unides = ordre.map((id) => {
    const base = millor.get(id)!;
    const es = encaixos.get(id)!;
    const totesSense = es.every((e) => e.sense_conveni);
    const mods = new Set(es.flatMap((e) => e.modalitats_possibles));
    const is = interessos.get(id)!;
    const interessa = is.includes(true) ? true : is.includes(false) ? false : null;
    return {
      ...base,
      pendiente: totesSense,
      sense_conveni: totesSense,
      modalitats_possibles: [
        ...ORDRE_MODALITATS.filter((m) => mods.has(m)),
        ...[...mods].filter((m) => !ORDRE_MODALITATS.includes(m)),
      ],
      interessa_producte: interessa,
      ofertes_encaixen: es,
    };
  });
  // `sort` es estable: a igualdad, el orden en que aparecieron.
  return unides.sort((a, b) => {
    if (a.pendiente !== b.pendiente) return a.pendiente ? 1 : -1;
    return b.puntuacion - a.puntuacion;
  });
}
