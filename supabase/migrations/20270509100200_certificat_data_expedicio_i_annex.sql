-- Fecha de expedición y anexo del certificado de donación (05-11-2026).
--
-- Plan «Certificat de donació según el modelo de Tabaquet», bloque 1. El modelo de la
-- Fundació cierra con «expedeixo el present certificat a <lloc>, <data>», y esa fecha la
-- elige el super_admin al emitir:
--
--   · `p_data_expedicio date default null` en `emitir_certificado()` (anual),
--     `emitir_certificado_periodo()` (periodo y oferta) y `emitir_certificados_cierre()`
--     (la tanda anual). Por defecto: anual → 31-12 del ejercicio; periodo/oferta → hoy
--     (Europe/Madrid). Rango válido: ≥ fin del periodo y ≤ hoy; si no,
--     `22023 data_expedicio_fora_rang`. Un anual de PRUEBA de un ejercicio que todavía no
--     ha acabado (el ensayo de siempre) toma hoy como fin del periodo; uno REAL no se puede
--     expedir antes del 31-12 —sería certificar un año que no ha acabado—.
--
--   · `p_annex boolean default false` en las mismas: el detalle por producto como anexo
--     del PDF (D21, opcional). Lo decide quien emite.
--
--   · Las dos cosas se GUARDAN en la fila (`cierres_donante` y `cierres_periodo`:
--     `data_expedicio date`, `annex boolean`) y no solo en el snapshot, para que una
--     rectificación —que no tiene esos parámetros— reimprima la misma fecha y el mismo
--     anexo que el documento al que sustituye.
--
--   · El snapshot (`documentos.datos`, `cierre_datos_certificado()` y
--     `periodo_datos_certificado()`) gana `abast` ('exercici' | 'periode' | 'oferta'),
--     `data_expedicio` (ISO), `annex` (bool) y, en oferta, `excedente_id`. Se conserva todo
--     lo demás (`detall`, `factura`, `periode`, `lloc`, `apoderada`, `fundacio`, `donant`…)
--     y la revisión sigue entrando como evidencia (`certificat_revisio_snapshot`); el PDF
--     nuevo ya no la imprime. El DNI de la apoderada sigue FUERA del snapshot (§4).
--
--   · `emitir_certificado()` exige ahora una plantilla `CD` vigente sin variante (como el
--     periodo exige la `CD/parcial`): sin ella el PDF saldría con un cuerpo provisional.
--
--   · `emitir_certificado_periodo()` acepta `p_excedente uuid default null` solo como
--     comprobación (si se pasa y no es la oferta del certificado, 22023): el ámbito lo
--     decide el cálculo, no la emisión. Y la sustitución de certificados contenidos se
--     mide por líneas en cuanto uno de los dos es de oferta (20270509100100).
--
-- Cambian tres firmas → drop + create + revoke/grant (§4bis).

-- ---------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------
alter table public.cierres_donante add column if not exists data_expedicio date;
alter table public.cierres_donante add column if not exists annex boolean not null default false;
alter table public.cierres_periodo add column if not exists data_expedicio date;
alter table public.cierres_periodo add column if not exists annex boolean not null default false;

comment on column public.cierres_donante.data_expedicio is
  'Fecha de expedicion impresa en el certificado (la elige quien emite; default 31-12). 20270509100200.';
comment on column public.cierres_periodo.data_expedicio is
  'Fecha de expedicion impresa en el certificado (la elige quien emite; default hoy). 20270509100200.';
comment on column public.cierres_donante.annex is 'El PDF lleva el detalle por producto como anexo.';
comment on column public.cierres_periodo.annex is 'El PDF lleva el detalle por producto como anexo.';

-- En el periodo la regla «no antes del fin del periodo» se puede sostener también en la
-- tabla (en el anual el fin del ejercicio vive en otra tabla y lo sostiene la RPC).
do $$
begin
  if exists (select 1 from public.cierres_periodo
              where data_expedicio is not null and data_expedicio < periodo_hasta) then
    raise exception 'cierres_periodo te dates d''expedicio anteriors al final del periode';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cierres_periodo'::regclass
                    and conname = 'cierres_periodo_data_expedicio_check') then
    alter table public.cierres_periodo
      add constraint cierres_periodo_data_expedicio_check
      check (data_expedicio is null or data_expedicio >= periodo_hasta) not valid;
  end if;
