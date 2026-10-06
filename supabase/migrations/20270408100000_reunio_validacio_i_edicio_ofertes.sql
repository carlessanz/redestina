-- Reunión de revisión con Sebastián (octubre 2026): lo que la base necesita para los cambios
-- acordados en el flujo de oferta. Todo idempotente: la primera base donde corre es la real (§7).
--
--   1. Estado `pendent_validacio`: una oferta nueva no sale al Mercat hasta que el equipo la
--      valida. La RLS de `excedentes` ya solo enseña `publicada`/`parcial` a las receptoras, así
--      que el estado nuevo queda fuera del Mercat sin tocar la política.
--   2. `modalitats text[]`: el productor puede marcar VARIAS (donació, venda, maquila) cuando no
--      sabe cuál le conviene. La DEFINITIVA la fija el equipo al validar, en `modalitat`, que es
--      la columna que ya usa todo el circuito (compatibilidad, convenios, albaranes). Así nada
--      de lo que viene detrás cambia: lo que cambia es quién decide y cuándo.
--   3. La franja de recogida (`horari_desde`, `horari_fins`) en cuartos de hora.
--   4. `validar_oferta()`: la puerta del estado nuevo.
--   5. `excedente_edicions`: el rastro de cada edición de una oferta publicada (la edición la
--      hace `crear-oferta` en PATCH, porque el `texto_oferta` se compone en TypeScript).
--   6. La hora a la que la receptora irá a recoger (`recollida_prevista`) y su paso a la
--      canalización al aprobar.
--   7. El bloqueo por albarán sin confirmar más de 48 h.
--   8. `pendents_equip()` gana la cola 14, `ofertes_per_validar`, que es el badge persistente
--      de «Ofertes» en el menú del equipo.

-- ---------------------------------------------------------------------------------------
-- 1. El estado nuevo
-- ---------------------------------------------------------------------------------------
alter table excedentes drop constraint if exists excedentes_estado_check;
alter table excedentes add constraint excedentes_estado_check
  check (estado in (
    'borrador', 'pendent_validacio', 'publicada', 'parcial', 'bloqueada', 'cerrada',
    'no_colocada', 'cancelada'
  ));

-- ---------------------------------------------------------------------------------------
-- 2 y 3. Columnas nuevas de la oferta
-- ---------------------------------------------------------------------------------------
alter table excedentes add column if not exists modalitats   text[] not null default '{}';
alter table excedentes add column if not exists horari_desde time;
alter table excedentes add column if not exists horari_fins  time;
alter table excedentes add column if not exists validada_at  timestamptz;
alter table excedentes add column if not exists validada_per uuid references auth.users (id) on delete set null;

alter table excedentes drop constraint if exists excedentes_modalitats_valides;
alter table excedentes add constraint excedentes_modalitats_valides
  check (modalitats <@ array['donacio', 'venda', 'maquila']::text[]);

alter table excedentes drop constraint if exists excedentes_franja_ordenada;
alter table excedentes add constraint excedentes_franja_ordenada
  check (horari_desde is null or horari_fins is null or horari_desde < horari_fins);

-- Relleno: las ofertas que ya existen tienen UNA modalidad y es la definitiva.
update excedentes
   set modalitats = array[modalitat]
 where modalitat is not null
   and modalitats = '{}';

comment on column excedentes.modalitats is
  'Las modalidades que el productor acepta (puede marcar varias). La definitiva vive en `modalitat` y la fija el equipo en validar_oferta().';
comment on column excedentes.horari_desde is 'Inicio de la franja de recogida que da el productor (cuartos de hora).';
comment on column excedentes.horari_fins  is 'Final de la franja de recogida que da el productor.';

