-- Los datos provisionales de la Fundación solo bloquean el certificado REAL (21-09-2026).
--
-- QUÉ CAMBIA. Las siete RPC que emiten o rectifican un certificado —CD anual, CD de
-- periodo, CT de transacción, y la tanda `emitir_certificados_cierre()`— llevaban la misma
-- guarda:
--
--     if coalesce(par.datos_provisionales, true) then  raise ... errcode = '42501';
--
-- que se negaba a emitir NADA mientras `parametros_documentales.datos_provisionales` fuera
-- `true`. A partir de esta migración la guarda solo actúa cuando el acumulado es de
-- **modo real**:
--
--     if <modo> = 'real' and coalesce(par.datos_provisionales, true) then ...
--
-- No se toca ni una línea más de ninguna de las siete: mismo cuerpo, misma firma, mismas
-- guardas, mismo orden.
--
-- POR QUÉ. `datos_provisionales` está hoy en `true` y lo seguirá estando hasta que la
-- Fundació entregue sus datos fiscales reales —razón social, CIF válido, domicilio,
-- inscripción, los datos de la apoderada y los PNG de firma y sello—, que es material de la
-- fase 0 y no depende de este repositorio (§12.10). Mientras tanto, la guarda bloqueaba
-- **también los certificados de prueba**, así que el último escalón del ciclo —el de la
-- `Guía de prueba — ciclo completo asistido.md`— no se podía recorrer nunca: ni en la demo,
-- ni al validar una migración, ni al enseñar el producto. Decisión del cliente del
-- 21-09-2026: en modo prueba, se emite.
--
-- POR QUÉ ES SEGURO, y es lo único que hay que creerse aquí. Un documento con
-- `documentos.modo = 'prueba'` no puede llegar a un donante real, y no por una comprobación
-- sino por tres que ya existen y que esta migración no toca:
--
--   1. **El modo vive en el dato** (§4). La serie lleva prefijo `P-` —`P-CD`, `P-CDP`,
--      `P-CT`—, así que el número no sale de la serie legal y el 182 no lo ve.
--   2. **Marca de agua**. El renderizador estampa «PROVA» girada sobre cada página, y el
--      snapshot sigue llevando `dades_provisionals`: el PDF dice lo que es, impreso.
--   3. **`destinatariosPrueba`** (`_shared/gate.ts`): con `modo = 'prueba'` solo pasan las
--      direcciones de una organización `es_test` y el buzón
--      `parametros_documentales.email_equipo`, **aunque `test_mode` esté apagado**. Es la
--      segunda barrera; la primera es `cierre_destinatario()`, que ya elige a quién se
--      escribe. Ninguna de las dos se relaja aquí.
--
-- Y el modo de un cierre no se elige a mano en la pantalla: se deduce de `es_test` de la
-- ficha (§6ter), justamente para que nadie pueda marcar «prueba» sobre un donante real ni
-- al revés.
--
-- ⚠️ ESTO NO BASTA SOLO: EL FRONTEND TIENE SU PROPIA MITAD, Y LAS DOS VAN JUNTAS. La
--    interfaz apagaba los botones de certificado mirando **solo** `datos_provisionales`, sin
--    mirar el modo, en cuatro sitios: `CertificatsFitxa`, `DialegCertificatPeriode`,
--    `TancamentDetall` (la fila del donante y el botón «emet-los tots») y el paso
--    `certificat` de `passosCanalitzacio.ts`. Con esta migración aplicada y la interfaz sin
--    tocar, la base ya dejaría emitir en prueba pero nadie podría pulsar nada. Su
--    contrapartida es `bloquejaProvisionals(provisionals, mode)` en `src/lib/canalitzacio.ts`
--    —`provisionals && mode !== 'prueba'`—, que dice lo mismo que la guarda de aquí.
--
--    ⚠️ Con una asimetría deliberada que conviene no «corregir»: en TypeScript el modo puede
--       faltar (no hay ejercicio todavía) y entonces **bloquea**, igual que
--       `dadesFiscalsProvisionals()` responde `true` ante la duda. En SQL no puede faltar
--       —`modo` es `not null` con `check (modo in ('prueba','real'))`—, así que
--       `modo = 'real'` y `modo <> 'prueba'` son aquí la misma condición y se escribe la
--       primera, que es la que se lee como lo que quiere decir.
--
-- ⚠️ LAS SIETE SE RECREAN CON `create or replace` SOBRE LA MISMA FIRMA, así que conservan
--    sus privilegios: **no hay ni un GRANT ni un REVOKE en esta migración**, y no debe
--    haberlo. Cambiar un nombre de parámetro daría `42P13`; por eso cada una se copia de su
--    versión vigente tal cual, con `returns`, `language`, volatilidad, `security definer` y
--    `set search_path = public, pg_temp` idénticos.
--
-- DE DÓNDE SALE CADA COPIA (la versión vigente de cada función el 21-09-2026):
--   · emitir_certificado                 → 20260921211329_certificat_sense_factura.sql:41
--   · emitir_certificado_periodo         → 20260921211329_certificat_sense_factura.sql:176
--   · emitir_certificado_transaccion     → 20270301100100_certificado_transaccion.sql:552
--   · emitir_certificados_cierre         → 20260921211356_emitir_certificados_cierre.sql:24
--   · rectificar_certificado             → 20261109100100_rpc_cierre.sql:1076
--   · rectificar_certificado_periodo     → 20270303100300_rpc_certificat_periode.sql:655
--   · rectificar_certificado_transaccion → 20270303100400_asimetries_certificats.sql:172
--
-- QUÉ VARIABLE DE MODO USA CADA UNA. No es la misma en todas y no se puede suponer:
--   · las cuatro que cuelgan del cierre anual usan **`ce.modo`** (`cierres_ejercicio`),
--   · las dos de periodo usan **`cp.modo`** (`cierres_periodo` lleva su propio `modo`,
--     porque un certificado a demanda no abre cierre).
-- En las siete, la variable ya está cargada ANTES de la guarda: ninguna necesita un `select`
-- nuevo, que es lo que permite que el cambio sea exactamente un `if`.
--
-- ⚠️ Y UNA TRAMPA QUE HAY QUE DESCARTAR ANTES DE FIARSE DE ESTO: si la variable de modo
--    fuera NULL, `<modo> = 'real'` daría NULL, el `if` sería falso y la guarda se saltaría
--    **en silencio** — un fail-open justo en la comprobación que protege un documento con
--    efecto fiscal. No puede pasar, por dos cosas comprobadas y no supuestas:
--      · `cierres_ejercicio.modo` y `cierres_periodo.modo` son `not null` con
--        `check (modo in ('prueba', 'real'))`, así que una fila que exista tiene modo.
--      · En las siete, antes de llegar a la guarda ya ha cortado una comprobación de
--        existencia sobre la fila de la que sale el modo (`cd.id is null`, `cp.id is null`,
--        `ce.id is null`, o —en `rectificar_certificado`, que no comprueba `cd.id`— el
--        `certificado_numero is null`, que salta con 22023 para un uuid inexistente).
--        `cierres_donante.cierre_id` es además `not null references cierres_ejercicio(id)`,
--        así que un CD existente siempre tiene su `ce`.
--    Quien añada una octava función a esta familia tiene que repetir ese razonamiento: la
--    guarda solo es correcta si el modo no puede ser NULL cuando se evalúa.

