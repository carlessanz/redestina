-- Fase 4 de la revisión del 08-10-2026: el certificado de donación se REVISA antes de firmarse.
--
-- Hasta hoy, emitir el certificado era firmarlo: `emitir_certificado()` estampa la firma de la
-- apoderada al renderizar, y el donante no veía nada hasta que le llegaba el documento firmado.
-- La Fundació pide un paso en medio: que el ofertante revise los kilos y el valor y lo apruebe
-- —o que el equipo lo apruebe en su nombre, dejando una nota que sale impresa— y solo entonces
-- el super_admin firme y emita.
--
--   revisio_estat:  null → pendent_revisio → aprovat_ofertant | aprovat_equip
--
-- ⚠️ No se toca `cierres_donante.estado`: alimenta `mydoc.st_*`, `mydoc.next_*`, `tan.ds_*` y el
--    orden de todo el ciclo del cierre. La revisión es un eje aparte, como `aprovacio` en las
--    respuestas a una oferta.
-- ⚠️ Solo en MODO REAL. En prueba (`P-CD`) el ensayo se sigue recorriendo entero sin revisión.
-- ⚠️ Solo el certificado de DONACIÓN (anual y a demanda). El CT no lleva importe y no entra.

alter table public.cierres_donante
  add column if not exists revisio_estat text
    check (revisio_estat in ('pendent_revisio', 'aprovat_ofertant', 'aprovat_equip')),
  add column if not exists revisio_at   timestamptz,
  add column if not exists revisio_per  uuid references auth.users(id) on delete set null,
  add column if not exists revisio_nota text;

alter table public.cierres_periodo
  add column if not exists revisio_estat text
    check (revisio_estat in ('pendent_revisio', 'aprovat_ofertant', 'aprovat_equip')),
  add column if not exists revisio_at   timestamptz,
  add column if not exists revisio_per  uuid references auth.users(id) on delete set null,
  add column if not exists revisio_nota text;

-- Columnas nuevas de tablas que el panel lee con `select` explícito: SELECT de columna para
-- quien ya leía la tabla (la RLS sigue decidiendo las filas).
grant select (revisio_estat, revisio_at, revisio_nota) on public.cierres_donante to authenticated;
grant select (revisio_estat, revisio_at, revisio_nota) on public.cierres_periodo to authenticated;

-- ------------------------------------------------------------- el aviso al ofertante
alter table public.avisos drop constraint avisos_tipus_check;
alter table public.avisos add constraint avisos_tipus_check check (tipus in (
  'oferta_validada', 'oferta_rebutjada', 'sortida_trobada', 'interes_aprovat', 'interes_rebutjat',
  'oferta_sense_desti', 'recollida_canviada', 'kg_assignats_canviats', 'recollida_confirmada',
  'oferta_modificada', 'oferta_enviada', 'certificat_per_revisar'));
alter table public.avisos drop constraint avisos_objecte_tipo_check;
alter table public.avisos add constraint avisos_objecte_tipo_check check (objecte_tipo in (
  'excedente', 'oferta_resposta', 'canalizacion', 'cierre_donante', 'cierre_periodo'));

-- ------------------------------------------- cuándo un certificado pasa a «per revisar»
--
-- Un trigger y no dentro de `cerrar_cierre()`/`calcular_certificado_periodo()`: esas filas se
-- recalculan desde más de un camino (el cierre, el job de fin de año, recalcular a mano), y la
-- regla es la misma en todos: hay kilos y valor, no hay número, no hay bloqueo, y el cierre
-- está cerrado (anual) o el periodo calculado. Si un recálculo CAMBIA los kilos o el valor de
-- uno ya aprobado, vuelve a «per revisar»: lo aprobado era otra cifra.
create or replace function public.trg_certificat_revisio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tancat  boolean := true;
  v_modo    text;
  v_bloq    boolean;
  v_canvi   boolean;
