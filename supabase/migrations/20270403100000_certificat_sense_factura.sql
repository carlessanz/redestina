-- El certificado de donación deja de exigir factura del donante (21-09-2026).
--
-- QUÉ DECIDIÓ EL CLIENTE. Hasta hoy, emitir un certificado de donación —anual o a
-- demanda— exigía que el donante hubiera mandado su factura y que el importe cuadrase al
-- céntimo con lo calculado (`estado = 'coincident'`), o bien la **excepción de D4**: solo
-- el super_admin, con un motivo escrito, que quedaba grabado en
-- `excepcion_sin_factura` / `excepcion_motivo` / `excepcion_por` y salía impreso en el PDF.
-- El 21-09-2026 el cliente decidió retirar esa condición: **el certificado se emite sin
-- factura**. La factura se sigue pudiendo registrar si llega —`registrar_factura()` y
-- `registrar_factura_periodo()` no se tocan— y la discrepancia sigue calculándose y
-- guardándose en `estado`, pero pasa a ser **aviso para el equipo, no bloqueo**.
--
-- QUÉ NO CAMBIA, y conviene saberlo antes de tocar nada más:
--   · `render/cd.ts` YA imprime la rama «Sense factura del donant» cuando el snapshot no
--     cita ninguna, así que **el PDF no necesita ningún cambio**.
--   · Las plantillas `CD` y `CD/parcial` no llevan marcadores de factura.
--   · `rectificar_certificado()` y `rectificar_certificado_periodo()` nunca exigieron
--     factura: se quedan exactamente como están.
--   · Las columnas `excepcion_*` de `cierres_donante` y `cierres_periodo` **se conservan**:
--     son evidencia de los certificados que ya se emitieron por esa vía, y borrarlas sería
--     reescribir la historia de un documento con efecto fiscal. Lo único que cambia es que
--     **ya nadie las vuelve a escribir**.
--
-- POR QUÉ SE CONSERVA EL PARÁMETRO `p_motivo_excepcion`. Las dos funciones lo siguen
-- aceptando y **lo ignoran**. Cambiar la firma obligaría a tocar a la vez
-- `src/lib/tancament.ts` y el arnés de RLS, y a publicarlo todo en el mismo instante: con
-- `create or replace` sobre la misma firma, la base y el frontend vigente siguen
-- encajando durante la ventana de despliegue (§11: el `git push` va el último). El día que
-- se quiera limpiar, se hace en dos publicaciones.
--
-- Y UNA TERCERA COSA, que no es cosmética: el snapshot deja de citar una factura que no
-- cuadra. Ver §3.

