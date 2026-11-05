-- El texto del certificado de donación según el modelo de la Fundació (05-11-2026).
--
-- Plan «Certificat de donació según el modelo de Tabaquet», bloque 1. El modelo
-- (`Certificat_Donacio_Tabaquet.pdf`, Drive › 1. Fuentes › Certificats donacio) pasa a ser
-- la ÚNICA plantilla del certificado de donación, para los tres ámbitos:
--
--   · `CD` sin variante → el anual (`cierres_donante`). Hasta hoy NO había ninguna plantilla
--     `CD` vigente sin variante, y el CD anual se imprimía con el cuerpo provisional del
--     renderizador.
--   · `CD` / `parcial` → el certificado a demanda, de periodo o de oferta
--     (`cierres_periodo`). Sustituye a la versión 1 «[ESBORRANY]» de 20270303100200.
--
-- Mismo texto en las dos: lo que cambia entre ámbitos («durant l'exercici …» o «durant el
-- període …») lo compone el módulo puro `_shared/certificatDonacio.ts` en el marcador del
-- periodo, igual que la naturaleza del donante (física o jurídica, por el NIF), la frase
-- de la factura (solo si la hay), el importe en letras y la fecha de expedición. Los
-- marcadores de este fichero son exactamente los de `MARCADORS_CERTIFICAT` de ese módulo:
-- `tests/certificatDonacio.test.ts` lee este fichero (por el nombre) y lo comprueba. Por
-- eso este comentario no escribe ninguno entre llaves.
--
-- Las versiones anteriores pasan a `vigente = false` y NO se borran: una plantilla que ya
-- ha emitido algo es inmutable (`plantillas_inmutables`, `plantillas_no_esborrar`), y
-- `vigente` es lo único que se puede cambiar de ella. El índice `plantillas_vigente_uidx`
-- obliga a retirar antes de insertar.
--
-- Idempotente: si la versión con este mismo cuerpo ya existe, no se inserta otra.

