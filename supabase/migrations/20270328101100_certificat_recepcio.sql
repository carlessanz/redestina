-- El **certificado de recepción** (`CR`): lo que Redestina acredita a una entidad
-- RECEPTORA sobre los kilos de producto local fuera del circuito de venta que ha recibido
-- en una ventana de fechas.
--
-- QUÉ RESUELVE. Todo el circuito documental construido hasta hoy mira hacia el lado del
-- **generador**: el resumen anual, el certificado de donación (anual y a demanda) y el de
-- transacción acreditan lo que una organización ENTREGÓ. La entidad que RECIBE no tiene
-- ningún papel que acredite lo que ha entrado por su puerta, y lo necesita para lo mismo
-- que el donante necesita el suyo: enseñárselo a un tercero —una memoria anual, una
-- subvención, una auditoría de sostenibilidad, un ayuntamiento que pide justificar el
-- aprovechamiento alimentario—.
--
-- ⚠️ NO ES UN DOCUMENTO FISCAL Y NO LLEVA NI UN EURO. El CD acredita una donación
--    deducible (art. 16 Ley 49/2002) y va al modelo 182; el CR acredita **kilos
--    recibidos**, y nada más. Por eso:
--      · `cierres_receptor` **no tiene ninguna columna de importe**, igual que
--        `albaran_lineas` no tiene ninguna de precio. No es que no se impriman: es que no
--        existen, así que no se pueden filtrar por descuido. El arnés lo comprueba
--        esperando `42703 undefined_column`, que es la única forma de verificar una
--        ausencia.
--      · No hay factura, ni `registrar_factura_*`, ni excepción de D4. No había nada que
--        retirar: este circuito nace después de la decisión del 21-09-2026 (§4, deuda 111).
--
-- DONACIÓN Y COMPRA, EN EL MISMO PAPEL. La entidad receptora recibe por las tres
-- valorizaciones (`donacio`, `venda`, `maquila`) y lo que quiere acreditar es el total de
-- producto aprovechado, no una de las tres. El certificado las suma y las **desglosa**
-- (`kg_donacio` / `kg_compra`), que es lo que permite que el tercero que lo lea entienda
-- qué está viendo.
--
-- 🔴 LAS DOS PARTES NO SE IMPRIMEN IGUAL, Y ESO ES UNA DECISIÓN DEL CLIENTE, NO UN DETALLE:
--
--   · **Compra (venda/maquila): SÍ se nombra al generador.** D3 protege al donante en la
--     donación; en una compra hay dos partes que ya se conocen —han contratado entre
--     ellas— y ocultarlo no protegería a nadie. Es la misma regla que ya aplica el albarán
--     `OPE` (20261012100500 §5: «aquí sí van las dos partes con nombre»).
--
--   · **Donación: D3 con todo su rigor.** Municipio y comarca de origen, NUNCA la
--     organización. Y eso no se sostiene con un comentario: se sostiene con un `check` en
--     `cierre_receptor_lineas` que hace **imposible** guardar el nombre, el NIF o el id del
--     donante en una línea de donación. El motivo de que sea un check y no disciplina: la
--     entidad lee sus propias líneas por RLS (`cierres_receptor_meus()`), así que una
--     columna rellenada por error no se quedaría en el PDF, se serviría por la API.
--
--   ⚠️ Y hay tres vías por las que el nombre del donante se cuela sin que nadie lo escriba
--      (§9, «D3 también se aplica en la API»), las tres cerradas aquí:
--        1. `excedentes.id_excedente` tiene el formato `E-AAMMDD-XXX-YYY-N`, donde **XXX
--           son las tres primeras letras del nombre del productor**. Por eso estas tablas
--           guardan `canalizacion_id` y NO guardan ni `id_excedente` ni `excedente_id`.
--        2. `recogida.lugar` (la finca) y `responsable_origen` (la persona en origen)
--           nombran al donante. No entran en ningún sitio de este circuito.
--        3. El `productor_id` a secas: un uuid no dice el nombre, pero el equipo lo
--           resuelve en un join y la entidad no debe tenerlo. Fuera también.
--      La traza para el equipo no se pierde: `canalizacion_id` lleva al excedente y de ahí
--      al productor en un join, y eso el equipo ya lo puede hacer.
--
--   ⚠️ LO QUE ESTO **NO** ARREGLA, y conviene no fingir lo contrario: una donación cuyo
--      municipio de origen tenga un solo generador es identificable igualmente. Es el mismo
--      límite que ya tiene el albarán `ENT` desde la fase 3, y se acepta con el mismo
--      criterio: el municipio es la unidad mínima con la que la entidad puede decir de
--      dónde viene lo que reparte.
--
-- POR QUÉ TABLA PROPIA Y NO UNA FILA MÁS EN `cierres_donante` NI EN `cierres_periodo`. Por
-- lo mismo que el certificado a demanda no cabía en `cierres_donante` (20270303100100), y
-- además por una razón que allí no existía:
--   · el eje es **`entidad_id`**, no `productor_id`. Las dos tablas del cierre tienen esa
--     columna `not null` y toda su RLS, sus puentes y `datos_182()` cuelgan de ella.
--   · un certificado de recepción **no abre cierre**: es a demanda, por ventana, y una
--     entidad puede pedir varios al año.
-- Del motor documental se hereda todo lo demás sin tocarlo: `ruta_documento()`,
-- `documents_meus()`, `puede_ver_documento()` —que delega en `documents_meus()` y por eso
-- no hay que recrearla—, la inmutabilidad de `documentos` y el trigger de encolado del PDF.