-- ---------------------------------------------------------------------------
-- 1. emitir_certificado() — el certificado anual de donación
-- ---------------------------------------------------------------------------
-- Copia literal de 20260921211329_certificat_sense_factura.sql:41-162, con el único cambio
-- de la guarda (0). `ce` ya está cargada dos líneas más arriba, así que `ce.modo` está a
-- mano y no hace falta ningún `select` nuevo.
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

  -- (0) Para emitir en REAL, los datos de la Fundación tienen que ser los de verdad.
  --     En `modo = 'prueba'` NO bloquea: serie con prefijo `P-`, marca de agua y
  --     `destinatariosPrueba` (§8). Un certificado de ensayo no llega a un donante real.
  if ce.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat REAL. Omple Configuracio i desmarca datos_provisionales.',
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

  -- (2) AQUÍ IBA LA FACTURA, y ya no va. Decisión del cliente del 21-09-2026: el
  --     certificado se emite sin factura del donante. `p_motivo_excepcion` se acepta para
  --     no romper la firma —la llaman `src/lib/tancament.ts` y el arnés— y **se ignora**:
  --     `excepcion_sin_factura` no se vuelve a escribir desde aquí nunca más. Lo que
  --     guarden las filas antiguas es evidencia de cómo se emitieron ellas.

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
                            -- Se conserva la clave: hoy vale lo que ya valiera la fila.
                            'excepcio', cd.excepcion_sin_factura,
                            -- Cuántos certificados a demanda han quedado sustituidos.
                            'parcials_substituits', v_parc);
