# Engefy Proxy - Deploy no Netlify

## Estrutura do Projeto
```
engefy-proxy/
├── index.html                          ← Página de descoberta (scan APIs)
├── netlify.toml                        ← Configuração do Netlify
├── package.json                        ← Metadados
└── netlify/
    └── functions/
        ├── sienge-proxy.js             ← Proxy serverless para Sienge
        ├── saving-cache.js             ← Cache do dashboard (Reunião Saving)
        ├── dashboard-cache.mts         ← Snapshot do dashboard para a triagem IA
        ├── triagem-background.mts      ← Triagem de oportunidades por IA (webhook Pipefy)
        └── triagem-varredura.mts       ← Varredura agendada da fase Triagem
```

Triagem por IA: ver [TRIAGEM.md](TRIAGEM.md).

## Como fazer deploy

### Opção 1: Via GitHub (recomendado)
1. Crie um repositório no GitHub
2. Suba todos os arquivos desta pasta
3. No Netlify, vá em "Sites" → "Import an existing project"
4. Selecione o repositório
5. Deploy automático!

### Opção 2: Deploy manual (arrasta e solta)
1. Vá em https://app.netlify.com/drop
2. Arraste a pasta `engefy-proxy` inteira para o Netlify
3. Pronto!

⚠️ **IMPORTANTE**: O deploy por drag-and-drop pode NÃO incluir as functions.
   Prefira o deploy via GitHub ou Netlify CLI.

### Opção 3: Netlify CLI
```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod
```

## Após o deploy
1. Acesse a URL do site (ex: https://lucent-bavarois-3560ef.netlify.app/)
2. Clique em "Escanear Pipefy" para listar todos os pipes
3. Clique em "Escanear Sienge" para testar os endpoints via proxy
4. Copie o relatório e cole na conversa com o Claude

## Teste do proxy
Acesse no navegador:
```
https://SEU-SITE.netlify.app/.netlify/functions/sienge-proxy?endpoint=/building-projects&limit=1
```
Se retornar JSON do Sienge, está funcionando!

## Segredos (nunca no código: este repositório é público)

Todas as credenciais ficam em **Netlify → Site configuration → Environment variables**
(marcar como *secret*; escopo *Functions*):

| Variável | Uso |
|---|---|
| `SIENGE_USER`, `SIENGE_PASS` | usuário de API do Sienge (`sienge-proxy`) |
| `SIENGE_PROXY_ALLOW_WRITE` | `1` só se algum sistema precisar de POST/PUT/DELETE no Sienge (padrão: somente leitura) |
| `PIPEFY_API_TOKEN` | token do Pipefy (`pipefy-proxy` e triagem IA) |
| `PROXY_ACCESS_KEY` | chave que a página de descoberta pede para usar o `pipefy-proxy` |
| demais da triagem | ver [TRIAGEM.md](TRIAGEM.md) |

Depois de alterar uma variável, faça um novo deploy para as functions lerem o valor.
