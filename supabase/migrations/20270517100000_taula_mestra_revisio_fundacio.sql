-- Taula mestra: revisión de la Fundació (Sebas, 09-11-2026, columna J, filas 1.3 y 1.5).
--
-- POR QUÉ, punto por punto (lo que ya estaba hecho —1.1, 1.5 «Gestió interna»— no se toca):
--
--   2. «Tipo de actividad: ELIMINAR "Cooperativa agraria"». `20270512100100` hizo lo contrario
--      (la amplió a los dos papeles). Aquí se quita del catálogo y de las fichas que la tuvieran
--      (no hay FK: `tipus_activitat[]` guarda códigos). La FORMA JURÍDICA `cooperativa` se queda:
--      es la forma legal, no la actividad.
--   3. «Forma jurídica: añadir … Comunidad de bienes (CB)». SAT y SC ya entraron en
--      `20270512100000`; falta `cb`. `tipus_empresa_valid()` es la única guarda del servidor
--      y la lista del panel es `TIPUS_EMPRESA` (`src/lib/perfilReceptor.ts`): cambian juntas.
--   4. «Régimen de IVA: General, REAGP, Simplificado, Exento/no sujeto, Otros». Columna
--      `regim_iva` con lista cerrada, en las dos fichas (los datos fiscales viven en la ficha,
--      como `nif` y `razon_social`).
--   5. «Domicilio fiscal». Tres columnas aparte (`domicili_fiscal`, `codi_postal_fiscal`,
--      `poblacio_fiscal`) y UNA regla, en bloque y sin mezclar: si `domicili_fiscal` tiene texto,
--      convenio y certificados usan los tres campos fiscales; si no, la dirección de la ficha,
--      como hasta ahora (`dada_fiscal()`). Se recrean, copiadas de su última definición y
--      cambiando SOLO el origen del domicilio (y su comprobación de «falta domicili»):
--      `convenio_datos_org` (20270111100100), `calcular_cierre` (20270509100400),
--      `calcular_certificado_periodo` (20270509100100) y `calcular_certificat_recepcio`
--      (20270328101200). Lo ya emitido no cambia: es inmutable y lleva su copia congelada.
--   6. «Contacto administrativo: persona y correo para facturación». Dos columnas; por ahora
--      solo se guardan (no cambian a quién se envía nada).
--   8. «Data d'alta automática». Trigger BEFORE INSERT que la pone si viene vacía, y relleno
--      de las vacías con la fecha de creación. Sigue editable por el equipo.
--
-- El actor (titular) puede corregir sus datos fiscales y de facturación: las claves nuevas
-- entran en la lista blanca de `actualitzar_fitxa_productor/entitat` (copiadas de
-- 20270505100000; `tests/campsFitxa.test.ts` lee las claves de ESTA, la última definición).
-- `create or replace` con la misma firma conserva los GRANT de cada función.
-- Compatible hacia atrás: solo añade columnas y el frontend publicado no manda las claves nuevas.

-- 1. Cooperativa agrària, fuera ---------------------------------------------------------------

do $$
declare
  v_p int; v_e int;
begin
  update productores set tipus_activitat = array_remove(tipus_activitat, 'cooperativa_agraria')
   where 'cooperativa_agraria' = any(tipus_activitat);
  get diagnostics v_p = row_count;
  update entidades set tipus_activitat = array_remove(tipus_activitat, 'cooperativa_agraria')
   where 'cooperativa_agraria' = any(tipus_activitat);
  get diagnostics v_e = row_count;
  delete from tipus_activitat where codi = 'cooperativa_agraria';
  raise notice 'cooperativa_agraria retirada: % productores, % entidades', v_p, v_e;
end;
$$;

-- 2. Comunitat de béns (CB) ------------------------------------------------------------------

create or replace function public.tipus_empresa_valid(p_nou text, p_actual text)
returns boolean
language sql
immutable
as $$
  select p_nou is null
      or p_nou in ('cooperativa', 'sat', 'sc', 'cb', 'sl', 'sa', 'autonom', 'fundacio', 'associacio', 'altres')
      or p_nou is not distinct from p_actual;
$$;

-- 3. Columnas fiscales y de facturación ------------------------------------------------------
-- Los CHECK son los mismos que valida la pantalla (`src/lib/validacio.ts`: `errorCp`,
-- `errorCorreu`); un valor fuera de la lista del IVA da `23514`.

