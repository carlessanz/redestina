-- El cuestionario de diagnóstico, las medidas y las reglas: **texto de trabajo
-- provisional**, sembrado para que el circuito exista antes de que llegue el anexo B.
--
-- 🔴 NADA DE ESTE FICHERO ESTÁ VALIDADO POR LA FUNDACIÓ. Es exactamente la misma decisión
--    que tomaron los seis convenios en 20270111100200 y por el mismo motivo: el anexo B
--    del funcional es material de la fase 0 y no va a llegar antes, y un circuito que no
--    se puede recorrer no se puede probar. Todo lo que entra aquí nace con
--    `provisional = true`, lo cual:
--      · sale impreso en el plan que lo use (`questionari_provisional` en el snapshot), y
--      · se retira publicando la **versión 1** desde la pantalla, no editando esta.
--        Editar un cuestionario que ya ha generado diagnósticos está prohibido por trigger.
--
-- 🔴 Y SOLO LAS MEDIDAS DE REGISTRO NACEN OBLIGATORIAS (decisión del 22-09-2026). Son dos
--    de veinte: `registre_quantitats` en el generador y `registre_entrades` +
--    `registre_destinacions` en el receptor. El resto se **recomienda**. Lo único que
--    Redestina puede pedir con cara seria mientras el cuestionario sea provisional es que
--    la organización anote lo que le pasa — y es, además, lo único que el servicio
--    necesita de verdad para medir sus indicadores (§1bis).
--
-- ⚠️ `versio = 0` marca «anterior al anexo B», igual que `respuestas.versio_questionari`
--    marcaba los planes hechos sin ningún cuestionario. El anexo B real será la versión 1.
--
-- ⚠️ `prefill` es una PISTA PARA LA PANTALLA, no una lectura del servidor: dice de qué
--    columna de la ficha se puede proponer un valor inicial. La base no lo lee nunca —si
--    lo leyera, una respuesta escribiría en el diagnóstico algo que la persona no ha
--    dicho—. Vocabulario: `<taula>.<columna>`.