-- ---------------------------------------------------------------------------------------
-- 4. validar_oferta()
-- ---------------------------------------------------------------------------------------
-- ⚠️ `pot_aprovar()` (admin y super_admin), como aprobar un interés: es la misma decisión de
--    negocio —esto puede circular— y el técnico la ve en gris con el motivo (§6ter).
-- ⚠️ El convenio se exige con la modalidad DEFINITIVA, no con las marcadas: con varias, el
--    productor puede tener solo el de una, y es justo para eso que existe este paso.
create or replace function public.validar_oferta(
  p_excedente uuid,
  p_modalitat text default null
) returns excedentes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex    excedentes;
  v_mod text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'no_autoritzat: només admin pot validar ofertes' using errcode = '42501';
  end if;

  select * into ex from excedentes where id = p_excedente for update;
  if ex.id is null then
    raise exception 'oferta_inexistent: aquesta oferta no existeix' using errcode = '22023';
  end if;
  if ex.estado <> 'pendent_validacio' then
    raise exception 'no_pendent: aquesta oferta no està pendent de validació' using errcode = '22023';
  end if;

  v_mod := coalesce(
    nullif(p_modalitat, ''),
    case when cardinality(ex.modalitats) = 1 then ex.modalitats[1] end,
    ex.modalitat
  );
  if v_mod is null then
    raise exception 'cal_modalitat: tria la modalitat definitiva' using errcode = '22023';
  end if;
  if v_mod not in ('donacio', 'venda', 'maquila') then
    raise exception 'modalitat_invalida: %', v_mod using errcode = '22023';
  end if;
  if v_mod in ('venda', 'maquila') and ex.preu_minim is null then
    raise exception 'cal_preu: per a venda o maquila cal un preu mínim; edita l''oferta abans de validar-la'
      using errcode = '22023';
  end if;

  -- Antes de la fecha de corte avisa (y el aviso se descarta); después, 42501 sense_conveni.
  if ex.productor_id is not null then
    perform public.exigir_convenio('productor', ex.productor_id, v_mod, 'entrega');
  end if;

  update excedentes
     set estado       = 'publicada',
         modalitat    = v_mod,
         modalitats   = case when v_mod = any (modalitats) then modalitats
                             else array_append(modalitats, v_mod) end,
         -- El coste declarado solo vale para una donación (es lo que valora el certificado).
         coste_kg     = case when v_mod = 'donacio' then coste_kg else null end,
         validada_at  = now(),
         validada_per = auth.uid()
   where id = p_excedente
  returning * into ex;

  return ex;
end;
$$;

revoke execute on function public.validar_oferta(uuid, text) from public, anon;
grant  execute on function public.validar_oferta(uuid, text) to authenticated, service_role;

comment on function public.validar_oferta(uuid, text) is
  'Pasa una oferta de pendent_validacio a publicada fijando la modalidad definitiva. pot_aprovar(). Exige el convenio de esa modalidad a quien entrega.';

-- ---------------------------------------------------------------------------------------
-- 5. El rastro de las ediciones
-- ---------------------------------------------------------------------------------------
create table if not exists excedente_edicions (
  id            uuid primary key default gen_random_uuid(),
  excedente_id  uuid not null references excedentes (id) on delete cascade,
  editat_per    uuid references auth.users (id) on delete set null,
  editat_at     timestamptz not null default now(),
  canal         text not null check (canal in ('panel', 'asistido')),
  -- {campo: {abans, despres}} — solo lo que cambió.
  canvis        jsonb not null
);
create index if not exists excedente_edicions_excedente_idx
  on excedente_edicions (excedente_id, editat_at desc);

alter table excedente_edicions enable row level security;
-- Sin escritura para nadie con sesión: la escribe `crear-oferta` con service_role (§4).
revoke all on excedente_edicions from public, anon, authenticated;
grant select on excedente_edicions to authenticated;
grant all on excedente_edicions to service_role;

drop policy if exists "edicions: equip o productor" on excedente_edicions;
create policy "edicions: equip o productor" on excedente_edicions
  for select to authenticated
  using (
    (select public.es_intern())
    or excedente_id in (select public.excedents_dels_meus_productors())
  );

-- ---------------------------------------------------------------------------------------
-- 6. La hora de recogida que indica la receptora
-- ---------------------------------------------------------------------------------------
alter table oferta_respuestas add column if not exists recollida_prevista timestamptz;
alter table canalizaciones    add column if not exists recollida_prevista timestamptz;

comment on column oferta_respuestas.recollida_prevista is
  'Cuándo dice la receptora que irá a recoger, dentro de la franja del productor. Pasa a la canalización al aprobar.';
comment on column canalizaciones.recollida_prevista is
  'La recogida acordada. ⚠️ NO es data_hora_recollida, que decide el ejercicio fiscal y la escribe emitir_albaran().';

create or replace function public.fixar_recollida_interes(
  p_resposta uuid,
  p_quan     timestamptz
) returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      oferta_respuestas;
  ex     excedentes;
  v_hora time;
  v_dia  date;
