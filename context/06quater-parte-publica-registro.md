# AGENTS.md §6quater — 6quater. Parte pública, accesos separados y registro (31-07-2026)

> Detalle de la sección 6quater de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §6quater» del código apuntan aquí.

## 6quater. Parte pública, accesos separados y registro (31-07-2026)

Hasta hoy **no existía ninguna página pública**: `AuthGate` envolvía el router entero, así que
cualquier URL enseñaba el login del equipo («Consola Redestina · accés restringit a l'equip») y el router
ni se montaba sin sesión. Eso servía cuando los únicos usuarios eran tres personas del equipo; con
paneles de productor y de receptor deja de servir, porque no hay dónde explicar qué es Redestina ni por
dónde entra alguien que todavía no tiene cuenta.

### La composición se invierte

```text
App.tsx   SessioProvider            sesión cruda (¿hay token?) + evento PASSWORD_RECOVERY
            └─ RouterProvider
router    ArrelApp                  si esRecovery → /restablir, desde cualquier ruta
            ├─ públicas   /  /login  /admin  /registre  /restablir
            ├─ RequireSessio         monta AppContextProvider SOLO con sesión confirmada
            │    ├─ /panell (raíz por rol)  ·  /sense-acces
            │    └─ AppShell → /equip  /productor  /receptor
            └─ *  → /
```

**Por qué dos contextos y no uno.** `useSessio` (nuevo) solo dice si hay token; `useAppContext` dice
quién eres. `AppContextProvider` vive **dentro** de `RequireSessio` y no puede alcanzarse de otra manera.

🔴 **El contexto falla CERRADO (07-10-2026).** Hasta ese día, si `get_my_session_context` fallaba (red,
5xx, timeout), `contextDegradat()` construía un contexto que **simulaba equipo interno** (`esIntern`,
`admin`, `potAprovar`, `esSuperAdmin` a `true`, `rols: ['intern']`) y la interfaz le abría el panel del equipo
con todos los botones a **cualquier** usuario, productor o receptor incluidos, sin reintento hasta recargar
(la RLS cortaba los datos y las escrituras daban 0 filas silenciosas, pero la interfaz no debía abrirlo).
Ahora `resolContext(data, error)` (`src/lib/rols.ts`) devuelve `{ ok: false }` ante un error o una respuesta
vacía; `mapejaContext` solo concede `esIntern`/`potAprovar`/`esSuperAdmin` cuando la base devuelve exactamente
`true`; y `useAppContext` pinta la pantalla «No s'ha pogut carregar el teu compte» con «Torna-ho a provar»
(vuelve a cargar) y «Sortir» (cierra solo este dispositivo), sin montar nada de la aplicación privada. Se
retiró también el badge «Mode compatibilitat» de `AppShell` y no queda modo de compatibilidad ni en
desarrollo (la RPC existe en producción y en el clon). Los seis gates que daban `true` por defecto sin
contexto (`OfferDetail`, `Aprovacions`, `CanalitzacioDetall`, `ConveniDetall`, `FitxaRegistre`,
`DocumentacioOrganitzacio`) ahora dan `false`. `tests/rols.test.ts` fija que un error, una respuesta vacía o una
fila sin las claves de permisos no conceden nada.

🔴 **`carregant` DESMONTA LA PANTALLA, así que solo lo enciende la PRIMERA carga**
(22-09-2026). `RoleGuard` y `ArrelPerRol` hacen `if (carregant) return <Carregant />`: mientras
vale `true` el `<Outlet/>` no está montado, o sea que **cada recarga del contexto tiraba la
pantalla entera y la volvía a montar con estado nuevo**. Medido en producción antes del arreglo:
abrir el detalle de una oferta costaba **50 peticiones** —`excedentes` 13 veces, la Edge Function
`priorizar-entidades` **5** a ~1,4 s cada una, y `canalizaciones`/`albaranes`/`oferta_respuestas`/
`productores` 6 cada una—, con la pantalla tardando 8-12 s en estar completa. No era StrictMode:
la cifra es del *bundle* de producción.
⚠️ **Y no era solo lento**: el remontaje se llevaba por delante cualquier diálogo abierto (su
`open` es estado local), y las referencias del DOM caducaban entre dos lecturas seguidas. Una
recarga posterior no necesita bloquear nada —ya hay contexto servido— así que `primera` (un
`useRef`) hace que `setCarregant(true)` solo ocurra una vez.

🔴 **Y `SIGNED_IN` NO significa «alguien acaba de entrar».** supabase-js lo emite también al
recuperar la sesión del almacenamiento y al volver a la pestaña, así que `carrega()` se
disparaba una y otra vez sobre el **mismo** usuario (7 llamadas a `get_my_session_context` en
una sola carga). Ahora se compara con `usuariCarregat` y solo se recarga si el usuario es
**otro**; `SIGNED_OUT` sigue recargando siempre. Por lo mismo, `useSessio` **conserva el objeto
anterior** cuando el `access_token` y el `user.id` no han cambiado: ese provider envuelve la
parte pública y la privada, y guardar un objeto nuevo por cada evento re-renderizaba la
aplicación entera sin que nada hubiera cambiado.

| Ruta | Qué es |
| --- | --- |
| `/` | **Landing pública** (`routes/public/Landing.tsx`): hero, «Com funciona» (los 4 momentos, con copy propio `land.*`), «Per a qui» y pie. Con sesión redirige a `/panell` |
| `/login` | Acceso de **productores y entidades**, con enlace al registro y los accesos de prueba |
| `/admin` | Acceso del **equipo**, con el copy de siempre. **No se enlaza desde lo público** |
| `/privacitat` | La **política de privacidad** (27-10-2026), pública, enlazada desde las casillas RGPD del alta y el pie de la portada. Texto de trabajo con «PROVISIONAL — pendent de validació per l'assessoria» visible; cambiarlo es subir `VERSIO_RGPD` |
| `/registre` | Alta self-service por rol, **y desde el 16-09-2026 por los dos a la vez** (§9): el selector era un `Tabs` —que por definición deja elegir uno— y son dos conmutadores con `aria-pressed`. Sin `@radix-ui/react-checkbox`: son dos opciones y una dependencia no se paga por eso |
| `/restablir` | Contraseña nueva tras un enlace de recuperación |
| `/confirmar/:token` | **Confirmación de un albarán sin sesión** (fase 3). Móvil primero: se abre desde una finca. Lo que autoriza es el token, no una cuenta (§9) |
| `/signar/:token` | **Firma del convenio sin sesión** (fase 2). Mismo criterio |
| `/organitzacio/diagnostic` · `/equip/diagnostics[/:tipus/:id]` | El diagnóstico y su plan (§4). Las dos entradas de menú van **`barra: false`** y **ninguna entra en `navPerRol`**, así que la barra inferior de móvil sigue con cuatro (§2) |
| `/verificar/:codi` | **Comprobar un certificado de recepción**, sin sesión y sin token: lo que se enseña es el código impreso en el papel. Responde la Edge Function `verificar-certificat` (pública, solo lectura) con **ocho campos y ni uno más** — ni el PDF, ni `datos`, ni el detalle, ni ninguna procedencia, que nombraría a terceros que no han pedido salir en una página pública. ⚠️ Un código **inventado y uno mal formado responden lo mismo**: distinguirlos diría si un número de certificado existe |
| `/panell` | Lo que antes era `/`: manda a cada cual a su panel |

🔴 **Y desde el 16-09-2026 EL CONVENIO YA NO SE FIRMA SALIENDO DE LA APLICACIÓN.** Con
sesión, el botón del aviso y el de «Pendent de tu» abren un **diálogo** (80 vw × 88 vh,
`DialegFirmaConveni`) que acuña el enlace al abrirse y monta dentro el mismo formulario.
Navegar a la página pública sacaba del panel y metía un convenio entero en una tarjeta de
28 rem, con metros de scroll — «se va fuera con una pantalla nueva y además está en un
espacio muy reducido», dijo el cliente.
⚠️ **No hay dos formularios**: `components/FirmaConveni` es el mismo en los dos sitios, y
lo único que cambia es `ample`. Con `ample` las dos columnas aparecen **solo desde `lg`**
(izquierda lo que se rellena, derecha lo que se lee y se acepta) y los campos van de dos en
dos desde `sm`; la página pública se queda en columna única **incluso en escritorio**,
porque quien llega por el correo puede estar en un móvil y de pie en un camino.
⚠️ **El diálogo no se cierra al pinchar fuera** (`onInteractOutside` prevenido): con nueve
campos rellenados y un trazo hecho, un clic despistado sería caro.
⚠️ **La confirmación de albarán SIGUE navegando** a `/confirmar/:token`: se abre sobre todo
desde el correo y desde una finca, y llevarla al diálogo es el mismo trabajo otra vez.

**Y ese «mismo trabajo otra vez» se hizo el 21-09-2026, por el modelo asistido.** Las tres
pantallas públicas que quedaban están partidas ya con el patrón de `FirmaConveni`: el formulario
en `components/`, la página como marco (`LayoutAcces` + `Card`) y el mismo componente dentro del
diálogo del equipo. Son `FormulariConfirmacio` (de `/confirmar/:token`), `FormulariFactura` (de
`/factura/:token`) y `FormulariNovaOferta` (de `/productor/ofertes/nova`).

⚠️ **La tercera no se partió por simetría**: `productorId` salía de `useOrganitzacio('productor')`,
que un interno **no tiene**, así que el alta de oferta era literalmente inalcanzable para quien
opera en nombre de otros — aunque `crear-oferta` ya aceptara al equipo y ya sellara
`canal='asistido'` desde julio. Ahora entra por prop.

⚠️ **`ample` decide el título, no solo el ancho.** Dentro del diálogo el título lo pone su
cabecera, así que el formulario omite el suyo y conserva **la referencia** —el número del albarán
o del resumen—, que es lo que dice de qué se está hablando.

⚠️ **El bloqueo por convenio entra por prop en el alta de oferta**, y no se lee dentro:
`useConveni` mira las organizaciones **de la cuenta**, y la del equipo no tiene ninguna. Leído
dentro daría `false` siempre en el alta asistida y dejaría al dinamizador delante de un `42501`
que la pantalla podía haber anticipado.

⚠️ **`/signar` y `/confirmar` siguen siendo públicas, y desde el 14-09-2026 también se
llega a ellas CON sesión**, desde el panel (`acunar_enllac_propi`, §6ter). No cambia quién
autoriza —sigue siendo el token— ni el contenido: lo único que añaden es el botón «Torna al
panell», que sale solo si hay sesión, y el destino viaja en `location.state.tornar`.

⚠️ **`/admin` no está enlazado, pero eso no es una protección.** Quien conozca la URL ve el mismo
formulario; lo que protege el panel del equipo son `RoleGuard` y las políticas de la base, no el
secreto de la ruta.

⚠️ **Los enlaces de recuperación y los mágicos aterrizan en `/`** (`redirectTo = APP_URL`) y
supabase-js consume los tokens del hash en cualquier ruta. Desde que la raíz es pública, quien
captura el evento `PASSWORD_RECOVERY` es `ArrelApp`, que desvía a `/restablir`. Si algún día se
cambia `APP_URL`, hay que revisar esto **y** la allow-list de Auth (§10).

**Volver a la portada, desde las cuatro pantallas de acceso** (16-09-2026). El logo de
`LayoutAcces` ya enlazaba a `/`, pero **nadie lee un logo como un botón**: desde `/login` y sobre
todo desde `/admin` —a la que se entra tecleando la URL, así que no hay «atrás» del navegador— no
había forma evidente de salir. El enlace explícito va en `LayoutAcces` y no en cada pantalla porque
las cuatro comparten marco.

**Y el menú de la persona lleva IDIOMA Y NOTIFICACIONES** (16-09-2026). El canal preferido
estaba enterrado al final de la ficha de la organización —una pantalla a la que se entra a
corregir el NIF, no a decidir cómo te avisan—; ahora está también arriba a la derecha, con
el idioma. Es el mismo dato y la misma RPC (`actualizar_meu_canal`), así que sigue estando
en la ficha para quien lo busque donde estaba.

⚠️ **Las notificaciones son DOS CASILLAS y `canal_preferido` guarda UN valor**, así que la
traducción es: las dos marcadas → `null` (auto), una sola → ese canal forzado, ninguna →
no se permite (nadie puede quedarse incontactable). **«Las dos» no significa enviar dos
veces**: `decidirCanal()` elige un canal por envío (§8bis), y marcar las dos es decir «usad
el que funcione». El texto de ayuda lo dice, porque la casilla sola sugiere lo contrario.

⚠️ **El canal es de la ORGANIZACIÓN, no de la persona**: si dos personas la comparten,
cambiarlo se lo cambia a las dos. Vive en `organizaciones.canal_preferido` justo para que
una organización con los dos papeles tenga UN canal (§4). El equipo no ve esta sección: no
tiene organización propia.

🔴 **Y el idioma pasa a guardarse TAMBIÉN en `perfiles.idioma`**, no solo en `localStorage`.
No es cosmético: **`preparar_convenio()` elige el idioma del documento leyendo esa columna**,
así que con la preferencia solo en el navegador alguien podía usar la aplicación en
castellano y recibir el convenio en catalán sin haber elegido nunca esa lengua.

**Y el menú de la persona enseña el correo** bajo el nombre (`UserMenu`): es **con qué cuenta
estás dentro**, y no se podía leer en ninguna pantalla — con la del equipo y la de la organización
abiertas en dos pestañas no había forma de saber en cuál estabas sin cerrar sesión. Se omite si el
nombre ya *es* el correo, para no escribir dos veces la misma línea.

**Deep-link**: antes la URL nunca cambiaba (el login se pintaba encima). Ahora `RequireSessio`
guarda la URL pedida en `location.state.from` y las dos pantallas de acceso vuelven a ella al
entrar; si la cuenta no tiene ese panel, `RoleGuard` la recoloca como siempre.

### Accesos directos a las cuentas de prueba

`/login` muestra, bajo el formulario, un botón por cuenta de prueba agrupado en **Fitxes reals de
l'equip** / Productors / Receptors (`src/lib/accessosTest.ts` +
`components/AccessosTest.tsx`): un clic abre sesión. Cada botón lleva **el nombre de la organización
en grande y qué es debajo, en pequeño** —es el nombre lo que identifica la cuenta al elegir, no su
tipo—.

