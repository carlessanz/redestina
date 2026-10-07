// Alta de una oferta desde el panel del productor.
//
//   GET  /crear-oferta/campos?productor=<uuid>  -> los 15 pasos, sus secciones y catálogos
//   POST /crear-oferta  { productor_id, datos } -> crea el excedente
//
// Por qué una Edge Function y no un insert desde el navegador:
//   · `id_excedente` es un correlativo por productor, producto y día, y `texto_oferta`
//     es el mensaje que se publica. Los dos se generan en `_shared/oferta.ts`, que es
//     código de Deno compartido con el intake. Duplicarlo en TypeScript garantizaría
//     que las dos versiones divergen.
//   · `authenticated` no tiene GRANT de INSERT sobre `excedentes` a propósito (§4bis):
//     así el correlativo no se puede falsificar desde el navegador.
//
// El descriptor se SIRVE en vez de escribirlo en el frontend, para que el formulario
// del panel y las preguntas del bot no puedan separarse.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { canvisOferta, crearExcedente, modalitatsAmbConveni, textoOfertaDeFila } from "../_shared/oferta.ts";
import { modalitatsDe } from "../_shared/modalitats.ts";
import { CAMPOS, CAUSES_ES, FAMILIES_ES, SECCIONES, faltantes } from "../_shared/camposOferta.ts";
import { contextoUsuario } from "../_shared/autorizacion.ts";
import { confirmarOfertaPerCorreu } from "../_shared/correu-oferta.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { fotosValides, veuCostReferencia } from "./validacio.ts";

