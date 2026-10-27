-- Tres interruptores de notificaciones: el general y uno por canal.
--
-- QUÉ ES. Hasta hoy solo había `whatsapp_activo` (20270317100000). Se añaden:
--   · `notificacions_actives` — el interruptor GENERAL. Apagado no sale ninguna notificación
--     operativa, ni por correo ni por WhatsApp.
--   · `email_activo` — el canal de correo, gemelo del de WhatsApp.
--
-- EL CANAL EFECTIVO ES «GENERAL Y CANAL». Los tres helpers de abajo devuelven ya el valor
-- efectivo, así que apagar el general corta aunque alguien escriba un canal a mano.
--
-- APAGAR EL GENERAL APAGA LOS DOS CANALES; ENCENDERLO NO LOS ENCIENDE (decisión del cliente):
-- quien lo reactiva decide canal a canal. Por eso la escritura va por RPC, en una transacción,
-- y no por el upsert directo que usaba Configuració: con dos escrituras sueltas, un fallo a
-- medias dejaría el general apagado y un canal encendido.
--
-- LO QUE NO CORTA: lo transaccional —acceso y bienvenida al aprobar un alta, recuperar la
-- contraseña—. Esa excepción la decide `sendEmail()` en el servidor (§8), no esta base.
--
-- FAIL-SAFE ENCENDIDO, igual que `whatsapp_activo`: solo un 'false' explícito apaga. Esta
-- migración es un no-op hasta que alguien pulse un interruptor.

-- ---------------------------------------------------------------------------
-- 1. Las claves, con el valor de siempre
-- ---------------------------------------------------------------------------
insert into app_settings (key, value) values
  ('notificacions_actives', 'true'),
  ('email_activo',          'true')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Los helpers, ya efectivos
-- ---------------------------------------------------------------------------
create or replace function public.notificacions_actives()
returns boolean
language sql
stable
parallel restricted
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           (select value from app_settings where key = 'notificacions_actives'),
           'true') <> 'false';
$$;

create or replace function public.email_activo()
returns boolean
language sql
stable
parallel restricted
security definer
set search_path = public, pg_temp
as $$
  select public.notificacions_actives()
     and coalesce(
           (select value from app_settings where key = 'email_activo'),
           'true') <> 'false';
$$;

-- `whatsapp_activo()` pasa a devolver el valor EFECTIVO. La heredan sin tocarse
-- `disparar_recordatorios_intake()` y `get_my_session_context()`.
create or replace function public.whatsapp_activo()
returns boolean
language sql
stable
parallel restricted
security definer
set search_path = public, pg_temp
as $$
  select public.notificacions_actives()
     and coalesce(
           (select value from app_settings where key = 'whatsapp_activo'),
           'true') <> 'false';
$$;

revoke execute on function public.notificacions_actives() from public, anon;
revoke execute on function public.email_activo()          from public, anon;
revoke execute on function public.whatsapp_activo()       from public, anon;
grant  execute on function public.notificacions_actives() to authenticated, service_role;
grant  execute on function public.email_activo()          to authenticated, service_role;
grant  execute on function public.whatsapp_activo()       to authenticated, service_role;

comment on function public.notificacions_actives() is
  'Interruptor general de notificaciones operativas. Fail-safe ENCENDIDO.';
comment on function public.email_activo() is
  'Canal de correo EFECTIVO: general y email_activo. Fail-safe ENCENDIDO.';
comment on function public.whatsapp_activo() is
  'Canal de WhatsApp EFECTIVO: general y whatsapp_activo. Fail-safe ENCENDIDO.';

