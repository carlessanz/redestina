-- Las seis plantillas de convenio: tres modelos × català/castellà, versión 1 vigente.
--
-- ⚠️⚠️ ESTOS TEXTOS **NO** ESTÁN VALIDADOS POR LA ASESORÍA JURÍDICA DE LA FUNDACIÓ.
--
-- Son **texto de trabajo**: completo, coherente y redactado a partir del anexo C del plan
-- funcional y de la estructura de los dos convenios que la Fundación ya usa en papel
-- (`00_CONV_SDA` y `01_CONV_PROD`), pero escritos por la consultoría, no por un abogado.
-- La fase 0 del plan tiene «los tres convenios ca/es validados por la asesoría» como
-- dependencia **bloqueante** para cargar las plantillas de verdad.
--
-- POR QUÉ SE SIEMBRAN IGUAL, EN VEZ DE ESPERAR. Sin plantilla vigente no se puede
-- preparar ningún convenio (`preparar_convenio()` falla con 22023), así que sin esto no
-- habría forma de probar el circuito de firma —enlace, evidencias, número, contrafirma—
-- hasta que llegara el texto definitivo, y ese circuito es justamente lo que la fase 2
-- construye. La salida es la misma que tomó `parametros_documentales` (20260928100400)
-- con los datos de la Fundación: sembrar valores **que se lean como provisionales a
-- simple vista**.
--
-- CÓMO SE VE QUE SON PROVISIONALES, y por qué de tres maneras a la vez:
--   1. El **primer bloque del cuerpo** es un aviso en mayúsculas. Como el renderizador
--      imprime los bloques en orden, sale en la primera página de cualquier PDF que se
--      genere antes de tiempo, encima del título.
--   2. El **título** de la plantilla empieza por `[ESBORRANY]` / `[BORRADOR]`, así que sale
--      también en el listado de plantillas del panel.
--   3. El **último bloque** lo repite al pie, para que no se pierda en un documento largo
--      que alguien hojee por el final.
-- Un convenio emitido con esto no se puede confundir con uno firmable, que es la única
-- garantía que un seed puede dar.
--
-- CÓMO SE SUSTITUYEN cuando llegue el texto validado (y **no** editando estas filas: el
-- trigger `plantillas_inmutables` lo impide en cuanto hayan emitido algo, 20260928100100):
--   1. Publicar la versión 2 desde la pantalla de plantillas, con el texto de la asesoría.
--   2. Retirar la versión 1 (`vigente = false`). El índice parcial deja pasar solo una.
--   3. Los convenios ya firmados **no cambian**: llevan su snapshot en `documentos.datos`.
--   4. Preparar convenios nuevos para quien ya tuviera uno vigente firmado con el texto
--      viejo; al contrafirmarlos, el anterior pasa a `substituit` solo.
--
-- LA FORMA DEL `cuerpo` la fija `_shared/pdf/plantilla.ts`: array de bloques
-- `{tipo, text}` con `tipo` ∈ h1 · h2 · h3 · p · lista · salt. `marcadores` es el contrato
-- declarado: un marcador sin valor NO se sustituye por vacío, queda visible y sale en
-- `faltan`, para que quien emite pueda negarse (20260928100100).

-- Los marcadores son los mismos en los seis textos: lo que cambia es el articulado, no
-- de dónde salen los datos. Salen de `documentos.datos`, que compone
-- `convenio_emet_document()` (20270111100100).
--   organitzacio.*  copia congelada de la ficha, tal como se firmó
--   firmant.*       quien firma, con su cargo (SIN DNI: eso vive solo en `evidencias`)
--   fundacio.*      `parametros_documentales`, también congelados en el snapshot
--   numero, ejercici, firmat_at

insert into plantillas_documento (tipo, variante, idioma, version, titulo, cuerpo, marcadores)
values

