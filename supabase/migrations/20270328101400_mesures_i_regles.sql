-- El **catálogo de medidas de prevención** y las **reglas** que deciden cuáles entran en
-- el plan de una organización.
--
-- POR QUÉ EN TABLA Y NO EN CÓDIGO. Exactamente el argumento de `convenios_exigidos`
-- (20270111100000) y de `modalitat_receptor_compat` (20260730091000): la regla de negocio
-- es una fila, y cambiarla tiene que ser un `insert`, no un despliegue. Aquí pesa además
-- una segunda razón: **la generación del plan ocurre en SQL, dentro de la transacción del
-- diagnóstico** (20270405100400). Con las reglas en TypeScript habría que sacar las
-- respuestas, evaluarlas fuera y volver a entrar a escribir; con las reglas en tabla es un
-- join y un `jsonb_agg`, y o se guardan el diagnóstico y su plan a la vez o ninguno de los
-- dos.
--
-- 🔴 SOLO LAS MEDIDAS DE **REGISTRO** NACEN OBLIGATORIAS. Es la decisión del 22-09-2026 y
--    conviene que quede escrita donde se lee: mientras la Fundación no valide el
--    cuestionario, lo único que Redestina puede pedirle a una organización con cara seria
--    es que **anote lo que le pasa** —cuántos kilos se quedan fuera del circuito y dónde
--    van—, porque es lo único que el servicio necesita de verdad para medir y lo único
--    defendible ante cualquiera. Todo lo demás se **recomienda**. Lo sostiene el seed
--    (20270405100200): `obligatoria_per_defecte = true` solo en `registre_*`.
--    ⚠️ Esto NO lo impone ningún check, a propósito: el día que la fase 0 entregue el
--    anexo B, la Fundación podrá declarar obligatoria otra medida sin una migración, que
--    es justo para lo que existe esta tabla. Lo que no puede pasar es que ocurra sin que
--    nadie lo decida, y para eso escribir aquí es `pot_aprovar()`.
--
-- SIN DELETE. Una medida no se borra: se retira con `activa = false`. Igual que una
-- plantilla. Un plan emitido cita su código, y un código que desaparece convierte ese
-- plan en un documento que habla de algo que ya no existe. (Y de todas formas el plan
-- lleva el título y la descripción **copiados dentro**, ver 20270405100200.)

-- ---------------------------------------------------------------------------
-- 1. mesures_prevencio: el catálogo
-- ---------------------------------------------------------------------------
create table if not exists mesures_prevencio (
  codi        text primary key check (codi ~ '^[a-z][a-z0-9_]{2,48}$'),

  -- Una medida es de un tipo de organización. Si la misma idea sirve para los dos, son
  -- DOS filas con dos códigos: así `regles_pla` puede llevar una FK compuesta que hace
  -- imposible que una regla de productor apunte a una medida de entidad.
  tipo_org    text not null check (tipo_org in ('productor', 'entidad')),

  bloc        text not null check (bloc in (
                'planificacio', 'collita', 'conservacio', 'canalitzacio', 'seguiment')),

  titol       jsonb not null,
  descripcio  jsonb not null,

  -- Ver la cabecera: hoy solo las de registro.
  obligatoria_per_defecte boolean not null default false,

  ordre       int  not null default 100,
  activa      boolean not null default true,

  -- 🔴 Como en el cuestionario: texto de trabajo sin validar por la Fundación. Viaja al
  --    plan y se imprime.
  provisional boolean not null default true,

  created_at  timestamptz not null default now(),

  constraint mesures_titol_forma check (
        jsonb_typeof(titol) = 'object'
    and jsonb_typeof(titol -> 'ca') = 'string'
    and jsonb_typeof(titol -> 'es') = 'string'),
  constraint mesures_descripcio_forma check (
        jsonb_typeof(descripcio) = 'object'
    and jsonb_typeof(descripcio -> 'ca') = 'string'
    and jsonb_typeof(descripcio -> 'es') = 'string'),

  -- Lo que permite la FK compuesta de `regles_pla`. Redundante con la PK a ojos de un
  -- índice, imprescindible a ojos de la integridad.
  unique (codi, tipo_org)
);

comment on table mesures_prevencio is
  'Catálogo de medidas de prevención. Se retira con activa=false, nunca se borra: un plan emitido cita su código.';
comment on column mesures_prevencio.obligatoria_per_defecte is
  'Hoy solo las de registro (decisión del 22-09-2026). Una regla puede escalar a obligatoria una medida que no lo sea; nunca al revés.';
comment on column mesures_prevencio.provisional is
  'true = redacción de trabajo sin validar por la Fundación.';

