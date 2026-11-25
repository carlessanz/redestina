// Priorización de entidades para un excedente.
// POST { excedente_id } -> ranking de entidades candidatas con puntuación y motivos.
// POST { disponibilitat_id } -> lo mismo para una disponibilidad multiproducto (fase 6a,
//   25-11-2026): el ranking de cada oferta viva del grupo unido por entidad, con
//   `ofertes_encaixen` (en qué ofertas encaja cada una) y `ofertes` (las del grupo).
//
// No envía nada. Requiere sesión de Supabase Auth (mismo esquema que whatsapp-send:
// se despliega SIN --no-verify-jwt y además se comprueba getUser).

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  admesaPerNaturalesa, matriuReceptor, modalitatsAdmeses, priorizar, reglaNaturalesa, uneixRankings,
} from "../_shared/priorizacion.ts";
import type { EntidadPriorizable, ExcedenteContexto, OfertaDelGrup } from "../_shared/priorizacion.ts";
import { exigirEquipo } from "../_shared/autorizacion.ts";
import { type CanalPreferido, decidirCanal } from "../_shared/canal.ts";
import { preferenciasDeCanal } from "../_shared/organizacion.ts";
import { canalsActius, type CanalsActius, modoTestActivo } from "../_shared/gate.ts";
import { modalitatsDe } from "../_shared/modalitats.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";

