# Sistema de diseño REDESTINA

Reglas de uso de la identidad en la aplicación. Complementa a `design/tokens.json`, que es la única fuente de valores (colores, tipografías, escalas, radios, sombras). Este documento recoge lo que un token no captura: cuándo se usa cada cosa y cómo se combinan.

Fuente: `1. Fuentes/Diseño/BRANDING_REDESTINA_FINAL.ai` (25-08-2026), una hoja de identidad con dos versiones del logo, cuatro colores y un espécimen tipográfico. Todo lo que va más allá (neutros, estados, escalas, variantes del logo) está marcado como derivado en `tokens.json` y puede revisarse con el diseñador.

## 1. Cómo se consume

- **Nadie escribe un color, un tamaño de fuente ni un radio a mano.** Se usan las clases de Tailwind que salen de `src/index.css` (`bg-primary`, `text-muted-foreground`, `border-input`, `rounded-lg`, `font-titulos`…) o las variables CSS (`var(--primary)`).
- `src/index.css` es la traducción de `tokens.json` a variables `:root` y `@theme inline`. Si hay que cambiar un color, se cambia en `tokens.json` **y** en `src/index.css` (el paso de generación es manual por ahora; ver `AGENTS.md`).
- Los nombres de shadcn (`primary`, `secondary`, `muted`, `accent`, `destructive`, `sidebar-*`) no se renombran: son el contrato con los componentes de `src/components/ui/`.
- Los tokens propios se exponen con su nombre en castellano: `coral`, `coral-suave`, `coral-texto`, `verde-claro`, `verde-oscuro`, `exito`, `exito-fondo`, `aviso`, `aviso-fondo`, `error`, `error-fondo`.

## 2. Color

| Papel | Token | Regla |
|---|---|---|
| Fondo de la app | `background` (crema) | La aplicación es crema, no blanca. Las superficies elevadas (tarjetas, popovers, inputs) son blancas: ese contraste crema/blanco es la jerarquía principal, más que la sombra. |
| Acción principal | `primary` (verde) con `primary-foreground` (crema) | Un solo botón primario por vista. Hover: `verde-oscuro`. |
| Acción secundaria | `secondary` (verde suave) con texto verde | Acciones de apoyo y badges de estado neutro. |
| Hover de menús y ghost | `accent` (crema oscurecido) | Es lo que shadcn usa en dropdowns, selects, comandos y botones ghost/outline. **No es el coral.** |
| Acento de marca | `coral` | Detalles que deben llamar la atención sin ser acción: indicador de elemento activo, contadores, iconos de destacado, sección «RE» de la portada, anillo de foco del sidebar. Contraste 2.67:1 sobre blanco: **nunca texto pequeño en coral, nunca texto blanco sobre coral.** Si hace falta texto coral, `coral-texto`. |
| Texto | `foreground` (negro tipográfico `#1d1d1b`), `muted-foreground` (verde gris) | Nunca gris frío. Los secundarios son verde gris. |
| Bordes | `border` (separadores), `input` (controles) | Cálidos, derivados del crema. |
| Estados | `exito`, `aviso`, `error`, `info` (texto + fondo) | El **error es rojo, no coral**, para que el coral siga siendo marca. `destructive` de shadcn apunta a ese rojo. |
| Sidebar | `sidebar-*` | Verde `#4e6b45` con texto crema; activo en crema sobre verde; hover en verde aclarado; foco en coral. Logo en negativo. |
| Gráficos | `chart-1` … `chart-5` | Verde, coral, verde claro, ámbar, verde oscuro, en ese orden. |

Contrastes verificados (WCAG AA texto normal ≥ 4.5:1): verde sobre blanco 5.98, verde sobre crema 5.31, crema sobre verde 5.31, negro sobre coral 6.33, verde gris sobre crema 4.99, blanco sobre `sidebar-accent` 4.82. Fallan y por eso están restringidos: coral sobre blanco 2.67, verde claro sobre blanco 3.2 (solo texto ≥ 24 px, bordes y fondos).

## 3. Tipografía