alter table public.productores
  add column regim_iva text
    constraint productores_regim_iva check (regim_iva in ('general', 'reagp', 'simplificat', 'exempt', 'altres')),
  add column domicili_fiscal text,
  add column codi_postal_fiscal text
    constraint productores_codi_postal_fiscal check (codi_postal_fiscal ~ '^[0-9]{5}$'),
  add column poblacio_fiscal text,
  add column contacte_facturacio_nom text,
  add column contacte_facturacio_email text
    constraint productores_contacte_facturacio_email check (contacte_facturacio_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$');

alter table public.entidades
  add column regim_iva text
    constraint entidades_regim_iva check (regim_iva in ('general', 'reagp', 'simplificat', 'exempt', 'altres')),
  add column domicili_fiscal text,
  add column codi_postal_fiscal text
    constraint entidades_codi_postal_fiscal check (codi_postal_fiscal ~ '^[0-9]{5}$'),
  add column poblacio_fiscal text,
  add column contacte_facturacio_nom text,
  add column contacte_facturacio_email text
    constraint entidades_contacte_facturacio_email check (contacte_facturacio_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$');

comment on column public.productores.regim_iva is 'Règim d''IVA: general · reagp · simplificat · exempt (exempt o no subjecte) · altres.';
comment on column public.productores.domicili_fiscal is 'Domicili fiscal si és diferent de l''adreça. Si té text, convenis i certificats fan servir els tres camps fiscals (dada_fiscal()).';
comment on column public.entidades.regim_iva is 'Règim d''IVA: general · reagp · simplificat · exempt (exempt o no subjecte) · altres.';
comment on column public.entidades.domicili_fiscal is 'Domicili fiscal si és diferent de l''adreça. Si té text, convenis i certificats fan servir els tres camps fiscals (dada_fiscal()).';

-- 4. Data d'alta automática ------------------------------------------------------------------

create or replace function public.trg_fitxa_data_alta()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- `productores.data_alta` es date; `entidades.data_alta`, texto (heredado del Excel, con
  -- valores como «2020»): se escribe `AAAA-MM-DD`, que la ficha ya entiende.
  if tg_table_name = 'productores' then
    if new.data_alta is null then
      new.data_alta := (now() at time zone 'Europe/Madrid')::date;
    end if;
  elsif nullif(btrim(new.data_alta::text), '') is null then
    new.data_alta := to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD');
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_fitxa_data_alta() from public, anon, authenticated;

create trigger productores_data_alta
  before insert on public.productores
  for each row execute function public.trg_fitxa_data_alta();
create trigger entidades_data_alta
  before insert on public.entidades
  for each row execute function public.trg_fitxa_data_alta();

-- Las que ya existen sin fecha: la de creación (la mejor aproximación que hay).
update public.productores
   set data_alta = (created_at at time zone 'Europe/Madrid')::date
 where data_alta is null;
update public.entidades
   set data_alta = to_char((created_at at time zone 'Europe/Madrid')::date, 'YYYY-MM-DD')
 where nullif(btrim(data_alta), '') is null;

-- 5. Domicilio de los documentos -------------------------------------------------------------

-- Un dato del domicilio de un documento: el fiscal si la ficha tiene domicilio fiscal, el de
-- la ficha si no. El primer argumento decide para los tres (nunca se mezcla calle fiscal con
-- código postal de la ficha).
create or replace function public.dada_fiscal(p_domicili_fiscal text, p_fiscal text, p_fitxa text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when nullif(btrim(p_domicili_fiscal), '') is not null then p_fiscal else p_fitxa end;
$$;
-- Solo la llaman funciones `security definer` (corren como su dueño): nadie más la necesita.
revoke execute on function public.dada_fiscal(text, text, text) from public, anon, authenticated;

create or replace function public.convenio_datos_org(p_conv uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c  convenios%rowtype;
  pr productores%rowtype;
  en entidades%rowtype;
begin
  select * into c from convenios where id = p_conv;
  if c.id is null then
    raise exception 'Aquest conveni no existeix' using errcode = '22023';
  end if;

  if c.tipo_org = 'productor' then
    select * into pr from productores where id = c.productor_id;
    return jsonb_build_object(
      'tipus_org',     'productor',
      'org_id',        pr.id,
      'raso_social',   coalesce(pr.empresa, pr.name),
      'nom',           pr.name,
      'nif',           pr.nif,
      'domicili',      public.dada_fiscal(pr.domicili_fiscal, pr.domicili_fiscal, pr.direccion),
      'codi_postal',   public.dada_fiscal(pr.domicili_fiscal, pr.codi_postal_fiscal, pr.codigo_postal),
      'poblacio',      public.dada_fiscal(pr.domicili_fiscal, pr.poblacio_fiscal, pr.poblacion),
      'comarca',       pr.area_geografica,
      'email',         pr.email,
      'telefon',       pr.phone);
  end if;

  select * into en from entidades where id = c.entidad_id;
  return jsonb_build_object(
    'tipus_org',     'entidad',
    'org_id',        en.id,
    'raso_social',   en.nombre,
    'nom',           en.nombre,
    'nif',           en.nif,
    'domicili',      public.dada_fiscal(en.domicili_fiscal, en.domicili_fiscal, en.direccion),
    'codi_postal',   public.dada_fiscal(en.domicili_fiscal, en.codi_postal_fiscal, en.codigo_postal),
    'poblacio',      public.dada_fiscal(en.domicili_fiscal, en.poblacio_fiscal, en.poblacion),
    'comarca',       en.area_geografica,
    'email',         en.email,
    'telefon',       en.telefono);
end;
$$;

create or replace function public.calcular_cierre(p_cierre uuid)
returns jsonb
language plpgsql
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

  insert into cierres_donante (cierre_id, productor_id, tipo)
  select p_cierre, d.productor_id, 'donacio'
    from (
      select productor_id from public.cierre_base(ce.ejercicio, ce.modo)
      union
      select productor_id from public.cierre_pendents(ce.ejercicio)
    ) d
  on conflict (cierre_id, productor_id, tipo) do nothing;

  delete from cierre_donante_lineas
   where cierre_donante_id in (select id from cierres_donante
                                where cierre_id = p_cierre and tipo = 'donacio');

  insert into cierre_donante_lineas (
    cierre_donante_id, canalizacion_id, albaran_rec_id, producto, mes,
    kg_neto, coste_kg, valor, entidad_id, retroactiva)
  select cd.id, b.canalizacion_id, b.albaran_rec_id, b.producto, b.mes,
         b.kg_neto, b.coste_kg, b.valor, b.entidad_id, b.retroactiva
    from public.cierre_base(ce.ejercicio, ce.modo) b
    join cierres_donante cd on cd.cierre_id = p_cierre and cd.tipo = 'donacio'
                           and cd.productor_id = b.productor_id;
  get diagnostics v_lin = row_count;

  update cierres_donante cd
     set kg_total     = (select coalesce(sum(l.kg_neto), 0) from cierre_donante_lineas l
                          where l.cierre_donante_id = cd.id),
         valor_total  = (select coalesce(sum(l.valor), 0) from cierre_donante_lineas l
                          where l.cierre_donante_id = cd.id),
         calculado_at = now(),
         datos_fiscales = jsonb_build_object(
           'raó_social', coalesce(pr.empresa, pr.name),
           'nif', pr.nif,
           'domicili', public.dada_fiscal(pr.domicili_fiscal, pr.domicili_fiscal, pr.direccion),
           'codi_postal', public.dada_fiscal(pr.domicili_fiscal, pr.codi_postal_fiscal, pr.codigo_postal),
           'poblacio', public.dada_fiscal(pr.domicili_fiscal, pr.poblacio_fiscal, pr.poblacion),
           'provincia', public.provincia_por_cp(public.dada_fiscal(pr.domicili_fiscal, pr.codi_postal_fiscal, pr.codigo_postal)),
           'email', pr.email),
         bloqueos = (
           select coalesce(jsonb_agg(x), '[]'::jsonb) from (
             select jsonb_build_object('codigo', 'sense_conciliar', 'bloqueja', true,
                      'detall', pe.canalizaciones::text || ' canalitzacions sense conciliar ('
                                || round(pe.kg, 1)::text || ' kg)') as x
               from public.cierre_pendents(ce.ejercicio) pe
              where pe.productor_id = cd.productor_id
             union all
             select jsonb_build_object('codigo', 'sense_cost', 'bloqueja', true,
                      'detall', 'Sense cost per quilo de ' || ce.ejercicio::text || ': '
                                || string_agg(distinct coalesce(l.producto, '(sense producte)'), ', '))
               from cierre_donante_lineas l
              where l.cierre_donante_id = cd.id and l.coste_kg is null
             having count(*) > 0
             union all
             select jsonb_build_object('codigo', 'dades_fiscals', 'bloqueja', true,
                      'detall', 'Falten dades fiscals: ' || array_to_string(array_remove(array[
                        case when coalesce(btrim(pr.nif), '') = '' then 'NIF' end,
                        case when coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.domicili_fiscal, pr.direccion)), '') = '' then 'domicili' end,
                        case when coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.codi_postal_fiscal, pr.codigo_postal)), '') = '' then 'codi postal' end,
                        case when coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.poblacio_fiscal, pr.poblacion)), '') = '' then 'poblacio' end],
                        null), ', '))
              where coalesce(btrim(pr.nif), '') = ''
                 or coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.domicili_fiscal, pr.direccion)), '') = ''
                 or coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.codi_postal_fiscal, pr.codigo_postal)), '') = ''
                 or coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.poblacio_fiscal, pr.poblacion)), '') = ''
             union all
             select jsonb_build_object('codigo', 'sense_rec', 'bloqueja', false,
                      'detall', count(*)::text || ' canalitzacions sense albara de recepcio conciliat')
               from cierre_donante_lineas l
              where l.cierre_donante_id = cd.id and l.albaran_rec_id is null
             having count(*) > 0
             union all
             select jsonb_build_object('codigo', 'certificat_desactualitzat', 'bloqueja', false,
                      'detall', 'El certificat ' || cd.certificado_numero
                                || ' es va emetre per un altre import: cal rectificar-lo')
              where cd.certificado_numero is not null
                and round(cd.valor_total, 2) <> round((select coalesce(sum(l.valor), 0)
                                                         from cierre_donante_lineas l
                                                        where l.cierre_donante_id = cd.id), 2)
           ) b(x))
    from productores pr
   where cd.cierre_id = p_cierre and cd.tipo = 'donacio' and pr.id = cd.productor_id;
  get diagnostics v_don = row_count;

  update cierres_ejercicio set calculado_at = now() where id = p_cierre;

  return jsonb_build_object(
    'tancament', p_cierre, 'exercici', ce.ejercicio, 'mode', ce.modo,
    'donants', v_don, 'linies', v_lin,
    'kg_total', (select coalesce(sum(kg_total), 0) from cierres_donante
                  where cierre_id = p_cierre and tipo = 'donacio'),
    'valor_total', (select coalesce(sum(valor_total), 0) from cierres_donante
                     where cierre_id = p_cierre and tipo = 'donacio'),
    'bloquejats', (select count(*) from cierres_donante
                    where cierre_id = p_cierre and tipo = 'donacio'
                      and exists (select 1 from jsonb_array_elements(bloqueos) b
                                   where (b->>'bloqueja')::boolean)),
    -- El CT está retirado (20270509100400): la clave se queda, vacía, para quien la lea.
    'transaccions', null);
