-- «Interaccions i seguiment» (proceso 1.2 del cliente), parte de ESCRITURA.
--
-- La sección nueva del equipo (Organitzacions → Interaccions i seguiment) lee LAS MISMAS FILAS
-- que la ficha de entidad registra desde 1F/1.5 (`notes_internes`, 20270502100000 y
-- 20270504100000): no hay tabla nueva ni copia. Esta migración amplía la interacción con lo que
-- pide 1.2; la lectura global va en la siguiente (20270616100100).
--
--   1. `notes_internes`:
--        · `tipus` gana `prospeccio`. `seguiment` se CONSERVA como valor heredado (lo tienen las
--          notas de 1F/1.5 y lo puede mandar el frontend publicado): se lee y se acepta, pero la
--          interfaz nueva ya no lo ofrece. El valor por defecto pasa a `operativa`.
--        · `resultat`: lo que salió del próximo paso, que se escribe al darlo por hecho
--          (`tancar_seguiment`). Solo con `seguiment_fet_at`.
--        · La PREVISIÓN DE PRODUCTO, como columnas de la propia interacción (`previsio_*`):
--          producto, kg aproximados y fecha prevista de disponibilidad van los tres o ninguno; la
--          ubicación (un lugar de la ficha o texto libre) es opcional y solo con previsión.
--          🔴 Una previsión NO crea oferta: es una nota del equipo, y como toda nota interna no
--          sale por ningún canal (AGENTS §8).
--   2. `afegir_nota_interna()` con cinco argumentos nuevos de previsión, todos con valor por
--      defecto: las llamadas de 1F y 1.5 (con nombre) siguen resolviendo igual.
--   3. `tancar_seguiment(p_id, p_resultat)`: guarda el resultado; sigue siendo idempotente.
--
-- 🔴 Las notas internas, sus seguimientos, resultados y previsiones NUNCA salen por ningún canal
--    (correo, WhatsApp, documento, aviso, ficha del actor). Ninguna Edge Function ni plantilla
--    las lee.
--
-- Compatible hacia atrás con el frontend publicado: columnas nuevas nulas, `seguiment` sigue
-- valiendo, y las dos RPC aceptan la llamada vieja (argumentos nuevos con valor por defecto).
-- `notes_internes` ya está en el orden del vaciado (`reiniciar_dades_operatives`, 20270611100000)
-- y cae en cascada con la organización (`borrar_ficha_completa`); borrar un lugar de la ficha deja
-- `previsio_ubicacio_id` a null (la previsión conserva el texto libre, si lo había). Ninguna
-- de esas dos rutas dispara triggers en `notes_internes` (no tiene).

-- ---------------------------------------------------------------------------
-- 1. Columnas y reglas
-- ---------------------------------------------------------------------------
alter table public.notes_internes
  add column if not exists resultat             text,
  add column if not exists previsio_producte    text references public.productos(nombre) on update cascade,
  add column if not exists previsio_kg          numeric,
  add column if not exists previsio_data        date,
  add column if not exists previsio_ubicacio_id uuid references public.productor_ubicaciones(id) on delete set null,
  add column if not exists previsio_ubicacio    text;

alter table public.notes_internes alter column tipus set default 'operativa';

-- Tipo: los seis que ofrece la interfaz, más `seguiment` (heredado de 1F/1.5). Todas las filas
-- vigentes caen en la lista vieja, que es un subconjunto de esta (comprobado con
-- `select distinct tipus`). Los tres CHECK, `not valid` + `validate` (tabla con datos, §7): las
-- columnas de resultado y previsión nacen nulas, así que validan sin tocar ninguna fila.
alter table public.notes_internes drop constraint if exists notes_internes_tipus_check;
alter table public.notes_internes add constraint notes_internes_tipus_check
  check (tipus in ('prospeccio', 'captacio', 'operativa', 'incidencia', 'documentacio', 'altres') or tipus = 'seguiment')
  not valid;
alter table public.notes_internes validate constraint notes_internes_tipus_check;

-- El resultado, solo de un seguimiento hecho, y de 1 a 1.000 caracteres.
alter table public.notes_internes drop constraint if exists notes_internes_resultat_check;
alter table public.notes_internes add constraint notes_internes_resultat_check
  check (resultat is null
         or (seguiment_fet_at is not null and char_length(btrim(resultat)) between 1 and 1000))
  not valid;
