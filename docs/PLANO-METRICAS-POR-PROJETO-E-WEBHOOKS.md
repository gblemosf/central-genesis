# Plano de métricas por projeto e webhooks de vendas

Análise realizada em 11/09/2026 a partir da planilha
`[PP.SC.AGO] Métricas vendas Diárias - Ecossistema Luiz Brito` e da cópia de
trabalho atual da Central Genesis.

## Conclusão

A implementação é viável. A Central já possui projetos, produtos, etapas do
funil, métricas de tráfego, eventos de venda, itens de venda, custos, contatos,
UTMs e importações CSV isolados por `project_id`. O trabalho restante não é
reproduzir a planilha: é completar as entradas de dados, consolidar as regras
financeiras e apresentar o mesmo resultado dentro de cada projeto.

As duas fontes prioritárias são Hubla e Hotmart. As duas podem abastecer a Central
por webhook. Uma API de catálogo ou consulta melhora a configuração e a
conciliação, mas não é necessária para registrar os eventos futuros. Quando não
houver consulta histórica suficiente, o passado precisará entrar por exportação
CSV, e a operação precisará de registro de entregas, reprocessamento e alerta de
falhas.

## O que existe na planilha

| Aba | Estado observado | Papel esperado |
| --- | --- | --- |
| Sistema Capital Digital | 23 dias/linhas de métricas e uma linha geral | Painel diário do projeto |
| GERAL | Sem valores no intervalo utilizado | Consolidado entre projetos |
| exportações hubla | Sem valores no intervalo utilizado | Dados brutos da plataforma de vendas |
| exportações downsell | Três fórmulas com `#REF!` | Fonte ou resumo de vendas de downsell |
| Lista para recuperação Ingresso | Sem valores no intervalo utilizado | Fila operacional de recuperação |

A aba principal contém: dia, CTR, connect rate, conversão de página para
checkout, conversão do checkout, vendas e faturamento do produto principal,
taxas da plataforma, gasto de tráfego, gasto acrescido da taxa de gestão, ROAS,
upsell, três order bumps, CPA, faturamento total, lucro, ARPU e ROAS geral.

As fórmulas revelam regras fixas dentro da planilha, como taxa de tráfego de
13,85%, preço do produto principal e preços de upsell/order bumps. Existem
divisões por zero e referências quebradas. Essas regras devem virar configurações
ou valores financeiros persistidos, e não novas fórmulas ocultas na interface.

Há também diferenças de definição que precisam ser deliberadas. A linha geral da
planilha usa a mediana de apenas parte das linhas para CTR e conversões, enquanto
a Central calcula a taxa ponderada a partir dos totais do período. O ARPU geral da
planilha é a mediana de quatro ARPUs diários; a Central usa faturamento total
dividido pelas vendas principais do período. O `LUCRO FINAL` diário da planilha é
faturamento menos mídia com taxa, enquanto a Central chama de lucro o resultado
depois de mídia e custos operacionais. Para evitar números igualmente nomeados e
diferentes, a recomendação é manter taxas ponderadas e separar `saldo após mídia`
de `lucro operacional`.

## Comparação com a Central atual

| Informação da planilha | Situação na Central | Ajuste necessário |
| --- | --- | --- |
| Dia e período | Existe por projeto | Usar um único período em todas as visões |
| Impressões, cliques e investimento | Existe em `traffic_metrics_daily` | Confirmar sincronização real da Meta e mostrar última atualização |
| CTR | Calculado | Nenhum ajuste estrutural |
| Connect rate | Calculado a partir de page views/cliques | Garantir que page views usem a mesma definição da operação |
| Conversão da LP | Calculada como checkouts/page views | Confirmar o evento que representa início de checkout |
| Conversão do checkout | Calculada como vendas principais/checkouts | Definir o produto de aquisição de forma única |
| Vendas por produto | Existe em `sales_events` e `sales_event_items` | Completar webhooks e mapeamento de produtos |
| Faturamento principal e total | Existe | Persistir o líquido do evento; não recalcular histórico pelo preço atual |
| Taxa fixa e percentual da plataforma | Não há decomposição diária equivalente | Guardar bruto, taxa e líquido por transação |
| Gasto com taxa de tráfego | Existe como premissa | Persistir vigência quando a taxa mudar |
| Upsell | O modelo suporta, mas a tabela diária não o destaca | Exibir produtos dinamicamente por etapa do funil |
| OB1, OB2 e OB3 | Existe | Remover o limite estrutural de três posições na visualização/importação |
| CPA, ARPU e ROAS | Calculados | Unificar denominadores e período entre resumo, diário e financeiro |
| Lucro diário | Não aparece na tabela diária | Derivar por dia com custos e taxas claramente identificados |
| Consolidado GERAL | Existe uma visão geral, com limitações de paginação | Agregar no banco por organização e período |
| Recuperação de ingresso | Eventos brutos da Hubla existem, mas não há fila operacional | Criar tentativas/checkout abandonado e tela de recuperação |

