-- Las RPC del certificado de recepción (`CR`): de una ventana de fechas al PDF.
--
-- CÓMO SE LEE ESTE FICHERO. Las mismas tres capas que `20270303100300_rpc_certificat_periode.sql`:
--   · base de cálculo (§1–3): solo equipo, y la del panel de la receptora.
--   · snapshot, destinatario y puente con `documentos` (§4–6): internos, solo `service_role`.
--   · acciones (§7–11): lo que llama el panel, con su comprobación de rol y su estado.
--
-- LAS GUARDAS SON LAS DEL CERTIFICADO A DEMANDA **TAL COMO QUEDARON TRAS F1**, y eso es
-- lo que hay que mirar dos veces antes de copiar de un fichero viejo:
--   · **NO exigen factura.** El certificado de donación dejó de exigirla el 21-09-2026
--     (20260921211329, §4 y deuda 111); aquí ni siquiera existe el concepto —este
--     documento no acredita ninguna donación deducible y no lleva importes—, así que no
--     hay `registrar_factura_*`, ni `estado = 'coincident'`, ni excepción de D4.
--   · **`datos_provisionales` solo bloquea el modo REAL** (20260921214526). En modo prueba
--     se emite: serie `P-CR`, marca de agua y `destinatariosPrueba`. Si no, el último
--     escalón del ciclo no se podría recorrer nunca, que es exactamente el problema que
--     aquella migración vino a resolver.
--     ⚠️ Y su razonamiento hay que repetirlo, porque solo es correcto si el modo no puede
--        ser NULL cuando se evalúa: `cierres_receptor.modo` es `not null` con
--        `check (modo in ('prueba','real'))`, y en las dos funciones que llevan la guarda
--        ya ha cortado antes una comprobación de existencia de la fila. Con un modo NULL,
--        `modo = 'real'` daría NULL, el `if` sería falso y la guarda se saltaría **en
--        silencio**.
--   · `pot_aprovar()` para calcular, emitir, rectificar, marcar enviado y reiniciar.
--   · `22023` si la ventana cruza dos ejercicios, si acaba en el futuro, o si esa misma
--     ventana ya tiene certificado.
--
-- LO QUE ESTE CIRCUITO **NO** TIENE, y no es un olvido:
--   · `periode_parteix_excedent`. En el certificado del donante los kilos salen del `REC`,
--     que documenta una entrada repartida después entre varias entidades, así que una
--     fecha de corte puede partir un albarán por la mitad (20270303100000). Aquí los kilos
--     salen del `ENT` o del `OPE`, que cuelgan **1:1 de la canalización**: no hay reparto y
--     por tanto no hay nada que partir.
--   · Ninguna columna, ningún parámetro y ninguna clave del snapshot con un importe.