-- ---------------------------------------------------------------------------
-- 1. emitir_certificado(): sin el bloque de factura / D4
-- ---------------------------------------------------------------------------
-- Copia literal de la versión vigente (20270303100400_asimetries_certificats.sql:30-161)
-- **menos** el bloque «(2) Factura coincidente, o la excepción de D4» (sus líneas 94-109).
-- Todo lo demás —las guardas (0), (0bis), (1), la numeración y la sustitución de los
-- parciales (3)— se queda intacto.
create or replace function public.emitir_certificado(
  p_cd              uuid,
  p_motivo_excepcion text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd      cierres_donante%rowtype;
  ce      cierres_ejercicio%rowtype;
  par     parametros_documentales%rowtype;
  v_serie text;
  v_n     int;
  v_dest  jsonb;
  v_doc   uuid;
  v_bloq  text;
  v_parc  int := 0;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  if cd.id is null then
    raise exception 'Aquest donant no es d''un tancament' using errcode = '22023';
  end if;
  if cd.tipo <> 'donacio' then
    raise exception 'Aquest acumulat es de transaccio: fes servir emitir_certificado_transaccion()'
      using errcode = '22023';
  end if;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  -- (0) Los datos de la Fundación tienen que ser los de verdad.
  if coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  -- (0bis) Después del 182 no se emite: se rectifica, y eso lo decide la gestoría (D10).
  --        Misma guarda que `emitir_resumen()` y `rectificar_certificado()`.
  if ce.estado = 'declarat' or cd.estado = 'declarat' then
    raise exception 'L''exercici ja esta declarat al 182: cap certificat nou sense parlar amb la gestoria (D10)'
      using errcode = '22023';
  end if;

  if cd.certificado_numero is not null then
    raise exception 'Aquest donant ja te el certificat % (fes servir rectificar_certificado)',
      cd.certificado_numero using errcode = '22023';
  end if;

  -- (1) Ningún bloqueo bloqueante.
  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cd.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquest donant esta bloquejat: %', v_bloq using errcode = '22023';
  end if;

  if cd.kg_total <= 0 or cd.valor_total <= 0 then
    raise exception 'Un certificat de 0 quilos o 0 euros no te sentit' using errcode = '22023';
  end if;

  -- (2) AQUÍ IBA LA FACTURA, y ya no va. Decisión del cliente del 21-09-2026: el
  --     certificado se emite sin factura del donante. `p_motivo_excepcion` se acepta para
  --     no romper la firma —la llaman `src/lib/tancament.ts` y el arnés— y **se ignora**:
  --     `excepcion_sin_factura` no se vuelve a escribir desde aquí nunca más. Lo que
  --     guarden las filas antiguas es evidencia de cómo se emitieron ellas.

  v_dest := public.cierre_destinatario(p_cd);

  v_serie := case when ce.modo = 'prueba' then 'P-CD' else 'CD' end;
  v_n := public.siguiente_numero(v_serie, ce.ejercicio);
  update cierres_donante
     set certificado_numero = public.formato_numero(v_serie, ce.ejercicio, v_n),
         certificado_at     = now(),        -- D14: la fecha del certificado es esta
         estado             = 'certificat_emes'
   where id = p_cd
  returning * into cd;

  v_doc := public.cierre_emet_document(
    p_cd, 'CD', 'definitiu',
    public.cierre_datos_certificado(p_cd),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', 'Certificat de donacio ' || ce.ejercicio::text || ' — ' || cd.certificado_numero,
      'plantilla', 'certificat_donacio'));

  -- (3) EL ANUAL MANDA. Los certificados a demanda del mismo donante, ejercicio y modo
  --     quedan sustituidos: lo que dice este documento incluye lo que decían ellos.
  --     `to_regclass` porque esta función es anterior a `cierres_periodo` y tiene que
  --     seguir funcionando en un entorno donde esa tabla todavía no exista.
  if to_regclass('public.cierres_periodo') is not null then
    update cierres_periodo cp
       set estado = 'substituit', sustituido_at = now(), cierre_donante_id = p_cd
     where cp.productor_id = cd.productor_id
       and cp.ejercicio = ce.ejercicio
       and cp.modo = ce.modo
       and cp.certificado_numero is not null
       and cp.estado <> 'substituit';
    get diagnostics v_parc = row_count;

    update documentos d
       set vigente = false, sustituido_por = v_doc
     where d.objeto_tipo = 'cierre_periodo' and d.vigente
       and d.objeto_id in (select cp.id from cierres_periodo cp
                            where cp.cierre_donante_id = p_cd);
  end if;

  return jsonb_build_object('document', v_doc, 'numero', cd.certificado_numero,
                            'data', cd.certificado_at, 'import', cd.valor_total,
                            'kg', cd.kg_total, 'destinatari', v_dest,
                            -- Se conserva la clave: hoy vale lo que ya valiera la fila.
                            'excepcio', cd.excepcion_sin_factura,
                            -- Cuántos certificados a demanda han quedado sustituidos.
                            'parcials_substituits', v_parc);
end;
$$;

comment on function public.emitir_certificado(uuid, text) is
  'Emite el certificado anual de donación. NO exige factura del donante (21-09-2026): p_motivo_excepcion se acepta y se ignora. Sustituye los certificados a demanda del mismo donante y ejercicio.';