-- ---------------------------------------------------------------------------
-- 1. cierres_receptor: una fila por certificado de recepción
-- ---------------------------------------------------------------------------
create table if not exists cierres_receptor (
  id                 uuid primary key default gen_random_uuid(),
  entidad_id         uuid not null references entidades(id),

  -- La ventana certificada, cerrada por los dos lados y **dentro de un solo año natural**:
  -- la serie es por ejercicio y un certificado a caballo de dos años no sabría a cuál
  -- pertenece. Lo impone el check de abajo, no un comentario.
  periodo_desde      date not null,
  periodo_hasta      date not null,
  ejercicio          int  not null check (ejercicio between 2020 and 2100),

  -- Vive en el dato, como en `cierres_ejercicio` y `cierres_periodo`: decide serie `P-`,
  -- marca de agua y destinatario. Independiente de `app_settings.test_mode` (§8).
  modo               text not null default 'prueba' check (modo in ('prueba', 'real')),

  -- Copia congelada de la ficha de la entidad en el momento del cálculo. Un cambio de
  -- domicilio en marzo no debe reescribir el certificado de enero.
  datos_fiscales     jsonb,

  -- 🔴 LOS TRES ÚNICOS NÚMEROS DE ESTA TABLA SON KILOS. Ver la cabecera: aquí no hay
  --    `valor_total` ni `coste_kg`, y su ausencia es la garantía.
  --    `kg_donacio + kg_compra = kg_total` **siempre**: una canalización sin
  --    `valorizacion` (las anteriores a 20261012100100) cuenta como donación, que es el
  --    defecto del negocio, en vez de caerse de los dos sumandos.
  kg_total           numeric not null default 0,
  kg_donacio         numeric not null default 0,
  kg_compra          numeric not null default 0,

  -- Sin los estados de la factura ni los del 182: aquí no hay ni una cosa ni la otra.
  estado             text not null default 'calculat' check (estado in (
                       'calculat', 'certificat_emes', 'enviat', 'substituit')),

  -- [{codigo, detall, bloqueja}], igual que en el resto del circuito.
  bloqueos           jsonb not null default '[]'::jsonb,

  certificado_numero text,
  certificado_at     timestamptz,
  rectificaciones    int  not null default 0,

  -- El certificado de recepción POSTERIOR que contiene a esta ventana y la sustituye. Es
  -- la regla de no-doble-conteo, en la base y no en una pantalla: dos papeles vigentes con
  -- kilos solapados es exactamente lo que hay que evitar cuando los dos acreditan lo mismo
  -- ante un tercero.
  sustituido_por     uuid references cierres_receptor(id) on delete set null,
  sustituido_at      timestamptz,

  -- El motivo con el que se pidió, si se dio (`emetre_certificat_recepcio(p_motiu)`).
  -- ⚠️ Es una nota INTERNA y **no sale impresa**: un certificado que dijera por qué se
  --    emitió estaría afirmando algo sobre quien lo pidió que nadie ha comprobado.
  notas              text,

  calculado_at       timestamptz,
  enviado_at         timestamptz,
  creado_por         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),

  constraint cierres_receptor_ventana_check check (periodo_desde <= periodo_hasta),
  -- ⚠️ El nombre NO puede ser `cierres_receptor_ejercicio_check`: ese lo genera Postgres
  --    solo para el `check` de columna de `ejercicio`, y dos constraints no comparten
  --    nombre en la misma tabla (misma trampa que en 20270303100100).
  constraint cierres_receptor_any_natural_check check (
    extract(year from periodo_desde)::int = ejercicio
    and extract(year from periodo_hasta)::int = ejercicio)
);

comment on table cierres_receptor is
  'Certificado de recepción (CR): los kilos que una entidad receptora ha recibido en una ventana de fechas. Donación y compra juntas, SIN importes.';
