-- =============================================================================
-- Plan 2 · A5 (10-11-2026): naturalesa de la organización y perfil de recepción por tipología.
-- Filas 2.7 y 2.8 de la Taula mestra (captura de Sebas, 09-11) y decisión D6.
-- =============================================================================
--
-- 2.7 · NATURALESA: «Entitat social» (fundacions, associacions, sense ànim de lucre) o «Empresa»
--       (societats mercantils i altres operadors). Es un eje de la ORGANIZACIÓN, distinto del rol
--       (ofertant/receptor) y distinto de `tipo_receptor` (lo que la receptora HACE con el
--       excedente: social · animal · transformador · comercial). Vive en `organizaciones`, la
--       identidad común de las dos fichas.
-- 2.8 · PERFIL POR TIPOLOGÍA: el perfil de recepción se pinta según la naturalesa (frontend,
--       `lib/perfilReceptor.ts`); a una empresa no se le enseñan campos sociales.
--
-- SUGERIDA, NO IMPUESTA. `naturalesa_suggerida(nif, forma)` la deduce de la letra del NIF (y, si
-- el NIF no lo dice, de la forma jurídica) y se guarda con `naturalesa_origen = 'suggerida'`. Solo
-- una persona la CONFIRMA (`fixar_naturalesa`, origen `confirmada`): el equipo siempre; el titular
-- de la organización mientras no esté confirmada (una vez confirmada, solo el equipo la cambia:
-- decide qué ofertas ve, igual que `tipo_receptor`, que el titular no toca).
--
-- P8 · EMPRESA → COMPRA Y MAQUILA (nunca donación), hasta que la Fundació diga otra cosa. La regla
-- vive EN TABLA (`modalitat_naturalesa_compat`), como `modalitat_receptor_compat`: cambiarla es un
-- insert/delete. Se cruza con la matriz por tipo en los DOS puntos que la usan
-- (`modalitats_compatibles_meves()` → Mercat; `comprova_interes()` → interés propio, asistido y
-- WhatsApp) y SOLO cuando la naturalesa está CONFIRMADA.
--
-- ⚠️ COMPATIBILIDAD HACIA ATRÁS (ventana base → frontend): una organización sin naturalesa
--    confirmada —todas al aplicar esta migración: el backfill solo SUGIERE— ve y puede mostrar
--    interés EXACTAMENTE como antes. El frontend publicado no conoce las columnas nuevas y no le
--    hacen falta. `v_organizaciones` solo gana columnas al final; `exportar_entitats` gana una
--    columna al final (drop + create: cambia `returns table`, misma firma de argumentos).
--
-- Idempotente: se puede aplicar dos veces.

-- ---------------------------------------------------------------------------
-- 1. Columnas de `organizaciones`
-- ---------------------------------------------------------------------------
alter table public.organizaciones
  add column if not exists naturalesa        text,
  add column if not exists naturalesa_origen text;

alter table public.organizaciones drop constraint if exists organizaciones_naturalesa;
alter table public.organizaciones add constraint organizaciones_naturalesa
  check (naturalesa in ('entitat_social', 'empresa'));
alter table public.organizaciones drop constraint if exists organizaciones_naturalesa_origen;
alter table public.organizaciones add constraint organizaciones_naturalesa_origen
  check (naturalesa_origen in ('suggerida', 'confirmada'));
-- Las dos a la vez: no hay origen sin valor ni valor sin origen.
alter table public.organizaciones drop constraint if exists organizaciones_naturalesa_coherent;
alter table public.organizaciones add constraint organizaciones_naturalesa_coherent
  check ((naturalesa is null) = (naturalesa_origen is null));

comment on column public.organizaciones.naturalesa is
  'A5 (2.7): entitat_social · empresa. Eje de la organización, distinto del rol y de tipo_receptor. '
  'Con origen confirmada, una empresa no ve ni pide donaciones (modalitat_naturalesa_compat, P8).';
