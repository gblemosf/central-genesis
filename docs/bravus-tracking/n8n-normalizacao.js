// HOTMART -> OUTPUT NORMALIZADO PARA PLANILHA
// n8n Code node: selecione "Run Once for All Items"
// Correção do SCK: preserva os pipes com espaços dentro dos nomes.
// Ordem: source|medium|campaign|content|term|id.
// Página de origem: recebe xcod e preenche Pagina_Origem, Page_URL e Page_Path.
//
// Aceita:
// - payload direto da Hotmart;
// - body;
// - body.body;
// - request.body;
// - payload;
// - postback legado.
//
// Também converte eventos abreviados:
// APPROVED -> PURCHASE_APPROVED
// EXPIRED -> PURCHASE_EXPIRED
// CANCELED -> PURCHASE_CANCELED etc.
//
// REGRA DE ABANDONO:
// PURCHASE_OUT_OF_SHOPPING_CART é convertido em CART_ABANDONMENT.
// O abandono somente gera saída quando existe telefone válido.

const HOTMART_CONFIG = {
  maxOrderBumps: 3,

  // Códigos enviados pelos botões das três páginas no parâmetro xcod.
  paginasOrigem: {
    dpaf6373: 'https://bravuscursos.com.br/operacao-farda-v1-h1/',
    dpaf6860: 'https://bravuscursos.com.br/da-prova-a-farda-v2h1/',
    dpaf6869: 'https://bravuscursos.com.br/da-prova-a-farda-v1h6/',
    dpaf7028: 'https://bravuscursos.com.br/da-prova-a-farda-v2h6-27/'
  },

  produtoPrincipal: {
    id: '8304193',
    nome: 'OPERAÇÃO DA PROVA À FARDA',
    offerCodes: [
      'euhwd10b',
      'z1tmwfbq'
    ]
  },

  orderBumps: [
    {
      id: '',
      nome: '',
      offerCodes: []
    },
    {
      id: '',
      nome: '',
      offerCodes: []
    },
    {
      id: '',
      nome: '',
      offerCodes: []
    }
  ]
};

const EVENTOS_DE_COMPRA_PERMITIDOS = new Set([
  'PURCHASE_APPROVED',
  'PURCHASE_COMPLETE',
  'CART_ABANDONMENT',
  'PURCHASE_BILLET_PRINTED',
  'PURCHASE_CANCELED',
  'PURCHASE_EXPIRED',
  'PURCHASE_DELAYED',
  'PURCHASE_PENDING',
  'PURCHASE_WAITING_PAYMENT',
  'PURCHASE_AWAITING_PAYMENT',
  'PURCHASE_DECLINED',
  'PURCHASE_REJECTED'
]);

const isObj = value =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value);

const has = value =>
  value !== undefined &&
  value !== null &&
  !isObj(value) &&
  !Array.isArray(value) &&
  String(value).trim() !== '';

const first = (...values) => {
  const found = values.find(has);

  return found === undefined || found === null
    ? ''
    : found;
};

const firstObj = (...values) =>
  values.find(isObj) || {};

const normalizeKey = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

function safeDecode(value) {
  let result = String(value || '');

  for (let index = 0; index < 3; index++) {
    try {
      const decoded = decodeURIComponent(result);

      if (decoded === result) {
        break;
      }

      result = decoded;
    } catch {
      break;
    }
  }

  return result;
}

// Ordem confirmada para o SCK deste fluxo.
// No formato recebido, | separa UTMs e " | " faz parte dos nomes.
const SCK_UTM_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id'
];

const TRACKING_KEY_ALIASES = {
  utm_source: 'utm_source',
  utmsource: 'utm_source',
  source: 'utm_source',
  src: 'utm_source',
  utm_medium: 'utm_medium',
  utmmedium: 'utm_medium',
  medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utmcampaign: 'utm_campaign',
  campaign: 'utm_campaign',
  utm_content: 'utm_content',
  utmcontent: 'utm_content',
  content: 'utm_content',
  utm_term: 'utm_term',
  utmterm: 'utm_term',
  term: 'utm_term',
  utm_id: 'utm_id',
  utmid: 'utm_id',
  id: 'utm_id'
};

