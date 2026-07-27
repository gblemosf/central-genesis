import type { Metadata } from "next";
import { Check, CircleAlert, Database, KeyRound, LockKeyhole } from "lucide-react";
import { getSupabasePublicEnv, getSupabaseSecretKey } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Configuracoes" };

export default function SettingsPage() {
  const publicEnv = getSupabasePublicEnv();
  const secretConfigured = Boolean(getSupabaseSecretKey());
  const checks = [
    {
      label: "Supabase publicavel",
      ready: publicEnv.configured,
      description: "URL e publishable key para sessao e consultas protegidas.",
      icon: Database,
    },
    {
      label: "Chave de servidor",
      ready: secretConfigured,
      description: "Usada somente pelas rotas protegidas para acessar o cofre.",
      icon: KeyRound,
    },
    {
      label: "RLS e migrations",
      ready: false,
      description: "Marque como concluido depois de aplicar a migration inicial.",
      icon: LockKeyhole,
    },
  ];

  return (
    <div className="space-y-7">
      <header>
        <p className="eyebrow mb-3">Ambiente</p>
        <h1 className="text-4xl font-black tracking-[-0.055em] sm:text-5xl">
          Configuracoes
        </h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Checklist para conectar o ambiente local e a Vercel ao Supabase.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {checks.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.label} className="panel rounded-[22px] p-5">
              <div className="mb-7 flex items-center justify-between">
                <div className="grid size-10 place-items-center rounded-xl bg-black/[0.045]">
                  <Icon size={18} />
                </div>
                <span
                  className={`grid size-7 place-items-center rounded-full ${
                    item.ready
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {item.ready ? <Check size={14} /> : <CircleAlert size={14} />}
                </span>
              </div>
              <h2 className="text-sm font-black">{item.label}</h2>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                {item.description}
              </p>
            </article>
          );
        })}
      </section>

      <section className="panel rounded-[24px] p-6">
        <p className="eyebrow">Variaveis da Vercel</p>
        <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
          Configuracao necessaria
        </h2>
        <div className="mt-6 overflow-x-auto rounded-xl bg-[var(--sidebar)] p-5 font-mono text-xs leading-7 text-white/72">
          <p>NEXT_PUBLIC_SUPABASE_URL</p>
          <p>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</p>
          <p>SUPABASE_SECRET_KEY</p>
          <p>META_GRAPH_API_VERSION=v25.0</p>
        </div>
        <p className="mt-4 max-w-3xl text-xs leading-6 text-[var(--muted)]">
          A chave secreta nunca recebe o prefixo NEXT_PUBLIC. Tokens de Meta,
          Hotmart ou outros provedores nao ficam em variaveis da Vercel: eles sao
          cadastrados pela Central e armazenados individualmente no cofre.
        </p>
      </section>
    </div>
  );
}