Deno.serve(async (req) => {
  const cors = corsPara(req, "GET, POST, OPTIONS");
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) {
    return responder({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
  }

  /** ¿Puede este usuario ofertar en nombre de esta ficha de productor? */
  const puedeOfertar = (productorId: string) =>
    ctx.esIntern || ctx.productores.includes(productorId);

  // -------------------------------------------------------------------------
  // GET /campos — descriptor + catálogos
  // -------------------------------------------------------------------------
  if (req.method === "GET") {
    const url = new URL(req.url);
    const productorId = url.searchParams.get("productor");

    // `costes_producto` es solo del equipo por RLS, pero el VALOR DE REFERENCIA se le
    // propone al productor al publicar (27-09-2026): se lee aquí con `service_role` y viaja
    // pegado a cada producto, sin abrir la tabla. `foto_mini` es para enseñar la foto del
    // catálogo junto a la casilla «fes servir la foto del producte».
    const veuCost = veuCostReferencia(ctx);
    const [productos, causas, ubicaciones, costos] = await Promise.all([
      supabase.from("productos").select("nombre, familia, foto_mini").order("nombre"),
      supabase.from("causas").select("codigo, nombre").order("nombre"),
      productorId && puedeOfertar(productorId)
        ? supabase.from("productor_ubicaciones")
          .select("id, alias, municipio").eq("productor_id", productorId)
        : Promise.resolve({ data: [] }),
      // Solo el equipo o quien tiene ficha de productor (M8): a cualquier otra sesión
      // —receptora, cuenta pendiente— no se le sirve una tabla que la RLS le niega.
      veuCost
        ? supabase.from("costes_producto").select("producto, coste_kg")
        : Promise.resolve({ data: [] }),
    ]);
    const referencia = new Map(
      ((costos.data ?? []) as { producto: string; coste_kg: number }[])
        .map((c) => [c.producto, Number(c.coste_kg)]),
    );

    const familias = [
      ...new Set((productos.data ?? [])
        .map((p: { familia: string | null }) => p.familia)
        .filter(Boolean)),
    ].sort();

    // ⚠️ COMPATIBILIDAD CON EL PANEL VIEJO. Desde el 27-09-2026 una condición puede ser una
    //    LISTA («o»), y el panel anterior hacía `condicion.en.includes(...)`: con una lista
    //    reventaba. Las funciones se publican antes que el frontend (§11), así que durante
    //    esa ventana el panel viejo lee este descriptor. Se sirve `condicion` con la PRIMERA
    //    (lo que el viejo entiende) y `condicions` con todas (lo que usa el nuevo).
    const campos = CAMPOS.map((c) =>
      Array.isArray(c.condicion) ? { ...c, condicion: c.condicion[0], condicions: c.condicion } : c
    );

    return responder({
      campos,
      // Las secciones viajan con los campos y no se escriben en la pantalla: agrupar los
      // pasos es parte del cuestionario, no de una interfaz concreta, y `campos[].seccion`
      // no se puede pintar sin saber en qué orden van los bloques ni cómo se titulan.
      secciones: SECCIONES,
      catalogos: {
        familias,
        productos: ((productos.data ?? []) as { nombre: string; familia: string | null; foto_mini: string | null }[])
          .map((p) => veuCost ? { ...p, cost_referencia: referencia.get(p.nombre) ?? null } : p),
        // `nombre_es` y `familias_es`: solo para enseñarlas en castellano; el valor que se
        // guarda no cambia (camposOferta.ts, FAMILIES_ES / CAUSES_ES).
        causas: ((causas.data ?? []) as { codigo: string; nombre: string | null }[])
          .map((c) => ({ ...c, nombre_es: CAUSES_ES[c.codigo] ?? null })),
        familias_es: FAMILIES_ES,
        ubicaciones: ubicaciones.data ?? [],
      },
    });
  }

  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  // ── Editar una oferta publicada (05-10-2026, rebanada 2) ──
  // POST /crear-oferta/editar  { id, canvis }
  // Vive aquí porque es quien sabe componer el `texto_oferta` (`componerTextoOferta()`); la
  // regla —quién, en qué estado, kg ≥ canalizado, D4— la impone `editar_oferta()` en la base.
  if (new URL(req.url).pathname.endsWith("/editar")) {
    try {
      const { id, canvis } = await req.json();
      if (!id || typeof id !== "string" || !canvis || typeof canvis !== "object") {
        return responder({ error: "Falten 'id' o 'canvis'" }, 400);
      }
      const { data: fila } = await supabase.from("excedentes").select("*").eq("id", id).maybeSingle();
      if (!fila) return responder({ error: "Oferta inexistent", code: "no_trobada" }, 404);
      if (!puedeOfertar(fila.productor_id)) {
        return responder({ error: "No pots editar aquesta oferta", code: "forbidden" }, 403);
      }
      const c = canvisOferta(canvis as Record<string, unknown>);
      if (Object.keys(c).length === 0) return responder({ error: "Cap canvi", code: "sense_canvis" }, 400);
      const texto = await textoOfertaDeFila(supabase, { ...fila, ...c, modalitat: null });
      const { data, error } = await supabase.rpc("editar_oferta", {
        p_id: id, p_canvis: c, p_texto: texto, p_actor: ctx.userId,
      });
      if (error) {
        // Los rechazos de negocio van con su código delante del mensaje (`kg_menys_canalitzats: …`).
        const code = (error.message ?? "").split(":")[0].trim();
        const status = error.code === "42501" ? 403 : 400;
        return responder({ error: error.message, code }, status);
      }
      return responder({ ok: true, estado: (data as { estado?: string } | null)?.estado ?? null });
    } catch (err) {
      console.error("crear-oferta/editar:", err instanceof Error ? err.message : String(err));
      return responder({ error: "Error interno o JSON inválido" }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST — crear la oferta
  // -------------------------------------------------------------------------
  try {
    const { productor_id: productorId, datos } = await req.json();

    if (!productorId || typeof productorId !== "string") {
      return responder({ error: "Falta 'productor_id'" }, 400);
    }
    if (!datos || typeof datos !== "object") {
      return responder({ error: "Falta 'datos'" }, 400);
    }
    if (!puedeOfertar(productorId)) {
      return responder(
        { error: "No pots publicar ofertes en nom d'aquest productor", code: "forbidden" },
        403,
      );
    }

    const faltan = faltantes(datos as Record<string, unknown>);
    if (faltan.length > 0) {
      return responder({ error: "Falten camps obligatoris", code: "campos_faltantes", faltan }, 400);
    }

    // La ubicación tiene que ser de ESTE productor. La función corre con `service_role`, así
    // que la RLS de `productor_ubicaciones` no lo comprueba por ella: sin esto, una oferta
    // podría apuntar a la finca de otro con solo conocer su uuid (y el trigger de comarca
    // copiaría además su municipio).
    const ubicacio = (datos as Record<string, unknown>).ubicacio;
    if (ubicacio) {
      const { data: ubi } = await supabase.from("productor_ubicaciones")
        .select("id").eq("id", String(ubicacio)).eq("productor_id", productorId).maybeSingle();
      if (!ubi) {
        return responder({ error: "Aquesta ubicació no és d'aquest productor", code: "ubicacio_aliena" }, 400);
      }
    }

    // Las fotos (20270404100000): como mucho 3, y todas de la carpeta de ESTE productor. La
    // subida ya la limitó la política de Storage; esto impide citar en una oferta la foto de
    // otro, que el receptor vería como si fuera de esta.
    // Forma exacta `<productor>/<uuid>.<ext>`: sin `..`, barras dobles ni subcarpetas (B7).
    const fotos = (datos as Record<string, unknown>).fotos;
    if (!fotosValides(fotos, productorId)) {
      return responder({ error: "Fotos no vàlides", code: "fotos_invalides" }, 400);
    }

    // El coste que declara el productor (27-09-2026): un número positivo o nada. La base lo
    // exige también (`excedentes_coste_kg_positiu`), pero así el error dice qué campo es.
    const cost = (datos as Record<string, unknown>).cost_kg;
    if (cost !== undefined && cost !== null && cost !== "") {
      const n = Number(String(cost).replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) {
        return responder({ error: "El cost per quilo ha de ser un número positiu", code: "cost_invalid" }, 400);
      }
    }
    // `foto_producte` es un booleano o no viene (entonces, sí).
    const fp = (datos as Record<string, unknown>).foto_producte;
    if (fp !== undefined && fp !== null && typeof fp !== "boolean") {
      return responder({ error: "foto_producte ha de ser booleà", code: "foto_producte_invalid" }, 400);
    }

    // ⚠️ La lista de columnas, en UN literal (§7, deuda 46).
    const { data: productor } = await supabase
      .from("productores").select("id, name, email").eq("id", productorId).maybeSingle();
    if (!productor) return responder({ error: "Productor no trobat" }, 404);

    // El convenio que exige ESTA modalidad a quien entrega (28-09-2026). Hasta hoy solo lo
    // comprobaba la pantalla: la oferta se publicaba igual y el choque llegaba al aprobar el
    // primer interés, con la oferta ya circulando. `exigir_convenio()` es la misma regla que
    // usan `aprovar_resposta()` y `manifestar_interes()`: antes de la fecha de corte avisa (y
    // aquí no se hace nada con el aviso), desde la fecha de corte levanta 42501.
    // ⚠️ El alta ASISTIDA no pasa por aquí: el equipo resuelve el convenio en la fase 1 del
    //    ciclo guiado, con la persona delante (§6ter).
    // Desde el 05-10-2026 una oferta puede ofrecerse en VARIAS modalidades, y basta con que
    // UNA tenga su convenio vigente para publicarla: la que no lo tenga la para
    // `aprovar_resposta()` al canalizar, y la pantalla avisa de cuáles son.
    const modalitats = modalitatsDe((datos as Record<string, unknown>).modalitat);
    let senseConveni: string[] = [];
    if (!ctx.esIntern) {
      const cobertes = await modalitatsAmbConveni(supabase, productorId, modalitats);
      if (cobertes.length === 0) {
        // La CLAVE i18n como mensaje: la pantalla la traduce con `textError()`.
        return responder({
          error: modalitats.length === 1 && modalitats[0] === "donacio" ? "po.cal_conveni_don" : "po.cal_conveni_com",
          code: "sense_conveni",
        }, 403);
      }
      senseConveni = modalitats.filter((m) => !cobertes.includes(m));
    }

    // `panel` cuando la publica el propio productor; `asistido` cuando la introduce el
    // equipo en su nombre, que es el modelo de operación del servicio (§1bis) y a la
    // hora de leer los datos no es lo mismo que si la hubiera publicado él.
    // G1 (05-10-2026, rebanada 3): con un albarán entregado y sin confirmar desde hace más
    // de 48 h, primero se confirma. Solo la productora: el equipo opera en su nombre y es
    // quien resuelve la confirmación, por eso el alta asistida no se bloquea.
    if (!ctx.esIntern) {
      const { data: pendents } = await supabase.rpc("bloqueig_per_albara", {
        p_tipo: "productor", p_org: productorId,
      });
      const ids = ((pendents ?? []) as unknown[]).map((x) => String(x));
      if (ids.length > 0) {
        return responder({ error: "po.err_albara_pendent", code: "albara_pendent", albarans: ids }, 409);
      }
    }

    const r = await crearExcedente(
      supabase,
      datos as Record<string, unknown>,
      productor,
      ctx.esIntern ? "asistido" : "panel",
    );
    if (!r.ok) return responder({ error: r.error ?? "No s'ha pogut crear l'oferta" }, 500);

    // La confirmación que el intake manda por WhatsApp (`_shared/oferta.ts`), aquí por
    // correo: quien publica desde el panel también tiene derecho a su referencia por
    // escrito, y con WhatsApp apagado (§8) esta es la única que va a recibir.
    const confirmacio = await confirmarOfertaPerCorreu(productor, r.idExcedente ?? "", r.excedenteId ?? "", datos, supabase, "crear-oferta", r.estado);

    return responder(
      {
        ok: true, id: r.excedenteId, id_excedente: r.idExcedente, confirmacio_email: confirmacio,
        // `pendent_validacio` o `publicada` (05-10-2026): lo decide la base, y la pantalla lo
        // dice tal cual en vez de dar por publicada una oferta que nadie ve todavía.
        estado: r.estado ?? "publicada",
        modalitats_sense_conveni: senseConveni,
      },
      200,
    );
  } catch (err) {
    console.error("crear-oferta:", err instanceof Error ? err.message : String(err));
    return responder({ error: "Error interno o JSON inválido" }, 500);
  }
});
