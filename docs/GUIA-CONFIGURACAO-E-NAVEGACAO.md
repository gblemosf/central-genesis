# Configuração e navegação da Central Gênesis

Revisão de 1º de outubro de 2026. Este guia acompanha a organização implementada nesta versão. As verificações de produção são uma fotografia desta data, não uma garantia de monitoramento contínuo.

## Problemas mapeados e ajustes

| Problema observado | Consequência | Ajuste aplicado |
|---|---|---|
| Relatórios, conexões, simulação e diagnóstico no mesmo nível | Não havia sequência clara para começar | Menu dividido em Acompanhar, Preparar a operação e Ferramentas |
| Sete opções em “Fontes e ajustes” | Custos e planejamento difíceis de encontrar | Financeiro próprio; configuração reúne vínculos e carga alternativa |
| “Resultados” e “Custos e saldo” dentro de Vendas | Receita confundida com lucro operacional | Receita das vendas e Custos e saldo explicados no Financeiro |
| Despesas, contrato, histórico de referência e orçamento no mesmo formulário | Muito preenchimento para uma tarefa simples | Cadastrar custos separado de Configurar projeções, preservando valores salvos |
| Avisos encaminhavam para CSV apesar das integrações | Indução ao abastecimento manual | Atalhos para produtos, histórico Hotmart, sincronização ou consulta conforme a evidência |
| Clique na área ativa voltava à primeira opção | Perda da seção em uso | Mantém a seção ativa e lembra a última visitada enquanto o projeto permanece aberto |
| Variáveis presentes apresentadas como integração funcionando | Cadastro verde escondia ausência de dados | Disponibilidade, cadastro, validação e chegada de dados distintos |
| Migrations incompletas e textos com caminhos antigos | Instruções divergentes da aplicação | Catálogo técnico compartilhado e caminhos atualizados |
| Nenhum roteiro completo | Dependência de instruções externas | Passo a passo com requisitos, evidências, projeto selecionável e atalhos |

## Como navegar

No menu principal:

- **Acompanhar → Visão geral:** comparar projetos ativos no período escolhido.
- **Acompanhar → Projetos:** escolher a operação e abrir seus painéis.
- **Preparar a operação → Passo a passo:** consultar a ordem de configuração e abrir a tarefa para o projeto escolhido.
- **Preparar a operação → Conexões:** cadastrar e validar contas. Uma conexão pode atender vários projetos.
- **Ferramentas → Simulador:** explorar hipóteses de funil.
- **Ferramentas → Diagnóstico técnico:** consultar variáveis, estruturas, migrations e publicação.

Dentro do projeto:

| Área | Opções | Finalidade |
|---|---|---|
| Resumo | Visão do projeto | Indicadores escolhidos para a rotina |
| Vendas | Compras, Recuperação, Importar histórico Hotmart | Transações, tentativas e carga histórica |
| Divulgação | Origens e UTMs, Tráfego diário | Atribuição e investimento |
| Público | Contatos, Respostas dos formulários | Pessoas identificadas e respostas |
| Financeiro | Receita das vendas, Custos e saldo, Cadastrar custos, Projeções, Configurar projeções | Receita, despesas e cenários futuros separados |
| Configurar | Conexões e metas, Produtos e funil, Conectar formulários, Importar CSV | Vínculos e carga alternativa |

Os endereços antigos com `view` continuam funcionando, inclusive `assumptions`, `history` e `results`. Datas e produtos permanecem no endereço quando se troca de tela. Na tela de custos, a despesa pertence ao projeto inteiro; esconder o seletor de produtos não altera a seleção salva para as demais análises.

## Tudo que precisa ser configurado

### 1. Sistema e publicação

- Na hospedagem: URL e chave pública Supabase, chave privada do servidor e modo de demonstração desativado. `GENESIS_BOOTSTRAP_EMAILS` serve para a primeira organização autorizada.
- No banco: migrations dos módulos utilizados, permissões, RLS e Vault. Esta reorganização da interface não exige migration adicional.
- No Supabase: funções `hubla-webhook`, `fetch-meta-data` e `payt-webhook` conforme as fontes utilizadas. Hotmart recebe eventos pela rota da aplicação.
- Para publicação automática do Supabase: `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_PASSWORD` nos segredos do repositório. Sem ambos, o fluxo pula banco e funções. O deploy da Vercel publica somente a aplicação.
- Para a equipe: usuários e papéis de acesso à organização. Operações administrativas exigem owner ou admin; esta reorganização não amplia permissões.

### 2. Plataformas de venda

| Plataforma | Cadastro e recebimento | Histórico anterior |
|---|---|---|
| Hotmart | Client ID, Client Secret, Basic Token e HOTTOK; validar conexão, sincronizar catálogo, configurar eventos e mapear produtos | API por produto e período; depende do agendador para continuar em segundo plano |
| Hubla | Token, endpoint geral, seleção de eventos e IDs de produtos vinculados | Sem importador histórico por API implementado; carga histórica requer fonte e formato próprios |
| Payt | Endereço protegido gerado pelo sistema, postback PayT V1, evento real, contrato validado e produtos vinculados | Sem API histórica implementada; relatório exportado exige importador de transações validado |
| Eduzz e Kiwify | Cadastro e catálogo existentes | Recebimento de vendas e histórico ainda não implementados nesta aplicação |

Confira uma compra real e uma alteração de estado antes de substituir os fluxos existentes. Não desative o n8n apenas porque uma conexão está cadastrada. Aprovação, conclusão e reenvio do mesmo pedido não devem duplicar a venda.

