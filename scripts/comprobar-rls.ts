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
// equip · super_admin · productor · receptor · sense_rol · pendent.
//
// ⚠️ **Hasta el 21-09-2026 había un séptimo, `doble_rol`**: una cuenta con ficha de
//    productor Y de entidad a la vez. Se retiró al repartir cada cuenta de test a un solo
//    papel (§ ver la nota grande más abajo, junto a la matriz); el hueco de cobertura que
//    deja está documentado ahí, no escondido.
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
//      `evidencias.documento_identidad`, `parametros_documentales.apoderada_dni` y
//      —desde 20270320100300— `documentos.envio` están fuera del GRANT de SELECT, y eso
//      lo comprueba un check `denegar` que pide esa columna y espera `permission denied
//      for column`. Es fácil de romper sin querer: basta con que alguien vuelva a
//      ejecutar un `grant select on all tables … to authenticated` como el de
//      20260721160000 y las cinco quedarían legibles otra vez, **sin que ninguna política
//      cambie**. Sin este check, nadie se enteraría.
//
//      ⚠️ Hasta el 14-09-2026 eran TRES vigiladas de cuatro: `codigo_hash` aparecía en el
//         `revoke` y en este comentario, pero no tenía check propio, así que reabrirlo
//         solo a él habría salido verde (deuda §12.55). Ahora son cinco de cinco, y la
//         regla para la próxima columna sensible es: el `revoke` en la migración y el
//         check aquí, en el mismo cambio.
//
//      ⚠️ `documentos.envio` es la única de las cinco que se comprueba también con una
//         cuenta EXTERNA (en `DOCUMENTAL_EXTERN`), y es el caso que importa: un donante sí
//         ve su fila de `documentos`, así que con el GRANT por tabla leía el token en
//         claro de su propio enlace de subida de factura. En las otras cuatro la tabla
//         entera ya le está negada.
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
//    migraciones— `es_super_admin()` devuelve true para cualquier
//    autenticado, así que «el equipo NO emite documentos de prueba» sale en rojo. No es
//    una regresión: es el fail-open deliberado. En el proyecto remoto, donde el
//    interruptor está encendido, pasa.

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
//
// COLA DEL EQUIPO Y PROGRESO DE UNA OFERTA (20270323100000). Dos RPC nuevas, y con ellas
// la primera afirmación del arnés sobre una función de AGREGACIÓN:
//
//   · `pendents_equip()` es de dentro. Cuenta registros pendientes, respuestas por
//     aprobar, albaranes, productos sin coste del ejercicio y el estado del cierre
//     abierto: cifras internas, aunque sean solo cifras. La comprueban en positivo el
//     técnico y el super_admin, y en negativo los CINCO perfiles externos (va en
//     `DOCUMENTAL_EXTERN`), incluidos `sense_rol` y `pendent`, que desde el 14-09-2026
//     vuelven a tener cuenta y por tanto dejan de ser bloques sin recorrer (§12.32).
//   · `progres_meves_ofertes()` es del generador: cuántas entidades han recibido, aceptado
//     y esperan aprobación en cada oferta suya, **sin un solo nombre**. Un receptor no
//     obtiene nada.
//
// ⚠️ Para que esos dos checks midieran algo hubo que enseñarle a la rama `rpc` a CONTAR
//    FILAS. Hasta hoy daba por buena cualquier llamada que no diera error, así que un
//    puente `security definer` que devolviera vacío salía verde igual que uno que
//    devolviera lo suyo — y el `requiereFixture` de una `rpc` era decorativo. Ahora «0
//    filas» se lee con el mismo criterio que en un `select`: saltada si falta el fixture,
//    y denegación cuando el check lo declara con `vacioEsDenegar`.
//
// 🔴 «CUÁNTAS, SIN NOMBRES» (20270324100000). La política de SELECT de `oferta_respuestas`
//    le daba al generador `entidad_id`, `telefono` y `preu_ofert` de cada respuesta a sus
//    ofertas —rama heredada de `20260730098000`, que arreglaba una recursión y no una
//    política—. Ninguna pantalla lo pedía, así que era un permiso ancho que nadie usaba.
//    Retirada esa rama, hay tres checks nuevos y cada uno afirma una cosa distinta:
//
//      · `productor` → **denegar**. Es el decisivo: esas dos cuentas no tienen ficha de
//        entidad, así que el resultado limpio es cero. (En un `leer`, «denegar» ya
//        significa 0 filas: RLS filtra sin dar error.)
//      · `receptor`  → **permitir**. La otra cara: al estrechar había que no llevarse por
//        delante la rama `mis_entidades()`, que es la que sostiene `Mercat` e `Interessos`.
//
// 🔴 **El bloque `doble_rol` se retiró el 21-09-2026**, y no por descuido: la última cuenta
//    con dos papeles (`hola+wa-carles@`, productor Y entidad) pasó a tener uno solo —
//    decisión de producto, «cada cuenta de test es o productora o receptora»—. Un bloque
//    de checks etiquetado `doble_rol` sin ninguna cuenta real que lo cumpla sería un
//    fantasma: saldría SALTADO o, peor, alguien podría reasignarlo a una cuenta que no lo
//    es y el arnés mentiría en verde. Se quita.
//
// ⚠️ **Lo que se pierde, dicho sin rodeos**: la garantía de que ver DOS paneles a la vez
//    (productor y receptor) no es ver dos veces la base —que una cuenta con ambos papeles
//    solo ve SU productor y SU entidad, nunca las de otro—. Hoy nada la comprueba. Se
//    recupera dando de alta una cuenta interna dedicada solo al arnés (nunca mostrada en
//    ninguna demo) con las dos membresías, el mismo camino que ya se usó para los bloques
//    `pendent` y `sense_rol` (§9): son cuentas que existen únicamente para que el arnés
//    tenga qué medir.

// AUDITORÍA DE FUNCIONES (07-10-2026, 20270414100400…101000). Tres cosas nuevas:
//   1. «denegar» para cada función que se cerró (base de cálculo y snapshot del CT,
//      `plan_datos`, `exigir_convenio`/`organizacion_de`, `convenio_vigente` sobre una ficha
//      ajena, `ruta_documento`, y las dos de job) en `DOCUMENTAL_EXTERN` y en `equip`;
//   2. «permitir» de `convenio_vigente` sobre la ficha PROPIA (marcadores `@meva_fitxa_*`);
//   3. un CHECK GLOBAL en `super_admin`, `auditoria_funcions_obertes()`, que mira el catálogo
//      entero y falla si aparece una `security definer` ejecutable por `anon` o una función
//      de trigger ejecutable por la API fuera de `PERMITIDAS_ABIERTAS` (hoy vacía).

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
  rol: "equip" | "super_admin" | "productor" | "receptor" | "sense_rol" | "pendent";
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
   * Para `leer`+`permitir` y para `rpc`+`permitir`: qué fixture hace falta para que esta
   * comprobación signifique algo. Con RLS activa, **0 filas es indistinguible** de «la
   * política me bloquea» y de «no hay nada que ver»: el `select` no da error, simplemente
   * filtra. Así que cuando no hay datos esto se marca SALTADA, no FALLA — afirmar un fallo
   * de permisos sería afirmar más de lo que se sabe. El texto dice qué crear para
   * recuperar la cobertura, y sale en el informe.
   *
   * ⚠️ Hasta el 14-09-2026 solo valía para `leer`: en una `rpc` se declaraba y no lo
   *    consultaba nadie, porque esa rama no miraba cuántas filas volvían y daba por
   *    buena cualquier llamada que no diera error. Con los puentes por organización
   *    (`pendents_meus`, `progres_meves_ofertes`) eso deja de ser aceptable: son
   *    exactamente el caso en el que 0 filas puede ser «no es mío» o «no hay nada».
   */
  requiereFixture?: string;
  /**
   * Solo para `rpc`+`denegar`: devolver **cero filas** cuenta como denegación, además
   * del rechazo con error que es lo normal. Es la misma convención que ya rige en `leer`
   * («denegar» ahí significa 0 filas, porque RLS filtra en vez de dar error), y hace
   * falta para los puentes `security definer` que resuelven «lo mío» por organización:
   * `progres_meves_ofertes()` no levanta 42501 a un receptor, le devuelve el conjunto
   * vacío que le corresponde. Lo que se quiere afirmar —«no obtiene nada de otro»— es el
   * resultado, no el mecanismo, así que el check pasa con las dos formas.
   *
   * No es el valor por defecto a propósito: en el resto de las RPC, una que debía
   * rechazar y devuelve vacío es un fallo, y darlo por bueno en silencio taparía
   * justamente la guarda que falta.
   */
  vacioEsDenegar?: boolean;
  /**
   * Solo `rpc` que devuelve filas con `codi`: el check pasa si alguna fila trae este código
   * (20270508100000: una ficha con ofertas tiene que dar `ofertes`, no un motivo cualquiera).
   */
  codiEsperat?: string;
  /**
   * SQLSTATE adicionales que, en un check `permitir`, cuentan como «autorizó y falló
   * después». Casi nunca hace falta: lo normal ya lo cubre `ERRORES_DE_NEGOCIO`.
   */
  erroresEsperados?: string[];
  /**
   * Solo `rpc`+`permitir`: el check pasa ÚNICAMENTE si la RPC falla con este SQLSTATE (y falla
   * si se ejecuta sin error). Sirve para afirmar, sin escribir nada, que una clave llega a su
   * columna: `actualitzar_fitxa_*` con `regim_iva: 'xx'` tiene que chocar con el CHECK
   * (`23514`); si la clave no estuviera en la lista blanca, se ignoraría y daría éxito
   * (20270517100000).
   */
  errorExigit?: string;
  /**
   * Solo para `rpc`: argumentos. Dos valores literales se sustituyen en tiempo de
   * ejecución, para que la comprobación mida la AUTORIZACIÓN y no un "esa fila no existe"
   * que llegaría igual con permisos de sobra:
   *
   *   · `@meva_membresia`      → el id de la propia membresía (uuid nulo si no ve ninguna)
   *   · `@fitxa_amb_documents` → un productor con algún albarán fuera de borrador, o sea
   *                              una ficha que NO se puede borrar (20270328100200). Uuid
   *                              nulo si el fixture documental no está puesto.
   *   · `@fitxa_amb_ofertes`   → un productor con alguna oferta (20270508100000): tampoco se
   *                              puede borrar. Uuid nulo si no hay ninguna oferta.
   *   · `@fitxa_amb_expedient` → un productor con un expediente de prevención numerado (deuda
   *                              §12.140, 20270525100000). Uuid nulo si no hay ninguno.
   *   · `@meva_fitxa_productor` / `@meva_fitxa_entitat` → la ficha propia de ese tipo,
   *                              leída de la propia membresía (20270414100600: lo que
   *                              `convenio_vigente()` sí responde a una cuenta externa).
   *   · `@meva_organitzacio`  → la organización propia (A5; la RLS le enseña solo la suya).
   *   · `@meva_accio_diagnostic` → una acción del diagnóstico que la cuenta VE (A3: la RLS le
   *                              da las de su ficha). Uuid nulo si no ve ninguna.
   */
  args?: Record<string, unknown>;
  /**
   * Columnas que se piden en un `leer` (o en la lectura previa de un `actualizar`).
   * Por defecto `*`, que es lo que hace la app. Hace falta declararlas en las tablas con
   * **GRANT por columnas** —`enlaces_token`, `evidencias`, `parametros_documentales` y,
   * desde 20270320100300, `documentos`—,
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
   * con `reiniciar_documentos_prova`.
   *
   * ⚠️ Esa limpieza corre **contra la base real** (§7: no hay base local) y hasta
   * `20270319100000` borraba `where modo = 'prueba'` a secas, o sea TODO lo que hubiera
   * en modo prueba. Eso no era la salvaguarda, era el problema: lo que el arnés podía
   * llevarse por delante es **el ensayo de cierre de diciembre**, que sí emite en modo
   * prueba (series `P-RES`, `P-CD`, `P-CT`, `P-CDP`) y tiene su propia limpieza
   * —`reiniciar_cierre_prueba()` y `reiniciar_periodes_prova()`—. Desde esa migración el
   * borrado va acotado a las series que esta RPC posee (`PROVA`, y `P-CT` mientras nadie
   * más devuelva su contador a 0), así que una pasada del arnés en mitad de un ensayo ya
   * no lo destruye, y no puede alcanzar ningún documento de una serie legal.
   *
   * El fixture de `crear-datos-documentales-prueba.ts` nunca estuvo en peligro, dicho
   * sea para que nadie lo vuelva a diagnosticar mal: sus albaranes son `modo = 'real'`
   * (`emitir_albaran()` lo inserta literal) y su cierre de prueba se calcula pero no se
   * emite, así que hoy este borrado alcanza cero filas.
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
  /**
   * Solo para `rpc`+`permitir` sobre una función que devuelve filas `{categoria, funcio}`
   * (hoy, `auditoria_funcions_obertes()`, 20270414101000): la comprobación pasa si **todas**
   * las filas están en esta lista, escritas como `"<categoria>:<funcio>"`. Una fila de más
   * es FALLA y el detalle dice cuál. Es la forma de vigilar una propiedad GLOBAL del
   * catálogo —«ninguna función abierta de más»— con la misma tabla PASS/FAIL que el resto.
   */
  listaPermitida?: readonly string[];
  /**
   * Solo `rpc`+`permitir` sobre una función que devuelve SIEMPRE el mismo número de filas
   * (hoy, `pendents_equip()`: una por cola, aunque valga 0). Pasa si devuelve exactamente
   * esas. Es como se vigila que una cola nueva no se quede fuera al recrear la función
   * (20270510100200: diecisiete).
   */
  filasExactas?: number;
}

// Las funciones de `public` que pueden quedar abiertas de más A PROPÓSITO, en el formato
// `"<categoria>:<funcio>"` de `auditoria_funcions_obertes()` (20270414101000):
//
//   · `definer_anon:<firma>`  — `security definer`, no de trigger, ejecutable por `anon`
//                               (o PUBLIC): se puede llamar SIN SESIÓN con la publishable key.
//   · `trigger_api:<firma>`   — función de trigger ejecutable por `anon` o `authenticated`.
//
// 🔴 HOY ESTÁ VACÍA, y así debe seguir salvo decisión explícita. La causa de los fallos de la
//    auditoría del 07-10-2026 (A1/A2/M2/M3/A4/M1/B1/B9) fue el `alter default privileges …
//    on functions` de Supabase, que concede EXECUTE a `anon` y `authenticated` a toda función
//    nueva salvo `revoke` explícito. Las dos que salieron como `definer_anon`
//    (`disparar_recordatorios_intake`, `marcar_excedentes_vencidos`) se cerraron en
//    20270414100700; las 32 de trigger, en 20270414100900. Si mañana una migración crea una
//    `security definer` y olvida `revoke execute … from public, anon`, este check sale en rojo
//    con su nombre.
//
// Añadir aquí una entrada exige escribir al lado el motivo: qué hace la función sin sesión y
// por qué eso es seguro (p. ej. una consulta pública de solo lectura que valida un token).
const PERMITIDAS_ABIERTAS: readonly string[] = [];

