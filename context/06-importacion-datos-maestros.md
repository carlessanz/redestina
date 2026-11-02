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

