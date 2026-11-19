-- Fase 2 del plan de los puntos 4-6 (cambio A1): ASIGNACIÓN EN UN SOLO ACTO y precio de venta.
--
-- Dos niveles de asignación:
--   · nivel 2 (como hasta ahora): la entidad muestra interés (o el equipo lo registra asistido)
--     y un admin lo aprueba en Aprovacions con `aprovar_resposta()`;
--   · nivel 1 (nuevo): el equipo con `pot_aprovar()` registra y confirma la asignación en un
--     acto, `assignar_directe()`. No deja nada en Aprovacions.
--
-- Venta: el precio acordado y la aceptación del ofertante viven en la CANALIZACIÓN (es el
-- registro de la operación y las dos partes ya la leen por RLS). En el nivel 1 son
-- obligatorios (`22023 cal_preu_acordat` / `cal_preu_acceptat`); en el nivel 2 todavía no (la
-- fase 3 los exigirá al validar la recogida) y se fijan con `fixar_preu_acordat()`.
-- `oferta_respuestas.preu_ofert` sigue siendo lo que ofreció la entidad.
--
-- Maquila: SIN precio (cierra la deuda 180). `comprova_interes`, `manifestar_interes` y
-- `manifestar_interes_assistit` solo miran `preu_minim`/`preu_ofert` en venta; el frontend
-- publicado sigue mandando el precio en maquila y ahora se ignora.
--
-- Esta migración:
--   1. Columnas `canalizaciones.preu_acordat_kg`, `preu_acceptat_at`, `preu_acceptat_per` (con
--      sus checks) y `oferta_respuestas.aprovat_per`, `assignacio_directa`.
--   2. Protecciones: el trigger de B2 cubre también el precio; `trg_respuestas_control_aprovacio`
--      cubre `aprovat_per` y `assignacio_directa`.
--   3. Deuda 180 en las tres funciones del interés (mismas firmas).
--   4. `aprova_resposta_intern()` (interna): el cuerpo de `aprovar_resposta` sin la guarda.
--   5. `aprovar_resposta()`: drop de la firma de seis + create con `p_preu_acceptat` al final
--      (default null). El frontend publicado llama con seis argumentos CON NOMBRE y PostgREST
--      los resuelve contra la nueva por el default (lo prueba el arnés).
--   6. `assignar_directe()` y `fixar_preu_acordat()`.

-- ---------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------
alter table public.canalizaciones
  add column if not exists preu_acordat_kg   numeric,
  add column if not exists preu_acceptat_at  timestamptz,
  add column if not exists preu_acceptat_per uuid references auth.users(id) on delete set null;

-- Columnas nuevas (todo nulo): los checks se validan al momento, pero con la norma de siempre.
alter table public.canalizaciones drop constraint if exists canalizaciones_preu_acordat_check;
alter table public.canalizaciones add constraint canalizaciones_preu_acordat_check
  check (preu_acordat_kg is null or preu_acordat_kg >= 0) not valid;
alter table public.canalizaciones validate constraint canalizaciones_preu_acordat_check;

alter table public.canalizaciones drop constraint if exists canalizaciones_preu_acordat_venda;
alter table public.canalizaciones add constraint canalizaciones_preu_acordat_venda
  check (coalesce(valorizacion, '') = 'venda'
         or (preu_acordat_kg is null and preu_acceptat_at is null)) not valid;
alter table public.canalizaciones validate constraint canalizaciones_preu_acordat_venda;

alter table public.canalizaciones drop constraint if exists canalizaciones_preu_acceptat_amb_preu;
alter table public.canalizaciones add constraint canalizaciones_preu_acceptat_amb_preu
  check (preu_acceptat_at is null or preu_acordat_kg is not null) not valid;
alter table public.canalizaciones validate constraint canalizaciones_preu_acceptat_amb_preu;

comment on column public.canalizaciones.preu_acordat_kg is
  'Venta: precio acordado (EUR/kg) entre las partes. Solo venta (check). Obligatorio en assignar_directe; en el nivel 2, fixar_preu_acordat (20270607100000).';
comment on column public.canalizaciones.preu_acceptat_at is
  'Venta: cuándo consta que el ofertante aceptó el precio acordado (lo registra el equipo).';
comment on column public.canalizaciones.preu_acceptat_per is
  'Quién del equipo registró la aceptación del precio.';

