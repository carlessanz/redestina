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
// SEGUNDA MITAD DE LA FASE 1 (20260928100100–100700). Entran cinco tablas más:
// `plantillas_documento`, `parametros_documentales`, `enlaces_token`, `evidencias` y
// `municipios`. Tres cosas que aquí se afirman y no se afirmaban en ninguna otra parte:
//
//   1. **Las columnas sensibles no se leen desde el navegador, ni siendo del equipo.**
//      `enlaces_token.token_hash`, `enlaces_token.codigo_hash`,
//      `evidencias.documento_identidad` y `parametros_documentales.apoderada_dni` están
//      fuera del GRANT de SELECT, y eso lo comprueba un check `denegar` que pide esa
//      columna y espera `permission denied for column`. Es fácil de romper sin querer:
//      basta con que alguien vuelva a ejecutar un `grant select on all tables … to
//      authenticated` como el de 20260721160000 y las cuatro quedarían legibles otra vez,
//      **sin que ninguna política cambie**. Sin este check, nadie se enteraría.
//   2. **Escribir el texto de un documento legal es `pot_aprovar()`, no ser del equipo.**
//      El técnico lee las plantillas y no las toca; el super_admin sí.
//   3. **El nomenclátor es catálogo, no dato.** `municipios` la lee cualquier cuenta con
//      sesión, como `productos`: la necesita el formulario de ubicación de un productor.
//
// ⚠️ Los `denegar` de plantillas/parámetros/enlaces/evidencias para cuentas externas
//    llevan `columnas` explícitas a propósito. Con `select *`, en las tablas con GRANT
//    por columnas lo que corta es el GRANT —antes de evaluar ninguna política— y el check
//    saldría verde sin haber probado la RLS. Con la lista explícita, lo que devuelve 0
//    filas es la política, que es lo que se quería medir.
//
// ⚠️ Dos de estas comprobaciones dependen del interruptor `roles_activos` (§4bis): con
//    el interruptor APAGADO —que es como nace cualquier entorno recreado desde las
//    migraciones, incluido el local— `es_super_admin()` devuelve true para cualquier
//    autenticado, así que «el equipo NO emite documentos de prueba» sale en rojo. No es
//    una regresión: es el fail-open deliberado. Contra remoto, donde el interruptor está
//    encendido, pasa.

// ALBARANES Y ESPIGOLADA (fase 3, migraciones 20261012*). Entran seis tablas más
// —`albaranes`, `albaran_lineas`, `espigoladas`, `documentos_externos`, `tipos_caja` y
// `costes_producto`— y con ellas la primera afirmación de pertenencia REAL del sistema
// documental: hasta la fase 3, `documents_meus()` devolvía vacío y todos los «denegar» de
// los externos salían verdes sin que nadie hubiera escrito una política. Ahora sí hay algo
// que ver, y lo que se comprueba es que cada cual ve **lo suyo**:
//
//   · el productor ve su REC (el albarán de recepción de su espigolada)
//   · la entidad ve sus ENT, y NO ve la espigolada de la que salieron —quién más recibió
//     de la misma jornada no es asunto suyo—
//   · nadie fuera del equipo ve `costes_producto`: el coste por kilo con el que se valora
//     una donación es información interna, y el donante ve el valor de SU certificado, no
//     la tabla
//   · **nadie ve importes en un albarán, porque no existen**: `albaran_lineas` no tiene
//     ninguna columna de dinero. Eso lo afirma un check con `columnaAusente`, que espera
//     `42703 undefined_column`. Es la única forma de comprobar una ausencia: si alguien
//     añadiera un `coste_kg` a la tabla «para tenerlo a mano», el arnés se pondría rojo
//     antes de que ese importe llegara a imprimirse en ningún PDF.
//
// ⚠️ Estas comprobaciones necesitan el fixture de `scripts/crear-datos-documentales-prueba.ts`
//    (la espigolada de 1.000 kg del plan). Sin él salen SALTADAS, no rojas: 0 filas no
//    distingue «la política me bloquea» de «no hay nada» (§12.48).
//
// ⚠️ LO QUE ESTE ARNÉS NO PUEDE AFIRMAR, y conviene saberlo: mide «ve algo / no ve nada»,
//    no «ve exactamente lo suyo». Que `productor-altre` (TEST-PROD-2, sin albaranes) salga
//    SALTADA es correcto; que viera el REC de TEST-PROD-1 saldría verde igual. Es la misma
//    limitación que ya tenían los checks de `productores` y `entidades`, y la cubre el
//    fixture: TEST-PROD-2 no tiene ninguno, así que un escape se vería como una saltada
//    que de pronto pasa a ok.