-- ===========================================================================
-- 1. Convenio de donación del generador — català
-- ===========================================================================
('CONV', 'don_gen', 'ca', 1,
 '[ESBORRANY] Conveni de col·laboració per a la donació d''aliments fora del circuit de venda habitual',
 $json$[
  {"tipo":"p","text":"⚠️ ESBORRANY DE TREBALL — TEXT PENDENT DE VALIDACIÓ PER L'ASSESSORIA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS. Aquest document NO té valor contractual. No l'envieu a firmar."},
  {"tipo":"h1","text":"Conveni de col·laboració per a la donació d'aliments fora del circuit de venda habitual"},
  {"tipo":"p","text":"Conveni número {{numero}} · exercici {{ejercici}}"},

  {"tipo":"h2","text":"Reunits"},
  {"tipo":"p","text":"D'una banda, {{fundacio.raso_social}}, amb NIF {{fundacio.cif}} i domicili a {{fundacio.domicili}}, {{fundacio.codi_postal}} {{fundacio.poblacio}}, {{fundacio.inscripcio}} (en endavant, la Fundació), representada per {{fundacio.apoderada_nom}}, en qualitat de {{fundacio.apoderada_carrec}}."},
  {"tipo":"p","text":"I d'altra banda, {{organitzacio.raso_social}}, amb NIF {{organitzacio.nif}} i domicili a {{organitzacio.domicili}}, {{organitzacio.codi_postal}} {{organitzacio.poblacio}} (en endavant, la part generadora), representada per {{firmant.nombre}}, en qualitat de {{firmant.cargo}}, que declara tenir-ne poders suficients."},

  {"tipo":"h2","text":"Manifesten"},
  {"tipo":"p","text":"Que la Fundació Espigoladors treballa per aprofitar els aliments que queden fora del circuit de venda habitual, generar ocupació de qualitat per a col·lectius en risc d'exclusió i sensibilitzar sobre les pèrdues i el malbaratament alimentari."},
  {"tipo":"p","text":"Que REDESTINA és el servei de la Fundació que canalitza aquests aliments cap a entitats socials, sortides comercials, transformació i espigolament, i que dona suport tecnològic a tot el procés."},
  {"tipo":"p","text":"Que la part generadora produeix o disposa d'aliments aptes per al consum que, per raons de calibre, aspecte, excedent de collita, canvi de comanda o qualsevol altra causa aliena a la seguretat alimentària, queden fora del circuit de venda habitual."},
  {"tipo":"p","text":"Que totes dues parts volen col·laborar perquè aquests aliments arribin a persones que els necessiten, i per això subscriuen aquest conveni amb les clàusules següents."},

  {"tipo":"h2","text":"Clàusules"},

  {"tipo":"h3","text":"1. Objecte"},
  {"tipo":"p","text":"Facilitar, mitjançant REDESTINA, la donació d'aliments de la part generadora a entitats receptores amb servei de distribució d'aliments, així com les espigolades que es facin a les seves finques."},

  {"tipo":"h3","text":"2. Paper de la Fundació"},
  {"tipo":"p","text":"La Fundació dinamitza el servei, proposa destinataris, coordina les recollides i registra les operacions a REDESTINA. En les donacions la Fundació és part de l'intercanvi: rep els aliments de la part generadora i els lliura a l'entitat receptora, i emet la documentació de tots dos trams."},

  {"tipo":"h3","text":"3. Compromisos de la part generadora"},
  {"tipo":"lista","text":[
    "Facilitar informació veraç sobre el producte, la quantitat, l'estat i la disponibilitat.",
    "Garantir que els aliments són aptes per al consum humà i compleixen la normativa de seguretat alimentària que li és aplicable.",
    "Respectar les recollides confirmades o avisar amb la màxima antelació possible si no es poden fer.",
    "Facilitar l'accés a la finca o al magatzem en l'horari acordat i les condicions mínimes per carregar."
  ]},

  {"tipo":"h3","text":"4. Espigolament"},
  {"tipo":"p","text":"Quan la donació es faci per espigolament, la part generadora autoritza l'entrada a la finca de l'equip i del voluntariat de la Fundació en les dates acordades. La Fundació respon de l'organització de la jornada, de la cobertura d'assegurança del voluntariat i de deixar la finca en les condicions en què la va trobar."},

  {"tipo":"h3","text":"5. Documentació i traçabilitat"},
  {"tipo":"p","text":"Cada recollida genera un albarà de recepció amb els quilos pesats, sense imports. La part generadora en rep còpia i el pot confirmar per un enllaç, sense necessitat de tenir compte a REDESTINA."},

  {"tipo":"h3","text":"6. Valoració anual i certificat de donació"},
  {"tipo":"p","text":"Un cop tancat l'exercici, la Fundació calcula els quilos conciliats i el seu valor a partir del cost per quilo de cada producte, i emet un resum anual. Amb la factura o document equivalent que emeti la part generadora per aquest import, la Fundació emet el certificat de donació corresponent."},
  {"tipo":"p","text":"La valoració no comporta cap pagament entre les parts: és el valor que la normativa exigeix per documentar la donació."},

  {"tipo":"h3","text":"7. Confidencialitat i ús de les dades"},
  {"tipo":"p","text":"Les quantitats i els valors econòmics són visibles només per a la part implicada i per a la Fundació. La Fundació en pot fer un ús agregat i anònim per als seus indicadors i per a la seva memòria d'activitat."},

  {"tipo":"h3","text":"8. Comunicacions"},
  {"tipo":"p","text":"Les comunicacions es fan per REDESTINA, per correu electrònic i, amb el consentiment exprés que s'atorga en firmar aquest conveni, per WhatsApp. Aquest consentiment es pot retirar en qualsevol moment escrivint BAIXA o comunicant-ho a la Fundació."},

  {"tipo":"h3","text":"9. Firma electrònica i registre d'evidències"},
  {"tipo":"p","text":"Les parts accepten la firma electrònica dins de REDESTINA i el registre d'evidències que l'acompanya: identitat declarada, control de l'adreça de correu, petjada digital del text acceptat, data, adreça IP i navegador. Aquestes evidències es conserven mentre duri la relació i durant els terminis legals de prescripció."},

  {"tipo":"h3","text":"10. Protecció de dades"},
  {"tipo":"p","text":"Les dades personals es tracten conforme al Reglament (UE) 2016/679 i a la Llei orgànica 3/2018, amb la finalitat de gestionar aquesta col·laboració. No se cedeixen a tercers fora dels casos previstos per la llei. Els drets d'accés, rectificació, supressió, limitació, oposició i portabilitat s'exerceixen davant la Fundació."},

  {"tipo":"h3","text":"11. Jerarquia d'usos"},
  {"tipo":"p","text":"Les parts assumeixen la jerarquia de prioritats de la Llei 1/2025 de prevenció de les pèrdues i el malbaratament alimentari: primer el consum humà, després l'alimentació animal i, finalment, la resta d'usos."},

  {"tipo":"h3","text":"12. Vigència"},
  {"tipo":"p","text":"Aquest conveni té una vigència d'un any des de la data de firma i es prorroga tàcitament per períodes iguals, llevat que qualsevol de les parts el denunciï amb dos mesos d'antelació."},

  {"tipo":"h3","text":"13. Resolució"},
  {"tipo":"p","text":"Són causes de resolució el mutu acord, l'incompliment greu de les obligacions, la impossibilitat sobrevinguda de complir-les i qualsevol canvi normatiu que ho impedeixi."},

  {"tipo":"h3","text":"14. Jurisdicció"},
  {"tipo":"p","text":"Les parts se sotmeten als jutjats i tribunals de Barcelona, amb renúncia a qualsevol altre fur."},

  {"tipo":"h2","text":"Firma"},
  {"tipo":"p","text":"Firmat electrònicament a REDESTINA el {{firmat_at}} per {{firmant.nombre}}, {{firmant.cargo}}, en nom de {{organitzacio.raso_social}}."},
  {"tipo":"p","text":"⚠️ RECORDATORI: ESBORRANY DE TREBALL. Text pendent de validació per l'assessoria jurídica. Aquest document no té valor contractual."}
 ]$json$::jsonb,
 array['numero','ejercici','firmat_at',
       'organitzacio.raso_social','organitzacio.nif','organitzacio.domicili',
       'organitzacio.codi_postal','organitzacio.poblacio',
       'firmant.nombre','firmant.cargo',
       'fundacio.raso_social','fundacio.cif','fundacio.domicili','fundacio.codi_postal',
       'fundacio.poblacio','fundacio.inscripcio','fundacio.apoderada_nom','fundacio.apoderada_carrec']),

