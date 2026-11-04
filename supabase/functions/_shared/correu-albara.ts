// El correo de «Envia per correu» del albarán (04-11-2026): el PDF adjunto y, si a esa parte
// todavía le falta confirmar los kilos, el botón para hacerlo (`/confirmar/:token`). Es un
// envío MANUAL (§8, `_shared/enviamentManual.ts`): lo lanza el equipo con un botón.
//
// Puro (sin red ni Deno) para que Vitest lo pueda probar. Solo decide QUÉ se dice.

export type Idioma = "ca" | "es";

export interface AlbaraPerEnviar {
  tipo: string; // REC · ENT · OPE (y R-*)
  numero: string | null;
  idioma: string | null;
  /** `recibe` (entidad receptora) o `entrega` (productor). */
  rol: string;
  nom: string | null;
  /** La URL de confirmación, solo si a esta parte le falta confirmar. */
  urlConfirmar: string | null;
  /** La URL del panel, para el botón cuando no hay nada que confirmar. */
  urlPanell: string;
}

export interface CorreuAlbara {
  assumpte: string;
  titol: string;
  preheader: string;
  cosHtml: string;
  boto: { texto: string; url: string };
  nota: string;
  fitxer: string;
  idioma: Idioma;
}

function escapa(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Qué albarán es, en palabras, según el tipo y la parte que lo recibe. */
function quin(tipo: string, ca: boolean): string {
  const t = tipo.replace(/^R-/, "");
  if (t === "REC") return ca ? "l’albarà de recollida" : "el albarán de recogida";
  if (t === "OPE") return ca ? "l’albarà de l’operació" : "el albarán de la operación";
  return ca ? "l’albarà d’entrega" : "el albarán de entrega";
}

export function composaCorreuAlbara(d: AlbaraPerEnviar): CorreuAlbara {
  const idioma: Idioma = d.idioma === "es" ? "es" : "ca";
  const ca = idioma === "ca";
  const num = d.numero ?? "";
  const numHtml = escapa(num);
  const nom = (d.nom ?? "").trim();
  const salutacio = nom ? `Hola ${escapa(nom)},` : "Hola,";
  const que = quin(d.tipo, ca);
  const confirmar = d.urlConfirmar !== null;

  const cos = confirmar
    ? (ca
      ? `T’enviem ${que} <strong>${numHtml}</strong> en PDF. Amb el botó pots confirmar els quilos o fer constar qualsevol incidència. És un minut i no cal tenir compte.`
      : `Te enviamos ${que} <strong>${numHtml}</strong> en PDF. Con el botón puedes confirmar los kilos o hacer constar cualquier incidencia. Es un minuto y no hace falta cuenta.`)
    : (ca
      ? `T’enviem ${que} <strong>${numHtml}</strong> en PDF, per als teus registres.`
      : `Te enviamos ${que} <strong>${numHtml}</strong> en PDF, para tus registros.`);

  return {
    idioma,
    assumpte: ca ? `Albarà ${num} · Redestina` : `Albarán ${num} · Redestina`,
    titol: ca ? `Albarà ${num}` : `Albarán ${num}`,
    preheader: (cos.replace(/<[^>]+>/g, "")).slice(0, 120),
    cosHtml: `<p style="margin:0 0 12px">${salutacio}</p><p style="margin:0">${cos}</p>`,
    boto: confirmar
      ? { texto: ca ? "Confirma els quilos" : "Confirma los kilos", url: d.urlConfirmar as string }
      : { texto: ca ? "Entra al teu panell" : "Entra en tu panel", url: d.urlPanell },
    nota: confirmar
      ? (ca
        ? "L’enllaç és personal i caduca. Si et caduca, demana’ns-en un de nou."
        : "El enlace es personal y caduca. Si te caduca, pídenos uno nuevo.")
      : (ca
        ? "També el tens al teu panell de Redestina, a l’apartat de documents."
        : "También lo tienes en tu panel de Redestina, en el apartado de documentos."),
    fitxer: `${(num || "albara").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`,
  };
}
