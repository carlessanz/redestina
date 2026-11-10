# AGENTS.md §6 — 6. Importación de datos maestros

> Detalle de la sección 6 de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §6» del código apuntan aquí.

## 6. Importación de datos maestros

🔴 **LOS DATOS IMPORTADOS YA NO ESTÁN EN LA BASE (16-09-2026).** A petición del cliente —«estamos
en desarrollo, no quiero esos datos en la base actual»— se borraron las **340 fichas de productor y
las 111 de entidad que no eran de prueba**, sus 12 ubicaciones y las **451 organizaciones** que
quedaron sin ficha. Queda **lo de prueba y nada más**: 6 productores + 8 entidades con `es_test`,
más la ficha del arnés (ver abajo). **Todo lo que este documento cuenta en pasado sobre el import
sigue siendo cierto** —cómo se hizo, qué peculiaridades tenían los CSV, qué se midió con esas 456
fichas— pero **ya no describe el contenido de la base**: antes de citar una de esas cifras como
estado actual, contar filas.

⚠️ **No costó nada colateral, y eso se midió antes de borrar**: de esas 452 fichas no colgaba ni un
excedente, ni una canalización, ni un convenio, ni un albarán, ni un documento — todo el circuito
documental pertenece a las fichas de prueba. Lo único que tenían eran las 12 `productor_ubicaciones`.
Después del borrado, **cero referencias colgando** en las ocho comprobaciones de integridad (FK
lógicas incluidas, que en mensajería no existen) y **cero objetos huérfanos en Storage**; el arnés
salió **669/669 + 13**, exactamente la referencia de §13, que es lo que demuestra que la base sigue
coherente.

⚠️ **Dos filas se quedaron a propósito y no son un descuido:**
- La ficha **«Compte de proves de l'arnes»** (`TEST-PENDENT-ARNES`), que es `es_test = false` pero
  cubre el bloque `pendent` del arnés: borrarla apaga **73 comprobaciones en silencio** (§9).
- `email_test_recipients` conserva **`tecnologia@espigoladors.com`** sin ficha detrás: es el correo
  propietario de la cuenta de Resend (§12.33). Y `wa_contacts` conserva `34636977820` («Laura
  Masdeu», 0 mensajes), que ya estaba sin ficha antes del borrado porque su ficha no tiene teléfono.

**Para recuperarlos**: `deno run -A scripts/import-ara.ts`, que es idempotente y sigue teniendo sus
CSV en `scripts/data/` (fuera de git, §7). Los `id` serían nuevos, así que no es «deshacer»: es
volver a importar.

Los datos maestros entran por **dos vías distintas, y la diferencia importa**:

| Qué | Cómo | Por qué |
| --- | --- | --- |
| Catálogos (`productos`, `causas`, `factores_conversion`) | Migración `20260721120300_seed_catalogos.sql` | Son configuración, no llevan datos personales: pueden vivir en git y deben existir en todos los entornos |
| `productores` y `entidades` | `scripts/import-ara.ts` | Llevan nombre, NIF, teléfono, email y dirección: los CSV **nunca** se versionan (§9) |

Para **regenerar el seed de catálogos** tras reexportar los CSV: el fichero se generó
leyendo `scripts/data/{causas,productos,factores_conversion}.csv`, normalizando las familias
igual que el script y emitiendo `insert … on conflict … do update`. Basta con crear una
migración nueva con el mismo formato; no editar la ya aplicada.

`scripts/import-ara.ts` (Deno) carga los 5 CSV de `scripts/data/`. **Idempotente**: se puede
ejecutar las veces que haga falta. Admite `--dry-run`. Verificado end-to-end con dos pasadas
seguidas: la segunda actualiza, no duplica.

| CSV | Filas | Destino | Clave |
| --- | --- | --- | --- |
| `causas.csv` | 8 | `causas` | `codigo` |
| `factores_conversion.csv` | 15 | `factores_conversion` | `producto` |
| `productos.csv` | 91 → 90 | `productos` | `nombre` |
| `sda.csv` | 111 | `entidades` | `nombre` (lookup manual) |
| `prod_actius.csv` | 339 | `productores` | ver abajo |

Peculiaridades verificadas de los datos, todas manejadas por el script:

- **`prod_actius.csv` tiene la cabecera DESPLAZADA** respecto a los datos: la primera
  columna real es una fecha de alta que no figura en la cabecera. Se importa por
  **posición**, ignorando la cabecera. El mapeo está documentado en el propio script.
- **3 códigos apuntan a productores distintos** (`CN038`, `PR215`, `PR273`). Usar `codigo`
  como clave fusionaría fichas: para los códigos ambiguos se cae a `nombre + población`.
- **Los teléfonos son texto libre**: espacios entre grupos, nombres pegados, extensiones y
  hasta tres números en una celda. `extraerTelefonos()` busca secuencias de 9 dígitos
  tolerando separadores; el primero va a `phone` y el resto a `telefono_alt`. Si no se
  extrae ninguno pero la celda tenía texto, se conserva en crudo.
  Resultado: **278 de 339 con teléfono, de los cuales solo 272 son móviles** — los 6 fijos
  no reciben WhatsApp. 3 colisiones (el segundo se queda con `phone = null`).
