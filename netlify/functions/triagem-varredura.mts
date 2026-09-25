// Varredura agendada: acha cards na fase Triagem ainda sem "Triagem pela IA" e
// manda um lote para a background function (rede de segurança do webhook).
// Cards em andamento, em espera após falha ou já desistidos ficam de fora.
import type { Config, Context } from '@netlify/functions'
import { getCard, listPhaseCards } from '../lib/triagem/pipefy'
import { cardBloqueado, resolverCampoIa } from '../lib/triagem/index'

const MAX_POR_RODADA = 4

export default async (_req: Request, context: Context) => {
  const fase = process.env.PIPEFY_TRIAGEM_PHASE_ID
  const segredo = process.env.TRIAGEM_WEBHOOK_SECRET
  if (!fase || !segredo || !process.env.PIPEFY_API_TOKEN || !process.env.ANTHROPIC_API_KEY) {
    console.log('[varredura] triagem não configurada; nada a fazer')
    return
  }

  const cards = await listPhaseCards(fase)
  if (!cards.length) return
  const campoIaId = await resolverCampoIa(await getCard(cards[0].id))

  const lote: string[] = []
  for (const c of cards) {
    if (lote.length >= MAX_POR_RODADA) break
    if (c.preenchidos.includes(campoIaId) || (await cardBloqueado(c.id))) continue
    lote.push(c.id)
  }
  if (!lote.length) return

  const base = process.env.URL || context.site.url
  const res = await fetch(`${base}/.netlify/functions/triagem-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-triagem-secret': segredo },
    body: JSON.stringify({ cardIds: lote }),
  })
  console.log(`[varredura] ${cards.length} na Triagem, lote ${lote.join(', ')} → HTTP ${res.status}`)
}

export const config: Config = {
  schedule: '*/15 11-23 * * 1-5', // 08h-20h (Brasília), dias úteis
}
