import { describe, expect, it } from "vitest";
import type { DailyMetric, IntegrationConnection } from "@/lib/domain";
import {
  buildOverviewDailySeries,
  connectionOperationalSummary,
} from "@/lib/overview";

const emptyMetric = {
  investment: 0,
  revenue: 0,
  impressions: 0,
  clicks: 0,
  pageViews: 0,
  checkouts: 0,
  coreSales: 0,
} satisfies Omit<DailyMetric, "date">;

describe("buildOverviewDailySeries", () => {
  it("preenche todos os dias do mes ate a data de referencia", () => {
    const series = buildOverviewDailySeries(
      [
        { ...emptyMetric, date: "2026-08-01", revenue: 19.9, coreSales: 1 },
        { ...emptyMetric, date: "2026-08-03", investment: 10 },
      ],
      "2026-08-03",
    );

    expect(series).toEqual([
      { date: "2026-08-01", investment: 0, revenue: 19.9, coreSales: 1 },
      { date: "2026-08-02", investment: 0, revenue: 0, coreSales: 0 },
      { date: "2026-08-03", investment: 10, revenue: 0, coreSales: 0 },
    ]);
  });

  it("ignora linhas fora do mes corrente", () => {
    const series = buildOverviewDailySeries(
      [{ ...emptyMetric, date: "2026-07-31", revenue: 50 }],
      "2026-08-01",
    );

    expect(series).toEqual([
      { date: "2026-08-01", investment: 0, revenue: 0, coreSales: 0 },
    ]);
  });
});

describe("connectionOperationalSummary", () => {
  const connection = {
    id: "connection",
    name: "Conexao",
    provider: "hubla",
    status: "connected",
    accountCount: 0,
    productCount: 0,
    lastVerifiedAt: null,
  } satisfies IntegrationConnection;

  it("nao descreve Hubla como uma conexao de contas", () => {
    expect(connectionOperationalSummary(connection)).toBe(
      "Webhook sem produtos identificados",
    );
  });

  it("mostra contas de anuncio somente para Meta", () => {
    expect(
      connectionOperationalSummary({
        ...connection,
        provider: "meta",
        accountCount: 5,
      }),
    ).toBe("5 conta(s) de anuncios");
  });
});
