// Lo que falta en el diagnóstico, con un camino a cada cosa (16-11-2026):
//   1. cada línea de «Falten dades» lleva un «Completa-ho» que sube hasta el control y le pasa el foco;
//   2. sin ningún lugar de recogida, la Operativa propone la dirección de la ficha (`llocDeLaFitxa`),
//      con el formulario ya rellenado; al guardarlo con un día, el aviso del lugar desaparece al
//      momento, sin «Desa el diagnòstic».
//
// Solo contra el CLON LOCAL y en escritorio: crea un lugar en una ficha de prueba y lo borra al acabar.

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sql } from './ajuda'

test.describe.configure({ mode: 'serial' })

let prod = ''
let direccio = ''

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('superadmin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'Crea un lloc en una fitxa de prova: només a escriptori')
})

test.beforeAll(() => {
  if (motiuSaltClon('superadmin') !== null) return
  // Un productor de prueba con dirección en la ficha y sin ningún lugar de recogida.
  const fila = sql(`select p.id || '|' || p.direccion from productores p
    where p.es_test and coalesce(btrim(p.direccion), '') <> '' and p.municipio_ine is not null
      and not exists (select 1 from productor_ubicaciones u where u.productor_id = p.id)
    order by p.id limit 1`)
  ;[prod, direccio] = fila.split('|')
})

test.afterAll(() => {
  if (prod) sql(`delete from productor_ubicaciones where productor_id = '${prod}' and alias in ('Adreça de la fitxa', 'Dirección de la ficha')`)
})

test('«Completa-ho» lleva al lugar, la ficha lo propone y al guardarlo deja de faltar', async ({ page }) => {
  test.skip(!prod, 'Cap productor de prova amb adreça i sense llocs al clon')
  await entra(page, 'superadmin')
  await page.goto(`/equip/diagnostics/productor/${prod}`)

  const falten = page.getByTestId('diag-falten')
  const lloc = falten.locator('li', { hasText: /lloc de recollida|lugar de recogida/ })
  await expect(lloc).toBeVisible()

  // La propuesta, con la dirección de la ficha.
  const proposta = page.getByTestId('lloc-proposta')
  await expect(proposta).toContainText(direccio)

  // El enlace sube hasta la propuesta y le deja el foco.
  await lloc.getByTestId('diag-falta-ves').click()
  await expect(page.getByTestId('lloc-proposta-usa')).toBeFocused()

  // El formulario sale relleno; con un día y guardado, ya no falta.
  await page.getByTestId('lloc-proposta-usa').click()
  await expect(page.locator('#diag-lloc-nom')).toHaveValue(/Adreça de la fitxa|Dirección de la ficha/)
  await expect(page.locator('#diag-lloc-direccion')).toHaveValue(direccio.trim())
  const llocs = page.locator('[data-desti="llocs"]')
  await llocs.getByRole('button', { name: /^dl$|^lu$/ }).click()
  await llocs.getByRole('button', { name: /Desar el lloc|Guardar el lugar/ }).click()
  await expect(llocs.getByTestId('lloc-principal')).toBeVisible()
  await expect(lloc).toHaveCount(0)
  await expect(proposta).toHaveCount(0)
  expect(sql(`select count(*) from productor_ubicaciones where productor_id = '${prod}' and es_principal
    and cardinality(dies_setmana) > 0`)).toBe('1')
})
