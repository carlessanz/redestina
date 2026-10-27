-- El interés asistido, con las MISMAS comprobaciones que el del receptor, y el envío manual
-- de una oferta (27-10-2026, fase 2 del plan de gestión autónoma).
--
-- POR QUÉ. `manifestar_interes_assistit()` (20270409100000) nació con menos guardas que la del
-- receptor: no aceptaba la hora de recogida, no exigía modalidad cuando la oferta tiene
-- varias, no miraba `kg_maxim` ni el convenio. Con el equipo gestionando el ciclo en nombre de
-- las entidades, eso producía intereses —y canalizaciones— que el receptor no habría podido
-- crear (R1 del plan: paridad de filas). Ahora las dos comparten `comprova_interes()`, así
-- que no pueden divergir: lo único que el equipo NO comparte es la pertenencia a la entidad
-- (actúa en su nombre) y el bloqueo de 48 h por albarán pendiente (decisión del equipo).

-- ---------------------------------------------------------------------------
-- 1. Las comprobaciones, en un solo sitio
-- ---------------------------------------------------------------------------
-- Interna: `security invoker`, así que solo la llaman las dos RPC `definer` de abajo (con
-- los privilegios de su dueño) y nadie con sesión.
create or replace function public.comprova_interes(
  p_excedente uuid,
  p_entidad   uuid,
  p_kg        numeric,
  p_preu      numeric,
  p_modalitat text,
  p_recollida timestamptz
) returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  ex     excedentes;
  v_mods text[];
  v_cand text[];
  v_mod  text;
begin
  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.estado not in ('publicada', 'parcial') then
    raise exception 'Aquesta oferta ja no esta disponible' using errcode = '22023';
  end if;

  v_mods := coalesce(ex.modalitats, array[ex.modalitat]);
  select coalesce(array_agg(c.modalitat), '{}') into v_cand
    from entidades e
    join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
   where e.id = p_entidad and c.modalitat = any(v_mods);

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
  if v_mod in ('venda', 'maquila') and ex.preu_minim is not null
     and (p_preu is null or p_preu < ex.preu_minim) then
    raise exception 'El preu ha de ser com a minim % EUR/kg', ex.preu_minim using errcode = '22023';
  end if;

  perform public.comprova_hora_recollida(ex, p_recollida);
  return v_mod;
end;
$$;

revoke execute on function public.comprova_interes(uuid, uuid, numeric, numeric, text, timestamptz)
  from public, anon, authenticated, service_role;

comment on function public.comprova_interes(uuid, uuid, numeric, numeric, text, timestamptz) is
  'Las guardas de un interés (estado, compatibilidad, modalidad, convenio, kg, precio y hora). La comparten manifestar_interes y manifestar_interes_assistit (20270430100100).';

-- ---------------------------------------------------------------------------
-- 2. El receptor: misma firma, ahora sobre `comprova_interes()`
-- ---------------------------------------------------------------------------
create or replace function public.manifestar_interes(
  p_excedente uuid,
  p_entidad   uuid,
  p_kg        numeric,
  p_preu      numeric default null,
  p_caixes    integer default null,
  p_modalitat text default null,
  p_recollida timestamptz default null
) returns oferta_respuestas
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
    p_kg, p_caixes, case when v_mod = 'donacio' then null else p_preu end, now(), v_mod, p_recollida
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

-- ---------------------------------------------------------------------------
-- 3. El equipo, en nombre de la entidad: con la hora de recogida
-- ---------------------------------------------------------------------------
-- La firma cambia (un parámetro más), así que se BORRA la vieja: `create or replace` dejaría
-- las dos, y una llamada de seis argumentos sería ambigua (PGRST203) durante la ventana entre
-- la base y el frontend.
drop function if exists public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, integer, text);

create function public.manifestar_interes_assistit(
  p_excedente uuid,
  p_entidad   uuid,
  p_kg        numeric,
  p_preu      numeric default null,
  p_caixes    integer default null,
  p_modalitat text default null,
  p_recollida timestamptz default null
) returns oferta_respuestas
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
    p_kg, p_caixes, case when v_mod = 'donacio' then null else p_preu end, now(), v_mod, p_recollida
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

revoke execute on function public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, integer, text, timestamptz)
  from public, anon;
grant execute on function public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, integer, text, timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. La oferta enviada A MANO: canal `manual`
-- ---------------------------------------------------------------------------
-- El equipo copia el texto de la oferta y lo pega en el WhatsApp de la entidad. La fila
-- `pendent` deja constancia de a quién se le ofreció y cuándo, como un envío por WhatsApp o
-- por correo, pero sin que nada haya salido de la plataforma. `trg_resposta_avis_enviada`
-- solo actúa con `canal = 'panel'`, así que este canal no crea el aviso «oferta enviada».
alter table oferta_respuestas drop constraint if exists oferta_respuestas_canal_check;
alter table oferta_respuestas add constraint oferta_respuestas_canal_check
  check (canal in ('whatsapp', 'email', 'panel', 'asistido', 'manual'));

create or replace function public.registrar_envio_manual(p_excedente uuid, p_entidad uuid)
returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex   excedentes;
  fila oferta_respuestas;
  tel  text;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot registrar un enviament manual' using errcode = '42501';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.estado not in ('publicada', 'parcial') then
    raise exception 'oferta_no_disponible: aquesta oferta no admet interessos' using errcode = '22023';
  end if;
  select telefono into tel from entidades where id = p_entidad;
  if not found then
    raise exception 'entitat_inexistent' using errcode = '22023';
  end if;

  select * into fila from oferta_respuestas
   where excedente_id = p_excedente and entidad_id = p_entidad for update;

  -- Un interés vivo no se pisa: reenviar la oferta lo devolvería a «pendent» y se perderían
  -- los kilos que la entidad ya pidió.
  if fila.id is not null and (fila.estado = 'acceptada' or fila.aprovacio = 'aprovada') then
    raise exception 'ja_resposta: aquesta entitat ja ha respost' using errcode = '22023';
  end if;

  if fila.id is null then
    insert into oferta_respuestas (excedente_id, entidad_id, telefono, canal, estado, enviado_at)
    values (p_excedente, p_entidad, tel, 'manual', 'pendent', now())
    returning * into fila;
  else
    update oferta_respuestas
       set canal = 'manual', estado = 'pendent', telefono = tel, enviado_at = now(),
           respondido_at = null, mensaje_respuesta = null, dialeg_pas = null, dialeg_dades = '{}',
           kg_solicitados = null, caixes_solicitades = null, preu_ofert = null,
           modalitat = null, recollida_at = null,
           -- Solo si estaba rechazada: mover `aprovacio` exige `pot_aprovar()` (trigger).
           aprovacio = 'pendent'
     where id = fila.id
    returning * into fila;
  end if;
  return fila;
end;
$$;

revoke execute on function public.registrar_envio_manual(uuid, uuid) from public, anon;
grant execute on function public.registrar_envio_manual(uuid, uuid) to authenticated, service_role;

comment on function public.registrar_envio_manual(uuid, uuid) is
  'La oferta enviada a mano a una entidad (canal manual): fila pendent sin que salga nada. Equipo (20270430100100).';
