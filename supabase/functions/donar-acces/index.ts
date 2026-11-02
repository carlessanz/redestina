// «Dona-li accés» (plan 1, rebanada 1D; D5 y P1): el equipo da acceso a una organización que YA
// existe. Crea la cuenta si no la hay, la hace titular de cada ficha activa y le manda un correo
// para que ponga su contraseña. Sustituye a `alta-assistida`, que siempre creaba una organización
// nueva con una contraseña puesta por el equipo.
//
//   POST { organizacion_id, email? }  →  { ok, compte_nou, email: "···@domini", correu }
//
// AUTORIZACIÓN: `exigirEquipo` y, encima, `pot_aprovar` (admin o super_admin): crear una cuenta
// ya aprobada es aprobar un alta. Mismo idioma que tenía `alta-assistida`.
//
// GATES, ANTES DE CREAR NADA:
//   · el interruptor del correo (general Y `email_activo`, §8) apagado → 409 `correu_desactivat`.
//     ⚠️ Este correo NO es transaccional, a diferencia de `enviar-acceso`: dar acceso es una
//     decisión operativa, y con el correo apagado la persona no recibiría el enlace (plan 1, §4).
//   · el modo test (fail-safe encendido) → todas las fichas activas tienen que ser `es_test`.
//   · y lo que comprueba `concedir_acces_org()` (cuenta del equipo, de otra organización, otra
//     cuenta ya activa, alta pendiente), que aquí se mira antes para no crear una cuenta en vano.
//
// PASOS Y COMPENSACIÓN (en orden inverso si algo falla, como `registro/alta.ts`):
//   A. `auth.admin.createUser` si no hay cuenta (contraseña aleatoria que no se guarda)  → deleteUser
//   B. `concedir_acces_org()`: correo en las fichas, membresías titulares, perfil activo,
//      en UNA transacción; devuelve la foto previa                                       → revertir_acces_org(foto)
//   C. `generateLink({ type: 'recovery' })`
//   D. `sendEmail()` operativo: si no sale, se deshace B y A
// «Torna a enviar» es la misma llamada: con la cuenta ya activa, B no cambia nada y se repiten C y D.
//
// Ningún consentimiento RGPD se marca aquí: el equipo no acepta por nadie (P3, deuda 152).
// Los logs llevan el correo enmascarado y nunca el enlace, que es una credencial.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { exigirEquipo, rolesActivos } from "../_shared/autorizacion.ts";
import { corsPara, origenPorDefecto } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { emailActivo, modoTestActivo, patroLiteral } from "../_shared/gate.ts";
import { sendEmail } from "../_shared/resend.ts";
import { enmascararEmail } from "../_shared/enmascarar.ts";
import { copiaBustiaLocal } from "../_shared/bustiaLocal.ts";
import { composaCorreu, errorConcedir, resoldreCorreu } from "./correu.ts";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Fitxa {
  id: string;
  email: string | null;
  activo: boolean;
  es_test: boolean;
  persona: string | null;
  nom: string | null;
}

/** Una contraseña que nadie conoce: la persona pone la suya con el enlace. */
function contrasenyaAleatoria(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, "x");
}