-- ---------------------------------------------------------------------------
-- 1. El cuestionario del GENERADOR (12 preguntas)
-- ---------------------------------------------------------------------------
insert into questionaris_diagnostic (tipo_org, versio, provisional, vigente, titol, preguntes)
values (
  'productor', 0, true, true,
  $t${"ca":"Diagnòstic de prevenció · entitat productora",
      "es":"Diagnóstico de prevención · entidad productora"}$t$::jsonb,
  $q$[
  {"id":"productes_principals","tipus":"multi","seccio":"planificacio","obligatoria":true,
   "prefill":"productores.productos_habituales",
   "etiqueta":{"ca":"Quins productes et generen més excedent?","es":"¿Qué productos te generan más excedente?"},
   "ajuda":{"ca":"Marca'n tots els que calgui.","es":"Marca todos los que hagan falta."},
   "opcions":[
     {"valor":"fruita_dolca","etiqueta":{"ca":"Fruita dolça","es":"Fruta dulce"}},
     {"valor":"citrics","etiqueta":{"ca":"Cítrics","es":"Cítricos"}},
     {"valor":"horta_fulla","etiqueta":{"ca":"Horta de fulla","es":"Hortaliza de hoja"}},
     {"valor":"horta_fruit","etiqueta":{"ca":"Horta de fruit","es":"Hortaliza de fruto"}},
     {"valor":"tuberculs","etiqueta":{"ca":"Tubercles, bulbs i arrels","es":"Tubérculos, bulbos y raíces"}},
     {"valor":"fruita_seca","etiqueta":{"ca":"Fruita seca","es":"Fruto seco"}},
     {"valor":"altres","etiqueta":{"ca":"Altres","es":"Otros"}}]},

  {"id":"volum_anual_perdut","tipus":"opcio","seccio":"planificacio","obligatoria":true,
   "etiqueta":{"ca":"Aproximadament, quants quilos es queden fora del circuit de venda cada any?","es":"Aproximadamente, ¿cuántos kilos se quedan fuera del circuito de venta cada año?"},
   "ajuda":{"ca":"Una estimació val. Si no ho saps, digues-ho: també és una resposta.","es":"Una estimación vale. Si no lo sabes, dilo: también es una respuesta."},
   "opcions":[
     {"valor":"menys_1000","etiqueta":{"ca":"Menys de 1.000 kg","es":"Menos de 1.000 kg"}},
     {"valor":"1000_5000","etiqueta":{"ca":"Entre 1.000 i 5.000 kg","es":"Entre 1.000 y 5.000 kg"}},
     {"valor":"5000_20000","etiqueta":{"ca":"Entre 5.000 i 20.000 kg","es":"Entre 5.000 y 20.000 kg"}},
     {"valor":"mes_20000","etiqueta":{"ca":"Més de 20.000 kg","es":"Más de 20.000 kg"}},
     {"valor":"no_ho_se","etiqueta":{"ca":"No ho sé","es":"No lo sé"}}]},

  {"id":"causes","tipus":"multi","seccio":"planificacio","obligatoria":true,
   "etiqueta":{"ca":"Per quins motius es queda producte fora del circuit?","es":"¿Por qué motivos se queda producto fuera del circuito?"},
   "opcions":[
     {"valor":"calibre","etiqueta":{"ca":"Calibre fora de norma","es":"Calibre fuera de norma"}},
     {"valor":"estetic","etiqueta":{"ca":"Aspecte o defecte estètic","es":"Aspecto o defecto estético"}},
     {"valor":"excedent_produccio","etiqueta":{"ca":"Més producció de la prevista","es":"Más producción de la prevista"}},
     {"valor":"preu_mercat","etiqueta":{"ca":"Preu de mercat per sota del cost","es":"Precio de mercado por debajo del coste"}},
     {"valor":"cancellacio_comanda","etiqueta":{"ca":"Comandes anul·lades","es":"Pedidos anulados"}},
     {"valor":"meteorologia","etiqueta":{"ca":"Meteorologia","es":"Meteorología"}},
     {"valor":"plaga","etiqueta":{"ca":"Plagues o malalties","es":"Plagas o enfermedades"}},
     {"valor":"altres","etiqueta":{"ca":"Altres","es":"Otros"}}]},

  {"id":"moment_perdua","tipus":"opcio","seccio":"collita","obligatoria":true,
   "etiqueta":{"ca":"En quin moment es perd la major part?","es":"¿En qué momento se pierde la mayor parte?"},
   "opcions":[
     {"valor":"camp","etiqueta":{"ca":"Al camp, sense collir","es":"En el campo, sin recolectar"}},
     {"valor":"postcollita","etiqueta":{"ca":"Just després de collir","es":"Justo después de recolectar"}},
     {"valor":"magatzem","etiqueta":{"ca":"Al magatzem","es":"En el almacén"}},
     {"valor":"transport","etiqueta":{"ca":"En el transport o a destinació","es":"En el transporte o en destino"}}]},

  {"id":"planifica_produccio","tipus":"boolea","seccio":"planificacio","obligatoria":true,
   "etiqueta":{"ca":"Planifiques la producció contra demanda confirmada?","es":"¿Planificas la producción contra demanda confirmada?"}},

  {"id":"previsio_anticipacio","tipus":"opcio","seccio":"planificacio","obligatoria":false,
   "aplica_a":{"pregunta":"planifica_produccio","operador":"=","valor":true},
   "etiqueta":{"ca":"Amb quanta antelació ho saps?","es":"¿Con cuánta antelación lo sabes?"},
   "opcions":[
     {"valor":"setmanes","etiqueta":{"ca":"Setmanes","es":"Semanas"}},
     {"valor":"mesos","etiqueta":{"ca":"Mesos","es":"Meses"}},
     {"valor":"campanya","etiqueta":{"ca":"Tota la campanya","es":"Toda la campaña"}}]},

  {"id":"capacitat_fred","tipus":"boolea","seccio":"conservacio","obligatoria":true,
   "etiqueta":{"ca":"Tens cambra de fred o algun sistema de conservació?","es":"¿Tienes cámara de frío o algún sistema de conservación?"}},

  {"id":"capacitat_fred_dies","tipus":"numero","seccio":"conservacio","obligatoria":false,
   "aplica_a":{"pregunta":"capacitat_fred","operador":"=","valor":true},
   "etiqueta":{"ca":"Quants dies pots mantenir el producte en condicions?","es":"¿Cuántos días puedes mantener el producto en condiciones?"}},

  {"id":"registre_quantitats","tipus":"boolea","seccio":"seguiment","obligatoria":true,
   "etiqueta":{"ca":"Anotes els quilos que es queden fora del circuit de venda?","es":"¿Anotas los kilos que se quedan fuera del circuito de venta?"},
   "ajuda":{"ca":"És la dada que fa possible mesurar: sense ella, tota la resta és una estimació.","es":"Es el dato que hace posible medir: sin él, todo lo demás es una estimación."}},

  {"id":"canals_actuals","tipus":"multi","seccio":"canalitzacio","obligatoria":true,
   "etiqueta":{"ca":"Què fas avui amb aquest producte?","es":"¿Qué haces hoy con ese producto?"},
   "opcions":[
     {"valor":"donacio","etiqueta":{"ca":"El dono a entitats socials","es":"Lo dono a entidades sociales"}},
     {"valor":"venda_segona","etiqueta":{"ca":"El venc com a segona categoria","es":"Lo vendo como segunda categoría"}},
     {"valor":"transformacio","etiqueta":{"ca":"El transformo o el faig transformar","es":"Lo transformo o lo hago transformar"}},
     {"valor":"alimentacio_animal","etiqueta":{"ca":"Alimentació animal","es":"Alimentación animal"}},
     {"valor":"compostatge","etiqueta":{"ca":"Compostatge","es":"Compostaje"}},
     {"valor":"abandonament_camp","etiqueta":{"ca":"Es queda al camp","es":"Se queda en el campo"}}]},

  {"id":"transport_propi","tipus":"boolea","seccio":"canalitzacio","obligatoria":true,
   "etiqueta":{"ca":"Pots assumir el transport fins a destinació?","es":"¿Puedes asumir el transporte hasta destino?"}},

  {"id":"observacions_diagnostic","tipus":"text","seccio":"seguiment","obligatoria":false,
   "etiqueta":{"ca":"Hi ha res més que calgui saber?","es":"¿Hay algo más que haya que saber?"}}
]$q$::jsonb)
on conflict (tipo_org, versio) do nothing;

