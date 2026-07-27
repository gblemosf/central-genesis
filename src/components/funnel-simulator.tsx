"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import type { FunnelStage } from "@/lib/domain";
import { defaultFunnel } from "@/lib/demo-data";
import { calculateFunnel } from "@/lib/metrics";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

export function FunnelSimulator() {
  const [mode, setMode] = useState<"cascade" | "base">("cascade");
  const [stages, setStages] = useState<FunnelStage[]>(defaultFunnel);
  const [adCost, setAdCost] = useState(30000);
  const [extraCost, setExtraCost] = useState(5000);
  const [target, setTarget] = useState(100000);
  const calculated = calculateFunnel(stages, mode);
  const revenue = calculated.reduce((sum, stage) => sum + stage.revenue, 0);
  const cost = adCost + extraCost;
  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const roas = adCost > 0 ? revenue / adCost : 0;

  function updateStage(index: number, patch: Partial<FunnelStage>) {
    setStages((current) =>
      current.map((stage, stageIndex) =>
        stageIndex === index ? { ...stage, ...patch } : stage,
      ),
    );
  }

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-3">Laboratorio comercial</p>
          <h1 className="text-4xl font-black tracking-[-0.055em] sm:text-5xl">
            Simulador de funil
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--muted)]">
            Modele cenarios sem alterar os dados reais de performance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setStages(defaultFunnel);
            setAdCost(30000);
            setExtraCost(5000);
          }}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/50 px-4 py-2.5 text-xs font-bold"
        >
          <RotateCcw size={15} /> Restaurar
        </button>
      </header>

      <section className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <article className="panel rounded-[24px] p-5 sm:p-6">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Regra de conversao</p>
                <h2 className="mt-2 text-xl font-black tracking-[-0.035em]">
                  Caminho dos produtos
                </h2>
              </div>
              <div className="flex rounded-xl bg-black/[0.045] p-1">
                <button
                  type="button"
                  onClick={() => setMode("cascade")}
                  className={`rounded-lg px-3 py-2 text-[10px] font-bold ${
                    mode === "cascade" ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"
                  }`}
                >
                  Cascata
                </button>
                <button
                  type="button"
                  onClick={() => setMode("base")}
                  className={`rounded-lg px-3 py-2 text-[10px] font-bold ${
                    mode === "base" ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"
                  }`}
                >
                  Base Low Ticket
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
              {calculated.map((stage, index) => (
                <div
                  key={stage.id}
                  className="relative overflow-hidden rounded-[20px] border border-[var(--line)] bg-white/52 p-4"
                >
                  <span className="absolute right-3 top-3 text-[10px] font-black text-[var(--muted)]">
                    0{index + 1}
                  </span>
                  <input
                    value={stage.name}
                    onChange={(event) => updateStage(index, { name: event.target.value })}
                    className="mb-5 w-[80%] bg-transparent text-sm font-black outline-none"
                  />
                  <label className="mb-3 block text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Preco
                    <input
                      className="field mt-1.5 py-2 text-right text-xs"
                      inputMode="decimal"
                      value={stage.price}
                      onChange={(event) =>
                        updateStage(index, { price: Number(event.target.value) || 0 })
                      }
                    />
                  </label>
                  {index === 0 ? (
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      Vendas base
                      <input
                        className="field mt-1.5 py-2 text-right text-xs"
                        value={stage.quantity}
                        onChange={(event) =>
                          updateStage(index, { quantity: Number(event.target.value) || 0 })
                        }
                      />
                    </label>
                  ) : (
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      Conversao (%)
                      <input
                        className="field mt-1.5 py-2 text-right text-xs"
                        value={stage.conversionRate}
                        onChange={(event) =>
                          updateStage(index, {
                            conversionRate: Number(event.target.value) || 0,
                          })
                        }
                      />
                    </label>
                  )}
                  <div className="mt-5 border-t border-[var(--line)] pt-4">
                    <p className="text-[9px] uppercase tracking-wider text-[var(--muted)]">
                      Projecao
                    </p>
                    <p className="mt-1 text-lg font-black">{formatCurrency(stage.revenue)}</p>
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {formatNumber(stage.quantity)} vendas
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="panel grid gap-4 rounded-[24px] p-5 sm:grid-cols-3 sm:p-6">
            <label className="space-y-2 text-xs font-bold">
              Investimento em trafego
              <input
                className="field"
                inputMode="decimal"
                value={adCost}
                onChange={(event) => setAdCost(Number(event.target.value) || 0)}
              />
            </label>
            <label className="space-y-2 text-xs font-bold">
              Custos adicionais
              <input
                className="field"
                inputMode="decimal"
                value={extraCost}
                onChange={(event) => setExtraCost(Number(event.target.value) || 0)}
              />
            </label>
            <label className="space-y-2 text-xs font-bold">
              Meta de faturamento
              <input
                className="field"
                inputMode="decimal"
                value={target}
                onChange={(event) => setTarget(Number(event.target.value) || 0)}
              />
            </label>
          </article>
        </div>

        <aside className="h-fit rounded-[26px] bg-[var(--sidebar)] p-6 text-white xl:sticky xl:top-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">
            Resultado simulado
          </p>
          <p className="mt-5 text-4xl font-black tracking-[-0.055em]">
            {formatCurrency(revenue)}
          </p>
          <p className="mt-1 text-xs text-white/40">Faturamento projetado</p>

          <div className="mt-7 space-y-4">
            {[
              ["Lucro", formatCurrency(profit)],
              ["Margem", formatPercent(margin)],
              ["ROAS", `${roas.toFixed(2)}x`],
              ["Custo total", formatCurrency(cost)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-white/8 pb-3 text-xs">
                <span className="text-white/45">{label}</span>
                <span className="font-black">{value}</span>
              </div>
            ))}
          </div>

          <div className="mt-7">
            <div className="mb-2 flex justify-between text-[10px] text-white/45">
              <span>Progresso da meta</span>
              <span>{formatPercent(Math.min((revenue / Math.max(target, 1)) * 100, 100), 0)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-[var(--signal)]"
                style={{ width: `${Math.min((revenue / Math.max(target, 1)) * 100, 100)}%` }}
              />
            </div>
          </div>
          <p className="mt-7 rounded-xl bg-white/[0.045] p-4 text-[11px] leading-5 text-white/48">
            Este cenario nao altera as metricas reais. Salve-o futuramente como
            planejamento do projeto.
          </p>
        </aside>
      </section>
    </div>
  );
}