- `productos.csv` trae erratas de familia (`Fruita seca`, `Fruit vermell`,
  `Hort Tub/Bul/Arr`) que se normalizan, y un `Garrofa` duplicado que se fusiona.
- `email` es UNIQUE: vacíos y duplicados van a `null` (solo 78 de 339 tienen email).
- Solo 12 productores tienen par de coordenadas numérico → se crean ~12 ubicaciones.
- `productos_habituales` queda **vacío**: la columna Producte no existe en este export.
  Reimportar cuando se reexporte el Excel ARA con esa columna.


## 6.1 Importación del ARA 2026 (plan 1, rebanada 1E, 02-11-2026)

**Script `scripts/import-ara-2026.ts`** (Deno) sobre el núcleo puro **`scripts/ara2026/nucli.ts`**
(probado en `tests/importAra2026.test.ts`, CSV sintéticos). `import-ara.ts` se conserva como
**histórico** (la carga de julio, borrada el 16-09): no se vuelve a ejecutar.

```bash
eval "$(bash scripts/local/entorno-local.sh)"      # el clon
deno run -A --node-modules-dir=none scripts/import-ara-2026.ts --dry-run   # siempre primero
deno run -A --node-modules-dir=none scripts/import-ara-2026.ts             # carga
```

Fuera de esta máquina (`SUPABASE_URL` que no sea `127.0.0.1`/`localhost`) solo corre con `--dry-run`
salvo `--produccio` explícito: **la carga en producción es otra sesión, con el informe del dry-run
delante y la aprobación de Carles** (fecha límite 31-12-2026).

**Entrada**: `scripts/data/2026/{prod_actius,prod_inactius,prod_potencials,sda,sda_inactius}.csv`
(fuera de git), exportados del `DATOS_ARA_2026_.xlsm` con `scripts/data/2026/exportar-ara.py`
(biblioteca estándar, valores en caché, macros sin ejecutar). Opcional `airtable.csv` (copia del
`Datos AIRTABLE.csv` de `1. Fuentes/`) para el cruce. **Salida**: `informe-<fecha>[-dry-run][-N].md`
y `cruce-airtable-<fecha>.md` en la misma carpeta (datos personales: nunca a Drive ni a git; una
pasada no pisa el informe de otra del mismo día).

**Decisiones aplicadas** (D2 y §1E del plan, y las que tomó la sesión donde el plan no decía nada):

