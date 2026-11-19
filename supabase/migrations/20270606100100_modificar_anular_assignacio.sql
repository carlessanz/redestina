-- Fase 2 del plan de los puntos 4-6 (cambio B2): MODIFICAR y ANULAR una asignación.
--
-- Una asignación es la canalización que nace al aprobar un interés (nivel 2) o al asignar
-- directamente (nivel 1, A1). Hasta aquí solo se podía anular su albarán (`anular_albaran`),
-- que dejaba la canalización `anulada` pero no tocaba la respuesta ni el estado de la oferta.
--
-- Esta migración:
--
--   1. `canalizaciones`: `anulada_at`, `anulada_per` (FK a auth.users ON DELETE SET NULL: el
--      traspaso de autoría del equipo la recoge sola, por catálogo) y `motiu_anulacio`.
--   2. Trigger `canalizaciones_protegeix_assignacio` (BEFORE INSERT OR UPDATE): con sesión, sin
--      la marca `redestina.escriu_assignacio` y fuera de un traspaso de autoría, nadie escribe
--      `anulada_*` ni lleva una canalización a (o la saca de) `anulada`. Lo amplía A1 con el
--      precio acordado.
--   3. `avisos_tipus_check` + `assignacio_anulada` (texto en `_shared/textAvis.ts`, que se
--      publica ANTES que esta migración: si no, `enviar-avis` lo marca `tipus_desconegut`).
--   4. `trg_respostes_avis`: calla con la marca `redestina.anula_assignacio` (una anulación no
--      manda también `interes_rebutjat`: manda `assignacio_anulada`).
--   5. `trg_canalitzacio_avis_canvis`: si cambian kg y hora a la vez, salen los DOS avisos
--      (antes el `elsif` solo mandaba `recollida_canviada`).
--   6. `anula_canalitzacio(p_canalizacion, p_motiu)`, INTERNA: anula sus albaranes vivos, la
--      canalización, rechaza la respuesta («anul·lada: …»), avisa a las dos partes y recalcula.
--   7. `anular_assignacio(p_canalizacion, p_motiu)` y `modificar_assignacio(p_canalizacion,
--      p_kg, p_recollida)`: las RPC del equipo (`pot_aprovar()`).
--   8. `anular_albaran()` (misma firma): un ENT/OPE con canalización viva delega en la interna.
--
-- Compatible hacia atrás: columnas nulas, firmas nuevas, `anular_albaran` con la misma firma.

-- ---------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------
alter table public.canalizaciones
  add column if not exists anulada_at     timestamptz,
  add column if not exists anulada_per    uuid references auth.users(id) on delete set null,
  add column if not exists motiu_anulacio text;

comment on column public.canalizaciones.anulada_at is
  'Cuándo se anuló la asignación (anular_assignacio / anular_albaran, 20270606100100). Las anuladas antes de esa fecha, nulas.';
comment on column public.canalizaciones.anulada_per is
  'Quién la anuló (cuenta del equipo; nulo si fue el servidor).';
comment on column public.canalizaciones.motiu_anulacio is
  'Motivo obligatorio de la anulación; la respuesta queda rebutjada con «anul·lada: <motiu>».';

-- ---------------------------------------------------------------------------
-- 2. Protección: la anulación solo por su RPC
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
    return new;
  end if;
  if new.anulada_at        is distinct from old.anulada_at
     or new.anulada_per    is distinct from old.anulada_per
     or new.motiu_anulacio is distinct from old.motiu_anulacio
     or ((new.estado = 'anulada') is distinct from (old.estado = 'anulada')) then
    raise exception 'assignacio_protegida: una assignacio nomes s''anul.la per anular_assignacio'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_canalizaciones_protegeix_assignacio() from public, anon, authenticated;

drop trigger if exists canalizaciones_protegeix_assignacio on public.canalizaciones;
create trigger canalizaciones_protegeix_assignacio
  before insert or update on public.canalizaciones
  for each row execute function public.trg_canalizaciones_protegeix_assignacio();

-- ---------------------------------------------------------------------------
-- 3. El aviso nuevo
-- ---------------------------------------------------------------------------
-- Superconjunto del vigente (20270428100000): las filas actuales cumplen. Igualmente `not valid`
-- + `validate`, que es la norma sobre tablas con datos.
alter table public.avisos drop constraint if exists avisos_tipus_check;
alter table public.avisos add constraint avisos_tipus_check check (tipus = any (array[
  'oferta_validada', 'oferta_rebutjada', 'sortida_trobada', 'interes_aprovat', 'interes_rebutjat',
  'oferta_sense_desti', 'recollida_canviada', 'kg_assignats_canviats', 'recollida_confirmada',
  'oferta_modificada', 'oferta_enviada', 'certificat_per_revisar', 'recollida_per_registrar',
  'recollida_retornada', 'document_signat',
  -- 20270606100100:
  'assignacio_anulada'])) not valid;
