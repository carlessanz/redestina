// Arnés de verificación de RLS.
//
//   SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... deno run -A scripts/comprobar-rls.ts
//
// Hasta ahora la única comprobación automática del proyecto era `npm run build`
// (tsc), que no sabe nada de políticas: un error en RLS solo se ve en producción,
// y de dos maneras igual de malas —o el equipo se queda sin datos, o un usuario
// externo ve las 452 fichas—. Este script cierra ese agujero.
//
// Cómo funciona: abre una sesión REAL por cada cuenta (con la publishable key, como
// el navegador, así que RLS se aplica igual que en la app), ejecuta la matriz de
// comprobaciones de abajo y saca una tabla PASS/FAIL. Sale con código 1 si algo
// falla, para poder encadenarlo en un despliegue.
//
// Las credenciales NO van en git: se leen de scripts/data/cuentas-prueba.json
// (directorio ignorado, §7) o de la variable de entorno CUENTAS_PRUEBA con el mismo
// contenido. Formato:
//   [{ "etiqueta": "equip", "email": "...", "password": "...", "rol": "equip" }]
//
// El `rol` elige el bloque de la matriz que se le aplica; hay uno por caso del modelo:
// equip · super_admin · productor · receptor · sense_rol · pendent · doble_rol. El
// último es una cuenta con ficha de productor Y de entidad (las crea
// scripts/crear-usuarios-whatsapp.ts), que es lo que la interfaz enseña con los dos
// menús a la vez: aquí se comprueba que ver dos paneles no es ver dos veces la base.
//
// ⚠️ Desde el 31-07-2026 NO HAY CUENTA para `sense_rol` ni para `pendent`: se retiraron
// del juego de prueba junto con el grupo «Control» del login. Sus bloques se quedan aquí
// —son la especificación, no sobran— pero nadie los recorre, así que el arnés pasó de 66
// a 57 comprobaciones. Para volver a cubrirlos basta con dar de alta una organización por
// el registro público (`/registre`), que produce exactamente el caso `pendent`, y añadir
// su credencial abajo:
//   { "etiqueta": "pendent", "email": "hola+pendent-registre@carlessanz.com",
//     "password": "…", "rol": "pendent" }
// Es la cuenta que crea scripts/crear-usuarios-prueba.ts con la membresía
// `aprovacio = 'pendent'` + `activo = false` (su contraseña se imprime al crearla).
//
// Las escrituras solo se prueban sobre filas de prueba (codigo like 'TEST-%') y
// siempre se revierten; si una fila fixture no existe, la comprobación se salta y
// se avisa, en vez de tocar datos reales.
//
// SISTEMA DOCUMENTAL (fase 1, migraciones 20260928*). Se añaden las comprobaciones ya
// alcanzables: el equipo lee `documentos`, `documento_envios` y `series_documentales` y
// no escribe ninguna de las tres; nadie salvo el super_admin emite un documento; y
// `siguiente_numero()` no la puede llamar ni el super_admin desde el navegador —quemar
// un número de una serie legal solo puede pasar dentro de la transacción de una RPC de
// emisión—. Los externos no ven nada porque en la fase 1 `documents_meus()` devuelve
// vacío; cuando la fase 3 la reescriba, esos «denegar» pasan a «permitir, solo los
// suyos» con su `requiereFixture`.
//
// ⚠️ Dos de estas comprobaciones dependen del interruptor `roles_activos` (§4bis): con
//    el interruptor APAGADO —que es como nace cualquier entorno recreado desde las
//    migraciones, incluido el local— `es_super_admin()` devuelve true para cualquier
//    autenticado, así que «el equipo NO emite documentos de prueba» sale en rojo. No es
//    una regresión: es el fail-open deliberado. Contra remoto, donde el interruptor está
//    encendido, pasa.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL");
const publishable = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

if (!url || !publishable) {
  console.error("Faltan SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en el entorno.");
  console.error("Se usa la publishable key a propósito: es la que usa el navegador,");
  console.error("y por tanto la única con la que RLS se comporta como en la app real.");
  Deno.exit(1);
}

// Ya validadas. Hacen falta como `string` a secas porque TypeScript NO propaga a las
// funciones de más abajo el estrechamiento que hace el `if` de aquí arriba: el narrowing
// por flujo de control no cruza a una closure, aunque la variable sea `const`.
const URL_BASE: string = url;
const PUBLISHABLE: string = publishable;

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

interface Cuenta {
  etiqueta: string;
  email: string;
  password: string;
  /** Perfil esperado: decide qué bloque de la matriz se le aplica. */
  rol: "equip" | "super_admin" | "productor" | "receptor" | "sense_rol" | "pendent" | "doble_rol";
}

