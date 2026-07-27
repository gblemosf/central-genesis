"use client";

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { MetaConnectionOption } from "@/lib/domain";
import { cn } from "@/lib/utils";

const steps = ["Expert", "Integracoes", "Funil", "Metas"];

interface FormState {
  expertName: string;
  expertEmail: string;
  projectName: string;
  slug: string;
  metaConnection: string;
  adAccountId: string;
  salesProvider: string;
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
  monthlyTarget: "100000",
  marginTarget: "65",
};

export function NewProjectWizard({
  demoMode,
  metaConnections,
}: {
  demoMode: boolean;
  metaConnections: MetaConnectionOption[];
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialState);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");
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

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === "projectName" && !current.slug
        ? {
            slug: value
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
          }
        : {}),
    }));
  };

  async function createProject() {
    setSaving(true);
    setError("");
    if (demoMode) {
      await new Promise((resolve) => setTimeout(resolve, 550));
      setCreated(true);
      setSaving(false);
      return;
    }

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.projectName,
        slug: form.slug,
        expertName: form.expertName,
        expertEmail: form.expertEmail || null,
        salesProvider: form.salesProvider,
        metaConnectionId: form.metaConnection || null,
        metaAdAccountExternalId: form.adAccountId || null,
        monthlyTarget: Number(form.monthlyTarget),
        marginTarget: Number(form.marginTarget),
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(body?.error ?? "Nao foi possivel criar o projeto.");
      setSaving(false);
      return;
    }

    setCreated(true);
    setSaving(false);
  }

  if (created) {
    return (
      <div className="panel mx-auto max-w-2xl rounded-[28px] p-8 text-center sm:p-12">
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-full bg-[var(--signal)]">
          <Check size={27} strokeWidth={3} />
        </div>
        <p className="eyebrow mb-3">Onboarding iniciado</p>
        <h1 className="text-3xl font-black tracking-[-0.045em]">
          {form.projectName || "Novo projeto"} foi criado.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--muted)]">
          Agora conecte as credenciais, sincronize os produtos e valide a primeira
          coleta antes de ativar a operacao.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Link
            href="/integrations"
            className="rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-bold text-white"
          >
            Configurar integracoes
          </Link>
          <Link
            href="/projects"
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
          Configure a estrutura inicial. Credenciais serao adicionadas depois, em
          uma etapa protegida.
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
                </label>
                <label className="space-y-2 text-xs font-bold sm:col-span-2">
                  Plataforma de vendas
                  <select
                    className="field"
                    value={form.salesProvider}
                    onChange={(event) => update("salesProvider", event.target.value)}
                  >
                    <option value="hotmart">Hotmart</option>
                    <option value="eduzz">Eduzz</option>
                    <option value="kiwify">Kiwify</option>
                    <option value="hubla">Hubla</option>
                  </select>
                </label>
              </div>
              <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-950">
                Nenhum token e solicitado aqui. Se uma conexao nao listar contas,
                execute a descoberta na area protegida de integracoes.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <p className="eyebrow">Etapa 3</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Estrutura do funil
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {["Produto core", "Order bump", "Upsell", "Downsell"].map(
                  (stage, index) => (
                    <div
                      key={stage}
                      className="rounded-2xl border border-[var(--line)] bg-white/50 p-4"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
                        Etapa {index + 1}
                      </p>
                      <p className="mt-1 text-sm font-black">{stage}</p>
                      <p className="mt-2 text-[11px] leading-5 text-[var(--muted)]">
                        Os produtos reais serao sincronizados e associados depois.
                      </p>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <p className="eyebrow">Etapa 4</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                  Metas operacionais
                </h2>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="space-y-2 text-xs font-bold">
                  Meta mensal de faturamento
                  <input
                    className="field"
                    inputMode="decimal"
                    value={form.monthlyTarget}
                    onChange={(event) => update("monthlyTarget", event.target.value)}
                  />
                </label>
                <label className="space-y-2 text-xs font-bold">
                  Margem alvo (%)
                  <input
                    className="field"
                    inputMode="decimal"
                    value={form.marginTarget}
                    onChange={(event) => update("marginTarget", event.target.value)}
                  />
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
                onClick={() => setStep((current) => current + 1)}
                className="inline-flex items-center gap-1 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-xs font-bold text-white"
              >
                Continuar <ChevronRight size={15} />
              </button>
            ) : (
              <button
                type="button"
                disabled={saving || !form.projectName || !form.expertName}
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
