-- Series documentales: el contador del que salen TODOS los números de documento.
--
-- POR QUÉ EXISTE ESTA TABLA. Hoy el único correlativo del proyecto se calcula contando
-- filas (`generarId()` en `_shared/oferta.ts`, deuda §12.39): dos altas simultáneas del
-- mismo productor y producto chocan y la segunda falla. Para un identificador interno de
-- oferta eso es molesto; para un albarán o un certificado de donación es inaceptable —una
-- serie documental no puede tener huecos ni repeticiones, y no se puede reconstruir a
-- posteriori contando lo que hay—.
--
-- LA REGLA (§A del plan de ejecución): **el número pertenece a la fila, no al fichero**.
-- `siguiente_numero()` se llama DENTRO de la transacción que crea la fila del dominio y
-- su fila en `documentos`. Si la transacción cae, el número no se consume; si lo que
-- falla es el PDF (más tarde, en la Edge Function), la fila ya existe y no hay hueco.
--
-- POR QUÉ NO UNA SECUENCIA DE POSTGRES. Una `sequence` es no transaccional a propósito:
-- `nextval` no se deshace con el `rollback`, así que cada emisión fallida dejaría un
-- hueco permanente. Aquí es justo al revés: se quiere que el número vuelva atrás.
-- El precio es que las emisiones de una misma serie se serializan (una espera a la otra
-- mientras dura la transacción). A la escala de Redestina —decenas de documentos al día—
-- eso no se nota, y es exactamente la garantía que pide una serie legal.
--
-- CÓMO SERIALIZA. `insert … on conflict (serie, ejercicio) do update` toma el bloqueo de
-- la fila del contador; el segundo que llega espera al `commit`/`rollback` del primero,
-- y solo entonces lee `ultimo` y suma. No hace falta `select … for update` previo ni
-- `advisory lock`.

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists series_documentales (
  serie      text    not null,
  ejercicio  int     not null,
  ultimo     int     not null default 0,
  digitos    int     not null default 5,
  primary key (serie, ejercicio)
);

comment on table series_documentales is
  'Contador por serie y ejercicio. Una fila = un correlativo. Solo la escribe siguiente_numero().';
comment on column series_documentales.ultimo is
  'Último número entregado. Vuelve atrás si la transacción que lo pidió no llega a commit.';
comment on column series_documentales.digitos is
  'Relleno con ceros de formato_numero(): REC-2026-00042 son 5 dígitos, RES-2026-0012 son 4.';

-- ---------------------------------------------------------------------------
-- 2. siguiente_numero(): el corazón de la numeración
-- ---------------------------------------------------------------------------
-- `volatile` (escribe) y `security definer` (la tabla no la puede tocar nadie más).
-- Se le revoca EXECUTE a `authenticated` a propósito: un usuario no puede quemar
-- números de una serie legal desde el navegador. Solo la llaman las RPC de emisión
-- —que también son `security definer`— y `service_role`.
--
-- El `digitos` de una serie se hereda del ejercicio anterior ya sembrado, así que al
-- estrenar 2027 no hay que volver a sembrar nada: RES sigue con 4 dígitos y REC con 5.
-- Si la serie no se ha visto nunca, cae al default 5.
create or replace function public.siguiente_numero(p_serie text, p_ejercicio int)
returns int
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into series_documentales as s (serie, ejercicio, ultimo, digitos)
  values (
    p_serie,
    p_ejercicio,
    1,
    coalesce((select d.digitos
                from series_documentales d
               where d.serie = p_serie
               order by d.ejercicio desc
               limit 1), 5))
  on conflict (serie, ejercicio) do update
     set ultimo = s.ultimo + 1
  returning s.ultimo;
$$;

-- ---------------------------------------------------------------------------
-- 3. formato_numero(): 'REC' + 2026 + 42 -> 'REC-2026-00042'
-- ---------------------------------------------------------------------------
-- `stable`, no `immutable`: lee `digitos` de la tabla. Dentro de una misma transacción
-- el resultado no cambia, que es lo que `stable` promete.
create or replace function public.formato_numero(p_serie text, p_ejercicio int, p_n int)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_serie || '-' || p_ejercicio::text || '-' ||
         lpad(p_n::text,
              greatest(coalesce((select d.digitos
                                   from series_documentales d
                                  where d.serie = p_serie and d.ejercicio = p_ejercicio), 5),
                       length(p_n::text)),
              '0');
