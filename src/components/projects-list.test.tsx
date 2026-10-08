// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ProjectSummary } from "@/lib/domain";
import { ProjectsList } from "./projects-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);
const project: ProjectSummary = { id: "one", name: "Projeto", expertName: "Responsável", status: "active",
  initials: "P", color: "#ffffff", monthlyTarget: 2000, marginTarget: 10, investment: 0, revenue: 0,
  coreSales: 0, products: 1, lastSyncAt: null, dailyMetrics: [] };

it("mostra fonte ausente e meta sem base como indisponíveis na carteira", () => {
  render(<ProjectsList projects={[project]} canManage={false} />);
  const article = within(screen.getByText("Projeto").closest("article")!);
  expect(article.getAllByText("Indisponível")).toHaveLength(2);
  expect(article.getByText("Dados indisponíveis")).toBeTruthy();
  expect(article.queryByText("0.00x")).toBeNull();
  expect(article.queryByText("0%")).toBeNull();
});

it("preserva um líquido zero conhecido sem inventar ROAS quando não houve investimento", () => {
  render(<ProjectsList projects={[{ ...project, monthlyTarget: 0, dailyMetrics: [{ date: "2026-10-05", revenue: 0,
    investment: 0, coreSales: 0, impressions: 0, clicks: 0, pageViews: 0, checkouts: 0,
    revenueAvailable: true, salesAvailable: true, trafficAvailable: true }] }]} canManage={false} />);
  const article = within(screen.getByText("Projeto").closest("article")!);
  expect(article.getByText(/0,00/)).toBeTruthy();
  expect(article.getByText("Indisponível")).toBeTruthy();
  expect(article.getByText("Não definida")).toBeTruthy();
});

it("identifica o ROAS parcial no cartão do projeto com recebimentos pendentes", () => {
  render(<ProjectsList projects={[{ ...project, dailyMetrics: [{ date: "2026-10-08", revenue: 300,
    investment: 100, coreSales: 1, impressions: 0, clicks: 0, pageViews: 0, checkouts: 0,
    revenueAvailable: true, trafficAvailable: true, comparisonAvailable: false }] }]} canManage={false} />);
  const article = within(screen.getByText("Projeto").closest("article")!);
  expect(article.getByText("ROAS líquido parcial")).toBeTruthy();
  expect(article.getByText("3.00x")).toBeTruthy();
  expect(article.getByText(/pode mudar após a conciliação/)).toBeTruthy();
});
