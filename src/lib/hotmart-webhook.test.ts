import { describe, expect, it } from "vitest";
import {
  normalizeHotmartWebhookEvent,
  parseHotmartWebhookPayload,
} from "@/lib/hotmart-webhook";

function realShapeFixture(
  event: "PURCHASE_APPROVED" | "PURCHASE_COMPLETE",
  withAttribution: boolean,
) {
  return {
    id: `event-${event.toLowerCase()}`,
    creation_date: 1_788_674_309_438,
    event,
    version: "2.0.0",
    data: {
      product: {
        id: 1_234_567,
        ucode: "00000000-0000-4000-8000-000000000001",
        name: "Produto de teste",
        has_co_production: true,
      },
      commissions: [
        { currency_value: "BRL", source: "MARKETPLACE", value: 10 },
        { currency_value: "BRL", source: "PRODUCER", value: 70 },
      ],
      purchase: {
        origin: withAttribution
          ? { xcod: "pagina-teste", sck: "meta-ads|campanha|conjunto|anuncio" }
          : { sck: "instagram|organic|bio" },
        approved_date: 1_788_674_299_000,
        order_date: 1_788_674_143_000,
        transaction: `transaction-${event.toLowerCase()}`,
        status: event === "PURCHASE_COMPLETE" ? "COMPLETED" : "APPROVED",
        price: { currency_value: "BRL", value: 100 },
        offer: { code: "offer-test", name: "Oferta de teste" },
        order_bump: { is_order_bump: withAttribution },
      },
      buyer: {
        name: "Pessoa de teste",
        email: "pessoa@example.invalid",
        document: "documento-pessoal-teste",
      },
    },
  };
}

describe("Hotmart webhook normalization", () => {
  it("aceita PURCHASE_COMPLETE sem hotmart_fee e converte o nome interno", () => {
    const [envelope] = parseHotmartWebhookPayload(
      realShapeFixture("PURCHASE_COMPLETE", false),
    );
    const event = normalizeHotmartWebhookEvent(envelope);

    expect(event).toMatchObject({
      eventType: "PURCHASE_COMPLETED",
      grossAmount: 100,
      netAmount: 70,
      currency: "BRL",
      payload: {
        source_event_type: "PURCHASE_COMPLETE",
        net_amount_source: "producer_commission",
        attribution: { sck: "instagram|organic|bio" },
      },
    });
  });

  it("preserva atribuição e contato, sem CPF ou endereço", () => {
    const [envelope] = parseHotmartWebhookPayload(
      realShapeFixture("PURCHASE_APPROVED", true),
    );
    const event = normalizeHotmartWebhookEvent(envelope);

    expect(event?.payload).toMatchObject({
      attribution: {
        sck: "meta-ads|campanha|conjunto|anuncio",
        xcod: "pagina-teste",
      },
      is_order_bump: true,
    });
    expect(event?.payload.contact).toMatchObject({ email: "pessoa@example.invalid" });
    expect(JSON.stringify(event?.payload)).not.toContain("documento-pessoal-teste");
  });

  it("usa taxa explicita e depois valor bruto como alternativas seguras", () => {
    const withFee = realShapeFixture("PURCHASE_APPROVED", false);
    withFee.data.commissions = [];
    Object.assign(withFee.data.purchase, { hotmart_fee: { total: 15 } });
    const [withFeeEnvelope] = parseHotmartWebhookPayload(withFee);

    expect(normalizeHotmartWebhookEvent(withFeeEnvelope)).toMatchObject({
      netAmount: 85,
      payload: { net_amount_source: "gross_minus_hotmart_fee" },
    });

    const withoutNetDetails = realShapeFixture("PURCHASE_APPROVED", false);
    withoutNetDetails.data.commissions = [];
    const [withoutNetEnvelope] = parseHotmartWebhookPayload(withoutNetDetails);

    expect(normalizeHotmartWebhookEvent(withoutNetEnvelope)).toMatchObject({
      netAmount: 100,
      payload: { net_amount_source: "gross_fallback" },
    });
  });

  it("ignora eventos que nao representam venda contabilizada", () => {
    const [envelope] = parseHotmartWebhookPayload({
      event: "PURCHASE_DELAYED",
      buyer: { email: "pessoa@example.invalid" },
    });

    expect(normalizeHotmartWebhookEvent(envelope)).toBeNull();
  });
});