end;
$$;

create or replace function public.calcular_certificado_periodo(
  p_productor uuid,
  p_desde     date,
  p_hasta     date,
  p_modo      text default 'real',
  p_excedente uuid default null)
returns public.cierres_periodo
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cp      cierres_periodo%rowtype;
  pr      productores%rowtype;
  ex      excedentes%rowtype;
  v_abast text := case when p_excedente is null then 'periode' else 'oferta' end;
  v_desde date;
  v_hasta date;
  v_ej    int;
  v_hoy   date;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar calcula un certificat' using errcode = '42501';
  end if;
  if p_modo is null or p_modo not in ('prueba', 'real') then
    raise exception 'Mode desconegut: %', p_modo using errcode = '22023';
  end if;

  v_hoy := (now() at time zone 'Europe/Madrid')::date;

  if v_abast = 'periode' then
    if p_desde is null or p_hasta is null or p_desde > p_hasta then
      raise exception 'El periode ha de tenir una data d''inici anterior o igual a la de fi'
        using errcode = '22023';
    end if;
    v_desde := p_desde;
    v_hasta := p_hasta;
  end if;

  select * into pr from productores where id = p_productor;
  if pr.id is null then
    raise exception 'Aquest donant no existeix' using errcode = '22023';
  end if;

  if v_abast = 'oferta' then
    select * into ex from excedentes where id = p_excedente;
    if ex.id is null then
      raise exception 'Aquesta oferta no existeix' using errcode = '22023';
    end if;
    if ex.productor_id is distinct from p_productor then
      raise exception 'oferta_daltri_productor: aquesta oferta no es d''aquest donant'
        using errcode = '22023';
    end if;
    -- La ventana es la de lo CERTIFICABLE de la oferta, con la misma fecha y la misma
    -- regla de retroactivas que `cierre_base_periodo()`.
    select min((coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
                  at time zone 'Europe/Madrid')::date),
           max((coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
                  at time zone 'Europe/Madrid')::date)
      into v_desde, v_hasta
      from canalizaciones c
      left join entidades en on en.id = c.entidad_id
     where c.excedente_id = p_excedente
       and c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
       and public.motiu_exclusio_certificat(c.valorizacion, c.entidad_id, en.tipo_receptor) is null;
    if v_desde is null then
      raise exception 'oferta_sense_certificable: aquesta oferta no te cap donacio conciliada a una entitat social'
        using errcode = '22023';
    end if;
  end if;

  v_ej := extract(year from v_desde)::int;
  if extract(year from v_hasta)::int <> v_ej then
    raise exception 'Un certificat no pot cobrir dos exercicis (% i %): la serie i el cost per quilo son anuals',
      v_ej, extract(year from v_hasta)::int using errcode = '22023';
  end if;
  -- Certificar un periodo que todavía no ha terminado sería certificar el futuro.
  if v_hasta > v_hoy then
    raise exception 'El periode acaba el % i encara no ha acabat (avui es %)', v_hasta, v_hoy
      using errcode = '22023';
  end if;

  -- ¿Hay ya un certificado emitido de esto mismo? Entonces no es un recálculo, es una
  -- rectificación. En el ámbito oferta, «esto mismo» es la misma oferta con la misma
  -- ventana: si la ventana ha crecido (otra recogida conciliada), se calcula uno nuevo y
  -- al emitirse sustituye al anterior.
  if exists (select 1 from cierres_periodo c
              where c.productor_id = p_productor and c.modo = p_modo
                and c.periodo_desde = v_desde and c.periodo_hasta = v_hasta
                and c.excedente_id is not distinct from p_excedente
                and c.certificado_numero is not null and c.estado <> 'substituit') then
    raise exception 'Aquest donant ja te un certificat d''aquest %: fes servir rectificar_certificado_periodo()',
      case when v_abast = 'oferta' then 'oferta' else 'periode' end
      using errcode = '22023';
  end if;

  -- El borrador: por ventana en el ámbito periodo, por oferta en el ámbito oferta.
  if v_abast = 'periode' then
    select * into cp from cierres_periodo
     where productor_id = p_productor and modo = p_modo
       and periodo_desde = v_desde and periodo_hasta = v_hasta
       and excedente_id is null and certificado_numero is null
     for update;
  else
    select * into cp from cierres_periodo
     where excedente_id = p_excedente and modo = p_modo and certificado_numero is null
     for update;
    if cp.id is not null
       and (cp.periodo_desde <> v_desde or cp.periodo_hasta <> v_hasta) then
      update cierres_periodo
         set periodo_desde = v_desde, periodo_hasta = v_hasta, ejercicio = v_ej
       where id = cp.id
      returning * into cp;
    end if;
  end if;

  if cp.id is null then
    insert into cierres_periodo (productor_id, periodo_desde, periodo_hasta, ejercicio,
                                 modo, creado_por, abast, excedente_id)
    values (p_productor, v_desde, v_hasta, v_ej, p_modo, auth.uid(), v_abast, p_excedente)
    returning * into cp;
  end if;

  -- Las líneas, siempre desde cero: son el detalle del cálculo, no un histórico.
  delete from cierre_periodo_lineas where cierre_periodo_id = cp.id;

  insert into cierre_periodo_lineas (
    cierre_periodo_id, canalizacion_id, albaran_rec_id, producto, mes,
    kg_neto, coste_kg, valor, entidad_id, retroactiva, excedente_partido)
  select cp.id, b.canalizacion_id, b.albaran_rec_id, b.producto, b.mes,
         b.kg_neto, b.coste_kg, b.valor, b.entidad_id, b.retroactiva, b.excedent_partit
    from public.cierre_base_periodo(v_desde, v_hasta, p_modo) b
   where b.productor_id = p_productor
     and (p_excedente is null or b.excedente_id = p_excedente);

  update cierres_periodo c
     set kg_total     = (select coalesce(sum(l.kg_neto), 0) from cierre_periodo_lineas l
                          where l.cierre_periodo_id = c.id),
         valor_total  = (select coalesce(sum(l.valor), 0) from cierre_periodo_lineas l
                          where l.cierre_periodo_id = c.id),
         calculado_at = now(),
         datos_fiscales = jsonb_build_object(
           'raó_social', coalesce(pr.empresa, pr.name),
           'nif', pr.nif,
           'domicili', public.dada_fiscal(pr.domicili_fiscal, pr.domicili_fiscal, pr.direccion),
           'codi_postal', public.dada_fiscal(pr.domicili_fiscal, pr.codi_postal_fiscal, pr.codigo_postal),
           'poblacio', public.dada_fiscal(pr.domicili_fiscal, pr.poblacio_fiscal, pr.poblacion),
           'provincia', public.provincia_por_cp(public.dada_fiscal(pr.domicili_fiscal, pr.codi_postal_fiscal, pr.codigo_postal)),
           'email', pr.email),
         bloqueos = (
           select coalesce(jsonb_agg(x), '[]'::jsonb) from (
             -- (a) donaciones CERTIFICABLES sin conciliar. En el ámbito periodo, las de la
             --     ventana; en el de oferta, todas las de la oferta (una recogida que falta
             --     cae fuera de la ventana derivada, y por eso no se mira la fecha).
             select jsonb_build_object('codigo', 'sense_conciliar', 'bloqueja', true,
                      'detall', pe.canalizaciones::text || ' canalitzacions del periode sense conciliar ('
                                || round(pe.kg, 1)::text || ' kg)') as x
               from public.cierre_pendents_periodo(v_desde, v_hasta) pe
              where v_abast = 'periode' and pe.productor_id = p_productor
             union all
             select jsonb_build_object('codigo', 'sense_conciliar', 'bloqueja', true,
                      'detall', count(*)::text || ' canalitzacions de l''oferta sense conciliar ('
                                || round(coalesce(sum(c2.kg_confirmados), 0), 1)::text || ' kg)')
               from canalizaciones c2
               left join entidades en2 on en2.id = c2.entidad_id
              where v_abast = 'oferta'
                and c2.excedente_id = p_excedente
                and c2.estado in ('confirmada', 'entregada')
                and public.motiu_exclusio_certificat(c2.valorizacion, c2.entidad_id, en2.tipo_receptor) is null
             having count(*) > 0
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
                        case when coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.domicili_fiscal, pr.direccion)), '') = '' then 'domicili' end,
                        case when coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.codi_postal_fiscal, pr.codigo_postal)), '') = '' then 'codi postal' end,
                        case when coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.poblacio_fiscal, pr.poblacion)), '') = '' then 'poblacio' end],
                        null), ', '))
              where coalesce(btrim(pr.nif), '') = ''
                 or coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.domicili_fiscal, pr.direccion)), '') = ''
                 or coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.codi_postal_fiscal, pr.codigo_postal)), '') = ''
                 or coalesce(btrim(public.dada_fiscal(pr.domicili_fiscal, pr.poblacio_fiscal, pr.poblacion)), '') = ''
             union all
             -- (d) 🔴 la ventana parte un excedente (20270303100000): bloquea.
             select jsonb_build_object('codigo', 'periode_parteix_excedent', 'bloqueja', true,
                      'detall', count(*)::text || ' linies surten d''un excedent que el periode parteix: '
                                || 'mou la data de tall o certifica l''excedent sencer')
               from cierre_periodo_lineas l
              where l.cierre_periodo_id = c.id and l.excedente_partido
             having count(*) > 0
             union all
             -- (e1) otro certificado de PERIODO del mismo donante se solapa a medias con
             --      este de periodo: por ventana, como siempre.
             select jsonb_build_object('codigo', 'periode_encavalcat', 'bloqueja', true,
                      'detall', 'El certificat ' || string_agg(o.certificado_numero, ', ')
                                || ' cobreix part d''aquest periode sense estar-hi contingut')
               from cierres_periodo o
              where v_abast = 'periode' and o.abast = 'periode'
                and o.productor_id = p_productor and o.modo = p_modo
                and o.id <> c.id and o.certificado_numero is not null
                and o.estado <> 'substituit'
                and o.periodo_desde <= v_hasta and o.periodo_hasta >= v_desde
                and not (o.periodo_desde >= v_desde and o.periodo_hasta <= v_hasta)
             having count(*) > 0
             union all
             -- (e2) en cuanto uno de los dos es de OFERTA, por líneas: comparten alguna
             --      canalización y el otro no queda contenido en este.
             select jsonb_build_object('codigo', 'periode_encavalcat', 'bloqueja', true,
                      'detall', 'El certificat ' || string_agg(o.certificado_numero, ', ')
                                || ' ja certifica part d''aquests quilos sense estar-hi contingut')
               from cierres_periodo o
              where (v_abast = 'oferta' or o.abast = 'oferta')
                and o.productor_id = p_productor and o.modo = p_modo
                and o.id <> c.id and o.certificado_numero is not null
                and o.estado <> 'substituit'
                and exists (select 1 from cierre_periodo_lineas lo
                              join cierre_periodo_lineas lc
                                on lc.canalizacion_id = lo.canalizacion_id
                               and lc.cierre_periodo_id = c.id
                             where lo.cierre_periodo_id = o.id)
                and exists (select 1 from cierre_periodo_lineas lo
                             where lo.cierre_periodo_id = o.id
                               and not exists (select 1 from cierre_periodo_lineas lc
                                                where lc.cierre_periodo_id = c.id
                                                  and lc.canalizacion_id = lo.canalizacion_id))
             having count(*) > 0
             union all
             -- (f) el anual ya está emitido: avisa, no bloquea.
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
             -- (g) sin REC conciliado: avisa.
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