-- ---------------------------------------------------------------------------
-- 3. La escritura: solo por RPC y solo el super_admin
-- ---------------------------------------------------------------------------
-- Con `false`, las tres claves a 'false' en la misma transacción. Con `true`, SOLO el general.
create or replace function public.fixar_notificacions(p_actives boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.es_super_admin() then
    raise exception 'no_autoritzat' using errcode = '42501';
  end if;
  if p_actives is null then
    raise exception 'valor_invalid' using errcode = '22023';
  end if;

  if p_actives then
    insert into app_settings (key, value) values ('notificacions_actives', 'true')
      on conflict (key) do update set value = excluded.value;
  else
    insert into app_settings (key, value) values
      ('notificacions_actives', 'false'),
      ('email_activo',          'false'),
      ('whatsapp_activo',       'false')
      on conflict (key) do update set value = excluded.value;
  end if;
end;
$$;

-- Un canal. Encenderlo con el general apagado se niega: el canal no serviría de nada y la
-- pantalla diría «activat» de algo que no envía.
create or replace function public.fixar_canal_notificacio(p_canal text, p_actiu boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clau text;
begin
  if auth.uid() is null or not public.es_super_admin() then
    raise exception 'no_autoritzat' using errcode = '42501';
  end if;
  v_clau := case p_canal when 'email' then 'email_activo'
                         when 'whatsapp' then 'whatsapp_activo' end;
  if v_clau is null then
    raise exception 'canal_desconegut' using errcode = '22023';
  end if;
  if p_actiu is null then
    raise exception 'valor_invalid' using errcode = '22023';
  end if;
  if p_actiu and not public.notificacions_actives() then
    raise exception 'notificacions_desactivades' using errcode = '22023',
      detail = 'Activa primer les notificacions.';
  end if;

  insert into app_settings (key, value) values (v_clau, case when p_actiu then 'true' else 'false' end)
    on conflict (key) do update set value = excluded.value;
end;
$$;

revoke execute on function public.fixar_notificacions(boolean)           from public, anon, service_role;
revoke execute on function public.fixar_canal_notificacio(text, boolean) from public, anon, service_role;
grant  execute on function public.fixar_notificacions(boolean)           to authenticated;
grant  execute on function public.fixar_canal_notificacio(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_my_session_context(): `email_actiu` y `notificacions_actives`
-- ---------------------------------------------------------------------------
-- Cuerpo de 20270317100000 letra por letra, más las dos claves. ⚠️ `parallel restricted`
-- explícito: `create or replace` reescribe todos los atributos.
create or replace function public.get_my_session_context()
returns jsonb
language sql
stable
parallel restricted
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'user_id',        p.id,
    'email',          p.email,
    'nombre',         p.nombre,
    'idioma',         p.idioma,
    'activo',         p.activo,
    'rol',            public.mi_rol(),
    'roles_activos',  public.roles_activos(),
    'es_intern',      public.mi_rol() is not null,
    'pot_aprovar',    coalesce(public.mi_rol() in ('super_admin', 'admin'), false),
    'es_super_admin', coalesce(public.mi_rol() = 'super_admin', false),
    -- Los tres ya efectivos: `whatsapp_actiu` y `email_actiu` son falsos con el general apagado.
    'whatsapp_actiu', public.whatsapp_activo(),
    'email_actiu',    public.email_activo(),
    'notificacions_actives', public.notificacions_actives(),
    'vista_defecto',  coalesce(
        p.vista_defecto,
        case
          when public.mi_rol() is not null then 'intern'
          when exists (select 1 from membresias m
                        where m.user_id = p.id and m.activo and m.productor_id is not null)
            then 'productor'
          when exists (select 1 from membresias m
                        where m.user_id = p.id and m.activo and m.entidad_id is not null)
            then 'receptor'
        end),
    'registre_pendent', exists (
        select 1 from membresias m
         where m.user_id = p.id and m.aprovacio = 'pendent'),
    'registre_rebutjat', exists (
        select 1 from membresias m
         where m.user_id = p.id and m.aprovacio = 'rebutjada')
      and not exists (
        select 1 from membresias m
         where m.user_id = p.id and m.activo),
    'conveni_pendent', exists (
        select 1 from convenios c
          join membresias m on (m.productor_id = c.productor_id or m.entidad_id = c.entidad_id)
         where m.user_id = p.id and m.activo
           and c.estado in ('pendent_firma', 'retornat')),
    'organizaciones', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'tipo',          m.tipo,
                 'id',            coalesce(m.productor_id, m.entidad_id),
                 'nombre',        coalesce(pr.empresa, pr.name, en.nombre),
                 'rol_org',       m.rol_org,
                 'tipo_receptor', en.tipo_receptor,
                 'modalitat',     en.modalitat,
                 'poblacion',     coalesce(pr.poblacion, en.poblacion))
               order by m.tipo, m.created_at)
          from membresias m
          left join productores pr on pr.id = m.productor_id
          left join entidades   en on en.id = m.entidad_id
         where m.user_id = p.id and m.activo), '[]'::jsonb))
    from perfiles p
   where p.id = auth.uid();
$$;

revoke execute on function public.get_my_session_context() from public, anon;
grant  execute on function public.get_my_session_context() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. documento_envios: un envío cortado por un interruptor queda trazado como tal
-- ---------------------------------------------------------------------------
-- `desactivat` y no `error`: no ha fallado nada, alguien ha apagado el canal. La pestaña
-- Enviaments lo enseña y «Reenvia» funciona después (su freno solo mira enviat/simulat).
alter table documento_envios
  drop constraint if exists documento_envios_estado_check;
alter table documento_envios
  add constraint documento_envios_estado_check
    check (estado in ('pendent', 'enviat', 'simulat', 'error', 'desactivat'));
