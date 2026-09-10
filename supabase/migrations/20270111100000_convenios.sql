-- `convenios` y `convenios_exigidos`: el papel que habilita a operar, y cuándo hace falta.
--
-- QUÉ ES UN CONVENIO AQUÍ. La fila que dice que una organización ha aceptado —y firmado
-- electrónicamente— el marco de colaboración con la Fundació Espigoladors. Hay tres
-- modelos (§3.2.1 del plan funcional): donación del generador (`don_gen`), entidad
-- receptora (`don_rec`) y compraventa y maquila (`com`). No son tres tablas: son tres
-- valores de `tipo` sobre la misma máquina de estados, porque el ciclo de vida
-- —preparar, enviar, firmar, contrafirmar, resolver— es idéntico en los tres y lo único
-- que cambia es el texto de la plantilla y a quién se le manda.
--
-- POR QUÉ CLAVE EXCLUYENTE Y NO UNA `organizacion` ÚNICA. Es la misma decisión que tomó
-- `membresias` (20260730090000) y por el mismo motivo: la `organizacion` unificada del
-- funcional (§1bis, brecha 2) exigiría deduplicar 111 entidades sin clave común y
-- reescribir medio panel. Mientras eso no exista, un convenio cuelga de `productor_id`
-- **o** de `entidad_id`, con un check que impide que cuelgue de los dos o de ninguno, y
-- `tipo_org` dice cuál de los dos es sin tener que mirar cuál es null.
--
-- ⚠️ CONSECUENCIA QUE CONVIENE TENER PRESENTE: una organización que es a la vez
--    productor y entidad (las cuatro cuentas de doble rol, §9) necesita **dos convenios**,
--    uno por ficha, porque son dos filas distintas de dos tablas distintas. No es un
--    defecto del diseño de convenios: es la deuda §12.16 asomando otra vez.
--
-- EL CONVENIO DE COMPRAVENTA ES EL ÚNICO CON ROLES. En donación, quién entrega y quién
-- recibe está implícito en el modelo (`don_gen` lo firma quien dona, `don_rec` quien
-- recibe). En `com` una misma organización puede ser parte vendedora, compradora y
-- obrador a la vez (anexo C: «Una misma organización puede marcar varios»), y eso no cabe
-- en una columna de texto: es `roles_com text[]`.
--
-- LA MATRIZ VIVE EN UNA TABLA, NO EN UN `case`. `convenios_exigidos` es a los convenios
-- lo que `modalitat_receptor_compat` (20260730090000) es al mercado: cambiar la regla de
-- negocio —«a partir de ahora la maquila exige convenio propio del obrador»— tiene que
-- ser un `insert`, no un despliegue. Escrita a mano dentro de una función, la regla
-- estaría en dos sitios (la función y el funcional) y solo uno de los dos se actualizaría.
--
-- LO QUE ESTA MIGRACIÓN **NO** HACE, a propósito:
--   · No migra `productores.conveni` ni `entidades.estat` (decisión D del plan). Son texto
--     libre con más de cuatro valores y ninguno acredita una firma. Se enseñan como badge
--     «conveni en paper (històric)» y **no cuentan como vigente**: la campaña re-firma todo.
--   · No guarda ningún DNI. El documento de identidad de quien firma vive **solo** en
--     `evidencias.documento_identidad` (20260928100300), fuera del GRANT de SELECT. Ni
--     `convenios.firmante` ni `convenios.datos_org` lo llevan, y eso es una regla de
--     protección de datos, no una omisión: la ficha de una organización no es el sitio
--     donde guardar el DNI de una persona física.
--   · No abre ninguna superficie de escritura. `authenticated` no tiene INSERT, UPDATE ni
--     DELETE sobre `convenios`: todo pasa por las RPC de 20270111100100.

