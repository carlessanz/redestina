-- UN SOLO COSTE POR PRODUCTO, sin ejercicio (27-09-2026, decisión del cliente).
--
-- Hasta hoy `costes_producto` tenía clave `(producto, ejercicio)` y la pantalla obligaba a
-- elegir año para poner un precio. Carles: «el precio es uno y, si se tiene que actualizar,
-- se actualizará en el momento y quedará ese precio». Y además ese precio pasa a ser solo
-- una REFERENCIA: el coste de cada oferta lo declara el productor al publicarla
-- (`excedentes.coste_kg`, 20270405100100), partiendo de esta referencia.
--
-- QUÉ NO CAMBIA, Y ES LO QUE PROTEGE LO FISCAL: el cierre y los certificados leen
-- `canalizaciones.coste_kg`, que se copia al crear la canalización y se CONGELA al
-- conciliar. Cambiar hoy la referencia no toca nada ya conciliado, y las funciones
-- `cierre_*`/`calcular_*` no leen `costes_producto` (verificado contra la base).
--
-- Decidido con Carles: un precio nuevo afecta a las canalizaciones que se creen DESPUÉS;
-- las ya creadas con precio lo conservan. Si una llega a conciliar sin precio, se usa el de
-- la oferta o, si no hay, la referencia vigente.
--
-- Se recrean las ocho funciones que miraban el ejercicio, partiendo de su definición VIVA
-- (sacada de la base, no de las migraciones: `pendents_equip` corre la copia de
-- 20260921221806). Solo cambian las líneas del coste.
--
-- Permisos sin cambios: fijar la referencia `pot_aprovar()`, borrarla `es_super_admin()`.

-- 1. La tabla. Si hubiera un producto con varios años, se queda el más reciente.
delete from costes_producto c
 using costes_producto d
 where d.producto = c.producto and d.ejercicio > c.ejercicio;

alter table costes_producto drop constraint costes_producto_pkey;
alter table costes_producto drop column ejercicio;
alter table costes_producto add primary key (producto);

comment on table costes_producto is
  'Coste por kilo de REFERENCIA de cada producto (uno, sin ejercicio). El de cada oferta lo '
  'declara el productor en excedentes.coste_kg; la canalización lo copia y lo congela al conciliar.';

-- Las 79 filas del histórico eran TODAS del arnés de RLS: fijaba un coste de Tomàquet en el
-- «ejercicio 1999» y lo borraba en cada pasada. Con un solo coste por producto aparecerían
-- como historia real de Tomàquet en su detalle, y el arnés ya no escribe (su check de
-- `fijar_coste_producto` pasa a medir la autorización con un coste 0, que no escribe nada).
delete from costes_producto_hist
 where ejercicio = 1999 and motivo like '%arnés de RLS%';

-- El histórico conserva el año de las filas viejas; las nuevas llegan sin él.
alter table costes_producto_hist alter column ejercicio drop not null;
drop index if exists costes_producto_hist_idx;
create index if not exists costes_producto_hist_idx
  on costes_producto_hist (producto, vigente_hasta desc);

-- 2. El histórico por trigger, sin ejercicio.
create or replace function public.trg_costes_producto_hist()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.motivo is null or btrim(new.motivo) = '' then
    raise exception 'Cal indicar d''on surt el cost per quilo (motiu)' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and (old.coste_kg is distinct from new.coste_kg) then
    insert into costes_producto_hist (producto, coste_kg, motivo, fijado_por,
                                      vigente_desde, vigente_hasta)
    values (old.producto, old.coste_kg, old.motivo, old.fijado_por, old.updated_at, now());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- 3. Fijar y borrar la referencia: nueva firma, sin `p_ejercicio`.
