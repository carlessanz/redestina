-- Fase 3 del plan de los puntos 4-6 (cambio C4, con D3): los certificados con un REC por recogida.
--
-- Copias de las vigentes (cierre_base_periodo: 20270509100700; cierre_base_recepcio:
-- 20270509100600; calcular_certificat_recepcio: 20270517100000), mismas firmas y mismos
-- `returns`. Lo que cambia:
--
--   1. `cierre_base_periodo` (certificado de donación, ámbitos ejercicio, intervalo y oferta): el
--      `lateral` del REC casa por `canalizacion_id` (el REC de ESA recogida) o, en lo heredado, con
--      el REC sin canalización de la misma oferta. Cada REC nuevo agrupa una sola canalización: el
--      reparto es 1:1 y `excedent_partit` sale false. La venta y la maquila (sin REC) se agrupan por
--      oferta y las descarta `motiu_exclusio_certificat`, como antes. La espigolada no cambia.
--      Lo consumen sin tocarlos `cierre_base`, `calcular_cierre`, `calcular_certificado_periodo` y
--      `datos_182`.
--   2. `cierre_base_recepcio` (certificado de recepción, D): una venta o una maquila validadas sin
--      albarán no son «retroactivas»: `retroactiva = retro or (sin albarán and donación)`. Los
--      kilos, como siempre: los del albarán conciliado y, si no lo hay, `kg_conciliados`. Un OPE
--      heredado conciliado se sigue leyendo.
--   3. `calcular_certificat_recepcio`: el aviso `sense_albara` cuenta solo líneas de donación.
--
-- ⚠️ El texto del CR (`_shared/pdf/render/cr.ts`) dice que los kilos vienen de albaranes de
--    entrega; con venta y maquila sin albarán deja de ser cierto. Es del agente `servidor`.

