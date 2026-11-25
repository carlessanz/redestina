// Alta de una oferta desde el panel del productor.
//
//   GET  /crear-oferta/campos?productor=<uuid>  -> los pasos, sus secciones, catálogos y lo que
//                                                  propone la ficha (`predeterminats`, A4)
//   POST /crear-oferta  { productor_id, datos } -> crea el excedente
//   POST /crear-oferta/esborrany { id?, productor_id, datos } -> guarda un esborrany (fase C)
//   POST /crear-oferta/publicar  { id, datos? }  -> publica un esborrany, igual que el alta
//   POST /crear-oferta/editar    { id, canvis }  -> edita una oferta ya publicada (`canvis.espigolada`
//                                                  marca o desmarca la espigolada, fase 3)
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
import {
  canvisOferta, crearExcedente, dadesAmbEspigolada, desarEsborrany, filaEditada, modalitatsAmbConveni,
  textoOfertaDeFila,
} from "../_shared/oferta.ts";
import { modalitatsDe } from "../_shared/modalitats.ts";
import { CAMPOS, FAMILIES_ES, SECCIONES, faltantes } from "../_shared/camposOferta.ts";
import { agrupaCauses, motiuSubcausa, type FilaCausa, type FilaSubcausa } from "../_shared/causes.ts";
import { contextoUsuario } from "../_shared/autorizacion.ts";
import { confirmarOfertaPerCorreu } from "../_shared/correu-oferta.ts";
import { corsPara } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { errorFormatOferta, fotosValides, kgValid, mapsValid, veuCostReferencia } from "./validacio.ts";
import { predeterminatsDe, principalPrimer } from "../_shared/predeterminatsOferta.ts";

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
    const propi = Boolean(productorId && puedeOfertar(productorId));
    // A4 (20270521100000): cada lugar trae si es el principal, sus días y franjas y el horario
    // en texto; el principal va primero. Y la ficha, sus envases habituales: con eso se
    // calcula lo que se propone en la oferta nueva (`predeterminats`).
    const [productos, causas, subcausas, ubicaciones, costos, fitxa, origens] = await Promise.all([
      supabase.from("productos").select("nombre, familia, foto_mini").order("nombre"),
      // Fase B del punto 3: las causas ACTIVAS por orden, cada una con sus subcausas activas.
      supabase.from("causas").select("codigo, nombre, nombre_es, activa, orden"),
      supabase.from("subcausas").select("codigo, causa_codigo, nombre, nombre_es, orden, activa"),
      propi
        ? supabase.from("productor_ubicaciones")
          // `gmaps_url` (17-11-2026): el formulario enseña el enlace del lugar elegido.
          .select("id, alias, municipio, gmaps_url, es_principal, horario, dies_setmana, franges").eq("productor_id", productorId!)
          .order("alias")
        : Promise.resolve({ data: [] }),
      // Solo el equipo o quien tiene ficha de productor (M8): a cualquier otra sesión
      // —receptora, cuenta pendiente— no se le sirve una tabla que la RLS le niega.
      // Punto 3, fase D2 (20270601100000): la propuesta es el PRECIO DE REFERENCIA de hoy
      // (`preu_referencia_de`: el validado del mes o el último publicado, provisional), no
      // `costes_producto`. Solo se guarda en la oferta si el productor lo cambia.
      veuCost
        ? supabase.rpc("preus_vigents_oferta", {})
        : Promise.resolve({ data: [] }),
      propi
        ? supabase.from("productores").select("envasos_habituals").eq("id", productorId!).maybeSingle()
        : Promise.resolve({ data: null }),
      // 20270604100000: un precio MANUAL dice que no es oficial, cómo se decidió y de qué fuente
      // sale. Solo el origen (criterio y fuente), nunca el `motivo` ni quién lo fijó.
      veuCost
        ? supabase.from("costes_producto").select("producto, criteri, font_origen")
        : Promise.resolve({ data: [] }),
    ]);
    type Lloc = {
      id: string; alias: string | null; municipio: string | null; gmaps_url: string | null;
      es_principal: boolean | null; horario: string | null; dies_setmana: number[] | null; franges: unknown;
    };
    const llocs = principalPrimer((ubicaciones.data ?? []) as Lloc[]);
    const envasos = ((fitxa.data as { envasos_habituals: string[] | null } | null)?.envasos_habituals) ?? null;
    // `dia` (20270603100000): solo Mercabarna sin el mes validado → el precio de ese día.
    type Vigent = {
      producto: string; eur_kg: number; font: string | null; mes_font: string | null; provisional: boolean;
      dia?: string | null;
    };
    const referencia = new Map(
      ((costos.data ?? []) as Vigent[]).map((c) => [c.producto, c]),
    );
    type Origen = { producto: string; criteri: string | null; font_origen: string | null };
    const origen = new Map(((origens.data ?? []) as Origen[]).map((o) => [o.producto, o]));

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
    // Lo OCULTO (17-11-2026, `transport`) no se sirve: ni el panel nuevo ni el publicado lo
    // pintan, y el servidor tampoco lo exige (`aplica()` devuelve false).
    const campos = CAMPOS.filter((c) => !c.oculto).map((c) =>
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
          .map((p) => {
            if (!veuCost) return p;
            const r = referencia.get(p.nombre);
            // `cost_referencia` sigue siendo un número (el panel publicado lo lee así); el mes,
            // la fuente y si es provisional viajan aparte.
            return {
              ...p,
              cost_referencia: r ? Number(r.eur_kg) : null,
              cost_referencia_font: r?.font ?? null,
              cost_referencia_mes: r?.mes_font ?? null,
              cost_referencia_provisional: r ? Boolean(r.provisional) : null,
              cost_referencia_dia: r?.dia ?? null,
              cost_referencia_origen: r?.font === "manual" && origen.has(p.nombre)
                ? { criteri: origen.get(p.nombre)!.criteri, font_origen: origen.get(p.nombre)!.font_origen }
                : null,
            };
          }),
        // `familias_es`: solo para enseñarlas en castellano; el valor que se guarda no cambia.
        // Las causas (fase B del punto 3, 20270529100000): `[{codigo, nombre, nombre_es,
        // subcausas: [{codigo, nombre, nombre_es}]}]`, solo activas y en orden. El panel elige
        // la SUBCAUSA y manda su código en `causa`. ⚠️ Un panel anterior pinta `codigo/nombre`
        // de cada causa (las 7 categorías) y manda una categoría: `subcausa_obligatoria` (400)
        // hasta que se publique el frontend.
        causas: agrupaCauses(
          (causas.data ?? []) as FilaCausa[],
          (subcausas.data ?? []) as FilaSubcausa[],
        ),
        familias_es: FAMILIES_ES,
        ubicaciones: llocs,
      },
      // A4: lo que la ficha propone (lugar principal, su primera franja, el formato de los
      // envases habituales). Clave NUEVA: un panel anterior la ignora.
      predeterminats: predeterminatsDe(llocs, envasos),
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
      // Fase C: las fotos y el enlace de Maps, con las mismas reglas que el alta (la RPC lo vuelve
      // a mirar, pero así el error dice qué campo es).
      if ("fotos" in c && !fotosValides(c.fotos, fila.productor_id)) {
        return responder({ error: "Fotos no vàlides", code: "fotos_invalides" }, 400);
      }
      if ("gmaps_url" in c && !mapsValid(c.gmaps_url)) {
        return responder({ error: "L'enllaç de Maps no és vàlid", code: "maps_invalid" }, 400);
      }
      // El texto, con la fila como quedará: también lo que la RPC deriva de la espigolada (fase 3).
      const texto = await textoOfertaDeFila(supabase, filaEditada(fila, c));
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

  // Los mensajes de los errores de formato (los mismos códigos en el alta y en el esborrany).
  const MISSATGE_FORMAT: Record<string, string> = {
    kg_invalid: "Els kg han de ser un número positiu",
    retorn_quantitat_invalid: "Quants envasos ha de ser un enter positiu",
    hectarees_invalid: "Les hectàrees han de ser un número positiu",
    maps_invalid: "L'enllaç de Maps no és vàlid",
    fotos_invalides: "Fotos no vàlides",
    cost_invalid: "El cost per quilo ha de ser un número positiu",
    foto_producte_invalid: "foto_producte ha de ser booleà",
  };

  /** La ubicación tiene que ser de ESTE productor (la función corre con `service_role`). */
  const ubicacioAliena = async (ubicacio: unknown, productorId: string) => {
    if (!ubicacio) return false;
    const { data: ubi } = await supabase.from("productor_ubicaciones")
      .select("id").eq("id", String(ubicacio)).eq("productor_id", productorId).maybeSingle();
    return !ubi;
  };

  /**
   * TODO lo que se comprueba antes de publicar, igual para el alta directa y para la publicación
   * de un esborrany (fase C del punto 3): una sola lista, así que publicar un esborrany no puede
   * ser más permisivo que el alta. Devuelve la respuesta de error o lo que hace falta para crear.
   */
  const validarPublicacio = async (
    productorId: string,
    d: Record<string, unknown>,
  ): Promise<Response | { productor: { id: string; name: string; email: string | null }; senseConveni: string[] }> => {
    const faltan = faltantes(d);
    if (faltan.length > 0) {
      return responder({ error: "Falten camps obligatoris", code: "campos_faltantes", faltan }, 400);
    }
    // 17-11-2026: los kilos, positivos (un «0» pasaba `faltantes()`).
    if (!kgValid(d.kg)) return responder({ error: MISSATGE_FORMAT.kg_invalid, code: "kg_invalid" }, 400);
    // Los envases a devolver, un entero; el enlace de Maps, un http(s); las fotos, como mucho 3 y
    // todas de la carpeta de ESTE productor (`<productor>/<uuid>.<ext>`, B7); el coste, positivo.
    const format = errorFormatOferta(d, productorId);
    if (format) return responder({ error: MISSATGE_FORMAT[format], code: format }, 400);

    // Fase B del punto 3 (fila 3.6): en el panel se elige una SUBCAUSA activa; la causa sale de
    // ella. Una categoría a secas (o una causa de las de antes) = falta la subcausa. El intake
    // de WhatsApp no pasa por aquí: allí basta la categoría y la completa el equipo.
    {
      const codi = String(d.causa ?? "").trim();
      const [{ data: sub }, { data: causa }] = await Promise.all([
        supabase.from("subcausas").select("activa").eq("codigo", codi).maybeSingle(),
        supabase.from("causas").select("codigo").eq("codigo", codi).maybeSingle(),
      ]);
      const motiu = motiuSubcausa(codi, sub as { activa: boolean | null } | null, Boolean(causa));
      if (motiu === "subcausa_obligatoria") {
        return responder({ error: "po.err_subcausa_obligatoria", code: motiu, faltan: ["causa"] }, 400);
      }
      if (motiu) return responder({ error: "po.err_subcausa_invalida", code: motiu }, 400);
    }

    // Sin esto, una oferta podría apuntar a la finca de otro con solo conocer su uuid (y el
    // trigger de comarca copiaría además su municipio).
    if (await ubicacioAliena(d.ubicacio, productorId)) {
      return responder({ error: "Aquesta ubicació no és d'aquest productor", code: "ubicacio_aliena" }, 400);
    }

    // ⚠️ La lista de columnas, en UN literal (§7, deuda 46).
    const { data: productor } = await supabase
      .from("productores").select("id, name, email").eq("id", productorId).maybeSingle();
    if (!productor) return responder({ error: "Productor no trobat" }, 404);

    // El convenio que exige ESTA modalidad a quien entrega (28-09-2026): `exigir_convenio()`, la
    // misma regla que `aprovar_resposta()` y `manifestar_interes()`. Basta con que UNA modalidad
    // tenga su convenio vigente (05-10-2026); la pantalla avisa de cuáles no.
    // ⚠️ El alta ASISTIDA no pasa por aquí: el equipo resuelve el convenio con la persona delante.
    const modalitats = modalitatsDe(d.modalitat);
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

    // G1 (05-10-2026, rebanada 3): con un albarán entregado y sin confirmar desde hace más de
    // 48 h, primero se confirma. Solo la productora: el equipo opera en su nombre.
    if (!ctx.esIntern) {
      const { data: pendents } = await supabase.rpc("bloqueig_per_albara", {
        p_tipo: "productor", p_org: productorId,
      });
      const ids = ((pendents ?? []) as unknown[]).map((x) => String(x));
      if (ids.length > 0) {
        return responder({ error: "po.err_albara_pendent", code: "albara_pendent", albarans: ids }, 409);
      }
    }
    return { productor, senseConveni };
  };

  /** Crea (o publica el esborrany) y manda la confirmación: el MISMO efecto por los dos caminos. */
  const publicar = async (
    d: Record<string, unknown>,
    v: { productor: { id: string; name: string; email: string | null }; senseConveni: string[] },
    esborranyId?: string,
  ) => {
    // `panel` cuando la publica el propio productor; `asistido` cuando la introduce el equipo
    // en su nombre (§1bis).
    const r = await crearExcedente(supabase, d, v.productor, ctx.esIntern ? "asistido" : "panel", { esborranyId });
    if (!r.ok) {
      if (r.error === "esborrany_inexistent") {
        return responder({ error: "Aquest esborrany ja no existeix", code: "esborrany_inexistent" }, 409);
      }
      return responder({ error: r.error ?? "No s'ha pogut crear l'oferta" }, 500);
    }
    // «Espigolada» (fase 3, 25-11-2026): es una oferta de DONACIÓN con el producto en el campo
    // (`espigolada_demanada`, `tipus_operacio = 'espigolada'`) y sigue el circuito de cualquier
    // donación: Mercat, interés, asignación, recogida, ENT + REC. Ya no se crea ninguna jornada
    // (`crear_espigolada` está revocada): la del equipo nace publicada (asistida) y la de la
    // productora va a validación, como siempre (lo decide el trigger `excedentes_validacio`).
    // La confirmación que el intake manda por WhatsApp, aquí por correo: quien publica desde el
    // panel también tiene derecho a su referencia por escrito.
    const confirmacio = await confirmarOfertaPerCorreu(
      v.productor, r.idExcedente ?? "", r.excedenteId ?? "", d, supabase, "crear-oferta", r.estado,
    );
    return responder({
      ok: true, id: r.excedenteId, id_excedente: r.idExcedente, confirmacio_email: confirmacio,
      // `pendent_validacio` o `publicada` (05-10-2026): lo decide la base.
      estado: r.estado ?? "publicada",
      modalitats_sense_conveni: v.senseConveni,
    }, 200);
  };

  const ruta = new URL(req.url).pathname;

  // ── Guardar un ESBORRANY (fase C del punto 3, filas 3.1.2 y 3.7.1) ──
  // POST /crear-oferta/esborrany { id?, productor_id, datos }
  // Basta con productor y producto (del catálogo); lo demás se guarda como esté, pero lo que hay
  // tiene que tener buen formato. No dispara nada: ni validación, ni avisos, ni correo.
  if (ruta.endsWith("/esborrany")) {
    try {
      const { id, productor_id: productorId, datos } = await req.json();
      if (!productorId || typeof productorId !== "string" || !datos || typeof datos !== "object") {
        return responder({ error: "Falten 'productor_id' o 'datos'" }, 400);
      }
      if (id !== undefined && id !== null && typeof id !== "string") {
        return responder({ error: "'id' no vàlid" }, 400);
      }
      if (!puedeOfertar(productorId)) {
        return responder({ error: "No pots desar ofertes en nom d'aquest productor", code: "forbidden" }, 403);
      }
      // Con «Espigolada», donación y producto en el campo también en lo guardado (fase 3).
      const d = dadesAmbEspigolada(datos as Record<string, unknown>);
      const producte = String(d.producte ?? "").trim();
      if (!producte) {
        return responder({ error: "Cal triar el producte", code: "falta_producte", faltan: ["producte"] }, 400);
      }
      const { data: prod } = await supabase.from("productos").select("nombre").eq("nombre", producte).maybeSingle();
      if (!prod) return responder({ error: "Producte desconegut", code: "producte_invalid" }, 400);
      const format = errorFormatOferta(d, productorId);
      if (format) return responder({ error: MISSATGE_FORMAT[format], code: format }, 400);
      if (await ubicacioAliena(d.ubicacio, productorId)) {
        return responder({ error: "Aquesta ubicació no és d'aquest productor", code: "ubicacio_aliena" }, 400);
      }
      // Reescribir uno existente: tiene que ser un esborrany de ESTE productor (el productor de
      // un esborrany no cambia; para otro, otro esborrany).
      if (id) {
        const { data: fila } = await supabase.from("excedentes")
          .select("productor_id, estado").eq("id", id).maybeSingle();
        if (!fila || !puedeOfertar(fila.productor_id)) {
          return responder({ error: "Esborrany inexistent", code: "esborrany_inexistent" }, 404);
        }
        if (fila.estado !== "esborrany") {
          return responder({ error: "Aquesta oferta ja no és un esborrany", code: "no_es_esborrany" }, 409);
        }
        if (fila.productor_id !== productorId) {
          return responder({ error: "El productor d'un esborrany no canvia", code: "productor_fix" }, 400);
        }
      }
      const r = await desarEsborrany(supabase, d, productorId, ctx.esIntern ? "asistido" : "panel", id ?? undefined);
      if (!r.ok) {
        const status = r.error === "esborrany_inexistent" ? 409 : 500;
        return responder({ error: r.error, code: r.error === "esborrany_inexistent" ? r.error : undefined }, status);
      }
      return responder({ ok: true, id: r.id, estado: "esborrany" });
    } catch (err) {
      console.error("crear-oferta/esborrany:", err instanceof Error ? err.message : String(err));
      return responder({ error: "Error interno o JSON inválido" }, 500);
    }
  }

  // ── Publicar un ESBORRANY ──
  // POST /crear-oferta/publicar { id, datos? }  (sin `datos`, lo guardado en el esborrany)
  // Las MISMAS comprobaciones que el alta y el mismo efecto (correo de confirmación incluido);
  // la validación del equipo la decide la base al pasar a `publicada`.
  if (ruta.endsWith("/publicar")) {
    try {
      const { id, datos } = await req.json();
      if (!id || typeof id !== "string") return responder({ error: "Falta 'id'" }, 400);
      const { data: fila } = await supabase.from("excedentes")
        .select("productor_id, estado, dades_esborrany").eq("id", id).maybeSingle();
      // El permiso antes que la existencia: a quien no puede, lo mismo exista o no.
      if (!fila || !puedeOfertar(fila.productor_id)) {
        return responder({ error: "Esborrany inexistent", code: "esborrany_inexistent" }, 404);
      }
      if (fila.estado !== "esborrany") {
        return responder({ error: "Aquesta oferta ja està publicada", code: "no_es_esborrany" }, 409);
      }
      const d = dadesAmbEspigolada(
        (datos && typeof datos === "object" ? datos : fila.dades_esborrany ?? {}) as Record<string, unknown>,
      );
      // El producto SÍ puede cambiar mientras es esborrany: el `E-…` (que lo lleva) nace aquí.
      const v = await validarPublicacio(fila.productor_id, d);
      if (v instanceof Response) return v;
      return await publicar(d, v, id);
    } catch (err) {
      console.error("crear-oferta/publicar:", err instanceof Error ? err.message : String(err));
      return responder({ error: "Error interno o JSON inválido" }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // POST — crear la oferta (alta directa)
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
    // «Espigolada» (fase 3): la regla se aplica ANTES de validar, así que los obligatorios, el
    // convenio exigido (el de donación) y la fila dicen lo mismo.
    const d = dadesAmbEspigolada(datos as Record<string, unknown>);
    const v = await validarPublicacio(productorId, d);
    if (v instanceof Response) return v;
    return await publicar(d, v);
  } catch (err) {
    console.error("crear-oferta:", err instanceof Error ? err.message : String(err));
    return responder({ error: "Error interno o JSON inválido" }, 500);
  }
});
