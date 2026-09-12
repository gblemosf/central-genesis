import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('./rastreamento.js', import.meta.url), 'utf8');
const historicalParser = readFileSync(new URL('./parser-sck-2026-09-05.js', import.meta.url), 'utf8');
const checkout = 'https://pay.hotmart.com/V107140616F?off=0phj7mw3&checkoutMode=10';

function fixture({ path = '/da-prova-a-farda-v2h6-27/', query = '', hrefs = [checkout], loading = false, cookies = '', blockedCookies = false } = {}) {
  const location = new URL('https://bravuscursos.com.br' + path + query);
  const documentEvents = new Map();
  const windowEvents = new Map();
  const observers = [];
  const anchor = value => ({
    tagName: 'A', nodeType: 1, href: value,
    getAttribute(name) { return name === 'href' ? this.href : null; },
    closest() { return this; }, matches() { return true; }, querySelector() { return null; }
  });
  const links = hrefs.map(anchor);
  const addEvent = target => (name, handler) => target.set(name, [...(target.get(name) || []), handler]);
  const document = {
    readyState: loading ? 'loading' : 'complete', documentElement: {},
    get cookie() { if (blockedCookies) throw new Error('cookies disabled'); return cookies; },
    querySelectorAll: () => links,
    addEventListener: addEvent(documentEvents)
  };
  const window = { location, addEventListener: addEvent(windowEvents) };
  class MutationObserver {
    constructor(callback) { observers.push(callback); }
    observe() {}
  }
  const context = vm.createContext({ window, document, URL, URLSearchParams, MutationObserver });
  const run = () => vm.runInContext(script, context);
  run();
  return {
    links, run, documentEvents,
    read: (index = 0) => new URL(links[index].href).searchParams,
    fire: (name, target = links[0]) => (documentEvents.get(name) || []).forEach(handler => handler({ target })),
    show: () => (windowEvents.get('pageshow') || []).forEach(handler => handler()),
    add(value = checkout) { const link = anchor(value); links.push(link); return link; },
    mutate(records) { observers.forEach(callback => callback(records)); }
  };
}

for (const [path, code] of Object.entries({
  '/operacao-farda-v1-h1/': 'dpaf6373',
  '/da-prova-a-farda-v2h1/': 'dpaf6860',
  '/da-prova-a-farda-v1h6/': 'dpaf6869',
  '/da-prova-a-farda-v2h6-27/': 'dpaf7028'
})) {
  test('acesso direto identifica ' + path, () => {
    const page = fixture({ path });
    assert.equal(page.read().get('xcod'), code);
    assert.equal(page.read().get('off'), '0phj7mw3');
    assert.equal(page.read().get('checkoutMode'), '10');
    assert.equal(page.read().get('utm_source'), null);
  });
}

test('preserva o contrato historico de pipes dentro dos nomes', () => {
  const page = fixture({ query: '?' + new URLSearchParams({ utm_source: 'facebook', utm_medium: 'Grupo | Teste', utm_campaign: 'Acao & Revisao + bonus', utm_content: 'Criativo | A' }) });
  assert.equal(page.read().get('sck'), 'facebook|Grupo | Teste|Acao & Revisao + bonus||Criativo | A|');
  assert.equal(page.read().get('utm_medium'), 'Grupo | Teste');
  assert.equal(page.read().get('utm_campaign'), 'Acao & Revisao + bonus');
});

test('o parser entregue em 05/09 recupera nomes completos e posicoes vazias', () => {
  const page = fixture({ query: '?' + new URLSearchParams({ utm_source: 'meta-ads', utm_medium: 'Grupo | A', utm_campaign: 'Campanha | B', utm_content: 'Criativo | C', fbclid: 'click-teste' }) });
  const parsed = vm.runInNewContext(historicalParser + '\nparseTrackingString(value)', {
    value: page.read().get('sck'),
    safeDecode(value) { try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); } },
    normalizeKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '_'); }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    utm_source: 'meta-ads', utm_medium: 'Grupo | A', utm_campaign: 'Campanha | B',
    utm_content: '', utm_term: 'Criativo | C', utm_id: 'click-teste'
  });
});

test('cookie bloqueado nao interrompe a identificacao', () => {
  const page = fixture({ blockedCookies: true });
  assert.equal(page.read().get('xcod'), 'dpaf7028');
});

test('mantem identificadores Meta existentes sem renovar o timestamp', () => {
  const page = fixture({ query: '?fbclid=teste', cookies: '_fbp=fb.1.123.456; _fbc=fb.1.123.teste' });
  assert.equal(page.read().get('fbc'), 'fb.1.123.teste');
  assert.equal(page.read().get('fbp'), 'fb.1.123.456');
});

test('cookie malformado nao interrompe a identificacao', () => {
  const page = fixture({ cookies: '_fbp=%broken' });
  assert.equal(page.read().get('xcod'), 'dpaf7028');
});

test('aguarda botoes do corpo quando o script carrega antes deles', () => {
  const page = fixture({ hrefs: [], loading: true });
  page.add();
  page.fire('DOMContentLoaded');
  assert.equal(page.read().get('xcod'), 'dpaf7028');
});

for (const event of ['pointerdown', 'click', 'auxclick', 'contextmenu', 'focusin']) {
  test('identifica botao tardio antes de ' + event, () => {
    const page = fixture({ hrefs: [] });
    const link = page.add();
    page.fire(event, { closest: () => link });
    assert.equal(page.read().get('xcod'), 'dpaf7028');
  });
}

test('observa botao inserido sem esperar clique', async () => {
  const page = fixture({ hrefs: [] });
  const link = page.add();
  page.mutate([{ type: 'childList', addedNodes: [link] }]);
  await Promise.resolve();
  assert.equal(page.read().get('xcod'), 'dpaf7028');
});

test('recupera href substituido depois do carregamento', async () => {
  const page = fixture();
  page.links[0].href = checkout;
  page.mutate([{ type: 'attributes', target: page.links[0] }]);
  await Promise.resolve();
  assert.equal(page.read().get('xcod'), 'dpaf7028');
});

test('retorno pela navegacao preserva a identificacao', () => {
  const page = fixture();
  page.links[0].href = checkout;
  page.show();
  assert.equal(page.read().get('xcod'), 'dpaf7028');
});

test('nao duplica parametros ou ouvintes', () => {
  const page = fixture({ hrefs: [checkout + '&xcod=velho&xcod=duplicado'], query: '?utm_source=teste' });
  page.run();
  for (let i = 0; i < 3; i++) page.fire('click');
  assert.equal(page.read().getAll('xcod').length, 1);
  assert.equal(page.read().getAll('utm_source').length, 1);
  assert.equal(page.documentEvents.get('click').length, 1);
});

test('preserva SCK explicito quando nao ha UTMs', () => {
  const page = fixture({ query: '?sck=origem%7Ccampanha' });
  assert.equal(page.read().get('sck'), 'origem|campanha');
});

test('nao altera links de outros produtos, destinos, portas ou protocolos', () => {
  const hrefs = ['#lote', 'https://example.com/', 'https://pay.hotmart.com/OUTRO', 'http://pay.hotmart.com/V107140616F', 'https://pay.hotmart.com:444/V107140616F', 'https://usuario@pay.hotmart.com/V107140616F'];
  assert.deepEqual(fixture({ hrefs }).links.map(a => a.href), hrefs);
});

test('nao atua em outras paginas nem no editor', () => {
  assert.equal(fixture({ path: '/outro-produto/' }).links[0].href, checkout);
  assert.equal(fixture({ query: '?elementor-preview=7028' }).links[0].href, checkout);
});