-- ---------------------------------------------------------------------------
-- 1. `plantillas_documento.variante`: tres plantillas del mismo tipo `CONV`
-- ---------------------------------------------------------------------------
-- El vocabulario de `documentos.tipo` y de `plantillas_documento.tipo` tiene **un** valor
-- para los convenios, `CONV`, y el índice parcial `plantillas_vigente_uidx (tipo, idioma)
-- where vigente` deja exactamente una plantilla vigente por idioma. Con tres modelos eso
-- no da: harían falta seis filas vigentes (3 × ca/es) y la sexta chocaría con la primera.
--
-- Dos salidas posibles y por qué se elige esta:
--   (a) Partir `CONV` en `CONV-DON-GEN`/`CONV-DON-REC`/`CONV-COM` dentro de `tipo`. Obliga
--       a tocar el check de `documentos.tipo`, el de `plantillas_documento.tipo`, la
--       carpeta de `ruta_documento()` y el vocabulario que ya conoce el renderizador. Tres
--       modelos de un mismo documento pasarían a ser tres documentos distintos, que no es
--       lo que son: el PDF se llama «conveni» en los tres casos.
--   (b) Una columna `variante`, nullable, que solo usan los convenios. El tipo sigue
--       siendo `CONV` en `documentos`, la carpeta sigue siendo `CONV/`, y lo único que
--       cambia es qué texto se elige al emitir.
--
-- Se elige (b). Los índices se recrean con `coalesce(variante,'')` para que las plantillas
-- que **no** tienen variante (REC, ENT, RES, CD, PROVA…) sigan comportándose exactamente
-- igual que antes: una vigente por (tipo, idioma).
alter table plantillas_documento
  add column if not exists variante text;

comment on column plantillas_documento.variante is
  'Modelo dentro de un mismo tipo. Solo la usan los convenios (don_gen/don_rec/com); null en el resto.';

alter table plantillas_documento drop constraint if exists plantillas_documento_variante_check;
alter table plantillas_documento add constraint plantillas_documento_variante_check
  check (variante is null or variante in ('don_gen', 'don_rec', 'com'));

-- ⚠️ Los dos índices se recrean, no se añade uno nuevo: si el viejo `(tipo, idioma) where
--    vigente` sobreviviera, seguiría prohibiendo la segunda plantilla de convenio y el
--    seed de 20270111100200 fallaría con una violación de unicidad que no diría por qué.
drop index if exists plantillas_vigente_uidx;
create unique index if not exists plantillas_vigente_uidx
  on plantillas_documento (tipo, coalesce(variante, ''), idioma) where vigente;

drop index if exists plantillas_tipo_idioma_version_uidx;
create unique index if not exists plantillas_tipo_variante_idioma_version_uidx
  on plantillas_documento (tipo, coalesce(variante, ''), idioma, version);