alter table public.notes_internes validate constraint notes_internes_resultat_check;

-- La previsión: producto, kg y fecha, los tres o ninguno; kg > 0; la ubicación, solo con
-- previsión y el texto libre de 1 a 200 caracteres.
alter table public.notes_internes drop constraint if exists notes_internes_previsio_check;
alter table public.notes_internes add constraint notes_internes_previsio_check
  check (((previsio_producte is null) = (previsio_kg is null))
         and ((previsio_producte is null) = (previsio_data is null))
         and (previsio_kg is null or previsio_kg > 0)
         and (previsio_producte is not null or (previsio_ubicacio_id is null and previsio_ubicacio is null))
         and (previsio_ubicacio is null or char_length(btrim(previsio_ubicacio)) between 1 and 200))
  not valid;
alter table public.notes_internes validate constraint notes_internes_previsio_check;

-- (El CHECK de `propera_accio`/`propera_data` juntos, `notes_internes_propera_check`, y el de
-- `seguiment_fet_at` solo con próximo paso, `notes_internes_fet_check`, se quedan como están.)

-- Índices de la sección global: el historial ordena por fecha de la interacción; las previsiones,
-- por fecha prevista; el FK del lugar, para el `set null` al borrar un lugar.
create index if not exists notes_internes_data on public.notes_internes (data desc, created_at desc);
create index if not exists notes_internes_previsions on public.notes_internes (previsio_data)
  where previsio_producte is not null;
create index if not exists notes_internes_previsio_ubicacio on public.notes_internes (previsio_ubicacio_id)
  where previsio_ubicacio_id is not null;

comment on column public.notes_internes.tipus is
  'Proceso 1.2 (20270616100000): prospeccio · captacio · operativa · incidencia · documentacio · altres; `seguiment` es el valor heredado de 1F/1.5 (se lee, la interfaz ya no lo ofrece).';
comment on column public.notes_internes.resultat is
  'Proceso 1.2: el resultado del próximo paso, escrito al darlo por hecho (`tancar_seguiment`). Solo con `seguiment_fet_at`; 1-1.000 caracteres.';
comment on column public.notes_internes.previsio_producte is
  'Proceso 1.2: previsión de producto registrada en la interacción (con `previsio_kg` y `previsio_data`, los tres o ninguno). No crea oferta y no sale por ningún canal.';
comment on column public.notes_internes.previsio_kg is 'Proceso 1.2: cantidad aproximada prevista, en kg (> 0).';
comment on column public.notes_internes.previsio_data is 'Proceso 1.2: fecha prevista de disponibilidad (puede ser futura).';
comment on column public.notes_internes.previsio_ubicacio_id is
  'Proceso 1.2: el lugar de la previsión, entre los de un productor de la misma organización (`set null` si se borra el lugar).';
comment on column public.notes_internes.previsio_ubicacio is 'Proceso 1.2: el lugar o el campo de la previsión, en texto libre (≤ 200).';
comment on table public.notes_internes is
  'Plan 1, 1F (D4) + 1.5 + proceso 1.2 (20270616100000): interacciones del equipo con una organización (fecha, canal, tipo, responsable, texto, próximo paso, resultado y previsión de producto). Solo inserción por `afegir_nota_interna()`; lo único que cambia después es el cierre del seguimiento y su resultado (`tancar_seguiment()`); borrar, `esborrar_nota_interna()` (super_admin). Lectura: equipo. Nunca salen por ningún canal.';

