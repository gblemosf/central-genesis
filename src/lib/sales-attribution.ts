export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

export function safeWebUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

const knownPages: Record<string, string> = {
  dpaf6373: "https://bravuscursos.com.br/operacao-farda-v1-h1/",
  dpaf6860: "https://bravuscursos.com.br/da-prova-a-farda-v2h1/",
  dpaf6869: "https://bravuscursos.com.br/da-prova-a-farda-v1h6/",
  dpaf7028: "https://bravuscursos.com.br/da-prova-a-farda-v2h6-27/",
};

export interface SaleAttribution {
  source: string;
  medium: string;
  campaign: string;
  content: string;
  term: string;
  id: string;
  page: string | null;
  code: string;
  raw: string;
}

export function saleAttribution(
  input: unknown,
  productId?: string,
): SaleAttribution {
  const origin = record(input);
  const utm = record(origin.utm);
  const raw = text(origin.sck);
  const code = text(origin.xcod);
  // The Bravus contract uses bare pipes as separators and spaced pipes inside names.
  const parts = raw.split(/(?<!\s)\||\|(?!\s)/).map((value) => value.trim());
  const fields = [
    "source",
    "medium",
    "campaign",
    "content",
    "term",
    "id",
  ] as const;
  const parsed: Record<string, string> = {};
  if (raw.includes("utm_")) {
    const query = new URLSearchParams(
      raw.includes("?") ? raw.split("?").slice(1).join("?") : raw,
    );
    for (const field of fields) parsed[field] = query.get(`utm_${field}`) ?? "";
  } else if (parts.length <= 6) {
    fields.forEach((field, index) => {
      parsed[field] = parts[index] ?? "";
    });
  } else {
    // Ambiguous legacy strings are kept intact instead of guessing campaign boundaries.
    parsed.source = parts[0] ?? "";
  }
  const result = Object.fromEntries(
    fields.map((field) => [
      field,
      text(utm[field]) || text(origin[`utm_${field}`]) || parsed[field] || "",
    ]),
  ) as Record<(typeof fields)[number], string>;
  return {
    ...result,
    raw,
    code,
    page:
      safeWebUrl(origin.landing_url || origin.page_url || origin.page) ??
      (productId === "8304193" ? (knownPages[code] ?? null) : null),
  };
}
