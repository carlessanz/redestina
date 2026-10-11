-- Fase 3 de la revisión del cliente del 08-10-2026 (1/3): EL SNAPSHOT DEL ALBARÁN DE UNA
-- PÁGINA y la propuesta de conciliación con lo confirmado.
--
-- QUÉ PIDE LA FUNDACIÓ. El albarán actual «funciona a nivel de trazabilidad, pero visualmente
-- sigue siendo demasiado denso y técnico» (dos páginas). Pide adaptarlo al albarà de
-- recepció que ya usa Espigoladors: una página, simple y visual, con número y fecha,
-- ofertante, receptor, lugar, fecha y hora de recogida, producto, kg, modalidad y la
-- conformidad. El modelo (`3. Claude Code/capturas/2026-10-08-albara-recepcio-espigoladors.png`)
-- lleva además el VALOR DE REFERENCIA por kilo y el IMPORTE: decisión de Carles del
-- 11-10-2026, reproducirlo.
--
-- 🔴 LA INVARIANTE QUE CAMBIA: «los albaranes no llevan importes» (comu.ts, servidor.md).
--    Desde hoy el REC de DONACIÓN lleva el valor de referencia por kilo, y solo él:
--      · en el ENT lo leería la entidad por `documents_meus()` (D3: el coste del donante);
--      · en el OPE (venta/maquila) nunca, como pide el cliente («sin menciones de donación»).
--    Sigue SIN haber columna de importe en `albaran_lineas` (el arnés lo vigila con 42703):
--    el valor va en el snapshot y el IMPORTE se calcula al renderizar, así la versión emitida
--    y la conciliada del mismo albarán no discrepan por una cifra derivada.
--
-- LOS DOCUMENTOS YA EMITIDOS NO CAMBIAN: `documentos.datos` es inmutable, no tiene
-- `format` y `generar-documento` los sigue pintando con el renderizador de siempre. Solo
-- lo que se emita (o concilie) desde hoy lleva `format = 'albara-1p'`.

