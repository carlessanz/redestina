-- Cierre anual del ejercicio: las tres tablas de las que sale el certificado de donación.
--
-- QUÉ ES UN CIERRE. Una foto, congelada, de lo que cada donante ha donado durante un año
-- natural: sus kilos, su valor y el detalle de las canalizaciones que lo componen. De esa
-- foto salen dos documentos —el **resumen anual** con el que se le pide la factura, y el
-- **certificado de donación** que le permite aplicarse el incentivo del art. 16 de la Ley
-- 49/2002— y la exportación para el modelo 182 que presenta la gestoría.
--
-- POR QUÉ TRES TABLAS Y NO UNA VISTA. Podría calcularse al vuelo, y sería un error: un
-- certificado dice lo que decía el día que se emitió, y las canalizaciones cambian
-- después (una conciliación tardía, un coste corregido). `cierre_donante_lineas` guarda
-- **los kilos y el coste tal como estaban**, así que el certificado se puede regenerar
-- idéntico dentro de cinco años y la diferencia con lo que hoy dice la base es
-- comprobable, no invisible.
--
-- EL MODO ES LO QUE HACE ESTO EJECUTABLE EN DICIEMBRE (D1 del plan). El ejercicio 2026 se
-- cierra en **prueba** tantas veces como haga falta: series propias con prefijo `P-`
-- (`P-RES`, `P-CD`, sembradas en 20260928100000), marca de agua en el PDF, destinatarios
-- forzados al equipo, y un botón que borra los resultados sin tocar ni una canalización ni
-- un albarán. Un ejercicio admite **varios cierres de prueba y un solo cierre real**, y eso
-- último lo garantiza un índice, no una comprobación en el código.
--
-- ⚠️ NINGUNA DE LAS TRES TABLAS TIENE GRANT DE ESCRITURA. Todo se escribe por las RPC de
--    20261109100100. Un `update` a mano sobre `cierres_donante` podría poner un importe
--    distinto del calculado en un certificado ya numerado, que es exactamente lo que el
--    circuito existe para impedir.

-- ---------------------------------------------------------------------------
-- 1. cierres_ejercicio: la cabecera
-- ---------------------------------------------------------------------------
create table if not exists cierres_ejercicio (
  id             uuid primary key default gen_random_uuid(),
  ejercicio      int  not null check (ejercicio between 2020 and 2100),

  -- prueba | real. Vive en el dato, no en un interruptor global: un cierre de ensayo no
  -- puede convertirse en real por cambiar una configuración (§A del plan).
  modo           text not null default 'prueba' check (modo in ('prueba', 'real')),

  -- obert       -> se está calculando y recalculando
  -- provisional -> se ha enviado el resumen provisional (15 de diciembre)
  -- tancat      -> el ejercicio está congelado (31 de diciembre, job `congelar_ejercicio`)
  -- declarat    -> la gestoría ha presentado el 182
  estado         text not null default 'obert'
                   check (estado in ('obert', 'provisional', 'tancat', 'declarat')),

  abierto_at     timestamptz not null default now(),
  calculado_at   timestamptz,
  provisional_at timestamptz,
  cerrado_at     timestamptz,
  declarado_at   timestamptz,

  creado_por     uuid references auth.users(id) on delete set null,
  notas          text,
  created_at     timestamptz not null default now()
);

comment on table cierres_ejercicio is
  'Un cierre de un ejercicio. Varios en modo prueba por año; uno solo en modo real (índice parcial).';
comment on column cierres_ejercicio.modo is
  'prueba | real. Decide series P-*, marca de agua y destinatarios. Independiente de app_settings.test_mode.';
comment on column cierres_ejercicio.calculado_at is
  'Última vez que corrió calcular_cierre(). No es la fecha del certificado: esa es la de generación (D14).';

-- **Un solo cierre real por ejercicio.** Es la garantía que impide emitir dos veces los
-- certificados de un año; los de prueba no la tienen a propósito.
create unique index if not exists cierres_ejercicio_real_uidx
  on cierres_ejercicio (ejercicio) where modo = 'real';

create index if not exists cierres_ejercicio_ejercicio_idx
  on cierres_ejercicio (ejercicio, modo);

