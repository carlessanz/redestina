-- Cómo se entrega una oferta y quién la lleva (revisión funcional del 23-09-2026).
--
-- El alta preguntaba «Quin tipus de caixa?» con seis modelos de caja que el productor no
-- sabía contestar, y daba por hecho que siempre venía una entidad a recogerla. Ahora:
--
--   · `format_entrega`: caixes · palet · envasos_propis (los trae quien lo recibe) · altres.
--     No se pregunta si el producto sigue en el campo: se cosecha allí mismo.
--   · `transport_propi`: la productora puede llevarlo (true), hay que ir a buscarlo (false),
--     o no se preguntó (null: producto en el campo, o ofertas anteriores a esto).
--
-- ⚠️ `tipo_caixa` se QUEDA: lo tienen las ofertas anteriores y lo lee la conversión en
--    espigolada para prellenar. Simplemente ya no se pregunta. Las taras se fijan por línea
--    en el albarán (`albaran_lineas`), que es donde siempre se han decidido.
-- ⚠️ `retorn_envasos` sigue siendo texto: las nuevas son «Sí»/«No»; las antiguas pueden
--    decir «Caixes pròpies», que hoy es un formato de entrega y no un retorno.
-- ⚠️ Solo añade columnas nullable: el frontend vigente sigue funcionando durante la
--    ventana de publicación (§11).

alter table excedentes
  add column if not exists format_entrega text
    check (format_entrega in ('caixes', 'palet', 'envasos_propis', 'altres')),
  add column if not exists transport_propi boolean;

comment on column excedentes.format_entrega is
  'Cómo se entrega: caixes, palet, envasos_propis (los trae quien lo recibe) o altres. Null si el producto está en el campo.';
comment on column excedentes.transport_propi is
  'true = la productora lo lleva; false = hay que ir a buscarlo; null = no se preguntó.';
