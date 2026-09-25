// Cliente mínimo da API GraphQL do Pipefy para a triagem por IA.

const PIPEFY_URL = 'https://api.pipefy.com/graphql'

export interface PipefyField {
  field: { id: string; label: string; type: string }
  name: string
  value: string | null
  array_value: string[] | null
}

export interface PipefyCard {
  id: string
  title: string
  createdAt: string
  url: string
  current_phase: { id: string; name: string }
  pipe: { id: string; name: string }
  labels: { name: string }[]
  fields: PipefyField[]
  comments: { text: string; created_at: string; author_name: string | null }[]
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = process.env.PIPEFY_API_TOKEN
  if (!token) throw new Error('PIPEFY_API_TOKEN nao configurado')

  const res = await fetch(PIPEFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.errors) {
    throw new Error(`Pipefy ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 500)}`)
  }
  return json.data as T
}

export async function getCard(cardId: string): Promise<PipefyCard> {
  const data = await gql<{ card: PipefyCard }>(
    `query($id: ID!) {
      card(id: $id) {
        id title createdAt url
        current_phase { id name }
        pipe { id name }
        labels { name }
        fields { field { id label type } name value array_value }
        comments { text created_at author_name }
      }
    }`,
    { id: cardId }
  )
  return data.card
}

export async function updateCardField(cardId: string, fieldId: string, value: string) {
  await gql(
    `mutation($input: UpdateCardFieldInput!) {
      updateCardField(input: $input) { success }
    }`,
    { input: { card_id: cardId, field_id: fieldId, new_value: value } }
  )
}

/** Definição dos campos de uma fase (inclui campos ainda vazios). */
export async function phaseFields(phaseId: string): Promise<{ id: string; label: string; type: string }[]> {
  const data = await gql<{ phase: { fields: { id: string; label: string; type: string }[] } }>(
    `query($id: ID!) { phase(id: $id) { fields { id label type } } }`,
    { id: phaseId }
  )
  return data.phase.fields
}

/** Cards de uma fase com os ids dos campos já preenchidos (para a varredura). */
export async function listPhaseCards(phaseId: string, max = 200): Promise<{ id: string; preenchidos: string[] }[]> {
  const out: { id: string; preenchidos: string[] }[] = []
  let after: string | null = null
  while (out.length < max) {
    const data: {
      phase: {
        cards: {
          pageInfo: { hasNextPage: boolean; endCursor: string }
          edges: { node: { id: string; fields: { field: { id: string }; value: string | null }[] } }[]
        }
      }
    } = await gql(
      `query($id: ID!, $after: String) {
        phase(id: $id) {
          cards(first: 50, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges { node { id fields { field { id } value } } }
          }
        }
      }`,
      { id: phaseId, after }
    )
    for (const { node } of data.phase.cards.edges) {
      out.push({ id: node.id, preenchidos: node.fields.filter((f) => f.value?.trim()).map((f) => f.field.id) })
    }
    if (!data.phase.cards.pageInfo.hasNextPage) break
    after = data.phase.cards.pageInfo.endCursor
  }
  return out.slice(0, max)
}

/** Valor de um campo pelo id ou pelo rótulo (sem acento/caixa). */
export function fieldValue(card: PipefyCard, idOrLabel: string): string | null {
  const key = normalize(idOrLabel)
  const f = card.fields.find((f) => f.field.id === idOrLabel || normalize(f.name).startsWith(key))
  return f?.value ?? null
}

/**
 * URLs de anexos (campos do tipo attachment). Em `value` vem uma string JSON com
 * as URLs assinadas (expiram em ~15 min); `array_value` traz só caminhos
 * relativos (orgs/.../uploads/...), que não servem para baixar.
 */
export function attachmentUrls(card: PipefyCard): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = []
  for (const f of card.fields) {
    if (f.field.type !== 'attachment') continue
    let urls: unknown = []
    try {
      urls = f.value ? JSON.parse(f.value) : []
    } catch {
      urls = []
    }
    if (!Array.isArray(urls) || !urls.length) urls = f.array_value ?? []
    for (const url of urls as unknown[]) {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) out.push({ label: f.name, url })
    }
  }
  return out
}

export function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/gi, '')
    .trim()
    .toLowerCase()
}
