-- =============================================================================
-- Punto 3, fase D2 (17-11-2026): EL PRECIO DEL MES DEL ALBARÁN en canalizaciones, albaranes y
-- certificados («opción A» del cliente: «al generar el certificat cal agafar els preus del mes
-- en què es van generar els albarans»).
-- =============================================================================
--
-- La regla:
--   1. Al CREAR la canalización (nace su REC) se fija su valor por kilo:
--        · si el productor declaró coste en la oferta, ese (`declarat`, definitivo);
--        · si no, `preu_referencia_de(producto, mes del albarán)`: el validado de ese mes
--          (definitivo) o el último validado anterior (PROVISIONAL, con su mes);
--        · sin ninguno, null y provisional (deuda 128: lo llenará la validación de su mes).
--      El MES DEL ALBARÁN es el del REC de su oferta (o de su jornada de espigoleig): todas las
--      salidas de una oferta valen lo mismo que el único REC que imprime su valor.
--   2. Al VALIDAR un mes en Productes › Preus (cualquier escritura de `preus_referencia`, por
--      `validar_preus_mes`, `validar_preus_periode` o `fixar_preu_referencia`), un trigger de
--      sentencia ajusta las canalizaciones de ese producto y mes de albarán que sean
--      provisionales o vengan de una referencia de ese mes, salvo `declarat`, `fixat`,
--      `historic` y las ya incluidas en un certificado EMITIDO (`preu_certificat`). Puede tocar
--      canalizaciones conciliadas: solo por este camino (`redestina.ajust_preus`), nunca por
--      escritura directa. Cada cambio deja rastro en `canalizaciones_preu_hist`. Después
--      recalcula los certificados en borrador que las contienen.
--   3. Al EMITIR un certificado (anual, periodo u oferta, y al rectificar) no se busca ningún
--      precio: vale lo guardado en cada canalización. Si alguna sigue provisional, el cálculo
--      añade el bloqueo `preus_provisionals` (producto y mes) y la emisión se niega con
--      `22023 preus_provisionals`; si las líneas no casan con la canalización (precio ajustado
--      después de calcular), `22023 preus_canviats`. Al emitir, las canalizaciones quedan
--      selladas con el número del certificado.
--   4. El REC de donación imprime de dónde sale el valor (`valor_font` en su snapshot) y el
--      certificado, las fuentes usadas (`fonts_valor`, `detall_fonts`). Texto: `_shared/fontValor.ts`.
--   5. `preus_vigents_oferta(fecha)`: la propuesta de «Valor de cost» de la oferta (crear-oferta).
--
-- Compatible hacia atrás: columnas nuevas con valor por defecto; las canalizaciones de antes
-- quedan `historic` (con coste) sin tocar. Las de antes SIN coste (deuda 128) pasan a
-- provisionales con su mes: ya bloqueaban el cierre (`sense_cost`); ahora se valoran solas al
-- validarse su mes. Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas de la valoración en `canalizaciones`
-- ---------------------------------------------------------------------------
alter table public.canalizaciones add column if not exists preu_font text;
alter table public.canalizaciones add column if not exists preu_mes_albara date;
alter table public.canalizaciones add column if not exists preu_mes_font date;
alter table public.canalizaciones add column if not exists preu_font_dies integer;
alter table public.canalizaciones add column if not exists preu_provisional boolean not null default false;
alter table public.canalizaciones add column if not exists preu_certificat text;
alter table public.canalizaciones add column if not exists preu_certificat_at timestamptz;
alter table public.canalizaciones drop constraint if exists canalizaciones_preu_font_check;
alter table public.canalizaciones add constraint canalizaciones_preu_font_check
  check (preu_font is null or preu_font in ('declarat', 'gencat', 'mercabarna', 'manual', 'fixat', 'historic'));
create index if not exists canalizaciones_preu_mes on public.canalizaciones (preu_mes_albara) where estado <> 'anulada';

comment on column public.canalizaciones.preu_font is
  'De dónde sale coste_kg: declarat (oferta) · gencat · mercabarna · manual (referencia validada) · fixat (el equipo, a mano) · historic (antes de la D2). Null = sin valor todavía (20270601100000).';
comment on column public.canalizaciones.preu_mes_albara is
  'Mes del albarán (día 1): el del REC de su oferta o jornada. Es el precio que aplica el certificado (20270601100000).';
comment on column public.canalizaciones.preu_mes_font is
  'Mes (día 1) del precio de referencia usado; distinto de preu_mes_albara si es provisional (20270601100000).';
comment on column public.canalizaciones.preu_provisional is
  'El mes del albarán no estaba validado: vale el último validado (o nada) hasta validarlo. Bloquea el certificado (20270601100000).';
comment on column public.canalizaciones.preu_certificat is
  'Número del primer certificado de donación emitido que la incluye: desde entonces su valor no cambia (20270601100000).';

-- ---------------------------------------------------------------------------
-- 2. El rastro de cada cambio de valor
-- ---------------------------------------------------------------------------
create table if not exists public.canalizaciones_preu_hist (
  id                   bigint generated always as identity primary key,
  canalizacion_id      uuid not null references public.canalizaciones(id) on delete cascade,
  coste_anterior       numeric,
  coste_nou            numeric,
  font_anterior        text,
  font_nova            text,
  mes_font_anterior    date,
  mes_font_nou         date,
  provisional_anterior boolean,
  provisional_nou      boolean,
  -- mes_validat · mes_revalidat · conciliacio · conciliacio_retroactiva · canvi_directe
  motiu                text not null,
  detall               text,
  canviat_per          uuid references auth.users(id) on delete set null,
  canviat_at           timestamptz not null default now()
);
create index if not exists canalizaciones_preu_hist_idx on public.canalizaciones_preu_hist (canalizacion_id, canviat_at desc);
comment on table public.canalizaciones_preu_hist is
  'Cada cambio del valor por kilo de una canalización (anterior y nuevo, fuente, mes, motivo, quién y cuándo). Solo lo lee el equipo (20270601100000).';

alter table public.canalizaciones_preu_hist enable row level security;
revoke all on public.canalizaciones_preu_hist from anon, authenticated;
grant select on public.canalizaciones_preu_hist to authenticated;
grant all on public.canalizaciones_preu_hist to service_role;
drop policy if exists "canalizaciones_preu_hist: lectura equip" on public.canalizaciones_preu_hist;
create policy "canalizaciones_preu_hist: lectura equip" on public.canalizaciones_preu_hist
  for select to authenticated using ((select public.es_intern()));

