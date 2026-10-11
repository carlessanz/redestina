// Lo puro del expediente de prevención (fase 11): la comparativa anual de la cuantificación
// y el avance de las acciones. Sin Deno ni red.
//
// ⚠️ HAY UNA COPIA en `src/lib/expedient.ts` (la usa la pantalla) y `tests/expedient.test.ts`
//    comprueba que las dos dan lo mismo: el PDF y la pantalla no pueden contar cifras
//    distintas del mismo expediente (precedente: `modalitats.ts`).

export type CategoriaQuant = "perdua" | "excedent" | "residu";

export interface FilaQuant {
  mes: string;
  kg: number | string;
  categoria: CategoriaQuant | string;
}

export interface AnyQuant {
  any: number;
  perdua: number;
  excedent: number;
  residu: number;
  total: number;
  /** % respecto al año anterior (null en el primero o si el anterior es 0) */
  variacio: number | null;
}

/** Totales por año y categoría, del año más antiguo al más reciente, con la variación. */
export function comparativaAnual(files: FilaQuant[]): AnyQuant[] {
  const per = new Map<number, AnyQuant>();
  for (const f of files) {
    const any = Number(String(f.mes).slice(0, 4));
    if (!Number.isFinite(any) || any < 1900) continue;
    const kg = Number(f.kg) || 0;
    const a = per.get(any) ?? { any, perdua: 0, excedent: 0, residu: 0, total: 0, variacio: null };
    if (f.categoria === "perdua" || f.categoria === "excedent" || f.categoria === "residu") {
      a[f.categoria] += kg;
    }
    a.total += kg;
    per.set(any, a);
  }
  const anys = [...per.values()].sort((x, y) => x.any - y.any);
  for (let i = 1; i < anys.length; i++) {
    const ant = anys[i - 1].total;
    anys[i].variacio = ant > 0 ? Math.round(((anys[i].total - ant) / ant) * 1000) / 10 : null;
  }
  return anys;
}

/** Cuántas acciones están hechas, sobre las que cuentan (las descartadas no). */
export function avancAccions(accions: { estat: string }[]): { fetes: number; total: number; pct: number } {
  const compten = accions.filter((a) => a.estat !== "descartada");
  const fetes = compten.filter((a) => a.estat === "feta").length;
  const total = compten.length;
  return { fetes, total, pct: total === 0 ? 0 : Math.round((fetes / total) * 100) };
}
