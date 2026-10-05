-- Rebanada 2 de la reunión de seguimiento del 05-10-2026 (plan en `3. Claude Code/
-- 2026-10-05-plan-ejecucion-reunion-seguimiento.md`): avisos, badges y edición.
--
--   1. `avisos`: lo que la aplicación tiene que contarle a una organización (oferta validada,
--      salida encontrada, kilos aprobados distintos de los pedidos…). Una fila por aviso; el
--      panel la enseña (campana y badges) y la Edge Function `enviar-avis` la manda por el
--      canal que toque. **Todo lo que avise a alguien pasa por aquí**: no se añaden correos
--      sueltos.
--   2. `oferta_respuestas.kg_aprovats`: aprobar ya NO pisa lo que pidió la entidad.
--   3. `perfiles.mercat_vist_at`: el badge «noves» del Mercat.
--   4. `editar_oferta()` + `excedentes_canvis`: el productor (y el equipo) corrigen una oferta
--      publicada; si cambian producto, kg o modalidades, vuelve a validación (D4).
--   5. `contraparts_canalitzacions()`: tras aprobar, cada parte sabe con quién ha quedado (D1).
--
-- Todo es AÑADIR (§11). Los avisos nacen por TRIGGER y no dentro de cada RPC: las respuestas
-- se aprueban por `aprovar_resposta()` pero se rechazan con un `update` del panel, y las
-- ofertas se validan por RPC pero el job de vencidas también las mueve. Un trigger es el
-- único sitio por el que pasan todos los caminos.

-- ---------------------------------------------------------------------------
-- 1. La tabla de avisos
-- ---------------------------------------------------------------------------
create table if not exists avisos (
  id               uuid primary key default gen_random_uuid(),
  -- El aviso es de la ORGANIZACIÓN (de su ficha), no de una persona: lo ven todas sus
  -- cuentas, igual que ven sus ofertas.
  destinatari_tipo text not null check (destinatari_tipo in ('productor', 'entidad')),
  destinatari_id   uuid not null,
  tipus            text not null check (tipus in (
                     'oferta_validada', 'oferta_rebutjada', 'sortida_trobada',
                     'interes_aprovat', 'interes_rebutjat')),
  objecte_tipo     text not null check (objecte_tipo in ('excedente', 'oferta_resposta')),
  objecte_id       uuid not null,
  params           jsonb not null default '{}'::jsonb,
  llegit_at        timestamptz,
  -- Lo escribe `enviar-avis` (service_role): por dónde salió, o por qué no.
  canal_enviat     text check (canal_enviat is null or canal_enviat in ('email', 'whatsapp', 'cap')),
  enviat_at        timestamptz,
  error_envio      text,
  intents          integer not null default 0,
  created_at       timestamptz not null default now()
);

comment on table avisos is
  'Avisos a una organización (05-10-2026). Los crean triggers; los envía la Edge Function enviar-avis; el panel los lista y los marca como leídos con marcar_avisos_llegits().';

create index if not exists avisos_desti_idx on avisos (destinatari_tipo, destinatari_id, created_at desc);
create index if not exists avisos_no_llegits_idx on avisos (destinatari_tipo, destinatari_id) where llegit_at is null;
create index if not exists avisos_pendents_envio_idx on avisos (created_at) where enviat_at is null;

alter table avisos enable row level security;

-- Sin GRANT de escritura para nadie (§4: `authenticated` nace solo con SELECT desde
-- `20270322100100`, y aquí se deja explícito por si ese default cambia).
revoke all on avisos from anon, authenticated;
grant select on avisos to authenticated;
grant all on avisos to service_role;

drop policy if exists "avisos: els meus" on avisos;
create policy "avisos: els meus"
  on avisos for select to authenticated
  using (
       (select public.es_intern())
    or (destinatari_tipo = 'productor' and destinatari_id in (select public.mis_productores()))
    or (destinatari_tipo = 'entidad'   and destinatari_id in (select public.mis_entidades()))
  );

