// Enmascarar datos personales antes de escribirlos en un log (07-10-2026).
//
// Los logs de las Edge Functions los lee cualquiera con acceso al proyecto y se guardan
// fuera de la base, sin RLS. Un correo o un teléfono completos ahí son un dato personal
// replicado donde nadie lo gobierna. Lo que se conserva es lo justo para diagnosticar:
// el DOMINIO del correo (¿es de prueba?, ¿es del equipo?) y las ÚLTIMAS 4 cifras del
// teléfono (¿es el número que espero?).
//
// Puro y sin red: se prueba desde Vitest. ⚠️ No se usa en el webhook de WhatsApp, cuyo
// registro de entrantes es decisión documentada aparte.

/** `persona@espigoladors.com` → `···@espigoladors.com`. Sin `@`, solo `···`. */
export function enmascararEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.lastIndexOf("@");
  return at < 0 ? "···" : `···${email.slice(at).toLowerCase()}`;
}

/** `34676452492` → `···2492`. Con menos de 4 cifras, solo `···`. */
export function enmascararTelefono(telefono: string | null | undefined): string {
  if (!telefono) return "—";
  const cifras = telefono.replace(/\D/g, "");
  return cifras.length < 4 ? "···" : `···${cifras.slice(-4)}`;
}
