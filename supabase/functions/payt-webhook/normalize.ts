export type JsonObject = Record<string, unknown>;
export type PaytStatus = "paid" | "refunded" | "chargeback" | "pending" | "abandoned" | "failed" | "expired" | "other";

// Field paths and amount units are configured only after checking a real PayT V1 sample.
// Unconfigured or changed contracts go to the durable inbox, never to financial totals.
export interface PaytContract {
  version: 1;
  statusPath: string;
  statuses: Record<string, PaytStatus>;
  transactionPath: string;
  productIdPath: string;
  productNamePath?: string;
  occurredAtPath: string;
  timestampUnit: "iso" | "seconds" | "milliseconds";
  grossPath: string;
  feePath?: string;
  payoutPath?: string;
  amountUnit: "major" | "cents";
  currencyPath?: string;
  defaultCurrency?: string;
  contactNamePath?: string;
  contactEmailPath?: string;
  contactPhonePath?: string;
  checkoutUrlPath?: string;
  offerIdPath?: string;
  offerNamePath?: string;
  paymentMethodPath?: string;
  installmentsPath?: string;
  utmSourcePath?: string;
  utmMediumPath?: string;
  utmCampaignPath?: string;
  utmContentPath?: string;
  utmTermPath?: string;
  srcPath?: string;
  testPath?: string;
  testValues?: string[];
}

export function objectValue(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

const sensitiveKeys = /^(?:.*(?:token|secret|password|authorization|api_?key|integration_?key|chave|document|cpf|cnpj|pix|qrcode|barcode|address|endereco).*|card|credit_?card|credit_?card_?number|cvv|cvc|pan|cookies|headers)$/i;

export function sanitizePaytPayload(value: unknown, depth = 0): unknown {
  if (depth > 30) throw new Error("Payload nesting limit exceeded");
  if (Array.isArray(value)) return value.map(item => sanitizePaytPayload(item, depth + 1));
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      for (const key of [...url.searchParams.keys()]) if (sensitiveKeys.test(key)) url.searchParams.delete(key);
      url.username = ""; url.password = ""; url.hash = "";
      return url.toString();
    } catch { return value; }
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject)
    .filter(([key]) => !sensitiveKeys.test(key) && !["__proto__", "constructor", "prototype"].includes(key))
    .map(([key, item]) => [key, sanitizePaytPayload(item, depth + 1)]));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value as JsonObject)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function paytPayloadKey(payload: JsonObject) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(payload)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function field(payload: JsonObject, path: unknown): unknown {
  if (typeof path !== "string" || !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(path)) return undefined;
  const segments = path.split(".");
  if (segments.length > 15 || segments.some(segment => ["__proto__", "prototype", "constructor"].includes(segment))) return undefined;
  let value: unknown = payload;
  for (const segment of segments) {
    const object = objectValue(value);
    if (!Object.hasOwn(object, segment)) return undefined;
    value = object[segment];
  }
  return value;
}

function text(value: unknown, max = 300) {
  return (typeof value === "string" || typeof value === "number") ? String(value).trim().slice(0, max) : "";
}

