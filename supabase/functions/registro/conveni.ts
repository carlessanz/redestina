import { type Dades, type Rol } from "./validacio.ts";
import type { Cliente } from "./cliente.ts";

// ---------------------------------------------------------------------------
// El convenio dentro del alta (fase 2, §3.2.4 «Dentro del registro»)
// ---------------------------------------------------------------------------
// Dos RPC y ninguna decisión propia:
//   · `preparar_convenio()` compone el borrador con la plantilla vigente del modelo que
//     le toca a la organización —un productor firma `don_gen`; una entidad, `don_rec`—.
//     El de compraventa no se prepara aquí: se prepara cuando la organización opera en
//     venta o maquila, y en el alta todavía no sabemos si lo hará.
//   · `enviar_convenio()` crea el enlace de firma (token de 256 bits, del que en la base
//     solo queda el sha256) y devuelve el token EN CLARO, que es la única vez que existe.
//
// NUNCA LANZA. Lo peor que puede pasar es que el registro responda sin convenio y el
// equipo lo prepare desde la campaña, que es exactamente el camino de las 452 fichas que
// ya existen. Un alta perdida, en cambio, no se recupera.
//
// ⚠️ Aquí NO se manda ningún correo, igual que en el resto de esta función y por el mismo
//    motivo (§8): la organización nace con `es_test = false` y, con el modo test activo,
//    el correo se descartaría en silencio. Si firma quien registra, el token vuelve en la
//    respuesta y la pantalla sigue sola; si firma otra persona, el enlace queda creado y
//    lo envía el equipo.

export interface ConveniPreparat {
  id: string;
  tipo: string;
  estado: string;
  /** Solo cuando firma quien registra, y en la misma respuesta HTTP. */
  token: string | null;
  /** A quién apunta el enlace, para poder decirlo en pantalla. */
  destinatari: string | null;
  /** `true` = el enlace existe pero todavía no se ha enviado a nadie. */
  pendent_enviament: boolean;
}

export async function prepararConveni(
  supabase: Cliente,
  d: Dades,
  rol: Rol,
  fitxaId: string,
): Promise<ConveniPreparat | null> {
  try {
    const tipoOrg = rol === "productor" ? "productor" : "entidad";
    const tipo = rol === "productor" ? "don_gen" : "don_rec";

    const { data: conv, error: errPrep } = await supabase.rpc("preparar_convenio", {
      p_tipo_org: tipoOrg,
      p_org: fitxaId,
      p_tipo: tipo,
      p_idioma: null,
      p_roles_com: null,
    });
    if (errPrep || !conv) {
      // El caso esperable es `22023`: todavía no hay plantilla vigente de ese modelo.
      console.warn("[registro] preparar_convenio:", errPrep?.code, errPrep?.message);
      return null;
    }
    const fila = conv as { id: string; tipo: string; estado: string };

    // Quién firma. Sin ninguno de los dos, el borrador se queda como está y el equipo
    // decide a quién se lo manda: es una organización más de la campaña.
    const destinatari = d.firmarAra ? d.email : d.emailSignant;
    if (!destinatari) {
      return {
        id: fila.id,
        tipo: fila.tipo,
        estado: fila.estado,
        token: null,
        destinatari: null,
        pendent_enviament: false,
      };
    }

    const { data: env, error: errEnv } = await supabase.rpc("enviar_convenio", {
      p_id: fila.id,
      p_email: destinatari,
    });
    if (errEnv || !env) {
      console.warn("[registro] enviar_convenio:", errEnv?.code, errEnv?.message);
      return {
        id: fila.id,
        tipo: fila.tipo,
        estado: fila.estado,
        token: null,
        destinatari: null,
        pendent_enviament: false,
      };
    }
    const salida = env as { enllac?: { token?: string; destinatari?: string } };

    return {
      id: fila.id,
      tipo: fila.tipo,
      estado: "pendent_firma",
      // El token SOLO si firma quien está delante. Devolverlo cuando firma otra persona
      // sería poner una credencial al portador en manos de quien no la tiene que usar.
      token: d.firmarAra ? (salida.enllac?.token ?? null) : null,
      destinatari: salida.enllac?.destinatari ?? destinatari,
      pendent_enviament: !d.firmarAra,
    };
  } catch (e) {
    console.warn("[registro] conveni no preparat:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
