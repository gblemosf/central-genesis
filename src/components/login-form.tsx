"use client";

import Link from "next/link";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase ainda nao foi configurado.");
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError("E-mail ou senha invalidos.");
      setLoading(false);
      return;
    }

    await fetch("/api/bootstrap", { method: "POST" }).catch(() => null);
    router.push("/overview");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen bg-[var(--sidebar)] p-4 lg:grid-cols-[1.1fr_.9fr]">
      <section className="relative hidden overflow-hidden rounded-[28px] bg-[var(--signal)] p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full border-[70px] border-[var(--coral)]/75" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-[14px] bg-[var(--sidebar)] font-black text-white">
            G
          </div>
          <p className="font-black">Genesis</p>
        </div>
        <div className="relative z-10 max-w-2xl">
          <p className="mb-4 text-[11px] font-black uppercase tracking-[0.22em]">
            Central de gestao
          </p>
          <h1 className="text-6xl font-black leading-[.92] tracking-[-0.075em]">
            Decisoes rapidas. Dados confiaveis.
          </h1>
        </div>
        <p className="relative z-10 text-xs font-semibold opacity-60">
          Uso interno da equipe Genesis
        </p>
      </section>

      <section className="grid place-items-center px-4 py-12 sm:px-10">
        <div className="w-full max-w-md text-white">
          <div className="mb-8 grid size-12 place-items-center rounded-[15px] bg-white/7 lg:hidden">
            G
          </div>
          <LockKeyhole className="mb-5 text-[var(--signal)]" size={25} />
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
            Area protegida
          </p>
          <h2 className="text-4xl font-black tracking-[-0.055em]">Entrar</h2>
          <p className="mt-3 text-sm leading-6 text-white/42">
            Acesse projetos, integracoes e indicadores da operacao.
          </p>

          <form onSubmit={signIn} className="mt-8 space-y-5">
            <label className="block space-y-2 text-xs font-bold">
              E-mail
              <input
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-[var(--signal)]/50"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="block space-y-2 text-xs font-bold">
              Senha
              <input
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-[var(--signal)]/50"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p className="text-xs font-medium text-red-300">{error}</p>}
            <button
              type="submit"
              disabled={loading || demoMode}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--signal)] py-3.5 text-xs font-black text-[var(--sidebar)] disabled:opacity-40"
            >
              {loading && <LoaderCircle size={15} className="animate-spin" />}
              Acessar a Central
            </button>
          </form>

          {demoMode && (
            <div className="mt-6 rounded-xl border border-white/8 bg-white/[0.035] p-4 text-xs leading-5 text-white/48">
              Supabase nao configurado. Voce pode navegar com dados demonstrativos.
              <Link
                href="/overview"
                className="mt-3 block font-black text-[var(--signal)]"
              >
                Entrar no modo demonstracao
              </Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
