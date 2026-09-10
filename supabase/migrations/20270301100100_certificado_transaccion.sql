-- El certificado de transacción (`CT`): el mismo ciclo anual del certificado de donación,
-- sobre operaciones de venta y de maquila, y dirigido al **generador**.
--
-- LA DECISIÓN, y el porqué. D6 del plan mantiene el CT **anual y en esta fase**. Un CT es,
-- pieza por pieza, lo mismo que un CD:
--   · se acumula por año natural y por organización generadora,
--   · nace de operaciones **conciliadas**, con el detalle congelado línea a línea,
--   · pide su número a una serie legal dentro de la transacción que lo emite,
--   · se deja en la carpeta de esa organización y lo ve solo ella y el equipo.
-- Lo único distinto es **de dónde salen los kilos** (del albarán de operación, `OPE`, y no
-- del de recepción) y que **no lleva ningún importe**.
--
-- Por eso NO se crea un motor paralelo. Se reutilizan `cierres_ejercicio` (la cabecera
-- anual, con su modo prueba/real y su job de fin de año), `cierres_donante` (la fila por
-- organización) y `cierre_donante_lineas` (el detalle congelado), y se les añade **una
-- columna discriminadora**, `cierres_donante.tipo`. Con eso, el CT hereda gratis:
-- `cierre_emet_document()`, `cierre_destinatario()`, `ruta_documento()`, la RLS,
-- `cierres_donante_meus()`, `documents_meus()` y `puc_pujar_document_extern()`.
-- Duplicar tres tablas y cinco funciones para cambiar una consulta habría sido lo
-- contrario de lo que pide el plan.
--
-- ⚠️ EL CT NO LLEVA IMPORTES. El funcional es explícito: «acredita la operación realizada
--    con los kilos conciliados. **No recoge importes**. El valor económico queda
--    registrado a nivel interno». Así que `valor_total` y `valor` se calculan y se guardan
--    —los indicadores los necesitan— pero **el snapshot que va al PDF no los lleva**, ni
--    ellos ni el coste por kilo. `documentos.datos` lo lee la propia organización a través
--    de `documents_meus()`: meterlos ahí sería publicarlos.
--
-- ⚠️ COMO EL CD, NO SE EMITE MIENTRAS `parametros_documentales.datos_provisionales` VALGA
--    `true`. No es por el efecto fiscal —el CT no lo tiene—, sino porque un certificado
--    firmado por una fundación con el CIF de relleno `G00000000` no acredita nada.

-- ---------------------------------------------------------------------------
-- 1. La columna discriminadora
-- ---------------------------------------------------------------------------
-- `default 'donacio'` es lo que mantiene válidas las filas que ya existían, exactamente
-- por el mismo motivo que el `default 'aprovada'` de `membresias.aprovacio`: todo lo que
-- hay en la tabla se calculó con el motor de donaciones, o sea que es de donación por
-- definición.
alter table cierres_donante
  add column if not exists tipo text not null default 'donacio';

alter table cierres_donante drop constraint if exists cierres_donante_tipo_check;
alter table cierres_donante add constraint cierres_donante_tipo_check
  check (tipo in ('donacio', 'transaccio'));

comment on column cierres_donante.tipo is
  'donacio -> certificado de donación (CD, con importes). transaccio -> certificado de transacción (CT, venta/maquila, sin importes).';
comment on table cierres_donante is
  'El acumulado anual de una organización en un cierre. tipo=donacio: donante, factura y CD. tipo=transaccio: generador y CT.';

-- ⚠️ LA CLAVE CAMBIA. Un mismo productor puede donar Y vender en el mismo año: son dos
--    filas del mismo cierre, no una. El `unique (cierre_id, productor_id)` original lo
--    haría imposible.
alter table cierres_donante drop constraint if exists cierres_donante_cierre_id_productor_id_key;

create unique index if not exists cierres_donante_cierre_org_tipo_uidx
  on cierres_donante (cierre_id, productor_id, tipo);

-- La bandeja separa las dos colas.
create index if not exists cierres_donante_tipo_idx on cierres_donante (cierre_id, tipo, estado);