$$;

comment on function public.formato_numero(text, int, int) is
  'Número legible de una serie. El greatest() evita truncar si algún día se pasan los dígitos sembrados.';

-- ---------------------------------------------------------------------------
-- 4. Seed de dígitos (una fila por serie y ejercicio, con el contador a 0)
-- ---------------------------------------------------------------------------
-- Los dígitos son una decisión de formato por serie, pero la clave de la tabla es
-- (serie, ejercicio): se siembran los ejercicios 2026–2030 para que las series nazcan
-- ya con su formato. Del 2031 en adelante lo hereda solo `siguiente_numero()`.
--
-- 5 dígitos: los albaranes, que son muchos (REC recepción, ENT entrega, OPE operación
--            comercial) y sus rectificativos `R-`.
-- 4 dígitos: convenios, resúmenes de cierre, certificados y planes, que son pocos.
--            `P-RES` / `P-CD` son las series del **modo prueba** (§A: el modo vive en el
--            dato, y las series reales no se consumen ensayando).
-- `PROVA`  : la serie del documento de humo con el que se prueba el circuito entero
--            (`emitir_documento_prova()`), añadida por el spike.
--
-- `do update set digitos` no toca `ultimo`: reaplicar esto nunca reinicia un contador.
insert into series_documentales (serie, ejercicio, ultimo, digitos)
select s.serie, e.ejercicio, 0, s.digitos
  from (values
          ('REC', 5), ('ENT', 5), ('OPE', 5),
          ('R-REC', 5), ('R-ENT', 5), ('R-OPE', 5),
          ('CONV-DON-GEN', 4), ('CONV-DON-REC', 4), ('CONV-COM', 4),
          ('RES', 4), ('CD', 4), ('CT', 4), ('PLA', 4),
          ('P-RES', 4), ('P-CD', 4),
          ('PROVA', 4)
       ) as s(serie, digitos),
       generate_series(2026, 2030) as e(ejercicio)
on conflict (serie, ejercicio) do update set digitos = excluded.digitos;

-- ---------------------------------------------------------------------------
-- 5. Las dos capas: GRANT + RLS
-- ---------------------------------------------------------------------------
-- El GRANT de SELECT lo daría ya el `alter default privileges` de
-- 20260721160000, pero se escribe explícito: una tabla nueva sin GRANT responde
-- `permission denied` ANTES de evaluar RLS, y es el error más caro de diagnosticar (§4).
grant select on series_documentales to authenticated;

alter table series_documentales enable row level security;

-- El equipo lee el estado de los contadores (sale en la bandeja de documentos); nadie
-- más tiene nada que hacer aquí. Sin políticas de escritura a propósito: tampoco hay
-- GRANT, así que la única forma de mover un contador es la función de arriba.
drop policy if exists "series: intern" on series_documentales;
create policy "series: intern"
  on series_documentales for select to authenticated
  using ((select public.es_intern()));

-- ---------------------------------------------------------------------------
-- 6. EXECUTE: quitar el PUBLIC por defecto
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Sin este revoke, `anon` podría llamar
--    a siguiente_numero() y quemar números de una serie legal sin ni siquiera tener
--    sesión.
revoke execute on function public.siguiente_numero(text, int) from public, anon, authenticated;
grant  execute on function public.siguiente_numero(text, int) to service_role;

revoke execute on function public.formato_numero(text, int, int) from public, anon;
grant  execute on function public.formato_numero(text, int, int) to authenticated, service_role;

-- Verificación:
--   select public.siguiente_numero('PROVA', 2026);            -- 1, 2, 3…
--   select public.formato_numero('REC', 2026, 42);            -- REC-2026-00042
--   select has_table_privilege('authenticated','public.series_documentales','SELECT');  -- t
--   select has_function_privilege('authenticated','public.siguiente_numero(text,int)','EXECUTE');  -- f
