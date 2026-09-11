-- Las RPC del certificado de donación a demanda: de una ventana de fechas al PDF.
--
-- CÓMO SE LEE ESTE FICHERO. Mismas tres capas que `20261109100100_rpc_cierre.sql`:
--   · snapshot y puentes (§2–4): internos, solo `service_role`.
--   · acciones (§5–10): lo que llama el panel, con su comprobación de rol y su estado.
--
-- LAS GUARDAS SON LAS DEL CERTIFICADO ANUAL, LITERALMENTE, y eso no es una preferencia de
-- estilo: un certificado a demanda tiene el mismo efecto fiscal que uno anual sobre el
-- periodo que cubre. Así que se exige lo mismo —`pot_aprovar()`, datos de la Fundación no
-- provisionales, ningún bloqueo con `bloqueja = true`, kilos y valor positivos, y factura
-- coincidente o la excepción de D4 con `es_super_admin()` y motivo— más dos que el anual
-- no necesita porque no las puede sufrir:
--   · **el periodo no puede partir un excedente** (`periode_parteix_excedent`): los kilos
--     del certificado serían una parte del neto de un albarán de recepción, y repartir un
--     albarán entre dos certificados es una decisión de negocio (20270303100000);
--   · **dos certificados del mismo donante no se pueden solapar** a medias
--     (`periode_encavalcat`). Que uno CONTENGA al otro sí se permite, y es el caso normal
--     —«dame lo de este año a fecha de hoy», otra vez en junio—: al emitir el grande, el
--     pequeño queda sustituido. Lo que no cabe es «enero–marzo» y «febrero–mayo», donde
--     febrero y marzo estarían certificados dos veces sin forma de saberlo.
--
-- Y LA REGLA DE NO-DOBLE-CONTEO, en la base y no en una pantalla: **el anual manda**.
-- `emitir_certificado()` (20270303100400) sustituye los parciales del mismo donante y
-- ejercicio, y `datos_182()` sigue leyendo solo el cierre anual, así que la gestoría no
-- recibe nunca una fila de más.

-- ---------------------------------------------------------------------------
-- 1. La columna que faltaba: un parcial puede sustituir a otro parcial
-- ---------------------------------------------------------------------------
-- `cierres_periodo.cierre_donante_id` apunta al acumulado ANUAL que sustituye a la fila.
-- Falta el otro caso, el de «lo de este año a fecha de hoy» repetido: el certificado de
-- junio contiene al de marzo. Se añade aquí y no editando 20270303100100, que ya está
-- aplicada.
alter table cierres_periodo
  add column if not exists sustituido_por_periodo uuid references cierres_periodo(id) on delete set null;

comment on column cierres_periodo.sustituido_por_periodo is
  'El certificado a demanda POSTERIOR que contiene a este periodo y lo sustituye.';

-- ---------------------------------------------------------------------------
-- 2. periodo_datos_certificado(): el snapshot congelado
-- ---------------------------------------------------------------------------
-- Misma forma que `cierre_datos_certificado()`, porque **lo consume el mismo
-- renderizador**: el documento se emite con `documentos.tipo = 'CD'` y `renderCd()` ya
-- imprime `periode.des_de` / `periode.fins_a`. Lo único que cambia es de dónde sale ese
-- periodo: de la ventana, no del año natural.
--
-- ⚠️ NO LLEVA `apoderada_dni`, como el anual: `documentos.datos` lo lee el propio donante
--    a través de `documents_meus()`, y meter el DNI aquí lo publicaría.
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
    'factura', jsonb_build_object('numero', cp.factura_numero, 'data', cp.factura_fecha,
                                  'import', cp.factura_importe),
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
  'Snapshot del certificado a demanda. Misma forma que el anual: lo imprime el mismo renderizador (tipo CD).';