create or replace function public.calcular_certificat_recepcio(
  p_entidad uuid,
  p_desde   date,
  p_hasta   date,
  p_modo    text default 'real'
) returns cierres_receptor
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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
             select jsonb_build_object('codigo', 'sense_albara', 'bloqueja', false,
                      'detall', count(*)::text || ' lliuraments sense albara conciliat (ENT/OPE)')
               from cierre_receptor_lineas l
              where l.cierre_receptor_id = c.id and l.albaran_id is null
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
$$;

-- 6. Lista blanca del actor ------------------------------------------------------------------
-- ⚠️ `tests/campsFitxa.test.ts` lee las claves `d ? '…'` de la ÚLTIMA definición de estas
--    funciones y las compara con `campsFitxa.ts`.

create or replace function public.actualitzar_fitxa_productor(p_id uuid, p_dades jsonb)
returns productores
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p productores;
  d jsonb := coalesce(p_dades, '{}'::jsonb);
  txt text;
begin
  if not public.soc_titular('productor', p_id) then
    raise exception 'Nomes el titular pot editar les dades' using errcode = '42501';
  end if;
  select * into p from productores where id = p_id for update;

  txt := nullif(trim(d->>'tipo_empresa'), '');
  if not tipus_empresa_valid(txt, p.tipo_empresa) then
    raise exception 'tipus d''empresa desconegut: %', txt using errcode = '22023';
  end if;
  if d ? 'municipio_ine' and nullif(d->>'municipio_ine', '') is not null
     and not exists (select 1 from municipios where codi_ine = d->>'municipio_ine') then
    raise exception 'municipi desconegut' using errcode = '22023';
  end if;
  -- El área es la comarca: una de la lista, o la que ya tenía (un valor antiguo del import,
  -- como «Terres Ebre», se conserva mientras no se cambie; mismo criterio que tipo_empresa).
  if d ? 'area_geografica' and nullif(btrim(d->>'area_geografica'), '') is not null
     and btrim(d->>'area_geografica') is distinct from p.area_geografica
     and not exists (select 1 from municipios where comarca = btrim(d->>'area_geografica')) then
    raise exception 'comarca_desconeguda' using errcode = '22023';
  end if;
  if d ? 'ubicacio' and char_length(btrim(coalesce(d->>'ubicacio', ''))) > 120 then
    raise exception 'ubicacio_massa_llarga' using errcode = '22023';
  end if;
  if d ? 'tipus_activitat' and not public.tipus_activitat_valid(d->'tipus_activitat', 'productor') then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;

  -- Solo las claves que llegan: una clave ausente no toca la columna. `name` no se vacía
  -- nunca (es el nombre con el que se identifica la ficha en todo el circuito).
  update productores set
    name          = case when d ? 'name' then coalesce(nullif(trim(d->>'name'), ''), name) else name end,
    empresa       = case when d ? 'empresa' then nullif(trim(d->>'empresa'), '') else empresa end,
    razon_social  = case when d ? 'razon_social' then nullif(trim(d->>'razon_social'), '') else razon_social end,
    tipo_empresa  = case when d ? 'tipo_empresa' then txt else tipo_empresa end,
    email         = case when d ? 'email' then nullif(trim(d->>'email'), '') else email end,
    phone         = case when d ? 'phone' then nullif(trim(d->>'phone'), '') else phone end,
    telefono_alt  = case when d ? 'telefono_alt' then nullif(trim(d->>'telefono_alt'), '') else telefono_alt end,
    nif           = case when d ? 'nif' then nullif(upper(trim(d->>'nif')), '') else nif end,
    direccion     = case when d ? 'direccion' then nullif(trim(d->>'direccion'), '') else direccion end,
    codigo_postal = case when d ? 'codigo_postal' then nullif(trim(d->>'codigo_postal'), '') else codigo_postal end,
    municipio_ine = case when d ? 'municipio_ine' then nullif(d->>'municipio_ine', '') else municipio_ine end,
    -- 20270505100000: la ubicación (un lugar que no es municipio) y el área, editables.
    ubicacio      = case when d ? 'ubicacio' then nullif(btrim(d->>'ubicacio'), '') else ubicacio end,
    area_geografica = case when d ? 'area_geografica' then nullif(btrim(d->>'area_geografica'), '') else area_geografica end,
    tipus_activitat = case when d ? 'tipus_activitat'
      then coalesce(array(select jsonb_array_elements_text(d->'tipus_activitat')), '{}') else tipus_activitat end,
    -- 20270517100000 (Taula mestra, Fundació 09-11): datos fiscales y de facturación.
    regim_iva     = case when d ? 'regim_iva' then nullif(btrim(d->>'regim_iva'), '') else regim_iva end,
    domicili_fiscal    = case when d ? 'domicili_fiscal' then nullif(btrim(d->>'domicili_fiscal'), '') else domicili_fiscal end,
    codi_postal_fiscal = case when d ? 'codi_postal_fiscal' then nullif(btrim(d->>'codi_postal_fiscal'), '') else codi_postal_fiscal end,
    poblacio_fiscal    = case when d ? 'poblacio_fiscal' then nullif(btrim(d->>'poblacio_fiscal'), '') else poblacio_fiscal end,
    contacte_facturacio_nom   = case when d ? 'contacte_facturacio_nom' then nullif(btrim(d->>'contacte_facturacio_nom'), '') else contacte_facturacio_nom end,
    contacte_facturacio_email = case when d ? 'contacte_facturacio_email' then nullif(lower(btrim(d->>'contacte_facturacio_email')), '') else contacte_facturacio_email end
  where id = p_id
  returning * into p;
  return p;
