import { describe, expect, it } from "vitest";
import type { DailyMetric, IntegrationConnection } from "@/lib/domain";
import {
  buildOverviewDailySeries,
  connectionOperationalSummary,
  overviewDataAvailability,
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
  it("preserva zeros informados e deixa dias ausentes como indisponíveis", () => {
    const series = buildOverviewDailySeries(
      [
        { ...emptyMetric, date: "2026-08-01", revenue: 19.9, coreSales: 1 },
        { ...emptyMetric, date: "2026-08-03", investment: 10 },
      ],
      "2026-08-03",
    );

    expect(series).toEqual([
      { date: "2026-08-01", investment: 0, revenue: 19.9, coreSales: 1 },
      { date: "2026-08-02", investment: null, revenue: null, coreSales: null },
      { date: "2026-08-03", investment: 10, revenue: 0, coreSales: 0 },
    ]);
  });

  it("ignora linhas fora do mes corrente", () => {
    const series = buildOverviewDailySeries(
      [{ ...emptyMetric, date: "2026-07-31", revenue: 50 }],
      "2026-08-01",
    );

    expect(series).toEqual([
      { date: "2026-08-01", investment: null, revenue: null, coreSales: null },
    ]);
  });

  it("não exibe uma soma parcial como total quando uma fonte do dia é desconhecida", () => {
    const first = { ...emptyMetric, date: "2026-10-05", revenue: 100, investment: 50, coreSales: 1 };
    const incomplete = { ...emptyMetric, date: "2026-10-05", revenue: 20, revenueAvailable: false, trafficAvailable: false };
    const series = buildOverviewDailySeries([first, incomplete], "2026-10-05", "2026-10-05");
    expect(series[0]).toEqual({ date: "2026-10-05", investment: null, revenue: null, coreSales: 1 });
  });

  it("considera projetos sem registros no consolidado sem os excluir silenciosamente", () => {
    const rows = [{ ...emptyMetric, date: "2026-10-05", revenue: 100, investment: 50, coreSales: 1 }];
    expect(buildOverviewDailySeries(rows, "2026-10-05", "2026-10-05", [rows, []])[0])
      .toEqual({ date: "2026-10-05", investment: null, revenue: null, coreSales: null });
    expect(buildOverviewDailySeries(rows, "2026-10-05", "2026-10-05", [rows])[0].revenue).toBe(100);
  });
});

describe("overview data availability", () => {
  it("distingue fonte sem dados, período parcialmente conhecido e zero informado", () => {
    expect(overviewDataAvailability([])).toEqual({ revenue: false, traffic: false, sales: false });
    expect(overviewDataAvailability([{ ...emptyMetric, date: "2026-10-05" }]))
      .toEqual({ revenue: true, traffic: true, sales: true });
    expect(overviewDataAvailability([
      { ...emptyMetric, date: "2026-10-04" },
      { ...emptyMetric, date: "2026-10-05", revenueAvailable: false, salesAvailable: false },
    ])).toEqual({ revenue: false, traffic: true, sales: false });
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

  it("mostra Assiny conectada com produtos como webhook ativo", () => {
    expect(connectionOperationalSummary({ ...connection, provider: "assiny", productCount: 6 }))
      .toBe("Webhook ativo · 6 produto(s)");
    expect(connectionOperationalSummary({ ...connection, provider: "assiny", status: "revoked" }))
      .toBe("Conexão revogada");
  });
});

it("builds a custom period spanning months without dropping the first month", () => {
  const base = { investment: 0, revenue: 10, coreSales: 1, impressions: 0, clicks: 0, pageViews: 0, checkouts: 0 };
  const series = buildOverviewDailySeries([{ ...base, date: "2026-08-31" }, { ...base, date: "2026-09-01" }, { ...base, date: "2026-08-30" }], "2026-09-01", "2026-08-31");
  expect(series.map((row) => row.date)).toEqual(["2026-08-31", "2026-09-01"]);
  expect(series.reduce((sum, row) => sum + (row.revenue ?? 0), 0)).toBe(20);
});
