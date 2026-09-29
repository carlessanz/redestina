// Genera un icono SVG por producto del catálogo en `public/icones-productes/<slug>.svg`
// (29-09-2026). Sustituyen a las fotos del catálogo: dibujados aquí, con un mismo estilo
// —plano, 64×64, colores naturales del producto—, sin licencias de terceros y sin red.
//
//   deno run -A scripts/icones-productes.ts            # escribe los SVG
//   deno run -A scripts/icones-productes.ts --llista   # solo lista los slugs
//
// El nombre del fichero es `slugProducte(nombre)` (src/lib/iconaProducte.ts): la pantalla
// lo compone igual, así que añadir un producto al catálogo es añadir aquí su dibujo. Si
// falta, la pantalla enseña el icono genérico de su familia.

import { slugProducte } from '../src/lib/iconaProducte.ts'

// ── Paleta (colores de ilustración, no de interfaz: no son tokens) ───────────────
const C = {
  vermell: '#d9453b', vermellFosc: '#a93228', taronja: '#f08a24', taronjaFosc: '#c96a12',
  groc: '#f2c230', llimona: '#f5d63d', verd: '#6aa84f', verdFosc: '#3f7a2e', verdClar: '#a8cf6f',
  verdPal: '#d5e8b0', lila: '#6b3a78', lilaFosc: '#4a2454', blau: '#4a64b0', marro: '#8a5a2b',
  marroFosc: '#5e3b1a', beix: '#e8d3a8', crema: '#f7f1e1', blanc: '#fbf8f0', rosa: '#f2a3a0',
  gris: '#9aa39a', negre: '#2d2a26',
}

// ── Primitivas ───────────────────────────────────────────────────────────────────
const brill = (cx: number, cy: number, rx: number, ry: number, rot = -30) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="#fff" opacity=".35"/>`
const fulla = (x: number, y: number, llarg: number, ample: number, angle: number, color = C.verd) =>
  `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M0 0Q${llarg / 2} ${-ample} ${llarg} 0Q${llarg / 2} ${ample} 0 0Z" fill="${color}"/>` +
  `<path d="M1 0L${llarg - 2} 0" stroke="${C.verdFosc}" stroke-width="1" opacity=".5"/></g>`
const tija = (x1: number, y1: number, x2: number, y2: number, color = C.marroFosc, w = 2.5) =>
  `<path d="M${x1} ${y1}Q${(x1 + x2) / 2 + 1} ${(y1 + y2) / 2} ${x2} ${y2}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`
