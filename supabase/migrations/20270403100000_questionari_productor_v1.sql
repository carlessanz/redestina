-- El cuestionario de diagnóstico del PRODUCTOR, versión 1 (revisión funcional del 23-09-2026).
--
-- La revisión trae por fin el contenido del cuestionario —lo que §1bis llamaba «anexo B,
-- material de la fase 0»—, en cuatro bloques: A. Producció, B. Generació de l'excedent,
-- C. Gestió actual, D. Necessitats i oportunitats. Sustituye a la versión 0, que era texto de
-- trabajo de la consultoría.
--
-- ⚠️ SE PUBLICA, NO SE EDITA: `publicar_questionari()` crea la versión siguiente y retira la
--    anterior en la misma transacción. Los diagnósticos y planes hechos con la versión 0
--    siguen siendo lo que eran: guardan su cuestionario autocontenido (§4).
-- ⚠️ SIGUE MARCADO COMO PROVISIONAL (`p_provisional => true`), y el PDF lo dice: las
--    categorías de «Quin suport necessiteu» vienen del Airtable de la Fundació, que no
--    tenemos, y aquí van unas de trabajo. Se desmarca publicando la versión 2 con esa lista.
-- ⚠️ ADAPTACIONES QUE EL MOTOR OBLIGA A HACER, dichas para que se puedan revisar:
--      · «Selección de nuestra lista de productos» → las 12 FAMILIAS del catálogo (la lista
--        de 90 productos es inmanejable como casillas en un móvil).
--      · «Los principales, de los anteriores» y «los que generan más excedente, de los ya
--        introducidos» → la misma lista de familias: el motor no construye opciones a
--        partir de otra respuesta.
--      · «Volum anual per producte» → un único volumen anual total, en kg.
--      · «Temporalitat» → los doce meses como selección múltiple.
-- ⚠️ IDENTIFICADORES CONSERVADOS a propósito donde la pregunta es la misma (`causes`,
--    `canals_actuals`, `volum_anual_perdut`, `transport_propi`, `registre_quantitats`): sus
--    reglas del plan siguen valiendo tal cual.

do $$
declare
  r jsonb;