-- Interna: solo la llaman los triggers (definer) y `service_role`.
create or replace function public.crear_avis(
  p_destinatari_tipo text, p_destinatari_id uuid, p_tipus text,
  p_objecte_tipo text, p_objecte_id uuid, p_params jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_destinatari_id is null then return null; end if;
  insert into avisos (destinatari_tipo, destinatari_id, tipus, objecte_tipo, objecte_id, params)
  values (p_destinatari_tipo, p_destinatari_id, p_tipus, p_objecte_tipo, p_objecte_id,
          coalesce(p_params, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.crear_avis(text, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.crear_avis(text, uuid, text, text, uuid, jsonb) to service_role;

-- Marcar como leídos los MÍOS: por ids, o todos los de un tipo de objeto (lo que hace la
-- pantalla al abrirse: «Els meus interessos» marca los de `oferta_resposta`). Sin
-- argumentos, todos. Devuelve cuántos.
create or replace function public.marcar_avisos_llegits(
  p_ids uuid[] default null, p_objecte_tipo text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  if auth.uid() is null then
    raise exception 'Cal sessio' using errcode = '42501';
  end if;
  update avisos a
     set llegit_at = now()
   where a.llegit_at is null
     and (p_ids is null or a.id = any(p_ids))
     and (p_objecte_tipo is null or a.objecte_tipo = p_objecte_tipo)
     and ((a.destinatari_tipo = 'productor' and a.destinatari_id in (select public.mis_productores()))
       or (a.destinatari_tipo = 'entidad'   and a.destinatari_id in (select public.mis_entidades())));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.marcar_avisos_llegits(uuid[], text) from public, anon;
grant  execute on function public.marcar_avisos_llegits(uuid[], text) to authenticated;

-- El envío: mismo molde que `documentos_encola_generacion` (20260928100700) y el MISMO
-- secreto (`documentos_secret` / `x-documentos-secret`), para no añadir un secreto más que
-- configurar en dos sitios. Sin secreto, no-op con notice: el aviso existe igual en el panel.
create or replace function trg_avisos_encola_envio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secreto text;
begin
  select value into secreto from app_config where key = 'documentos_secret';
  if secreto is null or secreto = '' then
    raise notice 'avisos_encola_envio: sense secret configurat, no-op (%).', new.id;
    return new;
  end if;
  perform net.http_post(
    url     := public.url_funciones() || '/enviar-avis',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-documentos-secret', secreto),
    body    := jsonb_build_object('aviso_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists avisos_encola_envio on avisos;
create trigger avisos_encola_envio
  after insert on avisos
  for each row execute function trg_avisos_encola_envio();

-- El reintento: lo que se quedó sin enviar (función caída, `net.http_post` perdido), cada
-- 15 minutos y como mucho tres veces. A partir de ahí se queda en el panel, que es donde
-- el aviso existe de verdad.
create or replace function public.disparar_avisos_pendents()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secreto text;
  r record;
  n integer := 0;
begin
  select value into secreto from app_config where key = 'documentos_secret';
  if secreto is null or secreto = '' then return 0; end if;
  for r in
    select id from avisos
     where enviat_at is null and intents < 3
       and created_at < now() - interval '5 minutes'
       and created_at > now() - interval '3 days'
     order by created_at
     limit 50
  loop
    update avisos set intents = intents + 1 where id = r.id;
    perform net.http_post(
      url     := public.url_funciones() || '/enviar-avis',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-documentos-secret', secreto),
      body    := jsonb_build_object('aviso_id', r.id)
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.disparar_avisos_pendents() from public, anon, authenticated;
grant  execute on function public.disparar_avisos_pendents() to service_role;

do $$
begin
  perform cron.unschedule('avisos-pendents')
    where exists (select 1 from cron.job where jobname = 'avisos-pendents');
exception when others then null;
end $$;
select cron.schedule('avisos-pendents', '*/15 * * * *', 'select public.disparar_avisos_pendents()');

-- ---------------------------------------------------------------------------
-- 2. Kilos aprobados aparte de los pedidos
-- ---------------------------------------------------------------------------
alter table oferta_respuestas add column if not exists kg_aprovats numeric
  check (kg_aprovats is null or kg_aprovats > 0);
comment on column oferta_respuestas.kg_aprovats is
  'Los kg que aprobó el equipo (05-10-2026). `kg_solicitados` se queda con lo que pidió la entidad.';

-- Las aprobadas antes de hoy: `aprovar_resposta()` pisaba `kg_solicitados` con lo aprobado,
-- así que lo único que se sabe es eso. Se copia para que la pantalla no diga «aprovats: —».
update oferta_respuestas r
   set kg_aprovats = c.kg_confirmados
  from canalizaciones c
 where r.canalizacion_id = c.id and r.aprovacio = 'aprovada' and r.kg_aprovats is null
   and c.kg_confirmados > 0;

-- Misma función que `20270409100000` con DOS cambios: `kg_solicitados` ya no se toca y se
-- escribe `kg_aprovats`. Firma idéntica, así que `create or replace` basta y conserva el GRANT.
create or replace function public.aprovar_resposta(
  p_resposta uuid,
  p_kg       numeric default null,
  p_preu     numeric default null,
  p_motiu    text default null,
  p_modalitat text default null
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
  cubierto numeric;
  v_mods   text[];
  v_val    text;
  v_aviso  text;
begin
  if not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden aprovar' using errcode = '42501';
  end if;

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

  v_aviso := public.exigir_convenio('productor', ex.productor_id, v_val, 'entrega');
  if v_aviso is not null then raise notice '%', v_aviso; end if;
  v_aviso := public.exigir_convenio('entidad', r.entidad_id, v_val, 'recibe');
  if v_aviso is not null then raise notice '%', v_aviso; end if;

  insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, estado, valorizacion)
  values (r.excedente_id, r.entidad_id, kg, 'confirmada', v_val)
  returning * into c;

  update oferta_respuestas
     set aprovacio       = 'aprovada',
         aprovat_at      = now(),
         motiu_aprovacio = p_motiu,
         canalizacion_id = c.id,
         kg_aprovats     = kg,
         modalitat       = v_val,
         preu_ofert      = case when v_val = 'donacio' then null
                                else coalesce(p_preu, r.preu_ofert) end
   where id = r.id;

  select coalesce(sum(kg_confirmados), 0) into cubierto
    from canalizaciones where excedente_id = ex.id;

  update excedentes
     set estado = case
           when coalesce(ex.kg_total, 0) > 0 and cubierto >= ex.kg_total then 'bloqueada'
           else 'parcial'
         end
   where id = ex.id and estado in ('publicada', 'parcial');

  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Los triggers que crean los avisos
-- ---------------------------------------------------------------------------
-- Una respuesta aprobada o rechazada. D1 (decisión del 05-10-2026): una vez aprobada, las
-- dos partes saben quién es la otra — la entidad, la productora y el municipio; la
-- productora, la entidad. Antes de aprobar rige D3 y aquí no se nombra a nadie.
create or replace function trg_respostes_avis()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex   excedentes;
  v_prod text;
  v_mun  text;
  v_ent  text;
  v_kg   numeric;
begin
  if new.aprovacio is not distinct from old.aprovacio then return new; end if;
  select * into ex from excedentes where id = new.excedente_id;
  if ex.id is null then return new; end if;

  if new.aprovacio = 'aprovada' then
    v_kg := coalesce(new.kg_aprovats,
                     (select c.kg_confirmados from canalizaciones c where c.id = new.canalizacion_id),
                     new.kg_solicitados);
    select coalesce(nullif(p.empresa, ''), p.name) into v_prod from productores p where p.id = ex.productor_id;
    v_mun := coalesce((select u.municipio from productor_ubicaciones u where u.id = ex.ubicacion_id),
                      (select p.poblacion from productores p where p.id = ex.productor_id));
    select e.nombre into v_ent from entidades e where e.id = new.entidad_id;

    perform public.crear_avis('entidad', new.entidad_id, 'interes_aprovat', 'oferta_resposta', new.id,
      jsonb_build_object(
        'producte', ex.producto, 'kg_sol', new.kg_solicitados, 'kg_apr', v_kg,
        'modalitat', new.modalitat, 'productor', v_prod, 'municipi', v_mun,
        'excedente_id', ex.id));
    perform public.crear_avis('productor', ex.productor_id, 'sortida_trobada', 'excedente', ex.id,
      jsonb_build_object(
        'producte', ex.producto, 'ref', ex.id_excedente, 'kg', v_kg, 'entitat', v_ent,
        'modalitat', new.modalitat));
  elsif new.aprovacio = 'rebutjada' then
    perform public.crear_avis('entidad', new.entidad_id, 'interes_rebutjat', 'oferta_resposta', new.id,
      jsonb_build_object('producte', ex.producto, 'motiu', new.motiu_aprovacio,
                         'excedente_id', ex.id));
  end if;
  return new;
end;
$$;

drop trigger if exists oferta_respuestas_avis on oferta_respuestas;
create trigger oferta_respuestas_avis
  after update of aprovacio on oferta_respuestas
  for each row execute function trg_respostes_avis();

-- Una oferta que sale de validación.
create or replace function trg_excedentes_avis_validacio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.estado <> 'pendent_validacio' or new.estado = old.estado then return new; end if;
  if new.estado in ('publicada', 'parcial') then
    perform public.crear_avis('productor', new.productor_id, 'oferta_validada', 'excedente', new.id,
      jsonb_build_object('producte', new.producto, 'ref', new.id_excedente));
  elsif new.estado = 'cancelada' and new.validada_at is not null then
    -- Solo el rechazo del equipo (`rebutjar_oferta` escribe `validada_at`); si la cancela el
    -- propio productor o la vence el job, no hay nada que contarle.
    perform public.crear_avis('productor', new.productor_id, 'oferta_rebutjada', 'excedente', new.id,
      jsonb_build_object('producte', new.producto, 'ref', new.id_excedente,
                         'motiu', new.motivo_no_colocada));
  end if;
  return new;
end;
$$;

drop trigger if exists excedentes_avis_validacio on excedentes;
create trigger excedentes_avis_validacio
  after update of estado on excedentes
  for each row execute function trg_excedentes_avis_validacio();

-- `validar_oferta()` devolvía siempre `publicada`. Una oferta que vuelve a validación tras
-- una edición (D4, abajo) puede tener ya canalizaciones: entonces vuelve a `parcial` o
-- `bloqueada`, que es lo que era.
create or replace function public.validar_oferta(p_id uuid)
returns excedentes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ex excedentes;
  cubierto numeric;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden validar una oferta' using errcode = '42501';
  end if;
  select * into ex from excedentes where id = p_id for update;
  if ex.id is null or ex.estado <> 'pendent_validacio' then
    raise exception 'Aquesta oferta no esta pendent de validacio (estat %)',
      coalesce(ex.estado, 'inexistent') using errcode = '22023';
  end if;
  select coalesce(sum(kg_confirmados), 0) into cubierto from canalizaciones where excedente_id = ex.id;
  update excedentes
     set estado = case
                    when cubierto <= 0 then 'publicada'
                    when coalesce(ex.kg_total, 0) > 0 and cubierto >= ex.kg_total then 'bloqueada'
                    else 'parcial'
                  end,
         validada_at = now(), validada_per = auth.uid()
   where id = ex.id
  returning * into ex;
  return ex;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. El badge «noves» del Mercat
-- ---------------------------------------------------------------------------
alter table perfiles add column if not exists mercat_vist_at timestamptz;
comment on column perfiles.mercat_vist_at is
  'Última vez que la cuenta salió del Mercat (05-10-2026). Las ofertas publicadas después cuentan como «noves».';

create or replace function public.marcar_mercat_vist()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'Cal sessio' using errcode = '42501';
  end if;
  update perfiles set mercat_vist_at = v where id = auth.uid();
  return v;
end;
$$;
revoke execute on function public.marcar_mercat_vist() from public, anon;
grant  execute on function public.marcar_mercat_vist() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Editar una oferta (D4)
-- ---------------------------------------------------------------------------
create table if not exists excedentes_canvis (
  id           uuid primary key default gen_random_uuid(),
  excedente_id uuid not null references excedentes(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  abans        jsonb not null,
  despres      jsonb not null,
  revalidar    boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists excedentes_canvis_exc_idx on excedentes_canvis (excedente_id, created_at desc);
alter table excedentes_canvis enable row level security;
revoke all on excedentes_canvis from anon, authenticated;
grant select on excedentes_canvis to authenticated;
grant all on excedentes_canvis to service_role;
drop policy if exists "excedentes_canvis: equip i productor" on excedentes_canvis;
create policy "excedentes_canvis: equip i productor"
  on excedentes_canvis for select to authenticated
  using (
       (select public.es_intern())
    or excedente_id in (select e.id from excedentes e where e.productor_id in (select public.mis_productores()))
  );

-- La llama SOLO la Edge Function `crear-oferta` (ruta `/editar`), que es quien sabe componer
-- el `texto_oferta` (`componerTextoOferta()` vive en TypeScript y duplicarlo aquí acabaría
-- divergiendo). Por eso recibe al actor por parámetro y no tiene EXECUTE para nadie más:
-- un `authenticated` podría pasar el uuid de otro.
--
-- `p_canvis` admite solo estas claves: kg_total, modalitats, preu_minim, coste_kg,
-- disponible_hasta, hora_recollida_inici, hora_recollida_fi, horari_recollida, observacions,
-- variedad, num_caixes. El producto NO se edita: cambia `id_excedente`, el icono y lo que
-- vieron las entidades; para eso se cancela y se publica otra.
create or replace function public.editar_oferta(
  p_id uuid, p_canvis jsonb, p_texto text, p_actor uuid
)
returns excedentes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ex        excedentes;
  nou       excedentes;
  v_intern  boolean;
  v_prod    boolean;
  cubierto  numeric;
  v_mods    text[];
  revalidar boolean := false;
  clau      text;
  permeses  text[] := array['kg_total', 'modalitats', 'preu_minim', 'coste_kg', 'disponible_hasta',
                            'hora_recollida_inici', 'hora_recollida_fi', 'horari_recollida',
                            'observacions', 'variedad', 'num_caixes'];
begin
  if p_actor is null then
    raise exception 'Cal actor' using errcode = '42501';
  end if;
  select * into ex from excedentes where id = p_id for update;
  if ex.id is null then
    raise exception 'Oferta inexistent' using errcode = '22023';
  end if;

  v_intern := exists (select 1 from usuario_roles ur where ur.user_id = p_actor);
  v_prod := exists (select 1 from membresias m
                     where m.user_id = p_actor and m.activo and m.productor_id = ex.productor_id);
  if not v_intern and not v_prod then
    raise exception 'No pots editar aquesta oferta' using errcode = '42501';
  end if;
  if ex.estado not in ('pendent_validacio', 'publicada', 'parcial', 'bloqueada') then
    raise exception 'oferta_no_editable: una oferta % no es pot editar', ex.estado using errcode = '22023';
  end if;

  for clau in select jsonb_object_keys(p_canvis) loop
    if not (clau = any(permeses)) then
      raise exception 'camp_no_editable: %', clau using errcode = '22023';
    end if;
  end loop;

  select coalesce(sum(kg_confirmados), 0) into cubierto from canalizaciones where excedente_id = ex.id;
  if p_canvis ? 'kg_total' then
    if (p_canvis->>'kg_total')::numeric is null or (p_canvis->>'kg_total')::numeric <= 0 then
      raise exception 'kg_invalids' using errcode = '22023';
    end if;
    if (p_canvis->>'kg_total')::numeric < cubierto then
      raise exception 'kg_menys_canalitzats: ja n''hi ha % kg canalitzats', cubierto using errcode = '22023';
    end if;
  end if;
  if p_canvis ? 'modalitats' then
    select array_agg(m order by array_position(array['donacio','venda','maquila'], m))
      into v_mods
      from (select distinct jsonb_array_elements_text(p_canvis->'modalitats') m) s;
    if v_mods is null or cardinality(v_mods) = 0 then
      raise exception 'modalitats_buides' using errcode = '22023';
    end if;
    -- Una entrega ya aprobada en una modalidad no puede quedar fuera de la oferta.
    if exists (select 1 from canalizaciones c where c.excedente_id = ex.id
                and c.valorizacion is not null and not (c.valorizacion = any(v_mods))) then
      raise exception 'modalitat_amb_canalitzacions' using errcode = '22023';
    end if;
  end if;

  update excedentes e set
    kg_total             = case when p_canvis ? 'kg_total' then (p_canvis->>'kg_total')::numeric else e.kg_total end,
    modalitats           = case when p_canvis ? 'modalitats' then v_mods else e.modalitats end,
    modalitat            = case when p_canvis ? 'modalitats' then v_mods[1] else e.modalitat end,
    preu_minim           = case when p_canvis ? 'preu_minim' then nullif(p_canvis->>'preu_minim', '')::numeric else e.preu_minim end,
    coste_kg             = case when p_canvis ? 'coste_kg' then nullif(p_canvis->>'coste_kg', '')::numeric else e.coste_kg end,
    disponible_hasta     = case when p_canvis ? 'disponible_hasta' then nullif(p_canvis->>'disponible_hasta', '')::date else e.disponible_hasta end,
    hora_recollida_inici = case when p_canvis ? 'hora_recollida_inici' then nullif(p_canvis->>'hora_recollida_inici', '')::time else e.hora_recollida_inici end,
    hora_recollida_fi    = case when p_canvis ? 'hora_recollida_fi' then nullif(p_canvis->>'hora_recollida_fi', '')::time else e.hora_recollida_fi end,
    horari_recollida     = case when p_canvis ? 'horari_recollida' then nullif(p_canvis->>'horari_recollida', '') else e.horari_recollida end,
    observacions         = case when p_canvis ? 'observacions' then nullif(p_canvis->>'observacions', '') else e.observacions end,
    variedad             = case when p_canvis ? 'variedad' then nullif(p_canvis->>'variedad', '') else e.variedad end,
    num_caixes           = case when p_canvis ? 'num_caixes' then nullif(p_canvis->>'num_caixes', '')::integer else e.num_caixes end,
    texto_oferta         = coalesce(nullif(p_texto, ''), e.texto_oferta)
  where e.id = ex.id
  returning * into nou;

  -- D4: el productor cambia lo que decide a quién le sirve la oferta → vuelve a validación,
  -- si la validación está encendida y la oferta ya estaba fuera. El equipo no revalida: es
  -- quien valida.
  if not v_intern and public.validacio_ofertes_activa()
     and ex.estado in ('publicada', 'parcial', 'bloqueada')
     and (nou.kg_total is distinct from ex.kg_total
          or nou.modalitats is distinct from ex.modalitats) then
    revalidar := true;
    update excedentes set estado = 'pendent_validacio', validada_at = null, validada_per = null
     where id = ex.id
    returning * into nou;
  end if;

  -- Cubierto o no, con los kg nuevos.
  if not revalidar and nou.estado in ('publicada', 'parcial', 'bloqueada') and cubierto > 0 then
    update excedentes set estado = case
             when coalesce(nou.kg_total, 0) > 0 and cubierto >= nou.kg_total then 'bloqueada'
             else 'parcial' end
     where id = ex.id
    returning * into nou;
  end if;

  insert into excedentes_canvis (excedente_id, user_id, abans, despres, revalidar)
  values (ex.id, p_actor,
          (select jsonb_object_agg(k, to_jsonb(ex) -> k) from jsonb_object_keys(p_canvis) k),
          (select jsonb_object_agg(k, to_jsonb(nou) -> k) from jsonb_object_keys(p_canvis) k),
          revalidar);
  return nou;
end;
$$;
revoke execute on function public.editar_oferta(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant  execute on function public.editar_oferta(uuid, jsonb, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. D1: con quién has quedado, una vez aprobado
-- ---------------------------------------------------------------------------
-- Una fila por canalización en la que estoy de alguna de las dos partes. Al productor le
-- dice la entidad; a la entidad, la productora, el municipio y el enlace de Maps del lugar
-- de recogida. Nada antes de aprobar: sin canalización no hay fila (D3).
create or replace function public.contraparts_canalitzacions()
returns table (
  canalizacion_id uuid, excedente_id uuid, resposta_id uuid, rol text,
  contrapart text, municipi text, gmaps_url text, kg numeric, modalitat text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.excedente_id, r.id, 'productor'::text,
         en.nombre, en.poblacion, null::text, c.kg_confirmados, c.valorizacion
    from canalizaciones c
    join excedentes e on e.id = c.excedente_id
    left join entidades en on en.id = c.entidad_id
    left join oferta_respuestas r on r.canalizacion_id = c.id
   where auth.uid() is not null
     and e.productor_id in (select public.mis_productores())
  union all
  select c.id, c.excedente_id, r.id, 'entidad'::text,
         coalesce(nullif(p.empresa, ''), p.name),
         coalesce(u.municipio, p.poblacion), u.gmaps_url, c.kg_confirmados, c.valorizacion
    from canalizaciones c
    join excedentes e on e.id = c.excedente_id
    left join productores p on p.id = e.productor_id
    left join productor_ubicaciones u on u.id = e.ubicacion_id
    left join oferta_respuestas r on r.canalizacion_id = c.id
   where auth.uid() is not null
     and c.entidad_id in (select public.mis_entidades());
$$;
revoke execute on function public.contraparts_canalitzacions() from public, anon;
grant  execute on function public.contraparts_canalitzacions() to authenticated;
