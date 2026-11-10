-- Plan 2 · rebanada B1 (10-11-2026): estado CRM por papel.
--
-- POR QUÉ. La revisión de Sebas del 09-11 (Teams 1; Taula mestra 1.5) pide que cada papel de
-- una entidad tenga un estado de relación —Potencial · En desenvolupament · Actiu · Inactiu— en
-- «Gestió interna › Estat i papers». Decisión D8 de Carles: **el estado CRM manda y `activo` se
-- deriva** (`activo = (estat_crm = 'actiu')`). Potencial y En desenvolupament NO operan (ni
-- Mercat, ni priorización, ni selectores: todos miran `activo`). Pasar a Actiu exige lo de
-- siempre: NIF válido y razón social (`trg_fitxa_estat`).
--
-- SOLO AÑADE (§7): el frontend publicado sigue leyendo y escribiendo `activo` igual
-- (`activar_fitxa`/`desactivar_fitxa`/`*_organitzacio`) y el trigger traduce ese camino legado
-- al estado CRM. `aprovar_registre` conserva su firma (`returns membresias`).
--
-- Contenido:
--   1. `estat_crm` en `productores` y `entidades` + backfill + `fitxa_estat_hist.estat_crm`.
--   2. `trg_fitxa_estat()` recreada sobre `update of activo, estat_crm` (T5: un trigger aparte
--      no se dispararía, porque `update of activo` mira el SET, no el cambio) y
--      `trg_fitxa_estat_alta()` en el INSERT (coherencia `activo ↔ estat_crm`).
--   3. `fitxa_estat_hist`: el rastro de las altas se completa con el estado de la ficha.
--   4. RPC `fixar_estat_crm()` (pot_aprovar).
--   5. `aprovar_registre()` intenta pasar la ficha a `actiu` (P1).
--   6. `v_organizaciones` y `v_entitats_llistat`: estados por papel y de la organización.
--
-- Valor inicial por vía (D8):
--   · `crear_entitat()` → `actiu` (ya exige NIF válido y razón social; manda `p_activo = true`);
--   · importador del panel (`alta_fitxa_interna(p_activo = false)`) → `potencial`;
--   · registro propio (`registro`, Edge Function) → `en_desenvolupament` (lo manda la función
--     desde este cambio; hasta redesplegarla, el registro nace `actiu` como hoy);
--   · importador ARA 2026 (script) → por hoja, misma tabla que el backfill.
-- Decisión de esta sesión: la columna NO lleva `default`. En un BEFORE INSERT el default ya
-- está aplicado y no se distinguiría «no viene» de «viene potencial»; sin default, el trigger
-- de alta lo decide (si no viene, `activo` decide `actiu`/`potencial`) y el NOT NULL se
-- comprueba después de los triggers. Así `alta_fitxa_interna` no cambia de firma.

-- ---------------------------------------------------------------------------
-- 1. Columnas y backfill
-- ---------------------------------------------------------------------------
alter table public.productores add column if not exists estat_crm text;
alter table public.entidades   add column if not exists estat_crm text;
alter table public.fitxa_estat_hist add column if not exists estat_crm text;

-- Backfill, en este orden (plan §4 B1): activa → actiu; si no, por la hoja del ARA de la que
-- viene; si alguna vez estuvo activa → inactiu; resto → potencial. Antes que nada, el
-- «No procedeix» del `entidades.estat` legado → inactiu: era lo único que excluía de la
-- priorización (`_shared/priorizacion.ts`), que deja de mirarlo en este cambio.
-- Sin triggers de estado todavía (se crean abajo): este UPDATE no deja rastro ni comprueba NIF.
update public.entidades e
   set estat_crm = case
     when lower(btrim(coalesce(e.estat, ''))) = 'no procedeix' and not e.activo then 'inactiu'
     when e.activo then 'actiu'
     when e.ref_externa like 'ARA26:%\_inactius:%' then 'inactiu'
     when e.ref_externa like 'ARA26:sda:%' then 'en_desenvolupament'
     when exists (select 1 from public.fitxa_estat_hist h where h.entidad_id = e.id and h.activo) then 'inactiu'
     else 'potencial'
   end
 where e.estat_crm is null;

update public.productores p
   set estat_crm = case
     when p.activo then 'actiu'
     when p.ref_externa like 'ARA26:prod\_potencials:%' then 'potencial'
     when p.ref_externa like 'ARA26:%\_inactius:%' then 'inactiu'
     when p.ref_externa like 'ARA26:prod\_actius:%' then 'en_desenvolupament'
     when exists (select 1 from public.fitxa_estat_hist h where h.productor_id = p.id and h.activo) then 'inactiu'
     else 'potencial'
   end
 where p.estat_crm is null;

