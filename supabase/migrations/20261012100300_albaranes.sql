-- `albaranes` y `albaran_lineas`: el documento de cada movimiento físico.
--
-- LA REGLA DE ORO DE ESTAS DOS TABLAS: **aquí no hay importes, nunca**. Ni precio, ni
-- coste por kilo, ni valor. El coste vive en `canalizaciones.coste_kg` (interno) y el
-- valor solo aparece en el certificado de donación. Un albarán con un importe convertiría
-- una donación en una operación comercial a ojos de quien lo lea, y ese es exactamente el
-- riesgo que el circuito documental existe para evitar. Por eso `albaran_lineas` **no
-- tiene ninguna columna de dinero**: no es una omisión que haya que recordar, es una
-- imposibilidad de la tabla.
--
-- LOS KILOS OFICIALES VIVEN AQUÍ, no en la canalización. Cuatro columnas por línea, y las
-- cuatro significan cosas distintas que hasta hoy se confundían en `kg_confirmados` /
-- `kg_reales`:
--   · `kg_previstos`   lo que se acordó canalizar
--   · `kg_neto`        lo que se pesó al entregar (bruto menos tara)
--   · `kg_confirmados` lo que la otra parte dice haber recibido (por el enlace)
--   · `kg_validados`   lo que el equipo da por bueno al conciliar. **Es el único que
--                      cuenta** para indicadores y certificados (D13)
--
-- TRES TIPOS Y UNA REGLA DE PERTENENCIA:
--   REC  recepción   generador -> Espigoladors. Cuelga de un `excedente_id` (donación) o
--                    de una `espigolada_id`, nunca de una canalización.
--   ENT  entrega     Espigoladors -> entidad. Uno por lote: cuelga de la canalización.
--   OPE  operación   generador -> comprador u obrador (venta y maquila). Cuelga de la
--                    canalización, y confirman las dos partes.
--
-- EL RECTIFICATIVO NO ES UN CUARTO TIPO: es un albarán del mismo `tipo` con la serie
-- `R-REC`/`R-ENT`/`R-OPE` y `rectifica_a` apuntando al original. Así el vocabulario de
-- `tipo` sigue diciendo qué movimiento documenta, que es lo que decide la plantilla y el
-- renderizador, y la serie dice si es original o corrección.