begin
  if tg_table_name = 'cierres_donante' then
    if new.tipo <> 'donacio' then return new; end if;
    select ce.estado = 'tancat', ce.modo into v_tancat, v_modo from cierres_ejercicio ce where ce.id = new.cierre_id;
  else
    v_modo := new.modo;
  end if;
  if new.certificado_numero is not null then return new; end if;

  v_canvi := tg_op = 'UPDATE' and (new.kg_total is distinct from old.kg_total
                                   or new.valor_total is distinct from old.valor_total);
  if v_canvi and new.revisio_estat in ('aprovat_ofertant', 'aprovat_equip') then
    new.revisio_estat := 'pendent_revisio';
    new.revisio_at := null; new.revisio_per := null; new.revisio_nota := null;
    return new;
  end if;

  select exists (select 1 from jsonb_array_elements(new.bloqueos) b where (b->>'bloqueja')::boolean)
    into v_bloq;
  if new.revisio_estat is null and coalesce(v_tancat, false)
     and new.kg_total > 0 and new.valor_total > 0 and not coalesce(v_bloq, false) then
    new.revisio_estat := 'pendent_revisio';
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_certificat_revisio() from public, anon, authenticated;

create trigger cierres_donante_revisio
  before insert or update on public.cierres_donante
  for each row execute function public.trg_certificat_revisio();
create trigger cierres_periodo_revisio
  before insert or update on public.cierres_periodo
  for each row execute function public.trg_certificat_revisio();

-- El cierre anual pasa a `tancat`: sus donantes con cifra entran en revisión (el trigger de
-- arriba lo decide fila a fila; aquí solo se le da la ocasión).
create or replace function public.trg_cierre_tancat_revisio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.estado = 'tancat' and old.estado is distinct from 'tancat' then
    update cierres_donante set revisio_estat = revisio_estat
     where cierre_id = new.id and tipo = 'donacio' and certificado_numero is null;
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_cierre_tancat_revisio() from public, anon, authenticated;

create trigger cierres_ejercicio_revisio
  after update of estado on public.cierres_ejercicio
  for each row execute function public.trg_cierre_tancat_revisio();

-- El aviso, cuando una fila ENTRA en «per revisar» (no en cada recálculo).
create or replace function public.trg_avis_certificat_revisio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_any int;
begin
  if new.revisio_estat = 'pendent_revisio'
     and (tg_op = 'INSERT' or old.revisio_estat is distinct from 'pendent_revisio') then
    if tg_table_name = 'cierres_donante' then
      select ce.ejercicio into v_any from cierres_ejercicio ce where ce.id = new.cierre_id;
      perform public.crear_avis('productor', new.productor_id, 'certificat_per_revisar', 'cierre_donante', new.id,
        jsonb_build_object('exercici', v_any, 'kg', new.kg_total, 'valor', round(new.valor_total, 2)));
    else
      perform public.crear_avis('productor', new.productor_id, 'certificat_per_revisar', 'cierre_periodo', new.id,
        jsonb_build_object('exercici', new.ejercicio, 'kg', new.kg_total, 'valor', round(new.valor_total, 2),
                           'desde', new.periodo_desde, 'fins', new.periodo_hasta));
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_avis_certificat_revisio() from public, anon, authenticated;

-- ⚠️ `after update` A SECAS, no `update of revisio_estat`: el estado lo pone casi siempre el
--    trigger BEFORE de arriba, y un `update of <columna>` solo se dispara si la columna está
--    en el SET de la sentencia. La función ya compara `old` y `new`.
create trigger cierres_donante_avis_revisio
  after insert or update on public.cierres_donante
  for each row execute function public.trg_avis_certificat_revisio();
create trigger cierres_periodo_avis_revisio
  after insert or update on public.cierres_periodo
  for each row execute function public.trg_avis_certificat_revisio();