begin
  select * into r from oferta_respuestas where id = p_resposta for update;
  if r.id is null then
    raise exception 'resposta_inexistent: aquest interès no existeix' using errcode = '22023';
  end if;

  if auth.uid() is not null and not public.es_intern() then
    if r.entidad_id is null or r.entidad_id not in (select public.mis_entidades()) then
      raise exception 'no_autoritzat: aquest interès no és teu' using errcode = '42501';
    end if;
    -- Una vez decidido, la hora la mueve el equipo, que es quien coordina con el productor.
    if r.aprovacio <> 'pendent' then
      raise exception 'ja_decidit: l''equip ja ha decidit aquest interès; parla amb l''equip per canviar l''hora'
        using errcode = '22023';
    end if;
  end if;

  if p_quan is null then
    raise exception 'cal_hora: indica quan aniràs a recollir' using errcode = '22023';
  end if;

  v_hora := (p_quan at time zone 'Europe/Madrid')::time;
  v_dia  := (p_quan at time zone 'Europe/Madrid')::date;
  if extract(minute from v_hora)::int not in (0, 15, 30, 45) or extract(second from v_hora) <> 0 then
    raise exception 'hora_quarts: l''hora va en quarts d''hora (00, 15, 30, 45)' using errcode = '22023';
  end if;
  if v_dia < (now() at time zone 'Europe/Madrid')::date then
    raise exception 'hora_passada: el dia de recollida ja ha passat' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = r.excedente_id;
  if ex.disponible_hasta is not null and v_dia > ex.disponible_hasta then
    raise exception 'fora_disponibilitat: l''oferta només està disponible fins al %',
      to_char(ex.disponible_hasta, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if ex.horari_desde is not null and ex.horari_fins is not null
     and (v_hora < ex.horari_desde or v_hora > ex.horari_fins) then
    raise exception 'fora_franja: el productor ha indicat la franja de % a %',
      to_char(ex.horari_desde, 'HH24:MI'), to_char(ex.horari_fins, 'HH24:MI') using errcode = '22023';
  end if;

  update oferta_respuestas set recollida_prevista = p_quan where id = r.id returning * into r;
  if r.canalizacion_id is not null then
    update canalizaciones set recollida_prevista = p_quan where id = r.canalizacion_id;
  end if;
  return r;
end;
$$;

revoke execute on function public.fixar_recollida_interes(uuid, timestamptz) from public, anon;
grant  execute on function public.fixar_recollida_interes(uuid, timestamptz) to authenticated, service_role;

-- Al aprobar, `aprovar_resposta()` crea la canalización y escribe `canalizacion_id` en la
-- respuesta. Se copia la hora AHÍ, por trigger, para no recrear `aprovar_resposta()` (una
-- RPC del circuito legal) por un dato de coordinación.
create or replace function public.trg_respuestas_copia_recollida()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.canalizacion_id is not null
     and old.canalizacion_id is null
     and new.recollida_prevista is not null then
    update canalizaciones
       set recollida_prevista = new.recollida_prevista
     where id = new.canalizacion_id
       and recollida_prevista is null;
  end if;
  return new;
end;
$$;

drop trigger if exists respuestas_copia_recollida on oferta_respuestas;
create trigger respuestas_copia_recollida
  after update of canalizacion_id on oferta_respuestas
  for each row execute function public.trg_respuestas_copia_recollida();

-- ---------------------------------------------------------------------------------------
-- 7. Bloqueo por albarán sin confirmar
-- ---------------------------------------------------------------------------------------
-- La regla (acordada el 06-10-2026): con un albarán entregado y sin confirmar por su parte
-- desde hace más de 48 h, el productor no publica ofertas nuevas y la receptora no acepta
-- nuevas. Las horas viven en `app_settings.hores_bloqueig_albara` (por defecto 48).
--
-- ⚠️ «Pendiente POR SU PARTE»: en un OPE confirman las dos partes por separado, así que una
--    que ya confirmó no queda bloqueada por la otra.
create or replace function public.hores_bloqueig_albara()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select nullif(value, '')::int from app_settings where key = 'hores_bloqueig_albara'),
    48
  );
$$;

revoke execute on function public.hores_bloqueig_albara() from public, anon;
grant  execute on function public.hores_bloqueig_albara() to authenticated, service_role;