function parseQuery(rawQuery) {
  const result = {};

  String(rawQuery || '')
    .replace(/^\?/, '')
    .replace(/&amp;/gi, '&')
    .replace(/[;\n\r]+/g, '&')
    .replace(/\|(?=[a-zA-Z0-9_]+[=:])/g, '&')
    .split('&')
    .forEach(part => {
      let separator = part.indexOf('=');

      if (separator === -1) {
        separator = part.indexOf(':');
      }

      if (separator === -1) {
        return;
      }

      const key = normalizeKey(
        safeDecode(part.slice(0, separator).replace(/\+/g, ' '))
      );

      // Um "=" ou ":" em um nome não transforma o SCK em query string.
      // Só aceitamos chaves de rastreamento conhecidas.
      if (!Object.prototype.hasOwnProperty.call(TRACKING_KEY_ALIASES, key)) {
        return;
      }

      const value = safeDecode(
        part.slice(separator + 1).replace(/\+/g, ' ')
      ).trim();

      result[TRACKING_KEY_ALIASES[key]] = value;
    });

  return result;
}

function splitSckFields(value) {
  const parts = [];
  let current = '';

  for (let index = 0; index < value.length; index++) {
    const char = value[index];

    // Preserva os pipes com espaços dos nomes do conjunto e da campanha.
    const pipeInsideName =
      char === '|' &&
      /\s/.test(value[index - 1] || '') &&
      /\s/.test(value[index + 1] || '');

    if (char === '|' && !pipeInsideName) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  parts.push(current);

  // Formato deste fluxo, inclusive com posições vazias ou finais omitidas.
  if (parts.length > 1 && parts.length <= SCK_UTM_FIELDS.length) {
    return parts;
  }

  const simpleParts = value.split('|');

  // Compatibilidade com SCK simples, sem pipes dentro dos nomes,
  // inclusive "source | medium | campaign | content | term | id".
  if (simpleParts.length <= SCK_UTM_FIELDS.length) {
    return simpleParts;
  }

  // Sem uma separação distinguível, não existe divisão confiável.
  return null;
}

function parsePositionalSck(value) {
  const parts = splitSckFields(value);

  if (!parts) {
    return {
      tracking_error:
        'SCK ambíguo: não foi possível separar as seis UTMs. ' +
        'Neste fluxo, use | entre campos e " | " dentro dos nomes, ' +
        'ou envie utm_source=...&utm_medium=... com os valores codificados.'
    };
  }

  const result = {};

  SCK_UTM_FIELDS.forEach((field, index) => {
    // Decodifica cada campo depois da divisão para preservar %7C nos nomes.
    result[field] = safeDecode(parts[index] || '').trim();
  });

  return result;
}

function parseTrackingString(rawValue) {
  let value = String(rawValue || '').trim();

  if (!value) {
    return {};
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    if (/^https?:\/\//i.test(value)) {
      const queryStart = value.indexOf('?');

      return queryStart === -1
        ? {}
        : parseQuery(value.slice(queryStart + 1).split('#')[0]);
    }

    const parsed = parseQuery(value);

    if (Object.keys(parsed).length > 0) {
      return parsed;
    }

    // Divide antes de decodificar: um %7C dentro do nome não é separador.
    if (value.includes('|')) {
      return parsePositionalSck(value);
    }

    // Também aceita quando o SCK inteiro chegou codificado na URL.
    const decoded = safeDecode(value).trim();

    if (decoded === value) {
      break;
    }

    value = decoded;
  }

  return parsePositionalSck(value);
}

function splitUtmifyValue(
  rawValue,
  removeTrackingSuffix = false
) {
  const original = safeDecode(rawValue).trim();

  if (!original) {
    return {
      original: '',
      name: '',
      id: ''
    };
  }

  const clean = removeTrackingSuffix
    ? original.split('::')[0].trim()
    : original;

  const match = clean.match(
    /^(.*)\|(\d{8,})\s*$/
  );

  if (!match) {
    return {
      original,
      name: clean,
      id: ''
    };
  }

  return {
    original,
    name: String(match[1] || '').trim(),
    id: String(match[2] || '').trim()
  };
}

function parseUtmId(rawValue) {
  const original = safeDecode(rawValue).trim();

  const ids = original
    .split('|')
    .map(value => value.trim())
    .filter(value => /^\d{8,}$/.test(value));

  return {
    original,
    campaignId: ids[0] || '',
    adsetId: ids[1] || '',
    adId: ids[2] || ''
  };
}

function normalizeUtmSource(rawSource) {
  const value = safeDecode(rawSource).trim();
  const key = normalizeKey(value);

  return [
    'fb',
    'facebook',
    'facebook_ads',
    'meta',
    'meta_ads'
  ].includes(key)
    ? 'Facebook-Ads'
    : value;
}

function buildUtmQuery(values) {
  return [
    ['utm_source', values.source],
    ['utm_medium', values.medium],
    ['utm_content', values.content],
    ['utm_campaign', values.campaign],
    ['utm_term', values.term],
    ['utm_id', values.id]
  ]
    .filter(([, value]) => has(value))
    .map(
      ([key, value]) =>
        `${key}=${encodeURIComponent(String(value))}`
    )
    .join('&');
}

function phoneBR(rawPhone) {
  let digits = String(rawPhone || '')
    .replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  digits = digits.replace(/^0+/, '');

  let national = digits;

  if (
    digits.startsWith('55') &&
    [12, 13].includes(digits.length)
  ) {
    national = digits.slice(2);
  }

  if (national.length === 10) {
    national =
      `${national.slice(0, 2)}9${national.slice(2)}`;
  }

  if (national.length !== 11) {
    return digits;
  }

  return `55${national}`;
}

function parseDate(rawDate) {
  if (!has(rawDate)) {
    return null;
  }

  let date;

  if (
    typeof rawDate === 'number' ||
    /^\d{10,13}$/.test(String(rawDate))
  ) {
    const number = Number(rawDate);

    date = new Date(
      number < 10000000000
        ? number * 1000
        : number
    );
  } else {
    date = new Date(rawDate);
  }

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function dateBR(rawDate) {
  const date = parseDate(rawDate);

  if (!date) {
    return {
      data: '',
      hora: '',
      dataHora: ''
    };
  }

  const data = date.toLocaleDateString(
    'pt-BR',
    {
      timeZone: 'America/Sao_Paulo'
    }
  );

  const hora = date.toLocaleTimeString(
    'pt-BR',
    {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }
  );

  return {
    data,
    hora,
    dataHora: `${data} | ${hora}`
  };
}

function splitName(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return {
    firstName: parts.shift() || '',
    lastName: parts.join(' ')
  };
}

function money(rawValue) {
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue)
      ? rawValue
      : '';
  }

  if (typeof rawValue !== 'string') {
    return '';
  }

  let value = rawValue
    .trim()
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '');

  if (!value) {
    return '';
  }

  if (
    value.includes(',') &&
    value.includes('.')
  ) {
    value =
      value.lastIndexOf(',') >
      value.lastIndexOf('.')
        ? value
            .replace(/\./g, '')
            .replace(',', '.')
        : value.replace(/,/g, '');
  } else if (value.includes(',')) {
    value = value.replace(',', '.');
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : '';
}