end;
$$;

comment on function public.emitir_certificado(uuid, text) is
  'Emite el certificado anual de donación. NO exige factura del donante (21-09-2026). Los datos provisionales de la Fundación solo lo bloquean en modo REAL (21-09-2026): en modo prueba se emite con serie P-CD y marca de agua. Sustituye los certificados a demanda del mismo donante y ejercicio.';

-- ---------------------------------------------------------------------------
-- 2. emitir_certificado_periodo() — el certificado a demanda
-- ---------------------------------------------------------------------------
-- Copia literal de 20260921211329_certificat_sense_factura.sql:176-291. ⚠️ Aquí el modo es
-- **`cp.modo`**, no `ce.modo`: `cierres_periodo` lleva su propio `modo` porque un
-- certificado a demanda NO cuelga de `cierres_ejercicio` (§4) — de hecho no abre cierre
-- ninguno, y menos el real. Usar aquí `ce` ni siquiera compilaría: esa variable no existe
-- en esta función.
create or replace function public.emitir_certificado_periodo(
  p_periodo          uuid,
  p_motivo_excepcion text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cp      cierres_periodo%rowtype;
  par     parametros_documentales%rowtype;
  v_serie text;
  v_n     int;
  v_dest  jsonb;
  v_doc   uuid;
  v_bloq  text;
  v_subs  int := 0;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet un certificat' using errcode = '42501';
  end if;

  select * into cp from cierres_periodo where id = p_periodo for update;
  if cp.id is null then
    raise exception 'Aquest certificat de periode no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  -- (0) Para emitir en REAL, los datos de la Fundación tienen que ser los de verdad.
  --     En `modo = 'prueba'` NO bloquea: serie con prefijo `P-`, marca de agua y
  --     `destinatariosPrueba` (§8). Un certificado de ensayo no llega a un donante real.
  if cp.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat REAL. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  if cp.certificado_numero is not null then
    raise exception 'Aquest periode ja te el certificat % (fes servir rectificar_certificado_periodo)',
      cp.certificado_numero using errcode = '22023';
  end if;
  if cp.calculado_at is null then
    raise exception 'Aquest periode no s''ha calculat encara' using errcode = '22023';
  end if;

  -- (1) Ningún bloqueo bloqueante. Aquí es donde siguen cortando
  --     `periode_parteix_excedent` y `periode_encavalcat`.
  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cp.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquest donant esta bloquejat: %', v_bloq using errcode = '22023';
  end if;

  if cp.kg_total <= 0 or cp.valor_total <= 0 then
    raise exception 'Un certificat de 0 quilos o 0 euros no te sentit' using errcode = '22023';
  end if;

  -- (2) El texto que dice que este certificado NO cubre el año natural entra por la
  --     plantilla `CD/parcial`: sin ella el PDF saldría con el cuerpo del certificado
  --     anual y afirmaría algo que no es cierto.
  if not exists (select 1 from plantillas_documento p
                  where p.tipo = 'CD' and p.variante = 'parcial' and p.vigente) then
    raise exception 'No hi ha cap plantilla CD/parcial vigent: sense ella el certificat no diria que es d''un periode'
      using errcode = '22023';
  end if;

  -- (3) AQUÍ IBA LA FACTURA, y ya no va (ver la cabecera de esta migración).
  --     `p_motivo_excepcion` se acepta y se ignora, igual que en el anual.

  v_dest := public.periodo_destinatario(p_periodo);

  v_serie := case when cp.modo = 'prueba' then 'P-CDP' else 'CDP' end;
  v_n := public.siguiente_numero(v_serie, cp.ejercicio);
  update cierres_periodo
     set certificado_numero = public.formato_numero(v_serie, cp.ejercicio, v_n),
         certificado_at     = now(),
         estado             = 'certificat_emes'
   where id = p_periodo
  returning * into cp;

  v_doc := public.periodo_emet_document(
    p_periodo,
    public.periodo_datos_certificado(p_periodo),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', 'Certificat de donacio (periode) ' || to_char(cp.periodo_desde, 'DD/MM/YYYY')
                || ' — ' || to_char(cp.periodo_hasta, 'DD/MM/YYYY') || ' · ' || cp.certificado_numero,
      'plantilla', 'certificat_donacio'));

  -- Los certificados anteriores del mismo donante CONTENIDOS en esta ventana quedan
  -- sustituidos: lo que este documento dice incluye lo que decían ellos, y dos papeles
  -- vigentes con kilos solapados es el doble conteo que hay que evitar.
  update cierres_periodo o
     set estado = 'substituit', sustituido_at = now(), sustituido_por_periodo = p_periodo
   where o.productor_id = cp.productor_id and o.modo = cp.modo
     and o.id <> p_periodo and o.certificado_numero is not null
     and o.estado <> 'substituit'
     and o.periodo_desde >= cp.periodo_desde and o.periodo_hasta <= cp.periodo_hasta;
  get diagnostics v_subs = row_count;

  update documentos d
     set vigente = false, sustituido_por = v_doc
   where d.objeto_tipo = 'cierre_periodo' and d.vigente and d.id <> v_doc
     and d.objeto_id in (select o.id from cierres_periodo o
                          where o.sustituido_por_periodo = p_periodo);

  return jsonb_build_object('document', v_doc, 'numero', cp.certificado_numero,
                            'data', cp.certificado_at, 'import', cp.valor_total,
                            'kg', cp.kg_total, 'destinatari', v_dest,
                            'periode', jsonb_build_object('des_de', cp.periodo_desde,
                                                          'fins_a', cp.periodo_hasta),
                            'substitueix', v_subs,
                            'excepcio', cp.excepcion_sin_factura);
