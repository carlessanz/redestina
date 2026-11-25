// Los DÍAS DE RECOGIDA de una oferta limitan de verdad al receptor (fase 4, 25-11-2026, proceso 3.2):
//
//   a. En el Mercat, el día deja de ser un calendario libre: es un desplegable con solo los días de
//      la oferta elegibles (los demás, deshabilitados) y una línea que dice cuáles son.
//   b. La base rechaza otro día con `dia_fora_dies` (`comprova_hora_recollida`, 20270618100200),
//      y al equipo no lo bloquea (registra la realidad).
//   c. El lugar NUEVO creado desde el alta de oferta guarda sus días y franjas en la ficha
//      (`EditorDiesFranges` → `creaUbicacio(extra)`), la oferta los hereda y solo deja marcar
//      los días del lugar.
//
// Solo contra el CLON LOCAL y en escritorio: crea una oferta de prueba (dilluns i dimecres, de 8 a
// 12) que se cancela al acabar; los intentos contra la base van en transacciones que se deshacen.

import { expect, test } from '@playwright/test'
import { compte, entra, motiuSaltClon, productorDe, sql, sqlCom, triaCercador, tria } from './ajuda'

test.describe.configure({ mode: 'serial' })

const RECEPTOR = 'receptor-social'
const marca = Date.now()
let oferta: string | null = null

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin', 'productor', RECEPTOR)
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'escriu al clon: una sola passada')
})

const ALIAS = `[E2E] Lloc dies ${marca}`

test.afterAll(() => {
  if (motiuSaltClon('super_admin', 'productor', RECEPTOR)) return
  if (oferta) sql(`update excedentes set estado = 'cancelada', motivo_no_colocada = 'Prova E2E' where id = '${oferta}'`)
  // El lugar de la prueba c (ninguna oferta lo usa: el alta no se publica).
  sql(`delete from productor_ubicaciones where alias = '${ALIAS}'`)
})

/** El próximo día (desde mañana) con ese día ISO de la semana, `AAAA-MM-DD`. */
function proper(diaIso: number): string {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  for (let i = 1; i <= 7; i++) {
    const x = new Date(d.getTime() + i * 86_400_000)
    const w = x.getUTCDay() === 0 ? 7 : x.getUTCDay()
    if (w === diaIso) return x.toISOString().slice(0, 10)
  }
  throw new Error('impossible')
}