function sumCommission(
  commissions,
  source
) {
  const target = normalizeKey(source);

  const values = (
    Array.isArray(commissions)
      ? commissions
      : []
  )
    .filter(
      item =>
        isObj(item) &&
        normalizeKey(item.source) === target
    )
    .map(item =>
      money(
        first(
          item.value,
          item.amount,
          item.commission_value
        )
      )
    )
    .filter(value => value !== '');

  if (!values.length) {
    return '';
  }

  return Number(
    values
      .reduce(
        (sum, value) => sum + value,
        0
      )
      .toFixed(2)
  );
}

function addressText(address) {
  if (!isObj(address)) {
    return has(address)
      ? String(address).trim()
      : '';
  }

  return [
    first(
      address.address,
      address.street,
      address.logradouro
    ),
    first(
      address.number,
      address.street_number,
      address.numero
    ),
    first(
      address.complement,
      address.complemento
    ),
    first(
      address.neighborhood,
      address.district,
      address.bairro
    ),
    first(
      address.city,
      address.cidade
    ),
    first(
      address.state,
      address.uf
    ),
    first(
      address.zipcode,
      address.zip_code,
      address.postal_code,
      address.cep
    ),
    first(
      address.country,
      address.country_iso,
      address.pais
    )
  ]
    .filter(has)
    .join(', ');
}

function eventName(value) {
  return normalizeKey(value).toUpperCase();
}