begin
  r := public.publicar_questionari(
    'productor',
    $t${"ca": "Diagnòstic de l'explotació", "es": "Diagnóstico de la explotación"}$t$::jsonb,
    $q$[
      {"id": "productes", "tipus": "multi", "seccio": "produccio", "obligatoria": true,
       "prefill": "productores.productos_habituales",
       "etiqueta": {"ca": "Quins productes produïu?", "es": "¿Qué productos producís?"},
       "ajuda": {"ca": "Marca totes les famílies que calgui.", "es": "Marca todas las familias que hagan falta."},
       "opcions": [
         {"valor": "fruita_dolca", "etiqueta": {"ca": "Fruita dolça", "es": "Fruta dulce"}},
         {"valor": "citrics", "etiqueta": {"ca": "Cítrics", "es": "Cítricos"}},
         {"valor": "fruita_vermella", "etiqueta": {"ca": "Fruita vermella", "es": "Frutos rojos"}},
         {"valor": "fruita_exotica", "etiqueta": {"ca": "Fruita exòtica", "es": "Fruta exótica"}},
         {"valor": "fruita_seca", "etiqueta": {"ca": "Fruita seca", "es": "Fruto seco"}},
         {"valor": "horta_fulla", "etiqueta": {"ca": "Horta de fulla", "es": "Hortaliza de hoja"}},
         {"valor": "horta_fruit", "etiqueta": {"ca": "Horta de fruit", "es": "Hortaliza de fruto"}},
         {"valor": "horta_flor", "etiqueta": {"ca": "Horta de flor", "es": "Hortaliza de flor"}},
         {"valor": "tuberculs", "etiqueta": {"ca": "Tubercles, bulbs i arrels", "es": "Tubérculos, bulbos y raíces"}},
         {"valor": "bolets", "etiqueta": {"ca": "Bolets", "es": "Setas"}},
         {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}
       ]},
      {"id": "productes_principals", "tipus": "multi", "seccio": "produccio", "obligatoria": false,
       "etiqueta": {"ca": "Quins són els principals?", "es": "¿Cuáles son los principales?"},
       "ajuda": {"ca": "Dels que has marcat, els que més pesen a l'explotació.", "es": "De los que has marcado, los que más pesan en la explotación."},
       "opcions": [
         {"valor": "fruita_dolca", "etiqueta": {"ca": "Fruita dolça", "es": "Fruta dulce"}},
         {"valor": "citrics", "etiqueta": {"ca": "Cítrics", "es": "Cítricos"}},
         {"valor": "fruita_vermella", "etiqueta": {"ca": "Fruita vermella", "es": "Frutos rojos"}},
         {"valor": "fruita_exotica", "etiqueta": {"ca": "Fruita exòtica", "es": "Fruta exótica"}},
         {"valor": "fruita_seca", "etiqueta": {"ca": "Fruita seca", "es": "Fruto seco"}},
         {"valor": "horta_fulla", "etiqueta": {"ca": "Horta de fulla", "es": "Hortaliza de hoja"}},
         {"valor": "horta_fruit", "etiqueta": {"ca": "Horta de fruit", "es": "Hortaliza de fruto"}},
         {"valor": "horta_flor", "etiqueta": {"ca": "Horta de flor", "es": "Hortaliza de flor"}},
         {"valor": "tuberculs", "etiqueta": {"ca": "Tubercles, bulbs i arrels", "es": "Tubérculos, bulbos y raíces"}},
         {"valor": "bolets", "etiqueta": {"ca": "Bolets", "es": "Setas"}},
         {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}
       ]},
      {"id": "volum_anual", "tipus": "numero", "seccio": "produccio", "obligatoria": false,
       "etiqueta": {"ca": "Volum aproximat de producció a l'any (kg)", "es": "Volumen aproximado de producción al año (kg)"},
       "ajuda": {"ca": "Una estimació val. En tones, multiplica per 1.000.", "es": "Una estimación vale. En toneladas, multiplica por 1.000."}},
      {"id": "temporalitat", "tipus": "multi", "seccio": "produccio", "obligatoria": false,
       "etiqueta": {"ca": "En quins mesos teniu producció?", "es": "¿En qué meses tenéis producción?"},
       "opcions": [
         {"valor": "gen", "etiqueta": {"ca": "Gener", "es": "Enero"}},
         {"valor": "feb", "etiqueta": {"ca": "Febrer", "es": "Febrero"}},
         {"valor": "mar", "etiqueta": {"ca": "Març", "es": "Marzo"}},
         {"valor": "abr", "etiqueta": {"ca": "Abril", "es": "Abril"}},
         {"valor": "mai", "etiqueta": {"ca": "Maig", "es": "Mayo"}},
         {"valor": "jun", "etiqueta": {"ca": "Juny", "es": "Junio"}},
         {"valor": "jul", "etiqueta": {"ca": "Juliol", "es": "Julio"}},
         {"valor": "ago", "etiqueta": {"ca": "Agost", "es": "Agosto"}},
         {"valor": "set", "etiqueta": {"ca": "Setembre", "es": "Septiembre"}},
         {"valor": "oct", "etiqueta": {"ca": "Octubre", "es": "Octubre"}},
         {"valor": "nov", "etiqueta": {"ca": "Novembre", "es": "Noviembre"}},
         {"valor": "des", "etiqueta": {"ca": "Desembre", "es": "Diciembre"}}
       ]},
      {"id": "volum_anual_perdut", "tipus": "opcio", "seccio": "produccio", "obligatoria": true,
       "etiqueta": {"ca": "Quants quilos queden fora del circuit cada any, aproximadament?", "es": "¿Cuántos kilos quedan fuera del circuito cada año, aproximadamente?"},
       "ajuda": {"ca": "Si no ho saps, digues-ho: també és una resposta.", "es": "Si no lo sabes, dilo: también es una respuesta."},
       "opcions": [
         {"valor": "menys_1000", "etiqueta": {"ca": "Menys de 1.000 kg", "es": "Menos de 1.000 kg"}},
         {"valor": "1000_5000", "etiqueta": {"ca": "Entre 1.000 i 5.000 kg", "es": "Entre 1.000 y 5.000 kg"}},
         {"valor": "5000_20000", "etiqueta": {"ca": "Entre 5.000 i 20.000 kg", "es": "Entre 5.000 y 20.000 kg"}},
         {"valor": "mes_20000", "etiqueta": {"ca": "Més de 20.000 kg", "es": "Más de 20.000 kg"}},
         {"valor": "no_ho_se", "etiqueta": {"ca": "No ho sé", "es": "No lo sé"}}
       ]},
      {"id": "productes_excedent", "tipus": "multi", "seccio": "produccio", "obligatoria": false,
       "etiqueta": {"ca": "Quins productes generen més excedent?", "es": "¿Qué productos generan más excedente?"},
       "opcions": [
         {"valor": "fruita_dolca", "etiqueta": {"ca": "Fruita dolça", "es": "Fruta dulce"}},
         {"valor": "citrics", "etiqueta": {"ca": "Cítrics", "es": "Cítricos"}},
         {"valor": "fruita_vermella", "etiqueta": {"ca": "Fruita vermella", "es": "Frutos rojos"}},
         {"valor": "fruita_exotica", "etiqueta": {"ca": "Fruita exòtica", "es": "Fruta exótica"}},
         {"valor": "fruita_seca", "etiqueta": {"ca": "Fruita seca", "es": "Fruto seco"}},
         {"valor": "horta_fulla", "etiqueta": {"ca": "Horta de fulla", "es": "Hortaliza de hoja"}},
         {"valor": "horta_fruit", "etiqueta": {"ca": "Horta de fruit", "es": "Hortaliza de fruto"}},
         {"valor": "horta_flor", "etiqueta": {"ca": "Horta de flor", "es": "Hortaliza de flor"}},
         {"valor": "tuberculs", "etiqueta": {"ca": "Tubercles, bulbs i arrels", "es": "Tubérculos, bulbos y raíces"}},
         {"valor": "bolets", "etiqueta": {"ca": "Bolets", "es": "Setas"}},
         {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}
       ]},
      {"id": "causes", "tipus": "multi", "seccio": "generacio", "obligatoria": true,
       "etiqueta": {"ca": "Per quins motius queda fora del circuit?", "es": "¿Por qué motivos queda fuera del circuito?"},
       "ajuda": {"ca": "Marca'n tots els que calgui.", "es": "Marca todos los que hagan falta."},
       "opcions": [
         {"valor": "calibre", "etiqueta": {"ca": "Calibre", "es": "Calibre"}},
         {"valor": "estetic", "etiqueta": {"ca": "Aspecte o defecte estètic", "es": "Aspecto o defecto estético"}},
         {"valor": "excedent_produccio", "etiqueta": {"ca": "Sobreproducció", "es": "Sobreproducción"}},
         {"valor": "preu_mercat", "etiqueta": {"ca": "Preu de mercat", "es": "Precio de mercado"}},
         {"valor": "cancellacio_comanda", "etiqueta": {"ca": "Comandes anul·lades", "es": "Pedidos anulados"}},
         {"valor": "meteorologia", "etiqueta": {"ca": "Meteorologia", "es": "Meteorología"}},
         {"valor": "plaga", "etiqueta": {"ca": "Plagues o malalties", "es": "Plagas o enfermedades"}},
         {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}
       ]},
      {"id": "lloc_generacio", "tipus": "opcio", "seccio": "generacio", "obligatoria": true,
       "etiqueta": {"ca": "On es genera principalment?", "es": "¿Dónde se genera principalmente?"},
       "opcions": [
         {"valor": "produccio", "etiqueta": {"ca": "Producció", "es": "Producción"}},
         {"valor": "collita", "etiqueta": {"ca": "Collita", "es": "Cosecha"}},
         {"valor": "magatzem", "etiqueta": {"ca": "Magatzem", "es": "Almacén"}},
         {"valor": "distribucio", "etiqueta": {"ca": "Distribució", "es": "Distribución"}},
         {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}
       ]},
      {"id": "moment_generacio", "tipus": "opcio", "seccio": "generacio", "obligatoria": false,
       "etiqueta": {"ca": "En quin moment es genera la major part?", "es": "¿En qué momento se genera la mayor parte?"},
       "opcions": [
         {"valor": "inici_campanya", "etiqueta": {"ca": "A l'inici de la campanya", "es": "Al inicio de la campaña"}},
         {"valor": "plena_campanya", "etiqueta": {"ca": "En plena campanya", "es": "En plena campaña"}},
         {"valor": "final_campanya", "etiqueta": {"ca": "Al final de la campanya", "es": "Al final de la campaña"}},
         {"valor": "tot_lany", "etiqueta": {"ca": "Tot l'any per igual", "es": "Todo el año por igual"}}
       ]},
      {"id": "canals_actuals", "tipus": "multi", "seccio": "gestio", "obligatoria": true,
       "etiqueta": {"ca": "Què feu actualment amb aquest excedent?", "es": "¿Qué hacéis actualmente con este excedente?"},
       "opcions": [
         {"valor": "venda_segona", "etiqueta": {"ca": "Venda com a segona categoria", "es": "Venta como segunda categoría"}},
         {"valor": "donacio", "etiqueta": {"ca": "Donació", "es": "Donación"}},
         {"valor": "transformacio", "etiqueta": {"ca": "Transformació", "es": "Transformación"}},
         {"valor": "alimentacio_animal", "etiqueta": {"ca": "Alimentació animal", "es": "Alimentación animal"}},
         {"valor": "compostatge", "etiqueta": {"ca": "Compostatge", "es": "Compostaje"}},
         {"valor": "abandonament_camp", "etiqueta": {"ca": "Es queda al camp", "es": "Se queda en el campo"}},
         {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}
       ]},
      {"id": "transport_propi", "tipus": "boolea", "seccio": "gestio", "obligatoria": true,
       "etiqueta": {"ca": "Podeu assumir el transport?", "es": "¿Podéis asumir el transporte?"}},
      {"id": "registre_quantitats", "tipus": "boolea", "seccio": "gestio", "obligatoria": true,
       "etiqueta": {"ca": "Registreu els quilos que queden fora del circuit?", "es": "¿Registráis los kilos que quedan fuera del circuito?"}},
      {"id": "millores", "tipus": "multi", "seccio": "necessitats", "obligatoria": false,
       "etiqueta": {"ca": "Què us agradaria millorar?", "es": "¿Qué os gustaría mejorar?"},
       "opcions": [
         {"valor": "reduir_excedents", "etiqueta": {"ca": "Reduir excedents", "es": "Reducir excedentes"}},
         {"valor": "nous_compradors", "etiqueta": {"ca": "Trobar nous compradors", "es": "Encontrar nuevos compradores"}},
         {"valor": "transformadors", "etiqueta": {"ca": "Trobar transformadors", "es": "Encontrar transformadores"}},
         {"valor": "millorar_donacions", "etiqueta": {"ca": "Millorar les donacions", "es": "Mejorar las donaciones"}},
         {"valor": "logistica", "etiqueta": {"ca": "Millorar la logística", "es": "Mejorar la logística"}},
         {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}
       ]},
      {"id": "suport", "tipus": "multi", "seccio": "necessitats", "obligatoria": false,
       "etiqueta": {"ca": "Quin suport necessiteu?", "es": "¿Qué apoyo necesitáis?"},
       "ajuda": {"ca": "Llista provisional: s'ajustarà a les categories que ja feu servir.", "es": "Lista provisional: se ajustará a las categorías que ya usáis."},
       "opcions": [
         {"valor": "assessorament", "etiqueta": {"ca": "Assessorament tècnic", "es": "Asesoramiento técnico"}},
         {"valor": "comercialitzacio", "etiqueta": {"ca": "Comercialització", "es": "Comercialización"}},
         {"valor": "logistica", "etiqueta": {"ca": "Logística i transport", "es": "Logística y transporte"}},
         {"valor": "donacio", "etiqueta": {"ca": "Gestió de donacions", "es": "Gestión de donaciones"}},
         {"valor": "transformacio", "etiqueta": {"ca": "Transformació", "es": "Transformación"}},
         {"valor": "formacio", "etiqueta": {"ca": "Formació", "es": "Formación"}},
         {"valor": "altres", "etiqueta": {"ca": "Altres", "es": "Otros"}}
       ]},
      {"id": "observacions_diagnostic", "tipus": "text", "seccio": "necessitats", "obligatoria": false,
       "etiqueta": {"ca": "Altres comentaris", "es": "Otros comentarios"}}
    ]$q$::jsonb,
    true,
    true
  );
  raise notice 'questionari productor publicat: versio %, regles orfes %', r->>'versio', r->'regles_orfes';
