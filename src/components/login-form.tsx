"use client";

import Link from "next/link";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GenesisLogo } from "@/components/genesis-logo";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm({ demoMode }: { demoMode: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function enterCentral(
    supabase: NonNullable<ReturnType<typeof createSupabaseBrowserClient>>,
  ) {
    const response = await fetch("/api/bootstrap", { method: "POST" }).catch(
      () => null,
    );
    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as
        | { error?: string }
        | null;
      await supabase.auth.signOut();
      setError(
        body?.error ??
          "Sua conta ainda nao foi autorizada para acessar a organizacao.",
      );
      return false;
    }

    router.push("/overview");
    router.refresh();
    return true;
  }

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase ainda nao foi configurado.");
      setLoading(false);
      return;
    }

    if (mode === "sign-up") {
      if (password.length < 8) {
        setError("A senha precisa ter pelo menos 8 caracteres.");
        setLoading(false);
        return;
      }
      if (password !== passwordConfirmation) {
        setError("As senhas informadas nao coincidem.");
        setLoading(false);
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (signUpError) {
        setError("Nao foi possivel criar a conta. Verifique os dados informados.");
        setLoading(false);
        return;
      }

      if (!data.session) {
        setMessage(
          "Conta criada. Verifique seu e-mail para confirmar o cadastro antes de entrar.",
        );
        setLoading(false);
        return;
      }

      await enterCentral(supabase);
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

    await enterCentral(supabase);
    setLoading(false);
  }

  function changeMode() {
    setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
    setPassword("");
    setPasswordConfirmation("");
    setError("");
    setMessage("");
  }

  return (
    <main className="grid min-h-screen bg-[var(--sidebar)] p-4 lg:grid-cols-[1.1fr_.9fr]">
      <section className="relative hidden overflow-hidden rounded-[28px] bg-[var(--signal)] p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full border-[70px] border-[var(--coral)]/75" />
        <div className="relative z-10 flex items-center gap-3">
          <div className="grid size-14 place-items-center overflow-hidden rounded-[16px] bg-black shadow-[0_10px_35px_rgba(17,24,35,.2)]">
            <GenesisLogo size={56} priority className="size-14 object-cover" />
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
          <div className="mb-8 grid size-14 place-items-center overflow-hidden rounded-[16px] bg-black shadow-xl lg:hidden">
            <GenesisLogo size={56} priority className="size-14 object-cover" />
          </div>
          <LockKeyhole className="mb-5 text-[var(--signal)]" size={25} />
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
            Area protegida
          </p>
          <h2 className="text-4xl font-black tracking-[-0.055em]">
            {mode === "sign-in" ? "Entrar" : "Criar conta"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/42">
            {mode === "sign-in"
              ? "Acesse projetos, integracoes e indicadores da operacao."
              : "Cadastre seu acesso interno com e-mail e senha."}
          </p>

          <form onSubmit={authenticate} className="mt-8 space-y-5">
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
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {mode === "sign-up" && (
              <label className="block space-y-2 text-xs font-bold">
                Confirmar senha
                <input
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-[var(--signal)]/50"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                />
              </label>
            )}
            {error && <p className="text-xs font-medium text-red-300">{error}</p>}
            {message && (
              <p className="text-xs font-medium leading-5 text-[var(--signal)]">
                {message}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || demoMode}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--signal)] py-3.5 text-xs font-black text-[var(--sidebar)] disabled:opacity-40"
            >
              {loading && <LoaderCircle size={15} className="animate-spin" />}
              {mode === "sign-in" ? "Acessar a Central" : "Criar minha conta"}
            </button>
          </form>

          {!demoMode && (
            <div className="mt-6 border-t border-white/8 pt-5 text-center text-xs text-white/48">
              {mode === "sign-in" ? "Ainda nao possui acesso?" : "Ja possui uma conta?"}{" "}
              <button
                type="button"
                onClick={changeMode}
                className="font-black text-[var(--signal)] hover:underline"
              >
                {mode === "sign-in" ? "Criar conta" : "Entrar"}
              </button>
            </div>
          )}

          <nav className="mt-6 flex flex-wrap justify-center gap-4 text-xs text-white/65" aria-label="Informações do serviço">
            <Link href="/about">Sobre a Central</Link>
            <Link href="/privacy">Privacidade</Link>
            <Link href="/terms">Termos</Link>
          </nav>

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