drop function if exists public.fijar_coste_producto(text, int, numeric, text);
create or replace function public.fijar_coste_producto(p_producto text, p_coste numeric, p_motivo text)
returns costes_producto
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f costes_producto%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden fixar el cost per quilo'
      using errcode = '42501';
  end if;
  if p_coste is null or p_coste <= 0 then
    raise exception 'El cost per quilo ha de ser mes gran que zero' using errcode = '22023';
  end if;
  if not exists (select 1 from productos where nombre = p_producto) then
    raise exception 'El producte % no es al cataleg', p_producto using errcode = '23503';
  end if;

  insert into costes_producto (producto, coste_kg, motivo, fijado_por)
  values (p_producto, p_coste, p_motivo, auth.uid())
  on conflict (producto) do update
     set coste_kg   = excluded.coste_kg,
         motivo     = excluded.motivo,
         fijado_por = excluded.fijado_por
  returning * into f;
  return f;
end;
$$;
revoke execute on function public.fijar_coste_producto(text, numeric, text) from public, anon;
grant  execute on function public.fijar_coste_producto(text, numeric, text) to authenticated, service_role;

drop function if exists public.borrar_coste_producto(text, int, text);
create or replace function public.borrar_coste_producto(p_producto text, p_motivo text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c costes_producto%rowtype;
  n int;
begin
  -- `es_super_admin()`, no `pot_aprovar()`: borrar una referencia económica es más grave
  -- que fijarla (20261012100000).
  if auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin pot esborrar un cost per quilo' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Cal indicar per que s''esborra el cost per quilo (motiu)' using errcode = '22023';
  end if;

  select * into c from costes_producto where producto = p_producto for update;
  if c.producto is null then
    return 0;   -- Nada que borrar y nada que historiar: no es un error.
  end if;

  insert into costes_producto_hist (producto, coste_kg, motivo, fijado_por,
                                    vigente_desde, vigente_hasta)
  values (c.producto, c.coste_kg,
          '[esborrat] ' || btrim(p_motivo) ||
            ' (motiu original: ' || coalesce(c.motivo, '—') || ')',
          coalesce(auth.uid(), c.fijado_por), c.updated_at, now());

  delete from costes_producto where producto = p_producto;
  get diagnostics n = row_count;
  return n;
end;
$$;
comment on function public.borrar_coste_producto(text, text) is
  'Borra el coste de referencia (solo super_admin) dejando la fila en costes_producto_hist con motivo [esborrat].';
revoke execute on function public.borrar_coste_producto(text, text) from public, anon;
grant  execute on function public.borrar_coste_producto(text, text) to authenticated, service_role;

-- 4. La canalización copia al CREARSE el coste de la oferta y, si el productor no declaró
--    ninguno, la referencia vigente del producto. Si no hay ninguno de los dos se queda
--    null A PROPÓSITO: bloquea el cierre, que es lo que tiene que pasar (20261012100100).
create or replace function public.trg_canalizaciones_valoriza()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_producto text;
  v_coste    numeric;
begin
  if new.valorizacion is null and new.excedente_id is not null then
    select e.modalitat into new.valorizacion from excedentes e where e.id = new.excedente_id;
  end if;

  if new.coste_kg is null and new.excedente_id is not null then
    select e.producto, e.coste_kg into v_producto, v_coste
      from excedentes e where e.id = new.excedente_id;
    new.coste_kg := v_coste;
    if new.coste_kg is null and v_producto is not null then
      select c.coste_kg into new.coste_kg from costes_producto c where c.producto = v_producto;
    end if;
  end if;

  return new;
end;
$$;

-- 5. Las cuatro que leían el coste «del ejercicio», con su cuerpo vivo intacto salvo eso.
-- canalitzacio_assistida
CREATE OR REPLACE FUNCTION public.canalitzacio_assistida(p_excedente uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ex  excedentes%rowtype;
  res jsonb;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot veure una canalitzacio assistida'
      using errcode = '42501';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null then
    raise exception 'Aquesta oferta no existeix' using errcode = 'PT404';
  end if;

  select jsonb_build_object(
    'oferta', jsonb_build_object(
      'id', ex.id, 'id_excedente', ex.id_excedente, 'estado', ex.estado,
      'modalitat', ex.modalitat, 'producto', ex.producto, 'kg_total', ex.kg_total,
      'preu_minim', ex.preu_minim, 'disponible_hasta', ex.disponible_hasta,
      'origen', ex.origen, 'espigolada_id', ex.espigolada_id,
      'created_at', ex.created_at),

    'productor', (select jsonb_build_object('id', p.id,
                           'nom', coalesce(p.empresa, p.name),
                           'email', p.email, 'telefon', p.phone,
                           'organizacion_id', p.organizacion_id)
                    from productores p where p.id = ex.productor_id),

    'conveni_gen', (
      select jsonb_build_object('id', c.id, 'tipo', c.tipo, 'estado', c.estado,
                                'numero', c.numero_completo, 'enviado_at', c.enviado_at)
        from convenios c
        join convenios_exigidos ce
          on ce.tipo_convenio = c.tipo and ce.valorizacion = ex.modalitat
         and ce.parte = 'entrega'
       where c.productor_id = ex.productor_id
         and c.estado <> 'substituit'
       order by case c.estado when 'vigent' then 0 when 'firmat' then 1
                              when 'pendent_firma' then 2 else 3 end
       limit 1),

    'respostes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'entidad_id', r.entidad_id,
               'entitat', coalesce(e.nombre, '(sense fitxa)'),
               'email', e.email, 'tipo_receptor', e.tipo_receptor,
               'canal', r.canal, 'estado', r.estado, 'aprovacio', r.aprovacio,
               'kg_solicitados', r.kg_solicitados, 'preu_ofert', r.preu_ofert,
               'canalizacion_id', r.canalizacion_id,
               'conveni_rec', (
                 select jsonb_build_object('id', c2.id, 'estado', c2.estado,
                                           'numero', c2.numero_completo)
                   from convenios c2
                   join convenios_exigidos ce2
                     on ce2.tipo_convenio = c2.tipo and ce2.valorizacion = ex.modalitat
                    and ce2.parte = 'recibe'
                  where c2.entidad_id = r.entidad_id and c2.estado <> 'substituit'
                  order by case c2.estado when 'vigent' then 0 when 'firmat' then 1
                                          when 'pendent_firma' then 2 else 3 end
                  limit 1))
               order by r.created_at)
        from oferta_respuestas r
        left join entidades e on e.id = r.entidad_id
       where r.excedente_id = ex.id), '[]'::jsonb),

    'canalitzacions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ca.id, 'entidad_id', ca.entidad_id,
               'entitat', e.nombre,
               'kg_confirmados', ca.kg_confirmados, 'kg_reales', ca.kg_reales,
               'kg_conciliados', ca.kg_conciliados,
               'conciliada_at', ca.conciliada_at, 'coste_kg', ca.coste_kg)
               order by ca.created_at)
        from canalizaciones ca
        left join entidades e on e.id = ca.entidad_id
       where ca.excedente_id = ex.id), '[]'::jsonb),

    'albarans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', al.id, 'tipo', al.tipo, 'estado', al.estado,
               'numero', al.numero_completo, 'canalizacion_id', al.canalizacion_id,
               'emitido_at', al.emitido_at, 'entregado_at', al.entregado_at,
               'confirmado_at', al.confirmado_at, 'conciliado_at', al.conciliado_at,
               'rechazo', al.rechazo)
               order by al.tipo, al.created_at)
        from albaranes al
       where al.excedente_id = ex.id
          or al.canalizacion_id in (select id from canalizaciones where excedente_id = ex.id)
          or (ex.espigolada_id is not null and al.espigolada_id = ex.espigolada_id)),
      '[]'::jsonb),

    'cost_falten', (
      select count(*) from (select distinct ex.producto as prod) x
       where ex.coste_kg is null
         and not exists (select 1 from costes_producto cp where cp.producto = x.prod)),

    'exercici', (
      select jsonb_build_object('id', ce3.id, 'ejercicio', ce3.ejercicio,
                                'modo', ce3.modo, 'estado', ce3.estado)
        from cierres_ejercicio ce3
       where ce3.ejercicio = extract(year from coalesce(ex.created_at, now()))::int
       order by case ce3.modo when 'real' then 0 else 1 end
       limit 1)
  ) into res;

  return res;