create or replace function public.albaran_datos(p_albaran uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  a      albaranes%rowtype;
  ex     excedentes%rowtype;
  par    parametros_documentales%rowtype;
  v_mod  text;
  v_tipo text;
begin
  select * into a from albaranes where id = p_albaran;
  select * into ex from excedentes where id = a.excedente_id;
  select * into par from parametros_documentales where id = 1;
  v_tipo := replace(a.tipo, 'R-', '');

  -- La modalidad de ESTE documento: la de la canalización en ENT/OPE (`valorizacion`); en el
  -- REC, la donación es lo único que crea un REC (el trigger de canalizaciones), y una
  -- espigolada también es donación.
  v_mod := case
             when v_tipo = 'REC' then 'donacio'
             else coalesce((select c.valorizacion from canalizaciones c where c.id = a.canalizacion_id),
                           ex.modalitat)
           end;

  return jsonb_build_object(
    'format',       'albara-1p',
    'tipus',        a.tipo,
    'numero',       a.numero_completo,
    'ejercici',     a.ejercicio,
    'idioma',       a.idioma,
    'emes_at',      to_char(coalesce(a.emitido_at, now()) at time zone 'Europe/Madrid',
                            'YYYY-MM-DD"T"HH24:MI:SS'),
    'data_elaboracio', to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD'),
    'modalitat',    v_mod,
    -- Hasta hoy el REC imprimía siempre «Donació», también en una espigolada: el snapshot
    -- no llevaba este dato aunque el renderizador lo leía.
    'tipus_entrada', case when v_tipo = 'REC'
                          then case when a.espigolada_id is not null or ex.origen = 'espigolament'
                                    then 'espigolament' else 'donacio' end
                     end,
    -- Quien firma el pie: la Fundació, de sus parámetros (con sus marcas de provisional).
    'fundacio',     jsonb_build_object('razon_social', par.razon_social, 'nif', par.cif,
                                       'domicilio', par.domicilio),
    'partes',       a.partes,
    'recollida',    a.recogida,
    'retorn_envasos', a.retorn_envasos,
    'observacions', a.observaciones,
    'incidencies',  a.incidencias,
    'rebuig',       jsonb_build_object('tipus', a.rechazo, 'motiu', a.motivo_rechazo),
    'referencies',  jsonb_build_object(
                      'registre',   ex.id_excedente,
                      'espigolada', (select coalesce(es.ref_externa, es.id::text)
                                       from espigoladas es where es.id = a.espigolada_id),
                      'rectifica',  (select r.numero_completo from albaranes r where r.id = a.rectifica_a),
                      'externs',    (select jsonb_agg(jsonb_build_object('tipus', x.tipo,
                                                                          'numero', x.numero,
                                                                          'data', x.fecha))
                                       from documentos_externos x
                                      where x.objeto_tipo = 'albaran' and x.objeto_id = a.id)),
    'linies',       (select jsonb_agg(jsonb_build_object(
                              'ordre',          l.orden,
                              'producte',       l.producto,
                              'varietat',       l.variedad,
                              'familia',        l.familia,
                              'causa',          l.causa,
                              'caixes',         l.num_cajas,
                              'tipus_caixa',    l.tipo_caja,
                              'kg_brut',        l.kg_bruto,
                              'tara_kg',        l.tara_kg,
                              'kg_net',         l.kg_neto,
                              'kg_previstos',   l.kg_previstos,
                              'kg_confirmats',  l.kg_confirmados,
                              'kg_validats',    l.kg_validados,
                              'lot_origen',     l.lote_origen,
                              -- SOLO en el REC de donación (ver la cabecera): el coste que
                              -- declaró el productor en la oferta o, si no, la referencia
                              -- del producto. Null = «—» en el papel, nunca un 0 inventado.
                              'valor_kg',       case when v_tipo = 'REC' and v_mod = 'donacio'
                                                     then coalesce(ex.coste_kg,
                                                                   (select cp.coste_kg from costes_producto cp
                                                                     where cp.producto = l.producto))
                                                end)
                            order by l.orden)
                       from albaran_lineas l where l.albaran_id = a.id)
  );
end;
$$;

revoke execute on function public.albaran_datos(uuid) from public, anon, authenticated;
grant execute on function public.albaran_datos(uuid) to service_role;

-- La propuesta de conciliación con lo confirmado por quien entrega.
CREATE OR REPLACE FUNCTION public.propuesta_conciliacion(p_rec uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a        albaranes%rowtype;
  par      parametros_documentales%rowtype;
  v_rec    numeric;
  v_ent    numeric;
  v_dif    numeric;
  v_pct    numeric;
  v_ents   jsonb;
  v_extern jsonb;
  v_plazo  boolean;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot veure la proposta de conciliacio' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_rec;
  if a.id is null or a.tipo <> 'REC' then
    raise exception 'La proposta de conciliacio es fa sobre un albara de recepcio' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  -- El neto del REC con lo que CONFIRMÓ quien entrega, si confirmó (11-10-2026): hasta hoy
  -- se ignoraba, y un productor que confirmaba 95 kg de 100 previstos no movía la propuesta.
  -- Es la misma cascada que `conciliar_albaran()` usa para fijar los kilos validados.
  select coalesce(sum(coalesce(l.kg_confirmados, l.kg_neto, l.kg_previstos)), 0) into v_rec
    from albaran_lineas l where l.albaran_id = a.id;

  -- Los ENT del mismo registro (o de la misma espigolada). Se cuenta lo CONFIRMADO por la
  -- entidad y, si no ha confirmado, lo entregado: es lo que hace que la propuesta se pueda
  -- calcular aunque falte una confirmación.
  select coalesce(sum(x.kg), 0),
         jsonb_agg(jsonb_build_object('albara', x.numero, 'estat', x.estado,
                                      'entitat', x.entidad, 'kg', x.kg))
    into v_ent, v_ents
    from (
      select b.numero_completo as numero, b.estado as estado, e.nombre as entidad,
             coalesce(sum(coalesce(l.kg_confirmados, l.kg_neto, l.kg_previstos)), 0) as kg
        from albaranes b
        join canalizaciones c on c.id = b.canalizacion_id
        left join entidades e on e.id = c.entidad_id
        left join albaran_lineas l on l.albaran_id = b.id
       where b.tipo in ('ENT', 'OPE')
         and b.estado not in ('borrador', 'anulado', 'rectificado')
         and ((a.excedente_id  is not null and b.excedente_id  = a.excedente_id)
           or (a.espigolada_id is not null and c.excedente_id in
                 (select ex.id from excedentes ex where ex.espigolada_id = a.espigolada_id)))
       group by b.id, b.numero_completo, b.estado, e.nombre
    ) x;

  select jsonb_agg(jsonb_build_object('numero', x.numero, 'data', x.fecha))
    into v_extern
    from documentos_externos x
   where x.objeto_tipo = 'albaran' and x.objeto_id = a.id and x.tipo = 'albaran_productor';

  v_dif := v_rec - v_ent;
  v_pct := case when v_rec > 0 then round(abs(v_dif) / v_rec * 100, 2) else null end;

  -- ¿Se puede conciliar sin confirmación? Solo si venció el plazo del parámetro.
  select bool_and(b.confirmado_at is not null
                  or b.entregado_at + make_interval(days => coalesce(par.plazo_conciliar_sin_confirmacion_dias, 7)) < now())
    into v_plazo
    from albaranes b
    join canalizaciones c on c.id = b.canalizacion_id
   where b.tipo in ('ENT', 'OPE')
     and b.estado in ('entregado', 'confirmado')
     and b.excedente_id = a.excedente_id;

  return jsonb_build_object(
    'albara_rec',        a.numero_completo,
    'kg_recepcio',       v_rec,
    'kg_entregues',      v_ent,
    'entregues',         coalesce(v_ents, '[]'::jsonb),
    'document_productor', coalesce(v_extern, '[]'::jsonb),
    'diferencia',        v_dif,
    'diferencia_pct',    v_pct,
    'tolerancia_pct',    coalesce(par.tolerancia_conciliacion_pct, 2),
    'dins_tolerancia',   coalesce(v_pct, 0) <= coalesce(par.tolerancia_conciliacion_pct, 2),
    'termini_vencut',    coalesce(v_plazo, true)
  );
end;
$function$;
