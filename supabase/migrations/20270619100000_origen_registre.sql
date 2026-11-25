-- «Registrar operació realitzada» (proceso 3.7 del cliente; fase 5 del plan de noviembre de 2026),
-- 1 de 4: el ORIGEN de una oferta registrada a posteriori.
--
-- El equipo puede dar de alta una operación que YA ha ocurrido (sin publicar, ni interés, ni
-- asignación previa): `registrar_operacio_realitzada()` (20270619100200) crea la oferta con
-- `origen = 'registre'`. Ese valor es la MARCA de «registrada a posteriori»: no hay columna
-- propia (`registre_posteriori` se deriva de `origen = 'registre'` donde hace falta, p. ej. en
-- `sortides_base`, 20270619100300).
--
-- `excedentes_origen_check` pasa de cuatro valores a cinco. Ampliar una lista `in (…)` no puede
-- dejar filas fuera (todo lo que valía sigue valiendo), pero se sigue la regla de §7 igualmente:
-- `not valid` y `validate constraint` aparte. Idempotente (`drop … if exists`).
--
-- `trg_excedentes_validacio` solo manda a validación los orígenes `intake` y `panel`: una oferta
-- `registre` nace `publicada` y no pasa por «Per validar» (la registra el propio equipo).

alter table public.excedentes drop constraint if exists excedentes_origen_check;
alter table public.excedentes add constraint excedentes_origen_check
  check (origen = any (array['intake', 'panel', 'asistido', 'espigolament', 'registre'])) not valid;
alter table public.excedentes validate constraint excedentes_origen_check;

comment on column public.excedentes.origen is
  'De dónde sale la oferta: intake (WhatsApp) · panel (la productora) · asistido (el equipo en su nombre) · '
  'espigolament (heredado) · registre (operación ya realizada, registrada a posteriori por el equipo con '
  'registrar_operacio_realitzada; 20270619100000).';
