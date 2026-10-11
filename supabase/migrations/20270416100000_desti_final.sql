-- Fase 1 de la revisión del cliente del 08-10-2026: EL DESTINO FINAL DE LOS KILOS.
--
-- QUÉ PIDE LA FUNDACIÓ. Una oferta no puede acabar «Cancel·lada» sin más: cuando llega la
-- fecha que dijo el productor, Redestina tiene que saber qué ha pasado con el producto, y
-- puede haber varios destinos con sus kilos (100 donats, 80 venuts, 70 compostats), también
-- cuando la salida NO la ha gestionado Redestina (una venta externa). «Así mantenemos
-- trazabilidad del 100 % del producto introducido en REDESTINA».
--
-- QUÉ HABÍA. Ningún destino a nivel de oferta: solo `albaranes.destino_final`, texto libre al
-- conciliar. Y `excedentes.estado = 'cerrada'` existía en el CHECK sin que nadie lo
-- escribiera (deuda §12.106).
--
-- EL DISEÑO, SIN ESTADOS NUEVOS:
--   · `cerrada`     → todos los kilos tienen destino (Redestina + externos). Ahora sí la
--                     escribe alguien: esta RPC y el trigger de conciliación de abajo.
--   · `no_colocada` → vencida con kilos sin destino registrado. En la interfaz, «Sense
--                     sortida», y el productor tiene que decir qué pasó.
--   · `cancelada`   → retirada por error o incidencia. Nada más.
--   `parcial`/`bloqueada` son estados de REPARTO: el job de vencidas no los toca (eso va en
--   `20270416100100`).
--
-- «KILOS CON DESTINO REDESTINA» = la suma de `kg_confirmados` de las canalizaciones no
-- anuladas: lo ASIGNADO, que es la misma cuenta con la que se decide `parcial`/`bloqueada`.
-- No los conciliados: una merma de 5 kg al recoger se explica en la conciliación (con su
-- motivo, §4), y pedirle al productor el destino de esos 5 kg cada vez sería convertir el
-- cierre de cualquier oferta en un formulario.

-- --- 1. El catálogo --------------------------------------------------------------------

create table if not exists public.destins_finals (
  codi    text primary key,
  ordre   int  not null,
  actiu   boolean not null default true,
  nom_ca  text not null,
  nom_es  text not null
);

comment on table public.destins_finals is
  'Catálogo de destinos finales de los kilos de una oferta (revisión del 08-10-2026). '
  '`venda` y `donacio` son EXTERNOS: lo que Redestina gestiona va por canalizaciones.';

insert into public.destins_finals (codi, ordre, nom_ca, nom_es) values
  ('venda',                   1, 'Venda externa',                                 'Venta externa'),
  ('donacio',                 2, 'Donació externa',                                'Donación externa'),
  ('transformacio',           3, 'Transformació (consum humà)',                    'Transformación (consumo humano)'),
  ('alimentacio_animal',      4, 'Alimentació animal',                             'Alimentación animal'),
  ('subproducte',             5, 'Subproducte per a la indústria',                 'Subproducto para la industria'),
  ('compostatge',             6, 'Compostatge / digestió',                         'Compostaje / digestión'),
  ('valoritzacio_energetica', 7, 'Valorització energètica',                        'Valorización energética'),
  ('eliminacio',              8, 'Eliminació',                                     'Eliminación'),
  ('altres',                  9, 'Una altra sortida',                              'Otra salida')
on conflict (codi) do update
  set ordre = excluded.ordre, nom_ca = excluded.nom_ca, nom_es = excluded.nom_es;

alter table public.destins_finals enable row level security;
drop policy if exists "destins_finals: lectura" on public.destins_finals;
create policy "destins_finals: lectura" on public.destins_finals
  for select to authenticated using (true);
grant select on public.destins_finals to authenticated, service_role;

-- --- 2. Los destinos registrados de una oferta ---------------------------------------

