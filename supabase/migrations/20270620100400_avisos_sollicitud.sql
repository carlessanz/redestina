-- Ofertas multiproducto (proceso 3.3; fase 6 del plan de noviembre de 2026), 5 de 7: UN SOLO
-- AVISO por solicitud.
--
-- Resolver una solicitud de N productos pasa por N aprobaciones o rechazos de las puertas de
-- siempre (`aprova_resposta_intern`, `assignar_directe`, el rechazo por UPDATE), y cada una
-- dispara su aviso por línea (`trg_respostes_avis`: `interes_aprovat` y `sortida_trobada` al
-- aprobar, `interes_rebutjat` al rechazar). Para no mandar N correos/WhatsApp por una sola
-- respuesta del equipo:
--
--   · marca de transacción `redestina.agrupa_sollicitud = 'on'`: mientras está puesta,
--     `crear_avis()` NO crea esos tres tipos (devuelve null). La ponen y la quitan solo
--     `resoldre_sollicitud` y `assignar_directe_multiple` (20270620100500). Los demás avisos
--     (anulación, cambios de fecha o kg…) no se tocan.
--   · tipo nuevo `sollicitud_resolta` (en el CHECK de `avisos.tipus`) con objeto nuevo
--     `sollicitud_recollida` (en el CHECK de `avisos.objecte_tipo`). Al final de la RPC se crea
--     UNO para la entidad (todas las líneas, aprobadas y rechazadas) y, si hay alguna aprobada, UNO
--     para el productor (solo las aprobadas). Forma de `params`, para `enviar-avis` y la campana:
--       entidad:   {sollicitud_id, disponibilitat_id, codi, productor, municipi, recollida_at,
--                   n_aprovades, n_rebutjades,
--                   linies: [{resposta_id, excedente_id, producte, kg_sol, kg_apr, modalitat,
--                             estat: 'aprovada'|'rebutjada', motiu}]}
--       productor: {sollicitud_id, disponibilitat_id, codi, entitat, recollida_at, n_aprovades,
--                   linies: [{excedente_id, ref, producte, kg, modalitat}]}
--
-- La marca `redestina.registre_posteriori` (20270619100100) sigue mandando: con ella no se crea
-- ningún aviso.

-- ---------------------------------------------------------------------------
-- 1. Los CHECK de `avisos` (tabla con datos: not valid + validate)
-- ---------------------------------------------------------------------------
alter table public.avisos drop constraint if exists avisos_tipus_check;
alter table public.avisos add constraint avisos_tipus_check check (tipus = any (array[
  'oferta_validada', 'oferta_rebutjada', 'sortida_trobada', 'interes_aprovat', 'interes_rebutjat',
  'oferta_sense_desti', 'recollida_canviada', 'kg_assignats_canviats', 'recollida_confirmada',
  'oferta_modificada', 'oferta_enviada', 'certificat_per_revisar', 'recollida_per_registrar',
  'recollida_retornada', 'document_signat', 'assignacio_anulada', 'canvis_proposats',
  -- 20270620100400 (fase 6, 3.3)
  'sollicitud_resolta'])) not valid;
alter table public.avisos validate constraint avisos_tipus_check;

alter table public.avisos drop constraint if exists avisos_objecte_tipo_check;
alter table public.avisos add constraint avisos_objecte_tipo_check check (objecte_tipo = any (array[
  'excedente', 'oferta_resposta', 'canalizacion', 'cierre_donante', 'cierre_periodo', 'documento',
  -- 20270620100400 (fase 6, 3.3)
  'sollicitud_recollida'])) not valid;
alter table public.avisos validate constraint avisos_objecte_tipo_check;

-- ---------------------------------------------------------------------------
-- 2. `crear_avis()` con la marca de agrupación (misma firma: conserva los privilegios)
-- ---------------------------------------------------------------------------
create or replace function public.crear_avis(
  p_destinatari_tipo text, p_destinatari_id uuid, p_tipus text, p_objecte_tipo text,
  p_objecte_id uuid, p_params jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_destinatari_id is null then return null; end if;
  -- 20270619100100: una operación registrada a posteriori no se cuenta a nadie (ya pasó).
  if coalesce(current_setting('redestina.registre_posteriori', true), '') = 'on' then
    return null;
  end if;
  -- 20270620100400: dentro de una solicitud multiproducto, los avisos por línea se sustituyen por
  -- uno solo (`sollicitud_resolta`) que crea la propia RPC al final.
  if coalesce(current_setting('redestina.agrupa_sollicitud', true), '') = 'on'
     and p_tipus in ('interes_aprovat', 'interes_rebutjat', 'sortida_trobada') then
    return null;
  end if;
  insert into avisos (destinatari_tipo, destinatari_id, tipus, objecte_tipo, objecte_id, params)
  values (p_destinatari_tipo, p_destinatari_id, p_tipus, p_objecte_tipo, p_objecte_id,
          coalesce(p_params, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
