-- «Producte al camp»: una oferta puede declarar que lo ofrecido TODAVÍA NO ESTÁ RECOGIDO,
-- y el equipo puede convertirla en una jornada de espigueo sin duplicar la entrada.
--
-- QUÉ RESUELVE. Hoy una oferta y una espigolada son dos caminos que no se tocan: la oferta
-- entra por el intake o por el panel y presupone producto ya cosechado y envasado; la
-- espigolada la teclea el equipo de cero con `crear_espigolada()`. Pero el caso real más
-- común del espigueo es justamente el intermedio: un generador avisa de que tiene un campo
-- sin cosechar, eso se publica como oferta para ver quién la quiere, y **después** se monta
-- la jornada. Sin esta fase, el equipo tenía dos salidas, las dos malas:
--
--   · repartir la oferta como si el producto estuviera recogido → el REC que nace del
--     trigger de `canalizaciones` declara una entrada que nadie ha pesado; o
--   · crear la espigolada aparte → dos entradas del mismo producto, la oferta viva por su
--     lado, y la conciliación contando los kilos dos veces.
--
-- Lo que se añade es mínimo a propósito: una marca en la oferta, un enlace en la jornada, y
-- una rama en `crear_espigolada()` que REUTILIZA la oferta en vez de crear otra.
--
-- ⚠️ POR QUÉ UNA COLUMNA Y NO UN CAMPO EN JSON. `producte_al_camp` decide un flujo —si sale
--    en la cola del equipo, si se puede convertir, si el REC lo crea la jornada o el
--    trigger—, y un campo que decide un flujo no puede vivir en texto libre donde una
--    errata no la detecta nadie. Es un boolean `not null` con default, así que las ofertas
--    que ya existen quedan todas en `false`, que es lo que son.

-- ---------------------------------------------------------------------------
-- 1. excedentes.producte_al_camp
-- ---------------------------------------------------------------------------
alter table excedentes
  add column if not exists producte_al_camp boolean not null default false;

comment on column excedentes.producte_al_camp is
  'La oferta declara producto SIN COSECHAR: hay que ir a recogerlo. Es lo que la hace '
  'convertible en espigolada con crear_espigolada(p_excedente => ...).';

-- GRANT: NO hace falta ninguno, y conviene dejar escrito por qué se comprobó.
-- `excedentes` tiene GRANT **de tabla**, no por columnas: `select` de
-- `20260721160000_auth_authenticated.sql:60` (`grant select on all tables …`) y `update`
-- de `20260724100000_rls_gestiona_canalizaciones_excedentes.sql:22`. Un GRANT de tabla
-- cubre las columnas futuras, así que esta nace legible y escribible sin tocar nada.
--
-- ⚠️ Eso NO vale en una tabla con GRANT por columnas —`enlaces_token`, `evidencias`,
--    `parametros_documentales`, `documentos`—, donde una columna nueva no hereda nada y hay
--    que otorgarla a mano (precedente: `enlaces_token.rol_parte`, 20270304100200:39, §4).
--    Aquí se miró antes de darlo por hecho.
--
-- Quién puede escribirla, entonces: solo el equipo, porque la única política de UPDATE de
-- `excedentes` es «excedentes: edicio intern» (20260730096000:39), con `es_intern()` en el
-- `using` y en el `with check`. El generador la fija al publicar, pero por el servidor
-- (`crear-oferta` corre con `service_role`): `authenticated` no tiene INSERT sobre
-- `excedentes` (20270322100100:144) y no lo va a tener.

-- El índice que sostiene la cola nueva de `pendents_equip()`, que se consulta en cada
-- cambio de ruta del panel del equipo. Parcial y no total: las ofertas con producto en el
-- campo van a ser una minoría pequeña del total, así que un índice sobre la columna entera
-- sería casi todo `false` y no lo usaría el planner.
create index if not exists excedentes_al_camp_per_convertir_idx
  on excedentes (estado)
  where producte_al_camp and espigolada_id is null;