-- ---------------------------------------------------------------------------
-- 1. albaranes
-- ---------------------------------------------------------------------------
create table if not exists albaranes (
  id               uuid primary key default gen_random_uuid(),

  tipo             text not null check (tipo in ('REC', 'ENT', 'OPE')),

  -- Numeración: NULA en borrador. El número se pide al emitir, dentro de la transacción
  -- de `emitir_albaran()` (§A: el número pertenece a la fila, no al fichero). Un borrador
  -- que se descarta no deja hueco en la serie porque nunca llegó a tener número.
  serie            text,
  ejercicio        int,
  numero           int,
  numero_completo  text unique,

  -- A qué cuelga (ver cabecera). Los tres van a la vez en un ENT: `canalizacion_id` es su
  -- pertenencia y `excedente_id` es la referencia al registro que se imprime.
  excedente_id     uuid references excedentes(id),
  espigolada_id    uuid references espigoladas(id),
  canalizacion_id  uuid references canalizaciones(id),

  estado           text not null default 'borrador' check (estado in (
                     'borrador', 'emitido', 'entregado', 'confirmado',
                     'conciliado', 'anulado', 'rectificado')),

  -- COPIA CONGELADA de las partes, escrita al emitir desde las fichas y los parámetros:
  --   { entrega: {razon_social, nombre_comercial, nif, domicilio, lugar_recogida},
  --     recibe:  {razon_social, nif, domicilio, contacto},
  --     origen:  {municipio, comarca, codigo_lote} }     (solo ENT, D3)
  -- Si mañana cambia la dirección de una ficha, el albarán emitido no cambia. Es la
  -- primera de las dos capas de congelación (§D): esta la reutilizan las versiones
  -- posteriores del mismo albarán; `documentos.datos` congela cada PDF concreto.
  partes           jsonb,

  -- { fecha_hora, responsable_origen, quien_recoge, transportista, matricula,
  --   temperatura, lugar }
  recogida         jsonb,

  retorn_envasos   text,
  observaciones    text,

  -- [{ descripcion, foto_ruta }]. Lo escribe la confirmación por enlace.
  incidencias      jsonb,
  rechazo          text not null default 'cap' check (rechazo in ('cap', 'parcial', 'total')),
  motivo_rechazo   text,

  idioma           text not null default 'ca' check (idioma in ('ca', 'es')),

  emitido_at       timestamptz,
  emitido_por      uuid references auth.users(id) on delete set null,
  entregado_at     timestamptz,
  confirmado_at    timestamptz,
  conciliado_at    timestamptz,
  conciliado_por   uuid references auth.users(id) on delete set null,
  motivo_conciliacion text,
  -- Qué pasó con los kilos que no llegaron a ninguna entidad (merma, compostaje,
  -- alimentación animal…). Texto libre a propósito: el catálogo de destinos finales lo
  -- tiene que cerrar la fase 0 y sembrarlo antes es inventárselo.
  destino_final    text,
  anulado_at       timestamptz,
  motivo_anulacion text,

  -- Rectificación: el nuevo apunta al viejo (`rectifica_a`) y el viejo al nuevo
  -- (`rectificado_por`). Las dos direcciones porque las dos preguntas se hacen: «¿a qué
  -- corrige esto?» al leer el rectificativo y «¿esto sigue vigente?» al leer el original.
  rectifica_a      uuid references albaranes(id),
  rectificado_por  uuid references albaranes(id),

  created_at       timestamptz not null default now(),

  -- Un REC documenta una ENTRADA: viene de un registro o de una espigolada, exactamente
  -- de uno de los dos, y nunca de una canalización (que es una salida).
  -- Un ENT/OPE documenta una SALIDA: siempre cuelga de su canalización.
  constraint albaranes_pertenencia_check check (
    case tipo
      when 'REC' then canalizacion_id is null
                  and ((excedente_id is not null) <> (espigolada_id is not null))
      else            canalizacion_id is not null
    end
  ),
  -- La numeración es todo o nada: o es un borrador sin número, o está completa.
  constraint albaranes_numeracion_check check (
    (serie is null and ejercicio is null and numero is null and numero_completo is null)
    or (serie is not null and ejercicio is not null and numero is not null and numero_completo is not null)
  ),
  -- Un borrador no tiene número; cualquier estado posterior sí. Es la garantía de que no
  -- existe un albarán «entregado» del que nadie sepa el número.
  -- `anulado` es la excepción y tiene que estarlo: un borrador que se descarta se anula
  -- sin haber pedido nunca número, que es justamente lo que evita el hueco en la serie.
  constraint albaranes_estado_numero_check check (
       (estado = 'borrador' and numero_completo is null)
    or estado = 'anulado'
    or numero_completo is not null
  ),
  constraint albaranes_serie_uidx unique (serie, ejercicio, numero)
);

create index if not exists albaranes_canalizacion_idx on albaranes (canalizacion_id);
create index if not exists albaranes_excedente_idx    on albaranes (excedente_id);
create index if not exists albaranes_espigolada_idx   on albaranes (espigolada_id);
-- La bandeja: lo que está a medio camino es una fracción pequeña de la tabla.
create index if not exists albaranes_pendientes_idx
  on albaranes (estado, entregado_at)
  where estado in ('borrador', 'emitido', 'entregado', 'confirmado');

comment on table albaranes is
  'Un albarán por movimiento físico y tramo. SIN IMPORTES, nunca. Los kilos oficiales están en albaran_lineas.';
comment on column albaranes.partes is
  'Copia congelada de quién entrega y quién recibe, escrita al emitir. Si cambia una ficha, el albarán no cambia.';
comment on column albaranes.numero_completo is
  'null mientras es borrador: el número se pide al emitir y un borrador descartado no deja hueco en la serie.';

-- ---------------------------------------------------------------------------
-- 2. albaran_lineas
-- ---------------------------------------------------------------------------
create table if not exists albaran_lineas (
  id             uuid primary key default gen_random_uuid(),
  albaran_id     uuid not null references albaranes(id) on delete cascade,
  orden          int  not null default 1,

  producto       text references productos(nombre) on update cascade,
  variedad       text,
  familia        text,
  causa          text,

  num_cajas      int,
  tipo_caja      text references tipos_caja(codigo) on update cascade,

  kg_bruto       numeric check (kg_bruto       is null or kg_bruto       >= 0),
  tara_kg        numeric check (tara_kg        is null or tara_kg        >= 0),
  kg_neto        numeric check (kg_neto        is null or kg_neto        >= 0),
  kg_previstos   numeric check (kg_previstos   is null or kg_previstos   >= 0),
  kg_entregados  numeric check (kg_entregados  is null or kg_entregados  >= 0),
  kg_confirmados numeric check (kg_confirmados is null or kg_confirmados >= 0),
  kg_validados   numeric check (kg_validados   is null or kg_validados   >= 0),

  -- Lote o certificación de origen del producto (opcional, lo pide el anexo A).
  lote_origen    text,

  created_at     timestamptz not null default now()
);

