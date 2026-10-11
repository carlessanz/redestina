-- Fase 1 de la revisión del 08-10-2026 (segunda mitad): EL JOB DE VENCIDAS Y LA COLA.
--
-- Separada de `20270416100000` para poder revertirla sola: recrea `pendents_equip()` entera.
--
-- EL JOB, antes: pasaba a `no_colocada` cualquier `borrador`/`publicada`/`parcial` vencida
-- con kilos sin cubrir — también una `parcial` con canalizaciones vivas, que el productor
-- pasaba a ver como «Sense sortida» con una recogida en marcha.
--
-- AHORA, tres casos (umbral real: `disponible_hasta < current_date - 1`, o sea anteayer):
--   1. `pendent_validacio` vencida → `cancelada` (igual que antes: nadie la validó).
--   2. `borrador`/`publicada` vencida con kilos sin destino → `no_colocada` («Sense sortida»)
--      + `desti_reclamat_at` + aviso `oferta_sense_desti` al productor.
--   3. `parcial`/`bloqueada` vencida con kilos sin destino → SOLO `desti_reclamat_at` +
--      aviso, sin cambiar el estado: las canalizaciones y sus albaranes siguen su curso, y
--      lo que se le pide al productor es el destino de lo que sobra.
-- Idempotente por `desti_reclamat_at`: el aviso sale una vez. Las `no_colocada` que ya
-- existían NO reciben aviso retroactivo; salen en la cola del equipo.

create or replace function public.marcar_excedentes_vencidos()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sense_validar integer;
  sense_sortida integer := 0;
  reclamats     integer := 0;
  r             record;
begin
  update excedentes e
     set estado = 'cancelada',
         motivo_no_colocada = coalesce(e.motivo_no_colocada, 'no validada a temps')
   where e.estado = 'pendent_validacio'
     and e.disponible_hasta is not null
     and e.disponible_hasta < current_date - 1;
  get diagnostics sense_validar = row_count;

  for r in
    select e.id, e.estado, e.productor_id, e.producto, e.id_excedente, dx.kg_sense_desti
      from excedentes e
      cross join lateral public.desti_excedent(e.id) dx
     where e.estado in ('borrador', 'publicada', 'parcial', 'bloqueada')
       and e.disponible_hasta is not null
       and e.disponible_hasta < current_date - 1
       and e.desti_reclamat_at is null
       and dx.kg_sense_desti > 0
  loop
    if r.estado in ('borrador', 'publicada') then
      update excedentes
         set estado = 'no_colocada',
             motivo_no_colocada = coalesce(motivo_no_colocada, 'vencida sense destí registrat'),
             desti_reclamat_at = now()
       where id = r.id;
      sense_sortida := sense_sortida + 1;
    else
      update excedentes set desti_reclamat_at = now() where id = r.id;
      reclamats := reclamats + 1;
    end if;
    perform public.crear_avis('productor', r.productor_id, 'oferta_sense_desti', 'excedente', r.id,
      jsonb_build_object('producte', r.producto, 'ref', r.id_excedente, 'kg', r.kg_sense_desti));
  end loop;

  raise notice 'marcar_excedentes_vencidos: % sense sortida, % amb destí reclamat, % cancel·lades sense validar',
    sense_sortida, reclamats, sense_validar;
  return sense_sortida + reclamats + sense_validar;
end;
$$;

revoke execute on function public.marcar_excedentes_vencidos() from public, anon, authenticated;
grant execute on function public.marcar_excedentes_vencidos() to service_role;

-- La cola del equipo: `ofertes_vencudes` pasa a contar «ofertes sense destí registrat».
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