-- El historial de antes: el estado que correspondía a cada `activo` registrado.
update public.fitxa_estat_hist
   set estat_crm = case when activo then 'actiu' else 'inactiu' end
 where estat_crm is null;

alter table public.productores alter column estat_crm set not null;
alter table public.entidades   alter column estat_crm set not null;
alter table public.productores drop constraint if exists productores_estat_crm_check;
alter table public.productores add constraint productores_estat_crm_check
  check (estat_crm in ('potencial', 'en_desenvolupament', 'actiu', 'inactiu'));
alter table public.entidades drop constraint if exists entidades_estat_crm_check;
alter table public.entidades add constraint entidades_estat_crm_check
  check (estat_crm in ('potencial', 'en_desenvolupament', 'actiu', 'inactiu'));
alter table public.fitxa_estat_hist drop constraint if exists fitxa_estat_hist_estat_crm_check;
alter table public.fitxa_estat_hist add constraint fitxa_estat_hist_estat_crm_check
  check (estat_crm is null or estat_crm in ('potencial', 'en_desenvolupament', 'actiu', 'inactiu'));

comment on column public.productores.estat_crm is
  'B1 (20270518100000, D8): estado de la relación del papel ofertante — potencial · en_desenvolupament · actiu · inactiu. MANDA: `activo` = (estat_crm = ''actiu''), lo deriva el trigger productores_estat. Se cambia con fixar_estat_crm().';
comment on column public.entidades.estat_crm is
  'B1 (20270518100000, D8): estado de la relación del papel receptor — potencial · en_desenvolupament · actiu · inactiu. MANDA: `activo` = (estat_crm = ''actiu''), lo deriva el trigger entidades_estat. Se cambia con fixar_estat_crm().';
comment on column public.entidades.estat is
  'LEGADO del Excel del ARA (texto libre). Sin uso desde 20270518100000: el estado lo lleva estat_crm y la exclusión de la priorización, activo. Se conserva hasta autorizar su drop (deuda §12.172).';
comment on column public.fitxa_estat_hist.estat_crm is
  'B1 (20270518100000): el estado CRM tras el cambio (null solo en filas muy antiguas sin correspondencia).';

-- ---------------------------------------------------------------------------
-- 2. El trigger de estado, fundido (T5)
-- ---------------------------------------------------------------------------
-- UPDATE: si cambia `estat_crm`, manda y deriva `activo`; si no, y cambia `activo` (el camino
-- legado de `activar_/desactivar_fitxa` y `*_organitzacio`, y la escritura directa del equipo),
-- se traduce al estado: activar → actiu; desactivar una ficha que estaba actiu → inactiu (una
-- que nunca operó conserva su estado). Después, las mismas guardas de siempre al activar y la
-- fila en el historial, ahora con el estado.
create or replace function public.trg_fitxa_estat()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estat_crm is distinct from old.estat_crm then
    new.activo := (new.estat_crm = 'actiu');
  elsif new.activo is distinct from old.activo then
    new.estat_crm := case
      when new.activo then 'actiu'
      when old.estat_crm = 'actiu' then 'inactiu'
      else old.estat_crm
    end;
  else
    return new;
  end if;

  -- Activar (de inactiva a activa) exige NIF presente y válido y razón social (D2, P9 del
  -- plan 1). Desactivar no exige nada.
  if new.activo and not coalesce(old.activo, false) then
    if nullif(btrim(coalesce(new.nif, '')), '') is null then
      raise exception 'falta_nif: cal el NIF per activar la fitxa' using errcode = '22023';
    end if;
    if not public.nif_valid(new.nif) then
      raise exception 'nif_invalid: el NIF % no es valid', new.nif using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(new.razon_social, '')), '') is null then
      raise exception 'falta_rao_social: cal la rao social per activar la fitxa' using errcode = '22023';
    end if;
  end if;

  insert into public.fitxa_estat_hist (tipus, productor_id, entidad_id, activo, estat_crm, per)
  values (
    case tg_table_name when 'productores' then 'productor' else 'entidad' end,
    case when tg_table_name = 'productores' then new.id end,
    case when tg_table_name = 'entidades' then new.id end,
    coalesce(new.activo, false),
    new.estat_crm,
    auth.uid()
  );
  return new;
end;
$$;
revoke execute on function public.trg_fitxa_estat() from public, anon, authenticated;

drop trigger if exists productores_estat on public.productores;
create trigger productores_estat before update of activo, estat_crm on public.productores
  for each row execute function public.trg_fitxa_estat();
