// Textos que el panel compone para copiar y pegar en el grupo de WhatsApp.
//
// ⚠️ AQUÍ YA NO HAY ALBARÁN. `textoAlbaran()` vivía en este fichero desde el principio: una
// plantilla con marcadores, sin número de serie, con la advertencia «pendent del format
// oficial» impresa dentro y con el nombre del productor siempre en blanco (deuda 40). Desde
// la fase 3 el albarán es una fila numerada de `albaranes` con su PDF generado por el
// servidor, así que se ha retirado — con ella se cierran el checkpoint §12.4 y la deuda 40.
// Lo que queda es el aviso de WhatsApp, que no es un documento y sigue siendo texto.
// Reproducen el formato que el equipo usa hoy a mano, emojis incluidos.
//
// El de "OFERTA DISPONIBLE" no está aquí: lo genera el intake al crear el
// excedente (supabase/functions/_shared/oferta.ts) y se guarda en
// `excedentes.texto_oferta`, así que el panel solo lo lee.

export function textoRecollidaConfirmada(campos: {
  entitat: string
  dataHora: string
  kgRecollits: string
  kgFalten: string
  comentaris: string
}): string {
  return [
    '🚚 *RECOLLIDA CONFIRMADA*',
    '',
    `🏛️ SDA / ENTITAT: ${campos.entitat}`,
    `📅 DATA i HORA: ${campos.dataHora}`,
    `⚖️ KG RECOLLITS: ${campos.kgRecollits}`,
    `🔴 KG FALTEN RECOLLIR: ${campos.kgFalten}`,
    `👥 Comentaris: ${campos.comentaris}`,
  ].join('\n')
}
