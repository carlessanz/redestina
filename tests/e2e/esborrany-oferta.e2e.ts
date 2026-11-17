// Fase C del punto 3 (17-11-2026, filas 3.1.2 y 3.7 del Excel de la Fundació), contra el CLON:
//
//   1. el ESBORRANY en el servidor: se guarda con lo que haya, el receptor no lo ve, se reabre
//      con lo guardado, se completa y se publica (y entonces nace el `E-…` y el texto);
//   2. EDITAR una oferta publicada con el mismo formulario del alta: kilos, lugar y subcausa
//      cambian el texto, y la ficha de la entidad y sus lugares no se tocan;
//   3. «Comparteix» solo donde la oferta circula (publicada o parcial);
//   4. el formulario de editar a 375 px, sin scroll horizontal.
//
//   E2E_CLON=1 E2E_ESCRIU=1 npx playwright test tests/e2e/esborrany-oferta.e2e.ts

import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { APIRequestContext } from '@playwright/test'
import { compte, entra, motiuSaltClon, productorDe, sql, tria } from './ajuda'

const API = 'http://127.0.0.1:55321'
const clau = () => /VITE_SUPABASE_PUBLISHABLE_KEY=(.+)/.exec(readFileSync('.env.supabase-local.local', 'utf8'))![1].trim()

async function jwtDe(request: APIRequestContext, etiqueta: string): Promise<string> {
  const c = compte(etiqueta)!
  const r = await request.post(`${API}/auth/v1/token?grant_type=password`, {
    headers: { apikey: clau() }, data: { email: c.email, password: c.password },
  })
  expect(r.ok(), `login de ${etiqueta} en el clon`).toBeTruthy()
  return (await r.json()).access_token as string
}

/** La huella de la ficha del productor y de sus lugares: editar una oferta no la puede cambiar. */
function huellaFitxa(prod: string): string {
  return sql(`select md5((select row(p.*)::text from productores p where p.id = '${prod}')
      || coalesce((select string_agg(row(u.*)::text, '|' order by u.id) from productor_ubicaciones u
                    where u.productor_id = '${prod}'), ''))`)
}

test.describe.configure({ mode: 'serial' })

test.beforeEach(({}, info) => {
  const m = motiuSaltClon('productor', 'superadmin', 'receptor-social')
  test.skip(m !== null, m ?? '')
  test.skip(!process.env.E2E_ESCRIU, 'Escriu ofertes: només amb E2E_ESCRIU=1')
  test.skip(info.project.name !== 'escriptori', 'Escriu ofertes de prova: només a escriptori')
})