Deno.serve(async (req) => {
  const cors = corsPara(req);
  const responder = respondedor(cors);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const auth = await exigirEquipo(supabase, req);
  if ("rechazo" in auth) {
    const { error, code, status } = auth.rechazo;
    return responder({ error, code }, status);
  }
  if ((await rolesActivos(supabase)) && !auth.ctx.potAprovar) {
    return responder({ error: "Només admin o super_admin poden donar accés", code: "forbidden" }, 403);
  }

  // Lo que hay que deshacer si algo falla después de crearlo.
  let userCreat: string | null = null;
  let foto: unknown = null;
  const desfer = async () => {
    if (foto) {
      const { error } = await supabase.rpc("revertir_acces_org", { p_foto: foto });
      if (error) console.error("[donar-acces] NO s'ha pogut revertir l'accés:", error.message, JSON.stringify(foto));
    }
    if (userCreat) {
      const { error } = await supabase.auth.admin.deleteUser(userCreat);
      if (error) console.error("[donar-acces] NO s'ha pogut esborrar el compte creat:", userCreat, error.message);
    }
  };

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const org = typeof body.organizacion_id === "string" ? body.organizacion_id : "";
    if (!RE_UUID.test(org)) {
      return responder({ error: "Falta organizacion_id", code: "dades_invalides" }, 400);
    }

    // -----------------------------------------------------------------------
    // Prechecks: fallar aquí es limpio.
    // -----------------------------------------------------------------------
    const [o, p, e] = await Promise.all([
      supabase.from("organizaciones").select("id").eq("id", org).maybeSingle(),
      supabase.from("productores").select("id, email, activo, es_test, name, empresa").eq("organizacion_id", org),
      supabase.from("entidades").select("id, email, activo, es_test, contacto, nombre").eq("organizacion_id", org),
    ]);
    if (o.error || p.error || e.error) {
      console.error("[donar-acces] lectura:", o.error?.message ?? p.error?.message ?? e.error?.message);
      return responder({ error: "Error intern", code: "error_intern" }, 500);
    }
    if (!o.data) return responder({ error: "L'organització no existeix", code: "organitzacio_inexistent" }, 404);

    const fitxes: Fitxa[] = [
      ...(p.data ?? []).map((f: Record<string, unknown>) => ({
        id: f.id as string, email: f.email as string | null, activo: f.activo === true,
        es_test: f.es_test === true, persona: f.name as string | null, nom: f.empresa as string | null,
      })),
      ...(e.data ?? []).map((f: Record<string, unknown>) => ({
        id: f.id as string, email: f.email as string | null, activo: f.activo === true,
        es_test: f.es_test === true, persona: f.contacto as string | null, nom: f.nombre as string | null,
      })),
    ];
    const actives = fitxes.filter((f) => f.activo);
    if (actives.length === 0) {
      return responder({ error: "L'entitat no està activa", code: "entitat_inactiva" }, 409);
    }

    const correu = resoldreCorreu(body.email, actives.map((f) => f.email));
    if (!correu.ok) return responder({ error: correu.code, code: correu.code }, 400);
    const email = correu.email;

    if (!(await emailActivo(supabase))) {
      return responder({ error: "El correu està desactivat a Configuració", code: "correu_desactivat" }, 409);
    }
    if ((await modoTestActivo(supabase)) && actives.some((f) => !f.es_test)) {
      return responder({ error: "Amb el mode test, només entitats de prova", code: "no_test_user" }, 403);
    }

    const { data: perfil } = await supabase
      .from("perfiles").select("id, idioma").ilike("email", patroLiteral(email)).limit(1).maybeSingle();
    if (perfil) {
      const { data: rols } = await supabase.from("usuario_roles").select("rol").eq("user_id", perfil.id).limit(1);
      if ((rols ?? []).length > 0) {
        return responder({ error: "Aquest correu és d'un compte de l'equip", code: "compte_equip" }, 409);
      }
    }
    // Lo que `concedir_acces_org` rechazaría, mirado antes de crear una cuenta para nada.
    const ids = fitxes.map((f) => f.id);
    const { data: vives } = await supabase.from("membresias")
      .select("user_id, activo, aprovacio")
      .or(`productor_id.in.(${ids.join(",")}),entidad_id.in.(${ids.join(",")})`);
    if ((vives ?? []).some((m: { aprovacio: string }) => m.aprovacio === "pendent")) {
      return responder({ error: "Hi ha una alta pendent a Aprovacions", code: "registre_pendent" }, 409);
    }
    if ((vives ?? []).some((m: { user_id: string; activo: boolean; aprovacio: string }) =>
      m.activo && m.aprovacio === "aprovada" && m.user_id !== perfil?.id
    )) {
      return responder({ error: "L'entitat ja té un altre compte amb accés", code: "altre_compte_actiu" }, 409);
    }

    // -----------------------------------------------------------------------
    // A. La cuenta, si no existe.
    // -----------------------------------------------------------------------
    const persona = actives.find((f) => f.persona)?.persona ?? null;
    let userId = perfil?.id as string | undefined;
    if (!userId) {
      const { data: creada, error } = await supabase.auth.admin.createUser({
        email,
        password: contrasenyaAleatoria(),
        // El mailer nativo está apagado (§9): sin confirmar, la cuenta no podría entrar nunca.
        email_confirm: true,
        user_metadata: persona ? { nombre: persona } : {},
      });
      if (error || !creada?.user) {
        const codi = (error as unknown as { code?: string } | null)?.code ?? "";
        if (codi === "email_exists" || /already been registered|already exists/i.test(error?.message ?? "")) {
          return responder({ error: "Aquest correu ja té compte: torna-ho a provar", code: "compte_existent" }, 409);
        }
        console.error("[donar-acces] createUser:", error?.message);
        return responder({ error: "No s'ha pogut crear el compte", code: "error_intern" }, 500);
      }
      userId = creada.user.id as string;
      userCreat = userId;
    }

    // -----------------------------------------------------------------------
    // B. Membresías y correo en la ficha, en una transacción.
    // -----------------------------------------------------------------------
    const { data: concedit, error: errConcedir } = await supabase.rpc("concedir_acces_org", {
      p_org: org, p_user: userId, p_email: email, p_per: auth.ctx.userId,
    });
    if (errConcedir || !concedit) {
      await desfer();
      const { status, code } = errorConcedir(errConcedir?.message);
      if (status === 500) console.error("[donar-acces] concedir:", errConcedir?.message);
      return responder({ error: code, code }, status);
    }
    foto = concedit;

    // -----------------------------------------------------------------------
    // C. El enlace para poner la contraseña.
    // -----------------------------------------------------------------------
    const redirectTo = Deno.env.get("APP_URL") ?? origenPorDefecto();
    const { data: link, error: errLink } = await supabase.auth.admin.generateLink({
      type: "recovery", email, options: { redirectTo },
    });
    const enllac = (link?.properties as { action_link?: string } | undefined)?.action_link;
    if (errLink || !enllac) {
      await desfer();
      console.error("[donar-acces] generateLink:", errLink?.message ?? "sense enllaç");
      return responder({ error: "No s'ha pogut generar l'enllaç", code: "error_intern" }, 500);
    }

    // -----------------------------------------------------------------------
    // D. El correo. Operativo, no transaccional: `sendEmail` vuelve a mirar el interruptor y el
    //    modo test (con el correo ya escrito en la ficha), y si no sale se deshace todo.
    // -----------------------------------------------------------------------
    const nom = actives.find((f) => f.nom)?.nom ?? null;
    const missatge = composaCorreu({ enllac, idioma: perfil?.idioma ?? null, nom: persona, organitzacio: nom });
    const r = await sendEmail(
      { to: email, ...missatge },
      { supabase, proposito: "acces_entitat", objetoTipo: "organizacion", objetoId: org, funcion: "donar-acces" },
    );
    if (!r.ok) {
      await desfer();
      const tall = (r.data as { code?: string } | null)?.code;
      if (r.desactivado && tall === "no_test_user") {
        return responder({ error: "Amb el mode test, només entitats de prova", code: "no_test_user" }, 403);
      }
      if (r.desactivado) {
        return responder({ error: "El correu està desactivat a Configuració", code: "correu_desactivat" }, 409);
      }
      return responder({ error: "No s'ha pogut enviar el correu", code: "correu_no_enviat" }, 502);
    }
    if (r.simulado) await copiaBustiaLocal({ to: email, ...missatge });

    console.log(JSON.stringify({
      fn: "donar-acces", org, email: enmascararEmail(email), compte_nou: userCreat !== null,
      canvis: (concedit as { canvis?: boolean }).canvis ?? null, correu: r.simulado ? "simulat" : "enviat",
    }));
    return responder({
      ok: true,
      compte_nou: userCreat !== null,
      email: enmascararEmail(email),
      correu: r.simulado ? "simulat" : "enviat",
    }, 200);
  } catch (err) {
    console.error("[donar-acces] error:", err instanceof Error ? err.message : String(err));
    await desfer();
    return responder({ error: "Error intern", code: "error_intern" }, 500);
  }
});
