"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Blocks,
  ChevronRight,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { GenesisLogo } from "@/components/genesis-logo";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/overview", label: "Visao geral", icon: LayoutDashboard },
  { href: "/projects", label: "Projetos", icon: FolderKanban },
  { href: "/integrations", label: "Integracoes", icon: Blocks },
  { href: "/simulator", label: "Simulador", icon: FlaskConical },
  { href: "/settings", label: "Configuracoes", icon: Settings },
];

interface AppShellProps {
  children: React.ReactNode;
  userLabel: string;
  demoMode: boolean;
}

export function AppShell({ children, userLabel, demoMode }: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <button
        type="button"
        aria-label="Abrir menu"
        className="fixed left-4 top-4 z-50 grid size-11 place-items-center rounded-full border border-white/10 bg-[var(--sidebar)] text-white shadow-xl lg:hidden"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-white/8 bg-[var(--sidebar)] px-5 py-6 text-white transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-9 flex items-center gap-3 px-2">
          <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,.08)]">
            <GenesisLogo size={44} priority className="size-11 object-cover" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/40">
              Central de gestao
            </p>
            <p className="text-lg font-bold tracking-[-0.03em]">Genesis</p>
          </div>
        </div>

        <nav className="space-y-1">
          {navigation.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-white/58 transition",
                  active
                    ? "bg-white text-[var(--sidebar)] shadow-[0_8px_30px_rgba(0,0,0,.18)]"
                    : "hover:bg-white/7 hover:text-white",
                )}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
                <ChevronRight
                  size={15}
                  className={cn(
                    "ml-auto opacity-0 transition group-hover:opacity-50",
                    active && "opacity-35",
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-4">
          <div className="rounded-2xl border border-white/8 bg-white/[0.035] p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white/78">
              <Activity size={15} className="text-[var(--signal)]" />
              Operacao monitorada
            </div>
            <div className="space-y-2 text-[11px] text-white/42">
              <div className="flex justify-between">
                <span>Supabase</span>
                <span className="text-[var(--mint)]">
                  {demoMode ? "Demo" : "Conectado"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Protecao</span>
                <span className="flex items-center gap-1 text-white/70">
                  <ShieldCheck size={12} /> RLS
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 px-2">
            <div className="grid size-9 place-items-center rounded-full bg-white/9 text-xs font-bold">
              RG
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{userLabel}</p>
              <p className="text-[10px] text-white/35">Administrador</p>
            </div>
          </div>
        </div>
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <main className="min-h-screen lg:pl-[272px]">
        <div className="mx-auto w-full max-w-[1580px] px-4 pb-12 pt-20 sm:px-7 lg:px-10 lg:pt-9">
          {children}
        </div>
      </main>
    </div>
  );
}