/** Ejecuta una consulta COMO una cuenta y la DESHACE: devuelve el error o null. */
function provaCom(rol: string, consulta: string): string | null {
  const c = compte(rol)!
  const uid = sql(`select id from auth.users where email = '${c.email.replace(/'/g, "''")}'`)
  try {
    sql(`begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
      ${consulta};
      rollback;`)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

function entitatDe(rol: string): string {
  const c = compte(rol)!
  return sql(`select m.entidad_id from membresias m join auth.users u on u.id = m.user_id
               where u.email = '${c.email.replace(/'/g, "''")}' and m.entidad_id is not null and m.activo limit 1`)
}

test('a. el receptor solo puede elegir los días de recogida de la oferta', async ({ page }) => {
  const prod = productorDe('productor')
  oferta = sql(`insert into excedentes (id_excedente, productor_id, producto, kg_total, estado, origen, modalitat, modalitats,
      coste_kg, disponible_hasta, dies_recollida, hora_recollida_inici, hora_recollida_fi, observacions, texto_oferta)
    values ('E-E2E-DR-${marca}', '${prod}', 'Avellana', 120, 'publicada', 'asistido', 'donacio', '{donacio}',
      0.5, current_date + 14, '{1,3}', '08:00', '12:00', '[E2E] dies de recollida', '[E2E] Avellana')
    returning id`).split('\n')[0]
  // La receptora tiene que poder verla (RLS: tipo de receptor y entidad activa). Un SELECT: el
  // `commit` de `sqlCom` no escribe nada.
  test.skip(sqlCom(RECEPTOR, `select count(*) from excedentes where id = '${oferta}'`) !== '1',
    'la receptora de prova no veu una donació al clon')

  await entra(page, RECEPTOR)
  await page.goto(`/receptor/mercat?oferta=${oferta}&accio=interes`)
  const dialeg = page.getByRole('dialog')
  await expect(dialeg).toBeVisible({ timeout: 30_000 })
  // La línea que explica por qué: «Només es recull: dl, dc.»
  await expect(dialeg.getByTestId('mk-dies-nomes')).toContainText(/(dl, dc|lu, mi)/)

  const dilluns = proper(1)
  const diumenge = proper(7)
  await dialeg.locator('#mk-dia').click()
  const llista = page.getByRole('listbox')
  await expect(llista.locator(`[data-valor="${dilluns}"]`)).not.toHaveAttribute('data-disabled')
  await expect(llista.locator(`[data-valor="${diumenge}"]`)).toHaveAttribute('data-disabled')
  // Ningún día elegible que no sea dilluns o dimecres.
  const elegibles = await llista.locator('[role="option"]:not([data-disabled])').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-valor') ?? '').filter(Boolean))
  expect(elegibles.length).toBeGreaterThan(0)
  for (const d of elegibles) {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay()
    expect([1, 3]).toContain(w)
  }
  await llista.locator(`[data-valor="${dilluns}"]`).click()
  await expect(llista).toBeHidden()
  await expect(dialeg.locator('#mk-dia')).toContainText(dilluns.split('-').reverse().join('/'))

  // Sin scroll horizontal dentro del diálogo.
  const desborda = await dialeg.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(desborda).toBe(false)
})

test('b. la base rechaza otro día al receptor (dia_fora_dies) y no bloquea al equipo', () => {
  test.skip(!oferta, 'sense l’oferta de la prova a')
  const entitat = entitatDe(RECEPTOR)
  const diumenge = `${proper(7)}T10:00:00+01:00`
  const dilluns = `${proper(1)}T10:00:00+01:00`

  const errDiumenge = provaCom(RECEPTOR, `select manifestar_interes('${oferta}', '${entitat}', 10, null, null, null, '${diumenge}')`)
  expect(errDiumenge).toMatch(/dia_fora_dies/)
  // El día bueno no choca con esta regla (puede chocar con otra del clon, p. ej. el convenio).
  const errDilluns = provaCom(RECEPTOR, `select manifestar_interes('${oferta}', '${entitat}', 10, null, null, null, '${dilluns}')`)
  expect(errDilluns ?? '').not.toMatch(/dia_fora_dies/)
  // El equipo registra la realidad: el domingo no le da `dia_fora_dies`.
  const errEquip = provaCom('superadmin', `select manifestar_interes_assistit('${oferta}', '${entitat}', 10, null, null, null, '${diumenge}')`)
  expect(errEquip ?? '').not.toMatch(/dia_fora_dies/)
})

test('c. un lugar nuevo desde el alta guarda sus días y franjas, y la oferta solo deja esos días', async ({ page }) => {
  const prod = productorDe('productor')
  await entra(page, 'super_admin')
  // Un alta a medias en este navegador, con «Canvia el lloc» ya pulsado: se ve la lista y el
  // botón de lugar nuevo. Todos los bloques abiertos.
  await page.evaluate(([k]) => {
    localStorage.setItem(k, JSON.stringify({
      datos: { familia: 'Fruita', producte: 'Poma', producte_al_camp: 'no', kg: 100 },
      pas: 99, pasMaxim: 99, costTocat: true, proposats: [], canviaLloc: true, desat: Date.now(),
    }))
  }, [`redestina-oferta-esborrany:${prod}`])
  await page.goto('/equip/ofertes')
  await page.getByRole('button', { name: /^Nova oferta assistida$|^Nueva oferta asistida$/ }).first().click()
  const dlg = page.getByRole('dialog')
  await triaCercador(dlg.locator('#dnoa-productor'), sql(`select coalesce(empresa, name) from productores where id = '${prod}'`), prod)
  await expect(dlg.getByTestId('formulari-oferta')).toBeVisible({ timeout: 30_000 })

  await dlg.getByRole('button', { name: /Afegir un lloc nou|Añadir un lugar nuevo/ }).click()
  await dlg.locator('#of-lloc-nom').fill(ALIAS)
  const dies = dlg.locator('[aria-labelledby="of-lloc-dies-l"]')
  await dies.getByRole('button', { name: /^(dl|lu)$/ }).click()
  await dies.getByRole('button', { name: /^(dc|mi)$/ }).click()
  await dlg.getByRole('button', { name: /Afegeix una franja|Añade una franja/ }).click()
  const franja = dlg.locator('#of-lloc-franja-0')
  await tria(franja.getByLabel(/Hora d’inici|Hora de inicio/), '08')
  await tria(franja.getByLabel(/Hora de final/), '12')
  await dlg.getByRole('button', { name: /^Desar el lloc$|^Guardar el lugar$/ }).click()

  // En la ficha del lugar: días y franja.
  await expect.poll(() => sql(`select coalesce(array_to_string(dies_setmana, ','), '') || '|' || coalesce(franges::text, '')
                                 from productor_ubicaciones where alias = '${ALIAS}'`), { timeout: 15_000 })
    .toMatch(/^1,3\|\[\{"fi": "12:00", "inici": "08:00"\}\]$/)

  // La oferta los hereda y solo deja marcar los del lugar.
  const diesOferta = dlg.locator('#of-dies_recollida')
  await expect(diesOferta.getByRole('button', { name: /^(dl|lu)$/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(diesOferta.getByRole('button', { name: /^(dt|ma)$/ })).toBeDisabled()
  await expect(dlg.getByTestId('of-dies-del-lloc')).toBeVisible()
  await expect(dlg.getByTestId('of-franges-del-lloc')).toContainText('08:00–12:00')
})