end;
$$;
alter table public.cierres_periodo validate constraint cierres_periodo_data_expedicio_check;

-- ---------------------------------------------------------------------------
-- 2. Snapshots (misma firma: `create or replace` conserva el ACL de solo servidor)
-- ---------------------------------------------------------------------------
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
    'abast', 'exercici',
    'mode', ce.modo,
    'exercici', ce.ejercicio,
    'numero', cd.certificado_numero,
    -- D14: la fecha de generación sigue siendo la de generación.
    'data_generacio', now(),
    -- La fecha que imprime el «expedeixo … a <lloc>, <data>». Las filas anteriores a
    -- 20270509100200 no la tienen: se usa el día en que se certificaron.
    'data_expedicio', coalesce(cd.data_expedicio,
                               (cd.certificado_at at time zone 'Europe/Madrid')::date),
    'annex', coalesce(cd.annex, false),
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    -- Nombre y cargo sí; el DNI NO (§4): lo lee `generar-documento` al pintar.
    'apoderada', jsonb_build_object('nom', par.apoderada_nombre, 'carrec', par.apoderada_cargo),
    'donant', cd.datos_fiscales,
    'periode', jsonb_build_object('des_de', make_date(ce.ejercicio, 1, 1),
                                  'fins_a', make_date(ce.ejercicio, 12, 31)),
    'kg', cd.kg_total,
    'import', cd.valor_total,
    -- Solo se cita la factura que cuadra a dos decimales (20260921211329).
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

revoke execute on function public.cierre_datos_certificado(uuid) from public, anon, authenticated;
grant  execute on function public.cierre_datos_certificado(uuid) to service_role;

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
    -- 'periode' | 'oferta': lo que distingue a este certificado del anual.
    'abast', cp.abast,
    'excedente_id', cp.excedente_id,
    'mode', cp.modo,
    'exercici', cp.ejercicio,
    'numero', cp.certificado_numero,
    'data_generacio', now(),
    'data_expedicio', coalesce(cp.data_expedicio,
                               (cp.certificado_at at time zone 'Europe/Madrid')::date),
    'annex', coalesce(cp.annex, false),
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'apoderada', jsonb_build_object('nom', par.apoderada_nombre, 'carrec', par.apoderada_cargo),
    'donant', cp.datos_fiscales,
    'periode', jsonb_build_object('des_de', cp.periodo_desde, 'fins_a', cp.periodo_hasta),
    'kg', cp.kg_total,
    'import', cp.valor_total,
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