-- ---------------------------------------------------------------------------
-- 2. El guardián: cada tipo con su circuito, y sin cruces
-- ---------------------------------------------------------------------------
-- Sin esto, llamar a `emitir_resumen()` o a `emitir_certificado()` sobre una fila
-- `transaccio` emitiría un RES o un CD de una operación de venta: un documento con un
-- número de la serie de donaciones diciendo cosas que no son. El guardián está en un
-- trigger y no en cada RPC a propósito —así protege también del código que se escriba
-- mañana— y salta **en el momento del `update` que asigna el número**, antes de que se
-- cree ningún documento; al deshacerse la transacción, el número vuelve a la serie.
create or replace function trg_cierres_donante_tipo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.tipo = 'transaccio' then
    if new.resumen_numero is not null then
      raise exception 'Un certificat de transaccio no te resum anual: no hi ha factura a demanar'
        using errcode = '22023';
    end if;
    if new.factura_numero is not null or new.factura_importe is not null
       or new.factura_doc_externo_id is not null or new.excepcion_sin_factura then
      raise exception 'Un certificat de transaccio no cita cap factura (el pagament es tramita fora)'
        using errcode = '22023';
    end if;
    if new.certificado_numero is not null
       and new.certificado_numero !~ '^(P-)?CT-' then
      raise exception 'El numero % no es de la serie CT: aquesta fila es de transaccio',
        new.certificado_numero using errcode = '22023';
    end if;
  else
    if new.certificado_numero is not null
       and new.certificado_numero !~ '^(P-)?CD-' then
      raise exception 'El numero % no es de la serie CD: aquesta fila es de donacio',
        new.certificado_numero using errcode = '22023';
    end if;
  end if;

  -- El tipo es la identidad de la fila: no se cambia nunca.
  if tg_op = 'UPDATE' and new.tipo is distinct from old.tipo then
    raise exception 'El tipus d''un acumulat anual no es pot canviar (% -> %)', old.tipo, new.tipo
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists cierres_donante_tipo on cierres_donante;
create trigger cierres_donante_tipo
  before insert or update on cierres_donante
  for each row execute function trg_cierres_donante_tipo();

-- ---------------------------------------------------------------------------
-- 3. La serie de prueba del CT
-- ---------------------------------------------------------------------------
-- `CT` ya está sembrada (20260928100000) con 4 dígitos; `P-CT` no, y `siguiente_numero()`
-- la crearía sola con 5 —el default— porque no hay ningún ejercicio anterior del que
-- heredar. Se siembra para que el número de prueba tenga la misma forma que el real.
insert into series_documentales (serie, ejercicio, ultimo, digitos)
select 'P-CT', e.ejercicio, 0, 4
  from generate_series(2026, 2030) as e(ejercicio)
on conflict (serie, ejercicio) do update set digitos = excluded.digitos;

