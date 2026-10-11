-- Fase 2 de la revisión del 08-10-2026 (segunda mitad): AVISOS DE LOS CAMBIOS, «OFERTES PER
-- A TU» Y LA COLA DE OFERTAS MODIFICADAS.
--
-- QUÉ PIDE LA FUNDACIÓ. «Necesitamos un sistema de notificaciones para cambios relevantes en
-- los intereses: si se modifica la cantidad asignada, si se confirma o cambia la fecha o hora
-- de recogida, si se asigna o rechaza…» y, del lado del productor, que reciba la
-- actualización cuando el receptor confirma la recogida. Además: «Notificación también debe
-- llegar a la entidad o empresa que iba a comprar o recibir» cuando el productor edita su
-- oferta; y que una oferta que el equipo envía a un receptor quede registrada en su panel
-- («Ofertes per a tu») con «M'interessa» y «No m'interessa».
--
-- ⚠️ PUBLICAR `enviar-avis` ANTES que esta migración: marca `tipus_desconegut` DEFINITIVAMENTE
--    cualquier tipo que su `TIPUS_AVIS` no conozca.

-- --- 1. Tipos y objetos nuevos -------------------------------------------------------------

alter table public.avisos drop constraint if exists avisos_tipus_check;
alter table public.avisos add constraint avisos_tipus_check check (tipus in (
  'oferta_validada', 'oferta_rebutjada', 'sortida_trobada', 'interes_aprovat',
  'interes_rebutjat', 'oferta_sense_desti',
  'recollida_canviada', 'kg_assignats_canviats', 'recollida_confirmada',
  'oferta_modificada', 'oferta_enviada'));

-- `canalizacion`: una entrega que no nació de un interés (reparto de una espigolada, alta
-- directa del equipo) no tiene `oferta_resposta` a la que colgar el aviso del receptor.
alter table public.avisos drop constraint if exists avisos_objecte_tipo_check;
alter table public.avisos add constraint avisos_objecte_tipo_check check (
  objecte_tipo in ('excedente', 'oferta_resposta', 'canalizacion'));

-- --- 2. Cambios en una canalización: hora de recogida y kilos ------------------------------

-- A las DOS partes. Solo cuando ya había un valor: el primero lo pone la aprobación, que ya
-- avisa con `interes_aprovat`/`sortida_trobada`, o `emitir_albaran()`, que rellena la fecha si
-- estaba vacía y eso no es un cambio que comunicar.
create or replace function public.trg_canalitzacio_avis_canvis()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex      excedentes;
  v_resp  uuid;
  v_ent   text;
  v_tipus text;
  v_par   jsonb;
begin
  if new.estado = 'anulada' then return new; end if;
  if old.data_hora_recollida is not null
     and new.data_hora_recollida is distinct from old.data_hora_recollida then
    v_tipus := 'recollida_canviada';
  elsif old.kg_confirmados is not null
     and new.kg_confirmados is distinct from old.kg_confirmados then
    v_tipus := 'kg_assignats_canviats';
  else
    return new;
  end if;

  select * into ex from excedentes where id = new.excedente_id;
  select r.id into v_resp from oferta_respuestas r where r.canalizacion_id = new.id limit 1;
  select e.nombre into v_ent from entidades e where e.id = new.entidad_id;
  v_par := jsonb_build_object(
    'producte', ex.producto, 'kg', new.kg_confirmados, 'kg_abans', old.kg_confirmados,
    'recollida_at', new.data_hora_recollida, 'entitat', v_ent, 'excedente_id', ex.id);

  perform public.crear_avis('entidad', new.entidad_id, v_tipus,
    case when v_resp is null then 'canalizacion' else 'oferta_resposta' end,
    coalesce(v_resp, new.id), v_par);
  perform public.crear_avis('productor', ex.productor_id, v_tipus, 'excedente', ex.id, v_par);
  return new;
end;
$$;

revoke execute on function public.trg_canalitzacio_avis_canvis() from public, anon, authenticated;

drop trigger if exists canalizaciones_avis_canvis on public.canalizaciones;
create trigger canalizaciones_avis_canvis
  after update of data_hora_recollida, kg_confirmados on public.canalizaciones
  for each row execute function public.trg_canalitzacio_avis_canvis();

-- --- 3. La recogida confirmada: al productor ----------------------------------------------

-- «Si el receptor acepta una donación y confirma la recogida, la oferta debería actualizarse
-- automáticamente … y el productor debería recibir una notificación.» Cuando el albarán de
-- SALIDA (ENT/OPE) de una canalización queda confirmado —o conciliado sin pasar por ahí—.
create or replace function public.trg_albara_avis_confirmat()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c     canalizaciones;
  ex    excedentes;
  v_ent text;
  v_kg  numeric;
begin
  if new.tipo not in ('ENT', 'OPE') or new.canalizacion_id is null then return new; end if;
  if new.estado not in ('confirmado', 'conciliado')
     or old.estado in ('confirmado', 'conciliado') then return new; end if;
  select * into c from canalizaciones where id = new.canalizacion_id;
  select * into ex from excedentes where id = c.excedente_id;
  select e.nombre into v_ent from entidades e where e.id = c.entidad_id;
  v_kg := coalesce((select sum(coalesce(l.kg_confirmados, l.kg_neto, l.kg_previstos))
                      from albaran_lineas l where l.albaran_id = new.id), c.kg_confirmados);
  perform public.crear_avis('productor', ex.productor_id, 'recollida_confirmada', 'excedente', ex.id,
    jsonb_build_object('producte', ex.producto, 'kg', v_kg, 'entitat', v_ent,
                       'recollida_at', c.data_hora_recollida, 'excedente_id', ex.id));
  return new;