alter table public.oferta_respuestas
  add column if not exists aprovat_per        uuid references auth.users(id) on delete set null,
  add column if not exists assignacio_directa boolean not null default false;

comment on column public.oferta_respuestas.aprovat_per is
  'Quién aprobó la respuesta (aprovar_resposta) o asignó directamente (assignar_directe). Nulo en las anteriores a 20270607100000.';
comment on column public.oferta_respuestas.assignacio_directa is
  'true = asignación de nivel 1 (assignar_directe): el equipo registró y confirmó en un acto; no pasó por Aprovacions.';

-- ---------------------------------------------------------------------------
-- 2a. El trigger de B2, con el precio
-- ---------------------------------------------------------------------------
create or replace function public.trg_canalizaciones_protegeix_assignacio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Traspaso o borrado de una cuenta del equipo (20270514100000): solo cambia QUIEN, y solo las RPC
  -- `equip_*` ponen esta marca dentro de su transaccion.
  if tg_op = 'UPDATE' and coalesce(current_setting('redestina.traspas_autoria', true), '') = 'on' then
    return new;
  end if;
  if auth.uid() is null
     or coalesce(current_setting('redestina.escriu_assignacio', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.estado = 'anulada'
       or new.anulada_at is not null or new.anulada_per is not null or new.motiu_anulacio is not null then
      raise exception 'assignacio_protegida: una assignacio nomes s''anul.la per anular_assignacio'
        using errcode = '42501';
    end if;
    if new.preu_acordat_kg is not null or new.preu_acceptat_at is not null or new.preu_acceptat_per is not null then
      raise exception 'preu_acordat_protegit: el preu acordat nomes es fixa per assignar_directe o fixar_preu_acordat'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.anulada_at        is distinct from old.anulada_at
     or new.anulada_per    is distinct from old.anulada_per
     or new.motiu_anulacio is distinct from old.motiu_anulacio
     or ((new.estado = 'anulada') is distinct from (old.estado = 'anulada')) then
    raise exception 'assignacio_protegida: una assignacio nomes s''anul.la per anular_assignacio'
      using errcode = '42501';
  end if;
  if new.preu_acordat_kg      is distinct from old.preu_acordat_kg
     or new.preu_acceptat_at  is distinct from old.preu_acceptat_at
     or new.preu_acceptat_per is distinct from old.preu_acceptat_per then
    raise exception 'preu_acordat_protegit: el preu acordat nomes es fixa per assignar_directe o fixar_preu_acordat'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_canalizaciones_protegeix_assignacio() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2b. `trg_respuestas_control_aprovacio`: también quién aprobó y el nivel
-- ---------------------------------------------------------------------------
create or replace function public.trg_respuestas_control_aprovacio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Los flujos del servidor (webhook, jobs) corren con service_role: auth.uid() es
  -- null y pasan de largo, como debe ser.
  if auth.uid() is null then
    return new;
  end if;
  if new.aprovacio is distinct from old.aprovacio and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden aprovar una resposta'
      using errcode = '42501';
  end if;
  if new.canalizacion_id is distinct from old.canalizacion_id and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden canalitzar'
      using errcode = '42501';
  end if;
  -- 20270607100000: quién aprobó y si fue asignación directa, igual.
  if (new.aprovat_per is distinct from old.aprovat_per
      or new.assignacio_directa is distinct from old.assignacio_directa)
     and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden aprovar una resposta'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_respuestas_control_aprovacio() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Deuda 180: la maquila no pide precio
-- ---------------------------------------------------------------------------
-- `comprova_interes`: copia de la vigente (20270523100000) con `preu_minim` solo en venta.
create or replace function public.comprova_interes(
  p_excedente uuid, p_entidad uuid, p_kg numeric, p_preu numeric, p_modalitat text,
  p_recollida timestamptz)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  ex     excedentes;
  v_mods text[];
  v_cand text[];
  v_mod  text;
begin
  if exists (select 1 from entidades where id = p_entidad and not activo) then
    raise exception 'entitat_inactiva: aquesta entitat no esta activa' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.estado not in ('publicada', 'parcial') then
    raise exception 'Aquesta oferta ja no esta disponible' using errcode = '22023';
  end if;

  v_mods := coalesce(ex.modalitats, array[ex.modalitat]);
  select coalesce(array_agg(c.modalitat), '{}') into v_cand
    from entidades e
    join organizaciones o on o.id = e.organizacion_id
    join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
   where e.id = p_entidad and c.modalitat = any(v_mods)
     and (o.naturalesa_origen is distinct from 'confirmada'
          or exists (select 1 from modalitat_naturalesa_compat n
                      where n.naturalesa = o.naturalesa and n.modalitat = c.modalitat));

  if cardinality(v_cand) = 0 then
    raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
  end if;
  if p_modalitat is not null then
    if not (p_modalitat = any(v_cand)) then
      raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
    end if;
    v_mod := p_modalitat;
  elsif cardinality(v_cand) = 1 then
    v_mod := v_cand[1];
  else
    raise exception 'cal_modalitat: tria com vols rebre-la' using errcode = '22023';
  end if;

  perform public.exigir_convenio('entidad', p_entidad, v_mod, 'recibe');

  if p_kg is null or p_kg <= 0 then
    raise exception 'Cal indicar quants kg' using errcode = '22023';
  end if;
  if ex.kg_total is not null and p_kg > ex.kg_total then
    raise exception 'kg_maxim: com a maxim % kg', ex.kg_total using errcode = '22023';
  end if;
  -- 20270607100000 (deuda 180): el precio mínimo solo es de la VENTA. La maquila no lleva precio.
  if v_mod = 'venda' and ex.preu_minim is not null
     and (p_preu is null or p_preu < ex.preu_minim) then
    raise exception 'El preu ha de ser com a minim % EUR/kg', ex.preu_minim using errcode = '22023';
  end if;

  perform public.comprova_hora_recollida(ex, p_recollida);
  return v_mod;
end;
$$;
revoke execute on function public.comprova_interes(uuid, uuid, numeric, numeric, text, timestamptz) from public, anon, authenticated;

-- `manifestar_interes`: copia de la vigente (20270430100100) con `preu_ofert` solo en venta.
create or replace function public.manifestar_interes(
  p_excedente uuid, p_entidad uuid, p_kg numeric, p_preu numeric default null,
  p_caixes integer default null, p_modalitat text default null, p_recollida timestamptz default null)
returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fila  oferta_respuestas;
  tel   text;
  v_mod text;
begin
  if p_entidad not in (select public.mis_entidades()) then
    raise exception 'No pertanys a aquesta entitat' using errcode = '42501';
  end if;

  -- G1: con un albarán por confirmar desde hace más de 48 h, primero se confirma.
  if exists (select 1 from public.bloqueig_per_albara('entidad', p_entidad)) then
    raise exception 'albara_pendent: confirma primer l''albara pendent' using errcode = '22023';
  end if;

  v_mod := public.comprova_interes(p_excedente, p_entidad, p_kg, p_preu, p_modalitat, p_recollida);

  select telefono into tel from entidades where id = p_entidad;

  insert into oferta_respuestas (
    excedente_id, entidad_id, telefono, canal, estado,
    kg_solicitados, caixes_solicitades, preu_ofert, respondido_at, modalitat, recollida_at
  ) values (
    p_excedente, p_entidad, tel, 'panel', 'acceptada',
    -- 20270607100000 (deuda 180): solo la venta lleva precio.
    p_kg, p_caixes, case when v_mod = 'venda' then p_preu end, now(), v_mod, p_recollida
  )
  on conflict (excedente_id, entidad_id) do update
     set estado             = 'acceptada',
         canal              = 'panel',
         kg_solicitados     = excluded.kg_solicitados,
         caixes_solicitades = excluded.caixes_solicitades,
         preu_ofert         = excluded.preu_ofert,
         modalitat          = excluded.modalitat,
         recollida_at       = excluded.recollida_at,
         respondido_at      = now()
   where oferta_respuestas.aprovacio = 'pendent'
  returning * into fila;

  if fila.id is null then
    raise exception 'Aquesta resposta ja esta resolta' using errcode = '22023';
  end if;
  return fila;
end;
$$;
revoke execute on function public.manifestar_interes(uuid, uuid, numeric, numeric, integer, text, timestamptz) from public, anon;
grant  execute on function public.manifestar_interes(uuid, uuid, numeric, numeric, integer, text, timestamptz) to authenticated, service_role;

-- `manifestar_interes_assistit`: copia de la vigente (20270430100100) con `preu_ofert` solo en venta.
create or replace function public.manifestar_interes_assistit(
  p_excedente uuid, p_entidad uuid, p_kg numeric, p_preu numeric default null,
  p_caixes integer default null, p_modalitat text default null, p_recollida timestamptz default null)
returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fila  oferta_respuestas;
  tel   text;
  v_mod text;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot registrar un interes assistit' using errcode = '42501';
  end if;

  v_mod := public.comprova_interes(p_excedente, p_entidad, p_kg, p_preu, p_modalitat, p_recollida);

  select telefono into tel from entidades where id = p_entidad;

  insert into oferta_respuestas (
    excedente_id, entidad_id, telefono, canal, estado,
    kg_solicitados, caixes_solicitades, preu_ofert, respondido_at, modalitat, recollida_at
  ) values (
    p_excedente, p_entidad, tel, 'asistido', 'acceptada',
    -- 20270607100000 (deuda 180): solo la venta lleva precio.
    p_kg, p_caixes, case when v_mod = 'venda' then p_preu end, now(), v_mod, p_recollida
  )
  on conflict (excedente_id, entidad_id) do update
     set estado             = 'acceptada',
         canal              = 'asistido',
         kg_solicitados     = excluded.kg_solicitados,
         caixes_solicitades = excluded.caixes_solicitades,
         preu_ofert         = excluded.preu_ofert,
         modalitat          = excluded.modalitat,
         recollida_at       = excluded.recollida_at,
         respondido_at      = now()
   where oferta_respuestas.aprovacio = 'pendent'
  returning * into fila;

  if fila.id is null then
    raise exception 'Aquesta resposta ja esta resolta' using errcode = '22023';
  end if;
  return fila;
end;
$$;
revoke execute on function public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, integer, text, timestamptz) from public, anon;
grant  execute on function public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, integer, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. `aprova_resposta_intern()`: interna
-- ---------------------------------------------------------------------------
-- El cuerpo de `aprovar_resposta()` (B1) sin la guarda, más:
--   · venta: `preu_acordat_kg = coalesce(p_preu, r.preu_ofert)`; con `p_preu_acceptat`, también
--     `preu_acceptat_*` (y entonces el precio es obligatorio: `cal_preu_acordat`);
--   · `aprovat_per = auth.uid()` y `assignacio_directa = p_directa`;
--   · fuera de la venta, ni precio acordado ni `preu_ofert` (deuda 180).
-- Reutiliza los dos `exigir_convenio`, la valoración y los albaranes (triggers de la
-- canalización) y los avisos (`trg_respostes_avis`). El estado, `recalcula_estat_excedent()`.
create or replace function public.aprova_resposta_intern(
  p_resposta      uuid,
  p_kg            numeric,
  p_preu          numeric,
  p_motiu         text,
  p_modalitat     text,
  p_recollida     timestamptz,
  p_preu_acceptat boolean,
  p_directa       boolean
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r        oferta_respuestas;
  ex       excedentes;
  c        canalizaciones;
  kg       numeric;
  v_mods   text[];
  v_val    text;
  v_aviso  text;
  v_quan   timestamptz;
  v_preu   numeric;
  v_acc    boolean;
begin
  select * into r from oferta_respuestas where id = p_resposta for update;
  if r.id is null or r.estado <> 'acceptada' or r.aprovacio <> 'pendent' then
    raise exception 'Aquesta resposta no es pot aprovar' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = r.excedente_id for update;
  kg := coalesce(p_kg, r.kg_solicitados);
  if kg is null or kg <= 0 then
    raise exception 'Cal indicar els kg a canalitzar' using errcode = '22023';
  end if;

  v_mods := coalesce(ex.modalitats, array[coalesce(ex.modalitat, 'donacio')]);
  v_val := coalesce(p_modalitat, r.modalitat,
                    case when cardinality(v_mods) = 1 then v_mods[1] end);
  if v_val is null then
    raise exception 'cal_modalitat: tria la modalitat d''aquesta entrega' using errcode = '22023';
  end if;
  if not (v_val = any(v_mods)) then
    raise exception 'Aquesta oferta no s''ofereix en modalitat %', v_val using errcode = '22023';
  end if;

  -- La hora: la del equipo manda y se comprueba (solo «no pasada»: puede salirse de la franja
  -- si lo ha hablado con las dos partes); la de la entidad ya se comprobó al pedirla.
  if p_recollida is not null and p_recollida < now() - interval '1 hour' then
    raise exception 'hora_passada: la recollida no pot ser en el passat' using errcode = '22023';
  end if;
  v_quan := coalesce(p_recollida, r.recollida_at);

  -- El precio: solo en venta.
  if v_val = 'venda' then
    v_preu := coalesce(p_preu, r.preu_ofert);
    v_acc  := coalesce(p_preu_acceptat, false);
    if v_preu is not null and v_preu < 0 then
      raise exception 'preu_invalid: el preu no pot ser negatiu' using errcode = '22023';
    end if;
    if v_acc and v_preu is null then
      raise exception 'cal_preu_acordat: una venda necessita el preu acordat' using errcode = '22023';
    end if;
  else
    v_preu := null;
    v_acc  := false;
  end if;

  v_aviso := public.exigir_convenio('productor', ex.productor_id, v_val, 'entrega');
  if v_aviso is not null then raise notice '%', v_aviso; end if;
  v_aviso := public.exigir_convenio('entidad', r.entidad_id, v_val, 'recibe');
  if v_aviso is not null then raise notice '%', v_aviso; end if;

  perform set_config('redestina.escriu_assignacio', 'on', true);
  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, estado, valorizacion,
                              data_hora_recollida, preu_acordat_kg, preu_acceptat_at, preu_acceptat_per)
  values (r.excedente_id, r.entidad_id, kg, 'confirmada', v_val, v_quan,
          v_preu,
          case when v_acc then now() end,
          case when v_acc then auth.uid() end)
  returning * into c;
  perform set_config('redestina.escriu_assignacio', 'off', true);

  update oferta_respuestas
     set aprovacio          = 'aprovada',
         aprovat_at         = now(),
         aprovat_per        = auth.uid(),
         assignacio_directa = coalesce(p_directa, false),
         motiu_aprovacio    = p_motiu,
         canalizacion_id    = c.id,
         kg_aprovats        = kg,
         modalitat          = v_val,
         recollida_at       = v_quan,
         preu_ofert         = case when v_val = 'venda' then coalesce(p_preu, r.preu_ofert) end
   where id = r.id;

  perform public.recalcula_estat_excedent(ex.id);

  return c;
end;
$$;
revoke execute on function public.aprova_resposta_intern(uuid, numeric, numeric, text, text, timestamptz, boolean, boolean) from public, anon, authenticated;
grant  execute on function public.aprova_resposta_intern(uuid, numeric, numeric, text, text, timestamptz, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 5. `aprovar_resposta()`: siete argumentos (el último con default)
-- ---------------------------------------------------------------------------
-- `create or replace` no puede añadir un argumento: drop + create + revoke/grant. La guarda
-- sigue siendo `pot_aprovar()` SIN la salida de `service_role`: aprobar es un acto con autor.
drop function if exists public.aprovar_resposta(uuid, numeric, numeric, text, text, timestamptz);

create function public.aprovar_resposta(
  p_resposta      uuid,
  p_kg            numeric     default null,
  p_preu          numeric     default null,
  p_motiu         text        default null,
  p_modalitat     text        default null,
  p_recollida     timestamptz default null,
  p_preu_acceptat boolean     default null
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden aprovar' using errcode = '42501';
  end if;
  return public.aprova_resposta_intern(p_resposta, p_kg, p_preu, p_motiu, p_modalitat, p_recollida,
                                       p_preu_acceptat, false);
end;
$$;
revoke execute on function public.aprovar_resposta(uuid, numeric, numeric, text, text, timestamptz, boolean) from public, anon;
grant  execute on function public.aprovar_resposta(uuid, numeric, numeric, text, text, timestamptz, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6a. `assignar_directe()`: nivel 1, en un acto
-- ---------------------------------------------------------------------------
-- 1. Guarda `pot_aprovar()` (el permiso antes que la existencia).
-- 2. `comprova_interes()` con la hora a null (la regla del equipo es solo «no pasada», la
--    aplica la interna): entidad activa, oferta publicada/parcial, compatibilidad y naturalesa,
--    convenio de quien recibe, `kg_maxim` y precio mínimo de venta.
-- 3. Venta: precio acordado y aceptación del ofertante, obligatorios.
-- 4. Upsert de la respuesta (`canal='asistido'`, `acceptada`) salvo si ya está aprobada
--    (`22023 ja_assignada`); una rechazada o anulada se reabre y se aprueba.
-- 5. `aprova_resposta_intern(..., p_directa => true)`.
create or replace function public.assignar_directe(
  p_excedente     uuid,
  p_entidad       uuid,
  p_kg            numeric,
  p_modalitat     text        default null,
  p_recollida     timestamptz default null,
  p_caixes        integer     default null,
  p_preu          numeric     default null,
  p_preu_acceptat boolean     default false,
  p_motiu         text        default null
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mod text;
  tel   text;
  fila  oferta_respuestas;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden assignar directament' using errcode = '42501';
  end if;

  v_mod := public.comprova_interes(p_excedente, p_entidad, p_kg, p_preu, p_modalitat, null);

  if v_mod = 'venda' then
    if p_preu is null then
      raise exception 'cal_preu_acordat: una venda necessita el preu acordat' using errcode = '22023';
    end if;
    if p_preu < 0 then
      raise exception 'preu_invalid: el preu no pot ser negatiu' using errcode = '22023';
    end if;
    if not coalesce(p_preu_acceptat, false) then
      raise exception 'cal_preu_acceptat: cal que l''ofertant accepti el preu' using errcode = '22023';
    end if;
  end if;

  select telefono into tel from entidades where id = p_entidad;

  insert into oferta_respuestas (
    excedente_id, entidad_id, telefono, canal, estado,
    kg_solicitados, caixes_solicitades, preu_ofert, respondido_at, modalitat, recollida_at
  ) values (
    p_excedente, p_entidad, tel, 'asistido', 'acceptada',
    p_kg, p_caixes, case when v_mod = 'venda' then p_preu end, now(), v_mod, p_recollida
  )
  on conflict (excedente_id, entidad_id) do update
     set estado             = 'acceptada',
         canal              = 'asistido',
         kg_solicitados     = excluded.kg_solicitados,
         caixes_solicitades = excluded.caixes_solicitades,
         preu_ofert         = excluded.preu_ofert,
         modalitat          = excluded.modalitat,
         recollida_at       = excluded.recollida_at,
         respondido_at      = now(),
         -- Una respuesta rechazada (o una asignación anulada) se reabre: la aprueba la interna.
         aprovacio          = 'pendent',
         motiu_aprovacio    = null,
         canalizacion_id    = null,
         kg_aprovats        = null
   where oferta_respuestas.aprovacio <> 'aprovada'
  returning * into fila;

  if fila.id is null then
    raise exception 'ja_assignada: aquesta entitat ja te una assignacio en aquesta oferta' using errcode = '22023';
  end if;

  return public.aprova_resposta_intern(fila.id, p_kg, p_preu, p_motiu, v_mod, p_recollida,
                                       p_preu_acceptat, true);
end;
$$;
revoke execute on function public.assignar_directe(uuid, uuid, numeric, text, timestamptz, integer, numeric, boolean, text) from public, anon;
grant  execute on function public.assignar_directe(uuid, uuid, numeric, text, timestamptz, integer, numeric, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6b. `fixar_preu_acordat()`: el precio de una venta del nivel 2
-- ---------------------------------------------------------------------------
-- Fija (o cambia) el precio acordado; `p_acceptat` registra que el ofertante lo acepta (si no,
-- la aceptación anterior se borra: un precio nuevo hay que volver a aceptarlo).
create or replace function public.fixar_preu_acordat(
  p_canalizacion uuid,
  p_preu         numeric,
  p_acceptat     boolean default false
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c canalizaciones;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden fixar el preu acordat' using errcode = '42501';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if c.valorizacion is distinct from 'venda' then
    raise exception 'no_es_venda: nomes una venda te preu acordat' using errcode = '22023';
  end if;
  if c.estado = 'conciliada' or c.recollida_validada_at is not null then
    raise exception 'ja_validada: aquesta recollida ja esta validada' using errcode = '22023';
  end if;
  if p_preu is null or p_preu < 0 then
    raise exception 'preu_invalid: cal un preu acordat (>= 0)' using errcode = '22023';
  end if;

  perform set_config('redestina.escriu_assignacio', 'on', true);
  update canalizaciones
     set preu_acordat_kg   = p_preu,
         preu_acceptat_at  = case when coalesce(p_acceptat, false) then now() end,
         preu_acceptat_per = case when coalesce(p_acceptat, false) then auth.uid() end
   where id = c.id
  returning * into c;
  perform set_config('redestina.escriu_assignacio', 'off', true);
  return c;
end;
$$;
revoke execute on function public.fixar_preu_acordat(uuid, numeric, boolean) from public, anon;
grant  execute on function public.fixar_preu_acordat(uuid, numeric, boolean) to authenticated, service_role;
