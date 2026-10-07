-- 🔴 Tres funciones del convenio dejaban preguntar por una organización AJENA, y una de ellas
--    devolvía su NOMBRE: rompe D3 (al receptor no se le dice quién dona).
--
-- QUÉ PASABA (clon local, 07-10-2026, sesión de una RECEPTORA preguntando por Mas de Prova):
--
--   · `exigir_convenio('productor', <Mas de Prova>, 'venda', 'entrega')`
--       → 42501 «sense_conveni: Mas de Prova SCP no te conveni vigent (com) per a venda…».
--         Con el uuid de cualquier ficha, la respuesta trae su nombre comercial. Antes de la
--         fecha de corte sale igual, en el texto del aviso (`AVIS: <nombre> encara no…`).
--   · `convenio_vigente('productor', <Mas de Prova>, …)` → true/false: si esa organización
--         tiene firmado el convenio. Sin nombre, pero es un dato de otra organización.
--   · `organizacion_de('productor', <ficha>)` → el uuid de su organización: permite cruzar
--         las dos fichas del doble rol de un tercero.
--
-- Las tres son `security definer` con `grant execute … to authenticated` desde
-- `20270111100100:1395-1405`.
--
-- QUIÉN LAS LLAMA, que es lo que decide el arreglo de cada una (grep en `src/`, `scripts/`,
-- `supabase/functions/` y en las funciones SQL, 07-10-2026):
--
--   · `exigir_convenio()` (2 y 4 args): NINGUNA llamada desde el navegador. La usan
--     `aprovar_resposta()`, `manifestar_interes()` y `repartir_espigolada()` —todas
--     `security definer`, así que la ejecutan como propietario— y la Edge Function
--     `crear-oferta` (`_shared/oferta.ts:518`) con la clave secreta (`service_role`).
--     → `revoke … from authenticated`. Las llamadas internas no lo notan.
--   · `organizacion_de()`: ninguna llamada desde el navegador; la usan `convenio_vigente()`,
--     `actualizar_meu_canal()` y el trigger `trg_convenios_organitzacio()`, todas definer.
--     → `revoke … from authenticated`.
--   · `convenio_vigente()`: SÍ la llama el navegador —`src/lib/convenis.ts:262`
--     (`conveniVigent`), desde `aprovarResposta.ts`, o sea desde las pantallas del EQUIPO
--     (Aprovacions, OfferDetail, CanalitzacioDetall) para avisar antes de aprobar—. Revocarla
--     rompería ese aviso. → GUARDA DE PERTENENCIA: con sesión de usuario, o eres del equipo
--     o la ficha es tuya (`mis_productores()` / `mis_entidades()`); si no, 42501.
--     Sin sesión (`service_role`) pasa, el idioma de siempre (§4bis).
--
-- ⚠️ La guarda de `convenio_vigente()` se evalúa también cuando la llama otra función
--    `security definer` (`auth.uid()` sigue siendo el de la sesión), y por eso se comprobó
--    cada camino interno: `manifestar_interes()` solo pregunta por la entidad del propio
--    receptor (`perform exigir_convenio('entidad', p_entidad, …)` tras comprobar que
--    `p_entidad` es suya); `aprovar_resposta()` y `repartir_espigolada()` son del equipo. Ningún
--    camino de una cuenta externa pregunta por una organización ajena.
--
-- ⚠️ El mensaje de `exigir_convenio()` sigue llevando el nombre a propósito: ahora solo lo
--    puede ver el equipo (que ve todas las fichas) o el propio titular (por su ficha). No se
--    toca su cuerpo.

-- (1) exigir_convenio y organizacion_de: solo servidor y llamadas internas.
revoke execute on function public.exigir_convenio(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.exigir_convenio(text, uuid)             from public, anon, authenticated;
revoke execute on function public.organizacion_de(text, uuid)             from public, anon, authenticated;
grant execute on function public.exigir_convenio(text, uuid, text, text) to service_role;
grant execute on function public.exigir_convenio(text, uuid)             to service_role;
grant execute on function public.organizacion_de(text, uuid)             to service_role;

-- (2) convenio_vigente: guarda de pertenencia. Pasa a `plpgsql` para poder levantar la
--     excepción; el cálculo es literalmente el vigente (`20270312100000`), en `return`.
create or replace function public.convenio_vigente(
  p_tipo_org     text,
  p_org          uuid,
  p_valorizacion text,
  p_parte        text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_org is not null
     and auth.uid() is not null
     and not public.es_intern()
     and not (case p_tipo_org
                when 'productor' then p_org in (select public.mis_productores())
                when 'entidad'   then p_org in (select public.mis_entidades())
                else false
              end) then
    raise exception 'No pots consultar el conveni d''una altra organitzacio'
      using errcode = '42501';
  end if;

  return (
    select case
      when p_org is null then false
      when not exists (select 1 from convenios_exigidos ce
                        where ce.valorizacion = p_valorizacion and ce.parte = p_parte)
        then true
      else not exists (
        -- Falta alguno de los exigidos → no está cubierta.
        select 1
          from convenios_exigidos ce
         where ce.valorizacion = p_valorizacion
           and ce.parte        = p_parte
           and not exists (
             select 1 from convenios c
              where c.estado = 'vigent'
                and c.tipo   = ce.tipo_convenio
                -- Por organización: un convenio firmado con el otro papel de la MISMA
                -- organización también cuenta.
                and c.organizacion_id = public.organizacion_de(p_tipo_org, p_org)))
    end);
end;
$$;

revoke execute on function public.convenio_vigente(text, uuid, text, text) from public, anon;
grant execute on function public.convenio_vigente(text, uuid, text, text) to authenticated, service_role;

-- Verificación (clon local, sesión de receptora):
--   select exigir_convenio('productor', '<ajena>', 'venda', 'entrega');  -- 42501 (GRANT), sin nombre
--   select organizacion_de('productor', '<ajena>');                      -- 42501 (GRANT)
--   select convenio_vigente('productor', '<ajena>', 'donacio', 'entrega'); -- 42501 (guarda)
--   select convenio_vigente('entidad', '<la suya>', 'donacio', 'recibe');  -- true/false
--   técnico: convenio_vigente de cualquiera, como antes. manifestar_interes() y
--   aprovar_resposta() siguen avisando/bloqueando igual.
