import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termos de Uso" };

export default function TermsPage() {
  return (
    <article className="panel rounded-[28px] p-6 sm:p-10">
      <p className="eyebrow">Documento publico</p>
      <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] sm:text-5xl">
        Termos de Uso
      </h1>
      <p className="mt-4 text-sm text-[var(--muted)]">Vigentes desde 1 de agosto de 2026.</p>

      <div className="mt-8 space-y-7 text-sm leading-7 text-[var(--muted)]">
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">1. Aceitacao</h2>
          <p className="mt-2">
            Ao acessar a Central Genesis, o usuario declara ter autorizacao para representar
            sua organizacao e concorda com estes termos e com a Politica de Privacidade.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">2. Finalidade do servico</h2>
          <p className="mt-2">
            A Central oferece recursos para organizar projetos, conectar contas autorizadas,
            importar dados de plataformas, mapear produtos e acompanhar indicadores de
            publicidade, vendas, custos e projecoes.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">3. Responsabilidades do usuario</h2>
          <p className="mt-2">
            O usuario deve fornecer dados verdadeiros, proteger suas credenciais, conceder
            somente os acessos necessarios, respeitar as regras das plataformas conectadas e
            utilizar apenas contas e dados para os quais possua autorizacao. Tokens e chaves
            nao devem ser compartilhados por e-mail, chat ou canais inseguros.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">4. Dados e resultados</h2>
          <p className="mt-2">
            Indicadores dependem dos dados fornecidos pelas integracoes, das janelas de
            atribuicao e do mapeamento de produtos. Divergencias, atrasos e indisponibilidades
            das plataformas de origem podem afetar os resultados. Projecoes sao estimativas
            e nao representam garantia de desempenho financeiro.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">5. Disponibilidade</h2>
          <p className="mt-2">
            Podemos realizar manutencoes e alterar funcionalidades para seguranca, melhoria
            ou conformidade. Nao garantimos operacao ininterrupta de servicos de terceiros,
            incluindo APIs, hospedagem e plataformas de anuncios ou vendas.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">6. Propriedade intelectual</h2>
          <p className="mt-2">
            A interface, a marca, os textos e o software da Central sao protegidos pela
            legislacao aplicavel. Os dados comerciais inseridos ou conectados permanecem sob
            responsabilidade e titularidade de seus respectivos proprietarios.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">7. Suspensao e encerramento</h2>
          <p className="mt-2">
            O acesso pode ser suspenso em caso de uso indevido, risco de seguranca, violacao
            destes termos ou exigencia legal. O usuario pode solicitar encerramento e
            exclusao conforme as instrucoes publicadas na pagina de Exclusao de Dados.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">8. Contato</h2>
          <p className="mt-2">
            Duvidas, notificacoes ou solicitacoes relacionadas a estes termos podem ser
            enviadas para lrcmcho2@gmail.com.
          </p>
        </section>
      </div>
    </article>
  );
}
