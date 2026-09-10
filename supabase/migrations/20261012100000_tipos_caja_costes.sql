-- `tipos_caja` y `costes_producto`: los dos catálogos de los que dependen los kilos
-- oficiales y el valor fiscal de una donación.
--
-- POR QUÉ AQUÍ Y NO EN LA FASE 1. Los dos son catálogos, pero ninguno de los dos es
-- decorativo:
--
--   · `tipos_caja.tara_kg` es lo que convierte un peso de báscula en el **kilo neto** que
--     se certifica. Hoy `excedentes.tipo_caixa` es texto libre de una lista escrita a
--     mano en `_shared/camposOferta.ts`, sin tara ni FK: con eso no se puede calcular un
--     neto, y sin neto no hay albarán que valga.
--   · `costes_producto.coste_kg` es el **único** origen del valor de una donación
--     (decisión D del plan). `productos.eur_kg` NO sirve: vale 1 €/kg plano para los 90
--     productos, así que un cierre calculado con él daría una cifra plausible y falsa —y
--     el bloqueo por «falta el coste» no saltaría nunca—.
--
-- ⚠️ LOS DOS NACEN PROVISIONALES, Y SE NOTA. La fase 0 todavía no ha entregado ni la
--    lista de tipos de caja con su tara ni los costes por kilo de 2026. Mismo criterio
--    que `parametros_documentales` (20260928100400): en vez de sembrar valores inventados
--    que se parezcan a los buenos, se siembra lo que se puede deducir del uso real
--    **marcado como provisional y desactivado** (`activo = false`, `provisional = true`),
--    de forma que:
--      · el desplegable de un albarán no ofrece ninguna caja hasta que alguien confirme
--        su tara —una tara equivocada falsea el neto de todas las entregas de ese tipo—;
--      · y la lista ya existe, con sus códigos estables, así que cuando llegue el dato
--        real es un `update` de dos columnas y no una migración de datos.
--    `costes_producto` va más lejos: nace **vacío**. Sembrarlo con 1 €/kg sería
--    exactamente el error que la decisión D quiere evitar.

-- ---------------------------------------------------------------------------
-- 1. tipos_caja
-- ---------------------------------------------------------------------------
create table if not exists tipos_caja (
  codigo      text primary key,
  nombre      text    not null,
  -- Kilos que pesa la caja vacía. Se resta del bruto por caja para obtener el neto.
  tara_kg     numeric not null default 0 check (tara_kg >= 0),
  retornable  boolean not null default true,
  -- `false` = no se ofrece al crear un albarán. Es el estado de fábrica mientras la tara
  -- no esté confirmada.
  activo      boolean not null default true,
  -- `true` = el valor de `tara_kg`/`retornable` es una deducción de la consultoría, no un
  -- dato de la Fundación. Sale como aviso en la pantalla de configuración.
  provisional boolean not null default false,
  orden       int     not null default 100,
  created_at  timestamptz not null default now()
);

comment on table tipos_caja is
  'Catálogo de envases con su tara. De aquí sale el kilo neto de albaran_lineas (bruto - cajas x tara).';
comment on column tipos_caja.tara_kg is
  'Peso de la caja vacía. Provisionalmente 0 en todas: la Fundación aún no ha entregado la lista real.';
comment on column tipos_caja.activo is
  'false mientras la tara no esté confirmada: una tara equivocada falsea el neto de todas sus entregas.';

-- ---------------------------------------------------------------------------
-- 2. Seed deducido del uso real
-- ---------------------------------------------------------------------------
-- Los seis valores son los de `TIPOS_CAIXA` en `supabase/functions/_shared/camposOferta.ts`,
-- que es la lista que el intake ofrece por WhatsApp y el panel del productor en el alta:
-- o sea, exactamente lo que puede haber hoy en `excedentes.tipo_caixa`.
--
-- `retornable` sí se deduce sin riesgo (lo dice el propio nombre); `tara_kg` no se deduce
-- de nada, y por eso va a 0 con la fila desactivada.
insert into tipos_caja (codigo, nombre, tara_kg, retornable, activo, provisional, orden) values
  ('RIGIDA_FE',   'Rígida FE',    0, true,  false, true, 10),
  ('PLEGABLE_FE', 'Plegable FE',  0, true,  false, true, 20),
  ('PALOT',       'Palot',        0, true,  false, true, 30),
  ('RETORNABLE',  'Retornable',   0, true,  false, true, 40),
  ('PRODUCTORA',  'Productor/a',  0, false, false, true, 50),
  ('NO_RETORN',   'No retorn',    0, false, false, true, 60)
on conflict (codigo) do nothing;   -- reaplicar NUNCA pisa una tara ya confirmada