end;
$$;

-- Las reglas de las preguntas que ya no están se DESACTIVAN, no se borran: un plan emitido
-- cita su medida, y `regles_pla` no tiene DELETE para nadie (§4).
update regles_pla
   set activa = false,
       motiu = coalesce(motiu || ' · ', '') || 'Retirada amb el questionari v1 (27-09-2026): la pregunta ja no existeix.'
 where tipo_org = 'productor'
   and activa
   and pregunta_id in ('planifica_produccio', 'capacitat_fred', 'capacitat_fred_dies', 'moment_perdua');

-- Las reglas nuevas, con la gramática de `avaluar_regla` (= · in · conte).
insert into regles_pla (tipo_org, pregunta_id, operador, valor, mesura_codi, obligatoria, prioritat, motiu) values
  ('productor', 'lloc_generacio', 'in', '["magatzem", "distribucio"]', 'manipulacio_postcollita', false, 10,
   'Es genera després de collir: manipulació i conservació.'),
  ('productor', 'lloc_generacio', 'in', '["produccio", "collita"]', 'revisio_criteris_qualitat', false, 10,
   'Es genera al camp: revisar criteris de qualitat i collita.'),
  ('productor', 'moment_generacio', '=', '"plena_campanya"', 'calendari_previsions', false, 20,
   'Es concentra en plena campanya: planificar i anticipar.'),
  ('productor', 'millores', 'conte', '"transformadors"', 'transformacio_excedent', false, 20,
   'Vol trobar transformadors.'),
  ('productor', 'millores', 'conte', '"millorar_donacions"', 'conveni_donacio', false, 20,
   'Vol millorar les donacions.'),
  ('productor', 'millores', 'conte', '"nous_compradors"', 'segona_categoria', false, 30,
   'Vol trobar nous compradors: sortida de segona categoria.'),
  ('productor', 'millores', 'conte', '"reduir_excedents"', 'avaluacio_anual', false, 30,
   'Vol reduir excedents: cal mesurar-los cada any.');
