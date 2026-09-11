-- Una cuenta, una ficha de cada tipo. Lo que la interfaz ya da por cierto, dicho en la base.
--
-- EL PROBLEMA (deuda §12.31). `membresias` no tiene ninguna restricción por
-- `(user_id, tipo)`, así que una cuenta puede ser titular de dos productores; pero
-- `organitzacioActiva()` y `useOrganitzacio()` hacen `find`, o sea que **la segunda es
-- inalcanzable**. Y desde que el menú pinta una cabecera por panel, esa cabecera afirma
-- visualmente «este es tu panel de productor» — con dos fichas, miente.
--
-- POR QUÉ ESTO Y NO UN SELECTOR. Medido contra producción el 11-09-2026: de **14 membresías
-- activas y aprobadas, CERO cuentas tienen dos fichas del mismo tipo**. El problema no existe
-- todavía. Construir el selector de organización —con el `orgId` en la URL, que es el arreglo
-- «de verdad» que la deuda propone— es rehacer la navegación entera de los dos paneles
-- externos para un caso que nadie ha tenido; y mientras tanto la base seguiría permitiendo
-- llegar a un estado que la interfaz no sabe representar.
--
-- Así que se hace al revés: **se impone la invariante que el código ya asume**. Si algún día
-- hace falta de verdad que una persona lleve dos organizaciones del mismo tipo, quitar este
-- índice es una línea — y entonces sí tocará hacer el selector, con un caso real delante que
-- diga cómo tiene que comportarse.
--
-- ⚠️ Solo cuenta lo **vivo**. Una membresía rechazada o desactivada no ocupa sitio: el eje
--    `aprovacio` existe justamente porque `activo` solo no podía significar a la vez «todavía
--    no validada» y «desactivada por el equipo» (§4bis). Una persona a la que se le rechazó
--    un alta como productor tiene que poder volver a intentarlo.
create unique index if not exists membresias_una_fitxa_per_tipus_uidx
  on membresias (user_id, tipo)
  where activo and aprovacio = 'aprovada';

comment on index membresias_una_fitxa_per_tipus_uidx is
  'Una cuenta tiene como mucho UNA ficha activa de cada tipo. Es la invariante que la '
  'interfaz ya asume (`find` en organitzacioActiva/useOrganitzacio): sin ella se puede '
  'llegar a un estado que ninguna pantalla sabe representar (deuda §12.31). Parcial a '
  'propósito: las rechazadas y las desactivadas no ocupan sitio.';
