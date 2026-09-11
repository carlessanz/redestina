-- El REC de una espigolada deja de imprimir un uuid. Cierra la deuda §12.61.
--
-- EL DEFECTO. `albaran_datos()` ponía `'espigolada', a.espigolada_id` en el snapshot, o
-- sea la clave primaria de la jornada, y el renderizador la imprime tal cual bajo
-- «Referència de l'espigolada» (`_shared/pdf/render/comu.ts`). En pantalla es un dato
-- correcto; en un papel que alguien tiene que leer, cotejar o citar por teléfono, 36
-- caracteres hexadecimales no son una referencia.
--
-- LO QUE SE IMPRIME AHORA. `espigoladas.ref_externa` (20261012100200), que es el
-- identificador legible de la jornada —hoy lo escribe el equipo al crearla; mañana lo
-- traerá el módulo de espigolament, y por eso la columna es `unique`—. Si está vacía se
-- cae al uuid, que es lo que había: un albarán no se queda sin referencia porque la ficha
-- esté incompleta.
--
-- ⚠️ SOLO AFECTA A LO QUE SE EMITA DESDE AHORA. `documentos.datos` es un snapshot
--    congelado y `sha256_datos` es su huella: los REC ya emitidos siguen diciendo el uuid,
--    y tienen que seguir diciéndolo. Cambiar un snapshot emitido es exactamente lo que
--    impide el trigger `documentos_inmutable`.
--
-- El resto de la función es idéntico: se recrea entera porque no hay otra forma de tocar
-- una línea de un `jsonb_build_object` de 30.

create or replace function public.albaran_datos(p_albaran uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  a albaranes%rowtype;
begin
  select * into a from albaranes where id = p_albaran;

  return jsonb_build_object(
    'tipus',        a.tipo,
    'numero',       a.numero_completo,
    'ejercici',     a.ejercicio,
    'idioma',       a.idioma,
    'emes_at',      to_char(coalesce(a.emitido_at, now()) at time zone 'Europe/Madrid',
                            'YYYY-MM-DD"T"HH24:MI:SS'),
    'partes',       a.partes,
    'recollida',    a.recogida,
    'retorn_envasos', a.retorn_envasos,
    'observacions', a.observaciones,
    'incidencies',  a.incidencias,
    'rebuig',       jsonb_build_object('tipus', a.rechazo, 'motiu', a.motivo_rechazo),
    'referencies',  jsonb_build_object(
                      'registre',   (select e.id_excedente from excedentes e where e.id = a.excedente_id),
                      -- La referencia legible de la jornada, con el uuid como respaldo.
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
                              'lot_origen',     l.lote_origen)
                            order by l.orden)
                       from albaran_lineas l where l.albaran_id = a.id)
  );
end;
$$;

comment on function public.albaran_datos(uuid) is
  'Snapshot congelado del albarán. La referencia de espigolada es ref_externa (legible), con el uuid de respaldo.';

-- `create or replace` conserva los privilegios de 20261012100500 (solo `service_role`).

-- Verificación:
--   select public.albaran_datos('<rec_espigolada>')->'referencies'->>'espigolada';