El primer grupo va primero a propósito: es el único con el que se puede ejercitar el producto entero,
porque son las únicas fichas con móvil verificado en Meta. Su título no dice «WhatsApp» ni «doble
rol» porque **ninguna de las dos cosas es cierta para las cinco** —Anna Garreta solo tiene ficha de
entidad, y Laura Masdeu no tiene teléfono—; la excepción de cada una va en su propia etiqueta.

**No hay grupo «Control».** La cuenta sin rol y la del registro pendiente se retiraron el 31-07-2026:
son estados del sistema, no organizaciones con las que alguien quiera entrar a mirar, y ocupaban
sitio en la puerta de acceso. El caso pendiente se reproduce dando de alta cualquier organización
desde `/registre`.

Dos límites que **no se pueden relajar**:

1. **Ninguna cuenta con rol de plataforma.** Las de equipo (`hola+superadmin`, `hola+equip` y las
   tres reales) no están ni pueden estar: ven **todas** las fichas con nombre, NIF, teléfono y
   dirección (eran 452 hasta el borrado del 16-09-2026, §6; volverán a serlo al reimportar).
   El primer grupo sí enseña **fichas de personas reales del equipo**, pero por cuentas *externas*
   creadas aparte (§9), así que cada una ve solo la suya. Se aceptó explícitamente: es contacto
   profesional del propio equipo, no de los productores externos.