-- ---------------------------------------------------------------------------
-- 2. espigoladas.oferta_origen_id
-- ---------------------------------------------------------------------------
-- De qué oferta nació la jornada. Es trazabilidad, no evidencia fiscal: lo que certifica
-- son el REC y sus líneas, y esos cuelgan de `espigolada_id`.
--
-- 🔴 `on delete set null`, y NO es una preferencia de estilo: `borrar_ficha_completa()`
--    (20260921153439) borra `excedentes` en la línea 348 y `espigoladas` en la 352, o sea
--    LAS OFERTAS ANTES QUE LAS JORNADAS. Con `no action` —el default— esa función quedaría
--    rota con `23503` para cualquier productor que tuviera una oferta convertida, y es la
--    ÚNICA puerta de borrado de una ficha (§7). No se puede arreglar reordenando aquella
--    función: editar una migración aplicada está prohibido. Así que la FK se declara de
--    forma que no pueda bloquearla, igual que ya hace `excedentes.espigolada_id`
--    (20261012100200:52).
alter table espigoladas
  add column if not exists oferta_origen_id uuid;

alter table espigoladas drop constraint if exists espigoladas_oferta_origen_id_fkey;
alter table espigoladas add constraint espigoladas_oferta_origen_id_fkey
  foreign key (oferta_origen_id) references excedentes(id) on delete set null;

comment on column espigoladas.oferta_origen_id is
  'Oferta «producte al camp» de la que nació esta jornada, si nació de una. '
  'on delete set null: es trazabilidad, y no puede bloquear borrar_ficha_completa().';

-- Para la pregunta inversa —«¿esta oferta ya tiene jornada?»— desde el ciclo guiado.
create index if not exists espigoladas_oferta_origen_idx
  on espigoladas (oferta_origen_id) where oferta_origen_id is not null;

