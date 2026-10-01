# Organização dos painéis

Os projetos têm seis áreas: Resumo, Vendas, Divulgação, Público, Financeiro e Configurar. Compras, recuperação e histórico Hotmart ficam em Vendas; origens e tráfego diário em Divulgação; contatos e respostas em Público. Receita, saldo, custos e projeções ficam no Financeiro. Vínculos e importação alternativa ficam em Configurar. As funções e os endereços anteriores foram preservados. O menu principal distingue acompanhamento, preparação da operação e ferramentas. A página `/setup` oferece roteiro de configuração e atalhos para o projeto escolhido.

O mapa dos problemas, os requisitos completos e as pendências verificadas estão em [GUIA-CONFIGURACAO-E-NAVEGACAO.md](GUIA-CONFIGURACAO-E-NAVEGACAO.md).

## Contexto da análise

Os parâmetros `view`, `start`, `end` e `products` preservam a consulta no endereço do projeto. O botão Voltar restaura a área anterior; recarregar mantém o contexto. Ausência de `products` significa todos; `products=` significa nenhum. Datas inválidas usam os últimos 30 dias. Os intervalos são inclusivos, com até 366 dias.

A visão geral consulta o período no servidor, com paginação dos indicadores para evitar totais truncados em períodos longos. Ao abrir um projeto por essa tela, as datas são mantidas.

As respostas dos formulários usam a data do último envio em horário de Brasília, filtrada antes da paginação. Formulários pertencem ao projeto, sem vínculo obrigatório a um produto; por isso não recebem o filtro de produtos. O espelho da planilha conserva seu conteúdo original e informa que não aplica o filtro de datas.

## Blocos do resumo

O painel oferece composição financeira, tráfego, origens, recuperação, formulários, fontes e comparação de períodos. É possível adicionar, remover e mudar a ordem por teclado ou clique. Os modelos Gestão, Tráfego e Comercial são pontos de partida.

As preferências são salvas neste navegador por projeto, apenas com os identificadores dos blocos. Não incluem dados pessoais, valores de vendas nem credenciais. Não são sincronizadas entre dispositivos. Uma falha de armazenamento mantém a personalização durante a sessão e mostra uma mensagem.

## Significado dos valores

- O resumo financeiro e a tabela de compras usam a mesma regra de consolidação das transações: bruto aprovado, reembolsos, taxas, líquido após taxas e repasse ao produtor são valores distintos.
- Valores financeiros ausentes aparecem como não informados; uma falha da fonte oculta os valores anteriores do resumo.
- As importações diárias de CSV continuam em Tráfego diário e Custos e saldo. Não são somadas novamente às transações do resumo.
- Tráfego e investimento pertencem ao projeto. Selecionar produtos não distribui gastos entre eles.
- Ausência de origem ou página é exibida explicitamente e não é classificada automaticamente como orgânica.
- A comparação usa o intervalo imediatamente anterior, de igual duração, com a mesma moeda e os mesmos produtos. Não calcula uma variação percentual quando a base anterior é zero.
- O bloco de formulários informa totais históricos; a tabela de respostas permite a consulta por período.
- Conexão cadastrada, conta vinculada e dados atualizados são estados diferentes. A interface não afirma monitoramento ativo com base apenas na existência de credenciais.

## Validação e limites

Há testes de preservação dos filtros, seleção vazia, preferências, separação dos valores financeiros, falhas de carregamento, intervalos de respostas e paginação de consultas. A navegação foi exercitada em navegador de teste local, com telas de computador e celular, sem alterar dados de produção.

Esta reorganização não configura credenciais, não resolve vínculos de produtos ou contas pendentes e não substitui a validação operacional de cada integração. Não exige novas migrations ou Edge Functions. A disponibilização depende do deploy da aplicação.

Na revisão de outubro, os testes também verificam a seleção do projeto nos atalhos, a diferença entre credencial cadastrada e verificada, a ausência de formulários vinculados, o comportamento de módulos opcionais e a preservação das referências de projeção ao salvar custos. A interface foi conferida em computador e celular em demonstração local, sem cadastrar eventos ou despesas em produção.
