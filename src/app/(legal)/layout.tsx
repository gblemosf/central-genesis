import Image from "next/image";
import Link from "next/link";
import { genesisLogoUrl } from "@/lib/brand";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8 flex flex-col gap-5 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src={genesisLogoUrl}
              alt="Central Genesis"
              width={42}
              height={42}
              className="rounded-xl"
            />
            <span>
              <strong className="block text-sm">Central Genesis</strong>
              <small className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
                Gestao de performance
              </small>
            </span>
          </Link>
          <nav className="flex flex-wrap gap-4 text-xs font-bold text-[var(--muted)]">
            <Link href="/privacy">Privacidade</Link>
            <Link href="/terms">Termos</Link>
            <Link href="/data-deletion">Excluir dados</Link>
          </nav>
        </header>
        {children}
        <footer className="mt-10 border-t border-[var(--line)] pt-6 text-xs leading-6 text-[var(--muted)]">
          Central Genesis | Contato: {" "}
          <a className="font-bold text-[var(--ink)]" href="mailto:lrcmcho2@gmail.com">
            lrcmcho2@gmail.com
          </a>
        </footer>
      </div>
    </main>
  );
}