end;
$function$;

-- conciliacion_retroactiva
CREATE OR REPLACE FUNCTION public.conciliacion_retroactiva(p_canalizacion uuid, p_kg numeric, p_coste numeric DEFAULT NULL::numeric, p_motivo text DEFAULT NULL::text)
 RETURNS canalizaciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c       canalizaciones%rowtype;
  v_coste numeric;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar fa una conciliacio retroactiva' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Una conciliacio retroactiva necessita motiu' using errcode = '22023';
  end if;
  if p_kg is null or p_kg <= 0 then
    raise exception 'Els quilos han de ser positius' using errcode = '22023';
  end if;

  select * into c from canalizaciones where id = p_canalizacion for update;
  if c.id is null then
    raise exception 'Aquesta canalitzacio no existeix' using errcode = '22023';
  end if;
  if c.estado = 'conciliada' then
    raise exception 'Aquesta canalitzacio ja esta conciliada' using errcode = '22023';
  end if;
  if exists (select 1 from albaranes a
              where a.canalizacion_id = c.id and a.estado not in ('borrador', 'anulado')) then
    raise exception 'Aquesta canalitzacio te albara emes: concilia''l amb conciliar_albaran()'
      using errcode = '22023';
  end if;

  v_coste := coalesce(p_coste, c.coste_kg);
  if v_coste is null then
    -- El coste que declaró el productor en la oferta; si no declaró ninguno, la
    -- referencia vigente del producto (20270405100200).
    select coalesce(e.coste_kg, (select cp.coste_kg from costes_producto cp
                                  where cp.producto = e.producto))
      into v_coste from excedentes e where e.id = c.excedente_id;
  end if;

  update canalizaciones
     set kg_conciliados           = p_kg,
         kg_reales                = coalesce(kg_reales, p_kg),
         coste_kg                 = v_coste,
         estado                   = 'conciliada',
         conciliada_at            = now(),
         conciliada_por           = auth.uid(),
         motivo_conciliacion      = p_motivo,
         conciliacion_retroactiva = true
   where id = p_canalizacion
  returning * into c;
  return c;