/** Un número del perfil (jsonb), o null si no hay o no es un número. */
function numeroOuNull(v: unknown): number | null {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const json = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  // Sesión + equipo interno: el ranking devuelve nombre, población y teléfono de las
  // entidades candidatas, así que es información del equipo. La función corre con
  // service_role (BYPASSRLS): sin esta comprobación, cualquier cuenta lo obtendría.
  const auth = await exigirEquipo(supabase, req);
  if ("rechazo" in auth) {
    const { error, code, status } = auth.rechazo;
    return json({ error, code }, status);
  }

  try {
    const t0 = performance.now();
    const cos = await req.json();
    const excedente_id = cos?.excedente_id;
    const disponibilitat_id = cos?.disponibilitat_id;

    // ── Una DISPONIBILIDAD multiproducto (fase 6a, 25-11-2026) ──
    // El ranking de cada oferta viva del grupo (el de siempre) y, encima, la unión por entidad
    // (`uneixRankings()`): una entidad entra si encaja en alguna oferta del grupo, y
    // `ofertes_encaixen` dice en cuáles. Un solo mensaje por entidad, con `textDisponibilitat()`.
    if (disponibilitat_id !== undefined && disponibilitat_id !== null) {
      if (typeof disponibilitat_id !== "string" || !disponibilitat_id) {
        return json({ error: "'disponibilitat_id' no vàlid" }, 400);
      }
      const { data: disp, error: dErr } = await supabase
        .from("disponibilitats").select("id, codi, productor_id").eq("id", disponibilitat_id).maybeSingle();
      if (dErr) {
        console.error("disponibilitats select:", dErr.message);
        return json({ error: "Error consultando la disponibilitat" }, 500);
      }
      if (!disp) return json({ error: "Disponibilitat no trobada", code: "no_trobada" }, 404);
      const { data: files, error: fErr } = await supabase
        .from("excedentes")
        .select("id, id_excedente, familia, producto, variedad, kg_total, ubicacion_id, productor_id, modalitat, modalitats, estado, created_at")
        .eq("disponibilitat_id", disponibilitat_id)
        .order("created_at")
        .order("id_excedente");
      if (fErr) {
        console.error("excedentes select:", fErr.message);
        return json({ error: "Error consultando les ofertes" }, 500);
      }
      // Solo las que circulan: ni esborranys ni cerradas, cancelades o sin destino.
      const vives = ((files ?? []) as Excedent[]).filter((e) => !ESTATS_FORA_GRUP.has(e.estado ?? ""));
      if (vives.length === 0) {
        return json({ error: "Cap oferta del grup es pot prioritzar", code: "disponibilitat_sense_ofertes" }, 409);
      }
      const base = await carregaBase(supabase, json);
      if (base instanceof Response) return base;
      const perOferta: {
        oferta: OfertaDelGrup;
        ranking: Awaited<ReturnType<typeof rankingOferta>>["ranking"];
        contexto: ExcedenteContexto;
      }[] = [];
      for (const e of vives) {
        const r = await rankingOferta(supabase, base, e);
        perOferta.push({
          oferta: { excedente_id: e.id, id_excedente: e.id_excedente, producto: e.producto, modalitats: r.modalitats },
          ranking: r.ranking,
          contexto: r.contexto,
        });
      }
      const modalitats = [...new Set(perOferta.flatMap((p) => p.oferta.modalitats))];
      const ranking = uneixRankings(perOferta);
      console.log(`priorizar-entidades: disponibilitat ${disp.codi} (${vives.length} ofertes) en ${Math.round(performance.now() - t0)} ms`);
      return json({
        disponibilitat_id,
        codi: disp.codi,
        // Compatibilidad con quien lee la respuesta de una oferta: la PRIMERA del grupo.
        excedente_id: vives[0].id,
        contexto: perOferta[0].contexto,
        ofertes: vives.map((e, i) => ({
          excedente_id: e.id, id_excedente: e.id_excedente, producto: e.producto, variedad: e.variedad,
          kg_total: e.kg_total, estado: e.estado, modalitats: perOferta[i].oferta.modalitats,
        })),
        modo_test: base.modoTest,
        whatsapp_actiu: base.canals.whatsapp,
        email_actiu: base.canals.email,
        modalitat: modalitatsDe(modalitats)[0] ?? null,
        modalitats: modalitatsDe(modalitats),
        ranking,
      });
    }

    if (!excedente_id || typeof excedente_id !== "string") {
      return json({ error: "Falta 'excedente_id'" }, 400);
    }

    const { data: excedente, error: exError } = await supabase
      .from("excedentes")
      .select("id, id_excedente, familia, producto, variedad, kg_total, ubicacion_id, productor_id, modalitat, modalitats, estado, created_at")
      .eq("id", excedente_id)
      .maybeSingle();
    if (exError) {
      console.error("excedentes select:", exError.message);
      return json({ error: "Error consultando el excedente" }, 500);
    }
    if (!excedente) return json({ error: "Excedente no encontrado" }, 404);
    // Un ESBORRANY (fase C del punto 3) no se prioriza: no circula ni se envía a nadie.
    if (excedente.estado === "esborrany") {
      return json({ error: "Una oferta en esborrany no es prioritza", code: "oferta_esborrany" }, 409);
    }

    const base = await carregaBase(supabase, json);
    if (base instanceof Response) return base;
    const r = await rankingOferta(supabase, base, excedente as Excedent);
    console.log(`priorizar-entidades: oferta en ${Math.round(performance.now() - t0)} ms`);

    return json({
      excedente_id,
      contexto: r.contexto,
      modo_test: base.modoTest,
      whatsapp_actiu: base.canals.whatsapp,
      email_actiu: base.canals.email,
      modalitat: excedente.modalitat ?? null,
      modalitats: r.modalitats,
      ranking: r.ranking,
    });
  } catch (err) {
    console.error("priorizar-entidades:", err instanceof Error ? err.message : String(err));
    return json({ error: "Error interno o JSON inválido" }, 500);
  }
});

/** Las ofertas de un grupo que NO se priorizan (no circulan). */
const ESTATS_FORA_GRUP = new Set(["esborrany", "cerrada", "cancelada", "no_colocada"]);

/** Lo que se lee de una oferta para priorizarla. ⚠️ La lista de columnas, en UN literal (§7). */
interface Excedent {
  id: string;
  id_excedente: string | null;
  familia: string | null;
  producto: string | null;
  variedad: string | null;
  kg_total: number | null;
  ubicacion_id: string | null;
  productor_id: string | null;
  modalitat: string | null;
  modalitats: string[] | null;
  estado: string | null;
}

interface FitxaEntitat {
  id: string;
  nombre: string;
  poblacion: string | null;
  telefono: string | null;
  email: string | null;
  es_test: boolean | null;
  opt_in: boolean | null;
  area_geografica: string | null;
  tipo_receptor: string | null;
  tipus_activitat: string[] | null;
  perfil_receptor: Record<string, unknown> | null;
  modalitats_interes: string[] | null;
  organizacion_id: string | null;
}

