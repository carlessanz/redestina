-- `documentos_externos`: lo que aportan los demás.
--
-- LA DIFERENCIA CON `documentos`. `documentos` es lo que **Redestina emite**: nace de una
-- RPC, tiene número de serie propio, snapshot congelado y dos huellas. Esto es lo
-- contrario: un fichero que llega de fuera —el albarán del propio productor, la factura
-- del donante, la foto de una incidencia— del que no controlamos ni el formato ni el
-- número. Mezclar las dos cosas en una tabla obligaría a dejar en null media docena de
-- columnas que en `documentos` son `not null` por buenos motivos.
--
-- POR QUÉ POLIMÓRFICA DESDE EL PRIMER DÍA. En la fase 3 solo cuelga de albaranes (D2: el
-- REC se emite siempre, aunque el productor traiga el suyo, que se adjunta aquí y cuyo
-- número se cita en el nuestro). En la fase 4 cuelga también de `cierres_donante`: la
-- factura que el donante manda contra el resumen anual es exactamente esto. Se deja el
-- vocabulario abierto ahora para no migrar después.
--
-- LA RUTA LA DA `ruta_documento()`, IGUAL QUE UN DOCUMENTO EMITIDO (§B.3): el fichero va a
-- la carpeta de la organización **que lo aporta**, bajo `externs/`. La Edge Function
-- `subir-documento-externo` sube ahí y no elige carpeta.

create table if not exists documentos_externos (
  id           uuid primary key default gen_random_uuid(),

  objeto_tipo  text not null check (objeto_tipo in ('albaran', 'cierre_donante')),
  objeto_id    uuid not null,

  tipo         text not null check (tipo in (
                 'albaran_productor',   -- el albarán propio del generador (D2)
                 'factura',             -- la factura del donante contra el resumen (fase 4)
                 'foto_incidencia',     -- lo que adjunta quien confirma una entrega
                 'altre')),

  -- Número y fecha DEL DOCUMENTO AJENO, tal como vienen impresos en él. Se citan en el
  -- nuestro: «albarán del productor núm. 2026/118 de 14/10/2026».
  numero       text,
  fecha        date,

  ruta         text not null,
  sha256       text,
  mime         text,
  bytes        int,

  -- Por dónde entró. `whatsapp` es el caso opcional del final de la fase 3 (una foto que
  -- manda un productor con un REC abierto); `enlace`, lo que sube quien confirma sin tener
  -- cuenta.
  origen       text not null default 'panel' check (origen in ('panel', 'enlace', 'whatsapp')),

  subido_por   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists documentos_externos_objeto_idx
  on documentos_externos (objeto_tipo, objeto_id);

comment on table documentos_externos is
  'Ficheros aportados por terceros (albarán del productor, factura, fotos). Lo que Redestina emite va en `documentos`.';
comment on column documentos_externos.numero is
  'Número del documento AJENO, tal como viene impreso. Se cita en el nuestro; no es de ninguna serie nuestra.';

-- ---------------------------------------------------------------------------
-- Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- Solo SELECT. La subida pasa por la Edge Function `subir-documento-externo`, que es
-- quien comprueba el tipo MIME, el tamaño y quién sube, y quien deja el fichero en la
-- ruta que dice `ruta_documento()`. Una fila aquí sin fichero detrás no significa nada.
grant select on documentos_externos to authenticated;

alter table documentos_externos enable row level security;

-- ⚠️ Solo el equipo, de momento: la política que deja a un productor ver los adjuntos de
--    SU albarán necesita `albarans_de_les_meves_orgs()`, declarada en
--    20261012100500_rpc_albaranes.sql. Mismo orden que `albaranes` y que `documentos` en
--    la fase 1.
drop policy if exists "externs: intern" on documentos_externos;
create policy "externs: intern"
  on documentos_externos for select to authenticated
  using ((select public.es_intern()));

-- Verificación:
--   select has_table_privilege('authenticated','public.documentos_externos','SELECT');  -- t
--   select has_table_privilege('authenticated','public.documentos_externos','INSERT');  -- f