-- ---------------------------------------------------------------------------
-- 2. `convenios`
-- ---------------------------------------------------------------------------
create table if not exists convenios (
  id                     uuid primary key default gen_random_uuid(),

  -- Cuál de los tres modelos (§3.2.1).
  tipo                   text not null check (tipo in ('don_gen', 'don_rec', 'com')),

  -- La organización que firma, con la misma clave excluyente que `membresias`.
  tipo_org               text not null check (tipo_org in ('productor', 'entidad')),
  productor_id           uuid references productores(id) on delete cascade,
  entidad_id             uuid references entidades(id)   on delete cascade,

  -- Con qué texto se compuso. Se fija al preparar y **no puede cambiar** a partir de la
  -- firma: es lo que hace que dentro de cinco años se pueda responder «qué firmó».
  plantilla_id           uuid references plantillas_documento(id) on delete restrict,
  idioma                 text not null default 'ca' check (idioma in ('ca', 'es')),

  -- Numeración (§20260928100000). Las tres series ya están sembradas con 4 dígitos:
  -- CONV-DON-GEN, CONV-DON-REC y CONV-COM. El número se pide **al firmar**, no al
  -- preparar: un borrador que nadie firma no debe quemar un número de una serie legal.
  serie                  text,
  ejercicio              int,
  numero                 int,
  numero_completo        text unique,

  estado                 text not null default 'esborrany' check (estado in (
                           'esborrany',      -- faltan datos o falta enviarlo
                           'pendent_firma',  -- enviado, con enlace vivo
                           'firmat',         -- la organización ha firmado
                           'vigent',         -- contrafirmado por Espigoladors
                           'retornat',       -- devuelto en la contrafirma, con motivo
                           'resolt',         -- baja, con fecha de efecto
                           'substituit')),   -- lo reemplaza una versión nueva

  -- Solo en `com` (anexo C). Vocabulario cerrado por trigger, no por check de array:
  -- un check sobre `text[]` con `<@` es legible pero da un mensaje pésimo al fallar.
  roles_com              text[] not null default '{}',

  -- LA COPIA CONGELADA de los datos de la organización tal como se firmaron: razón
  -- social, NIF, domicilio, representante y cargo. Es la fuente de las versiones
  -- posteriores (contrafirma), y **nunca lleva DNI**.
  datos_org              jsonb not null default '{}'::jsonb,
  -- Quién firmó: {nombre, cargo, email}. Sin DNI (ver cabecera).
  firmante               jsonb,

  -- El enlace vivo de firma. Reenviar revoca el anterior y apunta al nuevo.
  enlace_id              uuid references enlaces_token(id) on delete set null,

  enviado_at             timestamptz,
  firmado_at             timestamptz,
  contrafirmado_at       timestamptz,
  contrafirmado_por      uuid references auth.users(id) on delete set null,

  devuelto_at            timestamptz,
  motivo_devolucion      text,

  resuelto_at            timestamptz,
  fecha_efecto_resolucion date,
  motivo_resolucion      text,

  -- Versionado del propio convenio (no del PDF): al firmar una versión nueva de la
  -- plantilla, el anterior pasa a `substituit` y apunta al que lo sustituye.
  sustituido_por         uuid references convenios(id) on delete set null,

  creado_por             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Igual que `membresias_fk_excluyente`: o productor, o entidad, nunca los dos.
  constraint convenios_fk_excluyente check (
       (tipo_org = 'productor' and productor_id is not null and entidad_id  is null)
    or (tipo_org = 'entidad'   and entidad_id   is not null and productor_id is null)),

  -- El modelo tiene que encajar con quién firma. `don_gen` lo firma quien dona (un
  -- productor); `don_rec`, quien recibe (una entidad); `com` lo pueden firmar los dos,
  -- porque la parte vendedora suele ser un productor y la compradora o el obrador, una
  -- entidad.
  constraint convenios_tipo_org_coherent check (
       (tipo = 'don_gen' and tipo_org = 'productor')
    or (tipo = 'don_rec' and tipo_org = 'entidad')
    or (tipo = 'com')),

  -- Un convenio firmado tiene número; uno en borrador, no. Que no haya estados a medias
  -- lo impone la base y no la RPC que lo escribe.
  --
  -- ⚠️ `pendent_firma` es el único estado que admite las dos cosas, y no es una laxitud:
  --    es el reenvío después de una devolución. Un convenio devuelto conserva su número
  --    (ver el trigger de transiciones) y vuelve a `pendent_firma` al reenviarlo, así que
  --    exigir aquí `numero_completo is null` haría imposible el camino
  --    `firmat → retornat → pendent_firma` que el propio funcional describe (§3.2.3).
  constraint convenios_numero_segons_estat check (
       (estado = 'esborrany' and numero_completo is null)
    or (estado = 'pendent_firma')
    or (estado in ('firmat', 'vigent', 'retornat', 'resolt', 'substituit')
        and numero_completo is not null and serie is not null and ejercicio is not null)),

  -- Devolver y resolver exigen motivo. Es el mismo criterio que `rebutjar_registre` y que
  -- `no_colocada`: una salida sin motivo es una salida que nadie puede explicar después.
  constraint convenios_motiu_devolucio check (estado <> 'retornat' or coalesce(btrim(motivo_devolucion), '') <> ''),
  constraint convenios_motiu_resolucio check (estado <> 'resolt'   or coalesce(btrim(motivo_resolucion), '') <> '')
);

comment on table convenios is
  'Convenio de colaboración de una organización, con su ciclo de firma. Escritura solo por RPC (20270111100100).';
comment on column convenios.datos_org is
  'Copia congelada de los datos con los que se firmó (razón social, NIF, domicilio, representante). NUNCA lleva DNI.';
comment on column convenios.firmante is
  '{nombre, cargo, email} de quien firmó. El DNI vive solo en evidencias.documento_identidad, fuera del GRANT.';
comment on column convenios.roles_com is
  'Solo en tipo `com`: venedora | compradora | obrador. Una organización puede marcar varios (anexo C).';
comment on column convenios.numero_completo is
  'Se pide AL FIRMAR, no al preparar: un borrador que nadie firma no quema un número de una serie legal.';

-- ---------------------------------------------------------------------------
-- 3. Índices
-- ---------------------------------------------------------------------------
-- LA REGLA DE NEGOCIO ENTERA EN UN ÍNDICE: una organización tiene **como mucho un**
-- convenio vigente de cada tipo. Es lo que impide que una contrafirma deje dos convenios
-- de donación válidos de la misma organización, que es exactamente el estado en el que
-- nadie sabría cuál de los dos rige.
create unique index if not exists convenios_vigent_uidx
  on convenios (coalesce(productor_id, entidad_id), tipo) where estado = 'vigent';