// CIERRE ANUAL Y CERTIFICADOS (fase 4, migraciones 20261109*). Tres tablas más
// —`cierres_ejercicio`, `cierres_donante`, `cierre_donante_lineas`— y once RPC. Lo que
// aquí se afirma y no se afirmaba en ninguna otra parte:
//
//   1. **Ninguna de las tres tablas tiene GRANT de escritura para nadie.** El importe de
//      un certificado no cambia con un `update` desde el navegador, ni siendo super_admin:
//      se recalcula o no cambia. Lo comprueba un `insertar` que espera 42501.
//   2. **El donante ve SU acumulado anual, y solo el suyo.** Es la primera vez que un
//      externo lee una cifra con efecto fiscal, y la regla tiene un matiz que ninguna otra
//      tabla tiene: los cierres de **prueba** los ve únicamente si su ficha es `es_test`
//      (`cierres_donante_meus()`), porque un donante real no debe encontrarse en su panel
//      un acumulado que no vale nada. Que un receptor o una cuenta de doble rol vean 0 es
//      una política, no falta de datos: el fixture crea el cierre y el equipo lo ve.
//   3. **Abrir el cierre REAL es del super_admin, no del equipo.** Es el acto que consume
//      las series legales de un año.
//
// ⚠️ `abrir_cierre` NO se prueba como «permitir» en ningún bloque: dejaría una cabecera de
//    cierre en la base y no hay RPC que la borre (a propósito: un cierre tiene número, no
//    es una fila desechable). Lo que se prueba del lado del super_admin son las RPC que
//    **no dejan rastro cuando el objeto no existe** —`reiniciar_cierre_prueba`,
//    `conciliacion_retroactiva` y `cerrar_cierre` sobre un uuid inventado—: la autorización
//    pasa y la función falla después con 22023, que el arnés lee como «dejó pasar». Por eso
//    tampoco se comprueba aquí que cerrar el cierre REAL exija `es_super_admin()`: haría
//    falta una cabecera de verdad en la base. Eso lo verifican las pruebas SQL de
//    20261109100300, dentro de una transacción con rollback.

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
   * Columnas que se piden en un `leer` (o en la lectura previa de un `actualizar`).
   * Por defecto `*`, que es lo que hace la app. Hace falta declararlas en las tablas con
   * **GRANT por columnas** —`enlaces_token`, `evidencias`, `parametros_documentales`—,
   * porque ahí `select *` lo corta el GRANT antes de que RLS diga nada: la comprobación
   * mediría el permiso de columna y no la política. Con la lista explícita se mide lo que
   * se quería medir, y la columna sensible se comprueba **aparte**, con su propio check
   * `denegar` (que sí debe salir `permission denied for column`).
   */
  columnas?: string;
  /**
   * Solo para `rpc`+`permitir`: función que deshace lo que la comprobación acaba de
   * crear. Una RPC que se espera que funcione **hace algo**, y el arnés no puede dejar
   * rastro: `emitir_documento_prova` emite un documento de verdad, así que se limpia
   * con `reiniciar_documentos_prova` (que solo toca `modo = 'prueba'`, §documental).
   */
  limpiar?: string;
  /** Argumentos de `limpiar`, cuando la función de limpieza los necesita. */
  limpiarArgs?: Record<string, unknown>;
  /**
   * Solo para `leer`+`denegar`: la comprobación afirma que **la columna no existe** en la
   * tabla (se espera `42703 undefined_column`), no que esté prohibida. Es como se verifica
   * que `albaran_lineas` no tiene ninguna columna de importe: una ausencia no se puede
   * comprobar de otra manera, y sin esto nadie se enteraría el día que alguien añada un
   * `coste_kg` «para tenerlo a mano».
   */
  columnaAusente?: boolean;
}