end;
$function$;

-- conciliar_albaran
CREATE OR REPLACE FUNCTION public.conciliar_albaran(p_id uuid, p_kg_validados jsonb DEFAULT NULL::jsonb, p_motivo text DEFAULT NULL::text, p_destino_final text DEFAULT NULL::text)
 RETURNS albaranes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a        albaranes%rowtype;
  par      parametros_documentales%rowtype;
  k        jsonb;
  v_total  numeric;
  v_coste  numeric;
  v_prod   text;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot conciliar un albara' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado not in ('entregado', 'confirmado') then
    raise exception 'Nomes es concilia un albara entregat o confirmat' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  if a.confirmado_at is null then
    if a.entregado_at is null
       or a.entregado_at + make_interval(days => coalesce(par.plazo_conciliar_sin_confirmacion_dias, 7)) > now() then
      raise exception 'Encara no ha vencut el termini de confirmacio: cal esperar o rebre la confirmacio'
        using errcode = '22023';
    end if;
    if coalesce(btrim(p_motivo), '') = '' then
      raise exception 'Conciliar sense confirmacio necessita motiu' using errcode = '22023';
    end if;
  end if;

  if p_kg_validados is null then
    update albaran_lineas
       set kg_validados = coalesce(kg_confirmados, kg_neto, kg_previstos)
     where albaran_id = a.id;
  else
    for k in select * from jsonb_array_elements(p_kg_validados) loop
      update albaran_lineas
         set kg_validados = (k->>'kg')::numeric
       where id = (k->>'linea_id')::uuid and albaran_id = a.id;
    end loop;
  end if;

  select coalesce(sum(kg_validados), 0) into v_total
    from albaran_lineas where albaran_id = a.id;

  update albaranes
     set estado              = 'conciliado',
         conciliado_at       = now(),
         conciliado_por      = auth.uid(),
         motivo_conciliacion = p_motivo,
         destino_final       = coalesce(p_destino_final, a.destino_final)
   where id = a.id
  returning * into a;

  -- La canalización: kilos conciliados y coste congelado. Si el coste seguía en null se
  -- intenta una última vez con `costes_producto` del ejercicio del albarán; si tampoco
  -- está, se queda null y **bloquea el cierre**, que es lo que tiene que pasar (D).
  if a.canalizacion_id is not null then
    select e.producto into v_prod
      from excedentes e join canalizaciones c on c.excedente_id = e.id
     where c.id = a.canalizacion_id;
    select c.coste_kg into v_coste from canalizaciones c where c.id = a.canalizacion_id;
    if v_coste is null and v_prod is not null then
      -- El coste que declaró el productor en la oferta; si no, la referencia vigente
      -- del producto (20270405100200). Ya no hay coste «del ejercicio».
      select coalesce(e.coste_kg, (select cp.coste_kg from costes_producto cp
                                    where cp.producto = e.producto))
        into v_coste
        from excedentes e join canalizaciones c on c.excedente_id = e.id
       where c.id = a.canalizacion_id;
    end if;

    update canalizaciones
       set kg_conciliados      = v_total,
           kg_reales           = coalesce(kg_reales, v_total),
           coste_kg            = v_coste,
           estado              = 'conciliada',
           conciliada_at       = now(),
           conciliada_por      = auth.uid(),
           motivo_conciliacion = p_motivo
     where id = a.canalizacion_id;
  end if;

  -- La versión definitiva del PDF, que sustituye a la emitida.
  perform public.albaran_emet_document(a.id, 'conciliat', null);

  return a;
