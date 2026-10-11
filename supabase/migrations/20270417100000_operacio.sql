-- Fase 2 de la revisión del cliente del 08-10-2026: LA FICHA DE LA OPERACIÓN.
--
-- QUÉ PIDE LA FUNDACIÓ. Cuando Redestina encuentra salida, ni el productor sabe quién, cuánto,
-- cuándo ni dónde, ni el receptor tiene la dirección concreta, la persona de contacto o el
-- teléfono del punto de recogida: solo municipio y comarca. «Cuando el receptor vea una oferta
-- como Assignada, debe tener toda la información necesaria para saber qué recibe, cuánto
-- recibe, de quién, dónde y cuándo lo recoge.» Y esa información debe salir de la ubicación
-- registrada por el ofertante, sin teclearla otra vez.
--
-- D1 (decidida el 05-10-2026): una vez APROBADA la canalización, las dos partes se ven. Antes
-- de aprobar rige D3 (comarca, sin nombres). Esta ficha solo existe para canalizaciones, o sea
-- después de aprobar, y por eso puede dar la dirección y el teléfono.

-- --- 1. El lugar de recogida, completo ------------------------------------------------------

alter table public.productor_ubicaciones
  add column if not exists direccion          text check (direccion is null or char_length(direccion) <= 300),
  add column if not exists observaciones      text check (observaciones is null or char_length(observaciones) <= 600),
  add column if not exists contacto_nombre    text check (contacto_nombre is null or char_length(contacto_nombre) <= 120),
  add column if not exists contacto_telefono  text check (contacto_telefono is null or char_length(contacto_telefono) <= 40),
  add column if not exists horario            text check (horario is null or char_length(horario) <= 200);

comment on column public.productor_ubicaciones.observaciones is
  'Lo relevante para recoger (accesos, carga y descarga, mínimos…). Revisión del 08-10-2026, §5.2.';

-- `productor_ubicaciones` tiene GRANT de tabla para `authenticated` y su RLS deja escribir al
-- productor en las suyas (20260730095000): las columnas nuevas nacen escribibles por él.

-- --- 2. La ficha de una operación ---------------------------------------------------------

-- Una fila por canalización, para quien es PARTE de ella (el productor de la oferta, la
-- entidad que recibe) o para el equipo. A cualquier otra cuenta, cero filas: devuelve `setof`
-- y no lanza, como `contraparts_canalitzacions()`.
--
-- ⚠️ `security definer` porque la entidad no puede leer `productores` ni
--    `productor_ubicaciones` por RLS: es exactamente lo que esta ficha le abre, y solo para las
--    canalizaciones suyas no anuladas.
create or replace function public.operacio_detall(p_canalizacion uuid)
returns table (
  canalizacion_id     uuid,
  excedente_id        uuid,
  resposta_id         uuid,
  rol                 text,
  producte            text,
  varietat            text,
  modalitat           text,
  kg_sollicitats      numeric,
  kg_assignats        numeric,
  kg_rebuts           numeric,
  data_hora_recollida timestamptz,
  estat_recollida     text,
  productor_nom       text,
  productor_contacte  text,
  productor_telefon   text,
  entitat_nom         text,
  entitat_contacte    text,
  entitat_telefon     text,
  lloc_alias          text,
  lloc_adreca         text,
  lloc_municipi       text,
  lloc_maps           text,
  lloc_contacte       text,
  lloc_telefon        text,
  lloc_horari         text,
  lloc_observacions   text,
  condicions          text,
  albara_numero       text,
  albara_estat        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select c.*, e.productor_id, e.producto, e.variedad, e.observacions, e.ubicacion_id,
           e.horari_recollida,
           case
             when auth.uid() is null or public.es_intern() then 'equip'
             when e.productor_id in (select public.mis_productores()) then 'productor'
             when c.entidad_id in (select public.mis_entidades()) then 'entidad'
           end as qui
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
     where c.id = p_canalizacion
  ),
  alb as (
    select a.numero_completo, a.estado
      from albaranes a, c
     where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
       and a.estado not in ('anulado', 'rectificado')
     order by a.created_at desc
     limit 1
  )
  select c.id, c.excedente_id, r.id, c.qui,
         c.producto, c.variedad, c.valorizacion,
         r.kg_solicitados,
         -- Lo VIGENTE: si el equipo cambia los kilos después de aprobar, manda la canalización.
         c.kg_confirmados,
         coalesce(c.kg_conciliados, c.kg_reales),
         c.data_hora_recollida,
         case
           when c.estado = 'conciliada' or alb.estado = 'conciliado' then 'conciliada'
           when alb.estado = 'confirmado' then 'confirmada'
           when alb.estado = 'entregado' then 'entregada'
           when alb.estado = 'emitido' or c.data_hora_recollida is not null then 'programada'
           else 'pendent'
         end,
         coalesce(nullif(p.empresa, ''), p.name), p.name, p.phone,
         en.nombre, en.contacto, en.telefono,
         u.alias, u.direccion, coalesce(u.municipio, p.poblacion), u.gmaps_url,
         coalesce(u.contacto_nombre, p.name), coalesce(u.contacto_telefono, p.phone),
         coalesce(u.horario, c.horari_recollida), u.observaciones,
         c.observacions,
         alb.numero_completo, alb.estado
    from c
    left join alb on true
    left join productores p on p.id = c.productor_id
    left join entidades en on en.id = c.entidad_id
    left join productor_ubicaciones u on u.id = c.ubicacion_id
    left join oferta_respuestas r on r.canalizacion_id = c.id
   where c.qui is not null
     -- La entidad no ve una canalización anulada: ya no hay nada que recoger.
     and (c.qui <> 'entidad' or c.estado <> 'anulada');
