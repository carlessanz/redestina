-- Las RPC del cierre anual: de las canalizaciones conciliadas al certificado de donación.
--
-- CÓMO SE LEE ESTE FICHERO. Hay tres capas, y la de abajo es la que importa:
--   · consulta (§1–3): `cierre_base()` y `cierre_pendents()` son funciones **puras de
--     lectura** que dicen qué entra en un cierre y qué falta. Se pueden ejecutar sueltas
--     (`select * from cierre_base(2026,'prueba')`) y son lo que hace auditable la cifra.
--   · emisión (§4–6): los snapshots congelados y el puente con `documentos`.
--   · acciones (§7–17): lo que llama el panel, con su comprobación de rol y su estado.
--
-- LA REGLA DE ORO, y no se negocia: **el importe del certificado es siempre el
-- calculado**. La factura del donante se cita y tiene que coincidir a 2 decimales. Si no
-- coincide, o el donante corrige la factura, o el equipo corrige un coste por kilo y se
-- recalcula. La única salida es la excepción de D4: `es_super_admin()` con motivo, que
-- queda registrado en la fila.
--
-- LOS KILOS SON LOS DEL ALBARÁN DE RECEPCIÓN (D13). La donación se produce al entregar a
-- Espigoladors, no al repartir después: si de 1.000 kg recibidos una entidad rechaza 10,
-- el donante donó 1.000. Como las líneas del cierre son **por canalización** (hace falta
-- saber a qué entidades llegó), el neto conciliado del REC se **reparte** entre las
-- canalizaciones del registro en proporción a sus kilos conciliados, y el residuo del
-- redondeo va entero a la línea mayor: así la suma de las líneas es EXACTAMENTE el neto
-- del REC, sin céntimos perdidos.
--
-- ⚠️ SI NO HAY REC CONCILIADO, los kilos son los de la canalización y la línea lo dice
--    (`albaran_rec_id` null). Es el caso de la **conciliación retroactiva** —las
--    canalizaciones de 2026 registradas antes de que existieran los albaranes, fuente 2
--    del plan— y por eso esas líneas solo cuentan en cierres de **prueba**.

-- ---------------------------------------------------------------------------
-- 1. provincia_por_cp(): los dos primeros dígitos del código postal
-- ---------------------------------------------------------------------------
-- La gestoría necesita la provincia en el 182 y la ficha no la tiene: solo hay código
-- postal. La correspondencia es fija desde 1985 y no depende de ninguna tabla, así que
-- `immutable` y escrita a mano. `municipios` no sirve: un donante puede tener el domicilio
-- fiscal fuera de Cataluña.
create or replace function public.provincia_por_cp(p_cp text)
returns text
language sql
immutable
as $$
  select case left(regexp_replace(coalesce(p_cp, ''), '\D', '', 'g'), 2)
    when '01' then 'Àlaba'         when '02' then 'Albacete'      when '03' then 'Alacant'
    when '04' then 'Almeria'       when '05' then 'Àvila'         when '06' then 'Badajoz'
    when '07' then 'Illes Balears' when '08' then 'Barcelona'     when '09' then 'Burgos'
    when '10' then 'Càceres'       when '11' then 'Cadis'         when '12' then 'Castelló'
    when '13' then 'Ciudad Real'   when '14' then 'Còrdova'       when '15' then 'A Coruña'
    when '16' then 'Conca'         when '17' then 'Girona'        when '18' then 'Granada'
    when '19' then 'Guadalajara'   when '20' then 'Guipúscoa'     when '21' then 'Huelva'
    when '22' then 'Osca'          when '23' then 'Jaén'          when '24' then 'Lleó'
    when '25' then 'Lleida'        when '26' then 'La Rioja'      when '27' then 'Lugo'
    when '28' then 'Madrid'        when '29' then 'Màlaga'        when '30' then 'Múrcia'
    when '31' then 'Navarra'       when '32' then 'Ourense'       when '33' then 'Astúries'
    when '34' then 'Palència'      when '35' then 'Las Palmas'    when '36' then 'Pontevedra'
    when '37' then 'Salamanca'     when '38' then 'Santa Cruz de Tenerife'
    when '39' then 'Cantàbria'     when '40' then 'Segòvia'       when '41' then 'Sevilla'
    when '42' then 'Sòria'         when '43' then 'Tarragona'     when '44' then 'Terol'
    when '45' then 'Toledo'        when '46' then 'València'      when '47' then 'Valladolid'
    when '48' then 'Biscaia'       when '49' then 'Zamora'        when '50' then 'Saragossa'
    when '51' then 'Ceuta'         when '52' then 'Melilla'
    else null
  end;
$$;

comment on function public.provincia_por_cp(text) is
  'Provincia a partir de los dos primeros dígitos del CP. La necesita el modelo 182 (§3.5.5).';

