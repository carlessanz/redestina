// Las facturas pendientes del cierre anual (segundo bloque). Separado de `index.ts` el
// 07-10-2026 sin cambiar una línea de lógica.

import { destinatariosPrueba, esEmailTest } from "../_shared/gate.ts";
import { BORDE, CORAL, CORAL_SUAVE, escaparHtml, SUAVE, VERDE } from "../_shared/resend.ts";
import {
  APP_URL,
  type Cliente,
  HITOS_DIAS,
  LIMITE_CONSULTA,
  MAX_POR_EJECUCION,
  type Motivo,
  tocaAviso,
} from "./enllacos.ts";

// ---------------------------------------------------------------------------
// Las facturas pendientes (fase 4)
// ---------------------------------------------------------------------------

export interface FilaCierreDonante {
  id: string;
  cierre_id: string;
  estado: string;
  kg_total: number | null;
  valor_total: number | null;
  resumen_numero: string | null;
  recordatorios: number;
  ultimo_recordatorio_at: string | null;
  requiere_llamada: boolean;
}

export interface FacturaPendiente {
  cd: FilaCierreDonante;
  hito: number;
  dias: number;
  email: string;
  nombre: string;
  /** El destinatario NO es el donante: es el buzón del equipo (modo prueba). */
  forzado: boolean;
  motivoDestinatario: string;
  numero: string | null;
  importe: number | null;
  kg: number | null;
  ejercicio: number | null;
  modo: string;
  caducaAt: string | null;
}