comment on column cierres_receptor.modo is
  'real | prueba. Decide la serie (CR / P-CR), la marca de agua y el destinatario.';
comment on column cierres_receptor.kg_donacio is
  'Kilos recibidos por donación. En el documento se imprimen SIN nombrar al donante (D3): municipio y comarca.';
comment on column cierres_receptor.kg_compra is
  'Kilos recibidos por venta o maquila. Aquí el generador SÍ se nombra: las dos partes han contratado entre ellas.';
comment on column cierres_receptor.bloqueos is
  'Array [{codigo, detall, bloqueja}]. Con algún bloqueja=true, emetre_certificat_recepcio() se niega.';
comment on column cierres_receptor.notas is
  'Nota interna del motivo de emisión. NO se imprime en el documento.';

-- Un solo borrador por entidad, modo y ventana: recalcular la misma ventana actualiza la
-- fila en vez de dejar dos. Los ya numerados quedan fuera del índice y se acumulan, que es
-- lo que se quiere (son el histórico).
create unique index if not exists cierres_receptor_esborrany_uidx
  on cierres_receptor (entidad_id, modo, periodo_desde, periodo_hasta)
  where certificado_numero is null;

create index if not exists cierres_receptor_entidad_idx
  on cierres_receptor (entidad_id, ejercicio, periodo_hasta desc);
create index if not exists cierres_receptor_estado_idx
  on cierres_receptor (estado, modo);

-- ---------------------------------------------------------------------------
-- 2. cierre_receptor_lineas: el detalle que sostiene la cifra
-- ---------------------------------------------------------------------------
-- Hermana de `cierre_donante_lineas` y `cierre_periodo_lineas`, y por el mismo motivo: sin
-- esto, «3.412 kg» sería un número sin nada detrás, y un certificado se tiene que poder
-- regenerar idéntico dentro de cinco años. Aquí además sostiene la **tabla de
-- procedencias** que imprime el PDF.
create table if not exists cierre_receptor_lineas (
  id                  uuid primary key default gen_random_uuid(),
  cierre_receptor_id  uuid not null references cierres_receptor(id) on delete cascade,
  canalizacion_id     uuid not null references canalizaciones(id),

  -- El albarán del que salen los kilos: **ENT** en donación, **OPE** en venta y maquila.
  -- Los dos cuelgan de la canalización 1:1, así que aquí NO hay reparto proporcional
  -- —al revés que en el certificado del donante, donde el `REC` documenta una entrada que
  -- luego se reparte entre varias entidades (20270303100000)—. Corolario que importa: la
  -- ventana **no puede partir** nada, y por eso este circuito no tiene el bloqueo
  -- `periode_parteix_excedent`.
  albaran_id          uuid references albaranes(id),
  albaran_tipo        text check (albaran_tipo is null or albaran_tipo in ('ENT', 'OPE')),

  valorizacion        text not null check (valorizacion in ('donacio', 'venda', 'maquila')),
  producto            text,
  mes                 int check (mes between 1 and 12),
  kg_neto             numeric not null default 0,

  -- El origen, en la forma que permite D3. Estas dos van SIEMPRE: son lo único que se
  -- imprime de la procedencia de una donación.
  municipio           text,
  comarca             text,

  -- 🔴 Y estas tres SOLO en compra. En donación son NULL y el check de abajo lo hace
  --    imposible de otra manera (ver cabecera).
  productor_id        uuid references productores(id) on delete set null,
  productor_nom       text,
  productor_nif       text,

  -- Conciliada a mano para el ensayo: en modo real no entra (misma regla que el resto).
  retroactiva         boolean not null default false,
  created_at          timestamptz not null default now(),

  unique (cierre_receptor_id, canalizacion_id),

  -- D3, en el esquema y no en la disciplina de quien escriba la próxima RPC.
  constraint cierre_receptor_lineas_d3_check check (
    valorizacion <> 'donacio'
    or (productor_id is null and productor_nom is null and productor_nif is null))
);

comment on table cierre_receptor_lineas is
  'Las entregas que componen un certificado de recepción, con los kilos CONGELADOS. En donación el origen es municipio+comarca; el donante no se nombra (D3, impuesto por check).';
comment on column cierre_receptor_lineas.albaran_id is
  'ENT en donación, OPE en venta/maquila. Los dos cuelgan 1:1 de la canalización: sin reparto proporcional.';
comment on column cierre_receptor_lineas.productor_nom is
  'Razón social del generador, congelada. SOLO en venta y maquila: en donación es NULL por check (D3).';

create index if not exists cierre_receptor_lineas_idx
  on cierre_receptor_lineas (cierre_receptor_id);
create index if not exists cierre_receptor_lineas_canalizacion_idx
  on cierre_receptor_lineas (canalizacion_id);

