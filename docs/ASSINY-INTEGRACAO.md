# Preparação da integração Assiny

Estado em 02/10/2026: conector independente em pré-desenvolvimento. Não há acesso à conta Assiny nem contrato técnico validado. O receptor guarda entregas para conferência; não cria vendas, contatos, recuperação, produtos automáticos ou lançamentos financeiros.

## O que está preparado

- Assiny no cadastro de conexões e no assistente de projetos. Produtos de referência podem ser cadastrados manualmente, sem fingir sincronização de catálogo.
- Endereço protegido por conexão, token aleatório de 256 bits guardado no Vault e apenas fingerprint no índice de roteamento. Administradores podem copiar o endereço; operadores e outras organizações não podem consultar eventos.
- Receptor próprio `assiny-webhook`, separado dos contratos e processadores dos demais gateways.
- Caixa dos 30 eventos mais recentes, download do JSON para conferência e estado obrigatório `awaiting_contract`. A conexão permanece em atenção, sem data de verificação da plataforma.
- Confirmação HTTP 202 somente após persistência. Entregas JSON idênticas, independentemente da ordem das chaves, não criam outra linha. O hash é calculado antes de remover campos privados. Isso ainda não é deduplicação por ID de evento ou transação da Assiny.
- Limite de 1 MB, objeto JSON obrigatório e profundidade máxima de 32. Campos convencionais de senhas, tokens, headers, documentos, endereços, cartões e Pix são removidos antes do armazenamento. O esquema desconhecido ainda pode conter dados pessoais em outros campos; o acesso é restrito a administradores.

## Publicação

Aplicar, em transações separadas e depois das migrations existentes:

1. `20261002123044_add_assiny_provider.sql`
2. `20261002123156_assiny_webhook_preparation.sql`

Publicar `supabase/functions/assiny-webhook`. `supabase/config.toml` define `verify_jwt = false`, pois um emissor externo não usa sessão Supabase; o próprio receptor exige nosso token e uma conexão Assiny não revogada. O workflow de publicação inclui essa função, mas só executa banco/funções se os segredos do Supabase estiverem configurados no repositório. Deploy da Vercel não aplica migrations.

Depois, em Conexões, criar uma conexão Assiny e usar **Copiar endereço Assiny**:

```
https://<projeto>.supabase.co/functions/v1/assiny-webhook/<connectionId>?token=<segredo>
```

Este token protege provisoriamente nosso receptor; **não é uma credencial emitida pela Assiny nem implementação da assinatura oficial da plataforma**. A URL completa é segredo e não deve aparecer em relatórios ou logs. Para testes próprios, `x-genesis-assiny-token` pode substituir o parâmetro da URL. Rotacionar a credencial invalida o endereço anterior. Revogar a conexão bloqueia novas entregas.

O receptor não busca URLs fornecidas pelo evento e não considera uma entrega como comprovação de venda. Não cadastrar como única integração de produção até validar a entrega e concluir o processamento específico.

## O que depende do acesso à Assiny

1. Obter a documentação técnica oficial, revisar configuração de webhook, assinatura/autenticação, sandbox, retries, identificação de eventos e transações.
2. Receber exemplos reais de aprovação, tentativa/pendência, abandono e estorno, conforme os eventos efetivamente disponíveis.
3. Confirmar IDs de produtos/ofertas, horários, moeda, unidade monetária, bruto, taxas, líquido após taxas e repasse. Valores ausentes permanecem desconhecidos.
4. Confirmar as origens/UTMs fornecidas e o que acontece em eventos posteriores; não recuperar página ou origem por suposição.
5. Implementar e testar o contrato próprio da Assiny, pedidos com múltiplos itens, recorrência e estornos parciais conforme a documentação. Só então alimentar vendas, contatos, recuperação e financeiro e permitir reprocessamento dos eventos compatíveis.
6. Verificar se existe API oficial de catálogo/histórico. Nenhuma API foi confirmada; não presumimos que seja inexistente. Histórico automático depende desse levantamento.
7. Validar de ponta a ponta uma operação real e confrontar os resultados com o painel Assiny antes de marcar a conexão como ativa.

## Fontes e limites do levantamento

- [Site Assiny — integração](https://assiny.com.br/#integration): página comercial; não apresenta contrato JSON, endpoints de API ou esquema de autenticação.
- [Painel Assiny](https://admin.assiny.com.br/login): acesso autenticado ainda indisponível nesta implementação.
- [Guia da VTurb para Assiny](https://help.vturb.com/pt-br/article/rastreando-a-conversao-assiny-gnmrac/): demonstra cadastro de webhook e seleção de produtos/evento de compra aprovada. É documentação de uma integração de terceiros, não especificação oficial dos campos da Assiny.

## Verificação de desenvolvimento

`npm test -- supabase/functions/assiny-webhook src/app/api/connections src/components/assiny-connection-panel.test.tsx`

`supabase/tests/assiny.test.sql` usa dados sintéticos e rollback para verificar isolamento, privilégios, rotação, revogação, repetição de entrega, ausência de fatos financeiros e cadastro de produtos em preparação. Testes locais não validam o contrato real do fornecedor.