2. Todo el bloque va tras la variable de build **`VITE_ACCESSOS_TEST`** (§10). Con ella apagada,
   Vite pliega la constante a `false`, el `&&` queda en código muerto y el módulo con las
   contraseñas **se cae del bundle**. Verificado con `grep` sobre `dist/`, no por confianza: la
   contraprueba con el flag encendido sí las encuentra.

### Las rutas de las fichas del equipo desde 1C (02-11-2026)

`/equip/entitats` (listado único; `?rol=ofertant|receptor` fija el filtro de papel),
`/equip/entitats/nova[?rol=…]` («Nova entitat» en dos pasos desde 1B: `NovaEntitat`) y `/equip/entitats/:id` con el **id de la
organización**. Compatibilidad: `/equip/productors` → `/equip/entitats?rol=ofertant`,
`/equip/productors/nou` → `/equip/entitats/nova?rol=ofertant`, `/equip/productors/:id`
(`RedireccioFitxa`) → `/equip/entitats/:id`, y `EntitatDetall` resuelve un id de **ficha**
(`productores.id` o `entidades.id`, los de todos los enlaces de antes) a su organización con
`replace`. Los 14 enlaces del código pasan el id de ficha tal cual.

### Aprovacions: tres colas, y se aprueba desde la cola

`src/routes/equip/Aprovacions.tsx` tiene **«Registres pendents»** (altas del registro público:
`membresias` con `aprovacio='pendent'`, embebiendo la ficha, más una segunda consulta a `perfiles`
—`membresias.user_id` referencia `auth.users`, no `perfiles`, así que PostgREST no los embebe),
**«Convenis per contrasignar»** y la cola de **intereses** de las entidades. Cada fila de registro
enlaza a la ficha para poder **completarla antes** de aprobar (una entidad nueva llega con
`estat = null` y hasta que se rellene no entra en la priorización). Los botones llaman a
`aprovar_registre` / `rebutjar_registre` (§4bis). El contador del menú **suma las tres colas** y
sale del mismo store que el tablero (`pendentsEquip.ts`); el desglose va en el título de cada cola.
Desde la rebanada 1D del plan 1 (02-11-2026) Aprovacions ya no ofrece «Nova organització amb compte»:
el equipo da de alta sin cuenta («Nova entitat») y el acceso se da desde la ficha (§6ter, «Dona-li accés»).

**Desde el 15-09-2026 la cola de intereses se aprueba ahí mismo**, sin ir al detalle de la oferta:
cada fila dice «Falten {n} de {m} kg», trae los kg prellenados (y el precio en `venda`/`maquila`) y
ofrece «Aprova i canalitza» / «Rebutja» / «Obre l'oferta». La lógica se sacó de `OfferDetail` a
`src/lib/aprovarResposta.ts` (`comprovaConvenis`, `aprovarResposta`, `rebutjarResposta`) y **las dos
pantallas la comparten**: mismo aviso previo de convenio (§12.78), mismo `codi: 'sense_conveni'`
traducido a `od.conv_blocked`, misma confirmación al canalizar de más. Una cuenta `tecnic` ve los
botones grises con el motivo («Només admin»): no se le esconde nada, se le dice por qué (§6ter).
⚠️ `appr.rej_desc` y `appr.rej_reason` se usan a través de la tabla `TEXTOS_MOTIU`, no como literal
dentro de `t(...)`, así que `tests/cobertura.test.ts` **no** avisaría si faltaran.

