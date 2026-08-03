import { describe, expect, it } from "vitest";
import { projectSlug } from "@/lib/project-slug";

describe("projectSlug", () => {
  it("normaliza o nome completo do projeto", () => {
    expect(projectSlug("Projetos Digitais")).toBe("projetos-digitais");
    expect(projectSlug("Imersao Arquitetura das Cores")).toBe(
      "imersao-arquitetura-das-cores",
    );
  });
});
