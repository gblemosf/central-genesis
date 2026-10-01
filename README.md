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
- Login e criacao de conta com Supabase Auth e autorizacao de bootstrap por e-mail
- Projetos independentes por expert
- Assistente de criacao de projeto
- Multiplas conexoes Meta, incluindo mais de um Business Manager
- Credenciais de plataformas armazenadas no Vault; endereços protegidos de recebimento Payt disponíveis somente para administradores
- Descoberta de contas de anuncios atribuidas ao System User
- Sincronizacao de Meta Insights por projeto
- Webhook Hotmart autenticado por `X-HOTMART-HOTTOK`
- Gateway Payt com endpoint protegido, caixa de eventos, conferência e reprocessamento de pendências
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

Para explorar somente a interface, deixe URL e chave publica do Supabase vazias e
defina `NEXT_PUBLIC_DEMO_MODE=true` em `.env.local`. A demonstracao precisa ser
ativada explicitamente, inclusive em desenvolvimento. Ela nao persiste alteracoes.

O diagnostico da estrutura, as limitacoes conhecidas e a ordem proposta para
concluir o produto estao em [docs/DIAGNOSTICO.md](docs/DIAGNOSTICO.md).

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
| `GOOGLE_CLIENT_ID` | Servidor | Client ID OAuth para autorizar Google Forms |
| `GOOGLE_CLIENT_SECRET` | Servidor | Client Secret OAuth para autorizar Google Forms |
| `GOOGLE_REDIRECT_URI` | Servidor | Callback OAuth, como `https://SEU_DOMINIO/api/connections/google/callback` |
| `NEXT_PUBLIC_DEMO_MODE` | Publica | Ativa dados demonstrativos apenas quando definido como `true` |

Nunca adicione `SUPABASE_SECRET_KEY`, tokens Meta ou credenciais de plataformas ao GitHub.
Se uma chave administrativa ja foi versionada, remove-la do arquivo nao a invalida:
substitua-a no Supabase e atualize os ambientes que a utilizam.

## Configuração Payt

A integração recebe postbacks no formato PayT V1 e distribui eventos por conexão e produto. Consulte a documentação oficial de [postbacks](https://help.payt.com.br/article/155-postback) e [UTMs e src](https://help.payt.com.br/article/75-utilizando-utms-nas-campanhas-payt).

Publicação, com uma CLI Supabase compatível com `config.toml` e acesso ao projeto correto:

1. Confira o destino e o histórico de migrations. Aplique `20261001150616_add_payt_provider.sql` antes de `20261001150854_payt_postback_receiver.sql`. A adição do enum precisa de uma transação separada.
2. Publique somente a Edge Function `payt-webhook`, com `verify_jwt = false`. A própria função exige o token de recebimento de 256 bits e confere sua conexão antes de armazenar eventos.
3. Em **Integrações**, crie a conexão **Payt**. O servidor gera o token e o armazena no Vault; nenhum token global da conta Payt é necessário para o recebimento por URL.
4. Copie o endereço protegido, cadastre-o na Payt, selecione produtos/eventos e envie **Testar URL**. O endereço contém uma credencial de entrega e deve ser usado somente nesse postback.
5. Confira os eventos em **Integrações > Payt > Conferir eventos**. Um administrador pode baixar o JSON já sem senhas, documentos, dados de cartão e Pix.

**Validação do contrato:** a documentação pública consultada não descreve os campos JSON e unidades monetárias de PayT V1. Antes da ativação financeira, confirme uma amostra real de aprovação, abandono e estorno. Configure `integration_connections.metadata.payt_payload_contract` com os caminhos e unidades verificados, seguindo `PaytContract` em `supabase/functions/payt-webhook/normalize.ts`. Esse contrato é configuração técnica do conector, não preenchimento de métricas pelo usuário.

Até essa validação, o recebimento armazena os eventos com `state = awaiting_contract`, sem produzir vendas ou valores estimados. Depois da validação, **Processar pendências** lê os eventos armazenados em lotes de até 100; eventos sem vínculo de produto permanecem disponíveis para processamento após o mapeamento. Eventos futuros são processados na chegada. Mudanças de formato também ficam para revisão. Configure a identificação de testes da plataforma no contrato para mantê-los fora dos resultados.

O processamento distingue bruto, taxa da plataforma, líquido após taxas e repasse informado pela Payt. Valores ausentes permanecem desconhecidos. Há uma compra e um estorno por transação, preservação de valores/UTMs já recebidos, contatos por projeto e recuperação de pagamentos com o mesmo identificador da transação. Reembolsos parciais, pedidos com vários itens e eventos de assinatura exigem confirmação do respectivo contrato e ficam fora de regras presumidas de faturamento.

Uma API pública de consulta/histórico ainda não foi confirmada. O histórico anterior ao início dos postbacks exige uma carga inicial por relatório exportado, com seu formato validado.

Testes de transporte/contrato: `npm test -- supabase/functions/payt-webhook`. Testes de banco com rollback: `supabase/tests/payt.test.sql`.

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

## Configuracao Google Forms

1. Crie um OAuth Client no Google Cloud Console.
2. Ative a Google Forms API no mesmo projeto Google.
3. Adicione `GOOGLE_REDIRECT_URI` aos redirect URIs autorizados.
4. Defina `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no ambiente do servidor.
5. Use Integracoes para autorizar a conta Google e depois vincule formularios dentro de cada projeto.

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
6. Adicione `https://SEU_DOMINIO/login` aos Redirect URLs do Supabase Auth.

O framework e o comando de build sao detectados automaticamente pela Vercel.
