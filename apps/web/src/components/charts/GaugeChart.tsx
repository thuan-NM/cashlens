export function GaugeChart({ pct }: { pct: number }) {
  const radius = 72;
  const circumference = Math.PI * radius;
  const fraction = Math.max(0, Math.min(1, pct / 100));

  return (
    <svg viewBox="0 0 200 116" width="100%" className="block max-w-[200px]">
      <path d="M28 100 A72 72 0 0 1 172 100" fill="none" stroke="var(--surface-3)" strokeWidth={18} strokeLinecap="round" />
      <path
        d="M28 100 A72 72 0 0 1 172 100"
        fill="none"
        stroke="var(--accent)"
        strokeWidth={18}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        className="transition-[stroke-dashoffset] duration-1000"
      />
      <text x={100} y={88} textAnchor="middle" fill="var(--text)" fontSize={27} fontWeight={700} fontFamily="Be Vietnam Pro">{pct}%</text>
      <text x={100} y={106} textAnchor="middle" fill="var(--muted)" fontSize={10} fontFamily="Be Vietnam Pro">tỷ lệ tiết kiệm</text>
    </svg>
  );
}
