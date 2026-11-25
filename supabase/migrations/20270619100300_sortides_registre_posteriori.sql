-- «Registrar operació realitzada» (proceso 3.7; fase 5 del plan de noviembre de 2026), 4 de 4:
-- «Entrades i sortides» distingue lo REGISTRADO A POSTERIORI.
--
-- `sortides_base()` gana una columna al final, `registre_posteriori boolean`
-- (= `excedentes.origen = 'registre'`, 20270619100000). Cambia el `returns table`, así que es
-- `drop` + `create` (los argumentos no cambian). Las dos funciones públicas NO cambian de firma
-- ni se recrean: `entrades_sortides()` devuelve cada fila con `to_jsonb(select * …)`, así que la
-- clave `registre_posteriori` aparece sola en `files[]`; `entrades_sortides_resum()` lee `s.*` y
-- no la usa. (Son plpgsql: no dependen de la definición de `sortides_base` en el catálogo, así que
-- el `drop` no las arrastra.)
--
-- Copia literal de 20270618100000 §1 salvo la columna nueva (marcada). Sigue interna: `revoke` a
-- todos. Idempotente (`drop … if exists`).

drop function if exists public.sortides_base(date, date, uuid, uuid, text, text, text, text, text, text);

create function public.sortides_base(
  p_desde          date default null,
  p_hasta          date default null,
  p_productor      uuid default null,
  p_entidad        uuid default null,
  p_producto       text default null,
  p_zona           text default null,
  p_modalitat      text default null,
  p_estat          text default null,
  p_cerca          text default null,
  p_tipus_operacio text default null
)
returns table(
  canalizacion_id    uuid,
  excedente_id       uuid,
  id_excedente       text,
  espigolada_id      uuid,
  created_at         timestamptz,
  data_sortida       date,
  productor_id       uuid,
  productor_nom      text,
  productor_org      uuid,
  entidad_id         uuid,
  entidad_nom        text,
  entidad_org        uuid,
  producto           text,
  variedad           text,
  kg_sortida         numeric,
  kg_recollits       numeric,
  modalitat          text,
  estat              text,
  causa_codigo       text,
  municipi           text,
  municipi_ine       text,
  zona               text,
  caixes_entregades  integer,
  caixes_retornades  integer,
  preu_kg            numeric,
  valor              numeric,
  albara_ent         jsonb,
  albara_rec         jsonb,
  tipus_operacio     text,
  -- 20270619100300: la oferta se registró a posteriori (`origen = 'registre'`).
  registre_posteriori boolean
)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_cerca  text := nullif(btrim(coalesce(p_cerca, '')), '');
  v_mod    text := p_modalitat;
  -- Compatibilidad: la pseudo-modalidad `espigolada` del frontend publicado.
  v_compat boolean := false;