-- ---------------------------------------------------------------------------
-- 3. crear_espigolada(): la rama que convierte una oferta
-- ---------------------------------------------------------------------------
-- `p_excedente` va AL FINAL y con default, así que la firma anterior
-- `crear_espigolada(uuid,uuid,date,int,text,jsonb,text)` sigue resolviendo: quien ya la
-- llama por nombre de parámetro o por posición (scripts/crear-datos-documentales-prueba.ts,
-- el panel) no se entera de que existe.
--
-- ⚠️ Es una SOBRECARGA NUEVA, no un reemplazo: `create or replace function` no puede
--    cambiar el número de argumentos, así que Postgres crea una segunda función con la
--    misma firma más un parámetro. Las dos convivirían y una llamada con siete argumentos
--    sería AMBIGUA (42725), porque las dos la aceptan. Por eso la vieja se borra
--    explícitamente al final, con su `drop function`, y no antes: entre el drop y el create
--    no puede haber ninguna ventana, y en una migración transaccional no la hay.
--
-- QUÉ CAMBIA CUANDO VIENE `p_excedente`:
--   · no se crea ningún excedente: se REUTILIZA ese. Pasa a `origen = 'espigolament'`,
--     `espigolada_id` = la jornada y `estado = 'borrador'` hasta que se reparta.
--   · la jornada guarda `oferta_origen_id`.
--   · el REC se crea igual que siempre, con su línea.
--
-- QUÉ NO CAMBIA: sin `p_excedente` el comportamiento es exactamente el de antes, línea por
-- línea. Es la misma decisión que el interruptor `roles_activos` (§4bis): una rama nueva no
-- puede alterar el camino que ya funciona.
create or replace function public.crear_espigolada(
  p_productor       uuid,
  p_ubicacion       uuid default null,
  p_fecha           date default null,
  p_num_voluntarios int default null,
  p_notas           text default null,
  p_lineas          jsonb default '[]'::jsonb,
  p_ref_externa     text default null,
  p_excedente       uuid default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  esp       espigoladas%rowtype;
  ex        excedentes%rowtype;
  l         jsonb;
  v_rec     uuid;
  v_orden   int := 0;
  v_ex      uuid;
  v_ejerc   int;
  v_n       int;
  v_ids     jsonb := '[]'::jsonb;
  v_kg      numeric;
  v_fam     text;
  v_prefijo text;
  v_fecha   date;
  v_ubic    uuid;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot crear una espigolada' using errcode = '42501';
  end if;

  v_fecha := coalesce(p_fecha, (now() at time zone 'Europe/Madrid')::date);
  v_ubic  := p_ubicacion;

  -- -------------------------------------------------------------------------
  -- Guardas de la conversión. Van ANTES de insertar nada: una jornada creada y
  -- deshecha por un `raise` posterior no deja rastro en esta transacción, pero sí
  -- habría gastado el `ref_externa` de un reintento en la siguiente.
  -- -------------------------------------------------------------------------
  if p_excedente is not null then
    -- `for update` serializa dos conversiones simultáneas de la misma oferta: la segunda
    -- espera, relee `espigolada_id` ya escrito y se va por `ja_es_espigolada`. Sin el
    -- bloqueo, las dos pasarían las guardas a la vez y crearían dos jornadas con el mismo
    -- producto, que es la duplicación de entrada que toda esta fase existe para impedir.
    select * into ex from excedentes where id = p_excedente for update;

    if ex.id is null then
      raise exception 'oferta_inexistent: aquesta oferta no existeix' using errcode = '22023';
    end if;

    -- El donante de la jornada y el de la oferta tienen que ser el mismo: de ese productor
    -- salen los kilos del REC y, con ellos, su certificado fiscal. Un desajuste aquí
    -- certificaría a nombre de quien no donó.
    if ex.productor_id is distinct from p_productor then
      raise exception 'productor_no_coincideix: l''oferta no es d''aquesta entitat productora'
        using errcode = '22023';
    end if;

    if not coalesce(ex.producte_al_camp, false) then
      raise exception 'sense_producte_al_camp: aquesta oferta no declara producte al camp'
        using errcode = '22023';
    end if;

    if ex.espigolada_id is not null then
      raise exception 'ja_es_espigolada: aquesta oferta ja forma part d''una espigolada'
        using errcode = '22023';
    end if;

    -- Ya repartida: convertirla duplicaría la entrada. El trigger
    -- `canalizaciones_crea_albaranes` ya le creó su REC al insertarse la primera
    -- canalización, así que la jornada aportaría un segundo albarán de recepción con los
    -- mismos kilos y la conciliación los contaría dos veces.
    if exists (select 1 from canalizaciones c where c.excedente_id = ex.id) then
      raise exception 'ja_te_canalitzacions: aquesta oferta ja s''ha repartit'
        using errcode = '22023';
    end if;

    -- La misma razón por el otro lado, y además protege del choque contra el índice único
    -- `albaranes_rec_excedente_uidx`: un albarán suelto (creado a mano, o superviviente de
    -- un reparto anulado) haría fallar la jornada con un `23505` ilegible en vez de con
    -- este motivo.
    if exists (select 1 from albaranes a
                where a.excedente_id = ex.id and a.estado <> 'anulado') then
      raise exception 'ja_te_albarans: aquesta oferta ja te albarans'
        using errcode = '22023';
    end if;

    -- Una oferta es UN producto, así que su conversión admite como mucho UNA línea: la del
    -- pesaje real de la jornada. Más de una obligaría a decidir en silencio qué se hace con
    -- las demás —¿excedentes nuevos? ¿se descartan?— y una decisión así no se toma dentro
    -- de un bucle. Si algún día una jornada tiene que recoger varios productos partiendo de
    -- una oferta, se añade aquí, explícito.
    if jsonb_array_length(coalesce(p_lineas, '[]'::jsonb)) > 1 then
      raise exception 'massa_linies: en convertir una oferta nomes s''admet una linia'
        using errcode = '22023';
    end if;

    -- La finca de la oferta, si no se pasa otra.
    v_ubic := coalesce(p_ubicacion, ex.ubicacion_id);
  end if;

  insert into espigoladas (productor_id, ubicacion_id, fecha, num_voluntarios, notas,
                           ref_externa, oferta_origen_id, creada_por)
  values (p_productor, v_ubic, v_fecha, p_num_voluntarios, p_notas, p_ref_externa,
          p_excedente, auth.uid())
  returning * into esp;

  v_ejerc := extract(year from esp.fecha)::int;

  -- El albarán de recepción de la jornada: uno solo, con una línea por producto.
  insert into albaranes (tipo, espigolada_id, idioma)
  values ('REC', esp.id, 'ca')
  returning id into v_rec;

  -- -------------------------------------------------------------------------
  -- Rama A: conversión de una oferta. Un registro, el que ya existe.
  -- -------------------------------------------------------------------------
  if p_excedente is not null then
    -- La línea del REC es lo que de verdad entró. Si no se pasa ninguna, se toma lo que la
    -- oferta declaraba; si se pasa, manda ella —después de una jornada se pesa, y lo pesado
    -- no tiene por qué parecerse a lo estimado sobre el campo—.
    l := jsonb_array_element(coalesce(p_lineas, '[]'::jsonb), 0);
    if l is null or jsonb_typeof(l) is distinct from 'object' then
      l := jsonb_build_object(
             'producto',  ex.producto,
             'variedad',  ex.variedad,
             'familia',   ex.familia,
             'causa',     ex.causa,
             'num_cajas', ex.num_caixes,
             'tipo_caja', ex.tipo_caixa,
             'kg',        ex.kg_total);
    end if;

    v_kg := coalesce((l->>'kg')::numeric, ex.kg_total, 0);
    select familia into v_fam from productos where nombre = coalesce(l->>'producto', ex.producto);

    -- La oferta pasa a ser el registro de la jornada. NO se le toca el `id_excedente`: ya
    -- tiene su correlativo y cambiarlo rompería cualquier referencia impresa o enviada.
    --
    -- `estado = 'borrador'` la saca del mercado mientras se cosecha, que es lo mismo que
    -- hace la espigolada normal: el reparto lo decide el equipo, no una entidad pulsando
    -- «M'interessa» sobre un producto que todavía está en la planta. `repartir_espigolada()`
    -- la devolverá a `parcial`/`bloqueada`.
    --
    -- ⚠️ Los intereses ya recibidos NO se tocan, y es deliberado: son exactamente las
    --    entidades a las que se repartirá. `aprovar_resposta()` no mira el estado del
    --    excedente, así que la cola de aprobación sigue funcionando sobre esta oferta.
    update excedentes
       set espigolada_id    = esp.id,
           origen           = 'espigolament',
           estado           = 'borrador',
           ubicacion_id     = coalesce(ubicacion_id, v_ubic),
           familia          = coalesce(l->>'familia', familia, v_fam),
           variedad         = coalesce(l->>'variedad', variedad),
           causa            = coalesce(l->>'causa', causa),
           kg_total         = v_kg,
           num_caixes       = coalesce((l->>'num_cajas')::int, num_caixes),
           tipo_caixa       = coalesce(l->>'tipo_caja', tipo_caixa)
     where id = ex.id;

    insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                                num_cajas, tipo_caja, kg_bruto, tara_kg, kg_neto, kg_previstos)
    values (v_rec, 1, coalesce(l->>'producto', ex.producto),
            coalesce(l->>'variedad', ex.variedad),
            coalesce(l->>'familia', ex.familia, v_fam),
            coalesce(l->>'causa', ex.causa),
            coalesce((l->>'num_cajas')::int, ex.num_caixes),
            coalesce(l->>'tipo_caja', ex.tipo_caixa),
            (l->>'kg_bruto')::numeric, (l->>'tara_kg')::numeric, v_kg, v_kg);

    v_ids := v_ids || jsonb_build_object('excedente_id', ex.id,
                                         'producte', coalesce(l->>'producto', ex.producto),
                                         'kg', v_kg);

  -- -------------------------------------------------------------------------
  -- Rama B: la espigolada de siempre. Un excedente nuevo por línea.
  -- -------------------------------------------------------------------------
  else
    for l in select * from jsonb_array_elements(p_lineas) loop
      v_orden := v_orden + 1;
      v_kg    := coalesce((l->>'kg')::numeric, 0);
      select familia into v_fam from productos where nombre = l->>'producto';

      -- id_excedente: E-AAMMDD-XXX-YYY-N, con N del contador de series.
      v_prefijo := 'E-' || to_char(esp.fecha, 'YYMMDD') || '-' ||
                   upper(left(regexp_replace(coalesce(
                     (select coalesce(p.empresa, p.name) from productores p where p.id = p_productor),
                     'XXX'), '[^a-zA-Z]', '', 'g') || 'XXX', 3)) || '-' ||
                   upper(left(regexp_replace(coalesce(l->>'producto', 'YYY'), '[^a-zA-Z]', '', 'g') || 'YYY', 3));
      v_n := public.siguiente_numero(v_prefijo, v_ejerc);

      insert into excedentes (id_excedente, productor_id, ubicacion_id, familia, producto,
                              variedad, kg_total, num_caixes, tipo_caixa, modalitat, causa,
                              estado, origen, espigolada_id, observacions)
      values (v_prefijo || '-' || v_n::text, p_productor, v_ubic,
              coalesce(l->>'familia', v_fam), l->>'producto', l->>'variedad',
              v_kg, (l->>'num_cajas')::int, l->>'tipo_caja', 'donacio', l->>'causa',
              'borrador', 'espigolament', esp.id, p_notas)
      returning id into v_ex;

      insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                                  num_cajas, tipo_caja, kg_bruto, tara_kg, kg_neto, kg_previstos)
      values (v_rec, v_orden, l->>'producto', l->>'variedad', coalesce(l->>'familia', v_fam),
              l->>'causa', (l->>'num_cajas')::int, l->>'tipo_caja',
              (l->>'kg_bruto')::numeric, (l->>'tara_kg')::numeric, v_kg, v_kg);

      v_ids := v_ids || jsonb_build_object('excedente_id', v_ex, 'producte', l->>'producto', 'kg', v_kg);
    end loop;
  end if;

  return jsonb_build_object('espigolada_id', esp.id,
                            'albara_rec', v_rec,
                            'oferta_origen_id', p_excedente,
                            'registres', v_ids);
