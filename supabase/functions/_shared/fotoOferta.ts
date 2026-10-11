// La foto principal de una oferta, como URL firmada que puede abrir quien la recibe (fase 8
// de la revisión del 08-10-2026: «la foto del producte també per WhatsApp i correu»).
//
// El bucket `fotos-ofertes` es privado: la URL se firma aquí, con `service_role`, solo para
// la oferta que se está enviando, y caduca (24 h en WhatsApp, 7 días en un correo). Sin
// foto propia devuelve null: el icono del producto es un SVG, que WhatsApp no pinta.

import type { ClienteSupabase } from "./cliente.ts";
import { urlPublica } from "./url-publica.ts";

export async function urlFotoOferta(
  supabase: ClienteSupabase,
  excedenteId: unknown,
  segons: number,
): Promise<string | null> {
  if (typeof excedenteId !== "string" || !/^[0-9a-f-]{36}$/i.test(excedenteId)) return null;
  const { data } = await supabase.from("excedentes").select("fotos").eq("id", excedenteId).maybeSingle();
  const ruta = ((data as { fotos: string[] | null } | null)?.fotos ?? [])[0];
  if (!ruta) return null;
  const { data: firma, error } = await supabase.storage.from("fotos-ofertes").createSignedUrl(ruta, segons);
  if (error || !firma?.signedUrl) return null;
  return urlPublica(firma.signedUrl, Deno.env.get("URL_PUBLICA_STORAGE"));
}
