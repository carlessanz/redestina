-- La receptora ve el producto de las entregas que ha recibido
-- ===========================================================================
--
-- EL PROBLEMA, medido en producción el 22-09-2026. En `/receptor/historic` y en la tabla
-- de albaranes de `/receptor/documents`, tres de las cuatro entregas del Menjador Social
-- de Prova salían con producto «—» y referencia «—». No era un dato que faltara: los
-- cuatro excedentes tienen su producto en la base, y `v_albaranes_bandeja` devuelve
-- «Tomàquet» para esos ENT cuando la consulta el equipo. O sea que el mismo albarán
-- enseñaba el producto a Redestina y un guion a la entidad que lo recibió.
--
-- POR QUÉ. La política de lectura de `excedentes` tiene cuatro ramas (`20270304100400`) y
-- la única que alcanza a un receptor por vía distinta del mercado es
-- `id in (select excedents_amb_interes_meu())`, que sale de `oferta_respuestas`. Una
-- canalización que NO nace de un interés registrado no entra por ninguna:
--
--   · el reparto de una espigolada (`repartir_espigolada`), que no pasa por ahí;
--   · el alta directa del equipo desde `OfferDetail` (los atajos de la deuda 109).
--
-- Y como `v_albaranes_bandeja` es `security_invoker`, su join con `excedentes` se evalúa
-- con la RLS de quien pregunta: sin visibilidad, `producto` sale `null` y la pantalla
-- pinta «—». El arnés no lo cazaba porque no es un permiso mal puesto, es una fila que no
-- existe para esa sesión.
--
-- LA DECISIÓN. Se añade una quinta rama: los excedentes de MIS canalizaciones. No amplía
-- el criterio de la política, lo completa — si a una entidad se le concede ver la oferta
-- por haber dicho «me interesa», negársela cuando además se le ha entregado el producto
-- es la misma regla aplicada al revés. El vínculo es más fuerte, no más débil.
--
-- ⚠️ D3 NO SE RELAJA. Lo que esta rama abre es la fila de `excedentes`, que es lo mismo
--    que ya abre la rama del interés y lo mismo que abre el mercado para cualquier oferta
--    publicada compatible. El rigor de D3 —no nombrar al donante en una donación— vive
--    donde tiene que vivir y no se toca: el `ENT` tapa `id_excedente`, `recogida.lugar` y
--    `responsable_origen` al renderizar, y `cierre_receptor_lineas` lo impone con un CHECK
--    que hace imposible guardar el productor en una línea de donación (§4). Esto es la
--    pantalla del histórico, no un documento.
--
-- ⚠️ SIN CORRELACIÓN, como `20270304100400`. La rama va como `id in (select f())` con una
--    función `security definer` que no recibe parámetros: así el planner la evalúa una vez
--    por consulta (InitPlan) y no una vez por fila, que es el motivo entero de aquella
--    migración. Un `exists (select … where c.excedente_id = excedentes.id)` escrito aquí
--    desharía ese trabajo sin que nada avisara.

/** Excedentes de los que alguna de mis entidades ha recibido una canalización. */
create or replace function public.excedents_de_les_meves_canalitzacions()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct c.excedente_id
    from canalizaciones c
   where c.entidad_id in (select public.mis_entidades())
     and c.excedente_id is not null;
$$;

comment on function public.excedents_de_les_meves_canalitzacions() is
  'Excedentes con alguna canalización hacia mis entidades. Puente sin correlación para la RLS de excedentes: sin él, una entrega que no nació de un interés registrado (espigolada, alta asistida) deja a la receptora sin poder leer el producto de lo que ha recibido.';

-- El EXECUTE a `authenticated` no es opcional: una política se evalúa con los privilegios
-- de quien consulta (mismo matiz que `modalitats_compatibles_meves()`).
revoke execute on function public.excedents_de_les_meves_canalitzacions() from public, anon;
grant  execute on function public.excedents_de_les_meves_canalitzacions() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La política, con la quinta rama
-- ---------------------------------------------------------------------------
-- Las cuatro anteriores se copian tal cual: no se toca ni la de `es_intern()`, ni la de
-- `mis_productores()`, ni la del mercado, ni la del interés.
drop policy if exists "excedentes: lectura per rol" on excedentes;
create policy "excedentes: lectura per rol"
  on excedentes for select to authenticated
  using (
       (select public.es_intern())
    or productor_id in (select public.mis_productores())
    or (estado in ('publicada', 'parcial')
        and modalitat in (select public.modalitats_compatibles_meves()))
    or id in (select public.excedents_amb_interes_meu())
    or id in (select public.excedents_de_les_meves_canalitzacions())
  );

-- Verificación (con la sesión del Menjador Social de Prova):
--   select count(*) from excedentes;                  -- sube en los 2 que faltaban
--   select e.id_excedente, e.producto
--     from canalizaciones c join excedentes e on e.id = c.excedente_id;
--   -- las 4 filas con producto, ninguna con null