end;
$$;

comment on function public.emitir_certificado_periodo(uuid, text) is
  'Emite el certificado de donación de una ventana. NO exige factura (21-09-2026); conserva plantilla CD/parcial vigente y los bloqueos de periodo. Los datos provisionales solo lo bloquean en modo REAL (21-09-2026).';

-- ---------------------------------------------------------------------------
-- 3. emitir_certificado_transaccion() — el CT de venta y maquila
-- ---------------------------------------------------------------------------
-- Copia literal de 20270301100100_certificado_transaccion.sql:552-631. Reutiliza el motor
-- del cierre anual, así que su modo es `ce.modo` y su serie de prueba es `P-CT`.
-- ⚠️ Esto es lo que desbloquea la deuda §12.85 por el lado de la prueba: el CT no tenía
--    ningún ensayo end-to-end posible porque el fixture deja `datos_provisionales = true`
--    y la guarda cortaba antes de generar ninguna fila de `documentos` de tipo CT.
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

  -- Como el CD: sin los datos reales de la Fundación no se emite nada EN REAL. En
  -- `modo = 'prueba'` NO bloquea: serie `P-CT`, marca de agua y `destinatariosPrueba`
  -- (§8). Un certificado de ensayo no llega a un generador real.
  if ce.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat REAL. Omple Configuracio i desmarca datos_provisionales.',
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

