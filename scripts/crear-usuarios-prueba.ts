// Usuarios y organizaciones de prueba, uno por cada caso del modelo de roles.
//
//   SUPABASE_URL=... SB_SECRET_KEY=... deno run -A scripts/crear-usuarios-prueba.ts [--dry-run]
//
// Idempotente: se puede ejecutar las veces que haga falta (la segunda pasada actualiza,
// no duplica), igual que import-ara.ts.
//
// ORGANIZACIONES FICTICIAS, NUNCA REALES. Vincular una cuenta de prueba a una de las
// 111 entidades o 341 productores reales significaría que un fallo de permisos expone
// una organización de verdad, y que un botón mal pulsado le manda un WhatsApp. Todas
// las fichas que crea llevan `codigo` con prefijo TEST- (que es la clave de
// idempotencia) y `es_test = true`.
//
// SIN TELÉFONO: `productores.phone` es UNIQUE y los números reales del equipo ya están
// dados de alta. Sin teléfono no hay envío accidental posible. Para probar WhatsApp de
// verdad están las cuentas de `scripts/crear-usuarios-whatsapp.ts`, que se apoyan en las
// fichas reales con móvil verificado en Meta.
//
// EL JUEGO ES DELIBERADAMENTE PEQUEÑO (31-07-2026): 2 productores y 3 receptores —social,
// transformador y comercial—, con UN usuario cada uno. Antes había pares
// titular/operador y un cuarto receptor de alimentación animal. Los pares se fueron
// porque el producto no tiene cargos dentro de la organización (todos sus usuarios ven el
// mismo panel), y el receptor animal porque esa línea no se usa todavía: cada cuenta que
// sobra es una ficha más de ruido en los listados del equipo y en la priorización.
//
// Las contraseñas se muestran UNA sola vez por pantalla y no se guardan en ningún
// fichero. Para mandar el acceso por enlace mágico, usa la Edge Function
// `enviar-acceso` (§9) desde el panel o con curl.
//

import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SB_SECRET_KEY");
if (!url || !key) {
  console.error("Faltan SUPABASE_URL o SB_SECRET_KEY en el entorno.");
  Deno.exit(1);
}
const dryRun = Deno.args.includes("--dry-run");

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// El fixture, declarativo: se lee de un vistazo y es su propia documentación
// ---------------------------------------------------------------------------

// Arriba del todo porque ORGS ya lo usa (const no tiene hoisting).
const BASE = "hola";
const DOMINIO = "carlessanz.com";
const correo = (sufijo: string) => `${BASE}+${sufijo}@${DOMINIO}`;

interface Org {
  codigo: string;
  tipo: "productor" | "entidad";
  nombre: string;
  poblacion: string;
  area: string;
  /** Solo entidades: decide qué ofertas ve en su mercado. */
  tipoReceptor?: "social" | "animal" | "transformador" | "comercial";
  modalitat?: string;
  /**
   * Correo de la organización: es el de su titular. Sin él la ficha se queda SIN
   * NINGÚN CANAL —no tienen teléfono, porque `productores.phone` es UNIQUE y los
   * números del equipo ya están dados de alta—, y con el correo como canal por
   * defecto (§8bis) esa es justamente la vía que hay que poder probar.
   */
  email: string;
}

const ORGS: Org[] = [
  { codigo: "TEST-PROD-1", tipo: "productor", nombre: "Mas de Prova SCP", poblacion: "Gavà", area: "Baix Llobregat", email: correo("prodowner-masprova") },
  { codigo: "TEST-PROD-2", tipo: "productor", nombre: "Horta de Prova SL", poblacion: "Viladecans", area: "Baix Llobregat", email: correo("prodowner-hortaprova") },
  { codigo: "TEST-ENT-SOCIAL", tipo: "entidad", nombre: "Menjador Social de Prova", poblacion: "Barcelona", area: "Barcelonès", tipoReceptor: "social", modalitat: "Donació", email: correo("recowner-social") },
  { codigo: "TEST-ENT-OBRADOR", tipo: "entidad", nombre: "Obrador de Prova", poblacion: "Sabadell", area: "Vallès Occidental", tipoReceptor: "transformador", modalitat: "Maquila", email: correo("recowner-obrador") },
  { codigo: "TEST-ENT-COMERCIAL", tipo: "entidad", nombre: "Comercial de Prova SL", poblacion: "Mercabarna", area: "Barcelonès", tipoReceptor: "comercial", modalitat: "Venda", email: correo("recowner-comercial") },
];

interface Cuenta {
  email: string;
  nombre: string;
  /** Rol de plataforma; null = usuario externo (su acceso sale de la membresía). */
  rol: "super_admin" | "admin" | "tecnic" | null;
  org?: { codigo: string; rolOrg: "titular" };
  para: string;
}

