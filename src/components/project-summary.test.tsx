// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectSummary } from "./project-summary";
import { demoProjects } from "@/lib/demo-data";
import { defaultProjectMetricConfig } from "@/lib/project-metrics";
import type {
  ProjectAnalytics,
  ProjectCatalog,
  ProjectFormsData,
} from "@/lib/domain";
import { saleFromRecord } from "@/lib/project-operations";

const project = demoProjects[0];
const filter = { start: "2026-09-01", end: "2026-09-13", productIds: null };
const catalog: ProjectCatalog = {
  products: [],
  stages: [],
  metaAccounts: [],
  salesConnections: [],
  linkedMetaAccountId: null,
};
const forms: ProjectFormsData = {
  connections: [],
  forms: [],
  contacts: [],
  utms: [],
  recoveryAttempts: [],
};
const analytics: ProjectAnalytics = {
  config: defaultProjectMetricConfig("2026-09-13"),
  configSaved: false,
  dataSources: {
    csvDailyRows: 0,
    metaTrafficRows: 0,
    webhookSalesEvents: 1,
    unmappedSalesEvents: 0,
  },
  dailyMetrics: [],
};
const sale = saleFromRecord({
  id: "sale",
  product_id: "one",
  gross_amount: 47,
  currency: "BRL",
  external_transaction_id: "transaction",
  payload: {
    financial: { platform_fee: 5.18, payout: 19.66 },
    attribution: {},
  },
});
const props = {
  project,
  analytics,
  rows: [],
  ready: true,
  error: "",
  filter,
  products: [],
  catalog,
  forms,
  demoMode: false,
  onNavigate: vi.fn(),
  onSyncMeta: vi.fn(),
  syncing: false,
};
const data = {
  sales: [sale],
  contacts: [],
  recovery: [],
  currency: "BRL",
  loadedAt: "2026-09-13T12:00:00Z",
};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps net after fees separate from producer payout and identifies missing origins", async () => {
  render(<ProjectSummary {...props} />);
  await screen.findAllByText(/41,82/);
  expect(screen.getAllByText(/19,66/)).toHaveLength(2);
  expect(screen.getByText("Sem origem informada")).toBeTruthy();
  expect(screen.getByText(/1 de 1 compra\(s\) sem página/)).toBeTruthy();
});
it("counts one purchase with bumps and a checkout URL as one purchase without a landing page", async () => {
  const checkoutSale = saleFromRecord({ id: "checkout-sale", external_transaction_id: "checkout-transaction",
    connection_id: "hubla", payload: { attribution: { landing_url: "https://pay.hub.la/offer", utm: { source: "FB" } } } });
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ data: { ...data,
    sales: [checkoutSale, { ...checkoutSale, id: "bump", orderBump: true }],
  } }) } as Response);
  render(<ProjectSummary {...props} />);
  await screen.findByText(/1 de 1 compra\(s\) sem página de entrada/);
  expect(screen.getByText("1 compra(s)")).toBeTruthy();
  expect(screen.queryByText("2 compra(s)")).toBeNull();
});
it("hides prior amounts while another period is pending or fails", async () => {
  const view = render(<ProjectSummary {...props} />);
  await screen.findAllByText(/41,82/);
  vi.mocked(fetch).mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Fonte indisponível" }),
  } as Response);
  view.rerender(
    <ProjectSummary {...props} filter={{ ...filter, start: "2026-08-01" }} />,
  );
  expect(screen.queryByText(/41,82/)).toBeNull();
  await screen.findByRole("alert");
  expect(screen.queryByText(/19,66/)).toBeNull();
});
it("does not turn an empty product selection into all sales", async () => {
  render(<ProjectSummary {...props} filter={{ ...filter, productIds: [] }} />);
  await screen.findAllByText("Nenhuma venda registrada nesta seleção.");
  expect(screen.queryByText(/41,82/)).toBeNull();
});
it("saves only widget choices, restores their order and supports adding and removing", async () => {
  localStorage.setItem(
    `genesis:dashboard:v1:${project.id}`,
    '["sources","finance"]',
  );
  render(<ProjectSummary {...props} />);
  await waitFor(() =>
    expect(
      within(screen.getByRole("region", { name: "Blocos do resumo" }))
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(["Fontes e pendências", "Composição financeira"]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Personalizar painel" }));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Mover Composição financeira para cima",
    }),
  );
  expect(
    JSON.parse(localStorage.getItem(`genesis:dashboard:v1:${project.id}`)!),
  ).toEqual(["finance", "sources"]);
  fireEvent.click(
    screen.getByRole("button", { name: "Remover Composição financeira" }),
  );
  fireEvent.click(screen.getByLabelText("Formulários"));
  expect(
    JSON.parse(localStorage.getItem(`genesis:dashboard:v1:${project.id}`)!),
  ).toEqual(["sources", "forms"]);
});