alter table public.avisos validate constraint avisos_tipus_check;

-- ---------------------------------------------------------------------------
-- 4. `trg_respostes_avis`: calla durante una anulación
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20270412100000) con la salida de la marca al principio.
create or replace function public.trg_respostes_avis()
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
  -- 20270606100100: la anulación de una asignación rechaza la respuesta, pero el aviso que
  -- toca es `assignacio_anulada` (lo crea `anula_canalitzacio`), no `interes_rebutjat`.
  if coalesce(current_setting('redestina.anula_assignacio', true), '') = 'on' then
    return new;
  end if;
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
        'excedente_id', ex.id, 'recollida_at', new.recollida_at));
    perform public.crear_avis('productor', ex.productor_id, 'sortida_trobada', 'excedente', ex.id,
      jsonb_build_object(
        'producte', ex.producto, 'ref', ex.id_excedente, 'kg', v_kg, 'entitat', v_ent,
        'modalitat', new.modalitat, 'recollida_at', new.recollida_at));
  elsif new.aprovacio = 'rebutjada' then
    perform public.crear_avis('entidad', new.entidad_id, 'interes_rebutjat', 'oferta_resposta', new.id,
      jsonb_build_object('producte', ex.producto, 'motiu', new.motiu_aprovacio,
                         'excedente_id', ex.id));
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_respostes_avis() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. `trg_canalitzacio_avis_canvis`: los dos avisos si cambian kg y hora a la vez
-- ---------------------------------------------------------------------------
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
  v_tipus text[] := '{}';
  v_t     text;
  v_par   jsonb;
begin
  if new.estado = 'anulada' then return new; end if;
  if old.data_hora_recollida is not null
     and new.data_hora_recollida is distinct from old.data_hora_recollida then
    v_tipus := array_append(v_tipus, 'recollida_canviada');
  end if;
  if old.kg_confirmados is not null
     and new.kg_confirmados is distinct from old.kg_confirmados then
    v_tipus := array_append(v_tipus, 'kg_assignats_canviats');
  end if;
  if cardinality(v_tipus) = 0 then
    return new;
  end if;

  select * into ex from excedentes where id = new.excedente_id;
  select r.id into v_resp from oferta_respuestas r where r.canalizacion_id = new.id limit 1;
  select e.nombre into v_ent from entidades e where e.id = new.entidad_id;
  v_par := jsonb_build_object(
    'producte', ex.producto, 'kg', new.kg_confirmados, 'kg_abans', old.kg_confirmados,
    'recollida_at', new.data_hora_recollida, 'entitat', v_ent, 'excedente_id', ex.id);

  foreach v_t in array v_tipus loop
    perform public.crear_avis('entidad', new.entidad_id, v_t,
      case when v_resp is null then 'canalizacion' else 'oferta_resposta' end,
      coalesce(v_resp, new.id), v_par);
    perform public.crear_avis('productor', ex.productor_id, v_t, 'excedente', ex.id, v_par);
  end loop;
  return new;
end;
$$;
revoke execute on function public.trg_canalitzacio_avis_canvis() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. `anula_canalitzacio()`: interna
-- ---------------------------------------------------------------------------
-- La llaman `anular_assignacio()` (equipo) y `anular_albaran()` (un ENT/OPE con canalización).
-- Rechazos 22023: `canalitzacio_inexistent`, `canalitzacio_anulada`, `ja_validada` (recogida
-- validada, canalización conciliada o algún albarán SUYO confirmado/conciliado).
-- ⚠️ En esta fase el REC sigue siendo uno por oferta (sin `canalizacion_id`): no se mira ni se
--    anula aquí; puede servir a otras canalizaciones de la misma oferta.
create or replace function public.anula_canalitzacio(p_canalizacion uuid, p_motiu text)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c     canalizaciones;
  ex    excedentes;
  r     oferta_respuestas;
  v_ent text;
  v_mot text := nullif(btrim(coalesce(p_motiu, '')), '');
  v_par jsonb;
  a     record;
