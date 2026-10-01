import { describe, expect, it } from "vitest";
import {
  readWorkspaceLocation,
  workspaceQuery,
  workspaceSections,
  workspaceDescriptions,
  sectionDestination,
} from "./workspace-navigation";
import {
  parseWidgetPreference,
  matchesSaleProducts,
  previousAnalysisPeriod,
} from "./dashboard-widgets";
import type { SaleRow } from "./project-operations";

describe("project navigation and saved preferences", () => {
  it("keeps all previous deep links reachable with exactly one area and an explanation", () => {
    const views = workspaceSections.flatMap((section) => section.views.map(([view]) => view));
    expect(new Set(views).size).toBe(views.length);
    for (const view of ["overview", "sales", "recovery", "results", "financial", "origins", "metrics", "contacts", "forms", "settings", "products", "forms-setup", "history", "imports", "planning", "assumptions"]) expect(views).toContain(view);
    expect(Object.keys(workspaceDescriptions).sort()).toEqual([...views].sort());
    expect(sectionDestination("finance", "sales", "forms")).toBe("results");
  });
  it("keeps dates and multi-product selection in a reloadable link for every area", () => {
    const filter = {
      start: "2026-07-01",
      end: "2026-09-12",
      productIds: ["a", "b"],
    };
    for (const section of workspaceSections)
      for (const [tab] of section.views) {
        const query = workspaceQuery(new URLSearchParams(), tab, filter);
        expect(
          readWorkspaceLocation(new URLSearchParams(query), "2026-09-26"),
        ).toEqual({ tab, filter });
      }
  });
  it("distinguishes no products from all products and rejects invalid dates or navigation", () => {
    const empty = readWorkspaceLocation(
      new URLSearchParams(
        "view=unknown&start=2026-02-30&end=2026-02-30&products=",
      ),
      "2026-09-26",
    );
    expect(empty).toEqual({
      tab: "overview",
      filter: { start: "2026-08-28", end: "2026-09-26", productIds: [] },
    });
    expect(
      readWorkspaceLocation(new URLSearchParams(), "2026-09-26").filter
        .productIds,
    ).toBeNull();
    expect(
      matchesSaleProducts(
        { catalogProductId: "a" } as SaleRow,
        empty.filter,
        [],
      ),
    ).toBe(false);
  });
  it("restores an intentionally empty panel and safely handles damaged or old preferences", () => {
    expect(parseWidgetPreference("[]")).toEqual([]);
    expect(
      parseWidgetPreference('["sources","finance","sources","unknown",null]'),
    ).toEqual(["sources", "finance"]);
    expect(parseWidgetPreference("broken")).toContain("finance");
    expect(parseWidgetPreference('{"finance":true}')).toContain("finance");
  });
  it("compares consecutive inclusive windows across month and year boundaries", () => {
    expect(
      previousAnalysisPeriod({ start: "2026-01-01", end: "2026-01-07" }),
    ).toEqual({ start: "2025-12-25", end: "2025-12-31" });
    expect(
      previousAnalysisPeriod({ start: "2024-03-01", end: "2024-03-01" }),
    ).toEqual({ start: "2024-02-29", end: "2024-02-29" });
  });
});
