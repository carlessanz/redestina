-- El certificado de donación **a demanda**: su tabla y su sitio en el circuito documental.
--
-- QUÉ RESUELVE. Hoy un donante solo recibe su certificado cuando se cierra el ejercicio.
-- El administrador tiene que poder emitirle uno **a fecha de hoy** —o a una fecha de corte
-- dada— en cualquier momento del año: una organización que dona en marzo y lo necesita
-- para su consejo, una auditoría, un convenio que pide justificar lo entregado hasta la
-- fecha.
--
-- POR QUÉ UNA TABLA HERMANA Y NO UNA FILA MÁS EN `cierres_donante`. Se consideró el patrón
-- del CT (un discriminador en la misma tabla) y no encaja, por dos cosas concretas:
--   · `cierres_donante.cierre_id` es `not null` y apunta a `cierres_ejercicio`, de donde
--     salen el **modo** y el ejercicio. Un certificado a demanda **no abre un cierre**, y
--     menos el real: `cierres_ejercicio_real_uidx` garantiza que solo haya uno por año, y
--     esa garantía no se toca.
--   · Un donante puede pedir **varios** certificados parciales en el mismo año (marzo,
--     julio, octubre). `unique (cierre_id, productor_id, tipo)` deja uno.
-- Relajar esa clave rompería `datos_182()`, el reinicio de prueba y la bandeja. Así que
-- tabla propia, y del motor documental se hereda todo lo demás: `ruta_documento()`,
-- `documents_meus()`, `puede_ver_documento()`, la inmutabilidad de `documentos` y —esto es
-- lo importante— **el renderizador del PDF, sin tocar una línea**.
--
-- EL PDF NO SE TOCA, Y ESE ERA EL REQUISITO. `_shared/pdf/render/cd.ts` ya imprime un
-- **periodo** (`periode.des_de` / `periode.fins_a`): lo único que estaba cableado al año
-- natural era quien componía el snapshot. Por eso el documento se emite con
-- `documentos.tipo = 'CD'` —que es lo que elige el renderizador— y lo que lo distingue es
-- la **serie** (`CDP`, con su `P-CDP` de prueba) y el `objeto_tipo`. Un certificado a
-- demanda es un certificado de donación de otro alcance, no otro documento.
--
-- ⚠️ Y EL ALCANCE TIENE QUE SALIR IMPRESO. Un certificado a fecha intermedia acredita lo
--    entregado hasta esa fecha, **no cubre el año natural y no sirve para el modelo 182**.
--    Eso va en el **cuerpo** del documento, no como marca de agua: no es un borrador, es
--    un documento válido de otra cosa. El texto entra por `plantillas_documento` con la
--    variante `parcial` (20270303100200), que es el único camino que tiene el
--    renderizador para imprimir prosa distinta sin cambiar de código.

