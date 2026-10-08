"use client";

import { useRef } from "react";

import {
  LayoutDashboard,
  ShoppingBag,
  ChartNoAxesCombined,
  Users,
  Settings2,
  Wallet,
  Plus,
} from "lucide-react";
import {
  workspaceSections,
  workspaceDescriptions,
  getWorkspaceSection,
  sectionDestination,
  type WorkspaceSection,
  type WorkspaceView,
} from "@/lib/workspace-navigation";

const icons = { summary: LayoutDashboard, sales: ShoppingBag, marketing: ChartNoAxesCombined, audience: Users, finance: Wallet, sources: Settings2 };
export function ProjectNavigation({
  value,
  onChange,
}: {
  value: WorkspaceView;
  onChange: (view: WorkspaceView) => void;
}) {
  const current = getWorkspaceSection(value);
  const remembered = useRef<Partial<Record<WorkspaceSection, WorkspaceView>>>({});
  function changeSection(section: WorkspaceSection) {
    remembered.current[current.id] = value;
    const next = sectionDestination(section, value, remembered.current[section]);
    if (next !== value) onChange(next);
  }
  return (
    <div className="space-y-3">
      <nav
        aria-label="Áreas do projeto"
        className="grid grid-cols-2 gap-1 rounded-2xl border border-[var(--line)] bg-white/50 p-1.5 sm:grid-cols-3 xl:grid-cols-6"
      >
        {workspaceSections.map((section) => {
          const Icon = icons[section.id],
            active = section.id === current.id;
          return (
            <button
              key={section.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => changeSection(section.id)}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-xs font-bold transition ${active ? "bg-[var(--ink)] text-white shadow-sm" : "text-[var(--muted)] hover:bg-black/5"}`}
            >
              <Icon size={16} aria-hidden="true" />
              {section.label}
            </button>
          );
        })}
      </nav>
      {current.views.length > 1 && (
        <nav
          aria-label={`Seções de ${current.label}`}
          className="flex flex-wrap gap-2"
        >
          {current.views.filter(([view]) => view !== "costs").map(([view, label]) => (
            <button
              key={view}
              type="button"
              aria-current={view === value ? "page" : undefined}
              onClick={() => onChange(view)}
              className={`rounded-lg px-3 py-2.5 text-xs font-semibold ${view === value ? "bg-white ring-1 ring-[var(--line)]" : "text-[var(--muted)] hover:bg-white/60"}`}
            >
              {label}
            </button>
          ))}
          {current.id === "finance" && <button type="button" aria-current={value === "costs" ? "page" : undefined} onClick={() => onChange("costs")} className={`ml-auto inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-3 py-2.5 text-xs font-semibold ${value === "costs" ? "bg-[var(--ink)] text-white" : "bg-white"}`}><Plus size={14} /> Cadastrar custos</button>}
        </nav>
      )}
      <details className="text-xs leading-5 text-[var(--muted)]"><summary className="w-fit cursor-pointer">Sobre esta seção</summary><p className="mt-2 max-w-4xl">{workspaceDescriptions[value]}</p></details>
    </div>
  );
}