create index if not exists mesures_tipus_idx on mesures_prevencio (tipo_org, bloc, ordre) where activa;

-- ---------------------------------------------------------------------------
-- 2. regles_pla: qué respuesta dispara qué medida
-- ---------------------------------------------------------------------------
create table if not exists regles_pla (
  id          uuid primary key default gen_random_uuid(),

  tipo_org    text not null check (tipo_org in ('productor', 'entidad')),

  -- El id de una pregunta del cuestionario vigente de ese tipo. **Sin FK**, y no es
  -- dejadez: las preguntas viven dentro de un `jsonb`, así que no hay a qué apuntar. Lo
  -- que sí se comprueba es que una regla no apunte a una pregunta inexistente cuando se
  -- publica el cuestionario —ahí sí se pueden cruzar las dos cosas— y que una regla que
  -- no encuentra su pregunta **no dispare**, en vez de fallar (ver `avaluar_regla`).
  pregunta_id text,

  operador    text not null check (operador in (
                'sempre', '=', '!=', 'in', 'conte', '>=', '<=', 'buit')),

  -- jsonb y no text: `in` necesita un array, `>=` un número y `=` puede comparar contra
  -- un booleano. Con `text` habría que castear en cada rama y adivinar el tipo.
  valor       jsonb,

  mesura_codi text not null,
  obligatoria boolean not null default false,
  prioritat   int not null default 100,
  activa      boolean not null default true,

  motiu       text,
  created_at  timestamptz not null default now(),

  -- La FK COMPUESTA: una regla de productor no puede apuntar a una medida de entidad.
  -- Con una FK simple sobre `codi` eso sería disciplina; así es imposible.
  constraint regles_mesura_fk foreign key (mesura_codi, tipo_org)
    references mesures_prevencio (codi, tipo_org) on delete restrict,

  -- `sempre` es la única que no mira ninguna pregunta —y es la que sostiene las medidas
  -- de registro, que entran en todos los planes—.
  constraint regles_pregunta_segons_operador check (
    operador = 'sempre' or pregunta_id is not null),
  constraint regles_sempre_sense_pregunta check (
    operador <> 'sempre' or pregunta_id is null),
  -- `buit` no compara contra nada; `sempre`, tampoco.
  constraint regles_valor_segons_operador check (
    operador in ('sempre', 'buit') or valor is not null)
);

comment on table regles_pla is
  'De una respuesta a una medida. Cambiar la regla de negocio es un insert. La evalúa generar_pla_des_de_diagnostic() en SQL.';
comment on column regles_pla.pregunta_id is
  'Id de una pregunta del cuestionario de ese tipo. Sin FK: las preguntas viven en jsonb. Una regla huérfana no dispara.';
comment on column regles_pla.obligatoria is
  'Escala la medida a obligatoria en este caso. Nunca la rebaja: el plan toma el OR con obligatoria_per_defecte.';
comment on column regles_pla.prioritat is
  'Desempata cuando dos reglas producen la misma medida. Menor = manda.';

create index if not exists regles_tipus_idx on regles_pla (tipo_org, pregunta_id) where activa;
create index if not exists regles_mesura_idx on regles_pla (mesura_codi);