function legacyEventFromStatus(statusRaw) {
  const status = eventName(statusRaw);

  if (
    [
      'APPROVED',
      'COMPLETED',
      'COMPLETE'
    ].includes(status)
  ) {
    return status === 'APPROVED'
      ? 'PURCHASE_APPROVED'
      : 'PURCHASE_COMPLETE';
  }

  if (
    [
      'BILLET_PRINTED',
      'WAITING_PAYMENT',
      'PENDING'
    ].includes(status)
  ) {
    return status === 'BILLET_PRINTED'
      ? 'PURCHASE_BILLET_PRINTED'
      : 'PURCHASE_PENDING';
  }

  if (
    [
      'CANCELED',
      'CANCELLED'
    ].includes(status)
  ) {
    return 'PURCHASE_CANCELED';
  }

  if (
    [
      'DECLINED',
      'REJECTED',
      'REFUSED'
    ].includes(status)
  ) {
    return 'PURCHASE_DECLINED';
  }

  if (status === 'EXPIRED') {
    return 'PURCHASE_EXPIRED';
  }

  if (
    [
      'DELAYED',
      'OVERDUE'
    ].includes(status)
  ) {
    return 'PURCHASE_DELAYED';
  }

  if (
    status === 'ABANDONED_CHECKOUT' ||
    status === 'ABANDONED' ||
    status === 'OUT_OF_SHOPPING_CART'
  ) {
    return 'CART_ABANDONMENT';
  }

  return '';
}

function canonicalPurchaseEvent(rawEvent) {
  const event = eventName(rawEvent);

  if (!event) {
    return '';
  }

  if (event === 'PURCHASE_OUT_OF_SHOPPING_CART') {
    return 'CART_ABANDONMENT';
  }

  if (
    event.startsWith('PURCHASE_') ||
    event === 'CART_ABANDONMENT'
  ) {
    return event;
  }

  return (
    legacyEventFromStatus(event) ||
    event
  );
}

function normalizedStatusFromEvent(eventRaw) {
  const event =
    canonicalPurchaseEvent(eventRaw);

  if (event === 'CART_ABANDONMENT') {
    return 'ABANDONED_CHECKOUT';
  }

  if (
    event === 'PURCHASE_APPROVED' ||
    event === 'PURCHASE_COMPLETE'
  ) {
    return 'APPROVED';
  }

  if (
    event === 'PURCHASE_BILLET_PRINTED' ||
    event === 'PURCHASE_PENDING' ||
    event === 'PURCHASE_WAITING_PAYMENT' ||
    event === 'PURCHASE_AWAITING_PAYMENT'
  ) {
    return 'PENDING';
  }

  if (event === 'PURCHASE_CANCELED') {
    return 'CANCELED';
  }

  if (
    event === 'PURCHASE_DECLINED' ||
    event === 'PURCHASE_REJECTED'
  ) {
    return 'DECLINED';
  }

  if (event === 'PURCHASE_EXPIRED') {
    return 'EXPIRED';
  }

  if (event === 'PURCHASE_DELAYED') {
    return 'OVERDUE';
  }

  if (event === 'PURCHASE_CHARGEBACK') {
    return 'CHARGEBACK';
  }

  if (event === 'PURCHASE_PROTEST') {
    return 'REFUND_REQUESTED';
  }

  if (event === 'PURCHASE_REFUNDED') {
    return 'REFUNDED';
  }

  return '';
}

function statusOf(eventRaw, statusRaw) {
  return (
    normalizedStatusFromEvent(eventRaw) ||
    normalizedStatusFromEvent(statusRaw) ||
    eventName(statusRaw || eventRaw)
  );
}

function purchaseEventOf(root, body) {
  const data = firstObj(
    body.data,
    root.data
  );

  const purchase = firstObj(
    data.purchase,
    body.purchase
  );

  const explicitEvent =
    canonicalPurchaseEvent(
      first(
        body.event,
        root.event
      )
    );

  if (explicitEvent) {
    return explicitEvent;
  }

  const hasPurchaseEvidence = Boolean(
    first(
      purchase.transaction,
      body.transaction,
      root.transaction,
      body.prod,
      body.product_id,
      purchase.status,
      body.status
    )
  );

  if (!hasPurchaseEvidence) {
    return '';
  }

  return legacyEventFromStatus(
    first(
      purchase.status,
      body.status,
      root.status
    )
  );
}

function buyerPhoneOf(root, body) {
  const data = firstObj(
    body.data,
    root.data
  );

  const buyer = firstObj(
    data.buyer,
    body.buyer,
    root.buyer
  );

  const phoneOriginal = first(
    buyer.checkout_phone,
    buyer.phone,
    body.phone,
    root.phone
  );

  return phoneBR(phoneOriginal);
}

function shouldProcessPurchase(
  root,
  body
) {
  const event = purchaseEventOf(
    root,
    body
  );

  if (
    !EVENTOS_DE_COMPRA_PERMITIDOS.has(event)
  ) {
    return false;
  }

  if (event === 'CART_ABANDONMENT') {
    return Boolean(
      buyerPhoneOf(root, body)
    );
  }

  return true;
}