/**
 * Lo que NO depende de la oferta: las entidades candidatas (activas y revisadas), su naturalesa y
 * las dos reglas en tabla, los contactos de WhatsApp, la preferencia de canal, los interruptores,
 * el modo test y la última recepción. Se lee una vez aunque el grupo tenga varias ofertas.
 */
interface Base {
  revisades: FitxaEntitat[];
  naturalesaOrg: Map<string, { naturalesa: string | null; naturalesa_origen: string | null }>;
  regla: Map<string, Set<string>> | null;
  matriu: Map<string, Set<string>> | null;
  porTelefono: Map<string, { opt_in: boolean | null; last_inbound_at: string | null }>;
  preferencias: Map<string, CanalPreferido>;
  modoTest: boolean;
  canals: CanalsActius;
  ultimaRecepcio: Map<string, string>;
}

async function carregaBase(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  /** El que responde con las cabeceras CORS de la petición. */
  json: (cos: unknown, status?: number) => Response,
): Promise<Base | Response> {
  const { data: entidadesActives, error: entError } = await supabase
    .from("entidades")
    // ⚠️ La lista de columnas va en UN literal, sin concatenar: supabase-js deduce el
    // tipo de la fila analizando ese literal, y ante una expresión (dos cadenas con
    // `+`) se rinde y devuelve GenericStringError, que rompe todo uso posterior de
    // `entidades`. Es la diferencia entre `deno check` en verde y tres errores.
    .select("id, nombre, poblacion, telefono, email, es_test, opt_in, area_geografica, prioritat, productes_frescos, transport_plataforma, descarrega_toro, tipo_receptor, perfil_receptor, tipus_activitat, modalitats_interes, organizacion_id")
    // Solo las activas (plan 1, 1A): una entidad importada inactiva (D2) no se prioriza ni
    // recibe la oferta hasta que el equipo la active con su NIF.
    .eq("activo", true);
  if (entError) {
    console.error("entidades select:", entError.message);
    return json({ error: "Error consultando las entidades" }, 500);
  }

  // Fuera también la que se registró sola y el equipo aún no ha aprobado (o rechazó): tiene
  // membresías y NINGUNA `aprovada`. La ficha del registro nace `activo = true` (el default),
  // y hasta el 09-11-2026 la mantenía fuera su `estat` vacío; desde la deuda §12.168 el
  // `estat` vacío ya no excluye, así que esta regla lo dice explícitamente. Las fichas que
  // crea el equipo sin cuenta no tienen membresías y entran. Falla cerrado: sin poder leer
  // las membresías no se sabe quién está sin revisar.
  const idsActives = ((entidadesActives ?? []) as FitxaEntitat[]).map((e) => e.id);
  const { data: membres, error: memError } = idsActives.length
    ? await supabase.from("membresias").select("entidad_id, aprovacio").in("entidad_id", idsActives)
    : { data: [], error: null };
  if (memError) {
    console.error("membresias select:", memError.message);
    return json({ error: "Error consultando las membresías" }, 500);
  }
  const ambMembresia = new Set<string>();
  const aprovades = new Set<string>();
  for (const m of (membres ?? []) as { entidad_id: string | null; aprovacio: string | null }[]) {
    if (!m.entidad_id) continue;
    ambMembresia.add(m.entidad_id);
    if (m.aprovacio === "aprovada") aprovades.add(m.entidad_id);
  }
  const revisades = ((entidadesActives ?? []) as FitxaEntitat[])
    .filter((e) => !ambMembresia.has(e.id) || aprovades.has(e.id));

  // P8 (deuda §12.176): la naturalesa CONFIRMADA y la regla en tabla. La matriz de tipo de
  // receptor, para el filtro «Modalitat» del ranking (16-11-2026). Si no se pueden leer, no
  // recortan: la base corta igualmente el interés.
  const orgIds = [...new Set(revisades.map((e) => e.organizacion_id).filter(Boolean))] as string[];
  const [
    { data: orgs, error: orgError }, { data: reglaFiles, error: reglaError }, { data: matriuFiles, error: matriuError },
  ] = await Promise.all([
    orgIds.length
      ? supabase.from("organizaciones").select("id, naturalesa, naturalesa_origen").in("id", orgIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("modalitat_naturalesa_compat").select("modalitat, naturalesa"),
    supabase.from("modalitat_receptor_compat").select("modalitat, tipo_receptor"),
  ]);
  if (matriuError) console.error("modalitat_receptor_compat:", matriuError.message);
  const matriu = matriuError ? null : matriuReceptor(matriuFiles ?? []);
  if (orgError || reglaError) {
    console.error("naturalesa:", (orgError ?? reglaError)?.message);
  }
  const regla = orgError || reglaError ? null : reglaNaturalesa(reglaFiles ?? []);
  const naturalesaOrg = new Map<string, { naturalesa: string | null; naturalesa_origen: string | null }>();
  for (const o of (orgs ?? []) as { id: string; naturalesa: string | null; naturalesa_origen: string | null }[]) {
    naturalesaOrg.set(o.id, o);
  }

  // Canal recomendado por entidad (`canal.ts`): la ventana de 24 h y el opt-in salen de
  // `wa_contacts`, que el ranking no mira.
  const telefonos = revisades.map((e) => e.telefono).filter(Boolean) as string[];
  const { data: contactos } = telefonos.length
    ? await supabase.from("wa_contacts").select("phone, opt_in, last_inbound_at").in("phone", telefonos)
    : { data: [] };
  const porTelefono = new Map<string, { opt_in: boolean | null; last_inbound_at: string | null }>();
  for (const c of (contactos ?? []) as { phone: string; opt_in: boolean | null; last_inbound_at: string | null }[]) {
    porTelefono.set(c.phone, c);
  }

  // La preferencia de canal de la organización de cada entidad. Fail-soft: si no se
  // puede leer, el mapa viene vacío y todo el mundo se decide como hasta ahora.
  const preferencias = await preferenciasDeCanal(supabase, "entidad", revisades.map((e) => e.id));

  // `es_test` decide si PUEDE recibir (§8); el canal, POR DÓNDE. Y los interruptores (§8):
  // con WhatsApp apagado no es un canal viable para nadie; con todo apagado, `cap` para todas.
  const modoTest = await modoTestActivo(supabase);
  const canals = await canalsActius(supabase);

  // La última vez que cada entidad RECIBIÓ algo (fase 6 de la revisión del 08-10-2026):
  // una canalización conciliada. Para el filtro «última recepció» del panel; no puntúa.
  const ultimaRecepcio = new Map<string, string>();
  const ids = revisades.map((e) => e.id);
  if (ids.length) {
    const { data: rebudes } = await supabase.from("canalizaciones")
      .select("entidad_id, conciliada_at").in("entidad_id", ids).not("conciliada_at", "is", null);
    for (const r of (rebudes ?? []) as { entidad_id: string; conciliada_at: string }[]) {
      const ant = ultimaRecepcio.get(r.entidad_id);
      if (!ant || r.conciliada_at > ant) ultimaRecepcio.set(r.entidad_id, r.conciliada_at);
    }
  }

  return {
    revisades, naturalesaOrg, regla, matriu, porTelefono,
    preferencias, modoTest, canals, ultimaRecepcio,
  };
}

/** El ranking de UNA oferta, exactamente el de siempre, sobre lo común ya leído. */
// deno-lint-ignore no-explicit-any
async function rankingOferta(supabase: any, base: Base, excedente: Excedent) {
  // El área/población de referencia salen de la ubicación del excedente y, si no,
  // de la ficha del productor.
  let area: string | null = null;
  let poblacion: string | null = null;
  if (excedente.ubicacion_id) {
    const { data: u } = await supabase
      .from("productor_ubicaciones").select("municipio").eq("id", excedente.ubicacion_id).maybeSingle();
    poblacion = u?.municipio ?? null;
  }
  if (excedente.productor_id) {
    const { data: p } = await supabase
      .from("productores").select("area_geografica, poblacion").eq("id", excedente.productor_id).maybeSingle();
    area = p?.area_geografica ?? null;
    poblacion = poblacion ?? p?.poblacion ?? null;
  }

  // P8 (deuda §12.176): fuera la entidad cuya naturalesa CONFIRMADA no admite ninguna modalidad
  // de la oferta (una empresa, en una oferta solo de donación). La misma regla que el Mercat y
  // `comprova_interes()`.
  const modalitatsOferta = modalitatsDe(excedente.modalitats ?? excedente.modalitat);
  const entidades = base.revisades.filter((e) => {
    const o = e.organizacion_id ? base.naturalesaOrg.get(e.organizacion_id) : undefined;
    return admesaPerNaturalesa(modalitatsOferta, o?.naturalesa, o?.naturalesa_origen, base.regla);
  });

  const contexto: ExcedenteContexto = {
    familia: excedente.familia,
    area_geografica: area,
    poblacion,
    kg_total: excedente.kg_total,
  };
  // `sense_conveni` dice si le FALTA EL PAPEL para poder recibir esto (fase 2).
  // Con VARIAS modalidades (05-10-2026) a una entidad le falta el papel solo si no tiene el
  // convenio de NINGUNA: con el de una, puede pedirla en esa modalidad (D2). Es la
  // intersección de los «sin convenio» de cada una.
  const ids = entidades.map((e) => e.id);
  const sinPorModalitat: Set<string>[] = [];
  for (const m of modalitatsOferta) sinPorModalitat.push(await entidadesSinConvenio(supabase, m, ids));
  const sinConvenio: Set<string> = sinPorModalitat.length === 0
    ? new Set<string>()
    : sinPorModalitat.reduce((acc, sin) => new Set([...acc].filter((x) => sin.has(x))));

  // Y es también lo que decide «activa o pendiente» en el ranking (deuda §12.168,
  // 09-11-2026): antes lo decidía `entidades.estat`, la columna del antiguo Excel, y un
  // `estat` vacío —el de toda entidad nueva— la dejaba fuera de las sugerencias.
  const ranking = priorizar(
    entidades.map((e) => ({ ...e, conveni_vigent: !sinConvenio.has(e.id) })) as unknown as EntidadPriorizable[],
    contexto,
  );

  const porId = new Map<string, FitxaEntitat>();
  for (const e of entidades) porId.set(e.id, e);

  // Canal recomendado por entidad (`canal.ts`): el correo es el canal por defecto y
  // WhatsApp solo cuando de verdad se puede, salvo que la organización haya pedido uno
  // (`organizaciones.canal_preferido`, §12.22) y ese sea viable. Se decide AQUÍ, no en
  // el panel, para que la política viva en un solo sitio; el panel solo la pinta y la obedece.
  const rankingConCanal = ranking.map((e) => {
    const ficha = porId.get(e.id);
    const contacto = ficha?.telefono ? base.porTelefono.get(ficha.telefono) : undefined;
    const d = decidirCanal({
      telefono: ficha?.telefono,
      email: ficha?.email,
      opt_in: contacto?.opt_in,
      last_inbound_at: contacto?.last_inbound_at,
      canal_preferido: base.preferencias.get(e.id) ?? null,
      whatsapp_activo: base.canals.whatsapp,
      email_activo: base.canals.email,
      notificacions_actives: base.canals.notificacions,
    });
    const nat = base.naturalesaOrg.get(ficha?.organizacion_id ?? "");
    return {
      ...e,
      email: ficha?.email ?? null,
      es_test: ficha?.es_test === true,
      // Para el filtro «tipus d'entitat» del panel (reunión del 05-10-2026). No entra en
      // la puntuación: la compatibilidad de tipo ya la decide la matriz de modalidades.
      tipo_receptor: ficha?.tipo_receptor ?? null,
      // Para los filtros «zona» y «última recepció» (fase 6). Tampoco puntúan.
      comarca: ficha?.area_geografica ?? null,
      ultima_recepcio: base.ultimaRecepcio.get(e.id) ?? null,
      // Fase 7: qué hace, y lo que dice que puede recibir (`perfil_receptor`). Solo filtran.
      tipus_activitat: ficha?.tipus_activitat ?? [],
      capacitat_maxima: numeroOuNull(ficha?.perfil_receptor?.capacitat_maxima),
      quantitat_habitual: numeroOuNull(ficha?.perfil_receptor?.quantitat_habitual),
      // Para el filtro «Modalitat» (16-11-2026): las de esta oferta que puede recibir (tipo y
      // naturalesa) y las que dice que le interesan. Solo filtran.
      modalitats_possibles: modalitatsAdmeses(
        modalitatsOferta, ficha?.tipo_receptor, base.matriu, nat?.naturalesa, nat?.naturalesa_origen, base.regla,
      ),
      modalitats_interes: ficha?.modalitats_interes ?? [],
      canal: d.canal,
      motiu_canal: d.motivo,
      whatsapp_possible: d.whatsappPosible,
      email_possible: d.emailPosible,
      // Qué pidió la organización y si se ha podido respetar. Va al panel para que un
      // incumplimiento no pase en silencio.
      canal_preferit: d.preferido,
      preferencia_respectada: d.preferenciaRespetada,
      // Aviso, no bloqueo: el bloqueo duro lo hace la base al aprobar (§fase 2).
      sense_conveni: sinConvenio.has(e.id),
    };
  });

  return { contexto, modalitats: modalitatsOferta, ranking: rankingConCanal };
}

// ---------------------------------------------------------------------------
// `sense_conveni`: a quién le falta el papel para poder recibir esto (fase 2)
// ---------------------------------------------------------------------------
// Es un AVISO, no un bloqueo. El bloqueo lo hace la base, y solo desde la fecha de corte
// (D7): `aprovar_resposta()` llama a `exigir_convenio()`, que antes del corte devuelve
// texto y después levanta `42501 sense_conveni:`. Aquí lo único que se hace es que el
// panel pueda pintarlo **antes** de aprobar, que es donde un aviso sirve de algo: uno
// después de haber canalizado no evita nada.
//
// ⚠️ POR QUÉ NO SE LLAMA A `convenio_vigente()` UNA VEZ POR ENTIDAD, que sería lo obvio.
//    Son 111 entidades: 111 llamadas RPC por cada vez que alguien abre una oferta. En su
//    lugar se leen las **dos** tablas de las que esa función sale —la matriz y los
//    convenios vigentes— y se hace la resta aquí. La regla de negocio sigue viviendo
//    donde tiene que vivir (`convenios_exigidos`, que se cambia con un `insert`); lo que
//    se replica es la resta, no la regla.
//
//    Y la autoridad sigue siendo `convenio_vigente()`: si esto y la base discreparan, el
//    panel enseñaría un aviso de más o de menos y la aprobación seguiría decidiendo bien.
//    Es la única duplicación aceptable, porque el peor caso es cosmético.
//
// Semántica copiada literalmente de la RPC: una valorización **sin ninguna fila** en la
// matriz no exige nada. No es un descuido: bloquear por omisión pararía el servicio el día
// que alguien añada una valorización nueva.

// deno-lint-ignore no-explicit-any
type ClienteSupabase = any;

async function entidadesSinConvenio(
  supabase: ClienteSupabase,
  modalitat: string | null | undefined,
  entidadIds: string[],
): Promise<Set<string>> {
  const sin = new Set<string>();
  const valorizacion = (modalitat ?? "").trim();
  if (!valorizacion || entidadIds.length === 0) return sin;

  const { data: exigidos, error: errEx } = await supabase
    .from("convenios_exigidos")
    .select("valorizacion, parte, tipo_convenio")
    .eq("valorizacion", valorizacion)
    .eq("parte", "recibe");
  if (errEx) {
    // Sin la matriz no se puede afirmar que falte nada: se calla. Un aviso inventado en
    // 111 filas es peor que no avisar.
    console.error("convenios_exigidos select:", errEx.message);
    return sin;
  }
  const tipos = (exigidos ?? []).map((f: { tipo_convenio: string }) => f.tipo_convenio);
  if (tipos.length === 0) return sin;

  const { data: vigentes, error: errConv } = await supabase
    .from("convenios")
    .select("id, tipo, estado, entidad_id")
    .eq("estado", "vigent")
    .in("tipo", tipos)
    .in("entidad_id", entidadIds);
  if (errConv) {
    console.error("convenios select:", errConv.message);
    return sin;
  }

  const porEntidad = new Map<string, Set<string>>();
  for (const c of vigentes ?? []) {
    const fila = c as { tipo: string; entidad_id: string | null };
    if (!fila.entidad_id) continue;
    const ya = porEntidad.get(fila.entidad_id) ?? new Set<string>();
    ya.add(fila.tipo);
    porEntidad.set(fila.entidad_id, ya);
  }
  for (const id of entidadIds) {
    const tiene = porEntidad.get(id) ?? new Set<string>();
    if (tipos.some((t: string) => !tiene.has(t))) sin.add(id);
  }
  return sin;
}
