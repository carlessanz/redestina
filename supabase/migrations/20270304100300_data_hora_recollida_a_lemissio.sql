-- `emitir_albaran()` escribe la fecha de recogida en la canalización.
-- Cierra la deuda §12.69 **solo hacia adelante**.
--
-- EL DEFECTO. `canalizaciones.data_hora_recollida` existe desde `20260721120100` y **no
-- la escribe nadie**: ni `aprovar_resposta()`, ni `repartir_espigolada()`, ni el panel.
-- Está vacía en todas las filas salvo las que planta el fixture de pruebas. Por eso
-- `cierre_base()`, `cierre_pendents()` y `cierre_base_transaccion()` la leen con respaldo
-- —`coalesce(data_hora_recollida, conciliada_at, created_at)`—, y ese respaldo es lo que
-- decide hoy en qué ejercicio fiscal entra una donación: la fecha en que alguien concilió,
-- o la fecha en que se creó la fila, que pueden caer en otro año que la recogida.
--
-- DÓNDE SE ESCRIBE, Y POR QUÉ AQUÍ. `emitir_albaran()` ya calcula `v_fecha` —la fecha del
-- acto documentado, con la que elige el ejercicio de la serie— y la tira después de usarla.
-- Es el único punto del circuito donde esa fecha está establecida y es la misma que se
-- imprime en el papel: escribirla en cualquier otro sitio sería inventarse una segunda.
--
-- 🔴 SOLO HACIA ADELANTE, Y ESTO NO ES UNA PRECAUCIÓN DE ESTILO. Esa fecha decide el
--    ejercicio fiscal de la canalización (`cierre_base`, el certificado, el modelo 182).
--    Tres cosas la acotan, y hacen falta las tres:
--
--    1. **`where data_hora_recollida is null`**: no se pisa ninguna fecha existente.
--    2. **Ningún backfill**. Las canalizaciones que ya existen se quedan como están, con
--       su respaldo. Rellenarlas ahora movería de año donaciones ya certificadas.
--    3. **El `coalesce` de respaldo se queda donde está**, en las tres funciones que lo
--       usan. Esta migración no toca ninguna.
--
--    Y por construcción no puede alcanzar a nada cerrado: `emitir_albaran()` exige
--    `estado = 'borrador'` (un albarán se emite una vez), y `cierre_base()` solo mira
--    canalizaciones `conciliada`, estado al que no se llega sin haber emitido antes. O
--    sea que la escritura ocurre **siempre antes** de que la fila pueda entrar en un
--    cierre. Lo único que puede cambiar de sitio es una canalización que todavía no ha
--    entrado en ninguno, que es exactamente lo que se quiere corregir.
--
-- ⚠️ QUÉ ALBARANES LA ESCRIBEN, DE VERDAD. Solo los que tienen `canalizacion_id`: **ENT y
--    OPE**. El REC cuelga del registro o de la espigolada y su `canalizacion_id` es null,
--    así que el `update` no toca nada. Consecuencia, dicha sin adornos: en una donación la
--    fecha que se acaba guardando es la de la **entrega a la entidad**, no la de la
--    entrada del donante, y las dos pueden caer en años distintos si la entrega cruza el
--    31 de diciembre. Sigue siendo mejor que el respaldo de hoy —`conciliada_at` puede ser
--    semanas más tarde— y es el cambio mínimo. Que el REC rellene además las
--    canalizaciones de su registro es la mejora siguiente, y se hace con el equipo
--    delante, no de paso.

