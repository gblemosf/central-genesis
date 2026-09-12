"use client";

import Link from "next/link";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ProjectMetricsPanel } from "@/components/project-metrics-panel";
import type {
  FunnelStageType,
  ProjectAnalytics,
  ProjectCatalog,
  ProjectFunnelStage,
  ProjectFormsData,
  ProjectProduct,
  ProjectSummary,
} from "@/lib/domain";
import { calculatePerformance } from "@/lib/metrics";
import { getProjectReadiness } from "@/lib/project-readiness";
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

const stageTypeLabels: Record<FunnelStageType, string> = {
  core: "Core",
  order_bump: "Order bump",
  upsell: "Upsell",
  downsell: "Downsell",
  low_ticket: "Low ticket",
  front_end: "Front-end",
  middle_end: "Middle-end",
  back_end: "Back-end",
};

const projectStatusLabels: Record<ProjectSummary["status"], string> = {
  draft: "Projeto em revisao",
  active: "Projeto ativo",
  paused: "Projeto pausado",
  archived: "Projeto arquivado",
};

const recoveryStatusLabels = {
  abandoned: "Abandonado",
  pending: "Pendente",
  failed: "Falhou",
  expired: "Expirado",
  recovered: "Recuperado",
} as const;

function formatDateTime(value: string | null) {
  if (!value) return "Pendente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function ProjectWorkspace({
  project,
  initialCatalog,
  analytics,
  initialForms,
  demoMode,
  googleOAuthConfigured,
}: {
  project: ProjectSummary;
  initialCatalog: ProjectCatalog;
  analytics: ProjectAnalytics;
  initialForms: ProjectFormsData;
  demoMode: boolean;
  googleOAuthConfigured: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<
    "overview" | "metrics" | "forms" | "leads" | "utms" | "products" | "settings"
  >("overview");
  const demoProducts = productSets[project.id] ?? [
    { name: "Produto principal", stage: "Core", price: 0 },
  ];
  const demoStages: ProjectFunnelStage[] = Array.from(
    new Set(demoProducts.map((product) => product.stage)),
  ).map((name, index) => {
    const normalizedName = name.toLowerCase();
    const type: FunnelStageType = normalizedName.includes("order bump")
      ? "order_bump"
      : normalizedName.includes("upsell")
        ? "upsell"
        : normalizedName.includes("downsell")
          ? "downsell"
          : "core";
    return {
      id: name,
      name,
      type,
      position: index + 1,
      color: null,
      archivedAt: null,
    };
  });
  const [stages, setStages] = useState<ProjectFunnelStage[]>(
    demoMode ? demoStages : initialCatalog.stages,
  );
  const [products, setProducts] = useState<ProjectProduct[]>(
    demoMode
      ? demoProducts.map((product, index) => ({
          id: `demo-${index}`,
          connectionId: null,
          externalId: `demo-${index}`,
          name: product.name,
          stageId: product.stage,
          price: product.price,
          currency: "BRL",
          source: "manual",
          archivedAt: null,
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
  const googleConnections = initialForms.connections.filter(
    (connection) => connection.status !== "revoked",
  );
  const [googleConnectionId, setGoogleConnectionId] = useState(
    googleConnections[0]?.id ?? "",
  );
  const [googleFormUrl, setGoogleFormUrl] = useState("");
  const [formsOperation, setFormsOperation] = useState<"idle" | "syncing">("idle");
  const [formsMessage, setFormsMessage] = useState("");
  const [projectSettings, setProjectSettings] = useState({
    monthlyTarget: project.monthlyTarget,
    marginTarget: project.marginTarget,
    status: project.status,
  });
  const [projectSaveState, setProjectSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [projectMessage, setProjectMessage] = useState("");
  const [catalogMessage, setCatalogMessage] = useState("");
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [stageDraft, setStageDraft] = useState({
    name: "",
    type: "core" as FunnelStageType,
    color: "#61d6c8",
  });
  const [productDraft, setProductDraft] = useState({
    connectionId: "",
    externalId: "",
    name: "",
    price: "",
    stageId: "",
  });
  const activeStages = stages
    .filter((stage) => !stage.archivedAt)
    .sort((a, b) => a.position - b.position);
  const archivedStages = stages.filter((stage) => stage.archivedAt);
  const nextStagePosition = Math.max(0, ...activeStages.map((stage) => stage.position)) + 1;
  const activeProducts = products.filter((product) => !product.archivedAt);
  const archivedProducts = products.filter((product) => product.archivedAt);
  const totals = calculatePerformance(project.dailyMetrics);
  const readiness = getProjectReadiness(
    project,
    {
      ...initialCatalog,
      products,
      stages,
      linkedMetaAccountId: metaAccountId || null,
    },
    analytics,
  );
  const hasProjectData = project.dailyMetrics.some(
    (metric) =>
      metric.investment !== 0 ||
      metric.revenue !== 0 ||
      metric.impressions !== 0 ||
      metric.clicks !== 0 ||
      metric.pageViews !== 0 ||
      metric.checkouts !== 0 ||
      metric.coreSales !== 0,
  );
  const hasTrafficData = project.dailyMetrics.some(
    (metric) =>
      metric.investment !== 0 ||
      metric.impressions !== 0 ||
      metric.clicks !== 0 ||
      metric.pageViews !== 0 ||
      metric.checkouts !== 0,
  );
  const hasSalesData = project.dailyMetrics.some(
    (metric) => metric.revenue !== 0 || metric.coreSales !== 0,
  );
  const trafficSourceSummary = analytics.dataSources.csvDailyRows > 0
    ? `CSV diario (${analytics.dataSources.csvDailyRows} linhas)`
    : analytics.dataSources.metaTrafficRows > 0
      ? `Meta (${analytics.dataSources.metaTrafficRows} dias)`
      : "Sem fonte";
  const salesSourceSummary = analytics.dataSources.csvDailyRows > 0
    ? `CSV diario (${analytics.dataSources.csvDailyRows} linhas)`
    : analytics.dataSources.webhookSalesEvents > 0
      ? `Webhook (${analytics.dataSources.webhookSalesEvents} eventos)`
      : "Sem fonte";

  async function saveProducts() {
    setSaveStatus("saving");
    if (!demoMode) {
      try {
        for (const product of activeProducts) {
          if (product.mappedProjectId && product.mappedProjectId !== project.id) continue;
          const response = await fetch(
            `/api/projects/${project.id}/products/${product.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                externalId: product.externalId,
                name: product.name,
                price: product.price,
                currency: product.currency,
                funnelStageId: product.stageId,
              }),
            },
          );
          if (!response.ok) {
            setCatalogMessage("Nao foi possivel salvar todos os mapeamentos.");
            setSaveStatus("error");
            return;
          }
        }
      } catch {
        setCatalogMessage("Falha de rede ao salvar os mapeamentos.");
        setSaveStatus("error");
        return;
      }
    }
    setProducts((current) =>
      current.map((product) =>
        product.archivedAt ||
        (product.mappedProjectId && product.mappedProjectId !== project.id)
          ? product
          : {
              ...product,
              mappedProjectId: product.stageId ? project.id : null,
            },
      ),
    );
    setSaveStatus("saved");
    if (demoMode) {
      setCatalogMessage("Alteracao demonstrativa; nenhum produto foi persistido.");
    }
    startTransition(() => router.refresh());
    window.setTimeout(() => setSaveStatus("idle"), 1800);
  }

  async function createStage() {
    if (!stageDraft.name.trim()) return;
    setBusyItem("new-stage");
    setCatalogMessage("");
    if (demoMode) {
      setStages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          name: stageDraft.name.trim(),
          type: stageDraft.type,
          position: nextStagePosition,
          color: stageDraft.color,
          archivedAt: null,
        },
      ]);
      setStageDraft({ name: "", type: "core", color: "#61d6c8" });
      setCatalogMessage("Etapa demonstrativa adicionada; ela nao foi persistida.");
      setBusyItem(null);
      return;
    }

    try {
      const response = await fetch(`/api/projects/${project.id}/stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stageDraft),
      });
      const body = (await response.json().catch(() => null)) as
        | { data?: { id?: string }; error?: string }
        | null;
      if (!response.ok || !body?.data?.id) {
        setCatalogMessage(body?.error ?? "Nao foi possivel adicionar a etapa.");
        return;
      }
      setStages((current) => [
        ...current,
        {
          id: body.data!.id!,
          name: stageDraft.name.trim(),
          type: stageDraft.type,
          position: nextStagePosition,
          color: stageDraft.color,
          archivedAt: null,
        },
      ]);
      setStageDraft({ name: "", type: "core", color: "#61d6c8" });
    } catch {
      setCatalogMessage("Falha de rede ao adicionar a etapa.");
    } finally {
      setBusyItem(null);
    }
  }

  async function saveStage(stage: ProjectFunnelStage, archived = Boolean(stage.archivedAt)) {
    setBusyItem(stage.id);
    setCatalogMessage("");
    if (!demoMode) {
      try {
        const response = await fetch(`/api/projects/${project.id}/stages/${stage.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: stage.name,
            type: stage.type,
            color: stage.color,
            archived,
          }),
        });
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          setCatalogMessage(body?.error ?? "Nao foi possivel salvar a etapa.");
          setBusyItem(null);
          return;
        }
      } catch {
        setCatalogMessage("Falha de rede ao salvar a etapa.");
        setBusyItem(null);
        return;
      }
    }

    const nextArchivedAt = archived ? stage.archivedAt ?? new Date().toISOString() : null;
    const nextPosition = archived
      ? stage.position
      : stage.archivedAt
        ? nextStagePosition
        : stage.position;
    setStages((current) =>
      current.map((item) =>
        item.id === stage.id
          ? { ...item, archivedAt: nextArchivedAt, position: nextPosition }
          : item,
      ),
    );
    if (archived) {
      setProducts((current) =>
        current.map((product) =>
          product.stageId === stage.id
            ? { ...product, stageId: null, mappedProjectId: null }
            : product,
        ),
      );
    }
    setCatalogMessage(
      demoMode
        ? "Alteracao demonstrativa; a etapa nao foi persistida."
        : archived
          ? "Etapa arquivada sem apagar o historico."
          : "Etapa salva.",
    );
    setBusyItem(null);
  }

  async function moveStage(stageId: string, direction: -1 | 1) {
    const currentIndex = activeStages.findIndex((stage) => stage.id === stageId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= activeStages.length) return;
    const reordered = [...activeStages];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];
    setBusyItem(stageId);
    setCatalogMessage("");
    if (!demoMode) {
      try {
        const response = await fetch(`/api/projects/${project.id}/stages`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageIds: reordered.map((stage) => stage.id) }),
        });
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          setCatalogMessage(body?.error ?? "Nao foi possivel reordenar as etapas.");
          setBusyItem(null);
          return;
        }
      } catch {
        setCatalogMessage("Falha de rede ao reordenar as etapas.");
        setBusyItem(null);
        return;
      }
    }
    const positions = new Map(reordered.map((stage, index) => [stage.id, index + 1]));
    setStages((current) =>
      current.map((stage) => ({
        ...stage,
        position: positions.get(stage.id) ?? stage.position,
      })),
    );
    setBusyItem(null);
  }

  async function createProduct() {
    if (!productDraft.name.trim() || !productDraft.externalId.trim()) return;
    setBusyItem("new-product");
    setCatalogMessage("");
    const nextProduct: ProjectProduct = {
      id: crypto.randomUUID(),
      connectionId: productDraft.connectionId || null,
      externalId: productDraft.externalId.trim(),
      name: productDraft.name.trim(),
      price: Number(productDraft.price) || 0,
      currency: "BRL",
      source: "manual",
      archivedAt: null,
      stageId: productDraft.stageId || null,
      mappedProjectId: productDraft.stageId ? project.id : null,
    };

    if (!demoMode) {
      try {
        const response = await fetch(`/api/projects/${project.id}/products`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectionId: nextProduct.connectionId,
            externalId: nextProduct.externalId,
            name: nextProduct.name,
            price: nextProduct.price,
            currency: nextProduct.currency,
            funnelStageId: nextProduct.stageId,
          }),
        });
        const body = (await response.json().catch(() => null)) as
          | { data?: { id?: string }; error?: string }
          | null;
        if (!response.ok || !body?.data?.id) {
          setCatalogMessage(body?.error ?? "Nao foi possivel adicionar o produto.");
          setBusyItem(null);
          return;
        }
        nextProduct.id = body.data.id;
      } catch {
        setCatalogMessage("Falha de rede ao adicionar o produto.");
        setBusyItem(null);
        return;
      }
    }

    setProducts((current) => [...current, nextProduct]);
    setProductDraft({ connectionId: "", externalId: "", name: "", price: "", stageId: "" });
    setCatalogMessage(
      demoMode
        ? "Produto demonstrativo adicionado; ele nao foi persistido."
        : "Produto adicionado e historico preservado.",
    );
    setBusyItem(null);
  }

  async function saveProduct(product: ProjectProduct) {
    setBusyItem(product.id);
    setCatalogMessage("");
    if (!demoMode) {
      try {
        const response = await fetch(
          `/api/projects/${project.id}/products/${product.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              externalId: product.externalId,
              name: product.name,
              price: product.price,
              currency: product.currency,
              funnelStageId: product.stageId,
            }),
          },
        );
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          setCatalogMessage(body?.error ?? "Nao foi possivel salvar o produto.");
          setBusyItem(null);
          return;
        }
      } catch {
        setCatalogMessage("Falha de rede ao salvar o produto.");
        setBusyItem(null);
        return;
      }
    }
    setProducts((current) =>
      current.map((item) =>
        item.id === product.id
          ? { ...item, mappedProjectId: item.stageId ? project.id : null }
          : item,
      ),
    );
    setCatalogMessage(
      demoMode
        ? "Alteracao demonstrativa; produto e mapeamento nao foram persistidos."
        : "Produto e mapeamento salvos.",
    );
    startTransition(() => router.refresh());
    setBusyItem(null);
  }

  async function setProductArchived(product: ProjectProduct, archived: boolean) {
    if (archived && !window.confirm("Arquivar este produto sem apagar vendas antigas?")) {
      return;
    }
    setBusyItem(product.id);
    setCatalogMessage("");
    if (!demoMode) {
      try {
        const response = await fetch(
          `/api/projects/${project.id}/products/${product.id}`,
          archived
            ? { method: "DELETE" }
            : {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ archived: false }),
              },
        );
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          setCatalogMessage(body?.error ?? "Nao foi possivel atualizar o produto.");
          setBusyItem(null);
          return;
        }
      } catch {
        setCatalogMessage("Falha de rede ao atualizar o produto.");
        setBusyItem(null);
        return;
      }
    }
    setProducts((current) =>
      current.map((item) =>
        item.id === product.id
          ? {
              ...item,
              archivedAt: archived ? new Date().toISOString() : null,
              stageId: archived ? null : item.stageId,
              mappedProjectId: archived ? null : item.mappedProjectId,
            }
          : item,
      ),
    );
    setCatalogMessage(
      demoMode
        ? "Alteracao demonstrativa; o produto nao foi persistido."
        : archived
          ? "Produto arquivado sem apagar vendas antigas."
          : "Produto restaurado.",
    );
    startTransition(() => router.refresh());
    setBusyItem(null);
  }

  async function saveMetaAccount() {
    setOperation("linking");
    setOperationMessage("");
    if (!demoMode) {
      try {
        const response = await fetch(`/api/projects/${project.id}/meta-account`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerAccountId: metaAccountId || null }),
        });
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          setOperation("idle");
          setOperationMessage(body?.error ?? "Nao foi possivel vincular a conta Meta.");
          return;
        }
      } catch {
        setOperation("idle");
        setOperationMessage("Falha de rede ao vincular a conta Meta.");
        return;
      }
    }
    setOperation("idle");
    setOperationMessage(
      demoMode
        ? "Alteracao demonstrativa; a conta Meta nao foi persistida."
        : "Conta Meta atualizada.",
    );
    startTransition(() => router.refresh());
  }

  async function saveProjectSettings() {
    setProjectSaveState("saving");
    setProjectMessage("");
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      setProjectSaveState("saved");
      setProjectMessage("Alteracao apenas demonstrativa; nenhum dado foi persistido.");
      return;
    }

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectSettings),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setProjectSaveState("error");
        setProjectMessage(body?.error ?? "Nao foi possivel salvar o projeto.");
        return;
      }

      setProjectSaveState("saved");
      setProjectMessage("Metas e status salvos no Supabase.");
      startTransition(() => router.refresh());
    } catch {
      setProjectSaveState("error");
      setProjectMessage("Falha de rede ao salvar o projeto.");
    }
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

    try {
      const response = await fetch(`/api/projects/${project.id}/sync/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          since: analytics.config.periodStart,
          until: analytics.config.periodEnd,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { processed?: number; error?: string }
        | null;
      setOperation("idle");
      setOperationMessage(
        response.ok
          ? `${body?.processed ?? 0} metrica(s) sincronizada(s).`
          : body?.error ?? "Nao foi possivel sincronizar a Meta.",
      );
      if (response.ok) startTransition(() => router.refresh());
    } catch {
      setOperation("idle");
      setOperationMessage("Falha de rede ao sincronizar a Meta.");
    }
  }

  async function syncGoogleForm(googleFormId?: string) {
    setFormsOperation("syncing");
    setFormsMessage("");

    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      setFormsOperation("idle");
      setFormsMessage("Sincronizacao demonstrativa concluida.");
      return;
    }

    const payload = googleFormId
      ? { googleFormId, fullSync: false }
      : {
          connectionId: googleConnectionId,
          formUrl: googleFormUrl.trim(),
          fullSync: true,
        };

    try {
      const response = await fetch(`/api/projects/${project.id}/forms/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | { data?: { title?: string; processed?: number }; error?: string }
        | null;
      if (!response.ok) {
        setFormsMessage(body?.error ?? "Nao foi possivel sincronizar o formulario.");
        setFormsOperation("idle");
        return;
      }

      setGoogleFormUrl("");
      setFormsMessage(
        `${body?.data?.title ?? "Formulario"}: ${body?.data?.processed ?? 0} resposta(s) processada(s).`,
      );
      setFormsOperation("idle");
      startTransition(() => router.refresh());
    } catch {
      setFormsOperation("idle");
      setFormsMessage("Falha de rede ao sincronizar o formulario.");
    }
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
            <p className="eyebrow mb-2">{projectStatusLabels[project.status]}</p>
            <h1 className="text-3xl font-black tracking-[-0.05em] sm:text-4xl">
              {project.name}
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">{project.expertName}</p>
          </div>
        </div>
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[var(--line)] bg-white/45 p-1">
          {[
            ["overview", "Resumo"],
            ["metrics", "Metricas"],
            ["forms", "Formularios"],
            ["leads", "Leads"],
            ["utms", "UTMs"],
            ["products", "Produtos"],
            ["settings", "Configuracoes"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key as typeof tab)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-bold ${
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

      {!project.legacy && (
        <section className="panel rounded-[24px] p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">Prontidao operacional</p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.035em]">
                {readiness.ready
                  ? "Projeto pronto para acompanhamento"
                  : "Complete o fluxo antes de confiar no dashboard"}
              </h2>
            </div>
            <span
              className={`w-fit rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-wider ${
                readiness.ready
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {readiness.completed}/{readiness.total} concluido(s)
            </span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {readiness.items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.target)}
                className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${
                  item.ready
                    ? "border-emerald-200 bg-emerald-50/70"
                    : "border-amber-200 bg-amber-50/70"
                }`}
              >
                <span
                  className={`grid size-7 place-items-center rounded-full ${
                    item.ready
                      ? "bg-emerald-600 text-white"
                      : "bg-amber-200 text-amber-900"
                  }`}
                >
                  {item.ready ? <Check size={13} /> : <CircleAlert size={13} />}
                </span>
                <span className="mt-3 block text-xs font-black">{item.label}</span>
                <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === "overview" && (
        <>
          {!hasProjectData && (
            <section className="rounded-[24px] border border-amber-200 bg-amber-50 p-6 text-amber-950">
              <p className="eyebrow text-amber-800">Projeto criado, configuracao pendente</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                Complete os primeiros passos para liberar os indicadores
              </h2>
              <div className="mt-6 grid gap-3 lg:grid-cols-3">
                {[
                  ["1", "Abastecer dados", "Importe os CSVs de trafego e vendas.", "metrics"],
                  ["2", "Mapear produtos", "Associe produtos as etapas do funil.", "products"],
                  ["3", "Revisar operacao", "Confirme metas, status e conta Meta.", "settings"],
                ].map(([number, title, description, target]) => (
                  <button
                    key={number}
                    type="button"
                    onClick={() => setTab(target as typeof tab)}
                    className="rounded-2xl border border-amber-200 bg-white/55 p-4 text-left"
                  >
                    <span className="grid size-6 place-items-center rounded-full bg-amber-200 text-[10px] font-black">
                      {number}
                    </span>
                    <span className="mt-3 block text-xs font-black">{title}</span>
                    <span className="mt-1 block text-[10px] leading-4 text-amber-900/70">
                      {description}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Faturamento observado", hasProjectData ? formatCurrency(totals.revenue) : "Sem dados"],
              ["Investimento em midia", hasProjectData ? formatCurrency(totals.investment) : "Sem dados"],
              ["Saldo apos midia", hasProjectData ? formatCurrency(totals.profit) : "Sem dados"],
              ["ROAS", hasProjectData ? `${totals.roas.toFixed(2)}x` : "Sem dados"],
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
              <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">
                Visao do mes atual. Custos operacionais completos aparecem em Metricas &gt;
                Financeiro.
              </p>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                {[
                  ["CTR", hasTrafficData ? formatPercent(totals.ctr) : "Sem dados"],
                  ["Connect rate", hasTrafficData ? formatPercent(totals.connectRate) : "Sem dados"],
                  ["Pagina para checkout", hasTrafficData ? formatPercent(totals.checkoutRate) : "Sem dados"],
                  ["Vendas core", hasSalesData ? formatNumber(totals.coreSales) : "Sem dados"],
                  ["CPA", hasTrafficData && hasSalesData ? formatCurrency(totals.cpa) : "Sem dados"],
                  ["AOV", hasSalesData ? formatCurrency(totals.aov) : "Sem dados"],
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
                {hasProjectData ? "Fontes com dados" : "Aguardando abastecimento"}
              </h2>
               <div className="mt-7 space-y-3 text-xs">
                <div className="flex justify-between border-b border-white/8 pb-3">
                  <span className="text-white/45">Trafego</span>
                  <span className="font-bold">{trafficSourceSummary}</span>
                </div>
                <div className="flex justify-between border-b border-white/8 pb-3">
                  <span className="text-white/45">Vendas</span>
                  <span className="font-bold">{salesSourceSummary}</span>
                </div>
                <div className="flex justify-between border-b border-white/8 pb-3">
                  <span className="text-white/45">Produtos mapeados</span>
                  <span className="font-bold">{project.products}</span>
                </div>
                <div className="flex justify-between pb-3">
                  <span className="text-white/45">Ultimo dia com dados</span>
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
                {!demoMode && !metaAccountId && (
                  <p className="mt-3 text-[10px] leading-4 text-white/45">
                    Vincule uma conta em Configuracoes ou use os CSVs em Metricas &gt;
                    Abastecimento.
                  </p>
                )}
              </article>
            </section>
            {operationMessage && (
              <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs font-medium text-blue-950">
                {operationMessage}
              </p>
            )}
          </>
      )}

      {tab === "forms" && (
        <div className="space-y-5">
          {!demoMode && !googleOAuthConfigured && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950 sm:flex-row sm:items-center sm:justify-between">
              <span>
                A sincronizacao esta pausada porque as credenciais OAuth do Google nao
                existem neste ambiente.
              </span>
              <Link href="/settings" className="shrink-0 font-black underline">
                Revisar configuracao
              </Link>
            </div>
          )}
          {initialForms.warning && (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
              {initialForms.warning}
            </p>
          )}
          {formsMessage && (
            <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs font-medium text-blue-950">
              {formsMessage}
            </p>
          )}

          <section className="panel rounded-[24px] p-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">Google Forms</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Vincular formulario
                </h2>
                <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">
                  Informe a URL do Google Form. A sincronizacao inicial busca perguntas,
                  respostas, contatos e UTMs.
                </p>
              </div>
              {!googleConnections.length && !demoMode &&
                (googleOAuthConfigured ? (
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "/api/connections/google/authorize";
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-xs font-bold text-white"
                  >
                    <KeyRound size={14} /> Conectar Google Forms
                  </button>
                ) : (
                  <Link
                    href="/settings"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-950"
                  >
                    <CircleAlert size={14} /> Configurar OAuth Google
                  </Link>
                ))}
            </div>

            <div className="grid gap-3 rounded-2xl bg-black/[0.035] p-4 lg:grid-cols-[220px_1fr_auto]">
              <select
                className="field"
                value={googleConnectionId}
                onChange={(event) => setGoogleConnectionId(event.target.value)}
                disabled={!googleConnections.length || demoMode}
              >
                <option value="">Sem conexao Google</option>
                {googleConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
              <input
                className="field"
                value={googleFormUrl}
                onChange={(event) => setGoogleFormUrl(event.target.value)}
                placeholder="https://docs.google.com/forms/d/..."
              />
              <button
                type="button"
                onClick={() => syncGoogleForm()}
                disabled={
                  formsOperation !== "idle" ||
                  (!demoMode && !googleOAuthConfigured) ||
                  (!demoMode && (!googleConnectionId || !googleFormUrl.trim()))
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-4 text-xs font-bold text-white disabled:opacity-40"
              >
                {formsOperation === "syncing" ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Sincronizar
              </button>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            {initialForms.forms.map((form) => (
              <article key={form.id} className="panel rounded-[24px] p-6">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      Versao {form.schemaVersion}
                    </p>
                    <h3 className="mt-2 text-lg font-black tracking-[-0.03em]">
                      {form.title}
                    </h3>
                    <p className="mt-1 break-all text-[10px] text-[var(--muted)]">
                      {form.externalFormId}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => syncGoogleForm(form.id)}
                    disabled={
                      formsOperation !== "idle" || (!demoMode && !googleOAuthConfigured)
                    }
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-[10px] font-bold disabled:opacity-40"
                  >
                    {formsOperation === "syncing" ? (
                      <LoaderCircle size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    Atualizar
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["Respostas", form.totalResponses],
                    ["Leads unicos", form.uniqueRespondents],
                    ["Nao resolvidas", form.unresolvedResponses + form.conflictResponses],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-black/[0.035] p-4">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                        {label}
                      </p>
                      <p className="mt-2 text-2xl font-black">{formatNumber(Number(value))}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 space-y-2 border-t border-[var(--line)] pt-4 text-xs">
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted)]">Ultima resposta</span>
                    <span className="font-bold">{formatDateTime(form.latestResponseAt)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-[var(--muted)]">Ultima sincronizacao</span>
                    <span className="font-bold">{formatDateTime(form.lastSyncedAt)}</span>
                  </div>
                  {form.lastError && (
                    <p className="rounded-xl bg-red-50 px-3 py-2 text-[11px] text-red-800">
                      {form.lastError}
                    </p>
                  )}
                </div>
              </article>
            ))}
            {!initialForms.forms.length && (
              <p className="rounded-[24px] border border-dashed border-[var(--line)] p-8 text-sm text-[var(--muted)]">
                Nenhum formulario vinculado a este projeto ainda.
              </p>
            )}
          </section>
        </div>
      )}

      {tab === "leads" && (
        <div className="space-y-6">
          <section className="panel rounded-[24px] p-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">Hubla</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Recuperacao de checkout
                </h2>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Abandonos e pagamentos pendentes identificados pelo webhook.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-amber-900">
                  <strong className="block text-xl">
                    {formatNumber(initialForms.recoveryAttempts.filter((attempt) =>
                      attempt.status !== "recovered" && attempt.status !== "expired"
                    ).length)}
                  </strong>
                  Em aberto
                </div>
                <div className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">
                  <strong className="block text-xl">
                    {formatNumber(initialForms.recoveryAttempts.filter((attempt) =>
                      attempt.status === "recovered"
                    ).length)}
                  </strong>
                  Recuperados
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="border-b border-[var(--line)] px-3 py-3">Status</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">Contato</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">Telefone</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">Valor</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">Origem</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">Ultimo evento</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">Checkout</th>
                  </tr>
                </thead>
                <tbody>
                  {initialForms.recoveryAttempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <td className="border-b border-[var(--line)] px-3 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                          attempt.status === "recovered"
                            ? "bg-emerald-100 text-emerald-800"
                            : attempt.status === "expired"
                              ? "bg-slate-100 text-slate-700"
                              : "bg-amber-100 text-amber-900"
                        }`}>
                          {recoveryStatusLabels[attempt.status]}
                        </span>
                      </td>
                      <td className="border-b border-[var(--line)] px-3 py-3">
                        <strong className="block">{attempt.contactName ?? "Sem nome"}</strong>
                        <span className="mt-1 block text-[10px] text-[var(--muted)]">
                          {attempt.contactEmail ?? "Sem e-mail"}
                        </span>
                      </td>
                      <td className="border-b border-[var(--line)] px-3 py-3">
                        {attempt.contactPhone ?? "-"}
                      </td>
                      <td className="border-b border-[var(--line)] px-3 py-3 font-bold">
                        {formatCurrency(attempt.amount)}
                      </td>
                      <td className="max-w-[240px] border-b border-[var(--line)] px-3 py-3">
                        <span className="block truncate">
                          {attempt.utmSource ?? "sem origem"} / {attempt.utmMedium ?? "sem meio"}
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">
                          {attempt.utmCampaign ?? "Sem campanha"}
                        </span>
                      </td>
                      <td className="border-b border-[var(--line)] px-3 py-3">
                        {formatDateTime(attempt.lastSeenAt)}
                      </td>
                      <td className="border-b border-[var(--line)] px-3 py-3">
                        {attempt.checkoutUrl ? (
                          <a
                            href={attempt.checkoutUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold text-violet-700 hover:underline"
                          >
                            Abrir
                          </a>
                        ) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!initialForms.recoveryAttempts.length && (
              <p className="mt-4 rounded-2xl border border-dashed border-[var(--line)] p-6 text-sm text-[var(--muted)]">
                Os abandonos aparecem aqui depois do primeiro evento real da Hubla.
              </p>
            )}
          </section>

          <section className="panel rounded-[24px] p-6">
            <div className="mb-6">
              <p className="eyebrow">Contatos</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                Leads identificados
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
                  <tr>
                    <th className="border-b border-[var(--line)] px-3 py-3">Nome</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">E-mail</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">Telefone</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">Fonte</th>
                    <th className="border-b border-[var(--line)] px-3 py-3">Ultimo contato</th>
                  </tr>
                </thead>
                <tbody>
                  {initialForms.contacts.map((contact) => (
                    <tr key={contact.id}>
                      <td className="border-b border-[var(--line)] px-3 py-3 font-bold">
                        {contact.name ?? "Sem nome"}
                      </td>
                      <td className="border-b border-[var(--line)] px-3 py-3">
                        {contact.email ?? "-"}
                      </td>
                      <td className="border-b border-[var(--line)] px-3 py-3">
                        {contact.phone ?? "-"}
                      </td>
                      <td className="border-b border-[var(--line)] px-3 py-3">
                        {contact.source ?? "-"}
                      </td>
                      <td className="border-b border-[var(--line)] px-3 py-3">
                        {formatDateTime(contact.lastSeenAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!initialForms.contacts.length && (
              <p className="mt-4 rounded-2xl border border-dashed border-[var(--line)] p-6 text-sm text-[var(--muted)]">
                Os leads aparecem aqui depois da primeira resposta ou evento da Hubla.
              </p>
            )}
          </section>
        </div>
      )}

      {tab === "utms" && (
        <section className="panel rounded-[24px] p-6">
          <div className="mb-6">
            <p className="eyebrow">Origem de leads</p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
              Campanhas UTM
            </h2>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {initialForms.utms.map((utm) => (
              <article key={utm.id} className="rounded-2xl border border-[var(--line)] bg-white/45 p-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  {utm.source ?? "sem source"} / {utm.medium ?? "sem medium"}
                </p>
                <h3 className="mt-2 text-lg font-black tracking-[-0.03em]">
                  {utm.campaign ?? "Campanha sem nome"}
                </h3>
                <div className="mt-5 grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="block text-[var(--muted)]">Leads</span>
                    <strong className="mt-1 block text-lg">{formatNumber(utm.contacts)}</strong>
                  </div>
                  <div>
                    <span className="block text-[var(--muted)]">Respostas</span>
                    <strong className="mt-1 block text-lg">{formatNumber(utm.responses)}</strong>
                  </div>
                  <div>
                    <span className="block text-[var(--muted)]">Ultimo toque</span>
                    <strong className="mt-1 block text-[11px]">
                      {formatDateTime(utm.latestTouchAt)}
                    </strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!initialForms.utms.length && (
            <p className="rounded-2xl border border-dashed border-[var(--line)] p-6 text-sm text-[var(--muted)]">
              UTMs aparecem quando as respostas trouxerem campos de origem/campanha.
            </p>
          )}
        </section>
      )}

      {tab === "products" && (
        project.legacy ? (
          <section className="panel rounded-[24px] p-6">
            <p className="eyebrow">Historico preservado</p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
              Projeto em modo somente leitura
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              As metricas importadas continuam disponiveis. Migre o projeto para o
              catalogo normalizado antes de alterar etapas ou produtos.
            </p>
          </section>
        ) : (
        <div className="space-y-5">
          {catalogMessage && (
            <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs font-medium text-blue-950">
              {catalogMessage}
            </p>
          )}

          <section className="panel rounded-[24px] p-6">
            <div className="mb-6">
              <p className="eyebrow">Ordem operacional</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                Etapas do funil
              </h2>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                Alteracoes futuras nao reclassificam as vendas que ja foram registradas.
              </p>
            </div>

            <div className="grid gap-3 rounded-2xl bg-black/[0.035] p-4 sm:grid-cols-[1fr_180px_70px_auto]">
              <input
                className="field"
                value={stageDraft.name}
                placeholder="Nova etapa"
                onChange={(event) =>
                  setStageDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
              <select
                className="field"
                value={stageDraft.type}
                onChange={(event) =>
                  setStageDraft((current) => ({
                    ...current,
                    type: event.target.value as FunnelStageType,
                  }))
                }
              >
                {Object.entries(stageTypeLabels).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                className="field h-11 p-2"
                type="color"
                aria-label="Cor da nova etapa"
                value={stageDraft.color}
                onChange={(event) =>
                  setStageDraft((current) => ({ ...current, color: event.target.value }))
                }
              />
              <button
                type="button"
                onClick={createStage}
                disabled={busyItem === "new-stage" || !stageDraft.name.trim()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-4 text-xs font-bold text-white disabled:opacity-40"
              >
                {busyItem === "new-stage" ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Adicionar
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {activeStages.map((stage, index) => (
                <div
                  key={stage.id}
                  className="grid gap-3 rounded-2xl border border-[var(--line)] bg-white/45 p-4 lg:grid-cols-[72px_1fr_180px_70px_auto]"
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Mover ${stage.name} para cima`}
                      disabled={index === 0 || busyItem === stage.id}
                      onClick={() => moveStage(stage.id, -1)}
                      className="grid size-8 place-items-center rounded-lg border border-[var(--line)] disabled:opacity-25"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Mover ${stage.name} para baixo`}
                      disabled={index === activeStages.length - 1 || busyItem === stage.id}
                      onClick={() => moveStage(stage.id, 1)}
                      className="grid size-8 place-items-center rounded-lg border border-[var(--line)] disabled:opacity-25"
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                  <input
                    className="field"
                    value={stage.name}
                    onChange={(event) =>
                      setStages((current) =>
                        current.map((item) =>
                          item.id === stage.id ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <select
                    className="field"
                    value={stage.type}
                    onChange={(event) =>
                      setStages((current) =>
                        current.map((item) =>
                          item.id === stage.id
                            ? { ...item, type: event.target.value as FunnelStageType }
                            : item,
                        ),
                      )
                    }
                  >
                    {Object.entries(stageTypeLabels).map(([type, label]) => (
                      <option key={type} value={type}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="field h-11 p-2"
                    type="color"
                    aria-label={`Cor de ${stage.name}`}
                    value={stage.color ?? "#61d6c8"}
                    onChange={(event) =>
                      setStages((current) =>
                        current.map((item) =>
                          item.id === stage.id ? { ...item, color: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveStage(stage, false)}
                      disabled={busyItem === stage.id || !stage.name.trim()}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-[10px] font-bold disabled:opacity-40"
                    >
                      <Save size={13} /> Salvar
                    </button>
                    <button
                      type="button"
                      aria-label={`Arquivar ${stage.name}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Arquivar esta etapa? Produtos ativos serao desmapeados, mas as vendas antigas permanecerao intactas.",
                          )
                        ) {
                          void saveStage(stage, true);
                        }
                      }}
                      disabled={busyItem === stage.id}
                      className="grid size-10 place-items-center rounded-xl border border-red-200 text-red-700 disabled:opacity-40"
                    >
                      <Archive size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {archivedStages.length > 0 && (
              <div className="mt-5 border-t border-[var(--line)] pt-4">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Etapas arquivadas
                </p>
                <div className="flex flex-wrap gap-2">
                  {archivedStages.map((stage) => (
                    <button
                      key={stage.id}
                      type="button"
                      onClick={() => saveStage(stage, false)}
                      disabled={busyItem === stage.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-[10px] font-bold disabled:opacity-40"
                    >
                      <RotateCcw size={13} /> Restaurar {stage.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="panel rounded-[24px] p-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="eyebrow">Catalogo manual e integracoes</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Produtos e mapeamentos
                </h2>
              </div>
              <button
                type="button"
                onClick={saveProducts}
                disabled={saveStatus === "saving"}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-xs font-bold text-white"
              >
                {saveStatus === "saved" ? <Check size={15} /> : <Save size={15} />}
                {saveStatus === "saving"
                  ? "Salvando..."
                  : saveStatus === "saved"
                    ? "Mapa salvo"
                    : "Salvar todos os mapas"}
              </button>
            </div>

            <div className="grid gap-3 rounded-2xl bg-[var(--sidebar)] p-4 text-white md:grid-cols-2 xl:grid-cols-[180px_1fr_1fr_120px_180px_auto]">
              <select
                className="field text-[var(--ink)]"
                value={productDraft.connectionId}
                onChange={(event) =>
                  setProductDraft((current) => ({
                    ...current,
                    connectionId: event.target.value,
                  }))
                }
              >
                <option value="">Produto interno</option>
                {initialCatalog.salesConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
              <input
                className="field text-[var(--ink)]"
                placeholder="ID externo ou interno"
                value={productDraft.externalId}
                onChange={(event) =>
                  setProductDraft((current) => ({
                    ...current,
                    externalId: event.target.value,
                  }))
                }
              />
              <input
                className="field text-[var(--ink)]"
                placeholder="Nome do produto"
                value={productDraft.name}
                onChange={(event) =>
                  setProductDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
              <input
                className="field text-right text-[var(--ink)]"
                type="number"
                min="0"
                step="0.01"
                placeholder="Preco"
                value={productDraft.price}
                onChange={(event) =>
                  setProductDraft((current) => ({ ...current, price: event.target.value }))
                }
              />
              <select
                className="field text-[var(--ink)]"
                value={productDraft.stageId}
                onChange={(event) =>
                  setProductDraft((current) => ({ ...current, stageId: event.target.value }))
                }
              >
                <option value="">Sem mapeamento</option>
                {activeStages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name} · {stageTypeLabels[stage.type]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={createProduct}
                disabled={
                  busyItem === "new-product" ||
                  !productDraft.name.trim() ||
                  !productDraft.externalId.trim()
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--signal)] px-4 text-xs font-black text-[var(--ink)] disabled:opacity-40"
              >
                {busyItem === "new-product" ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                Adicionar
              </button>
            </div>

            {saveStatus === "error" && (
              <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
                Nao foi possivel salvar o mapeamento.
              </p>
            )}
            {!activeProducts.length && (
              <p className="mt-4 rounded-2xl border border-dashed border-[var(--line)] p-6 text-sm text-[var(--muted)]">
                Adicione um produto manualmente ou sincronize o catalogo da integracao.
              </p>
            )}

            <div className="mt-4 space-y-3">
              {activeProducts.map((product) => {
                const locked = Boolean(
                  product.mappedProjectId && product.mappedProjectId !== project.id,
                );
                return (
                  <div
                    key={product.id}
                    className="grid gap-3 rounded-2xl border border-[var(--line)] bg-white/45 p-4 xl:grid-cols-[1fr_1fr_120px_190px_auto]"
                  >
                    <label className="space-y-1 text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      Produto
                      <input
                        className="field normal-case"
                        value={product.name}
                        disabled={locked}
                        onChange={(event) =>
                          setProducts((current) =>
                            current.map((item) =>
                              item.id === product.id
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="space-y-1 text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      Identificador · {product.source === "manual" ? "manual" : "integracao"}
                      <input
                        className="field normal-case"
                        value={product.externalId}
                        disabled={locked || product.connectionId !== null}
                        onChange={(event) =>
                          setProducts((current) =>
                            current.map((item) =>
                              item.id === product.id
                                ? { ...item, externalId: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="space-y-1 text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      Preco
                      <input
                        className="field text-right normal-case"
                        type="number"
                        min="0"
                        step="0.01"
                        value={product.price}
                        disabled={locked}
                        onChange={(event) =>
                          setProducts((current) =>
                            current.map((item) =>
                              item.id === product.id
                                ? { ...item, price: Number(event.target.value) || 0 }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="space-y-1 text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      Etapa
                      <select
                        className="field normal-case"
                        value={product.stageId ?? ""}
                        disabled={locked}
                        onChange={(event) =>
                          setProducts((current) =>
                            current.map((item) =>
                              item.id === product.id
                                ? { ...item, stageId: event.target.value || null }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="">Sem mapeamento</option>
                        {activeStages.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name} · {stageTypeLabels[stage.type]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={() => saveProduct(product)}
                        disabled={busyItem === product.id || locked}
                        className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-[10px] font-bold disabled:opacity-40"
                      >
                        {busyItem === product.id ? (
                          <LoaderCircle size={13} className="animate-spin" />
                        ) : (
                          <Save size={13} />
                        )}
                        Salvar
                      </button>
                      <button
                        type="button"
                        aria-label={`Arquivar ${product.name}`}
                        onClick={() => setProductArchived(product, true)}
                        disabled={busyItem === product.id || locked}
                        className="grid size-11 place-items-center rounded-xl border border-red-200 text-red-700 disabled:opacity-40"
                      >
                        <Archive size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {archivedProducts.length > 0 && (
              <div className="mt-5 border-t border-[var(--line)] pt-4">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  Produtos arquivados
                </p>
                <div className="flex flex-wrap gap-2">
                  {archivedProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => setProductArchived(product, false)}
                      disabled={busyItem === product.id}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-[10px] font-bold disabled:opacity-40"
                    >
                      <RotateCcw size={13} /> Restaurar {product.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
        )
      )}

      {tab === "metrics" && (
        <ProjectMetricsPanel
          projectId={project.id}
          analytics={analytics}
          products={products}
          stages={stages}
          demoMode={demoMode}
          readOnly={Boolean(project.legacy)}
        />
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
              <input
                className="field"
                type="number"
                min="0"
                step="0.01"
                value={projectSettings.monthlyTarget}
                onChange={(event) =>
                  setProjectSettings((current) => ({
                    ...current,
                    monthlyTarget: Number(event.target.value) || 0,
                  }))
                }
                disabled={Boolean(project.legacy)}
              />
              <span className="block text-[10px] font-normal leading-4 text-[var(--muted)]">
                Objetivo mensal do contrato. Nao e preenchido pelos CSVs.
              </span>
            </label>
            <label className="space-y-2 text-xs font-bold">
              Margem alvo (%)
              <input
                className="field"
                type="number"
                min="-100"
                max="100"
                step="0.01"
                value={projectSettings.marginTarget}
                onChange={(event) =>
                  setProjectSettings((current) => ({
                    ...current,
                    marginTarget: Number(event.target.value) || 0,
                  }))
                }
                disabled={Boolean(project.legacy)}
              />
              <span className="block text-[10px] font-normal leading-4 text-[var(--muted)]">
                Margem desejada para comparacao; a margem realizada e calculada no
                Financeiro.
              </span>
            </label>
            <label className="space-y-2 text-xs font-bold sm:col-span-2">
              Status operacional
              <select
                className="field"
                value={projectSettings.status}
                onChange={(event) =>
                  setProjectSettings((current) => ({
                    ...current,
                    status: event.target.value as ProjectSummary["status"],
                  }))
                }
                disabled={Boolean(project.legacy)}
              >
                <option value="draft">Em revisao</option>
                <option value="active">Ativo</option>
                <option value="paused">Pausado</option>
                <option value="archived">Arquivado</option>
              </select>
              <span className="block text-[10px] font-normal leading-4 text-[var(--muted)]">
                Projetos em revisao ficam fora do consolidado ate serem ativados.
              </span>
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
              <span className="block text-[10px] font-normal leading-4 text-[var(--muted)]">
                Fonte automatica de trafego. Se nao houver conta, use o CSV de trafego.
              </span>
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveProjectSettings}
              disabled={projectSaveState === "saving" || Boolean(project.legacy)}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40"
            >
              {projectSaveState === "saving" ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : projectSaveState === "saved" ? (
                <Check size={14} />
              ) : (
                <Save size={14} />
              )}
              Salvar projeto
            </button>
            <button
              type="button"
              onClick={saveMetaAccount}
              disabled={operation !== "idle" || Boolean(project.legacy)}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 text-xs font-bold disabled:opacity-40"
            >
              {operation === "linking" && (
                <LoaderCircle size={14} className="animate-spin" />
              )}
              Salvar conta Meta
            </button>
          </div>
          {projectMessage && (
            <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-950">
              {projectMessage}
            </p>
          )}
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
