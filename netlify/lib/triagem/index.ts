// Orquestra a triagem de um card: Pipefy → anexos → pesquisa web → Claude → Pipefy.
import Anthropic from '@anthropic-ai/sdk'
import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { attachmentUrls, fieldValue, getCard, normalize, phaseFields, updateCardField, type PipefyCard } from './pipefy'
import { buscarRelacionadas, carregarCriterios, carregarHistorico, formatarHistorico, registrarTriagem } from './dados'
import { formatarCampo, MODELO, pesquisarCliente, triar, type Anexo, type Triagem, type Uso } from './analisar'
import { carregarContextoDashboard, diretrizesDaSemana } from './contexto'

const ROTULO_CAMPO_IA = 'triagem pela ia'
const MAX_ANEXO_BYTES = 15 * 1024 * 1024
const MAX_TOTAL_BYTES = 22 * 1024 * 1024 // request da API tem limite de 32 MB (base64 incha ~33%)
const MAX_IMAGEM_BYTES = 5 * 1024 * 1024
const MAX_IMAGENS = 8
const MAX_RELACIONADAS = 30
const LOCK_MS = 20 * 60 * 1000

/** Depois de tantas falhas o card sai da varredura e o campo recebe um aviso. */
export const MAX_TENTATIVAS = 3
const ESPERA_ENTRE_TENTATIVAS_MS = 60 * 60 * 1000

export const STORE_LOCKS = 'triagem-locks'
export const STORE_FALHAS = 'triagem-falhas'
export interface Falha {
  tentativas: number
  ultimoErro: string
  em: number
}

export interface ResultadoTriagem {
  cardId: string
  titulo: string
  pulado?: string
  triagem?: Triagem
  texto?: string
}

/** Cards que a varredura não deve disparar agora (em andamento, em espera ou desistidos). */
export async function cardBloqueado(cardId: string): Promise<boolean> {
  const lock = (await getStore({ name: STORE_LOCKS, consistency: 'strong' }).get(cardId, { type: 'json' })) as {
    em: number
  } | null
  if (lock && Date.now() - lock.em < LOCK_MS) return true
  const falha = (await getStore({ name: STORE_FALHAS, consistency: 'strong' }).get(cardId, { type: 'json' })) as Falha | null
  if (!falha) return false
  return falha.tentativas >= MAX_TENTATIVAS || Date.now() - falha.em < ESPERA_ENTRE_TENTATIVAS_MS * falha.tentativas
}

