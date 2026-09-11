-- `enlaces_token.rol_parte`: de qué parte es cada enlace de confirmación.
-- Cierra la deuda §12.68.
--
-- EL DEFECTO. `marcar_entregado()` crea los enlaces con un `union all` de tres ramas —la
-- entidad que recibe, el generador, y el generador de una espigolada— y al escribirlos
-- **pierde de cuál venían**: `enlaces_token` solo guarda correo y nombre. En un REC o un
-- ENT da igual, porque hay un solo enlace y la parte se deduce del tipo de albarán. En un
-- **OPE se crean dos** (§3.3.2: en venta y maquila confirman las dos partes) y quedan
-- indistinguibles: la ficha del albarán los pinta uno debajo de otro sin poder decir cuál
-- es el que entrega y cuál el que recibe, y el mismo problema tiene la página pública de
-- confirmación, que no sabe a quién le está hablando.
--
-- EL VOCABULARIO ES EL DE `albaran_partes()`, no uno nuevo: `entrega` y `recibe` son las
-- dos claves del snapshot que ya se congela en `albaranes.partes` y que imprime el PDF.
-- Así la ficha puede casar el enlace con la parte sin traducir nada.
--
--   REC -> el generador entrega, Espigoladors recibe          => enlace del generador: 'entrega'
--   ENT -> Espigoladors entrega, la entidad recibe            => enlace de la entidad:  'recibe'
--   OPE -> el generador entrega, la entidad recibe            => uno de cada
--
-- ⚠️ LA COLUMNA ES NULLABLE, Y ESO NO ES PROVISIONAL. Los enlaces creados antes de esta
--    migración se quedan sin rol y **no se rellenan a posteriori**: deducirlo hoy exigiría
--    volver a casar correos con fichas que pueden haber cambiado, y un dato inventado en
--    una tabla de evidencia vale menos que un hueco honesto. Quien lo pinte tiene que
--    aguantar el null (y en REC/ENT puede seguir deduciéndolo del tipo del albarán).

alter table enlaces_token
  add column if not exists rol_parte text
    check (rol_parte in ('entrega', 'recibe'));

comment on column enlaces_token.rol_parte is
  'Parte del albarán a la que pertenece el enlace (entrega/recibe), con el vocabulario de albaran_partes(). NULL en los enlaces anteriores a 20270304.';

-- ⚠️ SIN ESTE GRANT LA COLUMNA NO EXISTE PARA NADIE. `enlaces_token` tiene el SELECT
--    concedido **por columnas** (20260928100300), para dejar fuera `token_hash` y
--    `codigo_hash`; una columna nueva NO hereda nada de eso —los default privileges
--    valen para tablas nuevas, no para columnas nuevas—, así que sin esta línea la ficha
--    del albarán se llevaría `42501 permission denied for column rol_parte`.
grant select (rol_parte) on enlaces_token to authenticated;

-- ---------------------------------------------------------------------------
-- marcar_entregado(): escribir el rol en las tres ramas
-- ---------------------------------------------------------------------------
-- Se recrea entera (es la de 20261012100500 con `rol` en el `union all`, en el `insert` y
-- en el jsonb de salida). El resto —el bloqueo de la fila, la generación del token, la
-- caducidad y el hecho de que el token en claro solo exista aquí— no cambia.
create or replace function public.marcar_entregado(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a        albaranes%rowtype;
  par      parametros_documentales%rowtype;
  v_dest   record;
  v_token  text;
  v_id     uuid;
  v_res    jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot marcar un albara com a entregat' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado <> 'emitido' then
    raise exception 'Nomes es pot marcar entregat un albara emes' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  update albaranes set estado = 'entregado', entregado_at = now() where id = a.id
  returning * into a;

  for v_dest in
    select * from (
      -- La entidad receptora (ENT y OPE): es la parte que RECIBE.
      select e.email as email, coalesce(e.contacto, e.nombre) as nombre, 'recibe' as rol
        from entidades e
        join canalizaciones c on c.entidad_id = e.id
       where c.id = a.canalizacion_id and a.tipo in ('ENT', 'OPE')
      union all
      -- El generador (REC y OPE): es la parte que ENTREGA en los dos casos.
      select p.email, coalesce(p.empresa, p.name), 'entrega'
        from productores p
        join excedentes ex on ex.productor_id = p.id
       where ex.id = a.excedente_id and a.tipo in ('REC', 'OPE')
      union all
      -- El generador de una espigolada (REC sin excedente): también entrega.
      select p.email, coalesce(p.empresa, p.name), 'entrega'
        from productores p
        join espigoladas es on es.productor_id = p.id
       where es.id = a.espigolada_id and a.tipo = 'REC'
    ) d
    where d.email is not null and btrim(d.email) <> ''
  loop
    -- 32 bytes aleatorios en base64url. Solo viaja en el correo; aquí queda el hash.
    --
    -- ⚠️ NO se usa `gen_random_bytes()` de pgcrypto aunque la fase 1 instale la extensión:
    --    en Supabase vive en el esquema `extensions`, y estas funciones llevan
    --    `search_path = public, pg_temp` (obligatorio en una `security definer`), así que
    --    la llamada falla con `42883 function does not exist`. Cualificarla como
    --    `extensions.gen_random_bytes` ataría la migración a la disposición de esquemas de
    --    Supabase. La aleatoriedad sale de dos `gen_random_uuid()` —que sí es built-in de
    --    Postgres— más el reloj: 244 bits de entropía, resumidos con `sha256()`, que
    --    también es built-in. Del token en claro solo se guarda su huella.
    v_token := rtrim(translate(
      encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                               clock_timestamp()::text, 'UTF8')), 'base64'),
      '+/', '-_'), '=');

    insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                               destinatario_email, destinatario_nombre, rol_parte,
                               token_hash, caduca_at, creado_por)
    values ('confirmacion_albaran', 'albaran', a.id,
            v_dest.email, v_dest.nombre, v_dest.rol,
            encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
            now() + make_interval(days => coalesce(par.caducidad_confirmacion_dias, 15)),
            auth.uid())
    returning id into v_id;

    -- `rol_part` en la salida: quien manda el correo (o el panel, en el modelo asistido)
    -- necesita saber a quién le está escribiendo cuando hay dos enlaces.
    v_res := v_res || jsonb_build_object(
      'id', v_id, 'destinatari', v_dest.email, 'nom', v_dest.nombre,
      'rol_part', v_dest.rol, 'token', v_token);
  end loop;

  return jsonb_build_object('albara', to_jsonb(a), 'enllacos', v_res);