function money(value: unknown, unit: PaytContract["amountUnit"]): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (unit === "cents" && !Number.isSafeInteger(number))) return null;
  const amount = unit === "cents" ? number / 100 : number;
  if (amount >= 1_000_000_000_000) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function normalizePaytPayload(payload: JsonObject, input: unknown) {
  const config = objectValue(input);
  if (config.version !== 1) return { reason: "awaiting_contract" as const };
  const contract = config as unknown as PaytContract;
  const statuses = objectValue(contract.statuses);
  const statusValue = text(field(payload, contract.statusPath), 120);
  const status = Object.hasOwn(statuses, statusValue) ? statuses[statusValue] : undefined;
  if (!["paid", "refunded", "chargeback", "pending", "abandoned", "failed", "expired", "other"].includes(String(status))) {
    return { reason: "unknown_status" as const };
  }
  const transactionId = text(field(payload, contract.transactionPath), 301);
  const productId = text(field(payload, contract.productIdPath), 301);
  const gross = money(field(payload, contract.grossPath), contract.amountUnit);
  if (!["major", "cents"].includes(contract.amountUnit) || !transactionId || transactionId.length > 300 || !productId || productId.length > 300 || gross === null) {
    return { reason: "invalid_identity_or_amount" as const };
  }
  const rawTime = field(payload, contract.occurredAtPath);
  let time: number = NaN;
  if (contract.timestampUnit === "iso" && typeof rawTime === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/.test(rawTime)) {
    time = Date.parse(rawTime);
  } else if (["seconds", "milliseconds"].includes(contract.timestampUnit) && /^\d+$/.test(String(rawTime))) {
    time = Number(rawTime) * (contract.timestampUnit === "seconds" ? 1_000 : 1);
  }
  if (!Number.isFinite(time) || time < Date.UTC(2000, 0, 1) || time > Date.now() + 86_400_000) {
    return { reason: "invalid_timestamp" as const };
  }
  const currency = (text(field(payload, contract.currencyPath), 4) || text(contract.defaultCurrency, 4)).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { reason: "invalid_currency" as const };
  const fee = money(field(payload, contract.feePath), contract.amountUnit);
  const payout = money(field(payload, contract.payoutPath), contract.amountUnit);
  if ((contract.feePath && field(payload, contract.feePath) != null && fee === null) ||
    (contract.payoutPath && field(payload, contract.payoutPath) != null && payout === null) ||
    (fee !== null && fee > gross)) return { reason: "invalid_financial_detail" as const };
  let checkoutUrl: URL | undefined;
  try {
    const candidate = new URL(text(field(payload, contract.checkoutUrlPath), 8_192));
    if (["https:", "http:"].includes(candidate.protocol)) {
      for (const key of [...candidate.searchParams.keys()]) if (sensitiveKeys.test(key)) candidate.searchParams.delete(key);
      candidate.username = "";
      candidate.password = "";
      checkoutUrl = candidate;
    }
  } catch { /* URL is optional. */ }
  const utm = Object.fromEntries((["source", "medium", "campaign", "content", "term"] as const).map(name => {
    const path = contract[`utm${name[0].toUpperCase()}${name.slice(1)}Path` as keyof PaytContract];
    return [name, text(field(payload, path), 4_000) || checkoutUrl?.searchParams.get(`utm_${name}`) || ""];
  }).filter(([, value]) => value));
  const src = text(field(payload, contract.srcPath), 1_000) || checkoutUrl?.searchParams.get("src") || "";
  return {
    value: {
      sandbox: Boolean(contract.testPath && Array.isArray(contract.testValues) && contract.testValues.includes(String(field(payload, contract.testPath)))),
      status, transaction_id: transactionId, product_external_id: productId,
      product_name: text(field(payload, contract.productNamePath), 500) || productId,
      occurred_at: new Date(time).toISOString(), currency,
      financial: { gross, platform_fee: fee, net_after_fees: fee === null ? null : Math.round((gross - fee) * 100) / 100,
        payout, payout_source: payout === null ? "unknown" : "payt_reported" },
      contact: { name: text(field(payload, contract.contactNamePath)),
        email: text(field(payload, contract.contactEmailPath), 254).toLowerCase(),
        phone: text(field(payload, contract.contactPhonePath), 40) },
      attribution: { utm, identifiers: src ? { src } : {}, ...(checkoutUrl ? { landing_url: checkoutUrl.toString() } : {}) },
      offer: { id: text(field(payload, contract.offerIdPath)), name: text(field(payload, contract.offerNamePath), 500) },
      payment: { type: text(field(payload, contract.paymentMethodPath), 100), installments: text(field(payload, contract.installmentsPath), 30) },
      source_status: statusValue, contract_version: 1,
    },
  };
}
