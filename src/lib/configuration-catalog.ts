// Code requirements, not a claim that migrations have been applied remotely.
export const migrations = [
  ["20260727201149", "Estrutura inicial e segurança"],
  ["20260727201637", "Proteção das funções legadas"],
  ["20260802083509", "Catálogo de projetos e integrações"],
  ["20260802094346", "Cadastro editável dos projetos"],
  ["20260802131909", "Recebimento de vendas Hubla"],
  ["20260802211421", "Importação dos CSVs de métricas"],
  ["20260803171244", "Proteção dos eventos e reembolsos Hubla"],
  ["20260803201504", "Exclusão segura de projetos"],
  ["20260803210305", "Proteção do histórico de projetos excluídos"],
  ["20260804075737", "Exclusão segura dos projetos legados"],
  ["20260804143613", "Provedor Google Forms"],
  ["20260804143631", "Formulários, contatos e UTMs"],
  ["20260804191134", "Ajustes do Google Forms"],
  ["20260811123241", "Importação diária por CSV"],
  ["20260911163137", "Recuperação de checkout Hubla"],
  ["20260911170021", "Endpoint geral Hubla"],
  ["20260913010155", "Compras, contatos e resultados"],
  ["20260913014322", "Autenticação do agendador Google Forms"],
  ["20260913112444", "Histórico Hotmart pela API"],
  ["20260913133708", "Sincronização automática Meta"],
  ["20261001150616", "Provedor Payt"],
  ["20261001150854", "Recebimento e processamento Payt"],
] as const;

export const databaseRequirements = [
  { table: "projects", column: "id", label: "Projetos", module: "base" },
  { table: "funnel_stages", column: "id", label: "Etapas de funil", module: "base" },
  { table: "integration_connections", column: "id", label: "Conexões", module: "base" },
  { table: "sales_events", column: "id", label: "Eventos de venda", module: "base" },
  { table: "project_daily_metrics", column: "project_id", label: "Métricas consolidadas", module: "base" },
  { table: "traffic_metrics_daily", column: "id", label: "Tráfego Meta", module: "meta" },
  { table: "hubla_webhook_events", column: "id", label: "Webhooks Hubla", module: "hubla" },
  { table: "payt_webhook_receipts", column: "id", label: "Postbacks Payt", module: "payt" },
  { table: "checkout_recovery_attempts", column: "id", label: "Recuperação de checkout", module: "sales" },
  { table: "hotmart_import_jobs", column: "id", label: "Fila de histórico Hotmart", module: "hotmart" },
  { table: "sync_runs", column: "id", label: "Registro de sincronizações", module: "jobs" },
  { table: "project_csv_daily_metrics", column: "project_id", label: "Métricas CSV", module: "csv" },
  { table: "metric_imports", column: "id", label: "Histórico de importações", module: "csv" },
  { table: "metricas_trafego", column: "organization_id", label: "Compatibilidade de tráfego", module: "legacy" },
  { table: "metricas_vendas", column: "organization_id", label: "Compatibilidade de vendas", module: "legacy" },
  { table: "google_forms", column: "id", label: "Google Forms", module: "google" },
  { table: "project_form_analytics", column: "project_id", label: "Análise de formulários", module: "google" },
] as const;

export interface DatabaseCheck { table: string; label: string; module: string; ready: boolean; error: string }

export function isBaseAvailable(checks: DatabaseCheck[]) {
  const base = checks.filter((item) => item.module === "base");
  return base.length > 0 && base.every((item) => item.ready);
}