begin
  if v_mot is null then
    raise exception 'cal_motiu: cal indicar el motiu de l''anul.lacio' using errcode = '22023';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if c.estado = 'conciliada' or c.recollida_validada_at is not null
     or exists (select 1 from albaranes al
                 where al.canalizacion_id = c.id and al.estado in ('confirmado', 'conciliado')) then
    raise exception 'ja_validada: aquesta recollida ja esta validada; no es pot anul.lar' using errcode = '22023';
  end if;

  -- Sus albaranes vivos, como `anular_albaran()`: anulados, sin documento vigente y sin
  -- enlaces de confirmación que sirvan.
  for a in select al.id from albaranes al
            where al.canalizacion_id = c.id and al.estado in ('borrador', 'emitido', 'entregado')
            for update loop
    update albaranes
       set estado = 'anulado', anulado_at = now(), motivo_anulacion = v_mot
     where id = a.id;
    update documentos set vigente = false
     where objeto_tipo = 'albaran' and objeto_id = a.id and vigente;
    update enlaces_token set estado = 'revocado'
     where objeto_tipo = 'albaran' and objeto_id = a.id and estado = 'activo';
  end loop;

  perform set_config('redestina.escriu_assignacio', 'on', true);
  update canalizaciones
     set estado = 'anulada', anulada_at = now(), anulada_per = auth.uid(), motiu_anulacio = v_mot
   where id = c.id
  returning * into c;
  perform set_config('redestina.escriu_assignacio', 'off', true);

  -- La respuesta: rechazada con el motivo. Conserva `canalizacion_id` y `kg_aprovats` como
  -- rastro. El aviso `interes_rebutjat` lo calla la marca: el que toca es el de abajo.
  select * into r from oferta_respuestas where canalizacion_id = c.id limit 1;
  if r.id is not null then
    perform set_config('redestina.anula_assignacio', 'on', true);
    update oferta_respuestas
       set aprovacio = 'rebutjada',
           motiu_aprovacio = left('anul·lada: ' || v_mot, 1000)
     where id = r.id;
    perform set_config('redestina.anula_assignacio', 'off', true);
  end if;

  select * into ex from excedentes where id = c.excedente_id;
  select e.nombre into v_ent from entidades e where e.id = c.entidad_id;
  v_par := jsonb_build_object(
    'producte', ex.producto, 'kg', c.kg_confirmados, 'motiu', v_mot, 'entitat', v_ent,
    'excedente_id', ex.id);
  perform public.crear_avis('entidad', c.entidad_id, 'assignacio_anulada',
    case when r.id is null then 'canalizacion' else 'oferta_resposta' end,
    coalesce(r.id, c.id), v_par);
  if ex.id is not null then
    perform public.crear_avis('productor', ex.productor_id, 'assignacio_anulada', 'excedente', ex.id, v_par);
    perform public.recalcula_estat_excedent(ex.id);
  end if;

  return c;
