// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { AnalysisFilters } from "./analysis-filters";
import type { AnalysisFilter } from "@/lib/analysis-filters";
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("selects one/multiple/no products with checkboxes without treating none as all", () => {
  function Demo() {
    const [value, onChange] = useState<AnalysisFilter>({ start: "2026-09-01", end: "2026-09-13", productIds: null });
    return <AnalysisFilters value={value} onChange={onChange} products={[{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]} />;
  }
  render(<Demo />);
  fireEvent.click(screen.getByText("Todos os produtos"));
  fireEvent.click(screen.getByLabelText("Beta"));
  expect(screen.getByText("1 produto(s) selecionado(s)")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Alpha"));
  expect(screen.getByText("0 produto(s) selecionado(s)")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Alpha"));
  fireEvent.click(screen.getByLabelText("Beta"));
  expect(screen.getByText("2 produto(s) selecionado(s)")).toBeTruthy();
  fireEvent.click(screen.getByText("Selecionar todos"));
  expect(screen.getByText("Todos os produtos")).toBeTruthy();
});
it("applies inclusive presets in one click and requires valid custom dates", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
  const onChange = vi.fn();
  render(<AnalysisFilters value={{ start: "2026-09-01", end: "2026-09-13", productIds: ["a"] }} onChange={onChange} products={[]} />);
  fireEvent.click(screen.getByText("7 dias"));
  expect(onChange).toHaveBeenLastCalledWith({ start: "2026-09-07", end: "2026-09-13", productIds: ["a"] });
  fireEvent.click(screen.getByText("Período personalizado"));
  fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
  expect((screen.getByText("Aplicar período") as HTMLButtonElement).disabled).toBe(true);
});
