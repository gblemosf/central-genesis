"use client";

import { useRef } from "react";

import {
  LayoutDashboard,
  ShoppingBag,
  ChartNoAxesCombined,
  Users,
  Settings2,
  Wallet,
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
          {current.views.map(([view, label]) => (
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
        </nav>
      )}
      <p className="max-w-4xl text-xs leading-5 text-[var(--muted)]">{workspaceDescriptions[value]}</p>
    </div>
  );
}
