"use client";

import {
  Check,
  Copy,
  KeyRound,
  LoaderCircle,
  PackageSearch,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import type {
  IntegrationConnection,
  Provider,
} from "@/lib/domain";
import { operationalProviders, providerLabels } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { PaytConnectionPanel } from "@/components/payt-connection-panel";

const providerOptions: Provider[] = [...operationalProviders];

interface ConnectionForm {
  name: string;
  provider: Provider;
  businessId: string;
  appId: string;
  systemUserId: string;
  accessToken: string;
  clientId: string;
  clientSecret: string;
  basicToken: string;
  hottok: string;
  accountId: string;
  webhookToken: string;
}

const emptyForm: ConnectionForm = {
  name: "",
  provider: "meta",
  businessId: "",
  appId: "",
  systemUserId: "",
  accessToken: "",
  clientId: "",
  clientSecret: "",
  basicToken: "",
  hottok: "",
  accountId: "",
  webhookToken: "",
};

const catalogProviders: Provider[] = ["hotmart", "eduzz", "kiwify"];

const providerHelp: Record<Provider, string> = {
  meta: "Token de System User para validar e descobrir contas de anuncios.",
  hotmart: "OAuth para catalogo e HOTTOK separado para autenticar vendas por webhook.",
  eduzz: "Token OAuth autorizado com o escopo myeduzz_products_read.",
  kiwify: "API Key, Client Secret e ID da conta para validar e listar produtos.",
  hubla: "A Hubla publica apenas token de webhook; produtos sao cadastrados manualmente.",
  payt: "Criamos um endereço protegido para o postback PayT V1. Os produtos serão identificados nos eventos e vinculados ao projeto.",
  google_forms: "OAuth organizacional para ler formularios e respostas do Google Forms.",
};

function credentialsFromForm(form: ConnectionForm) {
  return Object.fromEntries(
    [
      "accessToken",
      "clientId",
      "clientSecret",
      "basicToken",
      "hottok",
      "accountId",
      "webhookToken",
    ]
      .map((field) => [field, form[field as keyof ConnectionForm]])
      .filter(([, value]) => value),
  );
}

function hasRequiredCredentials(form: ConnectionForm) {
  if (form.provider === "payt") return true;
  if (form.provider === "meta" || form.provider === "eduzz") return Boolean(form.accessToken);
  if (form.provider === "hotmart") {
    return Boolean(form.clientId && form.clientSecret && form.basicToken && form.hottok);
  }
  if (form.provider === "kiwify") {
    return Boolean(form.clientId && form.clientSecret && form.accountId);
  }
  return Boolean(form.webhookToken);
}

export function IntegrationsManager({
  initialConnections,
  demoMode,
  googleOAuthConfigured,
  warning,
}: {
  initialConnections: IntegrationConnection[];
  demoMode: boolean;
  googleOAuthConfigured: boolean;
  warning?: string;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [showForm, setShowForm] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState(warning ?? "");

  const update = (field: keyof ConnectionForm, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  function openNewForm() {
    setEditingConnectionId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEditForm(connection: IntegrationConnection) {
    setEditingConnectionId(connection.id);
    setForm({
      name: connection.name,
      provider: connection.provider,
      businessId: connection.businessId ?? "",
      appId: connection.appId ?? "",
      systemUserId: connection.systemUserId ?? "",
      accessToken: "",
      clientId: "",
      clientSecret: "",
      basicToken: "",
      hottok: "",
      accountId: "",
      webhookToken: "",
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingConnectionId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  async function saveConnection() {
    setMessage("");
    setBusyId(editingConnectionId ?? "new");

    if (demoMode) {
      if (editingConnectionId) {
        setConnections((current) =>
          current.map((connection) =>
            connection.id === editingConnectionId
              ? {
                  ...connection,
                  name: form.name,
                  businessId: form.businessId || undefined,
                  appId: form.appId || undefined,
                  systemUserId: form.systemUserId || undefined,
                  status: Object.keys(credentialsFromForm(form)).length
                    ? "attention"
                    : connection.status,
                  lastVerifiedAt: Object.keys(credentialsFromForm(form)).length
                    ? null
                    : connection.lastVerifiedAt,
                }
              : connection,
          ),
        );
        closeForm();
        setBusyId(null);
        setMessage("Conexao demonstrativa atualizada.");
        return;
      }

      const connection: IntegrationConnection = {
        id: crypto.randomUUID(),
        name: form.name || `${providerLabels[form.provider]} sem nome`,
        provider: form.provider,
        status: form.provider === "payt" ? "attention" : "connected",
        businessId: form.businessId || undefined,
        accountCount: 0,
        productCount: 0,
        lastVerifiedAt: form.provider === "payt" ? null : new Date().toISOString(),
      };
      await new Promise((resolve) => setTimeout(resolve, 450));
      setConnections((current) => [...current, connection]);
      closeForm();
      setBusyId(null);
      setMessage("Conexao demonstrativa adicionada. Nenhuma credencial foi armazenada.");
      return;
    }

    try {
      const response = await fetch(
        editingConnectionId
          ? `/api/connections/${editingConnectionId}`
          : "/api/connections",
        {
          method: editingConnectionId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            ...(editingConnectionId ? {} : { provider: form.provider }),
            businessId: form.businessId || null,
            appId: form.appId || null,
            systemUserId: form.systemUserId || null,
            ...(Object.keys(credentialsFromForm(form)).length
              ? { credentials: credentialsFromForm(form) }
              : {}),
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as
        | { data?: IntegrationConnection; error?: string }
        | null;

      if (!response.ok || !body?.data) {
        setMessage(body?.error ?? "Nao foi possivel salvar a conexao.");
        return;
      }

      const verification = await fetch(`/api/connections/${body.data.id}/verify`, {
        method: "POST",
      });
      const verificationBody = (await verification.json().catch(() => null)) as
        | { error?: string; mode?: "remote" | "webhook"; confirmed?: boolean }
        | null;
      const confirmed = verification.ok && verificationBody?.confirmed !== false;
      let productCount = editingConnectionId
        ? connections.find((connection) => connection.id === editingConnectionId)?.productCount ?? 0
        : 0;
      let syncError = "";
      if (verification.ok && catalogProviders.includes(body.data.provider)) {
        const sync = await fetch(`/api/connections/${body.data.id}/products`, { method: "POST" });
        const syncBody = (await sync.json().catch(() => null)) as
          | { products?: number; error?: string }
          | null;
        if (sync.ok) productCount = syncBody?.products ?? productCount;
        else syncError = syncBody?.error ?? "Conexao validada, mas o catalogo nao foi sincronizado.";
      }
      const savedConnection = {
        ...body.data,
        status: confirmed ? ("connected" as const) : ("attention" as const),
        lastVerifiedAt: confirmed ? new Date().toISOString() : null,
        productCount,
      };
      setConnections((current) =>
        editingConnectionId
          ? current.map((connection) =>
              connection.id === editingConnectionId
                ? { ...connection, ...savedConnection, accountCount: connection.accountCount }
                : connection,
            )
          : [...current, savedConnection],
      );
      const wasEditing = Boolean(editingConnectionId);
      closeForm();
      if (!verification.ok) {
        setMessage(
          verificationBody?.error ??
            "Credenciais armazenadas, mas a plataforma recusou a verificacao.",
        );
      } else if (syncError) {
        setMessage(syncError);
      } else if (body.data.provider === "payt") {
        setMessage("Conexão Payt criada. Copie o endereço protegido e envie um teste PayT V1.");
      } else if (body.data.provider === "hubla") {
        setMessage("Webhook Hubla configurado. A confirmacao remota ocorrera no primeiro evento.");
      } else {
        setMessage(
          wasEditing
            ? "Conexao atualizada, verificada e catalogo sincronizado."
            : "Conexao verificada e credenciais armazenadas no cofre.",
        );
      }
    } catch {
      setMessage("Falha de rede ao salvar ou verificar a conexao.");
    } finally {
      setBusyId(null);
    }
  }

  async function verifyConnection(connectionId: string) {
    setBusyId(connectionId);
    setMessage("");
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      setConnections((current) =>
        current.map((connection) =>
          connection.id === connectionId
            ? {
                ...connection,
                status: "connected",
                lastVerifiedAt: new Date().toISOString(),
              }
            : connection,
        ),
      );
      setBusyId(null);
      return;
    }

    try {
      const response = await fetch(`/api/connections/${connectionId}/verify`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as
        | { confirmed?: boolean; error?: string }
        | null;
      const confirmed = response.ok && body?.confirmed !== false;
      setConnections((current) =>
        current.map((connection) =>
          connection.id === connectionId
            ? {
                ...connection,
                status: confirmed ? "connected" : "attention",
                lastVerifiedAt: confirmed ? new Date().toISOString() : null,
              }
            : connection,
        ),
      );
      setMessage(
        confirmed
          ? "Conexao verificada com sucesso."
          : response.ok
            ? "Recebimento e processamento ainda aguardam confirmação. Confira os eventos recebidos."
            : body?.error ?? "A verificacao falhou. Consulte o status da credencial.",
      );
    } catch {
      setMessage("Falha de rede ao verificar a conexao.");
    } finally {
      setBusyId(null);
    }
  }

  async function discoverAccounts(connectionId: string) {
    setBusyId(connectionId);
    setMessage("");
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      setConnections((current) =>
        current.map((connection) =>
          connection.id === connectionId
            ? { ...connection, accountCount: Math.max(connection.accountCount, 2) }
            : connection,
        ),
      );
      setMessage("Contas demonstrativas atualizadas.");
      setBusyId(null);
      return;
    }

    try {
      const response = await fetch(`/api/connections/${connectionId}/accounts`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as
        | { accounts?: number; unassignedAccounts?: number; error?: string }
        | null;
      if (response.ok) {
        const assignedAccounts = body?.accounts ?? 0;
        const unassignedAccounts = body?.unassignedAccounts ?? 0;
        setConnections((current) =>
          current.map((connection) =>
            connection.id === connectionId
              ? { ...connection, accountCount: assignedAccounts }
              : connection,
          ),
        );
        setMessage(
          unassignedAccounts > 0
            ? `${assignedAccounts} conta(s) atribuida(s) ao System User. A Meta mostrou pelo menos ${unassignedAccounts} outra(s) conta(s) no BM sem essa atribuicao.`
            : `${assignedAccounts} conta(s) Meta atribuida(s) ao System User.`,
        );
      } else {
        setMessage(body?.error ?? "Nao foi possivel descobrir as contas Meta.");
      }
    } catch {
      setMessage("Falha de rede ao descobrir as contas Meta.");
    } finally {
      setBusyId(null);
    }
  }

  async function syncProducts(connectionId: string) {
    setBusyId(connectionId);
    setMessage("");
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      setConnections((current) =>
        current.map((connection) =>
          connection.id === connectionId
            ? { ...connection, productCount: Math.max(connection.productCount, 4) }
            : connection,
        ),
      );
      setMessage("Catalogo demonstrativo atualizado.");
      setBusyId(null);
      return;
    }

    try {
      const response = await fetch(`/api/connections/${connectionId}/products`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as
        | { products?: number; error?: string }
        | null;
      if (response.ok) {
        setConnections((current) =>
          current.map((connection) =>
            connection.id === connectionId
              ? { ...connection, productCount: body?.products ?? connection.productCount }
              : connection,
          ),
        );
        setMessage(`${body?.products ?? 0} produto(s) sincronizado(s).`);
      } else {
        setMessage(body?.error ?? "Nao foi possivel sincronizar o catalogo.");
      }
    } catch {
      setMessage("Falha de rede ao sincronizar o catalogo.");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeConnection(connectionId: string) {
    if (!window.confirm("Revogar e apagar a credencial armazenada?")) return;
    setBusyId(connectionId);
    try {
      if (!demoMode) {
        const response = await fetch(`/api/connections/${connectionId}/credentials`, {
          method: "DELETE",
        });
        if (!response.ok) {
          setMessage("Nao foi possivel revogar a credencial.");
          return;
        }
      }

      setConnections((current) =>
        current.map((connection) =>
          connection.id === connectionId
            ? { ...connection, status: "revoked", lastVerifiedAt: null }
            : connection,
        ),
      );
      setMessage("Credencial revogada e removida do cofre.");
    } catch {
      setMessage("Falha de rede ao revogar a credencial.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteConnection(connectionId: string) {
    if (!window.confirm("Excluir definitivamente esta conexao revogada?")) return;
    setBusyId(connectionId);
    setMessage("");

    try {
      if (!demoMode) {
        const response = await fetch(`/api/connections/${connectionId}`, {
          method: "DELETE",
        });
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        if (!response.ok) {
          setMessage(body?.error ?? "Nao foi possivel excluir a conexao.");
          return;
        }
      }

      setConnections((current) =>
        current.filter((connection) => connection.id !== connectionId),
      );
      setMessage("Conexao excluida definitivamente.");
    } catch {
      setMessage("Falha de rede ao excluir a conexao.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-3">Cofre operacional</p>
          <h1 className="text-4xl font-black tracking-[-0.055em] sm:text-5xl">
            Integracoes
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Cadastre conexões da Meta, plataformas de vendas e formulários.
            Credenciais ficam no cofre. Administradores podem copiar o endereço protegido de recebimento da Payt.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewForm}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--ink)] px-4 text-sm font-bold text-white"
        >
          <Plus size={17} /> Nova conexao
        </button>
      </header>

      {message && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-950">
          {message}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {connections.map((connection) => {
          return (
          <article key={connection.id} className="panel rounded-[24px] p-5">
            <div className="mb-7 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "grid size-11 place-items-center rounded-[14px]",
                    connection.provider === "meta" && "bg-blue-100 text-blue-700",
                    connection.provider === "hotmart" && "bg-violet-100 text-violet-700",
                    connection.provider === "eduzz" && "bg-emerald-100 text-emerald-700",
                    connection.provider === "kiwify" && "bg-amber-100 text-amber-800",
                    connection.provider === "hubla" && "bg-rose-100 text-rose-700",
                    connection.provider === "payt" && "bg-teal-100 text-teal-800",
                    connection.provider === "google_forms" && "bg-sky-100 text-sky-700",
                  )}
                >
                  <KeyRound size={18} />
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    {providerLabels[connection.provider]}
                  </p>
                  <h2 className="mt-1 text-sm font-black">{connection.name}</h2>
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider",
                  connection.status === "connected" && "bg-emerald-100 text-emerald-800",
                  connection.status === "attention" && "bg-amber-100 text-amber-900",
                  connection.status === "revoked" && "bg-red-100 text-red-800",
                  connection.status === "disconnected" && "bg-slate-100 text-slate-700",
                )}
              >
                {connection.status}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between border-b border-[var(--line)] pb-3">
                <span className="text-[var(--muted)]">Credencial</span>
                <span className="font-black tracking-[0.18em]">••••••••••••</span>
              </div>
              <div className="flex justify-between border-b border-[var(--line)] pb-3">
                <span className="text-[var(--muted)]">
                  {connection.provider === "meta"
                    ? "Contas vinculadas"
                    : connection.provider === "google_forms"
                      ? "Formularios vinculados"
                      : "Produtos no catalogo"}
                </span>
                <span className="font-black">
                  {connection.provider === "meta"
                    ? connection.accountCount
                    : connection.provider === "google_forms"
                      ? "Projeto"
                    : connection.productCount}
                </span>
              </div>
              <div className="flex justify-between pb-2">
                <span className="text-[var(--muted)]">Ultima verificacao</span>
                <span className="font-black">
                  {connection.lastVerifiedAt ? "Verificada" : "Pendente"}
                </span>
              </div>
              {connection.provider === "hubla" && (
                <div className="border-t border-[var(--line)] pt-3">
                  <span className="mb-2 block text-[var(--muted)]">Endpoint Hubla</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/hubla-webhook`)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg bg-black/5 px-3 py-2 text-left font-bold"
                  >
                    <span className="truncate">Copiar endpoint geral Hubla</span>
                    <Copy size={13} className="shrink-0" />
                  </button>
                </div>
              )}
              {connection.provider === "hotmart" && (
                <div className="border-t border-[var(--line)] pt-3">
                  <span className="mb-2 block text-[var(--muted)]">Endpoint Hotmart</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/hotmart/${connection.id}`)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg bg-black/5 px-3 py-2 text-left font-bold"
                  >
                    <span className="truncate">Copiar URL do webhook</span>
                    <Copy size={13} className="shrink-0" />
                  </button>
                </div>
              )}
              {connection.provider === "payt" && connection.status !== "revoked" && <PaytConnectionPanel connectionId={connection.id} demoMode={demoMode} />}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busyId === connection.id}
                onClick={() => openEditForm(connection)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] py-2.5 text-[10px] font-bold disabled:opacity-40"
              >
                <Pencil size={14} /> Editar
              </button>
              {connection.provider === "google_forms" && (
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/api/connections/google/authorize";
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 py-2.5 text-[10px] font-bold text-sky-800"
                >
                  <RefreshCw size={14} /> Reconectar
                </button>
              )}
              {connection.provider !== "hubla" && connection.provider !== "payt" && connection.provider !== "google_forms" && (
                <button
                  type="button"
                  disabled={busyId === connection.id || connection.status === "revoked"}
                  onClick={() => verifyConnection(connection.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] py-2.5 text-[10px] font-bold disabled:opacity-40"
                >
                  {busyId === connection.id ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Verificar
                </button>
              )}
              {(connection.provider === "hubla" || connection.provider === "payt") && (
                <button
                  type="button"
                  disabled={busyId === connection.id || connection.status === "revoked"}
                  onClick={() => verifyConnection(connection.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 px-2 text-center text-[10px] font-bold text-violet-800 disabled:opacity-40"
                >
                  <RefreshCw size={14} /> Confirmar webhook
                </button>
              )}
              {connection.status === "revoked" ? (
                <button
                  type="button"
                  disabled={busyId === connection.id}
                  onClick={() => deleteConnection(connection.id)}
                  className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 py-2.5 text-[10px] font-bold text-red-700 disabled:opacity-40"
                >
                  <Trash2 size={14} /> Excluir definitivamente
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busyId === connection.id}
                  onClick={() => revokeConnection(connection.id)}
                  className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 py-2.5 text-[10px] font-bold text-red-700 disabled:opacity-40"
                >
                  <X size={14} /> Revogar credencial
                </button>
              )}
              {connection.provider === "meta" && connection.status !== "revoked" && (
                <button
                  type="button"
                  disabled={busyId === connection.id}
                  onClick={() => discoverAccounts(connection.id)}
                  className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 py-2.5 text-[10px] font-bold text-blue-800 disabled:opacity-40"
                >
                  <RefreshCw size={14} /> Descobrir contas Meta
                </button>
              )}
              {catalogProviders.includes(connection.provider) &&
                connection.status !== "revoked" && (
                  <button
                    type="button"
                    disabled={busyId === connection.id || connection.status !== "connected"}
                    onClick={() => syncProducts(connection.id)}
                    className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 py-2.5 text-[10px] font-bold text-violet-800 disabled:opacity-40"
                  >
                    <PackageSearch size={14} /> Sincronizar produtos
                  </button>
                )}
            </div>
          </article>
          );
        })}

        <button
          type="button"
          onClick={openNewForm}
          className="grid min-h-72 place-items-center rounded-[24px] border border-dashed border-[var(--muted)]/35 bg-white/25 p-6 text-center transition hover:bg-white/50"
        >
          <span>
            <Plus className="mx-auto mb-3 text-[var(--muted)]" />
            <strong className="block text-sm">Adicionar outra conexao</strong>
            <small className="mt-2 block max-w-48 text-[11px] leading-5 text-[var(--muted)]">
              Um token por BM quando os ativos estiverem separados.
            </small>
          </span>
        </button>

        <button
          type="button"
          disabled={!googleOAuthConfigured}
          onClick={() => {
            window.location.href = "/api/connections/google/authorize";
          }}
          className="grid min-h-72 place-items-center rounded-[24px] border border-dashed border-sky-300 bg-sky-50/70 p-6 text-center text-sky-950 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:border-amber-300 disabled:bg-amber-50 disabled:text-amber-950"
        >
          <span>
            <KeyRound className="mx-auto mb-3 text-sky-600" />
            <strong className="block text-sm">
              {googleOAuthConfigured ? "Conectar Google Forms" : "Google Forms indisponivel"}
            </strong>
            <small className="mt-2 block max-w-56 text-[11px] leading-5 text-sky-900/70">
              {googleOAuthConfigured
                ? "Autorize a leitura de formularios, respostas e planilhas vinculadas para apresenta-los nos projetos."
                : "Faltam as credenciais OAuth do Google no ambiente publicado. Revise Configuracoes."}
            </small>
          </span>
        </button>
      </section>

      <p className="text-xs leading-6 text-[var(--muted)]">
        Respostas Google sincronizadas ficam armazenadas para consulta nos projetos.
        Você pode revogar a conexão em Integrações. Veja os detalhes na{" "}
        <Link href="/privacy" className="font-bold underline">Política de Privacidade</Link>.
      </p>

      <section className="rounded-[24px] bg-[var(--sidebar)] p-6 text-white">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[var(--signal)] text-[var(--sidebar)]">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2 className="font-black">Como protegemos as credenciais</h2>
            <p className="mt-2 max-w-3xl text-xs leading-6 text-white/48">
              O navegador envia o segredo uma unica vez para uma rota autenticada. O
              backend grava no cofre e responde apenas com o status. Verificar usa o
              segredo em memória. Na Payt, um endereço protegido permite configurar o recebimento de eventos; o acesso a ele exige uma conta administradora.
            </p>
          </div>
        </div>
      </section>

      {showForm && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[26px] bg-[var(--paper)] p-6 shadow-2xl sm:p-8">
            <div className="mb-7 flex items-start justify-between">
              <div>
                <p className="eyebrow">
                  {editingConnectionId ? "Editar conexao" : "Nova conexao"}
                </p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  {editingConnectionId ? "Dados da integracao" : "Credencial protegida"}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={closeForm}
                className="grid size-9 place-items-center rounded-full bg-black/5"
              >
                <X size={17} />
              </button>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="space-y-2 text-xs font-bold">
                Provedor
                <select
                  className="field"
                  disabled={Boolean(editingConnectionId)}
                  value={form.provider}
                  onChange={(event) => update("provider", event.target.value)}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider} value={provider}>
                      {providerLabels[provider]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-xs font-bold">
                Nome interno
                <input
                  className="field"
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="Genesis BM Principal"
                />
              </label>
              {form.provider === "meta" && (
                <>
                  <label className="space-y-2 text-xs font-bold">
                    Business ID
                    <input
                      className="field"
                      value={form.businessId}
                      onChange={(event) => update("businessId", event.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-xs font-bold">
                    App ID
                    <input
                      className="field"
                      value={form.appId}
                      onChange={(event) => update("appId", event.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-xs font-bold sm:col-span-2">
                    System User ID
                    <input
                      className="field"
                      value={form.systemUserId}
                      onChange={(event) => update("systemUserId", event.target.value)}
                    />
                  </label>
                  <label className="space-y-2 text-xs font-bold sm:col-span-2">
                    Token de acesso do System User
                    <input
                      className="field"
                      type="password"
                      autoComplete="new-password"
                      value={form.accessToken}
                      onChange={(event) => update("accessToken", event.target.value)}
                      placeholder={editingConnectionId ? "Deixe vazio para manter" : "Cole o token Meta"}
                    />
                  </label>
                </>
              )}
              {form.provider === "hotmart" && (
                <>
                  <label className="space-y-2 text-xs font-bold">
                    Client ID
                    <input className="field" value={form.clientId} onChange={(event) => update("clientId", event.target.value)} placeholder={editingConnectionId ? "Deixe vazio para manter" : "Client ID Hotmart"} />
                  </label>
                  <label className="space-y-2 text-xs font-bold">
                    Client Secret
                    <input className="field" type="password" autoComplete="new-password" value={form.clientSecret} onChange={(event) => update("clientSecret", event.target.value)} placeholder={editingConnectionId ? "Deixe vazio para manter" : "Client Secret Hotmart"} />
                  </label>
                  <label className="space-y-2 text-xs font-bold">
                    Token Basic
                    <input className="field" type="password" autoComplete="new-password" value={form.basicToken} onChange={(event) => update("basicToken", event.target.value)} placeholder={editingConnectionId ? "Deixe vazio para manter" : "Token Basic da credencial"} />
                  </label>
                  <label className="space-y-2 text-xs font-bold">
                    HOTTOK do webhook
                    <input className="field" type="password" autoComplete="new-password" value={form.hottok} onChange={(event) => update("hottok", event.target.value)} placeholder={editingConnectionId ? "Deixe vazio para manter" : "HOTTOK da conta"} />
                  </label>
                </>
              )}
              {form.provider === "eduzz" && (
                <label className="space-y-2 text-xs font-bold sm:col-span-2">
                  Access Token OAuth
                  <input className="field" type="password" autoComplete="new-password" value={form.accessToken} onChange={(event) => update("accessToken", event.target.value)} placeholder={editingConnectionId ? "Deixe vazio para manter" : "Token autorizado pela Eduzz"} />
                </label>
              )}
              {form.provider === "kiwify" && (
                <>
                  <label className="space-y-2 text-xs font-bold">
                    Client ID / API Key
                    <input className="field" value={form.clientId} onChange={(event) => update("clientId", event.target.value)} placeholder={editingConnectionId ? "Deixe vazio para manter" : "Client ID Kiwify"} />
                  </label>
                  <label className="space-y-2 text-xs font-bold">
                    Client Secret
                    <input className="field" type="password" autoComplete="new-password" value={form.clientSecret} onChange={(event) => update("clientSecret", event.target.value)} placeholder={editingConnectionId ? "Deixe vazio para manter" : "Client Secret Kiwify"} />
                  </label>
                  <label className="space-y-2 text-xs font-bold sm:col-span-2">
                    ID da conta Kiwify
                    <input className="field" value={form.accountId} onChange={(event) => update("accountId", event.target.value)} placeholder={editingConnectionId ? "Deixe vazio para manter" : "x-kiwify-account-id"} />
                  </label>
                  <label className="space-y-2 text-xs font-bold sm:col-span-2">
                    Token do webhook (opcional)
                    <input className="field" type="password" autoComplete="new-password" value={form.webhookToken} onChange={(event) => update("webhookToken", event.target.value)} placeholder="Token configurado no webhook" />
                  </label>
                </>
              )}
              {form.provider === "hubla" && (
                <label className="space-y-2 text-xs font-bold sm:col-span-2">
                  Hubla Webhook Token
                  <input className="field" type="password" autoComplete="new-password" value={form.webhookToken} onChange={(event) => update("webhookToken", event.target.value)} placeholder={editingConnectionId ? "Deixe vazio para manter" : "Valor do header x-hubla-token"} />
                </label>
              )}
            </div>
            <p className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-[11px] leading-5 text-blue-950">
              {providerHelp[form.provider]}
            </p>
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-950">
              Credenciais atuais nunca sao exibidas. Na edicao, campos vazios preservam os
              valores armazenados; campos preenchidos substituem apenas aquele segredo.
            </p>
            <button
              type="button"
              disabled={
                busyId === (editingConnectionId ?? "new") ||
                !form.name ||
                (!editingConnectionId && !hasRequiredCredentials(form))
              }
              onClick={saveConnection}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink)] py-3 text-xs font-bold text-white disabled:opacity-40"
            >
              {busyId === (editingConnectionId ?? "new") ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
              {editingConnectionId ? "Salvar alteracoes" : form.provider === "payt" ? "Criar recebimento Payt" : "Validar e armazenar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
