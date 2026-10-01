// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProjectNavigation } from "./project-navigation";
import type { WorkspaceView } from "@/lib/workspace-navigation";

afterEach(cleanup);
it("keeps the active subview and returns to the last visited subview of an area", () => {
  function Demo() {
    const [value, onChange] = useState<WorkspaceView>("costs");
    return <><ProjectNavigation value={value} onChange={onChange} /><output>{value}</output></>;
  }
  render(<Demo />);
  fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
  expect(screen.getByRole("status").textContent).toBe("costs");
  fireEvent.click(screen.getByRole("button", { name: /^Vendas$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Recuperação" }));
  fireEvent.click(screen.getByRole("button", { name: "Financeiro" }));
  expect(screen.getByRole("status").textContent).toBe("costs");
  fireEvent.click(screen.getByRole("button", { name: /^Vendas$/ }));
  expect(screen.getByRole("status").textContent).toBe("recovery");
});