-- ---------------------------------------------------------------------------
-- 1. cierre_base_recepcio(): qué entra en un certificado de recepción
-- ---------------------------------------------------------------------------
-- La gemela de `cierre_base_transaccion()` con tres cambios y ni uno más:
--   · `valorizacion` **las tres** (donación, venta y maquila): lo que la receptora quiere
--     acreditar es el producto aprovechado, no una de las tres vías.
--   · el eje es **`entidad_id`**, no `productor_id`.
--   · el albarán es el `ENT` en donación y el `OPE` en venta/maquila.
--
-- ⚠️ `coalesce(c.valorizacion, 'donacio')`, y no `c.valorizacion` a secas. Las
--    canalizaciones anteriores a 20261012100100 pueden tenerla NULL; con el filtro
--    literal de `cierre_base()`/`cierre_base_transaccion()` esas filas **se caen de las
--    dos consultas sin que nadie lo vea**. En el certificado del donante eso es un kilo
--    que no se certifica; aquí sería un kilo que la entidad recibió y que su propio
--    certificado niega. El defecto del negocio es la donación, así que ahí van — y por eso
--    `kg_donacio + kg_compra = kg_total` se cumple siempre.
--    La MISMA expresión está en `kg_rebuts_exercici()` (§3): si divergieran, el acumulado
--    del panel y el del certificado dirían cifras distintas sobre lo mismo.
--
-- ⚠️ SOLO EQUIPO, con el idioma de 20270303100500: `auth.uid() is not null and not
--    es_intern()`. Con `es_intern()` a secas, una llamada con `service_role` —que no tiene
--    `auth.uid()`— se llevaría un 42501, y quien llama a esto es `calcular_certificat_recepcio()`.
--    Cruza `canalizaciones`, `excedentes`, `albaranes` y `productores` sin que la RLS de
--    ninguna vuelva a filtrar: sin la guarda, una entidad podría pedir por PostgREST lo que
--    ha recibido **todo el mundo**, con el nombre de cada generador. Es el agujero que
--    20270303100500 encontró en `cierre_base()`.
create or replace function public.cierre_base_recepcio(
  p_desde date,
  p_hasta date,
  p_modo  text default 'prueba'
)
returns table (
  canalizacion_id uuid,
  entidad_id      uuid,
  valorizacion    text,
  producto        text,
  mes             int,
  kg_conciliados  numeric,
  kg_neto         numeric,
  retroactiva     boolean,
  albaran_id      uuid,
  albaran_tipo    text,
  municipio       text,
  comarca         text,
  productor_id    uuid,
  productor_nom   text,
  productor_nif   text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta la base de calcul d''un certificat de recepcio'
      using errcode = '42501';
  end if;

  return query
  with ops as (
    select c.id                                   as can_id,
           c.entidad_id                           as ent_id,
           coalesce(c.valorizacion, 'donacio')    as val,
           e.producto                             as prod,
           e.productor_id                         as prod_id,
           coalesce(e.ubicacion_id, esp.ubicacion_id) as ubi_id,
           c.kg_conciliados                       as kg_conc,
           c.conciliacion_retroactiva             as retro,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid')       as fecha_local
      from canalizaciones c
      join excedentes     e   on e.id = c.excedente_id
      left join espigoladas esp on esp.id = e.espigolada_id
     where c.estado = 'conciliada'
       and c.kg_conciliados is not null
       and c.entidad_id is not null
       -- Misma regla que el resto del circuito: una conciliación hecha después de cerrar
       -- el ejercicio solo entra en los cierres de prueba.
       and (p_modo = 'prueba' or not c.conciliacion_retroactiva)
  ),
  enrango as (
    select o.* from ops o
     where o.fecha_local >= p_desde::timestamp
       and o.fecha_local <  (p_hasta + 1)::timestamp
  ),
  amb_albara as (
    select o.*, r.alb_id, r.alb_tipo, r.alb_kg
      from enrango o
      left join lateral (
        select a.id as alb_id, a.tipo as alb_tipo, sum(l.kg_validados) as alb_kg
          from albaranes a
          join albaran_lineas l on l.albaran_id = a.id
         where a.estado = 'conciliado'
           and a.canalizacion_id = o.can_id
           and a.tipo = case when o.val = 'donacio' then 'ENT' else 'OPE' end
         group by a.id, a.tipo
         order by a.id
         limit 1
      ) r on true
  ),
  amb_origen as (
    select o.*,
           coalesce(ub.municipio, pr.poblacion)   as muni,
           ub.municipio_ine                       as muni_ine,
           coalesce(pr.empresa, pr.name)          as pr_nom,
           pr.nif                                 as pr_nif
      from amb_albara o
      left join productor_ubicaciones ub on ub.id = o.ubi_id
      left join productores           pr on pr.id = o.prod_id
  )
  select o.can_id,
         o.ent_id,
         o.val,
         o.prod,
         extract(month from o.fecha_local)::int,
         o.kg_conc,
         -- Los kilos OFICIALES son los del albarán conciliado (D13). El respaldo a
         -- `kg_conciliados` cubre la conciliación retroactiva, que es el único caso en que
         -- no hay albarán, y queda marcado en `retroactiva`.
         round(coalesce(o.alb_kg, o.kg_conc), 2),
         (o.retro or o.alb_id is null),
         o.alb_id,
         o.alb_tipo,
         o.muni,
         (select m.comarca
            from municipios m
           where (o.muni_ine is not null and m.codi_ine = o.muni_ine)
              or (o.muni_ine is null and o.muni is not null
                  and lower(m.nom) = lower(o.muni))
           limit 1),
         -- 🔴 D3: en donación, el generador NO SE NOMBRA. Se anula aquí, además de estar
         --    prohibido por el check de `cierre_receptor_lineas`: la función es
         --    `security definer` y lo que devuelva acaba en una tabla que la entidad lee
         --    por RLS, así que la primera defensa tiene que estar donde se compone el dato.
         case when o.val = 'donacio' then null else o.prod_id end,
         case when o.val = 'donacio' then null else o.pr_nom end,
         case when o.val = 'donacio' then null else o.pr_nif end
    from amb_origen o;
end;
$$;

comment on function public.cierre_base_recepcio(date, date, text) is
  'Base del certificado de recepción: lo recibido por cada entidad en una ventana (donación + compra), con los kilos del ENT/OPE conciliado. Solo equipo. En donación no devuelve al generador (D3).';

-- ---------------------------------------------------------------------------
-- 2. cierre_pendents_recepcio(): lo que falta por conciliar
-- ---------------------------------------------------------------------------
-- Cada entrega sin conciliar bloquea el certificado de su receptora, por lo mismo que
-- bloquea el del donante: certificar una entrega a medias es certificar una cifra que
-- todavía puede cambiar.
create or replace function public.cierre_pendents_recepcio(p_desde date, p_hasta date)
returns table (entidad_id uuid, canalizaciones int, kg numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null and not public.es_intern() then
    raise exception 'Nomes l''equip consulta el que falta per conciliar'
      using errcode = '42501';
  end if;

  return query
  select c.entidad_id, count(*)::int, coalesce(sum(c.kg_confirmados), 0)
    from canalizaciones c
   where c.entidad_id is not null
     and c.estado in ('confirmada', 'entregada')
     and (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
            at time zone 'Europe/Madrid') >= p_desde::timestamp
     and (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
            at time zone 'Europe/Madrid') <  (p_hasta + 1)::timestamp
   group by c.entidad_id;
end;
$$;

comment on function public.cierre_pendents_recepcio(date, date) is
  'Entregas de la ventana sin conciliar, por entidad receptora (solo equipo). Cada una bloquea su certificado de recepción.';

-- ---------------------------------------------------------------------------
-- 3. kg_rebuts_exercici(): el acumulado del año, leído en SQL
-- ---------------------------------------------------------------------------
-- Lo que el panel de la receptora necesita para decir «has rebut X quilos aquest any» sin
-- traerse las canalizaciones y sumarlas en el navegador, que es la forma de que la cifra
-- de la pantalla y la del certificado acaben discrepando.
--
-- 🔴 `security invoker`, **no** `security definer`, y es la decisión que hace que esto sea
--    seguro sin escribir ni una guarda: igual que `pendents_equip()` y
--    `missatges_sense_contestar()` (§4bis), agrega **solo lo que quien pregunta ya puede
--    leer**. La RLS de `canalizaciones` filtra por `mis_entidades()`, y la de `albaranes` /
--    `albaran_lineas` por `albarans_de_les_meves_orgs()`: una receptora ve lo suyo, el
--    equipo lo ve todo y `service_role` ignora la RLS. Un `security definer` aquí habría
--    exigido reimplementar ese filtro a mano y habría abierto la puerta a olvidarlo.
--    ⚠️ Corolario: NO puede unirse a `excedentes` —la receptora no ve las ofertas ajenas y
--       se le caerían filas en silencio—. Por eso el producto no entra aquí y la
--       valorización sale de `canalizaciones`, que sí es suya.
--
-- ⚠️ `coalesce(c.valorizacion, 'donacio')`: la misma expresión que `cierre_base_recepcio()`.
--    Si divergieran, el acumulado del panel y el del certificado dirían cifras distintas
--    sobre exactamente lo mismo.
create or replace function public.kg_rebuts_exercici(
  p_ejercicio int  default null,
  p_entidad   uuid default null
)
returns table (
  entidad_id          uuid,
  ejercicio           int,
  kg_donacio          numeric,
  kg_compra           numeric,
  kg_total            numeric,
  operacions          int,
  kg_pendents         numeric,
  operacions_pendents int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ej as (
    select coalesce(p_ejercicio,
                    extract(year from (now() at time zone 'Europe/Madrid'))::int) as e
  ),
  base as (
    select c.id                                 as can_id,
           c.entidad_id                         as ent_id,
           c.estado                             as est,
           coalesce(c.valorizacion, 'donacio')  as val,
           c.kg_conciliados                     as kg_conc,
           c.kg_confirmados                     as kg_conf,
           (coalesce(c.data_hora_recollida, c.conciliada_at, c.created_at)
              at time zone 'Europe/Madrid')     as fecha_local
      from canalizaciones c
     where c.entidad_id is not null
       and c.estado in ('conciliada', 'confirmada', 'entregada')
       -- Una conciliada sin kilos conciliados no es ninguna de las dos cosas: ni cuenta
       -- como oficial ni como pendiente. Se deja fuera para que los dos contadores sumen.
       and (c.estado <> 'conciliada' or c.kg_conciliados is not null)
       and (p_entidad is null or c.entidad_id = p_entidad)
  ),
  dins as (
    select b.* from base b, ej
     where extract(year from b.fecha_local)::int = ej.e
  ),
  amb_kg as (
    select d.*,
           case when d.est = 'conciliada' then
             round(coalesce(
               (select sum(l.kg_validados)
                  from albaranes a
                  join albaran_lineas l on l.albaran_id = a.id
                 where a.canalizacion_id = d.can_id
                   and a.estado = 'conciliado'
                   and a.tipo = case when d.val = 'donacio' then 'ENT' else 'OPE' end),
               d.kg_conc), 2)
           end as kg_net
      from dins d
  )
  select a.ent_id,
         (select ej.e from ej),
         coalesce(sum(a.kg_net) filter (where a.est = 'conciliada' and a.val = 'donacio'), 0),
         coalesce(sum(a.kg_net) filter (where a.est = 'conciliada' and a.val <> 'donacio'), 0),
         coalesce(sum(a.kg_net) filter (where a.est = 'conciliada'), 0),
         (count(*) filter (where a.est = 'conciliada'))::int,
         coalesce(sum(a.kg_conf) filter (where a.est <> 'conciliada'), 0),
         (count(*) filter (where a.est <> 'conciliada'))::int
    from amb_kg a
   group by a.ent_id;
$$;

comment on function public.kg_rebuts_exercici(int, uuid) is
  'Kilos recibidos por una entidad en un ejercicio: conciliados (oficiales, del albarán) y pendientes. security invoker: agrega solo lo que quien pregunta ya puede leer.';

-- ---------------------------------------------------------------------------
-- 4. recepcio_datos_certificat(): el snapshot congelado
-- ---------------------------------------------------------------------------
-- Lo que consumirá `_shared/pdf/render/cr.ts`. Misma forma general que el CD y el CT
-- —cabecera de la Fundación, apoderada, periodo, detalle— y tres diferencias que el
-- renderizador tiene que respetar:
--
--   · **`receptora`** en vez de `donant` / `generador`: el destinatario es quien recibió.
--   · **`procedencies_donacio`** y **`procedencies_compra`** son DOS listas separadas, y no
--     una con un campo de tipo, precisamente para que sea imposible imprimirlas con el
--     mismo bloque: la primera **no lleva nombre de organización** y la segunda sí (ver la
--     cabecera de 20270404100000).
--   · **NI UN IMPORTE**, como el CT. `documentos.datos` lo lee la propia entidad a través
--     de `documents_meus()`, así que meter aquí un euro sería publicarlo. La comprobación
--     es fácil de escribir y conviene tenerla a mano:
--       select public.recepcio_datos_certificat('<cr>')::text ilike '%valor%';   -- f
--     (por eso la clave del tipo de operación se llama `tipus` y no `valoritzacio`: la
--     segunda contiene la subcadena y haría inútil esa comprobación).
--
-- ⚠️ NO LLEVA `apoderada_dni`, como ninguno de sus hermanos: el DNI vive solo en
--    `parametros_documentales`, fuera del GRANT de SELECT, y lo lee `generar-documento`
--    con `service_role` para estamparlo. Meterlo aquí anularía ese GRANT por columnas.
create or replace function public.recepcio_datos_certificat(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cr  cierres_receptor%rowtype;
  par parametros_documentales%rowtype;
begin
  select * into cr from cierres_receptor where id = p_id;
  if cr.id is null then
    raise exception 'Aquest certificat de recepcio no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  return jsonb_build_object(
    'tipus', 'CR',
    'abast', 'periode',
    'mode', cr.modo,
    'exercici', cr.ejercicio,
    'numero', cr.certificado_numero,
    -- D14: la fecha del certificado es la de generación, no la del periodo.
    'data_generacio', now(),
    'lloc', par.poblacion,
    'fundacio', jsonb_build_object(
      'raó_social', par.razon_social, 'cif', par.cif, 'domicili', par.domicilio,
      'codi_postal', par.codigo_postal, 'poblacio', par.poblacion,
      'inscripcio', par.inscripcion, 'dades_provisionals', par.datos_provisionales),
    'apoderada', jsonb_build_object('nom', par.apoderada_nombre, 'carrec', par.apoderada_cargo),
    'receptora', cr.datos_fiscales,
    'periode', jsonb_build_object('des_de', cr.periodo_desde, 'fins_a', cr.periodo_hasta),
    'kg', cr.kg_total,
    'kg_donacio', cr.kg_donacio,
    'kg_compra', cr.kg_compra,
    'sense_imports', true,
    -- ⚠️ Esta frase NO puede contener la subcadena «valor», y no es una manía: la
    --    comprobación de que el snapshot no lleva importes es
    --    `recepcio_datos_certificat(...)::text ilike '%valor%'  -- f`, la misma que usa el
    --    CT, y una nota que dijera «el valor economic…» la dejaría inútil sin que nada
    --    fallara. Dice lo mismo con otras palabras.
    'nota', 'Aquest certificat acredita els quilos rebuts dins del periode indicat. '
            || 'No recull imports: les quantitats economiques queden registrades internament.',
    'rectificacions', cr.rectificaciones,
    'detall', (
      select coalesce(jsonb_agg(x order by x->>'producte'), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'producte',   l.producto,
                   'kg',         sum(l.kg_neto),
                   'kg_donacio', coalesce(sum(l.kg_neto) filter (where l.valorizacion = 'donacio'), 0),
                   'kg_compra',  coalesce(sum(l.kg_neto) filter (where l.valorizacion <> 'donacio'), 0),
                   'operacions', count(*)) as x
            from cierre_receptor_lineas l
           where l.cierre_receptor_id = cr.id
           group by l.producto
        ) d),
    -- 🔴 D3: municipio y comarca, y nada más. Aquí no hay ninguna clave que pueda llevar
    --    el nombre de una organización, porque en estas líneas esas columnas son NULL por
    --    check.
    'procedencies_donacio', (
      select coalesce(jsonb_agg(x order by x->>'municipi'), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'municipi',   l.municipio,
                   'comarca',    l.comarca,
                   'kg',         sum(l.kg_neto),
                   'operacions', count(*)) as x
            from cierre_receptor_lineas l
           where l.cierre_receptor_id = cr.id and l.valorizacion = 'donacio'
           group by l.municipio, l.comarca
        ) d),
    -- Compra y maquila: aquí el generador SÍ se nombra (decisión del cliente).
    'procedencies_compra', (
      select coalesce(jsonb_agg(x order by x->>'generador'), '[]'::jsonb)
        from (
          select jsonb_build_object(
                   'generador',  l.productor_nom,
                   'nif',        l.productor_nif,
                   'municipi',   l.municipio,
                   'comarca',    l.comarca,
                   'tipus',      l.valorizacion,
                   'kg',         sum(l.kg_neto),
                   'operacions', count(*)) as x
            from cierre_receptor_lineas l
           where l.cierre_receptor_id = cr.id and l.valorizacion <> 'donacio'
           group by l.productor_nom, l.productor_nif, l.municipio, l.comarca, l.valorizacion
        ) d),
    'bloquejos', cr.bloqueos
  );
end;
$$;

comment on function public.recepcio_datos_certificat(uuid) is
  'Snapshot del certificado de recepción. SIN IMPORTES. La procedencia va en DOS listas: la de donación no nombra al generador (D3).';

-- ---------------------------------------------------------------------------
-- 5. recepcio_destinatari(): a quién se le manda
-- ---------------------------------------------------------------------------
-- Copia de `periodo_destinatario()` sobre `entidades`. ⚠️ En modo prueba nunca se escribe a
-- una entidad real, aunque `test_mode` esté apagado: solo a la propia organización si su
-- ficha es `es_test`, y si no al buzón del equipo. Sin buzón del equipo se levanta
-- excepción; quedarse sin destinatario es preferible a caer en el de la entidad.
create or replace function public.recepcio_destinatari(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cr     cierres_receptor%rowtype;
  en     entidades%rowtype;
  v_mail text;
begin
  select * into cr from cierres_receptor where id = p_id;
  select * into en from entidades where id = cr.entidad_id;

  if cr.modo = 'real' then
    if coalesce(btrim(en.email), '') = '' then
      raise exception 'L''entitat % no te correu a la fitxa: no es pot enviar', en.nombre
        using errcode = '22023';
    end if;
    return jsonb_build_object('email', en.email, 'nom', en.nombre,
                              'forcat', false, 'motiu', 'entitat receptora');
  end if;

  if en.es_test and coalesce(btrim(en.email), '') <> '' then
    return jsonb_build_object('email', en.email, 'nom', en.nombre,
                              'forcat', true, 'motiu', 'organitzacio de prova (es_test)');
  end if;

  select email_equipo into v_mail from parametros_documentales where id = 1;
  if coalesce(btrim(v_mail), '') = '' then
    raise exception 'Mode prova sense bustia de l''equip: omple email_equipo a Configuracio'
      using errcode = '22023';
  end if;
  return jsonb_build_object('email', v_mail, 'nom', 'Equip Redestina',
                            'forcat', true, 'motiu', 'mode prova → bustia de l''equip');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. recepcio_emet_document(): el puente con `documentos`
-- ---------------------------------------------------------------------------
-- Interna, mismo patrón que `periodo_emet_document()`. `objeto_tipo = 'cierre_receptor'`,
-- `tipo = 'CR'` (que es lo que elegirá el renderizador) y serie `CR` / `P-CR`.
--
-- 🔴 LA PLANTILLA SE PIDE CON `variante is null` Y CON `order by version desc`, y no con un
--    `limit 1` a secas. Hoy el `CR` tiene un solo modelo y da igual; el día que alguien
--    siembre una variante —como pasó con `CD`/`parcial`— un `limit 1` sin filtro ni orden
--    elegiría cualquiera de las dos y el documento saldría impreso con el texto del otro.
--    No da ningún error: solo se ve leyendo el PDF (§4).
create or replace function public.recepcio_emet_document(
  p_id    uuid,
  p_datos jsonb,
  p_envio jsonb default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cr       cierres_receptor%rowtype;
  v_serie  text;
  v_ver    int;
  v_previo uuid;
  v_id     uuid;
  v_idioma text;
  v_plant  uuid;
begin
  select * into cr from cierres_receptor where id = p_id;

  v_serie := case when cr.modo = 'prueba' then 'P-CR' else 'CR' end;

  -- El idioma sale del perfil del titular si existe (misma decisión que en los otros
  -- certificados). `perfiles.idioma` es lo que manda, no el `localStorage` del navegador.
  select coalesce(pe.idioma, 'ca') into v_idioma
    from membresias m join perfiles pe on pe.id = m.user_id
   where m.entidad_id = cr.entidad_id and m.activo and m.rol_org = 'titular'
   order by m.created_at limit 1;
  v_idioma := coalesce(v_idioma, 'ca');

  select p.id into v_plant
    from plantillas_documento p
   where p.tipo = 'CR' and p.variante is null and p.idioma = v_idioma and p.vigente
   order by p.version desc
   limit 1;

  select id, version into v_previo, v_ver
    from documentos
   where objeto_tipo = 'cierre_receptor' and objeto_id = p_id
     and tipo = 'CR' and vigente;

  if v_previo is not null then
    update documentos set vigente = false where id = v_previo;
  end if;

  insert into documentos (
    tipo, subtipo, objeto_tipo, objeto_id,
    numero_completo, version, serie, ejercicio,
    modo, idioma, plantilla_id, datos, sha256_datos, ruta, envio, emitido_por
  ) values (
    'CR', 'definitiu', 'cierre_receptor', p_id,
    cr.certificado_numero, coalesce(v_ver, 0) + 1, v_serie, cr.ejercicio,
    cr.modo, v_idioma, v_plant,
    p_datos,
    encode(sha256(convert_to(p_datos::text, 'UTF8')), 'hex'),
    public.ruta_documento('cierre_receptor', p_id, 'CR', cr.certificado_numero,
                          coalesce(v_ver, 0) + 1, cr.modo, cr.ejercicio),
    p_envio,
    auth.uid()
  ) returning id into v_id;

  if v_previo is not null then
    update documentos set sustituido_por = v_id where id = v_previo;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. calcular_certificat_recepcio(): la foto de la ventana
-- ---------------------------------------------------------------------------
-- Recalculable mientras no se haya emitido: hay **un solo borrador por entidad, modo y
-- ventana** (índice parcial de 20270404100000), así que llamarla dos veces con los mismos
-- argumentos actualiza la misma fila en vez de dejar dos.
--
-- ⚠️ CALCULAR YA ESCRIBE, igual que `calcular_certificado_periodo()`: inserta la fila antes
--    de que nadie decida emitir, que es lo que permite enseñar kilos y bloqueos primero. El
--    precio es el mismo y conviene saberlo: probar tres ventanas deja tres borradores sin
--    número (§12.112). No ensucian nada visible —el panel de la entidad solo lista lo
--    emitido— y `reiniciar_recepcions_prova()` limpia los de prueba.
create or replace function public.calcular_certificat_recepcio(
  p_entidad uuid,
  p_desde   date,
  p_hasta   date,
  p_modo    text default 'real'
) returns cierres_receptor
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cr    cierres_receptor%rowtype;
  en    entidades%rowtype;
  v_ej  int;
  v_hoy date;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar calcula un certificat' using errcode = '42501';
  end if;
  if p_modo not in ('prueba', 'real') then
    raise exception 'Mode desconegut: %', p_modo using errcode = '22023';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El periode ha de tenir una data d''inici anterior o igual a la de fi'
      using errcode = '22023';
  end if;

  v_ej  := extract(year from p_desde)::int;
  v_hoy := (now() at time zone 'Europe/Madrid')::date;

  if extract(year from p_hasta)::int <> v_ej then
    raise exception 'Un certificat no pot cobrir dos exercicis (% i %): la serie es anual',
      v_ej, extract(year from p_hasta)::int using errcode = '22023';
  end if;
  -- Certificar un periodo que todavía no ha terminado sería certificar el futuro: los
  -- kilos que faltan por conciliar llegarían después y el certificado ya estaría emitido.
  if p_hasta > v_hoy then
    raise exception 'El periode acaba el % i encara no ha acabat (avui es %)', p_hasta, v_hoy
      using errcode = '22023';
  end if;

  select * into en from entidades where id = p_entidad;
  if en.id is null then
    raise exception 'Aquesta entitat receptora no existeix' using errcode = '22023';
  end if;

  -- ¿Hay ya un certificado emitido de esta misma ventana? Entonces esto no es un recálculo,
  -- es una rectificación, y tiene su propia función.
  if exists (select 1 from cierres_receptor c
              where c.entidad_id = p_entidad and c.modo = p_modo
                and c.periodo_desde = p_desde and c.periodo_hasta = p_hasta
                and c.certificado_numero is not null and c.estado <> 'substituit') then
    raise exception 'Aquesta entitat ja te un certificat d''aquest periode: fes servir rectificar_certificat_recepcio()'
      using errcode = '22023';
  end if;

  -- El borrador de esta ventana, o uno nuevo.
  select * into cr from cierres_receptor
   where entidad_id = p_entidad and modo = p_modo
     and periodo_desde = p_desde and periodo_hasta = p_hasta
     and certificado_numero is null
   for update;

  if cr.id is null then
    insert into cierres_receptor (entidad_id, periodo_desde, periodo_hasta, ejercicio,
                                  modo, creado_por)
    values (p_entidad, p_desde, p_hasta, v_ej, p_modo, auth.uid())
    returning * into cr;
  end if;

  -- Las líneas, siempre desde cero: son el detalle del cálculo, no un histórico.
  delete from cierre_receptor_lineas where cierre_receptor_id = cr.id;

  insert into cierre_receptor_lineas (
    cierre_receptor_id, canalizacion_id, albaran_id, albaran_tipo, valorizacion,
    producto, mes, kg_neto, municipio, comarca,
    productor_id, productor_nom, productor_nif, retroactiva)
  select cr.id, b.canalizacion_id, b.albaran_id, b.albaran_tipo, b.valorizacion,
         b.producto, b.mes, b.kg_neto, b.municipio, b.comarca,
         b.productor_id, b.productor_nom, b.productor_nif, b.retroactiva
    from public.cierre_base_recepcio(p_desde, p_hasta, p_modo) b
   where b.entidad_id = p_entidad;

  update cierres_receptor c
     set kg_total   = (select coalesce(sum(l.kg_neto), 0) from cierre_receptor_lineas l
                        where l.cierre_receptor_id = c.id),
         kg_donacio = (select coalesce(sum(l.kg_neto), 0) from cierre_receptor_lineas l
                        where l.cierre_receptor_id = c.id and l.valorizacion = 'donacio'),
         kg_compra  = (select coalesce(sum(l.kg_neto), 0) from cierre_receptor_lineas l
                        where l.cierre_receptor_id = c.id and l.valorizacion <> 'donacio'),
         calculado_at = now(),
         -- Copia congelada de la ficha. Sin `provincia`: aquí no hay modelo 182 al que
         -- llevarla, y `provincia_por_cp()` existe para eso.
         datos_fiscales = jsonb_build_object(
           'raó_social', en.nombre,
           'nif', en.nif,
           'domicili', en.direccion,
           'codi_postal', en.codigo_postal,
           'poblacio', en.poblacion,
           'email', en.email),
         bloqueos = (
           select coalesce(jsonb_agg(x), '[]'::jsonb) from (
             -- (a) entregas de la ventana sin conciliar. **Bloquea**: es la garantía «nada
             --     sin conciliar», y evaluada sobre el periodo certificado dice la verdad
             --     también a mitad de año.
             select jsonb_build_object('codigo', 'sense_conciliar', 'bloqueja', true,
                      'detall', pe.canalizaciones::text || ' lliuraments del periode sense conciliar ('
                                || round(pe.kg, 1)::text || ' kg)') as x
               from public.cierre_pendents_recepcio(p_desde, p_hasta) pe
              where pe.entidad_id = p_entidad
             union all
             -- (b) sin albarán conciliado: AVISA, no bloquea. Es el caso de la conciliación
             --     retroactiva, y si bloqueara, los datos de 2026 harían el ensayo
             --     inejecutable — exactamente el argumento de `sense_rec` en el cierre
             --     anual (§4).
             select jsonb_build_object('codigo', 'sense_albara', 'bloqueja', false,
                      'detall', count(*)::text || ' lliuraments sense albara conciliat (ENT/OPE)')
               from cierre_receptor_lineas l
              where l.cierre_receptor_id = c.id and l.albaran_id is null
             having count(*) > 0
             union all
             -- (c) datos de la ficha incompletos: AVISA, no bloquea. El CR no tiene efecto
             --     fiscal y no va a ninguna declaración —mismo criterio que `sense_nif` en
             --     el certificado de transacción—; basta con poder nombrar a la entidad.
             select jsonb_build_object('codigo', 'dades_incompletes', 'bloqueja', false,
                      'detall', 'Falten dades de la fitxa: ' || array_to_string(array_remove(array[
                        case when coalesce(btrim(en.nif), '') = '' then 'NIF' end,
                        case when coalesce(btrim(en.direccion), '') = '' then 'domicili' end,
                        case when coalesce(btrim(en.poblacion), '') = '' then 'poblacio' end],
                        null), ', '))
              where coalesce(btrim(en.nif), '') = ''
                 or coalesce(btrim(en.direccion), '') = ''
                 or coalesce(btrim(en.poblacion), '') = ''
             union all
             -- (d) donaciones sin municipio de origen: AVISA. La tabla de procedencias
             --     saldría con una fila en blanco, que en un certificado queda raro pero no
             --     afirma nada falso.
             select jsonb_build_object('codigo', 'sense_procedencia', 'bloqueja', false,
                      'detall', count(*)::text || ' lliuraments en donacio sense municipi d''origen: '
                                || 'la taula de procedencies sortira incompleta')
               from cierre_receptor_lineas l
              where l.cierre_receptor_id = c.id and l.valorizacion = 'donacio'
                and coalesce(btrim(l.municipio), '') = ''
             having count(*) > 0
             union all
             -- (e) otro certificado de la misma entidad se solapa A MEDIAS con este.
             --     **Bloquea**. Que uno CONTENGA a otro sí se permite —es el caso normal,
             --     «lo de este año a fecha de hoy» repetido— y al emitir el grande el
             --     pequeño queda sustituido. Lo que no cabe es «enero–marzo» y
             --     «febrero–mayo», donde febrero y marzo estarían acreditados dos veces
             --     ante dos terceros sin forma de saberlo.
             select jsonb_build_object('codigo', 'periode_encavalcat', 'bloqueja', true,
                      'detall', 'El certificat ' || string_agg(o.certificado_numero, ', ')
                                || ' cobreix part d''aquest periode sense estar-hi contingut')
               from cierres_receptor o
              where o.entidad_id = p_entidad and o.modo = p_modo
                and o.id <> c.id and o.certificado_numero is not null
                and o.estado <> 'substituit'
                and o.periodo_desde <= p_hasta and o.periodo_hasta >= p_desde
                and not (o.periodo_desde >= p_desde and o.periodo_hasta <= p_hasta)
             having count(*) > 0
           ) b(x))
   where c.id = cr.id
  returning * into cr;

  return cr;
end;
$$;

comment on function public.calcular_certificat_recepcio(uuid, date, date, text) is
  'Calcula lo recibido por una entidad en una ventana y deja el borrador con sus bloqueos. No emite nada.';

-- ---------------------------------------------------------------------------
-- 8. emetre_certificat_recepcio()
-- ---------------------------------------------------------------------------
-- ⚠️ `p_motiu` NO es la excepción de D4 de otros tiempos, ni un parámetro que se acepta y
--    se ignora (§4, deuda 111). Es una **nota interna opcional** —por qué se pidió este
--    certificado— que se guarda en `cierres_receptor.notas` y sale en el retorno. **No se
--    imprime**: un certificado que dijera por qué se emitió estaría afirmando algo sobre
--    quien lo pidió que nadie ha comprobado.
create or replace function public.emetre_certificat_recepcio(
  p_id    uuid,
  p_motiu text default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cr      cierres_receptor%rowtype;
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

  select * into cr from cierres_receptor where id = p_id for update;
  if cr.id is null then
    raise exception 'Aquest certificat de recepcio no existeix' using errcode = '22023';
  end if;
  select * into par from parametros_documentales where id = 1;

  -- (0) Los datos de la Fundación tienen que ser los de verdad **en modo real**
  --     (20260921214526). En prueba se emite: serie `P-CR`, marca de agua y
  --     `destinatariosPrueba`, que es lo que permite recorrer el ciclo entero.
  if cr.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS (CIF %): no es pot emetre cap certificat real. Omple Configuracio i desmarca datos_provisionales.',
      coalesce(par.cif, '(buit)') using errcode = '42501';
  end if;

  if cr.certificado_numero is not null then
    raise exception 'Aquest periode ja te el certificat % (fes servir rectificar_certificat_recepcio)',
      cr.certificado_numero using errcode = '22023';
  end if;
  if cr.calculado_at is null then
    raise exception 'Aquest periode no s''ha calculat encara' using errcode = '22023';
  end if;

  -- (1) Ningún bloqueo bloqueante.
  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cr.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquesta entitat esta bloquejada: %', v_bloq using errcode = '22023';
  end if;

  if cr.kg_total <= 0 then
    raise exception 'Un certificat de 0 quilos no te sentit' using errcode = '22023';
  end if;

  -- (2) Sin plantilla vigente el PDF saldría con el cuerpo provisional del renderizador,
  --     que no dice lo que este documento es ni lo que no es. Se comprueba antes de pedir
  --     número: si faltara, el rollback devolvería el número a la serie, pero es más
  --     honesto no llegar a quemarlo.
  if not exists (select 1 from plantillas_documento p
                  where p.tipo = 'CR' and p.variante is null and p.vigente) then
    raise exception 'No hi ha cap plantilla CR vigent: sense ella el certificat no diria que acredita quilos rebuts'
      using errcode = '22023';
  end if;

  v_dest := public.recepcio_destinatari(p_id);

  v_serie := case when cr.modo = 'prueba' then 'P-CR' else 'CR' end;
  v_n := public.siguiente_numero(v_serie, cr.ejercicio);
  update cierres_receptor
     set certificado_numero = public.formato_numero(v_serie, cr.ejercicio, v_n),
         certificado_at     = now(),
         estado             = 'certificat_emes',
         notas              = coalesce(nullif(btrim(coalesce(p_motiu, '')), ''), notas)
   where id = p_id
  returning * into cr;

  v_doc := public.recepcio_emet_document(
    p_id,
    public.recepcio_datos_certificat(p_id),
    jsonb_build_object(
      'destinatario', v_dest->>'email',
      'nombre', v_dest->>'nom',
      'forzado', v_dest->>'forcat',
      'motiu_destinatari', v_dest->>'motiu',
      'asunto', 'Certificat de recepcio ' || to_char(cr.periodo_desde, 'DD/MM/YYYY')
                || ' — ' || to_char(cr.periodo_hasta, 'DD/MM/YYYY') || ' · ' || cr.certificado_numero,
      'plantilla', 'certificat_recepcio'));

  -- Los certificados anteriores de la misma entidad CONTENIDOS en esta ventana quedan
  -- sustituidos: lo que este documento dice incluye lo que decían ellos, y dos papeles
  -- vigentes con kilos solapados es el doble conteo que hay que evitar.
  update cierres_receptor o
     set estado = 'substituit', sustituido_at = now(), sustituido_por = p_id
   where o.entidad_id = cr.entidad_id and o.modo = cr.modo
     and o.id <> p_id and o.certificado_numero is not null
     and o.estado <> 'substituit'
     and o.periodo_desde >= cr.periodo_desde and o.periodo_hasta <= cr.periodo_hasta;
  get diagnostics v_subs = row_count;

  update documentos d
     set vigente = false, sustituido_por = v_doc
   where d.objeto_tipo = 'cierre_receptor' and d.vigente and d.id <> v_doc
     and d.objeto_id in (select o.id from cierres_receptor o
                          where o.sustituido_por = p_id);

  return jsonb_build_object('document', v_doc, 'numero', cr.certificado_numero,
                            'data', cr.certificado_at,
                            'kg', cr.kg_total,
                            'kg_donacio', cr.kg_donacio, 'kg_compra', cr.kg_compra,
                            'destinatari', v_dest,
                            'periode', jsonb_build_object('des_de', cr.periodo_desde,
                                                          'fins_a', cr.periodo_hasta),
                            'substitueix', v_subs,
                            'motiu', cr.notas);
end;
$$;

comment on function public.emetre_certificat_recepcio(uuid, text) is
  'Emite el certificado de recepción de una ventana. datos_provisionales solo bloquea el modo real. p_motiu es una nota INTERNA que no se imprime.';

-- ---------------------------------------------------------------------------
-- 9. rectificar_certificat_recepcio()
-- ---------------------------------------------------------------------------
-- Una rectificación **no consume número nuevo**: es la versión siguiente del mismo `CR`, y
-- la anterior queda `vigente = false`. No recalcula las líneas por sí misma —para eso está
-- `calcular_certificat_recepcio()` sobre el borrador— porque una fila ya numerada no puede
-- volver a serlo: quien rectifica tiene que saber qué cambia.
create or replace function public.rectificar_certificat_recepcio(p_id uuid, p_motiu text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cr     cierres_receptor%rowtype;
  par    parametros_documentales%rowtype;
  v_doc  uuid;
  v_dest jsonb;
  v_bloq text;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar rectifica un certificat' using errcode = '42501';
  end if;
  if coalesce(btrim(p_motiu), '') = '' then
    raise exception 'Una rectificacio necessita motiu' using errcode = '22023';
  end if;

  select * into cr from cierres_receptor where id = p_id for update;
  if cr.id is null then
    raise exception 'Aquest certificat de recepcio no existeix' using errcode = '22023';
  end if;
  if cr.certificado_numero is null then
    raise exception 'Aquest periode encara no te certificat' using errcode = '22023';
  end if;
  if cr.estado = 'substituit' then
    raise exception 'Aquest periode ja esta substituit: rectifica el certificat que el va substituir'
      using errcode = '22023';
  end if;

  select * into par from parametros_documentales where id = 1;
  if cr.modo = 'real' and coalesce(par.datos_provisionales, true) then
    raise exception 'Les dades de la Fundacio son PROVISIONALS: no es pot emetre cap certificat real'
      using errcode = '42501';
  end if;

  select string_agg(b->>'detall', '; ') into v_bloq
    from jsonb_array_elements(cr.bloqueos) b where (b->>'bloqueja')::boolean;
  if v_bloq is not null then
    raise exception 'Aquesta entitat esta bloquejada: %', v_bloq using errcode = '22023';
  end if;

  update cierres_receptor
     set rectificaciones = rectificaciones + 1,
         certificado_at  = now(),
         estado          = 'certificat_emes'
   where id = p_id
  returning * into cr;

  v_dest := public.recepcio_destinatari(p_id);
  v_doc := public.recepcio_emet_document(
    p_id,
    public.recepcio_datos_certificat(p_id) || jsonb_build_object('motiu_rectificacio', p_motiu),
    jsonb_build_object('destinatario', v_dest->>'email', 'nombre', v_dest->>'nom',
                       'forzado', v_dest->>'forcat', 'motiu_destinatari', v_dest->>'motiu',
                       'asunto', 'Certificat de recepcio RECTIFICAT — ' || cr.certificado_numero,
                       'plantilla', 'certificat_recepcio'));

  return jsonb_build_object('document', v_doc, 'numero', cr.certificado_numero,
                            'versio', cr.rectificaciones + 1, 'motiu', p_motiu);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. marcar_enviat_recepcio()
-- ---------------------------------------------------------------------------
create or replace function public.marcar_enviat_recepcio(p_id uuid)
returns cierres_receptor
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  cr cierres_receptor%rowtype;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar marca un certificat com a enviat' using errcode = '42501';
  end if;
  update cierres_receptor
     set estado = 'enviat', enviado_at = now()
   where id = p_id and estado = 'certificat_emes'
  returning * into cr;
  if cr.id is null then
    raise exception 'Nomes s''envia un certificat ja emes' using errcode = '22023';
  end if;
  return cr;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. reiniciar_recepcions_prova(): repetir el ensayo
-- ---------------------------------------------------------------------------
-- Gemela de `reiniciar_periodes_prova()`. **No toca ni una canalización ni un albarán**:
-- borra los resultados del ensayo —filas, líneas y documentos en modo prueba— y devuelve el
-- contador `P-CR` del ejercicio a 0.
--
-- ⚠️ `set_config(..., is_local => true)` es lo que abre la única excepción a
--    `documentos_no_esborrar`, y `true` significa «solo dentro de esta transacción»: el
--    interruptor no se puede dejar encendido.
--
-- ⚠️ Los PDF quedan en Storage: SQL no los puede retirar. Los limpia la Edge Function
--    `limpiar-documentos-prueba`, que es la otra mitad de este botón (§12.51).
create or replace function public.reiniciar_recepcions_prova(p_ejercicio int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ej   int;
  v_docs int;
  v_lin  int;
  v_fil  int;
begin
  if auth.uid() is not null and not public.pot_aprovar() then
    raise exception 'Nomes qui pot aprovar reinicia una prova' using errcode = '42501';
  end if;

  v_ej := coalesce(p_ejercicio, extract(year from (now() at time zone 'Europe/Madrid'))::int);

  perform set_config('redestina.reinicio_prueba', 'on', true);

  delete from documentos
   where objeto_tipo = 'cierre_receptor'
     and objeto_id in (select id from cierres_receptor
                        where modo = 'prueba' and ejercicio = v_ej);
  get diagnostics v_docs = row_count;

  delete from cierre_receptor_lineas
   where cierre_receptor_id in (select id from cierres_receptor
                                 where modo = 'prueba' and ejercicio = v_ej);
  get diagnostics v_lin = row_count;

  delete from cierres_receptor where modo = 'prueba' and ejercicio = v_ej;
  get diagnostics v_fil = row_count;

  update series_documentales set ultimo = 0
   where ejercicio = v_ej and serie = 'P-CR';

  return jsonb_build_object('exercici', v_ej, 'documents', v_docs, 'linies', v_lin,
                            'certificats', v_fil,
                            'canalitzacions', (select count(*) from canalizaciones),
                            'albarans', (select count(*) from albaranes));
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. EXECUTE: quitar el PUBLIC por defecto y conceder lo justo
-- ---------------------------------------------------------------------------
-- ⚠️ `create function` concede EXECUTE a PUBLIC. Sin estos revoke, `anon` podría emitir
--    certificados sin ni siquiera tener sesión.
do $$
declare f text;
begin
  -- Acciones del equipo y lecturas: comprueban `pot_aprovar()` / `es_intern()` por dentro,
  -- y el arnés verifica que un externo se lleva un 42501.
  foreach f in array array[
    'cierre_base_recepcio(date,date,text)',
    'cierre_pendents_recepcio(date,date)',
    'calcular_certificat_recepcio(uuid,date,date,text)',
    'emetre_certificat_recepcio(uuid,text)',
    'rectificar_certificat_recepcio(uuid,text)',
    'marcar_enviat_recepcio(uuid)',
    'reiniciar_recepcions_prova(int)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;

  -- El acumulado del panel: lo llama la propia receptora, y es `security invoker`, así que
  -- la RLS ya decide qué ve. `anon` fuera, como todo.
  execute 'revoke execute on function public.kg_rebuts_exercici(int,uuid) from public, anon';
  execute 'grant execute on function public.kg_rebuts_exercici(int,uuid) to authenticated, service_role';

  -- Internas de la emisión: `authenticated` no las ve ni existiendo. El snapshot lleva
  -- datos de la Fundación; el destinatario decide a quién se escribe; y
  -- `recepcio_emet_document` inserta en `documentos`, que es justamente lo que la ausencia
  -- de GRANT de escritura impide.
  foreach f in array array[
    'recepcio_datos_certificat(uuid)',
    'recepcio_destinatari(uuid)',
    'recepcio_emet_document(uuid,jsonb,jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Verificación:
--   select * from public.cierre_base_recepcio('2026-01-01', '2026-09-30', 'prueba');
--   select * from public.kg_rebuts_exercici(2026);                       -- con sesión de receptora
--   select public.calcular_certificat_recepcio('<entidad>', '2026-01-01', '2026-09-30', 'prueba');
--   select public.emetre_certificat_recepcio('<cr>', 'memoria anual de l''entitat');
--   select public.recepcio_datos_certificat('<cr>')::text ilike '%valor%';   -- f (sin importes)
--   select public.reiniciar_recepcions_prova(2026);
-- Y con una sesión de productor o de entidad, por PostgREST:
--   select * from public.cierre_base_recepcio('1999-01-01','1999-12-31','prueba');  -- 42501
