// Transport preparation only. No Assiny event/transaction/amount fields are assumed.
const privateKeys = /^(authorization|cookie|setcookie|headers|password|secret|clientsecret|accesstoken|refreshtoken|token|webhooktoken|apikey|hottok|cpf|cnpj|document|documentnumber|address|billingaddress|shippingaddress|card|cardnumber|cvv|pixcode|pixqrcode)$/;

function cleanString(value: string) {
  // Prevent delivery credentials embedded in URLs from entering the review inbox.
  return value.replace(/([?&](?:token|access_token|api_key|secret)=)[^&#\s]*/gi, "$1[redacted]");
}

export function prepareAssinyPayload(body: unknown): { payload: Record<string, unknown>; canonical: string } {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.keys(body).length) throw new Error("JSON object required");
  function visit(value: unknown, depth: number, redact: boolean): unknown {
    if (depth > 32) throw new Error("Payload nesting limit exceeded");
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1, redact));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .filter(([key]) => !redact || !privateKeys.test(key.toLowerCase().replace(/[^a-z0-9]/g, "")))
        .map(([key, item]) => [key, visit(item, depth + 1, redact)]));
    }
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid JSON number");
    return redact && typeof value === "string" ? cleanString(value) : value;
  }
  // Hash BEFORE redaction: distinct deliveries must not collapse after removing private fields.
  const canonical = JSON.stringify(visit(body, 0, false));
  const payload = visit(body, 0, true) as Record<string, unknown>;
  if (!Object.keys(payload).length) throw new Error("Event data required");
  return { payload, canonical };
}

export async function assinyDeliveryKey(canonical: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
