"use client";

import Link from "next/link";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { GenesisLogo } from "@/components/genesis-logo";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ResetPasswordForm({ userId }: { userId: string | null }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(!userId);
  const [done, setDone] = useState(false);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || expired || done) return;
    setError("");
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas informadas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) throw new Error("Authentication unavailable");
      // Revalidate with Auth: a session may expire while the form is open.
      const { data, error: sessionError } = await supabase.auth.getUser();
      if (sessionError || !data.user || data.user.id !== userId) {
        setExpired(true);
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        if (updateError.status === 401 || updateError.status === 403) setExpired(true);
        else setError(updateError.code === "same_password"
          ? "Escolha uma senha diferente da anterior."
          : updateError.code === "weak_password"
            ? "Escolha uma senha mais forte, com letras, números e símbolos."
            : "Não foi possível salvar a senha. Tente novamente.");
        return;
      }
      setPassword("");
      setConfirmation("");
      setDone(true);
      // Finish recovery and require a fresh sign-in; also revoke other refresh sessions.
      await supabase.auth.signOut({ scope: "global" }).catch(() => undefined);
    } catch {
      setError("Não foi possível conectar. Confira sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass = "mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-[var(--signal)]/50";
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--sidebar)] px-6 py-12 text-white">
      <section className="w-full max-w-md">
        <GenesisLogo size={56} priority className="mb-8 rounded-2xl" />
        <LockKeyhole className="mb-5 text-[var(--signal)]" size={25} />
        <h1 className="text-4xl font-black tracking-[-0.055em]">Redefinir senha</h1>
        {done ? (
          <p role="status" className="mt-5 text-sm leading-6 text-[var(--signal)]">Senha atualizada. Entre na Central com sua nova senha.</p>
        ) : expired ? (
          <p role="alert" className="mt-5 text-sm leading-6 text-red-300">Este link é inválido, expirou ou foi aberto em outro navegador. Volte ao login e solicite um novo link em “Esqueci minha senha”.</p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-white/60">Escolha uma nova senha com pelo menos 8 caracteres.</p>
            <form onSubmit={savePassword} className="mt-8 space-y-5">
              <label className="block text-xs font-bold">Nova senha
                <input type="password" autoComplete="new-password" required minLength={8} value={password}
                  onChange={event => setPassword(event.target.value)} className={inputClass} />
              </label>
              <label className="block text-xs font-bold">Confirmar nova senha
                <input type="password" autoComplete="new-password" required minLength={8} value={confirmation}
                  onChange={event => setConfirmation(event.target.value)} className={inputClass} />
              </label>
              {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
              <button type="submit" disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--signal)] py-3.5 text-xs font-black text-[var(--sidebar)] disabled:opacity-40">
                {loading && <LoaderCircle size={15} className="animate-spin" />}
                Salvar nova senha
              </button>
            </form>
          </>
        )}
        <Link href="/login" className="mt-7 inline-block text-sm font-bold text-[var(--signal)] hover:underline">
          {done ? "Entrar com a nova senha" : "Voltar ao login"}
        </Link>
      </section>
    </main>
  );
}