-- «Los convenios de esta organización» (la ficha) y la cola de contrafirma.
create index if not exists convenios_productor_idx on convenios (productor_id) where productor_id is not null;
create index if not exists convenios_entidad_idx   on convenios (entidad_id)   where entidad_id   is not null;

-- La tercera cola de Aprovacions. Índice parcial: lo pendiente de contrafirmar es una
-- fracción minúscula de la tabla.
create index if not exists convenios_per_contrasignar_idx
  on convenios (firmado_at) where estado = 'firmat';

-- La bandeja de la campaña: lo enviado y todavía sin firmar.
create index if not exists convenios_pendents_firma_idx
  on convenios (enviado_at) where estado = 'pendent_firma';

-- ---------------------------------------------------------------------------
-- 4. Trigger de inmutabilidad y de transiciones
-- ---------------------------------------------------------------------------
-- Un convenio firmado es un hecho. Lo que puede pasarle después es que se contrafirme,
-- que se devuelva, que se resuelva o que lo sustituya otro; nunca que cambie lo que dice.
--
-- Transiciones permitidas (§3.2.3):
--   esborrany     -> pendent_firma | resolt(no) ...  solo pendent_firma
--   pendent_firma -> firmat | esborrany            (reenviar no cambia de estado)
--   firmat        -> vigent | retornat
--   retornat      -> pendent_firma                 (se corrige y se vuelve a enviar)
--   vigent        -> resolt | substituit
--   resolt        -> (terminal)
--   substituit    -> (terminal)
--
-- ⚠️ `retornat -> pendent_firma` conserva el número. Es deliberado: la devolución no
--    anula el acto de firma, corrige un dato de la ficha (un NIF, un cargo) y vuelve a
--    pedir la firma sobre el mismo expediente. Consumir un número nuevo cada vez que la
--    apoderada detecta una errata dejaría huecos de significado en la serie.
create or replace function trg_convenios_control()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text;
begin
  -- Vocabulario de `roles_com`, aquí y no en un check, para poder decir cuál falla.
  if new.roles_com is not null then
    foreach v_rol in array new.roles_com loop
      if v_rol not in ('venedora', 'compradora', 'obrador') then
        raise exception 'Rol de compravenda desconegut: % (venedora | compradora | obrador)', v_rol
          using errcode = '22023';
      end if;
    end loop;
  end if;
  if new.tipo <> 'com' and coalesce(array_length(new.roles_com, 1), 0) > 0 then
    raise exception 'Nomes el conveni de compravenda te rols (% no en pot tenir)', new.tipo
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  -- A partir de `firmat`, la identidad y el contenido están congelados.
  if old.estado in ('firmat', 'vigent', 'retornat', 'resolt', 'substituit') then
    if new.tipo            is distinct from old.tipo
    or new.tipo_org        is distinct from old.tipo_org
    or new.productor_id    is distinct from old.productor_id
    or new.entidad_id      is distinct from old.entidad_id
    or new.plantilla_id    is distinct from old.plantilla_id
    or new.idioma          is distinct from old.idioma
    or new.serie           is distinct from old.serie
    or new.ejercicio       is distinct from old.ejercicio
    or new.numero          is distinct from old.numero
    or new.numero_completo is distinct from old.numero_completo
    or new.datos_org       is distinct from old.datos_org
    or new.firmante        is distinct from old.firmante
    or new.firmado_at      is distinct from old.firmado_at
    or new.roles_com       is distinct from old.roles_com then
      raise exception 'Un conveni firmat no es pot modificar (%). Retorna''l o substitueix-lo.',
        coalesce(old.numero_completo, old.id::text) using errcode = '42501';
    end if;
  end if;

  if new.estado is distinct from old.estado
     and not (
          (old.estado = 'esborrany'     and new.estado = 'pendent_firma')
       or (old.estado = 'pendent_firma' and new.estado in ('firmat', 'esborrany'))
       or (old.estado = 'firmat'        and new.estado in ('vigent', 'retornat'))
       or (old.estado = 'retornat'      and new.estado = 'pendent_firma')
       or (old.estado = 'vigent'        and new.estado in ('resolt', 'substituit'))) then
    raise exception 'Transicio d''estat no permesa en un conveni: % -> %', old.estado, new.estado
      using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists convenios_control on convenios;
create trigger convenios_control
  before insert or update on convenios
  for each row execute function trg_convenios_control();