create index if not exists albaran_lineas_albaran_idx on albaran_lineas (albaran_id, orden);

comment on table albaran_lineas is
  'Líneas de un albarán. Aquí viven los kilos oficiales. NINGUNA columna de importe, a propósito.';
comment on column albaran_lineas.kg_validados is
  'Lo que el equipo da por bueno al conciliar. Es el único kilo que cuenta para indicadores y certificados (D13).';

-- ---------------------------------------------------------------------------
-- 3. El nacimiento del albarán: un trigger, no una llamada
-- ---------------------------------------------------------------------------
-- POR QUÉ UN TRIGGER (§A del plan). `canalizaciones` se inserta hoy por **dos** caminos
-- distintos —la RPC `aprovar_resposta()` y las tres llamadas sueltas de `OfferDetail.tsx`
-- (deuda §12.19)— y la fase 3 añade un tercero (`repartir_espigolada`). Poner la creación
-- del albarán en una llamada obligaría a acordarse en los tres sitios, y el día que
-- alguien añada un cuarto camino, sus canalizaciones no tendrían albarán y nadie se
-- enteraría hasta el cierre anual. El trigger cubre todos los caminos, incluidos los que
-- todavía no existen.
--
-- QUÉ CREA, EN BORRADOR (sin número: nada se numera hasta emitir):
--   · el albarán de salida de esta canalización: **ENT** si la valorización es donación,
--     **OPE** si es venta o maquila;
--   · y, solo en donación, el **REC** del registro, si no lo tiene ya. El REC es de la
--     entrada del generador a Espigoladors: en venta y maquila no hay entrada —la
--     mercancía va del generador al comprador— y por eso ahí no se crea.
--
-- Las líneas se copian del excedente con `kg_previstos`; los kilos pesados llegan al
-- emitir y los confirmados, por el enlace.
create or replace function trg_canalizaciones_crea_albaranes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex          excedentes%rowtype;
  v_tipo      text;
  v_albaran   uuid;
  v_rec       uuid;
  v_familia   text;
begin
  if new.excedente_id is null then
    return new;   -- una canalización sin registro no puede documentar nada
  end if;

  select * into ex from excedentes where id = new.excedente_id;
  if ex.id is null then
    return new;
  end if;

  select familia into v_familia from productos where nombre = ex.producto;
  v_familia := coalesce(v_familia, ex.familia);

  v_tipo := case when coalesce(new.valorizacion, ex.modalitat) = 'donacio' then 'ENT' else 'OPE' end;

  -- (1) La salida de esta canalización.
  insert into albaranes (tipo, excedente_id, canalizacion_id, retorn_envasos, idioma)
  values (v_tipo, ex.id, new.id, ex.retorn_envasos, 'ca')
  returning id into v_albaran;

  insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                              num_cajas, kg_previstos, lote_origen)
  values (v_albaran, 1, ex.producto, ex.variedad, v_familia, ex.causa,
          new.caixes_entregades, new.kg_confirmados, new.codigo_lote);

  -- (2) La entrada del registro, solo en donación y solo si no existe ya. `for update`
  --     no hace falta: el índice único de abajo es lo que impide dos REC del mismo
  --     registro si dos canalizaciones se insertan a la vez.
  --
  -- ⚠️ UN REGISTRO DE ESPIGOLADA NO LLEVA REC PROPIO. La espigolada ya tiene el suyo
  --    —uno por jornada, con una línea por producto, creado por `crear_espigolada()`— y
  --    cuelga de `espigolada_id`, no del excedente. Sin esta condición, el reparto en
  --    lotes creaba un segundo albarán de recepción, en borrador y con los mismos kilos,
  --    que además haría contar la entrada dos veces al conciliar.
  if v_tipo = 'ENT'
     and ex.espigolada_id is null
     and not exists (select 1 from albaranes a
                      where a.tipo = 'REC' and a.excedente_id = ex.id
                        and a.estado <> 'anulado') then
    insert into albaranes (tipo, excedente_id, retorn_envasos, idioma)
    values ('REC', ex.id, ex.retorn_envasos, 'ca')
    returning id into v_rec;

    insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                                num_cajas, kg_previstos)
    values (v_rec, 1, ex.producto, ex.variedad, v_familia, ex.causa,
            ex.num_caixes, ex.kg_total);
  end if;

  return new;