-- ---------------------------------------------------------------------------
-- 2. cierre_base(): qué entra en el cierre, canalización a canalización
-- ---------------------------------------------------------------------------
-- Pura, sin efectos. Es la definición ejecutable de la base de cálculo del §3.5.1:
--   donación · conciliada · fecha de recogida dentro del año natural EN HORA DE MADRID.
--
-- ⚠️ LA FECHA. El criterio es `data_hora_recollida`, pero hoy esa columna está vacía en
--    todas las canalizaciones que existen (el reparto de una espigolada y `aprovar_resposta`
--    no la escriben). Sin un respaldo, el cierre de prueba de 2026 saldría VACÍO y
--    parecería un fallo de permisos. Se cae, por ese orden, a `conciliada_at` y a
--    `created_at`: las tres son la misma fecha con un margen de días, y el año natural no
--    cambia salvo en el filo del 31 de diciembre —que es justo el caso que el job de
--    `congelar_ejercicio` resuelve congelando el cálculo esa noche—.
create or replace function public.cierre_base(p_ejercicio int, p_modo text default 'prueba')
returns table (
  canalizacion_id uuid,
  excedente_id    uuid,
  entidad_id      uuid,
  productor_id    uuid,
  producto        text,
  mes             int,
  kg_conciliados  numeric,
  coste_kg        numeric,
  retroactiva     boolean,
  albaran_rec_id  uuid,
  rec_neto        numeric,
  kg_neto         numeric,
  valor           numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with ops as (
    select c.id as canalizacion_id, c.excedente_id, c.entidad_id,
           e.productor_id, e.producto, e.espigolada_id,
           c.kg_conciliados, c.coste_kg,
           c.conciliacion_retroactiva as retroactiva,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid') as fecha_local
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
     where c.valorizacion = 'donacio'
       and c.estado = 'conciliada'
       and c.kg_conciliados is not null
       -- La conciliación retroactiva (sin albaranes) NO cuenta en un cierre real.
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  enrango as (
    select o.*, extract(month from o.fecha_local)::int as mes
      from ops o
     where extract(year from o.fecha_local)::int = p_ejercicio
  ),
  -- El REC del que salen los kilos. En una espigolada el REC cuelga de la espigolada y
  -- lleva una línea por producto, así que se empareja además por producto; en un registro
  -- normal cuelga del propio registro.
  conrec as (
    select o.*, r.albaran_id as albaran_rec_id, r.kg as rec_neto
      from enrango o
      left join lateral (
        select a.id as albaran_id, sum(l.kg_validados) as kg
          from albaranes a
          join albaran_lineas l on l.albaran_id = a.id
         where a.tipo = 'REC' and a.estado = 'conciliado'
           and ( (o.espigolada_id is not null
                  and a.espigolada_id = o.espigolada_id
                  and l.producto is not distinct from o.producto)
              or (o.espigolada_id is null and a.excedente_id = o.excedente_id) )
         group by a.id
         order by a.id
         limit 1
      ) r on true
  ),
  repartido as (
    select c.*,
           sum(c.kg_conciliados) over (partition by c.excedente_id) as suma_can,
           row_number() over (partition by c.excedente_id
                              order by c.kg_conciliados desc, c.canalizacion_id) as rn,
           case when c.rec_neto is not null
                 and sum(c.kg_conciliados) over (partition by c.excedente_id) > 0
                then round(c.kg_conciliados * c.rec_neto
                           / sum(c.kg_conciliados) over (partition by c.excedente_id), 2)
                else round(c.kg_conciliados, 2)
           end as kg_prop
      from conrec c
  ),
  ajustado as (
    select r.*,
           -- El residuo del redondeo va ENTERO a la línea mayor: la suma de las líneas es
           -- exactamente el neto del REC.
           case when r.rn = 1 and r.rec_neto is not null and r.suma_can > 0
                then round(r.rec_neto, 2) - sum(r.kg_prop) over (partition by r.excedente_id)
                else 0
           end as correccion
      from repartido r
  )
  select a.canalizacion_id, a.excedente_id, a.entidad_id, a.productor_id, a.producto, a.mes,
         a.kg_conciliados, a.coste_kg, a.retroactiva, a.albaran_rec_id, a.rec_neto,
         (a.kg_prop + a.correccion)::numeric as kg_neto,
         round((a.kg_prop + a.correccion) * coalesce(a.coste_kg, 0), 2) as valor
    from ajustado a;
$$;

comment on function public.cierre_base(int, text) is
  'Base de cálculo del cierre (§3.5.1): donaciones conciliadas del año, con los kilos del REC repartidos por canalización.';

-- ---------------------------------------------------------------------------
-- 3. cierre_pendents(): lo que falta por conciliar, y por tanto bloquea
-- ---------------------------------------------------------------------------
create or replace function public.cierre_pendents(p_ejercicio int)
returns table (productor_id uuid, canalizaciones int, kg numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.productor_id, count(*)::int, coalesce(sum(c.kg_confirmados), 0)
    from canalizaciones c
    join excedentes e on e.id = c.excedente_id
   where c.valorizacion = 'donacio'
     and c.estado in ('confirmada', 'entregada')
     and extract(year from (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
                              at time zone 'Europe/Madrid'))::int = p_ejercicio
   group by e.productor_id;
$$;

comment on function public.cierre_pendents(int) is
  'Canalizaciones de donación del ejercicio que siguen sin conciliar. Cada una bloquea el certificado de su donante.';

-- ---------------------------------------------------------------------------
-- 4. Los snapshots congelados
-- ---------------------------------------------------------------------------
-- ⚠️ NI EL RESUMEN NI EL CERTIFICADO LLEVAN `apoderada_dni`. `documentos.datos` lo lee el
--    propio donante a través de `documents_meus()`, así que meter el DNI aquí lo
--    publicaría —justo lo que evita el GRANT por columnas de `parametros_documentales`
--    (20260928100400)—. El renderizador lo lee con `service_role` si el documento lo
--    exige; el snapshot no.
create or replace function public.cierre_datos_resumen(p_cd uuid)
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
    'tipus', 'RES',
    'mode', ce.modo,
    'exercici', ce.ejercicio,
    'numero', cd.resumen_numero,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'donant', cd.datos_fiscales,
    'kg_total', cd.kg_total,
    'valor_total', cd.valor_total,
    'detall', (
      select coalesce(jsonb_agg(x order by x->>'producte', (x->>'mes')::int), '[]'::jsonb)
        from (
          select jsonb_build_object('producte', l.producto, 'mes', l.mes,
                                    'kg', sum(l.kg_neto), 'cost_kg', max(l.coste_kg),
                                    'valor', sum(l.valor)) as x
            from cierre_donante_lineas l
           where l.cierre_donante_id = cd.id
           group by l.producto, l.mes
        ) d),
    'destinacions', (
      select coalesce(jsonb_agg(distinct jsonb_build_object('entitat', e.nombre)), '[]'::jsonb)
        from cierre_donante_lineas l
        join entidades e on e.id = l.entidad_id
       where l.cierre_donante_id = cd.id),
    'factura', jsonb_build_object(
      'a_nom_de', par.razon_social,
      'import', cd.valor_total,
      'data_operacio', (ce.ejercicio::text || '-12-31')::date,
      'concepte', 'Donació d''aliments fora del circuit de venda habitual — exercici ' || ce.ejercicio::text),
    'bloquejos', cd.bloqueos
  );
end;
$$;

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
    'factura', jsonb_build_object('numero', cd.factura_numero, 'data', cd.factura_fecha,
                                  'import', cd.factura_importe),
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

-- ---------------------------------------------------------------------------
-- 5. ruta_documento(): la rama `cierre_donante`
-- ---------------------------------------------------------------------------
-- Se recrea entera (20261012100500 hizo lo mismo con la rama de los albaranes). El
-- propietario del fichero es el **donante**: un resumen y un certificado son suyos.
--   RES / CD -> productors/<productor>/[proves/]<ejercicio>/RES|CD/<numero>-vN.pdf
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

  elsif p_objeto_tipo = 'cierre_donante' then
    select 'productors/' || cd.productor_id::text into v_org
      from cierres_donante cd where cd.id = p_objeto_id;
  end if;
  -- Fase 2: 'convenio'. Fase 5: 'plan'.

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
-- 6. documents_meus(): el donante ve también sus RES y sus CD
-- ---------------------------------------------------------------------------
-- `create or replace` conserva la firma y los GRANT; la política de `documentos` no se
-- toca (20260928100800). Lo único que cambia es qué devuelve.
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
     where (d.objeto_tipo = 'albaran'
            and d.objeto_id in (select public.albarans_de_les_meves_orgs(v_user)))
        or (d.objeto_tipo = 'cierre_donante'
            and d.objeto_id in (select public.cierres_donante_meus(v_user)));
  -- Fase 2 añadirá `convenio`; fase 5, `plan`.
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. cierre_emet_document(): el puente con `documentos`
-- ---------------------------------------------------------------------------
-- Interna. Mismo patrón que `albaran_emet_document()`: el número ya está en la fila del
-- dominio, aquí solo se versiona el PDF y se apaga el anterior.
create or replace function public.cierre_emet_document(
  p_cd      uuid,
  p_tipo    text,
  p_subtipo text,
  p_datos   jsonb,
  p_envio   jsonb default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd       cierres_donante%rowtype;
  ce       cierres_ejercicio%rowtype;
  v_num    text;
  v_serie  text;
  v_ver    int;
  v_previo uuid;
  v_id     uuid;
  v_idioma text;
begin
  select * into cd from cierres_donante where id = p_cd;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;

  v_num   := case p_tipo when 'RES' then cd.resumen_numero else cd.certificado_numero end;
  v_serie := case when ce.modo = 'prueba' then 'P-' else '' end || p_tipo;

  -- El idioma del documento sale del perfil del titular si existe (decisión D del plan).
  select coalesce(pe.idioma, 'ca') into v_idioma
    from membresias m join perfiles pe on pe.id = m.user_id
   where m.productor_id = cd.productor_id and m.activo and m.rol_org = 'titular'
   order by m.created_at limit 1;

  select id, version into v_previo, v_ver
    from documentos
   where objeto_tipo = 'cierre_donante' and objeto_id = p_cd and tipo = p_tipo and vigente;

  if v_previo is not null then
    update documentos set vigente = false where id = v_previo;
  end if;

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos, ruta, envio, emitido_por
  ) values (
    p_tipo, p_subtipo, 'cierre_donante', p_cd,
    v_num, coalesce(v_ver, 0) + 1, v_serie, ce.ejercicio,
    ce.modo, coalesce(v_idioma, 'ca'),
    (select p.id from plantillas_documento p
      where p.tipo = p_tipo and p.idioma = coalesce(v_idioma, 'ca') and p.vigente limit 1),
    p_datos,
    encode(sha256(convert_to(p_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('cierre_donante', p_cd, p_tipo, v_num,
                          coalesce(v_ver, 0) + 1, ce.modo, ce.ejercicio),
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
-- 8. cierre_destinatario(): a quién se le manda, y por qué a ese
-- ---------------------------------------------------------------------------
-- ⚠️ EN MODO PRUEBA NUNCA SE ESCRIBE A UN DONANTE REAL, aunque `test_mode` esté apagado
--    (§3.5.6). Solo se escribe a la propia organización si su ficha es `es_test`; en
--    cualquier otro caso, al buzón del equipo. Si no hay buzón del equipo, se levanta
--    excepción: quedarse sin destinatario es preferible a caer al del donante.
create or replace function public.cierre_destinatario(p_cd uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cd     cierres_donante%rowtype;
  ce     cierres_ejercicio%rowtype;
  pr     productores%rowtype;
  v_mail text;
begin
  select * into cd from cierres_donante where id = p_cd;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into pr from productores where id = cd.productor_id;

  if ce.modo = 'real' then
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
-- 9. abrir_cierre()
-- ---------------------------------------------------------------------------
create or replace function public.abrir_cierre(p_ejercicio int, p_modo text default 'prueba')
returns cierres_ejercicio
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ce cierres_ejercicio%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar obre un tancament' using errcode = '42501';
  end if;
  if p_modo not in ('prueba', 'real') then
    raise exception 'Mode de tancament desconegut: %', p_modo using errcode = '22023';
  end if;
  -- Abrir el cierre REAL es el acto que consume las series legales de un año: super_admin.
  if p_modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin obre el tancament real' using errcode = '42501';
  end if;
  if p_ejercicio > extract(year from (now() at time zone 'Europe/Madrid'))::int then
    raise exception 'No es pot tancar un exercici que encara no ha comencat' using errcode = '22023';
  end if;
  if p_modo = 'real' and exists (select 1 from cierres_ejercicio
                                  where ejercicio = p_ejercicio and modo = 'real') then
    raise exception 'L''exercici % ja te un tancament real', p_ejercicio using errcode = '22023';
  end if;

  insert into cierres_ejercicio (ejercicio, modo, creado_por)
  values (p_ejercicio, p_modo, auth.uid())
  returning * into ce;
  return ce;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. calcular_cierre(): recalculable mientras el ejercicio no esté cerrado
-- ---------------------------------------------------------------------------
-- Reescribe las líneas y los totales; **no toca** los estados, los números ni la factura.
-- Recalcular después de haber emitido un certificado es legítimo (una conciliación tardía),
-- y lo que hace es dejar el aviso `certificat_desactualitzat` en `bloqueos`, que la
-- bandeja enseña y `rectificar_certificado()` resuelve.
create or replace function public.calcular_cierre(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ce      cierres_ejercicio%rowtype;
  v_don   int;
  v_lin   int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar calcula un tancament' using errcode = '42501';
  end if;

  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;
  if ce.estado not in ('obert', 'provisional') then
    raise exception 'Un tancament % ja no es recalcula', ce.estado using errcode = '22023';
  end if;

  -- 1. Las filas de donante que hagan falta (las que ya estaban se conservan con su
  --    número, su factura y su estado).
  insert into cierres_donante (cierre_id, productor_id)
  select p_cierre, d.productor_id
    from (
      select productor_id from public.cierre_base(ce.ejercicio, ce.modo)
      union
      select productor_id from public.cierre_pendents(ce.ejercicio)
    ) d
  on conflict (cierre_id, productor_id) do nothing;

  -- 2. Las líneas, siempre desde cero: son el detalle del cálculo, no un histórico.
  delete from cierre_donante_lineas
   where cierre_donante_id in (select id from cierres_donante where cierre_id = p_cierre);

  insert into cierre_donante_lineas (
    cierre_donante_id, canalizacion_id, albaran_rec_id, producto, mes,
    kg_neto, coste_kg, valor, entidad_id, retroactiva)
  select cd.id, b.canalizacion_id, b.albaran_rec_id, b.producto, b.mes,
         b.kg_neto, b.coste_kg, b.valor, b.entidad_id, b.retroactiva
    from public.cierre_base(ce.ejercicio, ce.modo) b
    join cierres_donante cd on cd.cierre_id = p_cierre and cd.productor_id = b.productor_id;
  get diagnostics v_lin = row_count;

  -- 3. Totales, datos fiscales congelados y bloqueos.
  -- ⚠️ Los totales van en subconsultas correlacionadas dentro del `set`, no en un
  --    `left join lateral` del `from`: en un UPDATE la tabla destino NO se puede
  --    referenciar desde el FROM («invalid reference to FROM-clause entry»). Dentro del
  --    `set` sí, y además `cd.valor_total` sigue valiendo lo ANTERIOR, que es justo lo
  --    que necesita el aviso (e) para comparar con lo recién calculado.
  update cierres_donante cd
     set kg_total     = (select coalesce(sum(l.kg_neto), 0) from cierre_donante_lineas l
                          where l.cierre_donante_id = cd.id),
         valor_total  = (select coalesce(sum(l.valor), 0) from cierre_donante_lineas l
                          where l.cierre_donante_id = cd.id),
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
             -- (a) canalizaciones del año sin conciliar
             select jsonb_build_object('codigo', 'sense_conciliar', 'bloqueja', true,
                      'detall', pe.canalizaciones::text || ' canalitzacions sense conciliar ('
                                || round(pe.kg, 1)::text || ' kg)') as x
               from public.cierre_pendents(ce.ejercicio) pe
              where pe.productor_id = cd.productor_id
             union all
             -- (b) productos sin coste por kilo del ejercicio
             select jsonb_build_object('codigo', 'sense_cost', 'bloqueja', true,
                      'detall', 'Sense cost per quilo de ' || ce.ejercicio::text || ': '
                                || string_agg(distinct coalesce(l.producto, '(sense producte)'), ', '))
               from cierre_donante_lineas l
              where l.cierre_donante_id = cd.id and l.coste_kg is null
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
             -- (d) sin REC conciliado: AVISA, no bloquea (es el caso retroactivo)
             select jsonb_build_object('codigo', 'sense_rec', 'bloqueja', false,
                      'detall', count(*)::text || ' canalitzacions sense albara de recepcio conciliat')
               from cierre_donante_lineas l
              where l.cierre_donante_id = cd.id and l.albaran_rec_id is null
             having count(*) > 0
             union all
             -- (e) el certificado emitido ya no dice lo que dice el cálculo
             select jsonb_build_object('codigo', 'certificat_desactualitzat', 'bloqueja', false,
                      'detall', 'El certificat ' || cd.certificado_numero
                                || ' es va emetre per un altre import: cal rectificar-lo')
              where cd.certificado_numero is not null
                and round(cd.valor_total, 2) <> round((select coalesce(sum(l.valor), 0)
                                                         from cierre_donante_lineas l
                                                        where l.cierre_donante_id = cd.id), 2)
           ) b(x))
    from productores pr
   where cd.cierre_id = p_cierre and pr.id = cd.productor_id;
  get diagnostics v_don = row_count;

  update cierres_ejercicio set calculado_at = now() where id = p_cierre;

  return jsonb_build_object(
    'tancament', p_cierre, 'exercici', ce.ejercicio, 'mode', ce.modo,
    'donants', v_don, 'linies', v_lin,
    'kg_total', (select coalesce(sum(kg_total), 0) from cierres_donante where cierre_id = p_cierre),
    'valor_total', (select coalesce(sum(valor_total), 0) from cierres_donante where cierre_id = p_cierre),
    'bloquejats', (select count(*) from cierres_donante
                    where cierre_id = p_cierre
                      and exists (select 1 from jsonb_array_elements(bloqueos) b
                                   where (b->>'bloqueja')::boolean)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. emitir_resumen(): el resumen anual y la solicitud de factura
-- ---------------------------------------------------------------------------
-- El **número no se vuelve a pedir** si ya lo tiene: el resumen definitivo es la versión 2
-- del mismo RES, no un documento nuevo (§A: el número pertenece a la fila).
create or replace function public.emitir_resumen(p_cd uuid, p_provisional boolean default true)
returns jsonb
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
  v_token text;
  v_enl   uuid;
  v_doc   uuid;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un resum anual' using errcode = '42501';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  if cd.id is null then
    raise exception 'Aquest donant no es d''un tancament' using errcode = '22023';
  end if;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  if ce.estado = 'declarat' then
    raise exception 'L''exercici ja esta declarat' using errcode = '22023';
  end if;
  if cd.kg_total <= 0 then
    raise exception 'Aquest donant no te quilos conciliats a l''exercici' using errcode = '22023';
  end if;

  v_dest := public.cierre_destinatario(p_cd);

  -- Número (una sola vez por donante y cierre), dentro de esta transacción.
  if cd.resumen_numero is null then
    v_serie := case when ce.modo = 'prueba' then 'P-RES' else 'RES' end;
    v_n := public.siguiente_numero(v_serie, ce.ejercicio);
    update cierres_donante
       set resumen_numero = public.formato_numero(v_serie, ce.ejercicio, v_n)
     where id = p_cd
    returning * into cd;
  end if;

  -- El enlace para subir la factura. Se revoca el anterior y se crea uno nuevo: reenviar
  -- un resumen con un token muerto sería peor que no reenviarlo.
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'cierre_donante' and objeto_id = p_cd
     and proposito = 'subida_factura' and estado = 'activo';

  v_token := rtrim(translate(
    encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text ||
                             clock_timestamp()::text, 'UTF8')), 'base64'),
    '+/', '-_'), '=');

  insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                             destinatario_email, destinatario_nombre,
                             token_hash, caduca_at, creado_por)
  values ('subida_factura', 'cierre_donante', p_cd,
          v_dest->>'email', v_dest->>'nom',
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          now() + interval '60 days', auth.uid())
  returning id into v_enl;

  v_doc := public.cierre_emet_document(
    p_cd, 'RES',
    case when p_provisional then 'provisional' else 'definitiu' end,
    public.cierre_datos_resumen(p_cd) || jsonb_build_object('enllac_factura', v_enl),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', case when p_provisional then 'Resum provisional ' else 'Resum anual ' end
                || ce.ejercicio::text || ' — ' || coalesce(cd.resumen_numero, ''),
      'plantilla', 'resumen_anual',
      'token', v_token));

  update cierres_donante
     set estado = case when p_provisional then 'resum_enviat' else 'factura_pendent' end
   where id = p_cd and estado in ('calculat', 'resum_enviat', 'factura_pendent');

  return jsonb_build_object('document', v_doc, 'numero', cd.resumen_numero,
                            'enllac', v_enl, 'token', v_token,
                            'destinatari', v_dest);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. registrar_factura() y simular_factura()
-- ---------------------------------------------------------------------------
-- `registrar_factura` la llaman DOS caminos: el equipo desde el panel y la Edge Function
-- `enlace-publico` con `service_role` cuando el donante sube el PDF por el enlace. Por eso
-- la comprobación es `auth.uid() is not null and not pot_aprovar()`: `service_role` no
-- tiene `auth.uid()` y pasa, como en el resto del circuito.
--
-- SIN IMPORTE se queda en `factura_rebuda` (el PDF ha llegado pero nadie ha tecleado la
-- cifra). Con importe, la comparación es a 2 decimales y **no hay tolerancia**.
create or replace function public.registrar_factura(
  p_cd          uuid,
  p_numero      text,
  p_fecha       date default null,
  p_importe     numeric default null,
  p_doc_externo uuid default null
) returns cierres_donante
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd cierres_donante%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar registra una factura' using errcode = '42501';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  if cd.id is null then
    raise exception 'Aquest donant no es d''un tancament' using errcode = '22023';
  end if;
  if cd.estado = 'declarat' then
    raise exception 'Aquest donant ja esta declarat al 182' using errcode = '22023';
  end if;
  if coalesce(btrim(p_numero), '') = '' then
    raise exception 'La factura necessita numero' using errcode = '22023';
  end if;

  update cierres_donante
     set factura_numero  = p_numero,
         factura_fecha   = p_fecha,
         factura_importe = p_importe,
         factura_doc_externo_id = coalesce(p_doc_externo, factura_doc_externo_id),
         requiere_llamada = false,
         estado = case
                    when p_importe is null then 'factura_rebuda'
                    when round(p_importe, 2) = round(cd.valor_total, 2) then 'coincident'
                    else 'discrepancia'
                  end
   where id = p_cd
  returning * into cd;

  -- El enlace de subida se consume: un token de factura no se reutiliza tras usarlo.
  update enlaces_token set estado = 'usado', usado_at = now()
   where objeto_tipo = 'cierre_donante' and objeto_id = p_cd
     and proposito = 'subida_factura' and estado = 'activo';

  return cd;
end;
$$;

-- Solo en modo prueba. Existe para poder ensayar los tres caminos —coincidencia,
-- discrepancia y recordatorio— sin pedirle nada a nadie (§3.5.6).
create or replace function public.simular_factura(
  p_cd             uuid,
  p_desviacion_pct numeric default 0,
  p_numero         text default null,
  p_fecha          date default null
) returns cierres_donante
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd cierres_donante%rowtype;
  ce cierres_ejercicio%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar simula una factura' using errcode = '42501';
  end if;

  select * into cd from cierres_donante where id = p_cd;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  if ce.id is null then
    raise exception 'Aquest donant no es d''un tancament' using errcode = '22023';
  end if;
  if ce.modo <> 'prueba' then
    raise exception 'Nomes es poden simular factures en un tancament de prova'
      using errcode = '42501';
  end if;

  return public.registrar_factura(
    p_cd,
    coalesce(p_numero, 'SIM-' || ce.ejercicio::text || '-' || left(replace(p_cd::text, '-', ''), 6)),
    coalesce(p_fecha, (ce.ejercicio::text || '-12-31')::date),
    round(cd.valor_total * (1 + coalesce(p_desviacion_pct, 0) / 100), 2),
    null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. emitir_certificado()
-- ---------------------------------------------------------------------------
-- ⚠️ SE NIEGA MIENTRAS `parametros_documentales.datos_provisionales` VALGA `true`. Es la
--    deuda §12.56 y se cierra aquí: la fila sembrada lleva el CIF `G00000000`, que no es
--    válido, y un certificado de donación con un CIF inventado es un documento que alguien
--    podría llevarse a su declaración. Ninguna otra emisión lo comprueba porque ninguna
--    otra tiene efecto fiscal.
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
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  if cd.id is null then
    raise exception 'Aquest donant no es d''un tancament' using errcode = '22023';
  end if;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  -- (0) Los datos de la Fundación tienen que ser los de verdad.
  if coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
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

  -- (2) Factura coincidente, o la excepción de D4.
  if cd.estado <> 'coincident' then
    if auth.uid() is not null and not public.es_super_admin() then
      raise exception 'Sense factura coincident nomes el super_admin pot emetre el certificat'
        using errcode = '42501';
    end if;
    if coalesce(btrim(p_motivo_excepcion), '') = '' then
      raise exception 'L''excepcio sense factura coincident necessita motiu' using errcode = '22023';
    end if;
    update cierres_donante
       set excepcion_sin_factura = true,
           excepcion_motivo      = p_motivo_excepcion,
           excepcion_por         = auth.uid()
     where id = p_cd
    returning * into cd;
  end if;

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

  return jsonb_build_object('document', v_doc, 'numero', cd.certificado_numero,
                            'data', cd.certificado_at, 'import', cd.valor_total,
                            'kg', cd.kg_total, 'destinatari', v_dest,
                            'excepcio', cd.excepcion_sin_factura);
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. marcar_enviado() · marcar_declarado() · rectificar_certificado()
-- ---------------------------------------------------------------------------
create or replace function public.marcar_enviado(p_cd uuid)
returns cierres_donante
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd cierres_donante%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar marca un certificat com a enviat' using errcode = '42501';
  end if;
  update cierres_donante
     set estado = 'enviat', enviado_at = now()
   where id = p_cd and estado = 'certificat_emes'
  returning * into cd;
  if cd.id is null then
    raise exception 'Nomes s''envia un certificat ja emes' using errcode = '22023';
  end if;
  return cd;
end;
$$;

-- El 182 lo presenta la gestoría: esto solo lo registra. A partir de aquí ningún
-- certificado del ejercicio se rectifica sin hablar con ella (D10).
create or replace function public.marcar_declarado(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar marca un exercici com a declarat' using errcode = '42501';
  end if;
  if not exists (select 1 from cierres_ejercicio
                  where id = p_cierre and estado in ('tancat', 'provisional')) then
    raise exception 'Nomes es declara un exercici tancat' using errcode = '22023';
  end if;

  update cierres_donante set estado = 'declarat', declarado_at = now()
   where cierre_id = p_cierre and certificado_numero is not null;
  get diagnostics v_n = row_count;

  update cierres_ejercicio set estado = 'declarat', declarado_at = now() where id = p_cierre;
  return jsonb_build_object('tancament', p_cierre, 'donants_declarats', v_n);
end;
$$;

-- Una rectificación NO consume número nuevo: es la versión siguiente del mismo CD, y la
-- anterior queda `vigente = false` (§A, decisión sobre numeración).
create or replace function public.rectificar_certificado(p_cd uuid, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd    cierres_donante%rowtype;
  ce    cierres_ejercicio%rowtype;
  par   parametros_documentales%rowtype;
  v_doc uuid;
  v_dest jsonb;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Una rectificacio necessita motiu' using errcode = '22023';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  if cd.certificado_numero is null then
    raise exception 'Aquest donant encara no te certificat' using errcode = '22023';
  end if;
  if cd.estado = 'declarat' or ce.estado = 'declarat' then
    raise exception 'Despres del 182 la rectificacio la decideix la gestoria (D10)'
      using errcode = '22023';
  end if;
  if coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat'
      using errcode = '42501';
  end if;

  update cierres_donante
     set rectificaciones = rectificaciones + 1,
         certificado_at  = now(),
         estado          = 'certificat_emes'
   where id = p_cd
  returning * into cd;

  v_dest := public.cierre_destinatario(p_cd);
  v_doc := public.cierre_emet_document(
    p_cd, 'CD', 'definitiu',
    public.cierre_datos_certificado(p_cd) || jsonb_build_object('motiu_rectificacio', p_motivo),
    jsonb_build_object('destinatario', v_dest->>'email', 'nombre', v_dest->>'nom',
                       'forzado', v_dest->>'forcat', 'motiu_destinatari', v_dest->>'motiu',
                       'asunto', 'Certificat de donacio RECTIFICAT ' || ce.ejercicio::text
                                 || ' — ' || cd.certificado_numero,
                       'plantilla', 'certificat_donacio'));

  return jsonb_build_object('document', v_doc, 'numero', cd.certificado_numero,
                            'versio', cd.rectificaciones + 1, 'motiu', p_motivo);
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. reiniciar_cierre_prueba(): repetir el ensayo tantas veces como haga falta
-- ---------------------------------------------------------------------------
-- ⚠️ NO TOCA NI UNA CANALIZACIÓN NI UN ALBARÁN. Es la condición de aceptación de la fase:
--    `count(*)` de las dos tablas tiene que ser el mismo antes y después. Lo que borra son
--    los **resultados** del ensayo: líneas, donantes, sus documentos y sus enlaces; y
--    devuelve los contadores `P-RES`/`P-CD` del ejercicio a 0.
--
-- `redestina.reinicio_prueba` es lo único que levanta la inmutabilidad de `documentos`
-- (20260928100200) y se fija con `set_config(..., is_local => true)`: vive solo dentro de
-- esta transacción.
create or replace function public.reiniciar_cierre_prueba(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ce      cierres_ejercicio%rowtype;
  v_docs  int;
  v_enl   int;
  v_don   int;
  v_lin   int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar reinicia una prova' using errcode = '42501';
  end if;

  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;
  if ce.modo <> 'prueba' then
    raise exception 'Nomes es reinicia un tancament de PROVA' using errcode = '42501';
  end if;

  perform set_config('redestina.reinicio_prueba', 'on', true);

  -- `documento_envios` cae por cascada; el trigger comprueba además que `modo = 'prueba'`.
  delete from documentos
   where objeto_tipo = 'cierre_donante'
     and objeto_id in (select id from cierres_donante where cierre_id = p_cierre);
  get diagnostics v_docs = row_count;

  -- `evidencias` cae por cascada del enlace.
  delete from enlaces_token
   where objeto_tipo = 'cierre_donante'
     and objeto_id in (select id from cierres_donante where cierre_id = p_cierre);
  get diagnostics v_enl = row_count;

  delete from cierre_donante_lineas
   where cierre_donante_id in (select id from cierres_donante where cierre_id = p_cierre);
  get diagnostics v_lin = row_count;

  delete from cierres_donante where cierre_id = p_cierre;
  get diagnostics v_don = row_count;

  update series_documentales set ultimo = 0
   where ejercicio = ce.ejercicio and serie in ('P-RES', 'P-CD');

  update cierres_ejercicio
     set estado = 'obert', calculado_at = null, provisional_at = null,
         cerrado_at = null, declarado_at = null
   where id = p_cierre;

  return jsonb_build_object('tancament', p_cierre, 'documents', v_docs, 'enllacos', v_enl,
                            'donants', v_don, 'linies', v_lin,
                            'canalitzacions', (select count(*) from canalizaciones),
                            'albarans', (select count(*) from albaranes));
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. conciliacion_retroactiva(): completar 2026 sin inventar albaranes
-- ---------------------------------------------------------------------------
-- Fuente 2 del plan: las canalizaciones que la app registró desde julio de 2026 no tienen
-- albarán, ni neto, ni coste. Esto las deja utilizables para el ENSAYO del cierre y las
-- marca como lo que son. **No crea ningún albarán**: inventar un documento con número para
-- cuadrar una cifra sería exactamente lo contrario de lo que hace este sistema.
create or replace function public.conciliacion_retroactiva(
  p_canalizacion uuid,
  p_kg           numeric,
  p_coste        numeric default null,
  p_motivo       text    default null
) returns canalizaciones
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c       canalizaciones%rowtype;
  v_prod  text;
  v_ej    int;
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

  v_ej := extract(year from (coalesce(c.data_hora_recollida, c.created_at)
                               at time zone 'Europe/Madrid'))::int;
  v_coste := coalesce(p_coste, c.coste_kg);
  if v_coste is null then
    select e.producto into v_prod from excedentes e where e.id = c.excedente_id;
    select cp.coste_kg into v_coste from costes_producto cp
     where cp.producto = v_prod and cp.ejercicio = v_ej;
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
$$;

-- ---------------------------------------------------------------------------
-- 17. datos_182() y comparar_cierre_prueba()
-- ---------------------------------------------------------------------------
-- Lo que la gestoría necesita por donante. Los campos exactos se validan con ella (§3.5.5);
-- estos son los del anexo B. `en_especie` es siempre cierto: se donan alimentos, no dinero.
create or replace function public.datos_182(p_cierre uuid)
returns table (
  nif                text,
  razon_social       text,
  codigo_postal      text,
  provincia          text,
  importe            numeric,
  kg                 numeric,
  en_especie         boolean,
  certificado_numero text,
  fecha              date,
  modo               text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- ⚠️ El mismo idioma que el resto del circuito: `auth.uid() is not null and not …`.
  --    Con `es_intern()` a secas, una llamada con `service_role` —que no tiene
  --    `auth.uid()`— devolvería CERO FILAS EN SILENCIO, que es indistinguible de «este
  --    cierre no tiene certificados». Y con `roles_activos` encendido eso pasa siempre.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta les dades del 182' using errcode = '42501';
  end if;

  return query
  select cd.datos_fiscales->>'nif',
         cd.datos_fiscales->>'raó_social',
         cd.datos_fiscales->>'codi_postal',
         coalesce(cd.datos_fiscales->>'provincia',
                  public.provincia_por_cp(cd.datos_fiscales->>'codi_postal')),
         cd.valor_total,
         cd.kg_total,
         true,
         cd.certificado_numero,
         (cd.certificado_at at time zone 'Europe/Madrid')::date,
         ce.modo
    from cierres_donante cd
    join cierres_ejercicio ce on ce.id = cd.cierre_id
   where cd.cierre_id = p_cierre
     and cd.certificado_numero is not null
   order by cd.datos_fiscales->>'raó_social';
end;
$$;

comment on function public.datos_182(uuid) is
  'Filas del modelo 182 de un cierre: solo donantes con certificado. La provincia sale del CP.';

-- El informe de contraste del §3.5.6: lo calculado frente a las cifras reales que la
-- Fundación teclea a mano. `p_reales` = [{nif|codigo|productor_id, kg, valor}].
create or replace function public.comparar_cierre_prueba(p_cierre uuid, p_reales jsonb)
returns table (
  donante        text,
  nif            text,
  kg_calculado   numeric,
  valor_calculado numeric,
  kg_real        numeric,
  valor_real     numeric,
  dif_kg         numeric,
  dif_valor      numeric,
  coincide       boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip compara un tancament de prova' using errcode = '42501';
  end if;

  return query
  with calc as (
    select cd.productor_id,
           coalesce(cd.datos_fiscales->>'raó_social', pr.name) as donante,
           cd.datos_fiscales->>'nif' as nif,
           pr.codigo,
           cd.kg_total, cd.valor_total
      from cierres_donante cd
      join productores pr on pr.id = cd.productor_id
     where cd.cierre_id = p_cierre
  ),
  -- ⚠️ La clave se RESUELVE aquí, antes del join. Postgres no admite un `full outer join`
  --    con una condición que no sea de igualdad («FULL JOIN is only supported with
  --    merge-joinable or hash-joinable join conditions»), así que las tres formas de
  --    identificar al donante —id, código o NIF— se reducen a un `productor_id` y el join
  --    es una igualdad. Una fila de `p_reales` que no case con nadie sale igualmente, con
  --    lo calculado a null: es la mitad del informe que importa.
  real_ as (
    select coalesce(
             nullif(r->>'productor_id', '')::uuid,
             (select pr.id from productores pr
               where (nullif(r->>'codigo', '') is not null and pr.codigo = r->>'codigo')
                  or (nullif(r->>'codigo', '') is null
                      and nullif(r->>'nif', '') is not null and pr.nif = r->>'nif')
               limit 1)) as productor_id,
           nullif(r->>'codigo', '')  as codigo,
           nullif(r->>'nif', '')     as nif,
           (r->>'kg')::numeric       as kg,
           (r->>'valor')::numeric    as valor,
           nullif(r->>'donante', '') as donante
      from jsonb_array_elements(coalesce(p_reales, '[]'::jsonb)) r
  )
  select coalesce(c.donante, x.donante, x.codigo, x.nif),
         coalesce(c.nif, x.nif),
         c.kg_total, c.valor_total,
         x.kg, x.valor,
         round(coalesce(c.kg_total, 0) - coalesce(x.kg, 0), 2),
         round(coalesce(c.valor_total, 0) - coalesce(x.valor, 0), 2),
         round(coalesce(c.kg_total, 0) - coalesce(x.kg, 0), 2) = 0
           and round(coalesce(c.valor_total, 0) - coalesce(x.valor, 0), 2) = 0
    from calc c
    full outer join real_ x on x.productor_id = c.productor_id
   order by 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. EXECUTE: quitar el PUBLIC por defecto y conceder lo justo
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Sin estos revoke, `anon` podría emitir
--    certificados de donación sin ni siquiera tener sesión.
do $$
declare
  f text;
begin
  -- Consulta: las llaman las pantallas del equipo (por dentro comprueban el rol o pasan
  -- por RLS) y el catálogo de provincias lo necesita cualquier formulario fiscal.
  foreach f in array array[
    'provincia_por_cp(text)',
    'cierres_donante_meus(uuid)',
    'cierre_base(int,text)',
    'cierre_pendents(int)',
    'datos_182(uuid)',
    'comparar_cierre_prueba(uuid,jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Acciones del equipo: comprueban `pot_aprovar()` / `es_super_admin()` por dentro, y el
  -- arnés verifica que un externo se lleva un 42501.
  foreach f in array array[
    'abrir_cierre(int,text)',
    'calcular_cierre(uuid)',
    'emitir_resumen(uuid,boolean)',
    'registrar_factura(uuid,text,date,numeric,uuid)',
    'simular_factura(uuid,numeric,text,date)',
    'emitir_certificado(uuid,text)',
    'marcar_enviado(uuid)',
    'marcar_declarado(uuid)',
    'rectificar_certificado(uuid,text)',
    'reiniciar_cierre_prueba(uuid)',
    'conciliacion_retroactiva(uuid,numeric,numeric,text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- Internas de la emisión: `authenticated` no las ve ni existiendo. Los snapshots llevan
  -- datos de la Fundación y de terceros; el destinatario decide a quién se escribe.
  foreach f in array array[
    'cierre_datos_resumen(uuid)',
    'cierre_datos_certificado(uuid)',
    'cierre_destinatario(uuid)',
    'cierre_emet_document(uuid,text,text,jsonb,jsonb)',
    'ruta_documento(text,uuid,text,text,int,text,int)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Verificación:
--   select * from cierre_base(2026, 'prueba');
--   select abrir_cierre(2026, 'prueba');
--   select calcular_cierre('<id>');
--   select * from datos_182('<id>');
