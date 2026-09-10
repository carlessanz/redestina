-- Las RPC del circuito de albaranes: emitir, entregar, confirmar, conciliar, anular,
-- rectificar; y la espigolada manual con su reparto en lotes.
--
-- POR QUÉ TODO ESTO SON FUNCIONES Y NO POLÍTICAS DE `update`. Cada una de estas acciones
-- hace varias cosas que tienen que pasar juntas o no pasar:
--   · emitir      = pedir número + congelar las partes + mover el estado + crear el
--                   documento que generará el PDF. Si el número se pide fuera de la
--                   transacción, un fallo posterior deja un hueco en una serie legal.
--   · conciliar   = escribir los kilos validados en las líneas + en la canalización +
--                   congelar el coste + emitir la versión `conciliat` que sustituye a la
--                   `emes`. A medias, el albarán diría una cosa y el PDF otra.
--   · repartir    = N canalizaciones que disparan N albaranes de entrega.
-- RLS no sabe hacer nada de eso, y una secuencia de llamadas desde el navegador tampoco
-- (es lo que hace hoy `OfferDetail.tsx` al aprobar, deuda §12.19, y por eso existe
-- `aprovar_resposta()`).
--
-- ⚠️ NINGUNA DE ESTAS FUNCIONES ESCRIBE UN IMPORTE EN UN ALBARÁN. `albaran_lineas` no
--    tiene columnas de dinero (20261012100300), así que no es una regla que haya que
--    recordar: es una imposibilidad de la tabla. El coste por kilo lo congela
--    `conciliar_albaran()` en `canalizaciones`, que es interno y no se imprime.

