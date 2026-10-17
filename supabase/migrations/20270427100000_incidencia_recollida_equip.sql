-- La incidencia de recogida, del lado del EQUIPO (17-10-2026).
--
-- Continúa `20270426100000_registrar_recollida_receptor.sql`: el receptor registra los kilos
-- reales con `registrar_recollida()` y, si declara «menys» o «més», la canalización queda con
-- `incidencia_recollida` y los albaranes emitidos pero SIN conciliar, para que los revise el
-- equipo. Faltaban tres cosas:
--
--   1. `conciliar_albaran()` exige MOTIVO para conciliar algo con incidencia de recogida
--      (`22023 cal_motiu_incidencia`). Una diferencia declarada por la entidad no se puede
--      cerrar con un clic sin decir por qué: el motivo es lo que queda escrito en el albarán
--      y en la canalización. La cascada desde el REC sigue funcionando porque siempre pasa
--      motivo a las salidas (el del equipo o «Conciliat amb l'albara de recepcio …»).
--   2. `pendents_equip()`: `albarans_conciliar` cuenta también las ventas y maquilas
--      (ENT/OPE confirmados sin REC vivo) y las salidas con incidencia cuyo REC ya está
--      conciliado —las dos se quedaban fuera del contador y no las veía nadie—, y
--      `albarans_esborrany` deja de contar todos los borradores: con el flujo nuevo cada
--      operación asignada es un borrador que espera al receptor, y eso no es trabajo del
--      equipo hasta que la recogida ha pasado y nadie la ha registrado.
--   3. El aviso `recollida_confirmada` al productor lleva `kg_assignats` y `diferencia`, para
--      que el texto pueda decir «X kg (assignats Y)» y avisar de la diferencia.
--
-- Solo `create or replace`: compatible hacia atrás, sin columnas ni firmas nuevas.

-- ---------------------------------------------------------------------------
-- (1) conciliar_albaran(): motivo obligatorio con incidencia de recogida
-- ---------------------------------------------------------------------------
-- Copia íntegra de la versión de 20270414100100 con UNA guarda nueva, después de comprobar
-- el estado y el plazo de confirmación. Incidencia:
--   · REC     → `rec_te_incidencia_recollida()`: alguna de sus salidas la tiene.
--   · ENT/OPE → la de su propia canalización.
-- ⚠️ El mensaje EMPIEZA por `cal_motiu_incidencia`: el frontend lo reconoce por ese prefijo.
create or replace function public.conciliar_albaran(p_id uuid, p_kg_validados jsonb default null::jsonb,
                                                    p_motivo text default null::text,
                                                    p_destino_final text default null::text)
returns albaranes
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  a        albaranes%rowtype;
  par      parametros_documentales%rowtype;
  k        jsonb;
  v_total  numeric;
  v_coste  numeric;
  v_prod   text;
  v_prop   jsonb;
  v_inc    boolean;
  b        record;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot conciliar un albara' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado not in ('entregado', 'confirmado') then
    raise exception 'Nomes es concilia un albara entregat o confirmat' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  if a.confirmado_at is null then
    if a.entregado_at is null
       or a.entregado_at + make_interval(days => coalesce(par.plazo_conciliar_sin_confirmacion_dias, 7)) > now() then
      raise exception 'Encara no ha vencut el termini de confirmacio: cal esperar o rebre la confirmacio'
        using errcode = '22023';
    end if;
    if coalesce(btrim(p_motivo), '') = '' then
      raise exception 'Conciliar sense confirmacio necessita motiu' using errcode = '22023';
    end if;
  end if;

  -- NUEVA (20270427100000). Una diferencia de kilos declarada por la entidad receptora no se
  -- concilia sin motivo. Va después del plazo de confirmación: si aún no se puede conciliar,
  -- ese es el error que hay que dar, no pedir un motivo que luego no serviría.
  if a.tipo = 'REC' then
    v_inc := public.rec_te_incidencia_recollida(a.id);
  else
    v_inc := a.canalizacion_id is not null and exists (
      select 1 from canalizaciones c
       where c.id = a.canalizacion_id and c.incidencia_recollida is not null);
  end if;
  if coalesce(v_inc, false) and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'cal_motiu_incidencia: l''entitat receptora ha declarat una diferencia de quilos en aquesta recollida; cal un motiu per conciliar'
      using errcode = '22023';
  end if;

  -- Un REC fuera de tolerancia se concilia, pero con motivo: arrastra sus salidas.
  if a.tipo = 'REC' then
    v_prop := public.propuesta_conciliacion(a.id);
    if not coalesce((v_prop->>'dins_tolerancia')::boolean, true)
       and coalesce(btrim(p_motivo), '') = '' then
      raise exception 'fora_de_tolerancia: la diferencia (% %%) supera la tolerancia (% %%); cal un motiu per conciliar',
        v_prop->>'diferencia_pct', v_prop->>'tolerancia_pct' using errcode = '22023';
    end if;
  end if;

  if p_kg_validados is null then
    update albaran_lineas
       set kg_validados = coalesce(kg_confirmados, kg_neto, kg_previstos)
     where albaran_id = a.id;
  else
    for k in select * from jsonb_array_elements(p_kg_validados) loop
      update albaran_lineas
         set kg_validados = (k->>'kg')::numeric
       where id = (k->>'linea_id')::uuid and albaran_id = a.id;
    end loop;
  end if;

  select coalesce(sum(kg_validados), 0) into v_total
    from albaran_lineas where albaran_id = a.id;

  update albaranes
     set estado              = 'conciliado',
         conciliado_at       = now(),
         conciliado_por      = auth.uid(),
         motivo_conciliacion = p_motivo,
         destino_final       = coalesce(p_destino_final, a.destino_final)
   where id = a.id
  returning * into a;

  -- La canalización: kilos conciliados y coste congelado. Si el coste seguía en null se
  -- intenta una última vez: el de la oferta y, si no, la referencia del producto
  -- (20270405100200). Si tampoco está, se queda null y **bloquea el cierre**.
  if a.canalizacion_id is not null then
    select e.producto into v_prod
      from excedentes e join canalizaciones c on c.excedente_id = e.id
     where c.id = a.canalizacion_id;
    select c.coste_kg into v_coste from canalizaciones c where c.id = a.canalizacion_id;
    if v_coste is null and v_prod is not null then
      select coalesce(e.coste_kg, (select cp.coste_kg from costes_producto cp
                                    where cp.producto = e.producto))
        into v_coste
        from excedentes e join canalizaciones c on c.excedente_id = e.id
       where c.id = a.canalizacion_id;
    end if;

    update canalizaciones
       set kg_conciliados      = v_total,
           kg_reales           = coalesce(kg_reales, v_total),
           coste_kg            = v_coste,
           estado              = 'conciliada',
           conciliada_at       = now(),
           conciliada_por      = auth.uid(),
           motivo_conciliacion = p_motivo
     where id = a.canalizacion_id;
  end if;

  -- La versión definitiva del PDF, que sustituye a la emitida.
  perform public.albaran_emet_document(a.id, 'conciliat', null);

  -- La cascada: las salidas confirmadas de este REC. Solo desde un REC, así que la llamada
  -- de dentro (un ENT/OPE) no vuelve a entrar aquí. El motivo nunca llega vacío a las
  -- salidas, así que la guarda de incidencia no las frena.
  if a.tipo = 'REC' then
    for b in
      select s.id from albaranes s
       where s.id in (select public.albarans_germans_rec(a.id))
         and s.estado = 'confirmado'
       order by s.created_at
    loop
      perform public.conciliar_albaran(
        b.id, null,
        coalesce(nullif(btrim(p_motivo), ''),
                 'Conciliat amb l''albara de recepcio ' || coalesce(a.numero_completo, a.id::text)),
        null);
    end loop;
  end if;

  return a;
end;
$function$;

revoke execute on function public.conciliar_albaran(uuid, jsonb, text, text) from public, anon;
grant  execute on function public.conciliar_albaran(uuid, jsonb, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (2) pendents_equip(): `albarans_conciliar` y `albarans_esborrany`
-- ---------------------------------------------------------------------------
-- Copia íntegra de la versión de 20270417100100 (15 colas, mismo orden). Solo cambian esas
-- dos colas; el criterio de cada una va en su comentario.
CREATE OR REPLACE FUNCTION public.pendents_equip()
 RETURNS TABLE(cua text, n integer, ref uuid, detall jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Canalizaciones cuya recogida es ya trabajo del EQUIPO (20270427100000): no anuladas, sin
  -- registrar por el receptor, y con la recogida pasada —que es justo cuando
  -- `programar_albarans_recollida()` le pide al receptor que la registre; si no tiene panel,
  -- la registra el equipo con `confirmar_recollida()`— o, sin hora acordada (a esas el job no
  -- les avisa nunca), con más de 2 días.
  canal_equip as (
    select c.id, c.excedente_id
      from canalizaciones c
     where c.estado <> 'anulada'
       and c.recollida_registrada_at is null
       and (c.data_hora_recollida <= now()
            or (c.data_hora_recollida is null and c.created_at < now() - interval '2 days'))
  ),
  cues as (
    -- ⚠️ Las columnas del CTE NO se llaman `cua`, `n`, `ref` ni `detall`: esos cuatro
    --    nombres son los parámetros OUT de la función, y en plpgsql un identificador que
    --    coincide con una variable se sustituye por ella. `return query` casa por
    --    POSICIÓN, así que llamarlas distinto no cuesta nada y elimina la ambigüedad.
    select 1::numeric as ordre, 'registres'::text as clau,
           (select count(*) from membresias m where m.aprovacio = 'pendent')::int as quants,
           null::uuid as objecte, null::jsonb as extra
    union all
    select 2, 'convenis_contrasignar',
           (select count(*) from convenios cv where cv.estado = 'firmat')::int, null, null
    union all
    -- NUEVA (05-10-2026). Ofertas que esperan a que el equipo las valide antes de salir al
    -- Mercat (`excedentes_validacio`). Va entre los convenios y las respuestas porque es lo
    -- primero que le pasa a una oferta, y el orden de esta lista es el orden del proceso.
    -- Es la cifra del badge de «Ofertes»: no baja al entrar en la sección, solo al validar o
    -- rechazar, porque la oferta se queda parada hasta que alguien decide.
    select 2.5, 'ofertes_per_validar',
           (select count(*) from excedentes e where e.estado = 'pendent_validacio')::int,
           null, null
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
    -- NUEVA (11-10-2026, fase 2 de la revisión del 08-10-2026): ofertas que el PRODUCTOR ha
    -- editado y que el equipo no ha revisado. «Si se modifica una oferta ya publicada,
    -- REDESTINA debería recibir una notificación para revisar si afecta a la canalización.»
    -- Los cambios del propio equipo no cuentan: ya los sabe quien los hizo.
    select 5.5, 'ofertes_modificades',
           (select count(distinct x.excedente_id) from excedentes_canvis x
             where x.revisat_at is null
               and not exists (select 1 from usuario_roles ur where ur.user_id = x.user_id))::int,
           null, null
    union all
    -- «Ofertes sense destí registrat» (revisión del 08-10-2026, fase 1). La clave no cambia
    -- —la usan el badge, el tablero y sus pruebas—, cambia lo que cuenta: ya no «vencidas con
    -- kg sin cubrir» sino ofertas a las que les falta decir qué pasó con algún kilo. Una
    -- `no_colocada` (la «Sense sortida» de la interfaz) cuenta aunque su fecha sea futura: la
    -- marcó el equipo a mano y el destino sigue faltando.
    select 6, 'ofertes_vencudes',
           (select count(*) from excedentes e, param p
             where (e.estado = 'no_colocada'
                    or (e.estado in ('publicada', 'parcial') and e.disponible_hasta < p.avui))
               and (select dx.kg_sense_desti from public.desti_excedent(e.id) dx) > 0)::int,
           null, null
    union all
    -- CAMBIA (20270427100000). Con la recogida registrada por el receptor, cada operación
    -- asignada es un borrador que ESPERA AL RECEPTOR: contarlos todos inflaría la cola con
    -- trabajo que no es del equipo. Cuenta solo:
    --   (a) los de espigolada (REC con `espigolada_id`, o ENT/OPE de un registro de
    --       espigolada): los emite siempre el equipo, el job no los toca;
    --   (b) ENT/OPE cuya canalización está en `canal_equip` (recogida pasada sin registrar, o
    --       sin hora y con más de 2 días);
    --   (c) los REC de una oferta (sin espigolada) solo si alguna de sus canalizaciones está
    --       en `canal_equip`: el REC se emite cuando se registra la última salida;
    --   (d) cualquier otro borrador que no cuelgue ni de una canalización ni de una
    --       espigolada (no hay receptor que lo vaya a cerrar).
    select 7, 'albarans_esborrany',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
             where a.estado = 'borrador'
               and (
                 -- (a)
                 (a.tipo = 'REC' and a.espigolada_id is not null)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is not null)
                 -- (b)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is null
                     and a.canalizacion_id in (select ce.id from canal_equip ce))
                 -- (c)
                 or (a.tipo = 'REC' and a.espigolada_id is null and a.excedente_id is not null
                     and exists (select 1 from canal_equip ce where ce.excedente_id = a.excedente_id))
                 -- (d)
                 or (a.tipo in ('ENT', 'OPE') and a.canalizacion_id is null
                     and coalesce(ex.espigolada_id is null, true))
                 or (a.tipo = 'REC' and a.espigolada_id is null and a.excedente_id is null)
               ))::int, null, null
    union all
    -- CAMBIA (20270427100000). Lo que tiene que conciliar el equipo:
    --   · los REC entregados o confirmados (como siempre);
    --   · los ENT/OPE confirmados SIN REC vivo (venta o maquila; la rama 3 de
    --     `conciliacions_automatiques()`, que en una espigolada mira el REC de la jornada):
    --     con incidencia de recogida el job no los cierra, y hasta hoy no subían el contador;
    --   · los ENT/OPE confirmados con incidencia de recogida cuyo REC ya está conciliado (la
    --     rama 2 del job los salta y nadie más los cuenta).
    select 8, 'albarans_conciliar',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
              left join canalizaciones c on c.id = a.canalizacion_id
             where (a.tipo = 'REC' and a.estado in ('entregado', 'confirmado'))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    and not exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado not in ('anulado', 'rectificado')
                         and (r.excedente_id = a.excedente_id
                              or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id))))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    and c.incidencia_recollida is not null
                    -- ⚠️ Sin `albarans_germans_rec()`: es interna (sin EXECUTE para
                    --    `authenticated`) y esta función es `security invoker`. Misma
                    --    condición, escrita aquí: el REC del excedente o de su jornada.
                    and exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado = 'conciliado'
                         and (r.excedente_id = a.excedente_id
                              or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id)))))::int,
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
               and c.coste_kg is null
               and not exists (select 1 from costes_producto cp
                                where cp.producto = e.producto))::int, null, null
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
$function$;