// CIRCUITO DE FIRMA (20270510100000–100200). Lo que el arnés afirma:
//
//   · `firmes_document` no se escribe desde el navegador, ni siendo del equipo: todo entra
//     por RPC (insert y update denegados por GRANT, antes de evaluar ninguna política);
//   · las cinco funciones de servidor (`signar_document_per_enllac`,
//     `registrar_document_signat`, `preparar_enviament_signatura`, `ruta_document_signat`) y
//     las tres internas (`document_emet_versio_signada`, `document_part_signant_intern`,
//     `document_signatura_comprova`) dan 42501 a CUALQUIER sesión: las primeras por su
//     guarda (`auth.uid() is not null`), las internas porque no tienen EXECUTE;
//   · cerrar y rechazar una firma es `es_super_admin()`: el super_admin con un uuid
//     inventado recibe 22023 (autoriza) y el resto 42501;
//   · una cuenta externa no acuña un enlace de firma sobre un documento que no es suyo
//     (42501 con uuid inventado: permiso antes que existencia) y ve 0 filas en la bandeja.
//
// Las lecturas «permitir» llevan `requiereFixture`: el productor de prueba solo tiene una
// firma si `crear-datos-documentales-prueba.ts` ha subido la suya (`prepararSignatura`).
const FIRMA_SERVIDOR: Check[] = [
  {
    tabla: "signar_document_per_enllac",
    op: "rpc",
    esperado: "denegar",
    args: { p_enlace: "00000000-0000-0000-0000-000000000000", p_evidencia: {} },
    descripcion: "NO registra una signatura per enllac (nomes el servidor)",
  },
  {
    tabla: "registrar_document_signat",
    op: "rpc",
    esperado: "denegar",
    args: {
      p_documento: "00000000-0000-0000-0000-000000000000",
      p_user: "00000000-0000-0000-0000-000000000000",
      p_fitxer: {},
      p_signant: {},
    },
    descripcion: "NO registra un document signat (nomes el servidor)",
  },
  {
    tabla: "preparar_enviament_signatura",
    op: "rpc",
    esperado: "denegar",
    args: { p_documento: "00000000-0000-0000-0000-000000000000" },
    descripcion: "NO acunya l'enllac de signatura per correu (nomes el servidor)",
  },
  {
    tabla: "ruta_document_signat",
    op: "rpc",
    esperado: "denegar",
    args: { p_documento: "00000000-0000-0000-0000-000000000000", p_ext: "pdf" },
    descripcion: "NO calcula la ruta d'un document signat (nomes el servidor)",
  },
  {
    tabla: "document_emet_versio_signada",
    op: "rpc",
    esperado: "denegar",
    args: { p_firma: "00000000-0000-0000-0000-000000000000" },
    descripcion: "NO emet la versio signada (interna, sense EXECUTE)",
  },
  {
    tabla: "document_part_signant_intern",
    op: "rpc",
    esperado: "denegar",
    args: { p_documento: "00000000-0000-0000-0000-000000000000" },
    descripcion: "NO consulta la part signant sense filtre (interna)",
  },
  {
    tabla: "document_signatura_comprova",
    op: "rpc",
    esperado: "denegar",
    args: { p_documento: "00000000-0000-0000-0000-000000000000" },
    descripcion: "NO bloqueja documents per signar (interna)",
  },
  { tabla: "firmes_document", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap signatura directament (nomes per RPC)" },
  { tabla: "firmes_document", op: "actualizar", esperado: "denegar", descripcion: "NO modifica cap signatura directament" },
  // Las dos consultas abiertas a cualquier sesión. Con un uuid inventado: `false` y 0 filas.
  {
    tabla: "puc_signar_document",
    op: "rpc",
    esperado: "permitir",
    args: { p_documento: "00000000-0000-0000-0000-000000000000" },
    descripcion: "pot preguntar si pot signar un document",
  },
  {
    tabla: "document_part_signant",
    op: "rpc",
    esperado: "permitir",
    args: { p_documento: "00000000-0000-0000-0000-000000000000" },
    descripcion: "pot preguntar qui signa un document (0 files si no es seu)",
  },
];

// Lo que se añade a `DOCUMENTAL_EXTERN` (los cinco perfiles externos).
const FIRMA_EXTERN: Check[] = [
  ...FIRMA_SERVIDOR,
  { tabla: "v_signatures_bandeja", op: "leer", esperado: "denegar", descripcion: "NO veu la safata de signatures de l'equip" },
  {
    tabla: "tancar_signatura",
    op: "rpc",
    esperado: "denegar",
    args: { p_firma: "00000000-0000-0000-0000-000000000000" },
    descripcion: "NO tanca cap signatura (es del super_admin)",
  },
  {
    tabla: "rebutjar_signatura",
    op: "rpc",
    esperado: "denegar",
    args: { p_firma: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" },
    descripcion: "NO rebutja cap signatura (es del super_admin)",
  },
  {
    tabla: "acunar_enllac_propi",
    op: "rpc",
    esperado: "denegar",
    args: {
      p_proposito: "firma_document",
      p_objeto_tipo: "documento",
      p_objeto_id: "00000000-0000-0000-0000-000000000000",
    },
    descripcion: "NO encunya un enllac de signatura d'un document que no es seu",
  },
];

// IMPORTADOR DE ENTIDADES (20270511100000). Lo que el arnés afirma:
//
//   · previsualizar e importar son SOLO del super_admin (`es_super_admin()`): el técnico, el
//     admin y cualquier externo reciben 42501 antes de que se mire el payload; el super_admin,
//     con un payload inválido, 22023 `dades_invalides` (autoriza y no escribe nada);
//   · el registro (`importacions_entitats`, `importacions_entitats_files`) lo lee el equipo y
//     nadie lo escribe directo (sin GRANT de escritura: lo escribe la RPC);
//   · las funciones internas (el núcleo del alta y las `importacio_*`) no tienen EXECUTE para
//     ninguna sesión: 42501 «permission denied for function».
//
// Las lecturas «permitir» llevan `requiereFixture`: sin ninguna importación hecha, 0 filas.
// Plan 2, A5 (20270523100000): naturalesa de la organización. Para todas las cuentas.
//   · `modalitat_naturalesa_compat` es catálogo (como `modalitat_receptor_compat`): se lee, no se escribe.
//   · `refresca_naturalesa_suggerida` solo la ejecutan los triggers (service_role).
//   · `naturalesa_suggerida` es pura (NIF + forma jurídica → sugerencia): cualquiera la llama.
//   · `organizaciones` no tiene GRANT de UPDATE: la naturalesa solo cambia por `fixar_naturalesa`.
// Lo que la naturalesa CONFIRMADA cambia en el Mercat (una empresa no ve donaciones, P8) no se
// mide aquí: exigiría confirmar la de una ficha de prueba y cambiaría lo que ven las cuentas
// receptoras. Lo cubren el E2E `perfil-recepcio.e2e.ts` (clon) y la verificación SQL de A5.
const NATURALESA_COMUNS: Check[] = [
  { tabla: "modalitat_naturalesa_compat", op: "leer", esperado: "permitir", descripcion: "llegeix la regla naturalesa ↔ modalitat (cataleg, P8) (A5)" },
  { tabla: "modalitat_naturalesa_compat", op: "insertar", esperado: "denegar", descripcion: "NO escriu la regla naturalesa ↔ modalitat (A5)" },
  { tabla: "naturalesa_suggerida", op: "rpc", esperado: "permitir", args: { p_nif: "B12345674", p_forma: null }, descripcion: "calcula el suggeriment de naturalesa (funcio pura) (A5)" },
  { tabla: "refresca_naturalesa_suggerida", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO recalcula el suggeriment directament (nomes els triggers) (A5)" },
  { tabla: "organizaciones", op: "actualizar", esperado: "denegar", descripcion: "NO escriu la naturalesa a ma (nomes fixar_naturalesa) (A5)" },
];

const IMPORTACIO_INTERNES: Check[] = [
  {
    tabla: "alta_fitxa_interna",
    op: "rpc",
    esperado: "denegar",
    args: { p_rols: ["productor"], p_org: null, p_activo: false, p_productor: {}, p_entitat: {} },
    descripcion: "NO crida el nucli de l'alta (intern, sense EXECUTE)",
  },
  {
    tabla: "importacio_processa",
    op: "rpc",
    esperado: "denegar",
    args: { p_files: [], p_aplicar: false },
    descripcion: "NO processa un lot d'importacio directament (intern)",
  },
  {
    tabla: "importacio_aplica_fila",
    op: "rpc",
    esperado: "denegar",
    args: { p_n: {}, p_org: null, p_aplicar: false, p_ocupats: [], p_data: "2026-01-01" },
    descripcion: "NO aplica una fila d'importacio directament (intern)",
  },
  {
    tabla: "importacio_actualitza",
    op: "rpc",
    esperado: "denegar",
    args: { p_taula: "productores", p_id: "00000000-0000-0000-0000-000000000000", p_patch: {} },
    descripcion: "NO escriu una fitxa per la porta de la importacio (intern)",
  },
  {
    tabla: "importacio_normalitza_fila",
    op: "rpc",
    esperado: "denegar",
    args: { p_f: {}, p_munis: {} },
    descripcion: "NO normalitza files directament (intern)",
  },
  // Plan 2 B4 (20270519100000): la comparación que sobrescribe y los filtros de la exportación,
  // internos como el resto.
  {
    tabla: "importacio_compara",
    op: "rpc",
    esperado: "denegar",
    args: { p_taula: "productores", p_actual: {}, p_desitjat: {}, p_protegits: [] },
    descripcion: "NO compara/sobreescriu una fitxa directament (intern, B4)",
  },
  {
    tabla: "importacio_si_correu",
    op: "rpc",
    esperado: "denegar",
    args: { p: "a@b.cat" },
    descripcion: "NO crida el filtre de correus de l'exportacio (intern, B4)",
  },
  { tabla: "importacions_entitats", op: "insertar", esperado: "denegar", descripcion: "NO escriu el registre d'importacions directament" },
  { tabla: "importacions_entitats_files", op: "insertar", esperado: "denegar", descripcion: "NO escriu les files del registre directament" },
];

// Lo que se añade a `DOCUMENTAL_EXTERN` (los cinco perfiles externos).
const IMPORTACIO_EXTERN: Check[] = [
  ...IMPORTACIO_INTERNES,
  { tabla: "previsualitzar_importacio_entitats", op: "rpc", esperado: "denegar", args: { p_files: [] }, descripcion: "NO previsualitza importacions (es del super_admin)" },
  { tabla: "importar_entitats", op: "rpc", esperado: "denegar", args: { p_fitxer: {}, p_files: [] }, descripcion: "NO importa entitats (es del super_admin)" },
  { tabla: "importacions_entitats", op: "leer", esperado: "denegar", descripcion: "NO veu el registre d'importacions (0 files)" },
  { tabla: "importacions_entitats_files", op: "leer", esperado: "denegar", descripcion: "NO veu les files importades (0 files)" },
  { tabla: "importacions_entitats_files", op: "leer", esperado: "denegar", columnas: "fila, canvis", descripcion: "NO veu els canvis (abans/després) de cap importacio (B4)" },
];

// EXCEDENTES DEL DIAGNÓSTICO (A3, 20270522100000). Lo que el arnés afirma:
//
//   · las tres tablas (`diagnostic_productes`, `diagnostic_excedents`, `diagnostic_accions`) no
//     se escriben desde el navegador, ni siendo del equipo: sin GRANT de escritura (42501 antes
//     de evaluar ninguna política); las escriben `desar_excedents_diagnostic` y
//     `fixar_estat_accio`, solo del equipo (D5);
//   · las dos RPC ponen el permiso ANTES que la existencia: un externo recibe 42501 también con
//     un uuid inventado, y también sobre lo suyo; el equipo, 22023 (autoriza y no escribe);
//   · `diagnostic_excedents_json` es interna: sin EXECUTE para ninguna sesión;
//   · las lee el equipo y el propio productor (`requiereFixture`: sin bloques, 0 filas); una
//     cuenta sin ficha de productor no ve ninguna fila.
//
// 🔴 Los argumentos de las RPC, elegidos para que una guarda ROTA no escriba nada: con la ficha
//    propia, `p_productes: {}` (no es una lista: 22023 `productes_no_llista` antes de tocar
//    ninguna fila) y, con la acción propia, `p_estat: "no_existeix"` (22023 `estat_desconegut`).
//    Un `[]` vaciaría los excedentes del productor de prueba si la guarda dejara pasar.
const DIAGNOSTIC_EXCEDENTS_EXTERN: Check[] = [
  { tabla: "desar_excedents_diagnostic", op: "rpc", esperado: "denegar", args: { p_productor: "00000000-0000-0000-0000-000000000000", p_productes: {} }, descripcion: "NO desa els excedents de cap diagnostic (es de l'equip, D5) (A3)" },
  { tabla: "fixar_estat_accio", op: "rpc", esperado: "denegar", args: { p_accio: "00000000-0000-0000-0000-000000000000", p_estat: "no_existeix" }, descripcion: "NO canvia l'estat de cap accio del diagnostic (A3)" },
  { tabla: "diagnostic_excedents_json", op: "rpc", esperado: "denegar", args: { p_productor: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crida el json intern dels excedents (sense EXECUTE) (A3)" },
  { tabla: "diagnostic_productes", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap bloc del diagnostic a ma (A3)" },
  { tabla: "diagnostic_excedents", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap excedent del diagnostic a ma (A3)" },
  { tabla: "diagnostic_accions", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap accio del diagnostic a ma (A3)" },
];

// Lo que se añade a las cuentas SIN ficha de productor (receptores, sin rol, pendiente).
const DIAGNOSTIC_EXCEDENTS_SENSE_PRODUCTOR: Check[] = [
  { tabla: "diagnostic_productes", op: "leer", esperado: "denegar", descripcion: "NO veu cap bloc d'excedents del diagnostic (A3)" },
  { tabla: "diagnostic_excedents", op: "leer", esperado: "denegar", descripcion: "NO veu cap excedent del diagnostic (A3)" },
  { tabla: "diagnostic_accions", op: "leer", esperado: "denegar", descripcion: "NO veu cap accio del diagnostic (A3)" },
];

// Lo que se añade al equipo y al super_admin (los dos, igual: el diagnóstico es del equipo).
const DIAGNOSTIC_EXCEDENTS_EQUIP: Check[] = [
  { tabla: "diagnostic_productes", op: "leer", esperado: "permitir", descripcion: "veu els blocs d'excedents dels diagnostics (A3)", requiereFixture: "algun bloc d'excedents (desar_excedents_diagnostic)" },
  { tabla: "diagnostic_excedents", op: "leer", esperado: "permitir", descripcion: "veu els excedents dels diagnostics (A3)", requiereFixture: "algun excedent de diagnostic (desar_excedents_diagnostic)" },
  { tabla: "diagnostic_accions", op: "leer", esperado: "permitir", descripcion: "veu les accions dels diagnostics (A3)", requiereFixture: "alguna accio de diagnostic (desar_excedents_diagnostic)" },
  { tabla: "diagnostic_productes", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap bloc a ma (va per desar_excedents_diagnostic) (A3)" },
  { tabla: "diagnostic_excedents", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap excedent a ma (va per desar_excedents_diagnostic) (A3)" },
  { tabla: "diagnostic_accions", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap accio a ma (va per desar_excedents_diagnostic) (A3)" },
  { tabla: "diagnostic_productes", op: "actualizar", esperado: "denegar", descripcion: "NO modifica cap bloc a ma (A3)" },
  { tabla: "diagnostic_excedents", op: "actualizar", esperado: "denegar", descripcion: "NO modifica cap excedent a ma (A3)" },
  { tabla: "diagnostic_accions", op: "actualizar", esperado: "denegar", descripcion: "NO modifica cap accio a ma (va per fixar_estat_accio) (A3)" },
  // ⚠️ Con un uuid INEXISTENTE a propósito: la guarda de rol deja pasar y la RPC corta con
  //    `22023` (`fitxa_inexistent` / `accio_inexistent`). Mide la autorización y no escribe.
  { tabla: "desar_excedents_diagnostic", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_productor: "00000000-0000-0000-0000-000000000000", p_productes: [] }, descripcion: "pot desar els excedents de qualsevol productor (autoritza; 22023 fitxa_inexistent) (A3)" },
  { tabla: "fixar_estat_accio", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_accio: "00000000-0000-0000-0000-000000000000", p_estat: "pendent" }, descripcion: "pot canviar l'estat d'una accio (autoritza; 22023 accio_inexistent) (A3)" },
  // Invoker y de lectura: con un uuid inventado devuelve los tres códigos de Operativa.
  { tabla: "diagnostic_falten_productor", op: "rpc", esperado: "permitir", args: { p_productor: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot calcular el que falta d'un diagnostic (A3)" },
  { tabla: "diagnostic_excedents_json", op: "rpc", esperado: "denegar", args: { p_productor: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crida el json intern dels excedents (nomes les funcions del servidor) (A3)" },
];

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
  // --- La vía asistida es DEL EQUIPO, y estos tres checks son lo que lo sostiene ---
  // `acunar_enllac_assistit()` acuña un enlace `canal='asistido'` que luego permite firmar o
  // confirmar sin sesión. Si un externo pudiera llamarla, podría acuñarse un enlace sobre un
  // albarán ajeno y confirmarlo por su cuenta: es la puerta más peligrosa de las cuatro
  // funciones nuevas, y por eso su guarda exige sesión de EQUIPO (no solo sesión).
  {
    tabla: "acunar_enllac_assistit",
    op: "rpc",
    esperado: "denegar",
    args: {
      p_proposito: "confirmacion_albaran",
      p_objeto_tipo: "albaran",
      p_objeto_id: "00000000-0000-0000-0000-000000000000",
    },
    descripcion: "NO pot encunyar un enllac assistit (nomes l'equip)",
  },
  {
    tabla: "manifestar_interes_assistit",
    op: "rpc",
    esperado: "denegar",
    args: {
      p_excedente: "00000000-0000-0000-0000-000000000000",
      p_entidad: "00000000-0000-0000-0000-000000000000",
      p_kg: 1,
    },
    descripcion: "NO pot registrar un interes en nom d'una altra entitat",
  },
  // Las dos lecturas de la pantalla guiada son `security definer`: si se abrieran, un externo
  // vería el convenio, los intereses y los albaranes de cualquier lote, con nombres.
  {
    tabla: "canalitzacions_actives",
    op: "rpc",
    esperado: "denegar",
    descripcion: "NO pot llistar les canalitzacions de tothom",
  },
  // --- El conveni signat EN PAPER (20270329100300) ---
  // Es la puerta que decide si una organización puede operar sin haber firmado aquí, así
  // que su guarda es `es_super_admin()` y no `pot_aprovar()`. Un externo que pudiera
  // llamarla se daría por vigente a sí mismo y se saltaría la fecha de corte entera.
  {
    tabla: "preparar_conveni_en_paper",
    op: "rpc",
    esperado: "denegar",
    args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_tipo: "don_gen" },
    descripcion: "NO prepara cap conveni en paper",
  },
  {
    tabla: "registrar_conveni_en_paper",
    op: "rpc",
    esperado: "denegar",
    args: {
      p_conveni: "00000000-0000-0000-0000-000000000000",
      p_data_firma: "2020-01-01",
      p_referencia: "arnes",
      p_signant_nom: "arnes",
    },
    descripcion: "NO dona per vigent cap conveni signat fora de la plataforma",
  },
  { tabla: "plantillas_documento", op: "leer", esperado: "denegar", descripcion: "NO ve las plantillas de documento" },
  {
    tabla: "parametros_documentales",
    op: "leer",
    esperado: "denegar",
    columnas: "id, razon_social, cif",
    descripcion: "NO ve los parámetros documentales",
  },
  // La excepción deliberada al check de arriba, y por eso van juntos: de esa tabla un externo
  // no lee ni una fila, pero SÍ tiene que poder saber la fecha de corte de los convenios —es
  // el aviso de su propio panel—, y para eso existe `data_tall_convenis()` (20270316100000).
  // Si algún día este check empezara a fallar, el panel externo dejaría de avisar del corte y
  // la persona se encontraría el 42501 de `exigir_convenio()` sin previo aviso.
  {
    tabla: "data_tall_convenis",
    op: "rpc",
    esperado: "permitir",
    descripcion: "SÍ pot llegir la data de tall dels convenis (només aquesta columna)",
  },
  {
    tabla: "enlaces_token",
    op: "leer",
    esperado: "denegar",
    columnas: "id, estado",
    descripcion: "NO ve ningún enlace (los suyos, por pendents_meus)",
  },
  // Lo que tiene pendiente SÍ lo puede consultar, y es la vuelta del check de arriba: la
  // tabla sigue cerrada, y lo que se abre es una RPC que devuelve el estado sin el token.
  // Las dos cosas a la vez son la garantía; una sola no dice nada.
  {
    tabla: "pendents_meus",
    op: "rpc",
    esperado: "permitir",
    descripcion: "SÍ pot consultar què té pendent de signar o confirmar",
  },
  // La cola de trabajo del equipo NO es de nadie más (20270323100000). Cuenta registros
  // pendientes, respuestas por aprobar, albaranes, costes que faltan y el estado del cierre
  // abierto: son cifras internas, y la guarda es `auth.uid() is not null and not es_intern()`,
  // así que a una cuenta externa le responde 42501. Lo heredan los cinco perfiles externos,
  // incluidos `sense_rol` y `pendent`, que desde el 14-09-2026 vuelven a tener cuenta.
  {
    tabla: "pendents_equip",
    op: "rpc",
    esperado: "denegar",
    descripcion: "NO veu la cua de treball de l'equip",
  },
  // Y no puede acuñar un enlace de un objeto que no es suyo. El uuid inventado no existe,
  // así que lo que se comprueba es que la guarda de pertenencia corta con 42501 ANTES de
  // mirar si el convenio existe: si respondiera «no existe», estaría diciendo algo de la
  // base a quien no tiene por qué saberlo.
  {
    tabla: "acunar_enllac_propi",
    op: "rpc",
    esperado: "denegar",
    args: {
      p_proposito: "firma_convenio",
      p_objeto_tipo: "convenio",
      p_objeto_id: "00000000-0000-0000-0000-000000000000",
    },
    descripcion: "NO acunya cap enllaç d'un conveni que no és seu",
  },
  // ⚠️ NO HAY CHECK DE «SÍ acuña el suyo», y es deliberado. Acuñar deja una fila en
  //    `enlaces_token` Y REVOCA el enlace activo de ese convenio — el que la persona tiene
  //    en su correo. El arnés corre también contra producción, así que un check así le
  //    rompería el enlace a alguien real para comprobar una permisión, y no hay ninguna RPC
  //    que lo deshaga (`limpiar` no sirve: los enlaces no se borran). La permisión se
  //    verifica a mano con el fixture local, y lo que sí se vigila aquí es la guarda, que
  //    es la mitad que puede fallar en silencio.
  {
    tabla: "evidencias",
    op: "leer",
    esperado: "denegar",
    columnas: "id, tipo",
    descripcion: "NO ve ninguna evidencia de firma",
  },
  // El caso exacto de la deuda §12.75, y el único que era alcanzable de verdad: un
  // donante SÍ ve su fila de `documentos` por `documents_meus()`, así que con el GRANT
  // por tabla leía el `envio` de su propio resumen anual — que lleva el token en claro
  // del enlace de subida de factura. Desde 20270320100300 la columna está fuera del
  // GRANT y esto responde `42501 permission denied for column`. Si alguien restaurara el
  // GRANT por tabla, este check pasaría de «rechazado» a «ve 1 fila» y saldría rojo.
  {
    tabla: "documentos",
    op: "leer",
    esperado: "denegar",
    columnas: "envio",
    descripcion: "NO lee el sobre d'enviament del seu propi document (pot dur un token)",
  },
  // El coste por kilo es interno: el donante ve el valor de SU certificado, no la tabla
  // con la que se valora toda la base.
  { tabla: "costes_producto", op: "leer", esperado: "denegar", descripcion: "NO ve los costes por kilo" },
  { tabla: "costes_producto_hist", op: "leer", esperado: "denegar", descripcion: "NO ve el histórico de costes" },
  // Sobre un producto que NO existe: si la guarda fallara, la RPC respondería 22023 (y
  // saldría en rojo) en vez de escribir la foto o el coste de un producto real.
  { tabla: "fixar_foto_producte", op: "rpc", esperado: "denegar", args: { p_producto: "TEST-ARNES-INEXISTENT", p_foto: null, p_foto_mini: null }, descripcion: "NO canvia la foto d'un producte (només super_admin)" },
  { tabla: "fijar_coste_producto", op: "rpc", esperado: "denegar", args: { p_producto: "TEST-ARNES-INEXISTENT", p_coste: 1, p_motivo: "arnes" }, descripcion: "NO fija costes por kilo" },
  // Los envases sí: son catálogo, como `productos` y `municipios`, y los necesita el alta
  // de una oferta.
  { tabla: "tipos_caja", op: "leer", esperado: "permitir", descripcion: "lee el catálogo de envases" },
  { tabla: "emitir_albaran", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emite albaranes" },
  { tabla: "conciliar_albaran", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO concilia albaranes" },
  { tabla: "albaranes", op: "insertar", esperado: "denegar", descripcion: "NO crea albaranes a mano (van por RPC)" },
  // Cierre anual (fase 4). Aquí solo lo que vale para CUALQUIER externo; que el donante
  // vea SU fila de `cierres_donante` se comprueba en el bloque `productor`.
  // El canal preferido de OTRA organización. `actualizar_meu_canal` es la única escritura
  // de `organizaciones` (§4bis), y su guarda es `soc_titular` sobre la ficha que se le pasa:
  // con una ficha que no es suya —aquí, una inventada— tiene que cortar con 42501 ANTES de
  // mirar si existe. Si algún día devolviera el 22023 de «no té organització», estaría
  // contestando sobre fichas ajenas.
  // Enlazar organizaciones es del equipo (§12.28, etapa 3). Las dos mitades por separado:
  // VER las candidatas ya expone nombre, NIF, correo y teléfono de otra organización, así que
  // la consulta se corta igual que la escritura — si solo se vigilara `enllacar`, cualquier
  // cuenta externa podría ir preguntando por uuids a ver qué organizaciones se le parecen.
  { tabla: "organitzacions_candidates", op: "rpc", esperado: "denegar", args: { p_tipo: "productor", p_ficha: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO veu quines organitzacions coincideixen amb una fitxa" },
  { tabla: "enllacar_organitzacio", op: "rpc", esperado: "denegar", args: { p_tipo: "productor", p_ficha: "00000000-0000-0000-0000-000000000000", p_organitzacio: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO enllaça cap fitxa amb una altra organitzacio" },
  { tabla: "actualizar_meu_canal", op: "rpc", esperado: "denegar", args: { p_tipo: "productor", p_ficha: "00000000-0000-0000-0000-000000000000", p_canal: "email" }, descripcion: "NO canvia el canal preferit d'una altra organització" },
  // La ficha de OTRA organización (20270402100000). Mismo criterio que el canal: la guarda es
  // `soc_titular`, y con una ficha ajena corta con 42501 antes de mirar nada más.
  { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_dades: { nif: "B00000000" } }, descripcion: "NO edita la fitxa d'un altre productor" },
  { tabla: "actualitzar_fitxa_entitat", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_dades: { nif: "B00000000" } }, descripcion: "NO edita la fitxa d'una altra entitat" },
  // Las fotos de una oferta ajena (20270404100000/100100): el permiso va ANTES que la
  // existencia, así que con un id inventado también corta con 42501.
  { tabla: "fixar_fotos_oferta", op: "rpc", esperado: "denegar", args: { p_excedente: "00000000-0000-0000-0000-000000000000", p_fotos: [] }, descripcion: "NO canvia les fotos d'una oferta que no és seva" },
  // El destino final de los kilos (20270416100000, revisión del 08-10-2026). Como en
  // `fixar_fotos_oferta`, para un externo el permiso va antes que la existencia: un id
  // inventado corta con 42501. Y `excedente_destins` no tiene GRANT de escritura para nadie.
  { tabla: "registrar_desti_final", op: "rpc", esperado: "denegar", args: { p_excedente: "00000000-0000-0000-0000-000000000000", p_destins: [] }, descripcion: "NO registra el destí d'una oferta que no és seva" },
  { tabla: "excedente_destins", op: "insertar", esperado: "denegar", descripcion: "NO escriu destins directament (només per RPC)" },
  { tabla: "destins_finals", op: "leer", esperado: "permitir", descripcion: "ve el catàleg de destins (és catàleg)" },
  // La ficha de la operación y «Ofertes per a tu» (20270417100000/100100, fase 2 de la
  // revisión del 08-10-2026). La ficha devuelve `setof`: a quien no es parte, CERO filas.
  { tabla: "operacio_detall", op: "rpc", esperado: "denegar", vacioEsDenegar: true, args: { p_canalizacion: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO veu la fitxa d'una operació que no és seva" },
  { tabla: "declinar_oferta", op: "rpc", esperado: "denegar", args: { p_resposta: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO respon «no m'interessa» per una altra entitat" },
  { tabla: "marcar_canvis_revisats", op: "rpc", esperado: "denegar", args: { p_excedente: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO marca com a revisats els canvis d'una oferta (és de l'equip)" },
  // Confirmar la recogida (20270418100100, fase 3): solo el equipo, y el permiso va antes
  // que la existencia. Las funciones internas del reparto no las ejecuta nadie con sesión.
  { tabla: "confirmar_recollida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_kg_reals: 1 }, descripcion: "NO confirma cap recollida (és de l'equip)" },
  // Registrar la recogida (20270426100000): solo la entidad receptora de ESA canalización, y el
  // permiso va antes que la existencia (uuid inventado → 42501). Desde 20270428100000 solo
  // guarda la declaración: los albaranes los emite `validar_recollida()` (un admin). Las dos
  // internas, sin EXECUTE para nadie.
  { tabla: "registrar_recollida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_resultat: "coincideix" }, descripcion: "NO registra la recollida d'una operació que no és seva" },
  { tabla: "confirmar_part_declarada", op: "rpc", esperado: "denegar", args: { p_albaran: "00000000-0000-0000-0000-000000000000", p_rol: "recibe", p_kg: 1, p_user: "00000000-0000-0000-0000-000000000000", p_nom: "arnes", p_carrec: "arnes", p_data: null, p_incidencia: null, p_extra: null }, descripcion: "NO confirma cap part per declaració (funció interna)" },
  { tabla: "rec_te_incidencia_recollida", op: "rpc", esperado: "denegar", args: { p_rec: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO executa la consulta interna d'incidències" },
  // Validar o retornar una recogida (20270428100000) es de un admin (`pot_aprovar()`), con
  // sesión; el permiso va antes que la existencia (uuid inventado → 42501).
  { tabla: "validar_recollida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO valida cap recollida (és d'un admin)" },
  { tabla: "retornar_recollida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO retorna cap recollida (és d'un admin)" },
  // Gestión autónoma del equipo (20270430100000/100100/100200): el convenio declarado es del
  // super_admin; el envío manual, la hora y la recogida en nombre del receptor, del equipo.
  // Las dos internas (`comprova_interes`, `registrar_recollida_escriu`), sin EXECUTE.
  { tabla: "declarar_conveni", op: "rpc", esperado: "denegar", args: { p_tipo_org: "entidad", p_org: "00000000-0000-0000-0000-000000000000", p_tipo: "col_receptor", p_signant_nom: "arnes", p_signant_carrec: "arnes" }, descripcion: "NO dona per vigent cap conveni sense signar (només super_admin)" },
  { tabla: "registrar_envio_manual", op: "rpc", esperado: "denegar", args: { p_excedente: "00000000-0000-0000-0000-000000000000", p_entidad: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO registra cap enviament manual d'una oferta (és de l'equip)" },
  { tabla: "registrar_recollida_assistida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_resultat: "coincideix" }, descripcion: "NO registra cap recollida en nom del receptor (és d'un admin)" },
  { tabla: "fixar_hora_recollida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_quan: "2030-01-01T10:00:00Z" }, descripcion: "NO fixa l'hora de cap recollida (és de l'equip)" },
  { tabla: "comprova_interes", op: "rpc", esperado: "denegar", args: { p_excedente: "00000000-0000-0000-0000-000000000000", p_entidad: "00000000-0000-0000-0000-000000000000", p_kg: 1, p_preu: null, p_modalitat: null, p_recollida: null }, descripcion: "NO executa la comprovació interna d'un interès" },
  { tabla: "registrar_recollida_escriu", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_resultat: "coincideix", p_kg_reals: null, p_data: null, p_observacions: null, p_per: "00000000-0000-0000-0000-000000000000", p_origen: "equip" }, descripcion: "NO executa l'escriptura interna d'una recollida" },
  // Los avisos de una oferta (20270430100300) son `security invoker`: la RLS de `avisos` le
  // deja a una organización solo los suyos, así que de una oferta ajena no le llega nada.
  { tabla: "avisos_de_oferta", op: "rpc", esperado: "denegar", vacioEsDenegar: true, args: { p_excedente: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO veu cap avís d'una oferta que no és seva" },
  // La revisión del certificado (20270419100000, fase 4): un externo solo aprueba lo suyo
  // (permiso antes que existencia: id inventado → 42501), y nunca en nombre de otro.
  { tabla: "aprovar_certificat_ofertant", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_tipus: "anual" }, descripcion: "NO aprova un certificat que no és seu" },
  { tabla: "aprovar_certificat_equip", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_tipus: "anual", p_nota: "arnes" }, descripcion: "NO aprova cap certificat en nom d'un altre (és de l'equip)" },
  { tabla: "certificat_revisio_snapshot", op: "rpc", esperado: "denegar", args: { p_estat: null, p_at: null, p_per: null, p_nota: null }, descripcion: "NO executa el snapshot intern de la revisió" },
  { tabla: "confirmar_part_assistida", op: "rpc", esperado: "denegar", args: { p_albaran: "00000000-0000-0000-0000-000000000000", p_rol: "recibe", p_kg: 1, p_observacions: null, p_foto: null, p_data: null }, descripcion: "NO confirma cap part d'un albarà (funció interna)" },
  { tabla: "cierres_ejercicio", op: "leer", esperado: "denegar", descripcion: "NO ve los cierres de ejercicio" },
  { tabla: "cierres_donante", op: "insertar", esperado: "denegar", descripcion: "NO escribe en el cierre (no hay GRANT)" },
  { tabla: "abrir_cierre", op: "rpc", esperado: "denegar", args: { p_ejercicio: 2020, p_modo: "prueba" }, descripcion: "NO obre cap tancament" },
  { tabla: "calcular_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO calcula un cierre" },
  // Desde 20270509100200 con la fecha de expedición y el anexo: se llama con la firma nueva.
  { tabla: "emitir_certificado", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000", p_data_expedicio: "1999-12-31", p_annex: false }, descripcion: "NO emet certificats de donació" },
  { tabla: "conciliacion_retroactiva", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_kg: 1, p_motivo: "arnes" }, descripcion: "NO concilia res a posteriori" },
  { tabla: "reiniciar_cierre_prueba", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO reinicia un cierre de prueba" },
  { tabla: "datos_182", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO exporta los datos del 182" },
  { tabla: "cerrar_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO tanca cap exercici" },
  // Emitir TODOS los certificados de un cierre de golpe (20270328100800). Es la acción
  // más destructiva del circuito fiscal —N documentos con número legal y N correos a N
  // donantes— así que es la primera que tiene que cortar para cualquier cuenta externa.
  { tabla: "emitir_certificados_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000", p_data_expedicio: "1999-12-31", p_annex: false }, descripcion: "NO emet en bloc els certificats d'un tancament" },
  // Su espejo para los certificados de transacción (20270414100200): misma guarda.
  { tabla: "emitir_certificados_transaccion_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet en bloc els certificats de transacció" },
  // El helper de la conciliación en cascada (20270414100100) es interno: sin EXECUTE.
  { tabla: "albarans_germans_rec", op: "rpc", esperado: "denegar", args: { p_rec: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO consulta els germans d'un albarà (intern)" },
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
  // El convenio único (20270420100000): lo que cubren los anteriores es catálogo, como la matriz.
  { tabla: "convenis_equivalents", op: "leer", esperado: "permitir", descripcion: "llegeix les equivalències dels convenis anteriors (catàleg)" },
  { tabla: "convenis_equivalents", op: "insertar", esperado: "denegar", descripcion: "NO escriu equivalències de convenis" },
  { tabla: "conveni_cobreix_tot", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO executa la comprovació interna del conveni" },
  // La ficha de la organización (20270421100000, fase 7).
  { tabla: "tipus_activitat", op: "leer", esperado: "permitir", descripcion: "llegeix el catàleg de tipus d'activitat" },
  { tabla: "tipus_activitat", op: "insertar", esperado: "denegar", descripcion: "NO escriu al catàleg de tipus d'activitat" },
  { tabla: "organizacion_contactos", op: "insertar", esperado: "denegar", descripcion: "NO escriu contactes directament (només per RPC)" },
  { tabla: "desar_contacte_org", op: "rpc", esperado: "denegar", args: { p_id: null, p_organizacion: "00000000-0000-0000-0000-000000000000", p_dades: { nom: "arnes" } }, descripcion: "NO afegeix contactes a una organització que no és seva" },
  { tabla: "esborrar_contacte_org", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO esborra contactes d'una altra organització" },
  { tabla: "afegir_paper_organitzacio", op: "rpc", esperado: "denegar", args: { p_tipo_actual: "productor", p_id_actual: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO afegeix un paper a una organització que no és seva" },
  // Plan 1, rebanada 1A (20270501100000): estado de las fichas y búsqueda. Todo es del
  // equipo; un externo no busca, no activa ni desactiva, no añade papeles por la puerta del
  // equipo y no ve el historial de estados. Los contactos (D3) ya no se escriben desde el
  // panel: las dos RPC de arriba dan «permission denied for function» a cualquiera.
  { tabla: "cerca_entitats", op: "rpc", esperado: "denegar", args: { p_q: "B0000" }, descripcion: "NO cerca entitats (és de l'equip)" },
  { tabla: "activar_fitxa", op: "rpc", esperado: "denegar", args: { p_tipus: "entidad", p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO activa cap fitxa" },
  { tabla: "desactivar_fitxa", op: "rpc", esperado: "denegar", args: { p_tipus: "entidad", p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO desactiva cap fitxa" },
  // Plan 2, B1 (20270518100000): el estado CRM por papel es de `pot_aprovar()`.
  { tabla: "fixar_estat_crm", op: "rpc", esperado: "denegar", args: { p_tipus: "entidad", p_id: "00000000-0000-0000-0000-000000000000", p_estat: "actiu" }, descripcion: "NO canvia l'estat CRM de cap fitxa" },
  { tabla: "fixar_estat_crm", op: "rpc", esperado: "denegar", args: { p_tipus: "productor", p_id: "00000000-0000-0000-0000-000000000000", p_estat: "en_desenvolupament" }, descripcion: "NO canvia l'estat CRM de cap ofertant" },
  // Plan 2, A5 (20270523100000): la naturalesa la confirma el equipo o el titular de ESA
  // organización; un uuid inventado da 42501 (el permiso va antes que la existencia). La regla
  // naturalesa ↔ modalidad (P8) es catálogo; el recálculo de la sugerencia es interno.
  ...NATURALESA_COMUNS,
  { tabla: "fixar_naturalesa", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000", p_naturalesa: "empresa" }, descripcion: "NO fixa la naturalesa d'una organitzacio que no es seva (A5)" },
  { tabla: "desactivar_organitzacio", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO desactiva cap organització" },
  { tabla: "afegir_paper_org_equip", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000", p_paper: "entidad" }, descripcion: "NO afegeix papers per la porta de l'equip" },
  { tabla: "fitxa_estat_hist", op: "leer", esperado: "denegar", descripcion: "NO veu l'historial d'estats de les fitxes" },
  { tabla: "fitxa_estat_hist", op: "insertar", esperado: "denegar", descripcion: "NO escriu l'historial d'estats" },
  // Plan 1, rebanada 1B (20270501300000): el alta de una entidad es del equipo.
  { tabla: "crear_entitat", op: "rpc", esperado: "denegar", args: { p_dades: { rols: ["productor"] } }, descripcion: "NO dona d'alta entitats (és de l'equip)" },
  { tabla: "tipus_activitat_valid", op: "rpc", esperado: "denegar", args: { p_valors: [], p_papel: "productor" }, descripcion: "NO executa la validació interna d'activitats" },
  // Plan 1, rebanada 1D (20270501500000): dar y quitar acceso es del equipo, y el estado de la
  // cuenta solo lo lee el equipo. Las dos del servidor no las ejecuta ninguna sesión.
  { tabla: "estat_acces_org", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO veu l'estat d'accés d'una entitat" },
  // Plan 2, B3 (20270518110000): la exportación a Excel es del equipo (también `tecnic`).
  { tabla: "exportar_entitats", op: "rpc", esperado: "denegar", args: { p_ids: null }, descripcion: "NO exporta les entitats a Excel (és de l'equip)" },
  { tabla: "desactivar_acces_org", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO treu l'accés a cap entitat" },
  { tabla: "concedir_acces_org", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000", p_user: "00000000-0000-0000-0000-000000000000", p_email: "arnes@exemple.cat", p_per: null }, descripcion: "NO dona accés per la porta del servidor (només service_role)" },
  { tabla: "revertir_acces_org", op: "rpc", esperado: "denegar", args: { p_foto: {} }, descripcion: "NO reverteix accessos (només service_role)" },
  // Plan 1, rebanada 1F (20270502100000): las notas internas son del equipo y un externo ni
  // sabe que existen: el `select` le da 0 filas SIN error, y no escribe ni borra.
  { tabla: "notes_internes", op: "leer", esperado: "denegar", descripcion: "NO veu cap nota interna (0 files, sense error)" },
  { tabla: "notes_internes", op: "insertar", esperado: "denegar", descripcion: "NO escriu notes internes" },
  { tabla: "afegir_nota_interna", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000", p_canal: "telefon", p_text: "arnes" }, descripcion: "NO afegeix notes internes" },
  { tabla: "esborrar_nota_interna", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO esborra notes internes" },
  // Taula mestra 1.5 (20270504100000): cerrar un seguimiento es del equipo, y activar la
  // organización entera, de `pot_aprovar()`.
  { tabla: "tancar_seguiment", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO tanca seguiments del CRM" },
  // Consentimiento por enlace (20270506100000): pedirlo y listar es del equipo; guardarlo,
  // solo del servidor (`enlace-publico`).
  { tabla: "demanar_consentiment", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO demana consentiments" },
  { tabla: "llista_consentiments", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO veu la llista de consentiments" },
  { tabla: "registrar_consentiment_enllac", op: "rpc", esperado: "denegar", args: { p_token_hash: "arnes", p_respostes: [], p_versio: "1", p_idioma: "ca" }, descripcion: "NO registra consentiments per enllaç (només service_role)" },
  { tabla: "preparar_enviament_albara", op: "rpc", esperado: "denegar", args: { p_albaran: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO prepara l'enviament d'un albarà (només service_role, enviar-albara)" },
  // El equipo (20270513100000): ver y cambiar roles es SOLO del super_admin.
  { tabla: "equip_membres", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO veu les comptes de l'equip (és del super_admin)" },
  { tabla: "canviar_rol_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000", p_rol: "admin" }, descripcion: "NO canvia el rol de ningú de l'equip (és del super_admin)" },
  { tabla: "equip_rols_hist", op: "leer", esperado: "denegar", descripcion: "NO veu l'historial de rols de l'equip (0 files)" },
  { tabla: "equip_rols_hist", op: "insertar", esperado: "denegar", descripcion: "NO escriu l'historial de rols directament (només la RPC)" },
  // Gestión de las cuentas del equipo (20270514100000): todo es del super_admin; las internas no tienen EXECUTE para nadie.
  { tabla: "equip_columnes_autoria", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO crida la llista interna de columnes d'autoria" },
  { tabla: "equip_moure_accions", op: "rpc", esperado: "denegar", args: { p_origen: "00000000-0000-0000-0000-000000000000", p_desti: "00000000-0000-0000-0000-000000000000", p_motiu: "traspas" }, descripcion: "NO mou accions directament (intern)" },
  { tabla: "equip_valida_desti", op: "rpc", esperado: "denegar", args: { p_origen: "00000000-0000-0000-0000-000000000000", p_desti: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crida la validacio interna del desti" },
  { tabla: "equip_total_accions", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crida el recompte intern d'accions" },
  { tabla: "equip_traspassos", op: "insertar", esperado: "denegar", descripcion: "NO escriu el registre de traspassos directament" },
  { tabla: "equip_accions", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO veu les accions d'un compte (és del super_admin)" },
  { tabla: "traspassar_accions_equip", op: "rpc", esperado: "denegar", args: { p_origen: "00000000-0000-0000-0000-000000000000", p_desti: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO traspassa accions (és del super_admin)" },
  { tabla: "activar_membre_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO activa comptes de l'equip (és del super_admin)" },
  { tabla: "desactivar_membre_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO desactiva comptes de l'equip (és del super_admin)" },
  { tabla: "editar_membre_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000", p_nom: "x", p_telefon: null }, descripcion: "NO edita comptes de l'equip (és del super_admin)" },
  { tabla: "esborrar_membre_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO esborra comptes de l'equip (és del super_admin)" },
  { tabla: "equip_traspassos", op: "leer", esperado: "denegar", descripcion: "NO veu el registre de traspassos (0 files)" },
  // Rastro por fila del traspaso (20270515100000): solo el super_admin lo lee; nadie lo escribe.
  { tabla: "equip_traspassos_files", op: "leer", esperado: "denegar", descripcion: "NO veu el rastre per fila dels traspassos (0 files)" },
  { tabla: "equip_traspassos_files", op: "insertar", esperado: "denegar", descripcion: "NO escriu el rastre per fila directament" },
  { tabla: "equip_autoria_fila", op: "rpc", esperado: "denegar", args: { p_taula: "documentos", p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO consulta l'autoria original d'una fila (és del super_admin)" },
  // Auditoría del equipo y regeneración de documentos (20270516100000/100100): todo del super_admin.
  { tabla: "equip_auditoria", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO veu l'auditoria de l'equip (és del super_admin)" },
  { tabla: "equip_persones_arxiu", op: "leer", esperado: "denegar", descripcion: "NO veu l'arxiu de persones esborrades (0 files)" },
  { tabla: "equip_persones_arxiu", op: "insertar", esperado: "denegar", descripcion: "NO escriu l'arxiu de persones directament" },
  { tabla: "regenerar_documents_fundacio", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO regenera documents (és del super_admin)" },
  { tabla: "documento_datos_fundacio_actual", op: "rpc", esperado: "denegar", args: { p_datos: {} }, descripcion: "NO crida la funció interna de dades de la Fundació" },
  { tabla: "regeneracions_documents", op: "leer", esperado: "denegar", descripcion: "NO veu el registre de regeneracions (0 files)" },
  { tabla: "regeneracions_documents", op: "insertar", esperado: "denegar", descripcion: "NO escriu el registre de regeneracions directament" },
  // Pantalla de protecció prèvia a la home / la cortina (20270517110000): la contrasenya és en clar i només la veu el super_admin; la taula no té GRANT per a ningú.
  { tabla: "cortina_config", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO veu la contrasenya de la cortina (és del super_admin)" },
  { tabla: "cortina_activar", op: "rpc", esperado: "denegar", args: { p_activa: false }, descripcion: "NO encén ni apaga la cortina (és del super_admin)" },
  { tabla: "cortina_desar_contrasenya", op: "rpc", esperado: "denegar", args: { p_contrasenya: "contrasenya-arnes", p_hash: "0000000000000000000000000000000000000000000000000000000000000000", p_per: "arnes" }, descripcion: "NO desa la contrasenya de la cortina directament (només la Edge Function)" },
  { tabla: "cortina_config", op: "leer", esperado: "denegar", descripcion: "NO llegeix la taula de la cortina (contrasenya en clar: sense GRANT)" },
  { tabla: "cortina_config", op: "insertar", esperado: "denegar", descripcion: "NO escriu la taula de la cortina directament" },
  // Cua de fitxers orfes de Storage (20270526100000): sense GRANT per a ningú; la buida el job diari.
  { tabla: "fitxers_orfes", op: "leer", esperado: "denegar", descripcion: "NO llegeix la cua de fitxers orfes (sense GRANT)" },
  { tabla: "fitxers_orfes", op: "insertar", esperado: "denegar", descripcion: "NO escriu a la cua de fitxers orfes" },
  { tabla: "activar_organitzacio", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO activa cap organització" },
  // Los indicadores del tablero (20270422100000, fase 8): solo el equipo.
  { tabla: "kpis_equip", op: "rpc", esperado: "denegar", args: { p_desde: "2026-01-01", p_hasta: "2026-12-31" }, descripcion: "NO veu els indicadors de l'equip" },
  // Fase 10 (20270424100000): el impacto global es del equipo; los factores son catálogo
  // (los lee cualquiera) y solo el super_admin los fija.
  { tabla: "impacte_global", op: "rpc", esperado: "denegar", args: { p_desde: "2026-01-01", p_hasta: "2026-12-31" }, descripcion: "NO veu l'impacte de tota la plataforma" },
  { tabla: "factors_impacte", op: "leer", esperado: "permitir", descripcion: "veu els factors d'impacte (cataleg)", requiereFixture: "els factors sembrats (20270424100000)" },
  { tabla: "factors_impacte", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap factor d'impacte" },
  { tabla: "fixar_factor_impacte", op: "rpc", esperado: "denegar", args: { p_codi: "x", p_valor: 1 }, descripcion: "NO fixa cap factor d'impacte" },
  // Interruptores de notificaciones (27-10-2026): solo el super_admin.
  { tabla: "fixar_notificacions", op: "rpc", esperado: "denegar", args: { p_actives: true }, descripcion: "NO toca l'interruptor general de notificacions" },
  { tabla: "fixar_canal_notificacio", op: "rpc", esperado: "denegar", args: { p_canal: "email", p_actiu: true }, descripcion: "NO toca cap canal de notificació" },
  // Consentimientos RGPD: nadie escribe directo (los guarda el alta con service_role).
  { tabla: "consentiments", op: "insertar", esperado: "denegar", descripcion: "NO escriu consentiments directament" },
  // Fase 11 (20270425100000): el expediente de prevención lo lleva el equipo. Sin GRANT de
  // escritura para nadie; las RPC cortan antes de mirar si el expediente existe.
  { tabla: "expedients_prevencion", op: "insertar", esperado: "denegar", descripcion: "NO crea cap expedient de prevencio a ma" },
  { tabla: "pla_visites", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap visita del pla a ma" },
  { tabla: "obrir_expedient", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO obre cap expedient de prevencio" },
  { tabla: "desar_element_expedient", op: "rpc", esperado: "denegar", args: { p_taula: "pla_visites", p_expedient: "00000000-0000-0000-0000-000000000000", p_id: null, p_dades: {} }, descripcion: "NO escriu cap element d'un expedient" },
  { tabla: "exportar_expedient", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO exporta cap pla de prevencio" },
  { tabla: "verificar_expedient", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_any: 2026, p_resum: "x", p_conclusio: "x" }, descripcion: "NO verifica cap expedient" },
  { tabla: "volcar_quantificacio_expedients", op: "rpc", esperado: "denegar", descripcion: "NO llança el bolcat mensual (nomes el servidor)" },
  { tabla: "convenios", op: "insertar", esperado: "denegar", descripcion: "NO crea convenios a mano (van por RPC)" },
  // 🔴 Hasta 20270414100600 esto era un «permitir»: cualquier cuenta preguntaba por el
  //    convenio de cualquier organización, y `exigir_convenio()` le devolvía además su
  //    NOMBRE en el mensaje (rompe D3). Ahora `convenio_vigente()` solo responde por las
  //    fichas propias (o al equipo); por una ajena —aquí, el uuid de ceros—, 42501. El caso
  //    propio lo afirman los bloques `productor` y `receptor` con `@meva_fitxa_*`.
  {
    tabla: "convenio_vigente",
    op: "rpc",
    esperado: "denegar",
    args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_valorizacion: "donacio", p_parte: "entrega" },
    descripcion: "NO consulta el conveni d'una organitzacio aliena",
  },
  // `exigir_convenio()` y `organizacion_de()`: solo servidor y llamadas internas desde
  // 20270414100600. La primera devolvía el nombre de la organización en el error.
  {
    tabla: "exigir_convenio",
    op: "rpc",
    esperado: "denegar",
    args: { p_tipo: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_valorizacion: "venda", p_parte: "entrega" },
    descripcion: "NO crida exigir_convenio (el missatge porta el nom de l'organitzacio)",
  },
  { tabla: "organizacion_de", op: "rpc", esperado: "denegar", args: { p_tipo: "productor", p_ficha: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO resol l'organitzacio d'una fitxa" },
  // --- Auditoría de funciones del 07-10-2026 (20270414100400…101000) ---
  // La base de cálculo y el snapshot del certificado de transacción: lo mismo que
  // `cierre_base()` (más abajo), en la hermana que se quedó fuera de 20270303100500.
  { tabla: "cierre_base_transaccion", op: "rpc", esperado: "denegar", args: { p_ejercicio: 1999, p_modo: "prueba" }, descripcion: "NO llegeix la base de calcul del certificat de transaccio" },
  { tabla: "cierre_pendents_transaccion", op: "rpc", esperado: "denegar", args: { p_ejercicio: 1999 }, descripcion: "NO llegeix les transaccions pendents de conciliar" },
  { tabla: "cierre_datos_certificado_transaccion", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO llegeix el snapshot d'un certificat de transaccio" },
  // El snapshot del plan de prevención (nombre, NIF y respuestas de la organización).
  // La ruta de un documento delata la organización propietaria del objeto.
  { tabla: "ruta_documento", op: "rpc", esperado: "denegar", args: { p_objeto_tipo: "prova", p_objeto_id: null, p_tipo: "PROVA", p_numero_completo: "PROVA-1999-0001", p_version: 1, p_modo: "prueba", p_ejercicio: 1999 }, descripcion: "NO compon rutes de documents (nomes servidor)" },
  // Las dos funciones de job (solo pg_cron). ⚠️ Si alguna vez volvieran a abrirse, este
  // check las EJECUTARÍA de verdad: el aviso de recordatorios o el marcado de vencidas, lo
  // mismo que hace su job. Es el precio de vigilarlas con una llamada real.
  { tabla: "disparar_recordatorios_intake", op: "rpc", esperado: "denegar", descripcion: "NO dispara els recordatoris d'intake (nomes pg_cron)" },
  { tabla: "marcar_excedentes_vencidos", op: "rpc", esperado: "denegar", descripcion: "NO marca ofertes vençudes (nomes pg_cron)" },
  // La auditoría del catálogo es del equipo.
  { tabla: "auditoria_funcions_obertes", op: "rpc", esperado: "denegar", descripcion: "NO consulta l'auditoria de funcions" },
  { tabla: "preparar_convenio", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_tipo: "don_gen" }, descripcion: "NO prepara convenis" },
  { tabla: "enviar_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO envia convenis a firmar" },
  { tabla: "contrafirmar_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO contrasigna cap conveni" },
  { tabla: "retornar_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO retorna cap conveni" },
  { tabla: "descartar_convenio_esborrany", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO descarta cap conveni" },
  // Validar o rechazar una oferta antes del Mercat (05-10-2026): solo `pot_aprovar()`.
  { tabla: "validar_oferta", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO valida cap oferta" },
  { tabla: "rebutjar_oferta", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO rebutja cap oferta" },
  // Avisos y edición (05-10-2026, rebanada 2). `editar_oferta` es solo del servidor (la llama
  // `crear-oferta/editar` con el actor): un `authenticated` podría pasar el uuid de otro.
  { tabla: "editar_oferta", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_canvis: {}, p_texto: "", p_actor: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO edita ofertes directament (només el servidor)" },
  { tabla: "crear_avis", op: "rpc", esperado: "denegar", args: { p_destinatari_tipo: "productor", p_destinatari_id: "00000000-0000-0000-0000-000000000000", p_tipus: "oferta_validada", p_objecte_tipo: "excedente", p_objecte_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crea avisos (només triggers i servidor)" },
  // Recogida programada (rebanada 3): todo del servidor.
  { tabla: "programar_albarans_recollida", op: "rpc", esperado: "denegar", descripcion: "NO emet albarans programats (només el servidor)" },
  { tabla: "recordar_confirmacions_recollida", op: "rpc", esperado: "denegar", descripcion: "NO renova enllaços (només el servidor)" },
  { tabla: "conciliacions_automatiques", op: "rpc", esperado: "denegar", descripcion: "NO concilia automàticament (només el servidor)" },
  { tabla: "resolver_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO resol cap conveni" },
  { tabla: "iniciar_firma_asistida", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO obre cap firma assistida" },
  { tabla: "firmar_convenio_por_enlace", op: "rpc", esperado: "denegar", args: { p_enlace: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO firma per enllaç (això és del servidor)" },
  { tabla: "validar_codi_firma", op: "rpc", esperado: "denegar", args: { p_enlace: "00000000-0000-0000-0000-000000000000", p_codi: "000000" }, descripcion: "NO valida el codi de firma (això és del servidor)" },
  { tabla: "aprovar_resposta", op: "rpc", esperado: "denegar", args: { p_resposta: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO aprova cap resposta a una oferta" },
  // Plan de prevención (fase 5). Un externo LEE el suyo —eso va en su bloque, con su
  // `requiereFixture`— y no escribe nada. El motor del plan básico (`guardar_plan_basico`,
  // `emitir_plan_basico`, `plan_datos`…) y el del cuestionario se retiraron de la base con la
  // deuda 174/175 (20270524100000): sus checks se fueron con ellos.
  { tabla: "planes_prevencion", op: "insertar", esperado: "denegar", descripcion: "NO crea plans a mà (van per RPC)" },
  // Organización unificada (20270310100000). La tabla no tiene GRANT de escritura para
  // nadie: si alguien lo concediera, este check se pondría rojo antes de que llegara a
  // producción una forma de reasignar la ficha de una organización a otra.
  // ⚠️ Los dos de LECTURA no están aquí y sí en cada bloque, a propósito (14-09-2026): lo
  //    que se ve depende de tener organización, y `sense_rol` y `pendent` no tienen ninguna
  //    —sus membresías son inexistentes o `activo = false`—, así que para ellas 0 filas es el
  //    comportamiento CORRECTO y no una falta de fixture. Heredarlos como «permitir» ponía
  //    cuatro comprobaciones en rojo describiendo lo que debe pasar. No salió antes porque
  //    esos dos bloques llevaban desde julio sin ninguna cuenta que los recorriera (§12.32).
  { tabla: "organizaciones", op: "insertar", esperado: "denegar", descripcion: "NO crea organitzacions a ma" },
  {
    tabla: "planes_meus",
    op: "rpc",
    esperado: "denegar",
    args: { p_user: "00000000-0000-0000-0000-0000000000ff" },
    descripcion: "NO consulta els plans d'una altra persona",
  },
  // Certificado de transacción (fase 5; RETIRADO en 20270509100400): la guarda de
  // `pot_aprovar()` sigue delante del `certificat_transaccio_retirat`, así que un externo
  // sigue recibiendo 42501 y no el error de negocio.
  { tabla: "calcular_cierre_transacciones", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO calcula les transaccions d'un tancament" },
  { tabla: "emitir_certificado_transaccion", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet certificats de transaccio" },
  { tabla: "rectificar_certificado_transaccion", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000", p_motivo: "arnes" }, descripcion: "NO rectifica cap certificat de transaccio" },
  // 🔴 La base de cálculo del cierre. Hasta 20270303100500 estas cuatro funciones eran
  //    `security definer` con GRANT a `authenticated` y **sin comprobación de rol por
  //    dentro**: un productor con sesión podía pedir por PostgREST la donación de todos
  //    los donantes con nombre, kilos y coste por kilo. El arnés no lo miraba —comprobaba
  //    `datos_182` y daba por hecho el resto de la familia—, así que estos cuatro checks
  //    son la vigilancia que faltaba, no una comprobación de cortesía.
  { tabla: "cierre_base", op: "rpc", esperado: "denegar", args: { p_ejercicio: 1999, p_modo: "prueba" }, descripcion: "NO llegeix la base de calcul del tancament" },
  { tabla: "cierre_pendents", op: "rpc", esperado: "denegar", args: { p_ejercicio: 1999 }, descripcion: "NO llegeix el que falta per conciliar" },
  { tabla: "cierre_base_periodo", op: "rpc", esperado: "denegar", args: { p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" }, descripcion: "NO llegeix la base de calcul d'un periode" },
  { tabla: "cierre_pendents_periodo", op: "rpc", esperado: "denegar", args: { p_desde: "1999-01-01", p_hasta: "1999-12-31" }, descripcion: "NO llegeix els pendents d'un periode" },
  // Certificado de donación a demanda (CDP). Nada de su circuito es de un externo: ni la
  // tabla —que no tiene GRANT de escritura para nadie— ni ninguna de sus cinco acciones,
  // todas de `pot_aprovar()`. Que el donante vea SU certificado se comprueba en el bloque
  // `productor`, que es donde esa afirmación significa algo.
  { tabla: "cierres_periodo", op: "insertar", esperado: "denegar", descripcion: "NO escriu al certificat a demanda (no hi ha GRANT)" },
  { tabla: "calcular_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" }, descripcion: "NO calcula cap certificat a demanda" },
  // El ámbito oferta (20270509100100): la misma guarda, con la firma nueva.
  { tabla: "calcular_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: null, p_hasta: null, p_modo: "prueba", p_excedente: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO calcula cap certificat d'una oferta" },
  { tabla: "emitir_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000", p_data_expedicio: "1999-12-31", p_annex: false, p_excedente: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet cap certificat a demanda" },
  // Lo que se queda fuera de un certificado (20270509100000) es del equipo: lleva el nombre
  // de las entidades receptoras y las ventas del donante. Y el criterio puro no tiene
  // EXECUTE para nadie con sesión.
  { tabla: "cierre_exclosos_periodo", op: "rpc", esperado: "denegar", args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_fins: "1999-12-31", p_excedente: null, p_modo: "prueba" }, descripcion: "NO llegeix les donacions excloses d'un certificat" },
  { tabla: "motiu_exclusio_certificat", op: "rpc", esperado: "denegar", args: { p_valorizacion: "donacio", p_entidad: null, p_tipo_receptor: "social" }, descripcion: "NO executa el criteri intern del certificable" },
  { tabla: "registrar_factura_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000", p_numero: "F-ARNES" }, descripcion: "NO registra la factura d'un periode" },
  { tabla: "rectificar_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000", p_motivo: "arnes" }, descripcion: "NO rectifica cap certificat a demanda" },
  { tabla: "marcar_enviado_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO marca com a enviat cap certificat a demanda" },
  { tabla: "reiniciar_periodes_prova", op: "rpc", esperado: "denegar", args: { p_ejercicio: 1999 }, descripcion: "NO reinicia els certificats a demanda de prova" },
  // Borrado de una ficha (20270328100100, deuda §12.108). Las dos funciones nuevas están
  // cerradas a cualquiera que no sea del equipo, y la destructiva además al que no sea
  // super_admin. El uuid es el nulo a propósito: la guarda va ANTES de buscar la ficha, así
  // que un externo se lleva el `42501` sin que la función llegue a mirar ninguna fila —que
  // es justo lo que hace que este check sea inofensivo aunque apunte a la RPC que borra—.
  //
  // ⚠️ Y por eso NO hay ningún check que la ejercite en positivo contra una ficha de
  //    verdad, ni siquiera esperando el bloqueo: el arnés corre contra producción (§7), y
  //    si el bloqueo hubiera regresado, la comprobación **borraría la ficha y todo lo
  //    suyo**. La cobertura en positivo se hace con `bloqueigs_esborrat_fitxa()`, que es
  //    de solo lectura y contesta la misma pregunta (bloque `super_admin`). Mismo criterio
  //    que §12.97 con `acunar_enllac_propi`.
  {
    tabla: "borrar_ficha_completa",
    op: "rpc",
    esperado: "denegar",
    args: { p_tipo: "productor", p_ficha_id: "00000000-0000-0000-0000-000000000000", p_tambe_germana: false },
    descripcion: "NO esborra cap fitxa (ni la seva)",
  },
  {
    tabla: "bloqueigs_esborrat_fitxa",
    op: "rpc",
    esperado: "denegar",
    args: { p_tipo: "productor", p_ficha: "00000000-0000-0000-0000-000000000000" },
    descripcion: "NO consulta els bloquejos d'esborrat d'una fitxa",
  },
  // Crear una espigolada es del EQUIPO, y desde la F3 (20270328101000) además CONVIERTE
  // una oferta: la saca del mercado, le cambia el origen y le monta un REC. Si un externo
  // pudiera llamarla, podría convertir la oferta de otra organización y quedarse con la
  // entrada de producto. Hasta esta fase la RPC no la miraba nadie en el arnés.
  {
    tabla: "crear_espigolada",
    op: "rpc",
    esperado: "denegar",
    args: {
      p_productor: "00000000-0000-0000-0000-000000000000",
      p_excedente: "00000000-0000-0000-0000-000000000000",
    },
    descripcion: "NO crea ni converteix cap espigolada (nomes l'equip)",
  },
  // El cierre automático de la espigolada (20270406100300) lo hace un TRIGGER; la función
  // que recalcula no la puede llamar nadie con sesión, ni el equipo (bloque de abajo).
  {
    tabla: "recalcula_estat_espigolada",
    op: "rpc",
    esperado: "denegar",
    args: { p_espigolada: "00000000-0000-0000-0000-000000000000" },
    descripcion: "NO obre ni tanca espigolades a mà (ho fa el trigger)",
  },
  // --- Certificat de recepcio (CR, 20270328101100 / 223246) ---
  // Nada de este circuito es de un externo: ni la tabla —que no tiene GRANT de escritura
  // para nadie— ni ninguna de sus acciones, todas de `pot_aprovar()`. Que la RECEPTORA vea
  // EL SUYO se comprueba en el bloque `receptor`, que es donde esa afirmación significa algo.
  { tabla: "cierres_receptor", op: "insertar", esperado: "denegar", descripcion: "NO escriu al certificat de recepcio (no hi ha GRANT)" },
  { tabla: "calcular_certificat_recepcio", op: "rpc", esperado: "denegar", args: { p_entidad: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" }, descripcion: "NO calcula cap certificat de recepcio" },
  { tabla: "emetre_certificat_recepcio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet cap certificat de recepcio" },
  { tabla: "rectificar_certificat_recepcio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO rectifica cap certificat de recepcio" },
  { tabla: "marcar_enviat_recepcio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO marca com a enviat cap certificat de recepcio" },
  { tabla: "reiniciar_recepcions_prova", op: "rpc", esperado: "denegar", args: { p_ejercicio: 1999 }, descripcion: "NO reinicia els certificats de recepcio de prova" },
  // 🔴 La base de cálculo. Es `security definer` y cruza canalizaciones, excedentes,
  //    albaranes y productores sin que ninguna RLS vuelva a filtrar: sin su guarda, una
  //    entidad podría pedir por PostgREST lo que ha recibido TODO EL MUNDO, con el nombre
  //    de cada generador. Es exactamente el agujero que 20270303100500 encontró en
  //    `cierre_base()`, y por eso se vigila desde el primer día.
  { tabla: "cierre_base_recepcio", op: "rpc", esperado: "denegar", args: { p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" }, descripcion: "NO llegeix la base de calcul d'un certificat de recepcio" },
  { tabla: "cierre_pendents_recepcio", op: "rpc", esperado: "denegar", args: { p_desde: "1999-01-01", p_hasta: "1999-12-31" }, descripcion: "NO llegeix els lliuraments pendents de conciliar" },
  // --- Diagnòstic i pla de prevenció (F2, 20270328101300…231950) ---
  // El CUESTIONARIO sí lo ve cualquier cuenta con sesión: es el formulario que tiene que
  // contestar, y la política es `vigente or es_intern()`. Lo que NO ve es la maquinaria que
  // decide qué medidas le tocan —el catálogo y las reglas—, que es configuración del
  // servicio: su plan lleva el título y la descripción de cada medida COPIADOS dentro, así
  // que cerrarlas no le quita nada que necesite para leer su propio plan.
  // Las que reciben (tipo_org, org): su guarda `puc_gestionar_pla()` va ANTES de buscar
  // ninguna fila, así que el 42501 llega sin que la función mire si la organización existe —
  // que es lo que hace inofensivo apuntar a un uuid inventado.
  { tabla: "diagnostic_estat", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO consulta el diagnostic d'una altra organitzacio" },
  // La bandeja de diagnósticos de TODA la base es del equipo, como `pendents_equip()`.
  { tabla: "diagnostics_equip", op: "rpc", esperado: "denegar", descripcion: "NO veu els diagnostics de tota la base" },
  // A1 (20270520100000): el diagnóstico único vive en `diagnostics`, sin escritura directa para
  // nadie (lo escribe el equipo por RPC: D5). `diagnostic_datos` pone el permiso antes que la
  // existencia, así que un uuid inventado da 42501 a un externo.
  { tabla: "diagnostics", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap diagnostic a ma (A1)" },
  { tabla: "diagnostic_datos", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO llegeix el diagnostic d'una altra organitzacio (A1)" },
  // Excedentes del diagnóstico (A3, 20270522100000): ver `DIAGNOSTIC_EXCEDENTS_EXTERN`.
  ...DIAGNOSTIC_EXCEDENTS_EXTERN,
  // Circuito de firma (20270510100000–100200): ver `FIRMA_EXTERN`.
  ...FIRMA_EXTERN,
  // Importador de entidades (20270511100000): ver `IMPORTACIO_EXTERN`.
  ...IMPORTACIO_EXTERN,
];

// Lo que CADA rol debe poder hacer. Es la especificación ejecutable de AGENTS.md §4:
// si alguien relaja una política sin querer, aquí sale en rojo.
const MATRIZ: Record<Cuenta["rol"], Check[]> = {
  equip: [
    // --- La via assistida (20270328100200 / 20270328100300 / 20270328100400) ---
    // ⚠️ Los tres «permitir» se llaman con un uuid INEXISTENTE a propósito, igual que los
    //    del ciclo de cierre: lo que se afirma es que la guarda de ROL deja pasar, no que
    //    la operación se complete. `acunar_enllac_assistit()` ESCRIBE —acuña un enlace y
    //    revoca el anterior—, así que ejercitarla en positivo contra producción le
    //    rompería el enlace a alguien de verdad. Es el mismo criterio con el que
    //    `borrar_ficha_completa()` tampoco se prueba en positivo.
    {
      tabla: "acunar_enllac_assistit",
      op: "rpc",
      esperado: "permitir",
      args: {
        p_proposito: "confirmacion_albaran",
        p_objeto_tipo: "albaran",
        p_objeto_id: "00000000-0000-0000-0000-000000000000",
      },
      descripcion: "pot encunyar un enllac assistit (autoritza; l'albara no existeix)",
    },
    {
      tabla: "manifestar_interes_assistit",
      op: "rpc",
      esperado: "permitir",
      args: {
        p_excedente: "00000000-0000-0000-0000-000000000000",
        p_entidad: "00000000-0000-0000-0000-000000000000",
        p_kg: 1,
      },
      descripcion: "pot registrar un interes assistit (autoritza; l'oferta no existeix)",
    },
    {
      tabla: "canalitzacions_actives",
      op: "rpc",
      esperado: "permitir",
      descripcion: "veu els lots en curs de la pantalla guiada",
    },
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
    // ⚠️ `columnas` explícitas desde 20270320100300: `documentos` pasó a GRANT por
    //    columnas y un `select *` responde ahora `42501 permission denied for column
    //    "envio"`. Sin la lista, este check diría «rechazado» sin haber evaluado ninguna
    //    política — el mismo mecanismo que ya tenían `enlaces_token` y `evidencias`.
    {
      tabla: "documentos",
      op: "leer",
      esperado: "permitir",
      columnas: "id, tipo, numero_completo, estado, modo, vigente",
      descripcion: "ve los documentos emitidos",
      requiereFixture: "algún documento emitido (super_admin → emitir_documento_prova())",
    },
    // Y NI EL EQUIPO lee `envio`: ese sobre puede llevar el token en claro del enlace de
    // subida de factura (`emitir_resumen()`), que en `enlaces_token` solo existe hasheado.
    // Cierra la deuda §12.75; sin este check, volver a `grant select on documentos` no lo
    // notaría nadie.
    {
      tabla: "documentos",
      op: "leer",
      esperado: "denegar",
      columnas: "envio",
      descripcion: "NI el equipo lee el sobre de envío (puede llevar un token)",
    },
    { tabla: "series_documentales", op: "leer", esperado: "permitir", descripcion: "ve los contadores de serie" },
    { tabla: "documento_envios", op: "leer", esperado: "permitir", descripcion: "ve los envíos de documentos", requiereFixture: "algún envío registrado (fase 1, al mandar un documento por correo)" },
    { tabla: "documentos", op: "insertar", esperado: "denegar", descripcion: "NO crea documentos a mano (van por RPC)" },
    // ⚠️ `columnas` también aquí: la rama `actualizar` LEE la fila antes de tocarla, y
    //    con `select *` esa lectura se corta ahora por el GRANT de columna. Sin fila que
    //    tocar, el check pasa a "no demuestra nada" y deja de medir la política.
    { tabla: "documentos", op: "actualizar", esperado: "denegar", columnas: "id, intentos", descripcion: "NO edita un documento emitido" },
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
    //
    // ⚠️ `rol_parte` está en la lista a propósito (§12.68). Es una columna AÑADIDA a una
    //    tabla con GRANT por columnas, y una columna nueva no hereda nada: si algún día
    //    se recrea la tabla o se olvida el `grant select (rol_parte)`, esto sale `42501
    //    permission denied for column` y no «0 filas», así que el fallo se ve.
    {
      tabla: "enlaces_token",
      op: "leer",
      esperado: "permitir",
      columnas: "id, proposito, estado, caduca_at, rol_parte",
      descripcion: "ve el estado de los enlaces y de qué parte son",
      requiereFixture: "algún enlace emitido (fase 2/3: firma de convenio o confirmación de albarán)",
    },
    {
      tabla: "enlaces_token",
      op: "leer",
      esperado: "denegar",
      columnas: "token_hash",
      descripcion: "NI el equipo lee el hash del token (GRANT por columnas)",
    },
    // ⚠️ `codigo_hash` estaba en el `revoke` de 20260928100300 y en la cabecera de este
    //    fichero desde el primer día, pero NO tenía check propio: reabrirlo solo a él
    //    —un `grant select (codigo_hash)` de más en una migración— habría salido verde.
    //    Es el segundo factor de la firma asistida, o sea la otra mitad de la credencial
    //    que ya se vigila arriba. Cierra la deuda §12.55.
    {
      tabla: "enlaces_token",
      op: "leer",
      esperado: "denegar",
      columnas: "codigo_hash",
      descripcion: "NI el equipo lee el hash del codi de 6 xifres (GRANT por columnas)",
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
      columnas: "id, fecha, estado, oferta_origen_id",
      descripcion: "ve las espigoladas, y de qué oferta nació cada una",
      requiereFixture: "la espigolada de prueba (scripts/crear-datos-documentales-prueba.ts)",
    },
    // La guarda de ROL de la conversión (F3). Va contra un uuid de ceros a propósito: lo
    // que se mide es que `es_intern()` la deja pasar, no lo que contesta —contesta
    // `22023 oferta_inexistent`, que es error de NEGOCIO y por tanto cuenta como
    // ejecutada (ERRORES_DE_NEGOCIO)—.
    //
    // ⚠️ En positivo no se prueba NUNCA: convertir una oferta de verdad la sacaría del
    //    mercado, le cambiaría el origen y le montaría un REC, contra producción. Mismo
    //    criterio que `borrar_ficha_completa()` y que §12.97 con `acunar_enllac_propi`.
    {
      tabla: "crear_espigolada",
      op: "rpc",
      esperado: "permitir",
      args: {
      p_productor: "00000000-0000-0000-0000-000000000000",
      p_excedente: "00000000-0000-0000-0000-000000000000",
    },
      descripcion: "pot convertir una oferta en espigolada (la guarda el deixa passar)",
    },
    {
      tabla: "recalcula_estat_espigolada",
      op: "rpc",
      esperado: "denegar",
      args: { p_espigolada: "00000000-0000-0000-0000-000000000000" },
      descripcion: "NO obre ni tanca espigolades a mà (ho fa el trigger)",
    },
    // --- Certificat de recepcio (CR): el equipo LEE, y escribir es de `pot_aprovar()` ---
    {
      tabla: "cierres_receptor",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve els certificats de recepcio",
      requiereFixture: "algún certificado de recepción calculado (calcular_certificat_recepcio)",
    },
    {
      tabla: "cierre_receptor_lineas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve el detall dels certificats de recepcio",
      requiereFixture: "algún certificado de recepción calculado (calcular_certificat_recepcio)",
    },
    { tabla: "cierres_receptor", op: "insertar", esperado: "denegar", descripcion: "NO crea certificats de recepcio a ma (van per RPC)" },
    { tabla: "calcular_certificat_recepcio", op: "rpc", esperado: "denegar", args: { p_entidad: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" }, descripcion: "NO calcula un certificat de recepcio (es de pot_aprovar)" },
    { tabla: "emetre_certificat_recepcio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet un certificat de recepcio (es de pot_aprovar)" },
    // Las LECTURAS sí son del equipo: son lo que hace auditable la cifra del certificado.
    { tabla: "cierre_base_recepcio", op: "rpc", esperado: "permitir", args: { p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" }, descripcion: "pot llegir la base de calcul d'un certificat de recepcio" },
    { tabla: "cierre_pendents_recepcio", op: "rpc", esperado: "permitir", args: { p_desde: "1999-01-01", p_hasta: "1999-12-31" }, descripcion: "pot llegir els lliuraments pendents de conciliar" },
    { tabla: "kg_rebuts_exercici", op: "rpc", esperado: "permitir", args: {}, descripcion: "veu els quilos rebuts (security invoker: ho veu tot)", requiereFixture: "alguna canalización conciliada del ejercicio en curso" },
    // 🔴 LA AUSENCIA que hay que vigilar: un certificado de recepción NO lleva importes. Si
    //    algún día apareciera una columna de dinero aquí, esto se pondría rojo ANTES de que
    //    llegara a imprimirse en un PDF. Mismo mecanismo que `albaran_lineas.coste_kg`.
    {
      tabla: "cierres_receptor",
      op: "leer",
      esperado: "denegar",
      columnas: "id, valor_total",
      columnaAusente: true,
      descripcion: "un certificat de recepcio NO te imports (la columna no existeix)",
    },
    // --- Diagnostic (F2) ---
    // El cuestionario, el catálogo de medidas y las reglas del plan básico se retiraron con la
    // deuda 174/175 (20270524100000); queda la bandeja de diagnósticos.
    { tabla: "diagnostics_equip", op: "rpc", esperado: "permitir", descripcion: "veu els diagnostics de tota la base", requiereFixture: "alguna fitxa de productor o entitat" },
    // --- Diagnòstic únic (A1, 20270520100000) ---
    // El equipo LEE `diagnostics` y no la escribe a mano (solo por RPC).
    { tabla: "diagnostics", op: "leer", esperado: "permitir", descripcion: "veu els diagnostics (A1)", requiereFixture: "algun diagnostic desat (per RPC o el backfill d'A1)" },
    { tabla: "diagnostics", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap diagnostic a ma (nomes per RPC)" },
    { tabla: "diagnostics", op: "actualizar", esperado: "denegar", descripcion: "NO modifica cap diagnostic a ma (nomes per RPC)" },
    { tabla: "diagnostic_datos", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot llegir el diagnostic de qualsevol productor (autoritza; 22023 fitxa_inexistent)" },
    // --- Operativa (A4, 20270521100000) ---
    // El equipo edita la Operativa de cualquier productor con UPDATE directo (ficha y sección 1
    // del diagnóstico, T4) y marca su lugar principal por la RPC.
    { tabla: "productores", op: "leer", esperado: "permitir", columnas: "id, productes_principals, varietats, volum_produccio, envasos_habituals, canals_comercials, tipologia_clients, facturacio_anual_eur, facturacio_rang, volum_comercialitzat_kg, suport_interes", descripcion: "veu la Operativa de tots els productors (A4)" },
    { tabla: "productores", op: "actualizar", esperado: "permitir", columnas: "id, envasos_habituals", descripcion: "edita la Operativa d'una fitxa (A4, mateix valor)" },
    { tabla: "fixar_lloc_principal", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_lloc: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot triar el lloc principal de qualsevol productor (autoritza; 22023 lloc_inexistent) (A4)" },
    // --- Excedentes del diagnóstico (A3, 20270522100000): ver `DIAGNOSTIC_EXCEDENTS_EQUIP` ---
    ...DIAGNOSTIC_EXCEDENTS_EQUIP,
    {
      tabla: "costes_producto",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve los costes por kilo",
      requiereFixture: "algún coste fijado (scripts/crear-datos-documentales-prueba.ts)",
    },
    { tabla: "tipos_caja", op: "leer", esperado: "permitir", descripcion: "ve el catálogo de envases" },
    // El conveni en paper (20270329100300) es `es_super_admin()`, no `es_intern()` ni
    // `pot_aprovar()`: declarar vigente un convenio que la plataforma no ha visto firmar
    // decide si una organización puede operar, y eso no se amplía en silencio al equipo.
    {
      tabla: "preparar_conveni_en_paper",
      op: "rpc",
      esperado: "denegar",
      args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_tipo: "don_gen" },
      descripcion: "NO prepara un conveni en paper (només super_admin)",
    },
    {
      tabla: "registrar_conveni_en_paper",
      op: "rpc",
      esperado: "denegar",
      args: {
        p_conveni: "00000000-0000-0000-0000-000000000000",
        p_data_firma: "2020-01-01",
        p_referencia: "arnes",
        p_signant_nom: "arnes",
      },
      descripcion: "NO dona per vigent un conveni signat en paper (només super_admin)",
    },
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
      args: { p_producto: "TEST-ARNES-INEXISTENT", p_coste: 1, p_motivo: "arnes" },
      descripcion: "NO fija el coste por kilo (es de pot_aprovar)",
    },
    // El destino final lo registra también el equipo, en nombre del productor (modelo
    // asistido). Con un id inventado, la guarda de rol deja pasar y corta la existencia.
    {
      tabla: "registrar_desti_final",
      op: "rpc",
      esperado: "permitir",
      args: { p_excedente: "00000000-0000-0000-0000-000000000000", p_destins: [] },
      descripcion: "registra el destí d'una oferta en nom del productor (id inventat → 22023)",
    },
    { tabla: "excedente_destins", op: "insertar", esperado: "denegar", descripcion: "NO escriu destins directament (només per RPC)" },
    // Revisar los cambios de una oferta es del equipo (id inventado: autoriza y no toca nada).
    { tabla: "marcar_canvis_revisats", op: "rpc", esperado: "permitir", args: { p_excedente: "00000000-0000-0000-0000-000000000000" }, descripcion: "marca com a revisats els canvis d'una oferta" },
    // «Confirma la recollida» y validar/retornar la del receptor son de un ADMIN desde
    // 20270428100000 (`pot_aprovar()`): un técnico, no. El permiso va antes que la existencia.
    { tabla: "confirmar_recollida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_kg_reals: 1 }, descripcion: "NO confirma cap recollida (és d'un admin des de 20270428100000)" },
    { tabla: "validar_recollida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO valida cap recollida (és d'un admin)" },
    { tabla: "retornar_recollida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO retorna cap recollida (és d'un admin)" },
    // El registro del receptor NO es del equipo: el equipo tiene «Confirma la recollida».
    { tabla: "registrar_recollida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_resultat: "coincideix" }, descripcion: "NO registra la recollida en nom del receptor (té «Confirma la recollida»)" },
    { tabla: "confirmar_part_declarada", op: "rpc", esperado: "denegar", args: { p_albaran: "00000000-0000-0000-0000-000000000000", p_rol: "recibe", p_kg: 1, p_user: "00000000-0000-0000-0000-000000000000", p_nom: "arnes", p_carrec: "arnes", p_data: null, p_incidencia: null, p_extra: null }, descripcion: "NO confirma cap part per declaració (funció interna)" },
    // Aprobar un certificado en nombre del donante es de `pot_aprovar()`: un técnico, no.
    { tabla: "aprovar_certificat_equip", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_tipus: "anual", p_nota: "arnes" }, descripcion: "NO aprova certificats en nom del donant (és de pot_aprovar)" },
    { tabla: "repartir_kg_linies", op: "rpc", esperado: "denegar", args: { p_albaran: "00000000-0000-0000-0000-000000000000", p_kg: 1 }, descripcion: "NO executa el repartiment intern de quilos" },
    // Gestión autónoma (20270430100000…100200). El convenio declarado es del super_admin y la
    // recogida en nombre del receptor de un admin: un técnico, no. El envío manual y la hora
    // de recogida, sí (id inventado: la guarda deja pasar y corta la existencia, 22023).
    { tabla: "declarar_conveni", op: "rpc", esperado: "denegar", args: { p_tipo_org: "entidad", p_org: "00000000-0000-0000-0000-000000000000", p_tipo: "col_receptor", p_signant_nom: "arnes", p_signant_carrec: "arnes" }, descripcion: "NO dona per vigent cap conveni (només super_admin)" },
    { tabla: "registrar_recollida_assistida", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_resultat: "coincideix" }, descripcion: "NO registra recollides en nom del receptor (és d'un admin)" },
    { tabla: "registrar_envio_manual", op: "rpc", esperado: "permitir", args: { p_excedente: "00000000-0000-0000-0000-000000000000", p_entidad: "00000000-0000-0000-0000-000000000000" }, descripcion: "registra un enviament manual (oferta inventada → 22023)" },
    { tabla: "fixar_hora_recollida", op: "rpc", esperado: "permitir", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_quan: "2030-01-01T10:00:00Z" }, descripcion: "fixa l'hora d'una recollida (id inventat → 22023)" },
    { tabla: "comprova_interes", op: "rpc", esperado: "denegar", args: { p_excedente: "00000000-0000-0000-0000-000000000000", p_entidad: "00000000-0000-0000-0000-000000000000", p_kg: 1, p_preu: null, p_modalitat: null, p_recollida: null }, descripcion: "NO executa la comprovació interna d'un interès" },
    { tabla: "registrar_recollida_escriu", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_resultat: "coincideix", p_kg_reals: null, p_data: null, p_observacions: null, p_per: "00000000-0000-0000-0000-000000000000", p_origen: "equip" }, descripcion: "NO executa l'escriptura interna d'una recollida" },
    // Contactos: retirados del panel en el plan 1 (D3, 20270501100000). Las dos RPC ya no
    // se ejecutan con sesión, tampoco del equipo: «permission denied for function».
    { tabla: "desar_contacte_org", op: "rpc", esperado: "denegar", args: { p_id: null, p_organizacion: "00000000-0000-0000-0000-000000000000", p_dades: { nom: "arnes" } }, descripcion: "NO afegeix contactes (retirats, D3)" },
    { tabla: "esborrar_contacte_org", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO esborra contactes (retirats, D3)" },
    // Plan 1, 1A: el técnico BUSCA (antes de dar de alta) y ve el historial de estados, pero
    // activar, desactivar y añadir un papel son de `pot_aprovar()` (admin en adelante).
    { tabla: "cerca_entitats", op: "rpc", esperado: "permitir", args: { p_q: "B0000" }, descripcion: "cerca entitats per NIF", requiereFixture: "fitxes amb NIF B0000… (fitxes de prova)" },
    { tabla: "fitxa_estat_hist", op: "leer", esperado: "permitir", descripcion: "veu l'historial d'estats de les fitxes", requiereFixture: "algun canvi d'estat d'una fitxa (activar/desactivar)" },
    // Plan 1, 1C (20270501200000): el listado «Entitats», una fila por organización.
    { tabla: "v_entitats_llistat", op: "leer", esperado: "permitir", descripcion: "veu el llistat d'entitats (totes)", requiereFixture: "alguna organització amb fitxa" },
    { tabla: "fitxa_estat_hist", op: "insertar", esperado: "denegar", descripcion: "NO escriu l'historial directament (només el trigger)" },
    { tabla: "activar_fitxa", op: "rpc", esperado: "denegar", args: { p_tipus: "entidad", p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO activa fitxes (és de l'admin)" },
    { tabla: "desactivar_fitxa", op: "rpc", esperado: "denegar", args: { p_tipus: "entidad", p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO desactiva fitxes (és de l'admin)" },
    // Plan 2, B1 (20270518100000): el técnico no cambia el estado CRM (como activar/desactivar).
    { tabla: "fixar_estat_crm", op: "rpc", esperado: "denegar", args: { p_tipus: "entidad", p_id: "00000000-0000-0000-0000-000000000000", p_estat: "actiu" }, descripcion: "NO canvia l'estat CRM (és de l'admin)" },
    { tabla: "desactivar_organitzacio", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO desactiva organitzacions (és de l'admin)" },
    { tabla: "afegir_paper_org_equip", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000", p_paper: "entidad" }, descripcion: "NO afegeix papers en nom d'una organització (és de l'admin)" },
    // Plan 1, 1B (20270501300000): el técnico SÍ da de alta (como el alta directa de antes).
    // Sin papeles, la guarda deja pasar y la RPC corta con 22023 `cal_paper` sin escribir nada.
    { tabla: "crear_entitat", op: "rpc", esperado: "permitir", args: { p_dades: { rols: [] } }, descripcion: "pot donar d'alta una entitat (22023 sense papers)" },
    // Deuda 150 (20270501400000): ni el equipo inserta fichas directo; solo `crear_entitat()`.
    { tabla: "productores", op: "insertar", esperado: "denegar", descripcion: "NO dona d'alta fitxes directament (només crear_entitat)" },
    { tabla: "entidades", op: "insertar", esperado: "denegar", descripcion: "NO dona d'alta fitxes directament (només crear_entitat)" },
    // Plan 1, 1D (20270501500000): el técnico ve el estado de la cuenta, pero dar y quitar
    // acceso es de `pot_aprovar()` (crear una cuenta aprobada es aprobar un alta).
    { tabla: "estat_acces_org", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "veu l'estat d'accés d'una entitat (22023 si no existeix)" },
    // Plan 2, B3 (20270518110000): todo el equipo exporta (D10), también `tecnic`.
    { tabla: "exportar_entitats", op: "rpc", esperado: "permitir", args: { p_ids: null }, descripcion: "exporta les entitats a Excel (D10, tot l'equip)" },
    // Plan 2, A5 (20270523100000): todo el equipo confirma la naturalesa (`es_intern()`); con un
    // uuid inventado, 22023 `organitzacio_inexistent`; con un valor raro, 22023 antes de escribir.
    ...NATURALESA_COMUNS,
    { tabla: "fixar_naturalesa", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_org: "00000000-0000-0000-0000-000000000000", p_naturalesa: "empresa" }, descripcion: "pot fixar la naturalesa de qualsevol organitzacio (autoritza; 22023 organitzacio_inexistent) (A5)" },
    { tabla: "fixar_naturalesa", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_org: "00000000-0000-0000-0000-000000000000", p_naturalesa: "no_existeix" }, descripcion: "una naturalesa desconeguda es 22023 (A5)" },
    { tabla: "desactivar_acces_org", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO treu l'accés (és de l'admin)" },
    { tabla: "concedir_acces_org", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000", p_user: "00000000-0000-0000-0000-000000000000", p_email: "arnes@exemple.cat", p_per: null }, descripcion: "NO dona accés per la porta del servidor (només service_role)" },
    { tabla: "revertir_acces_org", op: "rpc", esperado: "denegar", args: { p_foto: {} }, descripcion: "NO reverteix accessos (només service_role)" },
    // Plan 1, 1F (20270502100000): el técnico lee y AÑADE notas internas (uuid inventado →
    // 22023 `organitzacio_inexistent`: la guarda dejó pasar), pero no las borra ni escribe directo.
    { tabla: "notes_internes", op: "leer", esperado: "permitir", descripcion: "veu les notes internes", requiereFixture: "alguna nota interna (afegir_nota_interna)" },
    { tabla: "notes_internes", op: "insertar", esperado: "denegar", descripcion: "NO escriu notes directament (només afegir_nota_interna)" },
    { tabla: "afegir_nota_interna", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000", p_canal: "telefon", p_text: "arnes" }, descripcion: "pot afegir una nota interna (22023 si l'organització no existeix)" },
    { tabla: "esborrar_nota_interna", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO esborra notes internes (és del super_admin)" },
    // 1.5 (20270504100000): el técnico cierra seguimientos (uuid inventado → 22023
    // `nota_inexistent`), pero activar la organización entera es del admin.
    { tabla: "tancar_seguiment", op: "rpc", esperado: "permitir", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot tancar un seguiment (22023 si la nota no existeix)" },
    // Consentimiento por enlace (20270506100000): pedirlo y listar es del equipo; guardarlo,
    // solo del servidor (`enlace-publico`).
    { tabla: "demanar_consentiment", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot demanar el consentiment (22023 si l'organització no existeix)" },
    { tabla: "llista_consentiments", op: "rpc", esperado: "permitir", args: {}, descripcion: "veu la llista de consentiments" },
    { tabla: "registrar_consentiment_enllac", op: "rpc", esperado: "denegar", args: { p_token_hash: "arnes", p_respostes: [], p_versio: "1", p_idioma: "ca" }, descripcion: "NO registra consentiments per enllaç (només service_role)" },
    { tabla: "preparar_enviament_albara", op: "rpc", esperado: "denegar", args: { p_albaran: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO prepara l'enviament d'un albarà (només service_role, enviar-albara)" },
    // El equipo (20270513100000): ver y cambiar roles es SOLO del super_admin.
    { tabla: "equip_membres", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO veu les comptes de l'equip (és del super_admin)" },
    { tabla: "canviar_rol_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000", p_rol: "admin" }, descripcion: "NO canvia el rol de ningú de l'equip (és del super_admin)" },
    { tabla: "equip_rols_hist", op: "leer", esperado: "denegar", descripcion: "NO veu l'historial de rols de l'equip (0 files)" },
    { tabla: "equip_rols_hist", op: "insertar", esperado: "denegar", descripcion: "NO escriu l'historial de rols directament (només la RPC)" },
    // Gestión de las cuentas del equipo (20270514100000): todo es del super_admin; las internas no tienen EXECUTE para nadie.
    { tabla: "equip_columnes_autoria", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO crida la llista interna de columnes d'autoria" },
    { tabla: "equip_moure_accions", op: "rpc", esperado: "denegar", args: { p_origen: "00000000-0000-0000-0000-000000000000", p_desti: "00000000-0000-0000-0000-000000000000", p_motiu: "traspas" }, descripcion: "NO mou accions directament (intern)" },
    { tabla: "equip_valida_desti", op: "rpc", esperado: "denegar", args: { p_origen: "00000000-0000-0000-0000-000000000000", p_desti: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crida la validacio interna del desti" },
    { tabla: "equip_total_accions", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crida el recompte intern d'accions" },
    { tabla: "equip_traspassos", op: "insertar", esperado: "denegar", descripcion: "NO escriu el registre de traspassos directament" },
    { tabla: "equip_accions", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO veu les accions d'un compte (és del super_admin)" },
    { tabla: "traspassar_accions_equip", op: "rpc", esperado: "denegar", args: { p_origen: "00000000-0000-0000-0000-000000000000", p_desti: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO traspassa accions (és del super_admin)" },
    { tabla: "activar_membre_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO activa comptes de l'equip (és del super_admin)" },
    { tabla: "desactivar_membre_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO desactiva comptes de l'equip (és del super_admin)" },
    { tabla: "editar_membre_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000", p_nom: "x", p_telefon: null }, descripcion: "NO edita comptes de l'equip (és del super_admin)" },
    { tabla: "esborrar_membre_equip", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO esborra comptes de l'equip (és del super_admin)" },
    { tabla: "equip_traspassos", op: "leer", esperado: "denegar", descripcion: "NO veu el registre de traspassos (0 files)" },
    // Rastro por fila del traspaso (20270515100000): solo el super_admin lo lee; nadie lo escribe.
    { tabla: "equip_traspassos_files", op: "leer", esperado: "denegar", descripcion: "NO veu el rastre per fila dels traspassos (0 files)" },
    { tabla: "equip_traspassos_files", op: "insertar", esperado: "denegar", descripcion: "NO escriu el rastre per fila directament" },
    { tabla: "equip_autoria_fila", op: "rpc", esperado: "denegar", args: { p_taula: "documentos", p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO consulta l'autoria original d'una fila (és del super_admin)" },
    // Auditoría del equipo y regeneración de documentos (20270516100000/100100): todo del super_admin.
    { tabla: "equip_auditoria", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO veu l'auditoria de l'equip (és del super_admin)" },
    { tabla: "equip_persones_arxiu", op: "leer", esperado: "denegar", descripcion: "NO veu l'arxiu de persones esborrades (0 files)" },
    { tabla: "equip_persones_arxiu", op: "insertar", esperado: "denegar", descripcion: "NO escriu l'arxiu de persones directament" },
    { tabla: "regenerar_documents_fundacio", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO regenera documents (és del super_admin)" },
    { tabla: "documento_datos_fundacio_actual", op: "rpc", esperado: "denegar", args: { p_datos: {} }, descripcion: "NO crida la funció interna de dades de la Fundació" },
    { tabla: "regeneracions_documents", op: "leer", esperado: "denegar", descripcion: "NO veu el registre de regeneracions (0 files)" },
    { tabla: "regeneracions_documents", op: "insertar", esperado: "denegar", descripcion: "NO escriu el registre de regeneracions directament" },
    // Pantalla de protecció prèvia a la home / la cortina (20270517110000): la contrasenya és en clar i només la veu el super_admin; la taula no té GRANT per a ningú.
    { tabla: "cortina_config", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO veu la contrasenya de la cortina (és del super_admin)" },
    { tabla: "cortina_activar", op: "rpc", esperado: "denegar", args: { p_activa: false }, descripcion: "NO encén ni apaga la cortina (és del super_admin)" },
    { tabla: "cortina_desar_contrasenya", op: "rpc", esperado: "denegar", args: { p_contrasenya: "contrasenya-arnes", p_hash: "0000000000000000000000000000000000000000000000000000000000000000", p_per: "arnes" }, descripcion: "NO desa la contrasenya de la cortina directament (només la Edge Function)" },
    { tabla: "cortina_config", op: "leer", esperado: "denegar", descripcion: "NO llegeix la taula de la cortina (contrasenya en clar: sense GRANT)" },
    { tabla: "cortina_config", op: "insertar", esperado: "denegar", descripcion: "NO escriu la taula de la cortina directament" },
    // Cua de fitxers orfes de Storage (20270526100000): sense GRANT per a ningú; la buida el job diari.
    { tabla: "fitxers_orfes", op: "leer", esperado: "denegar", descripcion: "NO llegeix la cua de fitxers orfes (sense GRANT)" },
    { tabla: "fitxers_orfes", op: "insertar", esperado: "denegar", descripcion: "NO escriu a la cua de fitxers orfes" },
    { tabla: "activar_organitzacio", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO activa organitzacions (és de l'admin)" },
    { tabla: "kpis_equip", op: "rpc", esperado: "permitir", args: { p_desde: "2026-01-01", p_hasta: "2026-12-31" }, descripcion: "veu els indicadors del període" },
    { tabla: "impacte_global", op: "rpc", esperado: "permitir", args: { p_desde: "2026-01-01", p_hasta: "2026-12-31" }, descripcion: "veu l'impacte de tota la plataforma" },
    { tabla: "factors_impacte", op: "leer", esperado: "permitir", descripcion: "veu els factors d'impacte", requiereFixture: "els factors sembrats (20270424100000)" },
    // Fijar un factor es del super_admin: un técnico, no.
    { tabla: "fixar_factor_impacte", op: "rpc", esperado: "denegar", args: { p_codi: "x", p_valor: 1 }, descripcion: "NO fixa els factors d'impacte (super_admin)" },
    { tabla: "fixar_notificacions", op: "rpc", esperado: "denegar", args: { p_actives: true }, descripcion: "NO toca l'interruptor general (és del super_admin)" },
    { tabla: "fixar_canal_notificacio", op: "rpc", esperado: "denegar", args: { p_canal: "email", p_actiu: true }, descripcion: "NO toca cap canal (és del super_admin)" },
    { tabla: "consentiments", op: "insertar", esperado: "denegar", descripcion: "NO escriu consentiments directament" },
    // El expediente: el día a día es del equipo (uuid inventado → 22023); abrir, verificar y
    // exportar es de `pot_aprovar()`, así que un técnico no.
    { tabla: "desar_element_expedient", op: "rpc", esperado: "permitir", args: { p_taula: "pla_visites", p_expedient: "00000000-0000-0000-0000-000000000000", p_id: null, p_dades: {} }, descripcion: "pot escriure els elements d'un expedient (22023 si no existeix)" },
    { tabla: "volcar_quantificacio_redestina", op: "rpc", esperado: "permitir", args: { p_expedient: "00000000-0000-0000-0000-000000000000", p_desde: "2026-01-01", p_hasta: "2026-12-31" }, descripcion: "pot importar la quantificacio de Redestina (22023 si no existeix)" },
    { tabla: "obrir_expedient", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO obre expedients (es de l'admin)" },
    { tabla: "exportar_expedient", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO exporta el pla (es de l'admin)" },
    { tabla: "expedients_prevencion", op: "leer", esperado: "permitir", descripcion: "veu els expedients de prevencio", requiereFixture: "algun expedient obert (fase 11)" },
    // Un papel nuevo lo pide el TITULAR; el equipo, no (lo aprueba después).
    { tabla: "afegir_paper_organitzacio", op: "rpc", esperado: "denegar", args: { p_tipo_actual: "productor", p_id_actual: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO afegeix papers en nom d'una organització" },
    // «No m'interessa» es SOLO de la entidad: tampoco el equipo contesta por ella.
    { tabla: "declinar_oferta", op: "rpc", esperado: "denegar", args: { p_resposta: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO respon «no m'interessa» en nom d'una entitat" },
    // La foto del catálogo es SOLO del super_admin (20270405100000), ni siquiera de un admin.
    {
      tabla: "fixar_foto_producte",
      op: "rpc",
      esperado: "denegar",
      args: { p_producto: "TEST-ARNES-INEXISTENT", p_foto: null, p_foto_mini: null },
      descripcion: "NO canvia la foto d'un producte (només super_admin)",
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
    { tabla: "emitir_certificado", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000", p_data_expedicio: "1999-12-31", p_annex: false }, descripcion: "NO emet certificats (és de pot_aprovar)" },
    // Emitir en bloque tampoco: es `pot_aprovar()`, la misma guarda que emitir uno a uno.
    // Si algún día la de la tanda se relajara sin tocar la individual, este check es el
    // único sitio donde se vería —desde el panel las dos se ven igual de grises—.
    { tabla: "emitir_certificados_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000", p_data_expedicio: "1999-12-31", p_annex: false }, descripcion: "NO emet en bloc els certificats d'un tancament (és de pot_aprovar)" },
    { tabla: "emitir_certificados_transaccion_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet en bloc els certificats de transacció (és de pot_aprovar)" },
    // Interno de la conciliación en cascada (20270414100100): ni el equipo lo llama.
    { tabla: "albarans_germans_rec", op: "rpc", esperado: "denegar", args: { p_rec: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO consulta els germans d'un albarà (intern)" },
    { tabla: "conciliacion_retroactiva", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_kg: 1, p_motivo: "arnes" }, descripcion: "NO concilia a posteriori (és de pot_aprovar)" },
    // Consultar los datos del 182 sí: es una lectura, y la hace el equipo con la gestoría.
    { tabla: "datos_182", op: "rpc", esperado: "permitir", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot consultar les dades del 182" },
    // Certificado de transacción (fase 5): calcular y emitir son de `pot_aprovar()`, igual
    // que en el circuito de donación. El técnico ve las filas y no mueve ninguna.
    { tabla: "calcular_cierre_transacciones", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO calcula les transaccions (és de pot_aprovar)" },
    { tabla: "emitir_certificado_transaccion", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet certificats de transaccio (és de pot_aprovar)" },
    { tabla: "rectificar_certificado_transaccion", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000", p_motivo: "arnes" }, descripcion: "NO rectifica un certificat de transaccio (és de pot_aprovar)" },
    // La base de cálculo SÍ es del equipo: es una lectura, y es lo que hace auditable la
    // cifra de un certificado. Sobre el ejercicio 1999 no devuelve nada, así que lo que
    // se mide es la autorización y no los datos.
    { tabla: "cierre_base", op: "rpc", esperado: "permitir", args: { p_ejercicio: 1999, p_modo: "prueba" }, descripcion: "pot llegir la base de calcul del tancament" },
    { tabla: "cierre_base_periodo", op: "rpc", esperado: "permitir", args: { p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" }, descripcion: "pot llegir la base de calcul d'un periode" },
    { tabla: "cierre_pendents_periodo", op: "rpc", esperado: "permitir", args: { p_desde: "1999-01-01", p_hasta: "1999-12-31" }, descripcion: "pot llegir els pendents d'un periode" },
    // Lo que se queda fuera de un certificado (20270509100000): lectura del equipo, como la
    // base de cálculo. Sobre un donante inexistente devuelve 0 filas.
    { tabla: "cierre_exclosos_periodo", op: "rpc", esperado: "permitir", args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_fins: "1999-12-31", p_excedente: null, p_modo: "prueba" }, descripcion: "pot llegir les donacions excloses d'un certificat" },
    { tabla: "motiu_exclusio_certificat", op: "rpc", esperado: "denegar", args: { p_valorizacion: "donacio", p_entidad: null, p_tipo_receptor: "social" }, descripcion: "NO executa el criteri intern del certificable (nomes servidor)" },
    // --- Auditoría de funciones del 07-10-2026 (20270414100400…101000) ---
    // La base de cálculo del CT sigue siendo del equipo (como la del CD); su snapshot y el
    // del plan, en cambio, son solo del servidor, igual que `cierre_datos_certificado()`.
    { tabla: "cierre_base_transaccion", op: "rpc", esperado: "permitir", args: { p_ejercicio: 1999, p_modo: "prueba" }, descripcion: "pot llegir la base de calcul del certificat de transaccio" },
    { tabla: "cierre_pendents_transaccion", op: "rpc", esperado: "permitir", args: { p_ejercicio: 1999 }, descripcion: "pot llegir les transaccions pendents de conciliar" },
    { tabla: "cierre_datos_certificado_transaccion", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO llegeix el snapshot del CT (nomes servidor)" },
    // `convenio_vigente()` la usan las pantallas del equipo (Aprovacions, OfferDetail,
    // CanalitzacioDetall) para avisar antes de aprobar: sobre cualquier ficha. Uuid de
    // ceros → `false`, sin error.
    { tabla: "convenio_vigente", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_valorizacion: "donacio", p_parte: "entrega" }, descripcion: "pot consultar el conveni de qualsevol fitxa" },
    { tabla: "exigir_convenio", op: "rpc", esperado: "denegar", args: { p_tipo: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_valorizacion: "venda", p_parte: "entrega" }, descripcion: "NO crida exigir_convenio directament (nomes servidor i RPC internes)" },
    { tabla: "organizacion_de", op: "rpc", esperado: "denegar", args: { p_tipo: "productor", p_ficha: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crida organizacion_de directament" },
    { tabla: "ruta_documento", op: "rpc", esperado: "denegar", args: { p_objeto_tipo: "prova", p_objeto_id: null, p_tipo: "PROVA", p_numero_completo: "PROVA-1999-0001", p_version: 1, p_modo: "prueba", p_ejercicio: 1999 }, descripcion: "NO compon rutes de documents (nomes servidor)" },
    { tabla: "disparar_recordatorios_intake", op: "rpc", esperado: "denegar", descripcion: "NO dispara els recordatoris d'intake (nomes pg_cron)" },
    { tabla: "marcar_excedentes_vencidos", op: "rpc", esperado: "denegar", descripcion: "NO marca ofertes vençudes (nomes pg_cron)" },
    // Certificado a demanda (CDP): el equipo lo LEE y no escribe nada. Calcular y emitir
    // son de `pot_aprovar()`, igual que en el cierre anual —y por el mismo motivo: los
    // dos documentos tienen el mismo efecto fiscal sobre el periodo que cubren—.
    {
      tabla: "cierres_periodo",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve els certificats de donacio a demanda",
      requiereFixture: "algún certificado a demanda calculado (calcular_certificado_periodo con una cuenta que pueda aprobar)",
    },
    { tabla: "cierres_periodo", op: "insertar", esperado: "denegar", descripcion: "NO crea certificats a demanda a mà (van per RPC)" },
    { tabla: "calcular_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba", p_excedente: null }, descripcion: "NO calcula un certificat a demanda (és de pot_aprovar)" },
    { tabla: "emitir_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000", p_data_expedicio: "1999-12-31", p_annex: false, p_excedente: null }, descripcion: "NO emet un certificat a demanda (és de pot_aprovar)" },
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
    { tabla: "descartar_convenio_esborrany", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO descarta un conveni (és de pot_aprovar)" },
    { tabla: "validar_oferta", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO valida una oferta (és de pot_aprovar)" },
    { tabla: "editar_oferta", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_canvis: {}, p_texto: "", p_actor: "00000000-0000-0000-0000-000000000000" }, descripcion: "NI l'equip edita per RPC (només el servidor)" },
    { tabla: "programar_albarans_recollida", op: "rpc", esperado: "denegar", descripcion: "NI l'equip emet albarans programats (només el servidor)" },
    { tabla: "resolver_convenio", op: "rpc", esperado: "denegar", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "NO resol un conveni (és de pot_aprovar)" },
    // Y NI EL EQUIPO firma por nadie: `firmar_convenio_por_enlace` y `validar_codi_firma`
    // son solo de `service_role`. Es lo que hace que una firma acredite algo: si el equipo
    // pudiera invocarla, el registro de evidencias no distinguiría a quien firmó de quien
    // tenía el panel abierto.
    { tabla: "firmar_convenio_por_enlace", op: "rpc", esperado: "denegar", args: { p_enlace: "00000000-0000-0000-0000-000000000000" }, descripcion: "NI l'equip firma per algú (només el servidor)" },
    { tabla: "validar_codi_firma", op: "rpc", esperado: "denegar", args: { p_enlace: "00000000-0000-0000-0000-000000000000", p_codi: "000000" }, descripcion: "NI l'equip valida el codi (només el servidor)" },
    // Ni acuña un enlace «propio»: un enlace de `canal = 'panel'` es el de quien tiene la
    // sesión, y el equipo no es titular de ninguna organización. Para lo suyo están
    // `enviar_convenio`, `iniciar_firma_asistida` y `marcar_entregado`.
    { tabla: "acunar_enllac_propi", op: "rpc", esperado: "denegar", args: { p_proposito: "firma_convenio", p_objeto_tipo: "convenio", p_objeto_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO acunya enllaços propis (no és titular de res)" },
    // La consulta sí la puede hacer: devuelve las de SUS organizaciones, y el equipo no
    // tiene ninguna, así que son 0 filas. Lo que se comprueba es que no dé 42501.
    { tabla: "pendents_meus", op: "rpc", esperado: "permitir", descripcion: "consulta els seus pendents (cap, no té organització)" },
    // La cola de trabajo consolidada (20270323100000). Devuelve SIEMPRE una fila por cola
    // —doce— aunque todas valgan 0, así que aquí no cabe ninguna saltada: si alguna vez
    // volviera vacía, es que la función ha dejado de cumplir su contrato y eso sí es un
    // fallo. `security invoker`, o sea que lo que cuenta es lo que este técnico ya podía
    // leer; lo que se comprueba es que la guarda le deja pasar.
    { tabla: "pendents_equip", op: "rpc", esperado: "permitir", filasExactas: 17, descripcion: "consulta la cua de treball de l'equip (17 cues)" },
    // Borrado de una ficha (20270328100100, deuda §12.108). El técnico SÍ puede preguntar
    // qué bloquea un borrado —es una pregunta del día a día, y sin ella el panel no podría
    // explicar por qué el botón no va a funcionar— y NO puede borrar: eso sigue siendo del
    // super_admin, igual que las políticas `productores: baixa super_admin` y
    // `entidades: baixa super_admin` que la RPC `security definer` deja de evaluar.
    //
    // La consulta va contra el uuid nulo: devuelve 0 filas y eso, en un `permitir` sin
    // `requiereFixture`, cuenta como ejecutada. Lo que se mide aquí es que la guarda le
    // deja pasar, no lo que contesta; lo que contesta se mide en el bloque `super_admin`.
    {
      tabla: "bloqueigs_esborrat_fitxa",
      op: "rpc",
      esperado: "permitir",
      args: { p_tipo: "productor", p_ficha: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot consultar què bloqueja l'esborrat d'una fitxa",
    },
    {
      tabla: "borrar_ficha_completa",
      op: "rpc",
      esperado: "denegar",
      args: { p_tipo: "productor", p_ficha_id: "00000000-0000-0000-0000-000000000000", p_tambe_germana: false },
      descripcion: "NO esborra fitxes (és de super_admin)",
    },
    // --- Circuito de firma (20270510100000–100200) ---
    ...FIRMA_SERVIDOR,
    {
      tabla: "firmes_document",
      op: "leer",
      esperado: "permitir",
      descripcion: "veu les signatures de documents",
      requiereFixture: "alguna signatura (scripts/crear-datos-documentales-prueba.ts → prepararSignatura)",
    },
    {
      tabla: "v_signatura_document",
      op: "leer",
      esperado: "permitir",
      descripcion: "veu l'estat de signatura dels documents",
      requiereFixture: "algun document signable vigent (albarà confirmat/conciliat, certificat emès o conveni)",
    },
    {
      tabla: "v_signatures_bandeja",
      op: "leer",
      esperado: "permitir",
      descripcion: "veu la safata de signatures",
      requiereFixture: "algun document signable vigent (albarà confirmat/conciliat, certificat emès o conveni)",
    },
    // El tècnic no tanca ni rebutja: és del super_admin. La guarda va abans de buscar la
    // signatura, així que el uuid inventat dona 42501.
    {
      tabla: "tancar_signatura",
      op: "rpc",
      esperado: "denegar",
      args: { p_firma: "00000000-0000-0000-0000-000000000000" },
      descripcion: "NO tanca cap signatura (es del super_admin)",
    },
    {
      tabla: "rebutjar_signatura",
      op: "rpc",
      esperado: "denegar",
      args: { p_firma: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" },
      descripcion: "NO rebutja cap signatura (es del super_admin)",
    },
    // Sin organización propia, el equipo no acuña enlaces de firma de panel (eso es de la
    // persona titular): 42501 antes de mirar si el documento existe.
    {
      tabla: "acunar_enllac_propi",
      op: "rpc",
      esperado: "denegar",
      args: {
        p_proposito: "firma_document",
        p_objeto_tipo: "documento",
        p_objeto_id: "00000000-0000-0000-0000-000000000000",
      },
      descripcion: "NO encunya un enllac de signatura de panell (no te organitzacio)",
    },
    // --- Importador de entidades (20270511100000) ---
    // El técnico lee el registro, pero importar es del super_admin: 42501 antes del payload.
    ...IMPORTACIO_INTERNES,
    { tabla: "previsualitzar_importacio_entitats", op: "rpc", esperado: "denegar", args: { p_files: [] }, descripcion: "NO previsualitza importacions (es del super_admin)" },
    { tabla: "importar_entitats", op: "rpc", esperado: "denegar", args: { p_fitxer: {}, p_files: [] }, descripcion: "NO importa entitats (es del super_admin)" },
    { tabla: "importacions_entitats", op: "leer", esperado: "permitir", descripcion: "veu el registre d'importacions", requiereFixture: "alguna importacio d'entitats (importar_entitats)" },
    { tabla: "importacions_entitats_files", op: "leer", esperado: "permitir", descripcion: "veu les files importades", requiereFixture: "alguna importacio d'entitats (importar_entitats)" },
    { tabla: "importacions_entitats_files", op: "leer", esperado: "permitir", columnas: "fila, canvis", descripcion: "veu els canvis (abans/després) de les importacions (B4)", requiereFixture: "alguna importacio d'entitats (importar_entitats)" },
  ],
  super_admin: [
    // Plan 1, 1A (20270501100000): con ids inventados la guarda de rol deja pasar y corta la
    // existencia con 22023 (`fitxa_inexistent`, `organitzacio_inexistent`) sin escribir nada.
    { tabla: "cerca_entitats", op: "rpc", esperado: "permitir", args: { p_q: "B0000" }, descripcion: "cerca entitats per NIF", requiereFixture: "fitxes amb NIF B0000… (fitxes de prova)" },
    { tabla: "activar_fitxa", op: "rpc", esperado: "permitir", args: { p_tipus: "entidad", p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot activar una fitxa (22023 si no existeix)" },
    { tabla: "v_entitats_llistat", op: "leer", esperado: "permitir", descripcion: "veu el llistat d'entitats (totes)", requiereFixture: "alguna organització amb fitxa" },
    { tabla: "desactivar_fitxa", op: "rpc", esperado: "permitir", args: { p_tipus: "productor", p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot desactivar una fitxa (22023 si no existeix)" },
    // Plan 2, B1 (20270518100000): con un id inventado, 22023 `fitxa_inexistent`.
    { tabla: "fixar_estat_crm", op: "rpc", esperado: "permitir", args: { p_tipus: "entidad", p_id: "00000000-0000-0000-0000-000000000000", p_estat: "en_desenvolupament" }, descripcion: "pot canviar l'estat CRM d'una fitxa (22023 si no existeix)" },
    { tabla: "desactivar_organitzacio", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot desactivar una organització (22023 si no existeix)" },
    { tabla: "afegir_paper_org_equip", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000", p_paper: "entidad" }, descripcion: "pot afegir un paper a una organització (22023 si no existeix)" },
    { tabla: "crear_entitat", op: "rpc", esperado: "permitir", args: { p_dades: { rols: [] } }, descripcion: "pot donar d'alta una entitat (22023 sense papers)" },
    { tabla: "productores", op: "insertar", esperado: "denegar", descripcion: "NO dona d'alta fitxes directament (només crear_entitat)" },
    { tabla: "entidades", op: "insertar", esperado: "denegar", descripcion: "NO dona d'alta fitxes directament (només crear_entitat)" },
    // Plan 1, 1D (20270501500000): con un id inventado, 22023 `organitzacio_inexistent`.
    { tabla: "estat_acces_org", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "veu l'estat d'accés d'una entitat (22023 si no existeix)" },
    // Plan 2, B3 (20270518110000): todo el equipo exporta (D10), también `tecnic`.
    { tabla: "exportar_entitats", op: "rpc", esperado: "permitir", args: { p_ids: null }, descripcion: "exporta les entitats a Excel (D10, tot l'equip)" },
    // Plan 2, A5 (20270523100000): todo el equipo confirma la naturalesa (`es_intern()`); con un
    // uuid inventado, 22023 `organitzacio_inexistent`; con un valor raro, 22023 antes de escribir.
    ...NATURALESA_COMUNS,
    { tabla: "fixar_naturalesa", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_org: "00000000-0000-0000-0000-000000000000", p_naturalesa: "empresa" }, descripcion: "pot fixar la naturalesa de qualsevol organitzacio (autoritza; 22023 organitzacio_inexistent) (A5)" },
    { tabla: "fixar_naturalesa", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_org: "00000000-0000-0000-0000-000000000000", p_naturalesa: "no_existeix" }, descripcion: "una naturalesa desconeguda es 22023 (A5)" },
    { tabla: "desactivar_acces_org", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot treure l'accés a una entitat (22023 si no existeix)" },
    // Plan 1, 1F (20270502100000): con ids inventados, 22023 (`organitzacio_inexistent`,
    // `nota_inexistent`): la guarda dejó pasar sin escribir ni borrar nada.
    { tabla: "notes_internes", op: "leer", esperado: "permitir", descripcion: "veu les notes internes", requiereFixture: "alguna nota interna (afegir_nota_interna)" },
    { tabla: "notes_internes", op: "insertar", esperado: "denegar", descripcion: "NO escriu notes directament (només afegir_nota_interna)" },
    { tabla: "afegir_nota_interna", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000", p_canal: "telefon", p_text: "arnes" }, descripcion: "pot afegir una nota interna (22023 si l'organització no existeix)" },
    { tabla: "esborrar_nota_interna", op: "rpc", esperado: "permitir", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot esborrar una nota interna (22023 si no existeix)" },
    { tabla: "tancar_seguiment", op: "rpc", esperado: "permitir", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot tancar un seguiment (22023 si la nota no existeix)" },
    // Consentimiento por enlace (20270506100000): pedirlo y listar es del equipo; guardarlo,
    // solo del servidor (`enlace-publico`).
    { tabla: "demanar_consentiment", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot demanar el consentiment (22023 si l'organització no existeix)" },
    { tabla: "llista_consentiments", op: "rpc", esperado: "permitir", args: {}, descripcion: "veu la llista de consentiments" },
    { tabla: "registrar_consentiment_enllac", op: "rpc", esperado: "denegar", args: { p_token_hash: "arnes", p_respostes: [], p_versio: "1", p_idioma: "ca" }, descripcion: "NO registra consentiments per enllaç (només service_role)" },
    { tabla: "preparar_enviament_albara", op: "rpc", esperado: "denegar", args: { p_albaran: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO prepara l'enviament d'un albarà (només service_role, enviar-albara)" },
    // El equipo (20270513100000): ver y cambiar roles es SOLO del super_admin.
    // Con un uuid inventado la guarda deja pasar y corta 22023 `usuari_inexistent` sin escribir nada.
    { tabla: "equip_membres", op: "rpc", esperado: "permitir", args: {}, descripcion: "veu les comptes de l'equip" },
    { tabla: "canviar_rol_equip", op: "rpc", esperado: "permitir", args: { p_user: "00000000-0000-0000-0000-000000000000", p_rol: "admin" }, descripcion: "pot canviar el rol d'un compte de l'equip (22023 si no existeix)" },
    { tabla: "equip_rols_hist", op: "leer", esperado: "permitir", descripcion: "veu l'historial de rols de l'equip", requiereFixture: "algun canvi de rol de l'equip" },
    { tabla: "equip_rols_hist", op: "insertar", esperado: "denegar", descripcion: "NO escriu l'historial de rols directament (només la RPC)" },
    // Gestión de las cuentas del equipo (20270514100000): todo es del super_admin; las internas no tienen EXECUTE para nadie.
    { tabla: "equip_columnes_autoria", op: "rpc", esperado: "denegar", args: {}, descripcion: "NO crida la llista interna de columnes d'autoria" },
    { tabla: "equip_moure_accions", op: "rpc", esperado: "denegar", args: { p_origen: "00000000-0000-0000-0000-000000000000", p_desti: "00000000-0000-0000-0000-000000000000", p_motiu: "traspas" }, descripcion: "NO mou accions directament (intern)" },
    { tabla: "equip_valida_desti", op: "rpc", esperado: "denegar", args: { p_origen: "00000000-0000-0000-0000-000000000000", p_desti: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crida la validacio interna del desti" },
    { tabla: "equip_total_accions", op: "rpc", esperado: "denegar", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO crida el recompte intern d'accions" },
    { tabla: "equip_traspassos", op: "insertar", esperado: "denegar", descripcion: "NO escriu el registre de traspassos directament" },
    // Con un uuid inventado la guarda deja pasar y corta 22023 `usuari_inexistent` sin escribir nada.
    { tabla: "equip_accions", op: "rpc", esperado: "permitir", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "veu les accions d'un compte (22023 si no existeix)" },
    { tabla: "traspassar_accions_equip", op: "rpc", esperado: "permitir", args: { p_origen: "00000000-0000-0000-0000-000000000000", p_desti: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot traspassar accions (22023 si no existeix)" },
    { tabla: "activar_membre_equip", op: "rpc", esperado: "permitir", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot activar un compte de l'equip (22023 si no existeix)" },
    { tabla: "desactivar_membre_equip", op: "rpc", esperado: "permitir", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot desactivar un compte de l'equip (22023 si no existeix)" },
    { tabla: "editar_membre_equip", op: "rpc", esperado: "permitir", args: { p_user: "00000000-0000-0000-0000-000000000000", p_nom: "x", p_telefon: null }, descripcion: "pot editar un compte de l'equip (22023 si no existeix)" },
    { tabla: "esborrar_membre_equip", op: "rpc", esperado: "permitir", args: { p_user: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot esborrar un compte de l'equip (22023 si no existeix)" },
    { tabla: "equip_traspassos", op: "leer", esperado: "permitir", descripcion: "veu el registre de traspassos", requiereFixture: "algun traspas d'accions entre comptes de l'equip" },
    { tabla: "equip_traspassos_files", op: "leer", esperado: "permitir", descripcion: "veu el rastre per fila dels traspassos", requiereFixture: "algun traspas d'accions entre comptes de l'equip" },
    { tabla: "equip_traspassos_files", op: "insertar", esperado: "denegar", descripcion: "NO escriu el rastre per fila directament (només la funció interna)" },
    { tabla: "equip_autoria_fila", op: "rpc", esperado: "permitir", args: { p_taula: "documentos", p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "consulta l'autoria original d'una fila (buida si no s'ha traspassat)" },
    { tabla: "equip_auditoria", op: "rpc", esperado: "permitir", args: {}, descripcion: "veu l'auditoria de l'equip (amb noms, encara que el compte s'hagi esborrat)" },
    { tabla: "equip_persones_arxiu", op: "leer", esperado: "permitir", descripcion: "veu l'arxiu de persones esborrades", requiereFixture: "algun compte de l'equip esborrat" },
    { tabla: "equip_persones_arxiu", op: "insertar", esperado: "denegar", descripcion: "NO escriu l'arxiu de persones directament (només el trigger)" },
    // Sin aceptar, la RPC solo informa: es segura de llamar desde el arnés.
    { tabla: "regenerar_documents_fundacio", op: "rpc", esperado: "permitir", args: {}, descripcion: "consulta quants documents es regenerarien (sense acceptar, no canvia res)" },
    { tabla: "documento_datos_fundacio_actual", op: "rpc", esperado: "denegar", args: { p_datos: {} }, descripcion: "NO crida la funció interna de dades de la Fundació" },
    { tabla: "regeneracions_documents", op: "leer", esperado: "permitir", descripcion: "veu el registre de regeneracions", requiereFixture: "alguna regeneracio de documents" },
    { tabla: "regeneracions_documents", op: "insertar", esperado: "denegar", descripcion: "NO escriu el registre de regeneracions directament" },
    // Pantalla de protecció prèvia a la home / la cortina (20270517110000): la contrasenya és en clar i només la veu el super_admin; la taula no té GRANT per a ningú.
    { tabla: "cortina_config", op: "rpc", esperado: "permitir", args: {}, descripcion: "veu l'estat de la cortina i la seva contrasenya (és del super_admin)" },
    { tabla: "cortina_activar", op: "rpc", esperado: "permitir", args: { p_activa: null }, descripcion: "pot encendre/apagar la cortina (amb null, error de negoci i no canvia res)" },
    { tabla: "cortina_desar_contrasenya", op: "rpc", esperado: "denegar", args: { p_contrasenya: "contrasenya-arnes", p_hash: "0000000000000000000000000000000000000000000000000000000000000000", p_per: "arnes" }, descripcion: "NO desa la contrasenya de la cortina directament (només la Edge Function)" },
    { tabla: "cortina_config", op: "leer", esperado: "denegar", descripcion: "NO llegeix la taula de la cortina (contrasenya en clar: sense GRANT)" },
    { tabla: "cortina_config", op: "insertar", esperado: "denegar", descripcion: "NO escriu la taula de la cortina directament" },
    // Cua de fitxers orfes de Storage (20270526100000): sense GRANT per a ningú; la buida el job diari.
    { tabla: "fitxers_orfes", op: "leer", esperado: "denegar", descripcion: "NO llegeix la cua de fitxers orfes (sense GRANT)" },
    { tabla: "fitxers_orfes", op: "insertar", esperado: "denegar", descripcion: "NO escriu a la cua de fitxers orfes" },
    { tabla: "activar_organitzacio", op: "rpc", esperado: "permitir", args: { p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot activar una organització (22023 si no existeix)" },
    { tabla: "concedir_acces_org", op: "rpc", esperado: "denegar", args: { p_org: "00000000-0000-0000-0000-000000000000", p_user: "00000000-0000-0000-0000-000000000000", p_email: "arnes@exemple.cat", p_per: null }, descripcion: "NO dona accés per la porta del servidor (només service_role)" },
    { tabla: "revertir_acces_org", op: "rpc", esperado: "denegar", args: { p_foto: {} }, descripcion: "NO reverteix accessos (només service_role)" },
    { tabla: "fitxa_estat_hist", op: "leer", esperado: "permitir", descripcion: "veu l'historial d'estats de les fitxes", requiereFixture: "algun canvi d'estat d'una fitxa (activar/desactivar)" },
    { tabla: "fitxa_estat_hist", op: "insertar", esperado: "denegar", descripcion: "NO escriu l'historial directament (només el trigger)" },
    { tabla: "desar_contacte_org", op: "rpc", esperado: "denegar", args: { p_id: null, p_organizacion: "00000000-0000-0000-0000-000000000000", p_dades: { nom: "arnes" } }, descripcion: "NO afegeix contactes (retirats, D3; tampoc el super_admin)" },
    // Abrir, verificar y exportar un expediente: uuid inventado → 22023 (la guarda dejó pasar).
    { tabla: "obrir_expedient", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot obrir un expedient (22023 si la fitxa no existeix)" },
    { tabla: "exportar_expedient", op: "rpc", esperado: "permitir", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot exportar el pla (22023 si no existeix)" },
    { tabla: "verificar_expedient", op: "rpc", esperado: "permitir", args: { p_id: "00000000-0000-0000-0000-000000000000", p_any: 2026, p_resum: "x", p_conclusio: "x" }, descripcion: "pot verificar un expedient (22023 si no existeix)" },
    // El super_admin fija los factores. Código inventado → 22023 factor_inexistent: la guarda dejó pasar.
    { tabla: "fixar_factor_impacte", op: "rpc", esperado: "permitir", args: { p_codi: "x", p_valor: 1 }, descripcion: "pot fixar els factors d'impacte (22023 si el codi no existeix)" },
    // Con un canal inventado: la guarda de ROL deja pasar y la validación corta con 22023
    // antes de escribir. Así se prueba sin tocar ningún interruptor de producción.
    { tabla: "fixar_canal_notificacio", op: "rpc", esperado: "permitir", args: { p_canal: "fax", p_actiu: true }, descripcion: "pot tocar els canals (22023 canal_desconegut)" },
    // Aprobar un certificado en nombre del donante (fase 4): id inventado → 22023.
    { tabla: "aprovar_certificat_equip", op: "rpc", esperado: "permitir", args: { p_id: "00000000-0000-0000-0000-000000000000", p_tipus: "anual", p_nota: "arnes" }, descripcion: "aprova un certificat en nom del donant (id inventat → 22023)" },
    // La recogida la valida un admin (20270428100000). Con un id inventado la guarda de rol
    // deja pasar y corta la existencia (22023 canalitzacio_inexistent). En positivo NO se
    // prueba aquí: validar emite albaranes con numeración legal (lo hace el E2E del clon).
    { tabla: "validar_recollida", op: "rpc", esperado: "permitir", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000" }, descripcion: "valida una recollida (id inventat → 22023)" },
    { tabla: "retornar_recollida", op: "rpc", esperado: "permitir", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" }, descripcion: "retorna una recollida al receptor (id inventat → 22023)" },
    { tabla: "confirmar_recollida", op: "rpc", esperado: "permitir", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_kg_reals: 1 }, descripcion: "confirma una recollida en nom de les parts (id inventat → 22023)" },
    // Gestión autónoma (20270430100000/100200). Declarar un convenio con un tipo que no es el
    // del papel corta con 22023 DESPUÉS de la guarda de rol: autoriza sin escribir nada.
    { tabla: "declarar_conveni", op: "rpc", esperado: "permitir", args: { p_tipo_org: "entidad", p_org: "00000000-0000-0000-0000-000000000000", p_tipo: "fax", p_signant_nom: "arnes", p_signant_carrec: "arnes" }, descripcion: "pot donar per vigent un conveni (tipus inventat → 22023)" },
    { tabla: "registrar_recollida_assistida", op: "rpc", esperado: "permitir", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_resultat: "coincideix" }, descripcion: "registra una recollida en nom del receptor (id inventat → 22023)" },
    // --- CHECK GLOBAL del catálogo (20270414101000) ---
    // No mira una función: mira TODAS las de `public`. Falla si alguna `security definer`
    // (no de trigger) es ejecutable por `anon`, o si alguna de trigger lo es por `anon` o
    // `authenticated`, y no está en `PERMITIDAS_ABIERTAS` (vacía; ver su comentario). Es la
    // vigilancia del patrón que produjo la auditoría del 07-10-2026: una función nueva hereda
    // EXECUTE para `anon` del `alter default privileges` de Supabase si nadie lo revoca.
    {
      tabla: "auditoria_funcions_obertes",
      op: "rpc",
      esperado: "permitir",
      listaPermitida: PERMITIDAS_ABIERTAS,
      descripcion: "cap funcio definer oberta a anon ni de trigger oberta a l'API (fora de la llista)",
    },
    // --- El conveni signat EN PAPER (20270329100300) ---
    // Los dos con uuid de ceros, por el mismo motivo que `crear_espigolada` aquí abajo: lo
    // que se afirma es que la guarda de ROL deja pasar, no que la operación se complete.
    // En positivo no se prueban nunca — `preparar_conveni_en_paper` CREA un borrador de
    // convenio sobre una organización real, y `registrar_conveni_en_paper` la dejaría
    // operando sin haber firmado nada. La organización inventada corta con `23503`
    // (violación de FK) y el convenio inventado con `22023 conveni_inexistent`, los dos
    // errores de negocio: prueban que se autorizó.
    {
      tabla: "preparar_conveni_en_paper",
      op: "rpc",
      esperado: "permitir",
      args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_tipo: "don_gen" },
      descripcion: "pot preparar un conveni signat en paper (la guarda el deixa passar)",
    },
    {
      tabla: "registrar_conveni_en_paper",
      op: "rpc",
      esperado: "permitir",
      args: {
        p_conveni: "00000000-0000-0000-0000-000000000000",
        p_data_firma: "2020-01-01",
        p_referencia: "arnes",
        p_signant_nom: "arnes",
      },
      descripcion: "pot donar per vigent un conveni signat en paper (la guarda el deixa passar)",
    },
    // La guarda de rol de la conversión de una oferta en jornada (F3, 20270328101000).
    // Mismo criterio que en `equip`: uuid de ceros, porque en positivo no se prueba nunca
    // —convertiría una oferta real contra producción—. Devuelve `22023 oferta_inexistent`,
    // que es error de negocio y cuenta como ejecutada.
    {
      tabla: "crear_espigolada",
      op: "rpc",
      esperado: "permitir",
      args: {
        p_productor: "00000000-0000-0000-0000-000000000000",
        p_excedente: "00000000-0000-0000-0000-000000000000",
      },
      descripcion: "pot convertir una oferta en espigolada (la guarda el deixa passar)",
    },
    {
      tabla: "recalcula_estat_espigolada",
      op: "rpc",
      esperado: "denegar",
      args: { p_espigolada: "00000000-0000-0000-0000-000000000000" },
      descripcion: "NO obre ni tanca espigolades a mà (ho fa el trigger)",
    },
    // --- Certificat de recepcio (CR). Todos contra un uuid inexistente o el ejercicio
    //     1999: miden la guarda de ROL y no dejan rastro. Emitir uno de verdad consumiría
    //     un número de la serie CR y mandaría un correo, que es exactamente lo que un
    //     arnés que corre contra producción no debe hacer.
    { tabla: "calcular_certificat_recepcio", op: "rpc", esperado: "permitir", args: { p_entidad: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" }, descripcion: "pot calcular un certificat de recepcio (autoritza; l'entitat no existeix)" },
    { tabla: "emetre_certificat_recepcio", op: "rpc", esperado: "permitir", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot emetre un certificat de recepcio (autoritza; el periode no existeix)" },
    { tabla: "rectificar_certificat_recepcio", op: "rpc", esperado: "permitir", args: { p_id: "00000000-0000-0000-0000-000000000000", p_motiu: "Comprovacio de l'arnes de RLS" }, descripcion: "pot rectificar un certificat de recepcio (autoritza; el periode no existeix)" },
    { tabla: "marcar_enviat_recepcio", op: "rpc", esperado: "permitir", args: { p_id: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot marcar com a enviat (autoritza; el periode no existeix)" },
    { tabla: "reiniciar_recepcions_prova", op: "rpc", esperado: "permitir", args: { p_ejercicio: 1999 }, descripcion: "pot reiniciar els certificats de recepcio de prova (1999: no hi ha res)" },
    { tabla: "cierres_receptor", op: "leer", esperado: "permitir", descripcion: "ve els certificats de recepcio", requiereFixture: "algún certificado de recepción calculado (calcular_certificat_recepcio)" },
    { tabla: "kg_rebuts_exercici", op: "rpc", esperado: "permitir", args: {}, descripcion: "veu els quilos rebuts", requiereFixture: "alguna canalización conciliada del ejercicio en curso" },
    // --- Diagnostic (F2) ---
    // El cuestionario y el plan básico se retiraron con la deuda 174/175 (20270524100000).
    { tabla: "diagnostics_equip", op: "rpc", esperado: "permitir", descripcion: "veu els diagnostics de tota la base", requiereFixture: "alguna fitxa de productor o entitat" },
    { tabla: "diagnostic_estat", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot consultar l'estat del diagnostic de qualsevol organitzacio" },
    // --- Diagnòstic únic (A1, 20270520100000) ---
    // Ni el super_admin escribe `diagnostics` a mano (A1 le quitó el GRANT de escritura).
    { tabla: "diagnostics", op: "leer", esperado: "permitir", descripcion: "veu els diagnostics (A1)", requiereFixture: "algun diagnostic desat (per RPC o el backfill d'A1)" },
    { tabla: "diagnostics", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap diagnostic a ma (nomes per RPC)" },
    { tabla: "diagnostics", op: "actualizar", esperado: "denegar", descripcion: "NO modifica cap diagnostic a ma (nomes per RPC)" },
    { tabla: "diagnostic_datos", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot llegir el diagnostic de qualsevol productor (autoritza; 22023 fitxa_inexistent)" },
    // --- Operativa (A4, 20270521100000) ---
    // El equipo edita la Operativa de cualquier productor con UPDATE directo (ficha y sección 1
    // del diagnóstico, T4) y marca su lugar principal por la RPC.
    { tabla: "productores", op: "leer", esperado: "permitir", columnas: "id, productes_principals, varietats, volum_produccio, envasos_habituals, canals_comercials, tipologia_clients, facturacio_anual_eur, facturacio_rang, volum_comercialitzat_kg, suport_interes", descripcion: "veu la Operativa de tots els productors (A4)" },
    { tabla: "productores", op: "actualizar", esperado: "permitir", columnas: "id, envasos_habituals", descripcion: "edita la Operativa d'una fitxa (A4, mateix valor)" },
    { tabla: "fixar_lloc_principal", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_lloc: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot triar el lloc principal de qualsevol productor (autoritza; 22023 lloc_inexistent) (A4)" },
    // --- Excedentes del diagnóstico (A3, 20270522100000): ver `DIAGNOSTIC_EXCEDENTS_EQUIP` ---
    ...DIAGNOSTIC_EXCEDENTS_EQUIP,
    // --- La via assistida (20270328100200 / 20270328100300 / 20270328100400) ---
    // ⚠️ Los tres «permitir» se llaman con un uuid INEXISTENTE a propósito, igual que los
    //    del ciclo de cierre: lo que se afirma es que la guarda de ROL deja pasar, no que
    //    la operación se complete. `acunar_enllac_assistit()` ESCRIBE —acuña un enlace y
    //    revoca el anterior—, así que ejercitarla en positivo contra producción le
    //    rompería el enlace a alguien de verdad. Es el mismo criterio con el que
    //    `borrar_ficha_completa()` tampoco se prueba en positivo.
    {
      tabla: "acunar_enllac_assistit",
      op: "rpc",
      esperado: "permitir",
      args: {
        p_proposito: "confirmacion_albaran",
        p_objeto_tipo: "albaran",
        p_objeto_id: "00000000-0000-0000-0000-000000000000",
      },
      descripcion: "pot encunyar un enllac assistit (autoritza; l'albara no existeix)",
    },
    {
      tabla: "manifestar_interes_assistit",
      op: "rpc",
      esperado: "permitir",
      args: {
        p_excedente: "00000000-0000-0000-0000-000000000000",
        p_entidad: "00000000-0000-0000-0000-000000000000",
        p_kg: 1,
      },
      descripcion: "pot registrar un interes assistit (autoritza; l'oferta no existeix)",
    },
    {
      tabla: "canalitzacions_actives",
      op: "rpc",
      esperado: "permitir",
      descripcion: "veu els lots en curs de la pantalla guiada",
    },
    { tabla: "productores", op: "leer", esperado: "permitir", descripcion: "ve las fichas de productor" },
    { tabla: "app_settings", op: "actualizar", esperado: "permitir", descripcion: "puede tocar el modo test" },
    { tabla: "app_config", op: "leer", esperado: "denegar", descripcion: "NO lee los secretos" },
    { tabla: "series_documentales", op: "leer", esperado: "permitir", descripcion: "ve los contadores de serie" },
    // La emite de verdad y se limpia acto seguido: es la única comprobación del arnés
    // que ejercita el circuito documental entero (número + snapshot + ruta).
    // La limpieza solo alcanza las series que esa RPC posee (`PROVA` y `P-CT`, desde
    // `20270319100000`), así que el arnés es inocuo para un ensayo de cierre en curso y
    // no deja hueco en ninguna serie legal. Ver `limpiar` arriba.
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
    // La contraparte del «denegar» del técnico, SIN ESCRIBIR NADA. Hasta el 27-09-2026 se
    // fijaba un coste de Tomàquet en el «ejercicio 1999» y se borraba después; con un solo
    // coste por producto (20270405100200) eso SOBRESCRIBIRÍA y BORRARÍA el coste real de
    // Tomàquet. Ahora: un coste 0 pasa la guarda de rol y lo rechaza la validación (22023).
    {
      tabla: "fijar_coste_producto",
      op: "rpc",
      esperado: "permitir",
      args: { p_producto: "Tomàquet", p_coste: 0, p_motivo: "Comprobación del arnés de RLS" },
      descripcion: "puede fijar el coste por kilo (autoriza; el coste 0 no se escribe)",
    },
    // Borrar un coste que no existe devuelve 0 sin tocar nada.
    {
      tabla: "borrar_coste_producto",
      op: "rpc",
      esperado: "permitir",
      args: { p_producto: "TEST-ARNES-INEXISTENT", p_motivo: "Comprobación del arnés de RLS" },
      descripcion: "puede borrar un coste por kilo (sobre un producto inexistente: no escribe)",
    },
    {
      tabla: "fixar_foto_producte",
      op: "rpc",
      esperado: "permitir",
      args: { p_producto: "TEST-ARNES-INEXISTENT", p_foto: null, p_foto_mini: null },
      descripcion: "pot canviar la foto d'un producte (autoritza; el producte no existeix)",
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
    // técnico. RETIRADO en 20270509100400: la autorización pasa y la función responde
    // `22023 certificat_transaccio_retirat` (calcular devuelve `{retirat: true}` sin
    // escribir). Lo que se mide sigue siendo que la guarda de rol va primero.
    {
      tabla: "calcular_cierre_transacciones",
      op: "rpc",
      esperado: "permitir",
      args: { p_cierre: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot cridar el càlcul de transaccions (autoritza; retirat: no escriu res)",
    },
    {
      tabla: "emitir_certificado_transaccion",
      op: "rpc",
      esperado: "permitir",
      args: { p_cd: "00000000-0000-0000-0000-000000000000" },
      descripcion: "passa la guarda d'emetre un CT (autoritza; retirat → 22023)",
    },
    {
      tabla: "rectificar_certificado_transaccion",
      op: "rpc",
      esperado: "permitir",
      args: { p_cd: "00000000-0000-0000-0000-000000000000", p_motivo: "Comprobación del arnés de RLS" },
      descripcion: "passa la guarda de rectificar un CT (autoritza; retirat → 22023)",
    },
    // Emitir en bloque los certificados de un cierre (20270328100800). Sobre un uuid
    // inventado la guarda de rol pasa y la función cae con 22023 («aquest tancament no
    // existeix») sin dejar rastro. **El bloque real no se prueba nunca en positivo**: una
    // sola llamada buena consumiría N números de la serie CD y mandaría N correos, y eso
    // es exactamente lo que un arnés que corre contra producción no puede hacer.
    {
      tabla: "emitir_certificados_cierre",
      op: "rpc",
      esperado: "permitir",
      args: { p_cierre: "00000000-0000-0000-0000-000000000000", p_data_expedicio: "1999-12-31", p_annex: false },
      descripcion: "pot emetre en bloc els certificats (autoritza; el tancament no existeix)",
    },
    // El mismo criterio para la tanda de CT (20270414100200): uuid inventado, la guarda de
    // rol pasa y cae con 22023 sin consumir ningún número de CT / P-CT.
    {
      tabla: "emitir_certificados_transaccion_cierre",
      op: "rpc",
      esperado: "permitir",
      args: { p_cierre: "00000000-0000-0000-0000-000000000000" },
      descripcion: "passa la guarda de la tanda de CT (autoritza; retirat → 22023)",
    },
    {
      tabla: "albarans_germans_rec",
      op: "rpc",
      esperado: "denegar",
      args: { p_rec: "00000000-0000-0000-0000-000000000000" },
      descripcion: "NO consulta els germans d'un albarà (intern; ni el super_admin)",
    },
    // Certificado de donación a demanda (CDP). Todas sobre un uuid inventado o sobre el
    // ejercicio **1999**: la autorización pasa y la función falla después con 22023, sin
    // dejar rastro. Emitir uno de verdad consumiría un número de la serie CDP, que es
    // exactamente lo que un arnés no debe hacer.
    {
      tabla: "calcular_certificado_periodo",
      op: "rpc",
      esperado: "permitir",
      args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" },
      descripcion: "pot calcular un certificat a demanda (autoritza; el donant no existeix)",
    },
    {
      tabla: "emitir_certificado_periodo",
      op: "rpc",
      esperado: "permitir",
      args: { p_periodo: "00000000-0000-0000-0000-000000000000", p_data_expedicio: "1999-12-31", p_annex: true, p_excedente: null },
      descripcion: "pot emetre un certificat a demanda (autoritza; el periode no existeix)",
    },
    // El ámbito oferta y la fecha de expedición (20270509100100 / 100200), con la firma
    // nueva y sobre uuids inventados: 22023 («aquest donant no existeix» / «aquest donant
    // no es d'un tancament») sin consumir ningún número.
    {
      tabla: "calcular_certificado_periodo",
      op: "rpc",
      esperado: "permitir",
      args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: null, p_hasta: null, p_modo: "prueba", p_excedente: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot calcular el certificat d'una oferta (autoritza; el donant no existeix)",
    },
    {
      tabla: "emitir_certificado",
      op: "rpc",
      esperado: "permitir",
      args: { p_cd: "00000000-0000-0000-0000-000000000000", p_data_expedicio: "1999-12-31", p_annex: true },
      descripcion: "pot emetre el certificat anual amb data d'expedició (autoritza; l'acumulat no existeix)",
    },
    {
      tabla: "cierre_exclosos_periodo",
      op: "rpc",
      esperado: "permitir",
      args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_fins: "1999-12-31", p_excedente: null, p_modo: "prueba" },
      descripcion: "pot llegir les donacions excloses d'un periode",
    },
    {
      tabla: "cierre_exclosos_periodo",
      op: "rpc",
      esperado: "permitir",
      args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: null, p_fins: null, p_excedente: "00000000-0000-0000-0000-000000000000", p_modo: "real" },
      descripcion: "pot llegir les donacions excloses d'una oferta",
    },
    {
      tabla: "rectificar_certificado_periodo",
      op: "rpc",
      esperado: "permitir",
      args: { p_periodo: "00000000-0000-0000-0000-000000000000", p_motivo: "Comprobación del arnés de RLS" },
      descripcion: "pot rectificar un certificat a demanda (autoritza; el periode no existeix)",
    },
    {
      tabla: "registrar_factura_periodo",
      op: "rpc",
      esperado: "permitir",
      args: { p_periodo: "00000000-0000-0000-0000-000000000000", p_numero: "F-ARNES" },
      descripcion: "pot registrar la factura d'un periode (autoritza; el periode no existeix)",
    },
    {
      tabla: "reiniciar_periodes_prova",
      op: "rpc",
      esperado: "permitir",
      args: { p_ejercicio: 1999 },
      descripcion: "pot reiniciar els certificats a demanda de prova (exercici 1999: no hi ha res)",
    },
    {
      tabla: "cierres_periodo",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve els certificats de donacio a demanda",
      requiereFixture: "algún certificado a demanda calculado (calcular_certificado_periodo)",
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
      tabla: "descartar_convenio_esborrany",
      op: "rpc",
      esperado: "permitir",
      args: { p_id: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot descartar un esborrany (autoritza; el conveni no existeix)",
    },
    {
      tabla: "validar_oferta",
      op: "rpc",
      esperado: "permitir",
      args: { p_id: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot validar una oferta (autoritza; l'oferta no existeix, 22023)",
    },
    { tabla: "pendents_equip", op: "rpc", esperado: "permitir", filasExactas: 17, descripcion: "consulta la cua de treball de l'equip (17 cues)" },
    {
      tabla: "convenios",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve tots els convenis",
      requiereFixture: "algún convenio (scripts/crear-datos-documentales-prueba.ts)",
    },
    // ── Borrado de una ficha (20270328100100, deuda §12.108) ───────────────────
    //
    // La contraparte del «denegar» del técnico: el super_admin SÍ pasa la guarda. Sobre el
    // uuid nulo la autorización pasa y la función falla después con `22023
    // fitxa_no_trobada`, que es lo que el arnés lee como «dejó pasar» — el mismo patrón que
    // `contrafirmar_convenio` y `cerrar_cierre`, y por el mismo motivo: ejercitarla contra
    // una ficha real la borraría, y esto corre contra producción (§7).
    {
      tabla: "borrar_ficha_completa",
      op: "rpc",
      esperado: "permitir",
      args: { p_tipo: "productor", p_ficha_id: "00000000-0000-0000-0000-000000000000", p_tambe_germana: false },
      descripcion: "pot esborrar una fitxa (autoritza; la fitxa no existeix)",
    },
    // Y AQUÍ SE MIDE EL BLOQUEO DE VERDAD, sin poder romper nada: una ficha con albaranes
    // emitidos, cierres o documentos **tiene que devolver al menos un motivo**. Si algún
    // día alguien relaja el paso 1 de `borrar_ficha_completa()`, esta comprobación se queda
    // sin filas antes de que ninguna ficha se pierda.
    //
    // ⚠️ Lo que este check NO puede afirmar: sin el fixture sale SALTADA, y una regresión
    //    del bloqueo se vería igual (0 filas → «falta fixture»). Es la misma limitación de
    //    todos los `requiereFixture`; lo que la acota es que el marcador
    //    `@fitxa_amb_documents` resuelve a un productor que **demostrablemente** tiene un
    //    albarán fuera de borrador, así que si esa ficha existe y aquí no sale ningún
    //    motivo, la línea de «sense» está describiendo un fallo. Al leer el informe, una
    //    saltada en esta línea con el fixture puesto hay que ir a mirarla.
    {
      tabla: "bloqueigs_esborrat_fitxa",
      op: "rpc",
      esperado: "permitir",
      args: { p_tipo: "productor", p_ficha: "@fitxa_amb_documents" },
      descripcion: "una fitxa amb albarans emesos NO es pot esborrar (i diu per què)",
      requiereFixture: "un albarán emitido de una ficha de prueba (scripts/crear-datos-documentales-prueba.ts)",
    },
    // 20270508100000 (04-11-2026): las OFERTAS también bloquean el borrado. De solo lectura,
    // por el mismo motivo que el de arriba; y exige el código `ofertes`, no un motivo
    // cualquiera: un productor con ofertas suele tener además albaranes, y sin `codiEsperat`
    // este check pasaría aunque se perdiera la regla nueva.
    {
      tabla: "bloqueigs_esborrat_fitxa",
      op: "rpc",
      esperado: "permitir",
      args: { p_tipo: "productor", p_ficha: "@fitxa_amb_ofertes" },
      codiEsperat: "ofertes",
      descripcion: "una fitxa amb ofertes NO es pot esborrar (motiu «ofertes»)",
      requiereFixture: "una oferta de una ficha de prueba",
    },
    // Deuda §12.140 (20270525100000): un expediente de prevención NUMERADO también bloquea, con su
    // código (antes el borrado acababa en un 23503 de la FK `restrict`). De solo lectura.
    {
      tabla: "bloqueigs_esborrat_fitxa",
      op: "rpc",
      esperado: "permitir",
      args: { p_tipo: "productor", p_ficha: "@fitxa_amb_expedient" },
      codiEsperat: "expedients",
      descripcion: "una fitxa amb un expedient de prevencio amb numero NO es pot esborrar (motiu «expedients»)",
      requiereFixture: "un expediente de prevención numerado",
    },
    // --- Circuito de firma (20270510100000–100200) ---
    // Cerrar y rechazar son del super_admin: con un uuid inventado la guarda deja pasar y la
    // existencia corta con 22023 (`estat_incorrecte`); sin motivo, `cal_motiu`. No escribe nada.
    ...FIRMA_SERVIDOR,
    {
      tabla: "tancar_signatura",
      op: "rpc",
      esperado: "permitir",
      args: { p_firma: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot tancar una signatura (autoritza; la signatura no existeix)",
    },
    {
      tabla: "rebutjar_signatura",
      op: "rpc",
      esperado: "permitir",
      args: { p_firma: "00000000-0000-0000-0000-000000000000", p_motiu: "arnes" },
      descripcion: "pot rebutjar una signatura (autoritza; la signatura no existeix)",
    },
    {
      tabla: "rebutjar_signatura",
      op: "rpc",
      esperado: "permitir",
      args: { p_firma: "00000000-0000-0000-0000-000000000000", p_motiu: "  " },
      descripcion: "rebutjar sense motiu → 22023 cal_motiu",
    },
    {
      tabla: "firmes_document",
      op: "leer",
      esperado: "permitir",
      descripcion: "veu les signatures de documents",
      requiereFixture: "alguna signatura (scripts/crear-datos-documentales-prueba.ts → prepararSignatura)",
    },
    {
      tabla: "v_signatures_bandeja",
      op: "leer",
      esperado: "permitir",
      descripcion: "veu la safata de signatures",
      requiereFixture: "algun document signable vigent (albarà confirmat/conciliat, certificat emès o conveni)",
    },
    // --- Importador de entidades (20270511100000) ---
    // Con un payload inválido la guarda deja pasar y corta 22023 `dades_invalides` sin
    // escribir nada (ni el registro: se valida antes de insertarlo).
    ...IMPORTACIO_INTERNES,
    { tabla: "previsualitzar_importacio_entitats", op: "rpc", esperado: "permitir", args: { p_files: {} }, descripcion: "pot previsualitzar una importacio (22023 dades_invalides)" },
    { tabla: "importar_entitats", op: "rpc", esperado: "permitir", args: { p_fitxer: {}, p_files: [] }, descripcion: "pot importar entitats (22023 dades_invalides)" },
    { tabla: "importacions_entitats", op: "leer", esperado: "permitir", descripcion: "veu el registre d'importacions", requiereFixture: "alguna importacio d'entitats (importar_entitats)" },
    { tabla: "importacions_entitats_files", op: "leer", esperado: "permitir", descripcion: "veu les files importades", requiereFixture: "alguna importacio d'entitats (importar_entitats)" },
    { tabla: "importacions_entitats_files", op: "leer", esperado: "permitir", columnas: "fila, canvis", descripcion: "veu els canvis (abans/després) de les importacions (B4)", requiereFixture: "alguna importacio d'entitats (importar_entitats)" },
  ],
  productor: [
    { tabla: "impacte_productor", op: "rpc", esperado: "permitir", args: { p_desde: "2026-01-01", p_hasta: "2026-12-31" }, descripcion: "veu el seu impacte (fase 10)" },
    { tabla: "productores", op: "leer", esperado: "permitir", descripcion: "ve SU ficha (solo la suya)" },
    // El archivo que el equipo guarda de SU organización (20270329100000): convenios
    // firmados en papel, certificados de ejercicios anteriores, planes previos. La
    // asimetría es el punto de esas dos ramas de la política: el equipo escribe y la
    // organización lee, al revés que en albaranes y cierres, donde sube el titular.
    //
    // ⚠️ Sale SALTADA mientras no haya ningún externo subido, y eso NO es lo mismo que
    //    «la política funciona»: sin fixture, 0 filas es indistinguible de un rechazo.
    {
      tabla: "documentos_externos",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve la documentació que l'equip li ha guardat",
      requiereFixture: "algún externo de su ficha (pujarDocumentExtern con objecteTipus 'productor')",
    },
    { tabla: "entidades", op: "leer", esperado: "denegar", descripcion: "NO ve las entidades" },
    { tabla: "wa_messages", op: "leer", esperado: "denegar", descripcion: "NO ve la mensajería" },
    { tabla: "wa_contacts", op: "leer", esperado: "denegar", descripcion: "NO ve los contactos" },
    { tabla: "intake_sessions", op: "leer", esperado: "denegar", descripcion: "NO ve los intakes" },
    { tabla: "app_settings", op: "leer", esperado: "denegar", descripcion: "NO ve la configuración" },
    { tabla: "productos", op: "leer", esperado: "permitir", descripcion: "lee el catálogo (lo necesita el alta de oferta)" },
    { tabla: "excedentes", op: "insertar", esperado: "denegar", descripcion: "NO inserta ofertas a mano (van por la Edge Function)" },
    {
      tabla: "excedentes",
      op: "leer",
      esperado: "permitir",
      columnas: "id, estado, producte_al_camp",
      descripcion: "veu si la SEVA oferta declara producte al camp",
      requiereFixture: "alguna oferta de TEST-PROD-1",
    },
    // `producte_al_camp` decide un flujo: si la oferta sale en la cola del equipo y si se
    // puede convertir en jornada. La única política de UPDATE de `excedentes` es
    // `es_intern()` (20260730096000:39), así que un externo no la mueve.
    //
    // ⚠️ Un UPDATE denegado por RLS NO da error: PostgREST no encuentra filas que cumplan
    //    el `using` y devuelve éxito con cero afectadas. Por eso la rama `actualizar` pide
    //    las filas afectadas y trata «cero sobre una fila que sé que existe» como
    //    denegación (§4bis).
    { tabla: "excedentes", op: "actualizar", esperado: "denegar", descripcion: "NO marca la seva oferta com a «producte al camp»" },
    // El certificado de recepción es de la ENTIDAD, no del generador. Ni siquiera el del
    // que le entregó lo suyo: lo que acredita es lo que recibió ELLA.
    { tabla: "cierres_receptor", op: "leer", esperado: "denegar", descripcion: "NO veu cap certificat de recepcio" },
    { tabla: "cierre_receptor_lineas", op: "leer", esperado: "denegar", descripcion: "NO veu les linies de cap certificat de recepcio" },
    // ⚠️ `kg_rebuts_exercici()` SÍ le devuelve filas a un generador, y NO es una fuga: es
    //    `security invoker`, así que agrega exactamente lo que su RLS ya le deja leer, y un
    //    productor ve las `canalizaciones` de SUS PROPIAS ofertas (§4: es la rama que hace
    //    que no quede a ciegas cuando nace una entrega que coordinar).
    //
    //    Medido contra producción el 22-09-2026 con la sesión de `prodowner-masprova`: la
    //    RPC devuelve 590 / 195 / 400 kg por entidad, y sus `canalizaciones` visibles suman
    //    390+200 / 195 / 400. Cuadra al kilo, o sea que el agregado NO añade ni un dato que
    //    no tuviera ya — lo único que hace es sumárselo.
    //
    //    Lo que hay que seguir vigilando es lo de al lado: que **no vea entidades ajenas**.
    //    Eso lo sostiene la RLS de `canalizaciones`, no esta función, y si alguna vez se
    //    relajara esto seguiría en verde. El check que lo cubre de verdad es el de
    //    `oferta_respuestas` en este mismo bloque.
    {
      tabla: "kg_rebuts_exercici",
      op: "rpc",
      esperado: "permitir",
      args: {},
      descripcion: "veu els quilos de les SEVES entregues agregats per entitat (res nou)",
      requiereFixture: "alguna canalización conciliada de una oferta suya en el ejercicio en curso",
    },
    { tabla: "canalizaciones", op: "insertar", esperado: "denegar", descripcion: "NO se canaliza a sí mismo" },
    { tabla: "membresias", op: "actualizar", esperado: "denegar", descripcion: "NO toca su propia membresía (ningún externo se auto-activa)" },
    { tabla: "aprovar_registre", op: "rpc", esperado: "denegar", args: { p_membresia: "@meva_membresia" }, descripcion: "NO valida registros (lo corta pot_aprovar)" },
    // Sistema documental: en la fase 1 `documents_meus()` devuelve vacío, así que un
    // externo no ve NINGÚN documento. Cuando la fase 3 la reescriba, este check pasará
    // a «permitir, solo los suyos» con su fixture.
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "NO ve los contadores de serie" },
    { tabla: "siguiente_numero", op: "rpc", esperado: "denegar", args: { p_serie: "PROVA", p_ejercicio: 1999 }, descripcion: "NO puede pedir un número de serie" },
    { tabla: "organizaciones", op: "leer", esperado: "permitir", descripcion: "veu la seva organitzacio" },
    { tabla: "v_organizaciones", op: "leer", esperado: "permitir", descripcion: "veu qui es la seva organitzacio" },
    // 1C: la vista del listado es `security_invoker`: solo su organización.
    { tabla: "v_entitats_llistat", op: "leer", esperado: "permitir", descripcion: "veu la seva organitzacio al llistat (security_invoker)" },
    // 🔴 Y NO las lee directamente (20270324100000). Hasta esa migración sí podía: la
    //    política de SELECT traía desde `20260730098000` la rama
    //    `excedente_id in (select excedents_dels_meus_productors())`, y con el GRANT por
    //    tabla eso le daba `entidad_id`, `telefono` y `preu_ofert` de cada respuesta.
    //    Medido contra producción el 14-09-2026: TEST-PROD-1 veía tres filas. Ninguna
    //    pantalla lo pedía, así que era un permiso ancho que nadie usaba — la clase de
    //    cosa que solo sale si alguien la mira.
    //    `denegar` en un `leer` significa ya «0 filas», que es como deniega una política
    //    (no hay error: RLS filtra). No hace falta `vacioEsDenegar`, que es el flag de las
    //    `rpc`, donde sí había que decidirlo.
    //    ⚠️ Este check FALLA mientras 20270324100000 no esté aplicada, y eso es lo
    //       correcto: es su prueba.
    {
      tabla: "oferta_respuestas",
      op: "leer",
      esperado: "denegar",
      descripcion: "NO llegeix qui s'ha interessat per les seves ofertes (només l'agregat)",
    },
    // El embudo de SUS ofertas (20270323100000): cuántas entidades la han recibido, la han
    // aceptado y esperan aprobación. Devuelve una fila por oferta ACTIVA, así que sin
    // ninguna activa son 0 filas y eso no prueba nada: de ahí el `requiereFixture`.
    //
    // ⚠️ Lo que este check NO afirma, y conviene no leerlo de más: que la RPC no devuelva
    //    nombres. Eso lo garantiza su tipo de retorno —cuatro columnas, ninguna con
    //    `entidad_id`—, no una política, así que romperlo exigiría cambiar la firma. Y
    //    tampoco afirma que el productor no pueda llegar a esos nombres por otro camino:
    //    la política de SELECT de `oferta_respuestas` (20260730098000) se los da hoy
    //    directamente por PostgREST. Es una decisión abierta, no algo que esta migración
    //    haya cerrado.
    {
      tabla: "progres_meves_ofertes",
      op: "rpc",
      esperado: "permitir",
      descripcion: "veu quantes entitats s'han interessat per les SEVES ofertes",
      requiereFixture: "alguna oferta activa (borrador/publicada/parcial/bloquejada) de la seva ficha (scripts/crear-datos-documentales-prueba.ts)",
    },
    // El año y el modo de SUS cierres (20270406100000): el mismo puente que la RLS de
    // `cierres_donante`, así que sin cierre suyo son 0 filas y eso no prueba nada.
    {
      tabla: "exercici_dels_meus_tancaments",
      op: "rpc",
      esperado: "permitir",
      descripcion: "veu l'exercici i el mode dels SEUS tancaments",
      requiereFixture: "algun cierres_donante de la seva ficha (scripts/crear-datos-documentales-prueba.ts)",
    },
    // `convenio_vigente()` SÍ responde por la ficha propia (20270414100600): la ajena la
    // niega `DOCUMENTAL_EXTERN`. Responde true/false sin error; si la cuenta no tuviera
    // ficha de productor, el uuid nulo daría 42501 y saldría FALLA, no saltada.
    { tabla: "convenio_vigente", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_org: "@meva_fitxa_productor", p_valorizacion: "donacio", p_parte: "entrega" }, descripcion: "pot consultar el conveni de la SEVA fitxa" },
    // Taula mestra (20270517100000): el titular corrige sus datos fiscales y de facturación por
    // su RPC. Sin escribir nada: un valor inválido tiene que llegar a la columna y chocar con su
    // CHECK (si la clave no estuviera en la lista blanca, se ignoraría y daría éxito).
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_productor", p_dades: { regim_iva: "no_existeix" } }, descripcion: "el règim d'IVA és a la llista blanca (i el CHECK el valida)" },
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_productor", p_dades: { contacte_facturacio_email: "no-es-un-correu" } }, descripcion: "el correu de facturació és a la llista blanca (i el CHECK el valida)" },
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_productor", p_dades: { codi_postal_fiscal: "123" } }, descripcion: "el codi postal fiscal és a la llista blanca (i el CHECK el valida)" },
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_id: "@meva_fitxa_productor", p_dades: { tipus_activitat: ["cooperativa_agraria"] } }, descripcion: "«Cooperativa agrària» ja no és una activitat (retirada a petició de la Fundació)" },
    // A4 (20270521100000): la Operativa del productor. La LEE en su ficha y la escribe SOLO por
    // su RPC (D5): el UPDATE directo lo filtra la política `edicio intern`. Sin escribir nada: un
    // valor fuera de lista tiene que llegar a la columna y chocar con su CHECK (si la clave no
    // estuviera en la lista blanca, se ignoraría y daría éxito); una forma equivocada, 22023.
    { tabla: "productores", op: "leer", esperado: "permitir", columnas: "id, productes_principals, varietats, volum_produccio, envasos_habituals, canals_comercials, tipologia_clients, facturacio_anual_eur, facturacio_rang, volum_comercialitzat_kg, suport_interes", descripcion: "veu la Operativa de la SEVA fitxa (A4)" },
    { tabla: "productores", op: "actualizar", esperado: "denegar", columnas: "id, envasos_habituals", descripcion: "NO escriu la seva fitxa directament: nomes per actualitzar_fitxa_productor (A4)" },
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_productor", p_dades: { envasos_habituals: ["no_existeix"] } }, descripcion: "els envasos habituals son a la llista blanca (i el CHECK els valida) (A4)" },
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_productor", p_dades: { canals_comercials: ["no_existeix"] } }, descripcion: "els canals comercials son a la llista blanca (i el CHECK els valida) (A4)" },
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_productor", p_dades: { tipologia_clients: ["no_existeix"] } }, descripcion: "la tipologia de clients es a la llista blanca (i el CHECK la valida) (A4)" },
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_productor", p_dades: { facturacio_rang: "no_existeix" } }, descripcion: "el rang de facturacio es a la llista blanca (i el CHECK el valida) (A4)" },
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_productor", p_dades: { suport_interes: ["no_existeix"] } }, descripcion: "el suport que vol es a la llista blanca (i el CHECK el valida) (A4, P6)" },
    { tabla: "actualitzar_fitxa_productor", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_id: "@meva_fitxa_productor", p_dades: { varietats: "no_es_un_objecte" } }, descripcion: "les varietats van per producte: una forma equivocada es 22023 (A4)" },
    // `fixar_lloc_principal`: con ficha de productor, un uuid inventado llega a la existencia.
    { tabla: "fixar_lloc_principal", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_lloc: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot triar el seu lloc principal (autoritza; 22023 lloc_inexistent) (A4)" },
    // A5 (20270523100000): el titular puede confirmar la naturalesa de SU organización (mientras
    // no la haya confirmado el equipo). Sin escribir nada: un valor raro tiene que pasar la
    // guarda y caer en 22023 `naturalesa_desconeguda`.
    { tabla: "fixar_naturalesa", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_org: "@meva_organitzacio", p_naturalesa: "no_existeix" }, descripcion: "pot fixar la naturalesa de la SEVA organitzacio (autoritza; 22023 amb un valor desconegut) (A5)" },
    { tabla: "productor_ubicaciones", op: "leer", esperado: "permitir", columnas: "id, es_principal, dies_setmana, franges", descripcion: "veu els dies i franges dels SEUS llocs (A4)", requiereFixture: "algun lloc de recollida de la seva fitxa" },
    // A3 (20270522100000): LEE los excedentes de su diagnóstico y no los escribe (D5), ni por
    // RPC sobre lo suyo ni por UPDATE directo. Los argumentos, inofensivos si la guarda fallara
    // (ver `DIAGNOSTIC_EXCEDENTS_EXTERN`). `productor-altre` no tiene bloques: sale «sense».
    { tabla: "diagnostic_productes", op: "leer", esperado: "permitir", descripcion: "veu els blocs d'excedents del SEU diagnostic (A3)", requiereFixture: "algun bloc d'excedents de la seva fitxa (desar_excedents_diagnostic)" },
    { tabla: "diagnostic_excedents", op: "leer", esperado: "permitir", descripcion: "veu els excedents del SEU diagnostic (A3)", requiereFixture: "algun excedent de la seva fitxa (desar_excedents_diagnostic)" },
    { tabla: "diagnostic_accions", op: "leer", esperado: "permitir", descripcion: "veu les accions del SEU diagnostic i el seu estat (A3)", requiereFixture: "alguna accio del diagnostic de la seva fitxa (desar_excedents_diagnostic)" },
    { tabla: "desar_excedents_diagnostic", op: "rpc", esperado: "denegar", args: { p_productor: "@meva_fitxa_productor", p_productes: {} }, descripcion: "NO desa els excedents del SEU diagnostic: el porta l'equip (D5, A3)" },
    { tabla: "fixar_estat_accio", op: "rpc", esperado: "denegar", args: { p_accio: "@meva_accio_diagnostic", p_estat: "no_existeix" }, descripcion: "NO canvia l'estat de les SEVES accions: el porta l'equip (D5, A3)" },
    { tabla: "diagnostic_accions", op: "actualizar", esperado: "denegar", descripcion: "NO modifica les SEVES accions a ma (A3)" },
    ...DOCUMENTAL_EXTERN,
    // Circuito de firma: ve la firma de SU documento (la que sube el fixture para
    // TEST-PROD-1) y el estado de firma de sus documentos. `productor-altre` (TEST-PROD-2) no
    // tiene ninguno y sale «sense», que es lo correcto.
    {
      tabla: "firmes_document",
      op: "leer",
      esperado: "permitir",
      descripcion: "veu les signatures dels SEUS documents",
      requiereFixture: "la signatura de TEST-PROD-1 (scripts/crear-datos-documentales-prueba.ts → prepararSignatura)",
    },
    {
      tabla: "v_signatura_document",
      op: "leer",
      esperado: "permitir",
      descripcion: "veu l'estat de signatura dels SEUS documents",
      requiereFixture: "un REC confirmat/conciliat de TEST-PROD-1 (scripts/crear-datos-documentales-prueba.ts)",
    },
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
      columnas: "id, tipo, numero_completo, estado, vigente",
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
    // Certificado a demanda: mismo puente y misma regla que el anual
    // (`cierres_periodo_meus()`, los de prueba solo si la ficha es `es_test`). Sin
    // fixture sale SALTADA, y eso es lo correcto: con RLS activa, 0 filas no distingue
    // «la política me bloquea» de «no hay nada que ver» (§12.48).
    {
      tabla: "cierres_periodo",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve EL SEU certificat a demanda (només el seu)",
      requiereFixture: "un certificado a demanda calculado con su ficha (calcular_certificado_periodo en modo prueba)",
    },
    {
      tabla: "cierre_periodo_lineas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve el detall del SEU certificat a demanda",
      requiereFixture: "un certificado a demanda calculado con su ficha (calcular_certificado_periodo en modo prueba)",
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
    // Organización unificada: ve LA SUYA y solo la suya. No lleva `requiereFixture` porque
    // toda ficha tiene organización desde la migración del relleno: si esto sale con 0 filas,
    // es que la política está mal o el relleno dejó huecos, no que falten datos.
    {
      tabla: "organizaciones",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve LA SEVA organitzacio (nomes la seva)",
    },
    {
      tabla: "organizaciones",
      op: "insertar",
      esperado: "denegar",
      descripcion: "NO crea organitzacions",
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
    // Diagnòstic únic (A1, 20270520100000): el productor LEE el suyo (tabla y `diagnostic_datos`)
    // y no lo escribe, ni sobre su propia ficha (D5: lo conduce el equipo). La lectura de la
    // tabla pide fixture: hoy solo Mas de Prova tiene diagnóstico, así que `productor-altre`
    // sale SALTADA, que es lo correcto (si viera el de otro sería un escape).
    { tabla: "diagnostics", op: "leer", esperado: "permitir", descripcion: "veu EL SEU diagnostic (nomes el seu)", requiereFixture: "un diagnostic desat del seu productor (desar_diagnostic des de l'equip)" },
    { tabla: "diagnostic_datos", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_org: "@meva_fitxa_productor" }, descripcion: "llegeix EL SEU diagnostic (buit si no en te)" },
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
    { tabla: "impacte_receptor", op: "rpc", esperado: "permitir", args: { p_desde: "2026-01-01", p_hasta: "2026-12-31" }, descripcion: "veu el seu impacte (fase 10)" },
    // --- Certificat de recepcio (CR): ve EL SEU. Mismo puente y misma regla que el del
    //     donante (`cierres_receptor_meus()`: los de prueba, solo si la ficha es es_test).
    {
      tabla: "cierres_receptor",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve EL SEU certificat de recepcio (nomes el seu)",
      requiereFixture: "un certificado de recepción calculado con su ficha (calcular_certificat_recepcio en modo prueba)",
    },
    {
      tabla: "cierre_receptor_lineas",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve el detall del SEU certificat de recepcio",
      requiereFixture: "un certificado de recepción calculado con su ficha (calcular_certificat_recepcio en modo prueba)",
    },
    {
      tabla: "kg_rebuts_exercici",
      op: "rpc",
      esperado: "permitir",
      args: {},
      descripcion: "veu ELS SEUS quilos rebuts de l'any",
      requiereFixture: "alguna canalización conciliada de su entidad en el ejercicio en curso",
    },
    { tabla: "productores", op: "leer", esperado: "denegar", descripcion: "NO ve las fichas de productor" },
    { tabla: "entidades", op: "leer", esperado: "permitir", descripcion: "ve SU entidad (solo la suya)" },
    {
      tabla: "excedentes",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve las ofertas compatibles",
      requiereFixture: "una oferta publicada de una modalitat compatible con su tipo_receptor",
    },
    // El puente de la RLS de ofertas (§12.23). No es una RPC que la interfaz llame: lo
    // que se verifica es que **el EXECUTE sigue concedido a `authenticated`**, porque la
    // expresión de una política se evalúa con los privilegios de quien consulta. Si
    // alguien lo revocara, el receptor no vería «menos ofertas»: le reventaría cualquier
    // `select` sobre `excedentes`.
    {
      tabla: "modalitats_compatibles_meves",
      op: "rpc",
      esperado: "permitir",
      descripcion: "puede llamar al puente de modalidades compatibles (lo usa su propia RLS)",
    },
    // La otra cara de 20270324100000: al estrechar la política había que asegurarse de no
    // llevarse por delante la rama `mis_entidades()`, que es la que deja a una entidad ver
    // lo que ELLA ha contestado (`Mercat` e `Interessos` la usan). Sin este check, un
    // `using (es_intern())` de más se vería como «todo bien».
    {
      tabla: "oferta_respuestas",
      op: "leer",
      esperado: "permitir",
      descripcion: "veu les respostes on la SEVA entitat és la receptora",
      requiereFixture: "alguna resposta de la seva entitat (scripts/crear-respuestas-prueba.ts)",
    },
    // El embudo de ofertas es del GENERADOR, y un receptor no tiene ninguna: la RPC
    // resuelve por `mis_productores()`, que aquí está vacío, así que devuelve el conjunto
    // vacío. **No levanta 42501 a propósito** —mismo criterio que `pendents_meus()` y
    // `documents_meus()`: un puente por organización responde «nada tuyo», no un error, y
    // así una cuenta que pierde su ficha de productor deja de ver datos sin que la pantalla
    // se rompa—. Por eso el check lleva `vacioEsDenegar`: lo que se afirma es el resultado
    // («no obté res de ningú altre»), no el mecanismo, y pasaría igual si algún día se
    // decidiera que sí levante.
    {
      tabla: "progres_meves_ofertes",
      op: "rpc",
      esperado: "denegar",
      vacioEsDenegar: true,
      descripcion: "NO veu el progrés de les ofertes d'altri (no té fitxa de productor)",
    },
    // Un receptor no tiene ningún cierre de donante: la RPC le da «nada tuyo», no un error.
    {
      tabla: "exercici_dels_meus_tancaments",
      op: "rpc",
      esperado: "denegar",
      vacioEsDenegar: true,
      descripcion: "NO veu l'exercici dels tancaments d'altri",
    },
    { tabla: "wa_messages", op: "leer", esperado: "denegar", descripcion: "NO ve la mensajería" },
    { tabla: "app_settings", op: "leer", esperado: "denegar", descripcion: "NO ve la configuración" },
    { tabla: "oferta_respuestas", op: "insertar", esperado: "denegar", descripcion: "NO escribe respuestas a mano (van por RPC)" },
    { tabla: "canalizaciones", op: "insertar", esperado: "denegar", descripcion: "NO se canaliza a sí mismo" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "NO ve los contadores de serie" },
    { tabla: "siguiente_numero", op: "rpc", esperado: "denegar", args: { p_serie: "PROVA", p_ejercicio: 1999 }, descripcion: "NO puede pedir un número de serie" },
    { tabla: "organizaciones", op: "leer", esperado: "permitir", descripcion: "veu la seva organitzacio" },
    { tabla: "v_organizaciones", op: "leer", esperado: "permitir", descripcion: "veu qui es la seva organitzacio" },
    // 1C: la vista del listado es `security_invoker`: solo su organización.
    { tabla: "v_entitats_llistat", op: "leer", esperado: "permitir", descripcion: "veu la seva organitzacio al llistat (security_invoker)" },
    // `convenio_vigente()` sobre la entidad PROPIA (20270414100600): es lo que
    // `manifestar_interes()` comprueba por dentro, y tiene que seguir respondiendo.
    { tabla: "convenio_vigente", op: "rpc", esperado: "permitir", args: { p_tipo_org: "entidad", p_org: "@meva_fitxa_entitat", p_valorizacion: "donacio", p_parte: "recibe" }, descripcion: "pot consultar el conveni de la SEVA entitat" },
    // Taula mestra (20270517100000): el titular corrige sus datos fiscales y de facturación por
    // su RPC. Sin escribir nada: un valor inválido tiene que llegar a la columna y chocar con su
    // CHECK (si la clave no estuviera en la lista blanca, se ignoraría y daría éxito).
    { tabla: "actualitzar_fitxa_entitat", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_entitat", p_dades: { regim_iva: "no_existeix" } }, descripcion: "el règim d'IVA és a la llista blanca (i el CHECK el valida)" },
    { tabla: "actualitzar_fitxa_entitat", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_entitat", p_dades: { contacte_facturacio_email: "no-es-un-correu" } }, descripcion: "el correu de facturació és a la llista blanca (i el CHECK el valida)" },
    { tabla: "actualitzar_fitxa_entitat", op: "rpc", esperado: "permitir", errorExigit: "23514", args: { p_id: "@meva_fitxa_entitat", p_dades: { codi_postal_fiscal: "123" } }, descripcion: "el codi postal fiscal és a la llista blanca (i el CHECK el valida)" },
    { tabla: "actualitzar_fitxa_entitat", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_id: "@meva_fitxa_entitat", p_dades: { tipus_activitat: ["cooperativa_agraria"] } }, descripcion: "«Cooperativa agrària» ja no és una activitat (retirada a petició de la Fundació)" },
    // A4 (20270521100000): sin ninguna ficha de productor, el lugar principal no es cosa suya
    // (el permiso va antes que la existencia: 42501 aunque el uuid no exista).
    { tabla: "fixar_lloc_principal", op: "rpc", esperado: "denegar", args: { p_lloc: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO tria el lloc principal de cap productor (A4)" },
    // A5 (20270523100000): el titular puede confirmar la naturalesa de SU organización (mientras
    // no la haya confirmado el equipo). Sin escribir nada: un valor raro tiene que pasar la
    // guarda y caer en 22023 `naturalesa_desconeguda`.
    { tabla: "fixar_naturalesa", op: "rpc", esperado: "permitir", errorExigit: "22023", args: { p_org: "@meva_organitzacio", p_naturalesa: "no_existeix" }, descripcion: "pot fixar la naturalesa de la SEVA organitzacio (autoritza; 22023 amb un valor desconegut) (A5)" },
    // A3 (20270522100000): sin ficha de productor, ningún excedente del diagnóstico es suyo.
    ...DIAGNOSTIC_EXCEDENTS_SENSE_PRODUCTOR,
    ...DOCUMENTAL_EXTERN,
    // Circuito de firma: el estado de firma de SUS documentos (ENT, CR, convenio).
    {
      tabla: "v_signatura_document",
      op: "leer",
      esperado: "permitir",
      descripcion: "veu l'estat de signatura dels SEUS documents",
      requiereFixture: "un ENT confirmat/conciliat o un conveni de la seva entitat (scripts/crear-datos-documentales-prueba.ts)",
    },
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
      columnas: "id, tipo, numero_completo, estado, vigente",
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
    // Diagnòstic únic (A1): es del productor; una receptora no ve ninguno (0 filas).
    { tabla: "diagnostics", op: "leer", esperado: "denegar", descripcion: "NO veu cap diagnostic de productor (A1)" },
    // Ni el cierre del donante del que ha recibido: el certificado es del donante.
    { tabla: "cierres_donante", op: "leer", esperado: "denegar", descripcion: "NO ve l'acumulat anual de cap donant" },
    { tabla: "cierre_donante_lineas", op: "leer", esperado: "denegar", descripcion: "NO ve les línies de cap tancament" },
    // Ni el certificado a demanda: es del donante, como el anual.
    { tabla: "cierres_periodo", op: "leer", esperado: "denegar", descripcion: "NO ve cap certificat a demanda" },
    { tabla: "cierre_periodo_lineas", op: "leer", esperado: "denegar", descripcion: "NO ve les línies de cap certificat a demanda" },
    // El nomenclátor sí: es catálogo público, como `productos`, y lo necesita el
    // formulario de ubicación.
    { tabla: "municipios", op: "leer", esperado: "permitir", descripcion: "lee el nomenclátor (catálogo público)" },
  ],
  sense_rol: [
    { tabla: "cierres_receptor", op: "leer", esperado: "denegar", descripcion: "no ve ningun certificat de recepcio" },
    { tabla: "cierre_receptor_lineas", op: "leer", esperado: "denegar", descripcion: "no ve el detall de cap certificat de recepcio" },
    { tabla: "productores", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "entidades", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "excedentes", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "documentos", op: "leer", esperado: "denegar", columnas: "id, tipo", descripcion: "no ve nada" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "albaranes", op: "leer", esperado: "denegar", descripcion: "no ve ningún albarán" },
    { tabla: "espigoladas", op: "leer", esperado: "denegar", descripcion: "no ve ninguna espigolada" },
    { tabla: "cierres_donante", op: "leer", esperado: "denegar", descripcion: "no ve ningún acumulado anual" },
    { tabla: "cierres_periodo", op: "leer", esperado: "denegar", descripcion: "no ve ningún certificado a demanda" },
    { tabla: "organizaciones", op: "leer", esperado: "denegar", descripcion: "no ve ninguna organización" },
    { tabla: "v_organizaciones", op: "leer", esperado: "denegar", descripcion: "no ve ninguna organización" },
    { tabla: "v_entitats_llistat", op: "leer", esperado: "denegar", descripcion: "no ve ninguna entidad del listado (1C)" },
    { tabla: "convenios", op: "leer", esperado: "denegar", descripcion: "no ve ningún convenio" },
    { tabla: "firmes_document", op: "leer", esperado: "denegar", descripcion: "no ve cap signatura" },
    { tabla: "v_signatura_document", op: "leer", esperado: "denegar", descripcion: "no ve l'estat de signatura de cap document" },
    // A4 (20270521100000): sin ninguna ficha de productor, el lugar principal no es cosa suya
    // (el permiso va antes que la existencia: 42501 aunque el uuid no exista).
    { tabla: "fixar_lloc_principal", op: "rpc", esperado: "denegar", args: { p_lloc: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO tria el lloc principal de cap productor (A4)" },
    // A3 (20270522100000): sin ficha de productor, ningún excedente del diagnóstico es suyo.
    ...DIAGNOSTIC_EXCEDENTS_SENSE_PRODUCTOR,
    ...DOCUMENTAL_EXTERN,
  ],
  // Registro público recién enviado: membresía `aprovacio = 'pendent'` + `activo =
  // false`. No ve NADA —`mis_productores()`/`mis_entidades()` filtran por `activo`, así
  // que ni la ficha de su propia organización—, pero SÍ lee su fila de `membresias`: la
  // política «membresias: meves» no filtra por activo, y esa fila es lo único que la
  // pantalla «pendent de validació» necesita para saber que está esperando.
  pendent: [
    { tabla: "cierres_receptor", op: "leer", esperado: "denegar", descripcion: "no ve ningun certificat de recepcio" },
    { tabla: "cierre_receptor_lineas", op: "leer", esperado: "denegar", descripcion: "no ve el detall de cap certificat de recepcio" },
    { tabla: "productores", op: "leer", esperado: "denegar", descripcion: "NO ve ninguna ficha, ni la de su organización" },
    { tabla: "entidades", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "excedentes", op: "leer", esperado: "denegar", descripcion: "NO ve ninguna oferta" },
    { tabla: "membresias", op: "leer", esperado: "permitir", descripcion: "ve SU membresía pendiente (pantalla de espera)" },
    { tabla: "membresias", op: "actualizar", esperado: "denegar", descripcion: "NO se activa a sí misma" },
    { tabla: "aprovar_registre", op: "rpc", esperado: "denegar", args: { p_membresia: "@meva_membresia" }, descripcion: "NO se aprueba a sí misma (lo corta pot_aprovar)" },
    { tabla: "documentos", op: "leer", esperado: "denegar", columnas: "id, tipo", descripcion: "no ve nada" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "no ve nada" },
    { tabla: "albaranes", op: "leer", esperado: "denegar", descripcion: "no ve ningún albarán" },
    { tabla: "espigoladas", op: "leer", esperado: "denegar", descripcion: "no ve ninguna espigolada" },
    { tabla: "cierres_donante", op: "leer", esperado: "denegar", descripcion: "no ve ningún acumulado anual" },
    { tabla: "cierres_periodo", op: "leer", esperado: "denegar", descripcion: "no ve ningún certificado a demanda" },
    { tabla: "organizaciones", op: "leer", esperado: "denegar", descripcion: "no ve ninguna organización" },
    { tabla: "v_organizaciones", op: "leer", esperado: "denegar", descripcion: "no ve ninguna organización" },
    { tabla: "v_entitats_llistat", op: "leer", esperado: "denegar", descripcion: "no ve ninguna entidad del listado (1C)" },
    { tabla: "convenios", op: "leer", esperado: "denegar", descripcion: "no ve ningún convenio" },
    { tabla: "firmes_document", op: "leer", esperado: "denegar", descripcion: "no ve cap signatura" },
    { tabla: "v_signatura_document", op: "leer", esperado: "denegar", descripcion: "no ve l'estat de signatura de cap document" },
    // A4 (20270521100000): sin ninguna ficha de productor, el lugar principal no es cosa suya
    // (el permiso va antes que la existencia: 42501 aunque el uuid no exista).
    { tabla: "fixar_lloc_principal", op: "rpc", esperado: "denegar", args: { p_lloc: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO tria el lloc principal de cap productor (A4)" },
    // A3 (20270522100000): sin ficha de productor, ningún excedente del diagnóstico es suyo.
    ...DIAGNOSTIC_EXCEDENTS_SENSE_PRODUCTOR,
    ...DOCUMENTAL_EXTERN,
  ],
};

// Cuerpos mínimos para probar un INSERT que DEBE fallar. Nunca llegan a la base si
// la política está bien; si llegara, la fila se borra en el `finally`.
const FILA_PRUEBA: Record<string, Record<string, unknown>> = {
  // A5: una fila VÁLIDA de la regla, para que el rechazo sea el GRANT y no una columna que no existe.
  modalitat_naturalesa_compat: { modalitat: "donacio", naturalesa: "empresa" },
  excedentes: { producto: "TEST-RLS", estado: "borrador" },
  excedente_destins: { excedente_id: "00000000-0000-0000-0000-000000000000", desti_codi: "venda", kg: 1, origen: "productor" },
  canalizaciones: { kg_confirmados: 1 },
  oferta_respuestas: { telefono: "34600000000", canal: "panel" },
  usuario_roles: { rol: "super_admin" },
  // Plan 1, 1A: el historial solo lo escribe el trigger `trg_fitxa_estat()`; sin GRANT de
  // escritura, el insert tiene que morir en 42501 aunque la fila sea válida.
  fitxa_estat_hist: { tipus: "entidad", entidad_id: "00000000-0000-0000-0000-000000000000", activo: true },
  equip_rols_hist: { user_id: "00000000-0000-0000-0000-000000000000", rol_abans: "admin", rol_despres: "super_admin" },
  equip_traspassos: { origen_id: "00000000-0000-0000-0000-000000000000", desti_id: "00000000-0000-0000-0000-000000000000", motiu: "traspas", total: 0, detall: [] },
  equip_persones_arxiu: { user_id: "00000000-0000-0000-0000-000000000000", email: "arnes@exemple.cat" },
  regeneracions_documents: { total: 0, signats: 0, detall: [] },
  cortina_config: { id: 2, activa: true },
  fitxers_orfes: { ruta: "arnes/no-existeix.pdf", origen: "arnes" },
  equip_traspassos_files: { traspas_id: "00000000-0000-0000-0000-000000000000", taula: "documentos", columna: "emitido_por", fila: { id: "00000000-0000-0000-0000-000000000000" } },
  notes_internes: { organizacion_id: "00000000-0000-0000-0000-000000000000", canal: "telefon", text: "arnes" },
  // 20270511100000: el registro del importador solo lo escribe `importar_entitats()`. Filas
  // válidas para que lo que corte sea el GRANT (42501) y no un `not null` o un `check`.
  importacions_entitats: { fitxer_nom: "arnes.xlsx", fitxer_sha256: "0".repeat(64), files_total: 0 },
  importacions_entitats_files: { importacio_id: "00000000-0000-0000-0000-000000000000", fila: 1, accio: "omesa" },
  // Deuda 150 (20270501400000): las fichas solo nacen por RPC. Filas válidas (inactivas y de
  // prueba) para que lo que corte sea el GRANT y no un `not null` o el trigger del NIF.
  productores: { name: "TEST-RLS", es_test: true, activo: false },
  entidades: { nombre: "TEST-RLS", es_test: true, activo: false },
  // Los tres del sistema documental de la fase 3. Se rellenan lo justo para que lo que
  // corte sea el permiso y no un `not null`: si cortara un check, la comprobación no
  // diría nada sobre RLS.
  albaranes: { tipo: "REC", estado: "borrador" },
  // Las dos del cierre: se rellenan lo justo para que lo que corte sea el GRANT —no hay
  // ninguno de escritura sobre estas tablas— y no un `not null`.
  cierres_ejercicio: { ejercicio: 2020, modo: "prueba" },
  cierres_donante: { productor_id: "00000000-0000-0000-0000-000000000000" },
  // Igual que las dos de arriba: `cierres_periodo` no tiene GRANT de escritura para nadie.
  // La ventana y el ejercicio tienen que cuadrar entre sí (check `any_natural`), o lo que
  // cortaría sería ese check y no el permiso.
  cierres_periodo: {
    productor_id: "00000000-0000-0000-0000-000000000000",
    periodo_desde: "1999-01-01",
    periodo_hasta: "1999-12-31",
    ejercicio: 1999,
  },
  // Igual que `cierres_periodo`: `cierres_receptor` no tiene GRANT de escritura para nadie.
  // La ventana y el ejercicio tienen que cuadrar entre sí (check `any_natural`), o lo que
  // cortaría el insert sería ESE check y no el permiso — y el arnés estaría midiendo otra
  // cosa sin decirlo.
  cierres_receptor: {
    entidad_id: "00000000-0000-0000-0000-000000000000",
    periodo_desde: "1999-01-01",
    periodo_hasta: "1999-12-31",
    ejercicio: 1999,
  },
  espigoladas: { fecha: "1999-01-01" },
  // `convenios` no tiene GRANT de escritura para nadie: la fila se rellena lo justo para
  // que lo que corte sea el permiso y no un `not null` ni el check excluyente.
  convenios: {
    tipo: "don_gen",
    tipo_org: "productor",
    productor_id: "00000000-0000-0000-0000-000000000000",
  },
  costes_producto: { producto: "Tomàquet", coste_kg: 1, motivo: "TEST-RLS" },
  // `planes_prevencion` tampoco tiene GRANT de escritura para nadie. Mismo criterio que
  // `convenios`: lo justo para que lo que corte sea el permiso y no el check excluyente.
  planes_prevencion: {
    tipo_org: "productor",
    productor_id: "00000000-0000-0000-0000-000000000000",
    respuestas: {},
  },
  // A1 (20270520100000): `diagnostics` no tiene GRANT de escritura para nadie. La fila cumple
  // los `not null` y los dos checks de forma (`respostes` objeto, `sobre.respostes` array) para
  // que lo que corte sea el permiso y no un dato.
  diagnostics: {
    productor_id: "00000000-0000-0000-0000-000000000000",
    respostes: {},
    sobre: { respostes: [] },
  },
  // A3 (20270522100000): las tres tablas de excedentes del diagnóstico no tienen GRANT de
  // escritura para nadie. Filas que cumplen los `not null` y los CHECK (causa del catálogo,
  // destino de la lista) para que lo que corte sea el permiso (42501) y no un dato.
  diagnostic_productes: { productor_id: "00000000-0000-0000-0000-000000000000", producte: "TEST-RLS" },
  diagnostic_excedents: { productor_id: "00000000-0000-0000-0000-000000000000", producte: "TEST-RLS", causa_codi: "EX" },
  diagnostic_accions: { excedent_id: "00000000-0000-0000-0000-000000000000", desti: "donacio", descripcio: "TEST-RLS" },
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
  // Circuito de firma (20270510100000): sin GRANT de escritura para nadie. La fila cumple los
  // CHECK (vía canvas, estado signat) para que lo que corte sea el permiso y no un check.
  firmes_document: {
    documento_id: "00000000-0000-0000-0000-000000000000",
    objeto_tipo: "albaran",
    objeto_id: "00000000-0000-0000-0000-000000000000",
    tipo_doc: "REC",
    modo: "real",
    part: "donant",
    tipo_org: "productor",
    org_id: "00000000-0000-0000-0000-000000000000",
    via: "canvas",
    estat: "signat",
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
  // Sin GRANT de UPDATE: lo corta el permiso (42501) antes de mirar ninguna fila.
  firmes_document: "signant_nom",
  // Retirar/publicar una plantilla es lo único que se puede hacer sobre una ya usada, así
  // que `vigente` es también la columna con la que se mide el permiso de escritura.
  plantillas_documento: "vigente",
  parametros_documentales: "caducidad_enlace_dias",
  // A1 (20270520100000): sin GRANT de UPDATE para `authenticated` (42501 antes de mirar filas).
  diagnostics: "notes",
  // A4 (20270521100000): la Operativa. El equipo la escribe directo (política `edicio intern`);
  // el productor, no (0 filas: la política filtra) —él va por `actualitzar_fitxa_productor`—.
  productores: "envasos_habituals",
  // A3 (20270522100000): sin GRANT de UPDATE para `authenticated` (42501 antes de mirar filas).
  diagnostic_productes: "observacions",
  diagnostic_excedents: "detall",
  diagnostic_accions: "notes",
  // A5 (20270523100000): sin GRANT de UPDATE para `authenticated` (42501 antes de mirar filas).
  organizaciones: "naturalesa",
};

/**
 * Columna con la que se identifica la fila en el UPDATE de `COLUMNA_INOCUA`, cuando no es
 * `id` (la tuvo `mesures_prevencio`, con `codi`, hasta que la deuda 175 retiró la tabla).
 */
const CLAVE_FILA: Record<string, string> = {};

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
/**
 * Los SQLSTATE que significan «la función se EJECUTÓ y rechazó el DATO».
 *
 * 🔴 **Esta distinción es la que faltaba, y costó una función inservible en producción.**
 *    Muchos checks de `permitir` se llaman a propósito con un uuid inexistente —el arnés
 *    corre contra producción y no puede escribir—, así que se espera un error: lo que se
 *    comprueba es que la guarda de ROL deja pasar. Hasta el 21-09-2026 la rama `rpc` daba
 *    por bueno **cualquier** error en ese caso, y eso incluía los errores de PROGRAMACIÓN:
 *    `canalitzacions_actives` respondía `42702 column reference "excedente_id" is
 *    ambiguous` desde que se creó —no devolvió una fila ni una vez— y el arnés la contaba
 *    en verde. Lo destapó ejecutarla de verdad desde la pantalla, no el arnés.
 *
 * Un error de negocio prueba que se autorizó. Uno de programación no prueba nada: la clase
 * `42` (columna, tabla o función que no existe, referencia ambigua) y un cast inválido
 * (`22P02`) significan que la función está rota, y eso es FALLA aunque el check sea de
 * `permitir`.
 */
const ERRORES_DE_NEGOCIO = [
  "PT404", "PT409", "PT410", "PT403", // los del circuito documental
  "22023",                            // invalid_parameter_value: la regla de negocio
  "23502", "23503", "23505",          // restricciones de la propia base
];

function esErrorDeNegocio(codigo: string, extras: string[] = []): boolean {
  return ERRORES_DE_NEGOCIO.includes(codigo) || extras.includes(codigo);
}

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
    } else if (valor === "@meva_fitxa_productor" || valor === "@meva_fitxa_entitat") {
      // La ficha PROPIA de ese tipo, por la membresía (que cada cuenta lee de sí misma).
      // Uuid nulo si no tiene ninguna: el check correspondiente lleva `requiereFixture`.
      const col = valor === "@meva_fitxa_productor" ? "productor_id" : "entidad_id";
      const { data } = await cliente.from("membresias").select(col)
        .not(col, "is", null).limit(1).maybeSingle();
      salida[clave] = (data as Record<string, string> | null)?.[col] ?? UUID_NULO;
    } else if (valor === "@meva_organitzacio") {
      // A5: la organización PROPIA (la RLS de `organizaciones` solo le enseña la suya).
      const { data } = await cliente.from("organizaciones").select("id").limit(1).maybeSingle();
      salida[clave] = (data as { id: string } | null)?.id ?? UUID_NULO;
    } else if (valor === "@meva_accio_diagnostic") {
      // A3: una acción del diagnóstico visible para esta sesión (la suya, por RLS). Así la
      // denegación se mide sobre una fila que EXISTE, no solo sobre un uuid inventado.
      const { data } = await cliente.from("diagnostic_accions").select("id").limit(1).maybeSingle();
      salida[clave] = (data as { id: string } | null)?.id ?? UUID_NULO;
    } else if (valor === "@fitxa_amb_documents") {
      // Un productor con algún albarán que ya NO es borrador: por definición, su ficha no
      // se puede borrar (20270328100200). Se busca en vez de codificar `TEST-PROD-1` para
      // que el check siga midiendo algo si el fixture cambia de nombre; si no hay ninguno,
      // cae al uuid nulo y el `requiereFixture` del check lo marca como saltado.
      const { data } = await cliente.from("v_albaranes_bandeja")
        .select("productor_id")
        .neq("estado", "borrador")
        .not("productor_id", "is", null)
        .limit(1).maybeSingle();
      salida[clave] = (data as { productor_id: string } | null)?.productor_id ?? UUID_NULO;
    } else if (valor === "@fitxa_amb_ofertes") {
      const { data } = await cliente.from("excedentes")
        .select("productor_id")
        .not("productor_id", "is", null)
        .limit(1).maybeSingle();
      salida[clave] = (data as { productor_id: string } | null)?.productor_id ?? UUID_NULO;
    } else if (valor === "@fitxa_amb_expedient") {
      const { data } = await cliente.from("expedients_prevencion")
        .select("productor_id")
        .not("productor_id", "is", null)
        .not("numero_completo", "is", null)
        .limit(1).maybeSingle();
      salida[clave] = (data as { productor_id: string } | null)?.productor_id ?? UUID_NULO;
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
      const clave = CLAVE_FILA[check.tabla] ?? "id";
      const id = (fila?.[clave] as string | number | undefined) ?? UUID_NULO;
      const valor = fila ? fila[columna] : 0;
      // ⚠️ `.select()` DESPUÉS del update, y no por comodidad: cuando lo que deniega es la
      // política (y no el GRANT), PostgREST **no da error** —el UPDATE simplemente no
      // encuentra filas que cumplan el `using`— y sin pedir las filas afectadas un
      // rechazo de RLS sería indistinguible de un éxito. Es el mismo argumento del
      // §12.48 para las lecturas, del otro lado: aquí sí se puede distinguir, porque
      // «cero filas actualizadas sobre una fila que sé que existe» solo significa una cosa.
      const { data: tocadas, error } = await cliente.from(check.tabla)
        .update({ [columna]: valor }).eq(clave, id).select(clave);
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
    const { data, error } = await cliente.rpc(funcion, await resolverArgs(cliente, check.args ?? {}));
    if (error) {
      if (esRechazo(error)) {
        return { ok: check.esperado === "denegar", detalle: `rechazado (${error.code ?? "42501"})` };
      }
      // La función no existe: la migración no está aplicada. No demuestra nada, pero
      // tampoco puede darse por bueno.
      if (error.code === "PGRST202") return { ok: false, detalle: "no existe (¿falta la migración?)" };
      // Un error que no es rechazo significa que la autorización SÍ dejó pasar y falló
      // algo posterior. Para un "denegar" eso es exactamente lo que no debe ocurrir; para
      // un "permitir" solo vale si ESE error es el que se esperaba —un `PT404` porque se
      // llama con un uuid inexistente a propósito—. Cualquier otro es un fallo de la
      // función, no una prueba de nada: ver la nota de `erroresEsperados`.
      const codigo = String(error.code ?? "");
      if (check.esperado === "denegar") {
        return { ok: false, detalle: `error: ${error.message.slice(0, 60)}` };
      }
      if (check.errorExigit) {
        const hi = codigo === check.errorExigit;
        return { ok: hi, detalle: hi ? `autoritza i falla amb ${codigo} (l'esperat)` : `¡${codigo} en lloc de ${check.errorExigit}!: ${error.message.slice(0, 50)}` };
      }
      const esperado = esErrorDeNegocio(codigo, check.erroresEsperados ?? []);
      return {
        ok: esperado,
        detalle: esperado
          ? `autoritza (${codigo} esperat)`
          : `ERROR NO ESPERADO ${codigo}: ${error.message.slice(0, 50)}`,
      };
    }
    if (check.errorExigit) {
      return { ok: false, detalle: `¡ejecutada sin el error ${check.errorExigit}!` };
    }
    // Propiedad GLOBAL (auditoría del catálogo): cada fila tiene que estar en la lista
    // permitida. Va antes que todo lo demás porque aquí 0 filas no es «sin datos», es el
    // resultado bueno.
    if (check.listaPermitida) {
      const filas = (Array.isArray(data) ? data : []) as { categoria?: string; funcio?: string }[];
      const sobran = filas
        .map((f) => `${f.categoria ?? "?"}:${f.funcio ?? "?"}`)
        .filter((clave) => !check.listaPermitida!.includes(clave));
      return {
        ok: check.esperado === "permitir" ? sobran.length === 0 : false,
        detalle: sobran.length === 0
          ? `cap fora de la llista (${filas.length} permeses)`
          : `¡${sobran.length} oberta(es) de mes!: ${sobran.join(", ").slice(0, 200)}`,
      };
    }
    if (check.filasExactas !== undefined) {
      const n = Array.isArray(data) ? data.length : -1;
      return {
        ok: check.esperado === "permitir" && n === check.filasExactas,
        detalle: n === check.filasExactas
          ? `ejecutada (${n} filas, las esperadas)`
          : `¡${n} filas, se esperaban ${check.filasExactas}!`,
      };
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
    // Cuántas filas ha devuelto, cuando devuelve un conjunto. Sin esto, una RPC que
    // responde vacío era indistinguible de una que responde lo esperado, y las dos salían
    // «ejecutada» en verde: es lo que dejaba sin efecto el `requiereFixture` de una `rpc`
    // y lo que impedía afirmar que un puente por organización no le da nada a quien no es
    // de esa organización. Una RPC escalar (`data_tall_convenis`) no devuelve array y se
    // queda como estaba.
    const filas = Array.isArray(data) ? data.length : null;
    if (filas === 0) {
      const esperadoAqui = check.vacioEsDenegar ? "denegar" : "permitir";
      return { ok: check.esperado === esperadoAqui, detalle: "0 filas (ejecutada)" };
    }
    if (check.codiEsperat) {
      const codis = (data as { codi?: string }[]).map((f) => f.codi ?? "?");
      const hi = codis.includes(check.codiEsperat);
      return {
        ok: check.esperado === "permitir" && hi,
        detalle: hi ? `ejecutada (${check.codiEsperat} entre ${codis.length})` : `¡sin ${check.codiEsperat}! (${codis.join(", ")})`,
      };
    }
    return {
      ok: check.esperado === "permitir",
      detalle: filas === null ? "ejecutada" : `ejecutada (${filas} filas)`,
    };
  }

  return { ok: true, detalle: "operación no implementada (saltada)" };
}

const cuentas = await leerCuentas();
const resultados: Resultado[] = [];

// ── Cómo se abre la sesión: login real contra el proyecto remoto ───────────────
//
// El arnés abre sesión con `signInWithPassword` y la publishable key, igual que el
// navegador, y así RLS se evalúa con el `sub` real de cada cuenta. Este proyecto no usa
// Supabase local (§9), así que no hay ninguna rama alternativa: si una cuenta no puede
// entrar, es un fallo de verdad y sale en rojo.

/** Cliente con la sesión de esa cuenta, o el motivo por el que no se pudo abrir. */
async function abrirSesion(cuenta: Cuenta): Promise<{ cliente?: SupabaseClient; error?: string }> {
  const cliente = createClient(URL_BASE, PUBLISHABLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await cliente.auth.signInWithPassword({
    email: cuenta.email,
    password: cuenta.password,
  });
  return error ? { error: error.message } : { cliente };
}

// Tablas que el equipo ve vacías: no tienen filas, punto. Una expectativa de "permitir"
// sobre ellas no demuestra nada, así que se salta en vez de dar un falso negativo.
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
    // Contra el proyecto remoto, no poder abrir sesión es un fallo de verdad: la cuenta
    // existe en `scripts/data/cuentas-prueba.json` y tiene que poder entrar.
    resultados.push({
      cuenta: cuenta.etiqueta,
      rol: cuenta.rol,
      check: {
        tabla: "—",
        op: "leer",
        esperado: "permitir",
        descripcion: "iniciar sesión",
      },
      ok: false,
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
    // `rpc` entra aquí desde el 14-09-2026: un puente por organización que devuelve vacío
    // es el mismo caso que un `select` filtrado por RLS, y merece la misma lectura.
    const sinDatos = (check.op === "leer" || check.op === "rpc") &&
      check.esperado === "permitir" && detalle.startsWith("0 filas");
    const saltada = (check.op === "leer" && check.esperado === "permitir" &&
      vacias.has(check.tabla)) || (sinDatos && check.requiereFixture !== undefined);
    resultados.push({ cuenta: cuenta.etiqueta, rol: cuenta.rol, check, ok: saltada ? true : ok, saltada, detalle });
  }
  // 🔴 `scope: "local"`: el `signOut()` por defecto es GLOBAL y cierra TODAS las sesiones
  //    de la cuenta. Como el arnés entra con las cuentas de prueba —las mismas de los
  //    botones de `/login`—, cada pasada echaba a quien las estuviera usando en el
  //    navegador: la pantalla seguía cargando (PostgREST solo mira la firma del JWT) pero
  //    las Edge Functions respondían 401 `session_not_found`. Pasó el 28-09-2026.
  await cliente.auth.signOut({ scope: "local" });
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