-- ---------------------------------------------------------------------------
-- 3. El puente: qué certificados de recepción son de cada organización
-- ---------------------------------------------------------------------------
-- Función puente `security definer` que devuelve `setof uuid`, no un `exists`
-- correlacionado (§4bis, deuda §12.23): envuelta en `(select …)` dentro de una política se
-- evalúa una vez por consulta y no reentra en la RLS de `entidades`.
--
-- MISMA REGLA QUE `cierres_donante_meus()` Y `cierres_periodo_meus()`: los de **prueba**
-- solo si la ficha es `es_test`. Una entidad real no debe encontrarse en su panel un
-- acumulado sin ningún valor: le parecería el de verdad.
create or replace function public.cierres_receptor_meus(p_user uuid default null)
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
    raise exception 'No pots consultar els certificats d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  return query
    select cr.id
      from cierres_receptor cr
      join entidades  en on en.id = cr.entidad_id
      join membresias m  on m.entidad_id = cr.entidad_id
      join perfiles   pe on pe.id = m.user_id
     where m.user_id = v_user
       and m.activo and pe.activo
       and (cr.modo = 'real' or en.es_test);
end;
$$;

comment on function public.cierres_receptor_meus(uuid) is
  'Ids de cierres_receptor que ve una organización del usuario. Los de prueba, solo si su ficha es es_test.';

-- ---------------------------------------------------------------------------
-- 4. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- SELECT explícito (§4: sin GRANT, PostgREST responde `permission denied` ANTES de evaluar
-- RLS, y es el error más caro de diagnosticar).
grant select on cierres_receptor      to authenticated;
grant select on cierre_receptor_lineas to authenticated;

-- **Sin escritura para nadie**: todo entra por las RPC de 20270404100100. Desde
-- 20270322100100 una tabla nueva ya nace sin INSERT/UPDATE/DELETE para `authenticated`,
-- pero el `revoke` se escribe igual: es una línea que se lee en el diff, y el día que
-- alguien reponga un `alter default privileges` amplio esto lo sigue cerrando.
revoke insert, update, delete, truncate on cierres_receptor       from authenticated;
revoke insert, update, delete, truncate on cierre_receptor_lineas from authenticated;
revoke all on cierres_receptor       from anon;
revoke all on cierre_receptor_lineas from anon;

alter table cierres_receptor       enable row level security;
alter table cierre_receptor_lineas enable row level security;

drop policy if exists "certificat recepcio: intern o meu" on cierres_receptor;
create policy "certificat recepcio: intern o meu"
  on cierres_receptor for select to authenticated
  using (
       (select public.es_intern())
    or id in (select public.cierres_receptor_meus())
  );

drop policy if exists "linies recepcio: intern o meves" on cierre_receptor_lineas;
create policy "linies recepcio: intern o meves"
  on cierre_receptor_lineas for select to authenticated
  using (
       (select public.es_intern())
    or cierre_receptor_id in (select public.cierres_receptor_meus())
  );

-- ---------------------------------------------------------------------------
-- 5. `documentos` y `plantillas_documento` aprenden el tipo `CR`
-- ---------------------------------------------------------------------------
-- Son DOS checks de `tipo`, no uno, y hay que tocar los dos: `plantillas_documento.tipo`
-- comparte vocabulario con `documentos.tipo` a propósito (20260928100100), así que sembrar
-- la plantilla de abajo fallaría con `23514` si solo se ampliara uno.
--
-- ⚠️ Sin `R-CR`. Una rectificación de certificado **no consume número nuevo**: es la
--    versión siguiente del mismo `CR` y la anterior queda `vigente = false`. Es la misma
--    decisión que ya tomaron `CD`, `CDP` y `CT`; los `R-*` son solo de los albaranes.
--
-- 🔴 EL `drop constraint if exists <nombre>` A SECAS NO VALE AQUÍ, y este es el único sitio
--    del fichero donde importa. Los dos checks de `tipo` son **checks de columna**, así que
--    el nombre lo puso Postgres al crear la tabla; si por lo que sea no fuera exactamente
--    `<tabla>_tipo_check`, el `if exists` no borraría nada, el `add` de abajo tendría éxito
--    con un nombre libre, **el check viejo seguiría ahí** y `CR` se rechazaría igual — con
--    `23514` y en el momento de emitir, no aquí. Por eso se descubren por su definición: la
--    cadena `'R-REC'` solo aparece en el check de `tipo` de estas dos tablas.
--    (`documentos_objeto_tipo_check` sí se nombra directo: ese nombre lo escribió a mano
--    20270303100100, así que es seguro.)
do $$
declare
  t text;
  c text;
