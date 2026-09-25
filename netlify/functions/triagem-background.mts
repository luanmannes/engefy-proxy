// Triagem por IA de cards do Pipefy (Background Function: responde 202 na hora
// e roda por até 15 min). Chamada pelo webhook do Pipefy (card.create /
// card.move) e pela varredura agendada (lista de cards, processados em
// sequência para reaproveitar o cache do prompt).
//
//   POST /.netlify/functions/triagem-background
//   header x-triagem-secret: <TRIAGEM_WEBHOOK_SECRET>   (ou ?secret=, se o Pipefy não permitir header)
//   body: webhook do Pipefy  |  { "cardIds": ["123", "456"] }
import type { Context } from '@netlify/functions'
import { timingSafeEqual } from 'node:crypto'
import { triarCard } from '../lib/triagem/index'

const MAX_CARDS_POR_EXECUCAO = 4 // ~3 min cada, dentro dos 15 min

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST' || !autorizado(req)) {
    console.warn('[triagem] chamada recusada (método ou segredo)')
    return
  }

  const body = await req.json().catch(() => ({}))
  const ids: string[] = body?.data?.card?.id
    ? [String(body.data.card.id)]
    : Array.isArray(body?.cardIds)
      ? body.cardIds.map(String).slice(0, MAX_CARDS_POR_EXECUCAO)
      : []
  if (!ids.length) {
    console.warn('[triagem] nenhum card no corpo')
    return
  }

  if (body?.data?.action === 'card.move') {
    const destino = body.data.to
    const fase = process.env.PIPEFY_TRIAGEM_PHASE_ID
    const entrouNaTriagem = fase ? String(destino?.id) === fase : /triagem/i.test(destino?.name ?? '')
    if (!entrouNaTriagem) return
  }

  for (const cardId of ids) {
    try {
      const r = await triarCard(cardId)
      console.log('[triagem]', cardId, r.pulado ?? `${r.triagem?.recomendacao} (${r.triagem?.score})`)
    } catch (e) {
      console.error('[triagem] erro no card', cardId, e)
    }
  }
}

function autorizado(req: Request) {
  const esperado = process.env.TRIAGEM_WEBHOOK_SECRET
  if (!esperado) return false
  const recebido = req.headers.get('x-triagem-secret') ?? new URL(req.url).searchParams.get('secret') ?? ''
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}
