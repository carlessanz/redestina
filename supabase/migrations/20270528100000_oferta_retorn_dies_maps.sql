-- Alta de oferta, fase A del «punto 3» (filas 3.1–3.5 del Excel de revisión de la Fundació,
-- 17-11-2026). Cuatro columnas nuevas en `excedentes`, todas opcionales:
--
--   · `retorn_envasos_detall`     qué envases hay que devolver (texto libre). Se pregunta solo si
--                                 `retorn_envasos = 'Sí'`. ⚠️ `retorn_envasos` YA EXISTÍA y guarda
--                                 la respuesta «Sí»/«No»: no se reutiliza, se añade al lado.
--   · `retorn_envasos_quantitat`  cuántos (entero > 0).
--   · `dies_recollida`            días en que se puede recoger (1 = dilluns … 7 = diumenge), mismo
--                                 vocabulario que `productor_ubicaciones.dies_setmana` (A4). Solo
--                                 lo pregunta el panel; el panel lo precarga del lugar elegido.
--   · `gmaps_url`                 el enlace de Google Maps PROPIO de la oferta, cuando el lugar no
--                                 tiene: el Excel dice que nada de la oferta toca la ficha, así que
--                                 no se escribe en `productor_ubicaciones`. Manda sobre el del
--                                 lugar en el texto de la oferta.
--
-- Compatible hacia atrás: columnas nulas, sin default obligatorio; el frontend publicado no las
-- conoce y no las manda. `excedentes` tiene GRANT de tabla (SELECT/UPDATE para `authenticated`,
-- sin INSERT: el alta va por `crear-oferta`), así que las columnas nuevas heredan el mismo
-- permiso; ningún trigger ni vista necesita conocerlas.

alter table public.excedentes
  add column if not exists retorn_envasos_detall text,
  add column if not exists retorn_envasos_quantitat integer,
  add column if not exists dies_recollida smallint[],
  add column if not exists gmaps_url text;

alter table public.excedentes drop constraint if exists excedentes_retorn_quantitat_positiva;
alter table public.excedentes add constraint excedentes_retorn_quantitat_positiva
  check (retorn_envasos_quantitat is null or retorn_envasos_quantitat > 0);

alter table public.excedentes drop constraint if exists excedentes_retorn_detall_llarg;
alter table public.excedentes add constraint excedentes_retorn_detall_llarg
  check (retorn_envasos_detall is null or char_length(retorn_envasos_detall) <= 400);

alter table public.excedentes drop constraint if exists excedentes_dies_recollida;
alter table public.excedentes add constraint excedentes_dies_recollida
  check (dies_recollida is null or dies_recollida <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);

alter table public.excedentes drop constraint if exists excedentes_gmaps_url;
alter table public.excedentes add constraint excedentes_gmaps_url
  check (gmaps_url is null or (gmaps_url ~* '^https?://' and char_length(gmaps_url) <= 500));

comment on column public.excedentes.retorn_envasos_detall is
  'Qué envases hay que devolver (si retorn_envasos = Sí). Fase A del punto 3, 17-11-2026.';
comment on column public.excedentes.retorn_envasos_quantitat is
  'Cuántos envases hay que devolver (> 0, si retorn_envasos = Sí).';
comment on column public.excedentes.dies_recollida is
  'Días de recogida de la oferta, 1 = dilluns … 7 = diumenge (solo panel; precargados del lugar).';
comment on column public.excedentes.gmaps_url is
  'Enlace de Google Maps propio de la oferta (si el lugar no tiene). No toca la ficha del lugar.';