drop trigger if exists entidades_estat on public.entidades;
create trigger entidades_estat before update of activo, estat_crm on public.entidades
  for each row execute function public.trg_fitxa_estat();

-- INSERT: coherencia `activo ↔ estat_crm`. Si viene `estat_crm`, manda; si no, `activo`
-- decide (`actiu` / `potencial`). No inserta en el historial: lo hacen quienes dan de alta
-- (`alta_fitxa_interna`, `crear_entitat`) y el rastro se completa en el punto 3.
create or replace function public.trg_fitxa_estat_alta()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.estat_crm is null then
    new.estat_crm := case when coalesce(new.activo, false) then 'actiu' else 'potencial' end;
  else
    new.activo := (new.estat_crm = 'actiu');
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_fitxa_estat_alta() from public, anon, authenticated;

drop trigger if exists productores_estat_alta on public.productores;
create trigger productores_estat_alta before insert on public.productores
  for each row execute function public.trg_fitxa_estat_alta();
drop trigger if exists entidades_estat_alta on public.entidades;
create trigger entidades_estat_alta before insert on public.entidades
  for each row execute function public.trg_fitxa_estat_alta();

-- ---------------------------------------------------------------------------
-- 3. El rastro del alta, con el estado
-- ---------------------------------------------------------------------------
-- `alta_fitxa_interna` y `crear_entitat` escriben su fila de historial sin `estat_crm` (no
-- cambian de firma en esta rebanada): se toma el de la ficha, que ya existe.
create or replace function public.trg_fitxa_estat_hist_estat()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estat_crm is null then
    if new.productor_id is not null then
      select estat_crm into new.estat_crm from public.productores where id = new.productor_id;
    elsif new.entidad_id is not null then
      select estat_crm into new.estat_crm from public.entidades where id = new.entidad_id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_fitxa_estat_hist_estat() from public, anon, authenticated;

drop trigger if exists fitxa_estat_hist_estat on public.fitxa_estat_hist;
create trigger fitxa_estat_hist_estat before insert on public.fitxa_estat_hist
  for each row execute function public.trg_fitxa_estat_hist_estat();

comment on table public.fitxa_estat_hist is
  'Cada cambio de estado de una ficha (`activo` y, desde 20270518100000, `estat_crm`): quién (`per`, null = servidor) y cuándo. Solo inserción, por trigger. Lectura: equipo.';