-- ---------------------------------------------------------------------------
-- 1. cierres_periodo: una fila por certificado a demanda
-- ---------------------------------------------------------------------------
create table if not exists cierres_periodo (
  id                     uuid primary key default gen_random_uuid(),
  productor_id           uuid not null references productores(id),

  -- La ventana certificada, cerrada por los dos lados y **dentro de un solo año natural**:
  -- la serie y el valor por kilo son por ejercicio, y un certificado a caballo de dos
  -- años no sabría a cuál pertenece. Lo impone el check de abajo, no un comentario.
  periodo_desde          date not null,
  periodo_hasta          date not null,
  ejercicio              int  not null check (ejercicio between 2020 and 2100),

  -- Vive en el dato, como en `cierres_ejercicio`: decide serie `P-`, marca de agua y
  -- destinatarios. Independiente de `app_settings.test_mode`.
  modo                   text not null default 'prueba' check (modo in ('prueba', 'real')),

  -- Copia congelada de la ficha fiscal en el momento del cálculo.
  datos_fiscales         jsonb,

  kg_total               numeric not null default 0,
  valor_total            numeric not null default 0,

  -- Mismo vocabulario que `cierres_donante`, menos los estados del 182 —un parcial no se
  -- declara— y más `substituit`, que es lo que le pasa cuando llega el certificado anual.
  estado                 text not null default 'calculat' check (estado in (
                           'calculat', 'factura_rebuda', 'coincident', 'discrepancia',
                           'certificat_emes', 'enviat', 'substituit')),

  -- [{codigo, detall, bloqueja}], igual que en el cierre anual.
  bloqueos               jsonb not null default '[]'::jsonb,

  certificado_numero     text,
  certificado_at         timestamptz,
  rectificaciones        int  not null default 0,

  -- La factura del donante que ampara el periodo. El importe del certificado **siempre**
  -- es `valor_total`; esto se cita y tiene que coincidir a 2 decimales (misma regla que el
  -- anual, §3.5.1).
  factura_numero         text,
  factura_fecha          date,
  factura_importe        numeric,
  factura_doc_externo_id uuid references documentos_externos(id) on delete set null,

  -- La excepción de D4, idéntica a la del anual: solo `super_admin` y con motivo.
  excepcion_sin_factura  boolean not null default false,
  excepcion_motivo       text,
  excepcion_por          uuid references auth.users(id) on delete set null,

  -- Cuando se emite el certificado ANUAL del mismo donante y ejercicio, este parcial deja
  -- de ser vigente y apunta a quien lo sustituye. Es la regla de no-doble-conteo, en la
  -- base y no en una pantalla.
  cierre_donante_id      uuid references cierres_donante(id) on delete set null,
  sustituido_at          timestamptz,

  calculado_at           timestamptz,
  enviado_at             timestamptz,
  creado_por             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),

  constraint cierres_periodo_ventana_check check (periodo_desde <= periodo_hasta),
  -- ⚠️ El nombre NO puede ser `cierres_periodo_ejercicio_check`: ese lo genera Postgres
  --    solo para el `check` de columna de `ejercicio`, y dos constraints no comparten
  --    nombre en la misma tabla.
  constraint cierres_periodo_any_natural_check check (
    extract(year from periodo_desde)::int = ejercicio
    and extract(year from periodo_hasta)::int = ejercicio)
);

comment on table cierres_periodo is
  'Certificado de donación a demanda: el acumulado de un donante en una ventana de fechas dentro de un ejercicio.';
comment on column cierres_periodo.modo is
  'real | prueba. Decide la serie (CDP / P-CDP), la marca de agua y el destinatario.';
comment on column cierres_periodo.bloqueos is
  'Array [{codigo, detall, bloqueja}]. Con algún bloqueja=true, emitir_certificado_periodo() se niega.';
comment on column cierres_periodo.cierre_donante_id is
  'El acumulado ANUAL que sustituyó a este parcial. El anual manda: solo él va al modelo 182.';

-- Un solo borrador por donante y ventana: recalcular la misma ventana actualiza la fila,
-- no crea una segunda. Los ya numerados quedan fuera del índice y se acumulan, que es lo
-- que se quiere (son el histórico).
create unique index if not exists cierres_periodo_esborrany_uidx
  on cierres_periodo (productor_id, modo, periodo_desde, periodo_hasta)
  where certificado_numero is null;

create index if not exists cierres_periodo_productor_idx
  on cierres_periodo (productor_id, ejercicio, periodo_hasta desc);
create index if not exists cierres_periodo_estado_idx
  on cierres_periodo (estado, modo);

-- ---------------------------------------------------------------------------
-- 2. cierre_periodo_lineas: el detalle que sostiene la cifra
-- ---------------------------------------------------------------------------
-- Gemela de `cierre_donante_lineas`, y por el mismo motivo: sin esto, «3.412 kg» sería un
-- número sin nada detrás, y un certificado se tiene que poder regenerar idéntico dentro
-- de cinco años.
create table if not exists cierre_periodo_lineas (
  id                uuid primary key default gen_random_uuid(),
  cierre_periodo_id uuid not null references cierres_periodo(id) on delete cascade,
  canalizacion_id   uuid not null references canalizaciones(id),
  albaran_rec_id    uuid references albaranes(id),

  producto          text,
  mes               int check (mes between 1 and 12),
  kg_neto           numeric not null default 0,
  coste_kg          numeric,
  valor             numeric not null default 0,
  entidad_id        uuid references entidades(id) on delete set null,
  retroactiva       boolean not null default false,
  -- El excedente del que sale esta línea lo parte la ventana: sus kilos son una PARTE del
  -- neto del albarán de recepción (20270303100000). Se congela aquí para que el motivo
  -- del bloqueo siga siendo legible dentro de cinco años.
  excedente_partido boolean not null default false,
  created_at        timestamptz not null default now(),

  unique (cierre_periodo_id, canalizacion_id)
);