function looksLikeHotmartPayload(value) {
  if (!isObj(value)) {
    return false;
  }

  const data = firstObj(value.data);

  return Boolean(
    has(value.event) ||
    has(value.version) ||
    isObj(data.purchase) ||
    isObj(data.product) ||
    has(value.transaction) ||
    has(value.prod)
  );
}

function extractHotmartPayloads(
  value,
  depth = 0
) {
  if (
    depth > 8 ||
    value === null ||
    value === undefined
  ) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item =>
      extractHotmartPayloads(
        item,
        depth + 1
      )
    );
  }

  if (!isObj(value)) {
    return [];
  }

  if (looksLikeHotmartPayload(value)) {
    return [value];
  }

  const candidates = [
    value.body,
    value.request?.body,
    value.payload,
    value.data?.body
  ].filter(
    candidate =>
      candidate !== undefined &&
      candidate !== null
  );

  return candidates.flatMap(candidate =>
    extractHotmartPayloads(
      candidate,
      depth + 1
    )
  );
}

function boolValue(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  return [
    'true',
    '1',
    'yes',
    'sim'
  ].includes(
    String(value || '')
      .trim()
      .toLowerCase()
  );
}

function productMatches(
  config,
  productId,
  productName,
  offerCode
) {
  const configId =
    String(config.id || '').trim();

  const currentId =
    String(productId || '').trim();

  const configName =
    normalizeKey(config.nome);

  const currentName =
    normalizeKey(productName);

  const offerCodes =
    Array.isArray(config.offerCodes)
      ? config.offerCodes
          .map(value => String(value).trim())
          .filter(Boolean)
      : [];

  return Boolean(
    (
      configId &&
      currentId &&
      configId === currentId
    ) ||
    (
      offerCode &&
      offerCodes.includes(
        String(offerCode).trim()
      )
    ) ||
    (
      configName &&
      currentName &&
      configName === currentName
    )
  );
}

function resolveItemPosition({
  isOrderBump,
  productId,
  productName,
  offerCode
}) {
  if (!isOrderBump) {
    const mapped = productMatches(
      HOTMART_CONFIG.produtoPrincipal,
      productId,
      productName,
      offerCode
    );

    return {
      ordem: 1,
      tipo: 'PRINCIPAL',
      mapped
    };
  }

  const index =
    HOTMART_CONFIG.orderBumps
      .slice(
        0,
        HOTMART_CONFIG.maxOrderBumps
      )
      .findIndex(config =>
        productMatches(
          config,
          productId,
          productName,
          offerCode
        )
      );

  if (index >= 0) {
    return {
      ordem: index + 2,
      tipo: 'ORDER_BUMP',
      mapped: true
    };
  }

  return {
    ordem: 99,
    tipo: 'ORDER_BUMP_NAO_MAPEADO',
    mapped: false
  };
}