end;
$function$;

-- pendents_equip
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
  cues as (
    -- ⚠️ Las columnas del CTE NO se llaman `cua`, `n`, `ref` ni `detall`: esos cuatro
    --    nombres son los parámetros OUT de la función, y en plpgsql un identificador que
    --    coincide con una variable se sustituye por ella. `return query` casa por
    --    POSICIÓN, así que llamarlas distinto no cuesta nada y elimina la ambigüedad.
    select 1 as ordre, 'registres'::text as clau,
           (select count(*) from membresias m where m.aprovacio = 'pendent')::int as quants,
           null::uuid as objecte, null::jsonb as extra
    union all
    select 2, 'convenis_contrasignar',
           (select count(*) from convenios cv where cv.estado = 'firmat')::int, null, null
    union all
    select 3, 'respostes',
           (select count(*) from oferta_respuestas r
             where r.estado = 'acceptada' and r.aprovacio = 'pendent')::int, null, null
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
    select 6, 'ofertes_vencudes',
           (select count(*) from excedentes e, param p
             where e.estado in ('publicada', 'parcial')
               and e.disponible_hasta < p.avui)::int, null, null
    union all
    select 7, 'albarans_esborrany',
           (select count(*) from albaranes a where a.estado = 'borrador')::int, null, null
    union all
    select 8, 'albarans_conciliar',
           (select count(*) from albaranes a
             where a.tipo = 'REC' and a.estado in ('entregado', 'confirmado'))::int,
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
  )
  select q.clau, q.quants, q.objecte, q.extra from cues q order by q.ordre;
end;
$function$;
