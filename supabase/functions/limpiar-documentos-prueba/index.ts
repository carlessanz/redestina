// Limpieza de los PDF huérfanos que dejan los ciclos de prueba (deudas §12.51 y §12.88).
//
//   POST /limpiar-documentos-prueba  { seco?: boolean }   (JWT de la sesión, super_admin)
//   -> { ok, revisados, huerfanos, borrados, seco, prefijos, bytes, ms }
//
// EL PROBLEMA, EN UNA LÍNEA: `reiniciar_documentos_prova()` y `reiniciar_cierre_prueba()`
// borran las FILAS de `documentos` y devuelven las series a cero, pero SQL no puede
// borrar del bucket. Cada ciclo de ensayo deja sus PDF sueltos en `proves/`: hoy hay tres
// en `proves/2026/PROVA/` (370 KB). Son inalcanzables —bucket privado y sin una sola
// política en `storage.objects`— pero ocupan, y el número crece con cada diciembre.
//
// POR QUÉ UNA FUNCIÓN NUEVA Y NO UNA ACCIÓN EN OTRA:
//   · `generar-documento` y `recordatorios-documentales` se autentican con el secreto
//     compartido, que la base conoce y el navegador no. Quien lanza una limpieza es una
//     persona desde el panel, así que ahí no puede vivir.
//   · `descargar-documento` sí tiene sesión, pero su contrato entero es «la única puerta
//     para LEER un documento, y autoriza documento a documento». Meterle un borrado
//     masivo dentro convierte esa frase en falsa, que es justo lo que hace que una
//     función siga siendo comprensible dentro de un año.
//   · `subir-documento-externo` es de otro dominio.
//
// LAS TRES GUARDAS, Y NINGUNA ES PRESCINDIBLE:
//   1. **Solo rutas de prueba.** Únicamente se mira dentro de `proves/…` y de
//      `<org>/proves/…`, que es exactamente lo que compone `ruta_documento()` con
//      `p_modo = 'prueba'` o con `tipo = 'PROVA'`. Nada fuera de ahí se lista siquiera.
//   2. **Solo huérfanos.** Se borra un objeto cuando NINGUNA fila lo reclama: ni
//      `documentos.ruta`, ni `documentos_externos.ruta`, ni `evidencias.trazo_firma_ruta`.
//      Un fichero con fila detrás es un documento vivo de un ensayo en curso y no se toca.
//      ⚠️ Las tres tablas hacen falta: los externos de un cierre de prueba (la factura que
//      sube el donante) viven bajo `<org>/proves/<ejercicio>/externs/` y NO están en
//      `documentos`; borrarlos rompería la conciliación del ensayo.
//   3. **Sesión de super_admin.** Mismo criterio que `reiniciar_documentos_prova()`, que
//      es la RPC de la que esto es la otra mitad.
//
// Y un `seco: true` que lista sin borrar, porque lo primero que se quiere hacer con algo
// que borra ficheros es mirarlo sin que borre nada.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { contextoUsuario, rolesActivos } from "../_shared/autorizacion.ts";
import { corsPara } from "../_shared/cors.ts";

const BUCKET = "documentos";

/**
 * Las carpetas raíz que puede haber en el bucket. `proves/` es la de los documentos de
 * tipo PROVA (sin organización); las otras dos son las de cada organización, y dentro de
 * cada una **solo** se desciende por su subcarpeta `proves/`.
 */
const RAIZ_PRUEBA = "proves";
const RAICES_ORG = ["productors", "entitats"] as const;

/** Tope de objetos que se listan en una ejecución. El bucket de pruebas no se acerca. */
const MAX_OBJETOS = 2000;
/** Tope de borrados por llamada: `storage.remove` va en tandas de 100. */
const MAX_BORRADOS = 500;
const TANDA = 100;

// deno-lint-ignore no-explicit-any
type Cliente = any;

interface Objeto {
  ruta: string;
  bytes: number;
}

function json(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/**
 * Lista recursivamente lo que cuelga de un prefijo. `storage.list()` no es recursivo: una
 * entrada sin `id` es una carpeta y hay que volver a entrar.
 */
async function listar(
  supabase: Cliente,
  prefijo: string,
  salida: Objeto[],
  profundidad = 0,
): Promise<void> {
  // Las rutas del sistema documental tienen 4-6 niveles; 8 es margen de sobra y a la vez
  // el freno de un bucle si algún día Storage devolviera algo raro.
  if (profundidad > 8 || salida.length >= MAX_OBJETOS) return;
  let desde = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefijo, { limit: TANDA, offset: desde, sortBy: { column: "name", order: "asc" } });
    if (error) {
      console.warn("limpiar-documentos-prueba: list", prefijo, error.message);
      return;
    }
    const filas = (data ?? []) as { name: string; id: string | null; metadata?: { size?: number } }[];
    if (filas.length === 0) return;
    for (const f of filas) {
      const ruta = prefijo ? `${prefijo}/${f.name}` : f.name;
      if (f.id) salida.push({ ruta, bytes: Number(f.metadata?.size ?? 0) });
      else await listar(supabase, ruta, salida, profundidad + 1);
      if (salida.length >= MAX_OBJETOS) return;
    }
    if (filas.length < TANDA) return;
    desde += TANDA;
  }
}

