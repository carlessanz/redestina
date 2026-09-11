// ¿Esta organización ya existe? — la parte que se puede razonar sin base de datos.
//
// ETAPA 2 de la organización unificada (§1bis, brecha 2). La etapa 1 creó `organizaciones`,
// las dos columnas `organizacion_id` y la vista `v_organizaciones`; aquí se usa esa identidad
// para lo que la deuda §12.28 pedía: que el registro público DETECTE que una organización ya
// consta, en vez de crear una ficha más y esperar a que el equipo se dé cuenta al validar.
//
// TRES CASOS, y la diferencia entre ellos es la razón de que este módulo exista:
//   1. no coincide nada                  → alta normal
//   2. coincide una organización que NO tiene ficha del tipo que se registra
//      (el productor que ahora también recibe)  → es la MISMA organización estrenando papel
//   3. coincide una organización que YA tiene ficha de ese tipo → duplicado de verdad, 409
//
// EL CRITERIO ES CORREO O TELÉFONO EXACTOS, NUNCA EL PARECIDO DEL NOMBRE, y es la misma regla
// con la que la migración de la etapa 1 enganchó los cuatro pares reales. Dos nombres
// parecidos son dos organizaciones distintas mucho más a menudo de lo que parece, y juntarlas
// aquí significa mezclar los kilos y el certificado fiscal de dos donantes: si hay duda, se
// prefiere dejar dos fichas separadas —el estado de hoy, que funciona— a arriesgar una fusión
// equivocada. Medido contra producción el 11-09-2026: de 345 productores y 119 entidades, los
// únicos pares reales coinciden por correo o teléfono; el NIF no sirve de clave (lo tiene la
// mitad de las fichas y no hay ni uno que aparezca en las dos tablas).
//
// Sin un solo import, y a propósito: así lo prueba Vitest tal cual (`tests/registro.test.ts`),
// que es donde se puede ejercitar la tabla de casos entera sin levantar nada.

/** Los dos papeles que puede tener una organización, con el vocabulario de `membresias`. */
export type TipusFitxa = "productor" | "entidad";

/** Por qué se considera que dos fichas son la misma organización. */
export type MotiuCoincidencia = "email" | "telefon";

/** Una ficha (de productor o de entidad) que coincide con lo que se está registrando. */
export interface FitxaCoincident {
  tipus: TipusFitxa;
  id: string;
  /** La organización a la que pertenece, o `null` si todavía no tiene ninguna. */
  organitzacio: string | null;
  /** Para poder nombrarla en la nota que lee el equipo. */
  nom: string | null;
  /** Todos los motivos por los que casa; `email` manda sobre `telefon` al explicarlo. */
  per: MotiuCoincidencia[];
}

/**
 * Lo que `v_organizaciones` sabe de una organización coincidente. **Los papeles se leen de
 * aquí y no de las fichas coincidentes**: una organización puede tener ficha del tipo que se
 * registra sin que esa ficha haya casado por correo ni por teléfono (dos fichas de la misma
 * organización pueden tener contactos distintos), y ese caso es un duplicado igualmente.
 */
export interface OrgCoincident {
  id: string;
  nombre: string | null;
  es_generadora: boolean;
  es_receptora: boolean;
}

export type Decisio =
  /** Nada coincide: alta normal, con su organización nueva. */
  | { cas: "alta" }
  /** Ya existe ficha de este tipo: se rechaza, como hasta ahora. */
  | { cas: "duplicat"; camp: MotiuCoincidencia; fitxa: FitxaCoincident }
  /** La misma organización estrenando papel: se da el alta, sin enlazar, y lo valida el equipo. */
  | { cas: "paper_nou"; fitxes: FitxaCoincident[]; organitzacions: OrgCoincident[] };

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

/**
 * Las últimas 9 cifras de un teléfono, que es como se comparan (§7): es lo único que tienen
 * en común `34612345678`, `+34 612 345 678` y `612345678`. Menos de 9 cifras no es un
 * teléfono comparable y devuelve `null` —jamás una cadena corta, que casaría con demasiado—.
 */
