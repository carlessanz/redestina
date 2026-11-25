// Alta de una cuenta del EQUIPO desde Configuració › Equip (deuda 169).
//
//   POST { email, nombre, telefon?, rol: 'super_admin'|'admin', idioma?: 'ca'|'es' }
//     → 200 { ok: true, user_id, email, rol, simulat }
//
// Hasta ahora una cuenta del equipo se creaba a mano (Admin API + insert en `usuario_roles`). Esto
// lo hace el Superadmin desde la app: crea la cuenta, le da el rol con `alta_membre_equip()` (que
// deja el apunte `accio='alta'` en `equip_rols_hist`) y le manda un correo para crear la contraseña.
//
// AUTORIZACIÓN: solo el super_admin, SIEMPRE (como `cortina-config`): aquí no vale `exigirEquipo`,
// que con `roles_activos` apagado dejaría pasar a cualquier cuenta con sesión. La RPC lo vuelve a
// comprobar con `p_autor` (super_admin ACTIVO), porque con la service key `auth.uid()` es nulo.
//
// Una cuenta que ya existe NO se convierte en equipo (decisión de Carles): si el correo es de una
// cuenta del equipo, 409 `compte_equip`; si es de cualquier otra (una organización), 409
// `compte_existent`. Por eso no se reutiliza nunca una cuenta: siempre se crea.
//
// El correo es TRANSACCIONAL (`{transaccional:true}`, §8), como `enviar-acceso` y
// `recuperar-password`: un acceso no es una notificación y los interruptores no lo cortan. Con el
// modo test encendido sale igual, con el mismo criterio que `esCuentaPermitida()`: el equipo pasa
// siempre (la cuenta ya es del equipo cuando se manda).
//
// PASOS Y COMPENSACIÓN (`desfer()`, en orden inverso, como `donar-acces`):
//   A. `auth.admin.createUser` (contraseña aleatoria que no se guarda; el trigger
//      `on_auth_user_created` crea el perfil) y teléfono e idioma en `perfiles`   → deleteUser
//   B. `alta_membre_equip()`: rol + apunte `alta` en el historial                → borrar rol y apunte
//   C. `generateLink({ type: 'recovery' })`
//   D. `sendEmail()`: si no sale, se deshace B y A y 502 `correu_fallit`.
// El rol y el apunte se borran ANTES del deleteUser: con el rol puesto, el trigger
// `equip_arxiva_persona` archivaría en `equip_persones_arxiu` a una persona que nunca llegó a
// estar en el equipo. El historial no tiene FK con `auth.users` y no bloquea el borrado.
//
// Los logs llevan el correo enmascarado y nunca el enlace, que es una credencial.
//
// Códigos: 401 `unauthorized` · 403 `forbidden` · 400 `correu_invalid|nom_buit|nom_massa_llarg|
// rol_invalid|idioma_invalid|telefon_invalid` · 409 `compte_equip|compte_existent|te_membresies` ·
// 502 `correu_fallit` · 500 `error_intern`.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import { contextoUsuario } from "../_shared/autorizacion.ts";
import { corsPara, origenPorDefecto } from "../_shared/cors.ts";
import { preflight, respondedor } from "../_shared/http.ts";
import { patroLiteral } from "../_shared/gate.ts";
import { sendEmail } from "../_shared/resend.ts";
import { enmascararEmail } from "../_shared/enmascarar.ts";
import { copiaBustiaLocal } from "../_shared/bustiaLocal.ts";
import { composaCorreu, errorAlta, validaEntrada } from "./correu.ts";

/** Una contraseña que nadie conoce: la persona pone la suya con el enlace. */
function contrasenyaAleatoria(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, "x");
}