## Arquitetura recomendada

### 1. Entrada bruta auditável

Criar uma camada comum de entregas de webhook, isolada por organização e conexão.
Cada entrega deve guardar:

- provedor, conexão, identificador do evento e versão do contrato;
- data de recebimento e data em que o evento ocorreu;
- assinatura validada, ambiente de teste e estado do processamento;
- referência ao projeto/produto quando resolvida;
- erro de normalização e payload minimizado conforme a necessidade operacional.

A combinação `(connection_id, external_event_id)` deve ser única. Isso evita
duplicidade quando o provedor repetir uma entrega.

### 2. Adaptador por provedor

Cada plataforma traduz seu formato para um contrato interno:

```text
evento: identificador, tipo, data e status
transação: identificador e status financeiro
cliente: identificador externo e campos disponíveis
produto: identificador externo, nome e quantidade
valores: bruto, taxa, líquido e moeda
atribuição: UTMs, página e referência de checkout quando disponíveis
```

Hotmart e Hubla têm formatos diferentes, mas devem produzir os mesmos
`sales_events`, `sales_event_items`, contatos e tentativas de checkout. Novos
provedores, como Eduzz, entram posteriormente como adaptadores do mesmo contrato.

### 3. Configuração por projeto

Cada projeto deve possuir:

- conta de tráfego vinculada;
- conexão de vendas vinculada;
- catálogo e mapeamento produto → etapa do funil;
- produto de aquisição definido explicitamente;
- período, metas, custos, participação e taxa de tráfego;
- regras financeiras com data de vigência quando alterarem o passado.

Os preços, taxas e valores líquidos usados em vendas históricas devem ser
fotografados na transação ou no item de venda. Alterar a configuração atual não
pode mudar o resultado de um mês encerrado.

### 4. Métricas derivadas

O banco deve entregar uma linha por projeto e dia com tráfego, checkout, vendas,
receita bruta, taxas, receita líquida, reembolsos e custos. CTR, conversões, CPA,
ARPU, ROAS e lucro são derivados dessa base. O painel diário, o financeiro e o
consolidado usam o mesmo período e a mesma definição.

### 5. Recuperação

Criar um registro de tentativa de checkout separado de venda. Estados mínimos:
`started`, `pending`, `abandoned`, `paid`, `refunded` e `canceled`. Quando o
webhook trouxer contato suficiente, associar por identificador externo e, com
regras explícitas, por e-mail ou telefone normalizados. A tela deve mostrar a
origem, produto, última atualização e se a tentativa virou venda.

## Integrações prioritárias

### Hubla

A Central possui uma URL geral da Hubla, autenticada pelo token enviado no
header `x-hubla-token`. O token é armazenado no cofre e somente sua impressão
SHA-256 é usada para localizar a conexão. Depois disso, o produto estável do
evento define o projeto e a etapa do funil. O endereço antigo com o identificador
da conexão continua aceito durante a transição.

A ingestão tem idempotência, armazenamento de entregas e normalização de compra
e reembolso. Em 11/09/2026, o receptor foi
ajustado com base em três formatos reais anonimizados: `lead.abandoned_checkout`,
`invoice.status_updated` e `customer.member_removed`. O abandono agora preserva
valor, moeda, oferta, contato, página e UTMs; cria contato e toque de campanha;
e entra em uma fila de recuperação associada ao produto e ao projeto. Uma compra
posterior do mesmo contato marca a tentativa como recuperada e cria a atribuição
de último toque da venda.

O evento bruto continua minimizado e não duplica nome, e-mail ou telefone. Esses
dados ficam nas tabelas operacionais protegidas para administradores. Produtos
sem mapeamento permanecem em quarentena. A fila aparece na aba **Leads** de cada
projeto; ainda falta publicar a migração e a função, validar uma entrega controlada
e completar o painel de saúde da conexão.

Uma única regra geral da Hubla pode enviar todos os eventos para
`/functions/v1/hubla-webhook`. Cada produto é descoberto automaticamente no
primeiro evento; até ser vinculado a um projeto, seus eventos ficam preservados
em quarentena. Assim, novos produtos não exigem a criação de outro endpoint.
Tipos de evento novos também recebem resposta de sucesso e entram no registro
minimizado; somente tipos conhecidos acionam vendas, reembolsos ou recuperação.

