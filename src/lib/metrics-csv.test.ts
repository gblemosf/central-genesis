import { describe, expect, it } from "vitest";
import {
  inspectMetricsCsv,
  MetricsCsvError,
  parseMetricsCsv,
} from "@/lib/metrics-csv";

const headers = "date,invest,impressions,clicks,pageviews,checkouts,core,ob1,ob2,ob3";

describe("parseMetricsCsv", () => {
  it("le uma linha diaria combinada com numeros brasileiros", () => {
    const rows = parseMetricsCsv(
      "data;investimento;impressoes;cliques;page_views;checkouts;vendas_core;vendas_ob1;vendas_ob2;vendas_ob3\n01/08/2026;1.234,56;10000;250;180;20;3;2;1;0",
    );

    expect(rows).toEqual([{
      date: "2026-08-01",
      invest: 1234.56,
      impressions: 10000,
      clicks: 250,
      pageviews: 180,
      checkouts: 20,
      core: 3,
      ob1: 2,
      ob2: 1,
      ob3: 0,
    }]);
  });

  it("rejeita datas duplicadas", () => {
    expect(() => parseMetricsCsv(
      `${headers}\n2026-08-01,80,1000,100,80,10,1,0,0,0\n2026-08-01,90,1100,110,85,11,2,0,0,0`,
    )).toThrow(MetricsCsvError);
  });

  it("exige todos os dados observados da linha", () => {
    expect(() => parseMetricsCsv(
      "date,invest,impressions,clicks,pageviews,checkouts,core,ob1,ob2\n2026-08-01,80,1000,100,80,10,1,0,0",
    )).toThrow(/ob3/);
  });

  it("rejeita conteudo numerico ou data parcialmente validos", () => {
    expect(() => parseMetricsCsv(
      `${headers}\n2026-08-01texto,80,1000,100,80,10,1,0,0,0`,
    )).toThrow(/data invalida/);
    expect(() => parseMetricsCsv(
      `${headers}\n2026-08-01,80,1000,100,80,10,12vendas,0,0,0`,
    )).toThrow(/valor invalido/);
    expect(() => parseMetricsCsv(
      `${headers}\n2026-08-01,80,1000,100,80,10,,0,0,0`,
    )).toThrow(/nao pode ficar vazio/);
  });

  it("interpreta separador de milhar brasileiro", () => {
    const rows = parseMetricsCsv(
      "date;invest;impressions;clicks;pageviews;checkouts;core;ob1;ob2;ob3\n2026-08-01;1.234;10.000;250;180;20;3;2;1;0",
    );

    expect(rows[0]).toMatchObject({ invest: 1234, impressions: 10000 });
  });

  it("preserva linha e valores originais para preview", () => {
    const result = inspectMetricsCsv(
      `${headers}\n2026-08-01,80,1000,100,80,10,2,1,0,0`,
    );

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      line: 2,
      raw: { date: "2026-08-01", core: "2", ob1: "1" },
      data: { date: "2026-08-01", invest: 80, core: 2, ob1: 1 },
    });
  });

  it("retorna todos os erros de linha na inspecao", () => {
    const result = inspectMetricsCsv(
      `${headers}\n2026-08-40,80,1000,100,80,10,1,0,0,0\n2026-08-02,80,1000,100,80,10,invalido,0,0,0`,
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((error) => error.line)).toEqual([2, 3]);
  });
});