-- Y lo que haya en producción y no esté en esa lista: `tipo_caixa` es texto libre, así
-- que una ficha vieja o un import pueden traer un valor que el código no conoce. Se da de
-- alta igual —provisional y desactivado— para que ningún albarán se quede sin poder
-- referenciar su tipo de caja. En local esto no encuentra nada; en remoto sí puede.
insert into tipos_caja (codigo, nombre, tara_kg, retornable, activo, provisional, orden)
select distinct
       upper(replace(replace(
         translate(regexp_replace(btrim(e.tipo_caixa), '[^a-zA-Z0-9À-ÿ /]', '', 'g'),
                   'àáâãäèéêëìíîïòóôõöùúûüçÀÁÂÃÄÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇ',
                   'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
         '/', ''), ' ', '_')),
       btrim(e.tipo_caixa),
       0, true, false, true, 900
  from excedentes e
 where e.tipo_caixa is not null
   and btrim(e.tipo_caixa) <> ''
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- 3. costes_producto (+ su histórico)
-- ---------------------------------------------------------------------------
-- Una fila por producto y ejercicio. La clave es `(producto, ejercicio)` porque el coste
-- de referencia cambia cada año y un certificado emitido en 2027 sobre kilos de 2026
-- tiene que valorarlos con el coste de **2026**.
create table if not exists costes_producto (
  producto    text not null references productos(nombre) on update cascade,
  ejercicio   int  not null,
  coste_kg    numeric not null check (coste_kg > 0),
  motivo      text not null,
  fijado_por  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (producto, ejercicio)
);

comment on table costes_producto is
  'Coste por kilo de referencia por producto y ejercicio. Único origen del valor fiscal de una donación (D).';
comment on column costes_producto.motivo is
  'De dónde sale la cifra (lonja, estudio, acuerdo). Obligatorio: un valor fiscal sin procedencia no es defendible.';

-- El histórico no es un lujo: si alguien corrige el coste de un producto a mitad de año,
-- las canalizaciones ya conciliadas conservan el suyo congelado y las nuevas usan el
-- nuevo. Sin esta tabla, la diferencia entre dos certificados del mismo producto no se
-- podría explicar.
create table if not exists costes_producto_hist (
  id          uuid primary key default gen_random_uuid(),
  producto    text not null,
  ejercicio   int  not null,
  coste_kg    numeric not null,
  motivo      text,
  fijado_por  uuid references auth.users(id) on delete set null,
  vigente_desde timestamptz not null,
  vigente_hasta timestamptz not null default now()
);

create index if not exists costes_producto_hist_idx
  on costes_producto_hist (producto, ejercicio, vigente_hasta desc);

comment on table costes_producto_hist is
  'Valores anteriores de costes_producto. Lo escribe el trigger al sobrescribir una fila; no se borra.';

-- El trigger de copia. `before update` para poder leer el valor viejo y exigir que el
-- nuevo venga con motivo: un coste sin procedencia es exactamente lo que no se puede
-- defender delante de una asesoría.
create or replace function trg_costes_producto_hist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.motivo is null or btrim(new.motivo) = '' then
    raise exception 'Cal indicar d''on surt el cost per quilo (motiu)' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and (old.coste_kg is distinct from new.coste_kg) then
    insert into costes_producto_hist (producto, ejercicio, coste_kg, motivo, fijado_por,
                                      vigente_desde, vigente_hasta)
    values (old.producto, old.ejercicio, old.coste_kg, old.motivo, old.fijado_por,
            old.updated_at, now());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists costes_producto_hist on costes_producto;
create trigger costes_producto_hist
  before insert or update on costes_producto
  for each row execute function trg_costes_producto_hist();

-- ---------------------------------------------------------------------------
-- 4. Las RPC de escritura
-- ---------------------------------------------------------------------------
-- Ni `tipos_caja` ni `costes_producto` tienen GRANT de escritura: se tocan por aquí. Es
-- el mismo criterio de §4bis —«escrituras por RPC con lista blanca, nunca por política de
-- update»— y aquí hay un motivo extra: las dos cifras que se escriben (`tara_kg`,
-- `coste_kg`) cambian lo que dirán todos los documentos futuros.

-- Fijar el coste de un producto para un ejercicio. `pot_aprovar()`, como aprobar una
-- canalización: es una decisión económica, no una edición de catálogo.
create or replace function public.fijar_coste_producto(
  p_producto  text,
  p_ejercicio int,
  p_coste     numeric,
  p_motivo    text
) returns costes_producto
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  f costes_producto%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden fixar el cost per quilo'
      using errcode = '42501';
  end if;
  if p_coste is null or p_coste <= 0 then
    raise exception 'El cost per quilo ha de ser mes gran que zero' using errcode = '22023';
  end if;
  if not exists (select 1 from productos where nombre = p_producto) then
    raise exception 'El producte % no es al cataleg', p_producto using errcode = '23503';
  end if;

  insert into costes_producto (producto, ejercicio, coste_kg, motivo, fijado_por)
  values (p_producto, p_ejercicio, p_coste, p_motivo, auth.uid())
  on conflict (producto, ejercicio) do update
     set coste_kg   = excluded.coste_kg,
         motivo     = excluded.motivo,
         fijado_por = excluded.fijado_por
  returning * into f;
  return f;
end;
$$;

-- Confirmar la tara de un tipo de caja (y activarlo). Es la RPC que cierra la deuda de
-- la fase 0: cuando la Fundación entregue la lista, esto es lo que se ejecuta una vez por
-- tipo, y la fila deja de ser provisional.
create or replace function public.fijar_tipo_caja(
  p_codigo     text,
  p_nombre     text default null,
  p_tara       numeric default null,
  p_retornable boolean default null,
  p_activo     boolean default null
) returns tipos_caja
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  t tipos_caja%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden fixar la tara d''un tipus de caixa'
      using errcode = '42501';
  end if;
  if p_tara is not null and p_tara < 0 then
    raise exception 'La tara no pot ser negativa' using errcode = '22023';
  end if;

  insert into tipos_caja (codigo, nombre, tara_kg, retornable, activo, provisional)
  values (p_codigo,
          coalesce(p_nombre, p_codigo),
          coalesce(p_tara, 0),
          coalesce(p_retornable, true),
          coalesce(p_activo, false),
          p_tara is null)
  on conflict (codigo) do update
     set nombre      = coalesce(p_nombre, tipos_caja.nombre),
         tara_kg     = coalesce(p_tara, tipos_caja.tara_kg),
         retornable  = coalesce(p_retornable, tipos_caja.retornable),
         activo      = coalesce(p_activo, tipos_caja.activo),
         -- Deja de ser provisional en cuanto alguien confirma una tara a mano.
         provisional = case when p_tara is not null then false else tipos_caja.provisional end
  returning * into t;
  return t;
end;
$$;

-- Borrar un coste. Existe por dos motivos: un coste fijado en el ejercicio equivocado no
-- tiene hoy ninguna vuelta atrás (solo se puede sobrescribir, y sobrescribir el año malo
-- no lo arregla), y el arnés de RLS necesita poder deshacer la comprobación con la que
-- verifica que el super_admin SÍ puede fijar costes. `es_super_admin()`, no `pot_aprovar()`:
-- borrar una referencia económica es más grave que fijarla, porque no deja histórico
-- —`costes_producto_hist` solo guarda lo que se sobrescribe—.
create or replace function public.borrar_coste_producto(p_producto text, p_ejercicio int)
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot esborrar un cost per quilo' using errcode = '42501';
  end if;
  delete from costes_producto where producto = p_producto and ejercicio = p_ejercicio;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- `tipos_caja` es catálogo, como `productos`: lo lee cualquiera con sesión, porque lo
-- necesita el formulario de alta de oferta de un productor.
grant select on tipos_caja to authenticated;

-- `costes_producto` NO: la cifra con la que se valora una donación es información
-- interna. Un donante ve el valor de SU certificado, no la tabla de costes.
grant select on costes_producto      to authenticated;
grant select on costes_producto_hist to authenticated;

alter table tipos_caja           enable row level security;
alter table costes_producto      enable row level security;
alter table costes_producto_hist enable row level security;

drop policy if exists "tipus_caixa: cataleg" on tipos_caja;
create policy "tipus_caixa: cataleg"
  on tipos_caja for select to authenticated
  using (true);

drop policy if exists "costos: intern" on costes_producto;
create policy "costos: intern"
  on costes_producto for select to authenticated
  using ((select public.es_intern()));

drop policy if exists "costos hist: intern" on costes_producto_hist;
create policy "costos hist: intern"
  on costes_producto_hist for select to authenticated
  using ((select public.es_intern()));

-- ---------------------------------------------------------------------------
-- 6. EXECUTE: quitar el PUBLIC por defecto
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Las dos comprueban el rol por dentro
--    (y el arnés verifica que un `tecnic` se lleva un 42501), así que se conceden a
--    `authenticated`; lo que hay que quitar es el `anon`.
revoke execute on function public.fijar_coste_producto(text, int, numeric, text) from public, anon;
grant  execute on function public.fijar_coste_producto(text, int, numeric, text) to authenticated, service_role;

revoke execute on function public.fijar_tipo_caja(text, text, numeric, boolean, boolean) from public, anon;
grant  execute on function public.fijar_tipo_caja(text, text, numeric, boolean, boolean) to authenticated, service_role;

revoke execute on function public.borrar_coste_producto(text, int) from public, anon;
grant  execute on function public.borrar_coste_producto(text, int) to authenticated, service_role;

-- Verificación:
--   select codigo, tara_kg, activo, provisional from tipos_caja order by orden;
--   select public.fijar_coste_producto('Tomàquet', 2026, 0.85, 'Llotja de Barcelona 2026');
--   select * from costes_producto;
--   select has_table_privilege('authenticated','public.tipos_caja','SELECT');       -- t
--   select has_table_privilege('authenticated','public.costes_producto','UPDATE');  -- f
