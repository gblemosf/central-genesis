import type { IntegrationConnection, ProjectSummary } from "@/lib/domain";
import { isBaseAvailable, type DatabaseCheck } from "@/lib/configuration-catalog";
import type { WorkspaceView } from "@/lib/workspace-navigation";

export type SetupStatus = "available" | "pending" | "review" | "optional" | "unknown";
export const setupStatusLabels: Record<SetupStatus, string> = {
  available: "Disponível", pending: "Configurar", review: "Conferir", optional: "Opcional", unknown: "Não foi possível verificar",
};
export interface SetupStep {
  id: string; title: string; description: string; status: SetupStatus;
  tasks: string[]; evidence: string; action: string; href: string; projectView?: WorkspaceView;
}
export interface SetupSnapshot {
  databaseConfigured: boolean; serverConfigured: boolean; googleConfigured: boolean;
  demoMode: boolean; checks: DatabaseCheck[]; connections: IntegrationConnection[];
  projects: ProjectSummary[]; connectionsWarning?: string; projectsWarning?: string;
  formsCount?: number | null; latestMetaAutomaticAt?: string | null;
}

export function buildSetupGuide(snapshot: SetupSnapshot): SetupStep[] {
  const usable = snapshot.connections.filter((item) => item.status !== "revoked");
  const sales = usable.filter((item) => ["hotmart", "hubla", "payt"].includes(item.provider));
  const meta = usable.filter((item) => item.provider === "meta");
  const google = usable.filter((item) => item.provider === "google_forms");
  const projects = snapshot.projects.filter((item) => !item.legacy && item.status !== "archived");
  const mapped = projects.filter((item) => item.products > 0);
  const verified = (items: IntegrationConnection[]) => items.some((item) => item.status === "connected" && Boolean(item.lastVerifiedAt));
  const base = snapshot.databaseConfigured && snapshot.serverConfigured && isBaseAvailable(snapshot.checks);
  const paytAvailable = snapshot.checks.some((check) => check.module === "payt" && check.ready);
  const connectionStatus = (items: IntegrationConnection[], optional = false): SetupStatus => snapshot.connectionsWarning ? "unknown" : verified(items) ? "available" : items.length ? "review" : optional ? "optional" : "pending";
  const steps: SetupStep[] = [
    {
      id: "base", title: "Preparar o sistema", status: base ? "available" : "pending",
      description: "A aplicação e o banco precisam estar publicados no mesmo ambiente.",
      evidence: base ? "Variáveis básicas presentes e estrutura principal acessível para sua conta. As funções e os agendadores precisam de conferência separada." : "Há variáveis básicas ou estruturas do banco indisponíveis. Veja o diagnóstico técnico antes de cadastrar novas fontes.",
      tasks: ["Configurar URL e chave pública do Supabase, chave privada do servidor e desativar o modo de demonstração em produção.", "Aplicar as migrations necessárias aos módulos utilizados e publicar as funções Hubla, Meta e Payt correspondentes.", "Para publicação automática do banco, configurar SUPABASE_ACCESS_TOKEN e SUPABASE_DB_PASSWORD nos segredos do repositório. O deploy da Vercel publica somente a aplicação."],
      action: "Abrir diagnóstico técnico", href: "/settings",
    },
    {
      id: "sales", title: "Conectar a plataforma de vendas", status: connectionStatus(sales),
      description: "Cadastre uma conexão por conta de venda. Ela pode atender vários produtos e projetos.",
      evidence: snapshot.connectionsWarning ? "A consulta de conexões falhou; os cadastros existentes não foram considerados ausentes." : `${sales.length} conexão(ões) Hotmart, Hubla ou Payt cadastrada(s). Cadastro e validação de credenciais não confirmam recebimento de todas as vendas.${!paytAvailable ? " A estrutura Payt ainda está indisponível neste ambiente." : ""}`,
      tasks: ["Hotmart: cadastrar Client ID, Client Secret, Basic Token e HOTTOK; validar a conexão e sincronizar os produtos. A API busca histórico e o webhook recebe novas alterações.", "Hubla: cadastrar o token e copiar o endpoint geral. Configurar os eventos na Hubla e vincular os IDs dos produtos aos projetos.", "Payt: criar o endereço protegido, configurar o postback PayT V1 e enviar um evento real para validar o contrato antes de processar vendas. O sistema ainda não importa histórico da Payt pela API.", "Eduzz e Kiwify têm cadastro e catálogo; o recebimento de vendas ainda não está implementado neste projeto."],
      action: "Abrir conexões", href: "/integrations",
    },
    {
      id: "project", title: "Organizar os produtos no projeto", status: snapshot.projectsWarning ? "unknown" : mapped.length ? "review" : "pending",
      description: "Crie o projeto, selecione a conexão e associe cada produto à etapa do funil.",
      evidence: snapshot.projectsWarning ? "Não foi possível consultar todos os projetos. Confira o acesso antes de criar outro cadastro." : `${projects.length} projeto(s) atual(is); ${mapped.length} com produtos vinculados. Revise também a etapa de cada produto e a conta Meta.`,
      tasks: ["Selecionar produto principal, complementos, upsell ou downsell conforme sua operação. Não é necessário repetir o mesmo produto em vários papéis.", "Vincular a conta de anúncios correta; um vínculo errado mistura investimento de outra operação.", "Ativar o projeto quando quiser incluí-lo na Visão geral. Metas são opcionais e não substituem vendas recebidas."],
      action: "Vincular produtos", href: "/projects/new", projectView: "products",
    },
    {
      id: "meta", title: "Trazer o investimento e o tráfego", status: connectionStatus(meta, true),
      description: "Use a Meta se o projeto tiver anúncios. A receita vem da plataforma de vendas.",
      evidence: snapshot.connectionsWarning ? "Conexões não consultadas." : `${meta.length} conexão(ões) Meta. O token validado ainda precisa de uma conta vinculada e sincronização com registros no projeto.`,
      tasks: ["Cadastrar o token do usuário do sistema autorizado às contas de anúncios utilizadas e validar em Conexões.", "No projeto, selecionar a conta e executar a primeira sincronização. Confirmar gasto e datas em Divulgação → Tráfego diário.", "Conferir o agendador Meta no passo de atualização automática. Um projeto sem anúncios pode seguir sem esta fonte."],
      action: "Vincular conta Meta", href: "/integrations", projectView: "settings",
    },
    {
      id: "forms", title: "Conectar os formulários, se utilizados", status: snapshot.connectionsWarning ? "unknown" : google.length && !snapshot.googleConfigured ? "pending" : google.length && snapshot.formsCount === null ? "unknown" : google.length && snapshot.formsCount === 0 ? "review" : connectionStatus(google, true),
      description: "Autorize uma conta Google que tenha acesso aos formulários e às planilhas vinculadas.",
      evidence: `${snapshot.googleConfigured ? "Credenciais Google presentes neste ambiente." : "Credenciais Google indisponíveis neste ambiente."} ${google.length} conta(s) autorizada(s) cadastrada(s). ${snapshot.formsCount === null || snapshot.formsCount === undefined ? "Quantidade de formulários não verificada." : `${snapshot.formsCount} formulário(s) vinculado(s) na organização.`} Confira a validade da autorização e a primeira importação.`,
      tasks: ["No Google Cloud, habilitar Forms API e Sheets API, configurar a tela de consentimento e criar um cliente OAuth web.", "Salvar GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI na hospedagem. O retorno deve coincidir com /api/connections/google/callback no domínio publicado.", "Em Conexões, autorizar a conta Google. Se usar outra conta, compartilhar o formulário e a planilha vinculada com ela.", "No projeto, selecionar a conexão e vincular a URL de edição do formulário. Sincronizar e conferir as respostas em Público. As colunas acompanham as perguntas; a planilha vinculada permite consultar colunas manuais e fórmulas formatadas.", "Conferir o modo de publicação do OAuth: autorização em modo de teste pode exigir reconexão periódica. Acesso interno não dispensa a configuração da autorização."],
      action: "Conectar formulários ao projeto", href: "/integrations", projectView: "forms-setup",
    },
    {
      id: "automation", title: "Ativar histórico e atualização automática", status: "review",
      description: "O navegador pode ficar fechado quando os receptores e agendadores estão configurados.",
      evidence: `${snapshot.latestMetaAutomaticAt ? `Última sincronização automática Meta concluída: ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(snapshot.latestMetaAutomaticAt))}.` : "Nenhuma execução automática Meta concluída foi confirmada nesta consulta."} Esta tela não consulta o estado do Supabase Cron nem testa URLs externas. Confirme execução recente e processamento; a presença das tabelas não comprova automação ativa.`,
      tasks: ["Configurar os eventos Hotmart, Hubla e Payt nos respectivos painéis, usando os endereços do sistema e seus segredos próprios. Conferir entrega e processamento de um evento real.", "No Supabase, ativar os jobs Google Forms, histórico Hotmart e Meta com os tokens dedicados no Vault. Os scripts de ativação estão documentados no diagnóstico técnico.", "Para a carga inicial Hotmart, selecionar o produto e o intervalo em Vendas → Importar histórico Hotmart. Ela também consulta estados pendentes e cancelados disponíveis na API.", "Filtros de data consultam dados já recebidos; não iniciam importações. CSV diário é alternativa para métricas, sem histórico de transações, contatos ou UTMs.", "Validar a captura de página e UTMs nos links até o checkout. Um evento sem origem não permite descobrir retrospectivamente a página por suposição."],
      action: "Buscar histórico Hotmart", href: "/settings", projectView: "history",
    },
    {
      id: "finance", title: "Conferir os resultados e despesas externas", status: "optional",
      description: "Escolha período e produtos para analisar. Digite somente o que não vem das plataformas.",
      evidence: "Os painéis funcionam sem metas e projeções preenchidas. Custos externos e divisão contratual precisam da sua definição para compor o saldo.",
      tasks: ["Em Financeiro → Receita das vendas, comparar bruto, taxas, líquido após taxas e repasse ao produtor. Líquido após taxas e repasse ao produtor são valores diferentes.", "Em Cadastrar custos, informar despesas externas e regras contratuais. Os totais são do projeto e não têm rateio automático por período nem recorrência mensal.", "Usar Custos e saldo para consultar o resultado com despesas. Para produtos isolados, gastos sem divisão confiável não geram lucro ou ROAS por produto.", "Usar Configurar projeções somente para planejamento futuro; orçamento, presença e metas não são dados observados de venda."],
      action: "Revisar custos do projeto", href: "/projects", projectView: "costs",
    },
  ];
  return snapshot.demoMode ? steps.map((step) => ({ ...step, status: "unknown" as const, evidence: "Demonstração: os exemplos não verificam configuração, credenciais ou dados de produção." })) : steps;
}