begin
  foreach t in array array['documentos', 'plantillas_documento'] loop
    for c in
      select con.conname
        from pg_constraint con
        join pg_class     rel on rel.oid = con.conrelid
        join pg_namespace ns  on ns.oid  = rel.relnamespace
       where ns.nspname = 'public' and rel.relname = t and con.contype = 'c'
         and pg_get_constraintdef(con.oid) like '%''R-REC''%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c);
      raise notice 'Retirado el check de tipo % de %', c, t;
    end loop;

    execute format($f$
      alter table public.%I add constraint %I check (tipo in (
        'REC', 'ENT', 'OPE',
        'R-REC', 'R-ENT', 'R-OPE',
        'CONV', 'RES', 'CD', 'CT', 'CR', 'PLA', 'PROVA'))
    $f$, t, t || '_tipo_check');
  end loop;
end $$;

-- El `objeto_tipo` es el **octavo**. Hay que tocar dos sitios: el check de la columna y el
-- trigger que sustituye a la FK que el modelo polimórfico no puede tener.
alter table documentos drop constraint if exists documentos_objeto_tipo_check;
alter table documentos add constraint documentos_objeto_tipo_check
  check (objeto_tipo in (
    'albaran', 'convenio', 'cierre_donante', 'cierre_periodo', 'cierre_receptor',
    'espigolada', 'plan', 'prova'));

-- Copia de 20270303100100 §5 con una rama más. `to_regclass` sigue resolviendo la tabla al
-- vuelo, así que esto no hay que volver a editarlo por cada fase que cree objetos nuevos:
-- solo por cada `objeto_tipo` nuevo, que es lo que estamos añadiendo.
create or replace function trg_documentos_objeto_existe()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tabla  text;
  v_existe boolean;
begin
  if new.objeto_tipo = 'prova' then
    return new;
  end if;

  v_tabla := case new.objeto_tipo
               when 'albaran'         then 'albaranes'
               when 'convenio'        then 'convenios'
               when 'cierre_donante'  then 'cierres_donante'
               when 'cierre_periodo'  then 'cierres_periodo'
               when 'cierre_receptor' then 'cierres_receptor'
               when 'espigolada'      then 'espigoladas'
               when 'plan'            then 'planes_prevencion'
             end;

  if to_regclass('public.' || v_tabla) is null then
    raise exception 'Encara no existeix la taula %: no es pot emetre cap document de tipus %',
      v_tabla, new.objeto_tipo using errcode = '0A000';
  end if;

  execute format('select exists (select 1 from public.%I where id = $1)', v_tabla)
    into v_existe using new.objeto_id;

  if not v_existe then
    raise exception 'No existeix cap % amb id %', new.objeto_tipo, new.objeto_id
      using errcode = '23503';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. ruta_documento(): la rama `cierre_receptor`
