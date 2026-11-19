-- Fase 5 de los puntos 4-6 (Excel 5.2, nivel 2): PROPONER CAMBIOS a un interés.
--
-- Hasta aquí, ante un interés de una entidad (`oferta_respuestas` `acceptada` + `pendent`), el
-- equipo solo podía aprobarlo (`aprovar_resposta`) o rechazarlo. Ahora hay una tercera vía: el
-- equipo (`pot_aprovar()`) PROPONE otros kilos, otra modalidad u otra hora, con un motivo, y la
-- entidad la acepta o la rechaza desde su panel.
--
--   pendent ──proposar_canvis──▶ proposada ──respondre_proposta(acepta)──▶ aprovada  (no venta)
--                                    │                                 └──▶ pendent  (venta: el
--                                    │                                      equipo aprueba con precio)
--                                    └──respondre_proposta(rechaza)──▶ pendent (valores originales)
--
-- Decisiones:
--   · La propuesta vive en columnas PROPIAS (`proposta_*`): mientras está `proposada`, la petición
--     de la entidad (`kg_solicitados`, `modalitat`, `recollida_at`) no se toca. Rechazar = volver a
--     `pendent` sin restaurar nada. Aceptar = copiar lo propuesto a esas columnas (la entidad lo
--     hace suyo); `proposta_original` guarda lo que pidió para el rastro.
--   · La propuesta guarda los valores EFECTIVOS completos (lo que no cambia, copiado de la
--     petición): la interfaz compara `proposta_*` con la petición para señalar qué cambia.
--   · La hora propuesta sigue la regla del equipo («no pasada», como `assignar_directe` y
--     `modificar_assignacio`): puede salirse de la franja si lo ha hablado con las partes.
--   · VENTA: aquí no se propone precio. Si la modalidad resultante es venta, aceptar aplica los
--     valores y devuelve el interés a `pendent` (vuelve a Aprovacions) para que el equipo lo
--     apruebe con el precio (`aprovar_resposta(p_preu, p_preu_acceptat)`). El dinero, siempre con
--     una persona del equipo delante. Fuera de la venta, aceptar aprueba en el acto con
--     `aprova_resposta_intern` (mismos avisos que aprobar: `interes_aprovat` + `sortida_trobada`)
--     y `aprovat_per` = quien propuso.
--   · Responde un miembro activo de la entidad (`mis_entidades()`) o, por la vía asistida, el
--     equipo con `pot_aprovar()`; `proposta_resposta_per` deja el rastro de quién.
--   · `proposada` NO cuenta en la cola `respostes` de `pendents_equip()` (que ya filtra
--     `aprovacio = 'pendent'`): espera a la entidad. Sí sale en `pendents_meus()` de la entidad
--     (proposito `resposta_proposta`) y cuenta como «en curso» en el progreso del productor.
--
-- Esta migración:
--   1. Columnas `proposta_*` y `proposta_original` en `oferta_respuestas`, el CHECK de
--      `aprovacio` con `proposada` y los checks de las columnas nuevas.
--   2. Trigger `respuestas_protegeix_proposta` (BEFORE INSERT OR UPDATE): con sesión y sin la
--      marca `redestina.escriu_proposta`, nadie escribe `proposta_*` ni pone `proposada`.
--      `trg_respuestas_control_aprovacio` deja pasar la misma marca (la entidad que acepta mueve
--      `aprovacio` dentro de la RPC).
--   3. `avisos_tipus_check` + `canvis_proposats` (texto en `_shared/textAvis.ts`, que se publica
--      ANTES que esta migración: si no, `enviar-avis` lo marca `tipus_desconegut`).
--   4. `manifestar_interes` y `manifestar_interes_assistit` (mismas firmas): sobre un interés
--      `proposada` dicen `22023 proposta_pendent` en lugar de «ja esta resolta».
--   5. `proposar_canvis()` y `respondre_proposta()`.
--   6. `pendents_meus()` (mismo `returns table`): las propuestas por responder de la entidad.
--   7. `progres_meves_ofertes()` (misma firma): `proposada` cuenta como «per aprovar».
--   8. `canalitzacio_assistida()` (misma firma): cada respuesta lleva también `proposta_*`.
--
-- Compatible hacia atrás: columnas nulas, firmas nuevas o iguales; nadie llega a `proposada` sin
-- el frontend nuevo.

-- ---------------------------------------------------------------------------
-- 1. Columnas y checks
-- ---------------------------------------------------------------------------
alter table public.oferta_respuestas
  add column if not exists proposta_kg              numeric,
  add column if not exists proposta_modalitat       text,
  add column if not exists proposta_recollida_at    timestamptz,
  add column if not exists proposta_motiu           text,
  add column if not exists proposta_at              timestamptz,
  add column if not exists proposta_per             uuid references auth.users(id) on delete set null,
  add column if not exists proposta_original        jsonb,
  add column if not exists proposta_resposta        text,
  add column if not exists proposta_resposta_at     timestamptz,
  add column if not exists proposta_resposta_motiu  text,
  add column if not exists proposta_resposta_per    uuid references auth.users(id) on delete set null;

comment on column public.oferta_respuestas.proposta_kg is
  'Kilos que propone el equipo (proposar_canvis, 20270610100000). Valor efectivo: si no cambian, los pedidos.';
comment on column public.oferta_respuestas.proposta_modalitat is
  'Modalidad que propone el equipo (efectiva). Mismo dominio que `modalitat`.';
