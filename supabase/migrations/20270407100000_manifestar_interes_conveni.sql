-- «M'interessa» comprueba el convenio que exige la MODALIDAD de la oferta (28-09-2026).
--
-- Desde 20270330100000 una entidad social ve también ofertas de venta y maquila, que exigen
-- el convenio `com` a quien recibe (`convenios_exigidos`). Pero `manifestar_interes()` no
-- miraba ningún convenio: con solo el `don_rec` vigente, la entidad mostraba interés, el
-- panel le decía «Interès enviat» y el equipo se chocaba con `42501 sense_conveni` al
-- aprobar (`aprovar_resposta()`), sin que la entidad llegara a saber nunca por qué.
-- AGENTS §4bis ya afirmaba que la base rechazaba «M'interessa» sin convenio; no era cierto.
--
-- Ahora llama a `exigir_convenio('entidad', …, modalitat, 'recibe')`, el mismo que usa
-- `aprovar_resposta()`: antes de la fecha de corte solo avisa (y el aviso no se devuelve,
-- la fila es el resultado), desde la fecha de corte rechaza con `42501 sense_conveni`.
--
-- Y de paso, un tope: no se pueden pedir más kilos de los que tiene la oferta. Los que
-- quedan por asignar los decide el equipo al aprobar (ahí sí hay aviso de «canalitzar de
-- més»); aquí solo se corta lo que no puede ser en ningún caso.
--
-- ⚠️ `manifestar_interes_assistit()` NO cambia: la conduce el equipo, que resuelve el
--    convenio en la fase 4 del ciclo guiado con la persona delante (§6ter).
-- ⚠️ Misma firma, así que `create or replace` conserva los GRANT (authenticated EXECUTE).

create or replace function public.manifestar_interes(
  p_excedente uuid, p_entidad uuid, p_kg numeric,
  p_preu numeric default null, p_caixes integer default null
)
returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  ex   excedentes;
  fila oferta_respuestas;
  tel  text;
begin
  if p_entidad not in (select public.mis_entidades()) then
    raise exception 'No pertanys a aquesta entitat' using errcode = '42501';
  end if;

  select * into ex from excedentes where id = p_excedente;
  if ex.id is null or ex.estado not in ('publicada', 'parcial') then
    raise exception 'Aquesta oferta ja no esta disponible' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from entidades e
      join modalitat_receptor_compat c on c.tipo_receptor = e.tipo_receptor
     where e.id = p_entidad and c.modalitat = ex.modalitat
  ) then
    raise exception 'Aquesta oferta no encaixa amb el tipus de receptor' using errcode = '22023';
  end if;

  -- El convenio que pide ESTA modalidad a quien recibe. Desde la fecha de corte, 42501.
  perform public.exigir_convenio('entidad', p_entidad, ex.modalitat, 'recibe');

  if p_kg is null or p_kg <= 0 then
    raise exception 'Cal indicar quants kg' using errcode = '22023';
  end if;

  if ex.kg_total is not null and p_kg > ex.kg_total then
    raise exception 'kg_maxim: com a maxim % kg', ex.kg_total using errcode = '22023';
  end if;

  -- En venda/maquila el preu mínimo lo fija el productor en el intake (§6bis).
  if ex.modalitat in ('venda', 'maquila') and ex.preu_minim is not null
     and (p_preu is null or p_preu < ex.preu_minim) then
    raise exception 'El preu ha de ser com a minim % EUR/kg', ex.preu_minim using errcode = '22023';
  end if;

  select telefono into tel from entidades where id = p_entidad;

  -- Upsert sobre unique(excedente_id, entidad_id): si el equipo ya le había enviado la
  -- oferta, se actualiza esa fila en vez de duplicarla.
  insert into oferta_respuestas (
    excedente_id, entidad_id, telefono, canal, estado,
    kg_solicitados, caixes_solicitades, preu_ofert, respondido_at
  ) values (
    p_excedente, p_entidad, tel, 'panel', 'acceptada',
    p_kg, p_caixes, p_preu, now()
  )
  on conflict (excedente_id, entidad_id) do update
     set estado             = 'acceptada',
         canal              = 'panel',
         kg_solicitados     = excluded.kg_solicitados,
         caixes_solicitades = excluded.caixes_solicitades,
         preu_ofert         = excluded.preu_ofert,
         respondido_at      = now()
   where oferta_respuestas.aprovacio = 'pendent'   -- lo ya resuelto no se toca
  returning * into fila;

  if fila.id is null then
    raise exception 'Aquesta resposta ja esta resolta' using errcode = '22023';
  end if;
  return fila;
end;
$function$;
