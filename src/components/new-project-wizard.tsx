"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileSpreadsheet,
  LoaderCircle,
  Plug,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type {
  FunnelStageType,
  MetaConnectionOption,
  SalesConnectionOption,
  SalesProvider,
} from "@/lib/domain";
import {
  funnelStageTypes,
  providerLabels,
  salesProviders,
} from "@/lib/domain";
import { projectSlug } from "@/lib/project-slug";
import { cn } from "@/lib/utils";

const steps = ["Expert", "Integracoes", "Funil", "Metas"];

interface FormState {
  expertName: string;
  expertEmail: string;
  projectName: string;
  slug: string;
  metaConnection: string;
  adAccountId: string;
  salesProvider: SalesProvider;
  salesConnectionId: string;
  monthlyTarget: string;
  marginTarget: string;
}

const initialState: FormState = {
  expertName: "",
  expertEmail: "",
  projectName: "",
  slug: "",
  metaConnection: "",
  adAccountId: "",
  salesProvider: "hotmart",
  salesConnectionId: "",
  monthlyTarget: "",
  marginTarget: "",
};

interface FunnelDraft {
  clientId: string;
  name: string;
  type: FunnelStageType;
  productId: string;
}

interface SalesCredentialDraft {
  name: string;
  accessToken: string;
  clientId: string;
  clientSecret: string;
  basicToken: string;
  hottok: string;
  accountId: string;
  webhookToken: string;
}

interface HublaEndpointDraft {
  connectionId: string;
  endpointUrl: string;
  tokenStored: boolean;
}

const emptySalesCredentialDraft: SalesCredentialDraft = {
  name: "",
  accessToken: "",
  clientId: "",
  clientSecret: "",
  basicToken: "",
  hottok: "",
  accountId: "",
  webhookToken: "",
};

const demoSalesConnections: SalesConnectionOption[] = [
  {
    id: "hotmart-main",
    name: "Hotmart demonstrativa",
    provider: "hotmart",
    products: [
      { id: "demo-core", externalId: "1001", name: "Formacao principal", price: 997, currency: "BRL" },
      { id: "demo-bump", externalId: "1002", name: "Material complementar", price: 47, currency: "BRL" },
    ],
  },
];

const initialFunnel: FunnelDraft[] = [
  { clientId: "stage-1", name: "Produto core", type: "core", productId: "" },
];

const stageTypeLabels: Record<FunnelStageType, string> = {
  core: "Produto core",
  order_bump: "Order bump",
  upsell: "Upsell",
  downsell: "Downsell",
  low_ticket: "Low ticket",
  front_end: "Front-end",
  middle_end: "Middle-end",
  back_end: "Back-end",
};

