# AGENTS.md §2bis — 2bis. Sistema de diseño (10-09-2026)

> Detalle de la sección 2bis de `AGENTS.md` (partido el 02-11-2026 para que el canónico quepa en el contexto).
> `AGENTS.md` conserva lo vigente en forma compacta; aquí está la referencia completa, con su historia.
> Se lee bajo demanda, cuando una tarea toca esta parte. Las citas «AGENTS.md §2bis» del código apuntan aquí.

## 2bis. Sistema de diseño (10-09-2026)

La imagen de REDESTINA (branding de agosto de 2026: `BRANDING_REDESTINA_FINAL.ai`) está implantada
como **sistema de diseño que el código consume**. Tres piezas, en `design/`:

| Fichero | Qué es | Manda en |
|---|---|---|
| `design/tokens.json` | **Fuente única** de colores (marca, neutros cálidos, estados, gráficos, mapa a shadcn, extensión), tipografías y jerarquía, espaciado, radios, sombras, puntos de corte y reglas del logo. Cada valor lleva `origen: branding` (del diseñador) o `derivado` (definido por la consultoría). | Los valores. |
| `design/DESIGN.md` | Reglas que un token no captura: cuándo se usa cada variante del logo y su zona de respeto, jerarquía tipográfica, tono de los mensajes y patrones de componentes (botón, tarjeta, badge, tabla, formulario, vacío, alertas, sidebar, barra móvil, diálogo, portada). | El uso. |
| `design/preview.html` | Página autónoma con todos los componentes pintados con los tokens. Se abre en el navegador; no forma parte del build. Sirve para validar antes de tocar la aplicación. | La muestra. |

`design/PLAN.md` es el plan con el que se implantó; queda como histórico.

**Reglas para el código:**

- **Todo estilo sale de los tokens.** No se escribe ningún hex, ningún `text-[13px]`, ningún color
  de la paleta genérica de Tailwind (`bg-green-100`, `text-red-700`, `bg-blue-*`…). Se usan las
  clases que salen de `src/index.css`: las de shadcn (`bg-primary`, `text-muted-foreground`,
  `border-input`, `bg-sidebar-accent`…) y las de la **extensión REDESTINA**: `coral`,
  `coral-foreground`, `coral-oscuro`, `coral-suave`, `coral-texto`, `verde-claro`, `verde-oscuro`,
  `exito` / `exito-fondo`, `aviso` / `aviso-fondo`, `error` / `error-fondo`, `chart-1…5`, y la fuente
  `font-titulos` (Sora). Los estados se pintan con `bg-exito-fondo text-exito`,
  `bg-aviso-fondo text-aviso`, `bg-error-fondo text-error`; lo neutro-informativo con
  `bg-secondary text-secondary-foreground`.
- **`text-nav` (0.6875rem / 11 px) es el único tamaño por debajo de `xs`**, y existe para una sola
  cosa: las etiquetas de la barra inferior de móvil. Son largas a propósito —`nav.ts` las eligió
  únicas entre paneles para que los tooltips del menú plegado no se repitan—, así que a `xs`
  (0.75rem) rompen a dos líneas en una celda de ~85 px y desalinean las pestañas. Antes era un
  `text-[11px]` a pelo, que contradecía la regla de arriba; el valor es el mismo, pero ahora sale
  de `tipografia.escala.nav` en `design/tokens.json`. No usarlo en texto que haya que leer.
- **`accent` de shadcn NO es el coral.** Es la superficie de hover de menús, selects y botones
  ghost (crema oscurecido). El coral es acento de marca y vive en `coral`; solo da 2.67:1 sobre
  blanco: nunca texto pequeño en coral ni texto blanco sobre coral (encima va negro,
  `coral-foreground`; para texto coral, `coral-texto`).
- **El error es rojo (`error` / `destructive`), no coral.** El coral no significa fallo.
- **Los títulos van en Sora solos**: `@layer base` pone `font-titulos` en `h1`–`h4`. No hace falta
  pedirlo en cada pantalla; para un título que no es un `h*`, la clase `font-titulos`.
- **Los nombres de shadcn no se renombran** (`primary`, `secondary`, `muted`, `accent`,
  `destructive`, `sidebar-*`, `chart-*`): son el contrato con `src/components/ui/`.
- **`src/index.css` se deriva de `tokens.json` a mano** (no hay generador). **Para cambiar un
  color**: se cambia el valor en `design/tokens.json`, se replica en `:root` de `src/index.css`
  (y en `@theme inline` si es un token nuevo), se comprueba `design/preview.html` y, si el color
  también aparece en los correos, en las constantes de `supabase/functions/_shared/resend.ts`
  (§9) y en `theme_color` / `background_color` de `vite.config.ts` e `index.html`. Nunca al revés.
