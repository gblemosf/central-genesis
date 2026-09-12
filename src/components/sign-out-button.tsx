"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase indisponivel");
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      // A full navigation also discards private data in the client router cache.
      window.location.assign("/login");
    } catch {
      setError("Nao foi possivel sair. Tente novamente.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={signOut}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-white/65 transition hover:bg-white/7 hover:text-white disabled:opacity-50"
      >
        <LogOut size={15} />
        {busy ? "Saindo..." : "Sair da conta"}
      </button>
      {error && <p role="alert" className="px-3 pt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
