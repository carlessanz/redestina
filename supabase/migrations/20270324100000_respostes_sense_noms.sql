-- «Cuántas, sin nombres»: que lo cumpla la política, no solo la RPC.
--
-- EL HECHO, MEDIDO. Desde `20260730098000` la política de SELECT de `oferta_respuestas`
-- tiene tres ramas, y la tercera es `excedente_id in (select
-- excedents_dels_meus_productors())`: el productor lee las respuestas a SUS ofertas.
-- `authenticated` tiene GRANT de SELECT sobre TODAS las columnas de esa tabla, así que
-- eso incluye `entidad_id`, `telefono`, `kg_solicitados` y `preu_ofert`. Comprobado el
-- 14-09-2026 abriendo sesión real con la cuenta de TEST-PROD-1 contra producción y
-- pidiendo la tabla por PostgREST: devuelve tres filas con su `entidad_id`.
--
-- Esa rama nació en una migración que arreglaba OTRA cosa —una recursión infinita entre
-- las políticas de `excedentes` y `oferta_respuestas`— y se escribió cuando todavía no
-- había ninguna decisión sobre qué ve el generador. No respondía a ninguna pantalla:
-- verificado uno por uno el 14-09-2026, los únicos lectores son
--
--   · `src/components/OfferDetail.tsx` y `src/routes/equip/Aprovacions.tsx` — del EQUIPO
--     (`OfferDetail` solo se monta desde `/equip/ofertes/:id`), rama `es_intern()`;
--   · `src/routes/receptor/Mercat.tsx` e `Interessos.tsx` — del RECEPTOR y filtrando por
--     su propia `entidad_id`, rama `mis_entidades()`;
--   · `supabase/functions/_shared/respuestas.ts` — el webhook, con `service_role`, que
--     ignora RLS por `BYPASSRLS`;
--   · `scripts/crear-respuestas-prueba.ts` — lee con la service key y decide con la
--     sesión del superadmin.
--
-- Ninguna pantalla del panel del productor la pide (`src/routes/productor/` consulta
-- `excedentes`, `canalizaciones`, `documentos`, `convenios`, `cierres_donante`,
-- `cierres_periodo` y `v_albaranes_bandeja`, y nada más). O sea que el dato estaba
-- concedido y nadie lo usaba: la forma más silenciosa que tiene un permiso de ser
-- demasiado ancho.
--
-- LO QUE ESTA MIGRACIÓN HACE: retira esa tercera rama. Las otras dos se quedan tal cual.
-- A partir de aquí el único camino del generador hacia esa información es
-- `progres_meves_ofertes()` (`20270323100000`), que devuelve cuatro columnas numéricas
-- por oferta y ninguna que identifique a nadie. Es `security definer` precisamente para
-- esto: no depende de la política, así que sigue devolviendo exactamente lo mismo antes
-- y después de este cambio.
--
-- POR QUÉ IMPORTA, dicho como negocio y no como permiso: quién quiere el producto es
-- información de la otra parte y de la coordinación. Un generador que ve los nombres
-- puede saltarse al equipo —y el modelo es asistido a propósito (§1bis)—, y una entidad
-- que manifiesta interés no ha consentido que su nombre viaje al generador antes de que
-- haya nada acordado.
--
-- ⚠️ ESTO NO DEJA AL PRODUCTOR A CIEGAS, Y ES DELIBERADO. La política de `canalizaciones`
--    conserva su rama `excedents_dels_meus_productors()`, así que en cuanto el equipo
--    aprueba una respuesta y nace la canalización, el generador la ve: a esas alturas hay
--    una entrega coordinada y tiene que saber quién viene a recoger. Lo que se retira es
--    la visibilidad de la etapa ANTERIOR —quién ha mostrado interés y a qué precio—, que
--    es donde vive la decisión del cliente. Y aun ahí ve un `entidad_id`, no un nombre:
--    `entidades` le sigue estando negada entera.
--
-- ⚠️ `excedents_dels_meus_productors()` NO SE BORRA. Sigue en uso en la política de
--    SELECT de `canalizaciones` (misma migración `20260730098000`), así que un
--    `drop function` la tumbaría. Lo que sobra es una referencia, no la función.
--
-- ⚠️ Y esto no toca el `insert`/`update`: `authenticated` conserva sus GRANT de escritura
--    sobre la tabla y sus políticas, que es por donde entra `manifestar_interes()`. Un
--    productor nunca ha podido escribir aquí y sigue sin poder —lo impide su propia
--    política de escritura y el trigger `respuestas_control_aprovacio`—.

drop policy if exists "respuestas: lectura per rol" on oferta_respuestas;
create policy "respuestas: lectura per rol"
  on oferta_respuestas for select to authenticated
  using (
       (select public.es_intern())
    or entidad_id in (select public.mis_entidades())
  );

comment on policy "respuestas: lectura per rol" on oferta_respuestas is
  'El equipo, y la entidad que respondió. El generador NO: ve el agregado por '
  'progres_meves_ofertes() (cuantas, sin nombres). La rama del productor se retiro en '
  '20270324100000; venia de 20260730098000, que arreglaba una recursion y no una politica.';

-- ---------------------------------------------------------------------------
-- Verificación (manual, tras aplicar)
-- ---------------------------------------------------------------------------
-- La política se lee así, y lo que tiene que haber desaparecido es la tercera rama:
--   select policyname, qual from pg_policies
--    where schemaname = 'public' and tablename = 'oferta_respuestas' and cmd = 'SELECT';
--   -- esperado: es_intern() OR entidad_id IN (mis_entidades()), y nada más
--
-- Pero el `qual` solo dice lo que está escrito. Lo que hay que comprobar es lo que se ve,
-- y eso pide dos sesiones REALES (la publishable key, como el navegador — con la service
-- key no se mide nada: `BYPASSRLS`):
--
--   # Productor (TEST-PROD-1). ANTES devolvía 3 filas con su entidad_id; ahora, cero.
--   curl -sS "$SUPABASE_URL/rest/v1/oferta_respuestas?select=id,entidad_id,telefono" \
--     -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $JWT_PRODUCTOR"
--   # esperado: []
--
--   # Equipo. Sigue viéndolas todas: la rama es_intern() no se ha tocado.
--   curl -sS "$SUPABASE_URL/rest/v1/oferta_respuestas?select=id,entidad_id" \
--     -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $JWT_EQUIP"
--   # esperado: las filas de siempre
--
--   # Y el productor sigue viendo su embudo, que es lo que sustituye a lo retirado.
--   curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/progres_meves_ofertes" \
--     -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $JWT_PRODUCTOR"
--   # esperado: una fila por oferta activa, con n_enviades / n_interessades / n_per_aprovar
--
-- ⚠️ Una cuenta de DOBLE ROL sigue viendo respuestas, y no es un escape: las ve por la
--    rama `mis_entidades()`, como receptora. Lo que deja de ver son las de sus propias
--    ofertas. Por eso el arnés no puede afirmar «cero» para esa cuenta (ver la nota en
--    `scripts/comprobar-rls.ts`).