end;
$$;

comment on function public.crear_espigolada(uuid,uuid,date,int,text,jsonb,text,uuid) is
  'Crea la jornada de espigueo, sus registros y el REC. Con p_excedente convierte una '
  'oferta «producte al camp» en jornada REUTILIZANDO ese excedente, en vez de crear otro.';

-- La firma de siete argumentos se retira **en esta misma transacción**. Si se quedara, una
-- llamada con siete argumentos sería ambigua (42725): las dos la aceptan, y Postgres no
-- prefiere la que no tiene defaults. Ninguna llamada existente se rompe —la de ocho la
-- resuelve igual, con `p_excedente` a null—.
drop function if exists public.crear_espigolada(uuid,uuid,date,int,text,jsonb,text);

-- EXECUTE de la firma nueva. `create function` concede EXECUTE a PUBLIC, así que sin esto
-- `anon` podría crear una espigolada sin tener sesión. Mismo reparto que tenía la de siete
-- argumentos en 20261012100500: la comprobación de rol va por dentro (`es_intern()`), y el
-- arnés verifica que un externo se lleva un 42501.
revoke execute on function public.crear_espigolada(uuid,uuid,date,int,text,jsonb,text,uuid)
  from public, anon;
grant  execute on function public.crear_espigolada(uuid,uuid,date,int,text,jsonb,text,uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. pendents_equip(): la cola 13, «ofertes per convertir en espigolada»
-- ---------------------------------------------------------------------------
-- Una oferta con producto en el campo y sin jornada es trabajo del equipo que hoy no
-- cuenta nadie: alguien tiene que ir a cosecharlo, y si no se mira, la oferta se muere sola
-- en el listado como ya le pasa a `ofertes_sense_enviar`.
--
-- ⚠️ SE RECREA ENTERA a propósito, repitiendo TODOS sus atributos —`stable`,
--    `security invoker`, `set search_path`— y sus GRANT. `create or replace` reescribe los
--    atributos que no se repitan: es la trampa que ya se cobró `parallel restricted` en
--    `get_my_session_context()` y el `revoke`/`grant` de `resolver_enlace()` (§4bis).
--
-- ⚠️ Y se conserva lo que la hace correcta: devuelve SIEMPRE una fila por cola —ahora
--    trece— aunque `n` valga 0; las fechas se cortan en hora de Madrid y no con
--    `current_date`, porque la sesión de PostgREST va en UTC; y la guarda se escribe
--    `auth.uid() is not null and not es_intern()`, que es lo único que deja pasar a
--    `service_role` (escrita `es_intern()` a secas respondería 42501 a la plataforma).
create or replace function public.pendents_equip()
returns table (cua text, n int, ref uuid, detall jsonb)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la cua de treball' using errcode = '42501';
  end if;

  return query
  with param as (
    select extract(year from (now() at time zone 'Europe/Madrid'))::int as any_curs,
           (now() at time zone 'Europe/Madrid')::date                   as avui
  ),
  tanc as (
    select ci.id, ci.ejercicio, ci.modo, ci.estado
      from cierres_ejercicio ci
     where ci.estado in ('obert', 'provisional')
     order by ci.abierto_at desc, ci.created_at desc
     limit 1
  ),
  cues as (
    -- ⚠️ Las columnas del CTE NO se llaman `cua`, `n`, `ref` ni `detall`: esos cuatro
    --    nombres son los parámetros OUT de la función, y en plpgsql un identificador que
    --    coincide con una variable se sustituye por ella. `return query` casa por
    --    POSICIÓN, así que llamarlas distinto no cuesta nada y elimina la ambigüedad.
    select 1 as ordre, 'registres'::text as clau,
           (select count(*) from membresias m where m.aprovacio = 'pendent')::int as quants,
           null::uuid as objecte, null::jsonb as extra
    union all
    select 2, 'convenis_contrasignar',
           (select count(*) from convenios cv where cv.estado = 'firmat')::int, null, null
    union all
    select 3, 'respostes',
           (select count(*) from oferta_respuestas r
             where r.estado = 'acceptada' and r.aprovacio = 'pendent')::int, null, null
    union all
    select 4, 'missatges',
           (select coalesce(sum(ms.pendents), 0)::int from missatges_sense_contestar() ms),
           null, null
    union all
    select 5, 'ofertes_sense_enviar',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and not exists (select 1 from oferta_respuestas r
                                where r.excedente_id = e.id))::int, null, null
    union all
    select 6, 'ofertes_vencudes',
           (select count(*) from excedentes e, param p
             where e.estado in ('publicada', 'parcial')
               and e.disponible_hasta < p.avui)::int, null, null
    union all
    select 7, 'albarans_esborrany',
           (select count(*) from albaranes a where a.estado = 'borrador')::int, null, null
    union all
    select 8, 'albarans_conciliar',
           (select count(*) from albaranes a
             where a.tipo = 'REC' and a.estado in ('entregado', 'confirmado'))::int,
           null, null
    union all
    select 9, 'albarans_esperant',
           (select count(*) from albaranes a where a.estado = 'entregado')::int, null, null
    union all
    select 10, 'costos',
           (select count(distinct e.producto)
              from canalizaciones c
              join excedentes e on e.id = c.excedente_id
              cross join param p
             where extract(year from (c.created_at at time zone 'Europe/Madrid'))::int
                   = p.any_curs
               and e.producto is not null
               and not exists (select 1 from costes_producto cp
                                where cp.producto = e.producto
                                  and cp.ejercicio = p.any_curs))::int, null, null
    union all
    select 11, 'tancament',
           (select count(*) from cierres_ejercicio ci
             where ci.estado in ('obert', 'provisional'))::int,
           (select t.id from tanc t),
           (select jsonb_build_object(
                     'ejercicio',   t.ejercicio,
                     'modo',        t.modo,
                     'estado',      t.estado,
                     'bloquejats',
                     (select count(*) from cierres_donante d
                       where d.cierre_id = t.id
                         and exists (
                           select 1
                             from jsonb_array_elements(
                                    case when jsonb_typeof(d.bloqueos) = 'array'
                                         then d.bloqueos else '[]'::jsonb end) b
                            where coalesce((b ->> 'bloqueja')::boolean, false))))
              from tanc t)
    union all
    select 12, 'documents_error',
           (select count(*) from documentos d where d.estado = 'error')::int, null, null
    union all
    -- NUEVA (F3). Ofertas publicadas que declaran producto sin cosechar y todavía no son
    -- una jornada. Es trabajo de campo pendiente: alguien tiene que organizar el espigueo.
    --
    -- ⚠️ `estado = 'publicada'` y no también `'parcial'`, y las dos mitades encajan a
    --    propósito: una oferta con alguna canalización ya no es convertible
    --    —`crear_espigolada()` se niega con `ja_te_canalitzacions`—, así que contarla aquí
    --    sería ofrecer un botón que la base va a rechazar. La cola cuenta exactamente lo
    --    que se puede convertir.
    --
    -- ⚠️ Y `espigolada_id is null` y no `oferta_origen_id`: lo que hay que mirar es si la
    --    oferta YA es parte de una jornada, venga de donde venga. Preguntarlo por el enlace
    --    inverso dejaría fuera cualquier otro camino que la ate a una espigolada, que es
    --    justo el estado que hace imposible convertirla.
    select 13, 'espigolades_per_convertir',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and e.producte_al_camp
               and e.espigolada_id is null)::int, null, null
  )
  select q.clau, q.quants, q.objecte, q.extra from cues q order by q.ordre;