comment on column public.oferta_respuestas.proposta_recollida_at is
  'Fecha y hora de recogida que propone el equipo (efectiva; nula si no hay ninguna).';
comment on column public.oferta_respuestas.proposta_motiu is
  'Por qué el equipo propone cambios (obligatorio). Lo ve la entidad.';
comment on column public.oferta_respuestas.proposta_at is
  'Cuándo se hizo la última propuesta.';
comment on column public.oferta_respuestas.proposta_per is
  'Quién del equipo la hizo (al aceptarla, también `aprovat_per`).';
comment on column public.oferta_respuestas.proposta_original is
  'Lo que pidió la entidad antes de la propuesta: {kg_solicitados, modalitat, recollida_at, preu_ofert}. Rastro: aceptar sobrescribe la petición.';
comment on column public.oferta_respuestas.proposta_resposta is
  'acceptada | rebutjada | null (sin responder o sin propuesta). respondre_proposta.';
comment on column public.oferta_respuestas.proposta_resposta_at is
  'Cuándo respondió la entidad (o el equipo por ella).';
comment on column public.oferta_respuestas.proposta_resposta_motiu is
  'Motivo opcional de la respuesta (sobre todo, del rechazo).';
comment on column public.oferta_respuestas.proposta_resposta_per is
  'Quién respondió: una cuenta de la entidad o, en la vía asistida, del equipo.';

-- `aprovacio`: superconjunto del vigente. `not valid` + `validate` (norma sobre tablas con datos).
alter table public.oferta_respuestas drop constraint if exists oferta_respuestas_aprovacio_check;
alter table public.oferta_respuestas add constraint oferta_respuestas_aprovacio_check
  check (aprovacio = any (array['pendent', 'aprovada', 'rebutjada', 'proposada'])) not valid;
alter table public.oferta_respuestas validate constraint oferta_respuestas_aprovacio_check;

alter table public.oferta_respuestas drop constraint if exists oferta_respuestas_proposta_kg_check;
alter table public.oferta_respuestas add constraint oferta_respuestas_proposta_kg_check
  check (proposta_kg is null or proposta_kg > 0) not valid;
alter table public.oferta_respuestas validate constraint oferta_respuestas_proposta_kg_check;

alter table public.oferta_respuestas drop constraint if exists oferta_respuestas_proposta_modalitat_check;
alter table public.oferta_respuestas add constraint oferta_respuestas_proposta_modalitat_check
  check (proposta_modalitat is null
         or proposta_modalitat = any (array['donacio', 'venda', 'maquila'])) not valid;
alter table public.oferta_respuestas validate constraint oferta_respuestas_proposta_modalitat_check;

alter table public.oferta_respuestas drop constraint if exists oferta_respuestas_proposta_resposta_check;
alter table public.oferta_respuestas add constraint oferta_respuestas_proposta_resposta_check
  check (proposta_resposta is null
         or proposta_resposta = any (array['acceptada', 'rebutjada'])) not valid;
alter table public.oferta_respuestas validate constraint oferta_respuestas_proposta_resposta_check;

-- Una respuesta `proposada` tiene su propuesta.
alter table public.oferta_respuestas drop constraint if exists oferta_respuestas_proposada_completa;
alter table public.oferta_respuestas add constraint oferta_respuestas_proposada_completa
  check (aprovacio <> 'proposada'
         or (proposta_at is not null and proposta_kg is not null and proposta_modalitat is not null
             and proposta_motiu is not null)) not valid;
alter table public.oferta_respuestas validate constraint oferta_respuestas_proposada_completa;

-- ---------------------------------------------------------------------------
-- 2a. Protección: la propuesta solo por sus RPC
-- ---------------------------------------------------------------------------
-- La tabla tiene GRANT de escritura a `authenticated` y la política «gestio intern» deja escribir
-- al equipo (técnico incluido, deuda 132). Este trigger cierra las columnas nuevas y la entrada en
-- `proposada`. Salir de `proposada` por escritura directa ya lo vigila
-- `trg_respuestas_control_aprovacio` (mover `aprovacio` exige `pot_aprovar()`).
create or replace function public.trg_respuestas_protegeix_proposta()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('redestina.escriu_proposta', true), '') = 'on' then
    return new;
  end if;
  -- Traspaso o borrado de una cuenta del equipo (20270514100000): solo cambia QUIÉN.
  if tg_op = 'UPDATE' and coalesce(current_setting('redestina.traspas_autoria', true), '') = 'on' then
    return new;
  end if;
  -- Los flujos del servidor (service_role) pasan.
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.aprovacio = 'proposada'
       or new.proposta_kg is not null or new.proposta_modalitat is not null
       or new.proposta_recollida_at is not null or new.proposta_motiu is not null
       or new.proposta_at is not null or new.proposta_per is not null
       or new.proposta_original is not null or new.proposta_resposta is not null
       or new.proposta_resposta_at is not null or new.proposta_resposta_motiu is not null
       or new.proposta_resposta_per is not null then
      raise exception 'proposta_protegida: una proposta nomes es fa per proposar_canvis i es respon per respondre_proposta'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.aprovacio = 'proposada' and old.aprovacio is distinct from 'proposada')
     or new.proposta_kg             is distinct from old.proposta_kg
     or new.proposta_modalitat      is distinct from old.proposta_modalitat
     or new.proposta_recollida_at   is distinct from old.proposta_recollida_at
     or new.proposta_motiu          is distinct from old.proposta_motiu
     or new.proposta_at             is distinct from old.proposta_at
     or new.proposta_per            is distinct from old.proposta_per
     or new.proposta_original       is distinct from old.proposta_original
     or new.proposta_resposta       is distinct from old.proposta_resposta
     or new.proposta_resposta_at    is distinct from old.proposta_resposta_at
     or new.proposta_resposta_motiu is distinct from old.proposta_resposta_motiu
     or new.proposta_resposta_per   is distinct from old.proposta_resposta_per then
    raise exception 'proposta_protegida: una proposta nomes es fa per proposar_canvis i es respon per respondre_proposta'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_respuestas_protegeix_proposta() from public, anon, authenticated;