test('esborrany: se guarda a medias, el receptor no lo ve, se reabre, se completa y se publica', async ({ page, request }) => {
  const prod = productorDe('productor')
  const lloc = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  const marca = `[E2E esborrany ${Date.now()}]`
  await entra(page, 'productor')
  // Un alta a medias en el navegador (sin causa): el «Desa com a esborrany» la sube al servidor.
  await page.evaluate(([k, l, obs]) => {
    localStorage.setItem(k, JSON.stringify({
      datos: {
        familia: 'Fruita Dolça', producte: 'Poma', producte_al_camp: 'no', kg: 80, format_entrega: 'caixes',
        retorn: 'No', ubicacio: l, dies_recollida: [1, 3], horari: { inici: '08:00', fi: '12:00' },
        disponible_fins: '2027-12-31', modalitat: ['donacio'], cost_kg: 0.4, observacions: obs,
      },
      pas: 0, pasMaxim: 99, costTocat: true, proposats: [], canviaLloc: false, desat: Date.now(),
    }))
  }, [`redestina-oferta-esborrany:${prod}`, lloc, marca])
  await page.goto('/productor/ofertes/nova')
  await page.getByTestId('desa-esborrany').click()
  await page.waitForURL(/\/productor\/ofertes\?tab=esborranys/)
  await expect(page.getByTestId('fila-esborrany').first()).toBeVisible()

  // En la base: un esborrany SIN referencia ni texto, con lo contestado guardado tal cual.
  await expect.poll(() => sql(`select count(*) from excedentes where observacions = '${marca}'`)).toBe('1')
  const id = sql(`select id from excedentes where observacions = '${marca}'`)
  expect(sql(`select estado || '|' || coalesce(id_excedente, '-') || '|' || coalesce(texto_oferta, '-') || '|'
      || (dades_esborrany->>'producte') from excedentes where id = '${id}'`)).toBe('esborrany|-|-|Poma')
  // El localStorage del alta ya no hace falta: lo guardado está en el servidor.
  expect(await page.evaluate((k) => localStorage.getItem(k), `redestina-oferta-esborrany:${prod}`)).toBeNull()

  // El receptor no lo ve, ni pidiéndolo por su id (RLS de `excedentes`).
  const jwtRec = await jwtDe(request, 'receptor-social')
  const vist = await request.get(`${API}/rest/v1/excedentes?id=eq.${id}&select=id`, {
    headers: { apikey: clau(), Authorization: `Bearer ${jwtRec}` },
  })
  expect(vist.ok()).toBeTruthy()
  expect(await vist.json()).toEqual([])
  // Ni se le puede mostrar interés: un esborrany no circula.
  expect(sql(`select count(*) from oferta_respuestas where excedente_id = '${id}'`)).toBe('0')

  // Se reabre: el formulario, con lo guardado.
  await page.goto(`/productor/ofertes/${id}`)
  await expect(page.getByRole('heading', { name: /Esborrany: Poma|Borrador: Poma/ })).toBeVisible()
  await expect(page.locator('#of-kg')).toHaveValue('80')
  // Publicar sin la causa no se puede: falta.
  await page.getByRole('button', { name: 'Publicar oferta' }).click()
  await expect(page.locator('#of-causa')).toHaveAttribute('aria-invalid', 'true')
  await tria(page.locator('#of-causa'), 'C4.2')
  await page.getByRole('button', { name: 'Publicar oferta' }).click()

  // Publicada: la MISMA fila, ahora con referencia y texto, y sin el jsonb del esborrany.
  await expect.poll(() => sql(`select estado from excedentes where id = '${id}'`), { timeout: 15_000 })
    .toMatch(/^(pendent_validacio|publicada)$/)
  expect(sql(`select (id_excedente like 'E-%')::text || '|' || (dades_esborrany is null)::text || '|' || subcausa_codigo
      from excedentes where id = '${id}'`)).toBe('true|true|C4.2')
  const text = sql(`select texto_oferta from excedentes where id = '${id}'`)
  expect(text).toContain('📦 QUANTITAT: 80 kg aprox')
  expect(text).toContain('⏰ HORARI DE RECOLLIDA: dl, dc · ')
  expect(text).toContain('🔴 CAUSA: Qualitat i requisits comercials — Qualitat o especificacions no acceptades pel comprador')
  expect(text).not.toContain('RESPONSABLE')
  // Ninguna etiqueta vacía: solo el punto de recogida acaba en «:» (el enlace va debajo).
  expect(text.split('\n').filter((l) => /:\s*$/.test(l) && !l.startsWith('🗺️'))).toEqual([])
  await expect(page.getByTestId('fitxa-oferta')).toBeVisible()

  // Pendiente de validar no se comparte todavía (fila 3.7.1): ni el botón.
  if (sql(`select estado from excedentes where id = '${id}'`) === 'pendent_validacio') {
    await expect(page.getByTestId('text-oferta')).toBeVisible()
    await expect(page.getByTestId('comparteix')).toHaveCount(0)
  }
})

