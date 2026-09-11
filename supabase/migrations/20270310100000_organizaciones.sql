-- La organización unificada: la identidad común de las dos tablas de fichas.
--
-- ETAPA 1 DE VARIAS, y conviene saberlo antes de leer: esto **no cierra ninguna deuda**. Es
-- lo que desbloquea las ocho de la brecha 2 (§1bis: 11, 16, 20, 22, 27, 28, 31, 79), y cada
-- una sigue necesitando su trabajo encima. Aquí solo nace la identidad.
--
-- EL PROBLEMA. `productores` y `entidades` son dos tablas sin clave común, así que una
-- organización que dona Y recibe son dos filas que el sistema no sabe que son la misma: el
-- registro público no puede detectar que ya existe, el webhook de WhatsApp desambigua por
-- prioridad, hacen falta dos convenios, y no hay dónde poner un atributo que sea de la
-- organización y no de su papel.
--
-- ⚠️ LO QUE LOS DATOS DICEN, Y QUE CAMBIA EL DISEÑO. La deuda §12.28 afirma que unificar
--    «exigiría deduplicar 111 entidades sin clave única». **Medido el 11-09-2026 contra
--    producción: no hay nada que deduplicar.** De 345 productores y 119 entidades, hay
--    exactamente **cuatro** pares que son la misma organización —los del propio equipo, que
--    §9 ya nombra— y coinciden por correo y teléfono, no por parecido de nombre. Las otras
--    456 fichas son organizaciones distintas entre sí.
--    Y el **NIF no sirve de clave**: lo tiene el 49 % de los productores y el 55 % de las
--    entidades, y **cero** NIF aparecen en las dos tablas.
--    Así que esto no es una migración de fusión con riesgo de juntar lo que no va junto: es
--    una fila por ficha y cuatro enlaces conocidos.
--
-- POR QUÉ `organizaciones` NO GUARDA NI NOMBRE NI NIF. Duplicarlos crearía dos fuentes de
-- verdad para el mismo dato y, en cuanto alguien editara una ficha, la organización diría
-- otra cosa — y nadie sabría cuál manda. Aquí vive **solo lo que no tiene otro sitio**: la
-- identidad y los atributos que son de la organización y no de su papel. Lo demás se lee de
-- las fichas por la vista `v_organizaciones`.
--
-- COMPATIBLE HACIA ATRÁS, que es lo que permite publicarla sin ventana rota: ninguna columna
-- existente cambia de tipo ni de nombre, ninguna FK se mueve, y el frontend que hay en
-- producción sigue funcionando sin enterarse. Las dos columnas nuevas son nullable.