begin
  if p_desde is not null and p_hasta is not null and p_desde > p_hasta then
    raise exception 'periode_invalid: la data inicial es posterior a la final' using errcode = '22023';
  end if;
  if v_mod = 'espigolada' then
    v_compat := true;
    v_mod := null;
  end if;
  if v_mod is not null and v_mod not in ('donacio', 'venda', 'maquila') then
    raise exception 'modalitat_invalida: %', p_modalitat using errcode = '22023';
  end if;
  if p_tipus_operacio is not null and p_tipus_operacio not in ('excedent', 'espigolada') then
    raise exception 'tipus_operacio_invalid: %', p_tipus_operacio using errcode = '22023';
  end if;
  if p_estat is not null and p_estat not in
     ('pendent', 'programada', 'registrada', 'entregada', 'confirmada', 'conciliada', 'anulada') then
    raise exception 'estat_invalid: %', p_estat using errcode = '22023';
  end if;
  if v_cerca is not null then
    v_cerca := public.unaccent(lower(v_cerca));
  end if;

  return query
  with f as (
    select c.id                                                    as f_canalizacion,
           c.excedente_id                                          as f_excedente,
           ex.id_excedente                                         as f_id_excedente,
           ex.espigolada_id                                        as f_espigolada,
           c.created_at                                            as f_created,
           ((coalesce(c.recollida_real_at, c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid'))::date                as f_data,
           p.id                                                    as f_productor,
           coalesce(nullif(p.empresa, ''), p.name)                 as f_productor_nom,
           p.organizacion_id                                       as f_productor_org,
           c.entidad_id                                            as f_entidad,
           en.nombre                                               as f_entidad_nom,
           en.organizacion_id                                      as f_entidad_org,
           ex.producto                                             as f_producto,
           ex.variedad                                             as f_variedad,
           c.kg_confirmados                                        as f_kg_sortida,
           coalesce(c.kg_conciliados, c.kg_reales)                 as f_kg_recollits,
           -- 20270618100000: la modalidad REAL; la espigolada es el tipo de operación.
           coalesce(c.valorizacion, ex.modalitat, 'donacio')       as f_modalitat,
           case
             when c.estado = 'anulada' then 'anulada'
             else public.estat_recollida_canalitzacio(c.estado, c.recollida_registrada_at,
                                                      c.recollida_validada_at, c.data_hora_recollida,
                                                      alb.estado)
           end                                                     as f_estat,
           ex.causa_codigo                                         as f_causa,
           coalesce(ex.municipi_ine, p.municipio_ine)              as f_ine,
           coalesce(nullif(ex.comarca, ''), nullif(p.area_geografica, '')) as f_zona,
           c.caixes_entregades                                     as f_caixes_ent,
           c.caixes_retornades                                     as f_caixes_ret,
           case when c.valorizacion = 'venda' then coalesce(c.preu_acordat_kg, c.coste_kg)
                else c.coste_kg end                                as f_preu,
           case when alb.id is not null then
             jsonb_build_object('id', alb.id, 'tipo', alb.tipo, 'numero', alb.numero_completo,
                                'estado', alb.estado) end          as f_ent,
           case when rec.id is not null then
             jsonb_build_object('id', rec.id, 'tipo', rec.tipo, 'numero', rec.numero_completo,
                                'estado', rec.estado) end          as f_rec,
           coalesce(ex.tipus_operacio, 'excedent')                 as f_tipus,
           coalesce(ex.origen = 'registre', false)                 as f_registre
      from canalizaciones c
      left join excedentes  ex on ex.id = c.excedente_id
      left join espigoladas es on es.id = ex.espigolada_id
      left join productores p  on p.id = coalesce(ex.productor_id, es.productor_id)
      left join entidades   en on en.id = c.entidad_id
      left join lateral (
        select a.id, a.tipo, a.numero_completo, a.estado
          from albaranes a
         where a.canalizacion_id = c.id and a.tipo in ('ENT', 'OPE')
           and a.estado not in ('anulado', 'rectificado')
         order by a.created_at desc
         limit 1
      ) alb on true
      -- La entrada: el REC de ESTA recogida; si no lo hay, el heredado de la oferta o el de la
      -- jornada de espigolada (rama dormida, deuda 192), solo para una donación.
      left join lateral (
        select a.id, a.tipo, a.numero_completo, a.estado
          from albaranes a
         where a.tipo = 'REC' and a.estado not in ('anulado', 'rectificado')
           and (a.canalizacion_id = c.id
                or (coalesce(c.valorizacion, ex.modalitat, 'donacio') = 'donacio'
                    and a.canalizacion_id is null
                    and ((a.excedente_id = c.excedente_id)
                         or (ex.espigolada_id is not null and a.espigolada_id = ex.espigolada_id))))
         order by (a.canalizacion_id is null), a.created_at desc
         limit 1
      ) rec on true
  )
  select f.f_canalizacion, f.f_excedente, f.f_id_excedente, f.f_espigolada, f.f_created, f.f_data,
         f.f_productor, f.f_productor_nom, f.f_productor_org,
         f.f_entidad, f.f_entidad_nom, f.f_entidad_org,
         f.f_producto, f.f_variedad, f.f_kg_sortida, f.f_kg_recollits,
         f.f_modalitat, f.f_estat, f.f_causa,
         m.nom, f.f_ine, f.f_zona,
         f.f_caixes_ent, f.f_caixes_ret,
         f.f_preu,
         case when f.f_kg_recollits is not null and f.f_preu is not null
              then round(f.f_kg_recollits * f.f_preu, 2) end,
         f.f_ent, f.f_rec,
         f.f_tipus,
         f.f_registre
    from f
    left join municipios m on m.codi_ine = f.f_ine
   where (p_desde is null or f.f_data >= p_desde)
     and (p_hasta is null or f.f_data <= p_hasta)
     and (p_productor is null or f.f_productor = p_productor)
     and (p_entidad is null or f.f_entidad = p_entidad)
     and (p_producto is null or f.f_producto = p_producto)
     and (p_zona is null or f.f_zona = p_zona)
     and (v_mod is null or f.f_modalitat = v_mod)
     and (p_tipus_operacio is null or f.f_tipus = p_tipus_operacio)
     and (not v_compat or f.f_tipus = 'espigolada')
     -- Las anuladas, solo si se piden.
     and (case when p_estat is null then f.f_estat <> 'anulada' else f.f_estat = p_estat end)
     and (v_cerca is null
          or strpos(public.unaccent(lower(concat_ws(' ',
                f.f_productor_nom, f.f_entidad_nom, f.f_producto, f.f_variedad, f.f_id_excedente,
                f.f_ent->>'numero', f.f_rec->>'numero'))), v_cerca) > 0);
end;
$$;
revoke execute on function public.sortides_base(date, date, uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;

comment on function public.sortides_base(date, date, uuid, uuid, text, text, text, text, text, text) is
  'Interna (20270612100000; 20270618100000 tipus_operacio; 20270619100300 registre_posteriori): una fila por salida (canalización) con sus filtros. Única definición de «Entrades i sortides»; la llaman entrades_sortides y entrades_sortides_resum.';
