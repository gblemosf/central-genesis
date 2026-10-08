// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectMetricsPanel } from "./project-metrics-panel";
import { defaultProjectMetricConfig } from "@/lib/project-metrics";
import type { ProjectAnalytics } from "@/lib/domain";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("saves costs without clearing projection settings hidden from the costs screen", async () => {
  const config = { ...defaultProjectMetricConfig("2026-10-01"), ticketBudget: 987, historicalAttendance: 23, formationProductId: "formation" };
  const analytics: ProjectAnalytics = { config, configSaved: true, dailyMetrics: [], dataSources: { csvDailyRows: 0, metaTrafficRows: 0, webhookSalesEvents: 0, unmappedSalesEvents: 0 } };
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: analytics }) });
  vi.stubGlobal("fetch", fetcher);
  render(<ProjectMetricsPanel projectId="project" analytics={analytics} products={[]} stages={[]} demoMode={false} filter={{ start: config.periodStart, end: config.periodEnd, productIds: null }} view="costs" />);
  const input = await screen.findByLabelText(/Custos fixos da empresa/);
  expect(screen.queryByText("Planejamento de investimento")).toBeNull();
  fireEvent.change(input, { target: { value: "125" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar custos e regras" }));
  await waitFor(() => expect(fetcher.mock.calls.some((call) => call[1]?.method === "PUT")).toBe(true));
  const saved = JSON.parse(fetcher.mock.calls.find((call) => call[1]?.method === "PUT")![1].body);
  expect(saved).toEqual({ ...config, companyCosts: 125 });
  await waitFor(() => expect(screen.getByText("Parametros salvos. Os indicadores foram recalculados.")).toBeTruthy());
});

it("shows partial financial figures with registered costs and keeps product comparisons unavailable", () => {
  const config = { ...defaultProjectMetricConfig("2026-10-08"), trafficFeePercent: 10,
    manychatCost: 0, companyCosts: 50, otherCosts: 0 };
  const analytics: ProjectAnalytics = { config, configSaved: true,
    qualityWarnings: ["Payt: recebimentos pendentes"],
    dailyMetrics: [{ date: "2026-10-08", investment: 100, revenue: 300, coreSales: 1,
      impressions: 0, clicks: 0, pageViews: 0, checkouts: 0,
      revenueAvailable: true, salesAvailable: true, trafficAvailable: true, comparisonAvailable: false,
      productMetrics: [{ productId: "core", stageId: "core-stage", productName: "Principal", stageType: "core", quantity: 1, revenue: 300 }] }],
    dataSources: { csvDailyRows: 0, metaTrafficRows: 1, webhookSalesEvents: 1, unmappedSalesEvents: 0 } };
  const props = { projectId: "project", analytics, products: [], stages: [], demoMode: false, readOnly: true,
    filter: { start: config.periodStart, end: config.periodEnd, productIds: null }, view: "financial" as const };
  const { rerender } = render(<ProjectMetricsPanel {...props} />);
  expect(within(screen.getByText("ROAS líquido parcial").closest("article")!).getByText("3.00x")).toBeTruthy();
  expect(within(screen.getByText("3 · Saldo parcial com custos registrados").closest("li")!).getByText(/140,00/)).toBeTruthy();
  expect(screen.getByText(/Saldo e ROAS parciais usam somente os valores registrados/)).toBeTruthy();
  expect(screen.getByText(/Payt: recebimentos pendentes/)).toBeTruthy();
  rerender(<ProjectMetricsPanel {...props} filter={{ ...props.filter, productIds: ["core"] }} />);
  expect(within(screen.getByText("ROAS líquido de mídia").closest("article")!).getByText("N/D")).toBeTruthy();
  expect(within(screen.getByText("3 · Saldo com custos registrados").closest("li")!).getByText("Indisponível")).toBeTruthy();
  expect(screen.queryByText("ROAS líquido parcial")).toBeNull();
});
