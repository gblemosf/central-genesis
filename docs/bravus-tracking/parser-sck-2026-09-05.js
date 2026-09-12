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
