import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sobre a Central Gênesis",
  description: "Gestão de projetos, vendas, contatos e respostas de formulários em um só lugar.",
};

export default function AboutPage() {
  return (
    <article className="panel rounded-[28px] p-6 sm:p-10">
      <p className="eyebrow">Central de gestão</p>
      <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] sm:text-5xl">
        Central Gênesis
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--muted)]">
        Organize projetos e acompanhe vendas, valores líquidos, origens, contatos,
        recuperação de checkout e resultados das suas operações.
      </p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <section className="rounded-2xl border border-[var(--line)] p-5">
          <h2 className="text-lg font-black">Vendas e resultados</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
            Conecte contas autorizadas da Hotmart, Hubla e Meta, vincule produtos e
            ativos a cada projeto e consulte indicadores comerciais e de publicidade.
          </p>
        </section>
        <section className="rounded-2xl border border-[var(--line)] p-5">
          <h2 className="text-lg font-black">Google Forms e Google Sheets</h2>
          <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
            Autorize a leitura da conta Google que tem acesso aos seus formulários.
            Escolha quais formulários vincular a cada projeto para importar perguntas
            e respostas e consultar os valores da planilha de respostas vinculada.
          </p>
        </section>
      </div>

      <section className="mt-7 space-y-3 text-sm leading-7 text-[var(--muted)]">
        <h2 className="text-lg font-black text-[var(--ink)]">Você controla a conexão</h2>
        <p>
          As permissões Google solicitadas são de leitura. A integração não altera
          formulários ou planilhas. Respostas sincronizadas ficam disponíveis para
          os usuários autorizados da organização, e a conexão pode ser revogada na
          área de Integrações.
        </p>
        <p>
          Consulte a <Link href="/privacy" className="font-bold underline">Política de Privacidade</Link>,
          os <Link href="/terms" className="font-bold underline">Termos de Uso</Link> e
          as <Link href="/data-deletion" className="font-bold underline">instruções de exclusão de dados</Link>.
        </p>
      </section>
      <Link href="/login" className="mt-8 inline-flex rounded-xl bg-[var(--sidebar)] px-6 py-3 text-sm font-bold text-white">
        Acessar a Central
      </Link>
    </article>
  );
}
