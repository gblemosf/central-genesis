import { describe, expect, it } from "vitest";
import { normalizePaytPayload, sanitizePaytPayload } from "./normalize";

export const paytV1Contract = { version: 1, schema: "payt-v1", amountUnit: "cents", currency: "BRL", timezone: "America/Sao_Paulo", payoutScope: "producer_group" };
export function paytPurchase() {
  return { test: false, type: "order", status: "paid", transaction_id: "PAYT-EXAMPLE", cart_id: "CART-EXAMPLE", updated_at: "2026-10-03 11:21:54.000000",
    product: { code: "core", name: "Principal", type: "digital", price: 29700, quantity: 1 },
    order_bumps: [{ code: "offer-bump", name: "Oferta do adicional", product: { code: "bump", name: "Adicional", type: "digital", price: 4700, quantity: 1 } }],
    customer: { name: "Pessoa Teste", email: "test@example.invalid", phone: "5511999999999", fake_email: false },
    link: { title: "Oferta principal", url: "https://checkout.payt.com.br/example", sources: { utm_source: "FB", utm_campaign: "Campanha | A", utm_content: "Anuncio" }, query_params: { utm_id: "campaign-id", fbclid: "click-id", page_url: "https://example.invalid/vendas" } },
    transaction: { total_price: 34400, paid_at: "2026-10-03 11:21:54", payment_method: "pix", payment_status: "paid", installments: 1 },
    commission: [{ type: "platform", amount: 1817 }, { type: "producer", amount: 0 }, { type: "coproducer", amount: 16291 }, { type: "affiliation", amount: 16292 }] };
}

describe("verified PayT V1 contract", () => {
  it("keeps the invoice, producer group, item prices and shared UTMs without allocating fees", () => {
    const event = normalizePaytPayload(paytPurchase(), paytV1Contract).value!;
    expect(event).toMatchObject({ provider: "payt", status: "paid", occurred_at: "2026-10-03T14:21:54.000Z", financial_scope: "invoice",
      financial: { gross: 344, platform_fee: 18.17, net_after_fees: 325.83, payout: 162.91, payout_source: "producer_group_commission" },
      attribution: { utm: { source: "FB", campaign: "Campanha | A", id: "campaign-id" }, identifiers: { fbclid: "click-id" } } });
    expect(event.items).toMatchObject([{ product_external_id: "core", is_order_bump: false, financial: { gross: 297, platform_fee: null, net_after_fees: null } },
      { product_external_id: "bump", offer_id: "offer-bump", is_order_bump: true, financial: { gross: 47, platform_fee: null, net_after_fees: null } }]);
  });
  it("preserves charged invoice totals with installment costs instead of scaling products", () => {
    const p=paytPurchase();p.transaction.total_price=43750;
    p.commission=[{type:"platform",amount:9266},{type:"producer",amount:0},{type:"coproducer",amount:17242},{type:"affiliation",amount:17242}];
    const result=normalizePaytPayload(p,paytV1Contract).value!;
    expect(result.financial).toMatchObject({gross:437.5,net_after_fees:344.84,reconciliation:{kind:"invoice_only",gross_delta:93.5}});
    expect(result.items?.map(i=>i.financial.gross)).toEqual([297,47]);
  });
  it("uses the exact invoice amounts for its sole product", () => {
    const p=paytPurchase();p.order_bumps=[];p.transaction.total_price=29700;
    p.commission=[{type:"platform",amount:1582},{type:"producer",amount:0},{type:"coproducer",amount:14059},{type:"affiliation",amount:14059}];
    expect(normalizePaytPayload(p,paytV1Contract).value?.items?.[0].financial).toMatchObject({gross:297,platform_fee:15.82,net_after_fees:281.18});
  });
  it("never counts a refund request, Pix pending, expiry or abandonment as revenue", () => {
    const p=paytPurchase();p.status="refund_requested";
    expect(normalizePaytPayload(p,paytV1Contract).reason).toBe("non_financial_event");
    p.status="waiting_payment";p.transaction.payment_status="waiting_payment";
    expect(normalizePaytPayload(p,paytV1Contract).value).toMatchObject({status:"pending",financial:{platform_fee:null,net_after_fees:null}});
    p.status="expired";p.transaction.payment_status="expired";
    expect(normalizePaytPayload(p,paytV1Contract).value?.status).toBe("expired");
    const abandoned={...p,status:"lost_cart",transaction_id:"",transaction:undefined};
    expect(normalizePaytPayload(abandoned,paytV1Contract).value).toMatchObject({status:"abandoned",transaction_id:"CART-EXAMPLE",external_kind:"cart"});
  });
  it("requires the approved ledger amounts for a full refund whose payload has zeroed amounts", () => {
    const p=paytPurchase();p.status="canceled";p.transaction.payment_status="refunded";p.transaction.total_price=0;
    p.commission=p.commission.map(c=>({...c,amount:0}));
    expect(normalizePaytPayload(p,paytV1Contract).value).toMatchObject({status:"refunded",financial_origin:"original_sale"});
    p.transaction.payment_status="refunded_partial";
    expect(normalizePaytPayload(p,paytV1Contract).reason).toBe("partial_refund_requires_review");
  });
  it("quarantines inconsistent amounts, unknown test flags, duplicate identities and malformed dates", () => {
    const p=paytPurchase();p.commission[0].amount++;
    expect(normalizePaytPayload(p,paytV1Contract).reason).toBe("commission_total_mismatch");
    expect(normalizePaytPayload({...p,test:undefined},paytV1Contract).reason).toBe("invalid_test_flag");
    p.order_bumps[0].product.code="core";
    expect(normalizePaytPayload(p,paytV1Contract).reason).toBe("invalid_items");
    expect(normalizePaytPayload({...p,updated_at:"2026-02-31 14:00:00"},paytV1Contract).reason).toBe("invalid_timestamp");
    expect(normalizePaytPayload(p,{...paytV1Contract,timezone:"UTC"}).reason).toBe("awaiting_contract");
  });
  it("does not promote a checkout to a landing page or preserve fake e-mail and private payment data", () => {
    const p=paytPurchase();p.customer.fake_email=true;
    const raw={...p,link:{...p.link,query_params:{utm_id:"id",fbclid:"click"}},customer:{...p.customer,doc:"private",ip:"private"},transaction:{...p.transaction,bankslip_code:"private"}};
    const sanitized=sanitizePaytPayload(raw) as Record<string,unknown>;
    expect(JSON.stringify(sanitized)).not.toContain("private");
    const result=normalizePaytPayload(sanitized,paytV1Contract).value!;
    expect(result.contact.email).toBe("");expect(result.attribution.landing_url).toBeUndefined();expect(result.checkout_url).toContain("checkout.payt");
  });
  it("identifies a platform test without trusting its financial totals", () => {
    const p=paytPurchase();p.test=true;p.commission=[];
    expect(normalizePaytPayload(p,paytV1Contract).value?.sandbox).toBe(true);
  });
});
