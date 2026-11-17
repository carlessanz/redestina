-- =============================================================================
-- Punto 3, fase D1 (17-11-2026): PRECIOS DE REFERENCIA por producto, año y mes, con carga
-- automática desde Gencat («Preus percebuts pel pagès») y Mercabarna («Estadístiques
-- diàries»), validación del equipo y alta de productos.
-- =============================================================================
--
-- Lo que hace esta migración:
--   1. `productos` gana `preu_manual` (sin fuente: el precio va a mano) y `nombre_es` (el
--      nombre en castellano, para casar con Mercabarna).
--   2. `preus_fonts_estat`: una fila por fuente con la URL (editable: el fichero de Gencat
--      lleva el rango de años en el nombre y cambiará en 2027), el interruptor `automatic`,
--      el ETag/Last-Modified de la última descarga y el resultado de la última comprobación.
--   3. `preus_carregues`: cada descarga (el fichero original, en el bucket privado
--      `preus-fonts`, sin políticas), con su huella, su fecha en la fuente y su estado
--      `pendent` · `validada` · `descartada`. Idempotente: mismo fichero (sha256) o, en
--      Mercabarna, mismo día = no hay carga nueva.
--   4. `preus_observats`: lo leído de cada carga (valor original, unidad y €/kg).
--   5. `productes_fonts`: las equivalencias producto ↔ nombre en la fuente (varias por
--      producto), con una SIEMBRA de las coincidencias claras que el equipo revisa.
--   6. `preus_referencia`: el precio VALIDADO, uno por producto, ejercicio y mes, con su
--      fuente; `preus_referencia_hist` guarda lo sustituido con el motivo (trigger).
--   7. RPC de lectura (`es_intern()`): `preus_proposta_mes`, `noms_fonts_preus`.
--      RPC de escritura (`pot_aprovar()`): `validar_preus_mes`, `validar_preus_periode`,
--      `fixar_preu_referencia`, `afegir_equivalencia_preu`, `treure_equivalencia_preu`,
--      `fixar_preu_manual`, `crear_producte`, `marcar_carrega_preus`; `fixar_font_preus`
--      (super_admin). Internas: `registrar_carrega_preus` (la Edge Function `preus-fonts`),
--      `preus_calcula_mes`, `preus_desa_mes` y `preu_referencia_de` (para la D2).
--   8. `pg_cron`: `preus-gencat` y `preus-mercabarna`, una vez al día, por `pg_net` con el
--      secreto de los documentos (`app_config.documentos_secret`, como `recollides-programades`).
--   9. `pendents_equip()`: cola nueva `preus` (cargas de Gencat por revisar + fuentes con error).
--
-- 🔴 PRECEDENCIA al proponer el precio de un mes (por producto): si el producto es
--    `preu_manual`, el manual vigente (`costes_producto`); si no, Gencat de ese mes → media
--    de los días de Mercabarna de ese mes → manual vigente. Varias equivalencias en la misma
--    fuente = media de sus valores. El equipo puede cambiar la fuente o el precio con motivo.
--
-- 🔴 NO SE TOCA LA VALORACIÓN (eso es la D2): `canalizaciones.coste_kg` sigue saliendo de la
--    oferta o de `costes_producto`. `preu_referencia_de()` deja el contrato listo.
--
-- Compatible hacia atrás: tablas y funciones nuevas; `productos` gana dos columnas con
-- valor por defecto. Idempotente.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Productos: precio manual y nombre en castellano
-- ---------------------------------------------------------------------------
alter table public.productos add column if not exists preu_manual boolean not null default false;
alter table public.productos add column if not exists nombre_es text;
comment on column public.productos.preu_manual is
  'Sin fuente de precios (Gencat/Mercabarna): el precio de cada mes es el manual vigente de costes_producto (20270531100000).';
comment on column public.productos.nombre_es is
  'Nombre en castellano (opcional), para proponer equivalencias con Mercabarna (20270531100000).';

-- ---------------------------------------------------------------------------
-- 2. Estado y configuración de cada fuente
-- ---------------------------------------------------------------------------
create table if not exists public.preus_fonts_estat (
  font                   text primary key check (font in ('gencat', 'mercabarna')),
  url                    text not null,
  automatic              boolean not null default true,
  etag                   text,
  last_modified          text,
  darrera_comprovacio_at timestamptz,
  darrer_resultat        text check (darrer_resultat in ('nou', 'sense_canvis', 'duplicat', 'error')),
  darrer_error           text,
  darrera_carrega_at     timestamptz,
  actualitzat_per        uuid references auth.users(id) on delete set null,
  updated_at             timestamptz not null default now()
);
comment on table public.preus_fonts_estat is
  'Una fila por fuente de precios: URL, interruptor del job (fail-closed: sin fila o sin true, el job no descarga) y última comprobación (20270531100000).';

insert into public.preus_fonts_estat (font, url) values
  ('gencat', 'https://agricultura.gencat.cat/web/.content/de_departament/de02_estadistiques_observatoris/20_observatori_agroalimentari_de_preus/03_preus/01_preus_en_origen/02_preus_percebuts_pel_pages/arxius_estatics_nous/Plantilla_Preus_percebuts2020_2026_20.xls'),
  ('mercabarna', 'https://www.mercabarna.es/serveis/es_estadistiques-diaries/')
on conflict (font) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Cargas
-- ---------------------------------------------------------------------------
create table if not exists public.preus_carregues (
  id            uuid primary key default gen_random_uuid(),
  font          text not null check (font in ('gencat', 'mercabarna')),
  url           text,
  fitxer_path   text,
  fitxer_nom    text,
  mime          text,
  mida_bytes    integer,
  sha256        text not null,
  etag          text,
  last_modified text,
  -- Gencat: el día del Last-Modified del fichero. Mercabarna: el día que dice la página.
  data_font     date,
  -- El último mes con datos (Gencat va con retraso: el del 12-11-2026 llega a septiembre).
  periode_fins  date,
  files         integer not null default 0,
  productes     integer not null default 0,
  estat         text not null default 'pendent' check (estat in ('pendent', 'validada', 'descartada')),
  origen        text not null default 'job' check (origen in ('job', 'manual')),
  creada_per    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  revisada_per  uuid references auth.users(id) on delete set null,
  revisada_at   timestamptz,
  motiu         text
);
create unique index if not exists preus_carregues_sha on public.preus_carregues (font, sha256);
create unique index if not exists preus_carregues_dia_mercabarna on public.preus_carregues (font, data_font)
  where font = 'mercabarna';
create index if not exists preus_carregues_recents on public.preus_carregues (font, created_at desc);
comment on table public.preus_carregues is
  'Cada descarga de una fuente de precios, con el fichero original en el bucket privado preus-fonts (20270531100000).';

-- ---------------------------------------------------------------------------
-- 4. Lo observado en cada carga
-- ---------------------------------------------------------------------------
create table if not exists public.preus_observats (
  id             bigint generated always as identity primary key,
  carrega_id     uuid not null references public.preus_carregues(id) on delete cascade,
  font           text not null check (font in ('gencat', 'mercabarna')),
  codi_font      text,
  nom_font       text not null,
  exercici       integer not null check (exercici between 2000 and 2100),
  mes            integer not null check (mes between 1 and 12),
  dia            integer check (dia between 1 and 31),
  valor_original numeric not null,
  unitat         text not null,
  -- null = unidad que no es de peso (€/unitat, €/100 litres…): se guarda y no se usa.
  eur_kg         numeric,
  valor_max      numeric,
  valor_min      numeric
);
create unique index if not exists preus_observats_unic on public.preus_observats
  (carrega_id, coalesce(codi_font, ''), nom_font, exercici, mes, coalesce(dia, 0));
create index if not exists preus_observats_mes on public.preus_observats (font, exercici, mes);
comment on table public.preus_observats is
  'Lo leído de cada carga de precios: valor y unidad originales y €/kg cuando la unidad es de peso (20270531100000).';

