import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const before = readFileSync(new URL('./n8n-anterior-2026-09-10.js', import.meta.url), 'utf8');
const after = readFileSync(new URL('./n8n-normalizacao.js', import.meta.url), 'utf8');
function run(code, origin) {
  const input = { body: { event: 'PURCHASE_APPROVED', data: {
    product: { id: 8304193, name: 'OPERAÇÃO DA PROVA À FARDA' },
    purchase: { transaction: 'TESTE-LOCAL', status: 'APPROVED', origin,
      approved_date: 1788994388000, price: { value: 47, currency_value: 'BRL' } }
  } } };
  return new Function('$input', code)({ all: () => [{ json: input }] });
}
for (const xcod of ['dpaf6373', 'dpaf6860', 'dpaf6869', '', 'desconhecido']) {
  test('preserva a saida anterior para ' + (xcod || 'sem codigo'), () => {
    const origin = { xcod, sck: 'meta-ads|Grupo | A|Campanha | B|Feed|Video|click-teste' };
    assert.deepEqual(run(after, origin), run(before, origin));
  });
}
test('mapeia a variacao 27 preservando nomes completos das UTMs', () => {
  const [item] = run(after, { xcod: 'dpaf7028', sck: 'meta-ads|Grupo | A|Campanha | B|Feed|Video|click-teste' });
  assert.ok(item);
  assert.equal(item.json.Page_URL, 'https://bravuscursos.com.br/da-prova-a-farda-v2h6-27/');
  assert.equal(item.json.Page_Path, '/da-prova-a-farda-v2h6-27/');
  assert.equal(item.json.UTM_Medium, 'Grupo | A');
  assert.equal(item.json.UTM_Campaign, 'Campanha | B');
});
test('nao inventa pagina para origem HOTMART_SALES_AGENT', () => {
  const [item] = run(after, { sck: 'HOTMART_SALES_AGENT' });
  assert.equal(item.json.UTM_Source, 'HOTMART_SALES_AGENT');
  assert.equal(item.json.Page_URL, '');
});