end;
$$;

create or replace function public.actualitzar_fitxa_entitat(p_id uuid, p_dades jsonb)
returns entidades
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e entidades;
  d jsonb := coalesce(p_dades, '{}'::jsonb);
  txt text;
begin
  if not public.soc_titular('entidad', p_id) then
    raise exception 'Nomes el titular pot editar les dades' using errcode = '42501';
  end if;
  select * into e from entidades where id = p_id for update;

  txt := nullif(trim(d->>'tipo_entidad'), '');
  if not tipus_empresa_valid(txt, e.tipo_entidad) then
    raise exception 'tipus d''entitat desconegut: %', txt using errcode = '22023';
  end if;
  if d ? 'municipio_ine' and nullif(d->>'municipio_ine', '') is not null
     and not exists (select 1 from municipios where codi_ine = d->>'municipio_ine') then
    raise exception 'municipi desconegut' using errcode = '22023';
  end if;
  -- El área es la comarca: una de la lista, o la que ya tenía (un valor antiguo del import,
  -- como «Terres Ebre», se conserva mientras no se cambie; mismo criterio que tipo_empresa).
  if d ? 'area_geografica' and nullif(btrim(d->>'area_geografica'), '') is not null
     and btrim(d->>'area_geografica') is distinct from e.area_geografica
     and not exists (select 1 from municipios where comarca = btrim(d->>'area_geografica')) then
    raise exception 'comarca_desconeguda' using errcode = '22023';
  end if;
  if d ? 'ubicacio' and char_length(btrim(coalesce(d->>'ubicacio', ''))) > 120 then
    raise exception 'ubicacio_massa_llarga' using errcode = '22023';
  end if;
  if d ? 'perfil_receptor' and jsonb_typeof(d->'perfil_receptor') <> 'object' then
    raise exception 'perfil_receptor ha de ser un objecte' using errcode = '22023';
  end if;
  if d ? 'tipus_activitat' and not public.tipus_activitat_valid(d->'tipus_activitat', 'entidad') then
    raise exception 'tipus_activitat_desconegut' using errcode = '22023';
  end if;
  if d ? 'modalitats_interes' and (jsonb_typeof(d->'modalitats_interes') <> 'array' or exists (
       select 1 from jsonb_array_elements_text(d->'modalitats_interes') m where m not in ('donacio', 'venda', 'maquila'))) then
    raise exception 'modalitat_desconeguda' using errcode = '22023';
  end if;
  -- Los tres booleanos de logística admiten «sense definir» (null): un valor que no sea
  -- true/false/null es un error de llamada, no un dato.
  if (d ? 'productes_frescos' and jsonb_typeof(d->'productes_frescos') not in ('boolean', 'null'))
     or (d ? 'transport_plataforma' and jsonb_typeof(d->'transport_plataforma') not in ('boolean', 'null'))
     or (d ? 'descarrega_toro' and jsonb_typeof(d->'descarrega_toro') not in ('boolean', 'null')) then
    raise exception 'logistica_invalida: cal true, false o null' using errcode = '22023';
  end if;

  -- ⚠️ `tipo_receptor`, `estat`, `prioritat`, `es_test`, `activo`… NO están en la lista:
  --    deciden qué ofertas ve y cómo puntúa, y eso lo decide el equipo (`campsFitxa.ts`:
  --    `edita: 'equip'`). Las claves que no están aquí se ignoran en silencio.
  update entidades set
    nombre        = case when d ? 'nombre' then coalesce(nullif(trim(d->>'nombre'), ''), nombre) else nombre end,
    razon_social  = case when d ? 'razon_social' then nullif(trim(d->>'razon_social'), '') else razon_social end,
    tipo_entidad  = case when d ? 'tipo_entidad' then txt else tipo_entidad end,
    contacto      = case when d ? 'contacto' then nullif(trim(d->>'contacto'), '') else contacto end,
    telefono      = case when d ? 'telefono' then nullif(trim(d->>'telefono'), '') else telefono end,
    email         = case when d ? 'email' then nullif(trim(d->>'email'), '') else email end,
    nif           = case when d ? 'nif' then nullif(upper(trim(d->>'nif')), '') else nif end,
    direccion     = case when d ? 'direccion' then nullif(trim(d->>'direccion'), '') else direccion end,
    codigo_postal = case when d ? 'codigo_postal' then nullif(trim(d->>'codigo_postal'), '') else codigo_postal end,
    municipio_ine = case when d ? 'municipio_ine' then nullif(d->>'municipio_ine', '') else municipio_ine end,
    -- 20270505100000: la ubicación (un lugar que no es municipio) y el área, editables.
    ubicacio      = case when d ? 'ubicacio' then nullif(btrim(d->>'ubicacio'), '') else ubicacio end,
    area_geografica = case when d ? 'area_geografica' then nullif(btrim(d->>'area_geografica'), '') else area_geografica end,
    horario       = case when d ? 'horario' then nullif(trim(d->>'horario'), '') else horario end,
    calendari_repartiment = case when d ? 'calendari_repartiment' then nullif(trim(d->>'calendari_repartiment'), '') else calendari_repartiment end,
    perfil_receptor = case when d ? 'perfil_receptor' then d->'perfil_receptor' else perfil_receptor end,
    tipus_activitat = case when d ? 'tipus_activitat'
      then coalesce(array(select jsonb_array_elements_text(d->'tipus_activitat')), '{}') else tipus_activitat end,
    modalitats_interes = case when d ? 'modalitats_interes'
      then coalesce(array(select distinct jsonb_array_elements_text(d->'modalitats_interes')), '{}') else modalitats_interes end,
    -- 1C (P5): el contacto secundario y la logística son de la organización.
    telefono2     = case when d ? 'telefono2' then nullif(trim(d->>'telefono2'), '') else telefono2 end,
    telefono3     = case when d ? 'telefono3' then nullif(trim(d->>'telefono3'), '') else telefono3 end,
    email2        = case when d ? 'email2' then nullif(trim(d->>'email2'), '') else email2 end,
    contacto2     = case when d ? 'contacto2' then nullif(trim(d->>'contacto2'), '') else contacto2 end,
    productes_frescos        = case when d ? 'productes_frescos' then (d->>'productes_frescos')::boolean else productes_frescos end,
    productes_frescos_txt    = case when d ? 'productes_frescos_txt' then nullif(trim(d->>'productes_frescos_txt'), '') else productes_frescos_txt end,
    transport_plataforma     = case when d ? 'transport_plataforma' then (d->>'transport_plataforma')::boolean else transport_plataforma end,
    transport_plataforma_txt = case when d ? 'transport_plataforma_txt' then nullif(trim(d->>'transport_plataforma_txt'), '') else transport_plataforma_txt end,
    descarrega_toro          = case when d ? 'descarrega_toro' then (d->>'descarrega_toro')::boolean else descarrega_toro end,
    descarrega_toro_txt      = case when d ? 'descarrega_toro_txt' then nullif(trim(d->>'descarrega_toro_txt'), '') else descarrega_toro_txt end,
    -- 20270517100000 (Taula mestra, Fundació 09-11): datos fiscales y de facturación.
    regim_iva     = case when d ? 'regim_iva' then nullif(btrim(d->>'regim_iva'), '') else regim_iva end,
    domicili_fiscal    = case when d ? 'domicili_fiscal' then nullif(btrim(d->>'domicili_fiscal'), '') else domicili_fiscal end,
    codi_postal_fiscal = case when d ? 'codi_postal_fiscal' then nullif(btrim(d->>'codi_postal_fiscal'), '') else codi_postal_fiscal end,
    poblacio_fiscal    = case when d ? 'poblacio_fiscal' then nullif(btrim(d->>'poblacio_fiscal'), '') else poblacio_fiscal end,
    contacte_facturacio_nom   = case when d ? 'contacte_facturacio_nom' then nullif(btrim(d->>'contacte_facturacio_nom'), '') else contacte_facturacio_nom end,
    contacte_facturacio_email = case when d ? 'contacte_facturacio_email' then nullif(lower(btrim(d->>'contacte_facturacio_email')), '') else contacte_facturacio_email end
  where id = p_id
  returning * into e;
  return e;
end;
$$;