-- Un convenio con número no se borra: se resuelve o se sustituye. Un borrador sí, porque
-- todavía no es nada —la campaña genera borradores en tandas y alguno se descarta—.
create or replace function trg_convenios_no_esborrar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.numero_completo is not null then
    raise exception 'El conveni % te numero: resol-lo o substitueix-lo, no l''esborris.',
      old.numero_completo using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists convenios_no_esborrar on convenios;
create trigger convenios_no_esborrar
  before delete on convenios
  for each row execute function trg_convenios_no_esborrar();

-- ---------------------------------------------------------------------------
-- 5. `convenios_exigidos`: la matriz de §3.2.2, en tabla
-- ---------------------------------------------------------------------------
-- Misma forma y mismo motivo que `modalitat_receptor_compat` (20260730090000): cambiar la
-- regla de negocio es un `insert`/`delete`, no un despliegue.
--
-- `parte` distingue quién entrega y quién recibe **de la operación**, no del convenio: en
-- una donación la parte que entrega necesita `don_gen` y la que recibe `don_rec`; en venta
-- y en maquila las dos necesitan el mismo `com`.
--
-- La clave incluye `tipo_convenio` a propósito, aunque hoy cada (valorización, parte)
-- tenga uno solo: el día que una maquila exija además un anexo del obrador, la regla es
-- una fila más y no un cambio de esquema.
create table if not exists convenios_exigidos (
  valorizacion  text not null check (valorizacion  in ('donacio', 'venda', 'maquila')),
  parte         text not null check (parte         in ('entrega', 'recibe')),
  tipo_convenio text not null check (tipo_convenio in ('don_gen', 'don_rec', 'com')),
  primary key (valorizacion, parte, tipo_convenio)
);

comment on table convenios_exigidos is
  'Qué convenio exige cada operación (§3.2.2). En tabla, como modalitat_receptor_compat: cambiar la regla es un insert.';

insert into convenios_exigidos (valorizacion, parte, tipo_convenio) values
  ('donacio', 'entrega', 'don_gen'),
  ('donacio', 'recibe',  'don_rec'),
  ('venda',   'entrega', 'com'),
  ('venda',   'recibe',  'com'),
  ('maquila', 'entrega', 'com'),
  ('maquila', 'recibe',  'com')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- SELECT explícito (una tabla nueva sin GRANT responde `permission denied` ANTES de
-- evaluar RLS, §4). **Sin ningún GRANT de escritura**, ni para el equipo: un convenio
-- nace, se firma y se contrafirma dentro de la transacción de una RPC, porque cada uno de
-- esos actos mueve a la vez el convenio, un enlace, una evidencia y un documento. Desde
-- el navegador no hay forma de garantizar eso.
grant select on convenios          to authenticated;
grant select on convenios_exigidos to authenticated;

alter table convenios          enable row level security;
alter table convenios_exigidos enable row level security;

-- El equipo lo ve todo; una organización ve **los suyos**. No hace falta ninguna función
-- puente aquí (§A del plan, deuda §12.23): `convenios` referencia `productores` y
-- `entidades` por columna propia, así que la política compara uuid contra uuid y los dos
-- helpers van envueltos en `(select …)` para que el planner los evalúe una vez por
-- consulta. Ningún `exists` correlacionado, ninguna reentrada en otra política.
drop policy if exists "convenis: intern o meus" on convenios;
create policy "convenis: intern o meus"
  on convenios for select to authenticated
  using (
       (select public.es_intern())
    or productor_id in (select public.mis_productores())
    or entidad_id   in (select public.mis_entidades())
  );

-- La matriz es catálogo, como `modalitat_receptor_compat` y `productos`: la lee cualquier
-- cuenta con sesión. Es la regla, no un dato de nadie, y la pantalla del panel externo la
-- necesita para poder explicar «per operar en venda et cal el conveni de compravenda».
drop policy if exists "convenis exigits: catalogo legible" on convenios_exigidos;
create policy "convenis exigits: catalogo legible"
  on convenios_exigidos for select to authenticated
  using (true);

-- Verificación:
--   select has_table_privilege('authenticated','public.convenios','SELECT');  -- t
--   select has_table_privilege('authenticated','public.convenios','INSERT');  -- f
--   select * from convenios_exigidos order by valorizacion, parte;
--   select tipo, coalesce(variante,'—'), idioma, version, vigente from plantillas_documento order by 1,2,3;
