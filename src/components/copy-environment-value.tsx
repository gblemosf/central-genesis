"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

interface CopyEnvironmentValueProps {
  name: string;
  value: string;
}

export function CopyEnvironmentValue({
  name,
  value,
}: CopyEnvironmentValueProps) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyValue}
      aria-label={`Copiar valor de ${name}`}
      className="flex shrink-0 items-center gap-2 rounded-lg border border-white/12 bg-white/8 px-3 py-2 text-[11px] font-bold text-white transition hover:bg-white/14"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}
