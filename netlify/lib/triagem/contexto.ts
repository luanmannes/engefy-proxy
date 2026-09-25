// "Momento atual" da Engefy para a triagem: o que o dashboard executivo publicou
// no cache (capacidade de engenharia, fila de orçamentos, metas) e as diretrizes
// da semana em TRIAGEM_CONTEXTO_ATUAL.
import { getStore } from '@netlify/blobs'

export const STORE_DASHBOARD = 'dashboard-cache'
const MAX_CHARS = 8_000

/** Dados publicados pelo dashboard (não confiáveis: vão marcados como dado no prompt). */
export async function carregarContextoDashboard(): Promise<string> {
  const partes: string[] = []
  try {
    const store = getStore(STORE_DASHBOARD)
    const { blobs } = await store.list()
    for (const { key } of blobs) {
      const snap = (await store.get(key, { type: 'json' })) as { data: unknown; timestamp: number } | null
      if (!snap) continue
      const idadeH = (Date.now() - snap.timestamp) / 3_600_000
      const idade = idadeH < 1 ? `${Math.round(idadeH * 60)} min` : `${idadeH.toFixed(1)} h`
      partes.push(`Dashboard · ${key} (atualizado há ${idade}):\n${JSON.stringify(snap.data, null, 1).slice(0, MAX_CHARS)}`)
    }
  } catch (e) {
    partes.push(`Cache do dashboard indisponível (${(e as Error).message}).`)
  }
  return partes.length ? partes.join('\n\n') : 'Dashboard não publicou capacidade/fila: capacidade atual desconhecida.'
}

/** Diretrizes da semana definidas pela Engefy na variável TRIAGEM_CONTEXTO_ATUAL (confiáveis). */
export function diretrizesDaSemana(): string | undefined {
  return process.env.TRIAGEM_CONTEXTO_ATUAL?.trim() || undefined
}
