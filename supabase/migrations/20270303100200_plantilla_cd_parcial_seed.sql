-- El texto del certificado de donación **a demanda** (variante `parcial` del tipo `CD`).
--
-- POR QUÉ ESTA MIGRACIÓN EXISTE. El requisito de negocio no es solo poder emitir un
-- certificado a mitad de año: es que **el papel diga de qué es**. Un certificado con
-- efecto en el modelo 182 cubre el año natural; uno emitido a fecha intermedia acredita lo
-- entregado hasta esa fecha, no sustituye al anual y no sirve para la declaración. Eso va
-- en el **cuerpo** del documento —no como marca de agua: no es un borrador, es un
-- documento válido de otra cosa—, y el cuerpo de un documento entra por
-- `plantillas_documento`, que es el único camino que tiene el renderizador para imprimir
-- prosa distinta sin cambiar de código (`_shared/pdf/render/cd.ts` no se toca).
--
-- ⚠️⚠️ ESTE TEXTO **NO** ESTÁ VALIDADO POR LA ASESORÍA JURÍDICA DE LA FUNDACIÓ.
--
-- Es texto de trabajo, escrito por la consultoría a partir del cuerpo provisional que ya
-- imprime el renderizador (`CUERPO_PROVISIONAL` en `cd.ts`) más el párrafo de alcance. Se
-- siembra igual, por el mismo motivo que las seis plantillas de convenio (20270111100200):
-- sin plantilla vigente no habría forma de que el aviso de alcance saliera impreso, y un
-- certificado parcial que no diga que es parcial es peor que no tenerlo.
--
-- Se marca como borrador de tres maneras, como allí: primer bloque en mayúsculas, título
-- con `[ESBORRANY]` (sale en el listado de plantillas del panel) y bloque final. Y además
-- `emitir_certificado_periodo()` se niega mientras `parametros_documentales.datos_provisionales`
-- valga `true`, igual que el anual.
--
-- CÓMO SE SUSTITUYE cuando llegue el texto validado, y **no** editando estas filas (el
-- trigger `plantillas_inmutables` lo impide en cuanto hayan emitido algo):
--   1. Publicar la versión 2 desde la pantalla de plantillas.
--   2. Retirar la versión 1 (`vigente = false`). El índice parcial deja pasar solo una.
--   3. Los certificados ya emitidos **no cambian**: llevan su snapshot en `documentos.datos`.
--
-- ⚠️ LOS MARCADORES NO SON LIBRES. Son exactamente los que `renderCd()` compone en su
--    objeto `valores` (claves ASCII: el snapshot trae `raó_social` y el renderizador lo
--    traduce a `donant.rao_social`). Un marcador que no exista ahí **no se sustituye por
--    vacío**: queda visible en el PDF y sale en `faltan`.

insert into plantillas_documento (tipo, variante, idioma, version, titulo, cuerpo, marcadores)
values

-- ===========================================================================
-- català
-- ===========================================================================
('CD', 'parcial', 'ca', 1,
 '[ESBORRANY] Certificat de donació — període parcial',
 $json$[
  {"tipo":"p","text":"⚠️ ESBORRANY DE TREBALL — TEXT PENDENT DE VALIDACIÓ PER L'ASSESSORIA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS."},

  {"tipo":"p","text":"Que {{donant.rao_social}}, amb NIF {{donant.nif}} i domicili a {{donant.domicili}}, ha lliurat a {{fundacio.rao_social}}, amb CIF {{fundacio.cif}}, aliments fora del circuit de venda habitual durant el període comprès entre {{periode.des_de_art}} i {{periode.fins_a_art}}."},
  {"tipo":"p","text":"Que aquest lliurament té caràcter de donació pura, simple i irrevocable, feta a títol gratuït, sense contraprestació de cap mena i sense que el donant hagi rebut ni hagi de rebre cap pagament ni cap bé o servei a canvi."},
  {"tipo":"p","text":"Que els aliments donats dins d'aquest període sumen {{kg}} quilos nets conciliats, valorats en {{import_lletres}} ({{import_xifres}}), d'acord amb el cost per quilo de cada producte fixat per a l'exercici {{exercici}}."},
  {"tipo":"p","text":"Que els aliments s'han rebut efectivament i s'han destinat íntegrament a les finalitats d'interès general de la Fundació, per fer-los arribar a entitats socials."},

  {"tipo":"h3","text":"Abast d'aquest certificat"},
  {"tipo":"p","text":"Que aquest certificat té un ABAST PARCIAL: acredita exclusivament els lliuraments compresos entre {{periode.des_de_art}} i {{periode.fins_a_art}}, i NO cobreix l'any natural complet."},
  {"tipo":"p","text":"Que, en conseqüència, NO substitueix el certificat anual de donacions ni és vàlid als efectes de la declaració informativa anual (model 182). La Fundació inclourà les donacions de l'exercici {{exercici}} en aquella declaració a partir del certificat anual, que emetrà un cop tancat l'exercici; els quilos i l'import que consten aquí hi quedaran integrats, sense comptar-se dues vegades."},
  {"tipo":"p","text":"Que les deduccions previstes a l'article 16 de la Llei 49/2002, de 23 de desembre, de règim fiscal de les entitats sense fins lucratius i dels incentius fiscals al mecenatge, s'apliquen sobre el certificat anual corresponent a l'exercici {{exercici}}."},

  {"tipo":"p","text":"I perquè així consti, s'expedeix aquest certificat de període amb número {{numero}} i codi de verificació {{codi}}."},

  {"tipo":"p","text":"⚠️ ESBORRANY DE TREBALL — TEXT PENDENT DE VALIDACIÓ PER L'ASSESSORIA JURÍDICA."}
 ]$json$::jsonb,
 array['numero','exercici','codi','kg','import_xifres','import_lletres',
       'donant.rao_social','donant.nif','donant.domicili',
       'fundacio.rao_social','fundacio.cif','fundacio.domicili',
       'periode.des_de_art','periode.fins_a_art']),

