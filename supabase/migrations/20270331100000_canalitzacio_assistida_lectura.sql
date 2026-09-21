-- ---------------------------------------------------------------------------
-- Las dos lecturas de la canalización asistida
-- ---------------------------------------------------------------------------
-- La pantalla guiada necesita, de un lote, TODO el estado del ciclo a la vez: el
-- convenio del generador, la oferta, los intereses, los albaranes y el cierre. Hacerlo
-- con ocho `select` desde el navegador es ocho viajes y ocho sitios donde la RLS puede
-- devolver algo distinto de lo que la pantalla supone.
--
-- ⚠️ SON `security definer`, ASÍ QUE PODRÍAN DEVOLVER LO QUE NO DEBEN. Lo que hoy
--    protege `enlaces_token.token_hash` y `codigo_hash` es el GRANT por columnas, y una
--    `definer` se lo salta sin avisar. Por eso estas dos **no leen `enlaces_token` en
--    absoluto**: de lo pendiente de firmar o confirmar ya informa el estado del OBJETO
--    (convenio en `pendent_firma`, albarán en `entregado`), que es además el criterio
--    correcto (§6ter: lo pendiente lo decide el objeto, no el enlace).
--
-- ⚠️ DEVUELVEN HECHOS, NO EL PASO. Qué toca ahora lo calcula `passosCanalitzacio.ts` en
--    el cliente, componiendo `procesOferta.ts` y `seguentPas.ts`. Calcularlo también
--    aquí sería una segunda definición de la misma regla, y las dos divergirían.

-- ---------------------------------------------------------------------------
-- 1. canalitzacio_assistida(): el estado entero de un lote, en un viaje
-- ---------------------------------------------------------------------------
create or replace function public.canalitzacio_assistida(p_excedente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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

    -- El convenio del generador que la modalidad exige (`convenios_exigidos`).
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

    -- Los intereses, con el convenio de cada receptora al lado.
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

    -- Cuántos productos de este lote no tienen coste del ejercicio: bloquea el cierre.
    'cost_falten', (
      select count(*) from (select distinct ex.producto as prod) x
       where not exists (
         select 1 from costes_producto cp
          where cp.producto = x.prod
            and cp.ejercicio = extract(year from coalesce(ex.created_at, now()))::int)),

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
$$;

revoke execute on function public.canalitzacio_assistida(uuid) from public, anon;
grant  execute on function public.canalitzacio_assistida(uuid) to authenticated, service_role;

comment on function public.canalitzacio_assistida(uuid) is
  'Tot l''estat del cicle d''un lot en un sol viatge, per a la pantalla guiada de l''equip. No llegeix enlaces_token: el que esta pendent ho diu l''estat de l''OBJECTE.';

-- ---------------------------------------------------------------------------
-- 2. canalitzacions_actives(): el índice
-- ---------------------------------------------------------------------------
create or replace function public.canalitzacions_actives(p_limit int default 200)
returns table (
  excedente_id   uuid,
  id_excedente   text,
  productor      text,
  estado         text,
  modalitat      text,
  kg_total       numeric,
  kg_canalitzats numeric,
  n_per_aprovar  int,
  rec_estado     text,
  ents_pendents  int,
  conveni_gen    text,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot llistar canalitzacions' using errcode = '42501';
  end if;

  return query
  select ex.id,
         ex.id_excedente,
         coalesce(p.empresa, p.name),
         ex.estado,
         ex.modalitat,
         ex.kg_total,
         coalesce((select sum(ca.kg_confirmados) from canalizaciones ca
                    where ca.excedente_id = ex.id), 0)::numeric,
         (select count(*) from oferta_respuestas r
           where r.excedente_id = ex.id
             and r.estado = 'acceptada' and r.aprovacio = 'pendent')::int,
         (select al.estado from albaranes al
           where al.tipo = 'REC'
             and (al.excedente_id = ex.id
                  or (ex.espigolada_id is not null and al.espigolada_id = ex.espigolada_id))
             and al.estado not in ('anulado', 'rectificado')
           order by al.created_at desc limit 1),
         (select count(*) from albaranes al
           where al.tipo in ('ENT', 'OPE')
             and al.canalizacion_id in (select id from canalizaciones where excedente_id = ex.id)
             and al.estado in ('emitido', 'entregado'))::int,
         (select c.estado from convenios c
           where c.productor_id = ex.productor_id and c.estado <> 'substituit'
           order by case c.estado when 'vigent' then 0 when 'firmat' then 1
                                  when 'pendent_firma' then 2 else 3 end
           limit 1),
         ex.created_at
    from excedentes ex
    left join productores p on p.id = ex.productor_id
   where ex.estado not in ('cancelada', 'no_colocada')
   order by ex.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke execute on function public.canalitzacions_actives(int) from public, anon;
grant  execute on function public.canalitzacions_actives(int) to authenticated, service_role;

comment on function public.canalitzacions_actives(int) is
  'Els lots en curs per a l''index de la pantalla guiada. Retorna FETS, no el pas: el pas el calcula passosCanalitzacio.ts al client.';
