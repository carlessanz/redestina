-- Conciliar un albarán de RECEPCIÓN concilia también sus albaranes de salida confirmados.
--
-- El problema, medido en el clon el 07-10-2026:
--   · La pantalla (`AlbaraDetall`) solo deja conciliar un REC, y `conciliar_albaran()` sobre
--     un REC no tocaba ni sus ENT/OPE ni sus canalizaciones. La canalización solo pasa a
--     `conciliada` (y congela `coste_kg`) cuando se concilia SU albarán de salida.
--   · `conciliacions_automatiques()` solo miraba RECs en `confirmado`. Si el equipo conciliaba
--     el REC a mano antes de que confirmaran las entidades, los ENT que confirmaban después ya
--     no los conciliaba nadie: la canalización se quedaba `confirmada` y el cierre la
--     bloqueaba por `sense_conciliar` sin que hubiera ninguna acción en la interfaz para
--     arreglarlo.
--   · Venta y maquila (OPE sin REC) dependían de la rama «OPE con ≥2 enlaces usados», que no
--     se alcanzaba nunca (ver 20270414100000).
--
-- Lo nuevo:
--
--   (1) `albarans_germans_rec(rec)`: los ENT/OPE que cuelgan de un REC —del mismo excedente,
--       o de cualquier registro de la misma espigolada—. Es la MISMA condición que ya usa
--       `propuesta_conciliacion()`, escrita una vez para que conciliar y proponer no
--       discrepen sobre qué es «un hermano». Interna: solo la llaman funciones definer.
--
--   (2) `conciliar_albaran()` sobre un REC:
--         · si la propuesta queda FUERA de tolerancia, exige motivo (22023
--           `fora_de_tolerancia`). La pantalla ya lo pedía; ahora lo impone la base, porque
--           conciliar el REC pasa a conciliar también las salidas, y eso no puede ocurrir
--           sin que alguien haya escrito por qué.
--         · concilia cada hermano en `confirmado` con el mismo motivo (o, sin motivo, uno que
--           dice con qué REC se concilió). Sus kilos validados son los confirmados: lo que la
--           entidad dijo que llegó. Los hermanos que aún no han confirmado se quedan; los
--           recogerá el job en cuanto confirmen (rama 2 de abajo).
--       Sin bucle: la cascada solo corre cuando el albarán es un REC, y los hermanos son
--       ENT/OPE, así que la llamada anidada no vuelve a entrar en ella.
--       Todo o nada: si un hermano falla, falla la conciliación del REC entera y no queda una
--       entrada conciliada con media salida sin conciliar.
--
--   (3) `conciliacions_automatiques()`, tres ramas:
--         1. REC `confirmado`, con todas sus salidas confirmadas (o cerradas) y la propuesta
--            dentro de tolerancia → concilia el REC, que arrastra las salidas por (2).
--            Ahora incluye también el REC de una espigolada (antes exigía `excedente_id`).
--         2. ENT/OPE `confirmado` cuyo REC YA está `conciliado` → se concilian. Es el caso
--            que se quedaba colgado para siempre.
--         3. OPE `confirmado` sin REC vivo en su excedente (venta o maquila puras) → se
--            concilia. Con 20270414100000, `confirmado` en un OPE ya significa «han
--            confirmado todas las partes que tenían enlace», así que la cuenta de enlaces
--            usados sobra.

