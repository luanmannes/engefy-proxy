// Dados da triagem no Supabase: critérios (texto editável), histórico de
// decisões e registro de cada triagem. Nada disso fica no Git (repo público).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface Oportunidade {
  data: string | null
  oportunidade: string
  cliente_marca: string | null
  grupo: string | null
  nicho: string | null
  tipo_obra: string | null
  local: string | null
  area_m2: number | null
  valor_estimado: string | null
  prazo: string | null
  origem: string | null
  intermediario: string | null
  decisao: string | null
  resultado: string | null
  motivos: string[] | null
}

let _db: SupabaseClient | undefined
export function db(): SupabaseClient {
  if (_db) return _db
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados')
  _db = createClient(url, key, { auth: { persistSession: false } })
  return _db
}

/** Critérios da Engefy (system prompt), editáveis na tabela triagem_config. */
export async function carregarCriterios(): Promise<string> {
  const { data, error } = await db().from('triagem_config').select('valor').eq('chave', 'criterios').maybeSingle()
  if (error) throw new Error(`Falha ao ler critérios: ${error.message}`)
  if (!data?.valor) throw new Error('Critérios não encontrados: rode o seed da triagem no Supabase (triagem_config.criterios)')
  return data.valor as string
}

export async function carregarHistorico(): Promise<Oportunidade[]> {
  const rows: Oportunidade[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from('oportunidades_historico')
      .select('data, oportunidade, cliente_marca, grupo, nicho, tipo_obra, local, area_m2, valor_estimado, prazo, origem, intermediario, decisao, resultado, motivos')
      .order('data', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Falha ao ler histórico: ${error.message}`)
    rows.push(...((data ?? []) as Oportunidade[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

/** Uma linha por oportunidade — vai inteiro no prompt (em cache). */
export function formatarHistorico(rows: Oportunidade[]): string {
  return rows
    .map((o) => {
      const partes = [
        o.data,
        o.oportunidade,
        o.grupo && `grupo ${o.grupo}`,
        o.nicho,
        o.tipo_obra,
        o.local,
        o.area_m2 && `${o.area_m2} m²`,
        o.valor_estimado,
        o.prazo && `prazo ${o.prazo}`,
        o.origem,
        o.intermediario && `via ${o.intermediario}`,
      ].filter(Boolean)
      const resultado = o.resultado && o.resultado !== 'desconhecido' ? ` (${o.resultado})` : ''
      return `- [${(o.decisao ?? 'indefinido').toUpperCase()}${resultado}] ${partes.join(' | ')} → ${(o.motivos ?? []).join('; ')}`
    })
    .join('\n')
}

/** Oportunidades anteriores que citam a mesma marca, grupo, arquiteto ou shopping. */
export function buscarRelacionadas(rows: Oportunidade[], termos: (string | null | undefined)[]): Oportunidade[] {
  const chaves = termos
    .filter((t): t is string => !!t && t.trim().length >= 3)
    .map((t) => t.toLowerCase().trim())
  if (!chaves.length) return []
  return rows.filter((o) => {
    const alvo = [o.oportunidade, o.cliente_marca, o.grupo, o.local, o.intermediario].join(' ').toLowerCase()
    return chaves.some((c) => alvo.includes(c))
  })
}

export async function registrarTriagem(registro: Record<string, unknown>) {
  const { error } = await db().from('triagens_ia').insert(registro)
  if (error) console.error('[triagem] falha ao registrar no Supabase:', error.message)
}