-- ---------------------------------------------------------------------------
-- 2. El cuestionario del RECEPTOR (12 preguntas)
-- ---------------------------------------------------------------------------
insert into questionaris_diagnostic (tipo_org, versio, provisional, vigente, titol, preguntes)
values (
  'entidad', 0, true, true,
  $t${"ca":"Diagnòstic de prevenció · entitat receptora",
      "es":"Diagnóstico de prevención · entidad receptora"}$t$::jsonb,
  $q$[
  {"id":"persones_ateses","tipus":"opcio","seccio":"planificacio","obligatoria":true,
   "etiqueta":{"ca":"A quantes persones atén l'entitat cada mes?","es":"¿A cuántas personas atiende la entidad cada mes?"},
   "opcions":[
     {"valor":"menys_50","etiqueta":{"ca":"Menys de 50","es":"Menos de 50"}},
     {"valor":"50_200","etiqueta":{"ca":"Entre 50 i 200","es":"Entre 50 y 200"}},
     {"valor":"200_500","etiqueta":{"ca":"Entre 200 i 500","es":"Entre 200 y 500"}},
     {"valor":"mes_500","etiqueta":{"ca":"Més de 500","es":"Más de 500"}}]},

  {"id":"frequencia_repartiment","tipus":"opcio","seccio":"planificacio","obligatoria":true,
   "etiqueta":{"ca":"Cada quant repartiu el producte que rebeu?","es":"¿Cada cuánto repartís el producto que recibís?"},
   "opcions":[
     {"valor":"diari","etiqueta":{"ca":"Diàriament","es":"Diariamente"}},
     {"valor":"setmanal","etiqueta":{"ca":"Setmanalment","es":"Semanalmente"}},
     {"valor":"quinzenal","etiqueta":{"ca":"Cada quinze dies","es":"Cada quince días"}},
     {"valor":"mensual","etiqueta":{"ca":"Mensualment","es":"Mensualmente"}}]},

  {"id":"productes_acceptats","tipus":"multi","seccio":"planificacio","obligatoria":true,
   "prefill":"entidades.productes_frescos",
   "etiqueta":{"ca":"Quins tipus de producte podeu acceptar?","es":"¿Qué tipos de producto podéis aceptar?"},
   "opcions":[
     {"valor":"fresc","etiqueta":{"ca":"Fresc","es":"Fresco"}},
     {"valor":"congelat","etiqueta":{"ca":"Congelat","es":"Congelado"}},
     {"valor":"sec","etiqueta":{"ca":"Sec i no perible","es":"Seco y no perecedero"}},
     {"valor":"cuinat","etiqueta":{"ca":"Cuinat","es":"Cocinado"}}]},

  {"id":"capacitat_fred","tipus":"boolea","seccio":"conservacio","obligatoria":true,
   "etiqueta":{"ca":"Teniu cambra de fred?","es":"¿Tenéis cámara de frío?"}},

  {"id":"capacitat_fred_m3","tipus":"numero","seccio":"conservacio","obligatoria":false,
   "aplica_a":{"pregunta":"capacitat_fred","operador":"=","valor":true},
   "etiqueta":{"ca":"Quants metres cúbics de fred teniu?","es":"¿Cuántos metros cúbicos de frío tenéis?"}},

  {"id":"capacitat_congelacio","tipus":"boolea","seccio":"conservacio","obligatoria":true,
   "etiqueta":{"ca":"Podeu congelar producte fresc que no arribareu a repartir?","es":"¿Podéis congelar producto fresco que no llegaréis a repartir?"}},

  {"id":"transport_propi","tipus":"boolea","seccio":"canalitzacio","obligatoria":true,
   "prefill":"entidades.transport_plataforma",
   "etiqueta":{"ca":"Teniu transport propi per anar a recollir?","es":"¿Tenéis transporte propio para ir a recoger?"}},

  {"id":"descarrega_mitjans","tipus":"multi","seccio":"canalitzacio","obligatoria":true,
   "prefill":"entidades.descarrega_toro",
   "etiqueta":{"ca":"Amb què podeu descarregar?","es":"¿Con qué podéis descargar?"},
   "opcions":[
     {"valor":"toro","etiqueta":{"ca":"Toro o carretó elevador","es":"Toro o carretilla elevadora"}},
     {"valor":"transpalet","etiqueta":{"ca":"Transpalet","es":"Transpalé"}},
     {"valor":"manual","etiqueta":{"ca":"A mà","es":"A mano"}}]},

  {"id":"registre_entrades","tipus":"boolea","seccio":"seguiment","obligatoria":true,
   "etiqueta":{"ca":"Anoteu els quilos que entren?","es":"¿Anotáis los kilos que entran?"},
   "ajuda":{"ca":"És la dada que fa possible mesurar l'aprofitament real.","es":"Es el dato que hace posible medir el aprovechamiento real."}},

  {"id":"registre_destinacions","tipus":"boolea","seccio":"seguiment","obligatoria":true,
   "etiqueta":{"ca":"Anoteu què passa amb el producte que no arribeu a repartir?","es":"¿Anotáis qué pasa con el producto que no llegáis a repartir?"}},

  {"id":"malbaratament_intern","tipus":"opcio","seccio":"seguiment","obligatoria":true,
   "etiqueta":{"ca":"Del producte que us arriba, quant se us fa malbé abans de repartir-lo?","es":"Del producto que os llega, ¿cuánto se echa a perder antes de repartirlo?"},
   "opcions":[
     {"valor":"cap","etiqueta":{"ca":"Pràcticament res","es":"Prácticamente nada"}},
     {"valor":"poc","etiqueta":{"ca":"Poc","es":"Poco"}},
     {"valor":"forca","etiqueta":{"ca":"Força","es":"Bastante"}},
     {"valor":"no_ho_se","etiqueta":{"ca":"No ho sé","es":"No lo sé"}}]},

  {"id":"observacions_diagnostic","tipus":"text","seccio":"seguiment","obligatoria":false,
   "etiqueta":{"ca":"Hi ha res més que calgui saber?","es":"¿Hay algo más que haya que saber?"}}
]$q$::jsonb)
on conflict (tipo_org, versio) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Las medidas del GENERADOR (10)
-- ---------------------------------------------------------------------------
insert into mesures_prevencio (codi, tipo_org, bloc, obligatoria_per_defecte, ordre, titol, descripcio)
values
  ('registre_quantitats','productor','seguiment',true,10,
   $x${"ca":"Registrar els quilos que queden fora del circuit","es":"Registrar los kilos que quedan fuera del circuito"}$x$::jsonb,
   $x${"ca":"Anotar, com a mínim un cop al mes, els quilos que no arriben al circuit de venda i el motiu. Un full de càlcul n'hi ha prou. És la base de tota la resta: sense aquesta dada, qualsevol millora és una impressió.","es":"Anotar, como mínimo una vez al mes, los kilos que no llegan al circuito de venta y el motivo. Basta una hoja de cálculo. Es la base de todo lo demás: sin ese dato, cualquier mejora es una impresión."}$x$::jsonb),

  ('calendari_previsions','productor','planificacio',false,20,
   $x${"ca":"Compartir un calendari de previsions amb Redestina","es":"Compartir un calendario de previsiones con Redestina"}$x$::jsonb,
   $x${"ca":"Avisar amb setmanes d'antelació de les collites que probablement generaran excedent, perquè es pugui buscar destinació abans que el producte sigui al camp esperant.","es":"Avisar con semanas de antelación de las cosechas que probablemente generarán excedente, para poder buscar destino antes de que el producto esté en el campo esperando."}$x$::jsonb),

  ('acord_demanda_anticipada','productor','planificacio',false,30,
   $x${"ca":"Acordar la demanda per endavant","es":"Acordar la demanda por adelantado"}$x$::jsonb,
   $x${"ca":"Tancar per escrit els volums amb els compradors habituals abans de sembrar o plantar, per reduir l'impacte d'una comanda anul·lada.","es":"Cerrar por escrito los volúmenes con los compradores habituales antes de sembrar o plantar, para reducir el impacto de un pedido anulado."}$x$::jsonb),

  ('segona_categoria','productor','collita',false,40,
   $x${"ca":"Obrir una línia de segona categoria","es":"Abrir una línea de segunda categoría"}$x$::jsonb,
   $x${"ca":"Classificar i vendre com a segona categoria el producte que només falla pel calibre o per l'aspecte. És producte bo: el que falla és la norma comercial.","es":"Clasificar y vender como segunda categoría el producto que solo falla por el calibre o por el aspecto. Es producto bueno: lo que falla es la norma comercial."}$x$::jsonb),

  ('revisio_criteris_qualitat','productor','collita',false,50,
   $x${"ca":"Revisar els criteris de collita","es":"Revisar los criterios de recolección"}$x$::jsonb,
   $x${"ca":"Repassar amb l'equip quins criteris deixen producte al camp i quins es poden relaxar sense perdre qualitat real.","es":"Repasar con el equipo qué criterios dejan producto en el campo y cuáles se pueden relajar sin perder calidad real."}$x$::jsonb),

  ('cadena_fred_minima','productor','conservacio',false,60,
   $x${"ca":"Assegurar una conservació mínima després de collir","es":"Asegurar una conservación mínima tras recolectar"}$x$::jsonb,
   $x${"ca":"Buscar un espai fresc, ombrejat i ventilat —o compartir cambra amb algú a prop— per allargar els dies disponibles per canalitzar el producte.","es":"Buscar un espacio fresco, sombreado y ventilado —o compartir cámara con alguien cercano— para alargar los días disponibles para canalizar el producto."}$x$::jsonb),

  ('manipulacio_postcollita','productor','conservacio',false,70,
   $x${"ca":"Millorar la manipulació postcollita","es":"Mejorar la manipulación poscosecha"}$x$::jsonb,
   $x${"ca":"Revisar envasos, apilament i temps d'espera entre la collita i la sortida: bona part de la pèrdua de magatzem es decideix les primeres hores.","es":"Revisar envases, apilado y tiempos de espera entre la recolección y la salida: buena parte de la pérdida de almacén se decide en las primeras horas."}$x$::jsonb),

  ('conveni_donacio','productor','canalitzacio',false,80,
   $x${"ca":"Canalitzar per donació el que no té sortida comercial","es":"Canalizar por donación lo que no tiene salida comercial"}$x$::jsonb,
   $x${"ca":"Signar el conveni de donació amb la Fundació i publicar les ofertes a Redestina en comptes de deixar el producte al camp. La donació genera certificat i el producte s'aprofita.","es":"Firmar el convenio de donación con la Fundación y publicar las ofertas en Redestina en vez de dejar el producto en el campo. La donación genera certificado y el producto se aprovecha."}$x$::jsonb),

  ('transformacio_excedent','productor','canalitzacio',false,90,
   $x${"ca":"Explorar la transformació de l'excedent","es":"Explorar la transformación del excedente"}$x$::jsonb,
   $x${"ca":"Valorar la maquila —conserves, sucs, cremes— per al producte que no aguanta fresc fins a trobar destinació.","es":"Valorar la maquila —conservas, zumos, cremas— para el producto que no aguanta fresco hasta encontrar destino."}$x$::jsonb),

  ('avaluacio_anual','productor','seguiment',false,100,
   $x${"ca":"Revisar el pla un cop l'any","es":"Revisar el plan una vez al año"}$x$::jsonb,
   $x${"ca":"Contrastar els quilos registrats amb els de l'any anterior i tornar a contestar el diagnòstic. El pla següent es construeix sobre aquestes dades.","es":"Contrastar los kilos registrados con los del año anterior y volver a contestar el diagnóstico. El plan siguiente se construye sobre esos datos."}$x$::jsonb)
