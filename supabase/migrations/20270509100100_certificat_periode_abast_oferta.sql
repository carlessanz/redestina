-- Certificado de donación de UNA OFERTA (05-11-2026).
--
-- Plan «Certificat de donació según el modelo de Tabaquet», bloque 1. El certificado a
-- demanda (`cierres_periodo`, serie CDP) cubría una ventana de fechas; la Fundació quiere
-- poder emitirlo también para una sola oferta. Se reutiliza la misma tabla, la misma serie
-- y el mismo motor, con un ámbito más:
--
--   · `cierres_periodo.abast` ∈ `periode` · `oferta` (default `periode`, que es lo que son
--     todas las filas anteriores) y `cierres_periodo.excedente_id` (FK a `excedentes`).
--     Coherencia por check: `abast = 'oferta'` ⇔ `excedente_id is not null`.
--
--   · `calcular_certificado_periodo(..., p_excedente uuid default null)`: con oferta, el
--     desde/hasta NO lo elige nadie: sale de las canalizaciones CERTIFICABLES de la oferta
--     (mínima y máxima de la misma fecha que usa la ventana de `cierre_base_periodo()`), y
--     las líneas son solo las de esa oferta. La oferta tiene que ser del donante.
--     Un borrador por oferta y modo: si al recalcular la ventana ha crecido (una recogida
--     más conciliada), se actualiza el mismo borrador.
--
--   · El solape entre certificados se mide por LÍNEAS en cuanto uno de los dos es de oferta
--     (entre dos de periodo sigue siendo por ventana, como antes): un certificado de oferta
--     comparte ventana con otro de periodo sin compartir ni un kilo, o al revés. Si comparten
--     alguna canalización sin que el otro quede contenido en este, bloquea
--     `periode_encavalcat`. El que contiene a otro lo sustituye al emitirse
--     (`emitir_certificado_periodo()`, 20270509100200). El anual sigue sustituyendo a todos.
--
-- Cambia la firma de `calcular_certificado_periodo` → drop + create + revoke/grant (§4bis).

-- ---------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------
alter table public.cierres_periodo
  add column if not exists excedente_id uuid references public.excedentes(id);
alter table public.cierres_periodo
  add column if not exists abast text not null default 'periode';

comment on column public.cierres_periodo.abast is
  'periode (ventana de fechas) | oferta (una sola oferta: excedente_id). 20270509100100.';
comment on column public.cierres_periodo.excedente_id is
  'La oferta certificada cuando abast = oferta; null en un certificado de periodo.';

-- Los checks, `not valid` + `validate` (§7). Todas las filas anteriores son `periode` sin
-- oferta, así que validan; se comprueba igual antes, por si alguien las ha tocado.
do $$
begin
  if exists (select 1 from public.cierres_periodo
              where abast not in ('periode', 'oferta')
                 or (abast = 'oferta') <> (excedente_id is not null)) then
    raise exception 'cierres_periodo te files incoherents amb abast/excedente_id: revisa-les abans';
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cierres_periodo'::regclass
                    and conname = 'cierres_periodo_abast_check') then
    alter table public.cierres_periodo
      add constraint cierres_periodo_abast_check
      check (abast in ('periode', 'oferta')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cierres_periodo'::regclass
                    and conname = 'cierres_periodo_abast_oferta_check') then
    alter table public.cierres_periodo
      add constraint cierres_periodo_abast_oferta_check
      check ((abast = 'oferta') = (excedente_id is not null)) not valid;
  end if;
end;
$$;

alter table public.cierres_periodo validate constraint cierres_periodo_abast_check;
alter table public.cierres_periodo validate constraint cierres_periodo_abast_oferta_check;

-- Un borrador por ventana en el ámbito periodo (el índice de siempre, ahora solo para él)
-- y uno por oferta y modo en el ámbito oferta.
drop index if exists public.cierres_periodo_esborrany_uidx;
create unique index if not exists cierres_periodo_esborrany_uidx
  on public.cierres_periodo (productor_id, modo, periodo_desde, periodo_hasta)
  where certificado_numero is null and excedente_id is null;
create unique index if not exists cierres_periodo_oferta_esborrany_uidx
  on public.cierres_periodo (excedente_id, modo)
  where certificado_numero is null and excedente_id is not null;
create index if not exists cierres_periodo_excedente_idx
  on public.cierres_periodo (excedente_id) where excedente_id is not null;

-- ---------------------------------------------------------------------------
-- 2. calcular_certificado_periodo, con el ámbito oferta
-- ---------------------------------------------------------------------------
drop function if exists public.calcular_certificado_periodo(uuid, date, date, text);
drop function if exists public.calcular_certificado_periodo(uuid, date, date, text, uuid);

create function public.calcular_certificado_periodo(
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
           'domicili', pr.direccion,
           'codi_postal', pr.codigo_postal,
           'poblacio', pr.poblacion,
           'provincia', public.provincia_por_cp(pr.codigo_postal),
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
                        case when coalesce(btrim(pr.direccion), '') = '' then 'domicili' end,
                        case when coalesce(btrim(pr.codigo_postal), '') = '' then 'codi postal' end,
                        case when coalesce(btrim(pr.poblacion), '') = '' then 'poblacio' end],
                        null), ', '))
              where coalesce(btrim(pr.nif), '') = ''
                 or coalesce(btrim(pr.direccion), '') = ''
                 or coalesce(btrim(pr.codigo_postal), '') = ''
                 or coalesce(btrim(pr.poblacion), '') = ''
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

comment on function public.calcular_certificado_periodo(uuid, date, date, text, uuid) is
  'Calcula (y guarda como borrador) el certificado de donacion a demanda de un donante: por periodo, o por oferta con p_excedente (la ventana sale de lo certificable de la oferta). 20270509100100.';

revoke execute on function public.calcular_certificado_periodo(uuid, date, date, text, uuid) from public, anon;
grant  execute on function public.calcular_certificado_periodo(uuid, date, date, text, uuid) to authenticated, service_role;