-- ---------------------------------------------------------------------------
-- 1. `cierre_base_periodo`: el REC de la recogida (1:1) o el heredado
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cierre_base_periodo(p_desde date, p_hasta date, p_modo text DEFAULT 'prueba'::text)
 RETURNS TABLE(canalizacion_id uuid, excedente_id uuid, entidad_id uuid, productor_id uuid, producto text, mes integer, kg_conciliados numeric, coste_kg numeric, retroactiva boolean, albaran_rec_id uuid, rec_neto numeric, kg_neto numeric, valor numeric, excedent_partit boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la base de calcul d''un tancament'
      using errcode = '42501';
  end if;

  return query
  with ops as (
    -- ⚠️ SIN filtro de fecha NI de modalidad. El universo del reparto son todas las
    --    canalizaciones conciliadas del excedente: las de otras fechas (20270303100000) y,
    --    desde 20270509100000, también las de venta, maquila y entidades no sociales, que
    --    se llevan su parte del neto del REC y se descartan al final.
    select c.id as canalizacion_id, c.excedente_id, c.entidad_id,
           e.productor_id, e.producto, e.espigolada_id,
           c.kg_conciliados, c.coste_kg,
           c.conciliacion_retroactiva as retroactiva,
           (public.motiu_exclusio_certificat(c.valorizacion, c.entidad_id, en.tipo_receptor)
              is null) as certificable,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid') as fecha_local
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
      left join entidades en on en.id = c.entidad_id
     where c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  conrec as (
    select o.*,
           r.albaran_id as albaran_rec_id,
           r.kg         as rec_neto,
           -- La clave del reparto: el albarán de recepción cuando lo hay, y el excedente
           -- cuando no, para que los NULL no se junten todos (20270320100000).
           coalesce(r.albaran_id, o.excedente_id) as clau_repartiment
      from ops o
      left join lateral (
        select a.id as albaran_id, sum(l.kg_validados) as kg
          from albaranes a
          join albaran_lineas l on l.albaran_id = a.id
         where a.tipo = 'REC' and a.estado = 'conciliado'
           and ( (o.espigolada_id is not null
                  and a.espigolada_id = o.espigolada_id
                  and l.producto is not distinct from o.producto)
              -- 20270608100300: el REC de ESTA recogida (fase 3 de los puntos 4-6)...
              or (o.espigolada_id is null and a.canalizacion_id = o.canalizacion_id)
              -- ...o, en lo heredado, el REC de la oferta (sin canalización).
              or (o.espigolada_id is null and a.canalizacion_id is null
                  and a.excedente_id = o.excedente_id) )
         group by a.id
         -- El de la recogida antes que el heredado (una oferta no mezcla los dos modelos, pero
         -- si los mezclara, cada recogida se queda con el suyo).
         order by (a.canalizacion_id is null), a.id
         limit 1
      ) r on true
  ),
  repartido as (
    select c.*,
           (c.fecha_local >= p_desde::timestamp
            and c.fecha_local < (p_hasta + 1)::timestamp) as dins,
           sum(c.kg_conciliados) over w as suma_can,
           row_number() over (partition by c.clau_repartiment, c.producto
                              order by c.kg_conciliados desc, c.canalizacion_id) as rn,
           -- La parte proporcional del neto del REC, SIN TOPE (20270509100700): el REC es
           -- lo que el donante entregó a la Fundació, y eso es lo que se certifica aunque la
           -- entidad haya confirmado menos. El universo incluye venta, maquila y entidades no
           -- sociales, así que su parte se queda en ellas y no llega a ninguna donación social.
           case when c.rec_neto is not null
                 and sum(c.kg_conciliados) over w > 0
                then round(c.kg_conciliados * c.rec_neto / sum(c.kg_conciliados) over w, 2)
                else round(c.kg_conciliados, 2)
           end as kg_prop
      from conrec c
    window w as (partition by c.clau_repartiment, c.producto)
  ),
  ajustado as (
    -- El céntimo del redondeo se le da a la línea mayor del grupo, esté dentro o fuera de
    -- la ventana y sea o no certificable: es suya (20270303100000).
    select r.*,
           case when r.rn = 1 and r.rec_neto is not null and r.suma_can > 0
                then round(r.rec_neto, 2)
                     - sum(r.kg_prop) over (partition by r.clau_repartiment, r.producto)
                else 0
           end as correccion
      from repartido r
  ),
  marcado as (
    select a.*,
           (a.rec_neto is not null
            and bool_or(a.certificable and not a.dins)
                  over (partition by a.clau_repartiment, a.producto))
             as excedent_partit
      from ajustado a
  )
  select m.canalizacion_id, m.excedente_id, m.entidad_id, m.productor_id, m.producto,
         extract(month from m.fecha_local)::int as mes,
         m.kg_conciliados, m.coste_kg, m.retroactiva, m.albaran_rec_id, m.rec_neto,
         (m.kg_prop + m.correccion)::numeric as kg_neto,
         round((m.kg_prop + m.correccion) * coalesce(m.coste_kg, 0), 2) as valor,
         m.excedent_partit
    from marcado m
   where m.dins
     and m.certificable;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. `cierre_base_recepcio`: sin albarán no es retroactiva fuera de la donación
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cierre_base_recepcio(p_desde date, p_hasta date, p_modo text DEFAULT 'prueba'::text)
 RETURNS TABLE(canalizacion_id uuid, entidad_id uuid, valorizacion text, producto text, mes integer, kg_conciliados numeric, kg_neto numeric, retroactiva boolean, albaran_id uuid, albaran_tipo text, municipio text, comarca text, productor_id uuid, productor_nom text, productor_nif text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la base de calcul d''un certificat de recepcio'
      using errcode = '42501';
  end if;

  return query
  with ops as (
    select c.id                                   as can_id,
           c.entidad_id                           as ent_id,
           c.valorizacion                         as val,
           e.producto                             as prod,
           e.productor_id                         as prod_id,
           coalesce(e.ubicacion_id, esp.ubicacion_id) as ubi_id,
           c.kg_conciliados                       as kg_conc,
           c.conciliacion_retroactiva             as retro,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid')       as fecha_local
      from canalizaciones c
      join excedentes     e   on e.id = c.excedente_id
      left join espigoladas esp on esp.id = e.espigolada_id
     where c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and c.entidad_id is not null
       -- Sin modalidad no se sabe si es donación (D3: no se nombra al generador) o compra
       -- (sí se nombra), ni qué albarán buscar; y `cierre_receptor_lineas.valorizacion` es
       -- `not null`. Fuera, en vez de suponer donación (20270509100600).
       and c.valorizacion is not null
       -- Misma regla que el resto del circuito: una conciliación hecha después de cerrar
       -- el ejercicio solo entra en los cierres de prueba.
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  enrango as (
    select o.* from ops o
     where o.fecha_local >= p_desde::timestamp
       and o.fecha_local <  (p_hasta + 1)::timestamp
  ),
  amb_albara as (
    select o.*, r.alb_id, r.alb_tipo, r.alb_kg
      from enrango o
      left join lateral (
        select a.id as alb_id, a.tipo as alb_tipo, sum(l.kg_validados) as alb_kg
          from albaranes a
          join albaran_lineas l on l.albaran_id = a.id
         where a.estado = 'conciliado'
           and a.canalizacion_id = o.can_id
           and a.tipo = case when o.val = 'donacio' then 'ENT' else 'OPE' end
         group by a.id, a.tipo
         order by a.id
         limit 1
      ) r on true
  ),
  amb_origen as (
    select o.*,
           coalesce(ub.municipio, pr.poblacion)   as muni,
           ub.municipio_ine                       as muni_ine,
           coalesce(pr.empresa, pr.name)          as pr_nom,
           pr.nif                                 as pr_nif
      from amb_albara o
      left join productor_ubicaciones ub on ub.id = o.ubi_id
      left join productores           pr on pr.id = o.prod_id
  )
  select o.can_id,
         o.ent_id,
         o.val,
         o.prod,
         extract(month from o.fecha_local)::int,
         o.kg_conc,
         -- Los kilos OFICIALES son los del albarán conciliado (D13). El respaldo a
         -- `kg_conciliados` cubre la conciliación retroactiva y, desde 20270608100300, la venta y
         -- la maquila validadas sin albarán (`kg_conciliados` = kilos validados).
         round(coalesce(o.alb_kg, o.kg_conc), 2),
         -- 20270608100300 (D): una venta o una maquila no tiene albarán de Redestina; sin él no es
         -- «retroactiva», es lo normal. Solo una DONACIÓN sin su ENT conciliado lo es.
         (o.retro or (o.alb_id is null and o.val = 'donacio')),
         o.alb_id,
         o.alb_tipo,
         o.muni,
         (select m.comarca
            from municipios m
           where (o.muni_ine is not null and m.codi_ine = o.muni_ine)
              or (o.muni_ine is null and o.muni is not null
                  and lower(m.nom) = lower(o.muni))
           limit 1),
         -- 🔴 D3: en donación, el generador NO SE NOMBRA. Se anula aquí, además de estar
         --    prohibido por el check de `cierre_receptor_lineas`: la función es
         --    `security definer` y lo que devuelva acaba en una tabla que la entidad lee
         --    por RLS, así que la primera defensa tiene que estar donde se compone el dato.
         case when o.val = 'donacio' then null else o.prod_id end,
         case when o.val = 'donacio' then null else o.pr_nom end,
         case when o.val = 'donacio' then null else o.pr_nif end
    from amb_origen o;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. `calcular_certificat_recepcio`: el aviso `sense_albara`, solo en donación
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calcular_certificat_recepcio(p_entidad uuid, p_desde date, p_hasta date, p_modo text DEFAULT 'real'::text)
 RETURNS cierres_receptor
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cr    cierres_receptor%rowtype;
  en    entidades%rowtype;
  v_ej  int;
  v_hoy date;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar calcula un certificat' using errcode = '42501';
  end if;
  if p_modo not in ('prueba', 'real') then
    raise exception 'Mode desconegut: %', p_modo using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El periode ha de tenir una data d''inici anterior o igual a la de fi'
      using errcode = '22023';
  end if;

  v_ej  := extract(year from p_desde)::int;
  v_hoy := (now() at time zone 'Europe/Madrid')::date;

  if extract(year from p_hasta)::int <> v_ej then
    raise exception 'Un certificat no pot cobrir dos exercicis (% i %): la serie es anual',
      v_ej, extract(year from p_hasta)::int using errcode = '22023';
  end if;
  -- Certificar un periodo que todavía no ha terminado sería certificar el futuro: los
  -- kilos que faltan por conciliar llegarían después y el certificado ya estaría emitido.
  if p_hasta > v_hoy then
    raise exception 'El periode acaba el % i encara no ha acabat (avui es %)', p_hasta, v_hoy
      using errcode = '22023';
  end if;

  select * into en from entidades where id = p_entidad;
  if en.id is null then
    raise exception 'Aquesta entitat receptora no existeix' using errcode = '22023';
  end if;

  -- ¿Hay ya un certificado emitido de esta misma ventana? Entonces esto no es un recálculo,
  -- es una rectificación, y tiene su propia función.
  if exists (select 1 from cierres_receptor c
              where c.entidad_id = p_entidad and c.modo = p_modo
                and c.periodo_desde = p_desde and c.periodo_hasta = p_hasta
                and c.certificado_numero is not null and c.estado <> 'substituit') then
    raise exception 'Aquesta entitat ja te un certificat d''aquest periode: fes servir rectificar_certificat_recepcio()'
      using errcode = '22023';
  end if;

  -- El borrador de esta ventana, o uno nuevo.
  select * into cr from cierres_receptor
   where entidad_id = p_entidad and modo = p_modo
     and periodo_desde = p_desde and periodo_hasta = p_hasta
     and certificado_numero is null
   for update;

  if cr.id is null then
    insert into cierres_receptor (entidad_id, periodo_desde, periodo_hasta, ejercicio,
                                  modo, creado_por)
    values (p_entidad, p_desde, p_hasta, v_ej, p_modo, auth.uid())
    returning * into cr;
  end if;

  -- Las líneas, siempre desde cero: son el detalle del cálculo, no un histórico.
  delete from cierre_receptor_lineas where cierre_receptor_id = cr.id;

  insert into cierre_receptor_lineas (
    cierre_receptor_id, canalizacion_id, albaran_id, albaran_tipo, valorizacion,
    producto, mes, kg_neto, municipio, comarca,
    productor_id, productor_nom, productor_nif, retroactiva)
  select cr.id, b.canalizacion_id, b.albaran_id, b.albaran_tipo, b.valorizacion,
         b.producto, b.mes, b.kg_neto, b.municipio, b.comarca,
         b.productor_id, b.productor_nom, b.productor_nif, b.retroactiva
    from public.cierre_base_recepcio(p_desde, p_hasta, p_modo) b
   where b.entidad_id = p_entidad;

  update cierres_receptor c
     set kg_total   = (select coalesce(sum(l.kg_neto), 0) from cierre_receptor_lineas l
                        where l.cierre_receptor_id = c.id),
         kg_donacio = (select coalesce(sum(l.kg_neto), 0) from cierre_receptor_lineas l
                        where l.cierre_receptor_id = c.id and l.valorizacion = 'donacio'),
         kg_compra  = (select coalesce(sum(l.kg_neto), 0) from cierre_receptor_lineas l
                        where l.cierre_receptor_id = c.id and l.valorizacion <> 'donacio'),
         calculado_at = now(),
         -- Copia congelada de la ficha. Sin `provincia`: aquí no hay modelo 182 al que
         -- llevarla, y `provincia_por_cp()` existe para eso.
         datos_fiscales = jsonb_build_object(
           'raó_social', en.nombre,
           'nif', en.nif,
           'domicili', public.dada_fiscal(en.domicili_fiscal, en.domicili_fiscal, en.direccion),
           'codi_postal', public.dada_fiscal(en.domicili_fiscal, en.codi_postal_fiscal, en.codigo_postal),
           'poblacio', public.dada_fiscal(en.domicili_fiscal, en.poblacio_fiscal, en.poblacion),
           'email', en.email),
         bloqueos = (
           select coalesce(jsonb_agg(x), '[]'::jsonb) from (
             -- (a) entregas de la ventana sin conciliar. **Bloquea**: es la garantía «nada
             --     sin conciliar», y evaluada sobre el periodo certificado dice la verdad
             --     también a mitad de año.
             select jsonb_build_object('codigo', 'sense_conciliar', 'bloqueja', true,
                      'detall', pe.canalizaciones::text || ' lliuraments del periode sense conciliar ('
                                || round(pe.kg, 1)::text || ' kg)') as x
               from public.cierre_pendents_recepcio(p_desde, p_hasta) pe
              where pe.entidad_id = p_entidad
             union all
             -- (b) sin albarán conciliado: AVISA, no bloquea. Es el caso de la conciliación
             --     retroactiva, y si bloqueara, los datos de 2026 harían el ensayo
             --     inejecutable — exactamente el argumento de `sense_rec` en el cierre
             --     anual (§4).
             -- 20270608100300 (D): solo la DONACIÓN; una venta o una maquila no tiene albarán.
             select jsonb_build_object('codigo', 'sense_albara', 'bloqueja', false,
                      'detall', count(*)::text || ' lliuraments en donacio sense albara conciliat (ENT)')
               from cierre_receptor_lineas l
              where l.cierre_receptor_id = c.id and l.albaran_id is null
                and l.valorizacion = 'donacio'
             having count(*) > 0
             union all
             -- (c) datos de la ficha incompletos: AVISA, no bloquea. El CR no tiene efecto
             --     fiscal y no va a ninguna declaración —mismo criterio que `sense_nif` en
             --     el certificado de transacción—; basta con poder nombrar a la entidad.
             select jsonb_build_object('codigo', 'dades_incompletes', 'bloqueja', false,
                      'detall', 'Falten dades de la fitxa: ' || array_to_string(array_remove(array[
                        case when coalesce(btrim(en.nif), '') = '' then 'NIF' end,
                        case when coalesce(btrim(public.dada_fiscal(en.domicili_fiscal, en.domicili_fiscal, en.direccion)), '') = '' then 'domicili' end,
                        case when coalesce(btrim(public.dada_fiscal(en.domicili_fiscal, en.poblacio_fiscal, en.poblacion)), '') = '' then 'poblacio' end],
                        null), ', '))
              where coalesce(btrim(en.nif), '') = ''
                 or coalesce(btrim(public.dada_fiscal(en.domicili_fiscal, en.domicili_fiscal, en.direccion)), '') = ''
                 or coalesce(btrim(public.dada_fiscal(en.domicili_fiscal, en.poblacio_fiscal, en.poblacion)), '') = ''
             union all
             -- (d) donaciones sin municipio de origen: AVISA. La tabla de procedencias
             --     saldría con una fila en blanco, que en un certificado queda raro pero no
             --     afirma nada falso.
             select jsonb_build_object('codigo', 'sense_procedencia', 'bloqueja', false,
                      'detall', count(*)::text || ' lliuraments en donacio sense municipi d''origen: '
                                || 'la taula de procedencies sortira incompleta')
               from cierre_receptor_lineas l
              where l.cierre_receptor_id = c.id and l.valorizacion = 'donacio'
                and coalesce(btrim(l.municipio), '') = ''
             having count(*) > 0
             union all
             -- (e) otro certificado de la misma entidad se solapa A MEDIAS con este.
             --     **Bloquea**. Que uno CONTENGA a otro sí se permite —es el caso normal,
             --     «lo de este año a fecha de hoy» repetido— y al emitir el grande el
             --     pequeño queda sustituido. Lo que no cabe es «enero–marzo» y
             --     «febrero–mayo», donde febrero y marzo estarían acreditados dos veces
             --     ante dos terceros sin forma de saberlo.
             select jsonb_build_object('codigo', 'periode_encavalcat', 'bloqueja', true,
                      'detall', 'El certificat ' || string_agg(o.certificado_numero, ', ')
                                || ' cobreix part d''aquest periode sense estar-hi contingut')
               from cierres_receptor o
              where o.entidad_id = p_entidad and o.modo = p_modo
                and o.id <> c.id and o.certificado_numero is not null
                and o.estado <> 'substituit'
                and o.periodo_desde <= p_hasta and o.periodo_hasta >= p_desde
                and not (o.periodo_desde >= p_desde and o.periodo_hasta <= p_hasta)
             having count(*) > 0
           ) b(x))
   where c.id = cr.id
  returning * into cr;

  return cr;
end;
$function$;