drop trigger if exists respuestas_protegeix_proposta on public.oferta_respuestas;
create trigger respuestas_protegeix_proposta
  before insert or update on public.oferta_respuestas
  for each row execute function public.trg_respuestas_protegeix_proposta();

-- ---------------------------------------------------------------------------
-- 2b. `trg_respuestas_control_aprovacio`: deja pasar la marca de la propuesta
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270607100000) con la salida de la marca. La entidad que ACEPTA una
-- propuesta no es `pot_aprovar()`, pero `respondre_proposta` mueve `aprovacio` (y, vía
-- `aprova_resposta_intern`, `canalizacion_id` y `aprovat_per`) en su nombre.
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
  -- 20270610100000: solo `proposar_canvis` / `respondre_proposta` ponen esta marca.
  if coalesce(current_setting('redestina.escriu_proposta', true), '') = 'on' then
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
-- 3. El aviso nuevo
-- ---------------------------------------------------------------------------
alter table public.avisos drop constraint if exists avisos_tipus_check;
alter table public.avisos add constraint avisos_tipus_check check (tipus = any (array[
  'oferta_validada', 'oferta_rebutjada', 'sortida_trobada', 'interes_aprovat', 'interes_rebutjat',
  'oferta_sense_desti', 'recollida_canviada', 'kg_assignats_canviats', 'recollida_confirmada',
  'oferta_modificada', 'oferta_enviada', 'certificat_per_revisar', 'recollida_per_registrar',
  'recollida_retornada', 'document_signat',
  -- 20270606100100:
  'assignacio_anulada',
  -- 20270610100000:
  'canvis_proposats'])) not valid;
alter table public.avisos validate constraint avisos_tipus_check;

-- ---------------------------------------------------------------------------
-- 4. `manifestar_interes` y `manifestar_interes_assistit`: un interés con propuesta se responde
-- ---------------------------------------------------------------------------
-- Copias de las vigentes (20270607100000) con una comprobación más antes del upsert: sobre una
-- respuesta `proposada` el upsert no escribe (`where aprovacio = 'pendent'`) y el error decía
-- «ja esta resolta», que no es verdad. Ahora: `22023 proposta_pendent`.
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

  -- 20270610100000: el equipo le ha propuesto cambios; primero se responden.
  if exists (select 1 from oferta_respuestas r
              where r.excedente_id = p_excedente and r.entidad_id = p_entidad
                and r.aprovacio = 'proposada') then
    raise exception 'proposta_pendent: respon primer la proposta de l''equip' using errcode = '22023';
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

  -- 20270610100000: hay una propuesta del equipo esperando a la entidad.
  if exists (select 1 from oferta_respuestas r
              where r.excedente_id = p_excedente and r.entidad_id = p_entidad
                and r.aprovacio = 'proposada') then
    raise exception 'proposta_pendent: l''entitat encara ha de respondre la proposta' using errcode = '22023';
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
-- 5a. `proposar_canvis()`: el equipo propone
-- ---------------------------------------------------------------------------
-- 1. Guarda `pot_aprovar()` (el permiso antes que la existencia).
-- 2. Motivo obligatorio (`cal_motiu`, ≤ 1000: `motiu_llarg`).
-- 3. Solo sobre un interés `acceptada` + `pendent` o `proposada` (cambiar la propuesta):
--    `resposta_inexistent`, `no_proposable`.
-- 4. Valores efectivos (null = el pedido); alguno distinto de lo pedido (`cal_canvi`).
-- 5. Hora: la regla del equipo, solo «no pasada» (`hora_passada`).
-- 6. `comprova_interes()` con la hora a null y el precio mínimo como precio (aquí no se propone
--    precio; lo fija el equipo al aprobar una venta): entidad activa (`entitat_inactiva`), oferta
--    publicada o parcial, compatibilidad y naturalesa P8, convenio de quien recibe, kg > 0 y
--    `kg_maxim`, `cal_modalitat`.
-- 7. Escribe la propuesta (con la marca), y el aviso `canvis_proposats` a la entidad.
create or replace function public.proposar_canvis(
  p_resposta     uuid,
  p_kg           numeric     default null,
  p_modalitat    text        default null,
  p_recollida_at timestamptz default null,
  p_motiu        text        default null
)
returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r      oferta_respuestas;
  ex     excedentes;
  v_mot  text := nullif(btrim(coalesce(p_motiu, '')), '');
  v_kg   numeric;
  v_mod  text;
  v_quan timestamptz;
  v_orig jsonb;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden proposar canvis' using errcode = '42501';
  end if;
  if v_mot is null then
    raise exception 'cal_motiu: cal indicar el motiu de la proposta' using errcode = '22023';
  end if;
  if char_length(v_mot) > 1000 then
    raise exception 'motiu_llarg' using errcode = '22023';
  end if;

  select * into r from oferta_respuestas where id = p_resposta for update;
  if r.id is null then
    raise exception 'resposta_inexistent' using errcode = '22023';
  end if;
  if r.estado <> 'acceptada' or r.aprovacio not in ('pendent', 'proposada') then
    raise exception 'no_proposable: aquesta resposta no admet una proposta (%)', r.aprovacio
      using errcode = '22023';
  end if;
  if p_modalitat is not null and p_modalitat not in ('donacio', 'venda', 'maquila') then
    raise exception 'modalitat_invalida' using errcode = '22023';
  end if;
  if p_kg is not null and p_kg <= 0 then
    raise exception 'Cal indicar quants kg' using errcode = '22023';
  end if;

  v_kg   := coalesce(p_kg, r.kg_solicitados);
  v_mod  := coalesce(p_modalitat, r.modalitat);
  v_quan := coalesce(p_recollida_at, r.recollida_at);
  if v_kg is not distinct from r.kg_solicitados
     and v_mod is not distinct from r.modalitat
     and v_quan is not distinct from r.recollida_at then
    raise exception 'cal_canvi: la proposta ha de canviar alguna cosa del que va demanar l''entitat'
      using errcode = '22023';
  end if;
  if p_recollida_at is not null and p_recollida_at < now() - interval '1 hour' then
    raise exception 'hora_passada: la recollida no pot ser en el passat' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = r.excedente_id;
  v_mod := public.comprova_interes(r.excedente_id, r.entidad_id, v_kg, ex.preu_minim, v_mod, null);

  -- Lo que pidió la entidad: los campos de la petición no se tocan mientras hay propuesta.
  v_orig := jsonb_build_object('kg_solicitados', r.kg_solicitados, 'modalitat', r.modalitat,
                               'recollida_at', r.recollida_at, 'preu_ofert', r.preu_ofert);

  perform set_config('redestina.escriu_proposta', 'on', true);
  update oferta_respuestas
     set aprovacio               = 'proposada',
         proposta_kg             = v_kg,
         proposta_modalitat      = v_mod,
         proposta_recollida_at   = v_quan,
         proposta_motiu          = v_mot,
         proposta_at             = now(),
         proposta_per            = auth.uid(),
         proposta_original       = v_orig,
         proposta_resposta       = null,
         proposta_resposta_at    = null,
         proposta_resposta_motiu = null,
         proposta_resposta_per   = null
   where id = r.id
  returning * into r;
  perform set_config('redestina.escriu_proposta', 'off', true);

  perform public.crear_avis('entidad', r.entidad_id, 'canvis_proposats', 'oferta_resposta', r.id,
    jsonb_build_object(
      'producte', ex.producto,
      'kg', v_kg, 'kg_sol', r.kg_solicitados,
      'modalitat', v_mod, 'modalitat_abans', r.modalitat,
      'recollida_at', v_quan, 'recollida_abans', r.recollida_at,
      'motiu', v_mot,
      'excedente_id', ex.id, 'resposta_id', r.id));

  return r;