create or replace function public.albarans_bloquejants(p_tipo_org text, p_org uuid)
returns table (albaran_id uuid, numero text, tipo text, entregado_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'tipus_invalid: %', p_tipo_org using errcode = '22023';
  end if;
  if auth.uid() is not null and not public.es_intern() then
    if (p_tipo_org = 'productor' and p_org not in (select public.mis_productores()))
       or (p_tipo_org = 'entidad' and p_org not in (select public.mis_entidades())) then
      raise exception 'no_autoritzat: aquesta organització no és teva' using errcode = '42501';
    end if;
  end if;

  return query
  select a.id, a.numero_completo, a.tipo, a.entregado_at
    from albaranes a
    left join canalizaciones c on c.id = a.canalizacion_id
    left join excedentes     e on e.id = a.excedente_id
    left join espigoladas   es on es.id = a.espigolada_id
   where a.estado = 'entregado'
     and a.entregado_at < now() - make_interval(hours => public.hores_bloqueig_albara())
     and (
          (p_tipo_org = 'productor' and a.tipo in ('REC', 'OPE')
             and coalesce(e.productor_id, es.productor_id) = p_org)
       or (p_tipo_org = 'entidad' and a.tipo in ('ENT', 'OPE')
             and c.entidad_id = p_org)
     )
     and not exists (
       select 1 from enlaces_token t
        where t.objeto_tipo = 'albaran'
          and t.objeto_id   = a.id
          and t.proposito   = 'confirmacion_albaran'
          and t.usado_at is not null
          and (t.rol_parte is null
               or t.rol_parte = case p_tipo_org when 'productor' then 'entrega' else 'recibe' end)
     )
   order by a.entregado_at;
end;
$$;

revoke execute on function public.albarans_bloquejants(text, uuid) from public, anon;
grant  execute on function public.albarans_bloquejants(text, uuid) to authenticated, service_role;

comment on function public.albarans_bloquejants(text, uuid) is
  'Albaranes entregados que esta organización no ha confirmado tras hores_bloqueig_albara() horas. Con alguno, no publica (productor) ni acepta (entidad).';

-- La mitad de la receptora: `manifestar_interes()` deja la fila con canal 'panel' y estado
-- 'acceptada'. Un trigger y no una línea dentro de la RPC para no recrearla (su última
-- versión es 20270407100000). Solo el canal 'panel': el asistido lo conduce el equipo, que es
-- quien puede resolver el albarán en la misma llamada, y por WhatsApp un rechazo de la base
-- dejaría el diálogo del bot sin respuesta (queda anotado en AGENTS.md).
create or replace function public.trg_respuestas_bloqueig_albara()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.canal = 'panel'
     and new.estado = 'acceptada'
     and new.entidad_id is not null
     and (tg_op = 'INSERT'
          or old.estado is distinct from 'acceptada'
          or old.canal  is distinct from 'panel')
     and exists (
       select 1
         from albaranes a
         left join canalizaciones c on c.id = a.canalizacion_id
        where a.estado = 'entregado'
          and a.tipo in ('ENT', 'OPE')
          and c.entidad_id = new.entidad_id
          and a.entregado_at < now() - make_interval(hours => public.hores_bloqueig_albara())
          and not exists (
            select 1 from enlaces_token t
             where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
               and t.proposito = 'confirmacion_albaran' and t.usado_at is not null
               and (t.rol_parte is null or t.rol_parte = 'recibe'))
     ) then
    raise exception 'albara_pendent: tens un albarà pendent de confirmar des de fa més de % hores',
      public.hores_bloqueig_albara() using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists respuestas_bloqueig_albara on oferta_respuestas;
create trigger respuestas_bloqueig_albara
  before insert or update on oferta_respuestas
  for each row execute function public.trg_respuestas_bloqueig_albara();

-- ---------------------------------------------------------------------------------------
-- 8. pendents_equip(): la cola 14
-- ---------------------------------------------------------------------------------------
-- Copia literal de la versión vigente (20270405100200) más la cola 14. ⚠️ Recrearla con
-- `create or replace` conserva la firma y los GRANT; las trece colas de antes no cambian.
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
    select 13, 'espigolades_per_convertir',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and e.producte_al_camp
               and e.espigolada_id is null)::int, null, null
    union all
    -- NUEVA (06-10-2026). Ofertas que esperan la validación del equipo antes de salir al
    -- Mercat. Es el badge de «Ofertes»: persistente hasta que alguien actúa sobre ellas
    -- (validar o cancelar), porque si el equipo no responde el proceso se para.
    select 14, 'ofertes_per_validar',
           (select count(*) from excedentes e where e.estado = 'pendent_validacio')::int,
           null, null
  )
  select q.clau, q.quants, q.objecte, q.extra from cues q order by q.ordre;
end;
$function$;

-- ---------------------------------------------------------------------------------------
-- 9. El productor también cancela una oferta que todavía espera validación
-- ---------------------------------------------------------------------------------------
-- Copia de 20260730097000 con `pendent_validacio` en la lista. Mismos GRANT (create or
-- replace los conserva).
create or replace function public.cancelar_meva_oferta(p_excedente uuid, p_motiu text)
returns excedentes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex excedentes;
begin
  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.productor_id not in (select public.mis_productores()) then
    raise exception 'Aquesta oferta no es teva' using errcode = '42501';
  end if;
  if ex.estado not in ('borrador', 'pendent_validacio', 'publicada', 'parcial') then
    raise exception 'Aquesta oferta ja no es pot cancel·lar' using errcode = '22023';
  end if;
  update excedentes
     set estado = 'cancelada',
         motivo_no_colocada = coalesce(p_motiu, motivo_no_colocada)
   where id = p_excedente
  returning * into ex;
  return ex;
end;
$$;