Deno.serve(async (req) => {
  const t0 = performance.now();
  const cors = corsPara(req);
  const responder = respondedor(cors);
  // `error` lleva el CÓDIGO, no un texto: el cliente (`altaMembreEquip`) lee `error ?? code` y la
  // pantalla lo traduce (`clauErrorAlta`). El texto lo pone la interfaz en ca/es.
  const falla = (code: string, status: number) => responder({ error: code, code }, status);

  if (req.method === "OPTIONS") return preflight(cors);
  if (req.method !== "POST") return responder({ error: "Method Not Allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SB_SECRET_KEY")!);

  const ctx = await contextoUsuario(supabase, req);
  if (!ctx) return falla("unauthorized", 401);
  if (ctx.rol !== "super_admin") {
    return falla("forbidden", 403);
  }

  // Lo que hay que deshacer si algo falla después de crearlo.
  let userCreat: string | null = null;
  let rolDonat = false;
  const desfer = async () => {
    if (!userCreat) return;
    if (rolDonat) {
      const [r, h] = await Promise.all([
        supabase.from("usuario_roles").delete().eq("user_id", userCreat),
        supabase.from("equip_rols_hist").delete().eq("user_id", userCreat).eq("accio", "alta"),
      ]);
      if (r.error) console.error("[alta-equip] NO s'ha pogut treure el rol:", userCreat, r.error.message);
      if (h.error) console.error("[alta-equip] NO s'ha pogut treure l'apunt d'alta:", userCreat, h.error.message);
    }
    const { error } = await supabase.auth.admin.deleteUser(userCreat);
    if (error) console.error("[alta-equip] NO s'ha pogut esborrar el compte creat:", userCreat, error.message);
    // Por si el rol no se pudo quitar y el trigger llegó a archivarla: no fue nunca del equipo.
    if (rolDonat) await supabase.from("equip_persones_arxiu").delete().eq("user_id", userCreat);
  };

  try {
    const body = await req.json().catch(() => null);
    const v = validaEntrada(body);
    if (!v.ok) return falla(v.code, 400);
    const { email, nombre, telefon, rol, idioma } = v.dades;

    // -----------------------------------------------------------------------
    // Precheck: el correo no puede tener cuenta. Fallar aquí es limpio.
    // -----------------------------------------------------------------------
    const { data: perfil, error: errPerfil } = await supabase
      .from("perfiles").select("id").ilike("email", patroLiteral(email)).limit(1).maybeSingle();
    if (errPerfil) {
      console.error("[alta-equip] lectura perfil:", errPerfil.message);
      return falla("error_intern", 500);
    }
    if (perfil) {
      const { data: rols } = await supabase.from("usuario_roles").select("rol").eq("user_id", perfil.id).limit(1);
      if ((rols ?? []).length > 0) {
        return falla("compte_equip", 409);
      }
      return falla("compte_existent", 409);
    }

    // -----------------------------------------------------------------------
    // A. La cuenta (y el perfil, por trigger), con teléfono e idioma.
    // -----------------------------------------------------------------------
    const { data: creada, error: errCrear } = await supabase.auth.admin.createUser({
      email,
      password: contrasenyaAleatoria(),
      // El mailer nativo está apagado (§9): sin confirmar, la cuenta no podría entrar nunca.
      email_confirm: true,
      user_metadata: { nombre },
    });
    if (errCrear || !creada?.user) {
      const codi = (errCrear as unknown as { code?: string } | null)?.code ?? "";
      if (codi === "email_exists" || /already been registered|already exists/i.test(errCrear?.message ?? "")) {
        return falla("compte_existent", 409);
      }
      console.error("[alta-equip] createUser:", errCrear?.message);
      return falla("error_intern", 500);
    }
    userCreat = creada.user.id as string;

    const { error: errPerf } = await supabase.from("perfiles")
      .update({ nombre, telefono: telefon, idioma }).eq("id", userCreat);
    if (errPerf) {
      await desfer();
      console.error("[alta-equip] perfil:", errPerf.message);
      return falla("error_intern", 500);
    }

    // -----------------------------------------------------------------------
    // B. El rol y el apunte del historial, en una transacción.
    // -----------------------------------------------------------------------
    const { error: errAlta } = await supabase.rpc("alta_membre_equip", {
      p_user: userCreat, p_rol: rol, p_autor: ctx.userId,
    });
    if (errAlta) {
      await desfer();
      const { status, code } = errorAlta(errAlta.code, errAlta.message);
      if (status === 500) console.error("[alta-equip] alta_membre_equip:", errAlta.code, errAlta.message);
      return falla(code, status);
    }
    rolDonat = true;

    // -----------------------------------------------------------------------
    // C. El enlace para crear la contraseña.
    // -----------------------------------------------------------------------
    const redirectTo = Deno.env.get("APP_URL") ?? origenPorDefecto();
    const { data: link, error: errLink } = await supabase.auth.admin.generateLink({
      type: "recovery", email, options: { redirectTo },
    });
    const enllac = (link?.properties as { action_link?: string } | undefined)?.action_link;
    if (errLink || !enllac) {
      await desfer();
      console.error("[alta-equip] generateLink:", errLink?.message ?? "sense enllaç");
      return falla("error_intern", 500);
    }

    // -----------------------------------------------------------------------
    // D. El correo, transaccional. Si no sale, no queda nada.
    // -----------------------------------------------------------------------
    const missatge = composaCorreu({ enllac, nombre, rol, idioma });
    const r = await sendEmail(
      { to: email, ...missatge },
      { supabase, proposito: "acces_equip", objetoTipo: "perfil", objetoId: userCreat, funcion: "alta-equip" },
      { transaccional: true },
    );
    if (!r.ok) {
      await desfer();
      console.error("[alta-equip] correu no enviat:", enmascararEmail(email), r.status);
      return falla("correu_fallit", 502);
    }
    if (r.simulado) await copiaBustiaLocal({ to: email, ...missatge });

    console.log(JSON.stringify({
      fn: "alta-equip", user_id: userCreat, email: enmascararEmail(email), rol, telefon: telefon !== null,
      correu: r.simulado ? "simulat" : "enviat", ms: Math.round(performance.now() - t0),
    }));
    return responder({ ok: true, user_id: userCreat, email, rol, simulat: r.simulado === true }, 200);
  } catch (err) {
    console.error("[alta-equip] error:", err instanceof Error ? err.message : String(err));
    await desfer();
    return falla("error_intern", 500);
  }
});