-- ---------------------------------------------------------------------------
-- Se recrea ENTERA desde su última versión (20270303100100 §6), como hicieron
-- 20261012100500, 20261109100100, 20270111100100, 20270301100200 y 20270303100100 con las
-- suyas: `create or replace` reescribe el cuerpo completo, así que copiar solo la rama
-- nueva borraría las siete anteriores.
--
-- El propietario del fichero es la **entidad receptora**, y la carpeta sale de `p_tipo`
-- (`CR`), así que el archivo queda en `entitats/<entidad_id>/<ejercicio>/CR/…`. Quien abra
-- la carpeta `CR/` de una entidad ve todos sus certificados de recepción, que es lo que se
-- quiere.
create or replace function public.ruta_documento(
  p_objeto_tipo     text,
  p_objeto_id       uuid,
  p_tipo            text,
  p_numero_completo text,
  p_version         int,
  p_modo            text,
  p_ejercicio       int
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_carpeta text;
  v_fichero text;
  v_org     text;
begin
  v_carpeta := regexp_replace(p_tipo, '^R-', '');
  v_fichero := p_numero_completo || '-v' || p_version::text || '.pdf';

  if p_tipo = 'PROVA' or p_objeto_tipo = 'prova' then
    return 'proves/' || p_ejercicio::text || '/PROVA/' || v_fichero;
  end if;

  if p_objeto_tipo = 'albaran' then
    select case a.tipo
             when 'ENT' then 'entitats/'   || c.entidad_id::text
             else            'productors/' || coalesce(e.productor_id, es.productor_id)::text
           end
      into v_org
      from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
      left join excedentes     e on e.id = a.excedente_id
      left join espigoladas   es on es.id = a.espigolada_id
     where a.id = p_objeto_id;

  elsif p_objeto_tipo = 'espigolada' then
    select 'productors/' || es.productor_id::text into v_org
      from espigoladas es where es.id = p_objeto_id;

  elsif p_objeto_tipo = 'cierre_donante' then
    -- Vale igual para el CD y para el CT: el propietario es la organización de la fila.
    select 'productors/' || cd.productor_id::text into v_org
      from cierres_donante cd where cd.id = p_objeto_id;

  elsif p_objeto_tipo = 'cierre_periodo' then
    select 'productors/' || cp.productor_id::text into v_org
      from cierres_periodo cp where cp.id = p_objeto_id;

  elsif p_objeto_tipo = 'cierre_receptor' then
    -- El único de la familia del cierre cuyo propietario es una ENTIDAD.
    select 'entitats/' || cr.entidad_id::text into v_org
      from cierres_receptor cr where cr.id = p_objeto_id;

  elsif p_objeto_tipo = 'convenio' then
    select case cv.tipo_org
             when 'productor' then 'productors/' || cv.productor_id::text
             else                  'entitats/'   || cv.entidad_id::text
           end
      into v_org
      from convenios cv where cv.id = p_objeto_id;

  elsif p_objeto_tipo = 'plan' then
    select case pl.tipo_org
             when 'productor' then 'productors/' || pl.productor_id::text
             else                  'entitats/'   || pl.entidad_id::text
           end
      into v_org
      from planes_prevencion pl where pl.id = p_objeto_id;
  end if;

  if v_org is null or v_org like '%null%' then
    raise exception
      'ruta_documento(): no es pot resoldre el propietari de % (%). Falta la taula o l''objecte no te organitzacio.',
      p_tipo, p_objeto_tipo using errcode = '0A000';
  end if;

  if p_modo = 'prueba' then
    return v_org || '/proves/' || p_ejercicio::text || '/' || v_carpeta || '/' || v_fichero;
  end if;
  return v_org || '/' || p_ejercicio::text || '/' || v_carpeta || '/' || v_fichero;
end;
$$;

comment on function public.ruta_documento(text, uuid, text, text, int, text, int) is
  'Carpeta y nombre del PDF dentro del bucket. Cubre los ocho objeto_tipo: albaran, espigolada, cierre_donante, cierre_periodo, cierre_receptor, convenio, plan y prova.';

-- ---------------------------------------------------------------------------
-- 7. documents_meus(): la entidad ve también sus certificados de recepción
-- ---------------------------------------------------------------------------
-- Se recrea entera desde 20270303100100 §7 con una rama más. `puede_ver_documento()` NO
-- hay que tocarla: delega en esta (`d.id in (select documents_meus(v_user))`), así que
-- hereda la rama sin una línea nueva.
create or replace function public.documents_meus(p_user uuid default null)
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
    raise exception 'No pots consultar els documents d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  return query
    select d.id
      from documentos d
     where (d.objeto_tipo = 'albaran'
            and d.objeto_id in (select public.albarans_de_les_meves_orgs(v_user)))
        or (d.objeto_tipo = 'cierre_donante'
            and d.objeto_id in (select public.cierres_donante_meus(v_user)))
        or (d.objeto_tipo = 'cierre_periodo'
            and d.objeto_id in (select public.cierres_periodo_meus(v_user)))
        or (d.objeto_tipo = 'cierre_receptor'
            and d.objeto_id in (select public.cierres_receptor_meus(v_user)))
        or (d.objeto_tipo = 'convenio'
            and d.objeto_id in (select public.convenios_meus(v_user)))
        or (d.objeto_tipo = 'plan'
            and d.objeto_id in (select public.planes_meus(v_user)));
end;
$$;

comment on function public.documents_meus(uuid) is
  'Ids de documentos que ve una cuenta externa: albaranes, cierres anuales (CD y CT), certificados a demanda, certificados de recepción, convenios y planes.';

-- ---------------------------------------------------------------------------
-- 8. La serie propia
-- ---------------------------------------------------------------------------
-- `CR` y su gemela de prueba `P-CR`, con los mismos 4 dígitos que el resto de
-- certificados. Se siembran **las dos** —como se hizo con `P-CT` (20270301100100) y con
-- `CDP`/`P-CDP` (20270303100100)— porque `siguiente_numero()` crearía la que falte con 5
-- dígitos, que es el default, y el número de prueba tendría otra forma que el real.
--
-- ⚠️ SERIE PROPIA, y no la del certificado del donante: son documentos distintos, para
--    destinatarios distintos, y sus correlativos no se mezclan.
insert into series_documentales (serie, ejercicio, ultimo, digitos)
select s.serie, e.ejercicio, 0, 4
  from (values ('CR'), ('P-CR')) as s(serie),
       generate_series(2026, 2030) as e(ejercicio)
on conflict (serie, ejercicio) do update set digitos = excluded.digitos;

-- ---------------------------------------------------------------------------
-- 9. La plantilla `CR`, en català y castellà
-- ---------------------------------------------------------------------------
-- ⚠️⚠️ ESTE TEXTO **NO** ESTÁ VALIDADO POR LA ASESORÍA JURÍDICA DE LA FUNDACIÓ.
--
-- Es texto de trabajo escrito por la consultoría, sembrado por el mismo motivo que las
-- seis plantillas de convenio (20270111100200) y la del certificado parcial
-- (20270303100200): sin plantilla vigente no hay forma de que el documento diga lo que es,
-- y `emetre_certificat_recepcio()` se niega a emitir sin ella.
--
-- Se marca como borrador de **tres maneras**, como allí: primer bloque en mayúsculas,
-- título con `[ESBORRANY]` (sale en el listado de plantillas del panel) y bloque final.
--
-- CÓMO SE SUSTITUYE cuando llegue el texto validado, y **no** editando estas filas (el
-- trigger `plantillas_inmutables` lo impide en cuanto hayan emitido algo):
--   1. Publicar la versión 2 desde la pantalla de plantillas.
--   2. Retirar la versión 1 (`vigente = false`). El índice parcial deja pasar solo una.
--   3. Los certificados ya emitidos **no cambian**: llevan su snapshot en `documentos.datos`.
--
-- ⚠️ `variante` va a NULL y así debe quedarse. El `CR` tiene un solo modelo, pero eso no
--    autoriza a pedir la plantilla con `tipo` e `idioma` y un `limit 1` a secas: ese es
--    exactamente el fallo que en el `CD` podía imprimir el texto del parcial en el
--    certificado anual (§4), y no da ningún error — solo se ve leyendo el PDF. Por eso
--    `recepcio_emet_document()` pide `variante is null` **explícitamente** y con
--    `order by version desc`.
--
-- ⚠️ LOS MARCADORES NO SON LIBRES: son los que `renderCr()` compondrá en su objeto
--    `valores`, con claves ASCII (el snapshot trae `raó_social` y el renderizador lo
--    traduce a `receptora.rao_social`). Un marcador que no exista ahí **no se sustituye
--    por vacío**: queda visible en el PDF y sale en `faltan`.
insert into plantillas_documento (tipo, variante, idioma, version, titulo, cuerpo, marcadores)
values

-- ===========================================================================
-- català
-- ===========================================================================
('CR', null, 'ca', 1,
 '[ESBORRANY] Certificat de recepció d''aliments',
 $json$[
  {"tipo":"p","text":"⚠️ ESBORRANY DE TREBALL — TEXT PENDENT DE VALIDACIÓ PER L'ASSESSORIA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS."},

  {"tipo":"p","text":"Que {{fundacio.rao_social}}, amb CIF {{fundacio.cif}} i domicili a {{fundacio.domicili}}, certifica que {{receptora.rao_social}}, amb NIF {{receptora.nif}} i domicili a {{receptora.domicili}}, ha rebut aliments locals fora del circuit de venda habitual durant el període comprès entre {{periode.des_de_art}} i {{periode.fins_a_art}}."},
  {"tipo":"p","text":"Que els aliments rebuts dins d'aquest període sumen {{kg}} quilos nets conciliats, dels quals {{kg_donacio}} quilos corresponen a lliuraments en concepte de donació i {{kg_compra}} quilos a operacions de compra o de transformació per maquila."},
  {"tipo":"p","text":"Que aquests quilos provenen d'operacions CONCILIADES: la quantitat certificada és la que consta als albarans de lliurament validats per les dues parts, i no una previsió ni una estimació."},

  {"tipo":"h3","text":"Procedència dels aliments"},
  {"tipo":"p","text":"Que la procedència dels aliments rebuts consta al detall adjunt a aquest certificat. En els lliuraments en concepte de DONACIÓ, la procedència s'expressa per municipi i comarca d'origen i no s'hi identifica l'organització donant, d'acord amb el compromís de confidencialitat que la Fundació manté amb les persones i empreses donants. En les operacions de COMPRA o MAQUILA, hi consta l'organització generadora, atès que és part contractant de l'operació."},

  {"tipo":"h3","text":"Abast d'aquest certificat"},
  {"tipo":"p","text":"Que aquest certificat acredita ÚNICAMENT els quilos rebuts dins del període indicat i NO recull cap import: el valor econòmic de les operacions queda registrat internament i no forma part d'aquesta acreditació."},
  {"tipo":"p","text":"Que aquest certificat NO és un certificat de donació als efectes de la Llei 49/2002 ni de cap declaració informativa tributària, i no substitueix cap document fiscal. La seva finalitat és acreditar davant de tercers el volum d'aliments aprofitats per l'entitat receptora."},

  {"tipo":"p","text":"I perquè així consti, s'expedeix aquest certificat de recepció amb número {{numero}} i codi de verificació {{codi}}."},

  {"tipo":"p","text":"⚠️ ESBORRANY DE TREBALL — TEXT PENDENT DE VALIDACIÓ PER L'ASSESSORIA JURÍDICA."}
 ]$json$::jsonb,
 array['numero','exercici','codi','kg','kg_donacio','kg_compra',
       'receptora.rao_social','receptora.nif','receptora.domicili',
       'fundacio.rao_social','fundacio.cif','fundacio.domicili',
       'periode.des_de_art','periode.fins_a_art']),

-- ===========================================================================
-- castellano
-- ===========================================================================
('CR', null, 'es', 1,
 '[BORRADOR] Certificado de recepción de alimentos',
 $json$[
  {"tipo":"p","text":"⚠️ BORRADOR DE TRABAJO — TEXTO PENDIENTE DE VALIDACIÓN POR LA ASESORÍA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS."},

  {"tipo":"p","text":"Que {{fundacio.rao_social}}, con CIF {{fundacio.cif}} y domicilio en {{fundacio.domicili}}, certifica que {{receptora.rao_social}}, con NIF {{receptora.nif}} y domicilio en {{receptora.domicili}}, ha recibido alimentos locales fuera del circuito de venta habitual durante el periodo comprendido entre {{periode.des_de_art}} y {{periode.fins_a_art}}."},
  {"tipo":"p","text":"Que los alimentos recibidos dentro de este periodo suman {{kg}} kilos netos conciliados, de los cuales {{kg_donacio}} kilos corresponden a entregas en concepto de donación y {{kg_compra}} kilos a operaciones de compra o de transformación por maquila."},
  {"tipo":"p","text":"Que estos kilos provienen de operaciones CONCILIADAS: la cantidad certificada es la que consta en los albaranes de entrega validados por ambas partes, y no una previsión ni una estimación."},

  {"tipo":"h3","text":"Procedencia de los alimentos"},
  {"tipo":"p","text":"Que la procedencia de los alimentos recibidos consta en el detalle adjunto a este certificado. En las entregas en concepto de DONACIÓN, la procedencia se expresa por municipio y comarca de origen y no se identifica en ella a la organización donante, de acuerdo con el compromiso de confidencialidad que la Fundación mantiene con las personas y empresas donantes. En las operaciones de COMPRA o MAQUILA consta la organización generadora, por ser parte contratante de la operación."},

  {"tipo":"h3","text":"Alcance de este certificado"},
  {"tipo":"p","text":"Que este certificado acredita ÚNICAMENTE los kilos recibidos dentro del periodo indicado y NO recoge ningún importe: el valor económico de las operaciones queda registrado internamente y no forma parte de esta acreditación."},
  {"tipo":"p","text":"Que este certificado NO es un certificado de donación a efectos de la Ley 49/2002 ni de ninguna declaración informativa tributaria, y no sustituye a ningún documento fiscal. Su finalidad es acreditar ante terceros el volumen de alimentos aprovechados por la entidad receptora."},

  {"tipo":"p","text":"Y para que así conste, se expide este certificado de recepción con número {{numero}} y código de verificación {{codi}}."},

  {"tipo":"p","text":"⚠️ BORRADOR DE TRABAJO — TEXTO PENDIENTE DE VALIDACIÓN POR LA ASESORÍA JURÍDICA."}
 ]$json$::jsonb,
 array['numero','exercici','codi','kg','kg_donacio','kg_compra',
       'receptora.rao_social','receptora.nif','receptora.domicili',
       'fundacio.rao_social','fundacio.cif','fundacio.domicili',
       'periode.des_de_art','periode.fins_a_art'])

on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 10. EXECUTE
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC: sin este revoke, `anon` podría preguntar
--    por los certificados de cualquiera sin tener sesión.
revoke execute on function public.cierres_receptor_meus(uuid) from public, anon;
grant  execute on function public.cierres_receptor_meus(uuid) to authenticated, service_role;

-- `ruta_documento`, `documents_meus` y `trg_documentos_objeto_existe` se recrean con
-- `create or replace` sobre la misma firma: conservan los privilegios que ya tenían y por
-- eso aquí no llevan ni GRANT ni REVOKE.

-- Verificación:
--   select has_table_privilege('authenticated','public.cierres_receptor','SELECT');  -- t
--   select has_table_privilege('authenticated','public.cierres_receptor','UPDATE');  -- f
--   select serie, ejercicio, ultimo, digitos from series_documentales where serie in ('CR','P-CR');
--   select public.ruta_documento('cierre_receptor', '<cr>', 'CR', 'CR-2026-0001', 1, 'real', 2026);
--   select tipo, variante, idioma, version, vigente, titulo from plantillas_documento where tipo = 'CR';