end;
$$;
revoke execute on function public.anula_canalitzacio(uuid, text) from public, anon, authenticated;
grant  execute on function public.anula_canalitzacio(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 7a. `anular_assignacio()`: RPC del equipo
-- ---------------------------------------------------------------------------
create or replace function public.anular_assignacio(p_canalizacion uuid, p_motiu text)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden anul.lar una assignacio' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motiu), '') = '' then
    raise exception 'cal_motiu: cal indicar el motiu de l''anul.lacio' using errcode = '22023';
  end if;
  return public.anula_canalitzacio(p_canalizacion, p_motiu);
end;
$$;
revoke execute on function public.anular_assignacio(uuid, text) from public, anon;
grant  execute on function public.anular_assignacio(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7b. `modificar_assignacio()`: kilos y fecha/hora de recogida
-- ---------------------------------------------------------------------------
-- Solo mientras la recogida no esté registrada ni validada y ningún albarán vivo de la
-- canalización haya salido de borrador. La MODALIDAD no se modifica (cambia el tipo de
-- albarán, los convenios y el precio): se anula y se vuelve a asignar.
-- Los avisos (`kg_assignats_canviats`, `recollida_canviada`) los manda el trigger.
create or replace function public.modificar_assignacio(
  p_canalizacion uuid,
  p_kg           numeric     default null,
  p_recollida    timestamptz default null
)
returns canalizaciones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c      canalizaciones;
  ex     excedentes;
  v_kg   numeric;
  v_quan timestamptz;
  a      record;
  l      jsonb;
  v_n    int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden modificar una assignacio' using errcode = '42501';
  end if;
  if p_kg is null and p_recollida is null then
    raise exception 'cal_canvi: no hi ha res a canviar' using errcode = '22023';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'canalitzacio_inexistent' using errcode = '22023';
  end if;
  if c.estado = 'anulada' then
    raise exception 'canalitzacio_anulada' using errcode = '22023';
  end if;
  if c.recollida_registrada_at is not null or c.recollida_validada_at is not null
     or c.estado = 'conciliada' then
    raise exception 'ja_registrada: la recollida ja esta registrada; no es pot modificar' using errcode = '22023';
  end if;
  if exists (select 1 from albaranes al
              where al.canalizacion_id = c.id
                and al.estado not in ('borrador', 'anulado', 'rectificado')) then
    raise exception 'albara_emes: l''albara ja s''ha emes; anul.la l''assignacio' using errcode = '22023';
  end if;

  select * into ex from excedentes where id = c.excedente_id;
  if p_kg is not null then
    if p_kg <= 0 then
      raise exception 'Cal indicar els kg a canalitzar' using errcode = '22023';
    end if;
    if ex.kg_total is not null and p_kg > ex.kg_total then
      raise exception 'kg_maxim: com a maxim % kg', ex.kg_total using errcode = '22023';
    end if;
  end if;
  -- La regla del equipo: solo «no pasada» (puede salirse de la franja si lo ha hablado).
  if p_recollida is not null and p_recollida < now() - interval '1 hour' then
    raise exception 'hora_passada: la recollida no pot ser en el passat' using errcode = '22023';
  end if;

  v_kg   := coalesce(p_kg, c.kg_confirmados);
  v_quan := coalesce(p_recollida, c.data_hora_recollida);
  if v_kg is not distinct from c.kg_confirmados
     and v_quan is not distinct from c.data_hora_recollida then
    raise exception 'cal_canvi: no hi ha res a canviar' using errcode = '22023';
  end if;

  update canalizaciones
     set kg_confirmados      = v_kg,
         data_hora_recollida = v_quan,
         registre_demanat_at = case when v_quan is distinct from c.data_hora_recollida
                                    then null else registre_demanat_at end
   where id = c.id
  returning * into c;

  -- Las líneas del albarán de salida en borrador (ENT/OPE de esta canalización). El REC sigue
  -- siendo uno por oferta (kg de la oferta entera) y no se toca.
  if p_kg is not null then
    for a in select al.id from albaranes al
              where al.canalizacion_id = c.id and al.tipo in ('ENT', 'OPE')
                and al.estado = 'borrador' loop
      select count(*) into v_n from albaran_lineas where albaran_id = a.id;
      if v_n = 1 then
        update albaran_lineas set kg_previstos = v_kg where albaran_id = a.id;
      elsif v_n > 1 then
        for l in select * from jsonb_array_elements(public.repartir_kg_linies(a.id, v_kg)) loop
          update albaran_lineas set kg_previstos = (l->>'kg')::numeric
           where id = (l->>'linea_id')::uuid;
        end loop;
      end if;
    end loop;
  end if;

  update oferta_respuestas
     set kg_aprovats = v_kg, recollida_at = v_quan
   where canalizacion_id = c.id;

  perform public.recalcula_estat_excedent(c.excedente_id);
  return c;
end;
$$;
revoke execute on function public.modificar_assignacio(uuid, numeric, timestamptz) from public, anon;
grant  execute on function public.modificar_assignacio(uuid, numeric, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. `anular_albaran()`: misma firma; un ENT/OPE con canalización viva anula la asignación
-- ---------------------------------------------------------------------------
-- Copia de la vigente (20261012100500). Antes ponía la canalización en `anulada` a pelo (sin
-- respuesta, sin aviso, sin recalcular la oferta); ahora delega en `anula_canalitzacio()`, que
-- anula también este albarán. El REC (sin canalización) y un albarán cuya canalización ya
-- estaba anulada siguen el camino de siempre.
create or replace function public.anular_albaran(p_id uuid, p_motivo text)
returns albaranes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a albaranes%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden anul.lar un albara' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Cal indicar el motiu de l''anul.lacio' using errcode = '22023';
  end if;

  -- Un albarán ya conciliado NO se anula: se rectifica.
  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado in ('anulado', 'rectificado', 'conciliado') then
    raise exception 'Aquest albara no es pot anul.lar (%): si ja esta conciliat, rectifica''l',
      coalesce(a.estado, 'no existeix') using errcode = '22023';
  end if;

  if a.tipo in ('ENT', 'OPE') and a.canalizacion_id is not null
     and exists (select 1 from canalizaciones c where c.id = a.canalizacion_id and c.estado <> 'anulada') then
    perform public.anula_canalitzacio(a.canalizacion_id, p_motivo);
    select * into a from albaranes where id = p_id;
    return a;
  end if;

  update albaranes
     set estado = 'anulado', anulado_at = now(), motivo_anulacion = p_motivo
   where id = a.id
  returning * into a;

  update documentos set vigente = false
   where objeto_tipo = 'albaran' and objeto_id = a.id and vigente;

  -- Los enlaces de confirmación que quedaran vivos dejan de servir.
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'albaran' and objeto_id = a.id and estado = 'activo';

  return a;
end;
$$;
revoke execute on function public.anular_albaran(uuid, text) from public, anon;
grant  execute on function public.anular_albaran(uuid, text) to authenticated, service_role;