end;
$$;

revoke execute on function public.trg_albara_avis_confirmat() from public, anon, authenticated;

drop trigger if exists albaranes_avis_confirmat on public.albaranes;
create trigger albaranes_avis_confirmat
  after update of estado on public.albaranes
  for each row execute function public.trg_albara_avis_confirmat();

-- --- 4. La oferta modificada: a quien tiene interés o entrega, y al equipo ----------------

alter table public.excedentes_canvis add column if not exists revisat_at  timestamptz;
alter table public.excedentes_canvis add column if not exists revisat_per uuid;

create or replace function public.trg_canvis_avis()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex excedentes;
  r  record;
  v_camps text;
begin
  select * into ex from excedentes where id = new.excedente_id;
  select string_agg(k, ',' order by k) into v_camps from jsonb_object_keys(new.despres) k;
  -- Las entidades con un interés vivo (aceptado y no rechazado) o con una entrega no anulada.
  for r in
    select distinct on (x.entidad_id) x.entidad_id, x.resp_id, x.can_id
      from (
        select o.entidad_id, o.id as resp_id, o.canalizacion_id as can_id
          from oferta_respuestas o
         where o.excedente_id = ex.id and o.estado = 'acceptada' and o.aprovacio <> 'rebutjada'
        union all
        select c.entidad_id, null::uuid, c.id
          from canalizaciones c
         where c.excedente_id = ex.id and c.estado <> 'anulada'
      ) x
     where x.entidad_id is not null
     order by x.entidad_id, x.resp_id nulls last
  loop
    perform public.crear_avis('entidad', r.entidad_id, 'oferta_modificada',
      case when r.resp_id is null then 'canalizacion' else 'oferta_resposta' end,
      coalesce(r.resp_id, r.can_id),
      jsonb_build_object('producte', ex.producto, 'camps', v_camps, 'excedente_id', ex.id));
  end loop;
  return new;
end;
$$;

revoke execute on function public.trg_canvis_avis() from public, anon, authenticated;

drop trigger if exists excedentes_canvis_avis on public.excedentes_canvis;
create trigger excedentes_canvis_avis
  after insert on public.excedentes_canvis
  for each row execute function public.trg_canvis_avis();

-- El equipo da por revisados los cambios de una oferta. Sin GRANT de UPDATE en la tabla.
create or replace function public.marcar_canvis_revisats(p_excedente uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip revisa els canvis d''una oferta' using errcode = '42501';
  end if;
  update excedentes_canvis
     set revisat_at = now(), revisat_per = auth.uid()
   where excedente_id = p_excedente and revisat_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.marcar_canvis_revisats(uuid) from public, anon;
grant execute on function public.marcar_canvis_revisats(uuid) to authenticated, service_role;

-- --- 5. «Ofertes per a tu»: lo que el equipo envía por el panel --------------------------

-- Una fila `pendent` con `canal = 'panel'` es una oferta que el equipo le ha propuesto a esa
-- entidad desde la plataforma: se le avisa por su canal (correo o WhatsApp, `enviar-avis`).
-- WhatsApp y correo ya llevan el texto de la oferta, así que esos dos canales no avisan.
create or replace function public.trg_resposta_avis_enviada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare ex excedentes;
begin
  if new.canal <> 'panel' or new.estado <> 'pendent' then return new; end if;
  if tg_op = 'UPDATE' and new.enviado_at is not distinct from old.enviado_at then return new; end if;
  select * into ex from excedentes where id = new.excedente_id;
  perform public.crear_avis('entidad', new.entidad_id, 'oferta_enviada', 'oferta_resposta', new.id,
    jsonb_build_object('producte', ex.producto, 'kg', ex.kg_total, 'comarca', ex.comarca,
                       'excedente_id', ex.id));
  return new;
end;
$$;

revoke execute on function public.trg_resposta_avis_enviada() from public, anon, authenticated;

drop trigger if exists oferta_respuestas_avis_enviada on public.oferta_respuestas;
create trigger oferta_respuestas_avis_enviada
  after insert or update of enviado_at on public.oferta_respuestas
  for each row execute function public.trg_resposta_avis_enviada();

-- «No m'interessa» desde el panel. Hasta hoy la entidad no escribía en `oferta_respuestas`
-- salvo por `manifestar_interes()`: el «no» solo podía llegar por WhatsApp o lo marcaba el
-- equipo a mano. Como en `fixar_fotos_oferta`, el permiso va antes que la existencia.
create or replace function public.declinar_oferta(p_resposta uuid)
returns oferta_respuestas
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare r oferta_respuestas;
begin
  select * into r from oferta_respuestas where id = p_resposta for update;
  if not coalesce(r.entidad_id in (select public.mis_entidades()), false) then
    raise exception 'Aquesta oferta no és per a tu' using errcode = '42501';
  end if;
  if r.estado <> 'pendent' then
    raise exception 'ja_resposta' using errcode = '22023';
  end if;
  update oferta_respuestas
     set estado = 'rebutjada', respondido_at = now(),
         mensaje_respuesta = coalesce(mensaje_respuesta, 'No m''interessa (panell)')
   where id = p_resposta
  returning * into r;
  return r;
end;
$$;

revoke execute on function public.declinar_oferta(uuid) from public, anon;
grant execute on function public.declinar_oferta(uuid) to authenticated, service_role;

-- --- 6. La cola del equipo: 15 colas --------------------------------------------------------
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
