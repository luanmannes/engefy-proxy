// Proxy somente leitura para a API GraphQL do Pipefy, usado pela página de
// descoberta (index.html). O token fica no Netlify (PIPEFY_API_TOKEN), nunca no
// navegador; o acesso exige a chave PROXY_ACCESS_KEY digitada pelo usuário.
import { timingSafeEqual } from 'node:crypto'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-proxy-key',
  'Content-Type': 'application/json',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

function chaveValida(recebida: string | null) {
  const esperada = process.env.PROXY_ACCESS_KEY
  if (!esperada || !recebida) return false
  const a = Buffer.from(recebida)
  const b = Buffer.from(esperada)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!process.env.PIPEFY_API_TOKEN || !process.env.PROXY_ACCESS_KEY) return json({ error: 'not_configured' }, 503)
  if (!chaveValida(req.headers.get('x-proxy-key'))) return json({ error: 'unauthorized' }, 401)

  const { query, variables } = await req.json().catch(() => ({}))
  if (typeof query !== 'string' || query.length > 5000) return json({ error: 'invalid_query' }, 400)
  // Só leitura: nada de mutation/subscription, mesmo que venha disfarçada.
  if (/\b(mutation|subscription)\b/i.test(query)) return json({ error: 'read_only' }, 403)

  const res = await fetch('https://api.pipefy.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PIPEFY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  return new Response(await res.text(), { status: res.status, headers })
}
