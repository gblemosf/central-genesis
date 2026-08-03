export type MetricsCsvKind = "traffic" | "sales";

export interface TrafficMetricsImportRow {
  date: string;
  invest: number;
  impressions: number;
  clicks: number;
  pageviews: number;
  checkouts: number;
}

export interface SalesMetricsImportRow {
  date: string;
  core: number;
  ob1: number;
  ob2: number;
  ob3: number;
  ob4: number;
  ob5: number;
  up1: number;
  up2: number;
  ds1: number;
  ds2: number;
  fat_liquido: number;
}

export class MetricsCsvError extends Error {
  constructor(message: string, public line?: number) {
    super(line ? `Linha ${line}: ${message}` : message);
  }
}

const headerAliases = {
  date: ["date", "data", "dia"],
  invest: ["invest", "investment", "investimento", "gasto_trafego", "valor_investido"],
  impressions: ["impressions", "impressoes"],
  clicks: ["clicks", "cliques"],
  pageviews: [
    "pageviews",
    "page_views",
    "visualizacoes_pagina",
    "visualizacoes_de_pagina",
    "views",
  ],
  checkouts: ["checkouts", "checkout"],
  core: ["core", "vendas_core"],
  ob1: ["ob1", "order_bump_1"],
  ob2: ["ob2", "order_bump_2"],
  ob3: ["ob3", "order_bump_3"],
  ob4: ["ob4", "order_bump_4"],
  ob5: ["ob5", "order_bump_5"],
  up1: ["up1", "upsell_1"],
  up2: ["up2", "upsell_2"],
  ds1: ["ds1", "downsell_1"],
  ds2: ["ds2", "downsell_2"],
  fat_liquido: [
    "fat_liquido",
    "faturamento_liquido",
    "receita_liquida",
    "net_revenue",
    "revenue",
  ],
} as const;

type CanonicalHeader = keyof typeof headerAliases;

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canonicalHeader(value: string): CanonicalHeader | null {
  const normalized = normalizeHeader(value);
  for (const [canonical, aliases] of Object.entries(headerAliases)) {
    if ((aliases as readonly string[]).includes(normalized)) {
      return canonical as CanonicalHeader;
    }
  }
  return null;
}

function detectDelimiter(text: string) {
  const scores = new Map<string, number>([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === "\n" || character === "\r")) {
      break;
    } else if (!quoted && scores.has(character)) {
      scores.set(character, (scores.get(character) ?? 0) + 1);
    }
  }

  return [...scores].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

function parseDelimited(text: string) {
  const delimiter = detectDelimiter(text);
  const rows: { fields: string[]; line: number }[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  const finishRow = () => {
    fields.push(field);
    if (fields.some((value) => value.trim())) rows.push({ fields, line: rowLine });
    fields = [];
    field = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      fields.push(field);
      field = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      finishRow();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      line += 1;
      rowLine = line;
      continue;
    }
    if (character === "\n") line += 1;
    field += character;
  }

  if (quoted) throw new MetricsCsvError("aspas nao foram fechadas.", rowLine);
  if (field || fields.length) finishRow();
  return rows;
}

function validDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

function parseDate(value: string, line: number) {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : brazilian
      ? [Number(brazilian[3]), Number(brazilian[2]), Number(brazilian[1])]
      : null;
  if (!parts || !validDate(parts[0], parts[1], parts[2])) {
    throw new MetricsCsvError(`data invalida: "${trimmed}".`, line);
  }
  return `${String(parts[0]).padStart(4, "0")}-${String(parts[1]).padStart(2, "0")}-${String(parts[2]).padStart(2, "0")}`;
}

function parseNumber(
  value: string,
  line: number,
  field: string,
  integer = false,
  required = false,
) {
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new MetricsCsvError(`${field} nao pode ficar vazio.`, line);
    return 0;
  }
  const parenthesized = /^\(.*\)$/.test(trimmed);
  let normalized = trimmed
    .replace(/[\s\u00a0]/g, "")
    .replace(/^R\$/i, "")
    .replace(/%$/, "")
    .replace(/[()]/g, "");
  if (!/^[+-]?\d[\d.,]*$/.test(normalized)) {
    throw new MetricsCsvError(`valor invalido em ${field}: "${trimmed}".`, line);
  }
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    const brazilian = /^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/.test(normalized);
    const international = /^[+-]?\d{1,3}(?:,\d{3})+\.\d+$/.test(normalized);
    if (!brazilian && !international) {
      throw new MetricsCsvError(`valor invalido em ${field}: "${trimmed}".`, line);
    }
    normalized = brazilian
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    if (/^[+-]?\d{1,3}(?:,\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/,/g, "");
    } else if (/^[+-]?\d+,\d+$/.test(normalized)) {
      normalized = normalized.replace(",", ".");
    } else {
      throw new MetricsCsvError(`valor invalido em ${field}: "${trimmed}".`, line);
    }
  } else if (dot >= 0) {
    if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, "");
    } else if (!/^[+-]?\d+\.\d+$/.test(normalized)) {
      throw new MetricsCsvError(`valor invalido em ${field}: "${trimmed}".`, line);
    }
  }

  const parsed = Number(normalized) * (parenthesized ? -1 : 1);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    throw new MetricsCsvError(`valor invalido em ${field}: "${trimmed}".`, line);
  }
  if (parsed < 0 && field !== "fat_liquido") {
    throw new MetricsCsvError(`${field} nao pode ser negativo.`, line);
  }
  return parsed;
}

