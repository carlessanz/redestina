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

/**
 * Por qué se considera que dos fichas son la misma organización — y con qué FUERZA, que
 * es lo que decide si una coincidencia puede llegar a denegar un alta.
 *
 * ⚠️ `telefon_secundari` no es un motivo de segunda por gusto: `telefono2`, `telefono3` y
 * `telefono_alt` guardan el contacto de OTRA persona de la organización, o el fijo de la
 * casa, o una centralita. Medido en producción el 14-09-2026: `Càritas l'Aldea` y
 * `Càritas Roquetes` comparten número, y también lo comparten un ayuntamiento y una
 * entidad de su municipio. Eso dice «estas dos fichas se cogen el teléfono en el mismo
 * sitio», no «son la misma organización».
 */
export type MotiuCoincidencia = "email" | "telefon" | "telefon_secundari";

/**
 * Los motivos que SÍ pueden denegar un alta: el correo y el teléfono principal, que son un
 * dato por ficha y llevan significando lo mismo desde el primer día.
 */
export type MotiuFort = "email" | "telefon";

/**
 * Una coincidencia es fuerte si algo más que un teléfono secundario la sostiene.
 *
 * ⚠️ LA REGLA QUE ESTO IMPONE: **una coincidencia solo por columna secundaria nunca
 * responde 409.** Denegar es la única salida de esta función que la persona no puede
 * remontar sola —se queda sin poder registrarse y tiene que llamar—, y una señal débil no
 * puede tener esa consecuencia. Lo que hace es llevarla al camino que ya existe para lo
 * dudoso: el alta sigue, la ficha nace con su nota y el equipo la mira (`revisio_equip`).
 */
export function esForta(per: MotiuCoincidencia[]): boolean {
  return per.some((p) => p !== "telefon_secundari");
}

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
  | { cas: "duplicat"; camp: MotiuFort; fitxa: FitxaCoincident }
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
 * TODAS las claves de 9 cifras que contiene un campo de teléfono, que es texto libre y
 * puede llevar más de un número («612345678 / 933000000», «612345678 i el fix 933000000»).
 *
 * ⚠️ `ultimes9()` SOLA NO BASTABA, y esa es la mitad no evidente de la deuda §12.91. Con dos
 * números en la misma celda, las últimas nueve cifras del campo son las del SEGUNDO: quien
 * se registrara con el primero no casaba, por mucho que se arreglara el patrón de la
 * consulta. Aquí se parte el campo en los números que contiene y cada uno da su clave.
 *
 * Es la misma lectura que hace `extraerTelefonos()` en `scripts/import-ara.ts` —el que metió
 * esos campos con varios números dentro— y se repite aquí en vez de importarla porque este
 * módulo no importa nada a propósito (así lo prueba Vitest tal cual).
 *
 * **El conjunto que devuelve incluye siempre `ultimes9()` del campo entero**, así que nunca
 * encuentra MENOS que antes: solo añade. Y añadir por aquí es el lado seguro —una clave de
 * más produce una coincidencia que mira una persona, nunca una fusión automática: enlazar
 * dos organizaciones es siempre una decisión del equipo (`enllacar_organitzacio()`)—.
 */
