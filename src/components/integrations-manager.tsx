"use client";

import {
  Check,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import type {
  IntegrationConnection,
  Provider,
} from "@/lib/domain";
import { providerLabels } from "@/lib/domain";
import { cn } from "@/lib/utils";

const providerOptions: Provider[] = [
  "meta",
  "hotmart",
  "eduzz",
  "kiwify",
  "hubla",
];

interface ConnectionForm {
  name: string;
  provider: Provider;
  businessId: string;
  appId: string;
  systemUserId: string;
  credential: string;
}

const emptyForm: ConnectionForm = {
  name: "",
  provider: "meta",
  businessId: "",
  appId: "",
  systemUserId: "",
  credential: "",
};

export function IntegrationsManager({
  initialConnections,
  demoMode,
  warning,
}: {
  initialConnections: IntegrationConnection[];
  demoMode: boolean;
  warning?: string;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState(warning ?? "");

  const update = (field: keyof ConnectionForm, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  async function addConnection() {
    setMessage("");
    setBusyId("new");

    if (demoMode) {
      const connection: IntegrationConnection = {
        id: crypto.randomUUID(),
        name: form.name || `${providerLabels[form.provider]} sem nome`,
        provider: form.provider,
        status: "connected",
        businessId: form.businessId || undefined,
        accountCount: 0,
        lastVerifiedAt: new Date().toISOString(),
      };
      await new Promise((resolve) => setTimeout(resolve, 450));
      setConnections((current) => [...current, connection]);
      setForm(emptyForm);
      setShowForm(false);
      setBusyId(null);
      setMessage("Conexao demonstrativa adicionada. Nenhuma credencial foi armazenada.");
      return;
    }

    const response = await fetch("/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        provider: form.provider,
        businessId: form.businessId || null,
        appId: form.appId || null,
        systemUserId: form.systemUserId || null,
        credential: form.credential,
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { data?: IntegrationConnection; error?: string }
      | null;

    if (!response.ok || !body?.data) {
      setMessage(body?.error ?? "Nao foi possivel criar a conexao.");
      setBusyId(null);
      return;
    }

    setConnections((current) => [...current, body.data!]);
    setForm(emptyForm);
    setShowForm(false);
    setBusyId(null);
    setMessage("Credencial armazenada. Ela nao pode mais ser visualizada.");
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

    const response = await fetch(`/api/connections/${connectionId}/verify`, {
      method: "POST",
    });
    setConnections((current) =>
      current.map((connection) =>
        connection.id === connectionId
          ? {
              ...connection,
              status: response.ok ? "connected" : "attention",
              lastVerifiedAt: response.ok ? new Date().toISOString() : null,
            }
          : connection,
      ),
    );
    setMessage(
      response.ok
        ? "Conexao verificada com sucesso."
        : "A verificacao falhou. Consulte o status da credencial.",
    );
    setBusyId(null);
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

    const response = await fetch(`/api/connections/${connectionId}/accounts`, {
      method: "POST",
    });
    const body = (await response.json().catch(() => null)) as
      | { accounts?: number; error?: string }
      | null;
    if (response.ok) {
      setConnections((current) =>
        current.map((connection) =>
          connection.id === connectionId
            ? { ...connection, accountCount: body?.accounts ?? connection.accountCount }
            : connection,
        ),
      );
      setMessage(`${body?.accounts ?? 0} conta(s) Meta encontrada(s).`);
    } else {
      setMessage(body?.error ?? "Nao foi possivel descobrir as contas Meta.");
    }
    setBusyId(null);
  }

  async function revokeConnection(connectionId: string) {
    if (!window.confirm("Revogar e apagar a credencial armazenada?")) return;
    setBusyId(connectionId);
    if (!demoMode) {
      const response = await fetch(`/api/connections/${connectionId}/credentials`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setMessage("Nao foi possivel revogar a credencial.");
        setBusyId(null);
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
    setBusyId(null);
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
            Cadastre varios BMs da Meta e conexoes de vendas. Credenciais sao
            write-only e nunca retornam ao navegador.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
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
        {connections.map((connection) => (
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
                <span className="text-[var(--muted)]">Contas vinculadas</span>
                <span className="font-black">{connection.accountCount}</span>
              </div>
              <div className="flex justify-between pb-2">
                <span className="text-[var(--muted)]">Ultima verificacao</span>
                <span className="font-black">
                  {connection.lastVerifiedAt ? "Verificada" : "Pendente"}
                </span>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
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
              <button
                type="button"
                disabled={busyId === connection.id || connection.status === "revoked"}
                onClick={() => revokeConnection(connection.id)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 py-2.5 text-[10px] font-bold text-red-700 disabled:opacity-40"
              >
                <Trash2 size={14} /> Revogar
              </button>
              {connection.provider === "meta" && (
                <button
                  type="button"
                  disabled={busyId === connection.id || connection.status === "revoked"}
                  onClick={() => discoverAccounts(connection.id)}
                  className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 py-2.5 text-[10px] font-bold text-blue-800 disabled:opacity-40"
                >
                  <RefreshCw size={14} /> Descobrir contas Meta
                </button>
              )}
            </div>
          </article>
        ))}

        <button
          type="button"
          onClick={() => setShowForm(true)}
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
      </section>

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
              segredo em memoria; visualizar, copiar ou recuperar nao e permitido.
            </p>
          </div>
        </div>
      </section>

      {showForm && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[26px] bg-[var(--paper)] p-6 shadow-2xl sm:p-8">
            <div className="mb-7 flex items-start justify-between">
              <div>
                <p className="eyebrow">Nova conexao</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Credencial protegida
                </h2>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setShowForm(false)}
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
                </>
              )}
              <label className="space-y-2 text-xs font-bold sm:col-span-2">
                Credencial ou token
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={form.credential}
                  onChange={(event) => update("credential", event.target.value)}
                  placeholder="Cole uma unica vez"
                />
              </label>
            </div>
            <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-950">
              Depois de salvar, a credencial nao sera exibida novamente. Para trocar,
              use o fluxo de substituicao ou revogue esta conexao.
            </p>
            <button
              type="button"
              disabled={busyId === "new" || !form.name || !form.credential}
              onClick={addConnection}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink)] py-3 text-xs font-bold text-white disabled:opacity-40"
            >
              {busyId === "new" ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Check size={15} />
              )}
              Validar e armazenar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
