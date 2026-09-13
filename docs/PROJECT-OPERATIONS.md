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

O token e o destino do job ficam no Supabase Vault, em `genesis_google_forms_job_token` e `genesis_google_forms_job_url`. O endpoint aceita `GOOGLE_FORMS_SYNC_SECRET` ou um token HMAC específico do job, derivado da chave de servidor e URL do Supabase. A chave do banco não é transmitida ao endpoint. Se a chave de servidor mudar, atualize também o token dedicado no Vault. [Agendamento de funções no Supabase](https://supabase.com/docs/guides/functions/schedule-functions).

Para ativar Google em produção:

1. Habilitar Google Forms API e Google Sheets API no projeto Google Cloud.
2. Criar o cliente OAuth web do sistema, com retorno `https://central-gestao-genesis.vercel.app/api/connections/google/callback`.
3. Configurar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no ambiente da aplicação.
4. Em Integrações, autorizar a conta que tem acesso aos formulários e planilhas. Os escopos são somente leitura do formulário, respostas e planilhas.
5. No projeto, vincular o formulário pela URL de edição e executar a primeira sincronização. As seguintes passam pela fila automática.

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

Migration: `20260913010155_project_operations_workspace.sql`. Publicar também `hubla-webhook` e a aplicação Next.js. O receptor Hotmart em uso continua sendo a rota da aplicação; a antiga Edge Function Hotmart está desativada.

Verificações: testes unitários/API, testes SQL de isolamento, idempotência e preservação das perguntas, verificação de tipos, lint e build. A conferência visual usa dados fictícios locais, sem registrar vendas de teste em produção.
