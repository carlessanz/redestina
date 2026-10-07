// Los enlaces sin usar a 7 y 14 días (primer bloque): qué toca avisar y cómo se cuenta al
// equipo. Separado de `index.ts` el 07-10-2026 sin cambiar una línea de lógica.

// Los colores salen de `resend.ts`: un hex a mano aquí es un sitio donde un cambio de
// token no llegaría, y además se cuela un color que el sistema no tiene (§9bis).
import { BORDE, CORAL, CORAL_SUAVE, escaparHtml, SUAVE, VERDE } from "../_shared/resend.ts";

// Sin tipos generados de la base: anotar el cliente con `ReturnType<typeof createClient>`
// resuelve el esquema a `never` (misma nota que en `generar-documento` y `_shared/gate.ts`).
// deno-lint-ignore no-explicit-any
export type Cliente = any;

export const APP_URL = (Deno.env.get("APP_URL") ?? "https://redestina.carlessanz.com")
  .replace(/\/$/, "");

export const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Los hitos, por posición: con `recordatorios = 0` toca a los 7 días; con 1, a los 14;
 * con 2 se acabó (a partir de ahí el enlace es material de llamada, no de correo, y
 * `recordatorios >= 2` es justo el filtro de la bandeja del equipo).
 */
export const HITOS_DIAS = [7, 14] as const;
/** Los avisos de factura pendiente al donante (segundo bloque). Ver dónde se usa. */
export const RECORDA_FACTURES = false;

/**
 * Dos avisos del mismo enlace no pueden ir seguidos. El caso que esto evita no es el
 * cron diario —entre el hito 7 y el 14 pasa una semana— sino el de recuperación: si
 * el job no corre durante quince días, al volver un enlace cumple los dos hitos a la
 * vez y se avisaría dos veces en la misma mañana. Con esto, el segundo espera a
 * mañana. 20 h y no 24 para que el propio cron diario no se pise por unos segundos.
 */
export const MIN_ENTRE_AVISOS_MS = 20 * 60 * 60 * 1000;

/** Candidatos que se traen de la base en una ejecución. */
export const LIMITE_CONSULTA = 200;

/**
 * Tope de enlaces escalados por ejecución. El gate `esEmailTest()` son dos consultas
 * por destinatario distinto, y una acumulación grande (el job parado una temporada)
 * no debe convertir una ejecución en cientos de idas y venidas a la base. A ritmo
 * diario, 50 es muy superior a cualquier volumen real de Redestina; lo que sobra
 * espera a mañana, que para un recordatorio es intrascendente.
 */
export const MAX_POR_EJECUCION = 50;

/**
 * La pantalla del panel donde se resuelve cada cosa. Es lo que convierte el aviso en algo
 * accionable: el correo NO puede llevar el enlace original —de `enlaces_token` solo se
 * guarda el hash— pero sí puede llevar a quien lee al sitio exacto donde se revoca y se
 * reenvía (`enviar_convenio()` emite uno nuevo y revoca el anterior; `marcar_entregado()`
 * vuelve a crear los de confirmación). Sin esto, el recordatorio decía «hay algo
 * pendiente» y dejaba al equipo buscándolo a mano (deudas §12.57 y §12.74).
 */
export function enlacePanel(objetoTipo: string, objetoId: string): string | null {
  if (objetoTipo === "convenio") return `${APP_URL}/equip/convenis/${objetoId}`;
  if (objetoTipo === "albaran") return `${APP_URL}/equip/albarans/${objetoId}`;
  return null;
}

/** Qué hay que hacer con cada tipo de enlace, dicho en una línea. */
export const ACCION_TEXTO: Record<string, string> = {
  firma_convenio: "Reenviar (revoca l'anterior) o signatura assistida",
  confirmacion_albaran: "Reenviar o confirmar des del panell",
};

export interface FilaEnlace {
  id: string;
  proposito: string;
  objeto_tipo: string;
  objeto_id: string;
  destinatario_email: string | null;
  destinatario_nombre: string | null;
  canal: string;
  caduca_at: string;
  recordatorios: number;
  ultimo_recordatorio_at: string | null;
  created_at: string;
}