comment on function public.emitir_certificado_transaccion(uuid) is
  'Emite el certificado de transacción (venta o maquila), sin importes. Los datos provisionales de la Fundación solo lo bloquean en modo REAL (21-09-2026): en prueba usa la serie P-CT.';

-- ---------------------------------------------------------------------------
-- 4. emitir_certificados_cierre() — la tanda de un cierre
-- ---------------------------------------------------------------------------
-- Copia literal de 20260921211356_emitir_certificados_cierre.sql:24-138.
--
-- 🔴 EL ORDEN DE LAS CINCO GUARDAS NO SE HA MOVIDO, Y NO SE PUEDE MOVER. El arnés la
--    llama con el uuid de ceros para medir la guarda de ROL y espera que después caiga con
--    un error de NEGOCIO (`22023`, «aquest tancament no existeix»). La de provisionales
--    sigue siendo la (5), después de que el cierre exista, esté `tancat` y esté calculado;
--    si subiera de sitio, ese check pasaría a recibir `42501` y estaría midiendo otra cosa.
--    Sigue además **fuera del bucle**, por el motivo que ya explicaba: dentro daría N
--    donantes saltados con el mismo motivo y un informe que parece un problema de los
--    donantes cuando es de Configuració.
--
-- El `select * into par` se queda donde estaba, delante del `if`: lo único que cambia es
-- la condición. Y `emitir_certificado()` —que es quien emite de verdad, una por una— ya
-- trae su propia guarda relajada en la sección 1, así que la tanda no duplica ninguna
-- regla: sigue siendo cierto que aquí no se repite ni una guarda suya.
create or replace function public.emitir_certificados_cierre(p_cierre uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  ce        cierres_ejercicio%rowtype;
  par       parametros_documentales%rowtype;
  cd        record;
  v_bloq    text;
  v_emesos  int := 0;
  v_ja      int := 0;
  v_saltats jsonb := '[]'::jsonb;
  v_donant  text;
begin
  -- ⚠️ EL ORDEN DE ESTAS CINCO GUARDAS NO ES NEGOCIABLE. El arnés llama con un uuid
  --    inexistente para medir la guarda de ROL, y espera que después caiga con un error de
  --    NEGOCIO (22023). Si `datos_provisionales` se comprobara antes que la existencia del
  --    cierre, ese check pasaría a devolver 42501 y estaría midiendo otra cosa.

  -- (1) Rol. El idioma de siempre: `service_role` (sin `auth.uid()`) no se queda fuera.
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar emet certificats' using errcode = '42501';
  end if;

  -- (2) El cierre existe. `for update`: durante la tanda nadie lo cierra ni lo declara.
  select * into ce from cierres_ejercicio where id = p_cierre for update;
  if ce.id is null then
    raise exception 'Aquest tancament no existeix' using errcode = '22023';
  end if;

  -- (3) Solo sobre un ejercicio cerrado. Emitir en bloque sobre un cierre `obert` sería
  --     certificar una cifra que el siguiente `calcular_cierre()` puede cambiar; y sobre
  --     uno `declarat`, emitir después del 182, que ya rechaza `emitir_certificado()` uno
  --     a uno (D10). Los dos casos caen aquí con el mismo mensaje.
  if ce.estado <> 'tancat' then
    raise exception 'Nomes s''emeten en bloc els certificats d''un tancament tancat: tanca l''exercici primer (estat actual: %)',
      ce.estado using errcode = '22023';
  end if;

  -- (4) Y calculado: sin cálculo no hay acumulado que certificar.
  if ce.calculado_at is null then
    raise exception 'Aquest tancament no s''ha calculat encara' using errcode = '22023';
  end if;

  -- (5) Datos de la Fundación de verdad, y solo si el cierre es REAL (20260921214526: en
  --     modo prueba la tanda se puede ejercitar entera). **Fuera del bucle a propósito**,
  --     y SIN moverla de sitio: el arnés llama con un uuid inexistente y espera el 22023
  --     de la guarda (2); subirla convertiría ese check en un 42501. Dentro daría N
  --     donantes saltados con el mismo motivo y un informe que parece un problema de datos
  --     de los donantes cuando el problema es de Configuració.
  select * into par from parametros_documentales where id = 1;
  if ce.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat REAL. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  -- Los que ya tienen certificado no son un error ni un salto: son trabajo hecho. Se
  -- cuentan aparte para que el informe no los mezcle con los que no se han podido emitir.
  select count(*) into v_ja
    from cierres_donante
   where cierre_id = p_cierre and tipo = 'donacio' and certificado_numero is not null;

  for cd in select * from cierres_donante
             where cierre_id = p_cierre
               and tipo = 'donacio'
               and certificado_numero is null
             order by created_at
  loop
    v_donant := coalesce(cd.datos_fiscales->>'raó_social',
                         (select coalesce(p.empresa, p.name) from productores p
                           where p.id = cd.productor_id),
                         cd.productor_id::text);

    -- (a) Algún bloqueo que bloquea de verdad. Mismo criterio que `emitir_certificado()`.
    select string_agg(b->>'detall', '; ') into v_bloq
      from jsonb_array_elements(cd.bloqueos) b where (b->>'bloqueja')::boolean;
    if v_bloq is not null then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'bloquejat', 'motiu', v_bloq);
      continue;
    end if;

    -- (b) Sin kilos o sin valor: un certificado de 0 no tiene sentido.
    if cd.kg_total <= 0 or cd.valor_total <= 0 then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'sense_kg',
        'motiu', 'Sense quilos o sense valor (' || round(cd.kg_total, 1)::text || ' kg, '
                 || round(cd.valor_total, 2)::text || ' EUR)');
      continue;
    end if;

    -- (c) El resto lo decide `emitir_certificado()`, que es la única definición de «cómo
    --     se emite un certificado». Aquí no se duplica ni una guarda suya: si añade una
    --     mañana, esta tanda la respeta sola. `null` en el motivo porque desde el
    --     21-09-2026 ese parámetro se ignora (20260921211329).
    begin
      perform public.emitir_certificado(cd.id, null);
      v_emesos := v_emesos + 1;
    exception when others then
      -- El savepoint del subbloque devuelve a la serie el número que se hubiera
      -- consumido, así que un fallo aquí no deja hueco en CD / P-CD.
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'error', 'motiu', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'tancament', p_cierre,
    'exercici',  ce.ejercicio,
    'mode',      ce.modo,
    'emesos',    v_emesos,
    'ja_tenien', v_ja,
    'saltats',   v_saltats);