-- ===========================================================================
-- 2. Convenio de donación del generador — castellano
-- ===========================================================================
('CONV', 'don_gen', 'es', 1,
 '[BORRADOR] Convenio de colaboración para la donación de alimentos fuera del circuito de venta habitual',
 $json$[
  {"tipo":"p","text":"⚠️ BORRADOR DE TRABAJO — TEXTO PENDIENTE DE VALIDACIÓN POR LA ASESORÍA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS. Este documento NO tiene valor contractual. No lo enviéis a firmar."},
  {"tipo":"h1","text":"Convenio de colaboración para la donación de alimentos fuera del circuito de venta habitual"},
  {"tipo":"p","text":"Convenio número {{numero}} · ejercicio {{ejercici}}"},

  {"tipo":"h2","text":"Reunidos"},
  {"tipo":"p","text":"De una parte, {{fundacio.raso_social}}, con NIF {{fundacio.cif}} y domicilio en {{fundacio.domicili}}, {{fundacio.codi_postal}} {{fundacio.poblacio}}, {{fundacio.inscripcio}} (en adelante, la Fundación), representada por {{fundacio.apoderada_nom}}, en calidad de {{fundacio.apoderada_carrec}}."},
  {"tipo":"p","text":"Y de otra parte, {{organitzacio.raso_social}}, con NIF {{organitzacio.nif}} y domicilio en {{organitzacio.domicili}}, {{organitzacio.codi_postal}} {{organitzacio.poblacio}} (en adelante, la parte generadora), representada por {{firmant.nombre}}, en calidad de {{firmant.cargo}}, que declara tener poderes suficientes."},

  {"tipo":"h2","text":"Manifiestan"},
  {"tipo":"p","text":"Que la Fundació Espigoladors trabaja para aprovechar los alimentos que quedan fuera del circuito de venta habitual, generar empleo de calidad para colectivos en riesgo de exclusión y sensibilizar sobre las pérdidas y el desperdicio alimentario."},
  {"tipo":"p","text":"Que REDESTINA es el servicio de la Fundación que canaliza esos alimentos hacia entidades sociales, salidas comerciales, transformación y espigueo, y que da soporte tecnológico a todo el proceso."},
  {"tipo":"p","text":"Que la parte generadora produce o dispone de alimentos aptos para el consumo que, por razones de calibre, aspecto, excedente de cosecha, cambio de pedido o cualquier otra causa ajena a la seguridad alimentaria, quedan fuera del circuito de venta habitual."},
  {"tipo":"p","text":"Que ambas partes desean colaborar para que esos alimentos lleguen a personas que los necesitan, y por ello suscriben este convenio con las cláusulas siguientes."},

  {"tipo":"h2","text":"Cláusulas"},

  {"tipo":"h3","text":"1. Objeto"},
  {"tipo":"p","text":"Facilitar, mediante REDESTINA, la donación de alimentos de la parte generadora a entidades receptoras con servicio de distribución de alimentos, así como los espigueos que se realicen en sus fincas."},

  {"tipo":"h3","text":"2. Papel de la Fundación"},
  {"tipo":"p","text":"La Fundación dinamiza el servicio, propone destinatarios, coordina las recogidas y registra las operaciones en REDESTINA. En las donaciones la Fundación es parte del intercambio: recibe los alimentos de la parte generadora y los entrega a la entidad receptora, y emite la documentación de ambos tramos."},

  {"tipo":"h3","text":"3. Compromisos de la parte generadora"},
  {"tipo":"lista","text":[
    "Facilitar información veraz sobre el producto, la cantidad, el estado y la disponibilidad.",
    "Garantizar que los alimentos son aptos para el consumo humano y cumplen la normativa de seguridad alimentaria que le es aplicable.",
    "Respetar las recogidas confirmadas o avisar con la máxima antelación posible si no pueden realizarse.",
    "Facilitar el acceso a la finca o al almacén en el horario acordado y las condiciones mínimas de carga."
  ]},

  {"tipo":"h3","text":"4. Espigueo"},
  {"tipo":"p","text":"Cuando la donación se realice por espigueo, la parte generadora autoriza la entrada en la finca del equipo y del voluntariado de la Fundación en las fechas acordadas. La Fundación responde de la organización de la jornada, de la cobertura de seguro del voluntariado y de dejar la finca en las condiciones en que la encontró."},

  {"tipo":"h3","text":"5. Documentación y trazabilidad"},
  {"tipo":"p","text":"Cada recogida genera un albarán de recepción con los kilos pesados, sin importes. La parte generadora recibe copia y puede confirmarlo mediante un enlace, sin necesidad de tener cuenta en REDESTINA."},

  {"tipo":"h3","text":"6. Valoración anual y certificado de donación"},
  {"tipo":"p","text":"Cerrado el ejercicio, la Fundación calcula los kilos conciliados y su valor a partir del coste por kilo de cada producto, y emite un resumen anual. Con la factura o documento equivalente que emita la parte generadora por ese importe, la Fundación emite el certificado de donación correspondiente."},
  {"tipo":"p","text":"La valoración no comporta pago alguno entre las partes: es el valor que la normativa exige para documentar la donación."},

  {"tipo":"h3","text":"7. Confidencialidad y uso de los datos"},
  {"tipo":"p","text":"Las cantidades y los valores económicos son visibles únicamente para la parte implicada y para la Fundación. La Fundación puede hacer un uso agregado y anónimo para sus indicadores y su memoria de actividad."},

  {"tipo":"h3","text":"8. Comunicaciones"},
  {"tipo":"p","text":"Las comunicaciones se realizan por REDESTINA, por correo electrónico y, con el consentimiento expreso que se otorga al firmar este convenio, por WhatsApp. Este consentimiento puede retirarse en cualquier momento escribiendo BAJA o comunicándolo a la Fundación."},

  {"tipo":"h3","text":"9. Firma electrónica y registro de evidencias"},
  {"tipo":"p","text":"Las partes aceptan la firma electrónica dentro de REDESTINA y el registro de evidencias que la acompaña: identidad declarada, control de la dirección de correo, huella digital del texto aceptado, fecha, dirección IP y navegador. Estas evidencias se conservan mientras dure la relación y durante los plazos legales de prescripción."},

  {"tipo":"h3","text":"10. Protección de datos"},
  {"tipo":"p","text":"Los datos personales se tratan conforme al Reglamento (UE) 2016/679 y a la Ley Orgánica 3/2018, con la finalidad de gestionar esta colaboración. No se ceden a terceros fuera de los casos previstos por la ley. Los derechos de acceso, rectificación, supresión, limitación, oposición y portabilidad se ejercen ante la Fundación."},

  {"tipo":"h3","text":"11. Jerarquía de usos"},
  {"tipo":"p","text":"Las partes asumen la jerarquía de prioridades de la Ley 1/2025 de prevención de las pérdidas y el desperdicio alimentario: primero el consumo humano, después la alimentación animal y, por último, el resto de usos."},

  {"tipo":"h3","text":"12. Vigencia"},
  {"tipo":"p","text":"Este convenio tiene una vigencia de un año desde la fecha de firma y se prorroga tácitamente por periodos iguales, salvo que cualquiera de las partes lo denuncie con dos meses de antelación."},

  {"tipo":"h3","text":"13. Resolución"},
  {"tipo":"p","text":"Son causas de resolución el mutuo acuerdo, el incumplimiento grave de las obligaciones, la imposibilidad sobrevenida de cumplirlas y cualquier cambio normativo que lo impida."},

  {"tipo":"h3","text":"14. Jurisdicción"},
  {"tipo":"p","text":"Las partes se someten a los juzgados y tribunales de Barcelona, con renuncia a cualquier otro fuero."},

  {"tipo":"h2","text":"Firma"},
  {"tipo":"p","text":"Firmado electrónicamente en REDESTINA el {{firmat_at}} por {{firmant.nombre}}, {{firmant.cargo}}, en nombre de {{organitzacio.raso_social}}."},
  {"tipo":"p","text":"⚠️ RECORDATORIO: BORRADOR DE TRABAJO. Texto pendiente de validación por la asesoría jurídica. Este documento no tiene valor contractual."}
 ]$json$::jsonb,
 array['numero','ejercici','firmat_at',
       'organitzacio.raso_social','organitzacio.nif','organitzacio.domicili',
       'organitzacio.codi_postal','organitzacio.poblacio',
       'firmant.nombre','firmant.cargo',
       'fundacio.raso_social','fundacio.cif','fundacio.domicili','fundacio.codi_postal',
       'fundacio.poblacio','fundacio.inscripcio','fundacio.apoderada_nom','fundacio.apoderada_carrec']),

