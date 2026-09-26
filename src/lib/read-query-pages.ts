// Preserve the query's row type and error contract while avoiding silent row limits.
export async function readQueryPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = [];
  for (let from = 0; from <= 50_000; from += 500) {
    const { data, error } = await fetchPage(from, from + 499);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (rows.length > 50_000)
      return {
        data: null,
        error: {
          message:
            "Selecione um período menor para consultar todos os indicadores.",
        },
      };
    if (!data || data.length < 500) return { data: rows, error: null };
  }
  return { data: null, error: { message: "Limite de consulta atingido." } };
}