export function clausTelefon(brut: string | null | undefined): string[] {
  const claus = new Set<string>();

  // La lectura de siempre, para no perder ningún caso que ya funcionaba.
  const sencer = ultimes9(brut);
  if (sencer) claus.add(sencer);

  // Fuera los paréntesis con su contenido (nombres, «(Joan)») y las extensiones.
  const net = (brut ?? "").replace(/\([^)]*\)/g, " ").replace(/ext\.?\s*\d+/gi, " ");

  // Un «número» es una tirada de 9 cifras o más admitiendo espacios, puntos y guiones
  // entre medias: lo que separa dos números de verdad (una barra, una coma, una letra)
  // rompe el grupo por sí solo.
  for (const m of net.matchAll(/(?:\d[\s.\-]*){9,}/g)) {
    let d = m[0].replace(/\D/g, "");

    const ultim = ultimes9(d);
    if (ultim) claus.add(ultim);

    // Y si el grupo lleva varios números pegados (separados solo por espacios), se van
    // sacando por delante: prefijo 34 + 9 cifras, o una tirada de 9 que empiece por móvil
    // o fijo español. Es la misma lectura de `extraerTelefonos()`.
    //
    // ⚠️ SOLO CUENTAN SI EL GRUPO SE DESCOMPONE ENTERO, y esa condición no es una
    // elegancia: sin ella, un campo de 10 cifras como `6123456789` soltaba la clave
    // `612345678` —los nueve primeros— y daba por la misma organización a dos que no lo
    // son. Lo cazó la prueba que comprueba que el prefiltro casa de más y el criterio no.
    // Si sobran cifras, el grupo no se entiende y se deja como estaba: con su `ultimes9`,
    // que es exactamente lo que hacía antes de todo esto.
    const parts: string[] = [];
    let resta = d.replace(/^0+/, "");
    while (resta.length >= 9) {
      if (resta.startsWith("34") && resta.length >= 11) {
        parts.push(resta.slice(2, 11));
        resta = resta.slice(11);
      } else if (/^[6789]/.test(resta)) {
        parts.push(resta.slice(0, 9));
        resta = resta.slice(9);
      } else {
        break;
      }
      resta = resta.replace(/^0+/, "");
    }
    if (resta === "") for (const p of parts) claus.add(p);
  }

  return [...claus];
}

/**
 * El patrón para el operador `match` (regex) de PostgREST. Tolera separadores entre cifras
 * y texto alrededor, porque los campos de teléfono son texto libre: el importador los
 * normaliza, pero cualquier edición posterior desde la ficha puede meter espacios, un
 * nombre pegado o un segundo número detrás.
 *
 * ⚠️ NO VA ANCLADO, y hasta el 14-09-2026 sí lo estaba (`…[^0-9]*$`). Con el ancla, un
 * campo como «612345678 / 933000000» no casaba —las cifras del segundo número quedan
 * detrás—, y como el ancla viaja EN LA CONSULTA, la fila ni siquiera llegaba a memoria:
 * `mateixTelefon()` no tenía ocasión de verla. Era la mitad visible de la deuda §12.91.
 *
 * ⚠️ Es un filtro GRUESO, no el criterio, y sin el ancla lo es más: `612345678` casa dentro
 * de `6123456789`, que es otro número. **Eso es inocuo mientras quien decida siga siendo
 * `mateixTelefon()`** sobre el valor que devuelva la consulta —y lo sigue siendo: en
 * `decidirCoincidencia()` ninguna fila entra en la lista de coincidencias sin pasar por
 * `algunTelefonCoincideix()`, que compara claves de 9 cifras—. Una fila de más se descarta
 * en memoria; una fila que no se consulta no se recupera.
 */
export function patroTelefon(nou: string): string {
  return nou.split("").join("[^0-9]*");
}

/**
 * Dos teléfonos son el mismo si comparten alguna clave de 9 cifras. Con campos de un solo
 * número es exactamente «las últimas 9 cifras» de siempre; con un campo que lleva dos,
 * basta con que uno de ellos sea el que se está registrando.
 */
export function mateixTelefon(a: string | null | undefined, b: string | null | undefined): boolean {
  const clausA = clausTelefon(a);
  if (clausA.length === 0) return false;
  const clausB = new Set(clausTelefon(b));
  return clausA.some((k) => clausB.has(k));
}

/**
 * Lo mismo contra VARIAS columnas de teléfono de una ficha. Una ficha de entidad tiene
 * `telefono`, `telefono2` y `telefono3`; una de productor, `phone` y `telefono_alt` —que es
 * justo donde el import de ARA dejó los números extra que venían en la misma celda—. Mirar
 * solo la primera era la otra mitad de la deuda §12.91.
 */
export function algunTelefonCoincideix(
  camps: (string | null | undefined)[],
  nou: string | null | undefined,
): boolean {
  return camps.some((c) => mateixTelefon(c, nou));
}

/**
 * Con qué fuerza coincide el teléfono de una ficha: por su columna principal, solo por una
 * secundaria, o nada. **La columna principal manda**: si el número está en las dos, esto es
 * una coincidencia de las de siempre y se comporta como siempre.
 */