export type Motivo =
  | "hito_no_vencut" // todavía no le toca (o ya agotó los dos avisos)
  | "avis_massa_recent" // se avisó hace menos de MIN_ENTRE_AVISOS_MS
  | "sense_destinatari" // sin correo (canal 'asistido') y modo test activo
  | "no_test_user" // modo test activo y el destinatario no es es_test
  | "limit_execucio" // pasó del tope de esta ejecución
  | "sense_email_equip" // `parametros_documentales.email_equipo` está vacío
  | "error_email" // Resend no aceptó el resumen
  | "sense_enllac_factura" // la factura no tiene enlace del que contar los días
  | "sense_destinatari_donant" // `cierre_destinatario()` no puede decidir a quién escribir
  | "mode_prova_bloqueja"; // cierre de prueba y el destinatario no es es_test ni el equipo

export type Resultado =
  | { toca: true; hito: number; dias: number }
  | { toca: false; motivo: "hito_no_vencut" | "avis_massa_recent" };

/**
 * ¿Le toca aviso a este enlace? Función **pura**: no mira la red ni el reloj del
 * sistema (el instante entra por parámetro), así que se puede probar sola. Mismo
 * criterio que `priorizacion.ts` y `canal.ts`.
 */
export function tocaAviso(
  fila: Pick<FilaEnlace, "recordatorios" | "created_at" | "ultimo_recordatorio_at">,
  ahoraMs: number,
): Resultado {
  const idx = fila.recordatorios;
  // Ya gastó los dos avisos (o llegó un valor imposible): no le toca nada más.
  if (idx < 0 || idx >= HITOS_DIAS.length) return { toca: false, motivo: "hito_no_vencut" };
  const hito = HITOS_DIAS[idx];

  const dias = (ahoraMs - Date.parse(fila.created_at)) / DIA_MS;
  if (!(dias >= hito)) return { toca: false, motivo: "hito_no_vencut" };

  if (fila.ultimo_recordatorio_at) {
    const desde = ahoraMs - Date.parse(fila.ultimo_recordatorio_at);
    if (desde < MIN_ENTRE_AVISOS_MS) return { toca: false, motivo: "avis_massa_recent" };
  }
  return { toca: true, hito, dias: Math.floor(dias) };
}

export const PROPOSITO_TEXTO: Record<string, string> = {
  firma_convenio: "Signatura de conveni",
  confirmacion_albaran: "Confirmació d'albarà",
  subida_factura: "Pujada de factura",
};

export const OBJETO_TEXTO: Record<string, string> = {
  albaran: "Albarà",
  convenio: "Conveni",
  cierre_donante: "Tancament de donant",
};

/** Días que le quedan de vida al enlace (nunca negativos: los vencidos ni se traen). */
export function diasParaCaducar(caducaAt: string, ahoraMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(caducaAt) - ahoraMs) / DIA_MS));
}

export interface Vencido {
  fila: FilaEnlace;
  hito: number;
  dias: number;
}

/**
 * Cómo se llama el objeto que espera respuesta, para que el equipo sepa CUÁL es sin
 * abrirlo. Antes el resumen imprimía los ocho primeros caracteres del uuid, que no
 * identifica nada: un albarán se conoce por su número (`ENT-2026-00042`) y un convenio
 * pendiente de firma **todavía no tiene número** —se pide al firmar—, así que ahí lo que
 * identifica es el tipo y la organización.
 */
export interface Identificacion {
  numero: string | null;
  etiqueta: string | null;
}

export const CONVENIO_TEXTO: Record<string, string> = {
  don_gen: "Conveni de donació · generador",
  don_rec: "Conveni de donació · receptor",
  com: "Conveni comercial",
};

export async function identificar(
  supabase: Cliente,
  vencidos: Vencido[],
): Promise<Map<string, Identificacion>> {
  const mapa = new Map<string, Identificacion>();
  const porTipo = (tipo: string) =>
    [...new Set(vencidos.filter((v) => v.fila.objeto_tipo === tipo).map((v) => v.fila.objeto_id))];

  const albaranes = porTipo("albaran");
  const convenios = porTipo("convenio");

  // Dos consultas como mucho por ejecución, y solo si hay algo que avisar.
  if (albaranes.length > 0) {
    // La lista de columnas, en UN literal (§7, deuda 46).
    const { data, error } = await supabase
      .from("albaranes")
      .select("id, tipo, numero_completo, estado")
      .in("id", albaranes);
    if (error) console.warn("recordatorios-documentales: albaranes:", error.message);
    for (const a of (data ?? []) as { id: string; tipo: string; numero_completo: string | null }[]) {
      mapa.set(a.id, { numero: a.numero_completo, etiqueta: `Albarà ${a.tipo}` });
    }
  }
  if (convenios.length > 0) {
    const { data, error } = await supabase
      .from("convenios")
      .select("id, tipo, numero_completo, estado")
      .in("id", convenios);
    if (error) console.warn("recordatorios-documentales: convenios:", error.message);
    for (const c of (data ?? []) as { id: string; tipo: string; numero_completo: string | null }[]) {
      mapa.set(c.id, { numero: c.numero_completo, etiqueta: CONVENIO_TEXTO[c.tipo] ?? "Conveni" });
    }
  }
  return mapa;
}

