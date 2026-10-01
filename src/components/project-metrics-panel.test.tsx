// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