create table if not exists organizaciones (
  id uuid primary key default gen_random_uuid(),

  -- Canal por el que esta organización prefiere que se la contacte. Es el campo que pide el
  -- funcional (§1bis) y la deuda §12.22: hoy el canal se DEDUCE de lo que hay en la ficha
  -- (móvil, opt-in, ventana de 24 h) y la persona no puede decir el suyo. Nulo = seguir
  -- deduciéndolo con `_shared/canal.ts`, que es el comportamiento de siempre.
  canal_preferido text check (canal_preferido in ('whatsapp', 'email')),

  -- Notas del equipo sobre la organización, no sobre su papel. Las fichas ya tienen las
  -- suyas (`productores.comentario`, `entidades.comentarios`) y no se tocan.
  notas text,

  creada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table organizaciones is
  'Identidad común de una organización, que puede tener ficha de productor, de entidad o las '
  'dos. NO guarda nombre ni NIF a propósito: eso vive en las fichas y se lee por '
  'v_organizaciones, para que no haya dos fuentes de verdad. Etapa 1 de la brecha 2 (§1bis).';

-- ---------------------------------------------------------------------------
-- El enlace desde las fichas
-- ---------------------------------------------------------------------------
-- La dirección importa: el puntero va de la ficha a la organización, no al revés. Así una
-- organización puede tener una ficha, dos o —mientras se migra— ninguna, sin que la tabla
-- tenga que saber cuántos papeles existen.
alter table productores add column if not exists organizacion_id uuid references organizaciones(id);
alter table entidades   add column if not exists organizacion_id uuid references organizaciones(id);

create index if not exists productores_organizacion_idx on productores (organizacion_id);
create index if not exists entidades_organizacion_idx   on entidades   (organizacion_id);

-- ⚠️ Una organización tiene como mucho UNA ficha de cada tipo. Sin esto, dos productores
-- podrían apuntar a la misma organización y «la ficha de productor de esta organización»
-- dejaría de ser una pregunta con respuesta — que es exactamente el agujero de §12.31 en la
-- interfaz, trasladado a la base.
create unique index if not exists productores_una_per_organitzacio_uidx
  on productores (organizacion_id) where organizacion_id is not null;
create unique index if not exists entidades_una_per_organitzacio_uidx
  on entidades (organizacion_id) where organizacion_id is not null;

-- ---------------------------------------------------------------------------
-- El relleno: una organización por ficha, y los cuatro pares compartiendo
-- ---------------------------------------------------------------------------
-- Idempotente: solo toca las fichas que todavía no tienen organización, así que volver a
-- aplicarla no duplica nada.
do $$
declare
  f record;
  o uuid;
  n_prod int := 0;
  n_ent  int := 0;
  n_par  int := 0;
begin
  -- 1. Cada productor sin organización estrena la suya.
  for f in select id from productores where organizacion_id is null loop
    insert into organizaciones default values returning id into o;
    update productores set organizacion_id = o where id = f.id;
    n_prod := n_prod + 1;
  end loop;

  -- 2. Las entidades que SON el mismo que un productor se enganchan a la suya.
  --
  --    El criterio es **correo o teléfono exactos**, nunca el parecido del nombre: un
  --    nombre parecido junta organizaciones distintas, y eso aquí significa mezclar los
  --    kilos y el certificado fiscal de dos donantes. Se prefiere dejar dos filas separadas
  --    —el estado de hoy, que funciona— a arriesgar una fusión equivocada.
  --
  --    El teléfono se compara por sus últimas 9 cifras, que es como se guardan los móviles
  --    españoles con y sin prefijo (§7).
  for f in
    select e.id as ent, p.id as prod, p.organizacion_id as org
      from entidades e
      join productores p on (
             (nullif(lower(trim(e.email)),  '') = nullif(lower(trim(p.email)), ''))
          or (nullif(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g'), '') is not null
              and right(regexp_replace(coalesce(e.telefono, ''), '\D', '', 'g'), 9)
                = right(regexp_replace(coalesce(p.phone, ''),   '\D', '', 'g'), 9)
              and length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 9))
     where e.organizacion_id is null and p.organizacion_id is not null
  loop
    -- El índice único protege de que dos entidades caigan en la misma organización; si
    -- pasara, se deja la fila suelta en vez de fallar la migración entera.
    begin
      update entidades set organizacion_id = f.org where id = f.ent;
      n_par := n_par + 1;
    exception when unique_violation then
      raise notice 'entidad % comparte criterio con una organización ya ocupada: se deja suelta', f.ent;
    end;
  end loop;

  -- 3. El resto de entidades estrena la suya.
  for f in select id from entidades where organizacion_id is null loop
    insert into organizaciones default values returning id into o;
    update entidades set organizacion_id = o where id = f.id;
    n_ent := n_ent + 1;
  end loop;

  raise notice 'organizaciones: % de productor, % de entidad, % entidades enganchadas a la de su productor',
    n_prod, n_ent, n_par;
end $$;

-- ---------------------------------------------------------------------------
-- La vista: quién es cada organización, leído de sus fichas
-- ---------------------------------------------------------------------------
-- `security_invoker` obligatorio, como en `v_productores_llistat` (§12.29): sin él la vista
-- correría con los permisos del propietario y **se saltaría la RLS** de las dos tablas, que
-- es lo único que protege las 464 fichas con nombre, NIF, teléfono y dirección.
--
-- El nombre y el NIF salen de la ficha que los tenga, con la del productor por delante
-- cuando hay las dos. No es arbitrario: el productor es quien firma el convenio de donación
-- y quien recibe el certificado fiscal, así que su ficha es la que se ha revisado.
create or replace view v_organizaciones
with (security_invoker = true) as
  select o.id,
         coalesce(p.name, e.nombre)                        as nombre,
         coalesce(nullif(p.nif, ''), nullif(e.nif, ''))     as nif,
         coalesce(nullif(p.email, ''), nullif(e.email, '')) as email,
         coalesce(nullif(p.phone, ''), nullif(e.telefono, '')) as telefono,
         coalesce(p.poblacion, e.poblacion)                 as poblacion,
         p.id      as productor_id,
         e.id      as entidad_id,
         (p.id is not null) as es_generadora,
         (e.id is not null) as es_receptora,
         e.tipo_receptor,
         o.canal_preferido,
         o.created_at
    from organizaciones o
    left join productores p on p.organizacion_id = o.id
    left join entidades   e on e.organizacion_id = o.id;

comment on view v_organizaciones is
  'Quién es cada organización, leído de sus fichas: nunca se duplica el nombre ni el NIF. '
  'Los roles (`es_generadora`, `es_receptora`) son DERIVADOS de tener ficha, no declarados: '
  'una organización es receptora porque tiene ficha de entidad, no porque alguien lo marcara.';

-- ---------------------------------------------------------------------------
-- Helper: la organización de una ficha, y las fichas de una organización
-- ---------------------------------------------------------------------------
create or replace function public.organizacion_de(p_tipo text, p_ficha uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_tipo
    when 'productor' then (select organizacion_id from productores where id = p_ficha)
    when 'entidad'   then (select organizacion_id from entidades   where id = p_ficha)
  end;
$$;

revoke execute on function public.organizacion_de(text, uuid) from public, anon;
grant  execute on function public.organizacion_de(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS y GRANT — las dos capas, como toda tabla nueva (§4)
-- ---------------------------------------------------------------------------
alter table organizaciones enable row level security;

-- Lectura: el equipo, y quien tenga una ficha de esa organización. El puente se hace con las
-- funciones de rol que ya existen, envueltas en `(select …)` para que sean InitPlan.
create policy organizaciones_llegir on organizaciones
  for select to authenticated
  using (
    (select es_intern())
    or id in (select organizacion_id from productores where id in (select mis_productores()))
    or id in (select organizacion_id from entidades   where id in (select mis_entidades()))
  );

-- Ninguna escritura para nadie: como el resto del circuito documental, la superficie de
-- escritura son las RPC `security definer` y `service_role`.
grant select on organizaciones   to authenticated, service_role;
grant select on v_organizaciones to authenticated, service_role;

-- Las dos columnas nuevas de las fichas heredan el GRANT de tabla que ya tienen (§4), pero
-- se deja comprobable, que es la clase de cosa que se da por hecha:
--   select has_column_privilege('authenticated','public.productores','organizacion_id','SELECT');
