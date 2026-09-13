# Operação dos projetos

Cada projeto apresenta Vendas, Origens, Recuperação, Contatos, Formulários e Resultados. As consultas exigem uma sessão administrativa e são limitadas à organização e ao projeto. Os produtos precisam estar vinculados ao projeto para suas vendas aparecerem.

## Formulários e planilha vinculada

- As colunas de respostas vêm das perguntas do Google Forms, na ordem do formulário. Cada pergunta usa seu identificador, permitindo títulos repetidos sem misturar respostas.
- Grades são expandidas em uma coluna por linha. Múltiplas escolhas, arquivos e perguntas removidas são preservados. Quando uma pergunta é renomeada, respostas já importadas conservam o título capturado originalmente.
- Se uma pergunta já estava removida antes da primeira importação, seu título antigo não pode ser recuperado pela API. O sistema preserva a resposta com o identificador da pergunta.
- A opção **Planilha vinculada** consulta todas as abas da planilha associada ao formulário. Usa a primeira linha como cabeçalho e apresenta valores formatados, incluindo colunas manuais e resultados de fórmulas. Não copia formatação visual, gráficos ou fórmulas executáveis para o banco.
- A tabela apresenta 100 respostas/linhas por página. A exportação desta tela é da página exibida. As demais respostas continuam disponíveis pela paginação; não há corte silencioso na primeira milhar de registros.

A API Forms identifica a planilha pelo campo `linkedSheetId`. Os valores são consultados com `FORMATTED_VALUE` na API Sheets. Referências: [Google Forms](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms), [Google Sheets](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get).

## Sincronização

A importação usa lotes de até 200 respostas. O próximo lote, o filtro original e o maior horário recebido são guardados no banco. O cursor definitivo avança somente ao terminar todas as páginas. Reenvios são idempotentes, e uma margem de cinco minutos permite consultar novamente a borda do último lote sem duplicar respostas.

O job `genesis-google-forms-sync` no Supabase Cron chama `POST /api/jobs/google-forms`, uma vez por minuto. Cada execução atende um formulário, alternando os formulários ativos pela última tentativa. Mais formulários aumentam o intervalo de atualização de cada um. Uma fonte com erro não impede as demais; execuções interrompidas têm sua reserva liberada após dez minutos.

