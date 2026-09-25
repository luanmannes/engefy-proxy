# Segurança: credenciais e dados (obrigatório)

Este repositório é PÚBLICO. Tudo o que for commitado fica visível para qualquer pessoa, inclusive no histórico.

- Nunca escrever no código, em docs, em testes ou em commits: tokens, senhas, chaves de API, JWTs, usuários de serviço, strings de conexão (Pipefy, Sienge, Supabase, Anthropic/OpenAI, Netlify, Google etc.).
- Credenciais ficam só em variáveis de ambiente: Netlify → Site configuration → Environment variables (marcadas como secret) ou `.env` local, que está no `.gitignore`. No código, ler com `process.env.NOME`; em `.env.example`, só o nome da variável, sem valor.
- Nada de chamar APIs com credencial a partir do navegador (HTML/JS do cliente): passar por uma Netlify Function que lê a credencial do ambiente, com o mínimo de permissão (só leitura quando possível) e exigindo chave de acesso.
- Dados de clientes, valores, propostas, conversas internas e critérios comerciais também não vão para o Git: ficam no Supabase ou em arquivo fora do repositório.
- Antes de cada commit, conferir o diff procurando segredos (padrões como `eyJ...`, `Bearer `, `Basic `, `sk-`, `password`, `senha`, `token =`). Se encontrar, parar e avisar o usuário.
- Se um segredo já foi commitado: avisar o usuário na hora que é preciso revogar e gerar outro (apagar do código não basta, ele continua no histórico) e mover o valor novo para variável de ambiente.
- Ao mostrar ou registrar valores sensíveis (logs, respostas, relatórios), mascarar (`***`).