on conflict (codi) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Las medidas del RECEPTOR (10)
-- ---------------------------------------------------------------------------
insert into mesures_prevencio (codi, tipo_org, bloc, obligatoria_per_defecte, ordre, titol, descripcio)
values
  ('registre_entrades','entidad','seguiment',true,10,
   $x${"ca":"Registrar els quilos que entren","es":"Registrar los kilos que entran"}$x$::jsonb,
   $x${"ca":"Anotar cada entrada amb data, producte i quilos. És la dada amb la qual Redestina pot acreditar el que heu rebut i mesurar l'aprofitament real.","es":"Anotar cada entrada con fecha, producto y kilos. Es el dato con el que Redestina puede acreditar lo recibido y medir el aprovechamiento real."}$x$::jsonb),

  ('registre_destinacions','entidad','seguiment',true,20,
   $x${"ca":"Registrar què passa amb el que no es reparteix","es":"Registrar qué pasa con lo que no se reparte"}$x$::jsonb,
   $x${"ca":"Anotar els quilos que no arriben a repartir-se i on van (congelació, transformació, alimentació animal, residu). Sense això no es pot saber on s'està perdent.","es":"Anotar los kilos que no llegan a repartirse y adónde van (congelación, transformación, alimentación animal, residuo). Sin eso no se puede saber dónde se está perdiendo."}$x$::jsonb),

  ('planificacio_recepcio','entidad','planificacio',false,30,
   $x${"ca":"Planificar la recepció amb antelació","es":"Planificar la recepción con antelación"}$x$::jsonb,
   $x${"ca":"Dir a Redestina quins dies i quins volums podeu assumir, perquè les ofertes us arribin ajustades al que realment podeu moure.","es":"Decir a Redestina qué días y qué volúmenes podéis asumir, para que las ofertas os lleguen ajustadas a lo que realmente podéis mover."}$x$::jsonb),

  ('ajust_volum_demanda','entidad','planificacio',false,40,
   $x${"ca":"Ajustar el volum acceptat a la demanda real","es":"Ajustar el volumen aceptado a la demanda real"}$x$::jsonb,
   $x${"ca":"Acceptar només el que es pot repartir en condicions. Dir que no a una part d'un lot no és perdre-la: permet que vagi a una altra entitat que sí pot.","es":"Aceptar solo lo que se puede repartir en condiciones. Decir que no a parte de un lote no es perderlo: permite que vaya a otra entidad que sí puede."}$x$::jsonb),

  ('cadena_fred_recepcio','entidad','conservacio',false,50,
   $x${"ca":"Assegurar la cadena de fred des de la recepció","es":"Asegurar la cadena de frío desde la recepción"}$x$::jsonb,
   $x${"ca":"Reduir el temps entre la descàrrega i el fred, i revisar la capacitat disponible abans d'acceptar producte fresc.","es":"Reducir el tiempo entre la descarga y el frío, y revisar la capacidad disponible antes de aceptar producto fresco."}$x$::jsonb),

  ('rotacio_estocs','entidad','conservacio',false,60,
   $x${"ca":"Ordenar la rotació d'estocs","es":"Ordenar la rotación de existencias"}$x$::jsonb,
   $x${"ca":"Repartir primer el que va entrar primer i marcar les dates a la vista. És la mesura que més redueix el malbaratament intern i no costa diners.","es":"Repartir primero lo que entró primero y marcar las fechas a la vista. Es la medida que más reduce el desperdicio interno y no cuesta dinero."}$x$::jsonb),

  ('congelacio_excedent','entidad','conservacio',false,70,
   $x${"ca":"Congelar el fresc que no arribareu a repartir","es":"Congelar el fresco que no llegaréis a repartir"}$x$::jsonb,
   $x${"ca":"Valorar la congelació —pròpia o compartida— del producte que està a punt de passar-se, per allargar-ne la vida útil setmanes.","es":"Valorar la congelación —propia o compartida— del producto que está a punto de pasarse, para alargar su vida útil semanas."}$x$::jsonb),

  ('acord_transport','entidad','canalitzacio',false,80,
   $x${"ca":"Acordar el transport amb antelació","es":"Acordar el transporte con antelación"}$x$::jsonb,
   $x${"ca":"Deixar tancat qui recull i amb què es descarrega abans d'acceptar un lot. Una recollida que no es pot fer deixa el producte al camp.","es":"Dejar cerrado quién recoge y con qué se descarga antes de aceptar un lote. Una recogida que no se puede hacer deja el producto en el campo."}$x$::jsonb),

  ('derivacio_segon_nivell','entidad','canalitzacio',false,90,
   $x${"ca":"Derivar a una segona entitat el que us sobri","es":"Derivar a una segunda entidad lo que os sobre"}$x$::jsonb,
   $x${"ca":"Avisar Redestina quan un lot us queda gran, per redistribuir-lo abans que es faci malbé en comptes de després.","es":"Avisar a Redestina cuando un lote os queda grande, para redistribuirlo antes de que se estropee en vez de después."}$x$::jsonb),

  ('avaluacio_anual_receptor','entidad','seguiment',false,100,
   $x${"ca":"Revisar el pla un cop l'any","es":"Revisar el plan una vez al año"}$x$::jsonb,
   $x${"ca":"Contrastar els quilos registrats amb els de l'any anterior i tornar a contestar el diagnòstic.","es":"Contrastar los kilos registrados con los del año anterior y volver a contestar el diagnóstico."}$x$::jsonb)