-- ---------------------------------------------------------------------------
-- 3. Internas: el mes del albarán y la valoración
-- ---------------------------------------------------------------------------
-- El mes (día 1, hora de Madrid) del REC de la oferta o de su jornada; sin REC todavía (la
-- primera canalización de una oferta: el REC nace en el AFTER INSERT), el de `p_creada`.
create or replace function public.mes_albara_canalitzacio(p_excedente uuid, p_creada timestamptz)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select date_trunc('month', (coalesce(
           (select min(a.created_at)
              from albaranes a
              join excedentes e on e.id = p_excedente
             where a.tipo = 'REC' and a.estado <> 'anulado'
               and (a.excedente_id = e.id
                    or (e.espigolada_id is not null and a.espigolada_id = e.espigolada_id))),
           p_creada, now()) at time zone 'Europe/Madrid'))::date;
$$;
revoke execute on function public.mes_albara_canalitzacio(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.mes_albara_canalitzacio(uuid, timestamptz) to service_role;

-- La valoración de una oferta en un mes de albarán: declarado → referencia (validado del mes;
-- si no, el último anterior, provisional; si no, el manual) → nada (null, provisional).
create or replace function public.valoracio_canalitzacio(p_excedente uuid, p_mes date)
returns table(coste_kg numeric, font text, mes_font date, dies integer, provisional boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_prod  text;
  v_decl  numeric;
  r       record;
begin
  select e.producto, e.coste_kg into v_prod, v_decl from excedentes e where e.id = p_excedente;
  if v_decl is not null then
    return query select v_decl, 'declarat'::text, null::date, null::integer, false;
    return;
  end if;
  select * into r from public.preu_referencia_de(v_prod, coalesce(p_mes, current_date)) limit 1;
  if not found or r.eur_kg is null then
    return query select null::numeric, null::text, null::date, null::integer, true;
    return;
  end if;
  return query
    select r.eur_kg, r.font,
           case when r.exercici is not null then make_date(r.exercici, r.mes, 1) end,
           (select pr.font_dies from preus_referencia pr
             where pr.producto = v_prod and pr.exercici = r.exercici and pr.mes = r.mes),
           r.provisional;
end;
$$;
revoke execute on function public.valoracio_canalitzacio(uuid, date) from public, anon, authenticated;
grant execute on function public.valoracio_canalitzacio(uuid, date) to service_role;

-- La propuesta de la oferta (crear-oferta, con service_role): la referencia de cada producto
-- hoy, con su fuente, su mes y si es provisional.
create or replace function public.preus_vigents_oferta(p_data date default null)
returns table(producto text, eur_kg numeric, font text, mes_font date, provisional boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.nombre, r.eur_kg, r.font,
         case when r.exercici is not null then make_date(r.exercici, r.mes, 1) end,
         r.provisional
    from productos p
    cross join lateral public.preu_referencia_de(
      p.nombre, coalesce(p_data, (now() at time zone 'Europe/Madrid')::date)) r
   where r.eur_kg is not null;
$$;
revoke execute on function public.preus_vigents_oferta(date) from public, anon, authenticated;
grant execute on function public.preus_vigents_oferta(date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Al crear la canalización: valor, fuente, mes del albarán y provisional
-- ---------------------------------------------------------------------------
create or replace function public.trg_canalizaciones_valoriza()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  if new.valorizacion is null and new.excedente_id is not null then
    select e.modalitat into new.valorizacion from excedentes e where e.id = new.excedente_id;
  end if;

  new.preu_mes_albara := public.mes_albara_canalitzacio(new.excedente_id, coalesce(new.created_at, now()));
  new.preu_certificat := null;
  new.preu_certificat_at := null;

  if new.coste_kg is not null then
    -- Quien inserta trae su coste (ninguna RPC lo hace hoy): fijado para esta canalización.
    new.preu_font := 'fixat';
    new.preu_mes_font := null;
    new.preu_font_dies := null;
    new.preu_provisional := false;
  elsif new.excedente_id is not null then
    select * into v from public.valoracio_canalitzacio(new.excedente_id, new.preu_mes_albara);
    new.coste_kg := v.coste_kg;
    new.preu_font := v.font;
    new.preu_mes_font := v.mes_font;
    new.preu_font_dies := v.dies;
    new.preu_provisional := coalesce(v.provisional, true);
  else
    new.preu_font := null;
    new.preu_provisional := true;
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_canalizaciones_valoriza() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. La protección: la valoración solo cambia por sus caminos
-- ---------------------------------------------------------------------------
-- Para una SESIÓN (auth.uid() no null) fuera de `redestina.ajust_preus` y del traspaso de
-- autoría: las columnas `preu_*` no se escriben; el coste de una canalización conciliada o
-- certificada no se cambia (42501); el de una sin conciliar sí (el equipo escribe directo,
-- deuda 132), y entonces queda `fixat`, definitivo. `service_role` (jobs, migraciones) pasa.
create or replace function public.trg_canalizaciones_protegeix_preu()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('redestina.ajust_preus', true), '') = 'on'
     or (tg_op = 'UPDATE' and coalesce(current_setting('redestina.traspas_autoria', true), '') = 'on') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.preu_font is not null or new.preu_mes_font is not null or new.preu_font_dies is not null
       or new.preu_certificat is not null or new.preu_certificat_at is not null then
      raise exception 'preu_canalitzacio_protegit: la valoracio d''una canalitzacio la fixa la base'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.preu_font is distinct from old.preu_font
     or new.preu_mes_albara is distinct from old.preu_mes_albara
     or new.preu_mes_font is distinct from old.preu_mes_font
     or new.preu_font_dies is distinct from old.preu_font_dies
     or new.preu_provisional is distinct from old.preu_provisional
     or new.preu_certificat is distinct from old.preu_certificat
     or new.preu_certificat_at is distinct from old.preu_certificat_at then
    raise exception 'preu_canalitzacio_protegit: la valoracio nomes canvia validant el mes a Productes > Preus'
      using errcode = '42501';
  end if;
  if new.coste_kg is distinct from old.coste_kg then
    if old.preu_certificat is not null then
      raise exception 'canalitzacio_certificada: aquesta canalitzacio ja es al certificat %', old.preu_certificat
        using errcode = '42501';
    end if;
    if old.estado = 'conciliada' then
      raise exception 'preu_canalitzacio_protegit: el valor d''una canalitzacio conciliada nomes canvia validant el mes'
        using errcode = '42501';
    end if;
    new.preu_font := case when new.coste_kg is null then null else 'fixat' end;
    new.preu_mes_font := null;
    new.preu_font_dies := null;
    new.preu_provisional := new.coste_kg is null;
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_canalizaciones_protegeix_preu() from public, anon, authenticated;

drop trigger if exists canalizaciones_protegeix_preu on public.canalizaciones;
create trigger canalizaciones_protegeix_preu
  before insert or update on public.canalizaciones
  for each row execute function public.trg_canalizaciones_protegeix_preu();

-- ---------------------------------------------------------------------------
-- 6. Lo que ya existe: mes del albarán, `historic` y la deuda 128; sello de lo certificado
-- ---------------------------------------------------------------------------
update public.canalizaciones c
   set preu_mes_albara = public.mes_albara_canalitzacio(c.excedente_id, c.created_at)
 where c.preu_mes_albara is null;

-- Sello: las canalizaciones de los certificados de donación ya emitidos (el primero que la
-- incluye). Las líneas del anual se recalculan después de emitir, así que puede sellar alguna
-- que llegó luego: son de antes de la D2 y `historic`, así que tampoco se habrían ajustado.
update public.canalizaciones c
   set preu_certificat = s.numero, preu_certificat_at = s.at
  from (
    select distinct on (x.canalizacion_id) x.canalizacion_id, x.numero, x.at
      from (
        select l.canalizacion_id, cd.certificado_numero as numero, cd.certificado_at as at
          from cierre_donante_lineas l join cierres_donante cd on cd.id = l.cierre_donante_id
         where cd.certificado_numero is not null
        union all
        select l.canalizacion_id, cp.certificado_numero, cp.certificado_at
          from cierre_periodo_lineas l join cierres_periodo cp on cp.id = l.cierre_periodo_id
         where cp.certificado_numero is not null
      ) x
     where x.canalizacion_id is not null
     order by x.canalizacion_id, x.at nulls last
  ) s
 where s.canalizacion_id = c.id and c.preu_certificat is null;

update public.canalizaciones c
   set preu_font = 'historic', preu_provisional = false
 where c.preu_font is null and c.coste_kg is not null;

-- Deuda 128: sin coste, viva y sin certificar → provisional con su mes; la validación de ese
-- mes la valorará.
update public.canalizaciones c
   set preu_provisional = true
 where c.coste_kg is null and c.estado <> 'anulada' and c.preu_certificat is null
   and not c.preu_provisional;

-- ---------------------------------------------------------------------------
-- 7. El rastro, por trigger: cualquier cambio de valor (después del backfill)
-- ---------------------------------------------------------------------------
create or replace function public.trg_canalizaciones_preu_hist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into canalizaciones_preu_hist (canalizacion_id, coste_anterior, coste_nou, font_anterior, font_nova,
                                        mes_font_anterior, mes_font_nou, provisional_anterior, provisional_nou,
                                        motiu, detall, canviat_per)
  values (new.id, old.coste_kg, new.coste_kg, old.preu_font, new.preu_font,
          old.preu_mes_font, new.preu_mes_font, old.preu_provisional, new.preu_provisional,
          coalesce(nullif(current_setting('redestina.motiu_preu', true), ''), 'canvi_directe'),
          nullif(current_setting('redestina.motiu_preu_detall', true), ''),
          auth.uid());
  return new;
end;
$$;
revoke execute on function public.trg_canalizaciones_preu_hist() from public, anon, authenticated;

drop trigger if exists canalizaciones_preu_hist on public.canalizaciones;
create trigger canalizaciones_preu_hist
  after update of coste_kg, preu_font, preu_mes_font, preu_provisional on public.canalizaciones
  for each row
  when (old.coste_kg is distinct from new.coste_kg or old.preu_font is distinct from new.preu_font
        or old.preu_mes_font is distinct from new.preu_mes_font
        or old.preu_provisional is distinct from new.preu_provisional)
  execute function public.trg_canalizaciones_preu_hist();

-- ---------------------------------------------------------------------------
-- 8. Valorar una canalización sin coste (conciliación) y ajustar un producto-mes (validación)
-- ---------------------------------------------------------------------------
create or replace function public.valora_canalitzacio_si_cal(p_canalizacion uuid, p_motiu text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c canalizaciones%rowtype;
  v record;
begin
  select * into c from canalizaciones where id = p_canalizacion;
  if c.id is null or c.coste_kg is not null or c.preu_certificat is not null or c.estado = 'anulada'
     or c.excedente_id is null then
    return;
  end if;
  select * into v from public.valoracio_canalitzacio(
    c.excedente_id, coalesce(c.preu_mes_albara, public.mes_albara_canalitzacio(c.excedente_id, c.created_at)));
  if v.coste_kg is null then
    return;   -- sigue sin valor y provisional: bloquea el certificado hasta validar su mes
  end if;
  perform set_config('redestina.ajust_preus', 'on', true);
  perform set_config('redestina.motiu_preu', p_motiu, true);
  update canalizaciones
     set coste_kg = v.coste_kg, preu_font = v.font, preu_mes_font = v.mes_font,
         preu_font_dies = v.dies, preu_provisional = coalesce(v.provisional, true)
   where id = c.id;
  perform set_config('redestina.motiu_preu', '', true);
  perform set_config('redestina.ajust_preus', 'off', true);
end;
$$;
revoke execute on function public.valora_canalitzacio_si_cal(uuid, text) from public, anon, authenticated;
grant execute on function public.valora_canalitzacio_si_cal(uuid, text) to service_role;

-- Ajusta lo de un producto y mes al precio validado de ese mes. Devuelve las canalizaciones
-- tocadas. Nunca: anuladas, `declarat`, `fixat`, `historic` ni certificadas.
create or replace function public.preus_ajusta_canalitzacions(p_producto text, p_exercici integer, p_mes integer)
returns uuid[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mes date := make_date(p_exercici, p_mes, 1);
  r     preus_referencia%rowtype;
  v_ids uuid[];
begin
  select * into r from preus_referencia
   where producto = p_producto and exercici = p_exercici and mes = p_mes;
  if r.producto is null then
    return '{}'::uuid[];
  end if;

  perform set_config('redestina.ajust_preus', 'on', true);
  perform set_config('redestina.motiu_preu_detall',
                     p_producto || ' ' || to_char(v_mes, 'MM/YYYY') || coalesce(' · ' || r.motiu, ''), true);

  -- Primero las provisionales (motivo «mes validat»); luego las que ya venían de este mes y
  -- cambian porque el equipo ha revalidado el precio («mes revalidat»).
  perform set_config('redestina.motiu_preu', 'mes_validat', true);
  with u as (
    update canalizaciones c
       set coste_kg = r.eur_kg, preu_font = r.font, preu_mes_font = v_mes,
           preu_font_dies = r.font_dies, preu_provisional = false
      from excedentes e
     where e.id = c.excedente_id and e.producto = p_producto
       and c.preu_mes_albara = v_mes and c.estado <> 'anulada'
       and c.preu_certificat is null
       and c.preu_provisional
       and coalesce(c.preu_font, '') not in ('declarat', 'fixat', 'historic')
    returning c.id)
  select coalesce(array_agg(u.id), '{}'::uuid[]) into v_ids from u;

  perform set_config('redestina.motiu_preu', 'mes_revalidat', true);
  with u as (
    update canalizaciones c
       set coste_kg = r.eur_kg, preu_font = r.font, preu_mes_font = v_mes, preu_font_dies = r.font_dies
      from excedentes e
     where e.id = c.excedente_id and e.producto = p_producto
       and c.preu_mes_albara = v_mes and c.estado <> 'anulada'
       and c.preu_certificat is null
       and not c.preu_provisional
       and c.preu_font in ('gencat', 'mercabarna', 'manual')
       and c.preu_mes_font is not distinct from v_mes
       and (c.coste_kg is distinct from r.eur_kg or c.preu_font is distinct from r.font
            or c.preu_font_dies is distinct from r.font_dies)
    returning c.id)
  select v_ids || coalesce(array_agg(u.id), '{}'::uuid[]) into v_ids from u;

  perform set_config('redestina.motiu_preu', '', true);
  perform set_config('redestina.motiu_preu_detall', '', true);
  perform set_config('redestina.ajust_preus', 'off', true);
  return v_ids;
end;
$$;
revoke execute on function public.preus_ajusta_canalitzacions(text, integer, integer) from public, anon, authenticated;
grant execute on function public.preus_ajusta_canalitzacions(text, integer, integer) to service_role;

-- Recalcula los certificados en BORRADOR (sin número) que contienen esas canalizaciones: el
-- anual de un cierre abierto o provisional y los de periodo u oferta. Lo que falle se queda
-- como estaba (el botón «Recalcula» sigue ahí); nunca tumba la validación del mes.
create or replace function public.preus_recalcula_certificats(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  x   record;
  n   integer := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  for x in
    select distinct cd.cierre_id
      from cierre_donante_lineas l
      join cierres_donante cd on cd.id = l.cierre_donante_id
      join cierres_ejercicio ce on ce.id = cd.cierre_id
     where l.canalizacion_id = any(p_ids) and ce.estado in ('obert', 'provisional')
  loop
    begin
      perform public.calcular_cierre(x.cierre_id);
      n := n + 1;
    exception when others then
      raise notice 'preus: no s''ha pogut recalcular el tancament %: %', x.cierre_id, sqlerrm;
    end;
  end loop;
  for x in
    select distinct cp.productor_id, cp.periodo_desde, cp.periodo_hasta, cp.modo, cp.excedente_id, cp.abast
      from cierre_periodo_lineas l
      join cierres_periodo cp on cp.id = l.cierre_periodo_id
     where l.canalizacion_id = any(p_ids) and cp.certificado_numero is null
  loop
    begin
      perform public.calcular_certificado_periodo(
        x.productor_id,
        case when x.abast = 'oferta' then null else x.periodo_desde end,
        case when x.abast = 'oferta' then null else x.periodo_hasta end,
        x.modo, x.excedente_id);
      n := n + 1;
    exception when others then
      raise notice 'preus: no s''ha pogut recalcular el certificat de periode: %', sqlerrm;
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function public.preus_recalcula_certificats(uuid[]) from public, anon, authenticated;
grant execute on function public.preus_recalcula_certificats(uuid[]) to service_role;

-- El trigger de SENTENCIA sobre `preus_referencia`: una vez por sentencia, con las filas
-- nuevas o cambiadas (tablas de transición), ajusta y recalcula.
create or replace function public.trg_preus_referencia_aplica()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  x     record;
  v_ids uuid[] := '{}'::uuid[];
begin
  if tg_op = 'INSERT' then
    for x in select distinct n.producto, n.exercici, n.mes from preus_nous n loop
      v_ids := v_ids || public.preus_ajusta_canalitzacions(x.producto, x.exercici, x.mes);
    end loop;
  else
    for x in
      select distinct n.producto, n.exercici, n.mes
        from preus_nous n
        join preus_vells o on o.producto = n.producto and o.exercici = n.exercici and o.mes = n.mes
       where o.eur_kg is distinct from n.eur_kg or o.font is distinct from n.font
          or o.font_dies is distinct from n.font_dies
    loop
      v_ids := v_ids || public.preus_ajusta_canalitzacions(x.producto, x.exercici, x.mes);
    end loop;
  end if;
  perform public.preus_recalcula_certificats(v_ids);
  return null;
end;
$$;
revoke execute on function public.trg_preus_referencia_aplica() from public, anon, authenticated;

drop trigger if exists preus_referencia_aplica_ins on public.preus_referencia;
create trigger preus_referencia_aplica_ins
  after insert on public.preus_referencia
  referencing new table as preus_nous
  for each statement execute function public.trg_preus_referencia_aplica();
drop trigger if exists preus_referencia_aplica_upd on public.preus_referencia;
create trigger preus_referencia_aplica_upd
  after update on public.preus_referencia
  referencing old table as preus_vells new table as preus_nous
  for each statement execute function public.trg_preus_referencia_aplica();

-- ---------------------------------------------------------------------------
-- 9. Certificados: el bloqueo `preus_provisionals` y la guarda de la emisión
-- ---------------------------------------------------------------------------
-- Las canalizaciones provisionales de un certificado, por producto y mes del albarán.
create or replace function public.preus_provisionals_certificat(p_taula text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('producto', x.producto, 'mes', to_char(x.mes, 'YYYY-MM'),
                                               'n', x.n, 'sense_preu', x.sense)
                            order by x.mes, x.producto), '[]'::jsonb)
    from (
      select coalesce(e.producto, l.producto, '(sense producte)') as producto, c.preu_mes_albara as mes,
             count(distinct c.id)::int as n,
             count(distinct c.id) filter (where c.coste_kg is null)::int as sense
        from (select dl.canalizacion_id, dl.producto from cierre_donante_lineas dl
               where p_taula = 'cierres_donante' and dl.cierre_donante_id = p_id
              union all
              select pl.canalizacion_id, pl.producto from cierre_periodo_lineas pl
               where p_taula = 'cierres_periodo' and pl.cierre_periodo_id = p_id) l
        join canalizaciones c on c.id = l.canalizacion_id
        left join excedentes e on e.id = c.excedente_id
       where c.preu_provisional
       group by 1, 2) x;
$$;
revoke execute on function public.preus_provisionals_certificat(text, uuid) from public, anon, authenticated;
grant execute on function public.preus_provisionals_certificat(text, uuid) to service_role;

-- «Tomàquet (11/2026), Pebrot (10/2026)»
create or replace function public.preus_provisionals_text(p_items jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select string_agg(i->>'producto' || ' (' || substr(i->>'mes', 6, 2) || '/' || substr(i->>'mes', 1, 4) || ')', ', ')
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i;
$$;
revoke execute on function public.preus_provisionals_text(jsonb) from public, anon, authenticated;
grant execute on function public.preus_provisionals_text(jsonb) to service_role;

create or replace function public.trg_cierre_preus()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_items  jsonb;
  v_base   jsonb;
  v_sense  integer;
  v_num    text;
begin
  -- Dos `if` y no un `and`: `new.tipo` solo existe en `cierres_donante`.
  if tg_table_name = 'cierres_donante' then
    if new.tipo <> 'donacio' then
      return new;
    end if;
  end if;

  -- (a) Recalculado: el bloqueo `preus_provisionals` (y fuera `sense_cost` si lo explica).
  if tg_op = 'UPDATE' and new.calculado_at is distinct from old.calculado_at then
    v_items := public.preus_provisionals_certificat(tg_table_name, new.id);
    v_base := (select coalesce(jsonb_agg(b), '[]'::jsonb)
                 from jsonb_array_elements(case when jsonb_typeof(new.bloqueos) = 'array'
                                                then new.bloqueos else '[]'::jsonb end) b
                where b->>'codigo' is distinct from 'preus_provisionals');
    if jsonb_array_length(v_items) > 0 then
      -- Si todas las líneas sin coste son de canalizaciones provisionales, `sense_cost` dice lo
      -- mismo que este bloqueo, peor: fuera.
      if tg_table_name = 'cierres_donante' then
        select count(*) into v_sense from cierre_donante_lineas l
          left join canalizaciones c on c.id = l.canalizacion_id
         where l.cierre_donante_id = new.id and l.coste_kg is null and not coalesce(c.preu_provisional, false);
      else
        select count(*) into v_sense from cierre_periodo_lineas l
          left join canalizaciones c on c.id = l.canalizacion_id
         where l.cierre_periodo_id = new.id and l.coste_kg is null and not coalesce(c.preu_provisional, false);
      end if;
      if v_sense = 0 then
        v_base := (select coalesce(jsonb_agg(b), '[]'::jsonb) from jsonb_array_elements(v_base) b
                    where b->>'codigo' is distinct from 'sense_cost');
      end if;
      v_base := v_base || jsonb_build_array(jsonb_build_object(
        'codigo', 'preus_provisionals', 'bloqueja', true,
        'detall', 'Preus de referencia provisionals: ' || public.preus_provisionals_text(v_items)
                  || '. Cal validar el mes de l''albara a Productes > Preus.',
        'mesos', v_items));
    end if;
    new.bloqueos := v_base;
  end if;

  -- (b) Emisión o rectificación: nada provisional y las líneas al día; luego, el sello.
  if tg_op = 'UPDATE' and new.certificado_numero is not null
     and (old.certificado_numero is null or new.rectificaciones is distinct from old.rectificaciones) then
    v_items := public.preus_provisionals_certificat(tg_table_name, new.id);
    if jsonb_array_length(v_items) > 0 then
      raise exception 'preus_provisionals: % (cal validar el mes de l''albara a Productes > Preus)',
        public.preus_provisionals_text(v_items)
        using errcode = '22023', detail = v_items::text;
    end if;
    if tg_table_name = 'cierres_donante' then
      select string_agg(distinct coalesce(l.producto, '?'), ', ') into v_num
        from cierre_donante_lineas l join canalizaciones c on c.id = l.canalizacion_id
       where l.cierre_donante_id = new.id and l.coste_kg is distinct from c.coste_kg;
    else
      select string_agg(distinct coalesce(l.producto, '?'), ', ') into v_num
        from cierre_periodo_lineas l join canalizaciones c on c.id = l.canalizacion_id
       where l.cierre_periodo_id = new.id and l.coste_kg is distinct from c.coste_kg;
    end if;
    if v_num is not null then
      raise exception 'preus_canviats: el valor per quilo de % ha canviat despres de calcular; torna a calcular el certificat', v_num
        using errcode = '22023';
    end if;
    perform set_config('redestina.ajust_preus', 'on', true);
    update canalizaciones c
       set preu_certificat = new.certificado_numero, preu_certificat_at = now()
     where c.preu_certificat is null
       and c.id in (select l.canalizacion_id from cierre_donante_lineas l
                     where tg_table_name = 'cierres_donante' and l.cierre_donante_id = new.id
                    union
                    select l.canalizacion_id from cierre_periodo_lineas l
                     where tg_table_name = 'cierres_periodo' and l.cierre_periodo_id = new.id);
    perform set_config('redestina.ajust_preus', 'off', true);
  end if;

  -- (c) Un ensayo que se reinicia (`reiniciar_cierre_prueba`): fuera el sello que puso.
  if tg_op = 'UPDATE' and old.certificado_numero is not null and new.certificado_numero is null then
    perform set_config('redestina.ajust_preus', 'on', true);
    update canalizaciones set preu_certificat = null, preu_certificat_at = null
     where preu_certificat = old.certificado_numero;
    perform set_config('redestina.ajust_preus', 'off', true);
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_cierre_preus() from public, anon, authenticated;

-- Antes que `*_revisio` (orden alfabético): la revisión mira los bloqueos ya completos.
drop trigger if exists cierres_donante_preus on public.cierres_donante;
create trigger cierres_donante_preus
  before update on public.cierres_donante
  for each row execute function public.trg_cierre_preus();
drop trigger if exists cierres_periodo_preus on public.cierres_periodo;
create trigger cierres_periodo_preus
  before update on public.cierres_periodo
  for each row execute function public.trg_cierre_preus();

-- Las fuentes de un certificado para su snapshot: la lista sin repetir y el detalle por
-- producto, fuente y mes (el anexo).
create or replace function public.fonts_valor_certificat(p_taula text, p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with l as (
    select dl.canalizacion_id, dl.producto, dl.kg_neto, dl.valor, dl.coste_kg from cierre_donante_lineas dl
     where p_taula = 'cierres_donante' and dl.cierre_donante_id = p_id
    union all
    select pl.canalizacion_id, pl.producto, pl.kg_neto, pl.valor, pl.coste_kg from cierre_periodo_lineas pl
     where p_taula = 'cierres_periodo' and pl.cierre_periodo_id = p_id
  ),
  f as (
    select l.producto, c.preu_font as font, c.preu_mes_font as mes_font, c.preu_mes_albara as mes_albara,
           c.preu_font_dies as dies, l.kg_neto, l.valor, l.coste_kg
      from l join canalizaciones c on c.id = l.canalizacion_id
  )
  select jsonb_build_object(
    'fonts_valor', (select coalesce(jsonb_agg(distinct jsonb_build_object(
                                      'font', f.font, 'mes_font', f.mes_font, 'dies', f.dies)), '[]'::jsonb)
                      from f where f.font is not null),
    'detall_fonts', (select coalesce(jsonb_agg(jsonb_build_object(
                                       'producte', d.producto, 'font', d.font, 'mes_font', d.mes_font,
                                       'mes_albara', d.mes_albara, 'dies', d.dies, 'eur_kg', d.eur_kg,
                                       'kg', d.kg, 'valor', d.valor)
                                     order by d.producto, d.mes_albara, d.font), '[]'::jsonb)
                       from (select f.producto, f.font, f.mes_font, f.mes_albara, max(f.dies) as dies,
                                    max(f.coste_kg) as eur_kg, sum(f.kg_neto) as kg, sum(f.valor) as valor
                               from f group by f.producto, f.font, f.mes_font, f.mes_albara) d));
$$;
revoke execute on function public.fonts_valor_certificat(text, uuid) from public, anon, authenticated;
grant execute on function public.fonts_valor_certificat(text, uuid) to service_role;

-- El valor de una línea del REC: el de las canalizaciones de su oferta (o de su jornada y
-- producto), con su fuente. Sin canalización todavía, la valoración que tendría.
create or replace function public.valor_linia_rec(p_albaran uuid, p_producto text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  a  albaranes%rowtype;
  c  record;
  v  record;
  v_mes date;
begin
  select * into a from albaranes where id = p_albaran;
  select x.coste_kg, x.preu_font, x.preu_mes_font, x.preu_mes_albara, x.preu_font_dies, x.preu_provisional
    into c
    from canalizaciones x
    join excedentes e on e.id = x.excedente_id
   where x.estado <> 'anulada' and coalesce(x.valorizacion, 'donacio') = 'donacio'
     and ((a.excedente_id is not null and x.excedente_id = a.excedente_id)
          or (a.excedente_id is null and a.espigolada_id is not null
              and e.espigolada_id = a.espigolada_id and e.producto is not distinct from p_producto))
   order by x.created_at
   limit 1;
  if found then
    return jsonb_build_object('valor_kg', c.coste_kg, 'font', c.preu_font, 'mes_font', c.preu_mes_font,
                              'mes_albara', c.preu_mes_albara, 'dies', c.preu_font_dies,
                              'provisional', c.preu_provisional);
  end if;
  v_mes := date_trunc('month', coalesce(a.created_at, now()) at time zone 'Europe/Madrid')::date;
  if a.excedente_id is not null then
    select * into v from public.valoracio_canalitzacio(a.excedente_id, v_mes);
    return jsonb_build_object('valor_kg', v.coste_kg, 'font', v.font, 'mes_font', v.mes_font,
                              'mes_albara', v_mes, 'dies', v.dies, 'provisional', v.provisional);
  end if;
  select r.eur_kg as coste_kg, r.font,
         case when r.exercici is not null then make_date(r.exercici, r.mes, 1) end as mes_font,
         r.provisional
    into v from public.preu_referencia_de(p_producto, v_mes) r limit 1;
  return jsonb_build_object('valor_kg', v.coste_kg, 'font', v.font, 'mes_font', v.mes_font,
                            'mes_albara', v_mes, 'dies', null,
                            'provisional', coalesce(v.provisional, true));
end;
$$;
revoke execute on function public.valor_linia_rec(uuid, text) from public, anon, authenticated;
grant execute on function public.valor_linia_rec(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Lectura del equipo: lo que espera un mes (pantalla Productes › Preus)
-- ---------------------------------------------------------------------------
create or replace function public.preus_canalitzacions_mes(p_exercici integer, p_mes integer)
returns table(producto text, provisionals integer, sense_preu integer, kg numeric, canalitzacions jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta les canalitzacions per valorar' using errcode = '42501';
  end if;
  if p_mes is null or p_mes not between 1 and 12 or p_exercici is null or p_exercici not between 2000 and 2100 then
    raise exception 'mes_invalid' using errcode = '22023';
  end if;
  return query
    select coalesce(e.producto, '(sense producte)'),
           count(*)::int,
           count(*) filter (where c.coste_kg is null)::int,
           coalesce(sum(coalesce(c.kg_conciliados, c.kg_reales, c.kg_confirmados)), 0),
           jsonb_agg(jsonb_build_object('id', c.id, 'excedente_id', c.excedente_id, 'id_excedente', e.id_excedente,
                                        'kg', coalesce(c.kg_conciliados, c.kg_reales, c.kg_confirmados),
                                        'coste_kg', c.coste_kg, 'font', c.preu_font, 'mes_font', c.preu_mes_font,
                                        'estado', c.estado)
                     order by c.created_at)
      from canalizaciones c
      left join excedentes e on e.id = c.excedente_id
     where c.preu_mes_albara = make_date(p_exercici, p_mes, 1)
       and c.preu_provisional and c.estado <> 'anulada' and c.preu_certificat is null
     group by 1
     order by 1;
end;
$$;
revoke execute on function public.preus_canalitzacions_mes(integer, integer) from public, anon;
grant execute on function public.preus_canalitzacions_mes(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Cuerpos vigentes letra por letra, con los cambios de la D2 (misma firma: los GRANT se
--     conservan): conciliar_albaran, conciliacion_retroactiva, albaran_datos y los dos
--     snapshots del certificado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conciliar_albaran(p_id uuid, p_kg_validados jsonb DEFAULT NULL::jsonb, p_motivo text DEFAULT NULL::text, p_destino_final text DEFAULT NULL::text)
 RETURNS albaranes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a        albaranes%rowtype;
  par      parametros_documentales%rowtype;
  k        jsonb;
  v_total  numeric;
  v_prop   jsonb;
  v_inc    boolean;
  b        record;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot conciliar un albara' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado not in ('entregado', 'confirmado') then
    raise exception 'Nomes es concilia un albara entregat o confirmat' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  if a.confirmado_at is null then
    if a.entregado_at is null
       or a.entregado_at + make_interval(days => coalesce(par.plazo_conciliar_sin_confirmacion_dias, 7)) > now() then
      raise exception 'Encara no ha vencut el termini de confirmacio: cal esperar o rebre la confirmacio'
        using errcode = '22023';
    end if;
    if coalesce(btrim(p_motivo), '') = '' then
      raise exception 'Conciliar sense confirmacio necessita motiu' using errcode = '22023';
    end if;
  end if;

  -- NUEVA (20270427100000). Una diferencia de kilos declarada por la entidad receptora no se
  -- concilia sin motivo. Va después del plazo de confirmación: si aún no se puede conciliar,
  -- ese es el error que hay que dar, no pedir un motivo que luego no serviría.
  if a.tipo = 'REC' then
    v_inc := public.rec_te_incidencia_recollida(a.id);
  else
    v_inc := a.canalizacion_id is not null and exists (
      select 1 from canalizaciones c
       where c.id = a.canalizacion_id and c.incidencia_recollida is not null);
  end if;
  if coalesce(v_inc, false) and coalesce(btrim(p_motivo), '') = '' then
    raise exception 'cal_motiu_incidencia: l''entitat receptora ha declarat una diferencia de quilos en aquesta recollida; cal un motiu per conciliar'
      using errcode = '22023';
  end if;

  -- Un REC fuera de tolerancia se concilia, pero con motivo: arrastra sus salidas.
  if a.tipo = 'REC' then
    v_prop := public.propuesta_conciliacion(a.id);
    if not coalesce((v_prop->>'dins_tolerancia')::boolean, true)
       and coalesce(btrim(p_motivo), '') = '' then
      raise exception 'fora_de_tolerancia: la diferencia (% %%) supera la tolerancia (% %%); cal un motiu per conciliar',
        v_prop->>'diferencia_pct', v_prop->>'tolerancia_pct' using errcode = '22023';
    end if;
  end if;

  if p_kg_validados is null then
    update albaran_lineas
       set kg_validados = coalesce(kg_confirmados, kg_neto, kg_previstos)
     where albaran_id = a.id;
  else
    for k in select * from jsonb_array_elements(p_kg_validados) loop
      update albaran_lineas
         set kg_validados = (k->>'kg')::numeric
       where id = (k->>'linea_id')::uuid and albaran_id = a.id;
    end loop;
  end if;

  select coalesce(sum(kg_validados), 0) into v_total
    from albaran_lineas where albaran_id = a.id;

  update albaranes
     set estado              = 'conciliado',
         conciliado_at       = now(),
         conciliado_por      = auth.uid(),
         motivo_conciliacion = p_motivo,
         destino_final       = coalesce(p_destino_final, a.destino_final)
   where id = a.id
  returning * into a;

  -- La canalización: kilos conciliados. El coste ya no se busca aquí (punto 3, fase D2,
  -- 20270601100000): lo fijó la canalización al nacer con el precio del mes de su albarán. Si
  -- seguía en null se valora una vez más con esa misma regla (declarado → referencia del mes);
  -- si tampoco hay, se queda null y provisional, y bloquea el certificado hasta validar el mes.
  if a.canalizacion_id is not null then
    perform public.valora_canalitzacio_si_cal(a.canalizacion_id, 'conciliacio');

    update canalizaciones
       set kg_conciliados      = v_total,
           kg_reales           = coalesce(kg_reales, v_total),
           estado              = 'conciliada',
           conciliada_at       = now(),
           conciliada_por      = auth.uid(),
           motivo_conciliacion = p_motivo
     where id = a.canalizacion_id;
  end if;

  -- La versión definitiva del PDF, que sustituye a la emitida.
  perform public.albaran_emet_document(a.id, 'conciliat', null);

  -- La cascada: las salidas confirmadas de este REC. Solo desde un REC, así que la llamada
  -- de dentro (un ENT/OPE) no vuelve a entrar aquí. El motivo nunca llega vacío a las
  -- salidas, así que la guarda de incidencia no las frena.
  if a.tipo = 'REC' then
    for b in
      select s.id from albaranes s
       where s.id in (select public.albarans_germans_rec(a.id))
         and s.estado = 'confirmado'
       order by s.created_at
    loop
      perform public.conciliar_albaran(
        b.id, null,
        coalesce(nullif(btrim(p_motivo), ''),
                 'Conciliat amb l''albara de recepcio ' || coalesce(a.numero_completo, a.id::text)),
        null);
    end loop;
  end if;

  return a;
end;
$function$;

CREATE OR REPLACE FUNCTION public.conciliacion_retroactiva(p_canalizacion uuid, p_kg numeric, p_coste numeric DEFAULT NULL::numeric, p_motivo text DEFAULT NULL::text)
 RETURNS canalizaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c       canalizaciones%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar fa una conciliacio retroactiva' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Una conciliacio retroactiva necessita motiu' using errcode = '22023';
  end if;
  if p_kg is null or p_kg <= 0 then
    raise exception 'Els quilos han de ser positius' using errcode = '22023';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'Aquesta canalitzacio no existeix' using errcode = '22023';
  end if;
  if c.estado = 'conciliada' then
    raise exception 'Aquesta canalitzacio ja esta conciliada' using errcode = '22023';
  end if;
  if exists (select 1 from albaranes a
              where a.canalizacion_id = c.id and a.estado not in ('borrador', 'anulado')) then
    raise exception 'Aquesta canalitzacio te albara emes: concilia''l amb conciliar_albaran()'
      using errcode = '22023';
  end if;

  -- D2 (20270601100000): sin coste explícito, la valoración del mes del albarán (declarado →
  -- referencia validada; si no, sigue null y provisional). Con `p_coste`, queda `fixat`.
  if p_coste is null and c.coste_kg is null then
    perform public.valora_canalitzacio_si_cal(c.id, 'conciliacio_retroactiva');
  end if;
  perform set_config('redestina.motiu_preu', 'conciliacio_retroactiva', true);

  update canalizaciones
     set kg_conciliados           = p_kg,
         kg_reales                = coalesce(kg_reales, p_kg),
         coste_kg                 = coalesce(p_coste, coste_kg),
         estado                   = 'conciliada',
         conciliada_at            = now(),
         conciliada_por           = auth.uid(),
         motivo_conciliacion      = p_motivo,
         conciliacion_retroactiva = true
   where id = p_canalizacion
  returning * into c;
  perform set_config('redestina.motiu_preu', '', true);
  return c;
end;
$function$;

CREATE OR REPLACE FUNCTION public.albaran_datos(p_albaran uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a      albaranes%rowtype;
  ex     excedentes%rowtype;
  par    parametros_documentales%rowtype;
  v_mod  text;
  v_tipo text;
begin
  select * into a from albaranes where id = p_albaran;
  select * into ex from excedentes where id = a.excedente_id;
  select * into par from parametros_documentales where id = 1;
  v_tipo := replace(a.tipo, 'R-', '');

  -- La modalidad de ESTE documento: la de la canalización en ENT/OPE (`valorizacion`); en el
  -- REC, la donación es lo único que crea un REC (el trigger de canalizaciones), y una
  -- espigolada también es donación.
  v_mod := case
             when v_tipo = 'REC' then 'donacio'
             else coalesce((select c.valorizacion from canalizaciones c where c.id = a.canalizacion_id),
                           ex.modalitat)
           end;

  return jsonb_build_object(
    'format',       'albara-1p',
    'tipus',        a.tipo,
    'numero',       a.numero_completo,
    'ejercici',     a.ejercicio,
    'idioma',       a.idioma,
    'emes_at',      to_char(coalesce(a.emitido_at, now()) at time zone 'Europe/Madrid',
                            'YYYY-MM-DD"T"HH24:MI:SS'),
    'data_elaboracio', to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD'),
    'modalitat',    v_mod,
    -- Hasta hoy el REC imprimía siempre «Donació», también en una espigolada: el snapshot
    -- no llevaba este dato aunque el renderizador lo leía.
    'tipus_entrada', case when v_tipo = 'REC'
                          then case when a.espigolada_id is not null or ex.origen = 'espigolament'
                                    then 'espigolament' else 'donacio' end
                     end,
    -- Quien firma el pie: la Fundació, de sus parámetros (con sus marcas de provisional).
    'fundacio',     jsonb_build_object('razon_social', par.razon_social, 'nif', par.cif,
                                       'domicilio', par.domicilio),
    'partes',       a.partes,
    'recollida',    a.recogida,
    'retorn_envasos', a.retorn_envasos,
    'observacions', a.observaciones,
    'incidencies',  a.incidencias,
    'rebuig',       jsonb_build_object('tipus', a.rechazo, 'motiu', a.motivo_rechazo),
    'referencies',  jsonb_build_object(
                      'registre',   ex.id_excedente,
                      'espigolada', (select coalesce(es.ref_externa, es.id::text)
                                       from espigoladas es where es.id = a.espigolada_id),
                      'rectifica',  (select r.numero_completo from albaranes r where r.id = a.rectifica_a),
                      'externs',    (select jsonb_agg(jsonb_build_object('tipus', x.tipo,
                                                                          'numero', x.numero,
                                                                          'data', x.fecha))
                                       from documentos_externos x
                                      where x.objeto_tipo = 'albaran' and x.objeto_id = a.id)),
    'linies',       (select jsonb_agg(jsonb_build_object(
                              'ordre',          l.orden,
                              'producte',       l.producto,
                              'varietat',       l.variedad,
                              'familia',        l.familia,
                              'causa',          l.causa,
                              'caixes',         l.num_cajas,
                              'tipus_caixa',    l.tipo_caja,
                              'kg_brut',        l.kg_bruto,
                              'tara_kg',        l.tara_kg,
                              'kg_net',         l.kg_neto,
                              'kg_previstos',   l.kg_previstos,
                              'kg_confirmats',  l.kg_confirmados,
                              'kg_validats',    l.kg_validados,
                              'lot_origen',     l.lote_origen,
                              -- SOLO en el REC de donación (ver la cabecera). Desde la D2
                              -- (20270601100000) el valor de las canalizaciones de la oferta
                              -- —el precio del mes del albarán, o el último publicado y
                              -- provisional— y de dónde sale (`valor_font`, que se imprime).
                              -- Null = «—» en el papel, nunca un 0 inventado.
                              'valor_kg',       case when v_tipo = 'REC' and v_mod = 'donacio'
                                                     then (public.valor_linia_rec(a.id, l.producto)->>'valor_kg')::numeric
                                                end,
                              'valor_font',     case when v_tipo = 'REC' and v_mod = 'donacio'
                                                     then public.valor_linia_rec(a.id, l.producto) - 'valor_kg'
                                                end)
                            order by l.orden)
                       from albaran_lineas l where l.albaran_id = a.id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.cierre_datos_certificado(p_cd uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cd  cierres_donante%rowtype;
  ce  cierres_ejercicio%rowtype;
  par parametros_documentales%rowtype;
begin
  select * into cd from cierres_donante where id = p_cd;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  return jsonb_build_object(
    'tipus', 'CD',
    'abast', 'exercici',
    'mode', ce.modo,
    'exercici', ce.ejercicio,
    'numero', cd.certificado_numero,
    -- D14: la fecha de generación sigue siendo la de generación.
    'data_generacio', now(),
    -- La fecha que imprime el «expedeixo … a <lloc>, <data>». Las filas anteriores a
    -- 20270509100200 no la tienen: se usa el día en que se certificaron.
    'data_expedicio', coalesce(cd.data_expedicio,
                               (cd.certificado_at at time zone 'Europe/Madrid')::date),
    'annex', coalesce(cd.annex, false),
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    -- Nombre y cargo sí; el DNI NO (§4): lo lee `generar-documento` al pintar.
    'apoderada', jsonb_build_object('nom', par.apoderada_nombre, 'carrec', par.apoderada_cargo),
    'donant', cd.datos_fiscales,
    'periode', jsonb_build_object('des_de', make_date(ce.ejercicio, 1, 1),
                                  'fins_a', make_date(ce.ejercicio, 12, 31)),
    'kg', cd.kg_total,
    'import', cd.valor_total,
    -- Solo se cita la factura que cuadra a dos decimales (20260921211329).
    'factura', case
                 when cd.factura_importe is not null
                  and round(cd.factura_importe, 2) = round(cd.valor_total, 2)
                 then jsonb_build_object('numero', cd.factura_numero,
                                         'data', cd.factura_fecha,
                                         'import', cd.factura_importe)
                 else jsonb_build_object('numero', null, 'data', null, 'import', null)
               end,
    'excepcio_sense_factura', cd.excepcion_sin_factura,
    'excepcio_motiu', cd.excepcion_motivo,
    'rectificacions', cd.rectificaciones,
    'detall', (
      select coalesce(jsonb_agg(x order by x->>'producte'), '[]'::jsonb)
        from (
          select jsonb_build_object('producte', l.producto, 'kg', sum(l.kg_neto),
                                    'valor', sum(l.valor)) as x
            from cierre_donante_lineas l
           where l.cierre_donante_id = cd.id
           group by l.producto
        ) d)
  )
  -- D2 (20270601100000): de dónde sale cada valor (nota y anexo del certificado).
  || public.fonts_valor_certificat('cierres_donante', cd.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.periodo_datos_certificado(p_periodo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cp  cierres_periodo%rowtype;
  par parametros_documentales%rowtype;
begin
  select * into cp from cierres_periodo where id = p_periodo;
  if cp.id is null then
    raise exception 'Aquest certificat de periode no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  return jsonb_build_object(
    'tipus', 'CD',
    -- 'periode' | 'oferta': lo que distingue a este certificado del anual.
    'abast', cp.abast,
    'excedente_id', cp.excedente_id,
    'mode', cp.modo,
    'exercici', cp.ejercicio,
    'numero', cp.certificado_numero,
    'data_generacio', now(),
    'data_expedicio', coalesce(cp.data_expedicio,
                               (cp.certificado_at at time zone 'Europe/Madrid')::date),
    'annex', coalesce(cp.annex, false),
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'apoderada', jsonb_build_object('nom', par.apoderada_nombre, 'carrec', par.apoderada_cargo),
    'donant', cp.datos_fiscales,
    'periode', jsonb_build_object('des_de', cp.periodo_desde, 'fins_a', cp.periodo_hasta),
    'kg', cp.kg_total,
    'import', cp.valor_total,
    'factura', case
                 when cp.factura_importe is not null
                  and round(cp.factura_importe, 2) = round(cp.valor_total, 2)
                 then jsonb_build_object('numero', cp.factura_numero,
                                         'data', cp.factura_fecha,
                                         'import', cp.factura_importe)
                 else jsonb_build_object('numero', null, 'data', null, 'import', null)
               end,
    'excepcio_sense_factura', cp.excepcion_sin_factura,
    'excepcio_motiu', cp.excepcion_motivo,
    'rectificacions', cp.rectificaciones,
    'detall', (
      select coalesce(jsonb_agg(x order by x->>'producte'), '[]'::jsonb)
        from (
          select jsonb_build_object('producte', l.producto, 'kg', sum(l.kg_neto),
                                    'valor', sum(l.valor)) as x
            from cierre_periodo_lineas l
           where l.cierre_periodo_id = cp.id
           group by l.producto
        ) d)
  )
  -- D2 (20270601100000): de dónde sale cada valor (nota y anexo del certificado).
  || public.fonts_valor_certificat('cierres_periodo', cp.id);
end;
$function$;