end;
$$;

comment on function public.emitir_certificados_cierre(uuid) is
  'Emite todos los certificados de donación pendientes de un cierre ya cerrado. La llama el panel, NUNCA el job de congelación: un certificado necesita una persona detrás. Los datos provisionales solo la bloquean si el cierre es REAL (21-09-2026).';

-- ---------------------------------------------------------------------------
-- 5. rectificar_certificado() — la versión siguiente del CD anual
-- ---------------------------------------------------------------------------
-- Copia literal de 20261109100100_rpc_cierre.sql:1076-1133.
-- ⚠️ Su mensaje es **más corto** que el de las tres `emitir_*`: no cita el CIF. No se
--    unifica aquí a propósito —esta migración cambia guardas, no textos— más allá de
--    matizar que ahora habla del modo real.
-- `ce` está cargada tres líneas antes de la guarda, junto a `cd` y `par`; y para cuando se
-- llega aquí ya han pasado las dos guardas que garantizan que el CD existe y tiene número,
-- así que `ce.modo` no puede ser NULL por una fila inexistente.
create or replace function public.rectificar_certificado(p_cd uuid, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cd    cierres_donante%rowtype;
  ce    cierres_ejercicio%rowtype;
  par   parametros_documentales%rowtype;
  v_doc uuid;
  v_dest jsonb;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Una rectificacio necessita motiu' using errcode = '22023';
  end if;

  select * into cd from cierres_donante where id = p_cd for update;
  select * into ce from cierres_ejercicio where id = cd.cierre_id;
  select * into par from parametros_documentales where id = 1;

  if cd.certificado_numero is null then
    raise exception 'Aquest donant encara no te certificat' using errcode = '22023';
  end if;
  if cd.estado = 'declarat' or ce.estado = 'declarat' then
    raise exception 'Despres del 182 la rectificacio la decideix la gestoria (D10)'
      using errcode = '22023';
  end if;
  -- Solo en REAL: una rectificación de prueba es parte del ensayo (20260921214526).
  if ce.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat REAL (en mode prova si que es pot)'
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
    p_cd, 'CD', 'definitiu',
    public.cierre_datos_certificado(p_cd) || jsonb_build_object('motiu_rectificacio', p_motivo),
    jsonb_build_object('destinatario', v_dest->>'email', 'nombre', v_dest->>'nom',
                       'forzado', v_dest->>'forcat', 'motiu_destinatari', v_dest->>'motiu',
                       'asunto', 'Certificat de donacio RECTIFICAT ' || ce.ejercicio::text
                                 || ' — ' || cd.certificado_numero,
                       'plantilla', 'certificat_donacio'));

  return jsonb_build_object('document', v_doc, 'numero', cd.certificado_numero,
                            'versio', cd.rectificaciones + 1, 'motiu', p_motivo);
