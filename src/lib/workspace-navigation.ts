import {
  presetPeriod,
  validAnalysisPeriod,
  type AnalysisFilter,
} from "@/lib/analysis-filters";

export const workspaceSections = [
  { id: "summary", label: "Resumo", views: [["overview", "Visão do projeto"]] },
  {
    id: "sales",
    label: "Vendas",
    views: [
      ["sales", "Compras"],
      ["recovery", "Recuperação"],
    ],
  },
  {
    id: "marketing",
    label: "Tráfego e origens",
    views: [
      ["origins", "Origens e UTMs"],
      ["metrics", "Tráfego diário"],
    ],
  },
  {
    id: "audience",
    label: "Público",
    views: [
      ["contacts", "Contatos"],
      ["forms", "Respostas dos formulários"],
    ],
  },
  {
    id: "finance",
    label: "Financeiro",
    views: [
      ["results", "Receita das vendas"],
      ["financial", "Custos e saldo"],
      ["costs", "Cadastrar custos"],
      ["planning", "Projeções"],
    ],
  },
  {
    id: "sources",
    label: "Configurar",
    views: [
      ["settings", "Conexões e metas"],
      ["products", "Produtos e funil"],
      ["forms-setup", "Conectar formulários"],
      ["imports", "Importar CSV"],
      ["history", "Importar histórico Hotmart"],
      ["assumptions", "Configurar projeções"],
    ],
  },
] as const;

export type WorkspaceView =
  (typeof workspaceSections)[number]["views"][number][0];
export const metricViews = {
  metrics: "daily",
  financial: "financial",
  planning: "planning",
  imports: "data",
  costs: "costs",
  assumptions: "config",
} as const;
export type MetricView = (typeof metricViews)[keyof typeof metricViews];
export type WorkspaceSection = (typeof workspaceSections)[number]["id"];

export const workspaceDescriptions: Record<WorkspaceView, string> = {
  overview: "Acompanhe os indicadores do projeto. Escolha período e produtos para aprofundar a análise.",
  sales: "Consulte compras e valores por transação. O histórico anterior pode ser importado em Configurar.",
  recovery: "Acompanhe tentativas de compra e recuperações identificadas nos eventos recebidos.",
  history: "Escolha o produto e o período que deseja buscar na Hotmart. A consulta continua com a tela fechada quando o agendador está ativo.",
  origins: "Compare páginas, canais e UTMs das vendas. Informações não enviadas pela plataforma permanecem sem atribuição.",
  metrics: "Consulte investimento e tráfego por dia. Os gastos pertencem à conta vinculada ao projeto.",
  contacts: "Consulte os contatos identificados nas vendas, tentativas de compra e formulários recebidos.",
  forms: "Veja as respostas e as colunas da planilha vinculada ao formulário. As perguntas definem as colunas automaticamente.",
  results: "Confira bruto, taxas, líquido após taxas e repasse ao produtor. Estes valores ainda não descontam mídia e despesas externas.",
  financial: "Confira os valores consolidados com investimento em mídia e custos cadastrados. Revise a base da receita antes de comparar com Receita das vendas.",
  costs: "Informe somente despesas externas e regras do contrato. As taxas de venda recebidas da plataforma aparecem em Receita das vendas.",
  planning: "Explore cenários futuros usando produtos e dados de referência. Projeções não alteram o resultado realizado.",
  assumptions: "Escolha os produtos de referência e defina orçamento e metas. Preços e quantidades calculáveis usam os dados recebidos.",
  settings: "Vincule a conta Meta, revise o estado do projeto e defina metas opcionais. Credenciais são cadastradas em Conexões no menu principal.",
  products: "Vincule cada produto de venda ao projeto e à etapa do funil. Esse vínculo determina onde as compras aparecem.",
  "forms-setup": "Vincule os formulários após autorizar a conta Google em Conexões. Confira o acesso à planilha vinculada separadamente.",
  imports: "Use CSV como alternativa para dados diários indisponíveis nas integrações. Esta importação não recria transações, UTMs ou tentativas de compra.",
};

export function getWorkspaceSection(view: WorkspaceView) {
  return workspaceSections.find((section) => section.views.some(([candidate]) => candidate === view))!;
}

export function sectionDestination(section: WorkspaceSection, current: WorkspaceView, remembered?: WorkspaceView): WorkspaceView {
  const destination = workspaceSections.find((item) => item.id === section)!;
  if (destination.views.some(([view]) => view === current)) return current;
  if (remembered && destination.views.some(([view]) => view === remembered)) return remembered;
  return destination.views[0][0];
}
export function isWorkspaceView(value: string | null): value is WorkspaceView {
  return workspaceSections.some((section) =>
    section.views.some(([view]) => view === value),
  );
}
export function readWorkspaceLocation(
  params: URLSearchParams,
  today: string,
): { tab: WorkspaceView; filter: AnalysisFilter } {
  const view = params.get("view");
  const start = params.get("start") ?? "",
    end = params.get("end") ?? "";
  return {
    tab: isWorkspaceView(view) ? view : "overview",
    filter: {
      ...(validAnalysisPeriod(start, end)
        ? { start, end }
        : presetPeriod("30", today)),
      // An empty selection is different from all products. Unknown IDs must not expand the scope.
      productIds: params.has("products")
        ? [...new Set(params.get("products")!.split(",").filter(Boolean))]
        : null,
    },
  };
}
export function workspaceQuery(
  params: URLSearchParams,
  tab: WorkspaceView,
  filter: AnalysisFilter,
) {
  const next = new URLSearchParams(params);
  next.set("view", tab);
  next.set("start", filter.start);
  next.set("end", filter.end);
  if (filter.productIds === null) next.delete("products");
  else next.set("products", filter.productIds.join(","));
  return next.toString();
}