end;
$$;

comment on function public.marcar_entregado(uuid) is
  'Marca el albarán entregado y crea los enlaces de confirmación (uno por parte, con su rol_parte). Devuelve los tokens en claro.';

-- ---------------------------------------------------------------------------
-- resolver_enlace(): devolver también el rol
-- ---------------------------------------------------------------------------
-- ⚠️ `create or replace` NO sirve aquí: cambia el tipo de retorno de una función que
--    devuelve `table (...)` y Postgres lo rechaza («cannot change return type»). Hay que
--    borrarla y crearla, y **volver a poner el revoke/grant**, que el `drop` se lleva.
--
-- Es un campo más, así que quien ya la consume (`enlace-publico`) sigue funcionando sin
-- tocar nada. Sigue sin devolver `token_hash` ni `codigo_hash`, por lo de siempre.
drop function if exists public.resolver_enlace(text);

create function public.resolver_enlace(p_token_hash text)
returns table (
  id                     uuid,
  proposito              text,
  objeto_tipo            text,
  objeto_id              uuid,
  destinatario_email     text,
  destinatario_nombre    text,
  canal                  text,
  rol_parte              text,
  caduca_at              timestamptz,
  codigo_caduca_at       timestamptz,
  tiene_codigo           boolean,
  abierto_at             timestamptz,
  usado_at               timestamptz,
  estado                 text,
  estado_efectivo        text,
  recordatorios          int,
  ultimo_recordatorio_at timestamptz,
  created_at             timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id,
         e.proposito,
         e.objeto_tipo,
         e.objeto_id,
         e.destinatario_email,
         e.destinatario_nombre,
         e.canal,
         e.rol_parte,
         e.caduca_at,
         e.codigo_caduca_at,
         (e.codigo_hash is not null)          as tiene_codigo,
         e.abierto_at,
         e.usado_at,
         e.estado,
         case
           when e.estado <> 'activo'    then e.estado
           when e.usado_at is not null  then 'usado'
           when e.caduca_at < now()     then 'caducado'
           else 'activo'
         end                                   as estado_efectivo,
         e.recordatorios,
         e.ultimo_recordatorio_at,
         e.created_at
    from enlaces_token e
   where e.token_hash = p_token_hash;
$$;

comment on function public.resolver_enlace(text) is
  'Abre un enlace por el hash de su token. Devuelve estado_efectivo (caducidad al vuelo), rol_parte y nunca las credenciales.';

revoke execute on function public.resolver_enlace(text) from public, anon, authenticated;
grant  execute on function public.resolver_enlace(text) to service_role;

-- Verificación:
--   select has_column_privilege('authenticated','public.enlaces_token','rol_parte','SELECT');   -- t
--   select has_column_privilege('authenticated','public.enlaces_token','token_hash','SELECT');  -- f
--   select rol_parte, destinatario_email from enlaces_token where objeto_id = '<ope>';