const cercle = (cx: number, cy: number, r: number, fill: string, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`
const el = (cx: number, cy: number, rx: number, ry: number, fill: string, rot = 0) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`
const p = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`
const linia = (d: string, color: string, w = 1.5, op = 1) =>
  `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`

// Contorno para los productos claros: sin él se pierden sobre el crema del hueco.
const VORA = 'stroke="#bfae8a" stroke-width="1.3"'

// Formas que se repiten
const POMA = 'M32 20C24 14 12 18 12 33C12 47 22 56 28 56C30 56 31 55 32 55C33 55 34 56 36 56C42 56 52 47 52 33C52 18 40 14 32 20Z'
const PERA = 'M32 13C28 13 27 19 26 25C24 31 16 35 16 45C16 53 23 58 32 58C41 58 48 53 48 45C48 35 40 31 38 25C37 19 36 13 32 13Z'

function fruitaRodona(color: string, fosc: string, opts: { r?: number; cy?: number; sol?: boolean; tija?: boolean; fulla?: boolean; rugs?: string } = {}) {
  const r = opts.r ?? 19, cy = opts.cy ?? 35
  let s = cercle(32, cy, r, color)
  if (opts.sol) s += linia(`M32 ${cy - r + 2}Q${36} ${cy} 32 ${cy + r - 2}`, fosc, 2, .6)
  if (opts.rugs) s += opts.rugs
  s += brill(25, cy - r / 2, r / 4, r / 7)
  if (opts.tija !== false) s += tija(32, cy - r + 1, 33, cy - r - 6)
  if (opts.fulla !== false) s += fulla(33, cy - r - 4, 13, 5, -25)
  return s
}

function citric(color: string, fosc: string, rx: number, ry: number) {
  let s = el(32, 36, rx, ry, color)
  for (const [x, y] of [[24, 30], [38, 28], [30, 42], [42, 40], [22, 40], [35, 35], [44, 33]]) s += cercle(x, y, .9, fosc, 'opacity=".5"')
  s += brill(24, 30, rx / 4, ry / 6)
  s += tija(32, 36 - ry + 1, 32, 36 - ry - 3)
  s += fulla(32, 36 - ry - 2, 14, 5, -20)
  return s
}

function llimonaForma(color: string, fosc: string) {
  return `<g transform="rotate(-25 32 34)">` + el(32, 34, 20, 14, color) + el(11, 34, 3.5, 2.5, color) + el(53, 34, 3.5, 2.5, color) +
    linia('M18 38Q32 46 46 38', fosc, 1.2, .35) + `</g>` + brill(25, 28, 5, 2.5) + fulla(40, 17, 12, 4.5, -35)
}

function pinyol(color: string, fosc: string, wide = 1) {
  return `<g transform="translate(32 36) scale(${wide} 1) translate(-32 -36)">` + cercle(32, 36, 18, color) + `</g>` +
    linia('M32 19Q37 36 32 54', fosc, 1.8, .55) + brill(24, 29, 4.5, 2.5) + tija(32, 19, 33, 13) + fulla(33, 15, 12, 4.5, -20)
}

function baies(color: string, fosc: string) {
  let s = ''
  const pts: [number, number][] = [[26, 30], [33, 28], [40, 31], [24, 37], [31, 36], [38, 37], [44, 38], [27, 44], [34, 44], [41, 45], [31, 51], [38, 51]]
  for (const [x, y] of pts) s += cercle(x, y, 4.6, color) + cercle(x - 1.2, y - 1.3, 1.2, '#fff', 'opacity=".35"')
  s += linia('M26 25L32 22L38 25', C.verdFosc, 2.2) + fulla(32, 22, 9, 3.5, -60) + fulla(32, 22, 9, 3.5, -120)
  void fosc
  return s
}

function bossaBulb(color: string, fosc: string, tall: string, vora = '') {
  // cebes, alls: cuerpo en gota invertida + raíces
  return p('M32 14C31 22 16 28 16 42C16 51 23 57 32 57C41 57 48 51 48 42C48 28 33 22 32 14Z', color, vora) +
    linia('M32 17Q27 36 29 56M32 17Q37 36 35 56', fosc, 1.3, .5) + linia('M28 57L26 61M32 57V62M36 57L38 61', C.beix, 1.6) + tall
}

function arrel(color: string, fosc: string, fullesColor = C.verd, vora = '') {
  // pastanaga / xirivia
  return p('M24 20C22 26 26 40 31 56C32 58 33 58 33 56C37 40 42 26 40 20C36 17 28 17 24 20Z', color, vora) +
    linia('M27 28L31 29M29 36L33 36M31 44L34 44M30 23L34 24', fosc, 1.3, .6) +
    fulla(31, 19, 13, 4, -115, fullesColor) + fulla(33, 19, 13, 4, -65, fullesColor) + fulla(32, 19, 14, 4, -90, fullesColor)
}

function tubercle(color: string, fosc: string, forma: string) {
  return p(forma, color) + cercle(26, 32, 1.4, fosc) + cercle(38, 38, 1.4, fosc) + cercle(30, 44, 1.2, fosc) + cercle(42, 30, 1.2, fosc) +
    brill(26, 28, 5, 2.5, -20)
}

function beina(color: string, fosc: string, llavors: number, colorLlavor: string, obert: boolean) {
  let s = `<g transform="rotate(-35 32 34)">` + p('M8 34C14 24 50 24 56 34C50 42 14 42 8 34Z', color)
  if (obert) {
    s += p('M12 34C18 29 46 29 52 34C46 38 18 38 12 34Z', C.verdPal)
    for (let i = 0; i < llavors; i++) s += cercle(18 + i * (28 / Math.max(1, llavors - 1)), 34, 3.6, colorLlavor)
  } else {
    for (let i = 0; i < llavors; i++) s += el(17 + i * (30 / Math.max(1, llavors - 1)), 33, 4.5, 3.5, fosc, 0).replace('fill', 'opacity=".25" fill')
  }
  s += linia('M56 34L60 31', C.verdFosc, 2) + `</g>`
  return s
}

function fullaGran(color: string, fosc: string, tija_: string) {
  return p('M32 58C30 50 30 44 30 40C18 38 12 26 18 14C24 8 40 8 46 14C52 26 46 38 34 40C34 44 34 50 32 58Z', color) +
    linia('M32 56V14M32 34L22 24M32 28L42 20M32 22L25 14M32 34L42 26', fosc, 1.4, .6) + tija_
}

function floretes(color: string, fosc: string, tija_: string) {
  let s = tija_
  const pts: [number, number, number][] = [[22, 26, 8], [32, 20, 9], [42, 26, 8], [26, 33, 8], [38, 33, 8], [32, 29, 8]]
  for (const [x, y, r] of pts) s += cercle(x, y, r, color)
  for (const [x, y] of [[20, 24], [30, 18], [41, 23], [25, 31], [37, 30]]) s += cercle(x, y, 1.6, fosc, 'opacity=".45"')
  return s
}

function bolet(barret: string, fosc: string, peu: string, forma: 'pla' | 'rodo', vora = '') {
  const cap = forma === 'rodo'
    ? p('M12 34C12 20 22 12 32 12C42 12 52 20 52 34C44 36 20 36 12 34Z', barret, vora)
    : p('M8 32C10 20 22 14 32 14C42 14 54 20 56 32C46 35 18 35 8 32Z', barret)
  return p('M25 33C25 44 23 52 24 56C28 58 36 58 40 56C41 52 39 44 39 33Z', peu, vora) + cap +
    linia('M16 33Q32 38 48 33', fosc, 1.5, .4) + brill(24, 20, 7, 3, -15)
}

function caixa(extra: string) {
  return p('M10 30H54L50 56H14Z', '#c99a5b') + linia('M12 38H52M12 46H51', C.marro, 2, .6) + linia('M22 30L20 56M42 30L44 56', C.marro, 1.5, .5) + extra
}

// ── Los 90 ──────────────────────────────────────────────────────────────────────
const ICONES: Record<string, string> = {
  // Bolets
  'Bolet': bolet('#9a5b2e', C.marroFosc, C.crema, 'pla'),
  'Xampinyó': bolet('#efe7d8', '#b8a88a', '#f5efe2', 'rodo', VORA),

  // Cítrics
  'Taronja': citric(C.taronja, C.taronjaFosc, 19, 19),
  'Mandarina': citric('#f6922a', C.taronjaFosc, 20, 15) + fulla(36, 20, 11, 4, 20),
  'Llimona': llimonaForma(C.llimona, '#b89a12'),
  'Llima': llimonaForma('#8cc43f', C.verdFosc),

  // Fruita dolça
  'Poma': p(POMA, C.vermell) + brill(22, 28, 5, 3) + tija(32, 20, 34, 10) + fulla(34, 13, 13, 5, -30),
  'Pera': p(PERA, '#c7d44a') + brill(24, 42, 4, 6, -10) + tija(32, 13, 34, 6) + fulla(33, 9, 11, 4, -20),
  'Codony': p('M32 14C26 14 25 20 23 25C18 30 13 35 13 44C13 53 21 58 32 58C43 58 51 53 51 44C51 35 46 30 41 25C39 20 38 14 32 14Z', '#e3c12a') +
    linia('M22 33Q20 44 26 52M42 33Q45 44 39 52', '#b39212', 1.3, .5) + tija(32, 14, 33, 8) + fulla(33, 10, 12, 4.5, -25, C.verdFosc),
  'Kaki': p('M14 36C14 24 22 20 32 20C42 20 50 24 50 36C50 48 42 55 32 55C22 55 14 48 14 36Z', '#f07a1e') + brill(22, 30, 5, 2.5) +
    p('M32 23L22 18L28 25L20 25L30 27Z M32 23L42 18L36 25L44 25L34 27Z', C.verdFosc) + cercle(32, 23, 3, C.marroFosc),
  'Magrana': cercle(32, 37, 19, '#c8322e') + p('M26 19L28 13L31 17L32 12L33 17L36 13L38 19Z', '#a52825') + brill(24, 30, 5, 3) +
    linia('M22 44Q32 50 42 44', C.vermellFosc, 1.3, .4),
  'Nectarina': pinyol('#e2432f', C.vermellFosc) + el(38, 42, 6, 8, '#f39a3a', 20).replace('/>', ' opacity=".55"/>'),
  'Préssec': pinyol('#f7a868', '#d9744a') + el(40, 40, 7, 10, '#ef6f5a', 20).replace('/>', ' opacity=".45"/>'),
  'Paraguaià': el(32, 38, 22, 14, '#f2a867') + el(40, 40, 8, 7, '#e8674f').replace('/>', ' opacity=".45"/>') +
    cercle(32, 36, 3, '#c5623a', 'opacity=".6"') + linia('M32 26Q35 38 32 51', '#c5623a', 1.4, .5) + fulla(34, 26, 12, 4.5, -30),
  'Pruna': `<g transform="rotate(10 32 37)">` + el(32, 37, 16, 19, '#6e3a7e') + `</g>` + linia('M33 19Q38 36 31 55', C.lilaFosc, 1.6, .6) +
    brill(26, 30, 3.5, 5, 0) + tija(33, 19, 35, 12),
  'Albercoc': pinyol('#f4a53c', '#c9761d', .95) + el(38, 42, 5, 7, '#ea7b3b', 20).replace('/>', ' opacity=".4"/>'),
  'Nespre': el(24, 42, 9, 11, '#f2a33a') + el(40, 40, 9, 11, '#f5b04a') + el(32, 30, 9, 11, '#eea036') +
    cercle(32, 20, 1.6, C.marroFosc) + cercle(24, 32, 1.4, C.marroFosc) + cercle(40, 30, 1.4, C.marroFosc) + fulla(34, 20, 16, 6, -35, C.verdFosc),
  'Cirera': tija(24, 38, 36, 12, C.verdFosc, 2) + tija(42, 42, 36, 12, C.verdFosc, 2) + fulla(36, 12, 13, 5, -10) +
    cercle(23, 44, 10, '#c2182b') + cercle(43, 47, 10, '#d4202f') + brill(19, 40, 3, 2) + brill(39, 43, 3, 2),
  'Figa': p('M32 14C29 14 29 20 27 24C18 30 14 38 16 46C18 54 26 58 32 58C38 58 46 54 48 46C50 38 46 30 37 24C35 20 35 14 32 14Z', '#6d3b6e') +
    linia('M26 32Q24 44 28 54M38 32Q41 44 36 54', '#4a2454', 1.3, .5) + brill(24, 40, 3, 6, -10) + tija(32, 14, 32, 9, C.verdFosc),
  'Raim': (() => {
    let s = tija(32, 16, 32, 8, C.marroFosc) + fulla(32, 12, 15, 6, -20)
    const pts: [number, number][] = [[24, 22], [32, 21], [40, 22], [20, 30], [28, 29], [36, 29], [44, 30], [24, 37], [32, 36], [40, 37], [28, 44], [36, 44], [32, 51]]
    for (const [x, y] of pts) s += cercle(x, y, 5, '#7a3f8c') + cercle(x - 1.5, y - 1.5, 1.4, '#fff', 'opacity=".35"')
    return s
  })(),

  // Fruita exòtica
  'Alvocat': p('M32 10C24 10 22 22 18 32C14 44 20 58 32 58C44 58 50 44 46 32C42 22 40 10 32 10Z', '#3f6b2a') +
    p('M32 14C26 14 25 24 22 33C19 43 24 54 32 54C40 54 45 43 42 33C39 24 38 14 32 14Z', '#d6e39a') + cercle(32, 40, 8, '#8a5a2b') + brill(29, 37, 2.5, 1.5),
  'Coco': cercle(28, 36, 18, '#7a4f2a') + cercle(22, 30, 1.6, C.marroFosc) + cercle(27, 27, 1.6, C.marroFosc) + cercle(24, 35, 1.6, C.marroFosc) +
    p('M40 22A16 16 0 0 1 40 54A10 16 0 0 1 40 22Z', '#6a4222') + p('M41 26A12 12 0 0 1 41 50A7 12 0 0 1 41 26Z', C.blanc),
  'Kiwi': cercle(32, 34, 20, '#8a6a3a') + cercle(32, 34, 17, '#79b83a') + cercle(32, 34, 11, '#a9d86a') +
    (() => { let s = ''; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; s += el(32 + Math.cos(a) * 8.5, 34 + Math.sin(a) * 8.5, 1.3, .8, C.negre, i * 30) } return s })() +
    cercle(32, 34, 4.5, '#e9f3c9'),
  'Mango': `<g transform="rotate(-20 32 36)">` + p('M14 38C14 24 26 16 38 18C50 20 54 32 50 42C46 52 32 56 22 52C16 50 14 44 14 38Z', '#f4a93a') +
    p('M14 38C14 24 26 16 38 18C30 24 24 34 22 52C16 50 14 44 14 38Z', '#e25a3a', 'opacity=".75"') + `</g>` + brill(36, 26, 6, 3) + fulla(36, 17, 13, 5, -40, C.verdFosc),
  'Pinya': p('M32 26L26 8L30 18L32 6L34 18L38 8Z', C.verdFosc) + p('M24 22L20 14L28 22Z M40 22L44 14L36 22Z', C.verd) + el(32, 42, 14, 17, '#e8a92e') +
    linia('M20 34L42 56M22 28L46 50M28 25L46 43M18 42L34 58M44 34L22 56M42 28L18 50M36 25L18 43M46 42L30 58', '#b87b17', 1.2, .6),
  'Plàtan': p('M12 20C14 18 16 19 16 21C18 36 30 46 48 44C52 44 54 46 52 48C46 56 26 56 16 44C10 36 9 26 12 20Z', '#f5d43d') +
    linia('M16 24C20 38 32 46 48 46', '#c9a817', 1.4, .5) + p('M10 18L14 16L16 21L12 22Z', '#6b4a1e') + p('M50 46L55 48L52 50Z', '#6b4a1e'),
  'Xirimoia': p('M32 58C20 52 14 42 16 32C18 22 26 16 32 20C38 16 46 22 48 32C50 42 44 52 32 58Z', '#8fbf5c') +
    (() => { let s = ''; for (const [x, y] of [[24, 28], [32, 26], [40, 28], [22, 37], [30, 35], [38, 35], [44, 38], [26, 45], [34, 44], [40, 46], [32, 52]]) s += linia(`M${x - 4} ${y}Q${x} ${y + 4} ${x + 4} ${y}`, '#5e8f35', 1.3, .8); return s })() +
    tija(32, 20, 32, 12, C.marroFosc),

  // Fruita seca
  'Ametlla': p('M32 10C22 18 16 32 18 44C20 54 26 58 32 58C38 58 44 54 46 44C48 32 42 18 32 10Z', '#b98652') +
    linia('M26 24Q24 40 28 54M32 16V56M38 24Q40 40 36 54', '#8a5a2b', 1.2, .6) + brill(26, 34, 3, 6, 0),
  'Avellana': p('M32 16C44 16 50 28 50 38C50 50 42 57 32 57C22 57 14 50 14 38C14 28 20 16 32 16Z', '#a8672e') +
    p('M16 30C18 20 26 14 32 14C38 14 46 20 48 30C42 26 22 26 16 30Z', '#e0c39a') + brill(24, 40, 4, 6, -10),
  'Garrofa': p('M8 30C14 18 30 20 42 28C50 33 56 36 57 40C56 44 50 44 42 40C30 34 16 34 10 38C6 38 6 33 8 30Z', '#5a2f18') +
    linia('M14 32Q26 28 40 34Q48 38 54 40', '#3a1c0c', 1.3, .7) + (() => { let s = ''; for (const x of [16, 23, 30, 37, 44]) s += el(x, 30 + (x - 16) / 6, 2.2, 1.4, '#7a4a28'); return s })(),
  'Nous': cercle(32, 36, 19, '#c8995c') + linia('M32 17V55', '#8a5a2b', 2, .8) +
    linia('M22 24Q27 28 22 32Q17 36 23 40Q28 44 22 49M42 24Q37 28 42 32Q47 36 41 40Q36 44 42 49', '#8a5a2b', 1.4, .6) + brill(24, 26, 3.5, 2),

  // Fruita vermella
  'Gerd': baies('#e0415a', '#a8203a'),
  'Mores': baies('#3b1f3d', C.negre),
  'Nabiu': cercle(24, 40, 11, '#4a5fa8') + cercle(41, 42, 10, '#3f5296') + cercle(33, 26, 10, '#5268b5') +
    p('M33 22L31 25L35 25Z M24 37L22 40L26 40Z M41 39L39 42L43 42Z', '#243466') + brill(29, 22, 2.5, 1.5) + brill(20, 36, 2.5, 1.5) + brill(37, 38, 2.5, 1.5),

  // Horta flor
  'Brócoli': floretes('#4f8f35', C.verdFosc, p('M28 32H36L38 58H26Z', '#8cbf5a')),
  'Bròquil': floretes('#3f7a2e', '#2b5a1e', p('M28 32H36L38 58H26Z', '#9ccb6a')),
  'Carxofa': p('M32 10C38 14 44 20 44 28C44 34 40 40 32 42C24 40 20 34 20 28C20 20 26 14 32 10Z', '#7a9a4a') +
    p('M20 26C14 30 14 38 22 44C26 46 30 46 32 46C34 46 38 46 42 44C50 38 50 30 44 26C42 36 22 36 20 26Z', '#6a8a3c') +
    p('M24 16C22 22 24 28 32 30C40 28 42 22 40 16C36 20 28 20 24 16Z', '#8fae5a') + linia('M26 18L28 14M38 18L36 14M22 30L18 26M42 30L46 26', '#7a4a78', 2.2, .9) +
    p('M30 46H34L35 58H29Z', '#7a9a4a'),
  'Coliflor': fulla(32, 46, 24, 8, 155, C.verd) + fulla(32, 46, 24, 8, 25, C.verd) + fulla(32, 48, 16, 7, 90, C.verdFosc) +
    p('M12 36C16 50 26 54 32 54C38 54 48 50 52 36C44 46 20 46 12 36Z', C.verd) +
    (() => { let s = ''; for (const [x, y, r] of [[23, 32, 8], [32, 26, 9], [41, 32, 8], [27, 38, 8], [37, 38, 8]]) s += cercle(x, y, r, '#f4ecd6', 'stroke="#d8c9a0" stroke-width="1"'); for (const [x, y] of [[22, 31], [31, 24], [40, 30], [27, 37], [36, 36]]) s += cercle(x, y, 1.5, '#d8c9a0'); return s })(),

  // Horta fruit
  'Albergínia': p('M18 22C24 18 32 22 38 30C46 40 50 50 44 56C38 60 28 56 22 46C16 36 14 26 18 22Z', '#5b2a6b') + brill(26, 32, 3, 8, -35) +
    p('M14 16L22 18L26 26L18 24C16 20 14 18 14 16Z', C.verdFosc) + tija(14, 16, 9, 11, C.verdFosc, 3),
  'Carbassa': el(20, 38, 10, 16, '#e97d1d') + el(44, 38, 10, 16, '#e97d1d') + el(32, 38, 12, 18, '#f39333') + linia('M26 24Q22 38 26 52M38 24Q42 38 38 52', '#c35f10', 1.3, .7) +
    p('M30 22L31 12H35L34 22Z', '#5c7a2e') + fulla(34, 16, 12, 5, -20),
  'Carbassó': `<g transform="rotate(-30 32 34)">` + p('M6 34C6 28 12 26 20 26H48C54 26 58 30 58 34C58 38 54 42 48 42H20C12 42 6 40 6 34Z', '#3f7a2e') +
    linia('M14 30H48M12 34H52M14 38H48', '#8cbf5a', 1.3, .6) + p('M56 30H62V38H56Z', '#6a8a3c') + `</g>`,
  'Cogombre': `<g transform="rotate(-30 32 34)">` + p('M6 34C6 28 12 27 22 27H46C54 27 58 30 58 34C58 38 54 41 46 41H22C12 41 6 40 6 34Z', '#2f6224') +
    (() => { let s = ''; for (const [x, y] of [[14, 32], [22, 30], [30, 33], [38, 30], [46, 33], [18, 37], [34, 38], [44, 37]]) s += cercle(x, y, 1, '#b8d98a'); return s })() + `</g>`,
  'Fava': beina('#6aa84f', C.verdFosc, 4, '#b7d88a', true),
  'Fesol': (() => { let s = ''; for (const [x, y, r] of [[22, 30, -20], [40, 28, 25], [30, 44, 10], [44, 44, -30], [18, 44, 40]]) s += `<g transform="rotate(${r} ${x} ${y})">` + p(`M${x - 9} ${y}C${x - 9} ${y - 7} ${x + 9} ${y - 7} ${x + 9} ${y}C${x + 9} ${y + 6} ${x + 3} ${y + 3} ${x} ${y + 4}C${x - 3} ${y + 5} ${x - 9} ${y + 6} ${x - 9} ${y}Z`, '#f1e7cf', VORA) + linia(`M${x - 5} ${y - 2}Q${x} ${y - 4} ${x + 5} ${y - 2}`, '#fff', 1.4, .8) + `</g>`; return s })(),
  'Maduixa': p('M32 58C20 50 12 36 16 26C20 18 28 20 32 22C36 20 44 18 48 26C52 36 44 50 32 58Z', '#e0283a') +
    (() => { let s = ''; for (const [x, y] of [[24, 30], [32, 28], [40, 30], [22, 38], [30, 36], [38, 37], [44, 38], [27, 45], [35, 45], [32, 52]]) s += el(x, y, .9, 1.4, '#f6d94a'); return s })() +
    p('M32 22L22 16L28 24L18 22L30 26L32 18L34 26L46 22L36 24L42 16Z', C.verd),
  'Meló': el(32, 36, 22, 17, '#d8c75a') + linia('M14 30Q32 24 50 30M12 38Q32 32 52 38M16 46Q32 40 48 46M22 22Q18 36 22 50M32 19V53M42 22Q46 36 42 50', '#a99a3a', 1.2, .6) +
    tija(52, 34, 57, 30, C.marroFosc),
  'Mongeta': `<g transform="rotate(-20 32 32)">` + p('M8 26C20 22 40 22 58 26C58 28 56 29 54 29C40 26 22 26 10 29C8 29 8 27 8 26Z', '#5f9a3c') +
    p('M6 36C18 32 40 32 56 36C56 38 54 39 52 39C38 36 20 36 8 39C6 39 6 37 6 36Z', '#72ad4a') +
    p('M10 46C22 42 42 42 58 46C58 48 56 49 54 49C40 46 24 46 12 49C10 49 10 47 10 46Z', '#5f9a3c') + `</g>`,
  'Nyora': p('M32 18C44 18 52 26 52 38C52 50 42 56 32 56C22 56 12 50 12 38C12 26 20 18 32 18Z', '#8e1f1c') +
    linia('M18 30Q24 34 20 42M28 22Q32 30 28 40Q26 48 30 54M40 22Q36 32 42 40M46 30Q42 38 46 46', '#5a1210', 1.4, .7) +
    p('M28 18L30 10H34L36 18Z', '#5c7a2e') + brill(22, 28, 3, 1.5),
  'Pebrot': p('M18 22C24 18 28 20 32 20C36 20 40 18 46 22C52 26 52 40 48 50C46 56 40 58 36 54C34 56 30 56 28 54C24 58 18 56 16 50C12 40 12 26 18 22Z', '#e0301f') +
    linia('M26 24Q24 40 28 54M38 24Q41 40 36 54', '#a41c10', 1.4, .5) + brill(22, 32, 3, 6, 0) + p('M29 20L30 12Q32 9 35 11L34 20Z', '#3f7a2e'),
  'Pèsol': beina('#72ad4a', C.verdFosc, 5, '#5a9a2c', true),
  'Sindria': p('M6 22H58A26 26 0 0 1 6 22Z', '#3f7a2e') + p('M9 22H55A23 23 0 0 1 9 22Z', '#f4f1d8') + p('M11 22H53A21 21 0 0 1 11 22Z', '#e8384a') +
    (() => { let s = ''; for (const [x, y] of [[22, 28], [32, 32], [42, 28], [27, 36], [37, 36], [32, 26]]) s += el(x, y, 1.2, 2, C.negre); return s })(),
  'Tomàquet': cercle(32, 37, 20, '#e2332a') + brill(23, 30, 5, 3) + linia('M20 42Q32 52 44 42', '#a8211a', 1.2, .35) +
    p('M32 20L24 14L28 21L18 20L28 24L22 30L32 25L42 30L36 24L46 20L36 21L40 14Z', C.verdFosc) + tija(32, 21, 32, 13, C.verdFosc, 2.5),

  // Horta fulla
  'Alfabrega': tija(32, 58, 32, 20, C.verdFosc, 2.5) + fulla(32, 22, 15, 8, -60, '#4f9a3a') + fulla(32, 22, 15, 8, -120, '#4f9a3a') +
    fulla(32, 36, 18, 9, -20, '#5aaa42') + fulla(32, 36, 18, 9, 200, '#5aaa42') + fulla(32, 50, 17, 8, -15, '#4f9a3a') + fulla(32, 50, 17, 8, 195, '#4f9a3a'),
  'Api': (() => { let s = ''; for (const [x, a, c] of [[24, -8, '#b9d77a'], [32, 0, '#a6cc62'], [40, 8, '#b9d77a']] as [number, number, string][]) s += `<g transform="rotate(${a} ${x} 58)">` + p(`M${x - 4} 58L${x - 3} 26H${x + 3}L${x + 4} 58Z`, c) + linia(`M${x - 1} 56V28M${x + 1.5} 56V28`, '#8fb54a', 1, .6) + `</g>`; return s })() +
    fulla(26, 26, 12, 6, -120, C.verd) + fulla(32, 24, 13, 6, -90, C.verd) + fulla(38, 26, 12, 6, -60, C.verd) + fulla(30, 22, 10, 5, -140, C.verdFosc) + fulla(34, 22, 10, 5, -40, C.verdFosc),
  'Bleda': fullaGran('#3f8a36', '#2a5a22', '') + p('M30 40H34L35 58H29Z', '#f3efe0') + linia('M32 40V14', '#f3efe0', 2.5),
  'Card': (() => { let s = ''; for (const [x, a] of [[22, -12], [28, -4], [34, 4], [40, 12]]) s += `<g transform="rotate(${a} ${x} 58)">` + p(`M${x - 4} 58L${x - 3} 14H${x + 3}L${x + 4} 58Z`, '#b8c4a8') + linia(`M${x} 56V16`, '#8f9e80', 1.2, .8) + `</g>`; return s })() +
    fulla(20, 16, 12, 4, -130, '#8fa088') + fulla(44, 16, 12, 4, -50, '#8fa088'),
  'Col': cercle(32, 36, 20, '#6aa84f') + p('M32 16C22 20 18 30 22 40C26 48 38 48 42 40C46 30 42 20 32 16Z', '#8cc063') +
    linia('M32 18V54M32 30L22 22M32 30L42 22M32 40L18 34M32 40L46 34', '#4f8a38', 1.4, .6) + p('M12 38C14 50 22 56 32 56C42 56 50 50 52 38C46 46 18 46 12 38Z', '#4f8a38'),
  'Col de Brussel·les': p('M30 8H34L35 58H29Z', '#8fb35a') +
    (() => { let s = ''; for (const [x, y] of [[24, 16], [40, 20], [24, 28], [40, 32], [24, 40], [40, 44], [26, 52], [38, 55]]) s += cercle(x, y, 6, '#6aa84f') + linia(`M${x - 3} ${y - 2}Q${x} ${y + 3} ${x + 3} ${y - 2}`, C.verdFosc, 1, .6); return s })(),
  'Enciam': p('M10 38C8 26 18 18 26 20C28 12 40 12 42 20C50 18 58 28 54 38C58 46 48 56 32 56C16 56 6 46 10 38Z', '#8cc85a') +
    p('M18 38C16 30 24 26 30 28C32 22 40 24 40 30C46 30 50 36 46 42C42 50 22 50 18 38Z', '#b8e07a') + linia('M32 54V32M32 44L22 36M32 44L42 36', '#5f9a3c', 1.3, .6),
  'Escarola': (() => { let s = ''; for (let i = 0; i < 12; i++) { const a = i * 30; s += `<g transform="rotate(${a} 32 36)">` + p('M32 36L28 18L31 22L32 14L33 22L36 18Z', i % 2 ? '#7fbf4a' : '#9fd060') + `</g>` } return s })() +
    cercle(32, 36, 9, '#e8e28a') + (() => { let s = ''; for (let i = 0; i < 8; i++) s += `<g transform="rotate(${i * 45} 32 36)">` + p('M32 36L30 28L32 30L34 28Z', '#f2ecb0') + `</g>`; return s })(),
  'Espàrrec': (() => { let s = ''; for (const [x, a] of [[24, -10], [32, 0], [40, 10]] as [number, number][]) s += `<g transform="rotate(${a} ${x} 58)">` + p(`M${x - 3} 58L${x - 3} 18Q${x} 8 ${x + 3} 18L${x + 3} 58Z`, '#6f9a3a') + p(`M${x - 3} 20Q${x} 8 ${x + 3} 20Q${x} 24 ${x - 3} 20Z`, '#8a6a9a') + linia(`M${x - 3} 30L${x} 28M${x + 3} 38L${x} 36M${x - 3} 46L${x} 44`, '#4f7a2a', 1.3) + `</g>`; return s })() +
    p('M20 48H44V52H20Z', '#c9a86a'),
  'Espinac': tija(32, 58, 32, 44, C.verdFosc, 2.5) + fulla(32, 46, 26, 10, -120, '#2f6e2a') + fulla(32, 46, 26, 10, -60, '#2f6e2a') + fulla(32, 46, 28, 10, -90, '#3a8032'),
  'Julivert': (() => { let s = tija(32, 58, 26, 26, C.verdFosc, 1.8) + tija(32, 58, 32, 20, C.verdFosc, 1.8) + tija(32, 58, 40, 26, C.verdFosc, 1.8); for (const [x, y] of [[26, 24], [32, 18], [40, 24]]) for (let i = 0; i < 5; i++) { const a = -90 + (i - 2) * 40; s += `<g transform="translate(${x} ${y}) rotate(${a})">` + p('M0 0C2 -4 7 -4 8 0C7 4 2 4 0 0Z', '#3f8a36') + `</g>` } return s })(),
  'Rucula': tija(32, 58, 32, 16, '#4f7a2a', 2) + (() => { let s = ''; for (const [y, dir] of [[22, 1], [28, -1], [36, 1], [44, -1], [50, 1]] as [number, number][]) s += `<g transform="translate(32 ${y}) scale(${dir} 1)">` + p('M0 0C4 -6 10 -6 14 -8C12 -4 16 -2 18 -4C18 0 14 2 10 2C6 3 2 2 0 0Z', '#4f8f35') + `</g>`; return s })(),

  // Horta tub/bul/arr
  'All': bossaBulb('#f4efe2', '#b3a386', p('M30 14L32 6L34 14Z', '#c9bfa8'), VORA),
  'Calçot': (() => { let s = ''; for (const [x, a] of [[26, -8], [32, 0], [38, 8]] as [number, number][]) s += `<g transform="rotate(${a} ${x} 58)">` + p(`M${x - 3} 58L${x - 2} 30H${x + 2}L${x + 3} 58Z`, '#f3f0e2') + p(`M${x - 2} 32L${x - 1.5} 8H${x + 1.5}L${x + 2} 32Z`, '#5f9a3c') + p(`M${x - 3} 58L${x - 3} 52H${x + 3}L${x + 3} 58Z`, '#3a3530') + `</g>`; return s })(),
  'Ceba': bossaBulb('#d99a3a', '#9a5f1a', p('M30 14L32 5L34 14Z', '#b8812a')) + brill(24, 38, 3, 6, -10),
  'Cigrons': (() => { let s = ''; for (const [x, y] of [[22, 30], [34, 26], [44, 34], [28, 40], [40, 46], [18, 44], [30, 52], [42, 20]]) s += cercle(x, y, 6.5, '#e2c48a') + linia(`M${x - 3} ${y - 4}Q${x - 1} ${y} ${x - 4} ${y + 3}`, '#b8955a', 1.2, .8) + cercle(x + 2, y - 2, 1.4, '#fff', 'opacity=".4"'); return s })(),
  'Colrave': cercle(32, 40, 16, '#a9cf7a') + linia('M22 34L14 20M28 28L24 12M36 28L40 12M42 34L50 20', '#7fa84a', 2.2) +
    fulla(14, 20, 10, 4, -130) + fulla(24, 12, 10, 4, -110) + fulla(40, 12, 10, 4, -70) + fulla(50, 20, 10, 4, -50) + brill(26, 36, 4, 2.5) + linia('M32 56V60', '#c9bfa8', 1.5),
  'Fonoll': p('M18 40C18 30 26 30 32 30C38 30 46 30 46 40C46 50 40 56 32 56C24 56 18 50 18 40Z', '#eef1d8', VORA) +
    linia('M26 32Q24 44 28 54M38 32Q40 44 36 54', '#cfd6a8', 1.4) + p('M28 30L26 16H30L31 30Z M33 30L34 14H38L36 30Z', '#b9d77a') +
    linia('M28 16Q20 10 18 4M28 16Q28 8 24 4M36 14Q40 8 44 4M36 14Q44 12 48 8M32 18Q32 10 32 6', C.verd, 1.2),
  'Moniato': `<g transform="rotate(-25 32 34)">` + p('M6 34C10 24 24 22 36 24C48 26 58 30 58 34C58 40 48 44 36 44C24 46 10 44 6 34Z', '#b5485a') +
    linia('M16 30L18 32M28 28L30 31M40 30L42 33M22 40L24 38M36 40L38 38', '#7a2a3a', 1.3, .7) + `</g>` + linia('M56 28L61 24', '#7a2a3a', 1.5),
  'Nap': p('M32 58C28 52 16 48 16 38C16 30 22 26 32 26C42 26 48 30 48 38C48 48 36 52 32 58Z', '#f4efe8', VORA) +
    p('M16 38C16 30 22 26 32 26C42 26 48 30 48 38C42 34 22 34 16 38Z', '#9a5aa8') + fulla(30, 26, 18, 6, -110) + fulla(34, 26, 18, 6, -70) + fulla(32, 26, 16, 5, -90, C.verdFosc),
  'Pastanaga': arrel('#f08a24', '#c96a12'),
  'Patata': tubercle('#c9a266', '#8a6a3a', 'M12 38C10 26 22 20 34 22C46 24 54 30 52 40C50 50 38 54 28 52C18 50 12 46 12 38Z'),
  'Porro': p('M28 58L27 30H37L36 58Z', '#f5f2e6') + p('M27 32L28 26H36L37 32Z', '#dfe8b8') +
    p('M28 28L18 6L24 8L32 26Z', '#4f8a38') + p('M36 28L46 6L40 8L32 26Z', '#4f8a38') + p('M30 26L30 4H34L34 26Z', '#6aa84f') + linia('M30 58L28 62M34 58L36 62M32 58V63', '#c9bfa8', 1.2),
  'Rave': cercle(32, 40, 13, '#d9314a') + p('M20 44C22 50 26 53 32 53C38 53 42 50 44 44C40 48 24 48 20 44Z', '#f4e8ea') + linia('M32 53V62', '#d9314a', 1.3) +
    fulla(30, 28, 16, 6, -115) + fulla(34, 28, 16, 6, -65) + brill(26, 36, 3, 2),
  'Remolatxa': cercle(32, 40, 15, '#7a1f3d') + linia('M32 55V62', '#7a1f3d', 1.5) + brill(26, 35, 3.5, 2) +
    `<g>` + fulla(30, 26, 20, 7, -115, '#4f8a38') + fulla(34, 26, 20, 7, -65, '#4f8a38') + `</g>` + linia('M30 26L22 10M34 26L42 10', '#a8203f', 1.5),
  'Xicòria': p('M32 58C24 50 20 34 24 20C26 12 30 8 32 8C34 8 38 12 40 20C44 34 40 50 32 58Z', '#f1ecd2', VORA) +
    p('M32 8C28 12 26 18 26 24C30 20 34 20 38 24C38 18 36 12 32 8Z', '#e6de7a') + linia('M28 26Q27 42 31 54M36 26Q37 42 33 54', '#cfc79a', 1.3),
  'Xirivia': arrel('#efe2bf', '#bfa878', C.verd, VORA),
  'Yuca': `<g transform="translate(32 34) scale(.85) rotate(-25) translate(-32 -34)">` + p('M6 34C8 26 20 25 34 26C48 27 56 30 58 34C56 38 48 41 34 42C20 43 8 42 6 34Z', '#7a4a28') +
    el(7, 34, 3, 7, '#f7f1e1') + linia('M18 30L20 32M30 29L32 32M44 31L46 33M24 38L26 36M38 38L40 36', '#4e2e16', 1.3, .7) + `</g>`,

  // Varis
  'Arròs': p('M10 34H54C54 46 44 54 32 54C20 54 10 46 10 34Z', '#6b8fa8') + p('M10 34H54V36H10Z', '#4f7086') +
    p('M12 34C14 24 22 20 32 20C42 20 50 24 52 34Z', C.blanc) + (() => { let s = ''; for (const [x, y, a] of [[20, 30, 20], [26, 26, -30], [32, 24, 10], [38, 27, 40], [44, 31, -10], [30, 30, 60], [36, 32, -40], [24, 32, 80]]) s += el(x, y, 2.2, 1, '#d8d0bc', a); return s })(),
  'Blat de moro': `<g transform="rotate(-25 32 34)">` + el(32, 30, 9, 22, '#f2c230') +
    (() => { let s = ''; for (let y = 12; y <= 48; y += 5) for (const x of [26, 30, 34, 38]) s += el(x, y, 1.7, 2, '#e0a81a'); return s })() +
    p('M22 36C20 46 24 56 32 60C28 50 28 42 30 34Z', '#8cbf5a') + p('M42 36C44 46 40 56 32 60C36 50 36 42 34 34Z', '#6aa84f') + `</g>`,
  'Lactic': p('M22 20H42V56H22Z', '#f7f7f4') + p('M22 20L26 10H38L42 20Z', '#e8e8e2') + p('M26 6H38V10H26Z', C.blau) +
    p('M22 30H42V44H22Z', '#5a8ac0') + cercle(32, 37, 4, '#f7f7f4') + linia('M22 20H42V56H22ZM22 20L26 10H38L42 20', '#c8c8c0', 1),
  'Menta': tija(32, 58, 32, 14, '#3f7a2e', 2.2) + (() => { let s = ''; for (const [y, l] of [[18, 12], [30, 16], [44, 17]]) { s += `<g transform="translate(32 ${y}) rotate(-25)"><path d="M0 0Q${l / 2} -${l / 2.2} ${l} 0Q${l / 2} ${l / 2.2} 0 0Z" fill="#43b04a"/><path d="M1 0H${l - 2}" stroke="#2a7a30" stroke-width="1"/></g>`; s += `<g transform="translate(32 ${y}) rotate(205)"><path d="M0 0Q${l / 2} -${l / 2.2} ${l} 0Q${l / 2} ${l / 2.2} 0 0Z" fill="#43b04a"/><path d="M1 0H${l - 2}" stroke="#2a7a30" stroke-width="1"/></g>` } return s })(),
  'Olives': tija(10, 14, 54, 26, C.marro, 2.2) + fulla(20, 17, 16, 4, -30, '#7a8f5a') + fulla(38, 21, 16, 4, -40, '#7a8f5a') + fulla(30, 19, 14, 4, 40, '#8a9e6a') +
    fulla(48, 24, 14, 4, 30, '#8a9e6a') + el(22, 34, 6, 8, '#7a8a2a', -15) + el(36, 40, 6, 8, '#5f6e20', 10) + el(48, 36, 6, 8, '#3a2a30', -10) +
    brill(20, 31, 1.5, 2.5, -15) + brill(34, 37, 1.5, 2.5, 10) + brill(46, 33, 1.5, 2.5, -10),
  'Ou': p('M32 10C22 10 14 26 14 38C14 50 22 58 32 58C42 58 50 50 50 38C50 26 42 10 32 10Z', '#f4e6cf', VORA) + brill(24, 26, 4, 7, -15) +
    linia('M16 44Q32 50 48 44', '#d8c4a4', 1.2, .5),
  'Soja': beina('#b8b06a', '#8a8240', 3, '#e8dca0', true),
  'Suc': p('M18 20H46L42 58H22Z', '#e8f0f4') + p('M19 28H45L42 56H22Z', '#f5a027') + brill(26, 36, 2, 8, 0) + linia('M36 28L42 8L48 6', '#d9453b', 2.5) +
    cercle(46, 20, 7, C.taronja) + cercle(46, 20, 5, '#fbc36a'),
  'Varis': caixa(cercle(22, 28, 7, C.vermell) + cercle(33, 26, 7, C.taronja) + cercle(43, 28, 6, '#8cc43f') + fulla(33, 19, 8, 3, -60)),
  'RETORN': caixa('') + linia('M24 18A10 10 0 1 1 22 26', C.verdFosc, 3) + p('M18 14L24 18L18 22Z', C.verdFosc).replace('/>', ' transform="rotate(-10 20 18)"/>'),
}

// ── Escritura ────────────────────────────────────────────────────────────────────
const DIR = new URL('../public/icones-productes/', import.meta.url)
const soloLlista = Deno.args.includes('--llista')

if (!soloLlista) await Deno.mkdir(DIR, { recursive: true })
const vists = new Set<string>()
for (const [nom, cos] of Object.entries(ICONES)) {
  const slug = slugProducte(nom)
  if (vists.has(slug)) throw new Error(`Slug repetido: ${slug}`)
  vists.add(slug)
  if (soloLlista) { console.log(slug); continue }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${nom}">${cos}</svg>\n`
  await Deno.writeTextFile(new URL(`${slug}.svg`, DIR), svg)
}
console.log(`${vists.size} icones`)