export async function triarCard(
  cardId: string,
  opts: { dryRun?: boolean; force?: boolean; semLock?: boolean } = {}
): Promise<ResultadoTriagem> {
  const card = await getCard(cardId)
  const faseTriagem = process.env.PIPEFY_TRIAGEM_PHASE_ID
  if (faseTriagem && card.current_phase.id !== faseTriagem && !opts.force) {
    return { cardId, titulo: card.title, pulado: `card está na fase "${card.current_phase.name}", não na Triagem` }
  }
  const campoIaId = await resolverCampoIa(card)

  const atual = card.fields.find((f) => f.field.id === campoIaId)?.value
  if (atual?.trim() && !opts.force) {
    return { cardId, titulo: card.title, pulado: 'campo "Triagem pela IA" já preenchido' }
  }

  // Webhook (card.create/card.move) e varredura podem disparar o mesmo card.
  const usarBlobs = !opts.dryRun && !opts.semLock
  const locks = usarBlobs ? getStore({ name: STORE_LOCKS, consistency: 'strong' }) : null
  const falhas = usarBlobs ? getStore({ name: STORE_FALHAS, consistency: 'strong' }) : null
  const dono = randomUUID()
  let falha: Falha | null = null
  if (locks && falhas) {
    const lock = (await locks.get(cardId, { type: 'json' })) as { em: number } | null
    if (lock && Date.now() - lock.em < LOCK_MS && !opts.force) {
      return { cardId, titulo: card.title, pulado: 'triagem já em andamento' }
    }
    await locks.setJSON(cardId, { em: Date.now(), dono })
    // Conta a tentativa já no início: uma execução morta no limite de 15 min não passa pelo catch.
    falha = (await falhas.get(cardId, { type: 'json' })) as Falha | null
    await falhas.setJSON(cardId, { tentativas: (falha?.tentativas ?? 0) + 1, ultimoErro: falha?.ultimoErro ?? '', em: Date.now() })
  }

  try {
    const cardTexto = descreverCard(card, campoIaId)
    // Dados de contato e comentários não vão para a pesquisa web.
    const cardSemContato = descreverCard(card, campoIaId, { semContato: true })

    const [criterios, historico] = await Promise.all([carregarCriterios(), carregarHistorico()])
    const relacionadas = buscarRelacionadas(historico, [
      fieldValue(card, 'Marcas'),
      fieldValue(card, 'Grupo'),
      fieldValue(card, 'Nome completo do cliente'),
      fieldValue(card, 'Em caso de indicacao, quem indicou'),
      fieldValue(card, 'Shopping center'),
      card.title,
    ]).slice(-MAX_RELACIONADAS)

    const [{ anexos, ignorados }, pesquisa, contextoDashboard] = await Promise.all([
      baixarAnexos(card),
      pesquisarCliente(cardSemContato).catch((e) => ({ texto: `Pesquisa web falhou: ${e.message}`, uso: null as Uso | null })),
      carregarContextoDashboard(),
    ])

    const entrada = {
      criterios,
      historico: formatarHistorico(historico),
      card: cardTexto,
      relacionadas: formatarHistorico(relacionadas),
      pesquisa: pesquisa.texto,
      anexos,
      anexosIgnorados: ignorados,
      contextoDashboard,
      diretrizes: diretrizesDaSemana(),
    }
    let resposta
    try {
      resposta = await triar(entrada)
    } catch (e) {
      // PDF corrompido/criptografado ou imagem inválida: tenta uma vez sem os anexos.
      if (!(e instanceof Anthropic.BadRequestError) || !anexos.length) throw e
      console.warn('[triagem] anexos rejeitados pela API, repetindo sem eles:', e.message)
      resposta = await triar({
        ...entrada,
        anexos: [],
        anexosIgnorados: [...ignorados, ...anexos.map((a) => `${a.nome} (rejeitado pela API: arquivo inválido)`)],
      })
    }
    const { triagem, uso } = resposta

    const texto = formatarCampo(triagem)
    if (!opts.dryRun) {
      await updateCardField(card.id, campoIaId, texto)
      await registrarTriagem({
        pipefy_card_id: card.id,
        card_title: card.title,
        recomendacao: triagem.recomendacao,
        score: Math.round(triagem.score),
        confianca: triagem.confianca,
        resultado: triagem,
        texto_campo: texto,
        pesquisa_web: pesquisa.texto,
        contexto_atual: contextoDashboard,
        modelo: MODELO,
        tokens_entrada: uso.entrada,
        tokens_cache_criacao: uso.cache_criacao,
        tokens_cache_leitura: uso.cache_leitura,
        tokens_saida: uso.saida,
        pesquisa_tokens_entrada: pesquisa.uso ? pesquisa.uso.entrada + pesquisa.uso.cache_leitura + pesquisa.uso.cache_criacao : null,
        pesquisa_tokens_saida: pesquisa.uso?.saida ?? null,
        buscas_web: pesquisa.uso?.buscas_web ?? null,
      })
    }
    await falhas?.delete(cardId)
    return { cardId, titulo: card.title, triagem, texto }
  } catch (e) {
    const erro = (e as Error).message ?? String(e)
    const tentativas = (falha?.tentativas ?? 0) + 1
    if (falhas) {
      await falhas.setJSON(cardId, { tentativas, ultimoErro: erro.slice(0, 500), em: Date.now() }).catch(() => {})
      if (tentativas >= MAX_TENTATIVAS) {
        // Tira o card da varredura e avisa o time no próprio card.
        await updateCardField(
          card.id,
          campoIaId,
          `Triagem automática falhou após ${tentativas} tentativas: ${erro.slice(0, 300)}\nFaça a triagem manual ou peça para rodar de novo.`
        ).catch(() => {})
      }
    }
    throw e
  } finally {
    if (locks) {
      const lock = (await locks.get(cardId, { type: 'json' }).catch(() => null)) as { dono?: string } | null
      if (lock?.dono === dono) await locks.delete(cardId).catch(() => {})
    }
  }
}