end;
$$;
revoke execute on function public.proposar_canvis(uuid, numeric, text, timestamptz, text) from public, anon;
grant  execute on function public.proposar_canvis(uuid, numeric, text, timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5b. `respondre_proposta()`: la entidad (o el equipo por ella) responde
-- ---------------------------------------------------------------------------
-- Devuelve `{resposta_id, resultat, aprovacio, canalizacion_id}` con `resultat`:
--   · `aprovada`      — aceptada fuera de la venta: canalización confirmada en el acto;
--   · `pendent_preu`  — aceptada en venta: valores aplicados, vuelve a Aprovacions para el precio;
--   · `rebutjada`     — rechazada: vuelve a `pendent` con lo que pidió la entidad.
-- Errores: 42501 (ni de la entidad ni `pot_aprovar()`; también con un uuid inventado), 22023
-- `cal_resposta`, `resposta_inexistent`, `sense_proposta`, `motiu_llarg`, `hora_passada` y los
-- de `comprova_interes` / `aprova_resposta_intern` al aceptar (la oferta pudo cerrarse entre
-- medias: `Aquesta oferta ja no esta disponible`, `kg_maxim`, `entitat_inactiva`, convenio…).
create or replace function public.respondre_proposta(
  p_resposta uuid,
  p_accepta  boolean,
  p_motiu    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r     oferta_respuestas;
  ex    excedentes;
  c     canalizaciones;
  v_mot text := nullif(btrim(coalesce(p_motiu, '')), '');
  v_mod text;
  v_claims text;
  v_sub    text;
begin
  -- Permiso ANTES que existencia: un uuid inventado da 42501 a quien no es del equipo.
  if auth.uid() is not null and not public.pot_aprovar()
     and not exists (select 1 from oferta_respuestas x
                      where x.id = p_resposta
                        and x.entidad_id in (select public.mis_entidades())) then
    raise exception 'Nomes l''entitat pot respondre aquesta proposta' using errcode = '42501';
  end if;
  if p_accepta is null then
    raise exception 'cal_resposta: cal dir si s''accepta o no la proposta' using errcode = '22023';
  end if;
  if v_mot is not null and char_length(v_mot) > 1000 then
    raise exception 'motiu_llarg' using errcode = '22023';
  end if;

  select * into r from oferta_respuestas where id = p_resposta for update;
  if r.id is null then
    raise exception 'resposta_inexistent' using errcode = '22023';
  end if;
  if r.aprovacio <> 'proposada' then
    raise exception 'sense_proposta: aquesta resposta no te cap proposta per respondre' using errcode = '22023';
  end if;

  perform set_config('redestina.escriu_proposta', 'on', true);

  if not p_accepta then
    -- Rechazo: la petición de la entidad no se tocó; vuelve a la cola de Aprovacions.
    update oferta_respuestas
       set aprovacio               = 'pendent',
           proposta_resposta       = 'rebutjada',
           proposta_resposta_at    = now(),
           proposta_resposta_motiu = v_mot,
           proposta_resposta_per   = auth.uid()
     where id = r.id
    returning * into r;
    perform set_config('redestina.escriu_proposta', 'off', true);
    return jsonb_build_object('resposta_id', r.id, 'resultat', 'rebutjada',
                              'aprovacio', r.aprovacio, 'canalizacion_id', null);
  end if;

  -- Aceptación: lo propuesto se vuelve a comprobar (la oferta pudo cambiar desde la propuesta).
  if r.proposta_recollida_at is not null and r.proposta_recollida_at < now() - interval '1 hour' then
    raise exception 'hora_passada: l''hora proposada ja ha passat; cal una proposta nova' using errcode = '22023';
  end if;
  select * into ex from excedentes where id = r.excedente_id;
  v_mod := public.comprova_interes(r.excedente_id, r.entidad_id, r.proposta_kg, ex.preu_minim,
                                   r.proposta_modalitat, null);

  -- La entidad hace suya la propuesta: la petición pasa a ser la propuesta (lo pedido antes queda
  -- en `proposta_original`). El precio ofrecido solo sobrevive en venta.
  update oferta_respuestas
     set kg_solicitados          = r.proposta_kg,
         modalitat               = v_mod,
         recollida_at            = r.proposta_recollida_at,
         preu_ofert              = case when v_mod = 'venda' then r.preu_ofert end,
         aprovacio               = 'pendent',
         proposta_resposta       = 'acceptada',
         proposta_resposta_at    = now(),
         proposta_resposta_motiu = v_mot,
         proposta_resposta_per   = auth.uid()
   where id = r.id
  returning * into r;

  if v_mod = 'venda' then
    -- Venta: el equipo la aprueba con el precio en Aprovacions.
    perform set_config('redestina.escriu_proposta', 'off', true);
    return jsonb_build_object('resposta_id', r.id, 'resultat', 'pendent_preu',
                              'aprovacio', r.aprovacio, 'canalizacion_id', null);
  end if;

  -- Fuera de la venta: aprobada en el acto, con los mismos avisos que aprobar. La hora la pasa
  -- explícita (la interna solo comprueba «no pasada»).
  -- ⚠️ La interna corre COMO SERVIDOR (sin claims, como `validar_recollida` con
  --    `confirmar_part_declarada`): con la sesión de la entidad, `exigir_convenio('productor', …)`
  --    → `convenio_vigente()` la rechaza (42501 «No pots consultar el conveni d'una altra
  --    organitzacio»). El permiso ya está comprobado arriba; la autoría se restaura después.
  v_claims := current_setting('request.jwt.claims', true);
  v_sub    := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  c := public.aprova_resposta_intern(r.id, r.proposta_kg, null, r.proposta_motiu, v_mod,
                                     r.proposta_recollida_at, null, false);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  -- Quien aprobó de verdad es quien propuso (sin claims, la interna lo dejó nulo).
  update oferta_respuestas
     set aprovat_per = coalesce(r.proposta_per, aprovat_per)
   where id = r.id
  returning * into r;

  perform set_config('redestina.escriu_proposta', 'off', true);
  return jsonb_build_object('resposta_id', r.id, 'resultat', 'aprovada',
                            'aprovacio', r.aprovacio, 'canalizacion_id', c.id);
end;
$$;
revoke execute on function public.respondre_proposta(uuid, boolean, text) from public, anon;
grant  execute on function public.respondre_proposta(uuid, boolean, text) to authenticated, service_role;
-- ---------------------------------------------------------------------------
-- 6. `pendents_meus()`: las propuestas por responder de la entidad
-- ---------------------------------------------------------------------------
-- Copia literal de la vigente (20270510100200) con una rama más (`resposta_proposta`). Mismo
-- `returns table`: `create or replace` conserva los privilegios. Las ramas de convenio, albarán
-- y documento no cambian; el `left join lateral` del enlace sale a null en la rama nueva (no
-- hay enlaces de `oferta_resposta`).
CREATE OR REPLACE FUNCTION public.pendents_meus()
 RETURNS TABLE(proposito text, objeto_tipo text, objeto_id uuid, tipo_org text, org_id uuid, rol_parte text, numero text, etiqueta text, tipus text, estat_objecte text, motiu text, ejercicio integer, enlace_id uuid, enlace_estado_efectivo text, enlace_caduca_at timestamp with time zone, enlace_canal text, enlace_created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;
  end if;

  return query
  with meves as (
    select m.productor_id, m.entidad_id
      from membresias m
      join perfiles p on p.id = m.user_id
     where m.user_id = v_user and m.activo and p.activo
  ),
  pendents as (
    -- Convenios: `pendent_firma` y `retornat` son los dos estados en los que la pelota
    -- está en el tejado de la organización (mismo criterio que `conveni_pendent`).
    select 'firma_convenio'::text          as proposito,
           'convenio'::text                as objeto_tipo,
           c.id                            as objeto_id,
           c.tipo_org                      as tipo_org,
           coalesce(c.productor_id, c.entidad_id) as org_id,
           null::text                      as rol_parte,
           c.numero_completo               as numero,
           null::text                      as etiqueta,
           c.tipo                          as tipus,
           c.estado                        as estat_objecte,
           c.motivo_devolucion             as motiu,
           c.ejercicio                     as ejercicio
      from convenios c
     where c.estado in ('pendent_firma', 'retornat')
       and (c.productor_id in (select productor_id from meves where productor_id is not null)
         or c.entidad_id   in (select entidad_id   from meves where entidad_id   is not null))
    union all
    -- Albaranes entregados y sin confirmar. La parte se resuelve como en
    -- `marcar_entregado()`: REC y OPE los entrega el generador, ENT y OPE los recibe la
    -- entidad. En un OPE donde la cuenta tenga las dos fichas salen dos filas, y es lo
    -- correcto: son dos confirmaciones distintas.
    select 'confirmacion_albaran'::text,
           'albaran'::text,
           a.id,
           part.tipo_org,
           part.org_id,
           part.rol,
           a.numero_completo,
           (select string_agg(distinct l.producto, ', ') from albaran_lineas l where l.albaran_id = a.id),
           a.tipo,
           a.estado,
           null::text,
           a.ejercicio
      from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
      left join excedentes     e on e.id = a.excedente_id
      left join espigoladas   es on es.id = a.espigolada_id
      cross join lateral (
        select 'productor'::text as tipo_org,
               coalesce(e.productor_id, es.productor_id) as org_id,
               'entrega'::text as rol
         where a.tipo in ('REC', 'OPE')
           and coalesce(e.productor_id, es.productor_id)
               in (select productor_id from meves where productor_id is not null)
        union all
        select 'entidad', c.entidad_id, 'recibe'
         where a.tipo in ('ENT', 'OPE')
           and c.entidad_id in (select entidad_id from meves where entidad_id is not null)
      ) part
     where a.estado = 'entregado'
       and not exists (
         select 1 from enlaces_token t
          where t.objeto_tipo = 'albaran' and t.objeto_id = a.id
            and t.proposito = 'confirmacion_albaran' and t.usado_at is not null
            and (t.rol_parte is null or t.rol_parte = part.rol))
    union all
    -- NUEVA (20270510100200). Documentos que esta organización tiene que FIRMAR: CD, CR, REC y
    -- ENT vigentes, de modo real, cuya parte firmante (`document_part_signant`) es una ficha
    -- mía y sin ninguna firma viva (una rechazada no cuenta: vuelve a estar pendiente, y
    -- `motiu` dice por qué). El CONV NO entra: el convenio se firma por su propio circuito
    -- (rama `firma_convenio` de arriba) y subir un PDF firmado encima es cosa del equipo; si
    -- entrara, cada convenio ya firmado volvería a salir «pendent de tu».
    -- Como el convenio, sale a cualquier miembro activo (titular u operador): el panel
    -- decide qué botón ve cada uno («Només la persona titular…» para el operador).
    -- `etiqueta`: el ejercicio (cierre anual), el periodo dd/mm/aaaa – dd/mm/aaaa (a
    -- demanda y recepción) o los productos (albarán). `estat_objecte`: el estado de dominio.
    -- `url_path` no viaja: el enlace del panel lo acuña el diálogo (`acunar_enllac_propi`).
    select 'firma_document'::text,
           'documento'::text,
           d.id,
           ps.tipo_org,
           ps.org_id,
           null::text,
           d.numero_completo,
           case d.objeto_tipo
             when 'cierre_donante' then d.ejercicio::text
             when 'cierre_periodo' then (
               select to_char(cp.periodo_desde, 'DD/MM/YYYY') || ' – ' || to_char(cp.periodo_hasta, 'DD/MM/YYYY')
                 from cierres_periodo cp where cp.id = d.objeto_id)
             when 'cierre_receptor' then (
               select to_char(cr.periodo_desde, 'DD/MM/YYYY') || ' – ' || to_char(cr.periodo_hasta, 'DD/MM/YYYY')
                 from cierres_receptor cr where cr.id = d.objeto_id)
             when 'albaran' then (
               select string_agg(distinct l.producto, ', ') from albaran_lineas l where l.albaran_id = d.objeto_id)
           end,
           d.tipo,
           case d.objeto_tipo
             when 'cierre_donante'  then (select cd.estado from cierres_donante  cd where cd.id = d.objeto_id)
             when 'cierre_periodo'  then (select cp.estado from cierres_periodo  cp where cp.id = d.objeto_id)
             when 'cierre_receptor' then (select cr.estado from cierres_receptor cr where cr.id = d.objeto_id)
             when 'albaran'         then (select al.estado from albaranes        al where al.id = d.objeto_id)
           end,
           (select f.motiu_rebuig from firmes_document f
             where f.documento_id = d.id and f.estat = 'rebutjat'
             order by f.rebutjat_at desc limit 1),
           d.ejercicio
      from documentos d
      cross join lateral public.document_part_signant(d.id) ps
     where d.vigente
       and d.modo = 'real'
       and d.tipo in ('CD', 'CR', 'REC', 'ENT')
       and d.id in (select public.documents_meus(v_user))
       and ((ps.tipo_org = 'productor'
             and ps.org_id in (select productor_id from meves where productor_id is not null))
         or (ps.tipo_org = 'entidad'
             and ps.org_id in (select entidad_id from meves where entidad_id is not null)))
       and not exists (select 1 from firmes_document f
                        where f.documento_id = d.id and f.estat <> 'rebutjat')
    union all
    -- NUEVA (20270610100000). Propuestas de cambios del equipo que esta entidad tiene que
    -- ACEPTAR o RECHAZAR (`respondre_proposta`). Sin enlace ni token: se responde desde
    -- «Interessos» (`/receptor/interessos?resposta=<objeto_id>`). `etiqueta`: el producto;
    -- `tipus`: la modalidad propuesta; `motiu`: el motivo del equipo.
    select 'resposta_proposta'::text,
           'oferta_resposta'::text,
           r.id,
           'entidad'::text,
           r.entidad_id,
           null::text,
           null::text,
           concat_ws(' · ', ex.producto, nullif(btrim(coalesce(ex.variedad, '')), '')),
           r.proposta_modalitat,
           r.aprovacio,
           r.proposta_motiu,
           null::int
      from oferta_respuestas r
      join excedentes ex on ex.id = r.excedente_id
     where r.aprovacio = 'proposada'
       and r.estado = 'acceptada'
       and r.entidad_id in (select entidad_id from meves where entidad_id is not null)
  )
  select p.proposito, p.objeto_tipo, p.objeto_id, p.tipo_org, p.org_id, p.rol_parte,
         p.numero, p.etiqueta, p.tipus, p.estat_objecte, p.motiu, p.ejercicio,
         en.id, en.estado_efectivo, en.caduca_at, en.canal, en.created_at
    from pendents p
    left join lateral (
      select e.id,
             case
               when e.estado <> 'activo'   then e.estado
               when e.usado_at is not null then 'usado'
               when e.caduca_at < now()    then 'caducado'
               else 'activo'
             end as estado_efectivo,
             e.caduca_at, e.canal, e.created_at
        from enlaces_token e
       where e.objeto_tipo = p.objeto_tipo
         and e.objeto_id   = p.objeto_id
         and e.proposito   = p.proposito
         and (p.rol_parte is null or e.rol_parte is null or e.rol_parte = p.rol_parte)
       order by e.created_at desc
       limit 1
    ) en on true
   order by p.objeto_tipo, p.ejercicio desc nulls last, p.numero nulls last;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. `progres_meves_ofertes()`: una propuesta sigue «per aprovar» para el productor
-- ---------------------------------------------------------------------------
-- Copia literal de la vigente (20270530100000) con `proposada` en el recuento `n_per_aprovar`:
-- para quien ofrece, el interés sigue en curso. Misma firma.
CREATE OR REPLACE FUNCTION public.progres_meves_ofertes()
 RETURNS TABLE(excedente_id uuid, n_enviades integer, n_interessades integer, n_per_aprovar integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Cal una sessio per consultar el progres de les teves ofertes'
      using errcode = '42501';
  end if;

  return query
  select e.id,
         -- `count(r.id)` y no `count(*)`: con `left join`, una oferta sin respuestas
         -- produce una fila con `r` a null y `count(*)` diría 1.
         count(r.id)::int,
         count(r.id) filter (where r.estado = 'acceptada')::int,
         count(r.id) filter (where r.estado = 'acceptada'
                               and r.aprovacio in ('pendent', 'proposada'))::int
    from excedentes e
    left join oferta_respuestas r on r.excedente_id = e.id
   where e.productor_id in (select public.mis_productores())
     and e.estado in ('borrador', 'publicada', 'parcial', 'bloqueada')
   group by e.id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. `canalitzacio_assistida()`: cada respuesta lleva su propuesta
-- ---------------------------------------------------------------------------
-- Copia literal de la vigente (20270608100100) con las claves `proposta_*` en cada elemento de
-- `respostes` (el ciclo guiado puede enseñar la propuesta y su respuesta). Misma firma.
CREATE OR REPLACE FUNCTION public.canalitzacio_assistida(p_excedente uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ex  excedentes%rowtype;
  res jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot veure una canalitzacio assistida'
      using errcode = '42501';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null then
    raise exception 'Aquesta oferta no existeix' using errcode = 'PT404';
  end if;

  select jsonb_build_object(
    'oferta', jsonb_build_object(
      'id', ex.id, 'id_excedente', ex.id_excedente, 'estado', ex.estado,
      'modalitat', ex.modalitat, 'producto', ex.producto, 'kg_total', ex.kg_total,
      'preu_minim', ex.preu_minim, 'disponible_hasta', ex.disponible_hasta,
      'origen', ex.origen, 'espigolada_id', ex.espigolada_id,
      'created_at', ex.created_at,
      'modalitats', to_jsonb(ex.modalitats)),

    'productor', (select jsonb_build_object('id', p.id,
                           'nom', coalesce(p.empresa, p.name),
                           'email', p.email, 'telefon', p.phone,
                           'organizacion_id', p.organizacion_id)
                    from productores p where p.id = ex.productor_id),

    'conveni_gen', (
      select jsonb_build_object('id', c.id, 'tipo', c.tipo, 'estado', c.estado,
                                'numero', c.numero_completo, 'enviado_at', c.enviado_at,
                                'origen', c.origen)
        from convenios c
        join convenios_exigidos ce
          on (ce.tipo_convenio = c.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce.tipo_convenio and eq.tipo_antic = c.tipo and eq.valorizacion = ex.modalitat)) and ce.valorizacion = ex.modalitat
         and ce.parte = 'entrega'
       where c.productor_id = ex.productor_id
         and c.estado <> 'substituit'
       order by case c.estado when 'vigent' then 0 when 'firmat' then 1
                              when 'pendent_firma' then 2 else 3 end
       limit 1),

    'respostes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'entidad_id', r.entidad_id,
               'entitat', coalesce(e.nombre, '(sense fitxa)'),
               'email', e.email, 'tipo_receptor', e.tipo_receptor,
               'canal', r.canal, 'estado', r.estado, 'aprovacio', r.aprovacio,
               'kg_solicitados', r.kg_solicitados, 'preu_ofert', r.preu_ofert,
               'canalizacion_id', r.canalizacion_id,
               'modalitat', r.modalitat, 'caixes_solicitades', r.caixes_solicitades,
               'recollida_at', r.recollida_at, 'kg_aprovats', r.kg_aprovats,
               'telefono', r.telefono, 'enviado_at', r.enviado_at,
               'proposta_kg', r.proposta_kg, 'proposta_modalitat', r.proposta_modalitat,
               'proposta_recollida_at', r.proposta_recollida_at, 'proposta_motiu', r.proposta_motiu,
               'proposta_at', r.proposta_at, 'proposta_resposta', r.proposta_resposta,
               'proposta_resposta_at', r.proposta_resposta_at,
               'proposta_resposta_motiu', r.proposta_resposta_motiu,
               'conveni_rec', (
                 select jsonb_build_object('id', c2.id, 'estado', c2.estado,
                                           'numero', c2.numero_completo, 'tipo', c2.tipo,
                                           'origen', c2.origen)
                   from convenios c2
                   join convenios_exigidos ce2
                     on (ce2.tipo_convenio = c2.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce2.tipo_convenio and eq.tipo_antic = c2.tipo and eq.valorizacion = ex.modalitat)) and ce2.valorizacion = ex.modalitat
                    and ce2.parte = 'recibe'
                  where c2.entidad_id = r.entidad_id and c2.estado <> 'substituit'
                  order by case c2.estado when 'vigent' then 0 when 'firmat' then 1
                                          when 'pendent_firma' then 2 else 3 end
                  limit 1))
               order by r.created_at)
        from oferta_respuestas r
        left join entidades e on e.id = r.entidad_id
       where r.excedente_id = ex.id), '[]'::jsonb),

    'canalitzacions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ca.id, 'entidad_id', ca.entidad_id,
               'entitat', e.nombre,
               'kg_confirmados', ca.kg_confirmados, 'kg_reales', ca.kg_reales,
               'kg_conciliados', ca.kg_conciliados,
               'conciliada_at', ca.conciliada_at, 'coste_kg', ca.coste_kg,
               'valorizacion', ca.valorizacion,
               'estado', ca.estado, 'comentarios', ca.comentarios,
               'data_hora_recollida', ca.data_hora_recollida,
               'recollida_registrada_at', ca.recollida_registrada_at,
               'recollida_validada_at', ca.recollida_validada_at,
               'recollida_retornada_at', ca.recollida_retornada_at,
               'kg_declarats', ca.kg_declarats, 'resultat_recollida', ca.resultat_recollida,
               'incidencia', ca.incidencia_recollida is not null,
               'created_at', ca.created_at,
               -- Nuevas (20270608100100): el registro de una venta o maquila sin albarán y la
               -- anulación de la fase 2.
               'preu_acordat_kg', ca.preu_acordat_kg, 'preu_acceptat_at', ca.preu_acceptat_at,
               'caixes_entregades', ca.caixes_entregades,
               'anulada_at', ca.anulada_at, 'motiu_anulacio', ca.motiu_anulacio)
               order by ca.created_at)
        from canalizaciones ca
        left join entidades e on e.id = ca.entidad_id
       where ca.excedente_id = ex.id), '[]'::jsonb),

    'albarans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', al.id, 'tipo', al.tipo, 'estado', al.estado,
               'numero', al.numero_completo, 'canalizacion_id', al.canalizacion_id,
               'emitido_at', al.emitido_at, 'entregado_at', al.entregado_at,
               'confirmado_at', al.confirmado_at, 'conciliado_at', al.conciliado_at,
               'rechazo', al.rechazo,
               'fora_tolerancia', case when al.tipo = 'REC' and al.estado = 'confirmado'
                                       then not coalesce((public.propuesta_conciliacion(al.id)->>'dins_tolerancia')::boolean, true) end)
               order by al.tipo, al.created_at)
        from albaranes al
       where al.excedente_id = ex.id
          or al.canalizacion_id in (select id from canalizaciones where excedente_id = ex.id)
          or (ex.espigolada_id is not null and al.espigolada_id = ex.espigolada_id)),
      '[]'::jsonb),

    'cost_falten', (
      select count(*) from (select distinct ex.producto as prod) x
       where ex.coste_kg is null
         and not exists (select 1 from costes_producto cp where cp.producto = x.prod)),

    'exercici', (
      select jsonb_build_object('id', ce3.id, 'ejercicio', ce3.ejercicio,
                                'modo', ce3.modo, 'estado', ce3.estado)
        from cierres_ejercicio ce3
       where ce3.ejercicio = extract(year from coalesce(ex.created_at, now()))::int
       order by case ce3.modo when 'real' then 0 else 1 end,
                ce3.calculado_at desc nulls last,
                ce3.created_at desc,
                ce3.id
       limit 1)
  ) into res;

  return res;
end;
$function$;