function columnMap(headers: string[], required: CanonicalHeader[]) {
  const result = new Map<CanonicalHeader, number>();
  headers.forEach((header, index) => {
    const canonical = canonicalHeader(header);
    if (!canonical) return;
    if (result.has(canonical)) {
      throw new MetricsCsvError(`a coluna ${canonical} aparece mais de uma vez.`);
    }
    result.set(canonical, index);
  });
  const missing = required.filter((header) => !result.has(header));
  if (missing.length) {
    throw new MetricsCsvError(`colunas obrigatorias ausentes: ${missing.join(", ")}.`);
  }
  return result;
}

function fieldFor(
  fields: string[],
  columns: Map<CanonicalHeader, number>,
  header: CanonicalHeader,
) {
  const index = columns.get(header);
  return index === undefined ? "" : fields[index] ?? "";
}

export function parseMetricsCsv(
  text: string,
  kind: "traffic",
): TrafficMetricsImportRow[];
export function parseMetricsCsv(
  text: string,
  kind: "sales",
): SalesMetricsImportRow[];
export function parseMetricsCsv(text: string, kind: MetricsCsvKind) {
  const rows = parseDelimited(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new MetricsCsvError("o arquivo nao possui dados.");
  if (rows.length > 10_001) {
    throw new MetricsCsvError("o arquivo excede o limite de 10 mil linhas.");
  }

  const required: CanonicalHeader[] =
    kind === "traffic"
      ? ["date", "invest", "impressions", "clicks", "pageviews", "checkouts"]
      : ["date", "core", "fat_liquido"];
  const columns = columnMap(rows[0].fields, required);
  const dates = new Set<string>();

  return rows.slice(1).map(({ fields, line }) => {
    const date = parseDate(fieldFor(fields, columns, "date"), line);
    if (dates.has(date)) {
      throw new MetricsCsvError(`a data ${date} aparece mais de uma vez.`, line);
    }
    dates.add(date);

    if (kind === "traffic") {
      return {
        date,
        invest: parseNumber(
          fieldFor(fields, columns, "invest"),
          line,
          "invest",
          false,
          true,
        ),
        impressions: parseNumber(
          fieldFor(fields, columns, "impressions"),
          line,
          "impressions",
          true,
          true,
        ),
        clicks: parseNumber(
          fieldFor(fields, columns, "clicks"),
          line,
          "clicks",
          true,
          true,
        ),
        pageviews: parseNumber(
          fieldFor(fields, columns, "pageviews"),
          line,
          "pageviews",
          true,
          true,
        ),
        checkouts: parseNumber(
          fieldFor(fields, columns, "checkouts"),
          line,
          "checkouts",
          true,
          true,
        ),
      };
    }

    return {
      date,
      core: parseNumber(fieldFor(fields, columns, "core"), line, "core", true, true),
      ob1: parseNumber(fieldFor(fields, columns, "ob1"), line, "ob1", true),
      ob2: parseNumber(fieldFor(fields, columns, "ob2"), line, "ob2", true),
      ob3: parseNumber(fieldFor(fields, columns, "ob3"), line, "ob3", true),
      ob4: parseNumber(fieldFor(fields, columns, "ob4"), line, "ob4", true),
      ob5: parseNumber(fieldFor(fields, columns, "ob5"), line, "ob5", true),
      up1: parseNumber(fieldFor(fields, columns, "up1"), line, "up1", true),
      up2: parseNumber(fieldFor(fields, columns, "up2"), line, "up2", true),
      ds1: parseNumber(fieldFor(fields, columns, "ds1"), line, "ds1", true),
      ds2: parseNumber(fieldFor(fields, columns, "ds2"), line, "ds2", true),
      fat_liquido: parseNumber(
        fieldFor(fields, columns, "fat_liquido"),
        line,
        "fat_liquido",
        false,
        true,
      ),
    };
  });
}