create table if not exists public.excedente_destins (
  id             uuid primary key default gen_random_uuid(),
  excedente_id   uuid not null references public.excedentes(id) on delete cascade,
  desti_codi     text not null references public.destins_finals(codi),
  kg             numeric not null check (kg > 0),
  receptor       text check (receptor is null or char_length(receptor) <= 200),
  data           date,
  notes          text check (notes is null or char_length(notes) <= 400),
  registrat_per  uuid,
  origen         text not null check (origen in ('productor', 'equip')),
  created_at     timestamptz not null default now()
);

create index if not exists excedente_destins_excedente_idx on public.excedente_destins (excedente_id);

comment on table public.excedente_destins is
  'Lo que pasó con los kilos de una oferta que NO salieron por una canalización de Redestina '
  '(venta externa, compostaje…). Sin GRANT de escritura: entra por `registrar_desti_final()`.';

alter table public.excedente_destins enable row level security;
drop policy if exists "excedente_destins: lectura" on public.excedente_destins;
create policy "excedente_destins: lectura" on public.excedente_destins
  for select to authenticated
  using (
    (select public.es_intern())
    or excedente_id in (
      select e.id from public.excedentes e
       where e.productor_id in (select public.mis_productores())
    )
  );
grant select on public.excedente_destins to authenticated, service_role;
grant insert, update, delete on public.excedente_destins to service_role;

-- --- 3. Columnas nuevas en la oferta -----------------------------------------------------

alter table public.excedentes
  add column if not exists tancada_at        timestamptz,
  add column if not exists desti_reclamat_at timestamptz;

comment on column public.excedentes.tancada_at is
  'Cuándo pasó a `cerrada` (todos los kilos con destino). Fase 1 de la revisión del 08-10-2026.';
comment on column public.excedentes.desti_reclamat_at is
  'Cuándo el job de vencidas pidió al productor el destino de los kilos que quedaban. '
  'Es lo que evita repetir el aviso cada día.';

-- --- 4. Cuánto tiene destino ------------------------------------------------------------