comment on table cierre_periodo_lineas is
  'Las canalizaciones que componen un certificado a demanda, con kilos y coste CONGELADOS.';

create index if not exists cierre_periodo_lineas_idx
  on cierre_periodo_lineas (cierre_periodo_id);
create index if not exists cierre_periodo_lineas_canalizacion_idx
  on cierre_periodo_lineas (canalizacion_id);

-- ---------------------------------------------------------------------------
-- 3. El puente: qué certificados a demanda son de cada organización
-- ---------------------------------------------------------------------------
-- Función puente `security definer` que devuelve `setof uuid`, no un `exists`
-- correlacionado (§A, deuda §12.23). Misma regla que `cierres_donante_meus()`: los de
-- **prueba** solo si la ficha es `es_test`, para que un donante real no se encuentre en su
-- panel un acumulado sin ningún valor fiscal.
create or replace function public.cierres_periodo_meus(p_user uuid default null)
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
    select cp.id
      from cierres_periodo cp
      join productores pr on pr.id = cp.productor_id
      join membresias  m  on m.productor_id = cp.productor_id
      join perfiles    pe on pe.id = m.user_id
     where m.user_id = v_user
       and m.activo and pe.activo
       and (cp.modo = 'real' or pr.es_test);
end;
$$;

comment on function public.cierres_periodo_meus(uuid) is
  'Ids de cierres_periodo que ve una organización del usuario. Los de prueba, solo si su ficha es es_test.';

-- ---------------------------------------------------------------------------
-- 4. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- SELECT explícito (§4: sin GRANT, PostgREST responde `permission denied` antes de
-- evaluar RLS). **Sin INSERT/UPDATE/DELETE para nadie**: todo entra por las RPC de
-- 20270303100300, como en `cierres_donante`.
grant select on cierres_periodo       to authenticated;
grant select on cierre_periodo_lineas to authenticated;

alter table cierres_periodo       enable row level security;
alter table cierre_periodo_lineas enable row level security;

drop policy if exists "certificat periode: intern o meu" on cierres_periodo;
create policy "certificat periode: intern o meu"
  on cierres_periodo for select to authenticated
  using (
       (select public.es_intern())
    or id in (select public.cierres_periodo_meus())
  );

drop policy if exists "linies periode: intern o meves" on cierre_periodo_lineas;
create policy "linies periode: intern o meves"
  on cierre_periodo_lineas for select to authenticated
  using (
       (select public.es_intern())
    or cierre_periodo_id in (select public.cierres_periodo_meus())
  );

-- ---------------------------------------------------------------------------
-- 5. `documentos` acepta el nuevo objeto
-- ---------------------------------------------------------------------------
-- El `objeto_tipo` es nuevo de verdad —los seis que había se declararon en
-- 20260928100200 y ninguna fase posterior necesitó ampliarlos—, así que hay que tocar dos
-- sitios: el check de la columna y el trigger que sustituye a la FK que el modelo
-- polimórfico no puede tener.
alter table documentos drop constraint if exists documentos_objeto_tipo_check;
alter table documentos add constraint documentos_objeto_tipo_check
  check (objeto_tipo in (
    'albaran', 'convenio', 'cierre_donante', 'cierre_periodo',
    'espigolada', 'plan', 'prova'));

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
               when 'albaran'        then 'albaranes'
               when 'convenio'       then 'convenios'
               when 'cierre_donante' then 'cierres_donante'
               when 'cierre_periodo' then 'cierres_periodo'
               when 'espigolada'     then 'espigoladas'
               when 'plan'           then 'planes_prevencion'
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
-- 6. ruta_documento(): la rama `cierre_periodo`
-- ---------------------------------------------------------------------------
-- Se recrea entera, como hicieron 20261012100500, 20261109100100, 20270111100100 y
-- 20270301100200 con las suyas. El propietario del fichero es el **donante**, y la carpeta
-- sale de `p_tipo`: como el certificado a demanda se emite con `tipo = 'CD'`, se archiva
-- junto a los certificados anuales de esa misma organización y se distingue por el número
-- (`CDP-2026-0001`). Es lo correcto: quien abra la carpeta `CD/` de un donante quiere ver
-- todos sus certificados.
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
  'Carpeta y nombre del PDF dentro del bucket. Cubre los siete objeto_tipo: albaran, espigolada, cierre_donante, cierre_periodo, convenio, plan y prova.';