end;
$$;

drop trigger if exists canalizaciones_crea_albaranes on canalizaciones;
create trigger canalizaciones_crea_albaranes
  after insert on canalizaciones
  for each row execute function trg_canalizaciones_crea_albaranes();

-- Un registro tiene como mucho UN albarán de recepción vivo. Es lo que hace que el
-- `not exists` de arriba no dependa del orden de dos transacciones simultáneas: la
-- segunda choca contra el índice en vez de crear un REC duplicado.
create unique index if not exists albaranes_rec_excedente_uidx
  on albaranes (excedente_id) where tipo = 'REC' and estado <> 'anulado';
create unique index if not exists albaranes_rec_espigolada_uidx
  on albaranes (espigolada_id) where tipo = 'REC' and estado <> 'anulado';

-- ---------------------------------------------------------------------------
-- 4. Inmutabilidad
-- ---------------------------------------------------------------------------
-- Un albarán emitido es un documento con número de serie: a partir de ahí, lo único que
-- puede cambiar es su estado y lo que cada paso del circuito escribe (confirmación,
-- conciliación, anulación). La identidad y las partes están congeladas, y lo impone la
-- base —no la RPC—: ni un `update` mal escrito ni la `service_role` de una Edge Function
-- pueden reescribir a quién se le entregó qué.
--
-- Transiciones permitidas:
--   borrador  -> emitido | anulado
--   emitido   -> entregado | anulado | rectificado
--   entregado -> confirmado | conciliado | anulado | rectificado
--   confirmado-> conciliado | rectificado
--   conciliado-> rectificado          (la corrección de un albarán ya conciliado)
--   anulado   -> ninguna              (terminal)
--
-- ⚠️ `entregado -> conciliado` está a propósito: el plazo de confirmación puede vencer
--    sin que nadie confirme, y entonces el dinamizador concilia dejando el motivo
--    (§3.3.3 del funcional). Sin esa transición, un receptor que no contesta bloquearía
--    el cierre anual del donante.
create or replace function trg_albaranes_inmutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.estado <> 'borrador' then
    if new.tipo            is distinct from old.tipo
    or new.serie           is distinct from old.serie
    or new.ejercicio       is distinct from old.ejercicio
    or new.numero          is distinct from old.numero
    or new.numero_completo is distinct from old.numero_completo
    or new.excedente_id    is distinct from old.excedente_id
    or new.espigolada_id   is distinct from old.espigolada_id
    or new.canalizacion_id is distinct from old.canalizacion_id
    or new.partes          is distinct from old.partes
    or new.idioma          is distinct from old.idioma
    or new.emitido_at      is distinct from old.emitido_at
    or new.emitido_por     is distinct from old.emitido_por then
      raise exception 'Un albara emes no es pot modificar (%). Rectifica''l.',
        coalesce(old.numero_completo, old.id::text) using errcode = '42501';
    end if;
  end if;

  if new.estado is distinct from old.estado
     and not (
          (old.estado = 'borrador'   and new.estado in ('emitido', 'anulado'))
       or (old.estado = 'emitido'    and new.estado in ('entregado', 'anulado', 'rectificado'))
       or (old.estado = 'entregado'  and new.estado in ('confirmado', 'conciliado', 'anulado', 'rectificado'))
       or (old.estado = 'confirmado' and new.estado in ('conciliado', 'rectificado'))
       or (old.estado = 'conciliado' and new.estado = 'rectificado')) then
    raise exception 'Transicio d''estat no permesa en l''albara: % -> %', old.estado, new.estado
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists albaranes_inmutable on albaranes;
create trigger albaranes_inmutable
  before update on albaranes
  for each row execute function trg_albaranes_inmutable();

-- Borrar solo un borrador. Un albarán con número es un hecho: se anula o se rectifica,
-- pero no desaparece —si desapareciera, la serie tendría un hueco y un hueco en una serie
-- documental es exactamente lo que una inspección pregunta—.
create or replace function trg_albaranes_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.estado <> 'borrador' then
    raise exception 'Un albara amb numero no s''esborra (%): anul.la''l o rectifica''l.',
      old.numero_completo using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists albaranes_no_esborrar on albaranes;
create trigger albaranes_no_esborrar
  before delete on albaranes
  for each row execute function trg_albaranes_no_esborrar();

