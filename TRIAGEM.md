# Triagem de oportunidades por IA — Pipe "A.1. COM: Oportunidades externas"

Quando um card entra na fase **Triagem**, a IA (Claude) lê o card, os anexos
(projetos em PDF e fotos), pesquisa a marca/cliente/shopping na web, cruza com
o histórico de decisões da Engefy e com a capacidade atual (dashboard) e escreve
no campo **"Triagem pela IA"**:

**ORÇAR / ORÇAR COM RESSALVAS / AGUARDAR INFORMAÇÕES / NÃO ORÇAR**, com score,
classificação A/B/C, regras de corte aplicadas, faixa de valor, nicho, pesquisa
da marca, histórico relacionado, pontos fortes, riscos, perguntas a fazer e
estratégia de preço. A decisão final é do time.

## Onde está cada coisa

| O quê | Onde |
|---|---|
| Código | `netlify/lib/triagem/*` (Pipefy, Claude, Supabase, contexto do dashboard) |
| Webhook / execução | `netlify/functions/triagem-background.mts` (Background Function, até 15 min) |
| Varredura agendada | `netlify/functions/triagem-varredura.mts` (a cada 15 min, 08h–20h, dias úteis) |
| Capacidade do dashboard | `netlify/functions/dashboard-cache.mts` (Netlify Blobs) |
| Tabelas | `supabase/triagem_ia.sql` |
| **Critérios** (regras, pesos, R$/m², clientes) | Supabase → `triagem_config` (chave `criterios`) — **fora do Git** |
| **Histórico** (1.011 oportunidades, set/2024–set/2026) | Supabase → `oportunidades_historico` — **fora do Git** |
| Registro de cada triagem | Supabase → `triagens_ia` |

Critérios e histórico têm nomes de clientes, valores e citações internas; como
este repositório é público, eles só existem no Supabase (carga pelo arquivo de
seed entregue à parte). Para mudar uma regra, edite o texto em `triagem_config`
— não precisa de deploy.

## Configuração

1. **Supabase** (SQL Editor): rodar `supabase/triagem_ia.sql` e depois o
   arquivo de seed confidencial (`triagem_seed.sql`).
2. **Variáveis de ambiente no Netlify** (Site settings → Environment variables):

| Variável | O que é |
|---|---|
| `ANTHROPIC_API_KEY` | chave da API do Claude (mesma conta do Géfynho) |
| `PIPEFY_API_TOKEN` | token do Pipefy com acesso ao pipe 734128 |
| `PIPEFY_TRIAGEM_PHASE_ID` | id da fase Triagem (4983414, pela URL das configurações da fase) |
| `PIPEFY_TRIAGEM_FIELD_ID` | opcional: id do campo "Triagem pela IA" (se vazio, busca pelo nome) |
| `TRIAGEM_WEBHOOK_SECRET` | segredo longo e aleatório para o webhook |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | projeto Supabase das tabelas acima |
| `TRIAGEM_CONTEXTO_ATUAL` | opcional: diretrizes da semana ("priorizar contas-chave; meta do trimestre...") |
| `TRIAGEM_MODEL` | opcional: modelo (padrão `claude-opus-5`) |
| `DASHBOARD_CACHE_KEY` | chave que o dashboard envia em `x-dashboard-key` (sem ela o `dashboard-cache` recusa tudo) |
| `DASHBOARD_ORIGIN` | opcional: origem liberada no CORS (padrão `https://dashboard.construtoraengefy.com.br`) |

3. **Webhook no Pipefy** (via API `createWebhook`), ações `card.create` e
   `card.move`, URL `https://<site-do-proxy>/.netlify/functions/triagem-background`
   e header `x-triagem-secret: <TRIAGEM_WEBHOOK_SECRET>` (campo `headers` do
   webhook). Se não der para mandar header, use `?secret=` na URL (fica nos logs).
   A varredura agendada cobre qualquer card que o webhook perder.

   **Falhas:** cada card tem no máximo 3 tentativas automáticas (espera de 1 h, 2 h
   entre elas). Depois disso o campo recebe "Triagem automática falhou…" e o card
   sai da varredura. Para refazer: apagar o campo e rodar `npm run triagem -- <id> --force`.

4. **Dashboard → capacidade**: onde o dashboard calcula a capacidade (aba
   Engenharia › Capacidade & Time), publicar o snapshot. Só aceita números,
   booleanos, textos curtos (≤ 120 caracteres) e listas/objetos rasos, até 20 KB.
   A chave fica visível no JS do navegador: se o dashboard tiver backend, publique
   de lá.

```js
fetch('https://<site-do-proxy>/.netlify/functions/dashboard-cache', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-dashboard-key': DASHBOARD_CACHE_KEY },
  body: JSON.stringify({
    secao: 'engenharia',
    data: {
      capacidade_comprometida_pct: 49,   // físico
      ocupacao_hoje_pct: 90,
      prazo_pct: 24,
      status: 'Cheia',                   // Cheia | Pouca folga | Folga
      recomendacao_orcamento: 'preço prêmio',
      coordenadores: [{ nome: 'Fulano', obras: 8, capacidade_pct: 100, comprometida_pct: 52 /*, liberacao_prevista: '2026-10-20' */ }],
    },
  }),
})
```

   Também aceita `secao: 'orcamentos'` (fila: processos em andamento,
   orçamentistas, prazos) e `secao: 'comercial'` (meta, realizado, pipeline).
   A triagem lê tudo o que estiver publicado e informa a idade do dado.

## Teste local (sem gravar no Pipefy)

```bash
npm install
cp .env.example .env   # preencher (nunca commitar)
npm run triagem -- 1234567890 --dry-run   # um card
npm run triagem -- --fase --dry-run       # todos os pendentes da fase Triagem
npm run typecheck
```

## Custo estimado

Por card: pesquisa web (até 8 buscas) + ~100k tokens de critérios e histórico
em cache (1h) + anexos. Ordem de grandeza: US$ 0,50 a 2,00 por triagem.
