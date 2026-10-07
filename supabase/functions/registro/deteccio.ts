// La detección de una organización que ya existe (deuda §12.28). Las consultas viven aquí;
// la regla, pura y con pruebas, en `coincidencies.ts`. Separado de `index.ts` el 07-10-2026
// sin cambiar una línea de lógica.

import {
  type Decisio,
  decidir,
  type FitxaCoincident,
  motiuEmail,
  type MotiuCoincidencia,
  motiuTelefon,
  type OrgCoincident,
  patroTelefon,
  type TipusFitxa,
  ultimes9,
} from "./coincidencies.ts";
import { type Dades, patroLike } from "./validacio.ts";
import type { Cliente } from "./cliente.ts";

// ---------------------------------------------------------------------------
// ¿Esta organización ya existe? (etapa 2 de la brecha 2, deuda §12.28)
// ---------------------------------------------------------------------------
// Lo que se consulta son LAS FICHAS, y después la vista. No al revés, y no es un detalle:
// `v_organizaciones` expone un solo correo y un solo teléfono por organización (el de la
// ficha de productor cuando hay las dos, por el `coalesce`), así que filtrar la vista por
// correo dejaría invisible el correo de la otra ficha — y ese es justo el caso que esto
// viene a cazar. Las fichas dicen QUIÉN casa; `v_organizaciones` dice QUÉ PAPELES tiene ya
// la organización de quien ha casado, que es lo que separa el caso 2 del caso 3.
//
// Una consulta por campo —el correo y CADA columna de teléfono, en las dos tablas—, todas
// en paralelo: son idas y vueltas que cuestan lo que la más lenta, y evitan tener que
// escapar valores dentro de un `or=(…)` de PostgREST. Un correo válido puede llevar comas
// y paréntesis, que son separadores de esa sintaxis; un `ilike` suelto no tiene ese
// problema. Un registro es una operación rara: no hay nada que ahorrar aquí.
//
// `limit(5)` en cada una: con más de cinco fichas casando por el mismo correo ya no hay
// ninguna decisión automática que tomar, y la nota se leería sola.
const MAX_COINCIDENCIES = 5;

// Y no hay UNA columna de teléfono por ficha, sino varias (deuda §12.91): la de entidades
// las trae del Excel SDA (`telefono2`, `telefono3` son el contacto de otra persona de la
// misma organización) y la de productores tiene `telefono_alt`, que es DONDE EL IMPORTADOR
// DEJÓ los números extra cuando venían tres en la misma celda (§6). Mirar solo la primera
// dejaba fuera precisamente los casos que el import apartó por venir mal.
//
// ⚠️ PERO LAS SECUNDARIAS NO VALEN LO MISMO, y mezclarlas habría salido caro. Una
// coincidencia en la columna principal deniega el alta (409 `dades_en_us`); una en una
// secundaria, jamás — como mucho manda la ficha a revisión del equipo. Medido contra
// producción antes de decidirlo: dentro de productores hay 2 números compartidos por dos
// fichas distintas y dentro de entidades 1 (`Càritas l'Aldea` y `Càritas Roquetes`), así
// que sin esta distinción cualquiera de esas organizaciones se habría quedado **sin poder
// registrarse**, con un 409 y un «contacta amb l'equip» por toda salida. Un fallo de la
// detección tiene que producir un duplicado que el equipo ve; nunca un alta denegada, y
// nunca una fusión. Lo impone `esForta()`, en `coincidencies.ts`.
const TEL_PRINCIPAL_PRODUCTOR = "phone";
const TEL_PRINCIPAL_ENTITAT = "telefono";
const TEL_SECUNDARIS_PRODUCTOR = ["telefono_alt"] as const;
const TEL_SECUNDARIS_ENTITAT = ["telefono2", "telefono3"] as const;
const CAMPS_TEL_PRODUCTOR = [TEL_PRINCIPAL_PRODUCTOR, ...TEL_SECUNDARIS_PRODUCTOR];
const CAMPS_TEL_ENTITAT = [TEL_PRINCIPAL_ENTITAT, ...TEL_SECUNDARIS_ENTITAT];