/** Todas las rutas que alguna fila reclama dentro de las carpetas de prueba. */
async function rutasVivas(supabase: Cliente): Promise<Set<string>> {
  const vivas = new Set<string>();
  const anotar = (v: unknown) => {
    const r = typeof v === "string" ? v.trim() : "";
    if (r) vivas.add(r);
  };

  // `like` con dos patrones: `proves/%` (los PROVA) y `%/proves/%` (los de organización).
  const patrones = "ruta.like.proves/%,ruta.like.%/proves/%";

  const [docs, externos] = await Promise.all([
    supabase.from("documentos").select("id, ruta").or(patrones),
    supabase.from("documentos_externos").select("id, ruta").or(patrones),
  ]);
  if (docs.error) throw new Error(`documentos: ${docs.error.message}`);
  if (externos.error) throw new Error(`documentos_externos: ${externos.error.message}`);
  for (const d of (docs.data ?? []) as { ruta: string | null }[]) anotar(d.ruta);
  for (const d of (externos.data ?? []) as { ruta: string | null }[]) anotar(d.ruta);

  // Los trazos de firma se guardan siempre con `p_modo = 'real'` (`rutaTrazo()` en
  // `enlace-publico`), así que hoy no caen dentro de `proves/`. Se preguntan igual: si
  // mañana alguien los guarda con el modo del convenio, esta lista ya los protege, y
  // preguntar cuesta una consulta.
  const evs = await supabase
    .from("evidencias")
    .select("id, trazo_firma_ruta")
    .not("trazo_firma_ruta", "is", null);
  if (evs.error) throw new Error(`evidencias: ${evs.error.message}`);
  for (const e of (evs.data ?? []) as { trazo_firma_ruta: string | null }[]) {
    anotar(e.trazo_firma_ruta);
  }

  return vivas;
}

/** ¿La ruta está dentro de una carpeta de prueba? Es la primera de las tres guardas. */
export function esRutaDePrueba(ruta: string): boolean {
  if (ruta.startsWith(`${RAIZ_PRUEBA}/`)) return true;
  const trozos = ruta.split("/");
  // `<raiz>/<org_id>/proves/…`
  return trozos.length > 3 &&
    (RAICES_ORG as readonly string[]).includes(trozos[0]) &&
    trozos[2] === RAIZ_PRUEBA;
}

Deno.serve(async (req) => {
  const t0 = performance.now();
  const cors = corsPara(req);
  const responder = (body: unknown, status = 200) => json(body, status, cors);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) {
    return responder({ error: "Necesitas iniciar sesión", code: "unauthorized" }, 401);
  }
  // Mismo fail-open que `exigirEquipo()` y que los helpers de RLS (§4bis): con el modelo
  // de roles apagado, la base entera es permisiva y exigir aquí el super_admin dejaría la
  // función inservible en un entorno recién creado desde las migraciones.
  if ((await rolesActivos(supabase)) && ctx.rol !== "super_admin") {
    return responder(
      { error: "Només el super_admin pot netejar els documents de prova", code: "forbidden" },
      403,
    );
  }

  // Cuerpo opcional: un `{}` o incluso nada valen, y significan «borra».
  const cuerpo = await req.json().catch(() => null);
  const seco = cuerpo?.seco === true;

  let vivas: Set<string>;
  try {
    vivas = await rutasVivas(supabase);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("limpiar-documentos-prueba:", msg);
    // Sin la lista de rutas vivas NO se borra nada: la guarda de «solo huérfanos» no se
    // puede evaluar, y borrar sin ella sería borrar documentos de un ensayo en curso.
    return responder({ error: "No s'ha pogut comprovar què està en ús", code: "error_bd" }, 500);
  }

  // Se listan SOLO las carpetas de prueba. Nada de recorrer el bucket entero y filtrar
  // después: lo que no se lista no se puede borrar por error.
  const objetos: Objeto[] = [];
  await listar(supabase, RAIZ_PRUEBA, objetos);
  for (const raiz of RAICES_ORG) {
    const orgs: Objeto[] = [];
    // Un nivel: las carpetas de organización. De cada una solo se entra en `proves/`.
    const { data, error } = await supabase.storage.from(BUCKET).list(raiz, { limit: 1000 });
    if (error) {
      console.warn("limpiar-documentos-prueba: list", raiz, error.message);
      continue;
    }
    for (const f of (data ?? []) as { name: string; id: string | null }[]) {
      if (f.id) continue; // un fichero suelto en la raíz no es de nadie: no se toca
      await listar(supabase, `${raiz}/${f.name}/${RAIZ_PRUEBA}`, orgs);
    }
    objetos.push(...orgs);
  }

  const huerfanos = objetos.filter((o) => esRutaDePrueba(o.ruta) && !vivas.has(o.ruta));
  const aBorrar = huerfanos.slice(0, MAX_BORRADOS);
  const bytes = aBorrar.reduce((s, o) => s + o.bytes, 0);

  let borrados = 0;
  if (!seco) {
    for (let i = 0; i < aBorrar.length; i += TANDA) {
      const tanda = aBorrar.slice(i, i + TANDA).map((o) => o.ruta);
      const { data, error } = await supabase.storage.from(BUCKET).remove(tanda);
      if (error) {
        console.error("limpiar-documentos-prueba: remove:", error.message);
        break;
      }
      borrados += (data ?? []).length;
    }
  }

  const resultado = {
    ok: true,
    seco,
    revisados: objetos.length,
    huerfanos: huerfanos.length,
    borrados,
    bytes,
    limitado: huerfanos.length > MAX_BORRADOS,
    ms: Number((performance.now() - t0).toFixed(1)),
  };
  console.log(JSON.stringify({ fn: "limpiar-documentos-prueba", ...resultado, por: ctx.userId }));
  return responder(resultado, 200);
});