-- ---------------------------------------------------------------------------
-- 4. `fixar_estat_crm()`
-- ---------------------------------------------------------------------------
-- El selector de «Estat i papers». Solo `pot_aprovar()` (admin y super_admin), como
-- `activar_/desactivar_fitxa`. El permiso antes que la existencia (§4bis): un uuid inventado
-- da 42501 a quien no puede y `22023 fitxa_inexistent` a quien sí. Las reglas (NIF, razón
-- social) y el historial, el trigger.
create or replace function public.fixar_estat_crm(p_tipus text, p_id uuid, p_estat text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden canviar l''estat d''una fitxa' using errcode = '42501';
  end if;
  if p_estat is null or p_estat not in ('potencial', 'en_desenvolupament', 'actiu', 'inactiu') then
    raise exception 'estat_desconegut: %', coalesce(p_estat, 'null') using errcode = '22023';
  end if;
  if p_tipus = 'productor' then
    update productores set estat_crm = p_estat where id = p_id;
  elsif p_tipus = 'entidad' then
    update entidades set estat_crm = p_estat where id = p_id;
  else
    raise exception 'tipus_desconegut: %', coalesce(p_tipus, 'null') using errcode = '22023';
  end if;
  if not found then
    raise exception 'fitxa_inexistent' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.fixar_estat_crm(text, uuid, text) from public, anon;
grant  execute on function public.fixar_estat_crm(text, uuid, text) to authenticated;
comment on function public.fixar_estat_crm(text, uuid, text) is
  'B1 (20270518100000): fija el estado CRM de un papel (potencial · en_desenvolupament · actiu · inactiu); `activo` lo deriva el trigger, que exige NIF válido y razón social para actiu. pot_aprovar() con sesión.';

-- ---------------------------------------------------------------------------
-- 5. `aprovar_registre()`: la ficha intenta pasar a `actiu` (P1)
-- ---------------------------------------------------------------------------
-- Misma firma y mismo retorno. El registro propio nace `en_desenvolupament`; al aprobarlo, la
-- ficha pasa a `actiu` si cumple la regla (NIF válido y razón social). Si el trigger lo corta,
-- la aprobación sigue (la cuenta entra) y la ficha se queda como estaba: la cola de Aprovacions
-- lee el estado y lo avisa. Una ficha que el equipo ya puso `inactiu` no se toca.
create or replace function public.aprovar_registre(p_membresia uuid)
returns membresias
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m membresias;
begin
  if not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden validar un registre' using errcode = '42501';
  end if;

  select * into m from membresias where id = p_membresia for update;
  if m.id is null or m.aprovacio <> 'pendent' then
    raise exception 'Aquest registre no es pot aprovar' using errcode = '22023';
  end if;

  update membresias
     set activo          = true,
         aprovacio       = 'aprovada',
         aprovat_at      = now(),
         aprovat_per     = auth.uid(),
         motiu_aprovacio = null
   where id = m.id
  returning * into m;

  begin
    if m.productor_id is not null then
      update productores set estat_crm = 'actiu'
       where id = m.productor_id and estat_crm in ('potencial', 'en_desenvolupament');
    elsif m.entidad_id is not null then
      update entidades set estat_crm = 'actiu'
       where id = m.entidad_id and estat_crm in ('potencial', 'en_desenvolupament');
    end if;
  exception when sqlstate '22023' then
    null; -- falta_nif · nif_invalid · falta_rao_social: se queda; Aprovacions lo avisa.
  end;
  return m;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Las vistas (columnas AL FINAL; siguen `security_invoker`)
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
         e.estat_crm as entidad_estat_crm
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
  'Estado CRM por papel (`productor_estat_crm`, `entidad_estat_crm`) desde 20270518100000.';

-- `estat_crm` de la ORGANIZACIÓN: `actiu` si algún papel lo es; si no, el más avanzado
-- (en_desenvolupament > potencial > inactiu). Es la dimensión «Estat» del listado sin `?rol=`.
create or replace view public.v_entitats_llistat
with (security_invoker = true) as
  select v.id,
         v.nom_comercial,
         v.razon_social,
         v.nif,
         v.persona_contacte,
         v.email,
         v.telefono,
         v.poblacion,
         v.comarca,
         v.municipio_ine,
         v.productor_id,
         v.entidad_id,
         v.es_generadora,
         v.es_receptora,
         v.productor_activo,
         v.entidad_activo,
         v.activa,
         v.tipo_receptor,
         v.tipus_activitat,
         v.te_compte,
         v.compte_estat,
         v.canal_preferido,
         v.created_at,
         coalesce(p.es_test, false) or coalesce(e.es_test, false) as es_test,
         exists (select 1 from public.membresias m
                  where m.aprovacio = 'rebutjada'
                    and ((p.id is not null and m.productor_id = p.id) or (e.id is not null and m.entidad_id = e.id))) as rebutjada,
         coalesce(e.modalitats_interes, '{}'::text[]) as modalitats_interes,
         e.prioritat,
         p.id is not null and exists (select 1 from public.convenios c
                                       where c.estado = 'vigent' and c.productor_id = p.id) as conveni_productor,
         e.id is not null and exists (select 1 from public.convenios c
                                       where c.estado = 'vigent' and c.entidad_id = e.id) as conveni_entitat,
         greatest(
           (select max(x.created_at) from public.excedentes x where p.id is not null and x.productor_id = p.id),
           (select max(r.created_at) from public.oferta_respuestas r where e.id is not null and r.entidad_id = e.id),
           (select max(c.created_at) from public.canalizaciones c where e.id is not null and c.entidad_id = e.id)
         ) as darrera_activitat,
         dc.data  as darrer_contacte_at,
         dc.canal as darrer_contacte_canal,
         coalesce(sp.n, 0)::integer as seguiments_pendents,
         sp.propera as propera_seguiment,
         -- B1 (20270518100000)
         v.productor_estat_crm,
         v.entidad_estat_crm,
         case
           when 'actiu' in (v.productor_estat_crm, v.entidad_estat_crm) then 'actiu'
           when 'en_desenvolupament' in (v.productor_estat_crm, v.entidad_estat_crm) then 'en_desenvolupament'
           when 'potencial' in (v.productor_estat_crm, v.entidad_estat_crm) then 'potencial'
           else 'inactiu'
         end as estat_crm
    from public.v_organizaciones v
    left join public.productores p on p.id = v.productor_id
    left join public.entidades   e on e.id = v.entidad_id
    left join lateral (
      select n.data, n.canal
        from public.notes_internes n
       where n.organizacion_id = v.id
       order by n.data desc, n.created_at desc
       limit 1
    ) dc on true
    left join lateral (
      select count(*) as n, min(n.propera_data) as propera
        from public.notes_internes n
       where n.organizacion_id = v.id and n.propera_accio is not null and n.seguiment_fet_at is null
    ) sp on true
   where v.productor_id is not null or v.entidad_id is not null;