-- ⚠️ `albaran_lineas` NO lleva trigger de inmutabilidad, y es deliberado. Quien podría
--    escribirla sin pasar por una RPC es `authenticated`, y `authenticated` **no tiene
--    GRANT de escritura** sobre ella (apartado 6): PostgREST responde `permission denied`
--    antes de evaluar nada. Los únicos escritores posibles son `service_role` y las
--    funciones `security definer` de 20261012100500 —o sea, exactamente las RPC—, así que
--    un trigger solo podría bloquearlas a ellas. Un intento anterior comparaba
--    `current_user` con `'service_role'` y habría roto todas las RPC: dentro de una
--    función `security definer`, `current_user` es su **propietario** (postgres), no el
--    rol que llama. Lo que congela el contenido de un albarán emitido es
--    `documentos.datos` (el snapshot del PDF) más el trigger de la cabecera.

-- ---------------------------------------------------------------------------
-- 5. La vista de la bandeja
-- ---------------------------------------------------------------------------
-- `security_invoker = true` (PG15+): la vista NO es un agujero en la RLS. Se evalúan las
-- políticas de quien consulta, así que un receptor que la mire solo ve sus ENT. Sin esa
-- opción, una vista corre con los permisos de quien la creó —el superusuario de la
-- migración— y enseñaría la tabla entera a cualquiera.
create or replace view v_albaranes_bandeja
with (security_invoker = true) as
select a.id,
       a.tipo,
       a.numero_completo,
       a.estado,
       a.ejercicio,
       a.excedente_id,
       a.espigolada_id,
       a.canalizacion_id,
       e.id_excedente,
       e.producto,
       e.productor_id,
       c.entidad_id,
       c.codigo_lote,
       a.emitido_at,
       a.entregado_at,
       a.confirmado_at,
       a.conciliado_at,
       a.rechazo,
       l.kg_previstos,
       l.kg_neto,
       l.kg_confirmados,
       l.kg_validados,
       -- Días desde que salió el enlace de confirmación. Es lo que ordena la pestaña
       -- «Confirmacions pendents» y lo que compara la RPC con el plazo del parámetro.
       case when a.entregado_at is not null and a.confirmado_at is null
            then extract(day from (now() - a.entregado_at))::int
       end as dias_esperando
  from albaranes a
  left join excedentes     e on e.id = a.excedente_id
  left join canalizaciones c on c.id = a.canalizacion_id
  left join lateral (
       select sum(kg_previstos)   as kg_previstos,
              sum(kg_neto)        as kg_neto,
              sum(kg_confirmados) as kg_confirmados,
              sum(kg_validados)   as kg_validados
         from albaran_lineas where albaran_id = a.id
  ) l on true;

comment on view v_albaranes_bandeja is
  'Un albarán por fila con sus kilos sumados y los días de espera. security_invoker: respeta la RLS de quien consulta.';

grant select on v_albaranes_bandeja to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- Solo SELECT: emitir, confirmar, conciliar, anular y rectificar son RPC (20261012100500).
-- Ninguna de esas cinco cosas es un `update` de una columna: todas mueven varias tablas en
-- una transacción y todas piden un número o congelan una copia.
grant select on albaranes      to authenticated;
grant select on albaran_lineas to authenticated;

alter table albaranes      enable row level security;
alter table albaran_lineas enable row level security;

-- ⚠️ AQUÍ SOLO EL EQUIPO. La política que deja ver a un productor su REC y a una entidad
--    su ENT necesita `albarans_de_les_meves_orgs()`, que se declara en
--    20261012100500_rpc_albaranes.sql (no se puede declarar una política que llame a una
--    función que todavía no existe). Es el mismo orden que `documentos` en la fase 1: entre
--    las dos migraciones la tabla está cerrada para todo el que no sea del equipo, que es
--    el intermedio correcto.
drop policy if exists "albarans: intern" on albaranes;
create policy "albarans: intern"
  on albaranes for select to authenticated
  using ((select public.es_intern()));

drop policy if exists "linies albara: intern" on albaran_lineas;
create policy "linies albara: intern"
  on albaran_lineas for select to authenticated
  using ((select public.es_intern()));

-- Verificación:
--   select has_table_privilege('authenticated','public.albaranes','SELECT');  -- t
--   select has_table_privilege('authenticated','public.albaranes','INSERT');  -- f
--   insert into canalizaciones (excedente_id, entidad_id, kg_confirmados) values (…);
--   select tipo, estado, numero_completo from albaranes;   -- ENT y REC en borrador