-- ---------------------------------------------------------------------------
-- 5. Equivalencias producto ↔ fuente
-- ---------------------------------------------------------------------------
create table if not exists public.productes_fonts (
  id         uuid primary key default gen_random_uuid(),
  producto   text not null references public.productos(nombre) on update cascade on delete cascade,
  font       text not null check (font in ('gencat', 'mercabarna')),
  -- Gencat: el código de la fila (estable aunque cambie el nombre). Mercabarna: null.
  codi_font  text,
  nom_font   text not null check (btrim(nom_font) <> ''),
  origen     text not null default 'equip' check (origen in ('sembra', 'equip')),
  creat_per  uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists productes_fonts_unic on public.productes_fonts (producto, font, upper(nom_font));
create index if not exists productes_fonts_font on public.productes_fonts (font, upper(nom_font));
comment on table public.productes_fonts is
  'Equivalencias producto Redestina ↔ nombre (y código) en una fuente de precios; varias por producto = media (20270531100000).';

-- ---------------------------------------------------------------------------
-- 6. Precio de referencia validado (uno por producto, ejercicio y mes) + historial
-- ---------------------------------------------------------------------------
create table if not exists public.preus_referencia (
  producto        text not null references public.productos(nombre) on update cascade,
  exercici        integer not null check (exercici between 2000 and 2100),
  mes             integer not null check (mes between 1 and 12),
  eur_kg          numeric(12, 4) not null check (eur_kg > 0),
  font            text not null check (font in ('gencat', 'mercabarna', 'manual')),
  font_nom        text,
  font_dies       integer,
  -- Lo que proponía la fuente elegida al validar (si el equipo lo cambió, se ve la diferencia).
  proposta_eur_kg numeric(12, 4),
  carrega_id      uuid references public.preus_carregues(id) on delete set null,
  motiu           text,
  validat_per     uuid references auth.users(id) on delete set null,
  validat_at      timestamptz not null default now(),
  primary key (producto, exercici, mes)
);
create index if not exists preus_referencia_mes on public.preus_referencia (exercici, mes);
comment on table public.preus_referencia is
  'Precio de referencia VALIDADO por producto, ejercicio y mes, con su fuente. Nunca se sobrescribe sin rastro: preus_referencia_hist (20270531100000).';

create table if not exists public.preus_referencia_hist (
  id              bigint generated always as identity primary key,
  producto        text not null,
  exercici        integer not null,
  mes             integer not null,
  eur_kg          numeric(12, 4) not null,
  font            text not null,
  font_nom        text,
  font_dies       integer,
  proposta_eur_kg numeric(12, 4),
  carrega_id      uuid,
  motiu           text,
  validat_per     uuid references auth.users(id) on delete set null,
  validat_at      timestamptz,
  substituit_per  uuid references auth.users(id) on delete set null,
  substituit_at   timestamptz not null default now(),
  motiu_canvi     text
);
create index if not exists preus_referencia_hist_idx on public.preus_referencia_hist (producto, exercici, mes, substituit_at desc);

create or replace function public.trg_preus_referencia_hist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into preus_referencia_hist (producto, exercici, mes, eur_kg, font, font_nom, font_dies,
                                     proposta_eur_kg, carrega_id, motiu, validat_per, validat_at,
                                     substituit_per, motiu_canvi)
  values (old.producto, old.exercici, old.mes, old.eur_kg, old.font, old.font_nom, old.font_dies,
          old.proposta_eur_kg, old.carrega_id, old.motiu, old.validat_per, old.validat_at,
          auth.uid(), case when tg_op = 'DELETE' then '[esborrat]' else new.motiu end);
  return coalesce(new, old);
end;
$$;
revoke execute on function public.trg_preus_referencia_hist() from public, anon, authenticated;

-- Solo cuando cambia el precio o la fuente: el traspaso de autoría de una cuenta del equipo
-- (`validat_per`) reescribe filas y no es un cambio de precio.
drop trigger if exists preus_referencia_hist_upd on public.preus_referencia;
create trigger preus_referencia_hist_upd
  after update of eur_kg, font on public.preus_referencia
  for each row
  when (old.eur_kg is distinct from new.eur_kg or old.font is distinct from new.font)
  execute function public.trg_preus_referencia_hist();
drop trigger if exists preus_referencia_hist_del on public.preus_referencia;
create trigger preus_referencia_hist_del
  after delete on public.preus_referencia
  for each row execute function public.trg_preus_referencia_hist();

-- ---------------------------------------------------------------------------
-- RLS + GRANT: lectura solo del equipo; nadie escribe directo (todo por RPC)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['preus_fonts_estat', 'preus_carregues', 'preus_observats',
                           'productes_fonts', 'preus_referencia', 'preus_referencia_hist'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || ': lectura equip', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.es_intern()))',
                   t || ': lectura equip', t);
  end loop;
end $$;