-- ===========================================================================
-- 3. Convenio de entidad receptora — català
-- ===========================================================================
('CONV', 'don_rec', 'ca', 1,
 '[ESBORRANY] Conveni de col·laboració amb entitat receptora d''aliments',
 $json$[
  {"tipo":"p","text":"⚠️ ESBORRANY DE TREBALL — TEXT PENDENT DE VALIDACIÓ PER L'ASSESSORIA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS. Aquest document NO té valor contractual. No l'envieu a firmar."},
  {"tipo":"h1","text":"Conveni de col·laboració amb entitat receptora d'aliments"},
  {"tipo":"p","text":"Conveni número {{numero}} · exercici {{ejercici}}"},

  {"tipo":"h2","text":"Reunits"},
  {"tipo":"p","text":"D'una banda, {{fundacio.raso_social}}, amb NIF {{fundacio.cif}} i domicili a {{fundacio.domicili}}, {{fundacio.codi_postal}} {{fundacio.poblacio}}, {{fundacio.inscripcio}} (en endavant, la Fundació), representada per {{fundacio.apoderada_nom}}, en qualitat de {{fundacio.apoderada_carrec}}."},
  {"tipo":"p","text":"I d'altra banda, {{organitzacio.raso_social}}, amb NIF {{organitzacio.nif}} i domicili a {{organitzacio.domicili}}, {{organitzacio.codi_postal}} {{organitzacio.poblacio}} (en endavant, l'entitat receptora), representada per {{firmant.nombre}}, en qualitat de {{firmant.cargo}}, que declara tenir-ne poders suficients."},

  {"tipo":"h2","text":"Manifesten"},
  {"tipo":"p","text":"Que la Fundació Espigoladors canalitza, mitjançant el servei REDESTINA, aliments aptes per al consum que queden fora del circuit de venda habitual."},
  {"tipo":"p","text":"Que l'entitat receptora desenvolupa un servei de distribució d'aliments adreçat a persones o famílies en situació de vulnerabilitat, i disposa dels mitjans per rebre'ls, conservar-los i repartir-los."},
  {"tipo":"p","text":"Que totes dues parts volen col·laborar per fer arribar aquests aliments a les persones ateses per l'entitat, i per això subscriuen aquest conveni."},

  {"tipo":"h2","text":"Clàusules"},

  {"tipo":"h3","text":"1. Objecte"},
  {"tipo":"p","text":"Regular el lliurament d'aliments de la Fundació a l'entitat receptora a través de REDESTINA, i les obligacions de traçabilitat i informació que se'n deriven."},

  {"tipo":"h3","text":"2. Gratuïtat"},
  {"tipo":"p","text":"Els aliments es lliuren de manera gratuïta. L'entitat receptora no pot vendre'ls ni cedir-los a tercers a canvi de contraprestació, ni destinar-los a cap finalitat diferent de la seva activitat de distribució social d'aliments."},

  {"tipo":"h3","text":"3. Compromisos de l'entitat receptora"},
  {"tipo":"lista","text":[
    "Recollir els lots acceptats en la data i l'horari acordats, o avisar amb antelació si no és possible.",
    "Transportar i conservar els aliments en condicions adequades de temperatura i higiene.",
    "Complir la normativa de seguretat alimentària i d'higiene que li és aplicable, incloent-hi el registre sanitari quan escaigui.",
    "Destinar els aliments exclusivament a les persones ateses per l'entitat.",
    "Retornar els envasos retornables en el termini acordat."
  ]},

  {"tipo":"h3","text":"4. Confirmació de la recepció a REDESTINA"},
  {"tipo":"p","text":"L'entitat receptora es compromet a confirmar a REDESTINA la recepció de cada lot i els quilos realment rebuts, mitjançant l'enllaç que rep per correu o des del seu panell. Aquesta confirmació és el que permet tancar la traçabilitat i emetre la documentació anual del donant."},
  {"tipo":"p","text":"Qualsevol rebuig, total o parcial, s'ha de justificar, documentar i comunicar a la Fundació."},

  {"tipo":"h3","text":"5. Dada anual de persones ateses"},
  {"tipo":"p","text":"L'entitat receptora facilitarà anualment el nombre de persones o unitats familiars ateses amb els aliments rebuts. Aquesta dada s'utilitza de manera agregada per als indicadors del servei i per a la memòria d'activitat de la Fundació."},

  {"tipo":"h3","text":"6. Responsabilitat"},
  {"tipo":"p","text":"A partir del lliurament, l'entitat receptora assumeix la responsabilitat sobre la conservació, la manipulació i el repartiment dels aliments rebuts."},

  {"tipo":"h3","text":"7. Comunicacions"},
  {"tipo":"p","text":"Les comunicacions es fan per REDESTINA, per correu electrònic i, amb el consentiment exprés que s'atorga en firmar aquest conveni, per WhatsApp. Aquest consentiment es pot retirar en qualsevol moment escrivint BAIXA o comunicant-ho a la Fundació."},

  {"tipo":"h3","text":"8. Firma electrònica i registre d'evidències"},
  {"tipo":"p","text":"Les parts accepten la firma electrònica dins de REDESTINA i el registre d'evidències que l'acompanya: identitat declarada, control de l'adreça de correu, petjada digital del text acceptat, data, adreça IP i navegador."},

  {"tipo":"h3","text":"9. Protecció de dades"},
  {"tipo":"p","text":"Les dades personals es tracten conforme al Reglament (UE) 2016/679 i a la Llei orgànica 3/2018. Les dades de les persones ateses per l'entitat NO es comuniquen a la Fundació en cap cas: només el nombre agregat de la clàusula 5."},

  {"tipo":"h3","text":"10. Jerarquia d'usos"},
  {"tipo":"p","text":"Les parts assumeixen la jerarquia de prioritats de la Llei 1/2025 de prevenció de les pèrdues i el malbaratament alimentari. Els aliments que no es puguin destinar al consum humà es redirigiran, sempre que sigui possible, a alimentació animal abans que a qualsevol altre ús."},

  {"tipo":"h3","text":"11. Vigència"},
  {"tipo":"p","text":"Aquest conveni té una vigència d'un any des de la data de firma i es prorroga tàcitament per períodes iguals, llevat que qualsevol de les parts el denunciï amb dos mesos d'antelació."},

  {"tipo":"h3","text":"12. Resolució"},
  {"tipo":"p","text":"Són causes de resolució el mutu acord, l'incompliment greu de les obligacions —en particular la clàusula 2—, la impossibilitat sobrevinguda de complir-les i qualsevol canvi normatiu que ho impedeixi."},

  {"tipo":"h3","text":"13. Jurisdicció"},
  {"tipo":"p","text":"Les parts se sotmeten als jutjats i tribunals de Barcelona, amb renúncia a qualsevol altre fur."},

  {"tipo":"h2","text":"Firma"},
  {"tipo":"p","text":"Firmat electrònicament a REDESTINA el {{firmat_at}} per {{firmant.nombre}}, {{firmant.cargo}}, en nom de {{organitzacio.raso_social}}."},
  {"tipo":"p","text":"⚠️ RECORDATORI: ESBORRANY DE TREBALL. Text pendent de validació per l'assessoria jurídica. Aquest document no té valor contractual."}
 ]$json$::jsonb,
 array['numero','ejercici','firmat_at',
       'organitzacio.raso_social','organitzacio.nif','organitzacio.domicili',
       'organitzacio.codi_postal','organitzacio.poblacio',
       'firmant.nombre','firmant.cargo',
       'fundacio.raso_social','fundacio.cif','fundacio.domicili','fundacio.codi_postal',
       'fundacio.poblacio','fundacio.inscripcio','fundacio.apoderada_nom','fundacio.apoderada_carrec']),

