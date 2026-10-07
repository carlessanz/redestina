-- ---------------------------------------------------------------------------
-- El interés de una entidad, registrado con acompañamiento del equipo
-- ---------------------------------------------------------------------------
-- El equipo ya podía dejar una fila en `oferta_respuestas` — pero solo por ATAJO: un
-- `upsert` a pelo desde `OfferDetail.tsx:273-288` y un `update` a `acceptada` en `:291-297`.
-- Ese camino se salta las tres comprobaciones que `manifestar_interes()` sí hace:
--   · que la oferta siga `publicada`/`parcial`,
--   · que el tipo de receptor encaje con la modalidad (`modalitat_receptor_compat`),
--   · y el precio mínimo en venda/maquila.
-- Un lote nacido así se ve idéntico en el listado y llega hasta el certificado sin que
-- nada haya fallado. Esto le da al equipo la puerta buena.
--
-- ⚠️ ES UNA FUNCIÓN NUEVA, NO SE RELAJA `manifestar_interes()`. Una sola función con dos
--    regímenes de autorización —«o eres de esa entidad, o eres del equipo»— es justo
--    donde se esconde el fallo el día que alguien toque la guarda. Dos funciones, dos
--    guardas, cada una legible por separado.

-- `canal` gana 'asistido'. Mismo patrón que 20270318100000:49-59 con 'panel'.
alter table oferta_respuestas drop constraint if exists oferta_respuestas_canal_check;
alter table oferta_respuestas add constraint oferta_respuestas_canal_check
  check (canal in ('whatsapp', 'email', 'panel', 'asistido'));

create or replace function public.manifestar_interes_assistit(
  p_excedente uuid,
  p_entidad   uuid,
  p_kg        numeric,
  p_preu      numeric default null,
  p_caixes    int default null
)
returns oferta_respuestas
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ex   excedentes;
  fila oferta_respuestas;
  tel  text;
begin
  -- La única diferencia con `manifestar_interes()`: quién puede. `service_role` pasa
  -- (auth.uid() null), como en el resto del circuito documental.
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip pot registrar un interes assistit' using errcode = '42501';
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

  if p_kg is null or p_kg <= 0 then
    raise exception 'Cal indicar quants kg' using errcode = '22023';
  end if;

  if ex.modalitat in ('venda', 'maquila') and ex.preu_minim is not null
     and (p_preu is null or p_preu < ex.preu_minim) then
    raise exception 'El preu ha de ser com a minim % EUR/kg', ex.preu_minim using errcode = '22023';
  end if;

  select telefono into tel from entidades where id = p_entidad;

  insert into oferta_respuestas (
    excedente_id, entidad_id, telefono, canal, estado,
    kg_solicitados, caixes_solicitades, preu_ofert, respondido_at
  ) values (
    p_excedente, p_entidad, tel, 'asistido', 'acceptada',
    p_kg, p_caixes, p_preu, now()
  )
  on conflict (excedente_id, entidad_id) do update
     set estado             = 'acceptada',
         canal              = 'asistido',
         kg_solicitados     = excluded.kg_solicitados,
         caixes_solicitades = excluded.caixes_solicitades,
         preu_ofert         = excluded.preu_ofert,
         respondido_at      = now()
   where oferta_respuestas.aprovacio = 'pendent'
  returning * into fila;

  if fila.id is null then
    raise exception 'Aquesta resposta ja esta resolta' using errcode = '22023';
  end if;
  return fila;
end;
$$;

revoke execute on function public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, int)
  from public, anon;
grant  execute on function public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, int)
  to authenticated, service_role;

comment on function public.manifestar_interes_assistit(uuid, uuid, numeric, numeric, int) is
  'Registra l''interes d''una entitat conduit per l''equip (canal asistido). Mateixes comprovacions que manifestar_interes(); l''unica diferencia es la guarda: es_intern() en lloc de mis_entidades().';
