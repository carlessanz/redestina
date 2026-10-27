// La PARIDAD del modelo asistido (27-10-2026, R1 del plan de gestión autónoma): lo que el
// equipo hace en nombre de una parte deja las mismas filas y los mismos documentos que si lo
// hubiera hecho ella, y la parte lo ve en su panel (R2). A nivel de datos: las RPC se llaman
// COMO cada cuenta (`sqlCom`), igual que desde su sesión; las pantallas tienen sus pruebas.
//
// Solo contra el CLON LOCAL y en escritorio: consume numeración legal (CONV, REC, ENT). Tras la
// tanda, `scripts/local/cargar-local.sh` devuelve el clon a la copia de producción.

import { expect, test } from '@playwright/test'
import { compte, entidadDe, motiuSaltClon, productorDe, sql, sqlCom } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-carles'
const marca = Date.now()

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', RECEPTOR, 'super_admin', 'equip', 'receptor-social')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'de datos: una sola pasada')
})

/** Una oferta de donación publicada de la productora de prueba, sin franja. */
function oferta(producte: string, kg: number, sufix: string): string {
  const prod = productorDe('productor')
  return sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats, coste_kg, disponible_hasta, observacions, texto_oferta)
    values ('E-E2E-PA-${producte.slice(0, 3)}-${marca}-${sufix}', '${prod}', '${producte}', ${kg}, 'publicada', 'asistido', 'donacio', '{donacio}', 0.5, current_date + 5, '[E2E] paritat', '[E2E]')
    returning id`).split('\n')[0]
}

const DEMA = `((current_date + 1) + time '10:00') at time zone 'Europe/Madrid'`

let propia = ''
let assistida = ''
let canalPropia = ''
let canalAssistida = ''

test('el interés asistido deja la misma respuesta y la misma canalización que el propio', () => {
  const ent = entidadDe(RECEPTOR)
  // El clon arrastra albaranes de esta receptora con el enlace de confirmación sin usar desde
  // hace días, y eso la bloquea para pedir nada (G1, correcto). Aquí no es lo que se prueba.
  sql(`update enlaces_token t set estado = 'revocado'
         from albaranes a join canalizaciones c on c.id = a.canalizacion_id
        where t.objeto_tipo = 'albaran' and t.objeto_id = a.id and t.estado = 'activo'
          and t.usado_at is null and c.entidad_id = '${ent}'`)
  propia = oferta('Carbassa', 100, 'P')
  assistida = oferta('Carbassa', 100, 'A')

  sqlCom(RECEPTOR, `select (manifestar_interes('${propia}', '${ent}', 100, null, 4, null, ${DEMA})).id`)
  sqlCom('super_admin', `select (manifestar_interes_assistit('${assistida}', '${ent}', 100, null, 4, null, ${DEMA})).id`)

  const resposta = (exc: string) => sql(`select estado || '|' || aprovacio || '|' || kg_solicitados || '|' || caixes_solicitades
      || '|' || modalitat || '|' || recollida_at || '|' || coalesce(preu_ofert::text, '-')
    from oferta_respuestas where excedente_id = '${exc}'`)
  expect(resposta(assistida)).toBe(resposta(propia))
  expect(sql(`select canal from oferta_respuestas where excedente_id = '${propia}'`)).toBe('panel')
  expect(sql(`select canal from oferta_respuestas where excedente_id = '${assistida}'`)).toBe('asistido')

  // Las mismas guardas: el equipo tampoco pide más kilos que la oferta ni una hora pasada.
  expect(() => sqlCom('super_admin', `select manifestar_interes_assistit('${assistida}', '${ent}', 500)`)).toThrow(/kg_maxim/)
  expect(() => sqlCom('super_admin', `select manifestar_interes_assistit('${assistida}', '${ent}', 10, null, null, null, now() - interval '3 days')`)).toThrow(/hora_passada/)

  // Aprobadas las dos, nacen dos canalizaciones iguales.
  for (const exc of [propia, assistida]) {
    const r = sql(`select id from oferta_respuestas where excedente_id = '${exc}'`)
    sqlCom('super_admin', `select (aprovar_resposta('${r}', 100, null, null, null, null)).id`)
  }
  const canal = (exc: string) => sql(`select kg_confirmados || '|' || valorizacion || '|' || data_hora_recollida || '|' || estado
    from canalizaciones where excedente_id = '${exc}'`)
  expect(canal(assistida)).toBe(canal(propia))
  canalPropia = sql(`select id from canalizaciones where excedente_id = '${propia}'`)
  canalAssistida = sql(`select id from canalizaciones where excedente_id = '${assistida}'`)
})

test('la recogida asistida deja los mismos albaranes y líneas que la del receptor', () => {
  test.skip(!canalPropia || !canalAssistida, 'depende de la prueba anterior')
  const motiu = 'Faltava una caixa'
  // La recogida ya ha pasado (data_hora_recollida no es columna protegida).
  sql(`update canalizaciones set data_hora_recollida = now() - interval '1 hour' where id in ('${canalPropia}', '${canalAssistida}')`)

  // Camino del usuario: la receptora declara y un admin valida.
  sqlCom(RECEPTOR, `select registrar_recollida('${canalPropia}', 'menys', 90, null, '${motiu}')`)
  sqlCom('super_admin', `select validar_recollida('${canalPropia}', null, '${motiu}')`)
  // Camino asistido: el equipo, en un paso.
  sqlCom('super_admin', `select registrar_recollida_assistida('${canalAssistida}', 'menys', 90, null, '${motiu}', '${motiu}', null)`)

  const albarans = (exc: string) => sql(`select string_agg(a.tipo || ':' || a.estado || ':' || l.kg_previstos || '/' || l.kg_bruto || '/'
      || l.tara_kg || '/' || l.kg_neto || '/' || coalesce(l.kg_confirmados::text, '-') || '/' || coalesce(l.kg_validados::text, '-'),
      ',' order by a.tipo)
    from albaranes a join albaran_lineas l on l.albaran_id = a.id
   where a.id in (select id from albaranes where excedente_id = '${exc}'
                   union select id from albaranes where canalizacion_id in (select id from canalizaciones where excedente_id = '${exc}'))`)
  expect(albarans(propia)).toBe('ENT:conciliado:100/90.00/0/90.00/90.00/90.00,REC:conciliado:100/90.00/0/90.00/90.00/90.00')
  expect(albarans(assistida)).toBe(albarans(propia))

  const canal = (c: string) => sql(`select kg_declarats || '|' || kg_reales || '|' || resultat_recollida || '|' || kg_conciliados
      || '|' || estado || '|' || (incidencia_recollida->>'tipus')
    from canalizaciones where id = '${c}'`)
  expect(canal(canalAssistida)).toBe(canal(canalPropia))

  // Lo único distinto: quién lo hizo, y que la confirmación del ENT es asistida.
  expect(sql(`select incidencia_recollida->>'origen' from canalizaciones where id = '${canalPropia}'`)).toBe('entitat_receptora')
  expect(sql(`select incidencia_recollida->>'origen' from canalizaciones where id = '${canalAssistida}'`)).toBe('equip')
  const canalEnt = (c: string) => sql(`select t.canal from enlaces_token t join albaranes a on a.id = t.objeto_id
    where a.canalizacion_id = '${c}' and a.tipo = 'ENT' and t.rol_parte = 'recibe' and t.usado_at is not null`)
  expect(canalEnt(canalPropia)).toBe('panel')
  expect(canalEnt(canalAssistida)).toBe('asistido')

  // R2: la receptora y la productora lo ven en su panel como si lo hubieran hecho ellas.
  expect(sqlCom(RECEPTOR, `select count(*) from canalizaciones where id = '${canalAssistida}'`)).toBe('1')
  expect(sqlCom(RECEPTOR, `select count(*) from albaranes where canalizacion_id = '${canalAssistida}' and tipo = 'ENT'`)).toBe('1')
  expect(sqlCom('productor', `select count(*) from albaranes where excedente_id = '${assistida}' and tipo = 'REC'`)).toBe('1')
})

test('el convenio declarado deja la organización operando y ella lo ve vigente', () => {
  const ent = entidadDe('receptor-social')
  test.skip(sql(`select count(*) from convenios where entidad_id = '${ent}' and tipo = 'col_receptor' and estado = 'vigent'`) !== '0',
    'esta receptora ya tiene el conveni vigent (recarrega el clon)')

  // Un técnico no puede: es del super_admin.
  expect(() => sqlCom('equip', `select declarar_conveni('entidad', '${ent}', 'col_receptor', 'Persona Prova', 'Presidenta')`))
    .toThrow(/no_autoritzat/)

  const num = sqlCom('super_admin', `select (declarar_conveni('entidad', '${ent}', 'col_receptor', 'Persona Prova', 'Presidenta', null, 'REF-E2E')).numero_completo`)
  expect(num).toMatch(/^CONV-COL-REC-\d{4}-\d{4}$/)
  expect(sql(`select public.convenio_vigente('entidad', '${ent}', 'donacio', 'recibe')`)).toBe('t')
  expect(sql(`select count(*) from documentos where tipo = 'CONV' and numero_completo = '${num}' and datos->>'origen' = 'declarat'`)).toBe('1')
  // La receptora lo ve vigente desde su sesión.
  expect(sqlCom('receptor-social', `select origen || ':' || estado from convenios where numero_completo = '${num}'`)).toBe('declarat:vigent')
  // Y no se declara dos veces.
  expect(() => sqlCom('super_admin', `select declarar_conveni('entidad', '${ent}', 'col_receptor', 'Persona Prova', 'Presidenta')`))
    .toThrow(/ja_vigent/)
  // Un declarado no impide firmar el de verdad (lo sustituirá la contrafirma).
  expect(sql(`select public.conveni_cobreix_tot('entidad', '${ent}')`)).toBe('f')
  expect(compte('receptor-social')).toBeTruthy()
})
