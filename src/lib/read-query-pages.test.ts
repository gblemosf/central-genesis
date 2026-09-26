import { expect, it, vi } from "vitest";
import { readQueryPages } from "./read-query-pages";

it("loads more than 1,000 metrics without dropping projects or dates", async () => {
  const rows = Array.from({ length: 1107 }, (_, id) => ({ id }));
  const fetch = vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, to + 1),
    error: null,
  }));
  expect((await readQueryPages(fetch)).data).toEqual(rows);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("never presents a partial total when a later page fails", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      data: Array(500).fill({ id: "row" }),
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
  expect(await readQueryPages(fetch)).toEqual({
    data: null,
    error: { message: "unavailable" },
  });
});