revoke execute on function public.periodo_datos_certificado(uuid) from public, anon, authenticated;
grant  execute on function public.periodo_datos_certificado(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. emitir_certificado (anual)
-- ---------------------------------------------------------------------------
drop function if exists public.emitir_certificado(uuid, text);
drop function if exists public.emitir_certificado(uuid, text, date, boolean);

create function public.emitir_certificado(
  p_cd               uuid,
  p_motivo_excepcion text    default null,
  p_data_expedicio   date    default null,
  p_annex            boolean default false)
returns jsonb
language plpgsql
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
  v_hoy   date;
  v_fi    date;
  v_min   date;
  v_data  date;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  if cd.id is null then
    raise exception 'Aquest donant no es d''un tancament' using errcode = '22023';
  end if;
  if cd.tipo <> 'donacio' then
    raise exception 'certificat_transaccio_retirat: el certificat de transaccio ja no s''emet (20270509100400)'
      using errcode = '22023';
  end if;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  -- (00) Revisión y firma: en REAL firma el super_admin, y solo con la revisión hecha.
  if ce.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa i emet un certificat real' using errcode = '42501';
  end if;
  if ce.modo = 'real' and coalesce(cd.revisio_estat, '') not in ('aprovat_ofertant', 'aprovat_equip') then
    raise exception 'sense_revisio: el certificat encara no esta revisat per l''ofertant' using errcode = '22023';
  end if;

  -- (0) En REAL, los datos de la Fundación tienen que ser los de verdad.
  if ce.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat REAL. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  -- (0bis) Después del 182 no se emite: se rectifica, y lo decide la gestoría (D10).
  if ce.estado = 'declarat' or cd.estado = 'declarat' then
    raise exception 'L''exercici ja esta declarat al 182: cap certificat nou sense parlar amb la gestoria (D10)'
      using errcode = '22023';
  end if;

  if cd.certificado_numero is not null then
    raise exception 'Aquest donant ja te el certificat % (fes servir rectificar_certificado)',
      cd.certificado_numero using errcode = '22023';
  end if;

  -- (0ter) La fecha de expedición. Fin del periodo = 31-12; en un ensayo (prueba) de un
  --        ejercicio que todavía no ha acabado, hoy.
  v_hoy := (now() at time zone 'Europe/Madrid')::date;
  v_fi  := make_date(ce.ejercicio, 12, 31);
  v_min := case when ce.modo = 'prueba' then least(v_fi, v_hoy) else v_fi end;
  v_data := coalesce(p_data_expedicio, v_min);
  if v_data < v_min or v_data > v_hoy then
    raise exception 'data_expedicio_fora_rang: la data d''expedicio (%) ha de ser entre % i % (avui)',
      to_char(v_data, 'DD/MM/YYYY'), to_char(v_min, 'DD/MM/YYYY'), to_char(v_hoy, 'DD/MM/YYYY')
      using errcode = '22023';
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

  -- (2) El texto legal es la plantilla `CD` sin variante (20270509100300).
  if not exists (select 1 from plantillas_documento p
                  where p.tipo = 'CD' and p.variante is null and p.vigente) then
    raise exception 'No hi ha cap plantilla CD vigent: sense ella el certificat no tindria el text legal'
      using errcode = '22023';
  end if;

  -- (3) La factura no condiciona (20260921211329); `p_motivo_excepcion` se ignora.

  v_dest := public.cierre_destinatario(p_cd);

  v_serie := case when ce.modo = 'prueba' then 'P-CD' else 'CD' end;
  v_n := public.siguiente_numero(v_serie, ce.ejercicio);
  update cierres_donante
     set certificado_numero = public.formato_numero(v_serie, ce.ejercicio, v_n),
         certificado_at     = now(),
         estado             = 'certificat_emes',
         data_expedicio     = v_data,
         annex              = coalesce(p_annex, false)
   where id = p_cd
  returning * into cd;

  v_doc := public.cierre_emet_document(
    p_cd, 'CD', 'definitiu',
    public.cierre_datos_certificado(p_cd) || public.certificat_revisio_snapshot(cd.revisio_estat, cd.revisio_at, cd.revisio_per, cd.revisio_nota),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', 'Certificat de donacio ' || ce.ejercicio::text || ' — ' || cd.certificado_numero,
      'plantilla', 'certificat_donacio'));

  -- (4) EL ANUAL MANDA: sustituye a todos los certificados a demanda (periodo y oferta) del
  --     mismo donante, ejercicio y modo.
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

  return jsonb_build_object('document', v_doc, 'numero', cd.certificado_numero,
                            'data', cd.certificado_at, 'import', cd.valor_total,
                            'kg', cd.kg_total, 'destinatari', v_dest,
                            'abast', 'exercici',
                            'data_expedicio', cd.data_expedicio,
                            'annex', cd.annex,
                            'excepcio', cd.excepcion_sin_factura,
                            'parcials_substituits', v_parc);
end;
$$;

comment on function public.emitir_certificado(uuid, text, date, boolean) is
  'Emite el certificado de donacion ANUAL de un donante (CD / P-CD) con su fecha de expedicion (default 31-12) y anexo opcional. 20270509100200.';

