-- Qué modalidades ve cada tipo de receptor: la entidad social también ve venta y maquila,
-- y la empresa compradora también ve maquila (revisión funcional del 23-09-2026).
--
-- POR QUÉ. La regla de negocio que dio la Fundación es:
--   · Empresa (comercial)      → solo venta y maquila, nunca donación.
--   · Entidad social           → donación + venta + maquila.
-- La matriz sembrada en 20260730091000 dejaba a la entidad social solo con donación y a la
-- empresa solo con venta, así que una entidad social no veía nunca una oferta de venta que
-- sí podía pedir, y una empresa no veía la maquila.
--
-- ⚠️ SOLO SE AÑADE. La compatibilidad vive en tabla precisamente para que cambiar la regla
--    sea un insert (§4bis): la RLS de `excedentes` (`modalitats_compatibles_meves()`),
--    `manifestar_interes()` y `manifestar_interes_assistit()` leen esta misma tabla, así
--    que el mercado, el interés propio y el asistido cambian a la vez y sin tocar código.
--    `animal` y `transformador` no cambian.
--
-- ⚠️ LO QUE ESTO NO CAMBIA, y es deliberado: los CONVENIOS. `convenios_exigidos` pide un
--    convenio comercial (`com`) a las dos partes de una venta o una maquila. Una entidad
--    social con solo su `don_rec` verá ahora las ofertas de venta y podrá mostrar interés,
--    pero `aprovar_resposta()` no la canalizará hasta que tenga un `com` vigente — que es
--    exactamente lo que dice la matriz de convenios, y el panel del equipo ya lo avisa
--    antes de aprobar (§12.78).

insert into modalitat_receptor_compat (modalitat, tipo_receptor) values
  ('venda',   'social'),
  ('maquila', 'social'),
  ('maquila', 'comercial')
on conflict do nothing;
