// El correo de «oferta registrada», sin red ni Deno. Módulo «hoja» (27-10-2026): lo compone
// `correu-oferta.ts` para enviarlo y lo importa el panel del equipo para enseñarlo y copiarlo
// cuando el correo está apagado (R4 del plan de gestión autónoma: un solo texto). Lo vigila
// `tests/puresa.test.ts`.

export interface CorreuOfertaRegistrada {
  assumpte: string;
  titol: string;
  preheader: string;
  salutacio: string;
  /** La frase hasta la referencia; en el HTML la referencia va en negrita. */
  registrat: string;
  referencia: string;
  seguiment: string;
  boto: string;
  /** Ruta de la aplicación a la que lleva el botón. */
  ruta: string;
}

export function textCorreuOfertaRegistrada(
  nom: string | null | undefined,
  idExcedente: string,
  producte: string,
  estado = "publicada",
): CorreuOfertaRegistrada {
  return {
    assumpte: `Oferta registrada: ${idExcedente}`,
    titol: "Hem registrat la teva oferta",
    preheader: `Referència ${idExcedente}`,
    salutacio: `Hola ${nom ?? ""},`,
    registrat: `Hem registrat la teva oferta${producte ? ` de ${producte}` : ""} amb la referència`,
    referencia: idExcedente,
    seguiment: estado === "pendent_validacio"
      ? "L'equip de Redestina la revisarà i, un cop validada, buscarà qui la pugui aprofitar. En pots seguir l'estat al teu panell, a «Les meves ofertes»."
      : "L'equip de Redestina buscarà qui la pugui aprofitar. En pots seguir l'estat al teu panell, a «Les meves ofertes».",
    boto: "Veure les meves ofertes",
    ruta: "/productor/ofertes",
  };
}

/** El mismo correo en texto plano, para copiarlo. */
export function textPlaCorreuOfertaRegistrada(c: CorreuOfertaRegistrada, appUrl: string): string {
  return [c.salutacio, "", `${c.registrat} ${c.referencia}.`, "", c.seguiment, "", `${appUrl}${c.ruta}`].join("\n");
}
