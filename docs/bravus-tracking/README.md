# Rastreamento Bravus — situação em 10/09/2026

As três páginas e o mapa do n8n foram atualizados e publicados. Consulte [o diagnóstico](../DIAGNOSTICO-RASTREAMENTO-BRAVUS-2026-09-10.md) para evidências das vendas e comparação com 05/09.

## Arquivos

- `rastreamento.js` / `rastreamento.html`: código publicado no campo Head & Footer Code → BODY Code das páginas 6869, 6860 e 7028.
- `body-anterior-2026-09-05.html`: backup do bloco anterior comum às três páginas.
- `links-alterados.json`: sete hrefs anteriores e publicados no Elementor.
- `n8n-anterior-2026-09-10.js`: backup do normalizador encontrado no fluxo Geral.
- `n8n-normalizacao.js`: versão publicada, acrescentando somente o mapa dpaf7028.
- `parser-sck-2026-09-05.js`: parser histórico usado na verificação de compatibilidade; não é um novo nó a instalar.
- `verify.mjs`: 22 testes do script de página.
- `verify-n8n.mjs`: 7 testes do normalizador.

Executar: `node --test docs/bravus-tracking/verify.mjs docs/bravus-tracking/verify-n8n.mjs`.

## Contrato preservado

O SCK mantém a ordem histórica: utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid. O normalizador usa as posições como Source, Medium, Campaign, Content, Term, ID. Pipes com espaços pertencem aos nomes; pipes sem espaços separam os campos. Não inverter posições sem migrar os dois lados.

V2H6 continua no endereço /da-prova-a-farda-v2h1/, como já estava em 05/09. Os códigos antigos foram preservados. A variação 27 usa dpaf7028 nos links, no script e no mapa do n8n.

## Limites

Nenhuma compra foi realizada; nenhuma venda antiga foi reexecutada. Não há garantia de atribuição para links externos sem código ou checkout gerado pelo agente sem a origem anterior. Preservação de histórico identificado do lead ainda não foi implementada.

Antes de republicar conteúdo em abas antigas do Elementor, recarregar a versão salva, preservando eventuais alterações pessoais ainda não salvas. A página base 6373 ficou intacta.

Para reversão pontual, utilizar os backups correspondentes. Não apagar os demais scripts globais nem substituir o conteúdo inteiro das páginas.
