// La FRANJA de recogida (reunión del 05-10-2026): el productor no da una hora, da un intervalo
// —«de 9 a 12»—, y quien recoge elige dentro de él a qué hora irá.
//
// Hasta esa fecha `horari` era texto libre («10am», «matí»), así que no se podía comprobar nada
// ni avisar a nadie a una hora concreta. Ahora la oferta guarda además dos horas
// (`excedentes.hora_recollida_inici` y `_fi`, tipo `time`), y el texto se compone a partir de
// ellas. El panel las pide con desplegables (horas y cuartos); el bot de WhatsApp sigue
// preguntando en texto libre, y este módulo intenta leerlo: si lo entiende, rellena las horas;
// si no, el texto se guarda igual y el equipo lo ve tal cual. Es el mismo criterio que
// `parseDisponibleFins()` con la fecha.
//
// PURO y sin red, con pruebas en `tests/franja.test.ts`. Hay una copia mínima en
// `src/lib/franja.ts` para el panel (el navegador no importa Deno).

export interface Franja {
  /** «HH:MM», 24 h. */
  inici: string;
  /** «HH:MM», 24 h, estrictamente después de `inici`. */
  fi: string;
}

/** Las palabras que se entienden sin horas. Rangos amplios a propósito: es lo que se dice. */
const PARAULES: { re: RegExp; franja: Franja }[] = [
  { re: /\b(tot el dia|todo el dia|mati i tarda|mañana y tarde|manana y tarde)\b/, franja: { inici: "08:00", fi: "19:00" } },
  { re: /\b(mati|matins|mañana|mañanas|manana|mananas)\b/, franja: { inici: "08:00", fi: "13:00" } },
  { re: /\b(tarda|tardes|tarde)\b/, franja: { inici: "15:00", fi: "19:00" } },
];

function normalitza(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

/** «9», «9h», «9:30», «09.30», «9 h» → «09:30». null si no es una hora válida. */
export function horaDe(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?\s*h?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Minutos desde medianoche de una «HH:MM». */
export function minuts(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/** ¿Es una franja válida? Dos horas bien formadas y el final después del inicio. */
export function esFranjaValida(f: Partial<Franja> | null | undefined): f is Franja {
  if (!f?.inici || !f?.fi) return false;
  if (!horaDe(f.inici) || !horaDe(f.fi)) return false;
  return minuts(f.fi) > minuts(f.inici);
}

/**
 * Lo que el productor escribió, como franja, o null si no se entiende con seguridad.
 * Reconoce «de 9 a 12», «9-12», «9h-12h», «9:30 a 13:15», «entre 8 i 10», y las palabras
 * «matí», «tarda», «tot el dia» (y en castellano). Ante la duda, null: una franja inventada
 * acabaría en un aviso a una hora que nadie dijo.
 */
export function parseFranja(texto: unknown): Franja | null {
  if (typeof texto !== "string" || !texto.trim()) return null;
  const t = normalitza(texto);
  const m = t.match(/(\d{1,2}(?:\s*[:.h]\s*\d{2})?\s*h?)\s*(?:-|–|a|i|fins a|fins les|hasta|y)\s*(?:les\s+|las\s+)?(\d{1,2}(?:\s*[:.h]\s*\d{2})?\s*h?)/);
  if (m) {
    const inici = horaDe(m[1]);
    const fi = horaDe(m[2]);
    const f = inici && fi ? { inici, fi } : null;
    return esFranjaValida(f) ? f : null;
  }
  for (const p of PARAULES) if (p.re.test(t)) return { ...p.franja };
  return null;
}

/** «de 9:00 a 12:30». El texto que se guarda en `horari_recollida` y sale en la oferta. */
export function textFranja(f: Franja): string {
  const curta = (h: string) => h.replace(/^0(\d)/, "$1");
  return `de ${curta(f.inici)} a ${curta(f.fi)}`;
}

/**
 * Lo que llega en `datos.horari`, sea del panel nuevo (`{inici, fi}`), del panel viejo o del bot
 * (texto). Devuelve la franja si se puede saber, y el texto que se guarda en cualquier caso.
 */
export function llegeixHorari(valor: unknown): { franja: Franja | null; text: string | null } {
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    const v = valor as Partial<Franja>;
    const f = { inici: horaDe(String(v.inici ?? "")) ?? "", fi: horaDe(String(v.fi ?? "")) ?? "" };
    return esFranjaValida(f) ? { franja: f, text: textFranja(f) } : { franja: null, text: null };
  }
  if (typeof valor === "string" && valor.trim()) {
    return { franja: parseFranja(valor), text: valor.trim() };
  }
  return { franja: null, text: null };
}