-- ---------------------------------------------------------------------------
-- 4. cierre_base_transaccion(): qué entra en un CT
-- ---------------------------------------------------------------------------
-- La gemela de `cierre_base()`, y **mucho más simple**, porque el reparto proporcional no
-- hace falta: en una donación el REC documenta una entrada que después se reparte entre
-- varias entidades, y hay que atribuir esos kilos línea a línea; en una venta o una
-- maquila el `OPE` cuelga **de la propia canalización**, uno a uno. Escribirlas como una
-- sola función con ramas habría escondido esa diferencia, que es justo lo que hay que ver.
--
-- Misma regla de fecha que `cierre_base()` (`data_hora_recollida` con respaldo) y misma
-- regla de conciliación retroactiva: sin `OPE` conciliado la línea lo dice y **solo cuenta
-- en cierres de prueba**.
create or replace function public.cierre_base_transaccion(p_ejercicio int, p_modo text default 'prueba')
returns table (
  canalizacion_id uuid,
  excedente_id    uuid,
  entidad_id      uuid,
  productor_id    uuid,
  producto        text,
  valorizacion    text,
  mes             int,
  kg_conciliados  numeric,
  coste_kg        numeric,
  retroactiva     boolean,
  albaran_ope_id  uuid,
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
           e.productor_id, e.producto, c.valorizacion,
           c.kg_conciliados, c.coste_kg,
           c.conciliacion_retroactiva as retroactiva,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid') as fecha_local
      from canalizaciones c
      join excedentes e on e.id = c.excedente_id
     where c.valorizacion in ('venda', 'maquila')
       and c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  enrango as (
    select o.*, extract(month from o.fecha_local)::int as mes
      from ops o
     where extract(year from o.fecha_local)::int = p_ejercicio
  ),
  conope as (
    select o.*, r.albaran_id as albaran_ope_id, r.kg as ope_neto
      from enrango o
      left join lateral (
        select a.id as albaran_id, sum(l.kg_validados) as kg
          from albaranes a
          join albaran_lineas l on l.albaran_id = a.id
         where a.tipo = 'OPE' and a.estado = 'conciliado'
           and a.canalizacion_id = o.canalizacion_id
         group by a.id
         order by a.id
         limit 1
      ) r on true
  )
  select c.canalizacion_id, c.excedente_id, c.entidad_id, c.productor_id, c.producto,
         c.valorizacion, c.mes, c.kg_conciliados, c.coste_kg,
         (c.retroactiva or c.albaran_ope_id is null) as retroactiva,
         c.albaran_ope_id,
         round(coalesce(c.ope_neto, c.kg_conciliados), 2) as kg_neto,
         round(coalesce(c.ope_neto, c.kg_conciliados) * coalesce(c.coste_kg, 0), 2) as valor
    from conope c;
$$;

comment on function public.cierre_base_transaccion(int, text) is
  'Base del certificado de transacción: ventas y maquilas conciliadas del año, con los kilos del albarán OPE.';

-- ---------------------------------------------------------------------------
-- 5. cierre_pendents_transaccion(): lo que falta por conciliar
-- ---------------------------------------------------------------------------
create or replace function public.cierre_pendents_transaccion(p_ejercicio int)
returns table (productor_id uuid, canalizaciones int, kg numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.productor_id, count(*)::int, coalesce(sum(c.kg_confirmados), 0)
    from canalizaciones c
    join excedentes e on e.id = c.excedente_id
   where c.valorizacion in ('venda', 'maquila')
     and c.estado in ('confirmada', 'entregada')
     and extract(year from (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
                              at time zone 'Europe/Madrid'))::int = p_ejercicio
   group by e.productor_id;
$$;

comment on function public.cierre_pendents_transaccion(int) is
  'Ventas y maquilas del ejercicio sin conciliar. Cada una bloquea el certificado de transacción de su generador.';

-- ---------------------------------------------------------------------------
-- 6. El snapshot del CT: kilos sí, euros no
-- ---------------------------------------------------------------------------
-- ⚠️ Ni `valor`, ni `coste_kg`, ni `valor_total`. Ver la cabecera: el funcional lo dice y
--    además `documentos.datos` lo lee la propia organización. La comprobación es fácil de
--    escribir y conviene tenerla:
--      select public.cierre_datos_certificado_transaccion(<cd>)::text ilike '%valor%';  -- f
create or replace function public.cierre_datos_certificado_transaccion(p_cd uuid)
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
  if cd.tipo <> 'transaccio' then
    raise exception 'Aquest acumulat es de donacio: fes servir cierre_datos_certificado()'
      using errcode = '22023';
  end if;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  return jsonb_build_object(
    'tipus', 'CT',
    'mode', ce.modo,
    'exercici', ce.ejercicio,
    'numero', cd.certificado_numero,
    'data_generacio', now(),
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'apoderada', jsonb_build_object('nom', par.apoderada_nombre, 'carrec', par.apoderada_cargo),
    -- Los datos del generador, congelados al calcular. Sin `provincia`: aquí no hay 182.
    'generador', cd.datos_fiscales,
    'periode', jsonb_build_object('des_de', (ce.ejercicio::text || '-01-01')::date,
                                  'fins_a', (ce.ejercicio::text || '-12-31')::date),
    'kg', cd.kg_total,
    'sense_imports', true,
    'nota', 'Aquest certificat acredita les operacions realitzades amb els quilos conciliats. '
            || 'No recull imports: el pagament es tramita fora de la plataforma.',
    'detall', (
      select coalesce(jsonb_agg(x order by x->>'producte'), '[]'::jsonb)
        from (
          select jsonb_build_object('producte', l.producto, 'kg', sum(l.kg_neto),
                                    'operacions', count(*)) as x
            from cierre_donante_lineas l
           where l.cierre_donante_id = cd.id
           group by l.producto
        ) d),
    'destinacions', (
      select coalesce(jsonb_agg(distinct jsonb_build_object('entitat', e.nombre)), '[]'::jsonb)
        from cierre_donante_lineas l
        join entidades e on e.id = l.entidad_id
       where l.cierre_donante_id = cd.id),
    'bloquejos', cd.bloqueos
  );
end;
$$;

comment on function public.cierre_datos_certificado_transaccion(uuid) is
  'Snapshot del certificado de transacción. SIN IMPORTES, nunca: el valor económico es interno (§funcional).';

-- ---------------------------------------------------------------------------
-- 7. calcular_cierre(): la misma de 20261109100100, acotada a `tipo = 'donacio'`
-- ---------------------------------------------------------------------------
-- Lo único que cambia es el `tipo` en el insert, el `on conflict` con la clave nueva y los
-- tres filtros que impiden que el motor de donaciones toque —o borre— las líneas de un CT.
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
           'domicili', pr.direccion,
           'codi_postal', pr.codigo_postal,
           'poblacio', pr.poblacion,
           'provincia', public.provincia_por_cp(pr.codigo_postal),
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
                        case when coalesce(btrim(pr.direccion), '') = '' then 'domicili' end,
                        case when coalesce(btrim(pr.codigo_postal), '') = '' then 'codi postal' end,
                        case when coalesce(btrim(pr.poblacion), '') = '' then 'poblacio' end],
                        null), ', '))
              where coalesce(btrim(pr.nif), '') = ''
                 or coalesce(btrim(pr.direccion), '') = ''
                 or coalesce(btrim(pr.codigo_postal), '') = ''
                 or coalesce(btrim(pr.poblacion), '') = ''
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
                                   where (b->>'bloqueja')::boolean)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. calcular_cierre_transacciones(): la gemela para el CT