// Y con el CORREO pasa lo mismo desde el 15-09-2026 (deuda §12.102): `entidades.email2` era
// la última columna ciega. Se mira igual que las de teléfono y **con la misma regla**: una
// coincidencia ahí no puede denegar, porque ese campo guarda el correo de otra persona de la
// casa. `productores` no tiene ninguna secundaria —su `email` es UNIQUE—, así que la lista
// vacía no es un hueco por rellenar: es que no hay dónde mirar.
const EMAIL_PRINCIPAL = "email";
const EMAIL_SECUNDARIS_PRODUCTOR = [] as const;
const EMAIL_SECUNDARIS_ENTITAT = ["email2"] as const;

/**
 * Las filas que el prefiltro de teléfono trae de una tabla, buscando por cada una de sus
 * columnas y quitando las repetidas. Una consulta por columna, todas en paralelo: es lo
 * mismo que se hace con el correo y por el mismo motivo —un `or=(…)` de PostgREST habría
 * que escaparlo, y aquí el coste de una ida y vuelta más es el de la más lenta—.
 *
 * Un error NO aborta el alta: se registra y se sigue con lo que hayan traído las demás.
 * Quedarse sin ver una coincidencia produce un duplicado que el equipo resuelve; negar el
 * registro produce una persona que no puede darse de alta.
 */
async function filesPerColumnes(
  consulta: () => Cliente,
  camps: readonly string[],
  filtra: ((q: Cliente, camp: string) => Cliente) | null,
): Promise<Record<string, unknown>[]> {
  if (!filtra || camps.length === 0) return [];
  const resultats = await Promise.all(
    camps.map((c) => filtra(consulta(), c).limit(MAX_COINCIDENCIES)),
  );
  const files = new Map<string, Record<string, unknown>>();
  for (const [i, r] of resultats.entries()) {
    if (r.error) {
      console.error("[registro] coincidencies:", camps[i], r.error.code, r.error.message);
      continue;
    }
    for (const f of (r.data ?? []) as Record<string, unknown>[]) files.set(f.id as string, f);
  }
  return [...files.values()];
}