-- ------------------------------------------------------------------------- las RPC
--
-- El ofertante aprueba lo suyo. Para una cuenta externa el permiso va ANTES que la
-- existencia (un uuid inventado da 42501, como `fixar_fotos_oferta`).
create or replace function public.aprovar_certificat_ofertant(p_id uuid, p_tipus text default 'anual')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estat text;
  v_bloq  boolean;
begin
  if auth.uid() is null then
    raise exception 'Cal una sessio' using errcode = '42501';
  end if;
  if p_tipus not in ('anual', 'periode') then
    raise exception 'tipus_desconegut' using errcode = '22023';
  end if;
  if p_tipus = 'anual' then
    if p_id not in (select public.cierres_donante_meus(auth.uid())) then
      raise exception 'Aquest certificat no es teu' using errcode = '42501';
    end if;
    select revisio_estat, exists (select 1 from jsonb_array_elements(bloqueos) b where (b->>'bloqueja')::boolean)
      into v_estat, v_bloq from cierres_donante where id = p_id for update;
  else
    if p_id not in (select public.cierres_periodo_meus(auth.uid())) then
      raise exception 'Aquest certificat no es teu' using errcode = '42501';
    end if;
    select revisio_estat, exists (select 1 from jsonb_array_elements(bloqueos) b where (b->>'bloqueja')::boolean)
      into v_estat, v_bloq from cierres_periodo where id = p_id for update;
  end if;
  if v_estat is distinct from 'pendent_revisio' then
    raise exception 'no_pendent_revisio' using errcode = '22023';
  end if;
  if v_bloq then
    raise exception 'certificat_bloquejat' using errcode = '22023';
  end if;

  if p_tipus = 'anual' then
    update cierres_donante set revisio_estat = 'aprovat_ofertant', revisio_at = now(), revisio_per = auth.uid()
     where id = p_id;
  else
    update cierres_periodo set revisio_estat = 'aprovat_ofertant', revisio_at = now(), revisio_per = auth.uid()
     where id = p_id;
  end if;
  return jsonb_build_object('id', p_id, 'revisio_estat', 'aprovat_ofertant');
end;
$$;
revoke execute on function public.aprovar_certificat_ofertant(uuid, text) from public, anon;
grant execute on function public.aprovar_certificat_ofertant(uuid, text) to authenticated;