-- ---------------------------------------------------------------------------
-- 2. `afegir_nota_interna()` + previsión
-- ---------------------------------------------------------------------------
-- Cambia el número de argumentos: drop + create + revoke/grant (§4bis). Los cinco nuevos llevan
-- valor por defecto, así que las llamadas de 1F (p_org, p_canal, p_text[, p_data]) y de 1.5
-- (+ p_tipus, p_responsable, p_propera_accio, p_propera_data) resuelven igual.
--
-- Errores nuevos (22023 con el código en el mensaje): `previsio_incompleta` (falta producto, kg o
-- fecha, o viene un lugar sin previsión), `producte_desconegut`, `kg_invalid` (≤ 0),
-- `previsio_ubicacio_massa_llarga` (> 200), `ubicacio_aliena` (el lugar no es de un productor de
-- esa organización). El tipo `seguiment` se sigue aceptando (frontend publicado).
drop function if exists public.afegir_nota_interna(uuid, text, text, timestamptz, text, uuid, text, date);
-- Idempotente: si se reaplica, también la de 13 argumentos.
drop function if exists public.afegir_nota_interna(uuid, text, text, timestamptz, text, uuid, text, date, text, numeric, date, uuid, text);
create function public.afegir_nota_interna(
  p_org                  uuid,
  p_canal                text,
  p_text                 text,
  p_data                 timestamptz default now(),
  p_tipus                text default 'operativa',
  p_responsable          uuid default null,
  p_propera_accio        text default null,
  p_propera_data         date default null,
  p_previsio_producte    text default null,
  p_previsio_kg          numeric default null,
  p_previsio_data        date default null,
  p_previsio_ubicacio_id uuid default null,
  p_previsio_ubicacio    text default null
) returns public.notes_internes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_text     text := btrim(coalesce(p_text, ''));
  v_accio    text := nullif(btrim(coalesce(p_propera_accio, '')), '');
  v_resp     uuid := coalesce(p_responsable, auth.uid());
  v_tipus    text := coalesce(p_tipus, 'operativa');
  v_producte text := nullif(btrim(coalesce(p_previsio_producte, '')), '');
  v_lloc     text := nullif(btrim(coalesce(p_previsio_ubicacio, '')), '');
  v_nota     notes_internes;
begin
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip escriu notes internes' using errcode = '42501';
  end if;
  if p_canal is null or p_canal not in ('telefon', 'whatsapp', 'email', 'visita', 'reunio', 'altres') then
    raise exception 'canal_nota_desconegut: %', p_canal using errcode = '22023';
  end if;
  -- `seguiment`, heredado: se acepta (lo manda el frontend publicado), la interfaz ya no lo ofrece.
  if coalesce(p_tipus, 'operativa') not in ('prospeccio', 'captacio', 'operativa', 'incidencia', 'documentacio', 'altres')
     and v_tipus <> 'seguiment' then
    raise exception 'tipus_nota_desconegut: %', p_tipus using errcode = '22023';
  end if;
  if v_text = '' then
    raise exception 'nota_buida: la nota no pot ser buida' using errcode = '22023';
  end if;
  if char_length(v_text) > 2000 then
    raise exception 'nota_massa_llarga: maxim 2.000 caracters' using errcode = '22023';
  end if;
  if p_data is not null and p_data > now() + interval '1 day' then
    raise exception 'nota_futura: la data del contacte no pot ser futura' using errcode = '22023';
  end if;
  if v_accio is not null and p_propera_data is null then
    raise exception 'propera_accio_sense_data' using errcode = '22023';
  end if;
  if v_accio is null and p_propera_data is not null then
    raise exception 'propera_data_sense_accio' using errcode = '22023';
  end if;
  if char_length(coalesce(v_accio, '')) > 500 then
    raise exception 'propera_accio_massa_llarga: maxim 500 caracters' using errcode = '22023';
  end if;
  -- La previsión: los tres datos o ninguno; un lugar sin previsión tampoco es nada.
  if ((v_producte is null) <> (p_previsio_kg is null))
     or ((v_producte is null) <> (p_previsio_data is null))
     or (v_producte is null and (p_previsio_ubicacio_id is not null or v_lloc is not null)) then
    raise exception 'previsio_incompleta: producte, quilos i data, tots tres o cap' using errcode = '22023';
  end if;
  if p_previsio_kg is not null and p_previsio_kg <= 0 then
    raise exception 'kg_invalid: els quilos previstos han de ser mes de 0' using errcode = '22023';
  end if;
  if char_length(coalesce(v_lloc, '')) > 200 then
    raise exception 'previsio_ubicacio_massa_llarga: maxim 200 caracters' using errcode = '22023';
  end if;
  if v_producte is not null and not exists (select 1 from productos where nombre = v_producte) then
    raise exception 'producte_desconegut: %', v_producte using errcode = '22023';
  end if;
  if not exists (select 1 from usuario_roles where user_id = v_resp) then
    raise exception 'responsable_no_equip' using errcode = '22023';
  end if;
  if not exists (select 1 from organizaciones where id = p_org) then
    raise exception 'organitzacio_inexistent' using errcode = '22023';
  end if;
  if p_previsio_ubicacio_id is not null and not exists (
       select 1 from productor_ubicaciones u
         join productores p on p.id = u.productor_id
        where u.id = p_previsio_ubicacio_id and p.organizacion_id = p_org) then
    raise exception 'ubicacio_aliena: el lloc no es d''aquesta organitzacio' using errcode = '22023';
  end if;

  insert into notes_internes (organizacion_id, data, canal, autor, text, tipus, responsable, propera_accio, propera_data,
                              previsio_producte, previsio_kg, previsio_data, previsio_ubicacio_id, previsio_ubicacio)
  values (p_org, coalesce(p_data, now()), p_canal, auth.uid(), v_text, v_tipus, v_resp, v_accio, p_propera_data,
          v_producte, p_previsio_kg, p_previsio_data, p_previsio_ubicacio_id, v_lloc)
  returning * into v_nota;
  return v_nota;
