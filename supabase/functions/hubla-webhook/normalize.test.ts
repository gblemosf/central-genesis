import { describe, expect, it } from "vitest";
import { normalizeHublaWebhookPayload } from "./normalize";

describe("Hubla webhook normalization", () => {
  it("preserva recuperacao e atribuicao do checkout abandonado", () => {
    const result = normalizeHublaWebhookPayload({
      type: "lead.abandoned_checkout",
      version: "2.0.0",
      event: {
        products: [{
          id: "product-test",
          name: "Produto de teste",
          offers: [{ id: "offer-test", name: "Oferta de teste" }],
        }],
        lead: {
          id: "lead-test",
          fullName: "Pessoa de teste",
          email: "PESSOA@EXAMPLE.INVALID",
          phone: "+5511999999999",
          currency: "BRL",
          amount: { totalCents: 36_864 },
          createdAt: "2026-09-11T02:41:21.188Z",
          session: {
            url: "https://pay.hub.la/offer-test?utm_source=FB&utm_id=campaign-id&src=session-source",
            utm: {
              source: "FB",
              medium: "Conjunto de teste",
              campaign: "Campanha de teste",
              content: "Criativo de teste",
              term: "Feed",
            },
            cookies: { hbId: "hubla-session-test", fbclid: "click-test" },
          },
        },
      },
    });

    expect(result).toMatchObject({
      value: {
        type: "lead.abandoned_checkout",
        entityId: "lead-test",
        productExternalId: "product-test",
        grossAmount: 368.64,
        netAmount: 368.64,
        currency: "BRL",
        payload: {
          offer: { id: "offer-test" },
          contact: {
            name: "Pessoa de teste",
            email: "pessoa@example.invalid",
            phone: "+5511999999999",
          },
          attribution: {
            landing_url: expect.stringContaining("https://pay.hub.la/offer-test"),
            utm: {
              source: "FB",
              medium: "Conjunto de teste",
              campaign: "Campanha de teste",
              content: "Criativo de teste",
              term: "Feed",
              id: "campaign-id",
            },
            identifiers: {
              hb_id: "hubla-session-test",
              fbclid: "click-test",
              src: "session-source",
            },
          },
        },
      },
    });
  });

  it("normaliza atualizacao de fatura pendente com valor liquido do vendedor", () => {
    const result = normalizeHublaWebhookPayload({
      type: "invoice.status_updated",
      version: "2.0.0",
      event: {
        products: [{ id: "product-test", name: "Produto de teste" }],
        invoice: {
          id: "invoice-test",
          version: 2,
          status: "unpaid",
          currency: "BRL",
          modifiedAt: "2026-09-11T03:00:00.000Z",
          amount: { totalCents: 29_700 },
          receivers: [
            { role: "platform", totalCents: 2_000 },
            { role: "seller", totalCents: 27_700 },
          ],
          paymentSession: {
            url: "https://pay.hub.la/offer-test?utm_source=meta",
            utm: { source: "meta", campaign: "campanha-teste" },
          },
        },
        user: {
          id: "user-test",
          firstName: "Pessoa",
          lastName: "Teste",
          email: "pessoa@example.invalid",
        },
      },
    });

    expect(result).toMatchObject({
      value: {
        entityId: "invoice-test",
        grossAmount: 297,
        netAmount: 277,
        payload: {
          status: "unpaid",
          contact: { external_id: "user-test", name: "Pessoa Teste" },
          attribution: { utm: { source: "meta", campaign: "campanha-teste" } },
        },
      },
    });
  });

  it("aceita remocao de membro e usa a assinatura como entidade estavel", () => {
    const result = normalizeHublaWebhookPayload({
      type: "customer.member_removed",
      version: "2.0.0",
      event: {
        product: { id: "product-test", name: "Produto de teste" },
        subscription: {
          id: "subscription-test",
          version: 4,
          status: "inactive",
          modifiedAt: "2026-09-11T04:00:00.000Z",
          lastInvoice: {
            currency: "BRL",
            amount: { totalCents: 29_700 },
          },
        },
        user: {
          id: "user-test",
          firstName: "Pessoa",
          lastName: "Teste",
          email: "pessoa@example.invalid",
        },
      },
    });

    expect(result).toMatchObject({
      value: {
        type: "customer.member_removed",
        entityId: "subscription-test",
        entityVersion: 4,
        grossAmount: 297,
        payload: {
          status: "inactive",
          contact: { external_id: "user-test" },
        },
      },
    });
  });
});