-- El equipo aprueba en nombre del ofertante (modelo asistido), con una nota que se imprime.
create or replace function public.aprovar_certificat_equip(p_id uuid, p_tipus text default 'anual', p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estat text;
  v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if auth.uid() is null or not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar revisa un certificat en nom de l''ofertant' using errcode = '42501';
  end if;
  if p_tipus not in ('anual', 'periode') then
    raise exception 'tipus_desconegut' using errcode = '22023';
  end if;
  if p_tipus = 'anual' then
    select revisio_estat into v_estat from cierres_donante where id = p_id for update;
  else
    select revisio_estat into v_estat from cierres_periodo where id = p_id for update;
  end if;
  if not found then
    raise exception 'certificat_inexistent' using errcode = '22023';
  end if;
  if v_nota is null then
    raise exception 'cal_nota' using errcode = '22023';
  end if;
  if v_estat is distinct from 'pendent_revisio' then
    raise exception 'no_pendent_revisio' using errcode = '22023';
  end if;

  if p_tipus = 'anual' then
    update cierres_donante set revisio_estat = 'aprovat_equip', revisio_at = now(),
           revisio_per = auth.uid(), revisio_nota = left(v_nota, 400) where id = p_id;
  else
    update cierres_periodo set revisio_estat = 'aprovat_equip', revisio_at = now(),
           revisio_per = auth.uid(), revisio_nota = left(v_nota, 400) where id = p_id;
  end if;
  return jsonb_build_object('id', p_id, 'revisio_estat', 'aprovat_equip');
end;
$$;
revoke execute on function public.aprovar_certificat_equip(uuid, text, text) from public, anon;
grant execute on function public.aprovar_certificat_equip(uuid, text, text) to authenticated;

-- Lo que el certificado imprime de la revisión: quién la aprobó y cuándo. Sin uuid ni correo:
-- el nombre de la persona del equipo, si fue el equipo, y la nota.
create or replace function public.certificat_revisio_snapshot(p_estat text, p_at timestamptz, p_per uuid, p_nota text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_estat in ('aprovat_ofertant', 'aprovat_equip') then
    jsonb_build_object('revisio', jsonb_build_object(
      'estat', p_estat,
      'at', p_at,
      'per', case when p_estat = 'aprovat_equip'
                  then (select coalesce(nullif(btrim(pf.nombre), ''), 'Equip de Redestina') from perfiles pf where pf.id = p_per)
             end,
      'nota', case when p_estat = 'aprovat_equip' then p_nota end))
  else '{}'::jsonb end;
$$;
revoke execute on function public.certificat_revisio_snapshot(text, timestamptz, uuid, text) from public, anon, authenticated;

-- Las filas que ya existen: las que hoy entrarían en revisión, entran.
update public.cierres_donante set revisio_estat = revisio_estat
 where tipo = 'donacio' and certificado_numero is null;
update public.cierres_periodo set revisio_estat = revisio_estat
 where certificado_numero is null;

-- ---------------------------------------------- las tres emisiones, con la guarda nueva

CREATE OR REPLACE FUNCTION public.emitir_certificado(p_cd uuid, p_motivo_excepcion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- (00) Revisión y firma (11-10-2026, fase 4 de la revisión del 08-10-2026). En REAL el
  --      certificado lo FIRMA el super_admin —la emisión estampa la firma de la apoderada—
  --      y solo después de que el ofertante (o el equipo en su nombre, con nota) haya
  --      revisado los kilos y el valor. En prueba no se exige ninguna de las dos cosas.
  if ce.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa i emet un certificat real' using errcode = '42501';
  end if;
  if ce.modo = 'real' and coalesce(cd.revisio_estat, '') not in ('aprovat_ofertant', 'aprovat_equip') then
    raise exception 'sense_revisio: el certificat encara no esta revisat per l''ofertant' using errcode = '22023';
  end if;

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
    public.cierre_datos_certificado(p_cd) || public.certificat_revisio_snapshot(cd.revisio_estat, cd.revisio_at, cd.revisio_per, cd.revisio_nota),
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
$function$;

CREATE OR REPLACE FUNCTION public.emitir_certificado_periodo(p_periodo uuid, p_motivo_excepcion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- (00) Revisión y firma, como el anual (fase 4 de la revisión del 08-10-2026).
  if cp.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa i emet un certificat real' using errcode = '42501';
  end if;
  if cp.modo = 'real' and coalesce(cp.revisio_estat, '') not in ('aprovat_ofertant', 'aprovat_equip') then
    raise exception 'sense_revisio: el certificat encara no esta revisat per l''ofertant' using errcode = '22023';
  end if;

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
    public.periodo_datos_certificado(p_periodo) || public.certificat_revisio_snapshot(cp.revisio_estat, cp.revisio_at, cp.revisio_per, cp.revisio_nota),
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
$function$;

CREATE OR REPLACE FUNCTION public.emitir_certificados_cierre(p_cierre uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- (6) En REAL lo firma el super_admin (fase 4 de la revisión del 08-10-2026).
  if ce.modo = 'real' and auth.uid() is not null and not public.es_super_admin() then
    raise exception 'Nomes el super_admin signa i emet certificats reals' using errcode = '42501';
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

    -- (b2) En REAL, sin la revisión del ofertante (o del equipo en su nombre) no se firma.
    if ce.modo = 'real' and coalesce(cd.revisio_estat, '') not in ('aprovat_ofertant', 'aprovat_equip') then
      v_saltats := v_saltats || jsonb_build_object(
        'cd', cd.id, 'donant', v_donant, 'codi', 'sense_revisio',
        'motiu', 'Encara no l''ha revisat l''ofertant');
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
$function$;
