import { describe, expect, it } from "vitest";
import {
  connectionInputSchema,
  credentialInputSchema,
  projectInputSchema,
} from "@/lib/validators";

describe("projectInputSchema", () => {
  it("aceita um projeto valido", () => {
    expect(
      projectInputSchema.safeParse({
        name: "Projeto Teste",
        slug: "projeto-teste",
        expertName: "Expert Teste",
        expertEmail: null,
        salesProvider: "hotmart",
        monthlyTarget: 100000,
        marginTarget: 65,
      }).success,
    ).toBe(true);
  });

  it("rejeita slug e provedor invalidos", () => {
    expect(
      projectInputSchema.safeParse({
        name: "Projeto Teste",
        slug: "Projeto com espacos",
        expertName: "Expert Teste",
        salesProvider: "meta",
        monthlyTarget: 100000,
        marginTarget: 65,
      }).success,
    ).toBe(false);
  });

  it("exige conexao e conta Meta em conjunto", () => {
    expect(
      projectInputSchema.safeParse({
        name: "Projeto Teste",
        slug: "projeto-teste",
        expertName: "Expert Teste",
        salesProvider: "hotmart",
        metaConnectionId: "00000000-0000-0000-0000-000000000001",
        monthlyTarget: 100000,
        marginTarget: 65,
      }).success,
    ).toBe(false);
  });
});

describe("connectionInputSchema", () => {
  it("aceita conexoes Meta independentes por BM", () => {
    expect(
      connectionInputSchema.safeParse({
        name: "Genesis BM 2",
        provider: "meta",
        businessId: "123",
        appId: "456",
        systemUserId: "789",
      }).success,
    ).toBe(true);
  });
});

describe("credentialInputSchema", () => {
  it("nao aceita credencial vazia ou curta", () => {
    expect(credentialInputSchema.safeParse({ credential: "short" }).success).toBe(
      false,
    );
  });
});