test('editar una oferta publicada: kilos, lugar y subcausa cambian el texto; la ficha, no', async ({ page, request }) => {
  const prod = productorDe('productor')
  const principal = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and es_principal`)
  // Otro lugar al que mover la oferta (con su enlace, que el texto tiene que enseñar).
  let altre = sql(`select id from productor_ubicaciones where productor_id = '${prod}' and not coalesce(es_principal, false)
                   and gmaps_url is not null order by id limit 1`)
  if (!altre) {
    altre = sql(`insert into productor_ubicaciones (productor_id, alias, municipio, gmaps_url)
                 values ('${prod}', 'E2E fase C Magatzem', 'Vic', 'https://maps.app.goo.gl/e2eFaseC') returning id`).split('\n')[0]
  }
  const mapsAltre = sql(`select gmaps_url from productor_ubicaciones where id = '${altre}'`)

  // La oferta, por `crear-oferta` como la publica el equipo en nombre de la entidad.
  const marca = `[E2E edició ${Date.now()}]`
  const jwt = await jwtDe(request, 'superadmin')
  const r = await request.post(`${API}/functions/v1/crear-oferta`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: clau() },
    data: {
      productor_id: prod,
      datos: {
        familia: 'Fruita Dolça', producte: 'Poma', producte_al_camp: 'no', kg: 50, format_entrega: 'caixes',
        retorn: 'No', ubicacio: principal, disponible_fins: '31/12/2027', dies_recollida: [1, 3],
        horari: { inici: '08:00', fi: '12:00' }, modalitat: 'donacio', cost_kg: 0.4, causa: 'C3.1', observacions: marca,
      },
    },
  })
  expect(r.status(), JSON.stringify(await r.json())).toBe(200)
  const id = sql(`select id from excedentes where observacions = '${marca}'`)
  const textAbans = sql(`select texto_oferta from excedentes where id = '${id}'`)
  const huella = huellaFitxa(prod)

  await entra(page, 'superadmin')
  await page.goto(`/equip/ofertes/${id}`)
  // Circula: se comparte (fila 3.7.5).
  await expect(page.getByTestId('comparteix')).toBeVisible()
  await page.getByRole('button', { name: /^Edita l’oferta$|^Edita la oferta$/ }).click()
  const dlg = page.getByTestId('dialeg-edicio')
  await expect(dlg.getByTestId('producte-fix')).toContainText('Poma')
  await dlg.locator('#of-kg').fill('60')
  await dlg.getByRole('button', { name: /Canvia el lloc|Cambiar el lugar/ }).click()
  await tria(dlg.locator('#of-ubicacio'), altre)
  await tria(dlg.locator('#of-causa'), 'C4.2')
  await dlg.getByRole('button', { name: /^Desa els canvis$|^Guardar los cambios$/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await expect.poll(() => sql(`select kg_total::int || '|' || ubicacion_id || '|' || subcausa_codigo from excedentes where id = '${id}'`))
    .toBe(`60|${altre}|C4.2`)
  const text = sql(`select texto_oferta from excedentes where id = '${id}'`)
  expect(text).not.toBe(textAbans)
  expect(text).toContain('📦 QUANTITAT: 60 kg aprox')
  expect(text).toContain(mapsAltre)
  expect(text).toContain('🔴 CAUSA: Qualitat i requisits comercials — Qualitat o especificacions no acceptades pel comprador')
  // Lo que enseña la ficha es lo de la fila.
  await expect(page.getByTestId('text-oferta')).toContainText('60 kg aprox')
  // Y la ficha de la entidad y sus lugares, intactos.
  expect(huellaFitxa(prod)).toBe(huella)
  // El cambio queda en el historial de la oferta, con las claves nuevas.
  expect(sql(`select count(*) > 0 from excedentes_canvis where excedente_id = '${id}'`)).toBe('t')
})

test('Comparteix solo donde la oferta circula', async ({ page }) => {
  const prod = productorDe('productor')
  const tancada = sql(`select id from excedentes where productor_id = '${prod}' and estado = 'cerrada'
                        and texto_oferta is not null limit 1`)
  test.skip(!tancada, 'No hi ha cap oferta tancada de prova')
  await entra(page, 'superadmin')
  await page.goto(`/equip/ofertes/${tancada}`)
  await expect(page.getByTestId('text-oferta')).toBeVisible()
  await expect(page.getByTestId('comparteix')).toHaveCount(0)
})

test('editar a 375 px: sin scroll horizontal', async ({ page }) => {
  const prod = productorDe('productor')
  const id = sql(`select id from excedentes where productor_id = '${prod}' and estado = 'publicada'
                  and observacions like '[E2E edició %' order by created_at desc limit 1`)
  test.skip(!id, 'Falta la oferta de la prova anterior')
  await page.setViewportSize({ width: 375, height: 812 })
  await entra(page, 'superadmin')
  await page.goto(`/equip/ofertes/${id}`)
  await page.getByRole('button', { name: /^Edita l’oferta$|^Edita la oferta$/ }).click()
  const dlg = page.getByTestId('dialeg-edicio')
  await expect(dlg.locator('#of-kg')).toBeVisible()
  const desborden = await page.evaluate(() => {
    const out: string[] = []
    const arrel = document.querySelector('[data-testid="dialeg-edicio"]') as HTMLElement | null
    if (arrel && arrel.scrollWidth > arrel.clientWidth + 1) out.push(`DIALEG ${arrel.scrollWidth}>${arrel.clientWidth}`)
    for (const el of document.querySelectorAll('[data-testid="dialeg-edicio"] *')) {
      const h = el as HTMLElement
      if (h.scrollWidth > h.clientWidth + 1 && getComputedStyle(h).overflowX === 'visible' && h.clientWidth > 0) {
        out.push(`${h.tagName}#${h.id} ${h.scrollWidth}>${h.clientWidth} «${(h.textContent ?? '').slice(0, 40)}»`.slice(0, 200))
      }
    }
    return { doc: document.documentElement.scrollWidth > document.documentElement.clientWidth, out }
  })
  expect(desborden.doc).toBe(false)
  expect(desborden.out).toEqual([])
})