async function leerCuentas(): Promise<Cuenta[]> {
  const inline = Deno.env.get("CUENTAS_PRUEBA");
  if (inline) return JSON.parse(inline);
  try {
    return JSON.parse(await Deno.readTextFile("scripts/data/cuentas-prueba.json"));
  } catch {
    console.error("No hay cuentas que comprobar.");
    console.error("Crea scripts/data/cuentas-prueba.json (ignorado por git) o exporta CUENTAS_PRUEBA.");
    console.error('Formato: [{ "etiqueta": "equip", "email": "...", "password": "...", "rol": "equip" }]');
    Deno.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Matriz de comprobaciones
// ---------------------------------------------------------------------------

type Op = "leer" | "insertar" | "actualizar" | "borrar" | "rpc";
type Esperado = "permitir" | "denegar";

interface Check {
  /** Tabla, o nombre de la función cuando `op` es `rpc` (sale en el informe). */
  tabla: string;
  op: Op;
  esperado: Esperado;
  /** Solo para `leer`: "denegar" significa 0 filas (RLS filtra, no da error). */
  descripcion: string;
  /** Solo para `rpc`: nombre de la función si no coincide con `tabla`. */
  rpc?: string;
  /**
   * Solo para `leer`+`permitir`: qué fixture hace falta para que esta comprobación
   * signifique algo. Con RLS activa, **0 filas es indistinguible** de «la política me
   * bloquea» y de «no hay nada que ver»: el `select` no da error, simplemente filtra.
   * Así que cuando no hay datos esto se marca SALTADA, no FALLA — afirmar un fallo de
   * permisos sería afirmar más de lo que se sabe. El texto dice qué crear para
   * recuperar la cobertura, y sale en el informe.
   */
  requiereFixture?: string;
  /**
   * Solo para `rpc`: argumentos. El valor literal "@meva_membresia" se sustituye en
   * tiempo de ejecución por el id de la propia membresía —y por el uuid nulo si la
   * cuenta no ve ninguna—, para que la comprobación mida la AUTORIZACIÓN y no un
   * "esa fila no existe" que llegaría igual con permisos de sobra.
   */
  args?: Record<string, unknown>;
  /**
   * Solo para `rpc`+`permitir`: función que deshace lo que la comprobación acaba de
   * crear. Una RPC que se espera que funcione **hace algo**, y el arnés no puede dejar
   * rastro: `emitir_documento_prova` emite un documento de verdad, así que se limpia
   * con `reiniciar_documentos_prova` (que solo toca `modo = 'prueba'`, §documental).
   */
  limpiar?: string;
}

// Lo que CADA rol debe poder hacer. Es la especificación ejecutable de AGENTS.md §4:
// si alguien relaja una política sin querer, aquí sale en rojo.
const MATRIZ: Record<Cuenta["rol"], Check[]> = {
  equip: [
    { tabla: "productores", op: "leer", esperado: "permitir", descripcion: "ve las fichas de productor" },
    { tabla: "entidades", op: "leer", esperado: "permitir", descripcion: "ve las entidades" },
    { tabla: "excedentes", op: "leer", esperado: "permitir", descripcion: "ve todas las ofertas" },
    { tabla: "canalizaciones", op: "leer", esperado: "permitir", descripcion: "ve las canalizaciones" },
    { tabla: "oferta_respuestas", op: "leer", esperado: "permitir", descripcion: "ve las respuestas" },
    { tabla: "wa_messages", op: "leer", esperado: "permitir", descripcion: "ve la mensajería" },
    { tabla: "intake_sessions", op: "leer", esperado: "permitir", descripcion: "ve los intakes en curso" },
    { tabla: "app_settings", op: "leer", esperado: "permitir", descripcion: "lee el modo test" },
    { tabla: "productos", op: "leer", esperado: "permitir", descripcion: "lee el catálogo" },
    { tabla: "app_config", op: "leer", esperado: "denegar", descripcion: "NO lee los secretos" },
    { tabla: "usuario_roles", op: "insertar", esperado: "denegar", descripcion: "NO se puede dar roles a sí mismo" },
    // Sistema documental (fase 1). El equipo lo LEE todo y no escribe nada: un documento
    // nace dentro de la transacción de una RPC, nunca desde el navegador.
    {
      tabla: "documentos",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve los documentos emitidos",
      requiereFixture: "algún documento emitido (super_admin → emitir_documento_prova())",
    },
    { tabla: "series_documentales", op: "leer", esperado: "permitir", descripcion: "ve los contadores de serie" },
    { tabla: "documento_envios", op: "leer", esperado: "permitir", descripcion: "ve los envíos de documentos", requiereFixture: "algún envío registrado (fase 1, al mandar un documento por correo)" },
    { tabla: "documentos", op: "insertar", esperado: "denegar", descripcion: "NO crea documentos a mano (van por RPC)" },
    { tabla: "documentos", op: "actualizar", esperado: "denegar", descripcion: "NO edita un documento emitido" },
    { tabla: "siguiente_numero", op: "rpc", esperado: "denegar", args: { p_serie: "PROVA", p_ejercicio: 1999 }, descripcion: "NO quema números de una serie legal" },
    { tabla: "emitir_documento_prova", op: "rpc", esperado: "denegar", args: { p_fallar: false }, descripcion: "NO emite documentos de prueba (es del super_admin)" },
  ],
  super_admin: [
    { tabla: "productores", op: "leer", esperado: "permitir", descripcion: "ve las fichas de productor" },
    { tabla: "app_settings", op: "actualizar", esperado: "permitir", descripcion: "puede tocar el modo test" },
    { tabla: "app_config", op: "leer", esperado: "denegar", descripcion: "NO lee los secretos" },
    { tabla: "series_documentales", op: "leer", esperado: "permitir", descripcion: "ve los contadores de serie" },
    // La emite de verdad y se limpia acto seguido: es la única comprobación del arnés
    // que ejercita el circuito documental entero (número + snapshot + ruta).
    {
      tabla: "emitir_documento_prova",
      op: "rpc",
      esperado: "permitir",
      args: { p_fallar: false },
      limpiar: "reiniciar_documentos_prova",
      descripcion: "emite un documento de prueba (y lo limpia)",
    },
    { tabla: "siguiente_numero", op: "rpc", esperado: "denegar", args: { p_serie: "PROVA", p_ejercicio: 1999 }, descripcion: "NI el super_admin quema números a mano" },
  ],
  productor: [
    { tabla: "productores", op: "leer", esperado: "permitir", descripcion: "ve SU ficha (solo la suya)" },
    { tabla: "entidades", op: "leer", esperado: "denegar", descripcion: "NO ve las entidades" },
    { tabla: "wa_messages", op: "leer", esperado: "denegar", descripcion: "NO ve la mensajería" },
    { tabla: "wa_contacts", op: "leer", esperado: "denegar", descripcion: "NO ve los contactos" },
    { tabla: "intake_sessions", op: "leer", esperado: "denegar", descripcion: "NO ve los intakes" },
    { tabla: "app_settings", op: "leer", esperado: "denegar", descripcion: "NO ve la configuración" },
    { tabla: "productos", op: "leer", esperado: "permitir", descripcion: "lee el catálogo (lo necesita el alta de oferta)" },
    { tabla: "excedentes", op: "insertar", esperado: "denegar", descripcion: "NO inserta ofertas a mano (van por la Edge Function)" },
    { tabla: "canalizaciones", op: "insertar", esperado: "denegar", descripcion: "NO se canaliza a sí mismo" },
    { tabla: "membresias", op: "actualizar", esperado: "denegar", descripcion: "NO toca su propia membresía (ningún externo se auto-activa)" },
    { tabla: "aprovar_registre", op: "rpc", esperado: "denegar", args: { p_membresia: "@meva_membresia" }, descripcion: "NO valida registros (lo corta pot_aprovar)" },
    // Sistema documental: en la fase 1 `documents_meus()` devuelve vacío, así que un
    // externo no ve NINGÚN documento. Cuando la fase 3 la reescriba, este check pasará
    // a «permitir, solo los suyos» con su fixture.
    { tabla: "documentos", op: "leer", esperado: "denegar", descripcion: "NO ve documentos (fase 1: documents_meus() vacío)" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "NO ve los contadores de serie" },
    { tabla: "siguiente_numero", op: "rpc", esperado: "denegar", args: { p_serie: "PROVA", p_ejercicio: 1999 }, descripcion: "NO puede pedir un número de serie" },
  ],
  // OJO con el receptor: «ve las ofertas compatibles» solo se cumple si existe alguna
  // oferta viva de una modalitat que le encaje (`modalitat_receptor_compat`). Un
  // receptor comercial sin ninguna oferta de venda publicada verá 0, y estará bien: por
  // eso ese check lleva `requiereFixture` y sale como SALTADA en vez de FALLA. La
  // propiedad en sí no queda sin cubrir mientras haya otra cuenta receptora que sí
  // tenga ofertas compatibles (hoy, la social).
  receptor: [
    { tabla: "productores", op: "leer", esperado: "denegar", descripcion: "NO ve las fichas de productor" },
    { tabla: "entidades", op: "leer", esperado: "permitir", descripcion: "ve SU entidad (solo la suya)" },
    {
      tabla: "excedentes",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve las ofertas compatibles",
      requiereFixture: "una oferta publicada de una modalitat compatible con su tipo_receptor",
    },
    { tabla: "wa_messages", op: "leer", esperado: "denegar", descripcion: "NO ve la mensajería" },
    { tabla: "app_settings", op: "leer", esperado: "denegar", descripcion: "NO ve la configuración" },
    { tabla: "oferta_respuestas", op: "insertar", esperado: "denegar", descripcion: "NO escribe respuestas a mano (van por RPC)" },
    { tabla: "canalizaciones", op: "insertar", esperado: "denegar", descripcion: "NO se canaliza a sí mismo" },
    { tabla: "documentos", op: "leer", esperado: "denegar", descripcion: "NO ve documentos (fase 1: documents_meus() vacío)" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "NO ve los contadores de serie" },
    { tabla: "siguiente_numero", op: "rpc", esperado: "denegar", args: { p_serie: "PROVA", p_ejercicio: 1999 }, descripcion: "NO puede pedir un número de serie" },
  ],
  sense_rol: [
    { tabla: "productores", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "entidades", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "excedentes", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "documentos", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
  ],
  // Registro público recién enviado: membresía `aprovacio = 'pendent'` + `activo =
  // false`. No ve NADA —`mis_productores()`/`mis_entidades()` filtran por `activo`, así
  // que ni la ficha de su propia organización—, pero SÍ lee su fila de `membresias`: la
  // política «membresias: meves» no filtra por activo, y esa fila es lo único que la
  // pantalla «pendent de validació» necesita para saber que está esperando.
  pendent: [
    { tabla: "productores", op: "leer", esperado: "denegar", descripcion: "NO ve ninguna ficha, ni la de su organización" },
    { tabla: "entidades", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "excedentes", op: "leer", esperado: "denegar", descripcion: "NO ve ninguna oferta" },
    { tabla: "membresias", op: "leer", esperado: "permitir", descripcion: "ve SU membresía pendiente (pantalla de espera)" },
    { tabla: "membresias", op: "actualizar", esperado: "denegar", descripcion: "NO se activa a sí misma" },
    { tabla: "aprovar_registre", op: "rpc", esperado: "denegar", args: { p_membresia: "@meva_membresia" }, descripcion: "NO se aprueba a sí misma (lo corta pot_aprovar)" },
    { tabla: "documentos", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
  ],
  // Doble rol: una misma cuenta con ficha de productor Y de entidad. Es el caso que la
  // interfaz enseña con los dos menús a la vez, y aquí lo que se comprueba es que ver dos
  // paneles no es ver dos veces la base: sigue viendo SU productor y SU entidad y nada
  // más. Sin esta fila, un fallo de aislamiento en el doble rol pasaría desapercibido.
  doble_rol: [
    { tabla: "productores", op: "leer", esperado: "permitir", descripcion: "ve SU productor" },
    { tabla: "entidades", op: "leer", esperado: "permitir", descripcion: "ve SU entidad" },
    { tabla: "wa_messages", op: "leer", esperado: "denegar", descripcion: "NO ve la mensajería" },
    { tabla: "app_settings", op: "leer", esperado: "denegar", descripcion: "NO ve la configuración" },
    { tabla: "membresias", op: "actualizar", esperado: "denegar", descripcion: "NO toca sus membresías" },
    { tabla: "excedentes", op: "insertar", esperado: "denegar", descripcion: "NO inserta ofertas a mano" },
    { tabla: "aprovar_registre", op: "rpc", esperado: "denegar", args: { p_membresia: "@meva_membresia" }, descripcion: "NO valida registros" },
    { tabla: "documentos", op: "leer", esperado: "denegar", descripcion: "NO ve documentos (fase 1: documents_meus() vacío)" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "NO ve los contadores de serie" },
  ],
};

// Cuerpos mínimos para probar un INSERT que DEBE fallar. Nunca llegan a la base si
// la política está bien; si llegara, la fila se borra en el `finally`.
const FILA_PRUEBA: Record<string, Record<string, unknown>> = {
  excedentes: { producto: "TEST-RLS", estado: "borrador" },
  canalizaciones: { kg_confirmados: 1 },
  oferta_respuestas: { telefono: "34600000000", canal: "panel" },
  usuario_roles: { rol: "super_admin" },
  // `documentos` tiene checks y NOT NULL por todas partes: la fila se rellena entera
  // para que lo que corte sea el permiso y no una restricción de datos (si cortara un
  // check, la comprobación no diría nada sobre RLS). Ejercicio 1999 para que se
  // distinga a simple vista si alguna vez llegara a entrar.
  documentos: {
    tipo: "PROVA",
    objeto_tipo: "prova",
    objeto_id: "00000000-0000-0000-0000-000000000000",
    numero_completo: "TEST-RLS-1999-0001",
    version: 1,
    serie: "PROVA",
    ejercicio: 1999,
    modo: "prueba",
    datos: {},
    sha256_datos: "0".repeat(64),
  },
};

/**
 * Columna inocua con la que probar un UPDATE que debe fallar: se reescribe con su
 * propio valor, así que si el permiso estuviera mal abierto tampoco se estropearía nada.
 */
const COLUMNA_INOCUA: Record<string, string> = {
  documentos: "intentos",
};

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

interface Resultado {
  cuenta: string;
  /** Bloque de la matriz que se le aplicó: agrupa la cobertura por caso del modelo. */
  rol?: Cuenta["rol"];
  check: Check;
  ok: boolean;
  /** true = la tabla no tiene datos, así que la comprobación no demuestra nada. */
  saltada?: boolean;
  detalle: string;
}

/** ¿El error es un rechazo de permisos? (42501 = insufficient_privilege / RLS) */
function esRechazo(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const codigo = error.code ?? "";
  const mensaje = (error.message ?? "").toLowerCase();
  return codigo === "42501" || codigo === "PGRST301" ||
    mensaje.includes("permission denied") || mensaje.includes("row-level security");
}

/** uuid válido pero inexistente: sirve de argumento cuando no hay fila propia que usar. */
const UUID_NULO = "00000000-0000-0000-0000-000000000000";

/** Sustituye los marcadores de los argumentos de una RPC por valores de esta sesión. */
async function resolverArgs(
  cliente: SupabaseClient,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(args)) {
    if (valor === "@meva_membresia") {
      const { data } = await cliente.from("membresias").select("id").limit(1).maybeSingle();
      salida[clave] = data?.id ?? UUID_NULO;
    } else {
      salida[clave] = valor;
    }
  }
  return salida;
}

async function comprobar(cliente: SupabaseClient, check: Check): Promise<{ ok: boolean; detalle: string }> {
  if (check.op === "leer") {
    const { data, error } = await cliente.from(check.tabla).select("*").limit(1);
    if (error) {
      // Un error de permisos con "denegar" esperado es exactamente lo que queremos.
      if (esRechazo(error)) {
        return { ok: check.esperado === "denegar", detalle: `rechazado (${error.code ?? "42501"})` };
      }
      return { ok: false, detalle: `error inesperado: ${error.message}` };
    }
    const filas = data?.length ?? 0;
    // Sin error, RLS simplemente filtra: 0 filas es la forma normal de "denegar".
    if (check.esperado === "denegar") {
      return { ok: filas === 0, detalle: filas === 0 ? "0 filas" : `¡ve ${filas} fila(s)!` };
    }
    return { ok: filas > 0, detalle: filas > 0 ? `${filas} fila(s)` : "0 filas (¿falta fixture?)" };
  }

  if (check.op === "insertar") {
    const fila = FILA_PRUEBA[check.tabla] ?? { nombre: "TEST-RLS" };
    const { data, error } = await cliente.from(check.tabla).insert(fila).select("*");
    if (error) {
      if (esRechazo(error)) {
        return { ok: check.esperado === "denegar", detalle: `rechazado (${error.code ?? "42501"})` };
      }
      // Un check/NOT NULL que salta antes que RLS no demuestra nada: mejor avisar.
      return { ok: check.esperado === "denegar", detalle: `error de datos: ${error.message.slice(0, 60)}` };
    }
    // Si ha entrado, se limpia inmediatamente para no dejar basura.
    const ids = (data ?? []).map((f: Record<string, unknown>) => f.id).filter(Boolean);
    for (const id of ids) await cliente.from(check.tabla).delete().eq("id", id);
    return { ok: check.esperado === "permitir", detalle: "insertado (y revertido)" };
  }

  if (check.op === "actualizar") {
    // `membresias`: leer la fila propia e intentar activarse. Lo corta el GRANT (42501)
    // antes incluso de evaluar RLS —`authenticated` no tiene UPDATE sobre la tabla, §4—,
    // y si algún día lo tuviera, la política tendría que negarlo igual.
    if (check.tabla === "membresias") {
      const { data: fila } = await cliente.from("membresias").select("id, activo").limit(1).maybeSingle();
      if (!fila) return { ok: true, detalle: "sin membresía que probar (saltado)" };
      const { error } = await cliente.from("membresias").update({ activo: true }).eq("id", fila.id);
      if (error) {
        // Se distingue el corte de permisos (42501, lo esperado) de un error posterior
        // —p. ej. el check `aprovacio = 'aprovada' or activo = false`—: los dos impiden
        // la auto-activación, pero solo el primero demuestra que el GRANT está bien.
        return {
          ok: check.esperado === "denegar",
          detalle: esRechazo(error)
            ? `rechazado (${error.code ?? "42501"})`
            : `bloqueado por la base (${error.code ?? "?"})`,
        };
      }
      // Si ha entrado, se deshace: la fila fixture tiene que seguir como estaba.
      await cliente.from("membresias").update({ activo: fila.activo }).eq("id", fila.id);
      return { ok: check.esperado === "permitir", detalle: "¡actualizado! (y revertido)" };
    }
    // Tablas con una columna inocua declarada: se reescribe con su propio valor. Si la
    // cuenta no puede ni leerlas, el UPDATE se lanza igual contra un id inventado —lo
    // que se mide es el GRANT/la política, no que exista la fila—.
    const columna = COLUMNA_INOCUA[check.tabla];
    if (columna) {
      const { data: fila } = await cliente.from(check.tabla).select("*").limit(1).maybeSingle();
      const id = (fila?.id as string) ?? UUID_NULO;
      const valor = fila ? (fila as Record<string, unknown>)[columna] : 0;
      const { error } = await cliente.from(check.tabla)
        .update({ [columna]: valor }).eq("id", id);
      if (error) {
        return {
          ok: check.esperado === "denegar",
          detalle: esRechazo(error)
            ? `rechazado (${error.code ?? "42501"})`
            : `bloqueado por la base (${error.code ?? "?"})`,
        };
      }
      return {
        ok: check.esperado === "permitir",
        detalle: fila ? "actualizado (mismo valor)" : "sin fila que tocar, pero el UPDATE pasó",
      };
    }

    // app_settings es idempotente: se reescribe su valor actual.
    const { data: actual } = await cliente.from(check.tabla).select("key, value").limit(1).maybeSingle();
    if (!actual) return { ok: true, detalle: "sin fila que probar (saltado)" };
    const { error } = await cliente.from(check.tabla)
      .update({ value: actual.value }).eq("key", actual.key);
    if (error) {
      return { ok: check.esperado === "denegar", detalle: `rechazado (${error.code ?? "?"})` };
    }
    return { ok: check.esperado === "permitir", detalle: "actualizado (mismo valor)" };
  }

  if (check.op === "rpc") {
    const funcion = check.rpc ?? check.tabla;
    const { error } = await cliente.rpc(funcion, await resolverArgs(cliente, check.args ?? {}));
    if (error) {
      if (esRechazo(error)) {
        return { ok: check.esperado === "denegar", detalle: `rechazado (${error.code ?? "42501"})` };
      }
      // La función no existe: la migración no está aplicada. No demuestra nada, pero
      // tampoco puede darse por bueno.
      if (error.code === "PGRST202") return { ok: false, detalle: "no existe (¿falta la migración?)" };
      // Cualquier otro error significa que la autorización SÍ dejó pasar y falló algo
      // posterior: para un "denegar" eso es exactamente lo que no debe ocurrir.
      return { ok: check.esperado === "permitir", detalle: `error: ${error.message.slice(0, 60)}` };
    }
    // La RPC ha hecho su trabajo: si deja rastro, se limpia ahora mismo. El arnés no
    // puede añadir filas a la base que audita.
    if (check.limpiar) {
      const { error: errLimpieza } = await cliente.rpc(check.limpiar);
      if (errLimpieza) {
        return { ok: false, detalle: `ejecutada, pero no se pudo limpiar: ${errLimpieza.message.slice(0, 50)}` };
      }
      return { ok: check.esperado === "permitir", detalle: "ejecutada (y limpiada)" };
    }
    return { ok: check.esperado === "permitir", detalle: "ejecutada" };
  }

  return { ok: true, detalle: "operación no implementada (saltada)" };
}

const cuentas = await leerCuentas();
const resultados: Resultado[] = [];

// Tablas que el equipo ve vacías: no tienen filas, punto. Una expectativa de "permitir"
// sobre ellas no demuestra nada, así que se salta en vez de dar un falso negativo (es lo
// que pasa contra una base local recién sembrada, donde no hay ofertas ni mensajes).
// ── Cómo se abre la sesión: login real en remoto, JWT firmado en local ──────────
//
// En el CLI local `[auth.email] enable_signup = false` —que es obligatorio y debe seguir
// así (§9)— arrastra `GOTRUE_EXTERNAL_EMAIL_ENABLED=false` en el contenedor, así que
// `signInWithPassword` responde «Email logins are disabled» para TODAS las cuentas y el
// arnés salía 0/7 contra local sin que hubiera nada roto. No se arregla tocando ese flag:
// además de ser la postura correcta, un `config push` accidental dejaría al equipo fuera
// de producción (§9, «No hacer supabase config push»).
//
// Contra local, entonces, se firma el JWT con el secreto del stack y se evita GoTrue por
// completo. PostgREST valida la firma igual y **RLS se aplica exactamente igual**: lo que
// decide es el `sub` del token, no cómo se obtuvo. Verificado con `get_my_session_context`,
// que devuelve el rol real de cada cuenta.
const esLocal = URL_BASE.includes("127.0.0.1") || URL_BASE.includes("localhost");
const JWT_SECRET_LOCAL = Deno.env.get("SUPABASE_JWT_SECRET") ??
  "super-secret-jwt-token-with-at-least-32-characters-long"; // el del CLI, público

function base64url(entrada: Uint8Array | string): string {
  const bytes = typeof entrada === "string" ? new TextEncoder().encode(entrada) : entrada;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function firmarJwtLocal(userId: string, email: string): Promise<string> {
  const cabecera = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = base64url(JSON.stringify({
    sub: userId,
    email,
    role: "authenticated",
    aud: "authenticated",
    iat: ahora,
    exp: ahora + 3600,
    app_metadata: { provider: "email" },
    user_metadata: {},
  }));
  const clave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET_LOCAL),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const firma = new Uint8Array(
    await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(`${cabecera}.${cuerpo}`)),
  );
  return `${cabecera}.${cuerpo}.${base64url(firma)}`;
}

/** email → uuid de auth.users. Solo en local, y solo para poder firmar el token. */
async function idsLocales(): Promise<Map<string, string>> {
  const secreto = Deno.env.get("SB_SECRET_KEY");
  if (!secreto) {
    console.error("Contra la base local hace falta SB_SECRET_KEY para resolver los uuid.");
    console.error("El login por correo está apagado en el CLI local (§9), así que el arnés");
    console.error("firma el JWT en vez de iniciar sesión. Con `supabase status` tienes la clave.");
    Deno.exit(1);
  }
  const admin = createClient(URL_BASE, secreto, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    console.error("No se pudo listar los usuarios locales:", error.message);
    Deno.exit(1);
  }
  return new Map(data.users.map((u) => [u.email ?? "", u.id]));
}

const idsPorEmail = esLocal ? await idsLocales() : new Map<string, string>();

/** Cliente con la sesión de esa cuenta, o el motivo por el que no se pudo abrir. */
async function abrirSesion(cuenta: Cuenta): Promise<{ cliente?: SupabaseClient; error?: string }> {
  if (esLocal) {
    const id = idsPorEmail.get(cuenta.email);
    if (!id) return { error: `no existe en la base local: ${cuenta.email}` };
    const jwt = await firmarJwtLocal(id, cuenta.email);
    return {
      cliente: createClient(URL_BASE, PUBLISHABLE, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      }),
    };
  }
  const cliente = createClient(URL_BASE, PUBLISHABLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await cliente.auth.signInWithPassword({
    email: cuenta.email,
    password: cuenta.password,
  });
  return error ? { error: error.message } : { cliente };
}

const vacias = new Set<string>();

// El equipo primero: es quien lo ve todo, así que sirve para saber qué tablas están
// vacías de verdad antes de juzgar lo que ven los demás.
const ordenadas = [...cuentas].sort((a, b) => {
  const peso = (c: Cuenta) => (c.rol === "equip" || c.rol === "super_admin" ? 0 : 1);
  return peso(a) - peso(b);
});

for (const cuenta of ordenadas) {
  const { cliente, error: authError } = await abrirSesion(cuenta);
  if (authError || !cliente) {
    // Una cuenta que no existe en ESTA base no es un fallo de permisos: es falta de
    // datos, igual que una tabla vacía (§12.48). Pasa en local con las cuentas que
    // cuelgan de fichas reales del equipo, que el fixture no crea. Sale SALTADA con el
    // motivo, y el aviso de «no las cubre nadie» sigue vigilando la cobertura perdida.
    const ausente = esLocal && (authError ?? "").startsWith("no existe en la base local");
    resultados.push({
      cuenta: cuenta.etiqueta,
      rol: cuenta.rol,
      check: {
        tabla: "—",
        op: "leer",
        esperado: "permitir",
        descripcion: "iniciar sesión",
        ...(ausente ? { requiereFixture: `la cuenta ${cuenta.email} en esta base` } : {}),
      },
      ok: ausente,
      saltada: ausente,
      detalle: authError ?? "sin cliente",
    });
    continue;
  }
  const esEquipo = cuenta.rol === "equip" || cuenta.rol === "super_admin";
  for (const check of MATRIZ[cuenta.rol] ?? []) {
    const { ok, detalle } = await comprobar(cliente, check);
    if (esEquipo && check.op === "leer" && check.esperado === "permitir" && detalle.startsWith("0 filas")) {
      vacias.add(check.tabla);
    }
    // Dos motivos para saltar, y los dos son el mismo argumento: 0 filas no prueba nada.
    // `vacias` cubre la tabla entera sin filas; `requiereFixture`, el subconjunto que esta
    // cuenta debería ver y que hoy no existe (p. ej. un receptor comercial cuando no hay
    // ninguna oferta de venda publicada: `excedentes` tiene filas, pero ninguna suya).
    const sinDatos = check.op === "leer" && check.esperado === "permitir" &&
      detalle.startsWith("0 filas");
    const saltada = (check.op === "leer" && check.esperado === "permitir" &&
      vacias.has(check.tabla)) || (sinDatos && check.requiereFixture !== undefined);
    resultados.push({ cuenta: cuenta.etiqueta, rol: cuenta.rol, check, ok: saltada ? true : ok, saltada, detalle });
  }
  await cliente.auth.signOut();
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

const ancho = {
  cuenta: Math.max(7, ...resultados.map((r) => r.cuenta.length)),
  tabla: Math.max(6, ...resultados.map((r) => r.check.tabla.length)),
};

console.log();
for (const r of resultados) {
  const marca = r.saltada ? " sense" : r.ok ? "  ok  " : " FALLA";
  const detalle = r.saltada
    ? (r.check.tabla === "—" ? r.detalle : "taula buida, no es pot comprovar")
    : r.detalle;
  console.log(
    `${marca}  ${r.cuenta.padEnd(ancho.cuenta)}  ${r.check.tabla.padEnd(ancho.tabla)}  ` +
      `${r.check.op.padEnd(11)}  ${r.check.descripcion}  → ${detalle}`,
  );
}

const fallos = resultados.filter((r) => !r.ok);
const saltadasLista = resultados.filter((r) => r.saltada);
const saltadas = saltadasLista.length;
console.log(
  `\n${resultados.length - fallos.length - saltadas}/${resultados.length - saltadas} ` +
    `comprobaciones correctas` + (saltadas > 0 ? ` (${saltadas} sin datos que comprobar).` : "."),
);

// Qué cobertura falta y cómo recuperarla. Sin esto, una saltada es una línea «sense» que
// nadie sabe interpretar; el arnés debe decir qué crear para que vuelva a medir algo.
if (saltadas > 0) {
  console.log("\nSin datos que comprobar (no es un fallo de permisos: con RLS activa,");
  console.log("0 filas es indistinguible de «no hay nada»). Para recuperar la cobertura:");
  for (const r of saltadasLista) {
    const falta = r.check.requiereFixture ?? `alguna fila en ${r.check.tabla}`;
    console.log(`  · ${r.cuenta} · ${r.check.tabla}: falta ${falta}`);
  }

  // ⚠️ Saltar una comprobación porque UNA cuenta no tiene datos es normal; que la salten
  // TODAS las que la llevan significa que esa propiedad ya no la verifica nadie, y eso
  // se parece demasiado a un fallo de permisos como para pasarlo en una línea gris.
  const clave = (r: { rol?: Cuenta["rol"]; check: Check }) =>
    `${r.rol ?? "?"} · ${r.check.tabla}·${r.check.op}`;
  const totales = new Map<string, number>();
  for (const r of resultados) totales.set(clave(r), (totales.get(clave(r)) ?? 0) + 1);
  const huerfanas = new Set<string>();
  for (const k of new Set(saltadasLista.map(clave))) {
    if (saltadasLista.filter((r) => clave(r) === k).length === totales.get(k)) huerfanas.add(k);
  }
  if (huerfanas.size > 0) {
    console.log("\n⚠️  Y estas no las comprobó NINGUNA cuenta, así que hoy no las cubre nadie:");
    for (const k of huerfanas) console.log(`  · ${k}`);
  }
}

if (fallos.length > 0) {
  console.log("\nRevisa las políticas antes de seguir. Para volver al estado permisivo:");
  console.log("  psql … -f scripts/sql/rls-emergencia.sql   (o pégalo en el SQL Editor)\n");
  Deno.exit(1);
}
console.log("\nSin fallos de permisos.\n");