export function ultimes9(brut: string | null | undefined): string | null {
  const digits = (brut ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/**
 * El patrón para el operador `match` (regex) de PostgREST. Tolera separadores entre cifras
 * y texto detrás, porque `entidades.telefono` es texto libre: el importador lo normaliza,
 * pero cualquier edición posterior desde la ficha puede meter espacios o un nombre pegado.
 *
 * ⚠️ Es un filtro GRUESO, no el criterio: lo que decide es `mateixTelefon()` en memoria,
 * sobre el valor que devuelva la consulta. Una expresión regular sobre texto sucio puede
 * casar de más (y una consulta de más se descarta), pero nunca decide ella sola.
 */
export function patroTelefon(nou: string): string {
  return nou.split("").join("[^0-9]*") + "[^0-9]*$";
}

/** Dos teléfonos son el mismo si coinciden sus últimas 9 cifras. */
export function mateixTelefon(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = ultimes9(a);
  const y = ultimes9(b);
  return x !== null && x === y;
}

/** Dos correos son el mismo ignorando mayúsculas y espacios de los lados. Vacío no cuenta. */
export function mateixEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return x !== "" && x === y;
}

// ---------------------------------------------------------------------------
// La decisión
// ---------------------------------------------------------------------------

/** El papel que una organización estrena al registrarse con este rol. */
function teFitxaDeltipus(org: OrgCoincident, tipus: TipusFitxa): boolean {
  return tipus === "productor" ? org.es_generadora : org.es_receptora;
}

/** `email` manda sobre `telefon`: es el dato que la persona ha tecleado entero. */
function campPrincipal(per: MotiuCoincidencia[]): MotiuCoincidencia {
  return per.includes("email") ? "email" : "telefon";
}

/**
 * Los tres casos. `fitxes` son las fichas que casan por correo o teléfono; `organitzacions`,
 * lo que `v_organizaciones` dice de las organizaciones de esas fichas.
 *
 * El duplicado gana siempre que aparezca por cualquiera de los dos lados: por una ficha del
 * mismo tipo, o porque la organización de una ficha del otro tipo ya tiene su papel cubierto.
 * Y con varias organizaciones coincidentes a la vez —correo de una, teléfono de otra— no se
 * elige ninguna: eso es `paper_nou` con varios candidatos, que es una pregunta para el equipo
 * y no algo que esta función pueda resolver sola.
 */
export function decidir(
  rol: TipusFitxa,
  fitxes: FitxaCoincident[],
  organitzacions: OrgCoincident[],
): Decisio {
  if (fitxes.length === 0) return { cas: "alta" };

  const mateixTipus = fitxes.filter((f) => f.tipus === rol);
  if (mateixTipus.length > 0) {
    const fitxa = mateixTipus.find((f) => f.per.includes("email")) ?? mateixTipus[0];
    return { cas: "duplicat", camp: campPrincipal(fitxa.per), fitxa };
  }

  // Ninguna ficha del mismo tipo ha casado, pero la organización de alguna puede tener ya
  // ese papel con otro correo y otro teléfono. Es un duplicado igual.
  const ocupades = organitzacions.filter((o) => teFitxaDeltipus(o, rol));
  if (ocupades.length > 0) {
    const fitxa = fitxes.find((f) => f.organitzacio === ocupades[0].id) ?? fitxes[0];
    return { cas: "duplicat", camp: campPrincipal(fitxa.per), fitxa };
  }

  return { cas: "paper_nou", fitxes, organitzacions };
}

// ---------------------------------------------------------------------------
// Lo que lee el equipo
// ---------------------------------------------------------------------------

/**
 * La nota que se escribe en el comentario de la ficha nueva cuando el alta es un papel nuevo
 * de una organización que ya consta. **Es todo lo que el equipo tiene para decidir**, así que
 * dice qué coincidió y con qué ficha, y deja claro que la decisión está pendiente.
 *
 * Va al comentario de la ficha, y no a la membresía, porque la cola de «Registres pendents»
 * enlaza a la ficha para completarla antes de aprobar (§6quater): es el sitio donde el equipo
 * ya mira.
 */
export function notaPaperNou(fitxes: FitxaCoincident[], dataISO: string): string {
  const dia = dataISO.slice(0, 10);
  const linies = fitxes.map((f) => {
    const quin = f.tipus === "productor" ? "productor" : "entitat";
    const nom = f.nom ? `«${f.nom}»` : "sense nom";
    const per = f.per.includes("email") && f.per.includes("telefon")
      ? "correu i telefon"
      : f.per.includes("email")
      ? "correu"
      : "telefon";
    return `· fitxa de ${quin} ${nom} (coincideix el ${per})`;
  });
  return [
    `[${dia}] POSSIBLE MATEIXA ORGANITZACIO (registre public)`,
    ...linies,
    "Cal decidir si es la mateixa organitzacio abans d'aprovar l'acces. La fitxa s'ha creat",
    "SENSE enllacar amb cap organitzacio: enllacar-la es una decisio de l'equip.",
  ].join("\n");
}
