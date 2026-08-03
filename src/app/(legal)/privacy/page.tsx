import type { Metadata } from "next";

export const metadata: Metadata = { title: "Politica de Privacidade" };

export default function PrivacyPage() {
  return (
    <article className="panel rounded-[28px] p-6 sm:p-10">
      <p className="eyebrow">Documento publico</p>
      <h1 className="mt-3 text-3xl font-black tracking-[-0.05em] sm:text-5xl">
        Politica de Privacidade
      </h1>
      <p className="mt-4 text-sm text-[var(--muted)]">Vigente desde 1 de agosto de 2026.</p>

      <div className="mt-8 space-y-7 text-sm leading-7 text-[var(--muted)]">
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">1. Responsavel</h2>
          <p className="mt-2">
            A Central Genesis e uma ferramenta de gestao de projetos, publicidade e
            desempenho comercial. Duvidas sobre privacidade podem ser enviadas para
            lrcmcho2@gmail.com.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">2. Dados tratados</h2>
          <p className="mt-2">
            Podemos tratar nome, e-mail e identificadores dos usuarios autorizados;
            identificadores de contas e ativos conectados; metricas de campanhas e
            anuncios; dados de projetos, produtos, funis e vendas; registros tecnicos de
            acesso, sincronizacao, seguranca e auditoria. A Central nao solicita a chave
            secreta de aplicativos Meta nem exibe novamente credenciais armazenadas.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">3. Finalidades</h2>
          <p className="mt-2">
            Os dados sao utilizados para autenticar usuarios, conectar plataformas
            autorizadas, consolidar indicadores, calcular desempenho, apresentar
            relatorios, prevenir fraudes, solucionar falhas e cumprir obrigacoes legais.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">4. Integracoes e compartilhamento</h2>
          <p className="mt-2">
            Dados podem ser processados por fornecedores essenciais de hospedagem, banco
            de dados, autenticacao e monitoramento, incluindo Vercel e Supabase, e pelas
            plataformas que o usuario decidir conectar, como Meta e provedores de vendas.
            Nao vendemos dados pessoais. O acesso ocorre somente para operacao do servico,
            suporte, seguranca ou cumprimento de lei.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">5. Credenciais e seguranca</h2>
          <p className="mt-2">
            Credenciais de integracao sao recebidas por rotas autenticadas, armazenadas em
            cofre protegido e tratadas como segredos somente de escrita: podem ser
            substituidas, mas nunca sao retornadas ao navegador. Utilizamos controles de
            acesso por organizacao, politicas de seguranca no banco de dados e registros de
            operacoes administrativas. Nenhum sistema e completamente imune a riscos, mas
            adotamos medidas proporcionais a natureza dos dados tratados.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">6. Retencao</h2>
          <p className="mt-2">
            Mantemos os dados enquanto a conta, o projeto ou a integracao estiverem ativos
            e pelo periodo necessario para auditoria, seguranca, defesa de direitos ou
            obrigacao legal. Credenciais revogadas sao removidas do cofre operacional.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">7. Direitos do titular</h2>
          <p className="mt-2">
            O titular pode solicitar confirmacao de tratamento, acesso, correcao,
            portabilidade quando aplicavel, informacoes sobre compartilhamento, revogacao
            de consentimento e exclusao de dados que nao precisem ser preservados. As
            solicitacoes devem ser enviadas para lrcmcho2@gmail.com.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">8. Cookies e transferencias</h2>
          <p className="mt-2">
            Utilizamos cookies estritamente necessarios para autenticacao e seguranca. Os
            fornecedores de infraestrutura podem processar dados em outros paises, sob
            medidas contratuais e tecnicas adequadas.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-black text-[var(--ink)]">9. Atualizacoes</h2>
          <p className="mt-2">
            Esta politica pode ser atualizada para refletir mudancas legais, tecnicas ou
            operacionais. A versao vigente permanecera publicada nesta pagina.
          </p>
        </section>
      </div>
    </article>
  );
}
