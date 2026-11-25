-- Las jornadas de espigolada ABIERTAS que todavía no han movido nada vuelven al circuito normal
-- (fase 3 del plan de noviembre de 2026; procesos 3.6 y 3.5 C).
--
-- Con el módulo retirado (20270617100100), una jornada `oberta` ya no la puede repartir nadie
-- desde el panel. Las que no han movido nada se deshacen: su oferta pasa a ser una oferta de
-- donación con `tipus_operacio = 'espigolada'` (la marca `espigolada_demanada`) y sigue el
-- circuito de cualquier donación. Las que ya movieron algo se quedan como estaban, HEREDADAS y
-- dormidas (deuda 192): sus ramas `espigolada_id` siguen funcionando para ellas.
--
-- Una jornada se DESHACE si cumple todo esto:
--   · está `oberta`;
--   · su productor es una ficha `es_test` (en producción, a 25-11-2026, todas lo son: el vaciado
--     del 20-11 dejó solo fichas de prueba). Si alguna fuera de una ficha REAL, NO se toca y se
--     avisa con `raise notice`: esa decisión no la toma una migración;
--   · ninguna de sus ofertas tiene canalizaciones (ni anuladas: una anulada pudo dejar su ENT);
--   · ningún albarán de la jornada ni de sus ofertas tiene número (`numero_completo`): lo emitido
--     no se borra ni se reescribe;
--   · ningún documento cuelga de esos albaranes.
--
-- Y deshacerla es:
--   · cada oferta: `espigolada_id = null`, `espigolada_demanada = true`, `producte_al_camp = true`,
--     `modalitat = 'donacio'` / `modalitats = {donacio}` (el check `excedentes_espigolada_donacio`),
--     `origen` = 'asistido' si era 'espigolament' (la conversión la hizo siempre el equipo, y
--     'espigolament' activa excepciones del modelo heredado, como emitir el albarán sin validar la
--     recogida), y `estado` = 'publicada' si estaba en 'borrador' (las `no_colocada`, `cancelada`
--     o `cerrada` se quedan como están);
--   · borrar los albaranes en `borrador` sin número de la jornada (el REC de jornada) y sus líneas
--     (`on delete cascade`); `trg_albaranes_no_esborrar` deja borrar un borrador;
--   · la jornada, `tancada` (no se borra: guarda `oferta_origen_id` como rastro).
--
-- En el clon (25-11-2026) hay dos jornadas, las dos de fichas `es_test` y las dos se quedan como
-- heredadas: una ya `tancada` y otra `oberta` con su REC emitido (REC-2026-00025). En producción, las
-- tres `oberta` se resuelven así (el resultado exacto lo imprime el `raise notice` de cada una):
--   · E-261120-OFE-ALB-1 (`parcial`, 1 canalización) → heredada, sin tocar.
--   · E-261120-OFE-BLE-1 (`no_colocada`, 0 canalizaciones, 1 albarán) y E-261124-SEB-MAG-1
--     (`borrador`, 0 canalizaciones, 1 albarán) → se deshacen si su albarán es el REC de jornada en
--     `borrador` sin número (BLE se queda `no_colocada`; MAG pasa a `publicada`); si ese albarán ya
--     tiene número, heredadas sin tocar.
--
-- Idempotente: una segunda pasada no encuentra ninguna jornada `oberta` deshacible.

do $$
declare
  j        record;
  v_ofs    uuid[];
  v_albs   uuid[];
  v_motiu  text;
  v_n_alb  int;
  v_n_of   int;
begin
  for j in
    select e.id, e.productor_id, coalesce(p.es_test, false) as es_test,
           coalesce(p.empresa, p.name) as nom
      from public.espigoladas e
      left join public.productores p on p.id = e.productor_id
     where e.estado = 'oberta'
     order by e.created_at
  loop
    select coalesce(array_agg(x.id), '{}') into v_ofs
      from public.excedentes x where x.espigolada_id = j.id;

    select coalesce(array_agg(a.id), '{}') into v_albs
      from public.albaranes a
     where a.espigolada_id = j.id or a.excedente_id = any(v_ofs);

    v_motiu := case
      when not j.es_test then 'fitxa real (no es_test)'
      when exists (select 1 from public.canalizaciones c where c.excedente_id = any(v_ofs))
        then 'te canalitzacions'
      when exists (select 1 from public.albaranes a
                    where a.id = any(v_albs) and a.numero_completo is not null)
        then 'te albarans amb numero'
      when exists (select 1 from public.albaranes a
                    where a.id = any(v_albs) and a.estado <> 'borrador' and a.estado <> 'anulado')
        then 'te albarans fora d''esborrany'
      when exists (select 1 from public.documentos d
                    where d.objeto_id = any(v_albs))
        then 'te documents'
      else null end;

    if v_motiu is not null then
      raise notice 'espigolada % (%; ofertes %): es queda HERETADA, sense tocar: %',
        j.id, j.nom, (select string_agg(x.id_excedente, ', ') from public.excedentes x where x.id = any(v_ofs)),
        v_motiu;
      continue;
    end if;

    -- El REC de jornada (y cualquier otro borrador sin número de la jornada), con sus líneas.
    delete from public.albaranes a
     where a.id = any(v_albs) and a.estado = 'borrador' and a.numero_completo is null;
    get diagnostics v_n_alb = row_count;

    update public.excedentes x
       set espigolada_id       = null,
           espigolada_demanada = true,
           producte_al_camp    = true,
           modalitat           = 'donacio',
           modalitats          = array['donacio']::text[],
           origen              = case when x.origen = 'espigolament' then 'asistido' else x.origen end,
           estado              = case when x.estado = 'borrador' then 'publicada' else x.estado end
     where x.id = any(v_ofs);
    get diagnostics v_n_of = row_count;

    update public.espigoladas set estado = 'tancada' where id = j.id;

    raise notice 'espigolada % (%): DESFETA — % oferta(es) al circuit de donacio (%), % albara(ns) esborrany esborrat(s)',
      j.id, j.nom, v_n_of,
      (select string_agg(x.id_excedente || ' ' || x.estado, ', ') from public.excedentes x where x.id = any(v_ofs)),
      v_n_alb;
  end loop;
end;
$$;