-- El bucket del fichero original: privado y SIN políticas (lo sirve `preus-fonts` con una URL
-- firmada al equipo). 20 MB: el XLS de Gencat ronda los 300 KB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('preus-fonts', 'preus-fonts', false, 20971520,
        array['application/vnd.ms-excel', 'application/octet-stream', 'text/html'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 5bis. Siembra de equivalencias (coincidencias claras; el equipo las revisa)
-- ---------------------------------------------------------------------------
-- Gencat, por código (los nombres de las filas pueden cambiar; el código no).
insert into public.productes_fonts (producto, font, codi_font, nom_font, origen)
select v.producto, 'gencat', v.codi, v.nom, 'sembra'
  from (values
    ('Arròs', '002000', 'Arròs'),
    ('Taronja', '051115', 'Taronja grup Navel'),
    ('Mandarina', '051200', 'Mandarina'),
    ('Poma', '052111', 'Poma consum en fresc'),
    ('Pera', '052211', 'Pera consum en fresc'),
    ('Albercoc', '052311', 'Albercoc consum en fresc'),
    ('Nectarina', '052410', 'Préssec tipus Nectarina'),
    ('Préssec', '052499', 'Préssec consum en fresc'),
    ('Cirera', '052500', 'Cirera'),
    ('Pruna', '052600', 'Pruna'),
    ('Figa', '052701', 'Figues i figaflor'),
    ('Maduixa', '052900', 'Maduixot'),
    ('Ametlla', '053100', 'Ametlla'),
    ('Avellana', '053200', 'Avellana Negreta'),
    ('Enciam', '054010', 'Enciam'),
    ('Escarola', '054015', 'Escarola'),
    ('Coliflor', '054020', 'Coliflor'),
    ('Col', '054030', 'Col cabdellada'),
    ('Tomàquet', '054049', 'Tomàquet per consum en fresc'),
    ('Pèsol', '054061', 'Pèsol verd (consum en fresc)'),
    ('Ceba', '054070', 'Ceba'),
    ('Porro', '054085', 'Porro'),
    ('Carxofa', '054105', 'Carxofa per a consum en fresc'),
    ('Carbassó', '054135', 'Carbassó'),
    ('Fava', '054150', 'Fava tendra'),
    ('Mongeta', '054165', 'Mongeta tendra per consum en fresc'),
    ('Espinac', '054170', 'Espinacs'),
    ('Albergínia', '054190', 'Albergínia'),
    ('Bleda', '054210', 'Bledes')
  ) as v(producto, codi, nom)
  join public.productos p on p.nombre = v.producto
on conflict (producto, font, upper(nom_font)) do nothing;

-- Mercabarna, por nombre (en mayúsculas y en castellano, sin los espacios del final).
insert into public.productes_fonts (producto, font, nom_font, origen)
select v.producto, 'mercabarna', v.nom, 'sembra'
  from (values
    ('Olives', 'ACEITUNAS'), ('Bleda', 'ACELGAS'), ('Alvocat', 'AGUACATE'), ('All', 'AJOS SECOS'),
    ('Albercoc', 'ALBARICOQUES'), ('Carxofa', 'ALCACHOFA'), ('Ametlla', 'ALMENDRAS'), ('Api', 'APIOS'),
    ('Avellana', 'AVELLANAS'), ('Moniato', 'BATATA'), ('Moniato', 'BATATA MONIATO'),
    ('Albergínia', 'BERENJENA LARGA'), ('Albergínia', 'BERENJENA REDONDA'),
    ('Bròquil', 'BRÓCULI'), ('Bròquil', 'BRÉCOL'), ('Brócoli', 'BRÓCULI'), ('Brócoli', 'BRÉCOL'),
    ('Carbassó', 'CALABACÍN'), ('Carbassa', 'CALABAZA'), ('Calçot', 'CALÇOTS'), ('Kaki', 'CAQUIS'),
    ('Card', 'CARDOS'), ('Ceba', 'CEBOLLA SECA'), ('Cirera', 'CEREZAS'), ('Xampinyó', 'CHAMPIÑONES'),
    ('Xirimoia', 'CHIRIMOIA'), ('Xirivia', 'CHIRIVÍA'), ('Pruna', 'CIRUELA'), ('Coco', 'COCOS'),
    ('Col de Brussel·les', 'COL BRUSELAS'), ('Col', 'COLES'), ('Coliflor', 'COLIFLOR'),
    ('Escarola', 'ESCAROLA'), ('Espàrrec', 'ESPÁRRAGO VERDE'), ('Espàrrec', 'ESPÁRRAGO BLANCO'),
    ('Espinac', 'ESPINACAS'), ('Gerd', 'FRAMBUESA'), ('Maduixa', 'FRESA'), ('Maduixa', 'FRESÓN'),
    ('Bolet', 'SETAS SIN DETERMINAR'), ('Magrana', 'GRANADAS'), ('Pèsol', 'GUISANTE'), ('Fava', 'HABAS'),
    ('Figa', 'HIGOS'), ('Fonoll', 'HINOJO'), ('Mongeta', 'JUDÍA BOBI'), ('Mongeta', 'JUDÍA FINA'),
    ('Mongeta', 'JUDÍA PERONA'), ('Mongeta', 'JUDÍAS SIN DETERMINAR'), ('Kiwi', 'KIWIS'),
    ('Enciam', 'LECHUGA ICEBERG'), ('Enciam', 'LECHUGA LARGA'), ('Enciam', 'LECHUGA SIN DETERMINAR'),
    ('Llima', 'LIMA'), ('Llimona', 'LIMÓN'), ('Blat de moro', 'MAÍZ'),
    ('Mandarina', 'MANDARINA CLEMENTINA'), ('Mandarina', 'MANDARINA SATSUMA'), ('Mandarina', 'MANDARINAS SIN DETER.'),
    ('Mango', 'MANGOS'), ('Poma', 'MANZANA AMARILLA GOLDEN'), ('Poma', 'MANZANA BICOLOR'),
    ('Poma', 'MANZANA ROJA'), ('Poma', 'MANZANA VERDE GRANNY SMITH'), ('Poma', 'MANZANAS SIN DETERMINAR'),
    ('Préssec', 'MELOCOTÓN AMARILLO'), ('Préssec', 'MELOCOTÓN ROJO P.BLANCA'), ('Préssec', 'MELOCOTONES ROJOS P.AMARILLA'),
    ('Meló', 'MELÓN AMARILLO'), ('Meló', 'MELÓN GALIA'), ('Meló', 'MELÓN SIN DETERMINAR'),
    ('Meló', 'MELÓN VERDE PIEL DE SAPO'), ('Codony', 'MEMBRILLO'), ('Mores', 'MORA'), ('Nap', 'NABO'),
    ('Taronja', 'NARANJA'), ('Nectarina', 'NECTARINA PULPA AMARILLA'), ('Nectarina', 'NECTARINA PULPA BLANCA'),
    ('Nespre', 'NÍSPERO'), ('Nous', 'NUECES'), ('Patata', 'PATATA BLANCA CALIDAD MONA LISA'),
    ('Patata', 'PATATA ROJA'), ('Patata', 'PATATA TEMPRANA'), ('Cogombre', 'PEPINO'),
    ('Pera', 'PERA BLANQUILLA'), ('Pera', 'PERA DE INVIERNO'), ('Pera', 'PERA DE VERANO'), ('Pera', 'PERA TEMPRANA'),
    ('Julivert', 'PEREJIL'), ('Pebrot', 'PIMIENTO LAMUYO'), ('Pebrot', 'PIMIENTO ROJO'),
    ('Pebrot', 'PIMIENTO VERDE ITALIANO'), ('Pinya', 'PIÑA TROPICAL'), ('Plàtan', 'PLÁTANOS CANARIOS'),
    ('Plàtan', 'PLÁTANOS IMPORTACIÓN'), ('Porro', 'PUERROS'), ('Rave', 'RÁBANOS'), ('Remolatxa', 'REMOLACHA'),
    ('Sindria', 'SANDÍA CON GRANA'), ('Sindria', 'SANDÍA SIN GRANA'), ('Tomàquet', 'TOMATE MADURO'),
    ('Tomàquet', 'TOMATE VERDE'), ('Raim', 'UVA BLANCA'), ('Raim', 'UVA NEGRA'), ('Pastanaga', 'ZANAHORIA')
  ) as v(producto, nom)
  join public.productos p on p.nombre = v.producto
on conflict (producto, font, upper(nom_font)) do nothing;

-- ---------------------------------------------------------------------------
-- 7a. Interna: lo que dicen las fuentes de un mes, por producto
-- ---------------------------------------------------------------------------
-- Gencat: de cada fila (código), el valor de la carga MÁS RECIENTE no descartada que tenga
-- ese mes (un fichero nuevo puede revisar meses anteriores). Mercabarna: todos los días del
-- mes de cargas no descartadas. Varias equivalencias = media.
create or replace function public.preus_fonts_mes(p_exercici integer, p_mes integer)
returns table(producto text, font text, eur_kg numeric, noms text, dies integer, carrega_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with g_obs as (
    select distinct on (o.codi_font, o.nom_font)
           o.codi_font, o.nom_font, o.eur_kg, o.carrega_id
      from preus_observats o
      join preus_carregues c on c.id = o.carrega_id
     where c.font = 'gencat' and c.estat <> 'descartada'
       and o.exercici = p_exercici and o.mes = p_mes and o.eur_kg is not null and o.eur_kg > 0
     order by o.codi_font, o.nom_font, c.created_at desc, o.id desc
  ),
  g as (
    select pf.producto, 'gencat'::text as font, round(avg(go.eur_kg), 4) as eur_kg,
           string_agg(distinct go.nom_font, ' · ') as noms, null::integer as dies,
           (array_agg(go.carrega_id))[1] as carrega_id
      from productes_fonts pf
      join g_obs go
        on case when pf.codi_font is not null then pf.codi_font = go.codi_font
                else upper(pf.nom_font) = upper(go.nom_font) end
     where pf.font = 'gencat'
     group by pf.producto
  ),
  m as (
    select pf.producto, 'mercabarna'::text as font, round(avg(o.eur_kg), 4) as eur_kg,
           string_agg(distinct o.nom_font, ' · ') as noms, count(distinct o.dia)::integer as dies,
           null::uuid as carrega_id
      from productes_fonts pf
      join preus_observats o on o.font = 'mercabarna' and upper(o.nom_font) = upper(pf.nom_font)
      join preus_carregues c on c.id = o.carrega_id and c.estat <> 'descartada'
     where pf.font = 'mercabarna'
       and o.exercici = p_exercici and o.mes = p_mes and o.eur_kg is not null and o.eur_kg > 0
     group by pf.producto
  )
  select * from g
  union all
  select * from m;
$$;
revoke execute on function public.preus_fonts_mes(integer, integer) from public, anon, authenticated;
grant execute on function public.preus_fonts_mes(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7b. Interna: la propuesta de un mes para TODOS los productos del catálogo
-- ---------------------------------------------------------------------------
create or replace function public.preus_calcula_mes(p_exercici integer, p_mes integer)
returns table(
  producto text, familia text, preu_manual boolean, equivalencies integer,
  gencat_eur_kg numeric, gencat_nom text, gencat_carrega uuid,
  mercabarna_eur_kg numeric, mercabarna_nom text, mercabarna_dies integer,
  manual_eur_kg numeric,
  proposta_font text, proposta_eur_kg numeric,
  validat_eur_kg numeric, validat_font text, validat_nom text, validat_dies integer,
  validat_motiu text, validat_at timestamptz, validat_proposta numeric,
  anterior_eur_kg numeric, anterior_exercici integer, anterior_mes integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with f as (select * from public.preus_fonts_mes(p_exercici, p_mes))
  select p.nombre, p.familia, p.preu_manual,
         (select count(*)::integer from productes_fonts pf where pf.producto = p.nombre),
         g.eur_kg, g.noms, g.carrega_id,
         m.eur_kg, m.noms, m.dies,
         cp.coste_kg,
         case when p.preu_manual then case when cp.coste_kg is not null then 'manual' end
              when g.eur_kg is not null then 'gencat'
              when m.eur_kg is not null then 'mercabarna'
              when cp.coste_kg is not null then 'manual' end,
         case when p.preu_manual then cp.coste_kg
              else coalesce(g.eur_kg, m.eur_kg, cp.coste_kg) end,
         r.eur_kg, r.font, r.font_nom, r.font_dies, r.motiu, r.validat_at, r.proposta_eur_kg,
         a.eur_kg, a.exercici, a.mes
    from productos p
    left join f g on g.producto = p.nombre and g.font = 'gencat'
    left join f m on m.producto = p.nombre and m.font = 'mercabarna'
    left join costes_producto cp on cp.producto = p.nombre
    left join preus_referencia r on r.producto = p.nombre and r.exercici = p_exercici and r.mes = p_mes
    left join lateral (
      select ra.eur_kg, ra.exercici, ra.mes
        from preus_referencia ra
       where ra.producto = p.nombre
         and (ra.exercici < p_exercici or (ra.exercici = p_exercici and ra.mes < p_mes))
       order by ra.exercici desc, ra.mes desc
       limit 1) a on true
   where p.nombre <> 'RETORN'
   order by p.familia nulls last, p.nombre;
$$;
revoke execute on function public.preus_calcula_mes(integer, integer) from public, anon, authenticated;
grant execute on function public.preus_calcula_mes(integer, integer) to service_role;

-- La guarda del mes: válido y no futuro (en hora de Madrid).
create or replace function public.preus_comprova_mes(p_exercici integer, p_mes integer)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_avui date := (now() at time zone 'Europe/Madrid')::date;
begin
  if p_exercici is null or p_mes is null or p_mes not between 1 and 12 or p_exercici not between 2000 and 2100 then
    raise exception 'mes_invalid' using errcode = '22023';
  end if;
  if make_date(p_exercici, p_mes, 1) > date_trunc('month', v_avui)::date then
    raise exception 'mes_futur' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.preus_comprova_mes(integer, integer) from public, anon, authenticated;
grant execute on function public.preus_comprova_mes(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7c. Lectura del equipo: la propuesta de un mes
-- ---------------------------------------------------------------------------
create or replace function public.preus_proposta_mes(p_exercici integer, p_mes integer)
returns table(
  producto text, familia text, preu_manual boolean, equivalencies integer,
  gencat_eur_kg numeric, gencat_nom text, gencat_carrega uuid,
  mercabarna_eur_kg numeric, mercabarna_nom text, mercabarna_dies integer,
  manual_eur_kg numeric,
  proposta_font text, proposta_eur_kg numeric,
  validat_eur_kg numeric, validat_font text, validat_nom text, validat_dies integer,
  validat_motiu text, validat_at timestamptz, validat_proposta numeric,
  anterior_eur_kg numeric, anterior_exercici integer, anterior_mes integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta els preus de referencia' using errcode = '42501';
  end if;
  if p_mes is null or p_mes not between 1 and 12 or p_exercici is null or p_exercici not between 2000 and 2100 then
    raise exception 'mes_invalid' using errcode = '22023';
  end if;
  return query select * from public.preus_calcula_mes(p_exercici, p_mes);
end;
$$;
revoke execute on function public.preus_proposta_mes(integer, integer) from public, anon;
grant execute on function public.preus_proposta_mes(integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7d. Interna: guardar un mes (todo lo que tenga propuesta y aún no esté validado, más los
--     cambios explícitos del equipo)
-- ---------------------------------------------------------------------------
-- `p_canvis`: [{producto, font?, eur_kg?, motiu?}]. Un cambio que se aparta de la propuesta
-- (otra fuente u otro precio) o que toca un mes ya validado exige motivo.
create or replace function public.preus_desa_mes(p_exercici integer, p_mes integer, p_canvis jsonb,
                                                 p_nomes_canvis boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  c jsonb;
  v_canvis jsonb := coalesce(p_canvis, '[]'::jsonb);
  v_font text;
  v_preu numeric;
  v_motiu text;
  v_nom text;
  v_dies integer;
  v_carrega uuid;
  v_proposta numeric;
  n_nous integer := 0;
  n_canvis integer := 0;
  n_sense integer := 0;
  v_falta text;
begin
  perform public.preus_comprova_mes(p_exercici, p_mes);
  if jsonb_typeof(v_canvis) <> 'array' then
    raise exception 'canvis_invalids' using errcode = '22023';
  end if;
  select x->>'producto' into v_falta
    from jsonb_array_elements(v_canvis) x
   where not exists (select 1 from productos p where p.nombre = x->>'producto')
   limit 1;
  if found then
    raise exception 'producte_inexistent' using errcode = '22023', detail = coalesce(v_falta, '');
  end if;

  for r in select * from public.preus_calcula_mes(p_exercici, p_mes) loop
    select x into c from jsonb_array_elements(v_canvis) x where x->>'producto' = r.producto limit 1;
    if c is not null then
      v_font := coalesce(nullif(c->>'font', ''), r.proposta_font);
      if v_font is null or v_font not in ('gencat', 'mercabarna', 'manual') then
        raise exception 'font_invalida' using errcode = '22023', detail = r.producto;
      end if;
      v_proposta := case v_font when 'gencat' then r.gencat_eur_kg
                                when 'mercabarna' then r.mercabarna_eur_kg
                                else r.manual_eur_kg end;
      v_preu := coalesce((c->>'eur_kg')::numeric, v_proposta);
      if v_preu is null or v_preu <= 0 then
        raise exception 'preu_invalid' using errcode = '22023', detail = r.producto;
      end if;
      v_motiu := nullif(btrim(coalesce(c->>'motiu', '')), '');
      if v_motiu is null and (r.validat_eur_kg is not null
                              or v_font is distinct from r.proposta_font
                              or round(v_preu, 4) is distinct from round(r.proposta_eur_kg, 4)) then
        raise exception 'motiu_obligatori' using errcode = '22023', detail = r.producto;
      end if;
      v_nom := case v_font when 'gencat' then r.gencat_nom when 'mercabarna' then r.mercabarna_nom end;
      v_dies := case v_font when 'mercabarna' then r.mercabarna_dies end;
      v_carrega := case v_font when 'gencat' then r.gencat_carrega end;
      insert into preus_referencia (producto, exercici, mes, eur_kg, font, font_nom, font_dies,
                                    proposta_eur_kg, carrega_id, motiu, validat_per, validat_at)
      values (r.producto, p_exercici, p_mes, round(v_preu, 4), v_font, v_nom, v_dies,
              v_proposta, v_carrega, v_motiu, auth.uid(), now())
      on conflict (producto, exercici, mes) do update
         set eur_kg = excluded.eur_kg, font = excluded.font, font_nom = excluded.font_nom,
             font_dies = excluded.font_dies, proposta_eur_kg = excluded.proposta_eur_kg,
             carrega_id = excluded.carrega_id, motiu = excluded.motiu,
             validat_per = excluded.validat_per, validat_at = excluded.validat_at;
      if r.validat_eur_kg is null then n_nous := n_nous + 1; else n_canvis := n_canvis + 1; end if;
    elsif not p_nomes_canvis and r.validat_eur_kg is null then
      if r.proposta_eur_kg is null then
        n_sense := n_sense + 1;
      else
        insert into preus_referencia (producto, exercici, mes, eur_kg, font, font_nom, font_dies,
                                      proposta_eur_kg, carrega_id, motiu, validat_per, validat_at)
        values (r.producto, p_exercici, p_mes, round(r.proposta_eur_kg, 4), r.proposta_font,
                case r.proposta_font when 'gencat' then r.gencat_nom when 'mercabarna' then r.mercabarna_nom end,
                case r.proposta_font when 'mercabarna' then r.mercabarna_dies end,
                r.proposta_eur_kg,
                case r.proposta_font when 'gencat' then r.gencat_carrega end,
                null, auth.uid(), now())
        on conflict (producto, exercici, mes) do nothing;
        n_nous := n_nous + 1;
      end if;
    end if;
  end loop;

  -- Las cargas que han dado precio a este mes quedan revisadas.
  update preus_carregues pc
     set estat = 'validada', revisada_per = auth.uid(), revisada_at = now()
   where pc.estat = 'pendent'
     and (pc.id in (select pr.carrega_id from preus_referencia pr
                     where pr.exercici = p_exercici and pr.mes = p_mes and pr.carrega_id is not null)
          or (pc.font = 'mercabarna'
              and pc.data_font >= make_date(p_exercici, p_mes, 1)
              and pc.data_font < (make_date(p_exercici, p_mes, 1) + interval '1 month')::date
              and exists (select 1 from preus_referencia pr
                           where pr.exercici = p_exercici and pr.mes = p_mes and pr.font = 'mercabarna')));

  return jsonb_build_object('validats', n_nous, 'canviats', n_canvis, 'sense_preu', n_sense);
end;
$$;
revoke execute on function public.preus_desa_mes(integer, integer, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.preus_desa_mes(integer, integer, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 7e. Escritura del equipo (pot_aprovar)
-- ---------------------------------------------------------------------------
create or replace function public.validar_preus_mes(p_exercici integer, p_mes integer, p_canvis jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin validen els preus de referencia' using errcode = '42501';
  end if;
  return public.preus_desa_mes(p_exercici, p_mes, p_canvis, false);
end;
$$;
revoke execute on function public.validar_preus_mes(integer, integer, jsonb) from public, anon;
grant execute on function public.validar_preus_mes(integer, integer, jsonb) to authenticated, service_role;

-- En bloque: los meses de un intervalo (la carga inicial de Gencat, 2020-2026). Solo rellena
-- lo que falta; nunca cambia un precio ya validado.
create or replace function public.validar_preus_periode(p_des_exercici integer, p_des_mes integer,
                                                        p_fins_exercici integer, p_fins_mes integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mes date;
  v_fins date;
  v_r jsonb;
  n_mesos integer := 0;
  n_validats integer := 0;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin validen els preus de referencia' using errcode = '42501';
  end if;
  perform public.preus_comprova_mes(p_des_exercici, p_des_mes);
  perform public.preus_comprova_mes(p_fins_exercici, p_fins_mes);
  v_mes := make_date(p_des_exercici, p_des_mes, 1);
  v_fins := make_date(p_fins_exercici, p_fins_mes, 1);
  if v_fins < v_mes then
    raise exception 'periode_invalid' using errcode = '22023';
  end if;
  if (extract(year from age(v_fins, v_mes)) * 12 + extract(month from age(v_fins, v_mes))) >= 120 then
    raise exception 'periode_massa_llarg' using errcode = '22023';
  end if;
  while v_mes <= v_fins loop
    v_r := public.preus_desa_mes(extract(year from v_mes)::integer, extract(month from v_mes)::integer, '[]'::jsonb, false);
    n_mesos := n_mesos + 1;
    n_validats := n_validats + coalesce((v_r->>'validats')::integer, 0);
    v_mes := (v_mes + interval '1 month')::date;
  end loop;
  return jsonb_build_object('mesos', n_mesos, 'validats', n_validats);
end;
$$;
revoke execute on function public.validar_preus_periode(integer, integer, integer, integer) from public, anon;
grant execute on function public.validar_preus_periode(integer, integer, integer, integer) to authenticated, service_role;

-- Una celda: fuente o precio de un producto en un mes, siempre con motivo.
create or replace function public.fixar_preu_referencia(p_producto text, p_exercici integer, p_mes integer,
                                                        p_font text, p_eur_kg numeric, p_motiu text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin fixen els preus de referencia' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motiu), '') = '' then
    raise exception 'motiu_obligatori' using errcode = '22023';
  end if;
  if p_eur_kg is not null and p_eur_kg <= 0 then
    raise exception 'preu_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from productos where nombre = p_producto) then
    raise exception 'producte_inexistent' using errcode = '22023';
  end if;
  return public.preus_desa_mes(p_exercici, p_mes,
    jsonb_build_array(jsonb_build_object('producto', p_producto, 'font', p_font, 'eur_kg', p_eur_kg, 'motiu', p_motiu)),
    true);
end;
$$;
revoke execute on function public.fixar_preu_referencia(text, integer, integer, text, numeric, text) from public, anon;
grant execute on function public.fixar_preu_referencia(text, integer, integer, text, numeric, text) to authenticated, service_role;

create or replace function public.afegir_equivalencia_preu(p_producto text, p_font text, p_nom_font text,
                                                           p_codi_font text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_nom text := btrim(coalesce(p_nom_font, ''));
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin canvien les equivalencies de preus' using errcode = '42501';
  end if;
  if p_font is null or p_font not in ('gencat', 'mercabarna') then
    raise exception 'font_invalida' using errcode = '22023';
  end if;
  if v_nom = '' then
    raise exception 'nom_font_buit' using errcode = '22023';
  end if;
  if not exists (select 1 from productos where nombre = p_producto) then
    raise exception 'producte_inexistent' using errcode = '22023';
  end if;
  select id into v_id from productes_fonts
   where producto = p_producto and font = p_font and upper(nom_font) = upper(v_nom);
  if v_id is not null then
    return v_id;
  end if;
  insert into productes_fonts (producto, font, codi_font, nom_font, origen, creat_per)
  values (p_producto, p_font, nullif(btrim(coalesce(p_codi_font, '')), ''), v_nom, 'equip', auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.afegir_equivalencia_preu(text, text, text, text) from public, anon;
grant execute on function public.afegir_equivalencia_preu(text, text, text, text) to authenticated, service_role;

create or replace function public.treure_equivalencia_preu(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin canvien les equivalencies de preus' using errcode = '42501';
  end if;
  delete from productes_fonts where id = p_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.treure_equivalencia_preu(uuid) from public, anon;
grant execute on function public.treure_equivalencia_preu(uuid) to authenticated, service_role;

create or replace function public.fixar_preu_manual(p_producto text, p_manual boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin canvien el preu manual' using errcode = '42501';
  end if;
  if p_manual is null then
    raise exception 'valor_invalid' using errcode = '22023';
  end if;
  update productos set preu_manual = p_manual where nombre = p_producto;
  if not found then
    raise exception 'producte_inexistent' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.fixar_preu_manual(text, boolean) from public, anon;
grant execute on function public.fixar_preu_manual(text, boolean) to authenticated, service_role;

-- Alta de un producto del catálogo. Icono: el genérico de su familia hasta que alguien dibuje
-- el suyo (`scripts/icones-productes.ts`).
create or replace function public.crear_producte(p_nombre text, p_familia text, p_nombre_es text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nom text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_es text := nullif(regexp_replace(btrim(coalesce(p_nombre_es, '')), '\s+', ' ', 'g'), '');
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin donen d''alta productes' using errcode = '42501';
  end if;
  if char_length(v_nom) < 2 or char_length(v_nom) > 60 then
    raise exception 'nom_invalid' using errcode = '22023';
  end if;
  if v_es is not null and char_length(v_es) > 60 then
    raise exception 'nom_invalid' using errcode = '22023';
  end if;
  if p_familia is null or not exists (select 1 from productos where familia = p_familia) then
    raise exception 'familia_desconeguda' using errcode = '22023';
  end if;
  if exists (select 1 from productos where lower(nombre) = lower(v_nom)) then
    raise exception 'producte_existent' using errcode = '23505';
  end if;
  insert into productos (nombre, familia, nombre_es) values (v_nom, p_familia, v_es);
  return v_nom;
end;
$$;
revoke execute on function public.crear_producte(text, text, text) from public, anon;
grant execute on function public.crear_producte(text, text, text) to authenticated, service_role;

create or replace function public.marcar_carrega_preus(p_id uuid, p_estat text, p_motiu text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estat text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin revisen les carregues de preus' using errcode = '42501';
  end if;
  if p_estat is null or p_estat not in ('pendent', 'descartada') then
    raise exception 'estat_invalid' using errcode = '22023';
  end if;
  select estat into v_estat from preus_carregues where id = p_id for update;
  if v_estat is null then
    raise exception 'carrega_inexistent' using errcode = '22023';
  end if;
  if v_estat = 'validada' then
    raise exception 'carrega_validada' using errcode = '22023';
  end if;
  if p_estat = 'descartada' and coalesce(btrim(p_motiu), '') = '' then
    raise exception 'motiu_obligatori' using errcode = '22023';
  end if;
  update preus_carregues
     set estat = p_estat, revisada_per = auth.uid(), revisada_at = now(),
         motiu = nullif(btrim(coalesce(p_motiu, '')), '')
   where id = p_id;
end;
$$;
revoke execute on function public.marcar_carrega_preus(uuid, text, text) from public, anon;
grant execute on function public.marcar_carrega_preus(uuid, text, text) to authenticated, service_role;

-- La URL y el interruptor de una fuente: solo el super_admin (como los demás interruptores).
-- La URL tiene que ser del dominio de su fuente: la Edge Function la descarga con la clave de
-- servicio, y no puede apuntar a cualquier sitio.
create or replace function public.fixar_font_preus(p_font text, p_automatic boolean, p_url text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin configura les fonts de preus' using errcode = '42501';
  end if;
  if p_font is null or p_font not in ('gencat', 'mercabarna') then
    raise exception 'font_invalida' using errcode = '22023';
  end if;
  if v_url is not null and not (
       (p_font = 'gencat' and v_url like 'https://agricultura.gencat.cat/%')
    or (p_font = 'mercabarna' and v_url like 'https://www.mercabarna.es/%')) then
    raise exception 'url_invalida' using errcode = '22023';
  end if;
  update preus_fonts_estat
     set automatic = coalesce(p_automatic, automatic),
         url = coalesce(v_url, url),
         -- Una URL nueva es otro fichero: la petición condicional empieza de cero.
         etag = case when v_url is not null and v_url <> url then null else etag end,
         last_modified = case when v_url is not null and v_url <> url then null else last_modified end,
         actualitzat_per = auth.uid(), updated_at = now()
   where font = p_font;
end;
$$;
revoke execute on function public.fixar_font_preus(text, boolean, text) from public, anon;
grant execute on function public.fixar_font_preus(text, boolean, text) to authenticated, service_role;

-- Los nombres vistos en las últimas cargas (para proponer equivalencias): de Gencat, la última
-- carga no descartada (solo filas con €/kg); de Mercabarna, los últimos 90 días.
create or replace function public.noms_fonts_preus()
returns table(font text, codi_font text, nom_font text, unitat text, productes text[])
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta les fonts de preus' using errcode = '42501';
  end if;
  return query
  with ult_g as (
    select c.id from preus_carregues c
     where c.font = 'gencat' and c.estat <> 'descartada'
     order by c.created_at desc limit 1
  ),
  noms as (
    select distinct 'gencat'::text as f, o.codi_font as codi, o.nom_font as nom, o.unitat as u
      from preus_observats o
     where o.carrega_id in (select id from ult_g) and o.eur_kg is not null
    union
    select distinct 'mercabarna', null::text, o.nom_font, o.unitat
      from preus_observats o
      join preus_carregues c on c.id = o.carrega_id
     where c.font = 'mercabarna' and c.estat <> 'descartada'
       and c.data_font >= (now() at time zone 'Europe/Madrid')::date - 90
  )
  select n.f, n.codi, n.nom, n.u,
         coalesce((select array_agg(pf.producto order by pf.producto) from productes_fonts pf
                    where pf.font = n.f and upper(pf.nom_font) = upper(n.nom)), '{}'::text[])
    from noms n
   order by n.f, n.nom;
end;
$$;
revoke execute on function public.noms_fonts_preus() from public, anon;
grant execute on function public.noms_fonts_preus() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7f. Interna: registrar una carga (la llama `preus-fonts` con la clave de servicio)
-- ---------------------------------------------------------------------------
-- Devuelve el id de la carga nueva, o null si ya existía (mismo fichero, o mismo día de
-- Mercabarna): idempotente.
create or replace function public.registrar_carrega_preus(p_font text, p_meta jsonb, p_observats jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_data date := nullif(p_meta->>'data_font', '')::date;
begin
  if p_font is null or p_font not in ('gencat', 'mercabarna') then
    raise exception 'font_invalida' using errcode = '22023';
  end if;
  if coalesce(p_meta->>'sha256', '') = '' then
    raise exception 'sha256_obligatori' using errcode = '22023';
  end if;
  if exists (select 1 from preus_carregues where font = p_font and sha256 = p_meta->>'sha256')
     or (p_font = 'mercabarna' and exists (select 1 from preus_carregues
                                            where font = 'mercabarna' and data_font = v_data)) then
    return null;
  end if;
  insert into preus_carregues (font, url, fitxer_path, fitxer_nom, mime, mida_bytes, sha256, etag,
                               last_modified, data_font, periode_fins, origen, creada_per)
  values (p_font, p_meta->>'url', p_meta->>'fitxer_path', p_meta->>'fitxer_nom', p_meta->>'mime',
          nullif(p_meta->>'mida_bytes', '')::integer, p_meta->>'sha256', p_meta->>'etag',
          p_meta->>'last_modified', v_data, nullif(p_meta->>'periode_fins', '')::date,
          coalesce(nullif(p_meta->>'origen', ''), 'job'), nullif(p_meta->>'creada_per', '')::uuid)
  returning id into v_id;

  insert into preus_observats (carrega_id, font, codi_font, nom_font, exercici, mes, dia,
                               valor_original, unitat, eur_kg, valor_max, valor_min)
  select v_id, p_font, nullif(o.codi_font, ''), btrim(o.nom_font), o.exercici, o.mes, o.dia,
         o.valor_original, o.unitat, o.eur_kg, o.valor_max, o.valor_min
    from jsonb_to_recordset(coalesce(p_observats, '[]'::jsonb)) as o(
           codi_font text, nom_font text, exercici integer, mes integer, dia integer,
           valor_original numeric, unitat text, eur_kg numeric, valor_max numeric, valor_min numeric)
   where btrim(coalesce(o.nom_font, '')) <> ''
  on conflict do nothing;

  update preus_carregues c
     set files = (select count(*) from preus_observats o where o.carrega_id = v_id),
         productes = (select count(distinct (coalesce(o.codi_font, ''), o.nom_font))
                        from preus_observats o where o.carrega_id = v_id)
   where c.id = v_id;
  return v_id;
end;
$$;
revoke execute on function public.registrar_carrega_preus(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_carrega_preus(text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 7g. Para la D2: el precio de referencia de un producto en una fecha
-- ---------------------------------------------------------------------------
-- Contrato (context/04, «Precios de referencia»):
--   · `validat`: el validado de ese mes (provisional = false);
--   · `anterior`: si no lo hay, el último validado ANTERIOR, con provisional = true y su mes;
--   · `manual`: si tampoco, el manual vigente (`costes_producto`); provisional = false si el
--     producto es `preu_manual` (es su precio de verdad), true si no (falta validar su fuente);
--   · sin ninguno, cero filas.
-- Interna (sin EXECUTE para `authenticated`): la llamarán los triggers `security definer` de
-- la D2; el equipo ve lo mismo en `preus_proposta_mes`.
create or replace function public.preu_referencia_de(p_producto text, p_data date)
returns table(eur_kg numeric, font text, exercici integer, mes integer, provisional boolean, origen text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_e integer := extract(year from p_data)::integer;
  v_m integer := extract(month from p_data)::integer;
begin
  if p_producto is null or p_data is null then
    return;
  end if;
  return query
    select r.eur_kg::numeric, r.font, r.exercici, r.mes, false, 'validat'::text
      from preus_referencia r
     where r.producto = p_producto and r.exercici = v_e and r.mes = v_m;
  if found then return; end if;

  return query
    select r.eur_kg::numeric, r.font, r.exercici, r.mes, true, 'anterior'::text
      from preus_referencia r
     where r.producto = p_producto
       and (r.exercici < v_e or (r.exercici = v_e and r.mes < v_m))
     order by r.exercici desc, r.mes desc
     limit 1;
  if found then return; end if;

  return query
    select cp.coste_kg::numeric, 'manual'::text, null::integer, null::integer, not p.preu_manual, 'manual'::text
      from costes_producto cp
      join productos p on p.nombre = cp.producto
     where cp.producto = p_producto;
end;
$$;
revoke execute on function public.preu_referencia_de(text, date) from public, anon, authenticated;
grant execute on function public.preu_referencia_de(text, date) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Los jobs: una vez al día cada fuente, por pg_net (mismo secreto que los documentos)
-- ---------------------------------------------------------------------------
create or replace function public.disparar_preus_fonts(p_accio text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  secreto text;
begin
  if p_accio is null or p_accio not in ('gencat', 'mercabarna') then
    raise exception 'accio_invalida' using errcode = '22023';
  end if;
  select value into secreto from app_config where key = 'documentos_secret';
  if secreto is null or secreto = '' then
    raise notice 'preus-fonts: sense secret configurat, no-op.';
    return;
  end if;
  perform net.http_post(
    url     := public.url_funciones() || '/preus-fonts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-documentos-secret', secreto),
    body    := jsonb_build_object('accio', p_accio),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function public.disparar_preus_fonts(text) from public, anon, authenticated;
grant execute on function public.disparar_preus_fonts(text) to service_role;

do $$
begin
  perform cron.unschedule('preus-gencat') where exists (select 1 from cron.job where jobname = 'preus-gencat');
  perform cron.unschedule('preus-mercabarna') where exists (select 1 from cron.job where jobname = 'preus-mercabarna');
exception when others then null;
end $$;
-- Gencat: la petición condicional (If-None-Match) es barata; si no ha cambiado, no descarga.
select cron.schedule('preus-gencat', '20 6 * * *', $$select public.disparar_preus_fonts('gencat')$$);
-- Mercabarna: la página solo enseña el día anterior; a media mañana ya está.
select cron.schedule('preus-mercabarna', '15 10 * * *', $$select public.disparar_preus_fonts('mercabarna')$$);


-- ---------------------------------------------------------------------------
-- 9. pendents_equip(): cola `preus`
-- ---------------------------------------------------------------------------
-- Cuerpo de 20270510100200 letra por letra, más la rama 14. Misma firma (`returns table`
-- no cambia), así que `create or replace` basta y conserva los GRANT.
CREATE OR REPLACE FUNCTION public.pendents_equip()
 RETURNS TABLE(cua text, n integer, ref uuid, detall jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la cua de treball' using errcode = '42501';
  end if;

  return query
  with param as (
    select extract(year from (now() at time zone 'Europe/Madrid'))::int as any_curs,
           (now() at time zone 'Europe/Madrid')::date                   as avui
  ),
  tanc as (
    select ci.id, ci.ejercicio, ci.modo, ci.estado
      from cierres_ejercicio ci
     where ci.estado in ('obert', 'provisional')
     order by ci.abierto_at desc, ci.created_at desc
     limit 1
  ),
  -- Canalizaciones cuya recogida es ya trabajo del EQUIPO (20270427100000): no anuladas, sin
  -- registrar por el receptor, y con la recogida pasada —que es justo cuando
  -- `programar_albarans_recollida()` le pide al receptor que la registre; si no tiene panel,
  -- la registra el equipo con `confirmar_recollida()`— o, sin hora acordada (a esas el job no
  -- les avisa nunca), con más de 2 días.
  canal_equip as (
    select c.id, c.excedente_id
      from canalizaciones c
     where c.estado <> 'anulada'
       and c.recollida_registrada_at is null
       and c.recollida_validada_at is null
       -- 20270428100000: una que un admin acaba de retornar espera otra vez al receptor.
       and (c.recollida_retornada_at is null or c.recollida_retornada_at < now() - interval '2 days')
       and (c.data_hora_recollida <= now()
            or (c.data_hora_recollida is null and c.created_at < now() - interval '2 days'))
  ),
  cues as (
    -- ⚠️ Las columnas del CTE NO se llaman `cua`, `n`, `ref` ni `detall`: esos cuatro
    --    nombres son los parámetros OUT de la función, y en plpgsql un identificador que
    --    coincide con una variable se sustituye por ella. `return query` casa por
    --    POSICIÓN, así que llamarlas distinto no cuesta nada y elimina la ambigüedad.
    select 1::numeric as ordre, 'registres'::text as clau,
           (select count(*) from membresias m where m.aprovacio = 'pendent')::int as quants,
           null::uuid as objecte, null::jsonb as extra
    union all
    select 2, 'convenis_contrasignar',
           (select count(*) from convenios cv where cv.estado = 'firmat')::int, null, null
    union all
    -- NUEVA (05-10-2026). Ofertas que esperan a que el equipo las valide antes de salir al
    -- Mercat (`excedentes_validacio`). Va entre los convenios y las respuestas porque es lo
    -- primero que le pasa a una oferta, y el orden de esta lista es el orden del proceso.
    -- Es la cifra del badge de «Ofertes»: no baja al entrar en la sección, solo al validar o
    -- rechazar, porque la oferta se queda parada hasta que alguien decide.
    select 2.5, 'ofertes_per_validar',
           (select count(*) from excedentes e where e.estado = 'pendent_validacio')::int,
           null, null
    union all
    select 3, 'respostes',
           (select count(*) from oferta_respuestas r
             where r.estado = 'acceptada' and r.aprovacio = 'pendent')::int, null, null
    union all
    -- NUEVA (20270428100000). Recogidas que el receptor ha registrado y que un admin tiene
    -- que validar (o retornar): hasta entonces no se emite ningún albarán. Va justo después
    -- de las respuestas porque es el paso siguiente del proceso de una entrega.
    select 3.5, 'recollides_per_validar',
           (select count(*) from canalizaciones c
             where c.estado <> 'anulada'
               and c.recollida_registrada_at is not null
               and c.recollida_validada_at is null)::int, null, null
    union all
    -- NUEVA (20270510100200). Firmas que una contraparte ha SUBIDO (vía `pujat`) y que el
    -- super_admin tiene que revisar: cerrar (`tancar_signatura`) o rechazar con motivo
    -- (`rebutjar_signatura`). Va tras las recogidas por validar: es la misma clase de cola
    -- de aprobación. Las de canvas y las que sube el super_admin nacen cerradas y no cuentan.
    select 3.7, 'signatures_per_tancar',
           (select count(*) from firmes_document f where f.estat = 'signat')::int, null, null
    union all
    select 4, 'missatges',
           (select coalesce(sum(ms.pendents), 0)::int from missatges_sense_contestar() ms),
           null, null
    union all
    select 5, 'ofertes_sense_enviar',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and not exists (select 1 from oferta_respuestas r
                                where r.excedente_id = e.id))::int, null, null
    union all
    -- NUEVA (11-10-2026, fase 2 de la revisión del 08-10-2026): ofertas que el PRODUCTOR ha
    -- editado y que el equipo no ha revisado. «Si se modifica una oferta ya publicada,
    -- REDESTINA debería recibir una notificación para revisar si afecta a la canalización.»
    -- Los cambios del propio equipo no cuentan: ya los sabe quien los hizo.
    select 5.5, 'ofertes_modificades',
           (select count(distinct x.excedente_id) from excedentes_canvis x
             where x.revisat_at is null
               and not exists (select 1 from usuario_roles ur where ur.user_id = x.user_id))::int,
           null, null
    union all
    -- «Ofertes sense destí registrat» (revisión del 08-10-2026, fase 1). La clave no cambia
    -- —la usan el badge, el tablero y sus pruebas—, cambia lo que cuenta: ya no «vencidas con
    -- kg sin cubrir» sino ofertas a las que les falta decir qué pasó con algún kilo. Una
    -- `no_colocada` (la «Sense sortida» de la interfaz) cuenta aunque su fecha sea futura: la
    -- marcó el equipo a mano y el destino sigue faltando.
    select 6, 'ofertes_vencudes',
           (select count(*) from excedentes e, param p
             where (e.estado = 'no_colocada'
                    or (e.estado in ('publicada', 'parcial') and e.disponible_hasta < p.avui))
               and (select dx.kg_sense_desti from public.desti_excedent(e.id) dx) > 0)::int,
           null, null
    union all
    -- CAMBIA (20270427100000). Con la recogida registrada por el receptor, cada operación
    -- asignada es un borrador que ESPERA AL RECEPTOR: contarlos todos inflaría la cola con
    -- trabajo que no es del equipo. Cuenta solo:
    --   (a) los de espigolada (REC con `espigolada_id`, o ENT/OPE de un registro de
    --       espigolada): los emite siempre el equipo, el job no los toca;
    --   (b) ENT/OPE cuya canalización está en `canal_equip` (recogida pasada sin registrar, o
    --       sin hora y con más de 2 días);
    --   (c) los REC de una oferta (sin espigolada) solo si alguna de sus canalizaciones está
    --       en `canal_equip`: el REC se emite cuando se registra la última salida;
    --   (d) cualquier otro borrador que no cuelgue ni de una canalización ni de una
    --       espigolada (no hay receptor que lo vaya a cerrar).
    select 7, 'albarans_esborrany',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
             where a.estado = 'borrador'
               and (
                 -- (a)
                 (a.tipo = 'REC' and a.espigolada_id is not null)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is not null)
                 -- (b)
                 or (a.tipo in ('ENT', 'OPE') and ex.espigolada_id is null
                     and a.canalizacion_id in (select ce.id from canal_equip ce))
                 -- (c)
                 or (a.tipo = 'REC' and a.espigolada_id is null and a.excedente_id is not null
                     and exists (select 1 from canal_equip ce where ce.excedente_id = a.excedente_id))
                 -- (d)
                 or (a.tipo in ('ENT', 'OPE') and a.canalizacion_id is null
                     and coalesce(ex.espigolada_id is null, true))
                 or (a.tipo = 'REC' and a.espigolada_id is null and a.excedente_id is null)
               ))::int, null, null
    union all
    -- CAMBIA (20270427100000). Lo que tiene que conciliar el equipo:
    --   · los REC entregados o confirmados (como siempre);
    --   · los ENT/OPE confirmados SIN REC vivo (venta o maquila; la rama 3 de
    --     `conciliacions_automatiques()`, que en una espigolada mira el REC de la jornada):
    --     con incidencia de recogida el job no los cierra, y hasta hoy no subían el contador;
    --   · los ENT/OPE confirmados con incidencia de recogida cuyo REC ya está conciliado (la
    --     rama 2 del job los salta y nadie más los cuenta).
    select 8, 'albarans_conciliar',
           (select count(*) from albaranes a
              left join excedentes ex on ex.id = a.excedente_id
              left join canalizaciones c on c.id = a.canalizacion_id
             where (a.tipo = 'REC' and a.estado in ('entregado', 'confirmado'))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    -- 20270428100000: lo que espera la validación de un admin ya cuenta
                    -- en `recollides_per_validar`; contarlo aquí también sería doble.
                    and not coalesce(c.recollida_registrada_at is not null
                                     and c.recollida_validada_at is null, false)
                    and not exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado not in ('anulado', 'rectificado')
                         and (r.excedente_id = a.excedente_id
                              or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id))))
                or (a.tipo in ('ENT', 'OPE') and a.estado = 'confirmado'
                    and c.incidencia_recollida is not null
                    and c.recollida_validada_at is null
                    and c.recollida_registrada_at is null
                    -- ⚠️ Sin `albarans_germans_rec()`: es interna (sin EXECUTE para
                    --    `authenticated`) y esta función es `security invoker`. Misma
                    --    condición, escrita aquí: el REC del excedente o de su jornada.
                    and exists (
                      select 1 from albaranes r
                       where r.tipo = 'REC' and r.estado = 'conciliado'
                         and (r.excedente_id = a.excedente_id
                              or (ex.espigolada_id is not null and r.espigolada_id = ex.espigolada_id)))))::int,
           null, null
    union all
    select 9, 'albarans_esperant',
           (select count(*) from albaranes a where a.estado = 'entregado')::int, null, null
    union all
    select 10, 'costos',
           (select count(distinct e.producto)
              from canalizaciones c
              join excedentes e on e.id = c.excedente_id
              cross join param p
             where extract(year from (c.created_at at time zone 'Europe/Madrid'))::int
                   = p.any_curs
               and e.producto is not null
               and c.coste_kg is null
               and not exists (select 1 from costes_producto cp
                                where cp.producto = e.producto))::int, null, null
    union all
    select 11, 'tancament',
           (select count(*) from cierres_ejercicio ci
             where ci.estado in ('obert', 'provisional'))::int,
           (select t.id from tanc t),
           (select jsonb_build_object(
                     'ejercicio',   t.ejercicio,
                     'modo',        t.modo,
                     'estado',      t.estado,
                     'bloquejats',
                     (select count(*) from cierres_donante d
                       where d.cierre_id = t.id
                         and exists (
                           select 1
                             from jsonb_array_elements(
                                    case when jsonb_typeof(d.bloqueos) = 'array'
                                         then d.bloqueos else '[]'::jsonb end) b
                            where coalesce((b ->> 'bloqueja')::boolean, false))))
              from tanc t)
    union all
    select 12, 'documents_error',
           (select count(*) from documentos d where d.estado = 'error')::int, null, null
    union all
    -- NUEVA (F3). Ofertas publicadas que declaran producto sin cosechar y todavía no son
    -- una jornada. Es trabajo de campo pendiente: alguien tiene que organizar el espigueo.
    --
    -- ⚠️ `estado = 'publicada'` y no también `'parcial'`, y las dos mitades encajan a
    --    propósito: una oferta con alguna canalización ya no es convertible
    --    —`crear_espigolada()` se niega con `ja_te_canalitzacions`—, así que contarla aquí
    --    sería ofrecer un botón que la base va a rechazar. La cola cuenta exactamente lo
    --    que se puede convertir.
    --
    -- ⚠️ Y `espigolada_id is null` y no `oferta_origen_id`: lo que hay que mirar es si la
    --    oferta YA es parte de una jornada, venga de donde venga. Preguntarlo por el enlace
    --    inverso dejaría fuera cualquier otro camino que la ate a una espigolada, que es
    --    justo el estado que hace imposible convertirla.
    select 13, 'espigolades_per_convertir',
           (select count(*) from excedentes e
             where e.estado = 'publicada'
               and e.producte_al_camp
               and e.espigolada_id is null)::int, null, null
    union all
    -- NUEVA (20270531100000, punto 3 fase D1). Precios de referencia: cargas de Gencat que
    -- esperan revisión (un fichero nuevo) y fuentes cuya última comprobación dio error (la
    -- URL ha cambiado, la página no trae la tabla…). Las de Mercabarna, diarias, no cuentan:
    -- se revisan al validar el mes.
    select 14, 'preus',
           ((select count(*) from preus_carregues pc where pc.font = 'gencat' and pc.estat = 'pendent')
            + (select count(*) from preus_fonts_estat pf where pf.darrer_resultat = 'error'))::int,
           null, null
  )
  select q.clau, q.quants, q.objecte, q.extra from cues q order by q.ordre;
end;
$function$;
