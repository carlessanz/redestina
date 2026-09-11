-- La RLS de `excedentes` deja de evaluarse fila a fila. Cierra la deuda §12.23.
--
-- EL DEFECTO. La política de lectura de `excedentes` (20260730098000) tenía tres ramas
-- sin correlación —resueltas una vez por consulta, como InitPlan o SubPlan cacheado— y
-- una cuarta que sí la tenía:
--
--     or (estado in ('publicada','parcial')
--         and exists (select 1 from entidades e
--                       join modalitat_receptor_compat c
--                         on c.tipo_receptor = e.tipo_receptor
--                        and c.modalitat = excedentes.modalitat        <-- aquí
--                      where e.id in (select public.mis_entidades())))
--
-- Ese `excedentes.modalitat` ata el subplan a la fila que se está filtrando, así que
-- Postgres no lo puede resolver una sola vez: lo ejecuta **una vez por fila**, y dentro
-- recorre `entidades`, que a su vez vuelve a evaluar su propia RLS (otra llamada a
-- `mis_entidades()` por pasada). Con siete ofertas no se nota; el día que haya miles, cada
-- `select` de un receptor son miles de recorridos de `entidades`.
--
-- EL ARREGLO ES EL MISMO QUE YA USA ESTE FICHERO PARA ROMPER LA RECURSIÓN: una función
-- puente `security definer` **sin correlación**, que devuelve el conjunto pequeño y fijo
-- que de verdad depende de la cuenta —qué modalidades puede recibir— y una comparación
-- `modalitat in (select …)`, que el planner resuelve una vez y hashea.
--
-- ES EL MISMO CONJUNTO DE FILAS, y conviene ver por qué:
--   · el `exists` original leía `entidades` bajo su RLS (`es_intern() or id in
--     mis_entidades()`) y además exigía `e.id in mis_entidades()`, así que el conjunto
--     efectivo era siempre **mis entidades**, con rol interno o sin él;
--   · la función nueva es `security definer` (no evalúa RLS) pero filtra por lo mismo;
--   · una entidad con `tipo_receptor` null no casa con la matriz en ninguna de las dos
--     versiones, así que sigue sin ver ninguna oferta (§4bis);
--   · un excedente con `modalitat` null tampoco casaba antes y `null in (…)` no es cierto,
--     así que tampoco ahora.
--
-- No se toca la rama de `es_intern()`, ni la de `mis_productores()`, ni la del histórico
-- por interés: siguen exactamente como estaban.

/** Qué modalidades de oferta pueden recibir mis entidades (matriz `modalitat_receptor_compat`). */
create or replace function public.modalitats_compatibles_meves()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct c.modalitat
    from entidades e
    join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
   where e.id in (select public.mis_entidades());
$$;

comment on function public.modalitats_compatibles_meves() is
  'Modalidades (donacio/venda/maquila) que puede recibir alguna de mis entidades. Puente sin correlación para la RLS de excedentes.';

revoke execute on function public.modalitats_compatibles_meves() from public, anon;
grant  execute on function public.modalitats_compatibles_meves() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- La política, con la cuarta rama sin correlación
-- ---------------------------------------------------------------------------
drop policy if exists "excedentes: lectura per rol" on excedentes;
create policy "excedentes: lectura per rol"
  on excedentes for select to authenticated
  using (
       (select public.es_intern())
    or productor_id in (select public.mis_productores())
    or (estado in ('publicada', 'parcial')
        and modalitat in (select public.modalitats_compatibles_meves()))
    or id in (select public.excedents_amb_interes_meu())
  );

-- Verificación (con la sesión de un receptor, dentro de una transacción):
--   explain (analyze, costs off) select id from excedentes;
--   -- el filtro ya no dice EXISTS(SubPlan …) con loops > 1: son cuatro subplanes
--   -- hashed/InitPlan, todos con loops = 1.
--   -- Y el arnés tiene que dar exactamente lo mismo que antes para los tres receptores.