revoke execute on function public.emitir_certificado(uuid, text, date, boolean) from public, anon;
grant  execute on function public.emitir_certificado(uuid, text, date, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. emitir_certificado_periodo (periodo y oferta)
-- ---------------------------------------------------------------------------
drop function if exists public.emitir_certificado_periodo(uuid, text);
drop function if exists public.emitir_certificado_periodo(uuid, text, date, boolean, uuid);

create function public.emitir_certificado_periodo(
  p_periodo          uuid,
  p_motivo_excepcion text    default null,
  p_data_expedicio   date    default null,
  p_annex            boolean default false,
  p_excedente        uuid    default null)
returns jsonb
language plpgsql
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
  v_hoy   date;
  v_data  date;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;

  select * into cp from cierres_periodo where id = p_periodo for update;
  if cp.id is null then
    raise exception 'Aquest certificat de periode no existeix' using errcode = '22023';
  end if;
  if p_excedente is not null and cp.excedente_id is distinct from p_excedente then
    raise exception 'oferta_no_coincideix: aquest certificat no es d''aquesta oferta'
      using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  -- (00) Revisión y firma, como el anual.
  if cp.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa i emet un certificat real' using errcode = '42501';
  end if;
  if cp.modo = 'real' and coalesce(cp.revisio_estat, '') not in ('aprovat_ofertant', 'aprovat_equip') then
    raise exception 'sense_revisio: el certificat encara no esta revisat per l''ofertant' using errcode = '22023';
  end if;

  -- (0) En REAL, los datos de la Fundación tienen que ser los de verdad.
  if cp.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat REAL. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  if cp.certificado_numero is not null then
    raise exception 'Aquest periode ja te el certificat % (fes servir rectificar_certificado_periodo)',
      cp.certificado_numero using errcode = '22023';
  end if;
  if cp.calculado_at is null then
    raise exception 'Aquest periode no s''ha calculat encara' using errcode = '22023';
  end if;

  -- (0ter) La fecha de expedición: entre el fin del periodo y hoy; por defecto, hoy.
  v_hoy  := (now() at time zone 'Europe/Madrid')::date;
  v_data := coalesce(p_data_expedicio, v_hoy);
  if v_data < cp.periodo_hasta or v_data > v_hoy then
    raise exception 'data_expedicio_fora_rang: la data d''expedicio (%) ha de ser entre % i % (avui)',
      to_char(v_data, 'DD/MM/YYYY'), to_char(cp.periodo_hasta, 'DD/MM/YYYY'), to_char(v_hoy, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  -- (1) Ningún bloqueo bloqueante (aquí cortan `periode_parteix_excedent` y
  --     `periode_encavalcat`).
  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cp.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquest donant esta bloquejat: %', v_bloq using errcode = '22023';
  end if;

  if cp.kg_total <= 0 or cp.valor_total <= 0 then
    raise exception 'Un certificat de 0 quilos o 0 euros no te sentit' using errcode = '22023';
  end if;

  -- (2) El texto legal del certificado a demanda es la plantilla `CD/parcial`.
  if not exists (select 1 from plantillas_documento p
                  where p.tipo = 'CD' and p.variante = 'parcial' and p.vigente) then
    raise exception 'No hi ha cap plantilla CD/parcial vigent: sense ella el certificat no diria que es d''un periode'
      using errcode = '22023';
  end if;

  v_dest := public.periodo_destinatario(p_periodo);

  v_serie := case when cp.modo = 'prueba' then 'P-CDP' else 'CDP' end;
  v_n := public.siguiente_numero(v_serie, cp.ejercicio);
  update cierres_periodo
     set certificado_numero = public.formato_numero(v_serie, cp.ejercicio, v_n),
         certificado_at     = now(),
         estado             = 'certificat_emes',
         data_expedicio     = v_data,
         annex              = coalesce(p_annex, false)
   where id = p_periodo
  returning * into cp;

  v_doc := public.periodo_emet_document(
    p_periodo,
    public.periodo_datos_certificado(p_periodo) || public.certificat_revisio_snapshot(cp.revisio_estat, cp.revisio_at, cp.revisio_per, cp.revisio_nota),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', 'Certificat de donacio ('
                || case when cp.abast = 'oferta' then 'oferta' else 'periode' end || ') '
                || to_char(cp.periodo_desde, 'DD/MM/YYYY')
                || ' — ' || to_char(cp.periodo_hasta, 'DD/MM/YYYY') || ' · ' || cp.certificado_numero,
      'plantilla', 'certificat_donacio'));

  -- Los certificados anteriores del mismo donante CONTENIDOS en este quedan sustituidos.
  -- Entre dos de periodo, por ventana (como siempre); en cuanto uno es de oferta, por
  -- líneas: todas las canalizaciones del otro están en este.
  update cierres_periodo o
     set estado = 'substituit', sustituido_at = now(), sustituido_por_periodo = p_periodo
   where o.productor_id = cp.productor_id and o.modo = cp.modo
     and o.id <> p_periodo and o.certificado_numero is not null
     and o.estado <> 'substituit'
     and ( (o.abast = 'periode' and cp.abast = 'periode'
            and o.periodo_desde >= cp.periodo_desde and o.periodo_hasta <= cp.periodo_hasta)
        or ((o.abast = 'oferta' or cp.abast = 'oferta')
            and exists (select 1 from cierre_periodo_lineas lo where lo.cierre_periodo_id = o.id)
            and not exists (select 1 from cierre_periodo_lineas lo
                             where lo.cierre_periodo_id = o.id
                               and not exists (select 1 from cierre_periodo_lineas lc
                                                where lc.cierre_periodo_id = p_periodo
                                                  and lc.canalizacion_id = lo.canalizacion_id))) );
  get diagnostics v_subs = row_count;

  update documentos d
     set vigente = false, sustituido_por = v_doc
   where d.objeto_tipo = 'cierre_periodo' and d.vigente and d.id <> v_doc
     and d.objeto_id in (select o.id from cierres_periodo o
                          where o.sustituido_por_periodo = p_periodo);

  return jsonb_build_object('document', v_doc, 'numero', cp.certificado_numero,
                            'data', cp.certificado_at, 'import', cp.valor_total,
                            'kg', cp.kg_total, 'destinatari', v_dest,
                            'abast', cp.abast,
                            'excedente_id', cp.excedente_id,
                            'data_expedicio', cp.data_expedicio,
                            'annex', cp.annex,
                            'periode', jsonb_build_object('des_de', cp.periodo_desde,
                                                          'fins_a', cp.periodo_hasta),
                            'substitueix', v_subs,
                            'excepcio', cp.excepcion_sin_factura);
end;
$$;

comment on function public.emitir_certificado_periodo(uuid, text, date, boolean, uuid) is
  'Emite el certificado de donacion a demanda (periodo u oferta; CDP / P-CDP) con su fecha de expedicion (default hoy) y anexo opcional. 20270509100200.';

revoke execute on function public.emitir_certificado_periodo(uuid, text, date, boolean, uuid) from public, anon;
grant  execute on function public.emitir_certificado_periodo(uuid, text, date, boolean, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. emitir_certificados_cierre (la tanda anual)
-- ---------------------------------------------------------------------------
drop function if exists public.emitir_certificados_cierre(uuid);
drop function if exists public.emitir_certificados_cierre(uuid, date, boolean);

create function public.emitir_certificados_cierre(
  p_cierre         uuid,
  p_data_expedicio date    default null,
  p_annex          boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ce        cierres_ejercicio%rowtype;
  par       parametros_documentales%rowtype;
  cd        record;
  v_bloq    text;
  v_emesos  int := 0;
  v_ja      int := 0;
  v_saltats jsonb := '[]'::jsonb;
  v_donant  text;
  v_hoy     date;
  v_fi      date;
  v_min     date;
  v_data    date;
begin
  -- ⚠️ EL ORDEN DE ESTAS GUARDAS NO ES NEGOCIABLE (20270328100800): el arnés llama con un
  --    uuid inexistente y espera el 22023 de (2) tras pasar la de ROL (1).

  -- (1) Rol.
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet certificats' using errcode = '42501';
  end if;

  -- (2) El cierre existe.
  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;

  -- (3) Solo sobre un ejercicio cerrado.
  if ce.estado <> 'tancat' then
    raise exception 'Nomes s''emeten en bloc els certificats d''un tancament tancat: tanca l''exercici primer (estat actual: %)',
      ce.estado using errcode = '22023';
  end if;

  -- (4) Y calculado.
  if ce.calculado_at is null then
    raise exception 'Aquest tancament no s''ha calculat encara' using errcode = '22023';
  end if;

  -- (5) Datos de la Fundación de verdad, solo en REAL. Fuera del bucle a propósito.
  select * into par from parametros_documentales where id = 1;
  if ce.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat REAL. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  -- (6) En REAL lo firma el super_admin.
  if ce.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa i emet certificats reals' using errcode = '42501';
  end if;

  -- (7) La fecha de expedición, una vez para toda la tanda y con la misma regla que
  --     `emitir_certificado()`: fuera del bucle, o una fecha mala daría N saltos iguales.
  v_hoy := (now() at time zone 'Europe/Madrid')::date;
  v_fi  := make_date(ce.ejercicio, 12, 31);
  v_min := case when ce.modo = 'prueba' then least(v_fi, v_hoy) else v_fi end;
  v_data := coalesce(p_data_expedicio, v_min);
  if v_data < v_min or v_data > v_hoy then
    raise exception 'data_expedicio_fora_rang: la data d''expedicio (%) ha de ser entre % i % (avui)',
      to_char(v_data, 'DD/MM/YYYY'), to_char(v_min, 'DD/MM/YYYY'), to_char(v_hoy, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  select count(*) into v_ja
    from cierres_donante
   where cierre_id = p_cierre and tipo = 'donacio' and certificado_numero is not null;

  for cd in select * from cierres_donante
             where cierre_id = p_cierre
               and tipo = 'donacio'
               and certificado_numero is null
             order by created_at
  loop
    v_donant := coalesce(cd.datos_fiscales->>'raó_social',
                         (select coalesce(p.empresa, p.name) from productores p
                           where p.id = cd.productor_id),
                         cd.productor_id::text);

    -- (a) Algún bloqueo que bloquea de verdad.
    select string_agg(b->>'detall', '; ') into v_bloq
      from jsonb_array_elements(cd.bloqueos) b where (b->>'bloqueja')::boolean;
    if v_bloq is not null then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'bloquejat', 'motiu', v_bloq);
      continue;
    end if;

    -- (b) Sin kilos o sin valor.
    if cd.kg_total <= 0 or cd.valor_total <= 0 then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'sense_kg',
        'motiu', 'Sense quilos o sense valor (' || round(cd.kg_total, 1)::text || ' kg, '
                 || round(cd.valor_total, 2)::text || ' EUR)');
      continue;
    end if;

    -- (b2) En REAL, sin la revisión no se firma.
    if ce.modo = 'real' and coalesce(cd.revisio_estat, '') not in ('aprovat_ofertant', 'aprovat_equip') then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'sense_revisio',
        'motiu', 'Encara no l''ha revisat l''ofertant');
      continue;
    end if;

    -- (c) El resto lo decide `emitir_certificado()`.
    begin
      perform public.emitir_certificado(cd.id, null, v_data, coalesce(p_annex, false));
      v_emesos := v_emesos + 1;
    exception when others then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'error', 'motiu', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'tancament', p_cierre,
    'exercici',  ce.ejercicio,
    'mode',      ce.modo,
    'data_expedicio', v_data,
    'emesos',    v_emesos,
    'ja_tenien', v_ja,
    'saltats',   v_saltats);
end;
$$;

comment on function public.emitir_certificados_cierre(uuid, date, boolean) is
  'Emite en bloque los CD de un cierre tancat, todos con la misma fecha de expedicion (default 31-12) y anexo opcional. 20270509100200.';

revoke execute on function public.emitir_certificados_cierre(uuid, date, boolean) from public, anon;
grant  execute on function public.emitir_certificados_cierre(uuid, date, boolean) to authenticated, service_role;