Como a Hubla não é tratada no código como fonte de catálogo, os produtos podem
ser descobertos pelo primeiro evento ou cadastrados manualmente. O vínculo deve
usar o identificador estável do produto recebido no webhook.

A documentação oficial confirma regras por produto/oferta, evento de teste e
uma aba de histórico das entregas. Ela também lista abandono de carrinho entre
os casos de uso. Para vendas retroativas, a própria Hubla orienta exportar CSV,
pois não oferece essa importação por API. Fontes: [webhooks da
Hubla](https://help.hub.la/hc/pt-br/webhook-hubla) e [vendas retroativas por
CSV](https://help.hub.la/hc/pt-br/como-habilitar-a-integra%C3%A7%C3%A3o-com-o-spedy).

### Hotmart

A Central já possui endpoint Hotmart autenticado por HOTTOK. Em 11/09/2026, o
receptor foi ajustado com base em dois eventos reais anonimizados: passou a
aceitar `PURCHASE_COMPLETE`, tolerar a ausência de `hotmart_fee`, calcular o
líquido pela comissão do produtor quando ela estiver disponível e preservar
`sck`/`xcod` sem copiar os dados pessoais do comprador para o payload normalizado.
A compra completa é convertida para `PURCHASE_COMPLETED`, nome interno já usado
pelo banco. Ainda falta a camada própria de entregas brutas e o tratamento de
tentativa ou abandono de checkout.

O próximo ajuste da Hotmart deve:

1. registrar cada entrega antes da normalização, com idempotência e erro visível;
2. preservar os campos financeiros e de atribuição necessários;
3. manter o catálogo por API já existente;
4. normalizar estados adicionais somente quando o contrato da Hotmart fornecer
   dados confiáveis para isso;
5. usar a mesma tela de saúde e pendências da Hubla.

### Provedores futuros

Eduzz e outros provedores devem entrar depois de Hubla e Hotmart. O cadastro e a
consulta de catálogo da Eduzz já existem parcialmente, mas ainda não há receptor
de vendas. A camada comum de entregas evita repetir todo o desenho para cada nova
plataforma.

## Ordem de implementação

### Etapa 1 — contratos e provas de integração

- obter exemplos reais e anonimizados da Hubla e da Hotmart para compra aprovada,
  pendência/abandono, reembolso e cancelamento, quando disponíveis;
- confirmar cabeçalhos, autenticação, tentativas de reenvio e identificadores
  estáveis de cada plataforma;
- transformar os exemplos em testes antes de publicar alterações.

### Etapa 2 — ingestão confiável

- implantar a camada comum de entregas;
- adaptar primeiro a Hubla e depois alinhar a Hotmart à camada comum;
- registrar duplicidade, falha e evento sem produto mapeado;
- validar em ambiente de teste e depois com uma transação controlada.

### Etapa 3 — paridade com a planilha

- completar bruto, taxas e líquido por evento;
- destacar produtos dinamicamente na tabela diária;
- adicionar lucro diário e explicação da origem de cada número;
- unificar filtros e consolidado.

### Etapa 4 — recuperação e conciliação

- criar a fila de tentativas/abandonos;
- associar tentativa, contato e venda;
- permitir reprocessamento de entregas com erro;
- importar o histórico por CSV quando não houver API de consulta.

## Informações ainda necessárias

Antes de alterar os receptores em produção, são necessários:

1. payloads reais anonimizados da Hubla e da Hotmart para os eventos relevantes;
2. cabeçalhos realmente enviados e forma de autenticação;
3. códigos estáveis de produto e oferta;
4. definição dos valores enviados: bruto, taxa, comissão e líquido;
5. política de reenvio e possibilidade de exportar o histórico;
6. decisão sobre quais dados de contato podem ser preservados para recuperação.

Sem esses contratos é possível preparar a camada comum, mas não comprovar todos
os mapeamentos em produção.

## Critérios de aceite

- cada evento entra uma única vez, mesmo quando reenviado;
- uma venda é atribuída ao projeto pelo produto e vigência do mapeamento;
- evento desconhecido fica visível como pendência, sem contaminar métricas;
- reembolso reduz receita e quantidade segundo regra definida;
- alteração de preço ou taxa não modifica o histórico fechado;
- painel diário e financeiro reproduzem os mesmos totais da fonte;
- tentativa recuperada deixa de aparecer como pendência;
- falhas e última entrega são visíveis na tela de integrações;
- histórico pode ser importado quando o provedor não oferece consulta por API.
