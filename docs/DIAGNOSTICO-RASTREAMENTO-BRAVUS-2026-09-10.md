# Rastreamento Bravus — diagnóstico e alterações de 10/09/2026

## Conclusão após consultar as execuções reais

A diferença entre o título V2H6 e o endereço terminado em v2h1 **já existia em 05/09/2026**, quando ocorreu o primeiro ajuste. As páginas V1H6 e V2H6 mantinham em 10/09 o mesmo bloco BODY instalado naquela data. Não foi encontrada mudança entre esses dois registros de nomes, endereços ou códigos que explique as duas vendas sem página.

As duas vendas chegaram ao n8n **sem o identificador xcod**. O problema não surgiu da conversão desse código em URL nessas execuções.

| Venda | Execução | Entrada recebida da Hotmart | Saída observada |
| --- | --- | --- | --- |
| 06/09 às 21:10:19 | [82058](https://n8n-n8n.fsxl5e.easypanel.host/workflow/sUG3ZPft1tgcIZhX/executions/82058) | SCK = HOTMART_SALES_AGENT; pesquisa por xcod sem resultados | UTM_Source = HOTMART_SALES_AGENT; demais cinco campos UTM vazios |
| 09/09 às 19:53:11 | [82344](https://n8n-n8n.fsxl5e.easypanel.host/workflow/sUG3ZPft1tgcIZhX/executions/82344) | Pesquisas por xcod e sck sem resultados; pesquisa por origin encontrou apenas original_offer_price | SCK e os seis campos UTM vazios |
| Controle: 09/09 às 13:14 | [82323](https://n8n-n8n.fsxl5e.easypanel.host/workflow/sUG3ZPft1tgcIZhX/executions/82323) | xcod = dpaf6860 | Page_URL = https://bravuscursos.com.br/da-prova-a-farda-v2h1/ |

As execuções iniciaram, respectivamente, às 21:10:31, 19:53:24 e 13:14:56, com status Succeeded. Os horários acima de aprovação foram lidos da saída do normalizador. Para a venda de 09/09, order_date = 1788994388000 equivale a 09/09 às 19:53:08 em America/Sao_Paulo. Portanto, o pedido dessa venda não foi criado antes do ajuste de 05/09, embora isso não revele quando o checkout foi inicialmente aberto.

O marcador HOTMART_SALES_AGENT é evidência de uma origem diferente do SCK de campanhas preparado nas páginas. Sua associação ao Agente de Vendas é uma inferência pelo identificador. Não foi consultado o painel de conversas do comprador para confirmar a modalidade específica: página de vendas, abandono ou outro contato.

A Hotmart descreve atuação do agente em páginas de vendas, abandono de carrinho e após o checkout, além de histórico de conversas e envio opcional de dados de leads por webhook. A documentação consultada não garante que a URL externa original seja incluída no evento de venda do agente. [Documentação do Agente de Vendas](https://help.hotmart.com/pt-br/article/40205270182029/o-que-e-o-agente-de-vendas-e-como-utiliza-lo-para-aumentar-minhas-vendas-/).

## Comparação com o primeiro ajuste

Fonte histórica: tarefa “Analisar webhook de compra Hotmart”, iniciada em 05/09/2026, e arquivos preservados no diretório de trabalho daquela tarefa. A etapa de instalação nas páginas começou às 11:23:02 e terminou às 11:40:29, no fuso America/Sao_Paulo.

| Página | ID | Título em 05/09 e em 10/09 | Endereço preservado | Código preservado |
| --- | --- | --- | --- | --- |
| V1 | 6869 | DA PROVA À FARDA - V1H6 | /da-prova-a-farda-v1h6/ | dpaf6869 |
| V2 | 6860 | DA PROVA À FARDA - V2H6 | /da-prova-a-farda-v2h1/ | dpaf6860 |
| Base | 6373 | DA PROVA À FARDA | /operacao-farda-v1-h1/ | dpaf6373 |

Os blocos BODY de V1 e V2 tinham 3.200 caracteres após normalização de quebras de linha e trim; foram comparados entre si e com o registro de instalação. O backup está em `bravus-tracking/body-anterior-2026-09-05.html`.

O código atual do normalizador no n8n também corresponde ao arquivo entregue em 05/09: 33.765 caracteres normalizados, mesmo mapa de três páginas e parser que distingue `|` separador de ` | ` dentro dos nomes. Não foi necessário inverter Content/Term ou mudar o significado das posições.

Essa comparação não é uma auditoria de todas as revisões intermediárias. Ela comprova a configuração registrada no primeiro ajuste e a encontrada agora; não determina se houve alterações transitórias entre essas datas.

## Correções de conclusões anteriores

- A falha na variação 27 era real, mas **não explica essas duas vendas**. O estrategista informou que elas pertencem às duas páginas anteriores. A variação 27 consta como publicada em 08/09 às 21:19.
- Não havia evidência de bloqueio no local correto do script. A negativa de permissão ocorreu na área Elementor Custom Code. O código real estava no campo **Head & Footer Code → BODY Code** de cada página e pôde ser editado com a sessão existente.
- O separador com espaços dentro dos nomes **faz parte do contrato do parser entregue em 05/09**. A avaliação inicial baseada em dividir indiscriminadamente por `|` não representava esse parser. A proposta local de remover pipes foi descartada antes da instalação. O código publicado preserva os nomes.
- O print inicial mostrava a página vazia; a consulta posterior aos eventos é que permitiu verificar também o estado das UTMs.

## Alterações concluídas

1. **Sete links publicados no Elementor:** três em V1H6, dois em V2H6 e dois em V2H6 | 27. Cada link salvo contém o xcod da própria página. Produto, oferta e checkoutMode foram preservados. Backup em `links-alterados.json`.
2. **BODY Code substituído nas três páginas:** reconhece a variação 27, cobre links inseridos ou modificados depois do carregamento, retorno por navegação e interações por mouse/teclado. Preserva o formato histórico de SCK e restringe alterações ao checkout do produto V107140616F. Arquivos `rastreamento.js` e `rastreamento.html`.
3. **n8n publicado:** no fluxo [Geral](https://n8n-n8n.fsxl5e.easypanel.host/workflow/sUG3ZPft1tgcIZhX), nó “Normaliza Dados de Venda Hotmart”, foi acrescentado somente:
   `dpaf7028 → https://bravuscursos.com.br/da-prova-a-farda-v2h6-27/`.
   A versão publicada se chama “Origem da pagina V2H6 27 - 10/09/2026”. O botão retornou ao estado Published. Backups antes/depois em `n8n-anterior-2026-09-10.js` e `n8n-normalizacao.js`.

A página base 6373 não foi editada. Os outros scripts de rastreamento presentes no site não foram removidos. Nenhuma venda histórica foi reexecutada ou preenchida por suposição.

## Validação

- 22 testes locais do script das páginas, incluindo compatibilidade com o parser histórico, campos vazios, nomes com pipes, cookies bloqueados, links tardios e alteração de href.
- 7 testes locais do normalizador: mapa novo, preservação das saídas dos códigos antigos e desconhecidos, nomes completos e ausência de página para HOTMART_SALES_AGENT.
- Verificação nas três páginas públicas: todos os sete botões enviaram o xcod correto e o SCK `verificacao|Grupo | Teste|Conferencia|Feed|Criativo|`; ofertas preservadas.
- Na variação 27, acesso sem UTMs também manteve dpaf7028 nos dois botões.
- Confirmações de atualização no WordPress e verificação do conteúdo salvo em V1/V2; confirmação pública do novo comportamento da variação 27.
- Não foi feita compra de teste. Os testes públicos usaram a sessão disponível, autenticada no WordPress; não cobrem diferenças de cache para visitantes anônimos.

## Histórico anterior do lead e limites

O evento de aprovação recebido não constitui um histórico de navegação. Para procurar a origem anterior, verificar eventos prévios de abandono/tentativa do mesmo lead ou transação e o histórico de conversas em Ferramentas → Ver todas → Agente de Vendas na Hotmart.

Para futuras recuperações pelo agente, a melhoria estrutural é registrar a página e as UTMs no primeiro contato identificado e preservar esse registro, associando-o à venda posterior por uma chave confiável. Registrar separadamente a página/campanha original e o canal de fechamento evita substituir a primeira origem por HOTMART_SALES_AGENT.

Esse armazenamento de histórico de leads **não foi implementado nesta alteração**. Antes de fazê-lo, é necessário conferir os dados efetivamente disponíveis na captura/abandono e a chave de associação. Os ajustes nos links e scripts não conseguem reconstruir dados que nunca foram registrados nem obrigar um checkout externo gerado pelo agente a carregar a identificação da página.

## Verificação complementar: histórico do WordPress e venda de 09/09

O histórico do Elementor registra ações de edição e versões salvas/publicadas da página. O recurso Submissions registra formulários enviados quando a ação Collect Submissions está ativa. Nenhum desses recursos constitui, por padrão, um histórico da execução do JavaScript no navegador de cada visitante. Os botões de compra inspecionados são links para o checkout externo. Fontes: [histórico do Elementor](https://elementor.com/help/revision-history-undo-and-redo/) e [envios de formulários](https://elementor.com/help/form-submissions/).

O WP_DEBUG_LOG registra erros do WordPress/PHP quando configurado; não é um registro automático dos cliques ou da execução do script no navegador. [Documentação do WordPress](https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/).

Na sessão disponível, o menu e a tela Ferramentas do WordPress não apresentaram um histórico de execução desse script. Essa observação não comprova a inexistência de registros na hospedagem ou em ferramentas de monitoramento fora das áreas consultadas.

Foram conferidos dois registros próximos à venda: a execução 82331, de 09/09 às 16:47:46, possui um identificador de transação diferente do recebido em 82344; isso não determina se seria ou não o mesmo lead em outra tentativa. A execução 82346, de 19:54:10, contém o evento CLUB_FIRST_ACCESS, não apresentou campo transaction na busca e não gerou saída no normalizador. Esses registros não demonstraram a causa da ausência de atribuição na venda 82344.

O script original acrescentava xcod mesmo sem UTMs. Portanto, uma visita sem UTMs, isoladamente, não explica a ausência simultânea de xcod se o visitante passou por uma das páginas reconhecidas e o script executou como previsto. As possibilidades ainda não discriminadas pelos registros são: acesso ao checkout por um link sem rastreamento, ausência/falha de execução na sessão do visitante ou descarte dos parâmetros em alguma etapa posterior do checkout. Não há evidência suficiente para escolher uma delas como causa comprovada da venda de 09/09. Os testes atuais e a presença do código salvo não reconstituem a execução histórica no navegador da compradora.
