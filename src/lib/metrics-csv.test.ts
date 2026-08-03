import { describe, expect, it } from "vitest";
import { MetricsCsvError, parseMetricsCsv } from "@/lib/metrics-csv";

describe("parseMetricsCsv", () => {
  it("le trafego separado por ponto e virgula e numeros brasileiros", () => {
    const rows = parseMetricsCsv(
      "data;investimento;impressoes;cliques;page_views;checkouts\n01/08/2026;1.234,56;10000;250;180;20",
      "traffic",
    );

    expect(rows).toEqual([
      {
        date: "2026-08-01",
        invest: 1234.56,
        impressions: 10000,
        clicks: 250,
        pageviews: 180,
        checkouts: 20,
      },
    ]);
  });

  it("le vendas com order bumps opcionais", () => {
    const rows = parseMetricsCsv(
      "date,core,ob1,ob2,fat_liquido\n2026-08-01,3,2,1,\"197,60\"",
      "sales",
    );

    expect(rows[0]).toMatchObject({
      date: "2026-08-01",
      core: 3,
      ob1: 2,
      ob2: 1,
      ob3: 0,
      fat_liquido: 197.6,
    });
  });

  it("rejeita datas duplicadas", () => {
    expect(() =>
      parseMetricsCsv(
        "date,core,fat_liquido\n2026-08-01,1,20\n2026-08-01,2,40",
        "sales",
      ),
    ).toThrow(MetricsCsvError);
  });

  it("informa colunas obrigatorias ausentes", () => {
    expect(() => parseMetricsCsv("date,core\n2026-08-01,1", "sales")).toThrow(
      /fat_liquido/,
    );
  });

  it("rejeita conteudo numerico ou data parcialmente validos", () => {
    expect(() =>
      parseMetricsCsv(
        "date,core,fat_liquido\n2026-08-01texto,1,20",
        "sales",
      ),
    ).toThrow(/data invalida/);
    expect(() =>
      parseMetricsCsv(
        "date,core,fat_liquido\n2026-08-01,12vendas,20",
        "sales",
      ),
    ).toThrow(/valor invalido/);
    expect(() =>
      parseMetricsCsv("date,core,fat_liquido\n2026-08-01,,20", "sales"),
    ).toThrow(/nao pode ficar vazio/);
  });

  it("interpreta separador de milhar brasileiro", () => {
    const rows = parseMetricsCsv(
      "date;invest;impressions;clicks;pageviews;checkouts\n2026-08-01;1.234;10.000;250;180;20",
      "traffic",
    );

    expect(rows[0]).toMatchObject({ invest: 1234, impressions: 10000 });
  });
});