Dos familias, las dos libres (OFL) y cargadas desde Google Fonts:

- **Sora** para todo lo que titula: `display`, `h1`, `h2`, `h3`, `subtitulo`, `sobrelinea`. Pesos 800 (títulos de página y portada, como en el logo y el espécimen), 600 (secciones, tarjetas, diálogos) y 500 (subtítulos, el claim «Xarxa de solucions…»).
- **Inter** para todo lo que se lee: cuerpo, formularios, tablas, botones, etiquetas. Pesos 400, 500 (labels y botones) y 600 (énfasis puntual).

Reglas:

- Un `h1` por vista, en Sora 800 `2xl`, tracking `-0.01em`. Los títulos grandes se aprietan un poco (`-0.01em` / `-0.02em`); el cuerpo no se toca.
- «REDESTINA» en mayúsculas solo cuando es la marca; en texto corrido, «Redestina».
- No se usa Sora para párrafos ni Inter para títulos. Si un componente de shadcn trae `font-semibold` en un título, es Sora vía la clase `font-titulos`.
- Tamaños: la escala de `tokens.json` (`xs` a `4xl`). Ningún `text-[13px]`.
- Interlineado del cuerpo 1.5; de los títulos, el de la escala (más prieto).

## 4. Logo

Archivos en `public/` (todos SVG con las letras convertidas a trazados; no dependen de la fuente):

| Archivo | Cuándo |
|---|---|
| `logo-redestina.svg` | Por defecto. Cabecera pública, emails, documentos PDF, pantalla de acceso en horizontal. Fondo crema o blanco. |
| `logo-redestina-apilado.svg` | Espacios cuadrados o estrechos: splash, tarjeta de presentación, portada en móvil. |
| `logo-redestina-negativo.svg` | Sobre verde o fondos oscuros: cabecera del sidebar, pie de página verde. |
| `logo-redestina-mono.svg` | Un solo color (`currentColor`): impresión en blanco y negro, marca de agua. |
| `isotipo-redestina.svg` | Solo la hoja: favicon, iconos PWA (`icona-*.png`, `apple-touch-icon.png`), avatar del sistema en la mensajería, botón de inicio en móvil. |
| `isotipo-redestina-mono.svg` | La hoja en `currentColor`. |
| `logo-email.png` | Versión rasterizada del horizontal para clientes de correo que no pintan SVG. Se regenera desde el SVG. |

Reglas:

- **Zona de respeto:** la altura de la «E» de «RE» por cada lado (≈ 0,3 × la altura del logo horizontal). Nada dentro.
- **Tamaño mínimo:** horizontal 24 px de alto, apilado 40 px, isotipo 16 px. Por debajo, isotipo.
- **Fondos:** crema o blanco para la versión en color; verde o negro para la negativa. Nunca sobre coral, nunca sobre fotografía sin caja.
- **Colores del logo:** verde `#4e6b45`, nervio `#3e5139`, «RE» `#e56a5c` (un coral algo más oscuro que el de la paleta; se respeta tal cual). En la negativa, «RE» pasa al coral de paleta `#ef7d77` para ganar luminosidad sobre verde.
- **Prohibido:** recolorear, separar «RE» del isotipo, deformar, girar, añadir sombra o contorno, y escribir «REDESTINA» con la fuente del sistema donde debería ir el logo.
- El isotipo **sí** puede ir solo; la palabra «DESTINA» sola, no.

## 5. Tono de los mensajes

La aplicación habla en catalán a los usuarios y en castellano en el código y la documentación. Las reglas de voz se resumen así:

- Frases cortas, verbo al principio en botones («Publica el lot», «Confirma l'entrega»). Sin exclamaciones.
- Los estados vacíos explican qué es esa vista y ofrecen la acción que la llena; no se disculpan.
- Los errores dicen qué ha pasado y qué hacer, en una línea cada cosa. En rojo (`error`), nunca en coral.
- Los avisos de éxito son breves y desaparecen solos (toast); los que requieren acción se quedan (alerta).
- Vocabulario: «registro» y «lote» (nunca «excedente»), «alimentos fuera del circuito de venta habitual (AFCV)», «canalización», «dinamización».

## 6. Patrones de componentes

Los componentes son los de shadcn/ui en `src/components/ui/` (estilo new-york). No se modifican para aplicar la marca: cambian de piel por los tokens. Lo que sigue son las convenciones de uso.

**Botón.** `default` = verde (acción principal, una por vista). `secondary` = verde suave (apoyo). `outline` y `ghost` para acciones terciarias y barras de herramientas; su hover es `accent` (crema). `destructive` = rojo, siempre con confirmación. El coral **no** es una variante de botón; si hace falta un botón de marca en la parte pública (por ejemplo «Vull participar-hi»), es verde. Radio `md`, altura 36 px (`h-9`), texto Inter 500 `sm`.

**Tarjeta.** Blanca sobre crema, borde `border`, radio `xl`, padding `6`, sombra `sm` (o ninguna). Título en Sora 600 `xl`, descripción en `muted-foreground`. Las tarjetas de lote llevan el estado como badge arriba a la derecha y las cantidades en Sora 600.

**Badge / estado.** Píldora (`rounded-full`), texto `xs` 500. Colores por estado del catálogo: nuevo/pendiente `aviso`, disponible `exito`, en gestión `info` (verde suave), cerrado `muted`, devuelto/retirado `error`. Un badge coral solo para «destacado» o «nuevo hoy».

**Tabla.** Cabecera en `muted` con texto `muted-foreground` `xs` 500 en mayúsculas espaciadas (`sobrelinea`). Filas blancas, separadores `border`, hover `accent`. Cantidades alineadas a la derecha en tabular-nums. En móvil, la misma información en tarjetas apiladas.

**Formulario.** Label Inter 500 `sm` encima del control, ayuda en `muted-foreground` `xs` debajo, error en `error` `xs` con el borde del input en `error`. Inputs blancos, borde `input`, radio `md`, foco con `ring` verde de 2 px. Campos obligatorios sin asterisco: el formulario es mínimo, todo lo que aparece es necesario; lo opcional se marca «(opcional)».

**Estado vacío.** Isotipo en `verde-claro` a 48 px, título Sora 600 `lg`, una frase en `muted-foreground` y el botón primario que crea el primer elemento. Centrado, dentro de una tarjeta con borde discontinuo (`border-dashed`).

**Estado de error / alerta.** Bloque con fondo `error-fondo`, borde `error` al 30 %, icono y título en `error`, texto en `foreground`. Mismo patrón para `aviso-fondo`/`aviso` y `exito-fondo`/`exito`. Los toasts (sonner) siguen estos mismos pares.

**Sidebar (escritorio).** Verde. Logo negativo arriba (24 px de alto, zona de respeto respetada con `p-4`). Ítems en crema 400 `sm`; el activo en crema sólido con texto verde; hover `sidebar-accent`; icono lucide de 16 px. Grupos separados con `sidebar-border`. Abajo, el usuario y el cierre de sesión.

**Barra inferior (móvil).** Blanca sobre crema, borde superior `border`, iconos en `muted-foreground` y el activo en `primary` con un punto coral de 4 px debajo. Respeta `env(safe-area-inset-bottom)`.

**Diálogo / sheet.** Blanco, radio `xl`, sombra `lg`, título Sora 600 `lg`. Un botón primario a la derecha y «Cancel·la» ghost a su izquierda.

**Parte pública.** Fondo crema, `display` en Sora 800, claim en `subtitulo`, bloques alternos crema/blanco. El coral aparece como acento gráfico (subrayado, contador, el «RE» de las secciones), no como fondo de grandes áreas.

## 7. Lo que no está decidido

- Modo oscuro: no existe en el branding y no se implementa. El `@custom-variant dark` de `index.css` se queda, sin valores.
- Iconografía: lucide, trazo 1.75–2 px, color del texto que acompaña. Si el diseñador entrega iconos propios, sustituirán a lucide en la navegación.
- Fotografía e ilustración: sin criterio en el branding. Hasta entonces, fotos reales del campo con una capa crema al 0 %: no se tintan.