-- ===========================================================================
-- 4. Convenio de entidad receptora — castellano
-- ===========================================================================
('CONV', 'don_rec', 'es', 1,
 '[BORRADOR] Convenio de colaboración con entidad receptora de alimentos',
 $json$[
  {"tipo":"p","text":"⚠️ BORRADOR DE TRABAJO — TEXTO PENDIENTE DE VALIDACIÓN POR LA ASESORÍA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS. Este documento NO tiene valor contractual. No lo enviéis a firmar."},
  {"tipo":"h1","text":"Convenio de colaboración con entidad receptora de alimentos"},
  {"tipo":"p","text":"Convenio número {{numero}} · ejercicio {{ejercici}}"},

  {"tipo":"h2","text":"Reunidos"},
  {"tipo":"p","text":"De una parte, {{fundacio.raso_social}}, con NIF {{fundacio.cif}} y domicilio en {{fundacio.domicili}}, {{fundacio.codi_postal}} {{fundacio.poblacio}}, {{fundacio.inscripcio}} (en adelante, la Fundación), representada por {{fundacio.apoderada_nom}}, en calidad de {{fundacio.apoderada_carrec}}."},
  {"tipo":"p","text":"Y de otra parte, {{organitzacio.raso_social}}, con NIF {{organitzacio.nif}} y domicilio en {{organitzacio.domicili}}, {{organitzacio.codi_postal}} {{organitzacio.poblacio}} (en adelante, la entidad receptora), representada por {{firmant.nombre}}, en calidad de {{firmant.cargo}}, que declara tener poderes suficientes."},

  {"tipo":"h2","text":"Manifiestan"},
  {"tipo":"p","text":"Que la Fundació Espigoladors canaliza, mediante el servicio REDESTINA, alimentos aptos para el consumo que quedan fuera del circuito de venta habitual."},
  {"tipo":"p","text":"Que la entidad receptora desarrolla un servicio de distribución de alimentos dirigido a personas o familias en situación de vulnerabilidad, y dispone de los medios para recibirlos, conservarlos y repartirlos."},
  {"tipo":"p","text":"Que ambas partes desean colaborar para hacer llegar estos alimentos a las personas atendidas por la entidad, y por ello suscriben este convenio."},

  {"tipo":"h2","text":"Cláusulas"},

  {"tipo":"h3","text":"1. Objeto"},
  {"tipo":"p","text":"Regular la entrega de alimentos de la Fundación a la entidad receptora a través de REDESTINA, y las obligaciones de trazabilidad e información que de ello se derivan."},

  {"tipo":"h3","text":"2. Gratuidad"},
  {"tipo":"p","text":"Los alimentos se entregan de forma gratuita. La entidad receptora no puede venderlos ni cederlos a terceros a cambio de contraprestación, ni destinarlos a finalidad distinta de su actividad de distribución social de alimentos."},

  {"tipo":"h3","text":"3. Compromisos de la entidad receptora"},
  {"tipo":"lista","text":[
    "Recoger los lotes aceptados en la fecha y el horario acordados, o avisar con antelación si no es posible.",
    "Transportar y conservar los alimentos en condiciones adecuadas de temperatura e higiene.",
    "Cumplir la normativa de seguridad alimentaria e higiene que le es aplicable, incluido el registro sanitario cuando proceda.",
    "Destinar los alimentos exclusivamente a las personas atendidas por la entidad.",
    "Devolver los envases retornables en el plazo acordado."
  ]},

  {"tipo":"h3","text":"4. Confirmación de la recepción en REDESTINA"},
  {"tipo":"p","text":"La entidad receptora se compromete a confirmar en REDESTINA la recepción de cada lote y los kilos realmente recibidos, mediante el enlace que recibe por correo o desde su panel. Esta confirmación es lo que permite cerrar la trazabilidad y emitir la documentación anual del donante."},
  {"tipo":"p","text":"Cualquier rechazo, total o parcial, debe justificarse, documentarse y comunicarse a la Fundación."},

  {"tipo":"h3","text":"5. Dato anual de personas atendidas"},
  {"tipo":"p","text":"La entidad receptora facilitará anualmente el número de personas o unidades familiares atendidas con los alimentos recibidos. Este dato se utiliza de forma agregada para los indicadores del servicio y para la memoria de actividad de la Fundación."},

  {"tipo":"h3","text":"6. Responsabilidad"},
  {"tipo":"p","text":"A partir de la entrega, la entidad receptora asume la responsabilidad sobre la conservación, la manipulación y el reparto de los alimentos recibidos."},

  {"tipo":"h3","text":"7. Comunicaciones"},
  {"tipo":"p","text":"Las comunicaciones se realizan por REDESTINA, por correo electrónico y, con el consentimiento expreso que se otorga al firmar este convenio, por WhatsApp. Este consentimiento puede retirarse en cualquier momento escribiendo BAJA o comunicándolo a la Fundación."},

  {"tipo":"h3","text":"8. Firma electrónica y registro de evidencias"},
  {"tipo":"p","text":"Las partes aceptan la firma electrónica dentro de REDESTINA y el registro de evidencias que la acompaña: identidad declarada, control de la dirección de correo, huella digital del texto aceptado, fecha, dirección IP y navegador."},

  {"tipo":"h3","text":"9. Protección de datos"},
  {"tipo":"p","text":"Los datos personales se tratan conforme al Reglamento (UE) 2016/679 y a la Ley Orgánica 3/2018. Los datos de las personas atendidas por la entidad NO se comunican a la Fundación en ningún caso: únicamente el número agregado de la cláusula 5."},

  {"tipo":"h3","text":"10. Jerarquía de usos"},
  {"tipo":"p","text":"Las partes asumen la jerarquía de prioridades de la Ley 1/2025 de prevención de las pérdidas y el desperdicio alimentario. Los alimentos que no puedan destinarse al consumo humano se redirigirán, siempre que sea posible, a alimentación animal antes que a cualquier otro uso."},

  {"tipo":"h3","text":"11. Vigencia"},
  {"tipo":"p","text":"Este convenio tiene una vigencia de un año desde la fecha de firma y se prorroga tácitamente por periodos iguales, salvo que cualquiera de las partes lo denuncie con dos meses de antelación."},

  {"tipo":"h3","text":"12. Resolución"},
  {"tipo":"p","text":"Son causas de resolución el mutuo acuerdo, el incumplimiento grave de las obligaciones —en particular la cláusula 2—, la imposibilidad sobrevenida de cumplirlas y cualquier cambio normativo que lo impida."},

  {"tipo":"h3","text":"13. Jurisdicción"},
  {"tipo":"p","text":"Las partes se someten a los juzgados y tribunales de Barcelona, con renuncia a cualquier otro fuero."},

  {"tipo":"h2","text":"Firma"},
  {"tipo":"p","text":"Firmado electrónicamente en REDESTINA el {{firmat_at}} por {{firmant.nombre}}, {{firmant.cargo}}, en nombre de {{organitzacio.raso_social}}."},
  {"tipo":"p","text":"⚠️ RECORDATORIO: BORRADOR DE TRABAJO. Texto pendiente de validación por la asesoría jurídica. Este documento no tiene valor contractual."}
 ]$json$::jsonb,
 array['numero','ejercici','firmat_at',
       'organitzacio.raso_social','organitzacio.nif','organitzacio.domicili',
       'organitzacio.codi_postal','organitzacio.poblacio',
       'firmant.nombre','firmant.cargo',
       'fundacio.raso_social','fundacio.cif','fundacio.domicili','fundacio.codi_postal',
       'fundacio.poblacio','fundacio.inscripcio','fundacio.apoderada_nom','fundacio.apoderada_carrec']),

