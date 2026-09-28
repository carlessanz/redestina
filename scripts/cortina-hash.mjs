// La huella de una contraseña nueva para la cortina (cortina/cortina.ts, HASH_TOKEN).
// Uso: node scripts/cortina-hash.mjs 'contrasenya'
// Imprime SOLO la huella: la contraseña no se guarda en ningún fichero.
const pw = process.argv[2]
if (!pw) { console.error("Ús: node scripts/cortina-hash.mjs 'contrasenya'"); process.exit(1) }
const enc = new TextEncoder()
const clau = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits'])
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode('redestina-cortina-v1'), iterations: 100000, hash: 'SHA-256' }, clau, 256)
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
console.log(hex(await crypto.subtle.digest('SHA-256', enc.encode(hex(bits)))))