-- ---------------------------------------------------------------------------
-- 3. periodo_destinatario(): a quién se le manda
-- ---------------------------------------------------------------------------
-- Copia de `cierre_destinatario()` sobre el modo de ESTA fila. ⚠️ En modo prueba nunca se
-- escribe a un donante real, aunque `test_mode` esté apagado: solo a la propia
-- organización si su ficha es `es_test`, y si no al buzón del equipo. Sin buzón del
-- equipo se levanta excepción; quedarse sin destinatario es preferible a caer en el del
-- donante.
create or replace function public.periodo_destinatario(p_periodo uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cp     cierres_periodo%rowtype;
  pr     productores%rowtype;
  v_mail text;
begin
  select * into cp from cierres_periodo where id = p_periodo;
  select * into pr from productores where id = cp.productor_id;

  if cp.modo = 'real' then
    if coalesce(btrim(pr.email), '') = '' then
      raise exception 'El donant % no te correu a la fitxa: no es pot enviar', pr.name
        using errcode = '22023';
    end if;
    return jsonb_build_object('email', pr.email,
                              'nom', coalesce(pr.empresa, pr.name),
                              'forcat', false, 'motiu', 'donant');
  end if;

  if pr.es_test and coalesce(btrim(pr.email), '') <> '' then
    return jsonb_build_object('email', pr.email,
                              'nom', coalesce(pr.empresa, pr.name),
                              'forcat', true, 'motiu', 'organitzacio de prova (es_test)');
  end if;

  select email_equipo into v_mail from parametros_documentales where id = 1;
  if coalesce(btrim(v_mail), '') = '' then
    raise exception 'Mode prova sense bustia de l''equip: omple email_equipo a Configuracio'
      using errcode = '22023';
  end if;
  return jsonb_build_object('email', v_mail, 'nom', 'Equip Redestina',
                            'forcat', true, 'motiu', 'mode prova → bustia de l''equip');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. periodo_emet_document(): el puente con `documentos`
-- ---------------------------------------------------------------------------
-- Interna, mismo patrón que `cierre_emet_document()`. Dos diferencias, las dos
-- deliberadas:
--   · `objeto_tipo = 'cierre_periodo'` y `serie = CDP|P-CDP`, pero **`tipo = 'CD'`**: es
--     lo que hace que `renderCd()` lo imprima sin tocar el renderizador.
--   · la plantilla se pide con `variante = 'parcial'`, que es la que lleva el párrafo de
--     alcance (20270303100200). Sin ella el PDF saldría con el cuerpo provisional del
--     renderizador, que **no** dice que el certificado no cubre el año: por eso
--     `emitir_certificado_periodo()` se niega a emitir si no la encuentra.
create or replace function public.periodo_emet_document(
  p_periodo uuid,
  p_datos   jsonb,
  p_envio   jsonb default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cp       cierres_periodo%rowtype;
  v_serie  text;
  v_ver    int;
  v_previo uuid;
  v_id     uuid;
  v_idioma text;
  v_plant  uuid;
begin
  select * into cp from cierres_periodo where id = p_periodo;

  v_serie := case when cp.modo = 'prueba' then 'P-CDP' else 'CDP' end;

  -- El idioma sale del perfil del titular si existe (misma decisión que en el anual).
  select coalesce(pe.idioma, 'ca') into v_idioma
    from membresias m join perfiles pe on pe.id = m.user_id
   where m.productor_id = cp.productor_id and m.activo and m.rol_org = 'titular'
   order by m.created_at limit 1;
  v_idioma := coalesce(v_idioma, 'ca');

  select p.id into v_plant
    from plantillas_documento p
   where p.tipo = 'CD' and p.variante = 'parcial' and p.idioma = v_idioma and p.vigente
   limit 1;

  select id, version into v_previo, v_ver
    from documentos
   where objeto_tipo = 'cierre_periodo' and objeto_id = p_periodo
     and tipo = 'CD' and vigente;

  if v_previo is not null then
    update documentos set vigente = false where id = v_previo;
  end if;

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos, ruta, envio, emitido_por
  ) values (
    'CD', 'definitiu', 'cierre_periodo', p_periodo,
    cp.certificado_numero, coalesce(v_ver, 0) + 1, v_serie, cp.ejercicio,
    cp.modo, v_idioma, v_plant,
    p_datos,
    encode(sha256(convert_to(p_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('cierre_periodo', p_periodo, 'CD', cp.certificado_numero,
                          coalesce(v_ver, 0) + 1, cp.modo, cp.ejercicio),
    p_envio,
    auth.uid()
  ) returning id into v_id;

  if v_previo is not null then
    update documentos set sustituido_por = v_id where id = v_previo;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. calcular_certificado_periodo(): la foto de la ventana
-- ---------------------------------------------------------------------------
-- Recalculable mientras no se haya emitido: hay **un solo borrador por donante, modo y
-- ventana** (índice parcial de 20270303100100), así que llamarla dos veces con los mismos
-- argumentos actualiza la misma fila en vez de dejar dos.
create or replace function public.calcular_certificado_periodo(
  p_productor uuid,
  p_desde     date,
  p_hasta     date,
  p_modo      text default 'real'
) returns cierres_periodo
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cp     cierres_periodo%rowtype;
  pr     productores%rowtype;
  v_ej   int;
  v_hoy  date;
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
    raise exception 'Un certificat no pot cobrir dos exercicis (% i %): la serie i el cost per quilo son anuals',
      v_ej, extract(year from p_hasta)::int using errcode = '22023';
  end if;
  -- Certificar un periodo que todavía no ha terminado sería certificar el futuro: los
  -- kilos que faltan por conciliar llegarían después y el certificado ya estaría emitido.
  if p_hasta > v_hoy then
    raise exception 'El periode acaba el % i encara no ha acabat (avui es %)', p_hasta, v_hoy
      using errcode = '22023';
  end if;

  select * into pr from productores where id = p_productor;
  if pr.id is null then
    raise exception 'Aquest donant no existeix' using errcode = '22023';
  end if;

  -- ¿Hay ya un certificado emitido de esta misma ventana? Entonces esto no es un recálculo,
  -- es una rectificación, y tiene su propia función (que numera la versión siguiente).
  if exists (select 1 from cierres_periodo c
              where c.productor_id = p_productor and c.modo = p_modo
                and c.periodo_desde = p_desde and c.periodo_hasta = p_hasta
                and c.certificado_numero is not null and c.estado <> 'substituit') then
    raise exception 'Aquest donant ja te un certificat d''aquest periode: fes servir rectificar_certificado_periodo()'
      using errcode = '22023';
  end if;

  -- El borrador de esta ventana, o uno nuevo.
  select * into cp from cierres_periodo
   where productor_id = p_productor and modo = p_modo
     and periodo_desde = p_desde and periodo_hasta = p_hasta
     and certificado_numero is null
   for update;

  if cp.id is null then
    insert into cierres_periodo (productor_id, periodo_desde, periodo_hasta, ejercicio,
                                 modo, creado_por)
    values (p_productor, p_desde, p_hasta, v_ej, p_modo, auth.uid())
    returning * into cp;
  end if;

  -- Las líneas, siempre desde cero: son el detalle del cálculo, no un histórico.
  delete from cierre_periodo_lineas where cierre_periodo_id = cp.id;

  insert into cierre_periodo_lineas (
    cierre_periodo_id, canalizacion_id, albaran_rec_id, producto, mes,
    kg_neto, coste_kg, valor, entidad_id, retroactiva, excedente_partido)
  select cp.id, b.canalizacion_id, b.albaran_rec_id, b.producto, b.mes,
         b.kg_neto, b.coste_kg, b.valor, b.entidad_id, b.retroactiva, b.excedent_partit
    from public.cierre_base_periodo(p_desde, p_hasta, p_modo) b
   where b.productor_id = p_productor;

  update cierres_periodo c
     set kg_total     = (select coalesce(sum(l.kg_neto), 0) from cierre_periodo_lineas l
                          where l.cierre_periodo_id = c.id),
         valor_total  = (select coalesce(sum(l.valor), 0) from cierre_periodo_lineas l
                          where l.cierre_periodo_id = c.id),
         calculado_at = now(),
         datos_fiscales = jsonb_build_object(
           'raó_social', coalesce(pr.empresa, pr.name),
           'nif', pr.nif,
           'domicili', pr.direccion,
           'codi_postal', pr.codigo_postal,
           'poblacio', pr.poblacion,
           'provincia', public.provincia_por_cp(pr.codigo_postal),
           'email', pr.email),
         bloqueos = (
           select coalesce(jsonb_agg(x), '[]'::jsonb) from (
             -- (a) donaciones de la ventana sin conciliar. **Sigue bloqueando**: es la
             --     garantía «nada sin conciliar», y evaluada sobre el periodo certificado
             --     —y no sobre el año entero— por fin dice la verdad a mitad de año.
             select jsonb_build_object('codigo', 'sense_conciliar', 'bloqueja', true,
                      'detall', pe.canalizaciones::text || ' canalitzacions del periode sense conciliar ('
                                || round(pe.kg, 1)::text || ' kg)') as x
               from public.cierre_pendents_periodo(p_desde, p_hasta) pe
              where pe.productor_id = p_productor
             union all
             -- (b) productos sin coste por kilo del ejercicio
             select jsonb_build_object('codigo', 'sense_cost', 'bloqueja', true,
                      'detall', 'Sense cost per quilo de ' || v_ej::text || ': '
                                || string_agg(distinct coalesce(l.producto, '(sense producte)'), ', '))
               from cierre_periodo_lineas l
              where l.cierre_periodo_id = c.id and l.coste_kg is null
             having count(*) > 0
             union all
             -- (c) datos fiscales incompletos
             select jsonb_build_object('codigo', 'dades_fiscals', 'bloqueja', true,
                      'detall', 'Falten dades fiscals: ' || array_to_string(array_remove(array[
                        case when coalesce(btrim(pr.nif), '') = '' then 'NIF' end,
                        case when coalesce(btrim(pr.direccion), '') = '' then 'domicili' end,
                        case when coalesce(btrim(pr.codigo_postal), '') = '' then 'codi postal' end,
                        case when coalesce(btrim(pr.poblacion), '') = '' then 'poblacio' end],
                        null), ', '))
              where coalesce(btrim(pr.nif), '') = ''
                 or coalesce(btrim(pr.direccion), '') = ''
                 or coalesce(btrim(pr.codigo_postal), '') = ''
                 or coalesce(btrim(pr.poblacion), '') = ''
             union all
             -- (d) 🔴 la ventana parte un excedente: los kilos de estas líneas son una
             --     PARTE del neto de un albarán de recepción. El reparto es correcto
             --     (20270303100000), pero certificar media entrada es una decisión de
             --     negocio, no un detalle de cálculo. Bloquea.
             select jsonb_build_object('codigo', 'periode_parteix_excedent', 'bloqueja', true,
                      'detall', count(*)::text || ' linies surten d''un excedent que el periode parteix: '
                                || 'mou la data de tall o certifica l''excedent sencer')
               from cierre_periodo_lineas l
              where l.cierre_periodo_id = c.id and l.excedente_partido
             having count(*) > 0
             union all
             -- (e) otro certificado del mismo donante se solapa a medias con este
             select jsonb_build_object('codigo', 'periode_encavalcat', 'bloqueja', true,
                      'detall', 'El certificat ' || string_agg(o.certificado_numero, ', ')
                                || ' cobreix part d''aquest periode sense estar-hi contingut')
               from cierres_periodo o
              where o.productor_id = p_productor and o.modo = p_modo
                and o.id <> c.id and o.certificado_numero is not null
                and o.estado <> 'substituit'
                and o.periodo_desde <= p_hasta and o.periodo_hasta >= p_desde
                and not (o.periodo_desde >= p_desde and o.periodo_hasta <= p_hasta)
             having count(*) > 0
             union all
             -- (f) el certificado ANUAL ya está emitido: el anual manda y este parcial ya
             --     no aporta nada. Avisa, no bloquea: puede tener sentido reemitir un
             --     parcial de un tramo concreto para un tercero.
             select jsonb_build_object('codigo', 'ja_te_anual', 'bloqueja', false,
                      'detall', 'Aquest donant ja te el certificat anual '
                                || string_agg(cd.certificado_numero, ', ') || ' de ' || v_ej::text)
               from cierres_donante cd
               join cierres_ejercicio ce on ce.id = cd.cierre_id
              where cd.productor_id = p_productor and cd.tipo = 'donacio'
                and cd.certificado_numero is not null
                and ce.ejercicio = v_ej and ce.modo = p_modo
             having count(*) > 0
             union all
             -- (g) sin REC conciliado: avisa (es el caso de la conciliación retroactiva)
             select jsonb_build_object('codigo', 'sense_rec', 'bloqueja', false,
                      'detall', count(*)::text || ' canalitzacions sense albara de recepcio conciliat')
               from cierre_periodo_lineas l
              where l.cierre_periodo_id = c.id and l.albaran_rec_id is null
             having count(*) > 0
           ) b(x))
   where c.id = cp.id
  returning * into cp;

  return cp;
end;
$$;

comment on function public.calcular_certificado_periodo(uuid, date, date, text) is
  'Calcula el acumulado de un donante en una ventana y deja el borrador con sus bloqueos. No emite nada.';

-- ---------------------------------------------------------------------------
-- 6. registrar_factura_periodo()
-- ---------------------------------------------------------------------------
-- El equivalente de `registrar_factura()` para un periodo. Existe para que el camino
-- normal del certificado a demanda sea el mismo del anual —factura del donante que
-- coincide a 2 decimales con lo calculado— y la excepción de D4 siga siendo una
-- excepción. Sin esto, **todo** certificado a demanda tendría que emitirse por excepción,
-- que es exactamente lo que vacía de sentido una excepción.
--
-- SIN IMPORTE se queda en `factura_rebuda`. Con importe, la comparación es a 2 decimales
-- y **no hay tolerancia**.
create or replace function public.registrar_factura_periodo(
  p_periodo     uuid,
  p_numero      text,
  p_fecha       date default null,
  p_importe     numeric default null,
  p_doc_externo uuid default null
) returns cierres_periodo
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cp cierres_periodo%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar registra una factura' using errcode = '42501';
  end if;

  select * into cp from cierres_periodo where id = p_periodo for update;
  if cp.id is null then
    raise exception 'Aquest certificat de periode no existeix' using errcode = '22023';
  end if;
  if cp.estado = 'substituit' then
    raise exception 'Aquest periode ja esta substituit per un certificat posterior'
      using errcode = '22023';
  end if;
  if coalesce(btrim(p_numero), '') = '' then
    raise exception 'La factura necessita numero' using errcode = '22023';
  end if;

  update cierres_periodo
     set factura_numero  = p_numero,
         factura_fecha   = p_fecha,
         factura_importe = p_importe,
         factura_doc_externo_id = coalesce(p_doc_externo, factura_doc_externo_id),
         estado = case
                    when certificado_numero is not null then estado
                    when p_importe is null then 'factura_rebuda'
                    when round(p_importe, 2) = round(valor_total, 2) then 'coincident'
                    else 'discrepancia'
                  end
   where id = p_periodo
  returning * into cp;

  return cp;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. emitir_certificado_periodo()
-- ---------------------------------------------------------------------------
-- ⚠️ SE NIEGA MIENTRAS `parametros_documentales.datos_provisionales` VALGA `true`, igual
--    que el anual: la fila sembrada lleva el CIF `G00000000`, que no es válido, y un
--    certificado de donación con un CIF inventado es un documento que alguien podría
--    llevarse a su declaración.
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

  -- (1) Ningún bloqueo bloqueante.
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

  -- (3) Factura coincidente, o la excepción de D4. Igual que el anual, y por el mismo
  --     motivo: un certificado sin factura es exactamente el escenario que este circuito
  --     existe para impedir.
  if cp.estado <> 'coincident' then
    if auth.uid() is not null and not public.es_super_admin() then
      raise exception 'Sense factura coincident nomes el super_admin pot emetre el certificat'
        using errcode = '42501';
    end if;
    if coalesce(btrim(p_motivo_excepcion), '') = '' then
      raise exception 'L''excepcio sense factura coincident necessita motiu' using errcode = '22023';
    end if;
    update cierres_periodo
       set excepcion_sin_factura = true,
           excepcion_motivo      = p_motivo_excepcion,
           excepcion_por         = auth.uid()
     where id = p_periodo
    returning * into cp;
  end if;

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
  'Emite el certificado de donación de una ventana. Mismas guardas que el anual + periodo que no parta excedentes.';

-- ---------------------------------------------------------------------------
-- 8. marcar_enviado_periodo() y rectificar_certificado_periodo()
-- ---------------------------------------------------------------------------
create or replace function public.marcar_enviado_periodo(p_periodo uuid)
returns cierres_periodo
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cp cierres_periodo%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar marca un certificat com a enviat' using errcode = '42501';
  end if;
  update cierres_periodo
     set estado = 'enviat', enviado_at = now()
   where id = p_periodo and estado = 'certificat_emes'
  returning * into cp;
  if cp.id is null then
    raise exception 'Nomes s''envia un certificat ja emes' using errcode = '22023';
  end if;
  return cp;
end;
$$;

-- Una rectificación NO consume número nuevo: es la versión siguiente del mismo CDP, y la
-- anterior queda `vigente = false` (§A, decisión sobre numeración). Recalcula las líneas
-- antes de reemitir, que es justamente para lo que se rectifica.
create or replace function public.rectificar_certificado_periodo(p_periodo uuid, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cp     cierres_periodo%rowtype;
  par    parametros_documentales%rowtype;
  v_doc  uuid;
  v_dest jsonb;
  v_bloq text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Una rectificacio necessita motiu' using errcode = '22023';
  end if;

  select * into cp from cierres_periodo where id = p_periodo for update;
  if cp.id is null then
    raise exception 'Aquest certificat de periode no existeix' using errcode = '22023';
  end if;
  if cp.certificado_numero is null then
    raise exception 'Aquest periode encara no te certificat' using errcode = '22023';
  end if;
  if cp.estado = 'substituit' then
    raise exception 'Aquest periode ja esta substituit: rectifica el certificat que el va substituir'
      using errcode = '22023';
  end if;

  select * into par from parametros_documentales where id = 1;
  if coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat'
      using errcode = '42501';
  end if;

  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cp.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquest donant esta bloquejat: %', v_bloq using errcode = '22023';
  end if;

  update cierres_periodo
     set rectificaciones = rectificaciones + 1,
         certificado_at  = now(),
         estado          = 'certificat_emes'
   where id = p_periodo
  returning * into cp;

  v_dest := public.periodo_destinatario(p_periodo);
  v_doc := public.periodo_emet_document(
    p_periodo,
    public.periodo_datos_certificado(p_periodo) || jsonb_build_object('motiu_rectificacio', p_motivo),
    jsonb_build_object('destinatario', v_dest->>'email', 'nombre', v_dest->>'nom',
                       'forzado', v_dest->>'forcat', 'motiu_destinatari', v_dest->>'motiu',
                       'asunto', 'Certificat de donacio (periode) RECTIFICAT — ' || cp.certificado_numero,
                       'plantilla', 'certificat_donacio'));

  return jsonb_build_object('document', v_doc, 'numero', cp.certificado_numero,
                            'versio', cp.rectificaciones + 1, 'motiu', p_motivo);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. reiniciar_periodes_prova(): repetir el ensayo
-- ---------------------------------------------------------------------------
-- Gemela de `reiniciar_cierre_prueba()`. **No toca ni una canalización ni un albarán**:
-- borra los resultados del ensayo —filas, líneas y documentos en modo prueba— y devuelve
-- el contador `P-CDP` del ejercicio a 0.
create or replace function public.reiniciar_periodes_prova(p_ejercicio int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ej   int;
  v_docs int;
  v_lin  int;
  v_fil  int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar reinicia una prova' using errcode = '42501';
  end if;

  v_ej := coalesce(p_ejercicio, extract(year from (now() at time zone 'Europe/Madrid'))::int);

  perform set_config('redestina.reinicio_prueba', 'on', true);

  delete from documentos
   where objeto_tipo = 'cierre_periodo'
     and objeto_id in (select id from cierres_periodo
                        where modo = 'prueba' and ejercicio = v_ej);
  get diagnostics v_docs = row_count;

  delete from cierre_periodo_lineas
   where cierre_periodo_id in (select id from cierres_periodo
                                where modo = 'prueba' and ejercicio = v_ej);
  get diagnostics v_lin = row_count;

  delete from cierres_periodo where modo = 'prueba' and ejercicio = v_ej;
  get diagnostics v_fil = row_count;

  update series_documentales set ultimo = 0
   where ejercicio = v_ej and serie = 'P-CDP';

  return jsonb_build_object('exercici', v_ej, 'documents', v_docs, 'linies', v_lin,
                            'certificats', v_fil,
                            'canalitzacions', (select count(*) from canalizaciones),
                            'albarans', (select count(*) from albaranes));
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. EXECUTE: quitar el PUBLIC por defecto y conceder lo justo
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Sin estos revoke, `anon` podría emitir
--    certificados de donación sin ni siquiera tener sesión.
do $$
declare f text;
begin
  -- Acciones del equipo: comprueban `pot_aprovar()` / `es_super_admin()` por dentro, y el
  -- arnés verifica que un externo se lleva un 42501.
  foreach f in array array[
    'calcular_certificado_periodo(uuid,date,date,text)',
    'registrar_factura_periodo(uuid,text,date,numeric,uuid)',
    'emitir_certificado_periodo(uuid,text)',
    'marcar_enviado_periodo(uuid)',
    'rectificar_certificado_periodo(uuid,text)',
    'reiniciar_periodes_prova(int)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Internas de la emisión: `authenticated` no las ve ni existiendo. El snapshot lleva
  -- datos de la Fundación; el destinatario decide a quién se escribe; y
  -- `periodo_emet_document` inserta en `documentos`, que es justamente lo que la ausencia
  -- de GRANT de escritura impide.
  foreach f in array array[
    'periodo_datos_certificado(uuid)',
    'periodo_destinatario(uuid)',
    'periodo_emet_document(uuid,jsonb,jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Verificación:
--   select calcular_certificado_periodo('<productor>', '2026-01-01', '2026-09-30', 'prueba');
--   select emitir_certificado_periodo('<periodo>', 'prova');   -- 42501 con datos provisionales
--   select reiniciar_periodes_prova(2026);
