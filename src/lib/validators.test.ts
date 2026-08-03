import { describe, expect, it } from "vitest";
import {
  connectionInputSchema,
  connectionUpdateInputSchema,
  connectionWithCredentialInputSchema,
  credentialInputSchema,
  funnelStageInputSchema,
  funnelStageOrderInputSchema,
  projectInputSchema,
  projectMetricConfigInputSchema,
  projectProductInputSchema,
  projectUpdateInputSchema,
} from "@/lib/validators";
import { defaultProjectMetricConfig } from "@/lib/project-metrics";

describe("projectInputSchema", () => {
  const salesConnectionId = "00000000-0000-4000-8000-000000000010";
  const funnel = [
    { name: "Produto core", type: "core", color: null, productId: null },
  ];

  it("aceita um projeto valido", () => {
    expect(
      projectInputSchema.safeParse({
        name: "Projeto Teste",
        slug: "projeto-teste",
        expertName: "Expert Teste",
        expertEmail: null,
        salesProvider: "hotmart",
        salesConnectionId,
        funnel,
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
        salesConnectionId,
        funnel,
        monthlyTarget: 100000,
        marginTarget: 65,
      }).success,
    ).toBe(false);
  });

  it("aceita as plataformas de venda suportadas", () => {
    expect(
      projectInputSchema.safeParse({
        name: "Projeto Teste",
        slug: "projeto-teste",
        expertName: "Expert Teste",
        salesProvider: "eduzz",
        salesConnectionId,
        funnel,
        monthlyTarget: 100000,
        marginTarget: 65,
      }).success,
    ).toBe(true);
  });

  it("exige conexao e conta Meta em conjunto", () => {
    expect(
      projectInputSchema.safeParse({
        name: "Projeto Teste",
        slug: "projeto-teste",
        expertName: "Expert Teste",
        salesProvider: "hotmart",
        salesConnectionId,
        funnel,
        metaConnectionId: "00000000-0000-0000-0000-000000000001",
        monthlyTarget: 100000,
        marginTarget: 65,
      }).success,
    ).toBe(false);
  });
});

describe("projectUpdateInputSchema", () => {
  it("valida metas e ativacao do projeto", () => {
    expect(
      projectUpdateInputSchema.safeParse({
        monthlyTarget: 250000,
        marginTarget: 55,
        status: "active",
      }).success,
    ).toBe(true);
    expect(
      projectUpdateInputSchema.safeParse({
        monthlyTarget: -1,
        marginTarget: 101,
        status: "active",
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

  it("aceita conexoes Kiwify", () => {
    expect(
      connectionInputSchema.safeParse({
        name: "Kiwify",
        provider: "kiwify",
      }).success,
    ).toBe(true);
  });

  it("aceita edicao sem exigir uma nova credencial", () => {
    expect(
      connectionUpdateInputSchema.safeParse({
        name: "Genesis BM principal",
        businessId: "123",
        appId: "456",
        systemUserId: "789",
      }).success,
    ).toBe(true);
  });

  it("valida a nova credencial quando ela for informada", () => {
    expect(
      connectionUpdateInputSchema.safeParse({
        name: "Genesis BM principal",
        credentials: { clientSecret: "short" },
      }).success,
    ).toBe(false);
  });
});

describe("catalog schemas", () => {
  it("valida etapas e uma ordem sem duplicatas", () => {
    expect(
      funnelStageInputSchema.safeParse({
        name: "Order bump 2",
        type: "order_bump",
        color: "#61d6c8",
      }).success,
    ).toBe(true);
    expect(
      funnelStageOrderInputSchema.safeParse({
        stageIds: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000001",
        ],
      }).success,
    ).toBe(false);
  });

  it("aceita produto manual mapeado", () => {
    expect(
      projectProductInputSchema.safeParse({
        connectionId: null,
        externalId: "manual-produto-core",
        name: "Produto core",
        price: 97,
        currency: "BRL",
        funnelStageId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
  });
});

describe("credentialInputSchema", () => {
  it("nao aceita credencial vazia ou curta", () => {
    expect(
      credentialInputSchema.safeParse({ credentials: { accessToken: "short" } }).success,
    ).toBe(false);
  });

  it("exige o conjunto de credenciais de cada plataforma", () => {
    expect(
      connectionWithCredentialInputSchema.safeParse({
        name: "Hotmart principal",
        provider: "hotmart",
        credentials: {
          clientId: "client-id",
          clientSecret: "client-secret",
          basicToken: "basic-token",
          hottok: "webhook-token",
        },
      }).success,
    ).toBe(true);
    expect(
      connectionWithCredentialInputSchema.safeParse({
        name: "Kiwify principal",
        provider: "kiwify",
        credentials: { clientId: "client-id", clientSecret: "client-secret" },
      }).success,
    ).toBe(false);
  });
});

describe("projectMetricConfigInputSchema", () => {
  it("aceita os parametros financeiros de um projeto", () => {
    expect(
      projectMetricConfigInputSchema.safeParse(
        defaultProjectMetricConfig("2026-07-31"),
      ).success,
    ).toBe(true);
  });

  it("rejeita periodo invertido e taxa invalida", () => {
    expect(
      projectMetricConfigInputSchema.safeParse({
        ...defaultProjectMetricConfig("2026-07-31"),
        periodStart: "2026-08-01",
        periodEnd: "2026-07-01",
        trafficFeePercent: 101,
      }).success,
    ).toBe(false);
  });

  it("nao permite reutilizar o mesmo produto em dois papeis", () => {
    const productId = "00000000-0000-0000-0000-000000000001";
    expect(
      projectMetricConfigInputSchema.safeParse({
        ...defaultProjectMetricConfig("2026-07-31"),
        ticketProductId: productId,
        formationProductId: productId,
      }).success,
    ).toBe(false);
  });
});
