// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyMetric, ProjectSummary } from "@/lib/domain";
import { OverviewDashboard } from "./overview-dashboard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/analysis-filters", () => ({ AnalysisFilters: ({ context }: { context?: ReactNode }) => <>{context}</> }));
vi.mock("recharts", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Chart = ({ children }: { children?: ReactNode }) => <svg>{children}</svg>;
  return { ResponsiveContainer: Container, AreaChart: Chart, BarChart: Chart,
    Area: () => null, Bar: () => null, CartesianGrid: () => null, Tooltip: () => null,
    XAxis: () => null, YAxis: () => null };
});
afterEach(cleanup);
const metric: DailyMetric = { date: "2026-10-05", revenue: 1200, investment: 1000, coreSales: 9,
  impressions: 1000, clicks: 50, pageViews: 40, checkouts: 20,
  revenueAvailable: true, trafficAvailable: true, salesAvailable: true };
const project: ProjectSummary = { id: "complete", name: "Projeto completo", expertName: "Responsável", status: "active",
  initials: "PC", color: "#ffffff", monthlyTarget: 2000, marginTarget: 10, investment: 1000, revenue: 1200,
  coreSales: 9, products: 1, lastSyncAt: null, dailyMetrics: [metric] };
const props = { connections: [], source: "live" as const, reportingDate: "2026-10-05",
  period: { start: "2026-10-05", end: "2026-10-05" } };
function card(label: string) { return within(screen.getByText(label).closest("article")!); }

describe("overview financial integrity", () => {
  it("shows processed revenue but blocks conclusions while gateway deliveries are pending", () => {
    render(<OverviewDashboard {...props} projects={[{ ...project, qualityWarnings: ["Payt: recebimentos pendentes"],
      dailyMetrics: [{ ...metric, comparisonAvailable: false }] }]} />);
    expect(card("Líquido registrado após taxas").getByText(/1\.200,00/)).toBeTruthy();
    expect(card("Líquido registrado após taxas").getByText(/Base parcial/)).toBeTruthy();
    expect(card("Saldo após mídia").getByText("Indisponível")).toBeTruthy();
    expect(card("ROAS líquido registrado").getByText("Indisponível")).toBeTruthy();
    expect(screen.getByText(/Payt: recebimentos pendentes/)).toBeTruthy();
  });
  it("identifica os projetos que impedem o consolidado e mantém a seleção explícita", () => {
    render(<OverviewDashboard {...props} projects={[project, { ...project, id: "missing", name: "Projeto sem dados", dailyMetrics: [] }]} />);
    expect(card("Líquido registrado após taxas").getByText("Indisponível")).toBeTruthy();
    expect(card("Saldo após mídia").getByText("Indisponível")).toBeTruthy();
    expect(screen.getByText("Dados indisponíveis no período selecionado")).toBeTruthy();
    expect(screen.getAllByText("Projeto sem dados").length).toBeGreaterThan(1);
    fireEvent.change(screen.getByLabelText("Projeto na visão geral"), { target: { value: "complete" } });
    expect(card("Líquido registrado após taxas").getByText(/1\.200,00/)).toBeTruthy();
    expect(card("Saldo após mídia").getByText(/200,00/)).toBeTruthy();
    expect(card("ROAS líquido registrado").getByText("1.20x")).toBeTruthy();
    expect(screen.queryByText("Dados indisponíveis no período selecionado")).toBeNull();
    expect(screen.getByText(/não são a atribuição da Meta/)).toBeTruthy();
    expect(card("Saldo após mídia").getByText(/não representa lucro/)).toBeTruthy();
  });

  it("não apresenta líquido parcial como total nem perde um zero explicitamente conhecido", () => {
    const { rerender } = render(<OverviewDashboard {...props} projects={[{ ...project, dailyMetrics: [{ ...metric, revenueAvailable: false }] }]} />);
    expect(card("Líquido registrado após taxas").getByText("Indisponível")).toBeTruthy();
    expect(card("Investimento em mídia").getByText(/1\.000,00/)).toBeTruthy();
    rerender(<OverviewDashboard {...props} projects={[{ ...project, dailyMetrics: [{ ...metric, revenue: 0, coreSales: 0 }] }]} />);
    expect(card("Líquido registrado após taxas").getByText(/0,00/)).toBeTruthy();
    expect(card("ROAS líquido registrado").getByText("0.00x")).toBeTruthy();
    expect(card("ROAS líquido registrado").queryByText(/Mídia por venda/)).toBeNull();
  });
});