export async function decidirCoincidencia(
  supabase: Cliente,
  d: Dades,
  tipusRol: TipusFitxa,
): Promise<Decisio> {
  const nou9 = ultimes9(d.telefon);
  const patro = nou9 ? patroTelefon(nou9) : null;

  const prod = () =>
    supabase.from("productores").select("id, organizacion_id, name, empresa, email, phone, telefono_alt");
  const ent = () =>
    supabase.from("entidades").select("id, organizacion_id, nombre, email, email2, telefono, telefono2, telefono3");

  // Cada columna, su consulta. Un `or=(…)` de PostgREST habría que escaparlo, y aquí el
  // coste de una ida y vuelta más es el de la más lenta: van todas en paralelo.
  const perTel = patro ? (q: Cliente, c: string) => q.filter(c, "match", patro) : null;
  const perEmail = (q: Cliente, c: string) => q.ilike(c, patroLike(d.email));

  const [pEmail, eEmail, eEmail2, pTel, eTel] = await Promise.all([
    prod().ilike(EMAIL_PRINCIPAL, patroLike(d.email)).limit(MAX_COINCIDENCIES),
    ent().ilike(EMAIL_PRINCIPAL, patroLike(d.email)).limit(MAX_COINCIDENCIES),
    filesPerColumnes(ent, EMAIL_SECUNDARIS_ENTITAT, perEmail),
    filesPerColumnes(prod, CAMPS_TEL_PRODUCTOR, perTel),
    filesPerColumnes(ent, CAMPS_TEL_ENTITAT, perTel),
  ]);

  // Se vuelve a comprobar en memoria lo que devolvió la consulta. El `ilike` con los
  // comodines escapados ya es igualdad, pero el `match` del teléfono es un filtro grueso
  // sobre texto libre —y desde que dejó de ir anclado al final del campo, más grueso
  // todavía—: lo que decide es `algunTelefonCoincideix`, con claves de 9 cifras, que es el
  // mismo criterio con el que la migración de la etapa 1 enganchó los cuatro pares. Sin
  // esta segunda vuelta, el prefiltro daría por la misma organización a dos que no lo son.
  const fitxes = new Map<string, FitxaCoincident>();
  const afegir = (
    tipus: TipusFitxa,
    fila: Record<string, unknown>,
    per: MotiuCoincidencia,
  ) => {
    const id = fila.id as string;
    const clau = `${tipus}:${id}`;
    const previa = fitxes.get(clau);
    if (previa) {
      if (!previa.per.includes(per)) previa.per.push(per);
      return;
    }
    const nom = tipus === "productor"
      ? ((fila.empresa as string | null) || (fila.name as string | null))
      : (fila.nombre as string | null);
    fitxes.set(clau, {
      tipus,
      id,
      organitzacio: (fila.organizacion_id as string | null) ?? null,
      nom: nom ?? null,
      per: [per],
    });
  };

  // ⚠️ El teléfono se mira en TODAS las columnas de la fila, no solo en aquella por la que
  // la consulta la encontró: una ficha puede casar por `telefono3` y tener el mismo número
  // en `telefono`, y entonces la coincidencia es fuerte. `motiuTelefon` se queda con la más
  // fuerte de las dos, que es la única forma de que la columna por la que llegó la fila no
  // cambie la decisión.
  const tel = (f: Record<string, unknown>, principal: string, secundaris: readonly string[]) =>
    motiuTelefon(
      f[principal] as string | null,
      secundaris.map((c) => f[c] as string | null),
      d.telefon,
    );
  // El correo se mira en TODAS las columnas de la fila, no solo en aquella por la que la
  // consulta la encontró — mismo argumento que el teléfono de aquí al lado.
  const mail = (f: Record<string, unknown>, secundaris: readonly string[]) =>
    motiuEmail(
      f[EMAIL_PRINCIPAL] as string | null,
      secundaris.map((c) => f[c] as string | null),
      d.email,
    );

  for (const f of ((pEmail.data ?? []) as Record<string, unknown>[])) {
    const motiu = mail(f, EMAIL_SECUNDARIS_PRODUCTOR);
    if (motiu) afegir("productor", f, motiu);
  }
  for (const f of pTel) {
    const motiu = tel(f, TEL_PRINCIPAL_PRODUCTOR, TEL_SECUNDARIS_PRODUCTOR);
    if (motiu) afegir("productor", f, motiu);
  }
  for (const f of [...((eEmail.data ?? []) as Record<string, unknown>[]), ...eEmail2]) {
    const motiu = mail(f, EMAIL_SECUNDARIS_ENTITAT);
    if (motiu) afegir("entidad", f, motiu);
  }
  for (const f of eTel) {
    const motiu = tel(f, TEL_PRINCIPAL_ENTITAT, TEL_SECUNDARIS_ENTITAT);
    if (motiu) afegir("entidad", f, motiu);
  }

  const llista = [...fitxes.values()];
  if (llista.length === 0) return decidir(tipusRol, [], []);

  const ids = [...new Set(llista.map((f) => f.organitzacio).filter((x): x is string => !!x))];
  let orgs: OrgCoincident[] = [];
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("v_organizaciones")
      .select("id, nombre, es_generadora, es_receptora")
      .in("id", ids);
    if (error) {
      // Sin la vista no se puede afirmar que el papel esté libre. Fail-safe hacia el lado
      // que NO crea nada nuevo: se trata como duplicado y lo mira una persona. Lo caro
      // aquí no es rechazar un alta legítima —el equipo la recupera— sino dar por nueva
      // una organización que ya está.
      console.error("[registro] v_organizaciones:", error.code, error.message);
      const fitxa = llista[0];
      return { cas: "duplicat", camp: fitxa.per.includes("email") ? "email" : "telefon", fitxa };
    }
    orgs = (data ?? []) as OrgCoincident[];
  }

  return decidir(tipusRol, llista, orgs);
}
