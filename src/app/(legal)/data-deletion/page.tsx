import type { Metadata } from "next";

export const metadata: Metadata = { title: "Exclusao de Dados" };

export default function DataDeletionPage() {
  return (
    <article className="panel rounded-[28px] p-6 sm:p-10">
      <p className="eyebrow">Privacidade</p>
      <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] sm:text-5xl">
        Exclusao de Dados
      </h1>
      <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--muted)]">
        Usuarios e empresas podem solicitar a exclusao dos dados tratados pela Central
        Genesis seguindo as instrucoes abaixo.
      </p>

      <ol className="mt-8 space-y-4 text-sm leading-7 text-[var(--muted)]">
        <li className="rounded-2xl border border-[var(--line)] bg-white/40 p-5">
          <strong className="block text-[var(--ink)]">1. Envie a solicitacao</strong>
          Escreva para lrcmcho2@gmail.com com o assunto &quot;Exclusao de dados - Central
          Genesis&quot;.
        </li>
        <li className="rounded-2xl border border-[var(--line)] bg-white/40 p-5">
          <strong className="block text-[var(--ink)]">2. Identifique o cadastro</strong>
          Informe seu nome, e-mail de acesso, organizacao e quais projetos ou integracoes
          devem ser excluidos. Nunca envie tokens, senhas ou chaves secretas.
        </li>
        <li className="rounded-2xl border border-[var(--line)] bg-white/40 p-5">
          <strong className="block text-[var(--ink)]">3. Confirmacao de identidade</strong>
          Podemos solicitar informacoes adicionais para confirmar que o pedido foi feito por
          pessoa autorizada e impedir exclusoes fraudulentas.
        </li>
        <li className="rounded-2xl border border-[var(--line)] bg-white/40 p-5">
          <strong className="block text-[var(--ink)]">4. Processamento</strong>
          A solicitacao sera confirmada e processada em prazo razoavel, observadas as
          obrigacoes legais. Dados necessarios para seguranca, auditoria, prevencao de fraude
          ou defesa de direitos podem ser preservados pelo periodo aplicavel.
        </li>
      </ol>

      <section className="mt-8 rounded-2xl bg-[var(--sidebar)] p-6 text-white">
        <h2 className="text-lg font-black">Revogacao de integracoes</h2>
        <p className="mt-2 text-sm leading-7 text-white/55">
          Administradores tambem podem abrir a pagina de Integracoes, revogar a credencial
          conectada e, quando nao existirem projetos ou vendas vinculados, excluir a conexao.
          A revogacao remove o segredo armazenado e impede novas sincronizacoes.
        </p>
      </section>
    </article>
  );
}