-- ---------------------------------------------------------------------------
-- 7. documents_meus(): el donante ve también sus certificados a demanda
-- ---------------------------------------------------------------------------
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
        or (d.objeto_tipo = 'convenio'
            and d.objeto_id in (select public.convenios_meus(v_user)))
        or (d.objeto_tipo = 'plan'
            and d.objeto_id in (select public.planes_meus(v_user)));
end;
$$;

comment on function public.documents_meus(uuid) is
  'Ids de documentos que ve una cuenta externa: albaranes, cierres anuales (CD y CT), certificados a demanda, convenios y planes.';

-- ---------------------------------------------------------------------------
-- 8. La serie propia
-- ---------------------------------------------------------------------------
-- `CDP` y su gemela de prueba, con los mismos 4 dígitos que `CD`. Se siembran las dos
-- —como se hizo con `P-CT` (20270301100100)— porque `siguiente_numero()` crearía la que
-- falte con 5 dígitos, que es el default, y el número de prueba tendría otra forma que el
-- real.
--
-- ⚠️ SERIE PROPIA, no la de `CD`. Compartirla haría que un certificado parcial de marzo
--    consumiera un número de la serie con la que se certifica el ejercicio: los números
--    del 182 tienen que ser correlativos y solo del cierre anual.
insert into series_documentales (serie, ejercicio, ultimo, digitos)
select s.serie, e.ejercicio, 0, 4
  from (values ('CDP'), ('P-CDP')) as s(serie),
       generate_series(2026, 2030) as e(ejercicio)
on conflict (serie, ejercicio) do update set digitos = excluded.digitos;

-- ---------------------------------------------------------------------------
-- 9. El guardián de `cierres_donante` aprende el prefijo nuevo
-- ---------------------------------------------------------------------------
-- `trg_cierres_donante_tipo` (20270301100100) exige que el número de una fila `donacio`
-- empiece por `CD-` o `P-CD-`. Un `CDP-2026-0001` **no** casa con ese patrón, así que ya
-- saltaba; lo que no hacía era decir por qué. Se extiende en la dirección segura: el
-- número de un certificado a demanda se rechaza con su propio mensaje, que nombra la tabla
-- a la que pertenece. Nadie debe poder colar un parcial en la fila del cierre anual: es
-- exactamente el doble conteo que este diseño evita.
create or replace function trg_cierres_donante_tipo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- El certificado a demanda tiene tabla propia (`cierres_periodo`) y serie propia.
  if new.certificado_numero is not null and new.certificado_numero ~ '^(P-)?CDP-' then
    raise exception 'El numero % es d''un certificat a demanda: viu a cierres_periodo, no en un tancament anual',
      new.certificado_numero using errcode = '22023';
  end if;

  if new.tipo = 'transaccio' then
    if new.resumen_numero is not null then
      raise exception 'Un certificat de transaccio no te resum anual: no hi ha factura a demanar'
        using errcode = '22023';
    end if;
    if new.factura_numero is not null or new.factura_importe is not null
       or new.factura_doc_externo_id is not null or new.excepcion_sin_factura then
      raise exception 'Un certificat de transaccio no cita cap factura (el pagament es tramita fora)'
        using errcode = '22023';
    end if;
    if new.certificado_numero is not null
       and new.certificado_numero !~ '^(P-)?CT-' then
      raise exception 'El numero % no es de la serie CT: aquesta fila es de transaccio',
        new.certificado_numero using errcode = '22023';
    end if;
  else
    if new.certificado_numero is not null
       and new.certificado_numero !~ '^(P-)?CD-' then
      raise exception 'El numero % no es de la serie CD: aquesta fila es de donacio',
        new.certificado_numero using errcode = '22023';
    end if;
  end if;

  -- El tipo es la identidad de la fila: no se cambia nunca.
  if tg_op = 'UPDATE' and new.tipo is distinct from old.tipo then
    raise exception 'El tipus d''un acumulat anual no es pot canviar (% -> %)', old.tipo, new.tipo
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. `plantillas_documento.variante` admite `parcial`
-- ---------------------------------------------------------------------------
-- La columna nació para los tres modelos de convenio (20270111100000). Aquí hace el mismo
-- trabajo: dos textos vigentes del tipo `CD`, el del certificado anual y el del parcial,
-- que el índice `(tipo, coalesce(variante,''), idioma) where vigente` ya sabe distinguir.
alter table plantillas_documento drop constraint if exists plantillas_documento_variante_check;
alter table plantillas_documento add constraint plantillas_documento_variante_check
  check (variante is null or variante in ('don_gen', 'don_rec', 'com', 'parcial'));