comment on column public.organizaciones.naturalesa_origen is
  'suggerida (por NIF o forma jurídica, la recalculan los triggers de las fichas) · confirmada '
  '(fixar_naturalesa: el equipo, o el titular mientras no esté confirmada).';

-- ---------------------------------------------------------------------------
-- 2. La sugerencia (pura)
-- ---------------------------------------------------------------------------
-- Letra del NIF (orden EHA/451/2008):
--   entitat_social ← G (associacions, fundacions), R (entitats religioses), P (corporacions
--                    locals), Q (organismes públics), S (òrgans de l'Administració de l'Estat).
--   empresa        ← A, B, C, D (societats mercantils), E (comunitats de béns), J (societats
--                    civils), N (entitats estrangeres), U (UTE), W (establiments permanents) i
--                    persones físiques (DNI, NIE X/Y/Z, K/L/M): autònoms.
--   sense suggeriment ← F (cooperatives: n'hi ha d'agràries i d'iniciativa social), H
--                    (comunitats de propietaris), V (altres tipus): ho decideix una persona.
-- Si el NIF no la dice (vacío, forma rara o letra ambigua), la forma jurídica (`TIPUS_EMPRESA`):
-- fundacio · associacio → entitat_social; sl · sa · autonom · sc · cb · sat → empresa;
-- cooperativa · altres → nada. Espejo en `src/lib/naturalesa.ts` (paridad en su test).
create or replace function public.naturalesa_suggerida(p_nif text, p_forma text default null)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  n text := upper(regexp_replace(coalesce(p_nif, ''), '[\s.\-]', '', 'g'));
  f text := lower(btrim(coalesce(p_forma, '')));
begin
  if n ~ '^[GRPQS][0-9]{7}[0-9A-J]$' then
    return 'entitat_social';
  end if;
  if n ~ '^[ABCDEJNUW][0-9]{7}[0-9A-J]$' or n ~ '^[0-9]{8}[A-Z]$' or n ~ '^[XYZKLM][0-9]{7}[A-Z]$' then
    return 'empresa';
  end if;
  if f in ('fundacio', 'associacio') then
    return 'entitat_social';
  end if;
  if f in ('sl', 'sa', 'autonom', 'sc', 'cb', 'sat') then
    return 'empresa';
  end if;
  return null;
end;
$$;
revoke execute on function public.naturalesa_suggerida(text, text) from public, anon;
grant execute on function public.naturalesa_suggerida(text, text) to authenticated, service_role;

-- La sugerencia de UNA organización, con lo que digan hoy sus fichas (la receptora primero, como
-- `v_organizaciones` hace con el nombre al revés: el NIF es el mismo en las dos, D7). No toca una
-- naturalesa confirmada. Interna: la usan los triggers y el backfill.
create or replace function public.refresca_naturalesa_suggerida(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n text;
begin
  select public.naturalesa_suggerida(
           coalesce(nullif(btrim(e.nif), ''), nullif(btrim(p.nif), '')),
           coalesce(nullif(btrim(e.tipo_entidad), ''), nullif(btrim(p.tipo_empresa), '')))
    into v_n
    from public.organizaciones o
    left join public.entidades e on e.organizacion_id = o.id
    left join public.productores p on p.organizacion_id = o.id
   where o.id = p_org;

  update public.organizaciones
     set naturalesa = v_n,
         naturalesa_origen = case when v_n is null then null else 'suggerida' end
   where id = p_org
     and naturalesa_origen is distinct from 'confirmada'
     and (naturalesa is distinct from v_n
          or naturalesa_origen is distinct from case when v_n is null then null else 'suggerida' end);
end;
$$;
revoke execute on function public.refresca_naturalesa_suggerida(uuid) from public, anon, authenticated;
grant execute on function public.refresca_naturalesa_suggerida(uuid) to service_role;

-- Trigger de las dos fichas: al nacer y cuando cambia el NIF o la forma jurídica. AFTER: el
-- `before insert` que crea la organización (`organizacion_id not null`) ya ha corrido. SECURITY
-- DEFINER: una ficha se puede actualizar con UPDATE directo (equipo) y quien la actualiza no tiene
-- privilegio sobre `organizaciones`.
create or replace function public.trg_fitxa_naturalesa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.organizacion_id is not null then
    perform public.refresca_naturalesa_suggerida(new.organizacion_id);
  end if;
  if tg_op = 'UPDATE' and old.organizacion_id is distinct from new.organizacion_id
     and old.organizacion_id is not null then
    perform public.refresca_naturalesa_suggerida(old.organizacion_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.trg_fitxa_naturalesa() from public, anon, authenticated;

drop trigger if exists trg_entidades_naturalesa on public.entidades;
create trigger trg_entidades_naturalesa
  after insert or update of nif, tipo_entidad, organizacion_id on public.entidades
  for each row execute function public.trg_fitxa_naturalesa();
drop trigger if exists trg_productores_naturalesa on public.productores;
create trigger trg_productores_naturalesa
  after insert or update of nif, tipo_empresa, organizacion_id on public.productores
  for each row execute function public.trg_fitxa_naturalesa();

-- Backfill: SUGERIDA, nunca confirmada (no cambia lo que ve nadie). Lo confirmado no se toca.
select public.refresca_naturalesa_suggerida(o.id)
  from public.organizaciones o
 where o.naturalesa_origen is distinct from 'confirmada';

-- ---------------------------------------------------------------------------
-- 3. La regla P8, en tabla
-- ---------------------------------------------------------------------------
create table if not exists public.modalitat_naturalesa_compat (
  modalitat  text not null check (modalitat in ('donacio', 'venda', 'maquila')),
  naturalesa text not null check (naturalesa in ('entitat_social', 'empresa')),
  primary key (modalitat, naturalesa)
);
comment on table public.modalitat_naturalesa_compat is
  'A5 (P8): qué modalidades admite cada naturalesa CONFIRMADA, ADEMÁS de la matriz por tipo '
  '(modalitat_receptor_compat). Entitat social: las tres (sin restricción nueva). Empresa: venda y '
  'maquila, nunca donación. Cambiar la regla es un insert/delete.';

insert into public.modalitat_naturalesa_compat (modalitat, naturalesa) values
  ('donacio', 'entitat_social'),
  ('venda',   'entitat_social'),
  ('maquila', 'entitat_social'),
  ('venda',   'empresa'),
  ('maquila', 'empresa')
on conflict do nothing;

alter table public.modalitat_naturalesa_compat enable row level security;
revoke all on public.modalitat_naturalesa_compat from anon, authenticated;
grant select on public.modalitat_naturalesa_compat to authenticated;
grant all privileges on public.modalitat_naturalesa_compat to service_role;
drop policy if exists "catalogo legible" on public.modalitat_naturalesa_compat;
create policy "catalogo legible"
  on public.modalitat_naturalesa_compat for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4. RPC `fixar_naturalesa`
-- ---------------------------------------------------------------------------
-- El equipo (`es_intern()`, incluido `tecnic`) siempre; el titular de cualquiera de las fichas de
-- la organización, mientras no esté confirmada (`42501 naturalesa_confirmada` después). El permiso
-- se comprueba antes que la existencia: un uuid inventado da `42501` a un externo.
create or replace function public.fixar_naturalesa(p_org uuid, p_naturalesa text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intern boolean := auth.uid() is null or public.es_intern();
  v_origen text;
begin
  if not v_intern
     and not exists (select 1 from public.entidades e
                      where e.organizacion_id = p_org and public.soc_titular('entidad', e.id))
     and not exists (select 1 from public.productores p
                      where p.organizacion_id = p_org and public.soc_titular('productor', p.id)) then
    raise exception 'nomes_equip_o_titular' using errcode = '42501';
  end if;

  if p_naturalesa is null or p_naturalesa not in ('entitat_social', 'empresa') then
    raise exception 'naturalesa_desconeguda' using errcode = '22023';
  end if;

  select naturalesa_origen into v_origen from public.organizaciones where id = p_org for update;
  if not found then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;
  if not v_intern and v_origen = 'confirmada' then
    raise exception 'naturalesa_confirmada: ja esta confirmada; per canviar-la, parla amb l''equip' using errcode = '42501';
  end if;

  update public.organizaciones
     set naturalesa = p_naturalesa, naturalesa_origen = 'confirmada'
   where id = p_org;
end;
$$;
revoke execute on function public.fixar_naturalesa(uuid, text) from public, anon;
grant execute on function public.fixar_naturalesa(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Los dos consumidores de la matriz: Mercat e interés
-- ---------------------------------------------------------------------------
-- 5a. El Mercat (rama del mercado de la RLS de `excedentes`). Misma firma y GRANT.
create or replace function public.modalitats_compatibles_meves()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct c.modalitat
    from entidades e
    join organizaciones o on o.id = e.organizacion_id
    join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
   where e.id in (select public.mis_entidades())
     and e.activo
     -- A5 (P8): solo con naturalesa CONFIRMADA; sugerida o sin ella, como antes.
     and (o.naturalesa_origen is distinct from 'confirmada'
          or exists (select 1 from modalitat_naturalesa_compat n
                      where n.naturalesa = o.naturalesa and n.modalitat = c.modalitat));
$$;

-- 5b. El interés (panel, asistido y WhatsApp comparten esta función). Igual que en
-- 20270501100000 salvo el cruce con la naturalesa confirmada. Mismo mensaje de rechazo: el
-- frontend publicado ya lo traduce.
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

-- ---------------------------------------------------------------------------
-- 6. `v_organizaciones`: + naturalesa al final (sigue `security_invoker`)
-- ---------------------------------------------------------------------------
create or replace view public.v_organizaciones
with (security_invoker = true) as
  select o.id,
         coalesce(p.name, e.nombre)                        as nombre,
         coalesce(nullif(p.nif, ''), nullif(e.nif, ''))     as nif,
         coalesce(nullif(p.email, ''), nullif(e.email, '')) as email,
         coalesce(nullif(p.phone, ''), nullif(e.telefono, '')) as telefono,
         coalesce(p.poblacion, e.poblacion)                 as poblacion,
         p.id      as productor_id,
         e.id      as entidad_id,
         (p.id is not null) as es_generadora,
         (e.id is not null) as es_receptora,
         e.tipo_receptor,
         o.canal_preferido,
         o.created_at,
         (coalesce(p.activo, false) or coalesce(e.activo, false)) as activa,
         p.activo  as productor_activo,
         e.activo  as entidad_activo,
         coalesce(nullif(p.razon_social, ''), nullif(e.razon_social, '')) as razon_social,
         coalesce(nullif(p.empresa, ''), nullif(e.nombre, ''), nullif(p.name, '')) as nom_comercial,
         coalesce(nullif(p.name, ''), nullif(e.contacto, ''))  as persona_contacte,
         coalesce(p.municipio_ine, e.municipio_ine)            as municipio_ine,
         coalesce(nullif(p.area_geografica, ''), nullif(e.area_geografica, '')) as comarca,
         array(select distinct x
                 from unnest(coalesce(p.tipus_activitat, '{}'::text[]) || coalesce(e.tipus_activitat, '{}'::text[])) x
                order by x) as tipus_activitat,
         coalesce(m.n_actives, 0) > 0 as te_compte,
         case
           when coalesce(m.n_actives, 0) > 0     then 'activa'
           when coalesce(m.n_pendents, 0) > 0    then 'pendent'
           when coalesce(m.n_desactivades, 0) > 0 then 'desactivada'
           else 'cap'
         end as compte_estat,
         -- B1 (20270518100000)
         p.estat_crm as productor_estat_crm,
         e.estat_crm as entidad_estat_crm,
         -- A5 (20270523100000)
         o.naturalesa,
         o.naturalesa_origen
    from public.organizaciones o
    left join public.productores p on p.organizacion_id = o.id
    left join public.entidades   e on e.organizacion_id = o.id
    left join lateral (
      select count(*) filter (where mb.activo and mb.aprovacio = 'aprovada' and pf.activo)            as n_actives,
             count(*) filter (where mb.aprovacio = 'pendent')                                         as n_pendents,
             count(*) filter (where mb.aprovacio = 'aprovada' and not (mb.activo and pf.activo))     as n_desactivades
        from public.membresias mb
        join public.perfiles pf on pf.id = mb.user_id
       where (p.id is not null and mb.productor_id = p.id)
          or (e.id is not null and mb.entidad_id = e.id)
    ) m on true;

comment on view public.v_organizaciones is
  'Quién es cada organización, leído de sus fichas: nunca se duplica el nombre ni el NIF. '
  'Los roles (`es_generadora`, `es_receptora`) son DERIVADOS de tener ficha, y `activa` de tener '
  'algún papel activo (D7, 20270501100000). `compte_estat`: cap · pendent · activa · desactivada. '
  'Estado CRM por papel (`productor_estat_crm`, `entidad_estat_crm`) desde 20270518100000. '
  'Naturalesa y su origen (suggerida · confirmada) desde 20270523100000.';

-- ---------------------------------------------------------------------------
-- 7. Exportación (B3): + «Naturalesa», SOLO la confirmada
-- ---------------------------------------------------------------------------
-- Una sugerida sale vacía: reimportarla la convertiría en confirmada, y «exportar → reimportar =
-- sense_canvis» (B3/B4) dejaría de cumplirse. Cambia `returns table`: drop + create + GRANT.
drop function if exists public.exportar_entitats(uuid[]);
create function public.exportar_entitats(p_ids uuid[] default null)
returns table (
  organizacion_id uuid, es_test boolean, rols text[], nom_comercial text, razon_social text, nif text,
  tipus_empresa text, tipo_receptor text, tipus_activitat text[], modalitats_interes text[],
  persona_contacte text, email text, email2 text, telefon text, telefon2 text, direccion text,
  codigo_postal text, municipi text, area_geografica text, airtable_id text, data_alta text,
  estat_crm_productor text, estat_crm_entidad text, naturalesa text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'nomes_equip' using errcode = '42501';
  end if;

  return query
  select o.id,
         coalesce(p.es_test, false) or coalesce(e.es_test, false),
         array_remove(array[case when p.id is not null then 'productor' end,
                            case when e.id is not null then 'entidad' end], null),
         v->>'nom_comercial', v->>'razon_social', v->>'nif', v->>'tipus_empresa', v->>'tipo_receptor',
         public.importacio_text_array(v->'tipus_activitat'), public.importacio_text_array(v->'modalitats_interes'),
         v->>'persona_contacte', v->>'email', v->>'email2', v->>'telefon', v->>'telefon2',
         v->>'direccion', v->>'codigo_postal', v->>'municipi', v->>'area_geografica', v->>'airtable_id',
         v->>'data_alta',
         p.estat_crm,
         e.estat_crm,
         case when o.naturalesa_origen = 'confirmada' then o.naturalesa end
    from organizaciones o
    left join productores p on p.organizacion_id = o.id
    left join entidades e on e.organizacion_id = o.id
    cross join lateral (select public.entitat_valors_org(p, e) as v) x
   where (p.id is not null or e.id is not null)
     and (p_ids is null or o.id = any(p_ids))
   order by lower(coalesce(v->>'nom_comercial', '')), o.id;
end;
$$;
revoke execute on function public.exportar_entitats(uuid[]) from public, anon;
grant execute on function public.exportar_entitats(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Importación (B4): columna «Naturalesa» opcional
-- ---------------------------------------------------------------------------
-- Sin reescribir el importador (dos funciones de cientos de líneas): las versiones de B4 pasan a
-- llamarse `*_b4` y una envoltura con el nombre de siempre añade la naturalesa. `alter function …
-- rename` conserva cuerpo y ACL. Una celda con valor CONFIRMA (lo dice una persona, D11: lo que
-- trae valor manda); vacía no toca nada.
do $$
begin
  if to_regprocedure('public.importacio_normalitza_fila_b4(jsonb, jsonb)') is null then
    alter function public.importacio_normalitza_fila(jsonb, jsonb) rename to importacio_normalitza_fila_b4;
  end if;
  if to_regprocedure('public.importacio_aplica_fila_b4(jsonb, uuid, boolean, text[], text)') is null then
    alter function public.importacio_aplica_fila(jsonb, uuid, boolean, text[], text) rename to importacio_aplica_fila_b4;
  end if;
end;
$$;

-- 8a. Normalizar: el código o la etiqueta («Entitat social», «Empresa»; también «Entidad social»
-- y «Social»). Un valor que no se reconoce no es un error de la fila: aviso y sin naturalesa.
create or replace function public.importacio_normalitza_fila(p_f jsonb, p_munis jsonb)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_n   jsonb := public.importacio_normalitza_fila_b4(p_f, p_munis);
  v_txt text  := lower(unaccent(btrim(coalesce(p_f->>'naturalesa', ''))));
  v_nat text;
begin
  if v_txt = '' then
    return v_n || jsonb_build_object('nat', null);
  end if;
  v_nat := case
    when v_txt in ('entitat_social', 'entitat social', 'entidad social', 'entidad_social', 'social') then 'entitat_social'
    when v_txt in ('empresa') then 'empresa'
  end;
  if v_nat is null then
    return v_n || jsonb_build_object('nat', null,
      'avisos', coalesce(v_n->'avisos', '[]'::jsonb) || jsonb_build_array('naturalesa_desconeguda'));
  end if;
  return v_n || jsonb_build_object('nat', v_nat);
end;
$$;
revoke execute on function public.importacio_normalitza_fila(jsonb, jsonb) from public, anon, authenticated;

-- 8b. Aplicar: tras la fila de B4, la naturalesa de la organización. Una existente que ya la tiene
-- CONFIRMADA con el mismo valor: sin cambio (reimportar lo exportado = `sense_canvis`). Si no, un
-- `canvi` (la Revisió lo enseña) y, al aplicar, `confirmada`. Una organización nueva la recibe
-- confirmada al crearse (sin `canvi`: la fila entera es nueva).
create or replace function public.importacio_aplica_fila(p_n jsonb, p_org uuid, p_aplicar boolean, p_ocupats text[], p_data text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res    jsonb := public.importacio_aplica_fila_b4(p_n, p_org, p_aplicar, p_ocupats, p_data);
  v_nat    text  := p_n->>'nat';
  v_org    uuid;
  v_abans  text;
  v_origen text;
begin
  if v_nat is null then
    return v_res;
  end if;
  v_org := (v_res->>'organizacion_id')::uuid;

  if p_org is not null then
    select naturalesa, naturalesa_origen into v_abans, v_origen from public.organizaciones where id = p_org;
    if v_abans is not distinct from v_nat and v_origen = 'confirmada' then
      return v_res;
    end if;
    v_res := v_res || jsonb_build_object(
      'omplira', coalesce(v_res->'omplira', '[]'::jsonb) || jsonb_build_array('organizaciones.naturalesa'),
      'canvis', coalesce(v_res->'canvis', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'taula', 'organizaciones', 'columna', 'naturalesa', 'camp', 'naturalesa',
        -- Una sugerida no es un valor confirmado: «abans» vacío (la Revisió enseña «— → Empresa»).
        'abans', case when v_origen = 'confirmada' then v_abans end, 'despres', v_nat)));
    if v_res->>'accio' = 'sense_canvis' then
      v_res := v_res || jsonb_build_object('accio', 'actualitzar');
    end if;
  end if;

  if p_aplicar and v_org is not null then
    update public.organizaciones
       set naturalesa = v_nat, naturalesa_origen = 'confirmada'
     where id = v_org;
  end if;
  return v_res;
end;
$$;
revoke execute on function public.importacio_aplica_fila(jsonb, uuid, boolean, text[], text) from public, anon, authenticated;
