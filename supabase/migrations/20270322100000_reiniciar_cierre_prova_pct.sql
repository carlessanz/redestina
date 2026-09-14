-- ---------------------------------------------------------------------------
-- `reiniciar_cierre_prueba()` adopta la serie P-CT, y `reiniciar_documentos_prova()`
-- puede por fin quedarse en PROVA a secas
-- ---------------------------------------------------------------------------
-- Deuda §12.101, y el cabo suelto que `20270319100000` dejó escrito a propósito.
--
-- QUÉ PASABA. `reiniciar_cierre_prueba()` **sí borra** los documentos del certificado de
-- transacción: el CT cuelga de una fila de `cierres_donante` con `tipo = 'transaccio'`
-- (20270301100100:461) y se emite por `cierre_emet_document()`, que inserta siempre con
-- `objeto_tipo = 'cierre_donante'` (20261109100100:462), así que entra de lleno en su
-- `delete from documentos where objeto_tipo = 'cierre_donante' and objeto_id in (...)`.
-- Lo que **no** hacía era devolver su contador a 0: ese `update` nombra
-- `serie in ('P-RES', 'P-CD')` y es de noviembre de 2026, anterior al CT
-- (`20270301100100`, marzo de 2027). Nadie lo actualizó al añadir la serie.
--
-- ⚠️ COMPROBADO ANTES DE TOCAR EL CONTADOR, porque el orden importa: si resultara que la
--    función **no** borra los documentos `P-CT`, poner su contador a 0 sería peor que el
--    problema —un contador por debajo de los documentos vivos choca con el índice único
--    `(numero_completo, version)` de `documentos` en la siguiente emisión—. Verificado
--    sobre el cuerpo desplegado en producción el 14-09-2026 (`pg_get_functiondef`), que
--    coincide byte a byte con `20261109100100:1146`: el `delete` no filtra por `tipo` ni
--    por serie, así que se lleva los RES, los CD **y los CT** de ese cierre. El único
--    hueco era el contador.
--
-- QUÉ CAMBIA, EN DOS FUNCIONES Y NADA MÁS:
--
--   1. `reiniciar_cierre_prueba()` añade `'P-CT'` a su `serie in (...)`. Con eso el
--      documento y su contador vuelven a cero **juntos**, que es la única forma de no
--      fabricar una colisión de `numero_completo`.
--   2. `reiniciar_documentos_prova()` se queda en `array['PROVA']`. `20270319100000`
--      dejó `P-CT` dentro de su criterio —a regañadientes y explicándolo— porque era el
--      único sitio del código que la ponía a 0; con el punto 1 ya tiene dueño propio, así
--      que esa excepción se retira. Es literalmente lo que aquel fichero escribió que se
--      podría hacer «ese día, y no antes».
--
-- POR QUÉ IMPORTA, que es lo que esto arregla de verdad: el arnés (`comprobar-rls.ts`)
-- llama a `reiniciar_documentos_prova()` como `limpiar:` del check de
-- `emitir_documento_prova`, y corre contra la base REAL (§7: no hay base local). Mientras
-- `P-CT` estuviera en su criterio, una pasada del arnés en mitad del ensayo de cierre de
-- diciembre se llevaba por delante los certificados de transacción de ese ensayo y le
-- reseteaba la serie a otro. Es la deuda §12.52 por su último flanco.
--
-- MAPA DE DUEÑOS DESPUÉS DE ESTA MIGRACIÓN — ninguna serie de prueba se queda sin nadie,
-- y ninguna tiene dos dueños que puedan pisarse:
--
--   | Serie   | Borra sus documentos                     | Devuelve el contador a 0            |
--   |---------|------------------------------------------|-------------------------------------|
--   | PROVA   | reiniciar_documentos_prova()             | reiniciar_documentos_prova()        |
--   | P-RES   | reiniciar_cierre_prueba()   (por objeto) | reiniciar_cierre_prueba()           |
--   | P-CD    | reiniciar_cierre_prueba()   (por objeto) | reiniciar_cierre_prueba()           |
--   | P-CT    | reiniciar_cierre_prueba()   (por objeto) | **reiniciar_cierre_prueba()** ← AQUÍ |
--   | P-CDP   | reiniciar_periodes_prova()  (por objeto) | reiniciar_periodes_prova() (:763)   |
--
--   Comprobado en producción el 14-09-2026: esas cinco son TODAS las series de prueba que
--   existen (`select serie from series_documentales where serie like 'P-%'` da P-CD,
--   P-CDP, P-CT y P-RES; más `PROVA`, que no lleva prefijo), y las cinco están a 0 en los
--   cinco ejercicios sembrados 2026-2030.
--
-- ⚠️ LO QUE ESTO **NO** ARREGLA, y conviene no creer que sí: `reiniciar_cierre_prueba()`
--    resetea por `ce.ejercicio`, no por cierre. Como el índice único parcial de
--    `cierres_ejercicio` solo cubre `modo = 'real'`, puede haber **varios cierres de
--    prueba del mismo año**; reiniciar uno pondría a 0 una serie cuyos documentos del otro
--    siguen vivos. Es un riesgo que ya tenían `P-RES` y `P-CD` desde noviembre, y `P-CT`
--    pasa a compartirlo — no se introduce nada nuevo, pero tampoco se cierra. Hoy no hay
--    ningún cierre abierto en producción, así que no es alcanzable.
--
-- ⚠️ `create or replace` REESCRIBE TODOS LOS ATRIBUTOS de la función, así que las dos
--    repiten `volatile`, `security definer` y `set search_path`. Los privilegios sí los
--    conserva (la signatura no cambia y no hay `drop`), pero se vuelven a declarar
--    igualmente para que el fichero se lea solo, como en `20270304100200` y
--    `20270319100000`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. reiniciar_cierre_prueba(): mismo cuerpo, una serie más en el reseteo
-- ---------------------------------------------------------------------------
-- ⚠️ NO TOCA NI UNA CANALIZACIÓN NI UN ALBARÁN. Sigue siendo la condición de aceptación
--    de la fase 4: `count(*)` de las dos tablas tiene que ser el mismo antes y después.
create or replace function public.reiniciar_cierre_prueba(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ce      cierres_ejercicio%rowtype;
  v_docs  int;
  v_enl   int;
  v_don   int;
  v_lin   int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar reinicia una prova' using errcode = '42501';
  end if;

  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;
  if ce.modo <> 'prueba' then
    raise exception 'Nomes es reinicia un tancament de PROVA' using errcode = '42501';
  end if;

  perform set_config('redestina.reinicio_prueba', 'on', true);

  -- `documento_envios` cae por cascada; el trigger comprueba además que `modo = 'prueba'`.
  --
  -- Sin filtro por `tipo`: entran los RES y los CD de las filas `tipo = 'donacio'` y los
  -- CT de las `tipo = 'transaccio'`, porque todas son `cierres_donante` de este cierre.
  delete from documentos
   where objeto_tipo = 'cierre_donante'
     and objeto_id in (select id from cierres_donante where cierre_id = p_cierre);
  get diagnostics v_docs = row_count;

  -- `evidencias` cae por cascada del enlace.
  delete from enlaces_token
   where objeto_tipo = 'cierre_donante'
     and objeto_id in (select id from cierres_donante where cierre_id = p_cierre);
  get diagnostics v_enl = row_count;

  delete from cierre_donante_lineas
   where cierre_donante_id in (select id from cierres_donante where cierre_id = p_cierre);
  get diagnostics v_lin = row_count;

  delete from cierres_donante where cierre_id = p_cierre;
  get diagnostics v_don = row_count;

  -- ⚠️ ESTA LISTA TIENE QUE DECIR LO MISMO QUE EL `delete` DE ARRIBA. El `delete` se lleva
  --    los documentos de las tres series de prueba del cierre (P-RES, P-CD y P-CT), así
  --    que las tres tienen que volver a 0: dejar una serie con el contador por encima solo
  --    desperdicia números, pero dejarlo por DEBAJO de un documento vivo choca con el
  --    índice único `(numero_completo, version)` en la siguiente emisión. `P-CT` faltaba
  --    aquí desde `20270301100100` (§12.101).
  update series_documentales set ultimo = 0
   where ejercicio = ce.ejercicio and serie in ('P-RES', 'P-CD', 'P-CT');

  update cierres_ejercicio
     set estado = 'obert', calculado_at = null, provisional_at = null,
         cerrado_at = null, declarado_at = null
   where id = p_cierre;

  return jsonb_build_object('tancament', p_cierre, 'documents', v_docs, 'enllacos', v_enl,
                            'donants', v_don, 'linies', v_lin,
                            'canalitzacions', (select count(*) from canalizaciones),
                            'albarans', (select count(*) from albaranes));
end;
$$;

comment on function public.reiniciar_cierre_prueba(uuid) is
  'Repite el ensayo de un cierre de PRUEBA: borra sus lineas, donantes, documentos (RES, CD y CT) y enlaces, y devuelve los contadores P-RES, P-CD y P-CT del ejercicio a 0. No toca ninguna canalizacion ni ningun albaran.';

revoke execute on function public.reiniciar_cierre_prueba(uuid) from public, anon;
grant  execute on function public.reiniciar_cierre_prueba(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. reiniciar_documentos_prova(): ya puede soltar P-CT
-- ---------------------------------------------------------------------------
-- Mismo cuerpo que `20270319100000`, con `v_series` reducido a la única serie que esta
-- función posee. El resto de la cabecera de aquel fichero sigue valiendo entero: las dos
-- condiciones del `delete` (`modo = 'prueba'` para el trigger, la serie para no tocar un
-- ensayo ajeno ni un número legal) y la simetría obligatoria entre `delete` y `update`.
create or replace function public.reiniciar_documentos_prova()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ejercicio int;
  v_borrados  int;
  -- El criterio, escrito UNA vez. Desde esta migración es solo `PROVA`: las cuatro series
  -- `P-*` las limpia quien las emite (ver la tabla de dueños en la cabecera).
  v_series    text[] := array['PROVA'];
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot reiniciar el cicle de proves'
      using errcode = '42501';
  end if;

  v_ejercicio := extract(year from (now() at time zone 'Europe/Madrid'))::int;

  perform set_config('redestina.reinicio_prueba', 'on', true);

  -- `documento_envios` cae por cascada.
  --
  -- Las DOS condiciones hacen falta y dicen cosas distintas: `modo = 'prueba'` es lo que
  -- el trigger `documentos_no_esborrar` exige para dejar borrar nada, y el filtro de
  -- serie es lo que impide tocar ni un documento de un ensayo de cierre en curso ni uno
  -- que haya consumido un número de una serie legal.
  delete from documentos
   where modo = 'prueba'
     and serie = any(v_series);
  get diagnostics v_borrados = row_count;

  -- Mismo conjunto de series que el `delete`: resetear el contador de una serie cuyos
  -- documentos sobreviven es fabricar una colisión de `numero_completo`.
  update series_documentales
     set ultimo = 0
   where ejercicio = v_ejercicio
     and serie = any(v_series);

  return v_borrados;
end;
$$;

comment on function public.reiniciar_documentos_prova() is
  'Reinicia el ciclo de pruebas: borra los documentos en modo prueba de la serie PROVA y devuelve su contador del ejercicio a 0. No toca el ensayo de cierre (P-RES/P-CD/P-CT/P-CDP, que limpian sus propias RPC) ni ninguna serie legal.';

revoke execute on function public.reiniciar_documentos_prova() from public, anon;
grant  execute on function public.reiniciar_documentos_prova() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verificación (con la service key o una sesión de super_admin)
-- ---------------------------------------------------------------------------
--   -- 1. Punto de partida: las cinco series de prueba, y ninguna huérfana.
--   select serie, ejercicio, ultimo from series_documentales
--    where serie = 'PROVA' or serie like 'P-%' order by serie, ejercicio;
--
--   -- 2. El ciclo del arnés sigue entero y ahora solo alcanza PROVA.
--   select public.emitir_documento_prova();                                  -- uuid
--   select public.reiniciar_documentos_prova();                              -- 1
--   select count(*) from documentos where serie = 'PROVA';                   -- 0
--
--   -- 3. Y lo que esta migración añade: el arnés YA NO toca P-CT. Su contador tiene que
--   --    valer lo que valía antes del paso 2, igual que P-RES, P-CD y P-CDP.
--   select serie, ultimo from series_documentales
--    where ejercicio = extract(year from (now() at time zone 'Europe/Madrid'))::int
--      and serie in ('P-RES', 'P-CD', 'P-CT', 'P-CDP');                      -- sin cambios
--
--   -- 4. El nuevo dueño de P-CT, cuando haya un ensayo de cierre que reiniciar:
--   --    select public.reiniciar_cierre_prueba('<uuid del cierre de prueba>');
--   --    -> tras la llamada, P-RES, P-CD y P-CT del ejercicio del cierre a 0, y
--   --       `select count(*) from canalizaciones` / `from albaranes` sin cambios.
--
--   -- 5. El fixture documental, que vive en series reales, sigue en pie.
--   select count(*) from documentos where modo = 'real';                     -- 15