/**
 * El resumen que se manda al equipo. Todo lo que viene de la base va escapado.
 *
 * Cada fila lleva **el enlace a la pantalla donde se resuelve**, no el enlace de firma
 * —ese no se puede reconstruir— y **el número del documento**, no un trozo de uuid. Es
 * lo que hace que el aviso se pueda accionar sin buscar nada a mano.
 */
export function cuerpoResumen(
  vencidos: Vencido[],
  ahoraMs: number,
  ids: Map<string, Identificacion>,
  limitados: number,
): string {
  const filas = vencidos.map((v) => {
    const destinatario = v.fila.destinatario_email
      ? escaparHtml(v.fila.destinatario_nombre ?? v.fila.destinatario_email)
      : `${escaparHtml(v.fila.destinatario_nombre ?? "—")} <em>(assistit)</em>`;
    const correo = v.fila.destinatario_email
      ? `<br><span style="color:${SUAVE}">${escaparHtml(v.fila.destinatario_email)}</span>`
      : "";
    const id = ids.get(v.fila.objeto_id);
    // El número si lo tiene; si no (un conveni en `pendent_firma` todavía no lo tiene:
    // se pide al firmar), el tipo. El uuid corto se queda como último recurso.
    const queEs = escaparHtml(
      id?.numero ?? id?.etiqueta ?? OBJETO_TEXTO[v.fila.objeto_tipo] ?? v.fila.objeto_tipo,
    );
    const url = enlacePanel(v.fila.objeto_tipo, v.fila.objeto_id);
    const accion = escaparHtml(ACCION_TEXTO[v.fila.proposito] ?? "Obre'l al panell");
    const boton = url
      ? `<a href="${url}" style="color:${VERDE};font-weight:600;text-decoration:underline">Obre i reenvia</a>
         <br><span style="color:${SUAVE};font-size:12px">${accion}</span>`
      : `<span style="color:${SUAVE}">${accion}</span>`;
    return `<tr style="border-top:1px solid ${BORDE}">
      <td style="padding:8px 10px;vertical-align:top">${destinatario}${correo}</td>
      <td style="padding:8px 10px;vertical-align:top">${
      escaparHtml(PROPOSITO_TEXTO[v.fila.proposito] ?? v.fila.proposito)
    }<br><span style="color:${SUAVE}">${queEs}</span></td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${v.dias} dies</td>
      <td style="padding:8px 10px;vertical-align:top;white-space:nowrap">${
      diasParaCaducar(v.fila.caduca_at, ahoraMs)
    } dies</td>
      <td style="padding:8px 10px;vertical-align:top">${boton}</td>
    </tr>`;
  }).join("\n");

  const n = vencidos.length;
  // El tope de la ejecución, DICHO (deuda §12.58). Antes solo se veía en `motivos`, o sea
  // en ningún sitio que alguien mire: quien lee el correo daba por hecho que la lista
  // estaba completa.
  const recorte = limitados > 0
    ? `<p style="margin:0 0 14px;padding:10px 12px;background:${CORAL_SUAVE};border-left:3px solid ${CORAL}">
        <strong>La llista està retallada.</strong> Hi ha ${limitados} enllaç${
      limitados === 1 ? "" : "os"
    } més que també toquen avui i que s'han deixat per demà
        (el màxim per execució és ${MAX_POR_EJECUCION}).</p>`
    : "";

  return `${recorte}<p style="margin:0 0 14px">${
    n === 1
      ? "Hi ha <strong>1 enllaç</strong> que"
      : `Hi ha <strong>${n} enllaços</strong> que`
  } ${n === 1 ? "porta" : "porten"} 7 o 14 dies sense fer-se servir.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px">
  <tr style="text-align:left;color:${SUAVE};font-size:12px;text-transform:uppercase;letter-spacing:.5px">
    <th style="padding:0 10px 6px">Destinatari</th>
    <th style="padding:0 10px 6px">Què espera</th>
    <th style="padding:0 10px 6px">Enviat fa</th>
    <th style="padding:0 10px 6px">Caduca en</th>
    <th style="padding:0 10px 6px">Resoldre</th>
  </tr>
  ${filas}
</table>`;
}
