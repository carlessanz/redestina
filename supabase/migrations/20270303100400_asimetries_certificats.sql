-- Tres cosas que el circuito de certificados tenía descuadradas, y la regla que ata el
-- certificado a demanda con el anual.
--
-- 1. **El anual manda: al emitirlo, los parciales se apagan.** Es la regla de
--    no-doble-conteo del certificado a demanda, y vive aquí porque el sitio donde se
--    aplica es la emisión del anual. Sin esto, un donante podría tener a la vez un
--    `CDP-2026-0003` por 8.000 kg y un `CD-2026-0012` por 12.000 kg que ya incluye
--    aquellos: dos papeles vigentes, con el mismo efecto fiscal, y nada que diga cuál
--    vale. `datos_182()` **sigue leyendo solo el cierre anual**, así que la gestoría nunca
--    ve una fila de más; lo que faltaba era apagar el papel.
--
-- 2. **`emitir_certificado()` no comprobaba `cierres_ejercicio.estado = 'declarat'`.**
--    `emitir_resumen()` sí (`20261109100100:746`) y `rectificar_certificado()` también
--    (`:1104`): las tres tocan documentos del mismo ejercicio, y la única que dejaba
--    emitir después de que la gestoría hubiera presentado el 182 era justamente la que
--    emite el documento que va en esa declaración. No era alcanzable por accidente
--    —`marcar_declarado()` deja a los donantes en `declarat` y el certificado ya estaría
--    emitido—, pero un donante añadido a mano después caía por el hueco.
--
-- 3. **No existía `rectificar_certificado_transaccion()`.** El CD tiene rectificación
--    porque el modelo 182 la exige; el CT quedó sin ella a propósito, y el precio estaba
--    anotado (deuda §12.86): un certificado de transacción con un error no tenía salida
--    ninguna. Se le da la misma que al CD —versión siguiente del mismo número, la anterior
--    deja de ser vigente— sin inventar ninguna serie `R-CT`: eso sí sería fingir un
--    circuito que no existe.

-- ---------------------------------------------------------------------------
-- 1. emitir_certificado(): la guarda que faltaba y la sustitución de los parciales
-- ---------------------------------------------------------------------------
create or replace function public.emitir_certificado(
  p_cd              uuid,
  p_motivo_excepcion text default null
) returns jsonb
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
  v_parc  int := 0;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  if cd.id is null then
    raise exception 'Aquest donant no es d''un tancament' using errcode = '22023';
  end if;
  if cd.tipo <> 'donacio' then
    raise exception 'Aquest acumulat es de transaccio: fes servir emitir_certificado_transaccion()'
      using errcode = '22023';
  end if;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  -- (0) Los datos de la Fundación tienen que ser los de verdad.
  if coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  -- (0bis) Después del 182 no se emite: se rectifica, y eso lo decide la gestoría (D10).
  --        Misma guarda que `emitir_resumen()` y `rectificar_certificado()`.
  if ce.estado = 'declarat' or cd.estado = 'declarat' then
    raise exception 'L''exercici ja esta declarat al 182: cap certificat nou sense parlar amb la gestoria (D10)'
      using errcode = '22023';
  end if;

  if cd.certificado_numero is not null then
    raise exception 'Aquest donant ja te el certificat % (fes servir rectificar_certificado)',
      cd.certificado_numero using errcode = '22023';
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

  -- (2) Factura coincidente, o la excepción de D4.
  if cd.estado <> 'coincident' then
    if auth.uid() is not null and not public.es_super_admin() then
      raise exception 'Sense factura coincident nomes el super_admin pot emetre el certificat'
        using errcode = '42501';
    end if;
    if coalesce(btrim(p_motivo_excepcion), '') = '' then
      raise exception 'L''excepcio sense factura coincident necessita motiu' using errcode = '22023';
    end if;
    update cierres_donante
       set excepcion_sin_factura = true,
           excepcion_motivo      = p_motivo_excepcion,
           excepcion_por         = auth.uid()
     where id = p_cd
    returning * into cd;
  end if;

  v_dest := public.cierre_destinatario(p_cd);

  v_serie := case when ce.modo = 'prueba' then 'P-CD' else 'CD' end;
  v_n := public.siguiente_numero(v_serie, ce.ejercicio);
  update cierres_donante
     set certificado_numero = public.formato_numero(v_serie, ce.ejercicio, v_n),
         certificado_at     = now(),        -- D14: la fecha del certificado es esta
         estado             = 'certificat_emes'
   where id = p_cd
  returning * into cd;

  v_doc := public.cierre_emet_document(
    p_cd, 'CD', 'definitiu',
    public.cierre_datos_certificado(p_cd),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', 'Certificat de donacio ' || ce.ejercicio::text || ' — ' || cd.certificado_numero,
      'plantilla', 'certificat_donacio'));

  -- (3) EL ANUAL MANDA. Los certificados a demanda del mismo donante, ejercicio y modo
  --     quedan sustituidos: lo que dice este documento incluye lo que decían ellos.
  --     `to_regclass` porque esta función es anterior a `cierres_periodo` y tiene que
  --     seguir funcionando en un entorno donde esa tabla todavía no exista.
  if to_regclass('public.cierres_periodo') is not null then
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
  end if;

  return jsonb_build_object('document', v_doc, 'numero', cd.certificado_numero,
                            'data', cd.certificado_at, 'import', cd.valor_total,
                            'kg', cd.kg_total, 'destinatari', v_dest,
                            'excepcio', cd.excepcion_sin_factura,
                            -- Cuántos certificados a demanda han quedado sustituidos.
                            'parcials_substituits', v_parc);
