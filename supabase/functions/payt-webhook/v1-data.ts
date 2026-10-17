export type PaytObject = Record<string, unknown>;
export const object = (value: unknown): PaytObject => value && typeof value === "object" && !Array.isArray(value) ? value as PaytObject : {};
export const text = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
export const cents = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 100_000_000_000_000 ? value : null;

export function webUrl(value: unknown) {
  try {
    const url = new URL(text(value, 8192));
    if (!["https:", "http:"].includes(url.protocol)) return undefined;
    url.username = ""; url.password = ""; url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/token|secret|password|api_key|integration_key|cpf|cnpj|document|email|phone|pix/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return undefined; }
}

// The account UI and delivery samples confirm this timezone. Intl also handles
// historical daylight-saving offsets; the server's local timezone is irrelevant.
export function paytTime(value: unknown, timezone: unknown) {
  if (timezone !== "America/Sao_Paulo" || typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const localTime = (time: number) => {
    const p = Object.fromEntries(format.formatToParts(new Date(time)).map(part => [part.type, part.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  };
  let time = target;
  for (let i = 0; i < 3; i++) time += target - localTime(time);
  const date = new Date(target);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59 || localTime(time) !== target) return null;
  if (time < Date.UTC(2000, 0, 1) || time > Date.now() + 86_400_000) return null;
  return new Date(time + Number((match[7] || "").padEnd(3, "0").slice(0, 3))).toISOString();
}

export function paytTracking(payload: PaytObject) {
  const link = object(payload.link), sources = object(link.sources), params = object(link.query_params);
  const origin = object(object(object(payload.customer).origin).query_params);
  const checkout = webUrl(link.url), query = checkout ? new URL(checkout).searchParams : new URLSearchParams();
  const field = (name: string) => text(sources[name], 4000) || text(params[name], 4000) || query.get(name) || text(origin[name], 4000);
  const utm = Object.fromEntries(["source", "medium", "campaign", "content", "term", "id"].map(name => [name, field(`utm_${name}`)]).filter(([, value]) => value));
  const identifiers = Object.fromEntries(["src", "fbclid", "fbp", "fbc", "gclid", "campaign_id", "adset_id", "ad_id"].map(name => [name, field(name)]).filter(([, value]) => value));
  const landing = webUrl(params.page_url || params.landing_url);
  return { checkout, attribution: { utm, identifiers, ...(landing ? { landing_url: landing } : {}) } };
}