$$;

revoke execute on function public.operacio_detall(uuid) from public, anon;
grant execute on function public.operacio_detall(uuid) to authenticated, service_role;

-- --- 3. Las contrapartes, con la recogida -----------------------------------------------

-- Cambia el `returns table`, así que hay que borrarla y recrearla: `create or replace` no
-- puede, y el `revoke`/`grant` se repiten (la trampa de `resolver_enlace`, §4bis).
drop function if exists public.contraparts_canalitzacions();

create function public.contraparts_canalitzacions()
returns table (
  canalizacion_id uuid, excedente_id uuid, resposta_id uuid, rol text, contrapart text,
  municipi text, gmaps_url text, kg numeric, modalitat text,
  data_hora_recollida timestamptz, kg_aprovats numeric, estat_recollida text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select c.id, c.excedente_id, c.entidad_id, c.kg_confirmados, c.valorizacion,
           c.data_hora_recollida, c.estado, c.kg_conciliados,
           (select a.estado from albaranes a
             where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
               and a.estado not in ('anulado', 'rectificado')
             order by a.created_at desc limit 1) as alb_estat
      from canalizaciones c
     where c.estado <> 'anulada'
  ),
  estat as (
    select b.*,
           case
             when b.estado = 'conciliada' or b.alb_estat = 'conciliado' then 'conciliada'
             when b.alb_estat = 'confirmado' then 'confirmada'
             when b.alb_estat = 'entregado' then 'entregada'
             when b.alb_estat = 'emitido' or b.data_hora_recollida is not null then 'programada'
             else 'pendent'
           end as estat_recollida
      from base b
  )
  select b.id, b.excedente_id, r.id, 'productor'::text,
         en.nombre, en.poblacion, null::text, b.kg_confirmados, b.valorizacion,
         b.data_hora_recollida, r.kg_aprovats, b.estat_recollida
    from estat b
    join excedentes e on e.id = b.excedente_id
    left join entidades en on en.id = b.entidad_id
    left join oferta_respuestas r on r.canalizacion_id = b.id
   where auth.uid() is not null
     and e.productor_id in (select public.mis_productores())
  union all
  select b.id, b.excedente_id, r.id, 'entidad'::text,
         coalesce(nullif(p.empresa, ''), p.name),
         coalesce(u.municipio, p.poblacion), u.gmaps_url, b.kg_confirmados, b.valorizacion,
         b.data_hora_recollida, r.kg_aprovats, b.estat_recollida
    from estat b
    join excedentes e on e.id = b.excedente_id
    left join productores p on p.id = e.productor_id
    left join productor_ubicaciones u on u.id = e.ubicacion_id
    left join oferta_respuestas r on r.canalizacion_id = b.id
   where auth.uid() is not null
     and b.entidad_id in (select public.mis_entidades());
$$;

revoke execute on function public.contraparts_canalitzacions() from public, anon;
grant execute on function public.contraparts_canalitzacions() to authenticated, service_role;