let campoIaCache: string | undefined
export async function resolverCampoIa(card: PipefyCard): Promise<string> {
  if (process.env.PIPEFY_TRIAGEM_FIELD_ID) return process.env.PIPEFY_TRIAGEM_FIELD_ID
  if (campoIaCache) return campoIaCache
  const preenchido = card.fields.find((f) => normalize(f.name) === ROTULO_CAMPO_IA)
  if (preenchido) return (campoIaCache = preenchido.field.id)
  // Campos vazios não vêm em card.fields; busca na definição da fase Triagem.
  const fase = process.env.PIPEFY_TRIAGEM_PHASE_ID ?? card.current_phase.id
  const campo = (await phaseFields(fase)).find((f) => normalize(f.label) === ROTULO_CAMPO_IA)
  if (!campo) throw new Error(`Campo "Triagem pela IA" não encontrado na fase ${fase}`)
  return (campoIaCache = campo.id)
}

function descreverCard(card: PipefyCard, campoIaId: string, opts: { semContato?: boolean } = {}): string {
  const linhas: (string | null)[] = [
    `Título: ${card.title}`,
    `Nº do card: ${card.id}`,
    `Criado em: ${card.createdAt}`,
    `Fase: ${card.current_phase.name}`,
    card.labels.length ? `Etiquetas: ${card.labels.map((l) => l.name).join(', ')}` : null,
  ]
  for (const f of card.fields) {
    if (f.field.id === campoIaId || !f.value) continue
    if (opts.semContato && ['phone', 'email'].includes(f.field.type)) continue
    if (f.field.type === 'attachment') {
      linhas.push(`${f.name}: arquivo(s) anexado(s)`)
      continue
    }
    linhas.push(`${f.name}: ${limparValor(f.value)}`)
  }
  if (card.comments.length && !opts.semContato) {
    linhas.push('', 'Comentários no card:')
    for (const c of card.comments) linhas.push(`- ${c.created_at} ${c.author_name ?? ''}: ${c.text}`)
  }
  return linhas.filter((l) => l !== null).join('\n')
}

function limparValor(v: string) {
  // Campos de seleção múltipla/conexão vêm como '["a","b"]'
  if (v.startsWith('[')) {
    try {
      const arr = JSON.parse(v)
      if (Array.isArray(arr)) return arr.join(', ')
    } catch {}
  }
  return v
}

async function baixarAnexos(card: PipefyCard): Promise<{ anexos: Anexo[]; ignorados: string[] }> {
  const anexos: Anexo[] = []
  const ignorados: string[] = []
  let total = 0
  let imagens = 0

  // PDFs de projeto primeiro, depois fotos, depois o resto.
  const ordem = (label: string) => (/projeto/i.test(label) ? 0 : /foto/i.test(label) ? 1 : 2)
  const urls = attachmentUrls(card).sort((a, b) => ordem(a.label) - ordem(b.label))

  for (const { label, url } of urls) {
    let nome = 'arquivo'
    try {
      nome = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? 'arquivo')
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const tamanho = Number(res.headers.get('content-length') ?? 0)
      if (tamanho > MAX_ANEXO_BYTES) {
        ignorados.push(`${nome} (grande demais: ${(tamanho / 1024 / 1024).toFixed(1)} MB)`)
        await res.body?.cancel()
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      const mediaType = tipoPorConteudo(buf)
      const ehImagem = mediaType !== null && mediaType !== 'application/pdf'

      if (!mediaType) {
        ignorados.push(`${nome} (formato não suportado)`)
      } else if (buf.length > (ehImagem ? MAX_IMAGEM_BYTES : MAX_ANEXO_BYTES) || total + buf.length > MAX_TOTAL_BYTES) {
        ignorados.push(`${nome} (grande demais: ${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
      } else if (ehImagem && imagens >= MAX_IMAGENS) {
        ignorados.push(`${nome} (limite de ${MAX_IMAGENS} fotos)`)
      } else {
        anexos.push({ label, nome, mediaType, base64: buf.toString('base64') })
        total += buf.length
        if (ehImagem) imagens++
      }
    } catch (e) {
      ignorados.push(`${nome} (falha ao baixar: ${(e as Error).message})`)
    }
  }
  return { anexos, ignorados }
}

/** Tipo real pelo conteúdo (a extensão e o content-type do S3 não são confiáveis). */
function tipoPorConteudo(buf: Buffer): Anexo['mediaType'] | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif'
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}