export function NewProjectWizard({
  demoMode,
  metaConnections,
  salesConnections,
}: {
  demoMode: boolean;
  metaConnections: MetaConnectionOption[];
  salesConnections: SalesConnectionOption[];
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialState);
  const [funnel, setFunnel] = useState(initialFunnel);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [availableSalesConnections, setAvailableSalesConnections] = useState(
    demoMode ? demoSalesConnections : salesConnections,
  );
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [salesCredential, setSalesCredential] = useState(emptySalesCredentialDraft);
  const [hublaEndpoint, setHublaEndpoint] = useState<HublaEndpointDraft | null>(null);
  const [hublaStatus, setHublaStatus] = useState("");
  const availableConnections = demoMode
    ? [
        {
          id: "meta-bm-1",
          name: "Genesis BM Principal",
          accounts: [
            { id: "demo-account", externalId: "act_000000000", name: "Conta demo" },
          ],
        },
      ]
    : metaConnections;
  const selectedMetaConnection = availableConnections.find(
    (connection) => connection.id === form.metaConnection,
  );
  const providerConnections = availableSalesConnections.filter(
    (connection) => connection.provider === form.salesProvider,
  );
  const selectedSalesConnection = availableSalesConnections.find(
    (connection) => connection.id === form.salesConnectionId,
  );
  const canContinue =
    step === 0
      ? Boolean(form.projectName.trim() && form.expertName.trim())
      : step === 1
        ? Boolean(
            form.salesConnectionId &&
              (!form.metaConnection || form.adAccountId),
          )
        : step === 2
          ? funnel.every((stage) => stage.name.trim().length >= 2)
          : true;

  const update = <Key extends keyof FormState>(field: Key, value: FormState[Key]) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "projectName" &&
      (!current.slug || current.slug === projectSlug(current.projectName))
        ? { slug: projectSlug(value) }
        : {}),
    }));
  };

  function updateStage(clientId: string, patch: Partial<FunnelDraft>) {
    setFunnel((current) =>
      current.map((stage) => (stage.clientId === clientId ? { ...stage, ...patch } : stage)),
    );
  }

  function addStage() {
    setFunnel((current) => [
      ...current,
      {
        clientId: crypto.randomUUID(),
        name: `Etapa ${current.length + 1}`,
        type: "order_bump",
        productId: "",
      },
    ]);
  }

  function moveStage(index: number, direction: -1 | 1) {
    setFunnel((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function salesCredentials() {
    if (form.salesProvider === "payt") return {};
    if (form.salesProvider === "hotmart") {
      return {
        clientId: salesCredential.clientId,
        clientSecret: salesCredential.clientSecret,
        basicToken: salesCredential.basicToken,
        hottok: salesCredential.hottok,
      };
    }
    if (form.salesProvider === "kiwify") {
      return {
        clientId: salesCredential.clientId,
        clientSecret: salesCredential.clientSecret,
        accountId: salesCredential.accountId,
        ...(salesCredential.webhookToken
          ? { webhookToken: salesCredential.webhookToken }
          : {}),
      };
    }
    if (form.salesProvider === "eduzz") {
      return { accessToken: salesCredential.accessToken };
    }
    return { webhookToken: salesCredential.webhookToken };
  }

  const connectionFormComplete =
    Boolean(salesCredential.name.trim()) &&
    (form.salesProvider === "payt" ? true : form.salesProvider === "hotmart"
      ? Boolean(
          salesCredential.clientId &&
            salesCredential.clientSecret &&
            salesCredential.basicToken &&
            salesCredential.hottok,
        )
      : form.salesProvider === "kiwify"
        ? Boolean(
            salesCredential.clientId &&
              salesCredential.clientSecret &&
              salesCredential.accountId,
          )
        : form.salesProvider === "eduzz"
          ? Boolean(salesCredential.accessToken)
          : Boolean(salesCredential.webhookToken));

  async function createSalesConnection() {
    setConnecting(true);
    setError("");
    if (demoMode) {
      const connection: SalesConnectionOption = {
        id: crypto.randomUUID(),
        name: salesCredential.name,
        provider: form.salesProvider,
        products: [],
      };
      setAvailableSalesConnections((current) => [...current, connection]);
      setForm((current) => ({ ...current, salesConnectionId: connection.id }));
      setShowConnectionForm(false);
      setSalesCredential(emptySalesCredentialDraft);
      setConnecting(false);
      return;
    }

    if (form.salesProvider === "hubla" && hublaEndpoint) {
      try {
        const response = await fetch(`/api/connections/${hublaEndpoint.connectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: salesCredential.name,
            businessId: null,
            appId: null,
            systemUserId: null,
            credentials: { webhookToken: salesCredential.webhookToken },
          }),
        });
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          setError(body?.error ?? "Nao foi possivel armazenar o token Hubla.");
        } else {
          setHublaEndpoint((current) => current ? { ...current, tokenStored: true } : null);
          setHublaStatus(
            "Token salvo. Configure a URL na Hubla, envie um webhook de teste e confirme abaixo.",
          );
        }
      } catch {
        setError("Falha de rede ao armazenar o token Hubla.");
      }
      setConnecting(false);
      return;
    }

    try {
      const createResponse = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: salesCredential.name,
          provider: form.salesProvider,
          businessId: null,
          appId: null,
          systemUserId: null,
          credentials: salesCredentials(),
        }),
      });
      const created = (await createResponse.json().catch(() => null)) as
        | { data?: { id: string; name: string; provider: SalesProvider }; error?: string }
        | null;
      if (!createResponse.ok || !created?.data) {
        setError(created?.error ?? "Nao foi possivel armazenar a conexao.");
        setConnecting(false);
        return;
      }

      const verifyResponse = await fetch(`/api/connections/${created.data.id}/verify`, {
        method: "POST",
      });
      const verified = (await verifyResponse.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!verifyResponse.ok) {
        setError(
          verified?.error ??
            "Credenciais armazenadas, mas a plataforma recusou a conexao.",
        );
        setConnecting(false);
        return;
      }

      let products: SalesConnectionOption["products"] = [];
      if (form.salesProvider !== "hubla" && form.salesProvider !== "payt") {
        const syncResponse = await fetch(`/api/connections/${created.data.id}/products`, {
          method: "POST",
        });
        const synced = (await syncResponse.json().catch(() => null)) as
          | { items?: SalesConnectionOption["products"]; error?: string }
          | null;
        if (!syncResponse.ok) {
          setError(
            synced?.error ?? "Conexao validada, mas os produtos nao foram sincronizados.",
          );
          setConnecting(false);
          return;
        }
        products = synced?.items ?? [];
      }

      const connection: SalesConnectionOption = { ...created.data, products };
      setAvailableSalesConnections((current) => [...current, connection]);
      setForm((current) => ({ ...current, salesConnectionId: connection.id }));
      setShowConnectionForm(false);
      setSalesCredential(emptySalesCredentialDraft);
    } catch {
      setError("Falha de rede ao validar a integracao.");
    }
    setConnecting(false);
  }

  async function generateHublaEndpoint() {
    setConnecting(true);
    setError("");
    setHublaStatus("");
    if (demoMode) {
      setHublaEndpoint({
        connectionId: crypto.randomUUID(),
        endpointUrl: "https://example.supabase.co/functions/v1/hubla-webhook",
        tokenStored: false,
      });
      setConnecting(false);
      return;
    }
    try {
      const response = await fetch("/api/connections/hubla-endpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: salesCredential.name }),
      });
      const body = (await response.json().catch(() => null)) as
        | { data?: { id: string; endpointUrl: string }; error?: string }
        | null;
      if (!response.ok || !body?.data) {
        setError(body?.error ?? "Nao foi possivel gerar o endpoint Hubla.");
      } else {
        setHublaEndpoint({
          connectionId: body.data.id,
          endpointUrl: body.data.endpointUrl,
          tokenStored: false,
        });
        setHublaStatus("Endpoint gerado. Copie a URL para a configuracao de webhook da Hubla.");
      }
    } catch {
      setError("Falha de rede ao gerar o endpoint Hubla.");
    }
    setConnecting(false);
  }

  async function confirmHublaWebhook() {
    if (!hublaEndpoint) return;
    setConnecting(true);
    setError("");
    try {
      const response = await fetch(
        `/api/connections/${hublaEndpoint.connectionId}/verify`,
        { method: "POST" },
      );
      const body = (await response.json().catch(() => null)) as
        | { confirmed?: boolean; products?: SalesConnectionOption["products"]; error?: string }
        | null;
      if (!response.ok) {
        setError(body?.error ?? "Nao foi possivel verificar o webhook Hubla.");
      } else if (!body?.confirmed) {
        setHublaStatus("Nenhum webhook valido foi recebido ainda. Envie o teste pela Hubla e tente novamente.");
      } else {
        const connection: SalesConnectionOption = {
          id: hublaEndpoint.connectionId,
          name: salesCredential.name,
          provider: "hubla",
          products: body.products ?? [],
        };
        setAvailableSalesConnections((current) => [
          ...current.filter((item) => item.id !== connection.id),
          connection,
        ]);
        setForm((current) => ({ ...current, salesConnectionId: connection.id }));
        setShowConnectionForm(false);
        setSalesCredential(emptySalesCredentialDraft);
        setHublaEndpoint(null);
        setHublaStatus("");
      }
    } catch {
      setError("Falha de rede ao confirmar o webhook Hubla.");
    }
    setConnecting(false);
  }

  async function createProject() {
    setSaving(true);
    setError("");
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 550));
      setCreated(true);
      setSaving(false);
      return;
    }

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.projectName,
          slug: form.slug,
          expertName: form.expertName,
          expertEmail: form.expertEmail || null,
          salesProvider: form.salesProvider,
          salesConnectionId: form.salesConnectionId,
          metaConnectionId: form.metaConnection || null,
          metaAdAccountExternalId: form.adAccountId || null,
          monthlyTarget: Number(form.monthlyTarget),
          marginTarget: Number(form.marginTarget),
          funnel: funnel.map((stage) => ({
            name: stage.name,
            type: stage.type,
            color: null,
            productId: stage.productId || null,
          })),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            data?: { id?: string };
            error?: string;
            issues?: { field: string; message: string }[];
          }
        | null;

      if (!response.ok) {
        const issue = body?.issues?.[0];
        setError(
          issue
            ? `${issue.field || "Campo"}: ${issue.message}`
            : body?.error ?? "Nao foi possivel criar o projeto.",
        );
        setSaving(false);
        return;
      }

      setCreatedProjectId(body?.data?.id ?? null);
      setCreated(true);
      setSaving(false);
      router.refresh();
    } catch {
      setError("Falha de rede ao criar o projeto.");
      setSaving(false);
    }
  }

  if (created) {
    return (
      <div className="panel mx-auto max-w-2xl rounded-[28px] p-8 text-center sm:p-12">
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-full bg-[var(--signal)]">
          <Check size={27} strokeWidth={3} />
        </div>
        <p className="eyebrow mb-3">
          {demoMode ? "Simulacao concluida" : "Onboarding iniciado"}
        </p>
        <h1 className="text-3xl font-black tracking-[-0.045em]">
          {demoMode
            ? `${form.projectName || "Novo projeto"} foi apenas simulado.`
            : `${form.projectName || "Novo projeto"} foi criado.`}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">
          {demoMode
            ? "Nenhum dado foi persistido. Configure o Supabase para criar projetos reais."
            : "Conexao, produtos e estrutura inicial foram salvos. Revise o projeto antes de ativar a operacao."}
        </p>
        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          {createdProjectId && (
            <Link
              href={`/projects/${createdProjectId}`}
              prefetch={false}
              className="rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-bold text-white"
            >
              Abrir projeto e abastecer dados
            </Link>
          )}
          <Link
            href="/integrations"
            className="rounded-xl border border-[var(--line)] px-5 py-3 text-sm font-bold"
          >
            Gerenciar integracoes
          </Link>
          <Link
            href="/projects"
            prefetch={false}
            className="rounded-xl border border-[var(--line)] px-5 py-3 text-sm font-bold"
          >
            Voltar aos projetos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <header>
        <p className="eyebrow mb-3">Novo contrato</p>
        <h1 className="text-4xl font-black tracking-[-0.055em] sm:text-5xl">
          Criar projeto
        </h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Escolha conexoes ja validadas e monte um funil que podera ser alterado a
          qualquer momento.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="panel h-fit rounded-[22px] p-3">
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => index <= step && setStep(index)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-bold text-[var(--muted)]",
                index === step && "bg-[var(--ink)] text-white",
                index < step && "text-[var(--ink)]",
              )}
            >
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border border-current text-[10px]",
                  index < step && "border-transparent bg-[var(--signal)] text-[var(--ink)]",
                )}
              >
                {index < step ? <Check size={12} /> : index + 1}
              </span>
              {label}
            </button>
          ))}
        </aside>

        <section className="panel min-h-[520px] rounded-[24px] p-6 sm:p-8">
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <p className="eyebrow">Etapa 1</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Quem e o expert?
                </h2>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="space-y-2 text-xs font-bold">
                  Nome do expert
                  <input
                    className="field"
                    value={form.expertName}
                    onChange={(event) => update("expertName", event.target.value)}
                    placeholder="Ex.: Gi Quintino"
                  />
                </label>
                <label className="space-y-2 text-xs font-bold">
                  E-mail de referencia
                  <input
                    className="field"
                    type="email"
                    value={form.expertEmail}
                    onChange={(event) => update("expertEmail", event.target.value)}
                    placeholder="contato@expert.com"
                  />
                </label>
                <label className="space-y-2 text-xs font-bold">
                  Nome do projeto
                  <input
                    className="field"
                    value={form.projectName}
                    onChange={(event) => update("projectName", event.target.value)}
                    placeholder="Ex.: Colorista Pro"
                  />
                </label>
                <label className="space-y-2 text-xs font-bold">
                  Identificador
                  <input
                    className="field"
                    value={form.slug}
                    onChange={(event) => update("slug", event.target.value)}
                    placeholder="colorista-pro"
                  />
                </label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <p className="eyebrow">Etapa 2</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Como os dados chegarao?
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-950">
                  <Plug size={18} />
                  <p className="mt-3 text-xs font-black">Integracoes</p>
                  <p className="mt-1 text-[10px] leading-4">
                    Definem contas, catalogo e recebimento continuo quando o provedor
                    oferece webhook ou sincronizacao.
                  </p>
                </div>
                <div className="rounded-2xl bg-violet-50 p-4 text-violet-950">
                  <FileSpreadsheet size={18} />
                  <p className="mt-3 text-xs font-black">Importacao manual por CSV</p>
                  <p className="mt-1 text-[10px] leading-4">
                    Trafego e vendas realizados podem ser importados depois da criacao,
                    em Metricas &gt; Abastecimento.
                  </p>
                </div>
              </div>
              <p className="rounded-xl bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-950">
                A conexao de vendas e obrigatoria para identificar a operacao e seus
                produtos. Ela nao significa que os CSVs ja foram importados.
              </p>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="space-y-2 text-xs font-bold">
                  Conexao Meta
                  <select
                    className="field"
                    value={form.metaConnection}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        metaConnection: event.target.value,
                        adAccountId: "",
                      }))
                    }
                  >
                    <option value="">Selecionar depois</option>
                    {availableConnections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name}
                      </option>
                    ))}
                  </select>
                  <span className="block text-[10px] font-normal leading-4 text-[var(--muted)]">
                    Opcional. Use para sincronizar investimento, impressoes e cliques.
                  </span>
                </label>
                <label className="space-y-2 text-xs font-bold">
                  Conta de anuncios
                  <select
                    className="field"
                    value={form.adAccountId}
                    onChange={(event) => update("adAccountId", event.target.value)}
                    disabled={!form.metaConnection}
                  >
                    <option value="">Selecionar depois</option>
                    {(selectedMetaConnection?.accounts ?? []).map((account) => (
                      <option key={account.id} value={account.externalId}>
                        {account.name} ({account.externalId})
                      </option>
                    ))}
                  </select>
                  {form.metaConnection && !form.adAccountId && (
                    <span className="block text-[10px] font-normal leading-4 text-amber-800">
                      Se escolher uma conexao Meta, selecione tambem a conta de anuncios.
                    </span>
                  )}
                </label>
                <label className="space-y-2 text-xs font-bold">
                  Plataforma de vendas
                  <select
                    className="field"
                    value={form.salesProvider}
                    onChange={(event) => {
                      const salesProvider = event.target.value as SalesProvider;
                      setForm((current) => ({
                        ...current,
                        salesProvider,
                        salesConnectionId: "",
                      }));
                      setFunnel((current) =>
                        current.map((stage) => ({ ...stage, productId: "" })),
                      );
                      setSalesCredential(emptySalesCredentialDraft);
                      setHublaEndpoint(null);
                      setHublaStatus("");
                      setShowConnectionForm(true);
                    }}
                  >
                    {salesProviders.map((provider) => (
                      <option key={provider} value={provider}>
                        {providerLabels[provider]}
                      </option>
                    ))}
                  </select>
                  <span className="block text-[10px] font-normal leading-4 text-[var(--muted)]">
                    Define o catalogo e a origem operacional das vendas.
                  </span>
                </label>
                <label className="space-y-2 text-xs font-bold">
                  Conexao de vendas
                  <select
                    className="field"
                    value={form.salesConnectionId}
                    onChange={(event) => {
                      update("salesConnectionId", event.target.value);
                      setShowConnectionForm(false);
                      setFunnel((current) =>
                        current.map((stage) => ({ ...stage, productId: "" })),
                      );
                    }}
                  >
                    <option value="">Selecione uma conexão de vendas</option>
                    {providerConnections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name} ({connection.products.length} produtos)
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {providerConnections.length > 0 && !showConnectionForm && (
                <div className="flex flex-col gap-3 rounded-xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-950 sm:flex-row sm:items-center sm:justify-between">
                  <span>A conexao selecionada fornece os produtos disponiveis no funil.</span>
                  <button type="button" onClick={() => setShowConnectionForm(true)} className="shrink-0 rounded-lg border border-blue-300 px-3 py-2 font-black">
                    Adicionar outra conexao
                  </button>
                </div>
              )}
              {(showConnectionForm || providerConnections.length === 0) && (
                <div className="rounded-2xl border border-[var(--line)] bg-white/55 p-5">
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div>
                      <p className="eyebrow">Credencial protegida</p>
                      <h3 className="mt-1 text-base font-black">
                        Conectar {providerLabels[form.salesProvider]}
                      </h3>
                    </div>
                    {providerConnections.length > 0 && !hublaEndpoint && (
                      <button type="button" onClick={() => setShowConnectionForm(false)} className="text-xs font-bold text-[var(--muted)]">
                        Cancelar
                      </button>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-xs font-bold sm:col-span-2">
                      Nome interno da conexao
                      <input className="field" value={salesCredential.name} onChange={(event) => setSalesCredential((current) => ({ ...current, name: event.target.value }))} placeholder={`${providerLabels[form.salesProvider]} - ${form.projectName || "Projeto"}`} />
                    </label>
                    {form.salesProvider === "hotmart" && (
                      <>
                        <label className="space-y-2 text-xs font-bold">Client ID<input className="field" value={salesCredential.clientId} onChange={(event) => setSalesCredential((current) => ({ ...current, clientId: event.target.value }))} /></label>
                        <label className="space-y-2 text-xs font-bold">Client Secret<input className="field" type="password" autoComplete="new-password" value={salesCredential.clientSecret} onChange={(event) => setSalesCredential((current) => ({ ...current, clientSecret: event.target.value }))} /></label>
                        <label className="space-y-2 text-xs font-bold">Token Basic<input className="field" type="password" autoComplete="new-password" value={salesCredential.basicToken} onChange={(event) => setSalesCredential((current) => ({ ...current, basicToken: event.target.value }))} /></label>
                        <label className="space-y-2 text-xs font-bold">HOTTOK do webhook<input className="field" type="password" autoComplete="new-password" value={salesCredential.hottok} onChange={(event) => setSalesCredential((current) => ({ ...current, hottok: event.target.value }))} /></label>
                      </>
                    )}
                    {form.salesProvider === "eduzz" && (
                      <label className="space-y-2 text-xs font-bold sm:col-span-2">
                        Access Token OAuth
                        <input className="field" type="password" autoComplete="new-password" value={salesCredential.accessToken} onChange={(event) => setSalesCredential((current) => ({ ...current, accessToken: event.target.value }))} />
                      </label>
                    )}
                    {form.salesProvider === "kiwify" && (
                      <>
                        <label className="space-y-2 text-xs font-bold">Client ID / API Key<input className="field" value={salesCredential.clientId} onChange={(event) => setSalesCredential((current) => ({ ...current, clientId: event.target.value }))} /></label>
                        <label className="space-y-2 text-xs font-bold">Client Secret<input className="field" type="password" autoComplete="new-password" value={salesCredential.clientSecret} onChange={(event) => setSalesCredential((current) => ({ ...current, clientSecret: event.target.value }))} /></label>
                        <label className="space-y-2 text-xs font-bold sm:col-span-2">ID da conta Kiwify<input className="field" value={salesCredential.accountId} onChange={(event) => setSalesCredential((current) => ({ ...current, accountId: event.target.value }))} placeholder="x-kiwify-account-id" /></label>
                        <label className="space-y-2 text-xs font-bold sm:col-span-2">Token do webhook (opcional)<input className="field" type="password" autoComplete="new-password" value={salesCredential.webhookToken} onChange={(event) => setSalesCredential((current) => ({ ...current, webhookToken: event.target.value }))} /></label>
                      </>
                    )}
                    {form.salesProvider === "hubla" && (
                      <>
                        {hublaEndpoint && (
                          <label className="space-y-2 text-xs font-bold sm:col-span-2">
                            Endpoint para cadastrar na Hubla
                            <span className="flex gap-2">
                              <input className="field min-w-0 flex-1" readOnly value={hublaEndpoint.endpointUrl} />
                              <button type="button" aria-label="Copiar endpoint" onClick={() => navigator.clipboard.writeText(hublaEndpoint.endpointUrl)} className="grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-white">
                                <Copy size={15} />
                              </button>
                            </span>
                          </label>
                        )}
                        {hublaEndpoint && !hublaEndpoint.tokenStored && (
                          <label className="space-y-2 text-xs font-bold sm:col-span-2">
                            Hubla Webhook Token
                            <input className="field" type="password" autoComplete="new-password" value={salesCredential.webhookToken} onChange={(event) => setSalesCredential((current) => ({ ...current, webhookToken: event.target.value }))} placeholder="Valor de x-hubla-token" />
                          </label>
                        )}
                      </>
                    )}
                  </div>
                  <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-950">
                    {form.salesProvider === "hubla"
                      ? "A mesma Edge Function atende todas as conexoes. Esta URL identifica a conexao e o token autentica cada evento recebido."
                      : form.salesProvider === "payt" ? "O sistema cria o endereço protegido para o postback. Depois de criar a conexão, copie o endereço em Integrações e envie o teste PayT V1."
                      : "As credenciais serao gravadas no cofre, validadas na plataforma e usadas para sincronizar o catalogo agora."}
                  </p>
                  {hublaStatus && (
                    <p className="mt-3 rounded-xl bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-950">
                      {hublaStatus}
                    </p>
                  )}
                  {form.salesProvider === "hubla" ? (
                    !hublaEndpoint ? (
                      <button type="button" disabled={connecting || salesCredential.name.trim().length < 2} onClick={generateHublaEndpoint} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink)] py-3 text-xs font-black text-white disabled:opacity-40">
                        {connecting ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}
                        {connecting ? "Gerando..." : "Gerar endpoint"}
                      </button>
                    ) : !hublaEndpoint.tokenStored ? (
                      <button type="button" disabled={connecting || !connectionFormComplete} onClick={createSalesConnection} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink)] py-3 text-xs font-black text-white disabled:opacity-40">
                        {connecting ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
                        {connecting ? "Salvando..." : "Salvar token do webhook"}
                      </button>
                    ) : (
                      <button type="button" disabled={connecting} onClick={confirmHublaWebhook} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--signal)] py-3 text-xs font-black text-[var(--ink)] disabled:opacity-40">
                        {connecting ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
                        {connecting ? "Verificando..." : "Confirmar webhook recebido"}
                      </button>
                    )
                  ) : (
                    <button type="button" disabled={connecting || !connectionFormComplete} onClick={createSalesConnection} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink)] py-3 text-xs font-black text-white disabled:opacity-40">
                      {connecting ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
                      {connecting ? (form.salesProvider === "payt" ? "Criando recebimento..." : "Validando e sincronizando...") : (form.salesProvider === "payt" ? "Criar recebimento Payt" : "Confirmar conexao")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <p className="eyebrow">Etapa 3</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Estrutura do funil
                </h2>
                <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">
                  A ordem tambem interpreta as colunas do CSV: ob1 e o primeiro Order
                  bump, ob2 o segundo; a mesma regra vale para up1 e ds1.
                </p>
              </div>
              <div className="space-y-3">
                {funnel.map((stage, index) => {
                  const selectedElsewhere = new Set(
                    funnel
                      .filter((item) => item.clientId !== stage.clientId)
                      .map((item) => item.productId)
                      .filter(Boolean),
                  );
                  return (
                    <div
                      key={stage.clientId}
                      className="rounded-2xl border border-[var(--line)] bg-white/50 p-4"
                    >
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                          Etapa {index + 1}
                        </p>
                        <div className="flex gap-1">
                          <button type="button" aria-label="Mover etapa para cima" disabled={index === 0} onClick={() => moveStage(index, -1)} className="grid size-8 place-items-center rounded-lg border border-[var(--line)] disabled:opacity-30">
                            <ArrowUp size={14} />
                          </button>
                          <button type="button" aria-label="Mover etapa para baixo" disabled={index === funnel.length - 1} onClick={() => moveStage(index, 1)} className="grid size-8 place-items-center rounded-lg border border-[var(--line)] disabled:opacity-30">
                            <ArrowDown size={14} />
                          </button>
                          <button type="button" aria-label="Remover etapa" disabled={funnel.length === 1} onClick={() => setFunnel((current) => current.filter((item) => item.clientId !== stage.clientId))} className="grid size-8 place-items-center rounded-lg border border-red-200 text-red-700 disabled:opacity-30">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-2 text-xs font-bold">
                          Nome da etapa
                          <input className="field" value={stage.name} onChange={(event) => updateStage(stage.clientId, { name: event.target.value })} />
                        </label>
                        <label className="space-y-2 text-xs font-bold">
                          Papel no funil
                          <select className="field" value={stage.type} onChange={(event) => updateStage(stage.clientId, { type: event.target.value as FunnelStageType })}>
                            {funnelStageTypes.map((type) => (
                              <option key={type} value={type}>{stageTypeLabels[type]}</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-2 text-xs font-bold sm:col-span-2">
                          Produto associado
                          <select className="field" value={stage.productId} onChange={(event) => updateStage(stage.clientId, { productId: event.target.value })}>
                            <option value="">Associar depois</option>
                            {(selectedSalesConnection?.products ?? []).map((product) => (
                              <option key={product.id} value={product.id} disabled={selectedElsewhere.has(product.id)}>
                                {product.name} - {product.currency} {product.price.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button type="button" onClick={addStage} className="inline-flex items-center gap-2 rounded-xl border border-dashed border-[var(--ink)] px-4 py-3 text-xs font-black">
                <Plus size={15} /> Adicionar produto / etapa
              </button>
              {(selectedSalesConnection?.products.length ?? 0) === 0 && (
                <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
                  Esta conexao ainda nao tem produtos sincronizados. O funil pode ser criado e
                  os produtos associados depois na tela do projeto.
                </p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <p className="eyebrow">Etapa 4</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Metas operacionais
                </h2>
                <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">
                  Estas metas sao objetivos manuais do contrato. Elas nao vem dos CSVs e
                  podem ser deixadas vazias para configurar depois.
                </p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="space-y-2 text-xs font-bold">
                  Meta mensal de faturamento
                  <input
                    className="field"
                    inputMode="decimal"
                    value={form.monthlyTarget}
                    onChange={(event) => update("monthlyTarget", event.target.value)}
                    placeholder="Ex.: 100000"
                  />
                  <span className="block text-[10px] font-normal leading-4 text-[var(--muted)]">
                    Objetivo de faturamento para acompanhar progresso no mes.
                  </span>
                </label>
                <label className="space-y-2 text-xs font-bold">
                  Margem alvo (%)
                  <input
                    className="field"
                    inputMode="decimal"
                    value={form.marginTarget}
                    onChange={(event) => update("marginTarget", event.target.value)}
                    placeholder="Ex.: 30"
                  />
                  <span className="block text-[10px] font-normal leading-4 text-[var(--muted)]">
                    Percentual de margem desejado depois de todos os custos.
                  </span>
                </label>
              </div>
              <div className="rounded-2xl bg-[var(--sidebar)] p-5 text-white">
                <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-white/40">
                  Resumo
                </p>
                <p className="mt-3 text-lg font-black">
                  {form.projectName || "Projeto sem nome"}
                </p>
                <p className="mt-1 text-xs text-white/50">
                  {form.expertName || "Expert pendente"} · {form.salesProvider}
                </p>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-xs font-medium text-red-900">
              {error}
            </p>
          )}

          <div className="mt-10 flex items-center justify-between border-t border-[var(--line)] pt-5">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((current) => current - 1)}
              className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-30"
            >
              <ChevronLeft size={15} /> Voltar
            </button>
            {step < steps.length - 1 ? (
              <button
                type="button"
                disabled={!canContinue}
                onClick={() => setStep((current) => current + 1)}
                className="inline-flex items-center gap-1 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40"
              >
                Continuar <ChevronRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  saving ||
                  !form.projectName ||
                  !form.expertName ||
                  !form.salesConnectionId ||
                  !funnel.every((stage) => stage.name.trim().length >= 2)
                }
                onClick={createProject}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--signal)] px-5 py-2.5 text-xs font-black text-[var(--ink)] disabled:opacity-40"
              >
                {saving && <LoaderCircle size={15} className="animate-spin" />}
                Criar projeto
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
