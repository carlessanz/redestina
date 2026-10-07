-- canalitzacio_assistida(): el cierre del ejercicio, elegido de forma determinista (07-10-2026).
--
-- EL FALLO. La clave `exercici` se elegía con
--     order by case modo when 'real' then 0 else 1 end limit 1
-- SIN desempate. `cierres_ejercicio` admite varios cierres de PRUEBA por año (solo el real es
-- único, `cierres_ejercicio_real_uidx`), así que con dos ensayos de 2026 empataban y Postgres
-- devolvía cualquiera. En el clon local hay exactamente eso —uno calculado el 21-09 y otro
-- abierto después y nunca calculado— y la RPC devolvía el VACÍO: la pantalla guiada pintaba el
-- escalón del certificado «pendent» aunque el ensayo de verdad estuviera calculado.
--
-- EL ARREGLO. Se conserva la preferencia de modo de siempre (el real antes que cualquier
-- prueba) y se añade el desempate `calculado_at desc nulls last, created_at desc`: entre
-- ensayos gana el último CALCULADO, y si ninguno lo está, el más reciente. Con el cierre real
-- no cambia nada: es único por ejercicio.
--
-- `canalitzacions_actives()` NO se toca: no lee `cierres_ejercicio` (comprobado en su
-- definición vigente, `20270406100500`).
--
-- DE PASO, dos claves NUEVAS y opcionales (no se quita ni renombra ninguna):
--   · `oferta.modalitats`         — el `text[]` de la oferta (rebanada 1, 05-10-2026);
--                                   `oferta.modalitat` sigue siendo la principal.
--   · `canalitzacions[].valorizacion` — la modalidad con la que se aprobó cada entrega.
-- El frontend actual (`src/lib/canalitzacio.ts`) las IGNORA; existen para que la pantalla
-- guiada pueda elegir modalidad (deuda 130) sin otra migración.
--
-- ⚠️ `create or replace` reescribe los atributos: se repiten `stable`, `security definer` y
--    `set search_path`. La versión vigente es PARALLEL UNSAFE (el default, nunca se marcó) y
--    así se queda. Se repiten también el revoke/grant y el comentario.

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
      'created_at', ex.created_at,
      -- Nueva (opcional): todas las modalidades de la oferta.
      'modalitats', to_jsonb(ex.modalitats)),

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
               'conciliada_at', ca.conciliada_at, 'coste_kg', ca.coste_kg,
               -- Nueva (opcional): la modalidad de esta entrega.
               'valorizacion', ca.valorizacion)
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

    -- El real antes que cualquier prueba (como siempre); entre pruebas, el último
    -- calculado y, si ninguno lo está, el más reciente. Antes no había desempate.
    'exercici', (
      select jsonb_build_object('id', ce3.id, 'ejercicio', ce3.ejercicio,
                                'modo', ce3.modo, 'estado', ce3.estado)
        from cierres_ejercicio ce3
       where ce3.ejercicio = extract(year from coalesce(ex.created_at, now()))::int
       order by case ce3.modo when 'real' then 0 else 1 end,
                ce3.calculado_at desc nulls last,
                ce3.created_at desc,
                ce3.id
       limit 1)
  ) into res;

  return res;
end;
$$;

revoke execute on function public.canalitzacio_assistida(uuid) from public, anon;
grant  execute on function public.canalitzacio_assistida(uuid) to authenticated, service_role;

comment on function public.canalitzacio_assistida(uuid) is
  'Tot l''estat del cicle d''un lot en un sol viatge, per a la pantalla guiada de l''equip. No llegeix enlaces_token: el que esta pendent ho diu l''estat de l''OBJECTE.';