// UN SOLO USUARIO POR ORGANIZACIÓN. Antes había pares titular/operador para probar que
// el segundo no podía editar la ficha; se retiraron el 31-07-2026 porque el producto no
// tiene cargos dentro de la organización: todos los usuarios de una empresa ven el mismo
// panel. `rol_org` sigue en el esquema, pero de facto siempre vale `titular` —también lo
// que crea el registro público—, así que dos cuentas por organización no probaban nada
// que no probara una.
const CUENTAS: Cuenta[] = [
  { email: correo("superadmin"), nombre: "Super Admin Redestina", rol: "super_admin", para: "Aprueba, canaliza y toca la configuración" },
  { email: correo("equip"), nombre: "Tècnic Redestina", rol: "tecnic", para: "Opera el día a día; NO aprueba ni cambia el modo test" },
  { email: correo("prodowner-masprova"), nombre: "Productor Mas de Prova", rol: null, org: { codigo: "TEST-PROD-1", rolOrg: "titular" }, para: "Publica ofertas y edita la ficha de su organización" },
  { email: correo("prodowner-hortaprova"), nombre: "Productor Horta de Prova", rol: null, org: { codigo: "TEST-PROD-2", rolOrg: "titular" }, para: "Control de fuga: no debe ver nada de TEST-PROD-1" },
  { email: correo("recowner-social"), nombre: "Receptor Menjador Social", rol: null, org: { codigo: "TEST-ENT-SOCIAL", rolOrg: "titular" }, para: "Entidad social: mercado de donaciones, interés e histórico" },
  { email: correo("recowner-obrador"), nombre: "Receptor Obrador de Prova", rol: null, org: { codigo: "TEST-ENT-OBRADOR", rolOrg: "titular" }, para: "Transformador: maquila y preu mínim" },
  { email: correo("recowner-comercial"), nombre: "Receptor Comercial de Prova", rol: null, org: { codigo: "TEST-ENT-COMERCIAL", rolOrg: "titular" }, para: "Comercial: ve el preu y lo confirma al aceptar" },
];

// ---------------------------------------------------------------------------

function generarPassword(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  const chars = [...bytes].map((b) => abc[b % abc.length]);
  return [0, 5, 10].map((i) => chars.slice(i, i + 5).join("")).join("-");
}

/** Resumen de una línea de qué es la cuenta: sale en el listado y en las credenciales. */
function etiquetaCuenta(cuenta: Cuenta): string {
  return cuenta.rol ?? cuenta.org?.codigo ?? "sense rol";
}

/** Alta o actualización de una organización ficticia. Devuelve su id. */
async function asseguraOrg(org: Org): Promise<string | null> {
  const tabla = org.tipo === "productor" ? "productores" : "entidades";
  const campoNombre = org.tipo === "productor" ? "name" : "nombre";

  const { data: existente } = await admin
    .from(tabla).select("id").eq("codigo", org.codigo).maybeSingle();

  const fila: Record<string, unknown> = {
    [campoNombre]: org.nombre,
    codigo: org.codigo,
    poblacion: org.poblacion,
    area_geografica: org.area,
    email: org.email,
    es_test: true,
  };
  if (org.tipo === "entidad") {
    fila.tipo_receptor = org.tipoReceptor ?? null;
    fila.modalitat = org.modalitat ?? null;
    fila.opt_in = true;
    fila.estat = "Signat";       // para que entre en la priorización del equipo
    fila.prioritat = 1;
  } else {
    fila.activo = true;
  }

  if (dryRun) {
    console.log(`  [dry-run] ${existente ? "actualizaría" : "crearía"} ${tabla}: ${org.codigo}`);
    return existente?.id ?? null;
  }

  if (existente) {
    const { error } = await admin.from(tabla).update(fila).eq("id", existente.id);
    if (error) { console.error(`  ✗ ${org.codigo}: ${error.message}`); return null; }
    return existente.id;
  }
  const { data, error } = await admin.from(tabla).insert(fila).select("id").single();
  if (error) { console.error(`  ✗ ${org.codigo}: ${error.message}`); return null; }
  return data.id;
}

/** Busca una cuenta por correo paginando (la Admin API no filtra por email). */
async function buscaUsuari(email: string): Promise<string | null> {
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error || !data.users.length) return null;
    const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------

console.log(`\n${dryRun ? "SIMULACIÓN — no se escribe nada\n" : ""}1. Organizaciones de prueba`);
const idsOrg = new Map<string, string>();
for (const org of ORGS) {
  const id = await asseguraOrg(org);
  if (id) { idsOrg.set(org.codigo, id); console.log(`  ✓ ${org.codigo} · ${org.nombre} · ${org.email}`); }
}

