export interface DailyMetricsImportRow {
  date: string;
  invest: number;
  impressions: number;
  clicks: number;
  pageviews: number;
  checkouts: number;
  core: number;
  ob1: number;
  ob2: number;
  ob3: number;
}

export interface MetricsCsvInspectionRow {
  line: number;
  raw: Record<string, string>;
  data: DailyMetricsImportRow;
}

export interface MetricsCsvInspection {
  delimiter: string;
  headers: string[];
  rows: MetricsCsvInspectionRow[];
  errors: { line?: number; message: string }[];
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
  core: ["core", "vendas", "vendas_core"],
  ob1: ["ob1", "vendas_ob1", "order_bump_1"],
  ob2: ["ob2", "vendas_ob2", "order_bump_2"],
  ob3: ["ob3", "vendas_ob3", "order_bump_3"],
} as const;

type CanonicalHeader = keyof typeof headerAliases;

const requiredHeaders = Object.keys(headerAliases) as CanonicalHeader[];

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
  const scores = new Map<string, number>([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index += 1;
      else quoted = !quoted;
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
  return value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day;
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

function parseNumber(value: string, line: number, field: string, integer = false) {
  const trimmed = value.trim();
  if (!trimmed) throw new MetricsCsvError(`${field} nao pode ficar vazio.`, line);
  const parenthesized = /^\(.*\)$/.test(trimmed);
  let normalized = trimmed
    .replace(/[\s\u00a0]/g, "")
    .replace(/^R\$/i, "")
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
  if (parsed < 0) throw new MetricsCsvError(`${field} nao pode ser negativo.`, line);
  return parsed;
}

function columnMap(headers: string[]) {
  const result = new Map<CanonicalHeader, number>();
  headers.forEach((header, index) => {
    const canonical = canonicalHeader(header);
    if (!canonical) return;
    if (result.has(canonical)) {
      throw new MetricsCsvError(`a coluna ${canonical} aparece mais de uma vez.`);
    }
    result.set(canonical, index);
  });
  const missing = requiredHeaders.filter((header) => !result.has(header));
  if (missing.length) {
    throw new MetricsCsvError(`colunas obrigatorias ausentes: ${missing.join(", ")}.`);
  }
  return result;
}

function fieldFor(fields: string[], columns: Map<CanonicalHeader, number>, header: CanonicalHeader) {
  return fields[columns.get(header) ?? -1] ?? "";
}

function parseRow(fields: string[], line: number, columns: Map<CanonicalHeader, number>) {
  return {
    date: parseDate(fieldFor(fields, columns, "date"), line),
    invest: parseNumber(fieldFor(fields, columns, "invest"), line, "invest"),
    impressions: parseNumber(fieldFor(fields, columns, "impressions"), line, "impressions", true),
    clicks: parseNumber(fieldFor(fields, columns, "clicks"), line, "clicks", true),
    pageviews: parseNumber(fieldFor(fields, columns, "pageviews"), line, "pageviews", true),
    checkouts: parseNumber(fieldFor(fields, columns, "checkouts"), line, "checkouts", true),
    core: parseNumber(fieldFor(fields, columns, "core"), line, "core", true),
    ob1: parseNumber(fieldFor(fields, columns, "ob1"), line, "ob1", true),
    ob2: parseNumber(fieldFor(fields, columns, "ob2"), line, "ob2", true),
    ob3: parseNumber(fieldFor(fields, columns, "ob3"), line, "ob3", true),
  } satisfies DailyMetricsImportRow;
}

export function inspectMetricsCsv(text: string): MetricsCsvInspection {
  const normalizedText = text.replace(/^\uFEFF/, "");
  const inspection: MetricsCsvInspection = {
    delimiter: detectDelimiter(normalizedText),
    headers: [],
    rows: [],
    errors: [],
  };
  let parsedRows: ReturnType<typeof parseDelimited>;
  try {
    parsedRows = parseDelimited(normalizedText);
  } catch (error) {
    const csvError = error instanceof MetricsCsvError
      ? error
      : new MetricsCsvError("nao foi possivel ler o arquivo.");
    inspection.errors.push({ line: csvError.line, message: csvError.message });
    return inspection;
  }
  if (parsedRows.length < 2) {
    inspection.errors.push({ message: "O arquivo nao possui dados." });
    return inspection;
  }
  if (parsedRows.length > 10_001) {
    inspection.errors.push({ message: "O arquivo excede o limite de 10 mil linhas." });
    return inspection;
  }

  inspection.headers = parsedRows[0].fields.map((header) => header.trim());
  let columns: Map<CanonicalHeader, number>;
  try {
    columns = columnMap(inspection.headers);
  } catch (error) {
    const csvError = error instanceof MetricsCsvError
      ? error
      : new MetricsCsvError("cabecalhos invalidos.");
    inspection.errors.push({ message: csvError.message });
    return inspection;
  }

  const dates = new Set<string>();
  for (const { fields, line } of parsedRows.slice(1)) {
    try {
      const data = parseRow(fields, line, columns);
      if (dates.has(data.date)) {
        throw new MetricsCsvError(`a data ${data.date} aparece mais de uma vez.`, line);
      }
      dates.add(data.date);
      inspection.rows.push({
        line,
        raw: Object.fromEntries(
          inspection.headers.map((header, index) => [header || `coluna_${index + 1}`, fields[index] ?? ""]),
        ),
        data,
      });
    } catch (error) {
      const csvError = error instanceof MetricsCsvError
        ? error
        : new MetricsCsvError("linha invalida.", line);
      inspection.errors.push({ line, message: csvError.message });
    }
  }
  return inspection;
}

export function parseMetricsCsv(text: string) {
  const inspection = inspectMetricsCsv(text);
  const error = inspection.errors[0];
  if (error) throw new MetricsCsvError(error.message);
  return inspection.rows.map((row) => row.data);
}
