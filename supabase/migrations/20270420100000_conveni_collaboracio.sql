-- Fase 5 de la revisión del 08-10-2026: el «Conveni de col·laboració» único.
--
-- Hasta hoy una organización necesitaba hasta dos convenios: el de donación de su papel
-- (`don_gen` productor, `don_rec` receptora) y el comercial (`com`) para vender o maquilar.
-- La Fundació pide UNO: el Conveni de col·laboració, uno por papel, que cubre las tres
-- modalidades. Dos tipos nuevos, `col_productor` y `col_receptor`.
--
-- ⚠️ LOS VIGENTES DE ANTES SIGUEN VALIENDO EXACTAMENTE PARA LO QUE VALÍAN, ni más ni menos:
--    `convenis_equivalents` dice que un `don_gen` cubre la donación del productor y un `com`
--    la venta y la maquila. Lo que se firmó con un texto de donación no pasa a autorizar una
--    venta por cambiar de nombre.
-- ⚠️ Texto PROVISIONAL, marcado como borrador en el título y en el primer párrafo, como los
--    seis anteriores (§12.77): falta el de la asesoría.

-- --------------------------------------------------------------------------- tipos
alter table public.convenios drop constraint convenios_tipo_check;
alter table public.convenios add constraint convenios_tipo_check
  check (tipo in ('don_gen', 'don_rec', 'com', 'col_productor', 'col_receptor'));
alter table public.convenios drop constraint convenios_tipo_org_coherent;
alter table public.convenios add constraint convenios_tipo_org_coherent check (
     (tipo = 'don_gen' and tipo_org = 'productor')
  or (tipo = 'don_rec' and tipo_org = 'entidad')
  or (tipo = 'com')
  or (tipo = 'col_productor' and tipo_org = 'productor')
  or (tipo = 'col_receptor' and tipo_org = 'entidad'));

alter table public.convenios_exigidos drop constraint convenios_exigidos_tipo_convenio_check;
alter table public.convenios_exigidos add constraint convenios_exigidos_tipo_convenio_check
  check (tipo_convenio in ('don_gen', 'don_rec', 'com', 'col_productor', 'col_receptor'));

alter table public.plantillas_documento drop constraint plantillas_documento_variante_check;
alter table public.plantillas_documento add constraint plantillas_documento_variante_check
  check (variante is null or variante in ('don_gen', 'don_rec', 'com', 'parcial', 'col_productor', 'col_receptor'));

-- ----------------------------------------------------------- la matriz, ahora con UNO
delete from public.convenios_exigidos;
insert into public.convenios_exigidos (valorizacion, parte, tipo_convenio) values
  ('donacio', 'entrega', 'col_productor'), ('donacio', 'recibe', 'col_receptor'),
  ('venda',   'entrega', 'col_productor'), ('venda',   'recibe', 'col_receptor'),
  ('maquila', 'entrega', 'col_productor'), ('maquila', 'recibe', 'col_receptor');

-- Lo que cubría cada tipo anterior. Catálogo: lo lee cualquiera con sesión.
create table if not exists public.convenis_equivalents (
  tipo_nou     text not null check (tipo_nou in ('col_productor', 'col_receptor')),
  tipo_antic   text not null check (tipo_antic in ('don_gen', 'don_rec', 'com')),
  valorizacion text not null check (valorizacion in ('donacio', 'venda', 'maquila')),
  primary key (tipo_nou, tipo_antic, valorizacion)
);
insert into public.convenis_equivalents values
  ('col_productor', 'don_gen', 'donacio'),
  ('col_productor', 'com', 'venda'), ('col_productor', 'com', 'maquila'),
  ('col_receptor', 'don_rec', 'donacio'),
  ('col_receptor', 'com', 'venda'), ('col_receptor', 'com', 'maquila')
on conflict do nothing;
alter table public.convenis_equivalents enable row level security;
create policy "convenis_equivalents: lectura" on public.convenis_equivalents
  for select to authenticated using (true);
revoke all on public.convenis_equivalents from anon;
grant select on public.convenis_equivalents to authenticated;

