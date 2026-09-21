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
   * SQLSTATE adicionales que, en un check `permitir`, cuentan como «autorizó y falló
   * después». Casi nunca hace falta: lo normal ya lo cubre `ERRORES_DE_NEGOCIO`.
   */
  erroresEsperados?: string[];
  /**
   * Solo para `rpc`: argumentos. Dos valores literales se sustituyen en tiempo de
   * ejecución, para que la comprobación mida la AUTORIZACIÓN y no un "esa fila no existe"
   * que llegaría igual con permisos de sobra:
   *
   *   · `@meva_membresia`      → el id de la propia membresía (uuid nulo si no ve ninguna)
   *   · `@fitxa_amb_documents` → un productor con algún albarán fuera de borrador, o sea
   *                              una ficha que NO se puede borrar (20270329100000). Uuid
   *                              nulo si el fixture documental no está puesto.
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
  { tabla: "fijar_coste_producto", op: "rpc", esperado: "denegar", args: { p_producto: "Tomàquet", p_ejercicio: 1999, p_coste: 1, p_motivo: "arnes" }, descripcion: "NO fija costes por kilo" },
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
  { tabla: "cierres_ejercicio", op: "leer", esperado: "denegar", descripcion: "NO ve los cierres de ejercicio" },
  { tabla: "cierres_donante", op: "insertar", esperado: "denegar", descripcion: "NO escribe en el cierre (no hay GRANT)" },
  { tabla: "abrir_cierre", op: "rpc", esperado: "denegar", args: { p_ejercicio: 2020, p_modo: "prueba" }, descripcion: "NO obre cap tancament" },
  { tabla: "calcular_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO calcula un cierre" },
  { tabla: "emitir_certificado", op: "rpc", esperado: "denegar", args: { p_cd: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet certificats de donació" },
  { tabla: "conciliacion_retroactiva", op: "rpc", esperado: "denegar", args: { p_canalizacion: "00000000-0000-0000-0000-000000000000", p_kg: 1, p_motivo: "arnes" }, descripcion: "NO concilia res a posteriori" },
  { tabla: "reiniciar_cierre_prueba", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO reinicia un cierre de prueba" },
  { tabla: "datos_182", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO exporta los datos del 182" },
  { tabla: "cerrar_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO tanca cap exercici" },
  // Emitir TODOS los certificados de un cierre de golpe (20260921211356). Es la acción
  // más destructiva del circuito fiscal —N documentos con número legal y N correos a N
  // donantes— así que es la primera que tiene que cortar para cualquier cuenta externa.
  { tabla: "emitir_certificados_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet en bloc els certificats d'un tancament" },
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
  { tabla: "emitir_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet cap certificat a demanda" },
  { tabla: "registrar_factura_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000", p_numero: "F-ARNES" }, descripcion: "NO registra la factura d'un periode" },
  { tabla: "rectificar_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000", p_motivo: "arnes" }, descripcion: "NO rectifica cap certificat a demanda" },
  { tabla: "marcar_enviado_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO marca com a enviat cap certificat a demanda" },
  { tabla: "reiniciar_periodes_prova", op: "rpc", esperado: "denegar", args: { p_ejercicio: 1999 }, descripcion: "NO reinicia els certificats a demanda de prova" },
  // Borrado de una ficha (20270329100000, deuda §12.108). Las dos funciones nuevas están
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
  // Crear una espigolada es del EQUIPO, y desde la F3 (20260921221806) además CONVIERTE
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
  // --- Certificat de recepcio (CR, 20260921223245 / 223246) ---
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
  // --- Diagnòstic i pla de prevenció (F2, 20260921231946…231950) ---
  // El CUESTIONARIO sí lo ve cualquier cuenta con sesión: es el formulario que tiene que
  // contestar, y la política es `vigente or es_intern()`. Lo que NO ve es la maquinaria que
  // decide qué medidas le tocan —el catálogo y las reglas—, que es configuración del
  // servicio: su plan lleva el título y la descripción de cada medida COPIADOS dentro, así
  // que cerrarlas no le quita nada que necesite para leer su propio plan.
  { tabla: "questionaris_diagnostic", op: "leer", esperado: "permitir", descripcion: "veu el questionari vigent que ha de contestar", requiereFixture: "el questionari sembrat (migració 20260921231949)" },
  { tabla: "questionaris_diagnostic", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap questionari (no hi ha GRANT per a ningu)" },
  { tabla: "mesures_prevencio", op: "leer", esperado: "denegar", descripcion: "NO veu el cataleg de mesures de prevencio" },
  { tabla: "mesures_prevencio", op: "insertar", esperado: "denegar", descripcion: "NO declara cap mesura" },
  { tabla: "regles_pla", op: "leer", esperado: "denegar", descripcion: "NO veu les regles que generen el pla" },
  { tabla: "regles_pla", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap regla" },
  { tabla: "questionari_vigent", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor" }, descripcion: "pot demanar el questionari vigent", requiereFixture: "el questionari sembrat (migració 20260921231949)" },
  // Publicar una versión del cuestionario es `pot_aprovar()`: decidir qué se le pregunta a
  // una organización es una decisión, no una edición. Las preguntas van VACÍAS a propósito —
  // el 42501 llega antes de validarlas, así que esto no escribe nada ni siendo del equipo.
  { tabla: "publicar_questionari", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_titol: { ca: "x", es: "x" }, p_preguntes: [] }, descripcion: "NO publica cap questionari" },
  // Las tres que reciben (tipo_org, org): su guarda `puc_gestionar_pla()` va ANTES de buscar
  // ninguna fila, así que el 42501 llega sin que la función mire si la organización existe —
  // que es lo que hace inofensivo apuntar a un uuid inventado.
  { tabla: "desar_diagnostic", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_respostes: {} }, descripcion: "NO contesta el diagnostic d'una altra organitzacio" },
  { tabla: "generar_pla_des_de_diagnostic", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO genera el pla d'una altra organitzacio" },
  { tabla: "diagnostic_estat", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO consulta el diagnostic d'una altra organitzacio" },
  // La bandeja de diagnósticos de TODA la base es del equipo, como `pendents_equip()`.
  { tabla: "diagnostics_equip", op: "rpc", esperado: "denegar", descripcion: "NO veu els diagnostics de tota la base" },
];

// Lo que CADA rol debe poder hacer. Es la especificación ejecutable de AGENTS.md §4:
// si alguien relaja una política sin querer, aquí sale en rojo.
const MATRIZ: Record<Cuenta["rol"], Check[]> = {
  equip: [
    // --- La via assistida (20270329100000 / 20270330100000 / 20270331100000) ---
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
    // --- Diagnostic i pla de prevencio (F2) ---
    // El técnico LEE las tres tablas del servicio y no escribe ninguna: declarar obligatoria
    // una medida o cambiar el cuestionario es `pot_aprovar()`, igual que publicar el texto de
    // una plantilla documental.
    { tabla: "questionaris_diagnostic", op: "leer", esperado: "permitir", descripcion: "llegeix els questionaris", requiereFixture: "el questionari sembrat (migracio 20260921231949)" },
    { tabla: "mesures_prevencio", op: "leer", esperado: "permitir", descripcion: "llegeix el cataleg de mesures", requiereFixture: "les mesures sembrades (migracio 20260921231949)" },
    { tabla: "regles_pla", op: "leer", esperado: "permitir", descripcion: "llegeix les regles del pla", requiereFixture: "les regles sembrades (migracio 20260921231949)" },
    { tabla: "mesures_prevencio", op: "insertar", esperado: "denegar", descripcion: "NO declara cap mesura (nomes pot_aprovar)" },
    { tabla: "regles_pla", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap regla (nomes pot_aprovar)" },
    { tabla: "questionaris_diagnostic", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap questionari a ma (va per publicar_questionari)" },
    { tabla: "publicar_questionari", op: "rpc", esperado: "denegar", args: { p_tipo_org: "productor", p_titol: { ca: "x", es: "x" }, p_preguntes: [] }, descripcion: "NO publica cap questionari" },
    { tabla: "diagnostics_equip", op: "rpc", esperado: "permitir", descripcion: "veu els diagnostics de tota la base", requiereFixture: "alguna fitxa de productor o entitat" },
    // ⚠️ Con un uuid INEXISTENTE a propósito: la guarda de rol deja pasar (es del equipo, y
    //    el modelo es asistido), la RPC llega hasta el insert y la FK lo rechaza con `23503`.
    //    O sea que mide la autorizacion y **no escribe nada**.
    { tabla: "desar_diagnostic", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_respostes: {} }, descripcion: "pot contestar el diagnostic en nom d'una organitzacio (model assistit)" },
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
    // Emitir en bloque tampoco: es `pot_aprovar()`, la misma guarda que emitir uno a uno.
    // Si algún día la de la tanda se relajara sin tocar la individual, este check es el
    // único sitio donde se vería —desde el panel las dos se ven igual de grises—.
    { tabla: "emitir_certificados_cierre", op: "rpc", esperado: "denegar", args: { p_cierre: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet en bloc els certificats d'un tancament (és de pot_aprovar)" },
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
    { tabla: "calcular_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_productor: "00000000-0000-0000-0000-000000000000", p_desde: "1999-01-01", p_hasta: "1999-12-31", p_modo: "prueba" }, descripcion: "NO calcula un certificat a demanda (és de pot_aprovar)" },
    { tabla: "emitir_certificado_periodo", op: "rpc", esperado: "denegar", args: { p_periodo: "00000000-0000-0000-0000-000000000000" }, descripcion: "NO emet un certificat a demanda (és de pot_aprovar)" },
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
    { tabla: "pendents_equip", op: "rpc", esperado: "permitir", descripcion: "consulta la cua de treball de l'equip" },
    // Borrado de una ficha (20270329100000, deuda §12.108). El técnico SÍ puede preguntar
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
  ],
  super_admin: [
    // La guarda de rol de la conversión de una oferta en jornada (F3, 20260921221806).
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
    // --- Diagnostic i pla de prevencio (F2) ---
    { tabla: "questionaris_diagnostic", op: "leer", esperado: "permitir", descripcion: "llegeix els questionaris", requiereFixture: "el questionari sembrat (migracio 20260921231949)" },
    { tabla: "mesures_prevencio", op: "leer", esperado: "permitir", descripcion: "llegeix el cataleg de mesures", requiereFixture: "les mesures sembrades (migracio 20260921231949)" },
    { tabla: "regles_pla", op: "leer", esperado: "permitir", descripcion: "llegeix les regles del pla", requiereFixture: "les regles sembrades (migracio 20260921231949)" },
    // Ni el super_admin escribe la tabla a mano: publicar retira la version anterior y publica
    // la nueva en una transaccion, y eso no se hace con dos `update` desde el navegador.
    { tabla: "questionaris_diagnostic", op: "insertar", esperado: "denegar", descripcion: "NO escriu cap questionari a ma (va per publicar_questionari)" },
    // 🔴 `p_preguntes: []` NO es pereza: la guarda de rol deja pasar y entonces la validacion
    //    levanta `22023` ANTES del insert. Asi se comprueba que el super_admin autoriza **sin
    //    publicar una version de verdad**, que retiraria la vigente EN PRODUCCION. Mismo
    //    criterio que `borrar_ficha_completa()`.
    { tabla: "publicar_questionari", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_titol: { ca: "x", es: "x" }, p_preguntes: [] }, descripcion: "pot publicar un questionari (autoritza; 22023 per les preguntes buides)" },
    { tabla: "diagnostics_equip", op: "rpc", esperado: "permitir", descripcion: "veu els diagnostics de tota la base", requiereFixture: "alguna fitxa de productor o entitat" },
    { tabla: "desar_diagnostic", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000", p_respostes: {} }, descripcion: "pot contestar el diagnostic en nom d'una organitzacio (model assistit)" },
    { tabla: "generar_pla_des_de_diagnostic", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot generar el pla en nom d'una organitzacio (22023 sense_esborrany)" },
    { tabla: "diagnostic_estat", op: "rpc", esperado: "permitir", args: { p_tipo_org: "productor", p_org: "00000000-0000-0000-0000-000000000000" }, descripcion: "pot consultar l'estat del diagnostic de qualsevol organitzacio" },
    // --- La via assistida (20270329100000 / 20270330100000 / 20270331100000) ---
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
      tabla: "rectificar_certificado_transaccion",
      op: "rpc",
      esperado: "permitir",
      args: { p_cd: "00000000-0000-0000-0000-000000000000", p_motivo: "Comprobación del arnés de RLS" },
      descripcion: "pot rectificar un certificat de transaccio (autoritza; l'acumulat no existeix)",
    },
    // Emitir en bloque los certificados de un cierre (20260921211356). Sobre un uuid
    // inventado la guarda de rol pasa y la función cae con 22023 («aquest tancament no
    // existeix») sin dejar rastro. **El bloque real no se prueba nunca en positivo**: una
    // sola llamada buena consumiría N números de la serie CD y mandaría N correos, y eso
    // es exactamente lo que un arnés que corre contra producción no puede hacer.
    {
      tabla: "emitir_certificados_cierre",
      op: "rpc",
      esperado: "permitir",
      args: { p_cierre: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot emetre en bloc els certificats (autoritza; el tancament no existeix)",
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
      args: { p_periodo: "00000000-0000-0000-0000-000000000000" },
      descripcion: "pot emetre un certificat a demanda (autoritza; el periode no existeix)",
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
    { tabla: "pendents_equip", op: "rpc", esperado: "permitir", descripcion: "consulta la cua de treball de l'equip" },
    {
      tabla: "convenios",
      op: "leer",
      esperado: "permitir",
      descripcion: "ve tots els convenis",
      requiereFixture: "algún convenio (scripts/crear-datos-documentales-prueba.ts)",
    },
    // ── Borrado de una ficha (20270329100000, deuda §12.108) ───────────────────
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
    { tabla: "wa_messages", op: "leer", esperado: "denegar", descripcion: "NO ve la mensajería" },
    { tabla: "app_settings", op: "leer", esperado: "denegar", descripcion: "NO ve la configuración" },
    { tabla: "oferta_respuestas", op: "insertar", esperado: "denegar", descripcion: "NO escribe respuestas a mano (van por RPC)" },
    { tabla: "canalizaciones", op: "insertar", esperado: "denegar", descripcion: "NO se canaliza a sí mismo" },
    { tabla: "series_documentales", op: "leer", esperado: "denegar", descripcion: "NO ve los contadores de serie" },
    { tabla: "siguiente_numero", op: "rpc", esperado: "denegar", args: { p_serie: "PROVA", p_ejercicio: 1999 }, descripcion: "NO puede pedir un número de serie" },
    { tabla: "organizaciones", op: "leer", esperado: "permitir", descripcion: "veu la seva organitzacio" },
    { tabla: "v_organizaciones", op: "leer", esperado: "permitir", descripcion: "veu qui es la seva organitzacio" },
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
    { tabla: "convenios", op: "leer", esperado: "denegar", descripcion: "no ve ningún convenio" },
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
    { tabla: "convenios", op: "leer", esperado: "denegar", descripcion: "no ve ningún convenio" },
    ...DOCUMENTAL_EXTERN,
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
  // Diagnóstico (F2, 20260921231946…231950). Se rellenan ENTERAS por el mismo motivo que las
  // del cierre: lo que tiene que cortar es el permiso, no un `not null` ni un check de forma
  // sobre el jsonb — y las tres tienen checks de forma que saltarían antes.
  questionaris_diagnostic: {
    tipo_org: "productor",
    versio: 9999,
    vigente: false,
    titol: { ca: "TEST-RLS", es: "TEST-RLS" },
    preguntes: [{
      id: "test_rls", tipus: "text", seccio: "seguiment", obligatoria: false,
      etiqueta: { ca: "TEST-RLS", es: "TEST-RLS" },
    }],
  },
  mesures_prevencio: {
    codi: "test_rls_mesura", tipo_org: "productor", bloc: "seguiment",
    titol: { ca: "TEST-RLS", es: "TEST-RLS" },
    descripcio: { ca: "TEST-RLS", es: "TEST-RLS" },
  },
  // `operador: 'sempre'` con pregunta y valor nulos cumple los tres checks, y la pareja
  // (mesura_codi, tipo_org) existe en el seed: la FK compuesta no puede ser la que corte.
  regles_pla: {
    tipo_org: "productor", operador: "sempre",
    mesura_codi: "registre_quantitats", obligatoria: false,
  },
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
    } else if (valor === "@fitxa_amb_documents") {
      // Un productor con algún albarán que ya NO es borrador: por definición, su ficha no
      // se puede borrar (20270329100000). Se busca en vez de codificar `TEST-PROD-1` para
      // que el check siga midiendo algo si el fixture cambia de nombre; si no hay ninguno,
      // cae al uuid nulo y el `requiereFixture` del check lo marca como saltado.
      const { data } = await cliente.from("v_albaranes_bandeja")
        .select("productor_id")
        .neq("estado", "borrador")
        .not("productor_id", "is", null)
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
      const esperado = esErrorDeNegocio(codigo, check.erroresEsperados ?? []);
      return {
        ok: esperado,
        detalle: esperado
          ? `autoritza (${codigo} esperat)`
          : `ERROR NO ESPERADO ${codigo}: ${error.message.slice(0, 50)}`,
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