end;
$$;

comment on function public.rectificar_certificado(uuid, text) is
  'Versión siguiente del certificado anual de donación, con motivo. No consume número nuevo. Los datos provisionales solo la bloquean en modo REAL (21-09-2026).';

-- ---------------------------------------------------------------------------
-- 6. rectificar_certificado_periodo() — la versión siguiente del CDP
-- ---------------------------------------------------------------------------
-- Copia literal de 20270303100300_rpc_certificat_periode.sql:655-719. Modo: **`cp.modo`**,
-- por lo mismo que la sección 2.
create or replace function public.rectificar_certificado_periodo(p_periodo uuid, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cp     cierres_periodo%rowtype;
  par    parametros_documentales%rowtype;
  v_doc  uuid;
  v_dest jsonb;
  v_bloq text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Una rectificacio necessita motiu' using errcode = '22023';
  end if;

  select * into cp from cierres_periodo where id = p_periodo for update;
  if cp.id is null then
    raise exception 'Aquest certificat de periode no existeix' using errcode = '22023';
  end if;
  if cp.certificado_numero is null then
    raise exception 'Aquest periode encara no te certificat' using errcode = '22023';
  end if;
  if cp.estado = 'substituit' then
    raise exception 'Aquest periode ja esta substituit: rectifica el certificat que el va substituir'
      using errcode = '22023';
  end if;

  select * into par from parametros_documentales where id = 1;
  -- Solo en REAL: una rectificación de prueba es parte del ensayo (20260921214526).
  if cp.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat REAL (en mode prova si que es pot)'
      using errcode = '42501';
  end if;

  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cp.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquest donant esta bloquejat: %', v_bloq using errcode = '22023';
  end if;

  update cierres_periodo
     set rectificaciones = rectificaciones + 1,
         certificado_at  = now(),
         estado          = 'certificat_emes'
   where id = p_periodo
  returning * into cp;

  v_dest := public.periodo_destinatario(p_periodo);
  v_doc := public.periodo_emet_document(
    p_periodo,
    public.periodo_datos_certificado(p_periodo) || jsonb_build_object('motiu_rectificacio', p_motivo),
    jsonb_build_object('destinatario', v_dest->>'email', 'nombre', v_dest->>'nom',
                       'forzado', v_dest->>'forcat', 'motiu_destinatari', v_dest->>'motiu',
                       'asunto', 'Certificat de donacio (periode) RECTIFICAT — ' || cp.certificado_numero,
                       'plantilla', 'certificat_donacio'));

  return jsonb_build_object('document', v_doc, 'numero', cp.certificado_numero,
                            'versio', cp.rectificaciones + 1, 'motiu', p_motivo);
end;
$$;

comment on function public.rectificar_certificado_periodo(uuid, text) is
  'Versión siguiente del certificado de donación de una ventana, con motivo. No consume número nuevo. Los datos provisionales solo la bloquean en modo REAL (21-09-2026).';

-- ---------------------------------------------------------------------------
-- 7. rectificar_certificado_transaccion() — la versión siguiente del CT
-- ---------------------------------------------------------------------------
-- Copia literal de 20270303100400_asimetries_certificats.sql:172-233. Modo: `ce.modo`.
-- ⚠️ Aquí `select * into ce` está **justo encima** del `select * into par`, después de las
--    guardas de tipo y de número: el orden de lectura importaba y no se ha tocado.
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
  -- Solo en REAL: una rectificación de prueba es parte del ensayo (20260921214526).
  if ce.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat REAL (en mode prova si que es pot)'
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
  'Versión siguiente de un certificado de transacción, con motivo. No consume número nuevo ni existe serie R-CT. Los datos provisionales solo la bloquean en modo REAL (21-09-2026).';

-- ---------------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------------
-- 1) Las siete llevan la condición nueva, y ninguna se ha quedado atrás:
--
--    select p.proname,
--           prosrc like '%= ''real'' and coalesce(par.datos_provisionales%' as acotada
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('emitir_certificado', 'emitir_certificado_periodo',
--                         'emitir_certificado_transaccion', 'emitir_certificados_cierre',
--                         'rectificar_certificado', 'rectificar_certificado_periodo',
--                         'rectificar_certificado_transaccion')
--     order by 1;
--    -> siete filas, `acotada` = true en todas.
--
-- 2) Las firmas y los atributos NO han cambiado (un `42P13` al aplicar sería un nombre de
--    parámetro distinto; un cambio silencioso de volatilidad sería peor, porque no falla):
--
--    select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--           p.provolatile, p.prosecdef, p.proconfig
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname like '%_certificado%'
--     order by 1;
--    -> provolatile = 'v', prosecdef = true, proconfig = {search_path=public,pg_temp}.
--
-- 3) Los privilegios se conservan (esta migración no toca ninguno):
--
--    select p.proname, p.proacl
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname in ('emitir_certificado', 'emitir_certificados_cierre')
--     order by 1;
--    -> authenticated=X y service_role=X; ni `public` ni `anon`.
--
-- 4) El comportamiento, sobre datos reales. Con `datos_provisionales = true` (hoy):
--
--    select datos_provisionales, cif from parametros_documentales where id = 1;  -- true
--
--    -- a) Un cierre de PRUEBA: ya se puede emitir. Deja documento `modo = 'prueba'`,
--    --    serie `P-CD`, y `reiniciar_cierre_prueba()` lo revierte entero.
--    select emitir_certificado('<cd de un cierre modo=prueba>');
--    select numero_completo, modo, serie from documentos
--     where objeto_tipo = 'cierre_donante' and objeto_id = '<cd>';   -- P-CD-2026-0001, prueba
--
--    -- b) Un cierre REAL: sigue rechazando con 42501, que es lo que no se ha tocado.
--    select emitir_certificado('<cd de un cierre modo=real>');
--    -- ERROR 42501: Les dades de la Fundacio son PROVISIONALS (CIF G00000000): no es pot
--    --              emetre cap certificat REAL. ...
--
-- 5) El arnés (§13). Esta migración **no añade ni quita ninguna comprobación**: las tres
--    RPC que mira (`emitir_certificados_cierre`, `emitir_certificado`,
--    `emitir_certificado_periodo`) se llaman con un uuid de ceros y lo que miden es la
--    guarda de ROL, que no se ha tocado; el error de negocio que esperan (`22023`) sigue
--    llegando antes que el de provisionales. La cifra de referencia no debería moverse.
