import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function MetricCard({ label, value, hint, accent = "var(--mint)", action, unavailable = false }: {
  label: string;
  value: ReactNode;
  hint: string;
  accent?: string;
  unavailable?: boolean;
  action: { label: string; href: string } | { label: string; onClick: () => void };
}) {
  return <article className="panel @container flex min-w-0 flex-col overflow-hidden rounded-2xl border-t-[3px] p-4 sm:p-5" style={{ borderTopColor: accent }}>
    <h3 className="text-xs font-semibold text-[var(--muted)]">{label}</h3>
    <p className={`mt-3 font-bold tracking-tight tabular-nums ${unavailable ? "text-xl" : "text-[clamp(1.125rem,8.5cqw,1.75rem)]"}`}>{value}</p>
    <p className="mt-2 flex-1 text-xs leading-5 text-[var(--muted)]">{hint}</p>
    {"href" in action
      ? <Link href={action.href} className="mt-4 inline-flex w-fit items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline">{action.label}<ArrowUpRight size={14} aria-hidden="true" /></Link>
      : <button type="button" onClick={action.onClick} className="mt-4 inline-flex w-fit items-center gap-1 text-left text-xs font-semibold underline-offset-4 hover:underline">{action.label}<ArrowUpRight size={14} aria-hidden="true" /></button>}
  </article>;
}

export function DataHelp({ children, title = "Como interpretar estes valores" }: { children: ReactNode; title?: string }) {
  return <details className="rounded-xl border border-[var(--line)] bg-white/40 px-4 py-3 text-xs leading-5 text-[var(--muted)]">
    <summary className="w-fit cursor-pointer font-semibold text-[var(--ink)]">{title}</summary>
    <div className="mt-3 space-y-2">{children}</div>
  </details>;
}
