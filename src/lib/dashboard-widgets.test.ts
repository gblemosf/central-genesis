import { describe, expect, it } from "vitest";
import { paidSaleGroups, saleOrigins, saleSources } from "./dashboard-widgets";
import { saleFromRecord } from "./project-operations";

function sale(id: string, source: string, transaction = "T1", connection = "C1") {
  return saleFromRecord({
    id,
    connection_id: connection,
    external_transaction_id: transaction,
    event_type: "PURCHASE_APPROVED",
    payload: { attribution: { utm: { source } } },
  });
}

describe("transaction attribution counts", () => {
  it("counts the principal and bumps once per transaction, preserving different connections", () => {
    const rows = [sale("core", "FB"), sale("bump-1", "FB"), sale("bump-2", "FB"),
      sale("other-platform", "FB", "T1", "C2")];
    expect(paidSaleGroups(rows)).toHaveLength(2);
    expect(saleSources(rows)).toEqual([["FB", 2]]);
  });

  it("flags conflicting sources within the same transaction without double counting", () => {
    expect(saleSources([sale("core", "FB"), sale("bump", "instagram"),
      sale("extra", "FB")])).toEqual([["Origem divergente na mesma compra", 1]]);
  });

  it("keeps conflicting item origins and untagged refunds together in the transaction's detailed group", () => {
    const rows = [sale("core", "FB"), sale("bump", "instagram"),
      { ...sale("refund", ""), status: "refunded" as const }];
    const groups = [...saleOrigins(rows).values()];
    expect(groups).toHaveLength(1);
    expect(groups[0].label[0]).toBe("Origem divergente na mesma compra");
    expect(groups[0].sales).toHaveLength(3);
  });

  it("keeps missing attribution distinct from conflicting attribution and ignores refund rows", () => {
    expect(saleSources([sale("core", "FB"), sale("bump", ""),
      sale("unknown", "", "T2"), { ...sale("refund", "other", "T3"), status: "refunded" }]))
      .toEqual([["FB", 1], ["Sem origem informada", 1]]);
  });
});
