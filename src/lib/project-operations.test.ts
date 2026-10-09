import { describe, expect, it } from "vitest";
import {
  normalizeHotmartWebhookEvent,
  parseHotmartWebhookPayload,
} from "@/lib/hotmart-webhook";
import {
  csvDocument,
  saleFromRecord,
  saleRowsFromRecord,
  summarizeSales,
} from "@/lib/project-operations";
import { saleAttribution } from "@/lib/sales-attribution";
import { readAllRows } from "@/lib/project-operations-data";

const purchase = (currency = "BRL") =>
  normalizeHotmartWebhookEvent(
    parseHotmartWebhookPayload({
      event: "PURCHASE_APPROVED",
      id: "example-event",
      creation_date: 1788674309438,
      data: {
        product: { id: 8304193, name: "Produto exemplo" },
        buyer: {
          name: "Pessoa Exemplo",
          email: "test@example.invalid",
          document: "private-document",
        },
        purchase: {
          transaction: "example-sale",
          price: { value: 47, currency_value: currency },
          origin: {
            xcod: "dpaf6860",
            sck: "meta-ads|AUTO | ALL | V2H1|Campanha | Teste|Instagram_Feed|EST05|click-id",
          },
        },
        commissions: [
          { source: "MARKETPLACE", value: 5.18, currency_value: "BRL" },
          { source: "PRODUCER", value: 19.66, currency_value: "BRL" },
        ],
      },
    })[0],
  )!;