end;
$$;

comment on function public.afegir_nota_interna(uuid, text, text, timestamptz, text, uuid, text, date, text, numeric, date, uuid, text) is
  'Plan 1, 1F + 1.5 + proceso 1.2 (20270616100000). es_intern() con sesión: añade una interacción (fecha, canal, tipo, responsable del equipo, texto), su próximo paso con fecha y, opcional, una previsión de producto (producto, kg, fecha prevista y lugar). No crea oferta.';

revoke execute on function public.afegir_nota_interna(uuid, text, text, timestamptz, text, uuid, text, date, text, numeric, date, uuid, text)
  from public, anon, service_role;
grant execute on function public.afegir_nota_interna(uuid, text, text, timestamptz, text, uuid, text, date, text, numeric, date, uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. `tancar_seguiment(p_id, p_resultat)` — hecho, con su resultado
-- ---------------------------------------------------------------------------
-- Cambia el número de argumentos: drop + create + revoke/grant. `p_resultat` lleva valor por
-- defecto: la llamada vieja (`{p_id}`) sigue valiendo y cierra sin resultado.
--
-- Idempotente como hasta ahora: cerrar uno ya cerrado no cambia ni la fecha ni quién lo cerró, y
-- tampoco pisa un resultado ya escrito; solo lo completa si viene uno y no lo había.
--
-- Errores (22023): `nota_inexistent`, `nota_sense_seguiment`, `resultat_massa_llarg` (> 1.000).
drop function if exists public.tancar_seguiment(uuid);
drop function if exists public.tancar_seguiment(uuid, text);
create function public.tancar_seguiment(p_id uuid, p_resultat text default null)
returns public.notes_internes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nota     notes_internes;
  v_resultat text := nullif(btrim(coalesce(p_resultat, '')), '');
begin
  if auth.uid() is null or not public.es_intern() then
    raise exception 'Nomes l''equip tanca seguiments' using errcode = '42501';
  end if;
  if char_length(coalesce(v_resultat, '')) > 1000 then
    raise exception 'resultat_massa_llarg: maxim 1.000 caracters' using errcode = '22023';
  end if;
  select * into v_nota from notes_internes where id = p_id for update;
  if not found then
    raise exception 'nota_inexistent' using errcode = '22023';
  end if;
  if v_nota.propera_accio is null then
    raise exception 'nota_sense_seguiment' using errcode = '22023';
  end if;
  if v_nota.seguiment_fet_at is null then
    update notes_internes
       set seguiment_fet_at = now(), seguiment_fet_per = auth.uid(), resultat = v_resultat
     where id = p_id
    returning * into v_nota;
  elsif v_resultat is not null and v_nota.resultat is null then
    update notes_internes set resultat = v_resultat where id = p_id
    returning * into v_nota;
  end if;
  return v_nota;
end;
$$;

comment on function public.tancar_seguiment(uuid, text) is
  '1.5 + proceso 1.2 (20270616100000). es_intern() con sesión: da por hecho el próximo paso de una interacción y guarda su resultado (idempotente; no pisa un resultado ya escrito).';

revoke execute on function public.tancar_seguiment(uuid, text) from public, anon, service_role;
grant execute on function public.tancar_seguiment(uuid, text) to authenticated;