- **Logo** (SVG con las letras en trazados, no dependen de la fuente), en `public/`:
  `logo-redestina.svg` (horizontal, por defecto, sobre crema o blanco),
  `logo-redestina-apilado.svg` (espacios cuadrados), `logo-redestina-negativo.svg` (**sobre verde o
  fondos oscuros**: sidebar, pie de la landing, pantallas de acceso; la barra superior de la
  landing es clara y lleva el logo en color),
  `logo-redestina-mono.svg` (un color, `currentColor`), `isotipo-redestina.svg` (solo la hoja:
  favicon, iconos PWA, avatares) e `isotipo-redestina-mono.svg`. Y **`segell-redestina.svg`** (+
  `-mono`), el sello del certificado de recepción, que reutiliza los dos trazados exactos del
  isotipo dentro de un doble anillo. 🔴 **Va SIN una sola palabra dentro, a propósito**: se sirve
  desde la web de un tercero, donde Sora no está cargada —por eso el logo lleva las letras en
  trazados— y la aplicación es bilingüe, así que un «Certificat de recepció» grabado dentro se
  quedaría en catalán para siempre en la web de quien lo pegó. El texto va en el `alt`, que sí se
  traduce. **`logo-email.png` es el logo EN
  COLOR** —el principal— rasterizado a 410×120 con transparencia, y por eso **la cabecera de los
  correos es clara** (§9bis). Nada de `brightness-0 invert` ni
  filtros sobre el logo: se elige la variante. Zona de respeto, tamaños mínimos y prohibiciones en
  `design/DESIGN.md §4`.
- 🔴 **Desplegables: `components/Desplegable`, nunca un `<select>` nativo** (03-11-2026). Carles
  vio los filtros de «Entitats» con el `<select>` del sistema —borde azul, flecha propia, alto
  distinto por navegador— y lo encontró feo. `Desplegable` envuelve el `Select` de shadcn con la
  API del nativo (`value`/`onChange(string)`, o `defaultValue` + `name` en un formulario leído con
  `FormData`), `buit` para la opción vacía elegible («Tots») —Radix no admite un ítem con valor
  `''`, va con un centinela que no sale del componente— y `placeholder` para la que no se puede
  elegir («— Tria —»); se abre debajo (`position="popper"`). Las E2E eligen con `tria()` y leen
  las opciones con `opcionsDe()` (`tests/e2e/ajuda.ts`), por el `data-valor` de cada opción.
  Historia: hasta el 22-09-2026 el `SelectTrigger` de shadcn **no** traía `text-base md:text-sm`
  (iOS amplía la página al enfocar un control de menos de 16 px) y nacía `w-fit` con
  `whitespace-nowrap` (en `/registre` desbordaba su celda); se repetía a mano en cada uso. Desde
  el 03-11-2026 la base `ui/select.tsx` trae el tamaño de texto y `Desplegable` el `w-full min-w-0`.
- **Controles compactos** (03-11-2026, «todo es demasiado grande»): `ui/input` y el trigger de
  `ui/select` miden 32 px en escritorio y 40 en móvil (`sm`: 28/36); `ui/button` `default` 32/40,
  `sm` 28/36, `lg` 36/44, iconos 32/40; `ui/card` padding 20 px. Las alturas a mano `md:h-9` de
  todo `src/` pasaron a `md:h-8` en el mismo cambio; las de móvil (`h-11`, 44 px de dedo) se quedan.
- 🔴 **`{n}` está reservado para CONTADORES** (22-09-2026). Es el parámetro que dispara la
  variante `<clau>_1` del singular (§7), así que usarlo para un número de documento —
  `t('seg.alt_num', { n: 'CR-2026-0001' })`— hace que cualquiera que audite singulares vea esa
  clave como «le falta el `_1`». Para lo que no se cuenta, `{num}`. No era alcanzable
  (`Number('CR-2026-0001')` es `NaN`), pero ahora `n` significa **una sola cosa** en todo el
  diccionario, y `tests/i18n.test.ts` protege la paridad de marcadores.
- 🔴 **Ningún control de formulario se estila a mano** (16-09-2026). Casilla →
  `components/Casella` (`Casella` suelta, `FilaCasella` con etiqueta y 44 px de fila);
  campo → `ui/input`; desplegable → `components/Desplegable`.
  Salió de que el cliente viera **dos casillas de tamaños distintos en la misma pantalla**:
  había tres apariencias en la aplicación y una era el control por defecto del navegador.
  ⚠️ El fallo que lo explica: **`size-5` no basta dentro de un flex** —fija el tamaño
  preferido, no el mínimo—, así que una casilla junto a una etiqueta larga se deja aplastar
  por ella. Lo que lo arregla es `shrink-0`, y por eso vive en el componente. `design/DESIGN.md §6bis`.
- 🔴 **Un badge sobre fondo de color es un chip BLANCO con el texto en color** —`coral-texto`
  si avisa, `verde-oscuro` si informa; ante la duda, coral—. Nunca texto suelto: el contador
  del menú lateral era `text-sidebar-foreground` sin fondo sobre el verde del `sidebar`, o
  sea invisible. Y **el color no cambia al pasar por encima ni con la entrada activa**, que
  es lo que lo hacía desaparecer justo en la sección en la que estabas. `design/DESIGN.md §6ter`.
- **Fuentes**: Sora (500/600/700/800) e Inter (400/500/600/700), libres (OFL), desde Google Fonts
  en `index.html`. No hay fuentes propias en el repo.
- Modo oscuro: no existe en el branding y no se implementa (`@custom-variant dark` se queda sin valores).