-- ===========================================================================
-- castellano
-- ===========================================================================
('CD', 'parcial', 'es', 1,
 '[BORRADOR] Certificado de donación — periodo parcial',
 $json$[
  {"tipo":"p","text":"⚠️ BORRADOR DE TRABAJO — TEXTO PENDIENTE DE VALIDACIÓN POR LA ASESORÍA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS."},

  {"tipo":"p","text":"Que {{donant.rao_social}}, con NIF {{donant.nif}} y domicilio en {{donant.domicili}}, ha entregado a {{fundacio.rao_social}}, con CIF {{fundacio.cif}}, alimentos fuera del circuito de venta habitual durante el periodo comprendido entre {{periode.des_de_art}} y {{periode.fins_a_art}}."},
  {"tipo":"p","text":"Que esta entrega tiene carácter de donación pura, simple e irrevocable, hecha a título gratuito, sin contraprestación de ningún tipo y sin que el donante haya recibido ni deba recibir ningún pago ni ningún bien o servicio a cambio."},
  {"tipo":"p","text":"Que los alimentos donados dentro de este periodo suman {{kg}} kilos netos conciliados, valorados en {{import_lletres}} ({{import_xifres}}), de acuerdo con el coste por kilo de cada producto fijado para el ejercicio {{exercici}}."},
  {"tipo":"p","text":"Que los alimentos se han recibido efectivamente y se han destinado íntegramente a los fines de interés general de la Fundación, para hacerlos llegar a entidades sociales."},

  {"tipo":"h3","text":"Alcance de este certificado"},
  {"tipo":"p","text":"Que este certificado tiene un ALCANCE PARCIAL: acredita exclusivamente las entregas comprendidas entre {{periode.des_de_art}} y {{periode.fins_a_art}}, y NO cubre el año natural completo."},
  {"tipo":"p","text":"Que, en consecuencia, NO sustituye al certificado anual de donaciones ni es válido a efectos de la declaración informativa anual (modelo 182). La Fundación incluirá las donaciones del ejercicio {{exercici}} en esa declaración a partir del certificado anual, que emitirá una vez cerrado el ejercicio; los kilos y el importe que constan aquí quedarán integrados en él, sin contarse dos veces."},
  {"tipo":"p","text":"Que las deducciones previstas en el artículo 16 de la Ley 49/2002, de 23 de diciembre, de régimen fiscal de las entidades sin fines lucrativos y de los incentivos fiscales al mecenazgo, se aplican sobre el certificado anual correspondiente al ejercicio {{exercici}}."},

  {"tipo":"p","text":"Y para que así conste, se expide este certificado de periodo con número {{numero}} y código de verificación {{codi}}."},

  {"tipo":"p","text":"⚠️ BORRADOR DE TRABAJO — TEXTO PENDIENTE DE VALIDACIÓN POR LA ASESORÍA JURÍDICA."}
 ]$json$::jsonb,
 array['numero','exercici','codi','kg','import_xifres','import_lletres',
       'donant.rao_social','donant.nif','donant.domicili',
       'fundacio.rao_social','fundacio.cif','fundacio.domicili',
       'periode.des_de_art','periode.fins_a_art'])

on conflict do nothing;

-- Verificación:
--   select tipo, variante, idioma, version, vigente, titulo from plantillas_documento
--    where tipo = 'CD' order by coalesce(variante,''), idioma;
--   -- y que el certificado ANUAL sigue sin plantilla (no hay `variante is null` vigente):
--   select count(*) from plantillas_documento where tipo='CD' and variante is null and vigente;  -- 0