create or replace function public.emitir_albaran(
  p_id       uuid,
  p_recogida jsonb default null,
  p_lineas   jsonb default null,
  p_idioma   text default null
) returns albaranes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a          albaranes%rowtype;
  v_serie    text;
  v_ejercici int;
  v_n        int;
  v_numero   text;
  v_fecha    timestamptz;
  l          jsonb;
  v_orden    int := 0;
  v_tara     numeric;
  v_neto     numeric;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot emetre albarans' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null then
    raise exception 'No existeix l''albara %', p_id using errcode = '22023';
  end if;
  if a.estado <> 'borrador' then
    raise exception 'Aquest albara ja esta emes (%)', a.numero_completo using errcode = '22023';
  end if;

  -- Las líneas, si se sustituyen. Solo se puede en borrador, que es donde estamos.
  if p_lineas is not null then
    delete from albaran_lineas where albaran_id = a.id;
    for l in select * from jsonb_array_elements(p_lineas) loop
      v_orden := v_orden + 1;
      v_tara := coalesce(
        (l->>'tara_kg')::numeric,
        (l->>'num_cajas')::numeric * (select t.tara_kg from tipos_caja t
                                       where t.codigo = l->>'tipo_caja'),
        0);
      v_neto := coalesce((l->>'kg_neto')::numeric,
                         (l->>'kg_bruto')::numeric - v_tara);
      if v_neto is not null and v_neto < 0 then
        raise exception 'La tara (%) es mes gran que el pes brut a la linia %', v_tara, v_orden
          using errcode = '22023';
      end if;
      insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                                  num_cajas, tipo_caja, kg_bruto, tara_kg, kg_neto,
                                  kg_previstos, lote_origen)
      values (a.id, coalesce((l->>'orden')::int, v_orden),
              l->>'producto', l->>'variedad', l->>'familia', l->>'causa',
              (l->>'num_cajas')::int, l->>'tipo_caja',
              (l->>'kg_bruto')::numeric, v_tara, v_neto,
              (l->>'kg_previstos')::numeric, l->>'lote_origen');
    end loop;
  end if;

  -- El ejercicio es el del acto documentado (la recogida), no el de hoy: un albarán que
  -- se emite el 2 de enero por una recogida del 30 de diciembre pertenece al año viejo, y
  -- eso decide en qué cierre anual entra.
  v_fecha    := coalesce((p_recogida->>'fecha_hora')::timestamptz,
                         (a.recogida->>'fecha_hora')::timestamptz,
                         (select c.data_hora_recollida from canalizaciones c where c.id = a.canalizacion_id),
                         now());
  v_ejercici := extract(year from (v_fecha at time zone 'Europe/Madrid'))::int;

  v_serie  := case when a.rectifica_a is not null then 'R-' || a.tipo else a.tipo end;
  v_n      := public.siguiente_numero(v_serie, v_ejercici);
  v_numero := public.formato_numero(v_serie, v_ejercici, v_n);

  -- ⚠️ UN SOLO `update`, y las partes dentro. Congelarlas en un segundo `update` era lo
  --    natural de escribir y **lo prohíbe el trigger de inmutabilidad**: en cuanto el
  --    estado deja de ser `borrador`, `partes` es una columna congelada. Es exactamente lo
  --    que el trigger tiene que impedir, así que la que se mueve es esta función.
  --    `albaran_partes()` es `stable` y lee la fila anterior, que es lo correcto: no
  --    necesita el número, solo las fichas y los parámetros.
  update albaranes
     set estado          = 'emitido',
         serie           = v_serie,
         ejercicio       = v_ejercici,
         numero          = v_n,
         numero_completo = v_numero,
         idioma          = coalesce(p_idioma, a.idioma),
         recogida        = coalesce(p_recogida, a.recogida),
         partes          = public.albaran_partes(a.id),
         emitido_at      = now(),
         emitido_por     = auth.uid()
   where id = a.id
  returning * into a;

  -- La fecha del acto, en la canalización (§12.69). Solo si estaba vacía: lo que ya
  -- tiene fecha no se toca nunca, porque eso sí podría mover de ejercicio una donación.
  -- En un REC `canalizacion_id` es null y esto no afecta a ninguna fila.
  if a.canalizacion_id is not null then
    update canalizaciones
       set data_hora_recollida = v_fecha
     where id = a.canalizacion_id
       and data_hora_recollida is null;
  end if;

  -- Y el documento, que dispara el PDF (trigger de encolado, 20260928100700).
  perform public.albaran_emet_document(a.id, 'emes', null);

  return a;
end;
$$;

comment on function public.emitir_albaran(uuid, jsonb, jsonb, text) is
  'Emite un albarán: pide número, congela partes, escribe la fecha de recogida en la canalización si estaba vacía y dispara el PDF.';

-- `create or replace` conserva los privilegios de 20261012100500 (authenticated + service_role).

-- Verificación:
--   select data_hora_recollida from canalizaciones where id = '<can>';   -- null antes
--   select public.emitir_albaran('<ent_borrador>');
--   select data_hora_recollida from canalizaciones where id = '<can>';   -- la de la recogida
--   -- y una segunda emisión (rectificativo) NO la cambia.