-- ---------------------------------------------------------------------------
-- ⚠️ LOS BLOQUEOS SON OTROS, y no por descuido:
--     · `sense_conciliar` **bloquea** igual: certificar una operación a medias no tiene
--       sentido en ningún tipo de documento.
--     · `sense_cost` **NO bloquea**: el CT no lleva importes, así que un producto sin
--       coste por kilo no impide certificar nada. Solo empobrece el indicador interno, y
--       por eso queda como aviso.
--     · `dades_fiscals` **NO bloquea**: el CT no tiene efecto fiscal y no va al 182. Basta
--       con poder nombrar a la organización; el NIF ausente se avisa y ya.
--     · `sense_ope` avisa cuando la operación se concilió sin albarán (retroactiva).
create or replace function public.calcular_cierre_transacciones(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ce    cierres_ejercicio%rowtype;
  v_gen int;
  v_lin int;
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
  select p_cierre, d.productor_id, 'transaccio'
    from (
      select productor_id from public.cierre_base_transaccion(ce.ejercicio, ce.modo)
      union
      select productor_id from public.cierre_pendents_transaccion(ce.ejercicio)
    ) d
  on conflict (cierre_id, productor_id, tipo) do nothing;

  delete from cierre_donante_lineas
   where cierre_donante_id in (select id from cierres_donante
                                where cierre_id = p_cierre and tipo = 'transaccio');

  -- `albaran_rec_id` guarda aquí el **OPE**: es la columna «el albarán del que salen los
  -- kilos», y renombrarla obligaría a reescribir la tabla y el motor de donaciones para
  -- ganar exactitud en un nombre. Queda anotado en el comentario de la columna.
  insert into cierre_donante_lineas (
    cierre_donante_id, canalizacion_id, albaran_rec_id, producto, mes,
    kg_neto, coste_kg, valor, entidad_id, retroactiva)
  select cd.id, b.canalizacion_id, b.albaran_ope_id, b.producto, b.mes,
         b.kg_neto, b.coste_kg, b.valor, b.entidad_id, b.retroactiva
    from public.cierre_base_transaccion(ce.ejercicio, ce.modo) b
    join cierres_donante cd on cd.cierre_id = p_cierre and cd.tipo = 'transaccio'
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
           'domicili', pr.direccion,
           'codi_postal', pr.codigo_postal,
           'poblacio', pr.poblacion,
           'email', pr.email),
         bloqueos = (
           select coalesce(jsonb_agg(x), '[]'::jsonb) from (
             select jsonb_build_object('codigo', 'sense_conciliar', 'bloqueja', true,
                      'detall', pe.canalizaciones::text || ' operacions sense conciliar ('
                                || round(pe.kg, 1)::text || ' kg)') as x
               from public.cierre_pendents_transaccion(ce.ejercicio) pe
              where pe.productor_id = cd.productor_id
             union all
             select jsonb_build_object('codigo', 'sense_ope', 'bloqueja', false,
                      'detall', count(*)::text || ' operacions sense albara d''operacio conciliat')
               from cierre_donante_lineas l
              where l.cierre_donante_id = cd.id and l.albaran_rec_id is null
             having count(*) > 0
             union all
             select jsonb_build_object('codigo', 'sense_cost', 'bloqueja', false,
                      'detall', 'Sense cost per quilo: el certificat no en porta, pero l''indicador intern si')
               from cierre_donante_lineas l
              where l.cierre_donante_id = cd.id and l.coste_kg is null
             having count(*) > 0
             union all
             select jsonb_build_object('codigo', 'sense_nif', 'bloqueja', false,
                      'detall', 'La fitxa no te NIF')
              where coalesce(btrim(pr.nif), '') = ''
           ) b(x))
    from productores pr
   where cd.cierre_id = p_cierre and cd.tipo = 'transaccio' and pr.id = cd.productor_id;
  get diagnostics v_gen = row_count;

  update cierres_ejercicio set calculado_at = now() where id = p_cierre;

  return jsonb_build_object(
    'tancament', p_cierre, 'exercici', ce.ejercicio, 'mode', ce.modo,
    'generadors', v_gen, 'linies', v_lin,
    'kg_total', (select coalesce(sum(kg_total), 0) from cierres_donante
                  where cierre_id = p_cierre and tipo = 'transaccio'),
    -- El valor va en el retorno porque es un indicador interno del equipo, NO en el
    -- snapshot del documento (ver cabecera).
    'valor_intern', (select coalesce(sum(valor_total), 0) from cierres_donante
                      where cierre_id = p_cierre and tipo = 'transaccio'),
    'bloquejats', (select count(*) from cierres_donante
                    where cierre_id = p_cierre and tipo = 'transaccio'
                      and exists (select 1 from jsonb_array_elements(bloqueos) b
                                   where (b->>'bloqueja')::boolean)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. emitir_certificado_transaccion()
-- ---------------------------------------------------------------------------
-- La gemela de `emitir_certificado()`, sin el tramo de la factura —que aquí no existe: el
-- pago se tramita fuera— y sin la excepción de D4, que era justamente la salida cuando no
-- había factura coincidente.
create or replace function public.emitir_certificado_transaccion(p_cd uuid)
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
  v_doc   uuid;
  v_bloq  text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  if cd.id is null then
    raise exception 'Aquest generador no es d''un tancament' using errcode = '22023';
  end if;
  if cd.tipo <> 'transaccio' then
    raise exception 'Aquest acumulat es de donacio: fes servir emitir_certificado()'
      using errcode = '22023';
  end if;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  -- Como el CD: sin los datos reales de la Fundación no se emite nada (ver cabecera).
  if coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  if cd.certificado_numero is not null then
    raise exception 'Aquest generador ja te el certificat %', cd.certificado_numero
      using errcode = '22023';
  end if;

  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cd.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquest generador esta bloquejat: %', v_bloq using errcode = '22023';
  end if;

  if cd.kg_total <= 0 then
    raise exception 'Un certificat de 0 quilos no te sentit' using errcode = '22023';
  end if;

  v_dest := public.cierre_destinatario(p_cd);

  v_serie := case when ce.modo = 'prueba' then 'P-CT' else 'CT' end;
  v_n := public.siguiente_numero(v_serie, ce.ejercicio);
  update cierres_donante
     set certificado_numero = public.formato_numero(v_serie, ce.ejercicio, v_n),
         certificado_at     = now(),
         estado             = 'certificat_emes'
   where id = p_cd
  returning * into cd;

  v_doc := public.cierre_emet_document(
    p_cd, 'CT', 'definitiu',
    public.cierre_datos_certificado_transaccion(p_cd),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', 'Certificat de transaccio ' || ce.ejercicio::text || ' — ' || cd.certificado_numero,
      'plantilla', 'certificat_transaccio'));

  return jsonb_build_object('document', v_doc, 'numero', cd.certificado_numero,
                            'data', cd.certificado_at, 'kg', cd.kg_total,
                            'destinatari', v_dest);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Los dos congeladores, acotados a las donaciones
-- ---------------------------------------------------------------------------
-- `emitir_resumen()` solo tiene sentido sobre una fila de donación —es la petición de
-- factura—, así que los dos bucles filtran por tipo. Sin el filtro, cada CT del ejercicio
-- entraría en el `begin … exception` como un error anotado: no rompería nada (el guardián
-- del §2 lo corta antes de tocar ningún documento), pero el informe del job diría que
-- fallaron cosas que en realidad no debían intentarse.
--
-- Los dos **recalculan también las transacciones**: el 31 de diciembre se congela el
-- ejercicio entero, no la mitad.
create or replace function public.congelar_un_cierre(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd         record;
  v_res      int := 0;
  v_saltados int := 0;
  v_errores  jsonb := '[]'::jsonb;
begin
  perform public.calcular_cierre(p_cierre);
  perform public.calcular_cierre_transacciones(p_cierre);

  for cd in select * from cierres_donante
             where cierre_id = p_cierre and tipo = 'donacio' order by created_at loop
    if exists (select 1 from jsonb_array_elements(cd.bloqueos) b
                where (b->>'bloqueja')::boolean)
       or cd.kg_total <= 0 then
      v_saltados := v_saltados + 1;
      continue;
    end if;

    begin
      perform public.emitir_resumen(cd.id, false);
      v_res := v_res + 1;
    exception when others then
      v_errores := v_errores || jsonb_build_object('donant', cd.id, 'error', sqlerrm);
    end;
  end loop;

  update cierres_ejercicio
     set estado = 'tancat', cerrado_at = now()
   where id = p_cierre;

  return jsonb_build_object('tancament', p_cierre, 'resums_definitius', v_res,
                            'donants_bloquejats', v_saltados, 'errors', v_errores);
end;
$$;

create or replace function public.congelar_ejercicio(p_ejercicio int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ej     int;
  ce       record;
  cd       record;
  v_cierres int := 0;
  v_res    int := 0;
  v_saltados int := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  v_ej := coalesce(p_ejercicio,
                   extract(year from (now() at time zone 'Europe/Madrid'))::int);

  for ce in select * from cierres_ejercicio
             where ejercicio = v_ej and estado in ('obert', 'provisional')
             order by modo, created_at
  loop
    perform public.calcular_cierre(ce.id);
    perform public.calcular_cierre_transacciones(ce.id);

    for cd in select * from cierres_donante
               where cierre_id = ce.id and tipo = 'donacio' order by created_at loop
      if exists (select 1 from jsonb_array_elements(cd.bloqueos) b
                  where (b->>'bloqueja')::boolean)
         or cd.kg_total <= 0 then
        v_saltados := v_saltados + 1;
        continue;
      end if;

      begin
        perform public.emitir_resumen(cd.id, false);
        v_res := v_res + 1;
      exception when others then
        v_errores := v_errores || jsonb_build_object('donant', cd.id, 'error', sqlerrm);
      end;
    end loop;

    update cierres_ejercicio
       set estado = 'tancat', cerrado_at = now()
     where id = ce.id;
    v_cierres := v_cierres + 1;
  end loop;

  return jsonb_build_object('exercici', v_ej, 'tancaments', v_cierres,
                            'resums_definitius', v_res, 'donants_bloquejats', v_saltados,
                            'errors', v_errores);
end;
$$;

comment on function public.congelar_ejercicio(int) is
  'Congela los cierres abiertos del ejercicio: recalcula donaciones y transacciones, emite resúmenes definitivos y pasa a tancat. Cron en UTC.';

comment on column cierre_donante_lineas.albaran_rec_id is
  'El albarán del que salen los kilos: REC en las líneas de donación, OPE en las de transacción.';

-- ---------------------------------------------------------------------------
-- 11. EXECUTE: quitar el PUBLIC por defecto
-- ---------------------------------------------------------------------------
-- Las de consulta las puede llamar el equipo desde el panel (la RLS no aplica a una
-- función `security definer`, pero estas no devuelven nada que el equipo no vea ya); las
-- de escritura, solo el servidor y las cuentas con sesión que la propia función filtra
-- por rol.
do $$
declare f text;
begin
  foreach f in array array[
    'cierre_base_transaccion(int,text)',
    'cierre_pendents_transaccion(int)',
    'cierre_datos_certificado_transaccion(uuid)',
    'calcular_cierre_transacciones(uuid)',
    'emitir_certificado_transaccion(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- `congelar_ejercicio` y `congelar_un_cierre` se recrean con `create or replace`, que
-- conserva los privilegios: siguen siendo solo de `service_role` (20261109100200/300).

-- Verificación:
--   select * from public.cierre_base_transaccion(2026, 'prueba');
--   select public.calcular_cierre_transacciones('<cierre>');
--   select public.emitir_certificado_transaccion('<cd>');       -- 42501 con datos provisionales
--   select public.cierre_datos_certificado_transaccion('<cd>')::text ilike '%valor%';   -- f