-- ===========================================================================
-- 5. Convenio de compraventa y maquila — català (anexo C)
-- ===========================================================================
('CONV', 'com', 'ca', 1,
 '[ESBORRANY] Conveni de col·laboració per a la sortida comercial i la transformació d''aliments',
 $json$[
  {"tipo":"p","text":"⚠️ ESBORRANY DE TREBALL — TEXT PENDENT DE VALIDACIÓ PER L'ASSESSORIA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS. Aquest document NO té valor contractual. No l'envieu a firmar."},
  {"tipo":"h1","text":"Conveni de col·laboració per a la sortida comercial d'aliments fora del circuit de venda habitual i per a serveis de transformació"},
  {"tipo":"p","text":"Conveni número {{numero}} · exercici {{ejercici}}"},

  {"tipo":"h2","text":"Reunits"},
  {"tipo":"p","text":"D'una banda, {{fundacio.raso_social}}, amb NIF {{fundacio.cif}} i domicili a {{fundacio.domicili}}, {{fundacio.codi_postal}} {{fundacio.poblacio}}, {{fundacio.inscripcio}} (en endavant, la Fundació), representada per {{fundacio.apoderada_nom}}, en qualitat de {{fundacio.apoderada_carrec}}."},
  {"tipo":"p","text":"I d'altra banda, {{organitzacio.raso_social}}, amb NIF {{organitzacio.nif}} i domicili a {{organitzacio.domicili}}, {{organitzacio.codi_postal}} {{organitzacio.poblacio}} (en endavant, l'organització), representada per {{firmant.nombre}}, en qualitat de {{firmant.cargo}}, que declara tenir-ne poders suficients."},
  {"tipo":"p","text":"L'organització subscriu aquest conveni en els rols següents: {{roles}}. Una mateixa organització pot actuar en més d'un rol."},

  {"tipo":"h2","text":"Manifesten"},
  {"tipo":"p","text":"Que la Fundació Espigoladors treballa per aprofitar els aliments que queden fora del circuit de venda habitual i que REDESTINA és el servei amb què connecta generadors, compradors i obradors."},
  {"tipo":"p","text":"Que no tota la producció fora del circuit de venda habitual es pot destinar a donació, i que la sortida comercial i la transformació són vies legítimes i necessàries perquè aquests aliments no es perdin."},
  {"tipo":"p","text":"Que l'organització desenvolupa una activitat compatible amb el rol o els rols que declara, i que totes dues parts volen col·laborar mitjançant REDESTINA."},

  {"tipo":"h2","text":"Clàusules"},

  {"tipo":"h3","text":"1. Objecte"},
  {"tipo":"p","text":"Facilitar mitjançant REDESTINA la connexió entre generadors, compradors i obradors per donar sortida comercial a aliments fora del circuit de venda habitual o per transformar-los mitjançant maquila."},

  {"tipo":"h3","text":"2. Paper de la Fundació"},
  {"tipo":"p","text":"La Fundació dinamitza, proposa i registra les operacions. NO és part de la compravenda: no compra, no ven, no cobra i no paga. El preu, la facturació i el pagament s'acorden i es tramiten directament entre les parts, fora de la plataforma."},
  {"tipo":"p","text":"La Fundació es reserva la possibilitat de fixar condicions econòmiques pel servei en el futur, amb avís previ i una nova acceptació per part de l'organització."},

  {"tipo":"h3","text":"3. Compromisos de la part venedora"},
  {"tipo":"lista","text":[
    "Facilitar informació veraç sobre el producte, la quantitat, l'estat i la disponibilitat.",
    "Garantir que els aliments són aptes per al consum i compleixen la normativa de seguretat alimentària.",
    "Respectar les operacions confirmades o avisar amb la màxima antelació possible."
  ]},

  {"tipo":"h3","text":"4. Compromisos de la part compradora"},
  {"tipo":"lista","text":[
    "Destinar el producte a l'activitat declarada.",
    "Manipular i transportar els aliments en condicions adequades.",
    "Confirmar a REDESTINA la recepció i els quilos rebuts.",
    "Pagar segons el que hagi pactat amb la part venedora."
  ]},

  {"tipo":"h3","text":"5. Obrador i maquila"},
  {"tipo":"p","text":"En les operacions de maquila, la part generadora conserva la propietat del producte en tot moment. L'obrador presta un servei de transformació amb la tipologia acordada, respon de la custòdia del producte mentre el té i el retorna transformat en les condicions pactades."},

  {"tipo":"h3","text":"6. Preus i confidencialitat"},
  {"tipo":"p","text":"Els preus i els valors econòmics de cada operació són visibles només per a l'organització implicada i per a la Fundació. La Fundació en pot fer un ús agregat i anònim per als seus indicadors. En cap cas es fan públics."},

  {"tipo":"h3","text":"7. Jerarquia d'usos"},
  {"tipo":"p","text":"Les parts assumeixen la jerarquia de prioritats de la Llei 1/2025. Si una operació comercial no es completa, el producte es pot redirigir a donació sempre que hi hagi el conveni corresponent."},

  {"tipo":"h3","text":"8. Documentació"},
  {"tipo":"p","text":"Cada operació genera un albarà d'operació sense imports, que totes dues parts confirmen per enllaç. La facturació entre les parts és aliena a REDESTINA."},

  {"tipo":"h3","text":"9. Rebuig"},
  {"tipo":"p","text":"Qualsevol rebuig, total o parcial, s'ha de justificar, documentar i comunicar a l'altra part i a la Fundació."},

  {"tipo":"h3","text":"10. Comunicacions"},
  {"tipo":"p","text":"Les comunicacions es fan per REDESTINA, per correu electrònic i, amb el consentiment exprés que s'atorga en firmar aquest conveni, per WhatsApp. Aquest consentiment es pot retirar en qualsevol moment."},

  {"tipo":"h3","text":"11. Firma electrònica i registre d'evidències"},
  {"tipo":"p","text":"Les parts accepten la firma electrònica dins de REDESTINA i el registre d'evidències que l'acompanya: identitat declarada, control de l'adreça de correu, petjada digital del text acceptat, data, adreça IP i navegador."},

  {"tipo":"h3","text":"12. Protecció de dades"},
  {"tipo":"p","text":"Les dades personals es tracten conforme al Reglament (UE) 2016/679 i a la Llei orgànica 3/2018, per a ús intern i agregat, sense cessió a tercers fora dels casos previstos per la llei."},

  {"tipo":"h3","text":"13. Vigència"},
  {"tipo":"p","text":"Aquest conveni té una vigència d'un any des de la data de firma i es prorroga tàcitament per períodes iguals, llevat que qualsevol de les parts el denunciï amb dos mesos d'antelació."},

  {"tipo":"h3","text":"14. Resolució"},
  {"tipo":"p","text":"Són causes de resolució el mutu acord, l'incompliment greu de les obligacions, la impossibilitat sobrevinguda de complir-les i qualsevol canvi normatiu que ho impedeixi."},

  {"tipo":"h3","text":"15. Jurisdicció"},
  {"tipo":"p","text":"Les parts se sotmeten als jutjats i tribunals de Barcelona, amb renúncia a qualsevol altre fur."},

  {"tipo":"h2","text":"Firma"},
  {"tipo":"p","text":"Firmat electrònicament a REDESTINA el {{firmat_at}} per {{firmant.nombre}}, {{firmant.cargo}}, en nom de {{organitzacio.raso_social}}."},
  {"tipo":"p","text":"⚠️ RECORDATORI: ESBORRANY DE TREBALL. Text pendent de validació per l'assessoria jurídica. Aquest document no té valor contractual."}
 ]$json$::jsonb,
 array['numero','ejercici','firmat_at','roles',
       'organitzacio.raso_social','organitzacio.nif','organitzacio.domicili',
       'organitzacio.codi_postal','organitzacio.poblacio',
       'firmant.nombre','firmant.cargo',
       'fundacio.raso_social','fundacio.cif','fundacio.domicili','fundacio.codi_postal',
       'fundacio.poblacio','fundacio.inscripcio','fundacio.apoderada_nom','fundacio.apoderada_carrec']),

