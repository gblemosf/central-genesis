import { describe, expect, it } from "vitest";
import { normalizePaytPayload, paytPayloadKey, sanitizePaytPayload, type PaytContract } from "./normalize";

// Synthetic contract exercises configured paths, not an asserted vendor schema.
const contract: PaytContract = { version: 1, statusPath: "status", statuses: { ok: "paid", waiting: "pending", refunded: "refunded" },
  transactionPath: "transaction", productIdPath: "product.id", productNamePath: "product.name", occurredAtPath: "at", timestampUnit: "iso",
  grossPath: "financial.gross", feePath: "financial.fee", payoutPath: "financial.payout", amountUnit: "cents", defaultCurrency: "BRL",
  contactEmailPath: "buyer.email", utmSourcePath: "origin.source", checkoutUrlPath: "checkout", testPath: "test", testValues: ["true"] };
const fixture = () => ({ status: "ok", transaction: "synthetic-transaction", product: { id: "synthetic-product", name: "Synthetic product" },
  at: "2026-09-15T12:00:00Z", financial: { gross: 4700, fee: 518, payout: 1966 }, buyer: { email: "buyer@example.invalid" },
  origin: { source: "meta-ads" }, checkout: "https://example.invalid/checkout?src=pagina&utm_campaign=campanha" });

describe("Payt field contract and data minimization", () => {
  it("buffers a real-shaped event until its field contract has been verified", () => {
    expect(normalizePaytPayload(fixture(), null)).toEqual({ reason: "awaiting_contract" });
  });
  it("keeps gross, platform fee, net after fees and payout distinct", () => {
    const event = normalizePaytPayload(fixture(), contract).value;
    expect(event?.financial).toEqual({ gross: 47, platform_fee: 5.18, net_after_fees: 41.82, payout: 19.66, payout_source: "payt_reported" });
    expect(event?.attribution.utm).toEqual({ source: "meta-ads", campaign: "campanha" });
    expect(event?.attribution.identifiers).toEqual({ src: "pagina" });
  });
  it("does not manufacture missing fees or payout from the gross amount", () => {
    const payload = { ...fixture(), financial: { gross: 4700 } };
    expect(normalizePaytPayload(payload, contract).value?.financial).toEqual({ gross: 47, platform_fee: null, net_after_fees: null, payout: null, payout_source: "unknown" });
  });
  it("quarantines unknown statuses and malformed amounts or timestamps", () => {
    expect(normalizePaytPayload({ ...fixture(), status: "new-status" }, contract).reason).toBe("unknown_status");
    expect(normalizePaytPayload({ ...fixture(), financial: { gross: -1 } }, contract).value).toBeUndefined();
    expect(normalizePaytPayload({ ...fixture(), financial: { gross: "47,00" } }, contract).value).toBeUndefined();
    expect(normalizePaytPayload({ ...fixture(), at: "2026-09-15T09:00:00" }, contract).reason).toBe("invalid_timestamp");
    expect(normalizePaytPayload({ ...fixture(), at: "2050-01-01T00:00:00Z" }, contract).reason).toBe("invalid_timestamp");
  });
  it("rejects inherited or prototype-polluting field mappings", () => {
    expect(normalizePaytPayload(fixture(), { ...contract, transactionPath: "constructor.name" }).value).toBeUndefined();
    expect(normalizePaytPayload({ ...fixture(), status: "constructor" }, contract).reason).toBe("unknown_status");
  });
  it("does not truncate transaction identities or accept an invalid currency prefix", () => {
    expect(normalizePaytPayload({ ...fixture(), transaction: "x".repeat(301) }, contract).reason).toBe("invalid_identity_or_amount");
    expect(normalizePaytPayload(fixture(), { ...contract, defaultCurrency: "BRLX" }).reason).toBe("invalid_currency");
  });
  it("marks configured sandbox tests explicitly", () => {
    expect(normalizePaytPayload({ ...fixture(), test: true }, contract).value?.sandbox).toBe(true);
    expect(normalizePaytPayload(fixture(), contract).value?.sandbox).toBe(false);
  });
  it("removes credentials, CPF, address, card and Pix data, retaining useful buyer and origin fields", () => {
    const payload = sanitizePaytPayload({ ...fixture(), token: "secret", integration_key: "secret", headers: { authorization: "secret" },
      buyer: { email: "buyer@example.invalid", cpf: "00000000000", address: "private" }, payment: { type: "PIX", pix_code: "private", card: { number: "private" } },
      nested: { clientSecret: "secret" }, checkout: "https://user:secret@example.invalid/?token=secret&src=pagina#secret" });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("secret"); expect(serialized).not.toContain("private");
    expect(serialized).toContain("buyer@example.invalid"); expect(serialized).toContain("src=pagina");
  });
  it("deduplicates JSON independently of object key order", async () => {
    const left = { transaction: "x", info: { a: 1, b: 2 } };
    const right = { info: { b: 2, a: 1 }, transaction: "x" };
    expect(await paytPayloadKey(left)).toBe(await paytPayloadKey(right));
  });
});
