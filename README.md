# Central de Gestao de Projetos Genesis

Aplicacao interna para onboarding de experts, configuracao de integracoes, mapeamento de produtos, simulacao de funis e acompanhamento de performance real.

## Stack

- Next.js 16 com App Router e TypeScript
- React 19 e Tailwind CSS 4
- Supabase Auth, PostgreSQL, RLS e Vault
- Recharts para visualizacoes
- Vitest para testes unitarios
- Vercel para frontend e API intermediaria

## Funcionalidades

- Dashboard consolidado de trafego, vendas, lucro, margem, ROAS, CPA e AOV
- Projetos independentes por expert
- Assistente de criacao de projeto
- Multiplas conexoes Meta, incluindo mais de um Business Manager
- Credenciais write-only, armazenadas no Vault e nunca retornadas ao frontend
- Descoberta de contas de anuncios atribuidas ao System User
- Sincronizacao de Meta Insights por projeto
- Webhook Hotmart autenticado por `X-HOTMART-HOTTOK`
- Produtos e etapas de funil normalizados, sem colunas fixas como `ob1` ou `ob2`
- Simulador em cascata ou com todas as conversoes partindo do Low Ticket
- Modo demonstracao quando o Supabase ainda nao esta configurado

Os indicadores e metas usam o mes-calendario corrente, no fuso `America/Sao_Paulo`. Nesta versao, contas Meta e vendas usadas no consolidado devem estar em BRL; fontes em outra moeda nao sao somadas silenciosamente.

## Execucao local

```bash
npm install
cp .env.example .env.local
npm run dev
```

No Windows, crie `.env.local` a partir de `.env.example` e preencha as variaveis.

## Supabase

1. Use um projeto de desenvolvimento ou uma branch antes da producao.
2. Aplique as migrations em `supabase/migrations/` na ordem dos nomes.
3. Crie o primeiro usuario em Authentication.
4. Defina `GENESIS_BOOTSTRAP_EMAILS` e entre com um dos emails permitidos. O primeiro usuario autorizado inicializa a organizacao `Genesis` como owner.
5. Adicione os demais usuarios em `organization_members` com o papel apropriado.

O projeto existente possui tabelas legadas. A migration nova cria tabelas normalizadas sem apagar nem renomear as tabelas atuais. No primeiro bootstrap, registros legados ainda sem organizacao sao atribuidos a `Genesis`; o acesso anonimo anterior e bloqueado.

## Variaveis

| Variavel | Escopo | Finalidade |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Publica | URL da API Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publica | Sessao e consultas protegidas por RLS |
| `SUPABASE_SECRET_KEY` | Servidor | Rotas administrativas e acesso ao Vault |
| `GENESIS_BOOTSTRAP_EMAILS` | Servidor | Lista separada por virgulas autorizada a criar a primeira organizacao |
| `META_GRAPH_API_VERSION` | Servidor | Versao fixada da Graph API |
| `NEXT_PUBLIC_DEMO_MODE` | Publica | Ativa dados demonstrativos apenas quando definido como `true` |

Nunca adicione `SUPABASE_SECRET_KEY`, tokens Meta ou credenciais de plataformas ao GitHub.

## Configuracao Meta

Para cada BM da Genesis:

1. Crie ou identifique um System User dedicado a relatorios.
2. Atribua o App e as contas compartilhadas ao System User.
3. Use apenas as permissoes necessarias, normalmente `ads_read` e tarefa `ANALYZE`.
4. Gere o token e cadastre-o uma unica vez em Integracoes.
5. Use `POST /api/connections/:id/accounts` para descobrir as contas atribuidas.
6. Associe cada conta ao projeto correto no onboarding ou nas configuracoes do projeto.
7. Use a acao `Sincronizar Meta` no projeto para reconciliar o periodo solicitado.

Um token representa somente o BM do seu System User. Se os ativos estiverem divididos entre dois BMs, cadastre duas conexoes.

## Seguranca

- Rotas administrativas exigem usuario `owner` ou `admin`.
- Todas as tabelas novas possuem RLS.
- `integration_secrets` nao tem policy para usuarios comuns.
- Somente a chave de servidor executa as funcoes do Vault.
- O segredo e descriptografado apenas no runtime que chama o provedor.
- O webhook Hotmart compara o HOTTOK em tempo constante e persiste cada venda atomicamente com idempotencia por transacao.
- Produtos recebidos sem mapeamento ficam em quarentena ate serem associados a uma etapa do funil.
- O payload persistido e minimizado para evitar armazenamento desnecessario de PII.

## Validacao

```bash
npm run lint
npm run typecheck
npm test
npm run build
supabase db reset --local --no-seed
supabase db lint --local --level warning
supabase test db supabase/tests/database.test.sql
```

## GitHub

```bash
git add .
git commit -m "Create Genesis project management center"
git remote add origin https://github.com/ORGANIZACAO/central-gestao-genesis.git
git push -u origin main
```

## Vercel

1. Importe o repositorio do GitHub na Vercel.
2. Cadastre as variaveis de ambiente da tabela acima.
3. Mantenha `SUPABASE_SECRET_KEY` somente nos ambientes Server/Production apropriados.
4. Execute o deploy.
5. Configure a URL publicada nos webhooks de cada plataforma.

O framework e o comando de build sao detectados automaticamente pela Vercel.
