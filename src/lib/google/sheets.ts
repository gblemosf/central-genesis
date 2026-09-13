import "server-only";
import { ApiError } from "@/lib/api-auth";

export interface SheetTable {
  title: string;
  tabs: { id: number; title: string }[];
  sheetId: number;
  headers: string[];
  rows: { rowNumber: number; values: string[] }[];
  page: number;
  hasMore: boolean;
  loadedAt: string;
}

async function read<T>(url: URL, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new ApiError(
      response.status === 403
        ? "Autorize a leitura de planilhas na conexão Google e confira o acesso à planilha vinculada."
        : "Não foi possível consultar a planilha vinculada no Google.",
      422,
    );
  return response.json();
}

export function sheetColumn(index: number) {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}

export async function fetchLinkedSheet(
  spreadsheetId: string,
  accessToken: string,
  selectedTab?: number,
  page = 1,
): Promise<SheetTable> {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const metadataUrl = new URL(base);
  metadataUrl.searchParams.set(
    "fields",
    "properties(title),sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)))",
  );
  const metadata = await read<{
    properties: { title: string };
    sheets: {
      properties: {
        sheetId: number;
        title: string;
        sheetType: string;
        gridProperties?: { rowCount: number; columnCount: number };
      };
    }[];
  }>(metadataUrl, accessToken);
  const tabs = metadata.sheets
    .map((sheet) => sheet.properties)
    .filter((sheet) => sheet.sheetType === "GRID");
  const tab =
    selectedTab === undefined
      ? tabs[0]
      : tabs.find((tab) => tab.sheetId === selectedTab);
  if (!tab?.gridProperties)
    throw new ApiError("Aba não encontrada na planilha vinculada.", 404);
  const quotedName = `'${tab.title.replaceAll("'", "''")}'`;
  const lastColumn = sheetColumn(tab.gridProperties.columnCount - 1);
  const firstRow = 2 + (page - 1) * 100;
  const lastRow = Math.min(firstRow + 99, tab.gridProperties.rowCount);
  const url = new URL(`${base}/values:batchGet`);
  url.searchParams.append("ranges", `${quotedName}!A1:${lastColumn}1`);
  if (firstRow <= lastRow)
    url.searchParams.append(
      "ranges",
      `${quotedName}!A${firstRow}:${lastColumn}${lastRow}`,
    );
  // Formula results, dates and currencies use the same displayed values as Sheets.
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const data = await read<{ valueRanges?: { values?: unknown[][] }[] }>(
    url,
    accessToken,
  );
  const header = data.valueRanges?.[0]?.values?.[0] ?? [];
  const values = data.valueRanges?.[1]?.values ?? [];
  const width = Math.max(header.length, ...values.map((row) => row.length), 0);
  return {
    title: metadata.properties.title,
    tabs: tabs.map((tab) => ({ id: tab.sheetId, title: tab.title })),
    sheetId: tab.sheetId,
    headers: Array.from({ length: width }, (_, index) =>
      String(header[index] ?? ""),
    ),
    rows: values.map((row, index) => ({
      rowNumber: firstRow + index,
      values: Array.from({ length: width }, (_, column) =>
        String(row[column] ?? ""),
      ),
    })),
    page,
    hasMore: lastRow < tab.gridProperties.rowCount,
    loadedAt: new Date().toISOString(),
  };
}