export function motiuTelefon(
  principal: string | null | undefined,
  secundaris: (string | null | undefined)[],
  nou: string | null | undefined,
): MotiuCoincidencia | null {
  if (mateixTelefon(principal, nou)) return "telefon";
  if (algunTelefonCoincideix(secundaris, nou)) return "telefon_secundari";
  return null;
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

/**
 * `email` manda sobre `telefon`: es el dato que la persona ha tecleado entero. Solo se
 * llama sobre fichas FUERTES, así que `telefon_secundari` no puede salir de aquí — y por
 * eso el tipo de retorno es `MotiuFort`: que el compilador lo sostenga, no un comentario.
 */
function campPrincipal(per: MotiuCoincidencia[]): MotiuFort {
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

  // ⚠️ SOLO LAS COINCIDENCIAS FUERTES PUEDEN DENEGAR. Las débiles no se tiran —van en la
  // nota, que es lo que el equipo lee para decidir— pero no abren ninguno de los dos
  // caminos de abajo: si todo lo que hay es un teléfono secundario, esto acaba en
  // `paper_nou` y el alta sigue. Ver `esForta()`.
  const fortes = fitxes.filter((f) => esForta(f.per));

  const mateixTipus = fortes.filter((f) => f.tipus === rol);
  if (mateixTipus.length > 0) {
    const fitxa = mateixTipus.find((f) => f.per.includes("email")) ?? mateixTipus[0];
    return { cas: "duplicat", camp: campPrincipal(fitxa.per), fitxa };
  }

  // Ninguna ficha del mismo tipo ha casado, pero la organización de alguna puede tener ya
  // ese papel con otro correo y otro teléfono. Es un duplicado igual — siempre que quien
  // haya traído hasta esa organización sea una coincidencia fuerte: si la cadena entera
  // arranca de una centralita compartida, lo que hay es una sospecha, no un duplicado.
  const orgsFortes = new Set(fortes.map((f) => f.organitzacio).filter((x): x is string => !!x));
  const ocupades = organitzacions.filter((o) => orgsFortes.has(o.id) && teFitxaDeltipus(o, rol));
  if (ocupades.length > 0) {
    const fitxa = fortes.find((f) => f.organitzacio === ocupades[0].id) ?? fortes[0];
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
const PARAULA_MOTIU: Record<MotiuCoincidencia, string> = {
  email: "correu",
  telefon: "telefon",
  telefon_secundari: "telefon secundari",
};

export function notaPaperNou(fitxes: FitxaCoincident[], dataISO: string): string {
  const dia = dataISO.slice(0, 10);
  const ordre: MotiuCoincidencia[] = ["email", "telefon", "telefon_secundari"];
  const linies = fitxes.map((f) => {
    const quin = f.tipus === "productor" ? "productor" : "entitat";
    const nom = f.nom ? `«${f.nom}»` : "sense nom";
    const per = ordre.filter((m) => f.per.includes(m)).map((m) => PARAULA_MOTIU[m]).join(" i ");
    return `· fitxa de ${quin} ${nom} (coincideix el ${per})`;
  });

  // Si NADA fuerte la sostiene, hay que decirlo: el equipo tiene que saber que lo único que
  // hay es un número compartido, que es corriente entre organizaciones distintas del mismo
  // pueblo —una centralita, el fijo de un local— y no prueba nada por sí solo. Sin esta
  // línea, la nota se lee igual que la de una coincidencia de correo.
  const feble = fitxes.length > 0 && !fitxes.some((f) => esForta(f.per));

  return [
    `[${dia}] POSSIBLE MATEIXA ORGANITZACIO (registre public)`,
    ...linies,
    ...(feble
      ? [
        "ATENCIO: nomes coincideix un telefon SECUNDARI (centraleta, fix compartit, contacte",
        "d'una altra persona). Es una senyal feble: pot ser perfectament una altra organitzacio.",
      ]
      : []),
    "Cal decidir si es la mateixa organitzacio abans d'aprovar l'acces. La fitxa s'ha creat",
    "SENSE enllacar amb cap organitzacio: enllacar-la es una decisio de l'equip.",
  ].join("\n");
}
