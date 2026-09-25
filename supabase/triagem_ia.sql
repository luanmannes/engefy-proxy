-- Triagem de oportunidades por IA (pipe "A.1. COM: Oportunidades externas")
-- Rodar no SQL Editor do Supabase. Depois rodar o seed (fora do Git: tem dados de clientes).

-- Histórico de decisões (orçar / não orçar) usado como referência pela IA.
-- Carga inicial: arquivo de seed entregue fora do Git (extraído do grupo
-- "Comercial <> Orçamentos"). Novas decisões podem ser inseridas aqui.
create table if not exists oportunidades_historico (
  id bigint generated always as identity primary key,
  data date,
  oportunidade text not null,
  cliente_marca text,
  grupo text,
  nicho text,
  tipo_obra text,
  local text,
  area_m2 numeric,
  valor_estimado text,
  prazo text,
  origem text,
  intermediario text,
  decisao text not null default 'indefinido' check (decisao in ('orcar', 'nao_orcar', 'orcar_baixa_prioridade', 'aguardando_info', 'indefinido')),
  resultado text check (resultado in ('ganhou', 'perdeu', 'desconhecido')),
  motivos text[] default '{}',
  sinais_positivos text[] default '{}',
  sinais_negativos text[] default '{}',
  citacao text,
  fonte text default 'whatsapp',
  pipefy_card_id text,
  created_at timestamptz default now()
);

create index if not exists idx_oport_hist_marca on oportunidades_historico (lower(cliente_marca));
create index if not exists idx_oport_hist_grupo on oportunidades_historico (lower(grupo));
create index if not exists idx_oport_hist_nicho on oportunidades_historico (nicho);

-- Cada execução da triagem (auditoria + comparação IA x decisão real).
create table if not exists triagens_ia (
  id bigint generated always as identity primary key,
  pipefy_card_id text not null,
  card_title text,
  recomendacao text not null,
  score integer,
  confianca text,
  resultado jsonb not null,
  texto_campo text not null,
  pesquisa_web text,
  contexto_atual text,
  modelo text,
  tokens_entrada integer,
  tokens_cache_criacao integer,
  tokens_cache_leitura integer,
  tokens_saida integer,
  pesquisa_tokens_entrada integer,
  pesquisa_tokens_saida integer,
  buscas_web integer,
  decisao_final text,
  created_at timestamptz default now()
);

create index if not exists idx_triagens_ia_card on triagens_ia (pipefy_card_id);

-- Critérios da triagem (system prompt da IA), editáveis sem deploy.
-- chave 'criterios' = texto com as regras da Engefy.
create table if not exists triagem_config (
  chave text primary key,
  valor text not null,
  updated_at timestamptz default now()
);

-- Só o service role (servidor) lê/escreve. Nenhuma policy para anon/authenticated.
alter table oportunidades_historico enable row level security;
alter table triagens_ia enable row level security;
alter table triagem_config enable row level security;
