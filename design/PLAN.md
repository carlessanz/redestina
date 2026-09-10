# Plan del sistema de diseño REDESTINA

Acordado con Carles Sanz el 10 de septiembre de 2026. Este documento es el punto de partida para implantar la nueva imagen de REDESTINA en el repositorio como un sistema de diseño que el código consume directamente.

## Fuentes de diseño

Están en la carpeta del proyecto en el Mac, `Documents/Claude/Projects/REDESTINA/1. Fuentes/Diseño/`: un PDF que explica el nuevo diseño (paleta, tipografías, uso del logo) y un archivo de Illustrator con el logo. El archivo `.ai` se intenta leer como PDF compatible (rasterizar, extraer trazados y colores). Si no es posible, pedir a Carles la exportación del logo a SVG en tres variantes (principal, sobre fondo oscuro y monocromo) y los códigos hex de los colores y el nombre exacto de las tipografías.

## Estado del repositorio

Repo local `Documents/GitHub/Espigoladors/Redestina` (GitHub Espigoladors/Redestina). Vite 7, React 19, TypeScript 5.9 en modo strict, Tailwind v4 y shadcn/ui (estilo new-york, cssVariables, iconos lucide, componentes en `src/components/ui/`, veinte generados con el CLI).

El tema actual vive en `src/index.css` como variables CSS en `:root` y se expone a Tailwind con `@theme inline`. Paleta actual heredada de simbiosi_poma de espigoladors.cat: navy `#234C66`, crema `#E0EBC7`, coral `#EE7A5F`, fondo `#F9FAFD`, tipografía Space Grotesk. El menú lateral (sidebar de shadcn) va en navy con la crema como acento.

Activos actuales en `public/`: `logo-redestina.svg` (189 por 48), `favicon.svg`, `icona-192.png`, `icona-512.png`, `icona-maskable-512.png`, `apple-touch-icon.png` y `logo-email.png` (los iconos PWA se generan a partir del logo SVG).

Reglas del repo que hay que respetar: `AGENTS.md` es la fuente canónica y debe actualizarse en el mismo cambio, se trabaja sobre `main`, `npm run build` antes de dar por terminado un cambio, commits en castellano, `docs/` está fuera de git.

## Las cuatro piezas del sistema de diseño

1. **Tokens.** `design/tokens.json` como fuente única: colores con nombre semántico (primario, secundario, acento, superficie, fondo, texto, borde, éxito, aviso, error, y los del sidebar), tipografías y escala de tamaños, espaciados, radios, sombras y puntos de corte. De este archivo se generan las variables CSS de `src/index.css` (`:root` y `@theme inline`) manteniendo los nombres que shadcn espera, de modo que todos los componentes cambian de piel sin tocar pantallas.
2. **Activos.** Logo en SVG en sus variantes, favicon, iconos PWA regenerados, `logo-email.png` y las fuentes en woff2 si son propias (o carga desde Google Fonts si son libres).
3. **Reglas.** `design/DESIGN.md` con lo que un token no captura: cuándo se usa cada variante del logo y su zona de respeto, jerarquía tipográfica, tono de los mensajes, y patrones de componentes (botón, tarjeta, tabla, formulario, estados vacíos y de error, sidebar) con referencia a los tokens.
4. **Instrucciones para el código.** Sección nueva en `AGENTS.md` (y por importación en `CLAUDE.md`): todo estilo sale de los tokens, no se inventan colores ni tamaños, dónde están el logo y las reglas y cómo se cambia un color.

Antes de tocar la aplicación se genera `design/preview.html`, una página de muestra con todos los componentes pintados con los tokens, para validar visualmente.

## Orden de trabajo con puntos de parada

1. Analizar el PDF y el `.ai`. Informar de lo extraído (paleta con hex, tipografías, jerarquía, espaciados, radios, reglas del logo) y de lo que falta o es ambiguo. No tocar el repo.
2. Con confirmación, generar `design/tokens.json`, `design/DESIGN.md` y `design/preview.html`. Enseñar la preview y parar.
3. Con validación, aplicar al código: sustituir los tokens de `src/index.css`, actualizar los activos de `public/` y las fuentes. No modificar componentes de pantalla salvo que un estilo fijo en código contradiga los tokens, y en ese caso listarlos antes.
4. Añadir la sección a `AGENTS.md`, comprobar `npm run build`, proponer el commit en castellano y esperar aprobación.