| Tema | Decisión |
| --- | --- |
| Estado | Todo `activo = false`, `es_test = false`. Activar exige NIF válido y razón social (trigger 1A); la razón social **no** se rellena desde el Excel (la columna «Empresa» es el nombre comercial y a veces una persona). |
| Origen | `ref_externa = 'ARA26:<hoja>:<línea del CSV>'` (cabecera = línea 1), columna nueva en las dos fichas (`20270503100000`, índice único parcial). 1A no la había añadido. |
| Mapeo | **Por cabecera normalizada** (minúsculas, sin acentos, espacios colapsados) y, si se repite, **por ocurrencia**; si falta una cabecera esperada el script se para. Las columnas sin cabecera se nombran por su ocurrencia de la cabecera vacía. |
| Prod | `Nom` (`Productor/a` en potencials; la 2.ª columna sin cabecera en inactius) → `name` (o `Empresa` si falta); `Empresa`, `Comentari`, `Visitat`, `Conveni` tal cual; `Tipo Empresa` (en potencials, «Producte» #0: `Potencial`/`Pot.NoContac`) → `tipo_empresa`; `Producte` (#1 en potencials) → `productos_habituales[]`; `C.P.` #1 de potencials = área. **«Movils» y «Fix» son texto libre con teléfonos y correos** (en actius «Fix» trae sobre todo correos): de las dos salen los teléfonos (el primero libre → `phone`, el resto → `telefono_alt`) y el correo (el primero libre → `email`). Un tipo que es un correo cuenta como correo. |
| SDA | `nom`/`NOM ` → `nombre`; **«Telefon» #0 (el de la entidad) → `telefono`; «Telèfon» #1 (el de la persona de «Contactes») → `telefono2`; «Telèfon 2» → `telefono3`** (con «Contacte 2» y «Mail 2»); «Mail» → `email`; capacidades → `*_txt` + booleano solo si es concluyente. `tipo_receptor` desde `Familia` (análisis 21-09, §6.2: SDA/Xarxa/Cuines/BDA/Centre Social/Ajuntament → social; Animal → animal; E.I. → transformador; Ind. Agroalimentària → comercial). |
| Lo que no tiene columna | Va a un bloque **«[ARA 2026 · hoja · línia N]»** al final de `comentario`/`comentarios`: NIF inválido o repetido (con el valor original, para corregirlo al activar), motivo de baja (inactius), fecha de alta que no es fecha (`FITXAT`, un año en productores), código que no lo parece (`??`, `-`), coordenadas, teléfonos sobrantes o no reconocibles de las entidades, correos sobrantes o ya usados, y del SDA: Observacions, càmera frigorífica, neveres, beneficiaris, personal (`Treballador/es` o `Personal contractat`), voluntaris, voluntaris per espigolar y curs. **No se importan** las columnas mensuales 2019-2026 ni `Saldo`. |
| Fechas | ISO tal cual; número de serie de Excel (`43795`, celdas sin formato de fecha) → ISO; año suelto: en `entidades.data_alta` (texto) se guarda, en `productores.data_alta` (date) va a la nota. |
| NIF | Normalizado como el trigger; **inválido** → sin NIF + informe + nota; **repetido** entre filas del mismo papel → lo conserva la primera en el orden `prod_actius → prod_inactius → prod_potencials → sda → sda_inactius` (cierra §12.144); **ya en la base** en una ficha no importada → no se crea («ja existeix»). |
| Doble rol | Primera fila de Prod + primera de SDA con el mismo NIF → una organización, dos fichas. Sin NIF nunca se juntan; los nombres repetidos solo se listan. |
| Únicos | `productores.phone` y `.email` son UNIQUE: el número ya usado va a `telefono_alt` y el correo a la nota (informe «en uso»). |
| Municipio | `municipio_ine` solo si el nombre (sin artículo: «Prat de Llobregat, el» = «El Prat de Llobregat») casa con **un** municipio del catálogo; el trigger rellena entonces `poblacion` y `area_geografica` (= comarca). Si no, se conserva el texto del Excel. |
| Idempotencia | La segunda pasada encuentra la ficha por `ref_externa` y **solo rellena huecos** (nunca `activo`, nunca pisa lo corregido). Una ref que ya existe con **otro nombre** (la exportación cambió de orden) no se toca y va al informe. |
| Ubicaciones | **No** se crean `productor_ubicaciones` (14 pares de coordenadas útiles): quedan en la nota (§12.153). |

**Medido en el clon el 02-11-2026** (dry-run = carga; segunda pasada: 721 sin cambios):

| Hoja | Filas CSV | Sin nombre | Creadas | Sin NIF | NIF inválido | NIF repetido | Tel. sin extraer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| prod_actius | 353 | 6 | 347 | 172 | 21 | 0 | 6 |
| prod_inactius | 28 | 0 | 28 | 12 | 0 | 0 | 0 |
| prod_potencials | 176 | 1 | 175 | 174 | 0 | 1 | 7 |
| sda | 114 | 0 | 114 | 46 | 21 | 14 | 3 |
| sda_inactius | 57 | 0 | 57 | 41 | 7 | 3 | 1 |

550 productores + 171 entidades = 721 fichas en **720 organizaciones** (1 doble rol, por NIF);
0 «ja existeix»; 0 errores; 26 teléfonos ya usados por otro productor; 566 filas con municipio casado
y 110 sin casar. El arnés no cambia de cifra (1.711/1.711 y 31 sin datos): una ficha externa nueva
no añade comprobaciones. `cerca_entitats` las encuentra por NIF (exacto y prefijo) y por nombre;
ninguna sale en «Nova oferta assistida» ni en `priorizar-entidades` (comprobado con sesión de equipo).

**Cruce con Airtable (solo informe, nada se carga).** El CSV de transacciones (`;`) llega roto: las
celdas multilínea son filas sueltas. Se agrupa por registro (línea que empieza por `E-2026-NNN` y sus
continuaciones) y solo se fía de la línea de inicio: el ofertante sale de «Nombre transacción»; receptor
y destino, solo si esa línea trae sus 28 campos en su sitio. 36 registros (35 enteros), 34 códigos sin
registro (solo «Mensaje comercial»), 19 ofertantes y 4 receptores. Regla §4: **solo la coincidencia
exacta normalizada se propone casar, y la confirma Carles**; parecidos (trigramas ≥ 0,40 o un nombre
que contiene al otro) → «revisar»; lo que no está → «crear inactivo» (receptor `comercial` salvo
entidad social; `animal` si todo fue a alimentación animal). Resultado: casar 6 · revisar 11 · crear 6.

**Pendiente para la carga en producción** (decide Carles): aprobar el informe del dry-run contra
producción; confirmar el cruce de Airtable (las 6 exactas, las 11 dudosas, y si se crean las 6 que solo
están en Airtable); pedir la exportación de «Ofertantes»/«Receptores» de Airtable para casar por
teléfono o correo (P7); si el `.xlsm` del 21-09 es el definitivo (riesgo del plan, §7); y si se quieren
las coordenadas como `productor_ubicaciones`.

**Estado CRM (Plan 2 B1, `20270518100000`)**: cada hoja entra con su estado (`estatCrmDeHoja()` en
`scripts/ara2026/nucli.ts`, misma tabla que el backfill): `prod_potencials` → `potencial`; `prod_inactius` y
`sda_inactius` → `inactiu`; `prod_actius` y `sda` → `en_desenvolupament`. Ninguna entra `actiu`, y la segunda pasada
no pisa el estado (`pegatRellenaHuecos` lo salta como `activo`).

## 6.2 Importador de entidades desde Excel en el panel (`20270511100000`, 06-11-2026)

**Para qué.** El super_admin da de alta actores en lote desde un Excel exportado de Airtable (o la plantilla
propia) sin pasar por un script. Lo pidió la Fundació con el fichero «Actores dar alta REDESTINA.xlsx» (una
hoja, 3 actores con NIF válido, sin la columna «Rol» rellena) y la nota de la Taula mestra 1.1: «importar con
organización inactiva, buscar por NIF; ¿y sin NIF? ¿por nombre? 1 convenio».

**Reparto.** El navegador lee y normaliza; la base decide. Nada de lo que manda el cliente se da por bueno:
`importar_entitats` recalcula la identidad de cada fila (contrato y códigos en `context/04bis-…md`).
- `src/lib/fitxerImportacio.ts`: `.xlsx` con `read-excel-file/browser` (todas las hojas; se elige una),
  `.csv` con `;` o `,`, BOM y Windows-1252 si no es UTF-8; tope 5 MB; `.xls` se rechaza con su mensaje.
  Las dos librerías van por `import()` en chunks aparte (≈58 + 61 kB + `fflate` 15 kB): **no** se usa
  `exceljs` (≈1 MB y un aviso moderado de `uuid`) ni `xlsx` de npm (abandonada, con CVE).
- `src/lib/normalitzaImport.ts`: hoja pura con los normalizadores que antes vivían en
  `scripts/ara2026/nucli.ts` (`normalitzaCapcalera`, `normalitzaNom`, `similitud`, `extraerTelefonos`,
  `extraerCorreos`, `claveMunicipi`, `parseCsv`); `nucli.ts` los importa y reexporta, sin copias.
- `src/lib/importEntitats.ts`: `COLUMNES_PLANTILLA` (30 columnas: clave del contrato, cabecera en catalán,
  alias en castellano, de Airtable y del ARA, obligatoria, si va a la plantilla, formato texto, lista y
  ejemplo), `localitzaCapcalera` (tolera filas de título encima), `mapaCapcaleres` (reconocidas, ignoradas
  —`desconeguda` · `a_proposit` · `repetida`— y obligatorias que faltan; cabeceras repetidas por
  ocurrencia: los dos «Cargo» del Excel de Airtable), `llegeixFulla` (salta filas vacías, la fila «EXEMPLE —»
  de la plantilla y las filas con datos solo en columnas sin cabecera), `normalitzaFila`, `proposaRols`,
  `filesPerEnviar`, `sha256Hex`, `csvInforme` (con protección de fórmulas, molde `cella()` de `csv182`).
- `src/lib/plantillaEntitats.ts`: la plantilla con `write-excel-file`: «Entitats» (cabeceras en catalán, fila
  «EXEMPLE — esborra aquesta fila» y 300 filas en formato texto `@` en NIF, CP, teléfonos e ID Airtable),
  «Instruccions» y «Llistes» (Rol, Tipus de receptor, Forma jurídica, Tipus d'activitat, Modalitats, Comarca
  —de `municipios`— y, desde B2, Municipi). La plantilla descargada se reconoce entera al subirla (lo vigilan
  `tests/importEntitats.test.ts` y el E2E).
- **Desplegables (Plan 2 B2, 10-11-2026; decisión D9).** Antes no había (06-11: «`write-excel-file` no hace
  validación de datos»). Ahora, en la primera hoja, **Rol, Forma jurídica, Tipus de receptor, Tipus d'activitat,
  Modalitats d'interès y Municipi** llevan un desplegable que apunta a su columna de «Llistes»
  (`Llistes!$G$2:$G$948` para los 947 municipios: un rango, no texto literal, así que no hay tope de 255
  caracteres). **Comarca no** (D9: la deduce el municipio y, si contradice, manda el municipio). Cómo:
  - `src/lib/excelValidacions.ts` (puro, `tests/excelValidacions.test.ts`): `xmlValidacions()` construye
    `<dataValidations count="n">` con un `<dataValidation type="list" …>` por columna, e `insereixValidacions()`
    lo coloca **detrás de `</sheetData>` y delante del primer elemento que el esquema OOXML (`CT_Worksheet`)
    pone después** (`hyperlinks`, `printOptions`, `pageMargins`, `pageSetup`, `headerFooter`, `drawing`,
    `tableParts`, `extLst`…), o antes de `</worksheet>` si no hay ninguno; falla si la hoja ya trae
    validaciones. `featureValidacions()` lo envuelve como «feature» de `write-excel-file` 4.1.1 (transforma
    `xl/worksheets/sheet{id}.xml` solo para la hoja indicada). Se descartó el plan B
    (`@onparallel/write-excel-file-data-validation`): no hizo falta.
  - `plantillaEntitats.ts`: `validacionsPlantilla(ctx)` (qué columnas y con qué rango; una lista vacía se queda
    sin desplegable), `featurePlantilla(ctx)`, `fullesPlantilla(ctx)` (las hojas, iguales para `/browser` y
    `/node`), `SENSE_DESPLEGABLE = ['comarca']`, `LLISTES_MULTIPLES = ['tipus_activitat','modalitats']` y
    `FILES_AMB_DESPLEGABLE` = filas 2–302 (la de ejemplo y las 300 preparadas en formato texto).
    `ContextPlantilla` gana `municipis`; `ImportaEntitats` los pasa con `nomLlegible` («l'Ametlla del Vallès»,
    que `municipi_de_text()` reconoce) **ordenados por el nombre oficial** («Ametlla del Vallès, l'»), para que
    salgan en la A y no en la L.
  - **Avisa, no bloquea** (decisión de la sesión B2): `errorStyle="warning"`. En las listas de un valor,
    escribir algo de fuera abre «Valor fora de la llista» (`ie.dv_titol`/`ie.dv_avis`, en el idioma de la
    interfaz) con «Sí / No»: el lector acepta variantes que la lista no tiene (el otro idioma, sin acentos,
    mayúsculas), y la Revisió ya avisa de lo que no reconoce. En las de varios valores separados por coma
    (actividad, modalidades), `showErrorMessage="0"`: el desplegable solo ayuda. `showDropDown` no se escribe
    (con `1`, Excel **esconde** la flecha).
  - **Probado (10-11-2026)**: XML bien formado (`xmllint` en todas las partes del .xlsx, ca y es); orden de
    hijos de `worksheet` = `sheetViews · cols · sheetData · dataValidations`. **Excel para Mac**: abre sin
    reparar; desplegables en Rol y Municipi (los 947), aviso con Sí/No en Forma jurídica, sin aviso al escribir
    dos actividades, Comarca sin flecha. **Numbers**: abre sin avisos y convierte cada lista en menú emergente,
    **pero corta los menús a 250 elementos** (el de Municipi acaba en «el Palau d'Anglesola»): limitación de
    Numbers, no del fichero; quien use Numbers escribe el municipio a mano y el importador lo reconoce igual.
    **LibreOffice**: no está instalado en la máquina de desarrollo; sin probar.
  - Pruebas: `tests/excelValidacions.test.ts` (letras de columna, rango con comillas, atributos, inserción
    con y sin `pageMargins`/`drawing`, `sheetData` vacía, la feature solo toca su hoja) e
    `importEntitats.test.ts` («la plantilla, como fichero .xlsx de verdad»: lo genera `write-excel-file/node`,
    lo abre con `fflate` y comprueba un solo `<dataValidations>` con su `count`, orden, `sqref` 2–302, ninguno
    en Comarca ni en las otras hojas, y que `read-excel-file` lo sigue leyendo entero). El E2E
    `importa-entitats.e2e.ts` comprueba lo mismo en la plantilla que descarga el navegador, con los municipios
    del clon.

**Reglas de mapeo** (en `normalitzaFila`):
- **Papeles**: manda la columna «Rol» (Ofertant · Receptor · Tots dos, y sus equivalentes en castellano). Sin
  ella: «Entidad social» → receptor `social`; «Productor individual» o un «Registro excedente» → ofertant; un
  tipo de receptor → receptor. Si nada lo dice, la fila queda **sin papel** y no se puede importar hasta
  elegirlo en la revisión. «Tipo de entidad» no es el papel: va a la nota como «Tipus d'entitat (origen)».
- **Teléfonos**: se juntan los de todas las columnas (`Mòbil (WhatsApp)`, `Telèfon fix` y sus alias), cada
  trozo de una celda («937… / 629…») por separado, a E.164 con `normalitzaTelefon`; **los móviles delante**
  (el primero es el de WhatsApp); el 1.º a `telefon`, el 2.º a `telefon2`, el resto a la nota; lo que no se
  reconoce, a la nota como «no reconegut». Correos igual («contacto: x@…» se extrae).
- **CP** con ceros a la izquierda (8380 → 08380). «No disponible», «No localizada», «-» = vacío.
- **Forma jurídica** → `tipus_empresa` (`autonom`, `sl`, `sa`, `cooperativa`, `sat`, `sc`, `fundacio`, `associacio`); lo
  que no casa, `altres` y el texto original a la nota. `sat` (S.A.T., «societat agrària de transformació») se
  mira antes que `sa` y la cooperativa (SCCL) antes que `sc` (SC, SCP, «societat civil»), porque las siglas
  se solapan (09-11-2026).
- **Actividad**: lo que casa con el catálogo `tipus_activitat` (código o nombre ca/es) **y vale para el
  papel de la fila** (`aplica`) va a la ficha; el resto, a la nota. («Explotación agrícola» es del catálogo
  de receptores: a un ofertant le va a la nota.)
- **Nombre**: el comercial; si falta, «Entidad» o la razón social, con aviso. «Entidad» distinta del
  comercial, cargos, web, trabajadores, responsable interno, observaciones, «Registro excedente» y el
  convenio firmado (fecha y firmante) van a la nota, línea a línea («Etiqueta: valor»).
- **Ignoradas a propósito**: «Contactos» (registros enlazados de Airtable: otras organizaciones),
  «Provincia» y «Provincia (from Municipio)» (se derivan del municipio).

**Pantalla** `/equip/entitats/importa` (`ImportaEntitats.tsx`; botón «Importa des d'Excel» en Entitats, solo
super_admin; el resto ve un aviso): Fitxer (plantilla siempre a mano, columnas reconocidas, ignoradas y que
faltan; aviso si el `sha256` ya se importó) → Revisió (`previsualitzar_importacio_entitats`; badge por fila,
casillas de papel que vuelven a previsualizar —300 ms, respuestas tardías descartadas—, qué rellenará,
conflictos y avisos, y en las `dubtosa` un `Desplegable` crear nova / és «X» / ometre; filtros por estado;
«Importa N files» bloqueado con filas sin papel; confirmación) → Resultat (cifras, enlace a cada ficha,
avisos y errores, enlace a Documentació si la fila trae convenio, informe CSV). El convenio **no se declara
en el lote** (`declarar_conveni` emite PDF, consume número y exige NIF y dirección): se hace desde la ficha.

**Medido con el Excel recibido, en el clon (06-11-2026)**: 20 columnas reconocidas y 3 ignoradas; las 3 filas
salen `existent` por NIF (ya estaban del ARA, inactivas) y solo rellenan huecos (correo, razón social, CP,
teléfono secundario…; los nombres distintos quedan como conflicto, no se pisan). Segunda importación del
mismo fichero: 3 `sense_canvis` y aviso de «ja importat». En producción las 3 serían nuevas (el ARA se borró).

**Cómo debe ser el Excel** para la Fundació: `3. Claude Code/2026-11-06-importador-entitats.md` en Drive.

**Estado CRM (Plan 2 B1, `20270518100000`)**: las fichas que crea el importador del panel nacen **`potencial`**
(`alta_fitxa_interna(p_activo = false)` → el trigger de alta deriva `potencial`). Una ficha existente no cambia de
estado al reimportar.


## 6.3 Exportación de entidades a Excel con el formato de la plantilla (Plan 2 B3, `20270518110000`, 10-11-2026)

**Para qué** (Teams de Sebas, 09-11; D10): sacar las entidades a Excel, completarlas fuera y volver a subirlas
con el importador. La lanza **todo el equipo** (también `tecnic`) desde Entitats › «Exporta a Excel»; importar
sigue siendo del super_admin. Exporta las filas **visibles** con los filtros y la búsqueda.

**Base — `exportar_entitats(p_ids uuid[] default null)`** (T6: RPC y no ampliar `v_entitats_llistat`, que solo
admite columnas al final y no necesita estos datos para pintar). `security definer`, guarda
`if auth.uid() is not null and not es_intern() then 42501`; `revoke … from public, anon`, `grant … to
authenticated, service_role`. Una fila por organización con alguna ficha, en **códigos** y ordenada por nombre.
Los valores están elegidos para que **reimportar no cambie nada** (`importacio_aplica_fila` da `sense_canvis`
si no rellena ningún hueco ni añade nota):
- Campos que existen en las dos fichas: del ofertant primero, si no de la receptora (una diferencia entre las
  dos fichas es un conflicto al reimportar, y un conflicto no cambia nada).
- `persona_contacte`: el `name` del productor **no** cuenta si es igual que `empresa` (es el valor por defecto
  del alta, y `importacio_aplica_fila` lo trata como hueco: exportarlo lo «rellenaría»).
- `municipi`: `nom_municipi_llegible()` («l'Ametlla del Vallès», que `municipi_de_text` reconoce); sin
  `municipio_ine`, la `ubicacio` (que la reimportación vuelve a dejar en `ubicacio`) o la `poblacion`.
- `tipus_activitat`: la unión de las dos fichas en el orden del catálogo.
- `airtable_id`: lo que sigue a `AIRTABLE:` en `ref_externa`.
- **`data_alta` en texto**: `productores.data_alta` es `date`, pero `entidades.data_alta` es texto heredado del
  Excel (en el clon, 69 filas con solo el año, «2021»). Sale `least()` de las dos como texto (un año suelto queda
  antes que cualquier fecha de ese año o posterior).

**Navegador — `src/lib/exportEntitats.ts`** (puro salvo `blobExportacio`, `import()` dinámico de
`write-excel-file`):
- Hoja «Entitats»: **las 25 columnas de la plantilla, en su orden** (`COLUMNES_DE_PLANTILLA`), con los valores en
  el idioma de la interfaz (como «Llistes»: el lector entiende los dos) y **detrás cuatro informativas**
  (`CAPCALERES_EXPORTACIO` en `importEntitats.ts`): «ID Redestina» (texto `@`), «Data d'alta a l'organització»
  (una fecha `AAAA-MM-DD` va como fecha de Excel `dd/mm/yyyy`, construida en UTC para que no se corra un día;
  lo demás, texto), «Estat CRM (ofertant)» y «Estat CRM (receptor)» (en palabras). Van **detrás** para que A–Y
  sean las de la plantilla y los desplegables caigan en las mismas columnas. Después de los datos, 100 filas
  vacías con formato texto (`FILES_BUIDES`) para añadir entidades.
- **Columnas de nota vacías** (Càrrec, Web, Nombre de treballadors, Responsable intern, Conveni signat (data),
  Signant del conveni, Observacions): reimportarlas añadiría el texto otra vez al comentario
  (`importacio_bloc_nota`), y la nota de la ficha mezcla todo lo importado.
- **Solo códigos conocidos**: una forma jurídica heredada que no es código (en el clon, productores con
  `tipo_empresa = 'Explotació hortícola'`), una actividad fuera del catálogo o una modalidad desconocida **no
  salen**; exportadas, la reimportación las mandaría a «Altres» + nota. Un ofertant sin papel de receptor no
  saca tipo de receptor ni modalidades.
- «Llistes» idéntica a la plantilla; «Instruccions» propia (título, cómo completarla y volver a subirla, notas
  vacías, los puntos 3 y 4 de la plantilla, y las cuatro informativas) y la tabla de columnas de la plantilla más
  una fila por informativa.
- Desplegables: los **mismos de B2** (`validacionsPlantilla` + `featureValidacions`), en las filas con datos y en
  las vacías (`filesAmbDesplegable(n)`: 2 … 1 + n + 100).
- Las cuatro informativas están en `IGNORADES_A_PROPOSIT`: al reimportar salen en «Columnes que no s'importen»
  como **ignoradas a propósito**, no como desconocidas. **B4** convertirá «ID Redestina» y «Data d'alta» en
  columnas de `COLUMNES_PLANTILLA` (y las quitará de esa lista); «Estat CRM» no se importa nunca (P9).

**Contrato garantizado** (`tests/exportEntitats.test.ts`, 15 pruebas): una fila exportada, leída con
`llegeixFulla` + `normalitzaFila`, da exactamente la fila del contrato de la ficha, **sin avisos ni nota**, en
memoria y como `.xlsx` real (escrito con `write-excel-file/node`, leído con `read-excel-file/node`), en catalán y
en castellano; la fecha vuelve como fecha; las 25 columnas se reconocen y las 4 se ignoran a propósito.

**E2E** (`importa-entitats.e2e.ts`, tras las pruebas del importador): la cuenta `equip` (un `tecnic`) busca
`TEST-IMP`, filtra «Potencial», exporta 4 filas (cabeceras, ID de cada organización, notas vacías, 6
desplegables); el super_admin sube ese fichero tal cual: 25 reconocidas, 4 ignoradas, las 4 filas `existent` y
**4 `sense_canvis`**, y las fichas quedan idénticas byte a byte (`md5` de `row_to_json`).

**Límites conocidos** (B4 resolvió los dos primeros que había aquí: ver §6.4):
- **Más de 1.000 filas**: el importador acepta 1.000 por fichero; la pantalla avisa al exportar (deuda 173).
- Desde B4 la exportación **solo saca valores que el importador acepta** (NIF válido, correo con forma de correo,
  teléfono de 9–15 cifras, CP de 5 cifras, `data_alta` año o fecha): lo demás saldría y, reimportado, iría a la nota.

## 6.4 La importación ACTUALIZA, «ID Redestina» y las dos fechas de alta (Plan 2 B4, `20270519100000`, 10-11-2026)

**Para qué** (D11, Carles, no negociable): la importación es **idempotente** y **actualiza**. Mismo NIF o mismo
«ID Redestina» → actualiza esa organización, **nunca crea otra**; **celda vacía = no toca**; **celda con valor
distinto = sobrescribe**; reimportar el mismo fichero (o lo exportado) = todo `sense_canvis`; la Revisió enseña los
cambios campo a campo antes de confirmar. Hasta B4 (§6.2) un valor distinto era un «conflicte» que no se aplicaba.

**Base** (todo interno salvo las dos RPC de siempre, que no cambian de firma):
- `importacions_entitats_files.canvis jsonb` — `[{taula, columna, camp, abans, despres}]`, con el valor anterior
  (deshacer a mano es posible). `conflictes` se queda, siempre `[]`, por el contrato del frontend publicado.
- **`entitat_valors_org(p productores, e entidades)`**: lo que vale la organización (ofertant primero, receptora
  después, `name` por defecto no cuenta, unión de actividades, `least` de las fechas…). **`exportar_entitats()` se
  recrea encima** (misma `returns table`): una sola definición para exportar y para comparar. Solo saca valores que
  el importador acepta (`importacio_si_correu`, `importacio_si_telefon`, NIF válido, CP, fecha).
- **`importacio_compara(p_taula, p_actual, p_desitjat, p_protegits)`** (antes 3 argumentos): celda vacía → nada;
  columna **protegida** → nada; hueco → rellena; distinto → **sobrescribe**. Cada escritura va a `patch`,
  `omplira` y `canvis`. `productores.data_alta` (date) con solo el año → `AAAA-01-01`.
- **Protegidas (P-B4-2)**: las celdas cuyo valor es igual a lo que vale la organización. **No pisan ni rellenan
  ninguna de sus fichas.** Es lo que hace que exportar → reimportar no cambie nada aunque las dos fichas de una
  organización de doble rol difieran (en el clon hay 5: p. ej. una con nombre y teléfono distintos en cada papel);
  un valor nuevo en la celda sí se escribe en las dos fichas. Los dos teléfonos se comparan **como conjunto** (el
  lector pone el móvil delante: una ficha con el fijo primero vuelve cruzada y no cambia nada). Consecuencia: si la
  ofertant tiene correo y la receptora no, una fila con ese correo **no** rellena la receptora (antes sí): para
  dejar valores distintos por papel, o completar uno, la ficha.
- `importacio_normalitza_fila`: `redestina_id` (no-uuid → error `id_redestina_invalid`) y `data_alta`
  (`AAAA-MM-DD`, `D/M/AAAA` con `/`, `-` o `.`, o **solo el año**; entre 1900 y hoy; si no → aviso
  `data_alta_invalida` y línea de nota).
- `importacio_igual('data_alta', actual, fichero)` es **asimétrica**: si el fichero trae solo el año, iguala por año
  («2021» = 05/03/2021: no se pisa una fecha precisa con una aproximada); si trae fecha, compara la fecha entera.
- `importacio_aplica_fila`: correo/teléfono únicos de `productores` se comprueban también al **sobrescribir**
  (`correu_en_us`/`telefon_en_us` + nota); si cambia `empresa` y `name` era el valor por defecto, le sigue; si cambia
  el municipio sin comarca en el fichero, la comarca que pondrá el trigger va a `canvis`; la nota añadida, también
  (`camp: 'nota'`). Al añadir un papel, la fecha de alta sale de la ficha hermana si el fichero no trae.
- `importacio_processa`: identidad **0 · ID Redestina** (organización con alguna ficha) → 1 · NIF → 2 · `AIRTABLE:`
  → 3 · hash `IMP:`. Errores de fila: `id_redestina_inexistent` (no se cae al NIF ni crea: vaciar la celda para
  crear) e `id_nif_contradictoris` (P-B4-3/4). `identificada_per = 'id'`. Con ID, el nombre (hash) y el Airtable no
  hacen repetida la fila (dos organizaciones pueden llamarse igual en el mismo municipio).
- El NIF también se sobrescribe si la fila llegó por ID/Airtable y trae otro NIF válido que nadie tiene (D11 manda;
  se ve en «Canviarà»). Nunca: `activo`, `estat_crm`, `es_test`, `ref_externa`; el comentario solo crece.
- `alta_fitxa_interna`: `data_alta` en los dos `insert` (sin ella, el trigger pone hoy).

**Las dos fechas** (reunión 09-11): `data_alta` = **«Data d'alta a l'organització»** (cuándo entró en la red de la
Fundació; editable por el equipo y por el importador); `created_at` = **«Alta a la plataforma»** (solo lectura, en
Gestió interna). Las dos, solo equipo (P-B4-5). `entidades.data_alta` sigue siendo texto (año suelto heredado del ARA).

**Navegador**: «ID Redestina» y «Data d'alta a l'organització» son columnas de `COLUMNES_PLANTILLA` (Z y AA, las
mismas letras que ya usaba la exportación; la plantilla las lleva vacías); fuera de `IGNORADES_A_PROPOSIT` (quedan
las dos «Estat CRM», P9). `valorData()`: `Date` → ISO; entero 1900–2100 → año; otro entero → serial de Excel.
Revisió: bloque **«Canviarà»** por fila (agrupado: una organización de doble rol da el cambio una vez), contador
«Actualitzarà N fitxes», confirmación «el que porti valor sobreescriu; una cel·la buida no toca res».

**Verificado en el clon**: exportar las 731 organizaciones → `previsualitzar_importacio_entitats` = **731
`sense_canvis`** (antes del ajuste salían 83 rellenos de huecos y notas por teléfonos y NIF inválidos, y 13
«repetides» por nombre); pruebas de reglas con `rollback` (teléfono nuevo, NIF existente con otro nombre →
actualiza, ID sin NIF, los tres errores, doble rol → las dos fichas, año → 01/01 en el ofertant, reimportar →
`sense_canvis`). Arnés y E2E: §13 de AGENTS.md.