-- ---------------------------------------------------------------------------
-- 2. cierres_donante: una fila por donante y cierre
-- ---------------------------------------------------------------------------
create table if not exists cierres_donante (
  id                     uuid primary key default gen_random_uuid(),
  cierre_id              uuid not null references cierres_ejercicio(id) on delete cascade,
  productor_id           uuid not null references productores(id),

  -- Copia congelada de la razón social, el NIF y el domicilio EN EL MOMENTO DEL CÁLCULO.
  -- Un cambio de domicilio en marzo no debe reescribir el certificado de enero.
  datos_fiscales         jsonb,

  kg_total               numeric not null default 0,
  valor_total            numeric not null default 0,

  -- La máquina de estados del §3.5.3 del plan funcional.
  estado                 text not null default 'calculat' check (estado in (
                           'calculat', 'resum_enviat', 'factura_pendent', 'factura_rebuda',
                           'coincident', 'discrepancia', 'certificat_emes', 'enviat', 'declarat')),

  -- [{codigo, detall, bloqueja}]. `bloqueja = true` impide emitir el certificado.
  bloqueos               jsonb not null default '[]'::jsonb,

  -- Numeración: el número pertenece a ESTA fila, no al PDF (§A). `documentos` lo copia.
  resumen_numero         text,
  certificado_numero     text,
  certificado_at         timestamptz,

  -- La factura del donante. El importe del certificado NUNCA sale de aquí: se cita y
  -- tiene que coincidir con `valor_total` a 2 decimales (§3.5.1).
  factura_numero         text,
  factura_fecha          date,
  factura_importe        numeric,
  factura_doc_externo_id uuid references documentos_externos(id) on delete set null,

  -- La excepción de D4: certificado sin factura coincidente, solo super_admin y con motivo.
  excepcion_sin_factura  boolean not null default false,
  excepcion_motivo       text,
  excepcion_por          uuid references auth.users(id) on delete set null,

  -- Seguimiento: correo a los 7 y 14 días; a los 14, llamada del dinamizador (no hay
  -- módulo de tareas, y no se crea uno: la bandera y el contador son el filtro de la
  -- bandeja, decisión D del plan de ejecución).
  recordatorios          int  not null default 0,
  ultimo_recordatorio_at timestamptz,
  requiere_llamada       boolean not null default false,

  rectificaciones        int  not null default 0,
  calculado_at           timestamptz,
  enviado_at             timestamptz,
  declarado_at           timestamptz,
  created_at             timestamptz not null default now(),

  unique (cierre_id, productor_id)
);

comment on table cierres_donante is
  'El acumulado anual de un donante en un cierre: kilos, valor, factura citada y certificado.';
comment on column cierres_donante.bloqueos is
  'Array [{codigo, detall, bloqueja}]. Con algún bloqueja=true, emitir_certificado() se niega.';
comment on column cierres_donante.datos_fiscales is
  'Copia congelada de razón social, NIF y domicilio al calcular. El certificado no cambia si cambia la ficha.';
comment on column cierres_donante.factura_importe is
  'Lo que dice la factura del donante. El certificado siempre dice valor_total; si no coinciden, discrepancia.';

create index if not exists cierres_donante_cierre_idx on cierres_donante (cierre_id, estado);
create index if not exists cierres_donante_productor_idx on cierres_donante (productor_id);
-- La bandeja «Factures pendents» con los días de retraso.
create index if not exists cierres_donante_factura_idx
  on cierres_donante (ultimo_recordatorio_at)
  where estado in ('resum_enviat', 'factura_pendent', 'discrepancia');

-- ---------------------------------------------------------------------------
-- 3. cierre_donante_lineas: el detalle que sostiene la cifra
-- ---------------------------------------------------------------------------
-- Una fila por canalización incluida. Es lo que hace auditable un certificado: sin esto,
-- «3.412 kg» sería un número sin nada detrás.
create table if not exists cierre_donante_lineas (
  id                uuid primary key default gen_random_uuid(),
  cierre_donante_id uuid not null references cierres_donante(id) on delete cascade,
  canalizacion_id   uuid not null references canalizaciones(id),

  -- El albarán de recepción del que salen los kilos (D13). Null cuando la conciliación
  -- fue retroactiva: esas canalizaciones no tienen albaranes, y por eso no cuentan en un
  -- cierre real.
  albaran_rec_id    uuid references albaranes(id),

  producto          text,
  mes               int check (mes between 1 and 12),
  kg_neto           numeric not null default 0,
  coste_kg          numeric,
  valor             numeric not null default 0,
  entidad_id        uuid references entidades(id) on delete set null,
  retroactiva       boolean not null default false,
  created_at        timestamptz not null default now(),

  unique (cierre_donante_id, canalizacion_id)
);

