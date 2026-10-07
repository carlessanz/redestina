-- Una consulta para que el arnés vigile el ACL de las funciones, y el patrón de los fallos de
-- `20270414100400`…`100900` no vuelva a pasar sin que nadie lo vea.
--
-- LA CAUSA COMÚN de esos fallos es el `alter default privileges … on functions` que Supabase
-- deja en `public`: toda función nueva nace con EXECUTE para `anon` y `authenticated`, y si la
-- migración que la crea olvida el `revoke`, queda llamable por PostgREST. No se cambia ese
-- default (rompería la costumbre de todas las RPC del panel, que dependen de él para
-- `authenticated`; ver el informe de la auditoría). Lo que se añade es VIGILANCIA.
--
-- `auditoria_funcions_obertes()` devuelve las funciones de `public` que están abiertas de más,
-- en dos categorías:
--
--   · `definer_anon`  — `security definer`, que no devuelven `trigger`, y que `anon` (o
--                       PUBLIC) puede ejecutar. Una función así corre con los privilegios de
--                       su propietario y la puede llamar cualquiera con la publishable key,
--                       SIN SESIÓN. Hoy, tras las migraciones de esta tanda: ninguna.
--   · `trigger_api`   — funciones de trigger ejecutables por `anon` o `authenticated`. No son
--                       alcanzables (PostgREST no las expone), pero la regla del repo desde
--                       `20270414100900` es que no lo sean. Hoy: ninguna.
--
-- Quedan fuera las funciones que pertenecen a una extensión (`pg_depend.deptype = 'e'`): su
-- ACL lo decide la extensión, no este repo.
--
-- La lista de PERMITIDAS no vive aquí sino en el arnés (`scripts/comprobar-rls.ts`,
-- `PERMITIDAS_ABIERTAS`), con el motivo de cada una: así añadir una excepción es un cambio
-- que se lee en el diff del arnés, no algo escondido en una migración.
--
-- ⚠️ Es `security INVOKER` a propósito: `pg_proc` y `has_function_privilege()` los puede leer
--    cualquier rol, así que no necesita privilegios del propietario — y una `security
--    definer` más sería justamente lo que esta función existe para vigilar. Solo la puede
--    llamar el equipo (o `service_role`): el ACL de las funciones no es un secreto —
--    PostgREST ya publica las llamables—, pero no tiene ninguna utilidad para un externo.

create or replace function public.auditoria_funcions_obertes()
returns table (categoria text, funcio text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta l''auditoria de funcions' using errcode = '42501';
  end if;

  return query
  select 'definer_anon'::text, p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and p.prorettype <> 'pg_catalog.trigger'::pg_catalog.regtype
     and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
     and not exists (select 1 from pg_catalog.pg_depend d
                      where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                        and d.objid = p.oid and d.deptype = 'e')
  union all
  select 'trigger_api'::text, p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
     and (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
          or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     and not exists (select 1 from pg_catalog.pg_depend d
                      where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                        and d.objid = p.oid and d.deptype = 'e')
  order by 1, 2;
end;
$$;

comment on function public.auditoria_funcions_obertes() is
  'Funciones de public abiertas de más: security definer ejecutables por anon, y de trigger ejecutables por anon/authenticated. La vigila scripts/comprobar-rls.ts.';

revoke execute on function public.auditoria_funcions_obertes() from public, anon;
grant execute on function public.auditoria_funcions_obertes() to authenticated, service_role;

-- Verificación: con sesión del equipo, `select * from auditoria_funcions_obertes();` → 0 filas.
