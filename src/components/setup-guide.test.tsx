// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SetupGuide } from "./setup-guide";
import type { SetupStep } from "@/lib/setup-guide";

afterEach(cleanup);
const step: SetupStep = { id: "products", title: "Organizar produtos", description: "Vincular produtos", status: "review", tasks: [], evidence: "Conferir vínculos", action: "Vincular produtos", href: "/projects/new", projectView: "products" };
it("opens project tasks for the selected project rather than the first project", () => {
  render(<SetupGuide steps={[step]} projects={[{ id: "a", name: "Alpha", expertName: "A" }, { id: "b", name: "Beta", expertName: "B" }]} demoMode={false} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
  expect(screen.getAllByRole("link", { name: "Vincular produtos" }).every((link) => link.getAttribute("href") === "/projects/b?view=products")).toBe(true);
});
it("routes project setup to creation when no current project is available", () => {
  render(<SetupGuide steps={[step]} projects={[]} demoMode={false} />);
  expect(screen.getAllByRole("link", { name: "Vincular produtos" }).every((link) => link.getAttribute("href") === "/projects/new")).toBe(true);
});