-- `security invoker` a propósito: agrega solo lo que quien pregunta ya puede leer
-- (`excedentes`, `canalizaciones` y `excedente_destins` con su propia RLS), así que no
-- necesita guarda. Las RPC `definer` de abajo la llaman y ven todo, que es lo que quieren.
create or replace function public.desti_excedent(p_excedente uuid)
returns table (kg_total numeric, kg_redestina numeric, kg_externs numeric, kg_sense_desti numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with e as (
    select coalesce(ex.kg_total, 0)::numeric as total from excedentes ex where ex.id = p_excedente
  ),
  r as (
    select coalesce(sum(c.kg_confirmados), 0)::numeric as kg
      from canalizaciones c
     where c.excedente_id = p_excedente and c.estado <> 'anulada'
  ),
  x as (
    select coalesce(sum(d.kg), 0)::numeric as kg
      from excedente_destins d where d.excedente_id = p_excedente
  )
  select e.total, r.kg, x.kg, greatest(0, e.total - r.kg - x.kg)
    from e, r, x;
$$;

revoke execute on function public.desti_excedent(uuid) from public, anon;
grant execute on function public.desti_excedent(uuid) to authenticated, service_role;

-- --- 5. Registrar los destinos ------------------------------------------------------------

-- Reemplaza TODOS los destinos externos de la oferta por la lista que llega: la pantalla
-- enseña la lista entera y la guarda entera (productor o equipo, la misma lista).
--
-- ⚠️ EL ORDEN DE LAS GUARDAS, como en `fixar_fotos_oferta`: para una cuenta EXTERNA el
--    permiso va antes que la existencia (un uuid inventado corta con `42501`, y así el arnés
--    puede probar el «denegar» sin conocer ninguna oferta ajena); para el EQUIPO, un uuid
--    inventado da `22023 oferta_inexistent`, que es lo que prueba que su guarda deja pasar.
create or replace function public.registrar_desti_final(p_excedente uuid, p_destins jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ex       excedentes;
  v_intern boolean := (auth.uid() is null) or public.es_intern();
  v_item   jsonb;
  v_codi   text;
  v_kg     numeric;
  v_data   date;
  d        record;
  v_obertes int;
  v_estat  text;
begin
  select * into ex from excedentes where id = p_excedente for update;
  -- `coalesce(... , false)`: con `productor_id` nulo (o sin fila), un `in` daría NULL.
  if not v_intern and not coalesce(ex.productor_id in (select public.mis_productores()), false) then
    raise exception 'Aquesta oferta no és teva' using errcode = '42501';
  end if;
  if ex.id is null then
    raise exception 'oferta_inexistent' using errcode = '22023';
  end if;
  if ex.estado not in ('publicada', 'parcial', 'bloqueada', 'no_colocada') then
    raise exception 'estat_no_admet_desti' using errcode = '22023';
  end if;
  if p_destins is null or jsonb_typeof(p_destins) <> 'array' then
    raise exception 'destins_invalids' using errcode = '22023';
  end if;

  delete from excedente_destins where excedente_id = p_excedente;

  for v_item in select * from jsonb_array_elements(p_destins) loop
    v_codi := v_item->>'desti';
    v_kg   := nullif(v_item->>'kg', '')::numeric;
    v_data := nullif(v_item->>'data', '')::date;
    if not exists (select 1 from destins_finals f where f.codi = v_codi and f.actiu) then
      raise exception 'desti_desconegut' using errcode = '22023';
    end if;
    if v_kg is null or v_kg <= 0 then
      raise exception 'kg_invalids' using errcode = '22023';
    end if;
    if v_data is not null and v_data > (now() at time zone 'Europe/Madrid')::date then
      raise exception 'data_futura' using errcode = '22023';
    end if;
    insert into excedente_destins (excedente_id, desti_codi, kg, receptor, data, notes, registrat_per, origen)
    values (p_excedente, v_codi, v_kg,
            nullif(btrim(left(v_item->>'receptor', 200)), ''),
            v_data,
            nullif(btrim(left(v_item->>'notes', 400)), ''),
            auth.uid(),
            case when v_intern then 'equip' else 'productor' end);
  end loop;

  select * into d from public.desti_excedent(p_excedente);
  if d.kg_redestina + d.kg_externs > d.kg_total then
    raise exception 'massa_kg' using errcode = '22023';
  end if;

  -- ¿Queda alguna canalización en curso? Mientras haya una, la oferta no se cierra: falta la
  -- recogida (y la cierra el trigger de conciliación de abajo).
  select count(*) into v_obertes from canalizaciones c
   where c.excedente_id = p_excedente and c.estado in ('confirmada', 'entregada');

  v_estat := ex.estado;
  if d.kg_sense_desti = 0 then
    if v_obertes = 0 then
      v_estat := 'cerrada';
    elsif ex.estado in ('publicada', 'parcial') then
      v_estat := 'bloqueada';
    end if;
  end if;

  if v_estat <> ex.estado then
    update excedentes
       set estado = v_estat,
           tancada_at = case when v_estat = 'cerrada' then now() else tancada_at end
     where id = p_excedente;
  end if;

  return jsonb_build_object(
    'estado', v_estat, 'kg_total', d.kg_total, 'kg_redestina', d.kg_redestina,
    'kg_externs', d.kg_externs, 'kg_sense_desti', d.kg_sense_desti);
end;
$$;

revoke execute on function public.registrar_desti_final(uuid, jsonb) from public, anon;
grant execute on function public.registrar_desti_final(uuid, jsonb) to authenticated, service_role;

-- --- 6. Cerrar al conciliar la última canalización ---------------------------------------

-- Sobre `canalizaciones` y NUNCA sobre `albaranes`: el circuito legal no escribe en la
-- oferta (§12.106 explicaba por qué nadie escribía `cerrada`: tocar una RPC documental por
-- una cifra decorativa). `conciliar_albaran()` ya escribe `canalizaciones.estado`, así que
-- este trigger se entera sin que esa RPC cambie.
create or replace function public.trg_excedentes_tanca_si_complet()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex        excedentes;
  d         record;
  v_obertes int;
begin
  if new.estado is distinct from 'conciliada' or old.estado = 'conciliada' then
    return new;
  end if;
  select * into ex from excedentes where id = new.excedente_id for update;
  if ex.id is null or ex.estado not in ('parcial', 'bloqueada', 'no_colocada') then
    return new;
  end if;
  select * into d from public.desti_excedent(ex.id);
  select count(*) into v_obertes from canalizaciones c
   where c.excedente_id = ex.id and c.id <> new.id and c.estado in ('confirmada', 'entregada');
  if d.kg_sense_desti = 0 and v_obertes = 0 then
    update excedentes set estado = 'cerrada', tancada_at = now() where id = ex.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.trg_excedentes_tanca_si_complet() from public, anon, authenticated;

drop trigger if exists canalizaciones_tanca_excedent on public.canalizaciones;
create trigger canalizaciones_tanca_excedent
  after update of estado on public.canalizaciones
  for each row execute function public.trg_excedentes_tanca_si_complet();

-- --- 7. Cancelar: solo por error o incidencia ----------------------------------------------

-- Antes se podía cancelar una `parcial`, que deja canalizaciones vivas colgando de una oferta
-- cancelada sin tocarlas (AGENTS §12, decisión anotada el 28-09-2026). Ahora, con kilos ya
-- asignados, lo que toca es registrar el destino del resto, no cancelar. Y el motivo es
-- obligatorio: «Cancel·lada» ya no es un final normal sino una incidencia.
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
  if nullif(btrim(coalesce(p_motiu, '')), '') is null then
    raise exception 'cal_motiu' using errcode = '22023';
  end if;
  if ex.estado not in ('borrador', 'pendent_validacio', 'publicada') then
    raise exception 'Aquesta oferta ja no es pot cancel·lar' using errcode = '22023';
  end if;
  if exists (select 1 from canalizaciones c where c.excedente_id = p_excedente and c.estado <> 'anulada') then
    raise exception 'te_canalitzacions' using errcode = '22023';
  end if;
  update excedentes
     set estado = 'cancelada',
         motivo_no_colocada = btrim(p_motiu)
   where id = p_excedente
  returning * into ex;
  return ex;
end;
$$;

-- --- 8. El aviso nuevo ----------------------------------------------------------------------

-- ⚠️ PUBLICAR `enviar-avis` ANTES que esta migración: la función marca `tipus_desconegut`
--    DEFINITIVAMENTE cualquier tipo que su `TIPUS_AVIS` no conozca.
alter table public.avisos drop constraint if exists avisos_tipus_check;
alter table public.avisos add constraint avisos_tipus_check check (tipus in (
  'oferta_validada', 'oferta_rebutjada', 'sortida_trobada', 'interes_aprovat',
  'interes_rebutjat', 'oferta_sense_desti'));

-- --- 9. Poner al día lo que ya cumple la regla ---------------------------------------------

-- Las ofertas con todo canalizado y conciliado ya están, de hecho, cerradas: la interfaz las
-- pintaba «tancada» por el REC conciliado, pero su estado se quedó en `parcial`/`bloqueada`
-- porque nadie escribía `cerrada`. Es lo que el trigger de arriba habría hecho; idempotente.
-- (En el clon del 11-10-2026: dos, E-260914-MAS-TOM-1 y E-TEST-CT-2026.)
update public.excedentes e
   set estado = 'cerrada',
       tancada_at = coalesce(
         (select max(c.conciliada_at) from public.canalizaciones c where c.excedente_id = e.id),
         now())
 where e.estado in ('parcial', 'bloqueada')
   and exists (select 1 from public.canalizaciones c
                where c.excedente_id = e.id and c.estado = 'conciliada')
   and not exists (select 1 from public.canalizaciones c
                    where c.excedente_id = e.id and c.estado in ('confirmada', 'entregada'))
   and (select dx.kg_sense_desti from public.desti_excedent(e.id) dx) = 0;