comment on function public.pendents_equip() is
  'Cola de trabajo consolidada del equipo: una fila por cola (quince), siempre, aunque n = 0. security invoker: agrega solo lo que quien pregunta ya puede leer. albarans_esborrany y albarans_conciliar, recalculadas en 20270427100000 (recogida registrada por el receptor).';
revoke execute on function public.pendents_equip() from public, anon;
grant  execute on function public.pendents_equip() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (3) El aviso `recollida_confirmada`: kilos asignados y si hubo diferencia
-- ---------------------------------------------------------------------------
-- ⚠️ El orden importa. En `registrar_recollida()` la salida pasa a `confirmado` dentro de
--    `confirmar_part_declarada()` → `registrar_confirmacion()`, y
--    `canalizaciones.incidencia_recollida` se escribe DESPUÉS: aquí todavía es null. Por eso
--    `diferencia` sale de los KILOS, que `registrar_confirmacion()` ya ha escrito en las
--    líneas antes de cambiar el estado, y de la incidencia que esa misma actualización deja
--    en `albaranes.incidencias` (`tipus = 'diferencia_kg'`). La columna de la canalización se
--    mira también, para los caminos en que ya está escrita.
create or replace function public.trg_albara_avis_confirmat()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c       canalizaciones;
  ex      excedentes;
  v_ent   text;
  v_kg    numeric;
  v_dif   boolean;