-- ===========================================================================
-- 6. Convenio de compraventa y maquila — castellano (anexo C)
-- ===========================================================================
('CONV', 'com', 'es', 1,
 '[BORRADOR] Convenio de colaboración para la salida comercial y la transformación de alimentos',
 $json$[
  {"tipo":"p","text":"⚠️ BORRADOR DE TRABAJO — TEXTO PENDIENTE DE VALIDACIÓN POR LA ASESORÍA JURÍDICA DE LA FUNDACIÓ ESPIGOLADORS. Este documento NO tiene valor contractual. No lo enviéis a firmar."},
  {"tipo":"h1","text":"Convenio de colaboración para la salida comercial de alimentos fuera del circuito de venta habitual y para servicios de transformación"},
  {"tipo":"p","text":"Convenio número {{numero}} · ejercicio {{ejercici}}"},

  {"tipo":"h2","text":"Reunidos"},
  {"tipo":"p","text":"De una parte, {{fundacio.raso_social}}, con NIF {{fundacio.cif}} y domicilio en {{fundacio.domicili}}, {{fundacio.codi_postal}} {{fundacio.poblacio}}, {{fundacio.inscripcio}} (en adelante, la Fundación), representada por {{fundacio.apoderada_nom}}, en calidad de {{fundacio.apoderada_carrec}}."},
  {"tipo":"p","text":"Y de otra parte, {{organitzacio.raso_social}}, con NIF {{organitzacio.nif}} y domicilio en {{organitzacio.domicili}}, {{organitzacio.codi_postal}} {{organitzacio.poblacio}} (en adelante, la organización), representada por {{firmant.nombre}}, en calidad de {{firmant.cargo}}, que declara tener poderes suficientes."},
  {"tipo":"p","text":"La organización suscribe este convenio en los siguientes roles: {{roles}}. Una misma organización puede actuar en más de un rol."},

  {"tipo":"h2","text":"Manifiestan"},
  {"tipo":"p","text":"Que la Fundació Espigoladors trabaja para aprovechar los alimentos que quedan fuera del circuito de venta habitual y que REDESTINA es el servicio con el que conecta generadores, compradores y obradores."},
  {"tipo":"p","text":"Que no toda la producción fuera del circuito de venta habitual puede destinarse a donación, y que la salida comercial y la transformación son vías legítimas y necesarias para que esos alimentos no se pierdan."},
  {"tipo":"p","text":"Que la organización desarrolla una actividad compatible con el rol o los roles que declara, y que ambas partes desean colaborar mediante REDESTINA."},

  {"tipo":"h2","text":"Cláusulas"},

  {"tipo":"h3","text":"1. Objeto"},
  {"tipo":"p","text":"Facilitar mediante REDESTINA la conexión entre generadores, compradores y obradores para dar salida comercial a alimentos fuera del circuito de venta habitual o para transformarlos mediante maquila."},

  {"tipo":"h3","text":"2. Papel de la Fundación"},
  {"tipo":"p","text":"La Fundación dinamiza, propone y registra las operaciones. NO es parte de la compraventa: no compra, no vende, no cobra y no paga. El precio, la facturación y el pago se acuerdan y se tramitan directamente entre las partes, fuera de la plataforma."},
  {"tipo":"p","text":"La Fundación se reserva la posibilidad de fijar condiciones económicas por el servicio en el futuro, con aviso previo y una nueva aceptación por parte de la organización."},

  {"tipo":"h3","text":"3. Compromisos de la parte vendedora"},
  {"tipo":"lista","text":[
    "Facilitar información veraz sobre el producto, la cantidad, el estado y la disponibilidad.",
    "Garantizar que los alimentos son aptos para el consumo y cumplen la normativa de seguridad alimentaria.",
    "Respetar las operaciones confirmadas o avisar con la máxima antelación posible."
  ]},

  {"tipo":"h3","text":"4. Compromisos de la parte compradora"},
  {"tipo":"lista","text":[
    "Destinar el producto a la actividad declarada.",
    "Manipular y transportar los alimentos en condiciones adecuadas.",
    "Confirmar en REDESTINA la recepción y los kilos recibidos.",
    "Pagar según lo pactado con la parte vendedora."
  ]},

  {"tipo":"h3","text":"5. Obrador y maquila"},
  {"tipo":"p","text":"En las operaciones de maquila, la parte generadora conserva la propiedad del producto en todo momento. El obrador presta un servicio de transformación con la tipología acordada, responde de la custodia del producto mientras lo tiene y lo devuelve transformado en las condiciones pactadas."},

  {"tipo":"h3","text":"6. Precios y confidencialidad"},
  {"tipo":"p","text":"Los precios y los valores económicos de cada operación son visibles únicamente para la organización implicada y para la Fundación. La Fundación puede hacer un uso agregado y anónimo para sus indicadores. En ningún caso se hacen públicos."},

  {"tipo":"h3","text":"7. Jerarquía de usos"},
  {"tipo":"p","text":"Las partes asumen la jerarquía de prioridades de la Ley 1/2025. Si una operación comercial no se completa, el producto puede redirigirse a donación siempre que exista el convenio correspondiente."},

  {"tipo":"h3","text":"8. Documentación"},
  {"tipo":"p","text":"Cada operación genera un albarán de operación sin importes, que ambas partes confirman por enlace. La facturación entre las partes es ajena a REDESTINA."},

  {"tipo":"h3","text":"9. Rechazo"},
  {"tipo":"p","text":"Cualquier rechazo, total o parcial, debe justificarse, documentarse y comunicarse a la otra parte y a la Fundación."},

  {"tipo":"h3","text":"10. Comunicaciones"},
  {"tipo":"p","text":"Las comunicaciones se realizan por REDESTINA, por correo electrónico y, con el consentimiento expreso que se otorga al firmar este convenio, por WhatsApp. Este consentimiento puede retirarse en cualquier momento."},

  {"tipo":"h3","text":"11. Firma electrónica y registro de evidencias"},
  {"tipo":"p","text":"Las partes aceptan la firma electrónica dentro de REDESTINA y el registro de evidencias que la acompaña: identidad declarada, control de la dirección de correo, huella digital del texto aceptado, fecha, dirección IP y navegador."},

  {"tipo":"h3","text":"12. Protección de datos"},
  {"tipo":"p","text":"Los datos personales se tratan conforme al Reglamento (UE) 2016/679 y a la Ley Orgánica 3/2018, para uso interno y agregado, sin cesión a terceros fuera de los casos previstos por la ley."},

  {"tipo":"h3","text":"13. Vigencia"},
  {"tipo":"p","text":"Este convenio tiene una vigencia de un año desde la fecha de firma y se prorroga tácitamente por periodos iguales, salvo que cualquiera de las partes lo denuncie con dos meses de antelación."},

  {"tipo":"h3","text":"14. Resolución"},
  {"tipo":"p","text":"Son causas de resolución el mutuo acuerdo, el incumplimiento grave de las obligaciones, la imposibilidad sobrevenida de cumplirlas y cualquier cambio normativo que lo impida."},

  {"tipo":"h3","text":"15. Jurisdicción"},
  {"tipo":"p","text":"Las partes se someten a los juzgados y tribunales de Barcelona, con renuncia a cualquier otro fuero."},

  {"tipo":"h2","text":"Firma"},
  {"tipo":"p","text":"Firmado electrónicamente en REDESTINA el {{firmat_at}} por {{firmant.nombre}}, {{firmant.cargo}}, en nombre de {{organitzacio.raso_social}}."},
  {"tipo":"p","text":"⚠️ RECORDATORIO: BORRADOR DE TRABAJO. Texto pendiente de validación por la asesoría jurídica. Este documento no tiene valor contractual."}
 ]$json$::jsonb,
 array['numero','ejercici','firmat_at','roles',
       'organitzacio.raso_social','organitzacio.nif','organitzacio.domicili',
       'organitzacio.codi_postal','organitzacio.poblacio',
       'firmant.nombre','firmant.cargo',
       'fundacio.raso_social','fundacio.cif','fundacio.domicili','fundacio.codi_postal',
       'fundacio.poblacio','fundacio.inscripcio','fundacio.apoderada_nom','fundacio.apoderada_carrec'])

on conflict do nothing;

-- ⚠️ `{{roles}}` (solo en el modelo de compraventa) NO sale directamente de `roles_com`:
--    el array `['venedora','compradora']` impreso tal cual diría «venedora, compradora» en
--    catalán y en castellano a la vez. Lo compone `render/conv.ts` a partir de
--    `datos.roles_com` y del idioma del documento, que es donde vive la traducción; por eso
--    está declarado en `marcadores` pero no lo escribe ninguna función SQL.

-- Verificación:
--   select tipo, variante, idioma, version, vigente, left(titulo, 40) from plantillas_documento
--    where tipo = 'CONV' order by variante, idioma;              -- 6 filas, todas vigentes
--   select jsonb_array_length(cuerpo) from plantillas_documento where tipo = 'CONV';
--   select preparar_convenio('productor', '<uuid>', 'don_gen');  -- ya encuentra plantilla