-- ---------------------------------------------------------------------------
-- (1) Los hermanos de un REC
-- ---------------------------------------------------------------------------
create or replace function public.albarans_germans_rec(p_rec uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id
    from albaranes a
    join albaranes b on b.tipo in ('ENT', 'OPE')
   where a.id = p_rec and a.tipo = 'REC'
     and ((a.excedente_id  is not null and b.excedente_id = a.excedente_id)
       or (a.espigolada_id is not null and b.excedente_id in
             (select ex.id from excedentes ex where ex.espigolada_id = a.espigolada_id)));
$$;
comment on function public.albarans_germans_rec(uuid) is
  'Los ENT/OPE que cuelgan de un REC (mismo excedente o misma espigolada). Misma condicion que propuesta_conciliacion(). Interna (20270414100100).';
revoke execute on function public.albarans_germans_rec(uuid) from public, anon, authenticated;
grant  execute on function public.albarans_germans_rec(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- (2) conciliar_albaran(): la cascada desde el REC
-- ---------------------------------------------------------------------------
create or replace function public.conciliar_albaran(p_id uuid, p_kg_validados jsonb default null::jsonb,
                                                    p_motivo text default null::text,
                                                    p_destino_final text default null::text)
returns albaranes
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  a        albaranes%rowtype;
  par      parametros_documentales%rowtype;
  k        jsonb;
  v_total  numeric;
  v_coste  numeric;
  v_prod   text;
  v_prop   jsonb;
  b        record;
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

  -- Un REC fuera de tolerancia se concilia, pero con motivo: arrastra sus salidas.
  if a.tipo = 'REC' then
    v_prop := public.propuesta_conciliacion(a.id);
    if not coalesce((v_prop->>'dins_tolerancia')::boolean, true)
       and coalesce(btrim(p_motivo), '') = '' then
      raise exception 'fora_de_tolerancia: la diferencia (% %%) supera la tolerancia (% %%); cal un motiu per conciliar',
        v_prop->>'diferencia_pct', v_prop->>'tolerancia_pct' using errcode = '22023';
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
  -- intenta una última vez: el de la oferta y, si no, la referencia del producto
  -- (20270405100200). Si tampoco está, se queda null y **bloquea el cierre**.
  if a.canalizacion_id is not null then
    select e.producto into v_prod
      from excedentes e join canalizaciones c on c.excedente_id = e.id
     where c.id = a.canalizacion_id;
    select c.coste_kg into v_coste from canalizaciones c where c.id = a.canalizacion_id;
    if v_coste is null and v_prod is not null then
      select coalesce(e.coste_kg, (select cp.coste_kg from costes_producto cp
                                    where cp.producto = e.producto))
        into v_coste
        from excedentes e join canalizaciones c on c.excedente_id = e.id
       where c.id = a.canalizacion_id;
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

  -- La cascada: las salidas confirmadas de este REC. Solo desde un REC, así que la llamada
  -- de dentro (un ENT/OPE) no vuelve a entrar aquí.
  if a.tipo = 'REC' then
    for b in
      select s.id from albaranes s
       where s.id in (select public.albarans_germans_rec(a.id))
         and s.estado = 'confirmado'
       order by s.created_at
    loop
      perform public.conciliar_albaran(
        b.id, null,
        coalesce(nullif(btrim(p_motivo), ''),
                 'Conciliat amb l''albara de recepcio ' || coalesce(a.numero_completo, a.id::text)),
        null);
    end loop;
  end if;

  return a;
end;
$function$;

revoke execute on function public.conciliar_albaran(uuid, jsonb, text, text) from public, anon;
grant  execute on function public.conciliar_albaran(uuid, jsonb, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- (3) conciliacions_automatiques(): ya no depende de que el REC siga `confirmado`
-- ---------------------------------------------------------------------------
create or replace function public.conciliacions_automatiques()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  rec  record;
  b    record;
  prop jsonb;
  n    integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'Nomes el servidor concilia automaticament' using errcode = '42501';
  end if;

  -- 1. REC confirmado con todas sus salidas confirmadas (o ya cerradas), dentro de
  --    tolerancia. `conciliar_albaran()` concilia el REC y arrastra las salidas.
  for rec in
    select a.id
      from albaranes a
     where a.tipo = 'REC' and a.estado = 'confirmado'
       and not exists (
         select 1 from albaranes s
          where s.id in (select public.albarans_germans_rec(a.id))
            and s.estado not in ('confirmado', 'anulado', 'rectificado', 'conciliado'))
       and exists (
         select 1 from albaranes s
          where s.id in (select public.albarans_germans_rec(a.id))
            and s.estado = 'confirmado')
  loop
    begin
      prop := public.propuesta_conciliacion(rec.id);
      if coalesce((prop->>'dins_tolerancia')::boolean, false) then
        perform public.conciliar_albaran(rec.id, null, 'conciliacio automatica (dins de tolerancia)', null);
        n := n + 1;
      end if;
    exception when others then
      raise warning 'conciliacions_automatiques: REC %: %', rec.id, sqlerrm;
    end;
  end loop;

  -- 2. Salidas confirmadas cuyo REC ya está conciliado (el equipo lo concilió antes de que
  --    confirmaran, o confirmaron tarde). Sin esta rama se quedaban sin conciliar para
  --    siempre y el cierre las bloqueaba.
  for b in
    select s.id, a.numero_completo as rec_num
      from albaranes a
      join albaranes s on s.id in (select public.albarans_germans_rec(a.id))
     where a.tipo = 'REC' and a.estado = 'conciliado'
       and s.estado = 'confirmado'
  loop
    begin
      perform public.conciliar_albaran(
        b.id, null,
        'conciliacio automatica (recepcio ' || coalesce(b.rec_num, '?') || ' ja conciliada)', null);
      n := n + 1;
    exception when others then
      raise warning 'conciliacions_automatiques: sortida %: %', b.id, sqlerrm;
    end;
  end loop;

  -- 3. OPE confirmado sin REC vivo en su excedente: venta o maquila puras. Un OPE
  --    `confirmado` ya lo han confirmado todas las partes con enlace (20270414100000).
  --    Si el excedente sí tiene REC (oferta con varias modalidades), espera a las ramas 1-2.
  for b in
    select a.id from albaranes a
     where a.tipo = 'OPE' and a.estado = 'confirmado'
       and not exists (
         select 1 from albaranes r
          where r.tipo = 'REC' and r.excedente_id = a.excedente_id
            and r.estado not in ('anulado', 'rectificado'))
  loop
    begin
      perform public.conciliar_albaran(b.id, null, 'conciliacio automatica (confirmat per totes les parts)', null);
      n := n + 1;
    exception when others then
      raise warning 'conciliacions_automatiques: OPE %: %', b.id, sqlerrm;
    end;
  end loop;

  return n;
end;
$function$;

revoke execute on function public.conciliacions_automatiques() from public, anon, authenticated;
grant  execute on function public.conciliacions_automatiques() to service_role;
