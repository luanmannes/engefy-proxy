// Snapshot do dashboard executivo para a triagem por IA (capacidade de
// engenharia, fila de orçamentos, metas). Só escrita: a triagem lê direto do
// Netlify Blobs, então não há GET público.
//
//   POST /.netlify/functions/dashboard-cache
//   header x-dashboard-key: <DASHBOARD_CACHE_KEY>
//   body { "secao": "engenharia" | "orcamentos" | "comercial", "data": { ... } }
import { getStore } from '@netlify/blobs'
import { STORE_DASHBOARD } from '../lib/triagem/contexto'

const ORIGEM = process.env.DASHBOARD_ORIGIN || 'https://dashboard.construtoraengefy.com.br'
const headers = {
  'Access-Control-Allow-Origin': ORIGEM,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-dashboard-key',
  'Content-Type': 'application/json',
  Vary: 'Origin',
}
const SECOES = ['engenharia', 'orcamentos', 'comercial']
const MAX_BYTES = 20_000

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

/** Só números, booleanos, textos curtos e listas/objetos rasos: é dado, não texto livre. */
function dadoValido(v: unknown, prof = 0): boolean {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return true
  if (typeof v === 'string') return v.length <= 120
  if (prof >= 3) return false
  if (Array.isArray(v)) return v.length <= 50 && v.every((x) => dadoValido(x, prof + 1))
  if (typeof v === 'object') {
    const entradas = Object.entries(v as Record<string, unknown>)
    return entradas.length <= 40 && entradas.every(([k, x]) => k.length <= 60 && dadoValido(x, prof + 1))
  }
  return false
}

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405)

  const chave = process.env.DASHBOARD_CACHE_KEY
  if (!chave) return json({ ok: false, reason: 'not_configured' }, 503)
  if (req.headers.get('x-dashboard-key') !== chave) return json({ ok: false, reason: 'unauthorized' }, 401)

  try {
    const texto = await req.text()
    if (texto.length > MAX_BYTES) return json({ ok: false, reason: 'payload_too_large' }, 413)
    const body = JSON.parse(texto)
    if (!SECOES.includes(body?.secao) || !body.data || typeof body.data !== 'object' || !dadoValido(body.data)) {
      return json({ ok: false, reason: 'invalid_payload', secoes: SECOES }, 400)
    }
    await getStore(STORE_DASHBOARD).setJSON(body.secao, { data: body.data, timestamp: Date.now() })
    return json({ ok: true, secao: body.secao })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
}