-- ------------------------------------------------------------------ la serie legal
create or replace function public.convenio_serie(p_tipo text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_tipo
           when 'don_gen'       then 'CONV-DON-GEN'
           when 'don_rec'       then 'CONV-DON-REC'
           when 'com'           then 'CONV-COM'
           when 'col_productor' then 'CONV-COL-PROD'
           when 'col_receptor'  then 'CONV-COL-REC'
         end;
$$;
insert into public.series_documentales (serie, ejercicio, ultimo, digitos)
select s, e, 0, 4 from unnest(array['CONV-COL-PROD', 'CONV-COL-REC']) s, generate_series(2026, 2030) e
on conflict do nothing;

-- ----------------------------------------------------- las plantillas (texto de trabajo)
--
-- Se derivan de las de donación vigentes: mismo articulado, otro título, y una cláusula que
-- dice que el convenio cubre también la venta y la maquila. Las seis anteriores se retiran
-- (`vigente = false`, no se borran: los convenios firmados las citan).
do $$
declare
  r     record;
  v_out jsonb;
  e     jsonb;
  v_en_objecte boolean;
  v_fet boolean;
  v_titol text;
  v_extra text;
begin
  for r in select * from plantillas_documento
            where tipo = 'CONV' and variante in ('don_gen', 'don_rec') and vigente loop
    v_titol := case r.idioma when 'es' then 'Convenio de colaboración con REDESTINA'
                             else 'Conveni de col·laboració amb REDESTINA' end;
    v_extra := case r.idioma
      when 'es' then 'Este convenio cubre todas las modalidades de REDESTINA: la donación, la salida comercial (venta) y la transformación por maquila. En la venta y la maquila las condiciones económicas de cada operación las acuerdan las partes, y REDESTINA las pone en contacto y deja constancia de la operación.'
      else 'Aquest conveni cobreix totes les modalitats de REDESTINA: la donació, la sortida comercial (venda) i la transformació per maquila. En la venda i la maquila les condicions econòmiques de cada operació les acorden les parts, i REDESTINA les posa en contacte i deixa constància de l''operació.' end;
    v_out := '[]'::jsonb; v_en_objecte := false; v_fet := false;
    for e in select value from jsonb_array_elements(r.cuerpo) loop
      if e->>'tipo' = 'h1' then
        v_out := v_out || jsonb_build_array(jsonb_build_object('tipo', 'h1', 'text', v_titol));
        continue;
      end if;
      v_out := v_out || jsonb_build_array(e);
      if e->>'tipo' = 'h3' and (e->>'text') like '1.%' then v_en_objecte := true; continue; end if;
      if v_en_objecte and not v_fet and e->>'tipo' = 'p' then
        v_out := v_out || jsonb_build_array(jsonb_build_object('tipo', 'p', 'text', v_extra));
        v_fet := true;
      end if;
    end loop;
    insert into plantillas_documento (tipo, variante, idioma, version, titulo, cuerpo, marcadores, vigente)
    values ('CONV', case r.variante when 'don_gen' then 'col_productor' else 'col_receptor' end, r.idioma, 1,
            case r.idioma when 'es' then '[BORRADOR] ' else '[ESBORRANY] ' end || v_titol,
            v_out, r.marcadores, false);
  end loop;
end $$;
update public.plantillas_documento set vigente = false
 where tipo = 'CONV' and variante in ('don_gen', 'don_rec', 'com') and vigente;
update public.plantillas_documento set vigente = true
 where tipo = 'CONV' and variante in ('col_productor', 'col_receptor');

-- El albarán de recepción de una donación lleva desde la fase 3 el valor de referencia y el
-- importe (modelo de Espigoladors): «sense imports» ya no es cierto en el convenio nuevo.
update public.plantillas_documento
   set cuerpo = replace(replace(cuerpo::text,
         'amb els quilos pesats, sense imports.',
         'amb els quilos pesats i, en les donacions, el valor de referència dels productes.'),
         'con los kilos pesados, sin importes.',
         'con los kilos pesados y, en las donaciones, el valor de referencia de los productos.')::jsonb
 where tipo = 'CONV' and variante in ('col_productor', 'col_receptor')
   and not exists (select 1 from documentos d where d.plantilla_id = plantillas_documento.id);

-- ----------------------------------------------------- ¿ya cubre todo lo de su papel?
create or replace function public.conveni_cobreix_tot(p_tipo_org text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from (select distinct valorizacion from convenios_exigidos) v
     where not exists (
       select 1 from convenios c
        where c.estado = 'vigent'
          and c.organizacion_id = public.organizacion_de(p_tipo_org, p_org)
          and (c.tipo = case when p_tipo_org = 'productor' then 'col_productor' else 'col_receptor' end
               or exists (select 1 from convenis_equivalents eq
                           where eq.tipo_nou = case when p_tipo_org = 'productor' then 'col_productor' else 'col_receptor' end
                             and eq.tipo_antic = c.tipo and eq.valorizacion = v.valorizacion))));
$$;
revoke execute on function public.conveni_cobreix_tot(text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------- las funciones que lo deciden

CREATE OR REPLACE FUNCTION public.convenio_vigente(p_tipo_org text, p_org uuid, p_valorizacion text, p_parte text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if p_org is not null
     and auth.uid() is not null
     and not public.es_intern()
     and not (case p_tipo_org
                when 'productor' then p_org in (select public.mis_productores())
                when 'entidad'   then p_org in (select public.mis_entidades())
                else false
              end) then
    raise exception 'No pots consultar el conveni d''una altra organitzacio'
      using errcode = '42501';
  end if;

  return (
    select case
      when p_org is null then false
      when not exists (select 1 from convenios_exigidos ce
                        where ce.valorizacion = p_valorizacion and ce.parte = p_parte)
        then true
      else not exists (
        -- Falta alguno de los exigidos → no está cubierta.
        select 1
          from convenios_exigidos ce
         where ce.valorizacion = p_valorizacion
           and ce.parte        = p_parte
           and not exists (
             select 1 from convenios c
              where c.estado = 'vigent'
                -- El tipo exigido, o uno ANTERIOR que lo cubría para esta modalidad
                -- (`convenis_equivalents`, 12-10-2026): los vigentes de antes siguen valiendo
                -- exactamente para lo que valían.
                and (c.tipo = ce.tipo_convenio
                     or exists (select 1 from convenis_equivalents eq
                                 where eq.tipo_nou = ce.tipo_convenio
                                   and eq.tipo_antic = c.tipo
                                   and eq.valorizacion = p_valorizacion))
                -- Por organización: un convenio firmado con el otro papel de la MISMA
                -- organización también cuenta.
                and c.organizacion_id = public.organizacion_de(p_tipo_org, p_org)))
    end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.signar_conveni_propi(p_tipo_org text, p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user   uuid := auth.uid();
  v_mail   text;
  v_nom    text;
  v_tipo   text;
  v_tok    record;
  v_id     uuid;
  v_caduca timestamptz := now() + interval '1 hour';
  c        convenios%rowtype;
begin
  if v_user is null then
    raise exception 'Cal una sessio per signar el conveni' using errcode = '42501';
  end if;
  if p_tipo_org not in ('productor', 'entidad') then
    raise exception 'Tipus d''organitzacio desconegut: %', p_tipo_org using errcode = '22023';
  end if;
  if not public.soc_titular(p_tipo_org, p_org) then
    raise exception 'Nomes el titular de l''organitzacio pot signar el conveni'
      using errcode = '42501';
  end if;

  -- El Conveni de col·laboració único (12-10-2026): uno por papel, para todas las modalidades.
  v_tipo := case when p_tipo_org = 'productor' then 'col_productor' else 'col_receptor' end;

  -- --- NUEVO: no se abre un convenio encima de uno vigente -----------------------------
  -- La guarda de d8b25d1, con la equivalencia: «ya tienes uno vigente» significa que lo que
  -- hay vigente ya cubre TODAS las modalidades de este papel (un col_* vigente, o los dos
  -- antiguos juntos). Un don_gen solo no basta: no cubre la venta, y firmar el nuevo es
  -- justo lo que le falta.
  if public.conveni_cobreix_tot(p_tipo_org, p_org)
     and not exists (select 1 from convenios x
                      where x.tipo = v_tipo
                        and x.estado in ('esborrany', 'pendent_firma', 'retornat', 'firmat')
                        and ((p_tipo_org = 'productor' and x.productor_id = p_org)
                          or (p_tipo_org = 'entidad'   and x.entidad_id   = p_org)))
  then
    raise exception 'Ja tens un conveni vigent d''aquest tipus'
      using errcode = '22023';
  end if;

  -- Idempotente: si ya hay borrador, enviado o devuelto, devuelve ese.
  c := public.preparar_convenio(p_tipo_org, p_org, v_tipo, null, null);

  -- Los dos estados en los que no hay nada que firmar se distinguen en el mensaje: uno
  -- es «ya está» y el otro «espera a que lo contrafirmemos», y decirle lo mismo a las dos
  -- personas mandaría a una de ellas a buscar un problema que no tiene.
  if c.estado = 'firmat' then
    raise exception 'Ja has signat aquest conveni: falta la contrasignatura de l''equip'
      using errcode = '22023';
  end if;
  if c.estado not in ('esborrany', 'pendent_firma', 'retornat') then
    raise exception 'Aquest conveni no es pot signar (estat %)', c.estado using errcode = '22023';
  end if;

  select p.email, p.nombre into v_mail, v_nom from perfiles p where p.id = v_user;
  select * into v_tok from public.generar_token_enlace();

  -- Dos enlaces vivos son dos firmas posibles, y la segunda no tendría dónde ir. Misma
  -- regla que `enviar_convenio()` y `acunar_enllac_propi()`: acuñar revoca el anterior,
  -- incluido el que la persona pueda tener en el correo (§12.97).
  update enlaces_token set estado = 'revocado'
   where objeto_tipo = 'convenio' and objeto_id = c.id
     and proposito = 'firma_convenio' and estado = 'activo';

  insert into enlaces_token (proposito, objeto_tipo, objeto_id,
                             destinatario_email, destinatario_nombre, canal,
                             token_hash, caduca_at, creado_por)
  values ('firma_convenio', 'convenio', c.id, v_mail, v_nom, 'panel',
          v_tok.token_hash, v_caduca, v_user)
  returning id into v_id;

  -- Solo el borrador cambia de estado. `enviado_at` se queda como esté.
  if c.estado = 'esborrany' then
    update convenios
       set estado    = 'pendent_firma',
           enlace_id = v_id,
           datos_org = public.convenio_datos_org(c.id)
     where id = c.id;
  else
    update convenios set enlace_id = v_id where id = c.id;
  end if;

  return jsonb_build_object('id', v_id, 'token', v_tok.token,
                            'url_path', '/signar/' || v_tok.token,
                            'caduca_at', v_caduca);
end;
$function$;

-- ------------------------------------- los convenios ANTERIORES a medio firmar, fuera
--
-- Un `don_gen`, `don_rec` o `com` todavía sin número (borrador o enviado sin firmar) ya no se
-- va a firmar: lo sustituye el de col·laboració. Si se dejara, «Pendent de tu» pediría firmar
-- dos convenios y el equipo vería dos en marcha. Se borran con sus enlaces, como hace
-- `descartar_convenio_esborrany()`; los que tienen número o un escaneado adjunto no se tocan.
do $$
declare
  c record;
begin
  for c in select * from convenios
            where tipo in ('don_gen', 'don_rec', 'com')
              and estado in ('esborrany', 'pendent_firma')
              and numero_completo is null
              and origen = 'plataforma'
              and not exists (select 1 from documentos_externos d
                               where d.objeto_tipo = 'convenio' and d.objeto_id = convenios.id) loop
    delete from enlaces_token where objeto_tipo = 'convenio' and objeto_id = c.id;
    delete from convenios where id = c.id;
    raise notice 'conveni anterior descartat: % (% %)', c.id, c.tipo, c.estado;
  end loop;
end $$;

-- ------------------------------------------- la campaña de convenios, con el tipo nuevo
--
-- Las dos vistas de la campaña llevaban `don_gen`/`don_rec` fijados: la campaña habría
-- seguido preparando convenios del modelo anterior. Ahora preparan el de col·laboració, y
-- cuentan como hecho un convenio anterior de donación vigente (es lo que ya tenían).
create or replace view public.v_campanya_convenis with (security_invoker = true) as
 WITH orgs AS (
         SELECT 'productor'::text AS tipo_org,
            p.id,
            COALESCE(p.area_geografica, '(sense comarca)'::text) AS comarca,
            'col_productor'::text AS tipo
           FROM productores p
          WHERE COALESCE(p.activo, true)
        UNION ALL
         SELECT 'entidad'::text,
            e.id,
            COALESCE(e.area_geografica, '(sense comarca)'::text) AS "coalesce",
            'col_receptor'::text
           FROM entidades e
        ), estat AS (
         SELECT o.tipo_org,
            o.comarca,
            o.tipo,
            COALESCE(( SELECT
                        CASE
                            WHEN bool_or(c.estado = 'vigent'::text) THEN 'vigent'::text
                            WHEN bool_or(c.estado = 'firmat'::text) THEN 'firmat'::text
                            WHEN bool_or(c.estado = 'pendent_firma'::text) THEN 'pendent_firma'::text
                            WHEN bool_or(c.estado = 'retornat'::text) THEN 'retornat'::text
                            WHEN bool_or(c.estado = 'esborrany'::text) THEN 'esborrany'::text
                            WHEN bool_or(c.estado = 'resolt'::text) THEN 'resolt'::text
                            ELSE NULL::text
                        END AS "case"
                   FROM convenios c
                  WHERE (c.tipo = o.tipo
                         OR c.tipo = CASE o.tipo_org WHEN 'productor' THEN 'don_gen' ELSE 'don_rec' END)
                    AND COALESCE(c.productor_id, c.entidad_id) = o.id), 'sense'::text) AS estado
           FROM orgs o
        )
 SELECT tipo_org,
    tipo,
    comarca,
    count(*) AS organitzacions,
    count(*) FILTER (WHERE estado = 'vigent'::text) AS vigents,
    count(*) FILTER (WHERE estado = 'firmat'::text) AS per_contrasignar,
    count(*) FILTER (WHERE estado = 'pendent_firma'::text) AS pendents_firma,
    count(*) FILTER (WHERE estado = 'retornat'::text) AS retornats,
    count(*) FILTER (WHERE estado = 'esborrany'::text) AS esborranys,
    count(*) FILTER (WHERE estado = 'resolt'::text) AS resolts,
    count(*) FILTER (WHERE estado = 'sense'::text) AS sense_conveni,
    round(100.0 * count(*) FILTER (WHERE estado = 'vigent'::text)::numeric / NULLIF(count(*), 0)::numeric, 1) AS pct_vigent
   FROM estat
  GROUP BY tipo_org, tipo, comarca;

create or replace view public.v_fitxes_incompletes_conveni with (security_invoker = true) as
 WITH orgs AS (
         SELECT 'productor'::text AS tipo_org,
            p.id,
            COALESCE(p.empresa, p.name) AS nom,
            p.email,
            p.nif,
            p.direccion,
            p.poblacion,
            p.area_geografica,
            p.es_test
           FROM productores p
          WHERE COALESCE(p.activo, true)
        UNION ALL
         SELECT 'entidad'::text,
            e.id,
            e.nombre,
            e.email,
            e.nif,
            e.direccion,
            e.poblacion,
            e.area_geografica,
            e.es_test
           FROM entidades e
        )
 SELECT tipo_org,
    id AS org_id,
    nom,
    email,
    area_geografica AS comarca,
    es_test,
        CASE tipo_org
            WHEN 'productor'::text THEN 'col_productor'::text
            ELSE 'col_receptor'::text
        END AS tipo,
    (EXISTS ( SELECT 1
           FROM convenios c
          WHERE c.estado = 'vigent'::text
            AND c.tipo = ANY (CASE o.tipo_org
                    WHEN 'productor'::text THEN ARRAY['col_productor', 'don_gen']
                    ELSE ARRAY['col_receptor', 'don_rec'] END)
            AND COALESCE(c.productor_id, c.entidad_id) = o.id)) AS te_conveni_vigent,
    array_remove(ARRAY[
        CASE
            WHEN COALESCE(btrim(email), ''::text) = ''::text THEN 'correu'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(btrim(nif), ''::text) = ''::text THEN 'nif'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(btrim(direccion), ''::text) = ''::text THEN 'domicili'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(btrim(poblacion), ''::text) = ''::text THEN 'poblacio'::text
            ELSE NULL::text
        END], NULL::text) AS falta,
    COALESCE(btrim(email), ''::text) = ''::text AS nomes_firma_assistida
   FROM orgs o;

-- ------------------------- la canalización guiada, con las equivalencias de los anteriores
--
-- `canalitzacio_assistida()` y `canalitzacions_actives()` cruzaban la matriz con
-- `ce.tipo_convenio = c.tipo`: con la matriz nueva, un `don_gen` vigente dejaría de verse
-- y la pantalla pediría un convenio que la base no exige.

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
          on (ce.tipo_convenio = c.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce.tipo_convenio and eq.tipo_antic = c.tipo and eq.valorizacion = ex.modalitat)) and ce.valorizacion = ex.modalitat
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
                     on (ce2.tipo_convenio = c2.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce2.tipo_convenio and eq.tipo_antic = c2.tipo and eq.valorizacion = ex.modalitat)) and ce2.valorizacion = ex.modalitat
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
$function$;

CREATE OR REPLACE FUNCTION public.canalitzacions_actives(p_limit integer DEFAULT 200)
 RETURNS TABLE(excedente_id uuid, id_excedente text, productor text, estado text, modalitat text, kg_total numeric, kg_canalitzats numeric, n_per_aprovar integer, rec_estado text, ents_pendents integer, conveni_gen text, created_at timestamp with time zone, origen text, sortida_estado text, tot_conciliat boolean, n_respostes integer, n_per_aprovar_sense_conveni integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
             and al.canalizacion_id in (select c2.id from canalizaciones c2 where c2.excedente_id = ex.id)
             and al.estado in ('emitido', 'entregado'))::int,
         -- El convenio que la modalidad EXIGE al generador (`convenios_exigidos`, parte
         -- `entrega`), igual que `canalitzacio_assistida()`: una venta o maquila pide `com`,
         -- y un `don_gen` vigente no la deja operar.
         (select c.estado from convenios c
            join convenios_exigidos ce
              on (ce.tipo_convenio = c.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce.tipo_convenio and eq.tipo_antic = c.tipo and eq.valorizacion = ex.modalitat)) and ce.valorizacion = ex.modalitat
             and ce.parte = 'entrega'
           where c.productor_id = ex.productor_id and c.estado <> 'substituit'
           order by case c.estado when 'vigent' then 0 when 'firmat' then 1
                                  when 'pendent_firma' then 2 else 3 end
           limit 1),
         ex.created_at,
         ex.origen,
         (select al.estado from albaranes al
           where al.tipo in ('ENT', 'OPE')
             and al.canalizacion_id in (select c3.id from canalizaciones c3 where c3.excedente_id = ex.id)
             and al.estado not in ('anulado', 'rectificado')
           order by case al.estado when 'borrador' then 0 when 'emitido' then 1
                                   when 'entregado' then 2 when 'confirmado' then 3
                                   else 4 end
           limit 1),
         (select bool_and(c4.kg_conciliados is not null) from canalizaciones c4
           where c4.excedente_id = ex.id),
         -- Enviada a alguien: con respuestas, la distribución está hecha aunque nadie
         -- haya contestado todavía (la ficha dice «Recull l'interès»).
         (select count(*) from oferta_respuestas r2 where r2.excedente_id = ex.id)::int,
         -- Intereses por aprobar de una receptora SIN el convenio vigente que la modalidad
         -- le exige (parte `recibe`): `aprovar_resposta()` los rechazaría.
         (select count(*) from oferta_respuestas r3
           where r3.excedente_id = ex.id
             and r3.estado = 'acceptada' and r3.aprovacio = 'pendent'
             and not exists (
               select 1 from convenios c5
                 join convenios_exigidos ce5
                   on (ce5.tipo_convenio = c5.tipo or exists (select 1 from convenis_equivalents eq where eq.tipo_nou = ce5.tipo_convenio and eq.tipo_antic = c5.tipo and eq.valorizacion = ex.modalitat)) and ce5.valorizacion = ex.modalitat
                  and ce5.parte = 'recibe'
                where c5.entidad_id = r3.entidad_id and c5.estado = 'vigent'))::int
    from excedentes ex
    left join productores p on p.id = ex.productor_id
   where ex.estado not in ('cancelada', 'no_colocada')
   order by ex.created_at desc
   limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$function$;