// El bloque documental de CUALQUIER cuenta que no sea del equipo, sea cual sea su tipo.
// Se escribe una vez y se reparte a los cinco perfiles externos: es literalmente la misma
// afirmación en todos («nada del sistema documental es suyo salvo el nomenclátor»), y
// repetirla cinco veces garantizaría que algún día se actualicen cuatro.
//
// `columnas` en `enlaces_token` y `evidencias` no es un detalle: sin ella, `select *` lo
// cortaría el GRANT por columnas y la comprobación diría «rechazado» sin haber llegado a
// evaluar la política. Con la lista explícita, lo que rechaza es la RLS, que es lo que se
// quiere verificar.
const DOCUMENTAL_EXTERN: Check[] = [
  { tabla: "plantillas_documento", op: "leer", esperado: "denegar", descripcion: "NO ve las plantillas de documento" },
  {
    tabla: "parametros_documentales",
    op: "leer",
    esperado: "denegar",
    columnas: "id, razon_social, cif",
    descripcion: "NO ve los parámetros documentales",
  },
  {
    tabla: "enlaces_token",
    op: "leer",
    esperado: "denegar",
    columnas: "id, estado",
    descripcion: "NO ve ningún enlace (los suyos los tiene en el correo)",
  },
  {
    tabla: "evidencias",
    op: "leer",
    esperado: "denegar",
    columnas: "id, tipo",
    descripcion: "NO ve ninguna evidencia de firma",
  },
  // El coste por kilo es interno: el donante ve el valor de SU certificado, no la tabla
  // con la que se valora toda la base.
  { tabla: "costes_producto", op: "leer", esperado: "denegar", descripcion: "NO ve los costes por kilo" },
  { tabla: "costes_producto_hist", op: "leer", esperado: "denegar", descripcion: "NO ve el histórico de costes" },
  { tabla: "fijar_coste_producto", op: "rpc", esperado: "denegar", args: { p_producto: "Tomàquet", p_ejercicio: 1999, p_coste: 1, p_motivo: "arnes" }, descripcion: "NO fija costes por kilo" },
  // Los envases sí: son catálogo, como `productos` y `municipios`, y los necesita el alta
  // de una oferta.
  { tabla: "tipos_caja", op: "leer", esperado: "permitir", descripcion: "lee el catálogo de envases" },
  { tabla: "emitir_albaran", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emite albaranes" },
  { tabla: "conciliar_albaran", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO concilia albaranes" },
  { tabla: "albaranes", op: "insertar", esperado: "denegar", descripcion: "NO crea albaranes a mano (van por RPC)" },
  // Cierre anual (fase 4). Aquí solo lo que vale para CUALQUIER externo; que el donante
  // vea SU fila de `cierres_donante` se comprueba en el bloque `productor`.
  { tabla: "cierres_ejercicio", op: "leer", esperado: "denegar", descripcion: "NO ve los cierres de ejercicio" },
  { tabla: "cierres_donante", op: "insertar", esperado: "denegar", descripcion: "NO escribe en el cierre (no hay GRANT)" },
  { tabla: "abrir_cierre", op: "rpc", esperado: "denegar", args: { p_ejercicio: 2020, p_modo: "prueba" }, descripcion: "NO obre cap tancament" },
  { tabla: "calcular_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO calcula un cierre" },
  { tabla: "emitir_certificado", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet certificats de donació" },
  { tabla: "conciliacion_retroactiva", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_kg: 1, p_motivo: "arnes" }, descripcion: "NO concilia res a posteriori" },
  { tabla: "reiniciar_cierre_prueba", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO reinicia un cierre de prueba" },
  { tabla: "datos_182", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO exporta los datos del 182" },
  { tabla: "cerrar_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO tanca cap exercici" },
  // El puente que usa `subir-documento-externo` para decidir si alguien puede adjuntar un
  // fichero a un albarán o a un cierre. Dos afirmaciones distintas:
  //   - preguntar por OTRA persona se corta con 42501, aunque la respuesta fuera «no».
  //     Sin esto, cualquiera podría mapear a qué objetos tiene acceso quien sea.
  //   - preguntar por uno mismo se puede siempre: la respuesta es un booleano, y sobre un
  //     uuid inventado es `false`. Lo que se verifica aquí es que no da error, no el valor
  //     (el valor lo comprueban las pruebas SQL de la migración, que sí pueden mirar el
  //     objeto de cada cuenta).
  {
    tabla: "puc_pujar_document_extern",
    op: "rpc",
    esperado: "denegar",
    args: {
      p_objeto_tipo: "cierre_donante",
      p_objeto_id: "00000000-0000-0000-0000-000000000000",
      p_user: "00000000-0000-0000-0000-0000000000ff",
    },
    descripcion: "NO pregunta els permisos d'una altra persona",
  },
  {
    tabla: "puc_pujar_document_extern",
    op: "rpc",
    esperado: "permitir",
    args: { p_objeto_tipo: "cierre_donante", p_objeto_id: "00000000-0000-0000-0000-000000000000" },
    descripcion: "pot preguntar pels SEUS permisos (respon false, sense error)",
  },
  // Convenios (fase 2). Un externo LEE lo suyo y **no mueve ninguna pieza del ciclo de
  // firma**: ni prepara, ni envía, ni contrafirma, ni resuelve. Las dos que solo puede
  // llamar el servidor —firmar por enlace y validar el código— tampoco: quien firma no
  // tiene sesión, así que si `authenticated` pudiera llamarlas, cualquier cuenta podría
  // firmar un convenio ajeno conociendo el uuid de su enlace.
  { tabla: "convenios_exigidos", op: "leer", esperado: "permitir", descripcion: "lee la matriz de convenios exigidos (catálogo)" },
  { tabla: "convenios", op: "insertar", esperado: "denegar", descripcion: "NO crea convenios a mano (van por RPC)" },
  {
    tabla: "convenio_vigente",
    op: "rpc",
    esperado: "permitir",
    args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_valorizacion: "donacio", p_parte: "entrega" },
    descripcion: "pot consultar si li cal conveni (respon false, sense error)",
  },
  { tabla: "preparar_convenio", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_tipo: "don_gen" }, descripcion: "NO prepara convenis" },
  { tabla: "enviar_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO envia convenis a firmar" },
  { tabla: "contrafirmar_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO contrasigna cap conveni" },
  { tabla: "retornar_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO retorna cap conveni" },
  { tabla: "resolver_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO resol cap conveni" },
  { tabla: "iniciar_firma_asistida", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO obre cap firma assistida" },
  { tabla: "firmar_convenio_por_enlace", op: "rpc", esperado: "denegar", args: { p_enlace: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO firma per enllaç (això és del servidor)" },
  { tabla: "validar_codi_firma", op: "rpc", esperado: "denegar", args: { p_enlace: "00000000-0000-0000-0000-000000000000", p_codi: "000000" }, descripcion: "NO valida el codi de firma (això és del servidor)" },
  { tabla: "aprovar_resposta", op: "rpc", esperado: "denegar", args: { p_resposta: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO aprova cap resposta a una oferta" },
  // Plan de prevención (fase 5). Un externo LEE el suyo —eso va en su bloque, con su
  // `requiereFixture`— y no escribe nada: ni la tabla ni el cuestionario de otra
  // organización. `guardar_plan_basico` sobre un uuid ajeno corta en `puc_gestionar_pla()`,
  // que es la comprobación que de verdad separa «el meu qüestionari» de «el d'algú altre».
  //
  // ⚠️ `plan_emet_document` NO se comprueba aquí, y no por olvido: tiene el EXECUTE
  //    revocado a `authenticated`, así que PostgREST ni la ve y devolvería `PGRST202`
  //    —indistinguible de «falta la migración»—. Que sea inalcanzable lo garantiza el
  //    `revoke` de 20270301100200, no un check.
  { tabla: "planes_prevencion", op: "insertar", esperado: "denegar", descripcion: "NO crea plans a mà (van per RPC)" },
  {
    tabla: "guardar_plan_basico",
    op: "rpc",
    esperado: "denegar",
    args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_respuestas: {} },
    descripcion: "NO contesta el qüestionari d'una altra organitzacio",
  },
  {
    tabla: "planes_meus",
    op: "rpc",
    esperado: "denegar",
    args: { p_user: "00000000-0000-0000-0000-0000000000ff" },
    descripcion: "NO consulta els plans d'una altra persona",
  },
  // Certificado de transacción (fase 5): la misma regla que el de donación. Las dos son
  // de `pot_aprovar()`, así que un externo no llega ni a la comprobación siguiente.
  { tabla: "calcular_cierre_transacciones", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO calcula les transaccions d'un tancament" },
  { tabla: "emitir_certificado_transaccion", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet certificats de transaccio" },
];

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
    // Plantillas: el técnico las LEE (necesita saber con qué texto se emite) pero no las
    // escribe. Escribir el texto de un documento legal es `pot_aprovar()`, como aprobar
    // una canalización.
    { tabla: "plantillas_documento", op: "leer", esperado: "permitir", descripcion: "ve las plantillas de documento" },
    { tabla: "plantillas_documento", op: "insertar", esperado: "denegar", descripcion: "NO publica plantillas (es de pot_aprovar)" },
    { tabla: "plantillas_documento", op: "actualizar", esperado: "denegar", descripcion: "NO edita plantillas (es de pot_aprovar)" },
    // Parámetros: se leen todos MENOS el DNI de la apoderada, y no los toca nadie que no
    // sea super_admin (cambian lo que dirán todos los documentos futuros).
    {
      tabla: "parametros_documentales",
      op: "leer",
      esperado: "permitir",
      columnas: "id, razon_social, cif, caducidad_enlace_dias, datos_provisionales",
      descripcion: "ve los parámetros documentales",
    },
    {
      tabla: "parametros_documentales",
      op: "leer",
      esperado: "denegar",
      columnas: "apoderada_dni",
      descripcion: "NI el equipo lee el DNI de la apoderada (GRANT por columnas)",
    },
    {
      tabla: "parametros_documentales",
      op: "actualizar",
      esperado: "denegar",
      columnas: "id, caducidad_enlace_dias",
      descripcion: "NO cambia los parámetros (es del super_admin)",
    },
    // Enlaces y evidencias: el equipo ve el estado, nunca las credenciales ni el DNI.
    {
      tabla: "enlaces_token",
      op: "leer",
      esperado: "permitir",
      columnas: "id, proposito, estado, caduca_at",
      descripcion: "ve el estado de los enlaces",
      requiereFixture: "algún enlace emitido (fase 2/3: firma de convenio o confirmación de albarán)",
    },
    {
      tabla: "enlaces_token",
      op: "leer",
      esperado: "denegar",
      columnas: "token_hash",
      descripcion: "NI el equipo lee el hash del token (GRANT por columnas)",
    },
    {
      tabla: "evidencias",
      op: "leer",
      esperado: "permitir",
      columnas: "id, tipo, nombre, created_at",
      descripcion: "ve las evidencias de firma",
      requiereFixture: "alguna evidencia registrada (fase 2/3, al abrir o firmar un enlace)",
    },
    {
      tabla: "evidencias",
      op: "leer",
      esperado: "denegar",
      columnas: "documento_identidad",
      descripcion: "NI el equipo lee el DNI de quien firma (GRANT por columnas)",
    },
    { tabla: "municipios", op: "leer", esperado: "permitir", descripcion: "lee el nomenclátor" },
    // Albaranes y espigolada (fase 3). El equipo lo LEE todo y no escribe nada a mano:
    // emitir, conciliar, anular y rectificar mueven varias tablas a la vez y son RPC.
    {
      tabla: "albaranes",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve los albaranes",
      requiereFixture: "la espigolada de prueba (deno run -A scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "albaran_lineas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve las líneas y sus kilos",
      requiereFixture: "la espigolada de prueba (scripts/crear-datos-documentales-prueba.ts)",
    },
    // La ausencia que hay que vigilar: en un albarán no hay importes. Si algún día
    // apareciera una columna de dinero aquí, esto se pondría rojo antes de que llegara a
    // imprimirse en un PDF.
    {
      tabla: "albaran_lineas",
      op: "leer",
      esperado: "denegar",
      columnas: "id, coste_kg",
      columnaAusente: true,
      descripcion: "un albarán NO tiene importes (la columna no existe)",
    },
    {
      tabla: "espigoladas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve las espigoladas",
      requiereFixture: "la espigolada de prueba (scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "costes_producto",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve los costes por kilo",
      requiereFixture: "algún coste fijado (scripts/crear-datos-documentales-prueba.ts)",
    },
    { tabla: "tipos_caja", op: "leer", esperado: "permitir", descripcion: "ve el catálogo de envases" },
    {
      tabla: "documentos_externos",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve los documentos aportados por terceros",
      requiereFixture: "algún adjunto subido (Edge Function subir-documento-externo, fase 3)",
    },
    { tabla: "albaranes", op: "insertar", esperado: "denegar", descripcion: "NO crea albaranes a mano (van por RPC)" },
    { tabla: "espigoladas", op: "insertar", esperado: "denegar", descripcion: "NO crea espigoladas a mano (van por RPC)" },
    { tabla: "costes_producto", op: "insertar", esperado: "denegar", descripcion: "NO escribe costes a mano" },
    // Fijar el coste por kilo es `pot_aprovar()`, no ser del equipo: es una decisión
    // económica, como aprobar una canalización.
    {
      tabla: "fijar_coste_producto",
      op: "rpc",
      esperado: "denegar",
      args: { p_producto: "Tomàquet", p_ejercicio: 1999, p_coste: 1, p_motivo: "arnes" },
      descripcion: "NO fija el coste por kilo (es de pot_aprovar)",
    },
    {
      tabla: "fijar_tipo_caja",
      op: "rpc",
      esperado: "denegar",
      args: { p_codigo: "TEST-ARNES", p_tara: 1 },
      descripcion: "NO fija la tara de un envase (es de pot_aprovar)",
    },
    // Cierre anual (fase 4). El equipo lo LEE todo y no escribe ninguna de las tres
    // tablas: los kilos y el importe de un certificado nacen dentro de una RPC o no nacen.
    {
      tabla: "cierres_ejercicio",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve los cierres de ejercicio",
      requiereFixture: "un cierre de prueba de 2026 (scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "cierres_donante",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve el acumulado anual de todos los donantes",
      requiereFixture: "un cierre de prueba calculado (scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "cierre_donante_lineas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve el detalle que sostiene la cifra",
      requiereFixture: "un cierre de prueba calculado (scripts/crear-datos-documentales-prueba.ts)",
    },
    { tabla: "cierres_ejercicio", op: "insertar", esperado: "denegar", descripcion: "NO abre cierres a mano (van por RPC)" },
    { tabla: "cierres_donante", op: "insertar", esperado: "denegar", descripcion: "NO toca el acumulado de un donante" },
    // El técnico no puede aprobar, así que ninguna acción del cierre es suya. La de `real`
    // además es del super_admin: es la que consume las series legales del año.
    { tabla: "abrir_cierre", op: "rpc", esperado: "denegar", args: { p_ejercicio: 2020, p_modo: "real" }, descripcion: "NO obre el tancament REAL (és del super_admin)" },
    { tabla: "calcular_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO calcula un cierre (es de pot_aprovar)" },
    // El botón «Tanca l'exercici» tampoco es del técnico: cerrar emite los resúmenes
    // definitivos y congela el cálculo. Mismo `pot_aprovar()` que calcular.
    { tabla: "cerrar_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO tanca un exercici (és de pot_aprovar)" },
    { tabla: "emitir_certificado", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet certificats (és de pot_aprovar)" },
    { tabla: "conciliacion_retroactiva", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_kg: 1, p_motivo: "arnes" }, descripcion: "NO concilia a posteriori (és de pot_aprovar)" },
    // Consultar los datos del 182 sí: es una lectura, y la hace el equipo con la gestoría.
    { tabla: "datos_182", op: "rpc", esperado: "permitir", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot consultar les dades del 182" },
    // Certificado de transacción (fase 5): calcular y emitir son de `pot_aprovar()`, igual
    // que en el circuito de donación. El técnico ve las filas y no mueve ninguna.
    { tabla: "calcular_cierre_transacciones", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO calcula les transaccions (és de pot_aprovar)" },
    { tabla: "emitir_certificado_transaccion", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet certificats de transaccio (és de pot_aprovar)" },
    // Plan de prevención (fase 5). El equipo lo ve todo y **sí** puede contestar el
    // cuestionario de cualquier organización: el diagnóstico es un servicio asistido. Lo
    // que se comprueba es la autorización (`puc_gestionar_pla`), no el guardado: guardar
    // dejaría un borrador en la base y el arnés no puede añadir filas a lo que audita.
    {
      tabla: "planes_prevencion",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve els plans de prevencio",
      requiereFixture: "algún plan emitido (scripts/crear-datos-documentales-prueba.ts)",
    },
    { tabla: "planes_prevencion", op: "insertar", esperado: "denegar", descripcion: "NO crea plans a mà (van per RPC)" },
    {
      tabla: "puc_gestionar_pla",
      op: "rpc",
      esperado: "permitir",
      args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot contestar el qüestionari de qualsevol organitzacio (model assistit)",
    },
    // Convenios (fase 2). El equipo lo LEE todo, prepara y envía; **contrasignar, retornar
    // y resolver son de `pot_aprovar()`**, como aprobar una canalización: es el punto de
    // control humano del circuito de firma, no una tarea del día a día.
    {
      tabla: "convenios",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve els convenis",
      requiereFixture: "algún convenio (scripts/crear-datos-documentales-prueba.ts)",
    },
    { tabla: "convenios_exigidos", op: "leer", esperado: "permitir", descripcion: "ve la matriu de convenis exigits" },
    { tabla: "convenios", op: "insertar", esperado: "denegar", descripcion: "NO crea convenis a mà (van per RPC)" },
    {
      tabla: "v_campanya_convenis",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve el seguiment de la campanya",
      requiereFixture: "alguna organización activa (las fichas TEST-* del fixture)",
    },
    {
      tabla: "v_fitxes_incompletes_conveni",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve què falta a cada fitxa per al conveni",
      requiereFixture: "alguna organización activa (las fichas TEST-* del fixture)",
    },
    // Preparar sí: es el paso 2 de la campaña y lo hace el dinamizador. Sobre una
    // organización que no existe, la autorización pasa y el insert falla con la FK, así
    // que no deja ni una fila detrás (mismo truco que `reiniciar_cierre_prueba`).
    {
      tabla: "preparar_convenio",
      op: "rpc",
      esperado: "permitir",
      args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_tipo: "don_gen" },
      descripcion: "pot preparar un conveni (autoritza; l'organització no existeix)",
    },
    { tabla: "contrafirmar_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO contrasigna (és de pot_aprovar)" },
    { tabla: "retornar_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO retorna un conveni (és de pot_aprovar)" },
    { tabla: "resolver_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO resol un conveni (és de pot_aprovar)" },
    // Y NI EL EQUIPO firma por nadie: `firmar_convenio_por_enlace` y `validar_codi_firma`
    // son solo de `service_role`. Es lo que hace que una firma acredite algo: si el equipo
    // pudiera invocarla, el registro de evidencias no distinguiría a quien firmó de quien
    // tenía el panel abierto.
    { tabla: "firmar_convenio_por_enlace", op: "rpc", esperado: "denegar", args: { p_enlace: "00000000-0000-0000-0000-000000000000" }, descripcion: "NI l'equip firma per algú (només el servidor)" },
    { tabla: "validar_codi_firma", op: "rpc", esperado: "denegar", args: { p_enlace: "00000000-0000-0000-0000-000000000000", p_codi: "000000" }, descripcion: "NI l'equip valida el codi (només el servidor)" },
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
    { tabla: "plantillas_documento", op: "leer", esperado: "permitir", descripcion: "ve las plantillas de documento" },
    // La contraparte del «denegar» del técnico: alguien tiene que poder tocarlas, y es
    // quien puede aprobar. Se reescribe `vigente` con su propio valor, así que la
    // plantilla queda exactamente igual.
    { tabla: "plantillas_documento", op: "actualizar", esperado: "permitir", descripcion: "puede retirar o publicar plantillas" },
    {
      tabla: "parametros_documentales",
      op: "actualizar",
      esperado: "permitir",
      columnas: "id, caducidad_enlace_dias",
      descripcion: "puede tocar los parámetros documentales",
    },
    // La contraparte del «denegar» del técnico. Se fija un coste en el ejercicio **1999**
    // —imposible, ningún cierre lo mirará— y se borra acto seguido con
    // `borrar_coste_producto`, que existe también para eso: un coste fijado en el año
    // equivocado no tenía hasta ahora ninguna vuelta atrás.
    {
      tabla: "fijar_coste_producto",
      op: "rpc",
      esperado: "permitir",
      args: { p_producto: "Tomàquet", p_ejercicio: 1999, p_coste: 1, p_motivo: "Comprobación del arnés de RLS" },
      limpiar: "borrar_coste_producto",
      // `p_motivo` es obligatorio desde 20261109100500: borrar un coste deja fila en
      // `costes_producto_hist` con el motivo, igual que sobrescribirlo.
      limpiarArgs: { p_producto: "Tomàquet", p_ejercicio: 1999, p_motivo: "Limpieza del arnés de RLS" },
      descripcion: "puede fijar el coste por kilo (y lo borra)",
    },
    // Cierre anual (fase 4). Sobre un uuid inventado: la autorización pasa y la función
    // falla después con 22023 («aquest tancament no existeix»), que es lo que el arnés lee
    // como «dejó pasar», sin dejar ni una fila detrás. Ver la advertencia de la cabecera
    // sobre por qué `abrir_cierre` no se prueba nunca como «permitir».
    {
      tabla: "reiniciar_cierre_prueba",
      op: "rpc",
      esperado: "permitir",
      args: { p_cierre: "00000000-0000-0000-0000-000000000000" },
      descripcion: "puede reiniciar un cierre de prueba (autoriza; el cierre no existe)",
    },
    {
      tabla: "conciliacion_retroactiva",
      op: "rpc",
      esperado: "permitir",
      args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_kg: 1, p_motivo: "Comprobación del arnés de RLS" },
      descripcion: "puede conciliar a posteriori (autoriza; la canalización no existe)",
    },
    // Cerrar un ejercicio, por el mismo camino y por el mismo motivo: sobre un uuid
    // inventado la autorización pasa y la función falla con 22023 sin dejar rastro. Que un
    // cierre REAL exija además `es_super_admin()` no se puede comprobar aquí —haría falta
    // una cabecera real en la base, que es justo lo que ningún arnés debe crear—: lo
    // verifican las pruebas SQL de 20261109100300, en una transacción con rollback.
    {
      tabla: "cerrar_cierre",
      op: "rpc",
      esperado: "permitir",
      args: { p_cierre: "00000000-0000-0000-0000-000000000000" },
      descripcion: "puede cerrar un ejercicio (autoriza; el cierre no existe)",
    },
    {
      tabla: "cierres_donante",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve el acumulado anual de todos los donantes",
      requiereFixture: "un cierre de prueba calculado (scripts/crear-datos-documentales-prueba.ts)",
    },
    // Certificado de transacción (fase 5): la contraparte de los dos «denegar» del
    // técnico. Sobre un uuid inventado la autorización pasa y la función falla después con
    // 22023, sin dejar rastro: emitir uno de verdad consumiría un número de la serie CT.
    {
      tabla: "calcular_cierre_transacciones",
      op: "rpc",
      esperado: "permitir",
      args: { p_cierre: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot calcular les transaccions (autoritza; el tancament no existeix)",
    },
    {
      tabla: "emitir_certificado_transaccion",
      op: "rpc",
      esperado: "permitir",
      args: { p_cd: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot emetre un certificat de transaccio (autoritza; l'acumulat no existeix)",
    },
    {
      tabla: "planes_prevencion",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve els plans de prevencio",
      requiereFixture: "algún plan emitido (scripts/crear-datos-documentales-prueba.ts)",
    },
    // Convenios (fase 2): la contraparte de los tres «denegar» del técnico. Sobre un uuid
    // inventado la autorización pasa y la función falla después con 22023 («aquest conveni
    // no existeix»), sin dejar rastro: contrafirmar uno de verdad emitiría un documento con
    // número, que es exactamente lo que un arnés no debe crear.
    {
      tabla: "contrafirmar_convenio",
      op: "rpc",
      esperado: "permitir",
      args: { p_id: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot contrasignar un conveni (autoritza; el conveni no existeix)",
    },
    {
      tabla: "resolver_convenio",
      op: "rpc",
      esperado: "permitir",
      args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "Comprobación del arnés de RLS" },
      descripcion: "pot resoldre un conveni (autoritza; el conveni no existeix)",
    },
    {
      tabla: "convenios",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve tots els convenis",
      requiereFixture: "algún convenio (scripts/crear-datos-documentales-prueba.ts)",
    },
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
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "NO ve los contadores de serie" },
    { tabla: "siguiente_numero", op: "rpc", esperado: "denegar", args: { p_serie: "PROVA", p_ejercicio: 1999 }, descripcion: "NO puede pedir un número de serie" },
    ...DOCUMENTAL_EXTERN,
    // Albaranes (fase 3): el productor ve SU albarán de recepción y sus líneas. Es la
    // primera vez que `documents_meus()` devuelve algo, y por tanto la primera vez que
    // estos «permitir» significan algo.
    {
      tabla: "albaranes",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve SUS albaranes de recepción",
      requiereFixture: "un REC emitido de TEST-PROD-1 (scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "albaran_lineas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve las líneas de SUS albaranes",
      requiereFixture: "un REC emitido de TEST-PROD-1 (scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "espigoladas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve SUS espigoladas",
      requiereFixture: "una espigolada de TEST-PROD-1 (scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "documentos",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve los documentos de SUS albaranes",
      requiereFixture: "un REC emitido de TEST-PROD-1 (scripts/crear-datos-documentales-prueba.ts)",
    },
    // Cierre anual (fase 4): el donante ve SU acumulado y SU detalle. Las dos fichas de
    // prueba son `es_test`, que es lo que les da acceso al cierre de PRUEBA; una ficha
    // real solo vería los cierres reales.
    {
      tabla: "cierres_donante",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve SU acumulat anual (només el seu)",
      requiereFixture: "un cierre de prueba calculado con su ficha (scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "cierre_donante_lineas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve el detall del SEU acumulat",
      requiereFixture: "un cierre de prueba calculado con su ficha (scripts/crear-datos-documentales-prueba.ts)",
    },
    // Convenios (fase 2): ve EL SUYO. TEST-PROD-1 lo tiene vigente (firmado y
    // contrafirmado por el fixture); TEST-PROD-2 no tiene ninguno, así que su comprobación
    // sale SALTADA — y eso es lo correcto: si viera el de TEST-PROD-1 sería un escape.
    {
      tabla: "convenios",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve EL SEU conveni (només el seu)",
      requiereFixture: "el conveni vigent de TEST-PROD-1 (scripts/crear-datos-documentales-prueba.ts)",
    },
    // Plan de prevención (fase 5): ve EL SUYO. Mismo patrón que el convenio —el fixture lo
    // crea para TEST-PROD-1, así que la comprobación de TEST-PROD-2 sale SALTADA, y eso es
    // lo correcto: si viera el de TEST-PROD-1 sería un escape—.
    {
      tabla: "planes_prevencion",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve EL SEU pla de prevencio (només el seu)",
      requiereFixture: "el pla de TEST-PROD-1 (scripts/crear-datos-documentales-prueba.ts)",
    },
    // El nomenclátor sí: es catálogo público, como `productos`, y lo necesita el
    // formulario de ubicación.
    { tabla: "municipios", op: "leer", esperado: "permitir", descripcion: "lee el nomenclátor (catálogo público)" },
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
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "NO ve los contadores de serie" },
    { tabla: "siguiente_numero", op: "rpc", esperado: "denegar", args: { p_serie: "PROVA", p_ejercicio: 1999 }, descripcion: "NO puede pedir un número de serie" },
    ...DOCUMENTAL_EXTERN,
    // Albaranes (fase 3): la entidad ve SUS albaranes de entrega…
    {
      tabla: "albaranes",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve SUS albaranes de entrega",
      requiereFixture: "un ENT emitido a su entidad (scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "albaran_lineas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve las líneas de SUS entregas",
      requiereFixture: "un ENT emitido a su entidad (scripts/crear-datos-documentales-prueba.ts)",
    },
    {
      tabla: "documentos",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve los documentos de SUS entregas",
      requiereFixture: "un ENT emitido a su entidad (scripts/crear-datos-documentales-prueba.ts)",
    },
    // …y NO la espigolada de la que salieron: quién más recibió de la misma jornada no es
    // asunto suyo. Esto sí es una política, no falta de datos: el fixture crea una
    // espigolada y el equipo la ve.
    { tabla: "espigoladas", op: "leer", esperado: "denegar", descripcion: "NO ve la espigolada de origen" },
    // Convenios (fase 2): ve EL SUYO. TEST-ENT-SOCIAL tiene uno `pendent_firma` (el
    // fixture lo prepara y lo envía, pero no lo firma: es el estado que hay que poder ver
    // en la bandeja de la campaña).
    {
      tabla: "convenios",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve EL SEU conveni (només el seu)",
      requiereFixture: "el conveni pendent de firma de TEST-ENT-SOCIAL (scripts/crear-datos-documentales-prueba.ts)",
    },
    // Plan de prevención (fase 5): ve EL SUYO. El fixture lo crea para TEST-ENT-SOCIAL.
    {
      tabla: "planes_prevencion",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve EL SEU pla de prevencio (només el seu)",
      requiereFixture: "el pla de TEST-ENT-SOCIAL (scripts/crear-datos-documentales-prueba.ts)",
    },
    // Ni el cierre del donante del que ha recibido: el certificado es del donante.
    { tabla: "cierres_donante", op: "leer", esperado: "denegar", descripcion: "NO ve l'acumulat anual de cap donant" },
    { tabla: "cierre_donante_lineas", op: "leer", esperado: "denegar", descripcion: "NO ve les línies de cap tancament" },
    // El nomenclátor sí: es catálogo público, como `productos`, y lo necesita el
    // formulario de ubicación.
    { tabla: "municipios", op: "leer", esperado: "permitir", descripcion: "lee el nomenclátor (catálogo público)" },
  ],
  sense_rol: [
    { tabla: "productores", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "entidades", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "excedentes", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "documentos", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "albaranes", op: "leer", esperado: "denegar", descripcion: "no ve ningún albarán" },
    { tabla: "espigoladas", op: "leer", esperado: "denegar", descripcion: "no ve ninguna espigolada" },
    { tabla: "cierres_donante", op: "leer", esperado: "denegar", descripcion: "no ve ningún acumulado anual" },
    { tabla: "convenios", op: "leer", esperado: "denegar", descripcion: "no ve ningún convenio" },
    ...DOCUMENTAL_EXTERN,
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
    { tabla: "albaranes", op: "leer", esperado: "denegar", descripcion: "no ve ningún albarán" },
    { tabla: "espigoladas", op: "leer", esperado: "denegar", descripcion: "no ve ninguna espigolada" },
    { tabla: "cierres_donante", op: "leer", esperado: "denegar", descripcion: "no ve ningún acumulado anual" },
    { tabla: "convenios", op: "leer", esperado: "denegar", descripcion: "no ve ningún convenio" },
    ...DOCUMENTAL_EXTERN,
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
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "NO ve los contadores de serie" },
    ...DOCUMENTAL_EXTERN,
    // Su ficha de productor y su ficha de entidad no le dan más albaranes que los de esas
    // dos organizaciones. Hoy las cuentas de doble rol cuelgan de fichas reales, que no
    // tienen ninguno: sale SALTADA, y eso es lo correcto —si apareciera alguno sin fixture,
    // sería un escape—.
    {
      tabla: "albaranes",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve los albaranes de SUS dos organizaciones",
      requiereFixture: "un albarán de la ficha de productor o de entidad de esta cuenta",
    },
    // Su ficha de productor es REAL y no es `es_test`, así que no ve ningún cierre de
    // prueba —tampoco el suyo, si lo tuviera—. Es una política, no falta de datos: el
    // fixture crea el cierre y el equipo lo ve.
    { tabla: "cierres_donante", op: "leer", esperado: "denegar", descripcion: "NO veu cap acumulat anual (fitxa real, cap tancament real)" },
    {
      tabla: "convenios",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve els convenis de les SEVES dues organitzacions",
      requiereFixture: "un convenio de la ficha de productor o de entidad de esta cuenta",
    },
    { tabla: "municipios", op: "leer", esperado: "permitir", descripcion: "lee el nomenclátor (catálogo público)" },
  ],
};

// Cuerpos mínimos para probar un INSERT que DEBE fallar. Nunca llegan a la base si
// la política está bien; si llegara, la fila se borra en el `finally`.
const FILA_PRUEBA: Record<string, Record<string, unknown>> = {
  excedentes: { producto: "TEST-RLS", estado: "borrador" },
  canalizaciones: { kg_confirmados: 1 },
  oferta_respuestas: { telefono: "34600000000", canal: "panel" },
  usuario_roles: { rol: "super_admin" },
  // Los tres del sistema documental de la fase 3. Se rellenan lo justo para que lo que
  // corte sea el permiso y no un `not null`: si cortara un check, la comprobación no
  // diría nada sobre RLS.
  albaranes: { tipo: "REC", estado: "borrador" },
  // Las dos del cierre: se rellenan lo justo para que lo que corte sea el GRANT —no hay
  // ninguno de escritura sobre estas tablas— y no un `not null`.
  cierres_ejercicio: { ejercicio: 2020, modo: "prueba" },
  cierres_donante: { productor_id: "00000000-0000-0000-0000-000000000000" },
  espigoladas: { fecha: "1999-01-01" },
  // `convenios` no tiene GRANT de escritura para nadie: la fila se rellena lo justo para
  // que lo que corte sea el permiso y no un `not null` ni el check excluyente.
  convenios: {
    tipo: "don_gen",
    tipo_org: "productor",
    productor_id: "00000000-0000-0000-0000-000000000000",
  },
  costes_producto: { producto: "Tomàquet", ejercicio: 1999, coste_kg: 1, motivo: "TEST-RLS" },
  // `planes_prevencion` tampoco tiene GRANT de escritura para nadie. Mismo criterio que
  // `convenios`: lo justo para que lo que corte sea el permiso y no el check excluyente.
  planes_prevencion: {
    tipo_org: "productor",
    productor_id: "00000000-0000-0000-0000-000000000000",
    respuestas: {},
  },
  // `vigente: false` a propósito: con `true` chocaría con el índice único parcial
  // (tipo, idioma) where vigente y el corte vendría de un dato, no del permiso.
  plantillas_documento: {
    tipo: "PROVA",
    idioma: "ca",
    version: 99,
    titulo: "TEST-RLS",
    cuerpo: [],
    vigente: false,
  },
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
  // Retirar/publicar una plantilla es lo único que se puede hacer sobre una ya usada, así
  // que `vigente` es también la columna con la que se mide el permiso de escritura.
  plantillas_documento: "vigente",
  parametros_documentales: "caducidad_enlace_dias",
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
    const { data, error } = await cliente.from(check.tabla)
      .select(check.columnas ?? "*").limit(1);
    if (error) {
      // Afirmación de AUSENCIA: la columna no debe existir (importes en un albarán). El
      // 42703 es aquí el resultado correcto, y un éxito sería el fallo.
      if (check.columnaAusente) {
        const noExiste = error.code === "42703" ||
          (error.message ?? "").toLowerCase().includes("does not exist");
        return {
          ok: noExiste,
          detalle: noExiste ? "la columna no existe (correcto)" : `¡la columna existe! ${error.message}`,
        };
      }
      // Un error de permisos con "denegar" esperado es exactamente lo que queremos.
      if (esRechazo(error)) {
        return { ok: check.esperado === "denegar", detalle: `rechazado (${error.code ?? "42501"})` };
      }
      return { ok: false, detalle: `error inesperado: ${error.message}` };
    }
    if (check.columnaAusente) {
      return { ok: false, detalle: "¡la columna EXISTE y se puede leer!" };
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
      // ⚠️ El `select` va con una EXPRESIÓN, no con un literal, así que supabase-js no
      // puede deducir el tipo de la fila y devuelve `GenericStringError` (§7 y deuda
      // §12.46). Aquí es inevitable —la lista de columnas es del check— y por eso se
      // convierte a mano: es el único sitio del arnés donde esa convención no se cumple,
      // y se cumple el motivo por el que existe (saber por qué el tipo se pierde).
      const { data: filaCruda } = await cliente.from(check.tabla)
        .select(check.columnas ?? "*").limit(1).maybeSingle();
      const fila = filaCruda as Record<string, unknown> | null;
      const id = (fila?.id as string | number | undefined) ?? UUID_NULO;
      const valor = fila ? fila[columna] : 0;
      // ⚠️ `.select()` DESPUÉS del update, y no por comodidad: cuando lo que deniega es la
      // política (y no el GRANT), PostgREST **no da error** —el UPDATE simplemente no
      // encuentra filas que cumplan el `using`— y sin pedir las filas afectadas un
      // rechazo de RLS sería indistinguible de un éxito. Es el mismo argumento del
      // §12.48 para las lecturas, del otro lado: aquí sí se puede distinguir, porque
      // «cero filas actualizadas sobre una fila que sé que existe» solo significa una cosa.
      const { data: tocadas, error } = await cliente.from(check.tabla)
        .update({ [columna]: valor }).eq("id", id).select("id");
      if (error) {
        return {
          ok: check.esperado === "denegar",
          detalle: esRechazo(error)
            ? `rechazado (${error.code ?? "42501"})`
            : `bloqueado por la base (${error.code ?? "?"})`,
        };
      }
      if (!fila) {
        return { ok: check.esperado === "denegar", detalle: "sin fila que tocar (no demuestra nada)" };
      }
      const n = tocadas?.length ?? 0;
      if (n === 0) {
        return { ok: check.esperado === "denegar", detalle: "0 filas afectadas (la política filtra)" };
      }
      return { ok: check.esperado === "permitir", detalle: "actualizado (mismo valor)" };
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
      const { error: errLimpieza } = await cliente.rpc(check.limpiar, check.limpiarArgs ?? {});
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
  // Dos motivos distintos para una saltada, y confundirlos despista: o la tabla no tiene
  // ni una fila, o la tiene pero ninguna es de esta cuenta (el fixture no cubre a esta
  // organización). El segundo caso es el normal desde la fase 3, donde cada cuenta ve solo
  // lo suyo, y decir «taula buida» ahí sería directamente falso.
  const detalle = r.saltada
    ? (r.check.tabla === "—"
        ? r.detalle
        : vacias.has(r.check.tabla)
          ? "taula buida, no es pot comprovar"
          : "aquest compte no en té cap (falta fixture)")
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
  // Las columnas entran en la clave porque dos checks sobre la misma tabla y operación
  // pueden estar afirmando cosas distintas: «el equipo ve el estado de los enlaces» y
  // «el equipo NO ve su token_hash» son `enlaces_token·leer` los dos, y si contaran como
  // uno solo, el segundo taparía la cobertura perdida del primero.
  const clave = (r: { rol?: Cuenta["rol"]; check: Check }) =>
    `${r.rol ?? "?"} · ${r.check.tabla}·${r.check.op}` +
    (r.check.columnas ? `·${r.check.columnas}` : "");
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