function trackingData(
  purchase,
  root,
  body
) {
  const origin = firstObj(
    purchase.origin,
    purchase.purchase_origin,
    body.origin,
    root.origin
  );

  const sckRaw = first(
    origin.sck,
    purchase.sck,
    body.sck,
    body.source_sck,
    root.sck,
    root.query?.sck
  );

  const sck = parseTrackingString(sckRaw);

  const xcod = String(first(
    origin.xcod,
    purchase.xcod,
    body.xcod,
    root.xcod,
    root.query?.xcod
  )).trim();

  const mappedPageUrl = Object.prototype.hasOwnProperty.call(
    HOTMART_CONFIG.paginasOrigem,
    xcod
  ) ? HOTMART_CONFIG.paginasOrigem[xcod] : '';

  const sourceRaw = first(
    origin.utmsource,
    origin.utm_source,
    origin.utmSource,
    origin.source,
    origin.src,
    sck.utm_source,
    sck.source,
    root.query?.utm_source
  );

  const mediumRaw = first(
    origin.utmmedium,
    origin.utm_medium,
    origin.utmMedium,
    origin.medium,
    sck.utm_medium,
    sck.medium,
    root.query?.utm_medium
  );

  const campaignRaw = first(
    origin.utmcampaign,
    origin.utm_campaign,
    origin.utmCampaign,
    origin.campaign,
    sck.utm_campaign,
    sck.campaign,
    root.query?.utm_campaign
  );

  const contentRaw = first(
    origin.utmcontent,
    origin.utm_content,
    origin.utmContent,
    origin.content,
    sck.utm_content,
    sck.content,
    root.query?.utm_content
  );

  const termRaw = first(
    origin.utmterm,
    origin.utm_term,
    origin.utmTerm,
    origin.term,
    sck.utm_term,
    sck.term,
    root.query?.utm_term
  );

  const idRaw = first(
    origin.utmid,
    origin.utm_id,
    origin.utmId,
    sck.utm_id,
    sck.utmid,
    root.query?.utm_id
  );

  const campaign =
    splitUtmifyValue(campaignRaw);

  const medium =
    splitUtmifyValue(mediumRaw);

  const content =
    splitUtmifyValue(
      contentRaw,
      true
    );

  const existingId =
    parseUtmId(idRaw);

  const campaignId = first(
    campaign.id,
    existingId.campaignId
  );

  const adsetId = first(
    medium.id,
    existingId.adsetId
  );

  const adId = first(
    content.id,
    existingId.adId
  );

  const generatedId = [
    campaignId,
    adsetId,
    adId
  ].every(has)
    ? [
        campaignId,
        adsetId,
        adId
      ].join('|')
    : '';

  const result = {
    error: sck.tracking_error || '',

    source:
      normalizeUtmSource(sourceRaw),

    medium:
      medium.name,

    campaign:
      campaign.name,

    content:
      content.name,

    term:
      safeDecode(termRaw).trim(),

    id: first(
      generatedId,
      existingId.original
    ),

    campaignId,
    adsetId,
    adId,

    sck:
      sckRaw,

    sourceRaw,
    mediumRaw,
    campaignRaw,
    contentRaw,
    termRaw,
    idRaw,

    pageUrl: first(
      mappedPageUrl,
      origin.page_url,
      origin.pageUrl,
      origin.url,
      purchase.checkout_url,
      body.checkout_url
    )
  };

  const pageMatch = String(result.pageUrl || '').match(
    /^https?:\/\/[^/?#]+([^?#]*)/i
  );
  result.pagePath = pageMatch ? (pageMatch[1] || '/') : '';

  result.concatenated =
    buildUtmQuery(result);

  return result;
}

function normalizeV2(root, body) {
  const data = firstObj(
    body.data,
    root.data
  );

  const buyer = firstObj(
    data.buyer,
    body.buyer
  );

  const product = firstObj(
    data.product,
    body.product
  );

  const purchase = firstObj(
    data.purchase,
    body.purchase
  );

  const payment = firstObj(
    purchase.payment,
    data.payment,
    body.payment
  );

  const offer = firstObj(
    purchase.offer,
    data.offer,
    body.offer
  );

  const orderBump = firstObj(
    purchase.order_bump,
    purchase.orderBump
  );

  const commissions =
    Array.isArray(data.commissions)
      ? data.commissions
      : [];

  const event = purchaseEventOf(
    root,
    body
  );

  const status = statusOf(
    event,
    purchase.status
  );

  const transaction = String(
    first(
      purchase.transaction,
      body.transaction
    ) || ''
  ).trim();

  const parentTransaction = String(
    first(
      orderBump.parent_purchase_transaction,
      orderBump.parentPurchaseTransaction
    ) || ''
  ).trim();

  const hotmartMarkedOrderBump = boolValue(
    orderBump.is_order_bump ??
    orderBump.isOrderBump
  );

  const isOrderBump = Boolean(
    hotmartMarkedOrderBump &&
    parentTransaction &&
    parentTransaction !== transaction
  );

  const isParentPurchase = !isOrderBump;

  const invoiceKey = first(
    parentTransaction,
    transaction
  );

  const saleKey = first(
    invoiceKey,
    body.id,
    root.id
  );

  const productId = String(
    first(
      product.id,
      product.ucode
    ) || ''
  ).trim();

  const productName = first(
    product.name,
    product.title
  );

  const offerCode = String(
    first(
      offer.code,
      offer.id
    ) || ''
  ).trim();

  const position = resolveItemPosition({
    isOrderBump,
    productId,
    productName,
    offerCode
  });

  const eventDate = first(
    status === 'APPROVED'
      ? purchase.approved_date
      : '',

    status === 'REFUNDED'
      ? purchase.refund_date
      : '',

    status === 'CANCELED'
      ? purchase.cancel_date
      : '',

    purchase.order_date,
    body.creation_date,
    body.creationDate,
    root.creation_date,
    root.creationDate
  );

  const formattedDate =
    dateBR(eventDate);

  const name = splitName(
    first(
      buyer.name,
      buyer.full_name
    )
  );

  const phoneOriginal = first(
    buyer.checkout_phone,
    buyer.phone
  );

  const tracking = trackingData(
    purchase,
    root,
    body
  );

  const grossValue = money(
    first(
      purchase.full_price?.value,
      purchase.price?.value,
      purchase.original_offer_price?.value
    )
  );

  const offerValue = money(
    first(
      purchase.price?.value,
      purchase.original_offer_price?.value
    )
  );

  const producerNet = sumCommission(
    commissions,
    'PRODUCER'
  );

  const marketplaceFee = sumCommission(
    commissions,
    'MARKETPLACE'
  );

  const productKey = first(
    productId,
    normalizeKey(productName),
    offerCode,
    'SEM_PRODUTO'
  );

  const mappingError =
    position.mapped
      ? ''
      : isOrderBump
        ? `Order bump não mapeado: configure ID, nome ou offerCode para ${productName || productId || transaction}`
        : `Produto principal não mapeado: ${productName || productId || transaction}`;

  const statusFromEvent =
    normalizedStatusFromEvent(event);

  const statusFromPurchase =
    normalizedStatusFromEvent(
      purchase.status
    );

  const statusWarning =
    statusFromEvent &&
    statusFromPurchase &&
    statusFromEvent !== statusFromPurchase
      ? `Evento ${event} diverge do status interno ${eventName(purchase.status)}; o evento foi usado como fonte de verdade.`
      : '';

  const configurationMessages = [
    mappingError,
    statusWarning,
    tracking.error
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    'ID Evento': first(
      body.id,
      root.id,
      transaction
    ),

    ID_FATURA:
      invoiceKey,

    ID_TRANSACAO:
      transaction,

    ID_TRANSACAO_PAI:
      parentTransaction,

    CHAVE_VENDA:
      saleKey,

    CHAVE_ITEM:
      `${saleKey}|${productKey}`,

    Produto:
      productName,

    ID_PRODUTO:
      productId,

    CODIGO_OFERTA:
      offerCode,

    Nome: first(
      buyer.first_name,
      name.firstName
    ),

    Sobrenome: first(
      buyer.last_name,
      name.lastName
    ),

    CPF: first(
      buyer.document,
      buyer.document_number
    ),

    Email: first(
      buyer.email
    ),

    Endereço: first(
      addressText(buyer.address),
      'Sem endereço'
    ),

    Whatsapp:
      phoneBR(phoneOriginal),

    Telefone_Original:
      phoneOriginal,

    'Data / Hora':
      formattedDate.dataHora,

    Data:
      formattedDate.data,

    Hora:
      formattedDate.hora,

    Data_Garantia: first(
      purchase.warranty_expire_date,
      purchase.warrantyExpireDate
    ),

    'Método de PGTO': first(
      payment.type,
      payment.method
    ),

    Parcelas: first(
      payment.installments_number,
      payment.installments
    ),

    Motivo:
      event,

    Status:
      status,

    SCK:
      tracking.sck,

    UTM_Source:
      tracking.source,

    UTM_Medium:
      tracking.medium,

    UTM_Campaign:
      tracking.campaign,

    UTM_Content:
      tracking.content,

    UTM_Term:
      tracking.term,

    UTM_ID:
      tracking.id,

    Campaign_ID:
      tracking.campaignId,

    Adset_ID:
      tracking.adsetId,

    Ad_ID:
      tracking.adId,

    UTM_Source_Original:
      tracking.sourceRaw,

    UTM_Medium_Original:
      tracking.mediumRaw,

    UTM_Campaign_Original:
      tracking.campaignRaw,

    UTM_Content_Original:
      tracking.contentRaw,

    UTM_Term_Original:
      tracking.termRaw,

    UTM_ID_Original:
      tracking.idRaw,

    Pagina_Origem:
      tracking.pageUrl,

    Page_URL:
      tracking.pageUrl,

    Page_Path:
      tracking.pagePath,

    UTMs_Concatenadas:
      tracking.concatenated,

    Valor:
      grossValue,

    Valor_Oferta:
      offerValue,

    Valor_Fatura:
      grossValue,

    'Faturamento líquido':
      producerNet,

    Faturamento_Liquido:
      producerNet,

    Faturamento_Liquido_Fatura:
      producerNet,

    Taxa_Hotmart:
      marketplaceFee,

    Moeda: first(
      purchase.full_price?.currency_value,
      purchase.price?.currency_value,
      commissions[0]?.currency_value
    ),

    ORDEM_ITEM:
      position.ordem,

    SAIDA_SWITCH:
      position.ordem,

    TEM_DADOS:
      Boolean(productName) &&
      position.mapped,

    TIPO_ITEM:
      position.tipo,

    E_ORDER_BUMP:
      isOrderBump,

    HOTMART_IS_ORDER_BUMP:
      hotmartMarkedOrderBump,

    TRANSACAO_E_PAI:
      isParentPurchase,

    NOME_ORDER_BUMP:
      isOrderBump
        ? productName
        : '',

    VALOR_LIQUIDO_ORDER_BUMP:
      isOrderBump
        ? producerNet
        : '',

    TOTAL_ITENS_FATURA: '',
    TOTAL_ORDER_BUMPS: '',

    MAPEAMENTO_ITEM_OK:
      position.mapped,

    ERRO_CONFIGURACAO:
      configurationMessages,

    VERSAO_PAYLOAD:
      'HOTMART_WEBHOOK_V2'
  };
}

function normalizeLegacy(root, body) {
  const purchase = {
    transaction: first(
      body.transaction,
      root.transaction
    ),

    status: first(
      body.status,
      root.status
    ),

    order_date: first(
      body.purchase_date,
      body.order_date,
      root.purchase_date
    ),

    approved_date: first(
      body.confirmation_purchase_date,
      body.approved_date
    ),

    full_price: {
      value: first(
        body.price,
        body.full_price,
        body.purchase_price
      ),

      currency_value: first(
        body.currency_code_from,
        body.currency
      )
    },

    payment: {
      type: first(
        body.payment_type,
        body.payment_method
      ),

      installments_number: first(
        body.installments_number,
        body.installments
      )
    },

    offer: {
      code: first(
        body.off,
        body.offer_code
      )
    },

    origin: {
      sck: first(
        body.sck,
        body.src
      ),

      src:
        body.src,

      xcod:
        body.xcod,

      utmsource:
        body.utm_source,

      utmmedium:
        body.utm_medium,

      utmcampaign:
        body.utm_campaign,

      content:
        body.utm_content,

      term:
        body.utm_term
    },

    order_bump: {
      is_order_bump: first(
        body.is_order_bump,
        false
      ),

      parent_purchase_transaction: first(
        body.parent_purchase_transaction
      )
    }
  };

  const adapted = {
    ...body,

    event: first(
      body.event,
      legacyEventFromStatus(
        first(
          body.status,
          root.status
        )
      )
    ),

    data: {
      buyer: {
        name: first(
          body.name,
          body.buyer_name
        ),

        first_name:
          body.first_name,

        last_name:
          body.last_name,

        email: first(
          body.email,
          body.buyer_email
        ),

        document: first(
          body.doc,
          body.document
        ),

        checkout_phone: first(
          body.phone_checkout_local_code &&
          body.phone_checkout_number
            ? `${body.phone_checkout_local_code}${body.phone_checkout_number}`
            : '',

          body.phone
        ),

        address: firstObj(
          body.address,
          body.buyer_address
        )
      },

      product: {
        id: first(
          body.prod,
          body.product_id
        ),

        name: first(
          body.prod_name,
          body.product_name
        )
      },

      purchase,
      commissions: []
    }
  };

  const result =
    normalizeV2(root, adapted);

  return {
    ...result,

    VERSAO_PAYLOAD:
      'HOTMART_POSTBACK_V1_COMPAT'
  };
}

function normalizeRecord(root = {}) {
  const body = isObj(root.body)
    ? root.body
    : root;

  const data = firstObj(
    body.data,
    root.data
  );

  const looksLikeV2 =
    isObj(data) &&
    (
      has(body.version) ||
      has(body.creation_date) ||
      has(body.creationDate) ||
      isObj(data.purchase) ||
      isObj(data.product) ||
      isObj(data.buyer)
    );

  return looksLikeV2
    ? normalizeV2(root, body)
    : normalizeLegacy(root, body);
}

const records = [];

for (const item of $input.all()) {
  const json = item.json || {};

  const payloads =
    extractHotmartPayloads(json);

  for (const body of payloads) {
    const root = {
      ...json,
      body
    };

    if (
      shouldProcessPurchase(
        root,
        body
      )
    ) {
      records.push(
        normalizeRecord(root)
      );
    }
  }
}

const unique = new Map();

for (const record of records) {
  const key = [
    record.ID_TRANSACAO ||
      record['ID Evento'] ||
      '',

    record.Motivo || '',
    record.Status || '',
    record.CHAVE_ITEM || ''
  ].join('|');

  unique.set(
    key,
    record
  );
}

return Array
  .from(unique.values())
  .sort(
    (a, b) =>
      Number(
        a.ORDEM_ITEM || 999
      ) -
      Number(
        b.ORDEM_ITEM || 999
      )
  )
  .map(json => ({
    json
  }));