begin
  if new.tipo not in ('ENT', 'OPE') or new.canalizacion_id is null then return new; end if;
  if new.estado not in ('confirmado', 'conciliado')
     or old.estado in ('confirmado', 'conciliado') then return new; end if;
  select * into c from canalizaciones where id = new.canalizacion_id;
  select * into ex from excedentes where id = c.excedente_id;
  select e.nombre into v_ent from entidades e where e.id = c.entidad_id;
  v_kg := coalesce((select sum(coalesce(l.kg_confirmados, l.kg_neto, l.kg_previstos))
                      from albaran_lineas l where l.albaran_id = new.id), c.kg_confirmados);
  v_dif := c.incidencia_recollida is not null
        or (jsonb_typeof(new.incidencias) = 'array'
            and new.incidencias @> '[{"tipus": "diferencia_kg"}]'::jsonb)
        or (c.kg_confirmados is not null and v_kg is not null
            and round(v_kg, 2) <> round(c.kg_confirmados, 2));
  perform public.crear_avis('productor', ex.productor_id, 'recollida_confirmada', 'excedente', ex.id,
    jsonb_build_object('producte', ex.producto, 'kg', v_kg, 'entitat', v_ent,
                       'recollida_at', c.data_hora_recollida, 'excedente_id', ex.id,
                       'kg_assignats', c.kg_confirmados,
                       'diferencia', coalesce(v_dif, false)));
  return new;
end;
$$;

revoke execute on function public.trg_albara_avis_confirmat() from public, anon, authenticated;