comment on table cierre_donante_lineas is
  'Las canalizaciones que componen el acumulado de un donante, con kilos y coste CONGELADOS.';
comment on column cierre_donante_lineas.kg_neto is
  'Kilos atribuidos a esta canalización desde el neto conciliado del REC (D13). Ver calcular_cierre().';
comment on column cierre_donante_lineas.retroactiva is
  'Conciliación hecha sin albaranes (fuente 2 del plan). Solo cuenta en cierres de prueba.';

create index if not exists cierre_lineas_donante_idx on cierre_donante_lineas (cierre_donante_id);
create index if not exists cierre_lineas_canalizacion_idx on cierre_donante_lineas (canalizacion_id);

-- ---------------------------------------------------------------------------
-- 4. El puente: qué cierres son de cada organización
-- ---------------------------------------------------------------------------
-- Función puente `security definer` que devuelve `setof uuid`, no un `exists`
-- correlacionado (§A, deuda §12.23): envuelta en `(select …)` dentro de una política se
-- evalúa una vez por consulta y no reentra en la RLS de `productores`.
--
-- LA REGLA, que es la del plan: el donante ve su fila de los cierres **reales** siempre, y
-- la de los cierres **de prueba solo si su ficha es `es_test`**. Un donante real no debe
-- encontrarse en su panel un acumulado que no tiene ningún valor fiscal: le parecería el
-- de verdad. Las organizaciones `TEST-*` sí, porque son justamente con las que se ensaya.
create or replace function public.cierres_donante_meus(p_user uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els tancaments d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  return query
    select cd.id
      from cierres_donante cd
      join cierres_ejercicio ce on ce.id = cd.cierre_id
      join productores       pr on pr.id = cd.productor_id
      join membresias        m  on m.productor_id = cd.productor_id
      join perfiles          pe on pe.id = m.user_id
     where m.user_id = v_user
       and m.activo and pe.activo
       and (ce.modo = 'real' or pr.es_test);
end;
$$;

comment on function public.cierres_donante_meus(uuid) is
  'Ids de cierres_donante que ve una organización del usuario. Los de prueba, solo si su ficha es es_test.';

-- ---------------------------------------------------------------------------
-- 5. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- SELECT explícito: una tabla nueva sin GRANT responde `permission denied` ANTES de
-- evaluar RLS, y es el error más caro de diagnosticar (§4). **Sin INSERT/UPDATE/DELETE
-- para nadie**: todo pasa por las RPC de 20261109100100.
grant select on cierres_ejercicio     to authenticated;
grant select on cierres_donante       to authenticated;
grant select on cierre_donante_lineas to authenticated;

alter table cierres_ejercicio     enable row level security;
alter table cierres_donante       enable row level security;
alter table cierre_donante_lineas enable row level security;

-- La cabecera es del equipo. El donante no necesita saber cuántos ensayos se han hecho:
-- lo que le importa es SU fila, y esa la ve por la política de abajo.
drop policy if exists "tancaments: intern" on cierres_ejercicio;
create policy "tancaments: intern"
  on cierres_ejercicio for select to authenticated
  using ((select public.es_intern()));

drop policy if exists "tancament donant: intern o meu" on cierres_donante;
create policy "tancament donant: intern o meu"
  on cierres_donante for select to authenticated
  using (
       (select public.es_intern())
    or id in (select public.cierres_donante_meus())
  );

drop policy if exists "linies tancament: intern o meves" on cierre_donante_lineas;
create policy "linies tancament: intern o meves"
  on cierre_donante_lineas for select to authenticated
  using (
       (select public.es_intern())
    or cierre_donante_id in (select public.cierres_donante_meus())
  );

-- ---------------------------------------------------------------------------
-- 6. EXECUTE: quitar el PUBLIC por defecto
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC.
revoke execute on function public.cierres_donante_meus(uuid) from public, anon;
grant  execute on function public.cierres_donante_meus(uuid) to authenticated, service_role;

-- Verificación:
--   select has_table_privilege('authenticated','public.cierres_donante','SELECT');  -- t
--   select has_table_privilege('authenticated','public.cierres_donante','UPDATE');  -- f
--   insert into cierres_ejercicio (ejercicio, modo) values (2026,'real'), (2026,'real');  -- 23505