-- ---------------------------------------------------------------------------
-- 2. emitir_certificado_periodo(): lo mismo, en la ventana
-- ---------------------------------------------------------------------------
-- Copia literal de la versión vigente (20270303100300_rpc_certificat_periode.sql:490-620)
-- **menos** el bloque «(3) Factura coincidente, o la excepción de D4» (sus líneas
-- 553-570). Conserva sus dos guardas propias, que no tienen nada que ver con la factura:
-- la plantilla `CD/parcial` vigente —sin ella el PDF afirmaría cubrir el año entero— y los
-- bloqueos `periode_parteix_excedent` y `periode_encavalcat`, que llegan por
-- `cp.bloqueos` desde `calcular_certificado_periodo()` y los corta la guarda (1).
create or replace function public.emitir_certificado_periodo(
  p_periodo          uuid,
  p_motivo_excepcion text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cp      cierres_periodo%rowtype;
  par     parametros_documentales%rowtype;
  v_serie text;
  v_n     int;
  v_dest  jsonb;
  v_doc   uuid;
  v_bloq  text;
  v_subs  int := 0;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;

  select * into cp from cierres_periodo where id = p_periodo for update;
  if cp.id is null then
    raise exception 'Aquest certificat de periode no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  -- (0) Los datos de la Fundación tienen que ser los de verdad.
  if coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  if cp.certificado_numero is not null then
    raise exception 'Aquest periode ja te el certificat % (fes servir rectificar_certificado_periodo)',
      cp.certificado_numero using errcode = '22023';
  end if;
  if cp.calculado_at is null then
    raise exception 'Aquest periode no s''ha calculat encara' using errcode = '22023';
  end if;

  -- (1) Ningún bloqueo bloqueante. Aquí es donde siguen cortando
  --     `periode_parteix_excedent` y `periode_encavalcat`.
  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cp.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquest donant esta bloquejat: %', v_bloq using errcode = '22023';
  end if;

  if cp.kg_total <= 0 or cp.valor_total <= 0 then
    raise exception 'Un certificat de 0 quilos o 0 euros no te sentit' using errcode = '22023';
  end if;

  -- (2) El texto que dice que este certificado NO cubre el año natural entra por la
  --     plantilla `CD/parcial`: sin ella el PDF saldría con el cuerpo del certificado
  --     anual y afirmaría algo que no es cierto.
  if not exists (select 1 from plantillas_documento p
                  where p.tipo = 'CD' and p.variante = 'parcial' and p.vigente) then
    raise exception 'No hi ha cap plantilla CD/parcial vigent: sense ella el certificat no diria que es d''un periode'
      using errcode = '22023';
  end if;

  -- (3) AQUÍ IBA LA FACTURA, y ya no va (ver la cabecera de esta migración).
  --     `p_motivo_excepcion` se acepta y se ignora, igual que en el anual.

  v_dest := public.periodo_destinatario(p_periodo);

  v_serie := case when cp.modo = 'prueba' then 'P-CDP' else 'CDP' end;
  v_n := public.siguiente_numero(v_serie, cp.ejercicio);
  update cierres_periodo
     set certificado_numero = public.formato_numero(v_serie, cp.ejercicio, v_n),
         certificado_at     = now(),
         estado             = 'certificat_emes'
   where id = p_periodo
  returning * into cp;

  v_doc := public.periodo_emet_document(
    p_periodo,
    public.periodo_datos_certificado(p_periodo),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', 'Certificat de donacio (periode) ' || to_char(cp.periodo_desde, 'DD/MM/YYYY')
                || ' — ' || to_char(cp.periodo_hasta, 'DD/MM/YYYY') || ' · ' || cp.certificado_numero,
      'plantilla', 'certificat_donacio'));

  -- Los certificados anteriores del mismo donante CONTENIDOS en esta ventana quedan
  -- sustituidos: lo que este documento dice incluye lo que decían ellos, y dos papeles
  -- vigentes con kilos solapados es el doble conteo que hay que evitar.
  update cierres_periodo o
     set estado = 'substituit', sustituido_at = now(), sustituido_por_periodo = p_periodo
   where o.productor_id = cp.productor_id and o.modo = cp.modo
     and o.id <> p_periodo and o.certificado_numero is not null
     and o.estado <> 'substituit'
     and o.periodo_desde >= cp.periodo_desde and o.periodo_hasta <= cp.periodo_hasta;
  get diagnostics v_subs = row_count;

  update documentos d
     set vigente = false, sustituido_por = v_doc
   where d.objeto_tipo = 'cierre_periodo' and d.vigente and d.id <> v_doc
     and d.objeto_id in (select o.id from cierres_periodo o
                          where o.sustituido_por_periodo = p_periodo);

  return jsonb_build_object('document', v_doc, 'numero', cp.certificado_numero,
                            'data', cp.certificado_at, 'import', cp.valor_total,
                            'kg', cp.kg_total, 'destinatari', v_dest,
                            'periode', jsonb_build_object('des_de', cp.periodo_desde,
                                                          'fins_a', cp.periodo_hasta),
                            'substitueix', v_subs,
                            'excepcio', cp.excepcion_sin_factura);
