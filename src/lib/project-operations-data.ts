import "server-only";
import { ApiError, type AdminContext } from "@/lib/api-auth";
import { record, text } from "@/lib/sales-attribution";
import {
  recoveryFromRecord,
  saleFromRecord,
  saleRowsFromRecord,
  type ProjectOperations,
} from "@/lib/project-operations";

// Explicit pagination avoids PostgREST's default 1,000-row truncation.
export async function readAllRows(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from <= 50_000; from += 500) {
    const { data, error } = await fetchPage(from, from + 499);
    if (error)
      throw new ApiError("Não foi possível carregar os dados do projeto.", 503);
    if (!data?.length) return rows;
    rows.push(...data.map(record));
    if (rows.length > 50_000)
      throw new ApiError(
        "Há muitos registros. Selecione um período menor para consultar os dados completos.",
        422,
      );
    if (data.length < 500) return rows;
  }
  return rows;
}

export async function loadProjectOperations(
  context: AdminContext,
  projectId: string,
  start: string,
  end: string,
): Promise<ProjectOperations> {
  const { supabase, organizationId } = context;
  const scoped = (table: string, columns: string) =>
    supabase
      .from(table)
      .select(columns)
      .eq("organization_id", organizationId)
      .eq("project_id", projectId);
  const [sales, contacts, recovery, project, history] = await Promise.all([
    readAllRows((from, to) =>
      scoped(
        "sales_events",
        "id,connection_id,external_event_id,external_transaction_id,event_type,event_at,created_at,gross_amount,net_amount,currency,payload,contact_id,contacts(name,email,phone),integration_connections(provider),sales_event_items(product_id,gross_amount,net_amount,product_name_snapshot,stage_type_snapshot,products(external_id))",
      )
        .gte("event_at", `${start}T00:00:00-03:00`)
        .lt("event_at", `${end}T00:00:00-03:00`)
        .in("event_type", [
          "PURCHASE_APPROVED",
          "PURCHASE_COMPLETED",
          "PURCHASE_REFUNDED",
        ])
        .order("event_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    readAllRows((from, to) =>
      scoped(
        "contacts",
        "id,name,email,phone,source,created_at,first_seen_at,last_seen_at",
      )
        .is("archived_at", null)
        .order("last_seen_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    readAllRows((from, to) =>
      scoped(
        "checkout_recovery_attempts",
        "id,product_id,contact_id,status,amount,currency,checkout_url,last_seen_at,metadata,contacts(name,email,phone),utm_campaigns(utm_source,utm_campaign),products(name),integration_connections(provider)",
      )
        .gte("last_seen_at", `${start}T00:00:00-03:00`)
        .lt("last_seen_at", `${end}T00:00:00-03:00`)
        .order("last_seen_at", { ascending: false })
        .order("id")
        .range(from, to),
    ),
    supabase
      .from("projects")
      .select("currency")
      .eq("id", projectId)
      .eq("organization_id", organizationId)
      .single(),
    readAllRows((from, to) =>
      scoped("hotmart_history_records", "*")
        .in("purchase_status", ["REFUNDED", "CHARGEBACK", "PARTIALLY_REFUNDED"])
        .order("id")
        .range(from, to),
    ),
  ]);
  if (project.error)
    throw new ApiError("Não foi possível consultar a moeda do projeto.", 503);
  const saleRows = sales.flatMap(saleRowsFromRecord);
  const key = (connection: string, transaction: string) =>
    `${connection}:${transaction}`;
  const actualRefunds = new Set(
    saleRows
      .filter((row) => row.status === "refunded")
      .map((row) => key(row.connectionId, row.transaction)),
  );
  for (const snapshot of history) {
    const transactionKey = key(
      text(snapshot.connection_id),
      text(snapshot.transaction_id),
    );
    if (actualRefunds.has(transactionKey)) continue;
    let sale = saleRows.find(
      (row) => key(row.connectionId, row.transaction) === transactionKey,
    );
    if (!sale) {
      const occurredAt = text(snapshot.approved_at || snapshot.ordered_at);
      if (
        new Date(occurredAt).getTime() <
          new Date(`${start}T00:00:00-03:00`).getTime() ||
        new Date(occurredAt).getTime() >=
          new Date(`${end}T00:00:00-03:00`).getTime()
      )
        continue;
      sale = saleFromRecord({
        ...snapshot,
        external_transaction_id: snapshot.transaction_id,
        event_at: occurredAt,
        created_at: snapshot.observed_at,
        event_type: "PURCHASE_APPROVED",
        integration_connections: { provider: "hotmart" },
      });
      saleRows.push(sale);
    }
    sale.status =
      snapshot.purchase_status === "PARTIALLY_REFUNDED"
        ? "partial_refund"
        : "reversed";
  }
  return {
    sales: saleRows,
    recovery: recovery.map(recoveryFromRecord),
    contacts: contacts.map((row) => ({
      id: text(row.id),
      name: text(row.name),
      email: text(row.email),
      phone: text(row.phone),
      source: text(row.source),
      createdAt: text(row.first_seen_at || row.created_at),
      lastSeenAt: text(row.last_seen_at),
    })),
    currency: project.data.currency,
    loadedAt: new Date().toISOString(),
  };
}