/** `850` → `850,00 €`, sin `Intl` (misma razón que en `_shared/pdf/lletres.ts`). */
export function eur(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !isFinite(valor)) return "—";
  const [entera, decimal] = Math.abs(valor).toFixed(2).split(".");
  const conMillares = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${valor < 0 ? "-" : ""}${conMillares},${decimal} €`;
}

/**
 * Los donantes a los que hoy les toca aviso porque su factura sigue sin llegar.
 *
 * Tres cosas que decide esta función y conviene tener juntas:
 *
 *   · **De dónde se cuentan los días.** No de `cierres_donante` —que no guarda cuándo se
 *     mandó el resumen— sino del `enlaces_token` de propósito `subida_factura`, que crea
 *     `emitir_resumen()` en la misma transacción. Sin enlace no hay reloj y se salta:
 *     avisar de una factura que nunca se pidió sería avisar de nada.
 *   · **A quién se escribe.** Lo dice `cierre_destinatario()`, la MISMA función que usó la
 *     emisión, y no un `productores.email` leído aquí: en modo prueba nunca devuelve el
 *     correo de un donante real. Si no puede decidir (donante sin correo en un cierre
 *     real), se salta y el equipo lo verá en la bandeja.
 *   · **Qué gates se aplican.** Los dos: el modo test global (§8) y, si el cierre es de
 *     prueba, `destinatariosPrueba()` —que no mira `test_mode` a propósito—. Un ensayo del
 *     cierre no puede escribirle a un donante de verdad ni el día que Redestina esté en
 *     producción con el modo test apagado.
 */
export async function facturasPendientes(
  supabase: Cliente,
  ahoraMs: number,
  modoTest: boolean,
  salta: (m: Motivo) => void,
): Promise<{ pendientes: FacturaPendiente[]; revisadas: number; limitadas: number }> {
  // La lista de columnas, en UN literal (§7, deuda 46).
  const { data, error } = await supabase
    .from("cierres_donante")
    .select(
      "id, cierre_id, estado, kg_total, valor_total, resumen_numero, recordatorios, ultimo_recordatorio_at, requiere_llamada",
    )
    .eq("estado", "factura_pendent")
    .lt("recordatorios", HITOS_DIAS.length)
    .order("id", { ascending: true })
    .limit(LIMITE_CONSULTA);

  if (error) {
    console.error("recordatorios-documentales: select cierres_donante:", error.message);
    return { pendientes: [], revisadas: 0, limitadas: 0 };
  }
  const candidatas = (data ?? []) as FilaCierreDonante[];
  if (candidatas.length === 0) return { pendientes: [], revisadas: 0, limitadas: 0 };

  // El reloj: el enlace de subida vivo de cada donante.
  const { data: enlaces } = await supabase
    .from("enlaces_token")
    .select("id, proposito, objeto_tipo, objeto_id, estado, created_at, caduca_at, usado_at")
    .eq("proposito", "subida_factura")
    .eq("objeto_tipo", "cierre_donante")
    .eq("estado", "activo")
    .in("objeto_id", candidatas.map((c) => c.id));
  const reloj = new Map<string, { created_at: string; caduca_at: string }>();
  for (const e of (enlaces ?? []) as { objeto_id: string; created_at: string; caduca_at: string }[]) {
    reloj.set(e.objeto_id, { created_at: e.created_at, caduca_at: e.caduca_at });
  }

  // El ejercicio y el modo, por cierre.
  const { data: cierres } = await supabase
    .from("cierres_ejercicio")
    .select("id, ejercicio, modo, estado")
    .in("id", [...new Set(candidatas.map((c) => c.cierre_id))]);
  const porCierre = new Map<string, { ejercicio: number | null; modo: string }>();
  for (const c of (cierres ?? []) as { id: string; ejercicio: number | null; modo: string }[]) {
    porCierre.set(c.id, { ejercicio: c.ejercicio, modo: c.modo });
  }

  const pendientes: FacturaPendiente[] = [];
  let limitadas = 0;
  for (const cd of candidatas) {
    const enlace = reloj.get(cd.id);
    if (!enlace) {
      salta("sense_enllac_factura");
      continue;
    }
    const r = tocaAviso(
      {
        recordatorios: cd.recordatorios,
        created_at: enlace.created_at,
        ultimo_recordatorio_at: cd.ultimo_recordatorio_at,
      },
      ahoraMs,
    );
    if (!r.toca) {
      salta(r.motivo);
      continue;
    }
    if (pendientes.length >= MAX_POR_EJECUCION) {
      limitadas++;
      salta("limit_execucio");
      continue;
    }

    const cierre = porCierre.get(cd.cierre_id) ?? { ejercicio: null, modo: "prueba" };

    // A quién: lo decide SQL, como en la emisión.
    const { data: dest, error: errDest } = await supabase
      .rpc("cierre_destinatario", { p_cd: cd.id });
    const destino = (dest ?? {}) as Record<string, unknown>;
    const email = String(destino.email ?? "").trim();
    if (errDest || !email) {
      if (errDest) console.warn("recordatorios-documentales: cierre_destinatario:", errDest.message);
      salta("sense_destinatari_donant");
      continue;
    }

    // Barrera del cierre de prueba: independiente de `test_mode` (§8, `gate.ts`).
    const barrera = await destinatariosPrueba(
      supabase,
      { modo: cierre.modo, tipo: "RES", numero_completo: cd.resumen_numero, envio: { destinatario: email } },
      [email],
    );
    if (barrera.permitidos.length === 0) {
      salta("mode_prova_bloqueja");
      continue;
    }

    // Y el gate de test global, salvo que el destinatario sea el propio buzón del equipo
    // (mismo criterio que en el resto del circuito: ese buzón recibe siempre).
    if (modoTest && !destino.forcat && !(await esEmailTest(supabase, email))) {
      salta("no_test_user");
      continue;
    }

    pendientes.push({
      cd,
      hito: r.hito,
      dias: r.dias,
      email,
      nombre: String(destino.nom ?? ""),
      forzado: destino.forcat === true,
      motivoDestinatario: String(destino.motiu ?? ""),
      numero: cd.resumen_numero,
      importe: cd.valor_total,
      kg: cd.kg_total,
      ejercicio: cierre.ejercicio,
      modo: cierre.modo,
      caducaAt: enlace.caduca_at,
    });
  }

  return { pendientes, revisadas: candidatas.length, limitadas };
}

/** El correo al donante. Todo lo que viene de la base va escapado. */
export function cuerpoFactura(f: FacturaPendiente): string {
  const prova = f.modo === "prueba"
    ? `<p style="margin:0 0 14px;color:${SUAVE}"><strong>Aquest és un tancament de prova</strong> (${
      escaparHtml(f.motivoDestinatario)
    }): no cal fer res.</p>`
    : "";
  return `${prova}<p style="margin:0 0 14px">Fa <strong>${f.dias} dies</strong> que et vam enviar el resum anual