end;
$$;

comment on function public.emitir_certificado(uuid, text) is
  'Emite el certificado anual de donación. Sustituye los certificados a demanda del mismo donante y ejercicio: el anual manda.';

-- ---------------------------------------------------------------------------
-- 2. rectificar_certificado_transaccion()
-- ---------------------------------------------------------------------------
-- Gemela de `rectificar_certificado()` sobre una fila `tipo = 'transaccio'`. Sin el tramo
-- del 182 —un CT no se declara— y sin la excepción de D4, que aquí no existe porque no hay
-- factura que citar.
create or replace function public.rectificar_certificado_transaccion(p_cd uuid, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd     cierres_donante%rowtype;
  ce     cierres_ejercicio%rowtype;
  par    parametros_documentales%rowtype;
  v_doc  uuid;
  v_dest jsonb;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Una rectificacio necessita motiu' using errcode = '22023';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  if cd.id is null then
    raise exception 'Aquest generador no es d''un tancament' using errcode = '22023';
  end if;
  if cd.tipo <> 'transaccio' then
    raise exception 'Aquest acumulat es de donacio: fes servir rectificar_certificado()'
      using errcode = '22023';
  end if;
  if cd.certificado_numero is null then
    raise exception 'Aquest generador encara no te certificat' using errcode = '22023';
  end if;

  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;
  if coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat'
      using errcode = '42501';
  end if;

  update cierres_donante
     set rectificaciones = rectificaciones + 1,
         certificado_at  = now(),
         estado          = 'certificat_emes'
   where id = p_cd
  returning * into cd;

  v_dest := public.cierre_destinatario(p_cd);
  v_doc := public.cierre_emet_document(
    p_cd, 'CT', 'definitiu',
    public.cierre_datos_certificado_transaccion(p_cd)
      || jsonb_build_object('motiu_rectificacio', p_motivo),
    jsonb_build_object('destinatario', v_dest->>'email', 'nombre', v_dest->>'nom',
                       'forzado', v_dest->>'forcat', 'motiu_destinatari', v_dest->>'motiu',
                       'asunto', 'Certificat de transaccio RECTIFICAT ' || ce.ejercicio::text
                                 || ' — ' || cd.certificado_numero,
                       'plantilla', 'certificat_transaccio'));

  return jsonb_build_object('document', v_doc, 'numero', cd.certificado_numero,
                            'versio', cd.rectificaciones + 1, 'motiu', p_motivo);
end;
$$;

comment on function public.rectificar_certificado_transaccion(uuid, text) is
  'Versión siguiente de un certificado de transacción, con motivo. No consume número nuevo ni existe serie R-CT.';

-- ---------------------------------------------------------------------------
-- 3. EXECUTE
-- ---------------------------------------------------------------------------
-- `emitir_certificado` se recrea con `create or replace`: conserva sus privilegios.
revoke execute on function public.rectificar_certificado_transaccion(uuid, text) from public, anon;
grant  execute on function public.rectificar_certificado_transaccion(uuid, text) to authenticated, service_role;

-- Verificación:
--   select emitir_certificado('<cd>');   -- 'parcials_substituits' > 0 si el donante tenía CDP
--   select estado, sustituido_at from cierres_periodo where cierre_donante_id = '<cd>';
--   select rectificar_certificado_transaccion('<cd>', 'quilos corregits');