-- ---------------------------------------------------------------------------
-- 11. ⚠️ `cierre_emet_document()` tiene que pedir la plantilla SIN variante
-- ---------------------------------------------------------------------------
-- Buscaba la plantilla con `tipo = p_tipo and idioma = … and vigente limit 1`, sin mirar
-- la variante, porque hasta hoy ningún tipo del cierre tenía ninguna. En cuanto se siembra
-- la variante `parcial` del `CD` (20270303100200) hay **dos** plantillas vigentes de tipo
-- `CD`, y ese `limit 1` sin `order by` elegiría cualquiera de las dos: el certificado
-- ANUAL podría salir impreso con el texto del parcial —el que dice que no sirve para el
-- 182—. Es el tipo de fallo que no da ningún error y solo se ve leyendo el PDF.
create or replace function public.cierre_emet_document(
  p_cd      uuid,
  p_tipo    text,
  p_subtipo text,
  p_datos   jsonb,
  p_envio   jsonb default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd       cierres_donante%rowtype;
  ce       cierres_ejercicio%rowtype;
  v_num    text;
  v_serie  text;
  v_ver    int;
  v_previo uuid;
  v_id     uuid;
  v_idioma text;
begin
  select * into cd from cierres_donante where id = p_cd;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;

  v_num   := case p_tipo when 'RES' then cd.resumen_numero else cd.certificado_numero end;
  v_serie := case when ce.modo = 'prueba' then 'P-' else '' end || p_tipo;

  -- El idioma del documento sale del perfil del titular si existe (decisión D del plan).
  select coalesce(pe.idioma, 'ca') into v_idioma
    from membresias m join perfiles pe on pe.id = m.user_id
   where m.productor_id = cd.productor_id and m.activo and m.rol_org = 'titular'
   order by m.created_at limit 1;

  select id, version into v_previo, v_ver
    from documentos
   where objeto_tipo = 'cierre_donante' and objeto_id = p_cd and tipo = p_tipo and vigente;

  if v_previo is not null then
    update documentos set vigente = false where id = v_previo;
  end if;

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos, ruta, envio, emitido_por
  ) values (
    p_tipo, p_subtipo, 'cierre_donante', p_cd,
    v_num, coalesce(v_ver, 0) + 1, v_serie, ce.ejercicio,
    ce.modo, coalesce(v_idioma, 'ca'),
    (select p.id from plantillas_documento p
      where p.tipo = p_tipo and p.idioma = coalesce(v_idioma, 'ca')
        and p.variante is null and p.vigente limit 1),
    p_datos,
    encode(sha256(convert_to(p_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('cierre_donante', p_cd, p_tipo, v_num,
                          coalesce(v_ver, 0) + 1, ce.modo, ce.ejercicio),
    p_envio,
    auth.uid()
  ) returning id into v_id;

  if v_previo is not null then
    update documentos set sustituido_por = v_id where id = v_previo;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. EXECUTE
-- ---------------------------------------------------------------------------
revoke execute on function public.cierres_periodo_meus(uuid) from public, anon;
grant  execute on function public.cierres_periodo_meus(uuid) to authenticated, service_role;

-- `ruta_documento`, `documents_meus` y `cierre_emet_document` se recrean con
-- `create or replace`: conservan los privilegios que ya tenían.

-- Verificación:
--   select has_table_privilege('authenticated','public.cierres_periodo','SELECT');  -- t
--   select has_table_privilege('authenticated','public.cierres_periodo','UPDATE');  -- f
--   select serie, ejercicio, ultimo, digitos from series_documentales where serie like '%CDP';
