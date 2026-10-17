import { describe, expect, it } from "vitest";
import { saleRowsFromRecord, summarizeSales } from "./project-operations";

function invoice() {
  return { id:"invoice",connection_id:"payt",external_transaction_id:"T1",event_type:"PURCHASE_APPROVED",currency:"BRL",gross_amount:437.5,net_amount:344.84,
    integration_connections:{provider:"payt"},payload:{provider:"payt",contract_version:1,financial_scope:"invoice",
      financial:{gross:437.5,platform_fee:92.66,net_after_fees:344.84,payout:172.42,payout_source:"producer_group_commission",reconciliation:{kind:"invoice_only",gross_delta:73.5}},
      attribution:{utm:{source:"FB",campaign:"Campaign",id:"123"}},
      items:[{product_external_id:"core",product_name:"Principal",is_order_bump:false,financial:{gross:297,platform_fee:null as number|null,net_after_fees:null as number|null}},
        {product_external_id:"bump",product_name:"Adicional",is_order_bump:true,financial:{gross:67,platform_fee:null as number|null,net_after_fees:null as number|null}}]},
    sales_event_items:[{product_id:"core-id",gross_amount:297,net_amount:null as number|null,products:{external_id:"core"}},
      {product_id:"bump-id",gross_amount:67,net_amount:null as number|null,products:{external_id:"bump"}}] };
}

describe("invoice totals and product selections", () => {
  it("shows the correct invoice total once while retaining separate bump tracking and unknown item fees", () => {
    const rows=saleRowsFromRecord(invoice());
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({product:"Adicional",orderBump:true,afterFees:null,attribution:{source:"FB",campaign:"Campaign",id:"123"}});
    expect(summarizeSales(rows,"BRL")).toMatchObject({transactions:1,gross:437.5,fee:92.66,afterFees:344.84,payout:172.42,payoutMissing:0});
    expect(summarizeSales([rows[1]],"BRL")).toMatchObject({gross:67,fee:null,afterFees:null,payout:null});
    expect(rows[0].invoice?.note).toContain("sem rateio");
  });
  it("reverses an invoice once without attaching another platform or a duplicate item", () => {
    const source=invoice(),paid=saleRowsFromRecord(source),refunded=saleRowsFromRecord({...source,id:"refund",event_type:"PURCHASE_REFUNDED",gross_amount:-437.5,net_amount:-344.84});
    expect(summarizeSales([...paid,...refunded],"BRL")).toMatchObject({transactions:1,refunds:1,gross:437.5,refunded:437.5,afterFees:0,payout:0});
    const duplicate=[paid[0],paid[0]];
    expect(summarizeSales(duplicate,"BRL").afterFees).toBeNull();
    expect(summarizeSales([paid[0],{...paid[1],connectionId:"foreign"}],"BRL").afterFees).toBeNull();
  });
  it("uses the Assiny invoice cent while a product-only selection retains its reported item amount", () => {
    const source=invoice();source.integration_connections.provider="assiny";source.payload.provider="assiny";
    source.gross_amount=345.8;source.net_amount=325.99;
    Object.assign(source.payload.financial,{gross:345.8,platform_fee:19.81,net_after_fees:325.99,payout:325.98,reconciliation:{kind:"reported_item_rounding",gross_delta:0,net_after_fees_delta:0.01,platform_fee_delta:-0.01}});
    for(const [index,values]of [[282.15,16.17,265.98],[63.65,3.65,60]].entries()) {
      Object.assign(source.payload.items[index].financial,{gross:values[0],platform_fee:values[1],net_after_fees:values[2]});
      Object.assign(source.sales_event_items[index],{gross_amount:values[0],net_amount:values[2]});
    }
    const rows=saleRowsFromRecord(source);
    expect(summarizeSales(rows,"BRL")).toMatchObject({gross:345.8,afterFees:325.99,payout:325.98});
    expect(summarizeSales([rows[1]],"BRL").afterFees).toBe(60);
    expect(rows[0].invoice?.note).toContain("0.01 BRL");
  });
});