${escaparHtml(f.numero ?? "")} de l'exercici ${f.ejercicio ?? ""} i encara no ens ha arribat la teva factura.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px;margin:0 0 14px">
  <tr><td style="padding:4px 0;color:${SUAVE}">Import</td><td style="padding:4px 0;text-align:right"><strong>${
    eur(f.importe)
  }</strong></td></tr>
  <tr><td style="padding:4px 0;color:${SUAVE}">Quilos</td><td style="padding:4px 0;text-align:right">${
    f.kg === null ? "—" : `${f.kg} kg`
  }</td></tr>
</table>
<p style="margin:0 0 14px">Pots pujar-la des de l'enllaç que t'enviàvem amb el resum —encara és vàlid— o
des de <strong>Els meus documents</strong> al teu panell, amb el botó d'aquest correu.
Si has perdut l'enllaç, respon a aquest correu i te'n fem arribar un de nou.</p>`;
}

/** La segunda tabla del resumen del equipo. */
export function cuerpoFacturas(facturas: FacturaPendiente[], limitadas: number): string {
  const filas = facturas.map((f) =>
    `<tr style="border-top:1px solid ${BORDE}">
      <td style="padding:8px 10px;vertical-align:top">${escaparHtml(f.nombre || "—")}<br>
        <span style="color:${SUAVE}">${escaparHtml(f.email)}</span></td>
      <td style="padding:8px 10px;vertical-align:top">${escaparHtml(f.numero ?? "—")}<br>
        <span style="color:${SUAVE}">exercici ${f.ejercicio ?? ""}${
      f.modo === "prueba" ? " · prova" : ""
    }</span></td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap;text-align:right">${eur(f.importe)}</td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${f.dias} dies</td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${
      f.hito >= HITOS_DIAS[HITOS_DIAS.length - 1] ? "Cal trucar" : "Avisat"
    }</td>
      <td style="padding:8px 10px;vertical-align:top"><a href="${APP_URL}/equip/tancament/${
      encodeURIComponent(f.cd.cierre_id)
    }" style="color:${VERDE};font-weight:600;text-decoration:underline">Obre el tancament</a></td>
    </tr>`
  ).join("\n");

  const n = facturas.length;
  const recorte = limitadas > 0
    ? `<p style="margin:18px 0 0;padding:10px 12px;background:${CORAL_SUAVE};border-left:3px solid ${CORAL}">
        <strong>La llista de factures està retallada</strong>: ${limitadas} més toquen avui i s'han deixat per demà
        (el màxim per execució és ${MAX_POR_EJECUCION}).</p>`
    : "";
  return `${recorte}<p style="margin:18px 0 14px">${
    n === 1 ? "Hi ha <strong>1 factura</strong> pendent" : `Hi ha <strong>${n} factures</strong> pendents`
  } del tancament anual. Al donant ja se li ha escrit.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px">
  <tr style="text-align:left;color:${SUAVE};font-size:12px;text-transform:uppercase;letter-spacing:.5px">
    <th style="padding:0 10px 6px">Donant</th>
    <th style="padding:0 10px 6px">Resum</th>
    <th style="padding:0 10px 6px;text-align:right">Import</th>
    <th style="padding:0 10px 6px">Enviat fa</th>
    <th style="padding:0 10px 6px">Estat</th>
    <th style="padding:0 10px 6px">Resoldre</th>
  </tr>
  ${filas}
</table>`;
}