on conflict (codi) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Las reglas
-- ---------------------------------------------------------------------------
-- ⚠️ `obligatoria = true` SOLO en las tres de registro. Ver la cabecera.
-- El `on conflict` no sirve aquí (la PK es un uuid generado), así que la idempotencia se
-- resuelve con un `not exists` sobre la terna que identifica una regla.
insert into regles_pla (tipo_org, pregunta_id, operador, valor, mesura_codi, obligatoria, prioritat, motiu)
select v.tipo_org, v.pregunta_id, v.operador, v.valor, v.mesura_codi, v.obligatoria, v.prioritat, v.motiu
  from (values
  -- --- GENERADOR ---
  ('productor', null::text, 'sempre', null::jsonb, 'registre_quantitats', true, 10,
   'Sense registre no hi ha mesura possible: entra a tots els plans.'),
  ('productor', 'causes', 'conte', '"calibre"'::jsonb, 'segona_categoria', false, 20, null),
  ('productor', 'causes', 'conte', '"calibre"'::jsonb, 'conveni_donacio', false, 30, null),
  ('productor', 'causes', 'conte', '"estetic"'::jsonb, 'segona_categoria', false, 20, null),
  ('productor', 'causes', 'conte', '"estetic"'::jsonb, 'revisio_criteris_qualitat', false, 30, null),
  ('productor', 'causes', 'conte', '"excedent_produccio"'::jsonb, 'calendari_previsions', false, 20, null),
  ('productor', 'causes', 'conte', '"cancellacio_comanda"'::jsonb, 'acord_demanda_anticipada', false, 20, null),
  ('productor', 'causes', 'conte', '"preu_mercat"'::jsonb, 'conveni_donacio', false, 40, null),
  ('productor', 'planifica_produccio', '=', 'false'::jsonb, 'calendari_previsions', false, 10, null),
  ('productor', 'capacitat_fred', '=', 'false'::jsonb, 'cadena_fred_minima', false, 10, null),
  ('productor', 'capacitat_fred_dies', '<=', '2'::jsonb, 'manipulacio_postcollita', false, 20, null),
  ('productor', 'moment_perdua', '=', '"camp"'::jsonb, 'revisio_criteris_qualitat', false, 10, null),
  ('productor', 'moment_perdua', 'in', '["postcollita","magatzem"]'::jsonb, 'manipulacio_postcollita', false, 10, null),
  ('productor', 'canals_actuals', 'conte', '"abandonament_camp"'::jsonb, 'conveni_donacio', false, 10, null),
  ('productor', 'canals_actuals', 'conte', '"compostatge"'::jsonb, 'transformacio_excedent', false, 20, null),
  ('productor', 'transport_propi', '=', 'false'::jsonb, 'conveni_donacio', false, 50, null),
  ('productor', 'volum_anual_perdut', 'in', '["5000_20000","mes_20000"]'::jsonb, 'avaluacio_anual', false, 10, null),
  ('productor', 'volum_anual_perdut', '=', '"no_ho_se"'::jsonb, 'avaluacio_anual', false, 20, null),

  -- --- RECEPTOR ---
  ('entidad', null, 'sempre', null, 'registre_entrades', true, 10,
   'Sense registre d''entrades no es pot acreditar res del que es rep.'),
  ('entidad', null, 'sempre', null, 'registre_destinacions', true, 20,
   'Sense saber on va el que no es reparteix, no es pot prevenir res.'),
  ('entidad', 'capacitat_fred', '=', 'false'::jsonb, 'cadena_fred_recepcio', false, 10, null),
  ('entidad', 'capacitat_fred_m3', '<=', '5'::jsonb, 'cadena_fred_recepcio', false, 20, null),
  ('entidad', 'capacitat_congelacio', '=', 'false'::jsonb, 'congelacio_excedent', false, 10, null),
  ('entidad', 'productes_acceptats', 'conte', '"fresc"'::jsonb, 'cadena_fred_recepcio', false, 30, null),
  ('entidad', 'malbaratament_intern', 'in', '["forca","no_ho_se"]'::jsonb, 'rotacio_estocs', false, 10, null),
  ('entidad', 'malbaratament_intern', '=', '"forca"'::jsonb, 'ajust_volum_demanda', false, 10, null),
  ('entidad', 'malbaratament_intern', '!=', '"cap"'::jsonb, 'avaluacio_anual_receptor', false, 10, null),
  ('entidad', 'frequencia_repartiment', 'in', '["quinzenal","mensual"]'::jsonb, 'rotacio_estocs', false, 20, null),
  ('entidad', 'transport_propi', '=', 'false'::jsonb, 'acord_transport', false, 10, null),
  ('entidad', 'descarrega_mitjans', 'buit', null, 'acord_transport', false, 20, null),
  ('entidad', 'persones_ateses', '=', '"mes_500"'::jsonb, 'planificacio_recepcio', false, 10, null),
  ('entidad', 'registre_destinacions', '=', 'false'::jsonb, 'derivacio_segon_nivell', false, 20, null)
  ) as v(tipo_org, pregunta_id, operador, valor, mesura_codi, obligatoria, prioritat, motiu)
 where not exists (
   select 1 from regles_pla r
    where r.tipo_org = v.tipo_org
      and r.mesura_codi = v.mesura_codi
      and r.operador = v.operador
      and r.pregunta_id is not distinct from v.pregunta_id
      and r.valor is not distinct from v.valor);

-- Verificación:
--   select tipo_org, versio, vigente, provisional, jsonb_array_length(preguntes)
--     from questionaris_diagnostic;                                     -- 2 filas, 12 y 12
--   select tipo_org, count(*) from mesures_prevencio group by 1;        -- 10 y 10
--   select codi from mesures_prevencio where obligatoria_per_defecte;   -- solo registre_*
--   select tipo_org, count(*) from regles_pla group by 1;               -- 18 y 14