-- ---------------------------------------------------------------------------
-- 1. Los dos puentes: qué albaranes y qué documentos son de cada organización
-- ---------------------------------------------------------------------------
-- Funciones puente `security definer` que devuelven `setof uuid`, no `exists`
-- correlacionados (§A, deuda §12.23): envueltas en `(select …)` dentro de una política se
-- evalúan **una vez por consulta** (InitPlan) y no reentran en la RLS de `excedentes` ni
-- de `canalizaciones`.
--
-- REGLA DE PERTENENCIA, que es la misma que la del anexo A:
--   REC -> el productor del registro, o el de la espigolada (es quien dona)
--   ENT -> la entidad que recibe. El productor NO ve el ENT: por D3, el ENT ni siquiera
--          lleva su nombre —la entidad conoce el municipio y el lote, no al donante—, así
--          que enseñárselo al donante rompería la simetría por el otro lado.
--   OPE -> las dos partes: en una venta o una maquila el documento es entre ellas.
--
-- Los BORRADORES no salen nunca de las manos del equipo: un albarán sin número es un
-- papel de trabajo, y verlo desde fuera invitaría a preguntar por qué cambia.
create or replace function public.albarans_de_les_meves_orgs(p_user uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els albarans d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  return query
    with meves as (
      select m.productor_id, m.entidad_id
        from membresias m
        join perfiles p on p.id = m.user_id
       where m.user_id = v_user and m.activo and p.activo
    )
    select a.id
      from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
      left join excedentes     e on e.id = a.excedente_id
      left join espigoladas   es on es.id = a.espigolada_id
     where a.estado <> 'borrador'
       and (
            (a.tipo = 'REC' and coalesce(e.productor_id, es.productor_id)
                                in (select productor_id from meves where productor_id is not null))
         or (a.tipo = 'ENT' and c.entidad_id
                                in (select entidad_id from meves where entidad_id is not null))
         or (a.tipo = 'OPE' and (c.entidad_id in (select entidad_id from meves where entidad_id is not null)
                              or e.productor_id in (select productor_id from meves where productor_id is not null)))
       );
end;
$$;

comment on function public.albarans_de_les_meves_orgs(uuid) is
  'Ids de albaranes que ve una organización del usuario. REC -> productor, ENT -> entidad, OPE -> las dos. Sin borradores.';

-- `documents_meus()` reescrita. En la fase 1 devolvía vacío a propósito, para que la
-- política de `documentos` fuera la definitiva desde el primer día y cada fase solo
-- cambiara este cuerpo (20260928100800). Esta es la fase 3: los documentos de un albarán.
--
-- ⚠️ `create or replace` conserva la firma y los GRANT; la política de `documentos` no se
--    toca. Lo único que cambia es qué devuelve.
create or replace function public.documents_meus(p_user uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  if p_user is not null and auth.uid() is not null and p_user <> auth.uid() then
    raise exception 'No pots consultar els documents d''una altra persona' using errcode = '42501';
  end if;
  v_user := coalesce(p_user, auth.uid());
  if v_user is null then
    return;
  end if;

  return query
    select d.id
      from documentos d
     where d.objeto_tipo = 'albaran'
       and d.objeto_id in (select public.albarans_de_les_meves_orgs(v_user));
  -- Fase 2 añadirá `convenio`; fase 4, `cierre_donante`; fase 5, `plan`.
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Las políticas que faltaban
-- ---------------------------------------------------------------------------
-- 20261012100300 y 20261012100400 dejaron las tres tablas con RLS y solo la política del
-- equipo, porque el puente de arriba todavía no existía (una política no puede llamar a
-- una función inexistente). Aquí se completan.
drop policy if exists "albarans: intern" on albaranes;
drop policy if exists "albarans: intern o meus" on albaranes;
create policy "albarans: intern o meus"
  on albaranes for select to authenticated
  using (
       (select public.es_intern())
    or id in (select public.albarans_de_les_meves_orgs())
  );

drop policy if exists "linies albara: intern" on albaran_lineas;
drop policy if exists "linies albara: intern o meus" on albaran_lineas;
create policy "linies albara: intern o meus"
  on albaran_lineas for select to authenticated
  using (
       (select public.es_intern())
    or albaran_id in (select public.albarans_de_les_meves_orgs())
  );

-- Los adjuntos de un albarán los ve quien ve el albarán: el albarán del propio productor
-- es suyo, y la foto de una incidencia la aportó quien confirmó.
drop policy if exists "externs: intern" on documentos_externos;
drop policy if exists "externs: intern o meus" on documentos_externos;
create policy "externs: intern o meus"
  on documentos_externos for select to authenticated
  using (
       (select public.es_intern())
    or (objeto_tipo = 'albaran' and objeto_id in (select public.albarans_de_les_meves_orgs()))
  );

-- ---------------------------------------------------------------------------
-- 3. ruta_documento(): la rama de los albaranes (cierra la deuda §12.50 en su parte)
-- ---------------------------------------------------------------------------
-- La fase 1 la dejó levantando `0A000` para todo lo que no fuera `PROVA`, con el `case`
-- objetivo escrito en un comentario dentro de la propia función. Esto es ese `case`.
--
-- El propietario del fichero (§B.3) es la organización a la que pertenece el documento:
--   REC / R-REC -> productors/<productor>   (el generador que entrega)
--   ENT / R-ENT -> entitats/<entidad>       (la entidad que recibe)
--   OPE / R-OPE -> productors/<productor>   (el vendedor; el comprador lo ve por la tabla)
-- **Un fichero se guarda una sola vez**, bajo su organización propietaria: la otra parte
-- de un documento a dos bandas lo alcanza por `documents_meus()`, nunca por la ruta. La
-- carpeta ordena; la tabla autoriza.
create or replace function public.ruta_documento(
  p_objeto_tipo     text,
  p_objeto_id       uuid,
  p_tipo            text,
  p_numero_completo text,
  p_version         int,
  p_modo            text,
  p_ejercicio       int
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_carpeta text;
  v_fichero text;
  v_org     text;
begin
  -- El rectificativo se archiva con el original: `R-REC-2026-00007-v1.pdf` vive en `REC/`.
  v_carpeta := regexp_replace(p_tipo, '^R-', '');
  v_fichero := p_numero_completo || '-v' || p_version::text || '.pdf';

  if p_tipo = 'PROVA' or p_objeto_tipo = 'prova' then
    return 'proves/' || p_ejercicio::text || '/PROVA/' || v_fichero;
  end if;

  if p_objeto_tipo = 'albaran' then
    select case a.tipo
             when 'ENT' then 'entitats/'   || c.entidad_id::text
             else            'productors/' || coalesce(e.productor_id, es.productor_id)::text
           end
      into v_org
      from albaranes a
      left join canalizaciones c on c.id = a.canalizacion_id
      left join excedentes     e on e.id = a.excedente_id
      left join espigoladas   es on es.id = a.espigolada_id
     where a.id = p_objeto_id;

  elsif p_objeto_tipo = 'espigolada' then
    select 'productors/' || es.productor_id::text into v_org
      from espigoladas es where es.id = p_objeto_id;
  end if;
  -- Fase 2: 'convenio'. Fase 4: 'cierre_donante'. Fase 5: 'plan'.

  if v_org is null or v_org like '%null%' then
    raise exception
      'ruta_documento(): no es pot resoldre el propietari de % (%). Falta la taula o l''objecte no te organitzacio.',
      p_tipo, p_objeto_tipo using errcode = '0A000';
  end if;

  if p_modo = 'prueba' then
    return v_org || '/proves/' || p_ejercicio::text || '/' || v_carpeta || '/' || v_fichero;
  end if;
  return v_org || '/' || p_ejercicio::text || '/' || v_carpeta || '/' || v_fichero;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. exigir_convenio(): hoy avisa, en la fase 2 bloquea
-- ---------------------------------------------------------------------------
-- El funcional pide que, desde la fecha de corte (D7, prevista para el 1/4/2027), no se
-- pueda canalizar con una organización sin convenio firmado. La tabla `convenios` no
-- existe hasta la fase 2, así que esto es un **stub declarado**, no un olvido: devuelve el
-- aviso que la pantalla enseña y **nunca levanta excepción**.
--
-- Está escrito ahora, y no cuando exista la tabla, por un motivo concreto: quien tiene que
-- llamarlo es `repartir_espigolada()`, que se escribe hoy. Si el punto de llamada no
-- existiera desde el principio, la fase 2 tendría que acordarse de añadirlo —y el reparto
-- de una espigolada es justamente el camino que **no** pasa por `aprovar_resposta()`, o
-- sea el que se olvidaría—.
create or replace function public.exigir_convenio(p_tipo text, p_org uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_corte date;
begin
  select fecha_corte_convenios into v_corte from parametros_documentales where id = 1;

  if to_regclass('public.convenios') is null then
    return 'AVIS: encara no es comprova el conveni (fase 2). Data de tall prevista: ' ||
           coalesce(v_corte::text, 'sense fixar') || '.';
  end if;

  -- Fase 2: aquí se consulta `convenios` y, pasada la fecha de corte, se levanta 42501.
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Congelar las partes (interno de emitir_albaran)
-- ---------------------------------------------------------------------------
-- La copia congelada del anexo A: quién entrega, quién recibe y —solo en el ENT— el origen
-- del producto en la forma que permite D3 (municipio, comarca y código de lote; nunca el
-- nombre del productor).
--
-- La comarca sale de `municipios` (20260928100500) cruzando por `municipio_ine` de la
-- ubicación y, si no lo tiene, por nombre. Es la única pieza del albarán que no estaba en
-- ninguna tabla antes de la fase 1.
create or replace function public.albaran_partes(p_albaran uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  a    albaranes%rowtype;
  ex   excedentes%rowtype;
  esp  espigoladas%rowtype;
  prod productores%rowtype;
  ent  entidades%rowtype;
  ub   productor_ubicaciones%rowtype;
  par  parametros_documentales%rowtype;
  v_comarca text;
  v_muni    text;
  j_fundacio jsonb;
  j_prod     jsonb;
  j_ent      jsonb;
begin
  select * into a from albaranes where id = p_albaran;
  if a.id is null then
    raise exception 'No existeix l''albara %', p_albaran using errcode = '22023';
  end if;

  select * into par from parametros_documentales where id = 1;
  select * into ex  from excedentes   where id = a.excedente_id;
  select * into esp from espigoladas  where id = a.espigolada_id;
  select * into prod from productores where id = coalesce(ex.productor_id, esp.productor_id);
  select * into ub  from productor_ubicaciones where id = coalesce(ex.ubicacion_id, esp.ubicacion_id);
  if a.canalizacion_id is not null then
    select e.* into ent from entidades e
      join canalizaciones c on c.entidad_id = e.id
     where c.id = a.canalizacion_id;
  end if;

  v_muni := coalesce(ub.municipio, prod.poblacion);
  select m.comarca into v_comarca
    from municipios m
   where (ub.municipio_ine is not null and m.codi_ine = ub.municipio_ine)
      or (ub.municipio_ine is null and lower(m.nom) = lower(v_muni))
   limit 1;

  j_fundacio := jsonb_build_object(
    'razon_social', par.razon_social,
    'nif',          par.cif,
    'domicilio',    concat_ws(', ', par.domicilio, par.codigo_postal, par.poblacion),
    'inscripcion',  par.inscripcion
  );

  j_prod := jsonb_build_object(
    'razon_social',     coalesce(prod.empresa, prod.name),
    'nombre_comercial', prod.name,
    'nif',              prod.nif,
    'domicilio',        concat_ws(', ', prod.direccion, prod.codigo_postal, prod.poblacion),
    'lugar_recogida',   concat_ws(' · ', ub.alias, v_muni)
  );

  j_ent := jsonb_build_object(
    'razon_social', ent.nombre,
    'nif',          ent.nif,
    'domicilio',    concat_ws(', ', ent.direccion, ent.codigo_postal, ent.poblacion),
    'contacto',     ent.contacto
  );

  return case a.tipo
    -- REC: el generador entrega a Espigoladors.
    when 'REC' then jsonb_build_object('entrega', j_prod, 'recibe', j_fundacio)
    -- ENT: Espigoladors entrega a la entidad. El origen se declara SIN el nombre del
    -- productor (D3): municipio, comarca y código de lote, y nada más.
    when 'ENT' then jsonb_build_object(
                      'entrega', j_fundacio,
                      'recibe',  j_ent,
                      'origen',  jsonb_build_object(
                                   'municipio',   v_muni,
                                   'comarca',     v_comarca,
                                   'codigo_lote', (select c.codigo_lote from canalizaciones c
                                                    where c.id = a.canalizacion_id)))
    -- OPE: el generador vende o entrega a transformar. Aquí sí van las dos partes con
    -- nombre: son ellas las que contratan.
    else            jsonb_build_object('entrega', j_prod, 'recibe', j_ent)
  end;
end;
$$;

-- El snapshot que se congela en `documentos.datos` y del que sale el PDF. Lleva las
-- partes, la recogida, las líneas y las referencias; **ninguna cifra de euros**.
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
                      'espigolada', a.espigolada_id,
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

-- Inserta la fila de `documentos` de una versión del albarán. Devuelve su id.
-- `version` = la siguiente del mismo albarán y tipo; la anterior se marca sustituida, así
-- que el índice único parcial `(objeto_tipo, objeto_id, tipo) where vigente` sigue
-- cumpliéndose y **solo hay un PDF válido por albarán**.
create or replace function public.albaran_emet_document(
  p_albaran uuid,
  p_subtipo text,
  p_envio   jsonb default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a        albaranes%rowtype;
  v_datos  jsonb;
  v_ver    int;
  v_previo uuid;
  v_tipo   text;
  v_id     uuid;
begin
  select * into a from albaranes where id = p_albaran;
  v_tipo  := case when a.rectifica_a is not null then 'R-' || a.tipo else a.tipo end;
  v_datos := public.albaran_datos(p_albaran);

  select id, version into v_previo, v_ver
    from documentos
   where objeto_tipo = 'albaran' and objeto_id = p_albaran and tipo = v_tipo and vigente;

  if v_previo is not null then
    update documentos set vigente = false where id = v_previo;
  end if;

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos, ruta, envio, emitido_por
  ) values (
    v_tipo, p_subtipo, 'albaran', p_albaran,
    a.numero_completo, coalesce(v_ver, 0) + 1, a.serie, a.ejercicio,
    'real', a.idioma,
    (select p.id from plantillas_documento p
      where p.tipo = v_tipo and p.idioma = a.idioma and p.vigente limit 1),
    v_datos,
    encode(sha256(convert_to(v_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('albaran', p_albaran, v_tipo, a.numero_completo,
                          coalesce(v_ver, 0) + 1, 'real', a.ejercicio),
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
-- 6. emitir_albaran()
-- ---------------------------------------------------------------------------
-- Aquí es donde el borrador se convierte en documento: pide número **dentro de esta
-- transacción** (§A), congela las partes y encarga el PDF.
--
-- `p_lineas` (opcional) sustituye las líneas del borrador. Formato:
--   [{orden, producto, variedad, familia, causa, num_cajas, tipo_caja,
--     kg_bruto, tara_kg, kg_neto, kg_previstos, lote_origen}]
-- Si no se da `tara_kg`, se calcula como `num_cajas × tipos_caja.tara_kg`; si no se da
-- `kg_neto`, como `kg_bruto − tara_kg`. **`tara_kg` es la tara TOTAL de la línea**, no la
-- de una caja: es lo que se resta del bruto, y guardarla ya sumada evita tener que
-- recordar la aritmética cada vez que se lee una línea.
create or replace function public.emitir_albaran(
  p_id       uuid,
  p_recogida jsonb default null,
  p_lineas   jsonb default null,
  p_idioma   text default null
) returns albaranes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a          albaranes%rowtype;
  v_serie    text;
  v_ejercici int;
  v_n        int;
  v_numero   text;
  v_fecha    timestamptz;
  l          jsonb;
  v_orden    int := 0;
  v_tara     numeric;
  v_neto     numeric;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot emetre albarans' using errcode = '42501';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null then
    raise exception 'No existeix l''albara %', p_id using errcode = '22023';
  end if;
  if a.estado <> 'borrador' then
    raise exception 'Aquest albara ja esta emes (%)', a.numero_completo using errcode = '22023';
  end if;

  -- Las líneas, si se sustituyen. Solo se puede en borrador, que es donde estamos.
  if p_lineas is not null then
    delete from albaran_lineas where albaran_id = a.id;
    for l in select * from jsonb_array_elements(p_lineas) loop
      v_orden := v_orden + 1;
      v_tara := coalesce(
        (l->>'tara_kg')::numeric,
        (l->>'num_cajas')::numeric * (select t.tara_kg from tipos_caja t
                                       where t.codigo = l->>'tipo_caja'),
        0);
      v_neto := coalesce((l->>'kg_neto')::numeric,
                         (l->>'kg_bruto')::numeric - v_tara);
      if v_neto is not null and v_neto < 0 then
        raise exception 'La tara (%) es mes gran que el pes brut a la linia %', v_tara, v_orden
          using errcode = '22023';
      end if;
      insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                                  num_cajas, tipo_caja, kg_bruto, tara_kg, kg_neto,
                                  kg_previstos, lote_origen)
      values (a.id, coalesce((l->>'orden')::int, v_orden),
              l->>'producto', l->>'variedad', l->>'familia', l->>'causa',
              (l->>'num_cajas')::int, l->>'tipo_caja',
              (l->>'kg_bruto')::numeric, v_tara, v_neto,
              (l->>'kg_previstos')::numeric, l->>'lote_origen');
    end loop;
  end if;

  -- El ejercicio es el del acto documentado (la recogida), no el de hoy: un albarán que
  -- se emite el 2 de enero por una recogida del 30 de diciembre pertenece al año viejo, y
  -- eso decide en qué cierre anual entra.
  v_fecha    := coalesce((p_recogida->>'fecha_hora')::timestamptz,
                         (a.recogida->>'fecha_hora')::timestamptz,
                         (select c.data_hora_recollida from canalizaciones c where c.id = a.canalizacion_id),
                         now());
  v_ejercici := extract(year from (v_fecha at time zone 'Europe/Madrid'))::int;

  v_serie  := case when a.rectifica_a is not null then 'R-' || a.tipo else a.tipo end;
  v_n      := public.siguiente_numero(v_serie, v_ejercici);
  v_numero := public.formato_numero(v_serie, v_ejercici, v_n);

  -- ⚠️ UN SOLO `update`, y las partes dentro. Congelarlas en un segundo `update` era lo
  --    natural de escribir y **lo prohíbe el trigger de inmutabilidad**: en cuanto el
  --    estado deja de ser `borrador`, `partes` es una columna congelada. Es exactamente lo
  --    que el trigger tiene que impedir, así que la que se mueve es esta función.
  --    `albaran_partes()` es `stable` y lee la fila anterior, que es lo correcto: no
  --    necesita el número, solo las fichas y los parámetros.
  update albaranes
     set estado          = 'emitido',
         serie           = v_serie,
         ejercicio       = v_ejercici,
         numero          = v_n,
         numero_completo = v_numero,
         idioma          = coalesce(p_idioma, a.idioma),
         recogida        = coalesce(p_recogida, a.recogida),
         partes          = public.albaran_partes(a.id),
         emitido_at      = now(),
         emitido_por     = auth.uid()
   where id = a.id
  returning * into a;

  -- Y el documento, que dispara el PDF (trigger de encolado, 20260928100700).
  perform public.albaran_emet_document(a.id, 'emes', null);

  return a;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. marcar_entregado(): la recogida se ha hecho, sale el enlace de confirmación
-- ---------------------------------------------------------------------------
-- Devuelve `jsonb` y no la fila del albarán porque tiene que devolver **el token en
-- claro**: es la única vez que existe. En la base solo queda su sha256 (§enlaces_token),
-- así que si no se devuelve aquí, no se puede mandar el correo.
--
-- ⚠️ QUIÉN VE EL TOKEN. La función es `es_intern()`. En el flujo normal la llama la Edge
--    Function que manda el correo (`service_role`) y el token no toca el navegador. Cuando
--    la llama el panel, el equipo se queda con el enlace, y eso **es una capacidad
--    deliberada**: `enlaces_token.canal = 'asistido'` existe justamente porque el modelo
--    del proyecto es asistido (§1bis) y hay confirmaciones que se hacen por teléfono con
--    el dinamizador delante. Lo que impide que eso sea invisible es `evidencias`: cada
--    acto queda con su IP, su hora y, si fue asistido, con quién lo condujo.
--
-- Quién confirma, por tipo:
--   ENT -> la entidad que recibe
--   OPE -> las dos partes (§3.3.2: en venta y maquila confirman las dos)
--   REC -> el productor, si tiene correo. Si no lo tiene, no se crea enlace y se concilia
--          con el documento del productor o con el plazo vencido: un REC no se queda
--          bloqueado por una ficha incompleta.
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
      -- La entidad receptora (ENT y OPE).
      select e.email as email, coalesce(e.contacto, e.nombre) as nombre
        from entidades e
        join canalizaciones c on c.entidad_id = e.id
       where c.id = a.canalizacion_id and a.tipo in ('ENT', 'OPE')
      union all
      -- El generador (REC y OPE).
      select p.email, coalesce(p.empresa, p.name)
        from productores p
        join excedentes ex on ex.productor_id = p.id
       where ex.id = a.excedente_id and a.tipo in ('REC', 'OPE')
      union all
      -- El generador de una espigolada (REC sin excedente).
      select p.email, coalesce(p.empresa, p.name)
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
                               destinatario_email, destinatario_nombre,
                               token_hash, caduca_at, creado_por)
    values ('confirmacion_albaran', 'albaran', a.id,
            v_dest.email, v_dest.nombre,
            encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
            now() + make_interval(days => coalesce(par.caducidad_confirmacion_dias, 15)),
            auth.uid())
    returning id into v_id;

    v_res := v_res || jsonb_build_object(
      'id', v_id, 'destinatari', v_dest.email, 'nom', v_dest.nombre, 'token', v_token);
  end loop;

  return jsonb_build_object('albara', to_jsonb(a), 'enllacos', v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. registrar_confirmacion(): lo que escribe la otra parte, sin tener cuenta
-- ---------------------------------------------------------------------------
-- **Solo `service_role`**: la llama la Edge Function `enlace-publico` después de haber
-- resuelto el token con `resolver_enlace()`. Quien confirma no tiene sesión, así que
-- ninguna política puede protegerla: lo que la protege es tener el token.
--
-- CÓDIGOS DE ERROR. Se usan SQLSTATE `PT404`/`PT409`/`PT410` a propósito: PostgREST
-- traduce la clase `PT` al código HTTP que dicen las tres últimas cifras, así que el
-- enlace ya usado sale como **409** y el caducado como **410** sin que la Edge Function
-- tenga que traducir nada. Es exactamente lo que pide la aceptación de la fase 3.
--
-- `p_payload`  = { kg_confirmados: [{linea_id, kg}], caixes_retornades, incidencias,
--                  rechazo, motivo_rechazo }
-- `p_evidencia`= { nombre, cargo, ip, user_agent, sha256_texto }
create or replace function public.registrar_confirmacion(
  p_enlace    uuid,
  p_payload   jsonb,
  p_evidencia jsonb default null
) returns albaranes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  en enlaces_token%rowtype;
  a  albaranes%rowtype;
  k  jsonb;
  v_rechazo text;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor registra una confirmacio' using errcode = '42501';
  end if;

  select * into en from enlaces_token where id = p_enlace for update;
  if en.id is null or en.proposito <> 'confirmacion_albaran' then
    raise exception 'Enllac desconegut' using errcode = 'PT404';
  end if;
  if en.usado_at is not null or en.estado in ('usado', 'revocado') then
    raise exception 'Aquest enllac ja s''ha fet servir' using errcode = 'PT409';
  end if;
  if en.caduca_at < now() or en.estado = 'caducado' then
    raise exception 'Aquest enllac ha caducat' using errcode = 'PT410';
  end if;

  select * into a from albaranes where id = en.objeto_id for update;
  if a.id is null or a.estado not in ('emitido', 'entregado') then
    raise exception 'Aquest albara ja no admet confirmacio' using errcode = 'PT409';
  end if;

  -- Los kilos que dice haber recibido, línea a línea.
  for k in select * from jsonb_array_elements(coalesce(p_payload->'kg_confirmados', '[]'::jsonb)) loop
    update albaran_lineas
       set kg_confirmados = (k->>'kg')::numeric
     where id = (k->>'linea_id')::uuid and albaran_id = a.id;
  end loop;

  v_rechazo := coalesce(p_payload->>'rechazo', 'cap');
  if v_rechazo <> 'cap' and coalesce(btrim(p_payload->>'motivo_rechazo'), '') = '' then
    raise exception 'Un rebuig total o parcial necessita motiu' using errcode = '22023';
  end if;

  update albaranes
     set estado         = 'confirmado',
         confirmado_at  = now(),
         incidencias    = coalesce(p_payload->'incidencias', a.incidencias),
         rechazo        = v_rechazo,
         motivo_rechazo = p_payload->>'motivo_rechazo'
   where id = a.id
  returning * into a;

  if a.canalizacion_id is not null and (p_payload->>'caixes_retornades') is not null then
    update canalizaciones
       set caixes_retornades = (p_payload->>'caixes_retornades')::int
     where id = a.canalizacion_id;
  end if;

  -- La evidencia: es lo que hace que la confirmación valga algo.
  insert into evidencias (enlace_id, tipo, nombre, cargo, ip, user_agent, sha256_texto, payload)
  values (en.id, 'confirmacion',
          p_evidencia->>'nombre', p_evidencia->>'cargo',
          (p_evidencia->>'ip')::inet, p_evidencia->>'user_agent',
          p_evidencia->>'sha256_texto', p_payload);

  update enlaces_token set usado_at = now(), estado = 'usado' where id = en.id;

  return a;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. propuesta_conciliacion(): los tres números que hay que cuadrar
-- ---------------------------------------------------------------------------
-- Por cada donación se contrastan (§3.3.4 del funcional):
--   · el neto del albarán de RECEPCIÓN  (lo que entró)
--   · la suma de los netos confirmados de sus albaranes de ENTREGA (lo que llegó)
--   · el documento del productor, si lo hay
-- Si la diferencia está dentro de la tolerancia (parámetro, hoy 2 %), el sistema propone
-- conciliar y el dinamizador confirma con un clic. Si la supera, hace falta motivo.
--
-- No escribe nada: es la pantalla previa a `conciliar_albaran()`.
create or replace function public.propuesta_conciliacion(p_rec uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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

  select coalesce(sum(coalesce(l.kg_neto, l.kg_previstos)), 0) into v_rec
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
$$;

-- ---------------------------------------------------------------------------
-- 10. conciliar_albaran(): los kilos que cuentan
-- ---------------------------------------------------------------------------
-- Escribe `kg_validados` en las líneas y `kg_conciliados` en la canalización, congela el
-- coste por kilo y emite la versión `conciliat` del PDF, que **sustituye** a la `emes`
-- (una sola fila `vigente` por albarán, garantizado por el índice único parcial de
-- `documentos`).
--
-- `p_kg_validados` = [{linea_id, kg}]. Si es null, se valida lo confirmado (y, en su
-- defecto, lo entregado): es el camino de «dentro de tolerancia, un clic».
--
-- EXIGE confirmación **o** plazo vencido con motivo. Es la regla del funcional §3.3.3, y
-- la razón de que exista es práctica: sin ella, un receptor que no contesta bloquearía el
-- cierre anual de su donante.
create or replace function public.conciliar_albaran(
  p_id            uuid,
  p_kg_validados  jsonb default null,
  p_motivo        text default null,
  p_destino_final text default null
) returns albaranes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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
      select cp.coste_kg into v_coste from costes_producto cp
       where cp.producto = v_prod and cp.ejercicio = a.ejercicio;
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
$$;

-- ---------------------------------------------------------------------------
-- 11. anular_albaran() y rectificar_albaran()
-- ---------------------------------------------------------------------------
-- Anular = no hubo entrega. Los kilos vuelven a estar pendientes en el registro (la
-- canalización pasa a `anulada`) y el PDF deja de ser vigente, pero **el número no se
-- reutiliza**: un hueco explicado es correcto; un número reutilizado, no.
create or replace function public.anular_albaran(p_id uuid, p_motivo text)
returns albaranes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a albaranes%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden anul.lar un albara' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Cal indicar el motiu de l''anul.lacio' using errcode = '22023';
  end if;

  -- Un albarán ya conciliado NO se anula: se rectifica. Lo impediría igualmente el
  -- trigger de estados, pero con un mensaje sobre transiciones que no le dice a nadie qué
  -- hacer en su lugar.
  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado in ('anulado', 'rectificado', 'conciliado') then
    raise exception 'Aquest albara no es pot anul.lar (%): si ja esta conciliat, rectifica''l',
      coalesce(a.estado, 'no existeix') using errcode = '22023';
  end if;

  update albaranes
     set estado = 'anulado', anulado_at = now(), motivo_anulacion = p_motivo
   where id = a.id
  returning * into a;

  update documentos set vigente = false
   where objeto_tipo = 'albaran' and objeto_id = a.id and vigente;

  if a.canalizacion_id is not null then
    update canalizaciones set estado = 'anulada' where id = a.canalizacion_id;
  end if;

  -- Los enlaces de confirmación que quedaran vivos dejan de servir: el documento que
  -- pedían confirmar ya no existe.
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'albaran' and objeto_id = a.id and estado = 'activo';

  return a;
end;
$$;

-- Rectificar = el albarán decía algo que no era. Nace uno nuevo de la serie `R-<tipo>`,
-- con las líneas corregidas, y el original queda `rectificado` apuntando a él. No se
-- borra nada: los dos números existen y se explican el uno al otro.
create or replace function public.rectificar_albaran(
  p_id     uuid,
  p_lineas jsonb,
  p_motivo text
) returns albaranes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a     albaranes%rowtype;
  nueva albaranes%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes admin o super_admin poden rectificar un albara' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Cal indicar el motiu de la rectificacio' using errcode = '22023';
  end if;

  select * into a from albaranes where id = p_id for update;
  if a.id is null or a.estado in ('borrador', 'anulado', 'rectificado') then
    raise exception 'Aquest albara no es pot rectificar' using errcode = '22023';
  end if;

  insert into albaranes (tipo, excedente_id, espigolada_id, canalizacion_id,
                         retorn_envasos, observaciones, idioma, recogida, rectifica_a)
  values (a.tipo, a.excedente_id, a.espigolada_id, a.canalizacion_id,
          a.retorn_envasos, coalesce(p_motivo, a.observaciones), a.idioma, a.recogida, a.id)
  returning * into nueva;

  -- Se emite acto seguido: un rectificativo en borrador no tiene sentido (se rectifica
  -- porque ya se sabe lo que hay que corregir).
  nueva := public.emitir_albaran(nueva.id, a.recogida, p_lineas, a.idioma);

  update albaranes
     set estado = 'rectificado', rectificado_por = nueva.id
   where id = a.id;

  update documentos set vigente = false
   where objeto_tipo = 'albaran' and objeto_id = a.id and vigente;

  return nueva;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. La espigolada manual
-- ---------------------------------------------------------------------------
-- `p_lineas` = [{producto, variedad, familia, causa, num_cajas, tipo_caja,
--                kg_bruto, tara_kg, kg}]  — una por producto recogido.
--
-- Crea la cabecera, **un excedente por producto** (`origen = 'espigolament'`, modalitat
-- donación, estado `borrador`) y el albarán de recepción de la jornada, con una línea por
-- producto. `borrador` y no `publicada` a propósito: una espigolada no pasa por la cola de
-- publicación —es interna, y el reparto lo hace el equipo—, así que no debe aparecer en el
-- mercado de ninguna entidad.
--
-- El `id_excedente` sale de `siguiente_numero()`, no de contar filas: es el mismo
-- correlativo transaccional que todo lo demás, y evita de paso la colisión de la deuda
-- §12.39 (el formato `E-AAMMDD-XXX-YYY-N` no cambia).
create or replace function public.crear_espigolada(
  p_productor       uuid,
  p_ubicacion       uuid default null,
  p_fecha           date default null,
  p_num_voluntarios int default null,
  p_notas           text default null,
  p_lineas          jsonb default '[]'::jsonb,
  p_ref_externa     text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  esp      espigoladas%rowtype;
  l        jsonb;
  v_rec    uuid;
  v_orden  int := 0;
  v_ex     uuid;
  v_ejerc  int;
  v_serie  text;
  v_n      int;
  v_ids    jsonb := '[]'::jsonb;
  v_kg     numeric;
  v_fam    text;
  v_prefijo text;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot crear una espigolada' using errcode = '42501';
  end if;

  insert into espigoladas (productor_id, ubicacion_id, fecha, num_voluntarios, notas,
                           ref_externa, creada_por)
  values (p_productor, p_ubicacion,
          coalesce(p_fecha, (now() at time zone 'Europe/Madrid')::date),
          p_num_voluntarios, p_notas, p_ref_externa, auth.uid())
  returning * into esp;

  v_ejerc := extract(year from esp.fecha)::int;

  -- El albarán de recepción de la jornada: uno solo, con una línea por producto.
  insert into albaranes (tipo, espigolada_id, idioma)
  values ('REC', esp.id, 'ca')
  returning id into v_rec;

  for l in select * from jsonb_array_elements(p_lineas) loop
    v_orden := v_orden + 1;
    v_kg    := coalesce((l->>'kg')::numeric, 0);
    select familia into v_fam from productos where nombre = l->>'producto';

    -- id_excedente: E-AAMMDD-XXX-YYY-N, con N del contador de series.
    v_prefijo := 'E-' || to_char(esp.fecha, 'YYMMDD') || '-' ||
                 upper(left(regexp_replace(coalesce(
                   (select coalesce(p.empresa, p.name) from productores p where p.id = p_productor),
                   'XXX'), '[^a-zA-Z]', '', 'g') || 'XXX', 3)) || '-' ||
                 upper(left(regexp_replace(coalesce(l->>'producto', 'YYY'), '[^a-zA-Z]', '', 'g') || 'YYY', 3));
    v_n := public.siguiente_numero(v_prefijo, v_ejerc);

    insert into excedentes (id_excedente, productor_id, ubicacion_id, familia, producto,
                            variedad, kg_total, num_caixes, tipo_caixa, modalitat, causa,
                            estado, origen, espigolada_id, observacions)
    values (v_prefijo || '-' || v_n::text, p_productor, p_ubicacion,
            coalesce(l->>'familia', v_fam), l->>'producto', l->>'variedad',
            v_kg, (l->>'num_cajas')::int, l->>'tipo_caja', 'donacio', l->>'causa',
            'borrador', 'espigolament', esp.id, p_notas)
    returning id into v_ex;

    insert into albaran_lineas (albaran_id, orden, producto, variedad, familia, causa,
                                num_cajas, tipo_caja, kg_bruto, tara_kg, kg_neto, kg_previstos)
    values (v_rec, v_orden, l->>'producto', l->>'variedad', coalesce(l->>'familia', v_fam),
            l->>'causa', (l->>'num_cajas')::int, l->>'tipo_caja',
            (l->>'kg_bruto')::numeric, (l->>'tara_kg')::numeric, v_kg, v_kg);

    v_ids := v_ids || jsonb_build_object('excedente_id', v_ex, 'producte', l->>'producto', 'kg', v_kg);
  end loop;

  return jsonb_build_object('espigolada_id', esp.id, 'albara_rec', v_rec, 'registres', v_ids);
end;
$$;

-- Repartir en lotes. Cada lote es una canalización y, por el trigger de
-- 20261012100300, cada canalización nace con su albarán de entrega en borrador.
--
-- `p_lotes` = [{excedente_id, entidad_id, kg, nota, codigo_lote}]
--
-- ⚠️ AQUÍ SE LLAMA A `exigir_convenio()`. Este reparto **no pasa por
--    `aprovar_resposta()`**, así que es el único sitio donde el bloqueo por convenio de la
--    fase 2 tendría que aplicarse por su cuenta (§3.4 del funcional). Hoy el stub solo
--    devuelve un aviso, que se acumula en la respuesta; la fase 2 lo convierte en
--    excepción sin tocar esta función.
create or replace function public.repartir_espigolada(p_id uuid, p_lotes jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  esp      espigoladas%rowtype;
  lote     jsonb;
  v_can    uuid;
  v_aviso  text;
  v_avisos jsonb := '[]'::jsonb;
  v_res    jsonb := '[]'::jsonb;
  v_cub    numeric;
  ex       excedentes%rowtype;
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot repartir una espigolada' using errcode = '42501';
  end if;

  select * into esp from espigoladas where id = p_id for update;
  if esp.id is null or esp.estado <> 'oberta' then
    raise exception 'Aquesta espigolada no admet mes repartiment' using errcode = '22023';
  end if;

  for lote in select * from jsonb_array_elements(p_lotes) loop
    select * into ex from excedentes
     where id = (lote->>'excedente_id')::uuid and espigolada_id = esp.id;
    if ex.id is null then
      raise exception 'El registre % no es d''aquesta espigolada', lote->>'excedente_id'
        using errcode = '22023';
    end if;

    v_aviso := public.exigir_convenio('entidad', (lote->>'entidad_id')::uuid);
    if v_aviso is not null then
      v_avisos := v_avisos || to_jsonb(v_aviso);
    end if;

    insert into canalizaciones (excedente_id, entidad_id, kg_confirmados, valorizacion,
                                nota_lote, codigo_lote, estado)
    values (ex.id, (lote->>'entidad_id')::uuid, (lote->>'kg')::numeric, 'donacio',
            lote->>'nota', lote->>'codigo_lote', 'confirmada')
    returning id into v_can;

    v_res := v_res || jsonb_build_object('canalitzacio_id', v_can,
                                         'excedente_id', ex.id,
                                         'kg', (lote->>'kg')::numeric);

    -- Misma regla que `aprovar_resposta()`: al cubrir los kilos, el registro se bloquea.
    select coalesce(sum(kg_confirmados), 0) into v_cub
      from canalizaciones where excedente_id = ex.id;
    update excedentes
       set estado = case when coalesce(ex.kg_total, 0) > 0 and v_cub >= ex.kg_total
                         then 'bloqueada' else 'parcial' end
     where id = ex.id;
  end loop;

  return jsonb_build_object('lots', v_res, 'avisos', v_avisos);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. EXECUTE: quitar el PUBLIC por defecto y conceder lo justo
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Sin estos revoke, `anon` podría emitir
--    albaranes sin ni siquiera tener sesión.
do $$
declare
  f text;
begin
  -- Puentes y consultas: las usa la RLS y las pantallas.
  foreach f in array array[
    'albarans_de_les_meves_orgs(uuid)',
    'documents_meus(uuid)',
    'exigir_convenio(text,uuid)',
    'propuesta_conciliacion(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Las acciones del equipo: comprueban el rol por dentro (`es_intern()` / `pot_aprovar()`),
  -- y el arnés verifica que un externo se lleva un 42501.
  foreach f in array array[
    'emitir_albaran(uuid,jsonb,jsonb,text)',
    'marcar_entregado(uuid)',
    'conciliar_albaran(uuid,jsonb,text,text)',
    'anular_albaran(uuid,text)',
    'rectificar_albaran(uuid,jsonb,text)',
    'crear_espigolada(uuid,uuid,date,int,text,jsonb,text)',
    'repartir_espigolada(uuid,jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Las del servidor: `authenticated` no las ve ni existiendo. `registrar_confirmacion`
  -- la llama la Edge Function pública tras validar el token; `albaran_partes`,
  -- `albaran_datos` y `albaran_emet_document` son internas de la emisión.
  foreach f in array array[
    'registrar_confirmacion(uuid,jsonb,jsonb)',
    'albaran_partes(uuid)',
    'albaran_datos(uuid)',
    'albaran_emet_document(uuid,text,jsonb)',
    'ruta_documento(text,uuid,text,text,int,text,int)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Verificación:
--   select public.crear_espigolada('<productor>', null, current_date, 12, 'prova',
--            '[{"producto":"Tomàquet","kg":1000,"num_cajas":29,"tipo_caja":"PALOT"}]'::jsonb);
--   select public.emitir_albaran('<rec_id>');                  -- REC-2026-00001
--   select public.repartir_espigolada('<espigolada>', '[…]');  -- 3 ENT en borrador
--   select public.propuesta_conciliacion('<rec_id>');
--   select tipo, numero_completo, estado from albaranes order by created_at;