O token e o destino do job ficam no Supabase Vault, em `genesis_google_forms_job_token` e `genesis_google_forms_job_url`. O servidor consulta somente esse token dedicado pela função restrita `get_google_forms_sync_token`. A chave do banco não é transmitida ao endpoint. Se for necessário rotacionar o token, basta atualizar o segredo dedicado no Vault: agendador e aplicação consultam a mesma fonte. [Agendamento de funções no Supabase](https://supabase.com/docs/guides/functions/schedule-functions).

Para ativar Google em produção:

1. Habilitar Google Forms API e Google Sheets API no projeto Google Cloud.
2. Criar o cliente OAuth web do sistema, com retorno `https://central-gestao-genesis.vercel.app/api/connections/google/callback`.
3. Configurar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no ambiente da aplicação.
4. Em Integrações, autorizar a conta que tem acesso aos formulários e planilhas. Os escopos são somente leitura do formulário, respostas e planilhas.
5. No projeto, vincular o formulário pela URL de edição e executar a primeira sincronização. As seguintes passam pela fila automática.

Identificação pública do aplicativo: `/about`; política de privacidade: `/privacy`; termos: `/terms`; instruções de exclusão: `/data-deletion`. Essas páginas podem ser acessadas sem sessão. O Google exige a identificação pública e a política para o modo de produção. Em um aplicativo externo no modo Testing, os tokens de atualização destes escopos expiram em sete dias; depois de publicar o aplicativo, reconecte a conta para emitir uma autorização no novo estado. [OAuth Google](https://developers.google.com/identity/protocols/oauth2).

A conta Google conectada pode receber formulários compartilhados como Editor e a planilha vinculada como Leitor. A conta que administra o cliente OAuth não precisa ser a proprietária original dos formulários. As permissões do formulário e da planilha devem ser conferidas separadamente.

A identificação pública `google-site-verification` nos metadados do layout comprova a propriedade do endereço `https://central-gestao-genesis.vercel.app/` para a conta `automacoes.lc@gmail.com` no Search Console. Ela não é uma credencial de acesso e deve permanecer publicada para conservar a verificação. O login continua obrigatório para os dados dos projetos.

Uma planilha de consolidação que não esteja vinculada ao formulário não é importada por essa opção. Dados de vendas são recebidos diretamente das plataformas; a leitura da planilha não cria vendas, contatos ou alterações financeiras automaticamente.

## Valores financeiros e atribuição

- Bruto: valor da compra informado no evento.
- Taxa da plataforma: Hotmart `hotmart_fee.total` ou comissão `MARKETPLACE/HOTMART`; Hubla, recebedores com papel `platform`, na mesma moeda da compra.
- Líquido após taxa: bruto menos essa taxa.
- Valor do produtor: comissão `PRODUCER` da Hotmart ou recebedor `seller` da Hubla. Não representa saldo bancário disponível para saque.
- Dados financeiros ausentes aparecem como **Não informado**. Moedas distintas não são somadas. Os totais são apurados pelos eventos recebidos, com os reembolsos como reversões; taxas adicionais não informadas pela plataforma não são estimadas.

O exemplo Hotmart de R$ 47 com taxa de R$ 5,18 resulta em R$ 41,82 após a taxa, com R$ 19,66 destinados ao produtor. O exemplo Hubla de R$ 297 tem R$ 20,28 para a plataforma, R$ 276,72 após essa taxa e R$ 138,36 para o vendedor.

Os registros mantêm a identidade da transação; compras distintas do mesmo telefone não se sobrescrevem. Aprovação e conclusão da mesma transação não duplicam vendas. Informações de contato e atribuição já recebidas são preservadas quando a conclusão omite esses campos.

Contatos são relacionados por e-mail ou telefone no mesmo projeto. Conflitos entre esses identificadores não são mesclados automaticamente. A conversão exibida usa contatos registrados no período que possuem compra nesse período, excluindo transações reembolsadas dentro do filtro. Os dados históricos sem contato/atribuição disponíveis não são preenchidos por suposição.

## Implantação e validação

Migrations: `20260913010155_project_operations_workspace.sql` e `20260913014322_google_forms_job_vault_auth.sql`. Publicar também `hubla-webhook` e a aplicação Next.js. O receptor Hotmart em uso continua sendo a rota da aplicação; a antiga Edge Function Hotmart está desativada.

Verificações: testes unitários/API, testes SQL de isolamento, idempotência e preservação das perguntas, verificação de tipos, lint e build. A conferência visual usa dados fictícios locais, sem registrar vendas de teste em produção.
# Histórico Hotmart por produto e período

Em **Projeto → Vendas → Importar histórico da Hotmart**, selecione um produto já vinculado na aba Produtos e as datas inicial e final (dias completos em America/Sao_Paulo). A conexão utiliza a credencial Hotmart já guardada no servidor. Não há credencial nova no navegador.

A fila persiste o progresso no Supabase, divide o período em janelas de 30 dias e percorre os estados de compra e a paginação da Hotmart. O processo continua com a tela fechada. Falhas temporárias são tentadas até três vezes; a tela permite retomar do último lote confirmado. Repetir períodos não duplica transações, contatos ou atribuições. O vínculo do produto é estendido até a data solicitada somente quando não invade um vínculo histórico existente.

Compras aprovadas/concluídas são materializadas nas telas Vendas, Origens, Contatos e Resultados. O histórico consultado também apresenta pendências, cancelamentos e estornos, com exportação da página em CSV. Importações antigas não substituem campos mais completos já recebidos pelos webhooks. A identificação de produto, projeto e moeda é validada antes de confirmar o lote.

- Valores separados: bruto, taxa na mesma moeda da compra, líquido após taxa e comissão do produtor. Comissões de coprodutores e moedas diferentes não são somadas ao produtor. Ausência de valores aparece como “Não informado”.
- Origens: SCK, código externo, SRC original, página reconhecida e UTMs extraíveis; nomes de campanha com separadores são preservados pelo parser existente. A API não recompõe dados que nunca foram capturados.
- Recuperação: uma pendência observada antes da aprovação pode ser marcada como recuperada pela próxima consulta ou pelo webhook. Uma venda já aprovada na primeira consulta não prova recuperação.
- Estornos: o estado atual da API não fornece aqui a data contábil nem o valor efetivo de um reembolso parcial. Esses dados não são inventados. Uma compra com estorno pendente de conciliação fica fora da receita reconhecida; os detalhes continuam no histórico. O evento real de reembolso permite conciliar o lançamento original e sua reversão. Na visão operacional, totais líquidos com estorno parcial ficam desconhecidos.
- O período de consulta segue os filtros da Hotmart; na apresentação há datas separadas para pedido, aprovação e consulta. Uma aprovação pode ocorrer em um dia diferente do pedido.

Publicação: aplicar `20260913112444_hotmart_history_imports.sql`, publicar o app e executar `scripts/activate-hotmart-history.sql`. Este último cria apenas o segredo dedicado no Vault e o cron `genesis-hotmart-history`, que chama `POST /api/jobs/hotmart-history` a cada minuto. A rota valida esse segredo e não usa a sessão do navegador. Nenhum fluxo do n8n é desativado.

Contratos consultados: [histórico](https://developers.hotmart.com/docs/en/v1/sales/sales-history/), [comissões](https://developers.hotmart.com/docs/en/v1/sales/sales-commissions/). A resposta real das comissões usa `commission.currency_code`; o normalizador também aceita `currency_value` da documentação e dos webhooks.

As consultas de vendas usam `node:https`, com limite de 15 segundos e de 4 MiB por resposta. A validação em produção identificou HTTP 400 no transporte `fetch` da Vercel para consultas que funcionavam localmente; o transporte nativo foi validado na própria Vercel com as mesmas credenciais e filtros. Não segue redirecionamentos e não registra tokens, compradores ou o corpo da resposta de erro. Os logs conservam o endpoint, HTTP e código de erro para diagnóstico.
# Análises por período e produto — setembro de 2026

Vendas, Origens, Contatos, Recuperação, Resultados e Métricas compartilham a seleção de período e produtos ao trocar de aba. Atalhos inclusivos: 7, 15, 30, 60 dias, 3 e 6 meses de calendário. O período personalizado aceita até 366 dias por consulta. Selecionar um período consulta os dados já recebidos; a importação histórica da Hotmart continua disponível na aba Vendas para preencher intervalos anteriores.

A seleção múltipla usa IDs estáveis do catálogo, com distinção entre todos e nenhum. Vendas sem ID interno podem ser identificadas pelo par conexão/ID externo. Recuperações sem vínculo de produto ficam fora de uma seleção específica. Contatos filtrados por produto se limitam aos contatos vinculados às vendas ou tentativas no período; essa base não representa todos os visitantes do produto. Exportações acompanham os filtros.

Preços de referência usam a média ponderada por unidade das vendas aprovadas: repasse ao produtor quando disponível; caso contrário, valor após taxas. As duas bases não são misturadas. Valores desconhecidos permanecem indisponíveis, sem substituir pelo preço bruto do catálogo. Reembolsos não entram na média dos pagamentos; as quantidades de referência descontam os estornos registrados no período. Quantidades de produtos diferentes não comprovam conversão entre os mesmos compradores.

O CPA base automático só é calculado quando o projeto tem um único produto de entrada, vendas e investimento registrado. É um CPA combinado, incluindo vendas orgânicas. Ao filtrar produtos, os dados de tráfego continuam sendo os da conta; CPA, ROAS e resultado por produto ficam indisponíveis até haver divisão confiável dos gastos. Metas, verba futura, taxas contratuais, divisão do lucro, presença e despesas externas permanecem decisões da operação. Novos projetos não recebem percentuais e metas arbitrários. Valores personalizados existentes são preservados, com a opção de voltar a Automático.

O Financeiro permite consultar os dados recebidos sem confirmar premissas. O resultado considera apenas os custos registrados; não equivale a uma auditoria de todas as despesas.

## Atualização da Meta

A migration `20260913133708_meta_automatic_sync.sql` cria funções restritas ao servidor, seleção de projeto e trava de execução. Depois do deploy, `scripts/activate-meta-sync.sql` configura um token próprio no Vault e uma chamada a cada cinco minutos. Cada chamada processa um projeto ativo com conta Meta válida, no máximo uma vez por hora por projeto, sem depender de navegador aberto. Primeira execução: últimos seis meses; seguintes: últimos dez dias para incorporar ajustes recentes. A fila distribui a atualização pelos projetos. Falhas ficam em `sync_runs` com `job_type=meta_auto`; execuções interrompidas expiram em dez minutos e podem ser retomadas na próxima janela horária.

Nenhum vínculo de conta, credencial existente ou permissão de fornecedor é alterado. Projetos sem a conta correta ficam pendentes. A gravação do tráfego e a conclusão do trabalho ocorrem na mesma transação e só aceitam uma execução válida.
