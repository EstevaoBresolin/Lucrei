// Eventos do Meta Pixel (o código base e o PageView ficam em public/meta-pixel.js).
// Cada evento leva um eventID fixo para a mesma pessoa/empresa: o Meta descarta repetições com o
// mesmo ID (cadastro refeito, página recarregada) e, quando o envio pelo servidor for ligado,
// o mesmo ID evita contar o evento duas vezes.

type Fbq = (acao: 'track', evento: string, params?: Record<string, unknown>, opcoes?: { eventID: string }) => void

/** ID estável a partir de um texto (ex.: e-mail), sem expor o texto: SHA-256 em hexadecimal. */
export async function idEvento(base: string) {
  try {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base.trim().toLowerCase()))
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40)
  } catch {
    return crypto.randomUUID()
  }
}

export function rastrear(evento: 'CompleteRegistration' | 'StartTrial' | 'Subscribe', params: Record<string, unknown>, eventID: string) {
  try {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq
    if (typeof fbq !== 'function') return // bloqueador de anúncios, por exemplo: o sistema segue normal
    fbq('track', evento, params, { eventID })
  } catch {
    /* rastreamento nunca pode atrapalhar o cadastro */
  }
}
