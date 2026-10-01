"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Blocks,
  ChevronRight,
  FlaskConical,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Settings,
  ListChecks,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GenesisLogo } from "@/components/genesis-logo";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Acompanhar", items: [
    { href: "/overview", label: "Visão geral", icon: LayoutDashboard },
    { href: "/projects", label: "Projetos", icon: FolderKanban },
  ] },
  { label: "Preparar a operação", items: [
    { href: "/setup", label: "Passo a passo", icon: ListChecks },
    { href: "/integrations", label: "Conexões", icon: Blocks },
  ] },
  { label: "Ferramentas", items: [
    { href: "/simulator", label: "Simulador", icon: FlaskConical },
    { href: "/settings", label: "Diagnóstico técnico", icon: Settings },
  ] },
];

interface AppShellProps {
  children: React.ReactNode;
  userLabel: string;
  demoMode: boolean;
}

export function AppShell({ children, userLabel, demoMode }: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); }
      if (event.key === "Tab" && window.matchMedia("(max-width: 1023px)").matches) {
        const links = Array.from(sidebar.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)") ?? []);
        const first = menuButton.current, last = links.at(-1);
        if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-white focus:p-4">Ir para o conteúdo</a>
      <button
        ref={menuButton}
        type="button"
        aria-label={open ? "Fechar navegação" : "Abrir menu"}
        aria-expanded={open}
        aria-controls="app-navigation"
        className="fixed left-4 top-4 z-50 grid size-11 place-items-center rounded-full border border-white/10 bg-[var(--sidebar)] text-white shadow-xl lg:hidden"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={18} /> : <Menu size={18} />}
      </button>

      <aside
        ref={sidebar}
        id="app-navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col overflow-y-auto border-r border-white/8 bg-[var(--sidebar)] px-5 py-6 text-white transition-transform duration-300 lg:visible lg:translate-x-0",
          open ? "visible translate-x-0" : "invisible -translate-x-full",
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

        <nav className="space-y-6 pb-6" aria-label="Navegação principal">
          {navigation.map((group) => <div key={group.label}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/40">{group.label}</p>
            <div className="space-y-1">{group.items.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
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
          })}</div>
          </div>)}
        </nav>

        <div className="mt-auto space-y-4">
          <Link href="/setup" onClick={() => setOpen(false)} className="block rounded-2xl border border-white/10 bg-white/5 p-4 text-xs leading-5 text-white/70">
            {demoMode ? "Ambiente de demonstração" : "Precisa configurar algo?"}
            <span className="mt-1 block text-white/50">{demoMode ? "Os exemplos não representam vendas reais." : "Veja a sequência e o que falta em cada etapa."}</span>
          </Link>
          <div className="flex items-center gap-3 px-2">
            <div className="grid size-9 place-items-center rounded-full bg-white/9 text-xs font-bold">
              {userLabel.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{userLabel}</p>
              <p className="text-[10px] text-white/50">{demoMode ? "Demonstração" : "Conta conectada"}</p>
            </div>
          </div>
          {!demoMode && <SignOutButton />}
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

      <main id="main-content" tabIndex={-1} className="min-h-screen min-w-0 lg:pl-[272px]">
        <div className="mx-auto w-full max-w-[1580px] px-4 pb-12 pt-20 sm:px-7 lg:px-10 lg:pt-9">
          {children}
        </div>
      </main>
    </div>
  );
}