end;
$$;

comment on function public.pendents_equip() is
  'Cola de trabajo consolidada del equipo: una fila por cola (trece), siempre, aunque n = 0. '
  'security invoker: agrega solo lo que quien pregunta ya puede leer.';

revoke execute on function public.pendents_equip() from public, anon;
grant  execute on function public.pendents_equip() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verificación (manual, tras aplicar)
-- ---------------------------------------------------------------------------
--   -- La columna existe, es not null y las ofertas que había quedan en false.
--   select producte_al_camp, count(*) from excedentes group by 1;                       -- todo false
--   select has_table_privilege('authenticated','public.excedentes','SELECT');           -- t
--   select has_column_privilege('authenticated','public.excedentes','producte_al_camp','SELECT'); -- t
--
--   -- Solo queda UNA crear_espigolada, la de ocho argumentos.
--   select pg_get_function_identity_arguments(oid)
--     from pg_proc where proname = 'crear_espigolada';       -- uuid, uuid, date, integer, text, jsonb, text, uuid
--   select has_function_privilege('anon',
--     'public.crear_espigolada(uuid,uuid,date,int,text,jsonb,text,uuid)','EXECUTE');     -- f
--
--   -- Trece colas, siempre.
--   select count(*) from public.pendents_equip();                                       -- 13
--   select cua, n from public.pendents_equip() where cua = 'espigolades_per_convertir';
--
--   -- La conversión, en una transacción que se revierte (no consume numeración de
--   -- ninguna serie legal: el REC pide número al EMITIR, no al crearse).
--   -- begin;
--   --   update excedentes set producte_al_camp = true where id = '<oferta publicada>';
--   --   select public.crear_espigolada('<productor>', null, current_date, 8, 'prova',
--   --            '[{"kg":850,"num_cajas":20,"tipo_caja":"PALOT"}]'::jsonb, null, '<oferta>');
--   --   select estado, origen, espigolada_id, kg_total from excedentes where id = '<oferta>';
--   --   -- borrador | espigolament | <jornada> | 850
--   --   select public.crear_espigolada('<productor>', null, current_date, 8, null,
--   --            '[]'::jsonb, null, '<oferta>');   -- 22023 ja_es_espigolada
--   -- rollback;
