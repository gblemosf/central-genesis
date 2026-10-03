import { describe, expect, it } from "vitest";
import { normalizeAssinyPayload } from "./normalize";
import { prepareAssinyPayload } from "./payload";
const contract = { version: 1, amountUnit: "cents", sourceProjectId: "source-project" };
const product = (id: string, name: string) => ({ id, name });
function purchase() { return { event: "approved_purchase", data: {
  client: { full_name: "Pessoa Teste", email: "test@example.invalid", phone: "+5511999999999" },
  metadata: { utm_source: "meta", url_parameters: { utm_campaign: "campanha", page_url: "https://example.invalid/scd", fbclid: "click" }, event_source_url: "https://pay.assiny.com.br/test" },
  offer: { id: "00000000-0000-4000-8000-000000000010", name: "Principal", amount: 29700, amount_assiny: 1772, amount_client: 27928,
    product: product("00000000-0000-4000-8000-000000000001", "Sistema Capital Digital"), order_bumps: [
      { id: "00000000-0000-4000-8000-000000000011", name: "Acervo", product_price: 4700, amount_assiny: 300, amount_client: 4400,
        product: product("00000000-0000-4000-8000-000000000002", "Acervo") }] },
  transaction: { id: "00000000-0000-4000-8000-000000000099", project: { id: "source-project" }, status: "paid", amount: 34400, fee_amount: 2072, net_amount: 32328,
    created_at: "2026-10-02T20:57:03Z", updated_at: "2026-10-02T20:57:10Z", currency: "BRL", payment_type: "PIX", installments: 1,
    commissions: [{ amount: 16164, user: "Produtor A" }, { amount: 16164, user: "Produtor B" }] } } }; }

describe("Assiny documented normalization", () => {
  it("keeps exact item fees and net, shared tracking and unknown recipient payout", () => {
    const result = normalizeAssinyPayload(purchase(), contract).value!;
    expect(result).toMatchObject({ provider: "assiny", status: "paid", financial: { gross: 344, platform_fee: 20.72, net_after_fees: 323.28, payout: null },
      attribution: { utm: { source: "meta", campaign: "campanha" }, identifiers: { fbclid: "click" } } });
    expect(result.items).toMatchObject([{ product_name: "Sistema Capital Digital", is_order_bump: false, financial: { gross: 297, platform_fee: 17.72, net_after_fees: 279.28 } },
      { product_name: "Acervo", is_order_bump: true, financial: { gross: 47, platform_fee: 3, net_after_fees: 44 } }]);
    expect(normalizeAssinyPayload(purchase(), { ...contract, payoutRecipient: "Produtor A" }).value?.financial.payout).toBe(161.64);
    expect(normalizeAssinyPayload(purchase(), { ...contract, payoutRecipient: "Absent" }).value?.financial.payout).toBeNull();
  });
  it("quarantines mismatched invoice/item totals, fees and invalid fake products", () => {
    const p = purchase(); p.data.transaction.net_amount=40000;
    expect(normalizeAssinyPayload(p, contract).reason).toBe("financial_reconciliation_failed");
    p.data.transaction.amount=1;
    expect(normalizeAssinyPayload(p, contract).reason).toBe("item_total_mismatch");
    p.data.offer.product.id="fake-test-id";
    expect(normalizeAssinyPayload(p, contract).reason).toBe("invalid_items");
  });
  it("does not invent monetary units, source identity, status or missing dates", () => {
    expect(normalizeAssinyPayload(purchase(), {}).reason).toBe("awaiting_contract");
    expect(normalizeAssinyPayload(purchase(), { ...contract, sourceProjectId: "another-project" }).reason).toBe("source_project_mismatch");
    const p = purchase(); p.data.transaction.status="pending";
    expect(normalizeAssinyPayload(p, contract).reason).toBe("status_mismatch");
    p.data.transaction.status="paid";
    p.data.transaction.updated_at="invalid";
    expect(normalizeAssinyPayload(p, contract).reason).toBe("invalid_timestamp");
  });
  it("accepts documented abandonment without a transaction and never counts it as a sale", () => {
    const data = purchase().data;
    const result = normalizeAssinyPayload({ event: "abandoned_checkout", data: { offer: { ...data.offer, project_id: "source-project" }, client: data.client,
      metadata: data.metadata, created_at: "2026-10-02T20:57:03Z" } }, contract).value!;
    expect(result).toMatchObject({ status: "abandoned", external_kind: "lead", financial: { gross: 344, platform_fee: null, net_after_fees: null } });
    expect(result.transaction_id).toMatch(/^lead:/);
    expect(result.attribution.landing_url).toBe("https://example.invalid/scd");
  });
  it("supports the UI delivery variant, status reversals and smart installments", () => {
    const p=purchase(); p.event="refunded_purchase"; p.data.transaction.status="refunded";
    expect(normalizeAssinyPayload(p,contract).value?.status).toBe("refunded");
    const ui={...p,event:"abandoned_purchase",data:{...p.data,transaction:{...p.data.transaction,status:"",updated_at:{Time:"2026-10-02T20:57:03Z",Valid:true},smart_installment:{total_installments:8}}}};
    expect(normalizeAssinyPayload(ui,contract).value).toMatchObject({ status:"abandoned", payment:{installments:8} });
    expect(normalizeAssinyPayload({...p,event:"subscription_canceled"},contract).reason).toBe("unsupported_event");
  });
  it("does not present the checkout URL as the landing-page history", () => {
    const p=purchase(); delete (p.data.metadata.url_parameters as Record<string,unknown>).page_url;
    expect(normalizeAssinyPayload(p,contract).value?.attribution.landing_url).toBeUndefined();
  });
  it("redacts identity/payment/infrastructure values without removing tracking", () => {
    expect(prepareAssinyPayload({ data: { client:{ document:"private",address:{street:"private"},email:"test@example.invalid" }, metadata:{ip:"private",user_agent:"private",utm_source:"meta",url_parameters:{organizationDocument:"private"}},transaction:{additional_data:{PIX:{qr_code:"private"}}}} }).payload)
      .toEqual({data:{client:{email:"test@example.invalid"},metadata:{utm_source:"meta",url_parameters:{}},transaction:{}}});
  });
});
