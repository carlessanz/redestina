-- Que se vea cuáles son las fichas de un alta rechazada.
--
-- EL PROBLEMA (deuda §12.29). `rebutjar_registre()` no borra nada **a propósito**: queda la
-- auditoría y la persona puede leer el motivo. Pero solo marca la **membresía**; la fila de
-- `productores` o `entidades` que creó `registro/index.ts` se queda intacta y **sin ninguna
-- marca**, así que aparece en los listados del equipo como una organización más. Hasta que
-- el super_admin la borre a mano, nadie sabe mirándola que su alta se rechazó.
--
-- Y no había por dónde filtrar: `aprovacio` vive en `membresias`, no en las tablas de fichas.
--
-- LA DECISIÓN: marcar, no esconder.
--
-- Esconderlas del listado sería lo fácil y sería un error: **el super_admin llega a la ficha
-- desde ese listado**, y es quien tiene que borrarla. Una organización invisible es una
-- organización que no se puede limpiar, así que el problema pasaría de «ruido» a «residuo
-- inalcanzable» — que es peor, y es justo lo que ya pasó con `email_test_recipients` (§12.33).
--
-- Las vistas añaden una columna derivada `rebutjada`. La pantalla decide qué hacer con ella;
-- la base solo dice la verdad.
--
-- ⚠️ `security_invoker = true` es obligatorio y no es un detalle: sin él la vista corre con
-- los permisos de quien la creó (el propietario) y **se salta la RLS de la tabla de debajo**,
-- que es exactamente lo que protege las 452 fichas con nombre, NIF, teléfono y dirección.
-- Con él, la vista no añade ni un permiso: filtra lo mismo que un `select` directo.

create or replace view public.v_productores_llistat
with (security_invoker = true) as
  select p.*,
         exists (
           select 1 from membresias m
            where m.productor_id = p.id
              and m.aprovacio = 'rebutjada'
         ) as rebutjada
    from productores p;

create or replace view public.v_entidades_llistat
with (security_invoker = true) as
  select e.*,
         exists (
           select 1 from membresias m
            where m.entidad_id = e.id
              and m.aprovacio = 'rebutjada'
         ) as rebutjada
    from entidades e;

comment on view public.v_productores_llistat is
  'Productores con la marca derivada `rebutjada` (alta del registro público rechazada). '
  'security_invoker: no añade ningún permiso sobre `productores` (deuda §12.29).';
comment on view public.v_entidades_llistat is
  'Entidades con la marca derivada `rebutjada`. security_invoker, igual que la de productores.';

-- Las vistas necesitan su propio GRANT: heredar el de la tabla no basta (§4). `anon` no
-- recibe nada, como en todo el esquema.
grant select on public.v_productores_llistat to authenticated, service_role;
grant select on public.v_entidades_llistat  to authenticated, service_role;

-- El índice que hace barata la columna derivada: sin él, cada fila del listado dispara una
-- búsqueda secuencial en `membresias`. Parcial, porque solo interesan las rechazadas y son
-- una minoría diminuta.
create index if not exists membresias_rebutjades_idx
  on membresias (productor_id, entidad_id) where aprovacio = 'rebutjada';
