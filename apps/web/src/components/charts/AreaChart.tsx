import { useState } from "react";
import { formatMoney } from "@/utils/format";

interface MonthData { m: string; income: number; expense: number; }

export function AreaChart({ data }: { data: MonthData[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 580, H = 246, pl = 12, pr = 12, pt = 18, pb = 30;
  const innerW = W - pl - pr, innerH = H - pt - pb;
  const max = Math.max(...data.flatMap((m) => [m.income, m.expense])) * 1.14;
  const n = data.length;
  const xs = (i: number) => pl + (n < 2 ? innerW / 2 : (innerW * i) / (n - 1));
  const yv = (v: number) => pt + innerH * (1 - v / max);
  const lineP = (k: "income" | "expense") =>
    data.map((m, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${yv(m[k]).toFixed(1)}`).join(" ");
  const areaP = (k: "income" | "expense") =>
    lineP(k) + ` L${xs(n - 1).toFixed(1)} ${pt + innerH} L${xs(0).toFixed(1)} ${pt + innerH} Z`;
  const incomeColor = "var(--income)", expenseColor = "var(--expense)";

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        <defs>
          <linearGradient id="gInc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={incomeColor} stopOpacity={0.3} />
            <stop offset="100%" stopColor={incomeColor} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={expenseColor} stopOpacity={0.22} />
            <stop offset="100%" stopColor={expenseColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f, i) => (
          <line key={i} x1={pl} y1={(pt + innerH * (1 - f)).toFixed(1)} x2={W - pr} y2={(pt + innerH * (1 - f)).toFixed(1)}
            stroke="var(--border)" strokeWidth={1} />
        ))}
        <path d={areaP("income")} fill="url(#gInc)" />
        <path d={areaP("expense")} fill="url(#gExp)" />
        <path d={lineP("income")} fill="none" stroke={incomeColor} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        <path d={lineP("expense")} fill="none" stroke={expenseColor} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        {hover != null && (
          <>
            <line x1={xs(hover)} y1={pt} x2={xs(hover)} y2={pt + innerH} stroke="var(--border)" strokeWidth={1.5} strokeDasharray="3 3" />
            <circle cx={xs(hover)} cy={yv(data[hover].income)} r={4.5} fill="var(--surface)" stroke={incomeColor} strokeWidth={2.5} />
            <circle cx={xs(hover)} cy={yv(data[hover].expense)} r={4.5} fill="var(--surface)" stroke={expenseColor} strokeWidth={2.5} />
          </>
        )}
        {data.map((_, i) => {
          const bw = innerW / (n - 1 || 1);
          return (
            <rect key={i} x={(xs(i) - bw / 2).toFixed(1)} y={0} width={bw} height={H}
              fill="transparent" style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
        })}
        {data.map((m, i) => (
          <text key={i} x={xs(i)} y={H - 9} textAnchor="middle" fill="var(--muted)"
            fontSize={11} fontFamily="Be Vietnam Pro">{m.m}</text>
        ))}
      </svg>
      {hover != null && (
        <div className="absolute top-1.5 pointer-events-none rounded-[11px] p-3 min-w-[140px] z-10 text-[11px]"
          style={{ left: `${(xs(hover) / W) * 100}%`, transform: "translateX(-50%)", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow)" }}>
          <div className="font-bold mb-1.5">Tháng {data[hover].m.replace("T", "")}</div>
          <div className="flex justify-between gap-3 mb-0.5">
            <span style={{ color: "var(--muted)" }}>Thu</span>
            <b style={{ color: "var(--income)" }}>{formatMoney(data[hover].income)}</b>
          </div>
          <div className="flex justify-between gap-3 mb-0.5">
            <span style={{ color: "var(--muted)" }}>Chi</span>
            <b style={{ color: "var(--expense)" }}>{formatMoney(data[hover].expense)}</b>
          </div>
          <div className="flex justify-between gap-3 pt-1 mt-1 border-t" style={{ borderColor: "var(--border)" }}>
            <span style={{ color: "var(--muted)" }}>Net</span>
            <b>+{formatMoney(data[hover].income - data[hover].expense)}</b>
          </div>
        </div>
      )}
    </div>
  );
}