-- ---------------------------------------------------------------------------
-- 3. avaluar_regla(): la gramática de las condiciones, en un solo sitio
-- ---------------------------------------------------------------------------
-- La usan LAS DOS cosas que evalúan condiciones: las reglas del plan y el `aplica_a` de
-- una pregunta condicional. Tener dos implementaciones de «¿se cumple esto?» garantiza
-- que algún día se comporten distinto, y entonces una pregunta que la pantalla oculta
-- contaría como obligatoria en el servidor.
--
-- ⚠️ ANTE UN TIPO QUE NO CUADRA, `false`, NUNCA UN ERROR. Una regla mal configurada
--    —`>=` contra una respuesta de texto— no puede tumbar la emisión de un plan: produce
--    una medida de menos, que se ve y se arregla. Una excepción aquí dejaría a la
--    organización sin poder guardar su diagnóstico por un dato de configuración.
create or replace function public.avaluar_regla(
  p_operador text,
  p_valor    jsonb,
  p_resposta jsonb
) returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_tipus text;
begin
  if p_operador = 'sempre' then
    return true;
  end if;

  v_tipus := jsonb_typeof(p_resposta);

  -- «Sin contestar» incluye el null de SQL, el null de JSON, la cadena vacía y el array
  -- vacío: las cuatro son lo mismo para quien mira un formulario.
  if p_operador = 'buit' then
    return p_resposta is null
        or v_tipus = 'null'
        or (v_tipus = 'string' and btrim(p_resposta #>> '{}') = '')
        or (v_tipus = 'array'  and jsonb_array_length(p_resposta) = 0);
  end if;

  -- Sin respuesta no se dispara nada más. Es la diferencia entre «ha dicho que no» y «no
  -- ha dicho nada», y confundirlas metería medidas en el plan de quien no contestó.
  if p_resposta is null or v_tipus = 'null' then
    return false;
  end if;

  if p_operador = '=' then
    return p_resposta = p_valor;
  elsif p_operador = '!=' then
    return p_resposta <> p_valor;
  elsif p_operador = 'in' then
    if jsonb_typeof(p_valor) <> 'array' then
      return false;
    end if;
    return exists (select 1 from jsonb_array_elements(p_valor) e where e = p_resposta);
  elsif p_operador = 'conte' then
    -- Para las preguntas `multi`: la respuesta es un array y se pregunta si lleva un valor.
    if v_tipus <> 'array' then
      return false;
    end if;
    return exists (select 1 from jsonb_array_elements(p_resposta) e where e = p_valor);
  elsif p_operador in ('>=', '<=') then
    if v_tipus <> 'number' or jsonb_typeof(p_valor) <> 'number' then
      return false;
    end if;
    if p_operador = '>=' then
      return (p_resposta #>> '{}')::numeric >= (p_valor #>> '{}')::numeric;
    end if;
    return (p_resposta #>> '{}')::numeric <= (p_valor #>> '{}')::numeric;
  end if;

  return false;
end;
$$;

comment on function public.avaluar_regla(text, jsonb, jsonb) is
  'La gramática de las condiciones (sempre|=|!=|in|conte|>=|<=|buit), compartida por regles_pla y por el aplica_a de una pregunta. Un tipo que no cuadra devuelve false, nunca error.';

revoke execute on function public.avaluar_regla(text, jsonb, jsonb) from public, anon;
grant  execute on function public.avaluar_regla(text, jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- ⚠️ Lectura de EQUIPO, no de cualquiera: es la configuración del servicio, y una
--    organización no necesita verla para nada — su plan lleva el título y la descripción
--    de cada medida **copiados dentro** (20270405100200). Que una entidad pueda leer el
--    catálogo entero solo le diría qué medidas NO le han tocado, que es ruido.
--
-- Escritura de `pot_aprovar()`, igual que el texto de una plantilla (20260928100100):
-- declarar obligatoria una medida es una decisión, no una tarea.
grant select, insert, update on mesures_prevencio to authenticated;
grant select, insert, update on regles_pla        to authenticated;
revoke delete, truncate on mesures_prevencio from authenticated;
revoke delete, truncate on regles_pla        from authenticated;
revoke all on mesures_prevencio from anon;
revoke all on regles_pla        from anon;

alter table mesures_prevencio enable row level security;
alter table regles_pla        enable row level security;

drop policy if exists "mesures: intern llegeix" on mesures_prevencio;
create policy "mesures: intern llegeix"
  on mesures_prevencio for select to authenticated
  using ((select public.es_intern()));

drop policy if exists "mesures: aprovador escriu" on mesures_prevencio;
create policy "mesures: aprovador escriu"
  on mesures_prevencio for insert to authenticated
  with check ((select public.pot_aprovar()));

drop policy if exists "mesures: aprovador actualitza" on mesures_prevencio;
create policy "mesures: aprovador actualitza"
  on mesures_prevencio for update to authenticated
  using ((select public.pot_aprovar()))
  with check ((select public.pot_aprovar()));

drop policy if exists "regles: intern llegeix" on regles_pla;
create policy "regles: intern llegeix"
  on regles_pla for select to authenticated
  using ((select public.es_intern()));

drop policy if exists "regles: aprovador escriu" on regles_pla;
create policy "regles: aprovador escriu"
  on regles_pla for insert to authenticated
  with check ((select public.pot_aprovar()));

drop policy if exists "regles: aprovador actualitza" on regles_pla;
create policy "regles: aprovador actualitza"
  on regles_pla for update to authenticated
  using ((select public.pot_aprovar()))
  with check ((select public.pot_aprovar()));

-- Verificación:
--   select has_table_privilege('authenticated','public.mesures_prevencio','DELETE');  -- f
--   select public.avaluar_regla('conte', '"calibre"'::jsonb, '["calibre","estetic"]'::jsonb);  -- t
--   select public.avaluar_regla('>=',    '5'::jsonb,          '"molt"'::jsonb);                -- f
