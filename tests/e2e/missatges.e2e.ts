// Los mensajes del ciclo para avisar a mano (27-10-2026, plan de gestión autónoma).
// Solo contra el clon y en escritorio: se lee el portapapeles, que exige permisos del contexto.

import { expect, test } from '@playwright/test'
import { entra, motiuSaltClon, sql } from './ajuda'

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('super_admin')
  test.skip(m !== null, m ?? '')
  test.skip(info.project.name !== 'escriptori', 'el portapapeles es de escritorio')
})

test('el texto de la oferta se copia entero, con sus saltos de línea', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const id = sql(`select id from excedentes where texto_oferta is not null
    and estado in ('publicada','parcial','bloqueada') order by created_at desc limit 1`)
  test.skip(!id, 'el clon no tiene ninguna oferta viva con texto')
  const text = sql(`select texto_oferta from excedentes where id = '${id}'`)
  await entra(page, 'super_admin')
  await page.goto(`/equip/ofertes/${id}`)
  await page.getByRole('button', { name: /Copiar per al grup|Copiar para el grupo/ }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text)
})
