export interface FormColumn {
  id: string;
  externalId: string;
  title: string;
  type: string;
  position: number;
  archived: boolean;
}
export interface FormTableRow {
  id: string;
  submittedAt: string;
  email: string;
  contactId: string | null;
  matchStatus: string;
  answers: Record<string, { value: unknown; title: string }>;
}
export interface FormTableData {
  columns: FormColumn[];
  rows: FormTableRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function answerText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(answerText).join("; ");
  if (typeof value === "object") {
    const file = value as Record<string, unknown>;
    if (typeof file.fileName === "string") return file.fileName;
    if (typeof file.value === "string") return file.value;
    return JSON.stringify(value);
  }
  return String(value);
}