### 3. Projetos e produtos

Criar projeto, associar produtos às etapas, escolher a conta Meta correta e ativar o projeto quando ele deve entrar no consolidado. Nome, metas e orçamento são decisões da operação. Produtos não mapeados impedem a distribuição correta dos eventos. A conexão pertence à organização; produto e conta de anúncios precisam de vínculo no projeto.

### 4. Meta

Token do usuário do sistema autorizado às contas necessárias, validação da conexão, descoberta das contas, vínculo ao projeto e primeira sincronização. Para continuar automaticamente, conferir o job `genesis-meta-sync`, destino de produção e token dedicado. Ativação: `scripts/activate-meta-sync.sql`.

A Meta fornece tráfego e investimento; receita vem do gateway. Gastos da conta não podem ser distribuídos entre produtos por suposição.

### 5. Google Forms e Sheets

Habilitar Forms API e Sheets API no Google Cloud, configurar consentimento e criar cliente OAuth web. Na hospedagem: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. O retorno deve coincidir com o domínio publicado e `/api/connections/google/callback`.

Autorizar a conta em Conexões, compartilhar os arquivos quando necessário, vincular cada formulário ao projeto e sincronizar. A permissão da planilha é independente da permissão do formulário. Conferir o job `genesis-google-forms-sync`, destino e token dedicado no Vault. Instruções: `docs/PROJECT-OPERATIONS.md`.

As perguntas definem as colunas de respostas. A opção de planilha vinculada consulta abas e valores formatados, inclusive colunas manuais e fórmulas; não transforma uma planilha de vendas em transações automaticamente. OAuth em modo de teste pode exigir reconexão periódica. [Documentação Google](https://developers.google.com/identity/protocols/oauth2#expiration).

### 6. Histórico, automação e atribuição

Conferir os receptores nas plataformas e os jobs no Supabase Cron. Histórico Hotmart: `scripts/activate-hotmart-history.sql`. Tokens dos jobs são dedicados no Vault; não são senha do banco ou chave pública.

Filtro de datas só consulta os registros disponíveis; não inicia importação. CSV diário recebe métricas agregadas, sem histórico de pedidos, contatos, tentativas ou UTMs. Eventos sem origem não permitem descobrir retrospectivamente a página por suposição.

### 7. Financeiro

Conferir bruto, taxa, líquido após taxas e repasse ao produtor separadamente. R$ 41,82 após taxas e R$ 19,66 de repasse podem pertencer à mesma compra; são conceitos distintos.

Despesas externas, taxa contratual sobre mídia, participação, metas e orçamento futuro permanecem manuais. Custos são totais salvos no projeto: não há rateio automático por período ou recorrência mensal. A tabela `project_costs` existe, mas o front-end ainda usa totais de configuração, sem cadastro de despesas por competência integrado aos painéis.

## Situação confirmada em produção

Consulta de leitura em `hrcxlljvoemiaqhkihqp`, em 01/10/2026 às 16h50 de Brasília. Não foram alterados registros, credenciais, vínculos ou jobs.

- Estruturas consultadas de projetos, vendas, recuperação, histórico Hotmart, tráfego, formulários e métricas responderam. Isso não verifica as funções nem o recebimento completo de dados.
- Há duas conexões Hubla, uma Hotmart, uma Meta e uma Google não revogadas e com estado conectado. Esse estado não é teste atual dos tokens externos.
- A tabela de formulários retornou **zero formulários vinculados**. A conta Google autorizada, sozinha, não alimenta respostas dos projetos.
- Há dois projetos não excluídos: um ativo e um em revisão. O segundo não entra no consolidado dos ativos.
- `payt_webhook_receipts` respondeu 404/PGRST205; `payt-webhook` respondeu 404. A publicação Payt no Supabase está pendente.
- Funções Hubla e Meta responderam 405 ao GET, compatível com receptores POST. Não foi enviado evento ou comando de sincronização nesta consulta.
- Os doze registros recentes de sincronização consultados trouxeram catálogo Hotmart em 12/09 e Meta manual em 13/08 e 03/08, sem execução automática Meta concluída. É necessário conferir o agendador; isso não prova, sozinho, que o Cron está desligado.
- A verificação anterior do fluxo de publicação Supabase identificou ausência dos dois segredos do repositório. Configurar o acesso correto para publicar as migrations e funções pendentes.

O Passo a passo recalcula evidências ao abrir, respeitando sessão e organização. Não consulta os segredos do Vault ou o estado do Cron. Falha de consulta é informação não verificada, não cadastro inexistente. Módulos adicionais Payt/Google indisponíveis não tornam indisponível a base principal.

## Pendências prioritárias

1. Publicar Payt no Supabase e validar evento real antes do processamento financeiro.
2. Vincular formulários aos projetos, conferir autorização e primeira importação.
3. Conferir jobs Meta, Forms e histórico Hotmart, destino e execução recente.
4. Revisar produtos, etapas e conta de anúncios, especialmente do projeto em revisão.
5. Comparar transações e valores com as plataformas antes de dispensar os fluxos antigos.
6. Para despesas mensais e períodos arbitrários precisos, implementar lançamentos por data/competência e recorrência. A reorganização da tela não resolve essa modelagem.

Complementos: `docs/PROJECT-OPERATIONS.md`, `docs/USABILIDADE-PAINEIS.md`, seção Payt do `README.md` e [postbacks Payt](https://help.payt.com.br/article/155-postback).