// `enviar-email` exige DOS cosas: es_test en la ficha (arriba) y estar en esta
// whitelist mientras tenga filas (§8). Sin esto, las organizaciones de prueba
// pasarían el primer gate y las pararía el segundo, que es de los fallos más
// confusos de diagnosticar: la ficha "parece" correcta.
if (!dryRun) {
  const { error } = await admin.from("email_test_recipients").upsert(
    ORGS.map((o) => ({ email: o.email, etiqueta: o.codigo })),
    { onConflict: "email", ignoreDuplicates: true },
  );
  if (error) console.error(`  ✗ email_test_recipients: ${error.message}`);
  else console.log(`  ✓ ${ORGS.length} correos en la whitelist de test`);
}

console.log("\n2. Cuentas");
const credenciales: { email: string; password: string | null; nota: string }[] = [];

for (const cuenta of CUENTAS) {
  if (dryRun) {
    console.log(`  [dry-run] ${cuenta.email} · ${etiquetaCuenta(cuenta)}`);
    continue;
  }

  let userId = await buscaUsuari(cuenta.email);
  let password: string | null = null;

  if (!userId) {
    password = generarPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email: cuenta.email,
      password,
      email_confirm: true,                       // no envía ningún correo (§9)
      user_metadata: { nombre: cuenta.nombre },
    });
    if (error || !data.user) {
      console.error(`  ✗ ${cuenta.email}: ${error?.message}`);
      continue;
    }
    userId = data.user.id;
  }

  // El trigger crea el perfil; aquí se completan nombre y marca de prueba.
  const { error: errPerfil } = await admin.from("perfiles")
    .upsert({ id: userId, email: cuenta.email, nombre: cuenta.nombre }, { onConflict: "id" });
  if (errPerfil) console.error(`  ! perfil ${cuenta.email}: ${errPerfil.message}`);

  // Rol de plataforma (los externos no tienen ninguno).
  await admin.from("usuario_roles").delete().eq("user_id", userId);
  if (cuenta.rol) {
    const { error } = await admin.from("usuario_roles").insert({ user_id: userId, rol: cuenta.rol });
    if (error) console.error(`  ! rol ${cuenta.email}: ${error.message}`);
  }

  // Membresía con su organización.
  if (cuenta.org) {
    const orgId = idsOrg.get(cuenta.org.codigo);
    const org = ORGS.find((o) => o.codigo === cuenta.org!.codigo)!;
    if (orgId) {
      // No se escribe `aprovacio` a propósito: en el alta lo pone el default
      // (`aprovada`) y en las reejecuciones se respeta lo que haya decidido el equipo
      // desde el panel.
      const fila: Record<string, unknown> = {
        user_id: userId,
        tipo: org.tipo,
        productor_id: org.tipo === "productor" ? orgId : null,
        entidad_id: org.tipo === "entidad" ? orgId : null,
        rol_org: cuenta.org.rolOrg,
        activo: true,
      };
      const columna = org.tipo === "productor" ? "productor_id" : "entidad_id";
      const { data: existent } = await admin.from("membresias")
        .select("id").eq("user_id", userId).eq(columna, orgId).maybeSingle();
      const { error } = existent
        ? await admin.from("membresias").update(fila).eq("id", existent.id)
        : await admin.from("membresias").insert(fila);
      if (error) console.error(`  ! membresía ${cuenta.email}: ${error.message}`);
    }
  }

  credenciales.push({ email: cuenta.email, password, nota: etiquetaCuenta(cuenta) });
  console.log(`  ✓ ${cuenta.email} · ${etiquetaCuenta(cuenta)}`);
}

if (dryRun) {
  console.log("\nSimulación terminada. Quita --dry-run para aplicarlo.\n");
  Deno.exit(0);
}

console.log("\n3. Credenciales (solo se muestran ahora)\n");
console.log("  ┌─────────────────────────────────────────────────────────────────────────┐");
for (const c of credenciales) {
  console.log(`    ${c.email}`);
  console.log(`      ${c.password ?? "(ya existía: contraseña sin cambiar)"}  ·  ${c.nota}`);
}
console.log("  └─────────────────────────────────────────────────────────────────────────┘");
console.log(`
  Para mandar el acceso por enlace mágico (correo) o código (WhatsApp), usa la Edge
  Function enviar-acceso con la sesión de una cuenta del equipo:

    curl -X POST "$SUPABASE_URL/functions/v1/enviar-acceso" \\
      -H "Authorization: Bearer <access_token>" -H "Content-Type: application/json" \\
      -d '{"email":"${CUENTAS[0].email}","canal":"email"}'

  Recuerda: por WhatsApp va solo el código de 6 cifras, y solo llega a los números de
  meta_test_recipients con la ventana de 24 h abierta (§8). Estas fichas no tienen
  teléfono, así que su canal es el correo.
`);