describe("project sales presentation", () => {
  it("presents known payouts as a partial signed sum without hiding gaps or mixing currencies", () => {
    const paid = saleFromRecord({ event_type: 'PURCHASE_APPROVED', currency: 'BRL', gross_amount: 100, payload: {financial:{payout:40}} });
    const missing = { ...paid, payout: null };
    const refund = { ...paid, status: 'refunded' as const, payout: -10 };
    expect(summarizeSales([paid,missing,refund,{...paid,currency:'USD',payout:500}], 'BRL'))
      .toMatchObject({ payout: null, payoutKnown: 30, payoutMissing: 1 });
    expect(summarizeSales([missing], 'BRL')).toMatchObject({ payout: null, payoutKnown: null });
    expect(summarizeSales([{...paid,payout:0},missing], 'BRL')).toMatchObject({ payout: null, payoutKnown: 0 });
    expect(summarizeSales([paid,{...missing,status:'partial_refund'}], 'BRL')).toMatchObject({ payout: null, payoutKnown: null });
  });

  it("uses a validated invoice payout for its sole item without guessing a beneficiary", () => {
    const financial={gross:100,platform_fee:10,net_after_fees:90,payout:45,payout_source:'seller_receiver'};
    const row={id:'sale',gross_amount:100,event_type:'PURCHASE_APPROVED',currency:'BRL',
      payload:{provider:'assiny',contract_version:1,financial,items:[{product_external_id:'core',financial:{...financial,payout:null,payout_source:'unknown'}}]},
      sales_event_items:[{product_id:'p',gross_amount:100,products:{external_id:'core'}}]};
    expect(saleRowsFromRecord(row)[0].payout).toBe(45);
    expect(saleRowsFromRecord({...row,payload:{...row.payload,financial:{...financial,payout:null,payout_source:'unknown',commissions:[{recipient:'A',amount:45},{recipient:'B',amount:45}]}}})[0])
      .toMatchObject({payout:null,payoutIssue:'Há comissões informadas; confira os beneficiários e os valores do repasse.'});
    expect(saleRowsFromRecord({...row,gross_amount:200})[0].payout).toBeNull();
  });

  it("shows validated invoice items with their own values and inherited tracking without duplicating transaction counts", () => {
    const item = (external: string, gross: number, fee: number) => ({ product_external_id: external, product_name: external,
      financial: { gross, platform_fee: fee, net_after_fees: gross-fee, payout: null, payout_source: 'unknown' } });
    const row = { id: 'sale', connection_id: 'assiny-connection', external_transaction_id: 'T1', currency: 'BRL', gross_amount: 344, net_amount: 323.28,
      event_type: 'PURCHASE_APPROVED', integration_connections: {provider:'assiny'}, payload: { provider:'assiny', contract_version:1,
        items:[item('core',297,17.72),{...item('bump',47,3),is_order_bump:true}], attribution:{utm:{source:'meta'}} },
      sales_event_items:[{product_id:'p-core',gross_amount:297,net_amount:279.28,product_name_snapshot:'Principal',products:{external_id:'core'}},
        {product_id:'p-bump',gross_amount:47,net_amount:44,product_name_snapshot:'Acervo',stage_type_snapshot:'order_bump',products:{external_id:'bump'}}] };
    const sales = saleRowsFromRecord(row);
    expect(sales).toMatchObject([{id:'sale:p-core',provider:'assiny',gross:297,afterFees:279.28,payout:null,attribution:{source:'meta'}},
      {id:'sale:p-bump',provider:'assiny',gross:47,afterFees:44,payout:null,orderBump:true,attribution:{source:'meta'}}]);
    const refunds = saleRowsFromRecord({...row,event_type:'PURCHASE_REFUNDED'});
    expect(summarizeSales([...sales,...refunds],'BRL')).toMatchObject({transactions:1,refunds:1,gross:344,refunded:344,afterFees:0,payout:null});
    expect(summarizeSales([sales[1]],'BRL').gross).toBe(47);
    expect(saleRowsFromRecord({...row,payload:{financial:{platform_fee:20.72}}})).toHaveLength(1);
  });
  it("separates the real example's platform fee from the producer share", () => {
    const event = purchase();
    const row = saleFromRecord({
      id: "sale",
      event_type: event.eventType,
      gross_amount: event.grossAmount,
      net_amount: event.netAmount,
      currency: event.currency,
      payload: event.payload,
    });
    expect(row).toMatchObject({
      gross: 47,
      fee: 5.18,
      afterFees: 41.82,
      payout: 19.66,
      name: "Pessoa Exemplo",
      attribution: {
        medium: "AUTO | ALL | V2H1",
        campaign: "Campanha | Teste",
        page: "https://bravuscursos.com.br/da-prova-a-farda-v2h1/",
      },
    });
    expect(JSON.stringify(event.payload)).not.toContain("private-document");
  });
  it("does not mix a foreign purchase currency with BRL commissions", () => {
    const event = purchase("USD");
    expect(event.currency).toBe("USD");
    const row = saleFromRecord({
      gross_amount: event.grossAmount,
      net_amount: event.netAmount,
      currency: event.currency,
      payload: event.payload,
    });
    expect(row.fee).toBeNull();
    expect(row.payout).toBeNull();
  });
  it("keeps unknown financial values unknown and preserves a true zero payout", () => {
    expect(
      saleFromRecord({
        gross_amount: 100,
        net_amount: 100,
        payload: { net_amount_source: "gross_fallback" },
      }).payout,
    ).toBeNull();
    expect(
      saleFromRecord({
        gross_amount: 100,
        net_amount: 90,
        payload: { net_amount_source: "gross_minus_hotmart_fee" },
      }).payout,
    ).toBeNull();
    expect(
      saleFromRecord({
        gross_amount: 100,
        payload: { financial: { payout: 0, platform_fee: 0 } },
      }),
    ).toMatchObject({ payout: 0, fee: 0, afterFees: 100 });
  });
  it("counts separate purchases by the same contact and excludes refunded buyers", () => {
    const first = saleFromRecord({
      id: "1",
      contact_id: "contact",
      connection_id: "connection",
      external_transaction_id: "T1",
      event_type: "PURCHASE_APPROVED",
      currency: "BRL",
      gross_amount: 47,
      payload: purchase().payload,
    });
    const second = { ...first, id: "2", transaction: "T2" };
    const refund = saleFromRecord({
      id: "refund",
      contact_id: "contact",
      connection_id: "connection",
      external_transaction_id: "T1",
      event_type: "PURCHASE_REFUNDED",
      gross_amount: -47,
      currency: "BRL",
      payload: purchase().payload,
    });
    expect(summarizeSales([first, second, refund], "BRL")).toMatchObject({
      transactions: 2,
      refunds: 1,
      buyers: 1,
      gross: 94,
      refunded: 47,
      afterFees: 41.82,
    });
    expect(summarizeSales([first, refund], "BRL").buyers).toBe(0);
  });
  it("does not assign a known page code to another product", () => {
    expect(saleAttribution({ xcod: "dpaf6860" }, "other").page).toBeNull();
    expect(saleAttribution({ page: "javascript:alert(1)" }).page).toBeNull();
  });
  it("exports all columns and protects spreadsheet formula interpretation", () => {
    const csv = csvDocument(
      ["Nome", "Resposta", "Taxa"],
      [['=HYPERLINK("x")', "linha1\nlinha2;valor", -5.18]],
    );
    expect(csv).toContain("'=");
    expect(csv).toContain('"-5.18"');
    expect(csv).toContain('"linha1\nlinha2;valor"');
  });
  it("reads beyond PostgREST's first thousand records and surfaces errors", async () => {
    const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
    expect(
      (
        await readAllRows(async (from, to) => ({
          data: rows.slice(from, to + 1),
          error: null,
        }))
      ).length,
    ).toBe(1201);
    await expect(
      readAllRows(async () => ({
        data: null,
        error: { message: "unavailable" },
      })),
    ).rejects.toThrow("Não foi possível");
  });
});
