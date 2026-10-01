import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Database,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  LockKeyhole,
  Minus,
  PlugZap,
  Rocket,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { CopyEnvironmentValue } from "@/components/copy-environment-value";
import { getSupabasePublicEnv, getSupabaseSecretKey } from "@/lib/supabase/env";
import { databaseRequirements, migrations, isBaseAvailable } from "@/lib/configuration-catalog";
import { getDatabaseChecks } from "@/lib/configuration-status";
import { isGoogleOAuthConfigured } from "@/lib/google/oauth";

export const metadata: Metadata = { title: "Diagnóstico técnico" };

function getProjectRef(url: string) {
  try {
    return new URL(url).hostname.split(".")[0] ?? "";
  } catch {
    return "";
  }
}

export default async function SettingsPage() {
  await connection();
  const publicEnv = getSupabasePublicEnv();
  const secretConfigured = Boolean(getSupabaseSecretKey());
  const bootstrapConfigured = Boolean(
    process.env.GENESIS_BOOTSTRAP_EMAILS?.trim(),
  );
  const googleClientIdConfigured = Boolean(process.env.GOOGLE_CLIENT_ID?.trim());
  const googleClientSecretConfigured = Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim());
  const googleRedirectUriConfigured = Boolean(process.env.GOOGLE_REDIRECT_URI?.trim());
  const googleOAuthConfigured = isGoogleOAuthConfigured();
  const demoExplicitlyDisabled = process.env.NEXT_PUBLIC_DEMO_MODE === "false";
  const metaGraphVersion = process.env.META_GRAPH_API_VERSION?.trim() || "v25.0";
  const projectRef = getProjectRef(publicEnv.url);
  const supabaseDashboardUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}`
    : "https://supabase.com/dashboard/projects";

  const databaseChecks = await getDatabaseChecks();
  const databaseReady = isBaseAvailable(databaseChecks);

  const foundationChecks = [
    {
      label: "Conexao publica",
      ready: publicEnv.configured,
      description: "Verifica a presença da URL e da chave pública. Isso não confirma acesso às fontes externas.",
      icon: Database,
    },
    {
      label: "Operacoes do servidor",
      ready: secretConfigured,
      description: "Verifica a presença da chave privada do servidor. Sua validade não é testada nesta consulta.",
      icon: KeyRound,
    },
    {
      label: "Estrutura do banco",
      ready: databaseReady,
      description: "Consulta as estruturas principais para sua conta. Os módulos adicionais são verificados separadamente abaixo.",
      icon: LockKeyhole,
    },
    {
      label: "Credenciais Google (opcional)",
      ready: googleOAuthConfigured,
      description: "Verifica o formato das variáveis OAuth. A validade externa não é testada; autorize a conta e confira a leitura em Conexões.",
      icon: PlugZap,
    },
  ];
  const basicFoundations = foundationChecks.slice(0, 3);
  const completedFoundations = basicFoundations.filter((item) => item.ready).length;
  const foundationReady = completedFoundations === basicFoundations.length;

  const variables = [
    {
      name: "NEXT_PUBLIC_SUPABASE_URL",
      ready: Boolean(publicEnv.url),
      required: true,
      secret: false,
      value: publicEnv.url,
      description: "Endereco do projeto Supabase usado pelo navegador e pelo servidor.",
      source: "Supabase > Connect > Project URL",
    },
    {
      name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      ready: Boolean(publicEnv.key),
      required: true,
      secret: false,
      value: publicEnv.key,
      description: "Chave publica para login e consultas limitadas pelas regras RLS.",
      source: "Supabase > Settings > API Keys > Publishable key",
    },
    {
      name: "SUPABASE_SECRET_KEY",
      ready: secretConfigured,
      required: true,
      secret: true,
      value: "",
      description: "Chave privada das rotas administrativas e do cofre de integracoes.",
      source: "Supabase > Settings > API Keys > Secret key",
    },
    {
      name: "NEXT_PUBLIC_DEMO_MODE",
      ready: demoExplicitlyDisabled,
      required: false,
      secret: false,
      value: demoExplicitlyDisabled ? "false" : "",
      description: "Deixe como false para nunca substituir dados reais por demonstracao.",
      source: "Valor recomendado: false",
    },
    {
      name: "GENESIS_BOOTSTRAP_EMAILS",
      ready: bootstrapConfigured,
      required: false,
      secret: true,
      value: "",
      description: "E-mails autorizados a criar a primeira organizacao; depois disso e opcional.",
      source: "Lista de e-mails separada por virgulas",
    },
    {
      name: "META_GRAPH_API_VERSION",
      ready: true,
      required: false,
      secret: false,
      value: metaGraphVersion,
      description: "Versao da API Meta. Se estiver ausente, a aplicacao usa v25.0.",
      source: "Valor recomendado: v25.0",
    },
    {
      name: "GOOGLE_CLIENT_ID",
      ready: googleClientIdConfigured,
      required: false,
      secret: true,
      value: "",
      description: "Client ID OAuth usado para autorizar a leitura de Google Forms.",
      source: "Google Cloud Console > APIs & Services > Credentials",
    },
    {
      name: "GOOGLE_CLIENT_SECRET",
      ready: googleClientSecretConfigured,
      required: false,
      secret: true,
      value: "",
      description: "Client Secret OAuth do mesmo app configurado no Google Cloud.",
      source: "Google Cloud Console > APIs & Services > Credentials",
    },
    {
      name: "GOOGLE_REDIRECT_URI",
      ready: googleRedirectUriConfigured,
      required: false,
      secret: false,
      value: process.env.GOOGLE_REDIRECT_URI?.trim() ?? "",
      description: "URL autorizada para retorno do OAuth Google Forms.",
      source: "https://SEU_DOMINIO/api/connections/google/callback",
    },
  ];

  return (
    <div className="space-y-8">
      <header className="grid gap-5 xl:grid-cols-[1fr_440px] xl:items-end">
        <div>
          <p className="eyebrow mb-3">Ferramentas do sistema</p>
          <h1 className="max-w-3xl text-4xl font-black tracking-[-0.055em] sm:text-5xl">
            Diagnóstico técnico
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Consulte variáveis, estruturas e publicação. Um indicador verde confirma apenas a verificação descrita; não comprova uma integração completa.
          </p>
          <Link href="/setup" className="mt-4 inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4">Ver roteiro de configuração <ArrowRight size={14} /></Link>
        </div>

        <div
          className={`rounded-[24px] border p-5 ${
            foundationReady
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                foundationReady
                  ? "bg-emerald-600 text-white"
                  : "bg-amber-500 text-white"
              }`}
            >
              {foundationReady ? (
                <CheckCircle2 size={19} />
              ) : (
                <CircleAlert size={19} />
              )}
            </span>
            <div>
              <p className="text-sm font-black">
                {foundationReady ? "Base principal disponível" : "Revisar base principal"}
              </p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                {completedFoundations} de {basicFoundations.length} verificacoes
                concluidas nesta visita.
              </p>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/8">
            <div
              className={`h-full rounded-full ${
                foundationReady ? "bg-emerald-600" : "bg-amber-500"
              }`}
              style={{
                width: `${(completedFoundations / basicFoundations.length) * 100}%`,
              }}
            />
          </div>
        </div>
      </header>

      <section aria-labelledby="foundation-title">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Leitura automatica</p>
            <h2
              id="foundation-title"
              className="mt-2 text-2xl font-black tracking-[-0.04em]"
            >
              Fundacao da plataforma
            </h2>
          </div>
          <p className="hidden text-xs text-[var(--muted)] sm:block">
            Atualizado ao abrir esta pagina
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {foundationChecks.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.label} className="panel rounded-[22px] p-5">
                <div className="mb-7 flex items-center justify-between">
                  <div className="grid size-10 place-items-center rounded-xl bg-black/[0.045]">
                    <Icon size={18} />
                  </div>
                  <span
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${
                      item.ready
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {item.ready ? <Check size={12} /> : <CircleAlert size={12} />}
                    {item.ready ? "Disponível" : "Revisar"}
                  </span>
                </div>
                <h3 className="text-sm font-black">{item.label}</h3>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                  {item.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <details className="space-y-5 rounded-2xl border border-[var(--line)] p-5">
        <summary className="cursor-pointer text-sm font-black">Variáveis da hospedagem e instruções de configuração</summary>
      <section
        className="panel overflow-hidden rounded-[26px]"
        aria-labelledby="variables-title"
      >
        <div className="grid gap-5 border-b border-[var(--line)] p-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="eyebrow">Credenciais e variaveis</p>
            <h2
              id="variables-title"
              className="mt-2 text-2xl font-black tracking-[-0.04em]"
            >
              Valores esperados na Vercel
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--muted)]">
              Valores publicos podem ser copiados abaixo. Por seguranca, valores
              privados nunca sao mostrados, mesmo para um administrador.
            </p>
          </div>
          <a
            href="https://vercel.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-[var(--sidebar)] px-4 py-3 text-xs font-bold text-white transition hover:opacity-90"
          >
            Abrir painel da Vercel <ExternalLink size={14} />
          </a>
        </div>

        <div className="divide-y divide-[var(--line)]">
          {variables.map((variable) => {
            const needsAction = variable.required && !variable.ready;
            return (
              <article
                key={variable.name}
                className="grid gap-4 p-5 sm:p-6 xl:grid-cols-[minmax(260px,0.8fr)_minmax(320px,1.2fr)] xl:items-center"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${
                      variable.ready
                        ? "bg-emerald-100 text-emerald-700"
                        : needsAction
                          ? "bg-amber-100 text-amber-800"
                          : "bg-black/5 text-[var(--muted)]"
                    }`}
                  >
                    {variable.ready ? (
                      <Check size={14} />
                    ) : needsAction ? (
                      <CircleAlert size={14} />
                    ) : (
                      <Minus size={14} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="break-all text-xs font-black">{variable.name}</code>
                      <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-[var(--muted)]">
                        {variable.required ? "Obrigatoria" : "Opcional"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                      {variable.description}
                    </p>
                    <p className="mt-1 text-[10px] font-semibold text-[var(--muted)]">
                      Onde obter: {variable.source}
                    </p>
                  </div>
                </div>

                <div className="min-w-0 rounded-xl bg-[var(--sidebar)] p-3 text-white">
                  <div className="flex min-w-0 items-center gap-3">
                    <code className="min-w-0 flex-1 break-all text-[11px] leading-5 text-white/75">
                      {variable.ready
                        ? variable.secret
                          ? "Configurada com seguranca (valor oculto)"
                          : variable.value
                        : needsAction
                          ? "Ainda nao configurada neste ambiente"
                          : "Nao configurada (opcional)"}
                    </code>
                    {variable.ready && !variable.secret && variable.value ? (
                      <CopyEnvironmentValue name={variable.name} value={variable.value} />
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <article className="panel rounded-[26px] p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--signal)] text-[var(--sidebar)]">
              <Rocket size={19} />
            </span>
            <div>
              <p className="eyebrow">Passo a passo</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.04em]">
                Como corrigir um item amarelo
              </h2>
            </div>
          </div>

          <ol className="mt-7 space-y-5">
            {[
              {
                title: "Abra o projeto na Vercel",
                body: "Entre no painel, selecione a Central Genesis e abra Settings > Environment Variables.",
              },
              {
                title: "Crie somente as variaveis pendentes",
                body: "Use exatamente o nome exibido nesta pagina. Marque Production e Preview; marque Development se tambem usa o ambiente local da Vercel.",
              },
              {
                title: "Busque a chave secreta no Supabase",
                body: "Abra Settings > API Keys > Publishable and secret API keys. Copie ou crie uma sb_secret_ e salve somente como SUPABASE_SECRET_KEY.",
              },
              {
                title: "Salve e publique novamente",
                body: "Na Vercel, abra Deployments, selecione o ultimo deploy e use Redeploy. Variaveis NEXT_PUBLIC_ entram no aplicativo durante o build.",
              },
            ].map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--sidebar)] text-xs font-black text-white">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-black">{step.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <a
              href={`${supabaseDashboardUrl}/settings/api-keys`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-xs font-bold transition hover:border-black/20"
            >
              Abrir chaves do Supabase <ExternalLink size={14} />
            </a>
            <a
              href="https://supabase.com/docs/guides/getting-started/api-keys"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 py-3 text-xs font-bold transition hover:border-black/20"
            >
              Ler documentacao oficial <ExternalLink size={14} />
            </a>
          </div>
        </article>

        <aside className="rounded-[26px] bg-[var(--sidebar)] p-6 text-white">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-white/8 text-[var(--signal)]">
              <ShieldCheck size={18} />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/38">
                Regra de seguranca
              </p>
              <h2 className="mt-1 text-lg font-black">O que nunca deve ser enviado</h2>
            </div>
          </div>
          <div className="mt-6 space-y-4 text-xs leading-6 text-white/62">
            <p>
              Nunca cole uma <strong className="text-white">sb_secret_</strong>, token
              Meta, HOTTOK ou segredo Hubla em conversa, GitHub, planilha ou variavel
              iniciada por <strong className="text-white">NEXT_PUBLIC_</strong>.
            </p>
            <p>
              A publishable key comeca por{" "}
              <strong className="text-white">sb_publishable_</strong> e pode aparecer no
              navegador. Ela depende das politicas RLS para limitar o acesso aos dados.
            </p>
            <p>
              Se uma chave secreta for exposta, revogue-a no Supabase e gere outra antes
              de continuar.
            </p>
          </div>
        </aside>
      </section>

      </details>

      <details className="panel rounded-[26px] p-6">
        <summary className="cursor-pointer text-sm font-black">Estruturas do banco e migrations · {databaseChecks.filter((item) => item.ready).length}/{databaseRequirements.length} acessíveis</summary>
      <section className="mt-6" aria-labelledby="database-title">
        <div className="grid gap-5 border-b border-[var(--line)] pb-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="eyebrow">Banco de dados</p>
            <h2
              id="database-title"
              className="mt-2 text-2xl font-black tracking-[-0.04em]"
            >
              Estruturas consultadas nesta visita
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--muted)]">
              Esta verificacao consulta as tabelas e visoes realmente usadas pela aplicacao.
              Um item verde respondeu para o usuario atual; um item amarelo precisa ser
              investigado antes de confiar nos indicadores.
            </p>
          </div>
          <span
            className={`flex w-fit items-center gap-2 rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.08em] ${
              databaseReady
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {databaseReady ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
            {databaseReady ? "Estrutura operacional" : "Estrutura indisponivel"}
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {databaseChecks.map((item) => (
            <div
              key={item.table}
              className={`flex items-start gap-3 rounded-xl border p-4 ${
                item.ready
                  ? "border-emerald-200 bg-emerald-50/60"
                  : "border-amber-200 bg-amber-50/70"
              }`}
            >
              <span
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
                  item.ready
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-200 text-amber-900"
                }`}
              >
                {item.ready ? <Check size={12} /> : <CircleAlert size={12} />}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-black leading-5">{item.label}</p>
                <code className="block truncate text-[10px] text-[var(--muted)]">
                  {item.table}
                </code>
                {!item.ready && item.error && (
                  <p className="mt-1 text-[10px] leading-4 text-amber-900">{item.error}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 border-t border-[var(--line)] pt-6">
          <h3 className="text-sm font-black">Versoes esperadas no repositorio</h3>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--muted)]">
            Esta lista documenta a versao do codigo. Ela nao afirma, sozinha, que a migration
            foi aplicada no banco remoto; a confirmacao definitiva vem do historico de
            migrations do Supabase.
          </p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {migrations.map(([version, label]) => (
            <div
              key={version}
              className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-white/45 p-4"
            >
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">
                <Minus size={12} />
              </span>
              <div className="min-w-0">
                <code className="text-[10px] font-bold text-[var(--muted)]">{version}</code>
                <p className="mt-1 text-xs font-black leading-5">{label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-950">
          <ServerCog size={17} className="mt-0.5 shrink-0" />
          <p>
            Somente um desenvolvedor deve aplicar novas migrations. Confirme o historico com{" "}
            <code>supabase migration list</code>. Para uma nova versao, revise os arquivos,
            teste localmente, use{" "}
            <code>supabase db push --dry-run</code> e depois{" "}
            <code>supabase db push</code>.
          </p>
        </div>
      </section>

      </details>

      <details className="panel rounded-2xl p-6">
        <summary className="cursor-pointer text-sm font-black">Publicação das funções e atualização automática</summary>
        <p className="mt-4 max-w-3xl text-xs leading-6 text-[var(--muted)]">A consulta de tabelas não confirma que os receptores ou agendadores estão ativos. Confira estas configurações no projeto Supabase correto e uma execução com registros processados.</p>
        <ul className="mt-4 list-disc space-y-3 pl-4 text-xs leading-6 text-[var(--muted)]">
          <li>Publicar as funções <code>hubla-webhook</code>, <code>fetch-meta-data</code> e <code>payt-webhook</code> conforme as fontes utilizadas. Hotmart recebe eventos pela rota da aplicação.</li>
          <li>Google Forms: job <code>genesis-google-forms-sync</code>, destino da aplicação publicado e token dedicado no Vault. Configuração documentada em <code>docs/PROJECT-OPERATIONS.md</code>.</li>
          <li>Histórico Hotmart: ativar com <code>scripts/activate-hotmart-history.sql</code>. Meta: ativar com <code>scripts/activate-meta-sync.sql</code>. Conferir o domínio de destino antes da execução.</li>
          <li>Publicação automática do Supabase: segredos <code>SUPABASE_ACCESS_TOKEN</code> e <code>SUPABASE_DB_PASSWORD</code> no repositório. Sem eles, o fluxo de publicação pula as etapas do banco e das funções.</li>
          <li>Payt: receber um payload real, revisar e validar o contrato no painel da conexão antes de ativar o processamento. Recebimento de evento não significa venda processada.</li>
        </ul>
        <a href={supabaseDashboardUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs font-bold underline underline-offset-4">Abrir projeto no Supabase <ExternalLink size={14} /></a>
      </details>

      <section aria-labelledby="next-title">
        <p className="eyebrow">Depois da base tecnica</p>
        <h2 id="next-title" className="mt-2 text-2xl font-black tracking-[-0.04em]">
          Onde configurar cada tipo de dado
        </h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Link
            href="/integrations"
            className="group panel rounded-[22px] p-5 transition hover:-translate-y-0.5 hover:border-black/20"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-violet-100 text-violet-700">
              <PlugZap size={18} />
            </span>
            <h3 className="mt-6 text-sm font-black">Meta e plataformas de venda</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Tokens e conexoes de negocio sao cadastrados em Conexões, nao na
              Vercel. O sistema guarda cada segredo no cofre.
            </p>
            <span className="mt-5 flex items-center gap-2 text-xs font-black">
              Abrir Conexões{" "}
              <ArrowRight size={14} className="transition group-hover:translate-x-1" />
            </span>
          </Link>

          <Link
            href="/projects"
            className="group panel rounded-[22px] p-5 transition hover:-translate-y-0.5 hover:border-black/20"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
              <FileSpreadsheet size={18} />
            </span>
            <h3 className="mt-6 text-sm font-black">CSVs de trafego e vendas</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              No projeto, use Configurar → Importar CSV como alternativa para métricas diárias. Não substitui os eventos ou o histórico de transações.
            </p>
            <span className="mt-5 flex items-center gap-2 text-xs font-black">
              Abrir Projetos{" "}
              <ArrowRight size={14} className="transition group-hover:translate-x-1" />
            </span>
          </Link>

          <article className="panel rounded-[22px] p-5">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-100 text-amber-800">
              <Database size={18} />
            </span>
            <h3 className="mt-6 text-sm font-black">Supabase e migrations</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              Use as verificações acima para saber quais estruturas estão acessíveis. Publicação da Vercel não aplica migrations nem publica funções do Supabase.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
