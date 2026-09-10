-- `espigoladas`: la cabecera que agrupa los registros de una misma jornada de espigueo.
--
-- QUÉ RESUELVE. Una espigolada produce varios productos a la vez (tomate, calabacín,
-- lechuga) recogidos el mismo día, en la misma finca, por el mismo grupo de voluntariado,
-- y se reparte después en lotes a varias entidades. Sin cabecera, eso serían N excedentes
-- sueltos sin nada que los relacione: ni un albarán de recepción común, ni un recuento de
-- kilos por jornada, ni forma de saber cuántas personas fueron.
--
-- ES LA ESPIGOLADA **MANUAL**, no el módulo de espigolament. El módulo no existe todavía
-- (§1bis, brecha 10) y esto no lo sustituye: es la ficha mínima que el equipo rellena
-- desde el panel para poder documentar lo que ya hace. `ref_externa` es la única
-- concesión al futuro —cuando el módulo exista, podrá crear o actualizar la misma
-- espigolada por API sin duplicar kilos— y por eso es `unique`.

create table if not exists espigoladas (
  id              uuid primary key default gen_random_uuid(),

  -- De quién es la finca. Es el DONANTE de todo lo que salga de aquí: los kilos
  -- espigolados se certifican a su nombre, igual que una donación normal.
  productor_id    uuid not null references productores(id),
  ubicacion_id    uuid references productor_ubicaciones(id),

  fecha           date not null default (now() at time zone 'Europe/Madrid')::date,
  num_voluntarios int check (num_voluntarios is null or num_voluntarios >= 0),
  notas           text,

  -- Id en el sistema de origen (futuro módulo). Único cuando no es null.
  ref_externa     text,

  -- `oberta`  = todavía se pueden añadir productos o repartir lotes.
  -- `tancada` = el reparto ha terminado; el REC se emite y ya no se toca.
  estado          text not null default 'oberta' check (estado in ('oberta', 'tancada')),

  creada_por      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create unique index if not exists espigoladas_ref_externa_uidx
  on espigoladas (ref_externa) where ref_externa is not null;

create index if not exists espigoladas_productor_idx on espigoladas (productor_id, fecha desc);

comment on table espigoladas is
  'Cabecera de una jornada de espigueo: productor, finca, fecha y voluntariado. Sus productos son excedentes con origen = espigolament.';
comment on column espigoladas.num_voluntarios is
  'Personas voluntarias. Opcional: hoy solo es indicador, mañana lo alimentará el módulo de espigolament.';

-- La FK que la migración anterior no pudo declarar: `excedentes.espigolada_id` se creó
-- como uuid suelto porque esta tabla no existía. Aquí se ata.
alter table excedentes drop constraint if exists excedentes_espigolada_id_fkey;
alter table excedentes add constraint excedentes_espigolada_id_fkey
  foreign key (espigolada_id) references espigoladas(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- Solo SELECT: la espigolada se crea y se reparte con `crear_espigolada()` /
-- `repartir_espigolada()` (20261012100500), que hacen varias escrituras en una
-- transacción —cabecera, excedentes, albarán— y eso no lo sabe hacer una política.
grant select on espigoladas to authenticated;

alter table espigoladas enable row level security;

-- El equipo lo ve todo. El productor ve las suyas: son sus donaciones, y de ellas sale su
-- certificado. Una entidad receptora no ve la espigolada —ve su albarán de entrega—:
-- quién más recibió de la misma jornada no es asunto suyo.
drop policy if exists "espigolades: intern o meves" on espigoladas;
create policy "espigolades: intern o meves"
  on espigoladas for select to authenticated
  using (
       (select public.es_intern())
    or productor_id in (select public.mis_productores())
  );

-- Verificación:
--   select has_table_privilege('authenticated','public.espigoladas','SELECT');  -- t
--   select has_table_privilege('authenticated','public.espigoladas','INSERT');  -- f
--   \d espigoladas
