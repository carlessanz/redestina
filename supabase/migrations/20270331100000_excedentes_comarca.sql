-- Dónde está una oferta, legible por quien la puede pedir: municipio y COMARCA en la propia
-- oferta (revisión funcional del 23-09-2026: «el área geográfica es muy importante para un
-- receptor y debería aparecer ya en la tarjeta»).
--
-- POR QUÉ EN LA OFERTA Y NO CON UN JOIN. El receptor no puede leer `productores` ni
-- `productor_ubicaciones` (RLS: son del productor y del equipo), así que el mercado no tenía
-- ninguna forma de saber de dónde es una oferta. Copiarlo aquí da ese dato sin abrir las
-- fichas, que tienen nombre, NIF, teléfono y dirección.
--
-- ⚠️ D3: la pantalla enseña la COMARCA, no el municipio. Un municipio con un solo generador
--    lo identifica (el mismo límite que ya tiene el albarán ENT, §4); la comarca, mucho
--    menos. `municipi_ine` se guarda igualmente porque es lo que permitirá calcular una
--    distancia aproximada, y porque el `ENT` ya imprime municipio y comarca de origen.
--
-- DE DÓNDE SALE, por orden de fiabilidad:
--   1. `productor_ubicaciones.municipio_ine` de la ubicación de recogida, si lo tiene.
--   2. El código postal de la ficha del productor, por `codis_postals`: si apunta a UN
--      municipio, ese; si apunta a varios, no se elige ninguno (sería inventar), pero si
--      todos son de la misma comarca, la comarca sí se sabe.
--   3. Si nada de eso, null — la tarjeta no enseña nada, que es mejor que adivinar.
--
-- ⚠️ POR TRIGGER, no en `crearExcedente()`: `excedentes` se inserta desde la Edge Function
--    (panel y WhatsApp), desde `crear_espigolada()` y desde fixtures; una sola regla en la
--    base cubre todos los caminos, igual que `canalizaciones_crea_albaranes`.

alter table excedentes
  add column if not exists municipi_ine text references municipios (codi_ine),
  add column if not exists comarca text;

comment on column excedentes.municipi_ine is
  'Municipio de recogida (INE), derivado de la ubicación o del CP del productor. Lo rellena el trigger excedentes_ubica.';
comment on column excedentes.comarca is
  'Comarca de recogida, la que ve el receptor en el Mercat (D3: no el municipio).';

create or replace function public.ubicar_excedente(p_ubicacion uuid, p_productor uuid)
returns table (municipi_ine text, comarca text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ine text;
  v_cp text;
  v_n int;
  v_comarques int;
  v_comarca text;
begin
  -- 1. La ubicación de recogida, si ya está casada con el nomenclátor.
  if p_ubicacion is not null then
    select u.municipio_ine into v_ine from productor_ubicaciones u where u.id = p_ubicacion;
    if v_ine is not null then
      return query select m.codi_ine, m.comarca from municipios m where m.codi_ine = v_ine;
      return;
    end if;
  end if;

  -- 2. El código postal de la ficha.
  select nullif(trim(p.codigo_postal), '') into v_cp from productores p where p.id = p_productor;
  if v_cp is null then
    return query select null::text, null::text;
    return;
  end if;

  select count(*), count(distinct m.comarca), min(m.comarca), min(m.codi_ine)
    into v_n, v_comarques, v_comarca, v_ine
  from codis_postals c join municipios m on m.codi_ine = c.codi_ine
  where c.codi_postal = v_cp;

  if v_n = 1 then
    return query select v_ine, v_comarca;
  elsif v_n > 1 and v_comarques = 1 then
    -- Varios municipios, una sola comarca: el municipio no se elige, la comarca sí se sabe.
    return query select null::text, v_comarca;
  else
    return query select null::text, null::text;
  end if;
end;
$$;

-- La usa solo el trigger (que corre con los privilegios del dueño de la función). Nadie la
-- llama por PostgREST: devolvería la comarca de cualquier productor por su id.
revoke execute on function public.ubicar_excedente(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ubicar_excedente(uuid, uuid) to service_role;

create or replace function public.trg_excedentes_ubica()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  -- Solo si no viene dado, y en un UPDATE solo si cambia lo que lo decide: el equipo puede
  -- corregir la comarca a mano sin que el trigger se la vuelva a pisar.
  if tg_op = 'UPDATE'
     and new.ubicacion_id is not distinct from old.ubicacion_id
     and new.productor_id is not distinct from old.productor_id then
    return new;
  end if;
  if tg_op = 'INSERT' and new.comarca is not null then
    return new;
  end if;

  select * into r from ubicar_excedente(new.ubicacion_id, new.productor_id);
  new.municipi_ine := r.municipi_ine;
  new.comarca := r.comarca;
  return new;
end;
$$;

drop trigger if exists excedentes_ubica on excedentes;
create trigger excedentes_ubica
  before insert or update of ubicacion_id, productor_id on excedentes
  for each row execute function public.trg_excedentes_ubica();

-- El relleno de lo que ya existe. Idempotente: solo toca las que no tienen comarca.
update excedentes e
   set municipi_ine = u.municipi_ine, comarca = u.comarca
  from (select x.id, (ubicar_excedente(x.ubicacion_id, x.productor_id)).* from excedentes x
         where x.comarca is null) u
 where u.id = e.id;
