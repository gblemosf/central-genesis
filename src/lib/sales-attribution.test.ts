import { describe, expect, it } from "vitest";
import { saleAttribution } from "./sales-attribution";

describe("landing pages and checkout addresses", () => {
  it.each([
    "https://pay.hub.la/offer?utm_source=FB",
    "https://pay.hotmart.com/OFFER",
    "https://checkout.payt.com.br/offer",
    "https://pay.assiny.com.br/offer",
    "https://store.example/checkout/offer",
  ])("keeps legacy checkout %s out of landing-page coverage", (checkout) => {
    expect(saleAttribution({ landing_url: checkout })).toMatchObject({
      page: null,
      checkoutUrl: checkout,
    });
  });

  it("keeps an explicitly supplied landing page together with its checkout", () => {
    expect(saleAttribution({
      landing_url: "https://pay.hub.la/offer",
      page_url: "https://example.invalid/scd",
      utm: { source: "FB" },
    })).toMatchObject({
      page: "https://example.invalid/scd",
      checkoutUrl: "https://pay.hub.la/offer",
      source: "FB",
    });
  });

  it("resolves only an existing product page code and never invents a landing from checkout UTMs", () => {
    const origin = { xcod: "dpaf6860", landing_url: "https://pay.hotmart.com/OFFER?utm_campaign=pagina" };
    expect(saleAttribution(origin, "8304193").page).toBe("https://bravuscursos.com.br/da-prova-a-farda-v2h1/");
    expect(saleAttribution(origin, "other").page).toBeNull();
  });

  it("does not classify unrelated host names or articles mentioning checkout as payment URLs", () => {
    expect(saleAttribution({ page_url: "https://pay.hub.la.example.invalid/article" }).page)
      .toBe("https://pay.hub.la.example.invalid/article");
    expect(saleAttribution({ page_url: "https://example.invalid/blog/checkout" }).page)
      .toBe("https://example.invalid/blog/checkout");
    expect(saleAttribution({ landing_url: "javascript:alert(1)", checkout_url: "javascript:alert(2)" }))
      .toMatchObject({ page: null, checkoutUrl: null });
  });
});
