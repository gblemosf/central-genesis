"use client";

import { Check, LoaderCircle, RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import type { ProjectCatalog, ProjectProduct, ProjectSummary } from "@/lib/domain";
import { calculatePerformance } from "@/lib/metrics";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

const productSets: Record<string, { name: string; stage: string; price: number }[]> = {
  colorista: [
    { name: "Tecnica Morenas Iluminadas", stage: "Core", price: 19.9 },
    { name: "O Vilao Chamado Porosidade", stage: "Order bump 1", price: 147 },
    { name: "Camuflagem de Cabelos Brancos", stage: "Order bump 2", price: 47 },
    { name: "Tecnica Ruivos", stage: "Order bump 3", price: 27 },
  ],
  pesca: [
    { name: "Manual das Iscas Artificiais", stage: "Core", price: 19.9 },
    { name: "Workshop Mestre das Iscas", stage: "Order bump 1", price: 147 },
    { name: "Aula Linhas, Varas e Tralhas", stage: "Order bump 2", price: 47 },
    { name: "Segredos da Vara de Pesca", stage: "Order bump 3", price: 27 },
  ],
};

export function ProjectWorkspace({
  project,
  initialCatalog,
  demoMode,
}: {
  project: ProjectSummary;
  initialCatalog: ProjectCatalog;
  demoMode: boolean;
}) {
  const [tab, setTab] = useState<"overview" | "products" | "settings">("overview");
  const demoProducts = productSets[project.id] ?? [
    { name: "Produto principal", stage: "Core", price: 0 },
  ];
  const demoStages = Array.from(new Set(demoProducts.map((product) => product.stage))).map(
    (name) => ({ id: name, name }),
  );
  const stages = demoMode ? demoStages : initialCatalog.stages;
  const [products, setProducts] = useState<ProjectProduct[]>(
    demoMode
      ? demoProducts.map((product, index) => ({
          id: `demo-${index}`,
          externalId: `demo-${index}`,
          name: product.name,
          stageId: product.stage,
          price: product.price,
          currency: "BRL",
          mappedProjectId: project.id,
        }))
      : initialCatalog.products,
  );
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [metaAccountId, setMetaAccountId] = useState(
    initialCatalog.linkedMetaAccountId ?? "",
  );
  const [operation, setOperation] = useState<"idle" | "linking" | "syncing">("idle");
  const [operationMessage, setOperationMessage] = useState("");
  const totals = calculatePerformance(project.dailyMetrics);

  async function saveProducts() {
    setSaveStatus("saving");
    if (!demoMode) {
      const response = await fetch(`/api/projects/${project.id}/products`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappings: products
            .filter(
              (product) =>
                product.stageId &&
                (!product.mappedProjectId || product.mappedProjectId === project.id),
            )
            .map((product) => ({
              productId: product.id,
              funnelStageId: product.stageId,
            })),
        }),
      });
      if (!response.ok) {
        setSaveStatus("error");
        return;
      }
    }
    setSaveStatus("saved");
    window.setTimeout(() => setSaveStatus("idle"), 1800);
  }

  async function saveMetaAccount() {
    setOperation("linking");
    setOperationMessage("");
    if (!demoMode) {
      const response = await fetch(`/api/projects/${project.id}/meta-account`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAccountId: metaAccountId || null }),
      });
      if (!response.ok) {
        setOperation("idle");
        setOperationMessage("Nao foi possivel vincular a conta Meta.");
        return;
      }
    }
    setOperation("idle");
    setOperationMessage("Conta Meta atualizada.");
  }

  async function syncMeta() {
    setOperation("syncing");
    setOperationMessage("");
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      setOperation("idle");
      setOperationMessage("Sincronizacao demonstrativa concluida.");
      return;
    }

    const response = await fetch(`/api/projects/${project.id}/sync/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 10 }),
    });
    const body = (await response.json().catch(() => null)) as
      | { processed?: number; error?: string }
      | null;
    setOperation("idle");
    setOperationMessage(
      response.ok
        ? `${body?.processed ?? 0} metrica(s) sincronizada(s). Atualize a pagina para visualizar.`
        : body?.error ?? "Nao foi possivel sincronizar a Meta.",
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <div
            className="grid size-14 place-items-center rounded-[18px] text-sm font-black"
            style={{ background: project.color }}
          >
            {project.initials}
          </div>
          <div>
            <p className="eyebrow mb-2">Projeto ativo</p>
            <h1 className="text-3xl font-black tracking-[-0.05em] sm:text-4xl">
              {project.name}
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">{project.expertName}</p>
          </div>
        </div>
        <div className="flex gap-1 rounded-xl border border-[var(--line)] bg-white/45 p-1">
          {[
            ["overview", "Resumo"],
            ["products", "Produtos"],
            ["settings", "Configuracoes"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key as typeof tab)}
              className={`rounded-lg px-3 py-2 text-[11px] font-bold ${
                tab === key ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {initialCatalog.warning && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
          {initialCatalog.warning}
        </p>
      )}

      {tab === "overview" && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Faturamento real", formatCurrency(totals.revenue)],
              ["Investido", formatCurrency(totals.investment)],
              ["Lucro", formatCurrency(totals.profit)],
              ["ROAS", `${totals.roas.toFixed(2)}x`],
            ].map(([label, value]) => (
              <article key={label} className="panel rounded-[20px] p-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {label}
                </p>
                <p className="mt-4 text-2xl font-black tracking-[-0.04em]">{value}</p>
              </article>
            ))}
          </section>
          <section className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <article className="panel rounded-[24px] p-6">
              <p className="eyebrow">Indicadores de funil</p>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                {[
                  ["CTR", formatPercent(totals.ctr)],
                  ["Connect rate", formatPercent(totals.connectRate)],
                  ["Pagina para checkout", formatPercent(totals.checkoutRate)],
                  ["Vendas core", formatNumber(totals.coreSales)],
                  ["CPA", formatCurrency(totals.cpa)],
                  ["AOV", formatCurrency(totals.aov)],
                ].map(([label, value]) => (
                  <div key={label} className="border-b border-[var(--line)] pb-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                      {label}
                    </p>
                    <p className="mt-1 text-lg font-black">{value}</p>
                  </div>
                ))}
              </div>
            </article>
            <article className="rounded-[24px] bg-[var(--sidebar)] p-6 text-white">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
                Estado operacional
              </p>
              <h2 className="mt-3 text-2xl font-black tracking-[-0.04em]">
                Coleta monitorada
              </h2>
               <div className="mt-7 space-y-3 text-xs">
                <div className="flex justify-between border-b border-white/8 pb-3">
                  <span className="text-white/45">Produtos mapeados</span>
                  <span className="font-bold">{project.products}</span>
                </div>
                <div className="flex justify-between border-b border-white/8 pb-3">
                  <span className="text-white/45">Meta de margem</span>
                  <span className="font-bold">{formatPercent(project.marginTarget, 0)}</span>
                </div>
                <div className="flex justify-between pb-3">
                  <span className="text-white/45">Ultima referencia</span>
                  <span className="font-bold">{project.lastSyncAt ?? "Pendente"}</span>
                </div>
                </div>
                <button
                  type="button"
                  onClick={syncMeta}
                  disabled={operation !== "idle" || (!demoMode && !metaAccountId)}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[10px] font-bold text-[var(--sidebar)] disabled:opacity-35"
                >
                  {operation === "syncing" ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Sincronizar Meta
                </button>
              </article>
            </section>
            {operationMessage && (
              <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs font-medium text-blue-950">
                {operationMessage}
              </p>
            )}
          </>
      )}

      {tab === "products" && (
        <section className="panel rounded-[24px] p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="eyebrow">Mapeamento dinamico</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                Produtos e etapas
              </h2>
            </div>
            <button
              type="button"
              onClick={saveProducts}
              disabled={saveStatus === "saving"}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-xs font-bold text-white"
            >
              {saveStatus === "saved" ? <Check size={15} /> : <Save size={15} />}
              {saveStatus === "saving"
                ? "Salvando..."
                : saveStatus === "saved"
                  ? "Salvo"
                  : "Salvar mapa"}
            </button>
          </div>
          {saveStatus === "error" && (
            <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
              Nao foi possivel salvar o mapeamento.
            </p>
          )}
          {!products.length && (
            <p className="rounded-2xl border border-dashed border-[var(--line)] p-6 text-sm text-[var(--muted)]">
              Nenhum produto recebido ainda. Produtos aparecem aqui apos o primeiro webhook da plataforma.
            </p>
          )}
          <div className="space-y-3">
            {products.map((product, index) => (
              <div
                key={`${product.name}-${index}`}
                className="grid gap-3 rounded-2xl border border-[var(--line)] bg-white/45 p-4 sm:grid-cols-[1fr_190px_140px]"
              >
                <input
                  className="field"
                  value={product.name}
                  readOnly={!demoMode}
                  onChange={(event) =>
                    setProducts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, name: event.target.value } : item,
                      ),
                    )
                  }
                />
                <select
                  className="field"
                  value={product.stageId ?? ""}
                  disabled={
                    !demoMode &&
                    Boolean(product.mappedProjectId) &&
                    product.mappedProjectId !== project.id
                  }
                  onChange={(event) =>
                    setProducts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, stageId: event.target.value || null } : item,
                      ),
                    )
                  }
                >
                  <option value="">Sem mapeamento</option>
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
                <input
                  className="field text-right"
                  inputMode="decimal"
                  value={product.price}
                  readOnly={!demoMode}
                  onChange={(event) =>
                    setProducts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, price: Number(event.target.value) || 0 }
                          : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "settings" && (
        <section className="panel rounded-[24px] p-6">
          <p className="eyebrow">Parametros do projeto</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
            Metas e operacao
          </h2>
          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-bold">
              Meta mensal
              <input className="field" defaultValue={project.monthlyTarget} />
            </label>
            <label className="space-y-2 text-xs font-bold">
              Margem alvo (%)
              <input className="field" defaultValue={project.marginTarget} />
            </label>
            <label className="space-y-2 text-xs font-bold sm:col-span-2">
              Conta Meta principal
              <select
                className="field"
                value={metaAccountId}
                onChange={(event) => setMetaAccountId(event.target.value)}
              >
                <option value="">Sem conta vinculada</option>
                {initialCatalog.metaAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.externalId})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={saveMetaAccount}
            disabled={operation !== "idle"}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40"
          >
            {operation === "linking" && <LoaderCircle size={14} className="animate-spin" />}
            Salvar conta Meta
          </button>
          {operationMessage && (
            <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-xs font-medium text-blue-950">
              {operationMessage}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
