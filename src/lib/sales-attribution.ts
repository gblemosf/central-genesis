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

// Legacy gateway payloads stored their checkout URL as landing_url. Classify
// only recognizable checkout addresses; never derive a landing page from UTMs.
export function isCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^(?:pay|checkout|pagamento)\.(?:hub\.la|hotmart\.com|payt\.com\.br|assiny\.com\.br)$/.test(url.hostname) ||
      /^\/checkout(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
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
  checkoutUrl?: string | null;
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
  const pageCandidates = [origin.landing_url, origin.page_url, origin.page]
    .map(safeWebUrl).filter((value): value is string => Boolean(value));
  const checkoutUrl = safeWebUrl(origin.checkout_url) ??
    pageCandidates.find(isCheckoutUrl) ?? null;
  return {
    ...result,
    raw,
    code,
    page:
      pageCandidates.find((url) => url !== checkoutUrl && !isCheckoutUrl(url)) ??
      (productId === "8304193" ? (knownPages[code] ?? null) : null),
    checkoutUrl,
  };
}