end;
$$;

comment on function public.emitir_certificado_periodo(uuid, text) is
  'Emite el certificado de donación de una ventana. NO exige factura (21-09-2026); conserva plantilla CD/parcial vigente y los bloqueos de periodo.';

-- ---------------------------------------------------------------------------
-- 3. El snapshot solo cita la factura si CUADRA
-- ---------------------------------------------------------------------------
-- 🔴 Esta es la mitad menos evidente de la decisión, y sin ella el cambio produciría un
--    documento contradictorio. Antes, citar la factura en el certificado era seguro
--    porque emitir exigía que coincidiera al céntimo; retirada esa condición, un donante
--    con una factura de 11.900 € y un acumulado de 12.340,00 € obtendría un certificado
--    que **dice 12.340,00 € y cita debajo una factura de 11.900 €**: exactamente la
--    contradicción que la regla vieja impedía, ahora impresa y con efecto fiscal.
--
--    Así que el snapshot cita la factura **solo si `round(factura_importe, 2) =
--    round(valor_total, 2)`**. Si no cuadra —o si no hay importe, o no hay factura— las
--    tres claves van a `null` y `renderCd()` imprime su rama «Sense factura del donant»,
--    que es verdad: este certificado no se apoya en ninguna factura.
--
-- ⚠️ LA FORMA DEL JSON NO CAMBIA: `factura` sigue siendo un objeto con `numero`, `data` e
--    `import`, siempre presente. `renderCd()` decide con `datos.factura?.numero`, así que
--    un `null` ahí ya lo lleva por la rama correcta sin tocar una línea del renderizador.
--    Devolver `'factura', null` en vez del objeto habría funcionado igual hoy, pero deja
--    de ser la misma forma y cualquier lector de `documentos.datos` tendría que
--    contemplar dos.
--
-- ⚠️ La factura registrada NO se pierde: sigue en `cierres_donante.factura_*` /
--    `cierres_periodo.factura_*` y el equipo la ve en la pantalla del cierre. Lo que no
--    hace es entrar en un documento legal diciendo algo que no cuadra.
create or replace function public.cierre_datos_certificado(p_cd uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cd  cierres_donante%rowtype;
  ce  cierres_ejercicio%rowtype;
  par parametros_documentales%rowtype;
begin
  select * into cd from cierres_donante where id = p_cd;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  return jsonb_build_object(
    'tipus', 'CD',
    'mode', ce.modo,
    'exercici', ce.ejercicio,
    'numero', cd.certificado_numero,
    -- D14: la fecha del certificado es la de generación, no la del cierre.
    'data_generacio', now(),
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    -- Nombre y cargo sí; el DNI NO (ver cabecera de §4).
    'apoderada', jsonb_build_object('nom', par.apoderada_nombre, 'carrec', par.apoderada_cargo),
    'donant', cd.datos_fiscales,
    'periode', jsonb_build_object('des_de', (ce.ejercicio::text || '-01-01')::date,
                                  'fins_a', (ce.ejercicio::text || '-12-31')::date),
    'kg', cd.kg_total,
    'import', cd.valor_total,
    -- Solo se cita la factura que cuadra a dos decimales (ver el comentario de §3).
    'factura', case
                 when cd.factura_importe is not null
                  and round(cd.factura_importe, 2) = round(cd.valor_total, 2)
                 then jsonb_build_object('numero', cd.factura_numero,
                                         'data', cd.factura_fecha,
                                         'import', cd.factura_importe)
                 else jsonb_build_object('numero', null, 'data', null, 'import', null)
               end,
    'excepcio_sense_factura', cd.excepcion_sin_factura,
    'excepcio_motiu', cd.excepcion_motivo,
    'rectificacions', cd.rectificaciones,
    'detall', (
      select coalesce(jsonb_agg(x order by x->>'producte'), '[]'::jsonb)
        from (
          select jsonb_build_object('producte', l.producto, 'kg', sum(l.kg_neto),
                                    'valor', sum(l.valor)) as x
            from cierre_donante_lineas l
           where l.cierre_donante_id = cd.id
           group by l.producto
        ) d)
  );
end;
$$;

comment on function public.cierre_datos_certificado(uuid) is
  'Snapshot del certificado anual. Cita la factura del donante SOLO si coincide a 2 decimales con el valor calculado (21-09-2026).';

create or replace function public.periodo_datos_certificado(p_periodo uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cp  cierres_periodo%rowtype;
  par parametros_documentales%rowtype;
begin
  select * into cp from cierres_periodo where id = p_periodo;
  if cp.id is null then
    raise exception 'Aquest certificat de periode no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  return jsonb_build_object(
    'tipus', 'CD',
    -- Lo que distingue a este certificado del anual, para quien lea el JSON.
    'abast', 'periode',
    'mode', cp.modo,
    'exercici', cp.ejercicio,
    'numero', cp.certificado_numero,
    -- D14: la fecha del certificado es la de generación, no la del periodo.
    'data_generacio', now(),
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    -- Nombre y cargo sí; el DNI NO (ver cabecera).
    'apoderada', jsonb_build_object('nom', par.apoderada_nombre, 'carrec', par.apoderada_cargo),
    'donant', cp.datos_fiscales,
    'periode', jsonb_build_object('des_de', cp.periodo_desde, 'fins_a', cp.periodo_hasta),
    'kg', cp.kg_total,
    'import', cp.valor_total,
    -- Misma regla que el anual: se cita solo la factura que cuadra a dos decimales.
    'factura', case
                 when cp.factura_importe is not null
                  and round(cp.factura_importe, 2) = round(cp.valor_total, 2)
                 then jsonb_build_object('numero', cp.factura_numero,
                                         'data', cp.factura_fecha,
                                         'import', cp.factura_importe)
                 else jsonb_build_object('numero', null, 'data', null, 'import', null)
               end,
    'excepcio_sense_factura', cp.excepcion_sin_factura,
    'excepcio_motiu', cp.excepcion_motivo,
    'rectificacions', cp.rectificaciones,
    'detall', (
      select coalesce(jsonb_agg(x order by x->>'producte'), '[]'::jsonb)
        from (
          select jsonb_build_object('producte', l.producto, 'kg', sum(l.kg_neto),
                                    'valor', sum(l.valor)) as x
            from cierre_periodo_lineas l
           where l.cierre_periodo_id = cp.id
           group by l.producto
        ) d)
  );
end;
$$;

comment on function public.periodo_datos_certificado(uuid) is
  'Snapshot del certificado a demanda. Misma forma que el anual (lo imprime el mismo renderizador, tipo CD) y misma regla de factura: solo si cuadra a 2 decimales.';

-- ---------------------------------------------------------------------------
-- 4. EXECUTE
-- ---------------------------------------------------------------------------
-- Las cuatro son `create or replace` de funciones que ya existen: conservan sus
-- privilegios tal cual (las dos de emisión, `authenticated` + `service_role`; las dos de
-- snapshot, solo `service_role`). No hay nada que conceder ni que revocar.

-- Verificación (en un cierre de PRUEBA, y con `datos_provisionales = false`):
--   select emitir_certificado('<cd sin factura>');       -- ya no pide motivo ni super_admin
--   select datos->'factura' from documentos
--    where objeto_tipo = 'cierre_donante' and objeto_id = '<cd>' and vigente;
--     -> {"data": null, "import": null, "numero": null} si la factura no cuadra