do $plantilles$
declare
  v_ca jsonb := $j$[
    {"tipo": "p", "text": "{{apoderada.nom}}, amb DNI {{apoderada.dni}}, com {{apoderada.carrec}} de la {{fundacio.rao_social}}, amb CIF {{fundacio.cif}} i domicili social al {{fundacio.domicili}}, {{fundacio.codi_postal}} de {{fundacio.poblacio}}, {{fundacio.inscripcio}}."},
    {"tipo": "p", "text": "CERTIFICA:"},
    {"tipo": "p", "text": "Primer.- Que, durant {{periode.text}}, la persona {{donant.naturalesa}} donant {{donant.rao_social_maj}}, amb NIF {{donant.nif}}, ha lliurat a la {{fundacio.rao_social_maj}}, en concepte de donatiu pur i simple, amb caràcter irrevocable, {{kg}} kg de productes alimentaris{{factura.frase}}. Aquesta donació té un valor econòmic de {{import_lletres_maj}} ({{import_xifres}}) a efectes fiscals."},
    {"tipo": "p", "text": "Segon.- Que el lliurament del bé donat s'acredita mitjançant aquest document."},
    {"tipo": "p", "text": "Tercer.- Que els aliments donats seran destinats a contribuir a obres socials."},
    {"tipo": "p", "text": "Quart.- Que aquesta donació dóna dret a aplicar els incentius fiscals previstos a la Llei 49/2002, de 23 de desembre, de règim fiscal de les entitats sense afany de lucre i dels incentius fiscals del mecenatge."},
    {"tipo": "p", "text": "A aquests efectes es fa constar que l'entitat donatària es troba inclosa entre les regulades a l'article 16 de la Llei 49/2002."},
    {"tipo": "p", "text": "I perquè així consti, i als efectes oportuns, expedeixo el present certificat a {{lloc}}, {{data_expedicio}}."}
  ]$j$::jsonb;
  v_es jsonb := $j$[
    {"tipo": "p", "text": "{{apoderada.nom}}, con DNI {{apoderada.dni}}, como {{apoderada.carrec}} de la {{fundacio.rao_social}}, con CIF {{fundacio.cif}} y domicilio social en {{fundacio.domicili}}, {{fundacio.codi_postal}} de {{fundacio.poblacio}}, {{fundacio.inscripcio}}."},
    {"tipo": "p", "text": "CERTIFICA:"},
    {"tipo": "p", "text": "Primero.- Que, durante {{periode.text}}, la persona {{donant.naturalesa}} donante {{donant.rao_social_maj}}, con NIF {{donant.nif}}, ha entregado a la {{fundacio.rao_social_maj}}, en concepto de donativo puro y simple, con carácter irrevocable, {{kg}} kg de productos alimentarios{{factura.frase}}. Esta donación tiene un valor económico de {{import_lletres_maj}} ({{import_xifres}}) a efectos fiscales."},
    {"tipo": "p", "text": "Segundo.- Que la entrega del bien donado se acredita mediante este documento."},
    {"tipo": "p", "text": "Tercero.- Que los alimentos donados se destinarán a contribuir a obras sociales."},
    {"tipo": "p", "text": "Cuarto.- Que esta donación da derecho a aplicar los incentivos fiscales previstos en la Ley 49/2002, de 23 de diciembre, de régimen fiscal de las entidades sin fines lucrativos y de los incentivos fiscales al mecenazgo."},
    {"tipo": "p", "text": "A estos efectos se hace constar que la entidad donataria se encuentra incluida entre las reguladas en el artículo 16 de la Ley 49/2002."},
    {"tipo": "p", "text": "Y para que así conste, y a los efectos oportunos, expido el presente certificado en {{lloc}}, a {{data_expedicio}}."}
  ]$j$::jsonb;
  v_marcadors text[] := array[
    'apoderada.nom', 'apoderada.dni', 'apoderada.carrec',
    'fundacio.rao_social', 'fundacio.rao_social_maj', 'fundacio.cif', 'fundacio.domicili',
    'fundacio.codi_postal', 'fundacio.poblacio', 'fundacio.inscripcio',
    'periode.text', 'donant.naturalesa', 'donant.rao_social_maj', 'donant.nif',
    'kg', 'factura.frase', 'import_lletres_maj', 'import_xifres', 'lloc', 'data_expedicio'];
  r record;
begin
  for r in
    select * from (values
      (null::text, 'ca', 'CERTIFICAT DE DONACIÓ',   v_ca),
      (null::text, 'es', 'CERTIFICADO DE DONACIÓN', v_es),
      ('parcial',  'ca', 'CERTIFICAT DE DONACIÓ',   v_ca),
      ('parcial',  'es', 'CERTIFICADO DE DONACIÓN', v_es)
    ) as t(variante, idioma, titulo, cuerpo)
  loop
    -- ¿Ya está publicada esta versión? Entonces solo se asegura que sea la vigente.
    if exists (select 1 from plantillas_documento p
                where p.tipo = 'CD' and p.variante is not distinct from r.variante
                  and p.idioma = r.idioma and p.titulo = r.titulo and p.cuerpo = r.cuerpo
                  and p.vigente) then
      continue;
    end if;

    -- Retirar la vigente (si la hay) antes de insertar: el índice solo admite una.
    update plantillas_documento p
       set vigente = false
     where p.tipo = 'CD' and p.variante is not distinct from r.variante
       and p.idioma = r.idioma and p.vigente;

    insert into plantillas_documento (tipo, variante, idioma, version, titulo, cuerpo,
                                      marcadores, vigente, valida_desde)
    values ('CD', r.variante, r.idioma,
            coalesce((select max(p.version) from plantillas_documento p
                       where p.tipo = 'CD' and p.variante is not distinct from r.variante
                         and p.idioma = r.idioma), 0) + 1,
            r.titulo, r.cuerpo, v_marcadors, true,
            (now() at time zone 'Europe/Madrid')::date);
  end loop;
end;
$plantilles$;
